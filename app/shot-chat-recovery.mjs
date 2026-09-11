// Each saved Chat turn keeps its own read-only polling lifecycle. Selection and
// health updates must not cancel or restart work belonging to another Shot.
export function pendingShotChats(scopeId, projectUid, reviews) {
  return reviews.flatMap(review => review.shot.shotUid && review.chat?.pending
    ? [{ scopeId, projectUid, shotUid: review.shot.shotUid, pending: review.chat.pending }] : []);
}

export class ShotChatRecoveryPoller {
  #entries = new Map();
  #recover;
  #schedule;
  #cancel;

  constructor({ schedule = (callback, delay) => setTimeout(callback, delay), cancel = timer => clearTimeout(timer) } = {}) {
    this.#schedule = schedule;
    this.#cancel = cancel;
  }

  update(targets, recover) {
    this.#recover = recover;
    const remaining = new Set(this.#entries.keys());
    for (const target of targets) {
      const key = JSON.stringify([target.scopeId, target.projectUid, target.shotUid, target.pending.turnId, target.pending.sourceRevision]);
      remaining.delete(key);
      const existing = this.#entries.get(key);
      if (existing) { existing.target = target; continue; }
      const entry = { target, controller: new AbortController(), timer: undefined };
      this.#entries.set(key, entry);
      const poll = async () => {
        try { await this.#recover(entry.target, entry.controller.signal); }
        catch { /* A failed read never resubmits the model turn. */ }
        if (!entry.controller.signal.aborted) entry.timer = this.#schedule(poll, 3000);
      };
      entry.timer = this.#schedule(poll, 1500);
    }
    for (const key of remaining) this.#remove(key);
  }

  #remove(key) {
    const entry = this.#entries.get(key);
    if (!entry) return;
    entry.controller.abort();
    this.#cancel(entry.timer);
    this.#entries.delete(key);
  }

  dispose() {
    for (const key of this.#entries.keys()) this.#remove(key);
  }
}
