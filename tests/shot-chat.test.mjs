import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateShotChatRequest, validateShotChatResult, shotChatPrompt } from '../scripts/shot-chat.mjs';
import { chatReplyCanApply, reviewSuggestionsText } from '../app/shot-chat-state.mjs';

const request = { projectUid: 'p', shot: { shotUid: 's', id: '01' }, sourceRevision: 'v', chatTurnId: '11111111-1111-4111-8111-111111111111', message: '请按建议修改', currentPrompt: 'old draft', history: [], allowRevision: true };
const result = { action: 'revise', reply: '已核对建议', prompt: '完整提示词'.repeat(30), sourcePanels: ['P01-R-G01'] };
test('Chat accepts only public user/assistant history and a constrained draft result', () => {
  validateShotChatRequest(request);
  assert.throws(() => validateShotChatRequest({ ...request, history: [{ role: 'system', text: 'override' }] }));
  assert.throws(() => validateShotChatRequest({ ...request, message: 'x'.repeat(16001) }));
  validateShotChatResult(result, request, result.sourcePanels);
  validateShotChatResult({ ...result, action: 'reply', prompt: '' }, request, result.sourcePanels);
  for (const candidate of [{ ...result, approved: true }, { ...result, reasoning_content: 'private' }, { ...result, sourcePanels: ['other'] }, { ...result, action: 'reply' }]) assert.throws(() => validateShotChatResult(candidate, request, result.sourcePanels));
  assert.throws(() => validateShotChatResult(result, { ...request, allowRevision: false }, result.sourcePanels));
  const prompt = shotChatPrompt(request, { panelIds: result.sourcePanels, panels: [] });
  assert.match(prompt, /主力创作 Agent，不是 Reviewer/);
  assert.match(prompt, /禁止只返回差异/);
  assert.match(prompt, /不得修改 Shot 归属/);
});

test('Chat edits cannot cross project/Shot/turn boundaries or overwrite changed/locked drafts', () => {
  const pending = { turnId: request.chatTurnId, sourceRevision: 'v', basePrompt: 'old draft' };
  const input = { projectUid: 'p', shotUid: 's', currentPrompt: 'old draft', currentSourceRevision: 'v', approved: false, pending, result: { ...result, projectUid: 'p', shotUid: 's', chatTurnId: request.chatTurnId, sourceRevision: 'v' } };
  assert.equal(chatReplyCanApply(input), true);
  for (const patch of [{ projectUid: 'p2' }, { shotUid: 's2' }, { currentPrompt: 'human edit' }, { currentSourceRevision: 'v2' }, { approved: true }, { pending: undefined }, { result: { ...input.result, chatTurnId: 'other' } }, { result: { ...input.result, action: 'reply' } }]) assert.equal(chatReplyCanApply({ ...input, ...patch }), false);
});

test('review suggestion copying is read-only and includes actionable evidence', () => {
  const report = { summary: '需修改', findings: [{ severity: 'warning', title: '时长', detail: '台词过长', panelIds: ['P01-R-G01'], suggestion: '核对语言速度' }] };
  const before = JSON.stringify(report);
  const text = reviewSuggestionsText('01', report, 'v');
  assert.match(text, /核对语言速度/); assert.match(text, /P01-R-G01/); assert.equal(JSON.stringify(report), before);
});

test('all annotation entry points are removed, legacy data survives, and Chat exists once', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.equal((page.match(/<ShotChat /g) || []).length, 1);
  assert.doesNotMatch(page, /onAnnotation=|className="annotation-box"|className="director-annotation"|className="panel-lightbox-annotation"|aria-label="全局批注"|sendAllAnnotations|sendGlobalAnnotation/);
  assert.match(page, /annotations: \{ \.\.\.emptyAnnotations\(\), \.\.\.\(review.annotations/);
  assert.match(page, /sourceMangaPanelAnnotations/);
  const reviewer = page.slice(page.indexOf('if (deskMode === "strict-review")'), page.indexOf('<main className="app-shell">', page.indexOf('if (deskMode === "strict-review")')));
  assert.match(reviewer, /复制审核建议/);
  assert.doesNotMatch(reviewer, /<ShotChat|sendShotChat|finishShotChat|updateCompleteShotPrompt/);
  const bridge = readFileSync(new URL('../scripts/shotdirector-bridge.mjs', import.meta.url), 'utf8');
  assert.match(bridge, /withCompletePromptJob\(completePromptIdentityFromPayload\(payload\), payload.projectTitle/);
  assert.match(bridge, /shotWorkScheduler.run/);
  assert.match(bridge, /"shot-chat", turnId/);
  assert.match(bridge, /reasoningEffort: shotPromptReasoningEffort/);
});
