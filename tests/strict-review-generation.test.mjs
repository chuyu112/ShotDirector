import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindReviewerIdentity, generateStrictReview, strictReviewTokenBudget, REVIEW_CHECKS } from '../server/strict-review-generation.mjs';
const schema = JSON.parse(readFileSync(new URL('../scripts/prompt-review.schema.json', import.meta.url)));
const report = keys => ({ status: 'completed', shotId: '01', reviewerId: 'glm-5.3', evidence: { sourcePanels: ['R-G02', 'R-G01'] }, report: { verdict: 'needs-revision', summary: '需要修改', strengths: [], checks: Object.fromEntries(keys.map(k => [k, false])), findings: [{ id: '1', severity: 'blocking', panelIds: ['R-G02'], title: '冲突' }] } });
test('server binds only omitted reviewer identity without changing judgments or hiding mismatches', () => {
  const candidate=report(REVIEW_CHECKS);
  delete candidate.reviewerId;
  const bound=bindReviewerIdentity(candidate,'glm-5.3');
  assert.equal(bound.reviewerId,'glm-5.3');
  assert.equal(bound.report,candidate.report);
  assert.equal(bound.evidence,candidate.evidence);
  assert.equal(candidate.reviewerId,undefined);
  assert.equal(bindReviewerIdentity({...candidate,reviewerId:'wrong'},'glm-5.3').reviewerId,'wrong');
});
test('review budget is separate from legacy generic output limit', () => {
  assert.equal(strictReviewTokenBudget('glm', 16384), 65536);
  assert.equal(strictReviewTokenBudget('jiekou-anthropic', undefined), 65536);
  assert.equal(strictReviewTokenBudget('kimi', 16384), 32768);
});
test('terminal truncation partitions checks with full evidence and merges without changing the Shot', async () => {
  const calls = [];
  const result = await generateStrictReview({ prompt: 'ALL_EVIDENCE', schema,
    generate: async (prompt, s, phase) => {
      calls.push(phase); assert.match(prompt, /ALL_EVIDENCE/);
      if (phase === 'full') throw Object.assign(new Error('limit'), { code: 'output_limit' });
      return report(s.properties.report.properties.checks.required);
    },
    validate: r => { assert.equal(r.shotId, '01'); assert.deepEqual(r.evidence.sourcePanels, ['R-G02', 'R-G01']); assert.equal(Object.keys(r.report.checks).length, 6); },
  });
  assert.deepEqual(calls, ['full', 'part-1', 'part-2']);
  assert.deepEqual(Object.keys(result.report.checks).sort(), [...REVIEW_CHECKS].sort());
  assert.ok(Object.values(result.report.checks).every(v => v === false));
  assert.equal(new Set(result.report.findings.map(f => f.id)).size, 2);
});
test('504 never retries automatically and incomplete stages never produce a report', async () => {
  let calls = 0;
  await assert.rejects(generateStrictReview({ prompt: 'x', schema, validate: () => {}, generate: async () => { calls++; throw Object.assign(new Error('504'), { code: 'upstream_http' }); } }), /504/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(generateStrictReview({ prompt: 'x', schema, validate: () => {}, generate: async () => {
    if (++calls === 1) throw Object.assign(new Error('length'), { code: 'output_limit' });
    return report(['sourceBoundary']);
  } }), /检查项不完整/);
  assert.equal(calls, 2);
});
