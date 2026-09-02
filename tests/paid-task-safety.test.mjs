import test from "node:test";
import assert from "node:assert/strict";
import { extractPaidTaskId, mustNotAutoResubmit, paidFailureFor, PaidSubmissionUnknownError, PaidTaskCreatedError } from "../scripts/paid-task-safety.mjs";

test("a reported remote task is never converted into an ordinary retry", () => {
  const stderr = "[run] task=task_abc123 accepted\nconnection reset";
  assert.equal(extractPaidTaskId(stderr), "task_abc123");
  const error = paidFailureFor({ paidOperation: "image", stderr, stdout: "", fallback: new Error("CLI failed") });
  assert.ok(error instanceof PaidTaskCreatedError);
  assert.equal(error.taskId, "task_abc123");
  assert.equal(mustNotAutoResubmit(error), true);
});

test("ambiguous post-submit network failures require a manual canvas check", () => {
  const error = paidFailureFor({ paidOperation: "image", stderr: "504 Gateway Timeout", stdout: "", fallback: new Error("failed") });
  assert.ok(error instanceof PaidSubmissionUnknownError);
  assert.equal(mustNotAutoResubmit(error), true);
});

test("ordinary validation errors remain manually retryable", () => {
  const fallback = new Error("prompt is empty");
  assert.equal(paidFailureFor({ paidOperation: "image", stderr: "", stdout: "", fallback }), fallback);
  assert.equal(mustNotAutoResubmit(fallback), false);
});
