import assert from "node:assert/strict";
import test from "node:test";

import {
  promptReviewRecoveryDecision,
  promptReviewRecoveryTimeoutMs,
} from "../app/prompt-review-recovery.mjs";

test("strict review keeps waiting through transient disconnects and result-file races", () => {
  const now = Date.parse("2026-09-06T02:49:06+08:00");
  const startedAt = "2026-09-06T02:45:25+08:00";

  assert.deepEqual(promptReviewRecoveryDecision({ httpStatus: 0, startedAt, now }), { action: "waiting" });
  assert.deepEqual(promptReviewRecoveryDecision({ httpStatus: 404, startedAt, now }), { action: "waiting" });
  assert.deepEqual(promptReviewRecoveryDecision({ httpStatus: 502, startedAt, now }), { action: "waiting" });
  assert.deepEqual(promptReviewRecoveryDecision({ httpStatus: 202, resultStatus: "running", startedAt, now }), { action: "waiting" });
});

test("strict review only surfaces a confirmed failure or an expired recovery window", () => {
  const now = Date.parse("2026-09-06T03:10:00+08:00");
  assert.deepEqual(promptReviewRecoveryDecision({ httpStatus: 500, resultStatus: "failed", now }), { action: "failed", reason: "terminal" });
  assert.deepEqual(promptReviewRecoveryDecision({ httpStatus: 404, terminalJobStatus: "completed", now }), { action: "failed", reason: "missing-result" });
  assert.deepEqual(promptReviewRecoveryDecision({ httpStatus: 401, now }), { action: "failed", reason: "request" });
  assert.deepEqual(promptReviewRecoveryDecision({
    httpStatus: 404,
    startedAt: new Date(now - promptReviewRecoveryTimeoutMs).toISOString(),
    now,
  }), { action: "failed", reason: "timeout" });
});

test("strict review accepts a completed recovered report", () => {
  assert.deepEqual(promptReviewRecoveryDecision({ httpStatus: 200, resultStatus: "completed" }), { action: "completed" });
});
