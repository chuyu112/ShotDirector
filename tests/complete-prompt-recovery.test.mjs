import test from "node:test";
import assert from "node:assert/strict";
import {
  completePromptRecoveryGraceMs,
  completePromptRecoveryHttpAction,
  completePromptRecoveryPlan,
} from "../app/complete-prompt-recovery.mjs";

test("complete prompt recovery waits for live jobs and the submission registration window", () => {
  const now = Date.parse("2026-09-18T00:00:10.000Z");
  assert.equal(completePromptRecoveryPlan({
    status: "generating",
    sourceRevision: "complete-new",
    generationStartedAt: "2026-09-18T00:00:09.000Z",
    now,
  }).action, "wait");
  assert.equal(completePromptRecoveryPlan({
    status: "generating",
    sourceRevision: "complete-new",
    generationStartedAt: "2026-09-17T23:00:00.000Z",
    hasActiveJob: true,
    now,
  }).action, "wait");
  assert.equal(completePromptRecoveryGraceMs, 10_000);
});

test("complete prompt recovery queries durable results after restart and unlocks malformed stale state", () => {
  const now = Date.parse("2026-09-18T00:00:10.000Z");
  assert.equal(completePromptRecoveryPlan({
    status: "generating",
    sourceRevision: "complete-old",
    generationStartedAt: "2026-09-17T23:00:00.000Z",
    now,
  }).action, "query");
  assert.equal(completePromptRecoveryPlan({
    status: "generating",
    sourceRevision: "complete-finished",
    generationStartedAt: "2026-09-18T00:00:09.000Z",
    hasTerminalJob: true,
    now,
  }).action, "query");
  assert.deepEqual(completePromptRecoveryPlan({
    status: "generating",
    sourceRevision: "",
    generationStartedAt: "2026-09-17T23:00:00.000Z",
    now,
  }), {
    action: "unlock",
    message: "上次生成缺少版本信息，已解除占用，请重新生成。",
  });
});

test("complete prompt recovery distinguishes active, durable, terminal failure, and transient HTTP responses", () => {
  assert.equal(completePromptRecoveryHttpAction(202, "queued"), "wait");
  assert.equal(completePromptRecoveryHttpAction(202, "running"), "wait");
  assert.equal(completePromptRecoveryHttpAction(200, "completed"), "recover");
  assert.equal(completePromptRecoveryHttpAction(404, ""), "unlock");
  assert.equal(completePromptRecoveryHttpAction(500, "failed"), "unlock");
  assert.equal(completePromptRecoveryHttpAction(401, ""), "retry");
  assert.equal(completePromptRecoveryHttpAction(502, ""), "retry");
});
