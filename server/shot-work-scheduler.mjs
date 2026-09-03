// One shared project-worker pool for Creator, Chat and independent Reviewer.
// A queued/running Shot owns its stable key, so two tasks cannot race its draft.
export const SHOT_WORK_LIMIT = 5;

export class ShotWorkScheduler {
  #active = 0;
  #queue = [];
  #owned = new Map();

  snapshot() {
    return { limit: SHOT_WORK_LIMIT, active: this.#active, queued: this.#queue.length };
  }

  run(job, work, onStart = () => {}) {
    const key = JSON.stringify([job.projectUid, job.shotUid || job.shotId]);
    if (!job.projectUid || !(job.shotUid || job.shotId)) throw new Error('Shot 工作任务缺少稳定身份');
    if (this.#owned.has(key)) {
      throw Object.assign(new Error(`Shot ${job.shotId} 已有任务运行或排队，请等待完成`), { statusCode: 409 });
    }
    if (this.#queue.length >= 100) throw Object.assign(new Error('Shot 等待队列已满，请稍后提交'), { statusCode: 429 });
    return new Promise((resolve, reject) => {
      const item = { key, job, work, onStart, resolve, reject };
      this.#owned.set(key, item);
      this.#queue.push(item);
      this.#pump();
    });
  }

  #pump() {
    while (this.#active < SHOT_WORK_LIMIT && this.#queue.length) {
      const item = this.#queue.shift();
      this.#active++;
      Promise.resolve().then(() => { item.onStart(); return item.work(); }).then(
        result => { this.#release(item); item.resolve(result); },
        error => { this.#release(item); item.reject(error); },
      );
    }
  }

  #release(item) {
    this.#active--;
    this.#owned.delete(item.key);
    this.#pump();
  }
}
