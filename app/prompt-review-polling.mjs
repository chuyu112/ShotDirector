// Keep one parsed response available across health-driven React effect reruns.
// A replacement effect must be able to observe an earlier in-flight read;
// treating "requested" as "handled" can strand a completed review forever.
export class PromptReviewRecoveryReader {
  #pending;

  read(key, load) {
    if (this.#pending?.key === key) return this.#pending.response;
    const response = Promise.resolve().then(load);
    this.#pending = { key, response };
    return response;
  }

  release(key, response) {
    if (this.#pending?.key === key && this.#pending.response === response) this.#pending = undefined;
  }
}
