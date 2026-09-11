import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createShotContentReviewStore } from '../server/shot-content-review.mjs';
import { contentReviewTarget, contentReviewGuard, validateContentWorksheet, initialContentWorksheet, contentStructurePatch } from '../app/shot-content-review.mjs';
import { buildPromptReviewRevision, buildCompleteShotPromptRevision } from '../app/video-package.ts';
import { contentReviewState, contentPanelIds, completedContentWorksheet } from './fixtures/content-review-data.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'manjing-content-'));
  const draftDirectory = join(root, 'drafts'); mkdirSync(draftDirectory);
  const path = join(draftDirectory, 'scope.json');
  const initial = { scopeId: 'scope', storageKey: 'test', state: contentReviewState() };
  writeFileSync(path, JSON.stringify(initial));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let imageVersion = 'original', textVersion = 'A', busy = false;
  const readEvidence = (_, panelId) => ({ bytes: Buffer.from(`${panelId}-${imageVersion}`), sourceObservation: textVersion, sourceText: [], imagePath: `/test/${panelId}` });
  const store = createShotContentReviewStore({ directory: join(root, 'records'), draftDirectory, readEvidence, isBusy: () => busy });
  const open = () => store.prepare({ scopeId: 'scope', projectUid: initial.state.projectUid, shotUid: initial.state.reviews[0].shot.shotUid });
  const latest = () => JSON.parse(readFileSync(path, 'utf8'));
  return { store, open, initial, path, latest, root, changeImage: () => { imageVersion = 'changed'; }, changeText: () => { textVersion = 'changed'; }, setBusy: () => { busy = true; } };
}

test('prepare and unfinished save preserve every original fact, draft and approval; resume has no default decisions', t => {
  const f = fixture(t); const bytes = readFileSync(f.path, 'utf8'); const session = f.open();
  assert.deepEqual(session.worksheet.panels.map(p => [p.checked, p.decision, p.observation]), contentPanelIds.map(() => [false, '', '']));
  assert.equal(session.worksheet.action, f.initial.state.reviews[0].shot.action);
  const unfinished = structuredClone(session.worksheet); unfinished.panels[0].decision = 'uncertain';
  f.store.save({ id: session.id, worksheet: unfinished });
  assert.equal(f.open().id, session.id); assert.deepEqual(f.open().worksheet, unfinished);
  assert.equal(readFileSync(f.path, 'utf8'), bytes);
  assert.throws(() => f.store.preview({ id: session.id, worksheet: unfinished }), /核对/);
  assert.throws(() => f.store.confirm({ id: session.id, acknowledge: true }), /预览/);
});

test('confirmation applies only the human-entered structural patch and retains prompt, report provenance, media and raw evidence', t => {
  const f = fixture(t); const session = f.open(); const worksheet = completedContentWorksheet(session);
  const preview = f.store.preview({ id: session.id, worksheet });
  assert.deepEqual(f.latest(), f.initial);
  assert.throws(() => f.store.confirm({ id: session.id, proposalHash: preview.proposalHash }), /人工确认/);
  const result = f.store.confirm({ id: session.id, proposalHash: preview.proposalHash, acknowledge: true });
  const before = f.initial.state.reviews[0], after = result.snapshot.state.reviews[0];
  for (const key of ['completePrompt', 'completePromptGeneratorId', 'completePromptGeneratorProvider', 'completePromptGeneratedAt', 'chat', 'versions', 'artworkNames', 'whiteboxScenes', 'promptReviewReport', 'promptReviewSourceRevision', 'promptReviewRunId', 'promptReviewRequestId', 'promptReviewedAt']) assert.deepEqual(after[key], before[key], key);
  const allowed = new Set(['action', 'negative', 'continuity', 'segments', 'contentConfirmation']);
  for (const key of Object.keys(before.shot)) if (!allowed.has(key)) assert.deepEqual(after.shot[key], before.shot[key], key);
  assert.deepEqual(result.snapshot.state.reviews[1].shot, f.initial.state.reviews[1].shot);
  assert.deepEqual(result.snapshot.state.sourceMangaPanels, f.initial.state.sourceMangaPanels);
  assert.equal(result.snapshot.state.globalSettings.storyBackground, f.initial.state.globalSettings.storyBackground);
  assert.equal(after.completePromptStatus, 'stale'); assert.equal(after.promptReviewStatus, 'stale'); assert.equal(after.approved, false);
  assert.equal(result.snapshot.state.reviews[1].promptReviewStatus, 'stale');
  assert.deepEqual(result.snapshot.state.contentReviewHistory[0].before.reviews, f.initial.state.reviews);
  assert.ok(result.snapshot.agentRevision);
  const second = f.store.confirm({ id: session.id, proposalHash: preview.proposalHash, acknowledge: true });
  assert.equal(second.snapshot.state.contentReviewHistory.length, 1);
  assert.throws(() => f.store.save({ id: session.id, worksheet }), /不可覆盖/);
  const record = JSON.parse(readFileSync(join(f.root, 'records', `${session.id}.json`)));
  assert.deepEqual(record.before, f.initial);
});

test('strict review and Creator receive human facts with the original model claims explicitly separated', t => {
  const f = fixture(t); const session = f.open(); const worksheet = completedContentWorksheet(session);
  worksheet.panels[0].textStatus = 'unreadable'; worksheet.panels[0].note = '原文字形无法辨读，保持未知';
  const preview = f.store.preview({ id: session.id, worksheet });
  const { snapshot } = f.store.confirm({ id: session.id, proposalHash: preview.proposalHash, acknowledge: true });
  const payload = { projectUid: snapshot.state.projectUid, sourceMangaRequestId: snapshot.state.sourceMangaRequestId, shot: snapshot.state.reviews[0].shot };
  const raw = contentPanelIds.map(panelId => ({ panelId, sourceObservation: 'A', sourceText: [{ text: '旧模型猜测的台词' }] }));
  const effective = f.store.confirmedEvidence(payload, raw);
  assert.equal(effective[0].sourceObservation, worksheet.panels[0].observation);
  assert.deepEqual(effective[0].sourceText, []);
  assert.equal(effective[0].humanConfirmation.textStatus, 'unreadable');
  assert.equal(effective[0].machineEvidence.sourceObservation, 'A');
  assert.deepEqual(raw[0].sourceText, [{ text: '旧模型猜测的台词' }]);
  assert.throws(() => f.store.confirmedEvidence({ ...payload, projectUid: 'another-project' }, raw), /不匹配/);
  assert.throws(() => f.store.confirmedEvidence({ ...payload, shot: { ...payload.shot, contentConfirmation: undefined } }, raw), /请刷新/);
  f.changeImage(); assert.throws(() => f.store.confirmedEvidence(payload, raw), /裁图或文字证据已变化/);
});

for (const [name, change] of [
  ['prompt', f => { const snapshot = f.latest(); snapshot.state.reviews[0].completePrompt += 'new'; writeFileSync(f.path, JSON.stringify(snapshot)); }],
  ['global timeline', f => { const snapshot = f.latest(); snapshot.state.globalSettings.timeline.push('new'); writeFileSync(f.path, JSON.stringify(snapshot)); }],
  ['original crop', f => f.changeImage()], ['original text', f => f.changeText()], ['running job', f => f.setBusy()],
]) test(`stale confirmation is rejected when ${name} changes`, t => {
  const f = fixture(t); const session = f.open(); const preview = f.store.preview({ id: session.id, worksheet: completedContentWorksheet(session) });
  change(f); const before = readFileSync(f.path, 'utf8');
  assert.throws(() => f.store.confirm({ id: session.id, proposalHash: preview.proposalHash, acknowledge: true }));
  assert.equal(readFileSync(f.path, 'utf8'), before);
});

test('edited worksheets require a new exact preview and cannot change unrelated creative fields', t => {
  const f = fixture(t); const session = f.open(); const worksheet = completedContentWorksheet(session);
  const preview = f.store.preview({ id: session.id, worksheet });
  worksheet.action += ' 第二版'; f.store.save({ id: session.id, worksheet });
  assert.throws(() => f.store.confirm({ id: session.id, proposalHash: preview.proposalHash, acknowledge: true }), /预览/);
  assert.throws(() => f.store.preview({ id: session.id, worksheet: { ...worksheet, story: '越权修改剧情' } }), /范围之外/);
});

test('timing and scope validation covers missing/extra/reordered panels, gaps, overlap, overrun and unresolved facts', t => {
  const f = fixture(t); const sheet = completedContentWorksheet(f.open());
  assert.deepEqual(validateContentWorksheet(sheet, contentPanelIds), []);
  for (const mutate of [
    s => s.panels[0].checked = false, s => s.panels[0].decision = 'uncertain',
    s => s.segments[1].start = 11, s => s.segments[1].start = 9,
    s => s.segments[1].end = 27, s => s.segments[1].end = 25,
    s => s.segments[1].panelIds.pop(), s => s.segments[1].panelIds.push('P02-R-G09'),
    s => s.segments[0].panelIds.reverse(), s => s.panels.reverse(),
    s => s.panels[0].sourceText.push({ speaker: 'AI', text: '凭空的台词' }),
    s => s.action = '本镜 8 秒', s => s.negative = ['不得超出 P02-R-G06'],
    s => s.action = '估算需要 8 秒，当前设置为 8 秒', s => s.action = 'P02-R-G09 加入本镜动作',
    s => s.continuity = ['止于 G04'], s => s.timeline = ['Shot 01 旧 8 秒，止于 G04'],
  ]) { const changed = structuredClone(sheet); mutate(changed); assert.ok(validateContentWorksheet(changed, contentPanelIds).length); }
  assert.equal(contentReviewTarget({ ...f.initial.state.reviews[0].shot, duration: 8 }), false);
  const internal = structuredClone(sheet); internal.action = '总时长 26 秒，前 8 秒内部节拍保留，G04 到 G06 之间的动作保持原序。';
  assert.deepEqual(validateContentWorksheet(internal, contentPanelIds), []);
});

test('new structural/evidence version and later manual prompt edits produce different strict-review revisions', t => {
  const f = fixture(t), session = f.open();
  const preview = f.store.preview({ id: session.id, worksheet: completedContentWorksheet(session) });
  const { snapshot } = f.store.confirm({ id: session.id, proposalHash: preview.proposalHash, acknowledge: true });
  const revision = review => buildPromptReviewRevision({ shotId: review.shot.id, completePrompt: review.completePrompt, completePromptSourceRevision: review.completePromptSourceRevision, completePromptGeneratorId: review.completePromptGeneratorId, reviewerId: 'fixture' });
  const after = snapshot.state.reviews[0];
  assert.notEqual(revision(after), revision(f.initial.state.reviews[0]));
  assert.notEqual(revision(after), revision({ ...after, completePrompt: `${after.completePrompt}人工后续编辑` }));
  const input = state => ({ projectTitle: state.projectTitle, modelId: state.generationModel, globalSettings: state.globalSettings, shot: state.reviews[0].shot, shotAnnotations: {}, panelAnnotations: {}, sourceMangaRequestId: state.sourceMangaRequestId });
  assert.notEqual(buildCompleteShotPromptRevision(input(snapshot.state)), buildCompleteShotPromptRevision(input(f.initial.state)));
  assert.equal(contentReviewGuard({ ...f.initial.state, currentShot: 1, view: 'artwork' }), contentReviewGuard(f.initial.state));
});

test('required visual facts in mustShow are preserved separately from panel coverage', () => {
  const state = contentReviewState();
  state.reviews[0].shot.segments[0].mustShow.push('保留道具朝向与手势，不新增动作');
  const sheet = initialContentWorksheet(state.reviews[0], state.globalSettings.timeline);
  assert.deepEqual(sheet.segments[0].mustShow, ['保留道具朝向与手势，不新增动作']);
  assert.ok(contentStructurePatch(sheet).segments[0].mustShow.includes('保留道具朝向与手势，不新增动作'));
  sheet.segments[0].mustShow.push('必须呈现 P02-R-G09');
  assert.ok(validateContentWorksheet(sheet, contentPanelIds).some(error => /范围外画格/.test(error)));
});

test('a nonconsecutive human panel selection remains authoritative; omitted G04 cannot leak into action', () => {
  const state = contentReviewState();
  const ids = contentPanelIds.map(id => id === 'P02-R-G04' ? 'P01-L-G03' : id);
  state.reviews[0].shot.sourcePanels = ids;
  assert.equal(contentReviewTarget(state.reviews[0].shot), true);
  const sheet = completedContentWorksheet({ worksheet: initialContentWorksheet(state.reviews[0], state.globalSettings.timeline) });
  sheet.panels = sheet.panels.map((panel, i) => ({ ...panel, panelId: ids[i] }));
  sheet.segments = [{ start: 0, end: 26, beat: '保留人工原序', framing: '固定构图', panelIds: ids }];
  assert.deepEqual(validateContentWorksheet(sheet, ids), []);
  sheet.action += '，执行 P02-R-G04 的动作';
  assert.ok(validateContentWorksheet(sheet, ids).some(error => error.includes('P02-R-G04')));
});
