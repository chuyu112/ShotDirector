import assert from "node:assert/strict";
import test from "node:test";
import { promptReviewControls, promptReviewShotLabel } from "../app/prompt-review-controls.mjs";

const ready = {
  review: { shot: { id: "01" }, completePrompt: "current draft", completePromptStatus: "ready", completePromptSourceRevision: "current-v2", promptReviewStatus: "empty" },
  reviewer: { available: true },
  bridge: { connected: true, pairingToken: "test-only", busy: true },
  hasSource: true,
};

test("other Shots generating cannot lock reviewer selection or ready Shot submission", () => {
  assert.deepEqual(promptReviewControls(ready), { selectingDisabled: false, submitDisabled: false, reason: "", action: "" });
});

test("another Shot review does not block submission into the shared queue", () => {
  const controls = promptReviewControls({ ...ready, bridge: { ...ready.bridge, activeJob: { type: "prompt-review", status: "running", shotId: "02" } } });
  assert.equal(controls.selectingDisabled, false);
  assert.equal(controls.submitDisabled, false);
  assert.equal(controls.reason, "");
});

test("a running current review cannot be switched or submitted twice", () => {
  for (const input of [
    { ...ready, review: { ...ready.review, promptReviewStatus: "reviewing" } },
    { ...ready, bridge: { ...ready.bridge, activeJob: { type: "prompt-review", status: "running", shotId: "01" } } },
  ]) {
    assert.equal(promptReviewControls(input).selectingDisabled, true);
    assert.equal(promptReviewControls(input).submitDisabled, true);
  }
});

test("every unsupported state has a visible reason without marking drafts ready", () => {
  for (const input of [
    { ...ready, bridge: { ...ready.bridge, connected: false } },
    { ...ready, bridge: { ...ready.bridge, pairingToken: undefined } },
    { ...ready, bridge: { ...ready.bridge, draining: true } },
    { ...ready, reviewer: { available: false, reason: "未配置" } },
    { ...ready, hasSource: false },
    ...["empty", "stale", "error", "generating"].map(completePromptStatus => ({ ...ready, review: { ...ready.review, completePromptStatus } })),
    { ...ready, review: { ...ready.review, completePrompt: " " } },
    { ...ready, review: { ...ready.review, completePromptSourceRevision: undefined } },
  ]) {
    const before = JSON.stringify(input);
    const controls = promptReviewControls(input);
    assert.equal(controls.submitDisabled, true);
    assert.ok(controls.reason);
    assert.equal(controls.selectingDisabled, false);
    assert.equal(JSON.stringify(input), before);
  }
});

test("shot navigation distinguishes stale drafts and active generation from ready drafts", () => {
  assert.equal(promptReviewShotLabel(ready.review), "待审核");
  assert.equal(promptReviewShotLabel({ ...ready.review, completePromptStatus: "stale" }), "提示词需更新");
  assert.equal(promptReviewShotLabel({ ...ready.review, completePromptStatus: "generating" }), "提示词生成中");
});
