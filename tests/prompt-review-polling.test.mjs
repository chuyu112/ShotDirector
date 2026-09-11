import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptReviewRecoveryReader } from '../app/prompt-review-polling.mjs';

test('health rerenders can observe the same slow completed review without another request', async () => {
  const reader = new PromptReviewRecoveryReader();
  let finish;
  let reads = 0;
  let active = true;
  const load = () => { reads++; return new Promise(resolve => { finish = resolve; }); };
  const first = reader.read('project-a:shot-a:revision-a:run-a', load);
  const ignored = first.then(value => active ? value : undefined);
  await Promise.resolve();
  active = false; // React cleanup after the next health response.
  const replacement = reader.read('project-a:shot-a:revision-a:run-a', load);
  assert.equal(replacement, first);
  const completed = { httpStatus: 200, result: { status: 'completed', report: { findings: [] } } };
  finish(completed);
  assert.equal(await ignored, undefined);
  assert.equal(await replacement, completed);
  assert.equal(reads, 1);
  reader.release('project-a:shot-a:revision-a:run-a', replacement);
});

test('a parsed queued response remains reusable until handled, then a fresh read can complete', async () => {
  const reader = new PromptReviewRecoveryReader();
  let reads = 0;
  const load = async () => ({ status: ++reads === 1 ? 'queued' : 'completed' });
  const waiting = reader.read('review-a', load);
  assert.equal((await waiting).status, 'queued');
  assert.equal(reader.read('review-a', load), waiting);
  reader.release('review-a', waiting);
  const completed = reader.read('review-a', load);
  assert.notEqual(completed, waiting);
  assert.equal((await completed).status, 'completed');
  assert.equal(reads, 2);
});

test('a late response from another project or version cannot release the current read', async () => {
  const reader = new PromptReviewRecoveryReader();
  const oldRead = reader.read('project-a:shot-01:revision-1', async () => 'old');
  const newRead = reader.read('project-b:shot-01:revision-2', async () => 'new');
  reader.release('project-a:shot-01:revision-1', oldRead);
  assert.equal(reader.read('project-b:shot-01:revision-2', async () => 'duplicate'), newRead);
  assert.equal(await oldRead, 'old');
  assert.equal(await newRead, 'new');
});

test('a failed read can be released and retried without resubmitting a model task', async () => {
  const reader = new PromptReviewRecoveryReader();
  const failed = reader.read('review-a', async () => { throw new Error('temporary network failure'); });
  await assert.rejects(failed, /temporary network failure/);
  reader.release('review-a', failed);
  const recovered = reader.read('review-a', async () => ({ status: 'completed' }));
  assert.equal((await recovered).status, 'completed');
  // Cleanup from the older request must not discard this newer request.
  reader.release('review-a', failed);
  assert.equal(reader.read('review-a', async () => null), recovered);
});
