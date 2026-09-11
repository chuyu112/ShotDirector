import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingShotChats, ShotChatRecoveryPoller } from '../app/shot-chat-recovery.mjs';

function clock() {
  let id = 0;
  const timers = new Map();
  return {
    timers,
    schedule(callback, delay) { timers.set(++id, { callback, delay }); return id; },
    cancel(key) { timers.delete(key); },
    fire(key = timers.keys().next().value) {
      const timer = timers.get(key);
      assert.ok(timer, 'a scheduled read must exist');
      timers.delete(key);
      return timer.callback();
    },
  };
}
const review = (shotUid, turnId) => ({ shot: { shotUid }, chat: { pending: { turnId, sourceRevision: 'v1', basePrompt: 'old', startedAt: '2026-09-11T00:00:00Z' } } });

test('Chat recovery includes every saved pending Shot, independent of the selected Shot', async () => {
  const state = { currentShot: 0, reviews: [review('a', 'turn-a'), review('b', 'turn-b'), { shot: { shotUid: 'c' } }] };
  const initial = pendingShotChats('workspace', 'project', state.reviews);
  state.currentShot = 2;
  assert.deepEqual(pendingShotChats('workspace', 'project', state.reviews), initial);
  const time = clock(), poller = new ShotChatRecoveryPoller(time), calls = [];
  const recover = async target => calls.push([target.projectUid, target.shotUid, target.pending.turnId]);
  poller.update(initial, recover);
  const reads = [...time.timers.keys()];
  assert.equal(reads.length, 2);
  await Promise.all(reads.map(id => time.fire(id)));
  assert.deepEqual(calls, [['project', 'a', 'turn-a'], ['project', 'b', 'turn-b']]);
  poller.dispose();
});

test('health updates and another Shot starting do not reset or duplicate a slow Chat read', async () => {
  const time = clock(), poller = new ShotChatRecoveryPoller(time);
  const a = review('a', 'turn-a'), b = review('b', 'turn-b');
  let finish, reads = 0;
  const recover = async () => { reads++; await new Promise(resolve => { finish = resolve; }); };
  poller.update(pendingShotChats('workspace', 'project', [a]), recover);
  const firstTimer = [...time.timers.keys()][0];
  for (let n = 0; n < 5; n++) poller.update(pendingShotChats('workspace', 'project', [a]), recover);
  assert.deepEqual([...time.timers.keys()], [firstTimer]);
  const inFlight = time.fire();
  poller.update(pendingShotChats('workspace', 'project', [a, b]), recover);
  assert.equal(reads, 1);
  assert.equal(time.timers.size, 1, 'only new Shot B is scheduled while A is in flight');
  finish(); await inFlight;
  assert.deepEqual([...time.timers.values()].map(item => item.delay).sort(), [1500, 3000]);
  poller.dispose();
});

test('removing one completed turn preserves other Shot polling and re-reads after transport failures', async () => {
  const time = clock(), poller = new ShotChatRecoveryPoller(time), calls = [];
  const a = review('a', 'turn-a'), b = review('b', 'turn-b');
  const recover = async target => { calls.push(target.shotUid); if (calls.length === 1) throw new Error('504'); };
  poller.update(pendingShotChats('workspace', 'project', [a, b]), recover);
  const [aTimer, bTimer] = time.timers.keys();
  await time.fire(aTimer);
  assert.equal(time.timers.size, 2);
  poller.update(pendingShotChats('workspace', 'project', [b]), recover);
  assert.deepEqual([...time.timers.keys()], [bTimer]);
  await time.fire(bTimer);
  await time.fire();
  assert.deepEqual(calls, ['a', 'b', 'b']);
  poller.dispose();
  assert.equal(time.timers.size, 0);
});

test('changing workspace aborts old reads; late results cannot apply or restart their loop', async () => {
  const time = clock(), poller = new ShotChatRecoveryPoller(time), applied = [];
  let resolveOld, oldSignal;
  poller.update(pendingShotChats('old-workspace', 'project', [review('a', 'same-turn')]), async (target, signal) => {
    oldSignal = signal;
    await new Promise(resolve => { resolveOld = resolve; });
    if (!signal.aborted) applied.push(target.scopeId);
  });
  const oldRead = time.fire();
  poller.update(pendingShotChats('new-workspace', 'project', [review('a', 'same-turn')]), async target => { applied.push(target.scopeId); });
  assert.equal(oldSignal.aborted, true);
  resolveOld(); await oldRead;
  assert.equal(time.timers.size, 1);
  await time.fire();
  assert.deepEqual(applied, ['new-workspace']);
  poller.dispose();
});
