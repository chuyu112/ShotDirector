import test from 'node:test';
import assert from 'node:assert/strict';
import { ShotWorkScheduler, SHOT_WORK_LIMIT } from '../server/shot-work-scheduler.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
test('Creator, Chat and Reviewer share five slots, preserve FIFO, and release on failure', async () => {
  const pool = new ShotWorkScheduler();
  const started = [], releases = [];
  const jobs = Array.from({ length: 8 }, (_, i) => pool.run({ projectUid: 'project', shotUid: `shot-${i}`, shotId: `${i}`, type: ['complete-shot-prompt', 'prompt-review', 'shot-chat'][i % 3] }, () => new Promise((resolve, reject) => {
    started.push(i); releases[i] = i === 0 ? () => reject(Error('provider failed')) : resolve;
  })).catch(error => error.message));
  await tick();
  assert.equal(SHOT_WORK_LIMIT, 5);
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  assert.deepEqual(pool.snapshot(), { limit: 5, active: 5, queued: 3 });
  assert.throws(() => pool.run({ projectUid: 'project', shotUid: 'shot-1' }, () => {}), /已有任务/);
  assert.throws(() => pool.run({ projectUid: 'project', shotUid: 'shot-7' }, () => {}), /已有任务/);
  releases[0](); await tick();
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
  for (let i = 1; i < 8; i++) { releases[i](); await tick(); }
  assert.equal((await Promise.all(jobs))[0], 'provider failed');
  assert.deepEqual(pool.snapshot(), { limit: 5, active: 0, queued: 0 });
  assert.equal(await pool.run({ projectUid: 'project', shotUid: 'shot-1' }, () => 'retry'), 'retry');
});
