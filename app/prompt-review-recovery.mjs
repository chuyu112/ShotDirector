export const promptReviewRecoveryTimeoutMs = 21 * 60 * 1000;

export function promptReviewRecoveryDecision({
  httpStatus = 0,
  resultStatus = "",
  terminalJobStatus = "",
  startedAt = "",
  now = Date.now(),
  timeoutMs = promptReviewRecoveryTimeoutMs,
} = {}) {
  if (httpStatus === 200 && resultStatus === "completed") return { action: "completed" };
  if (httpStatus === 202 || resultStatus === "running") return { action: "waiting" };
  if (resultStatus === "failed" || terminalJobStatus === "failed") return { action: "failed", reason: "terminal" };
  if (terminalJobStatus === "completed" && httpStatus >= 400) return { action: "failed", reason: "missing-result" };

  const explicitClientFailure = httpStatus >= 400
    && httpStatus < 500
    && httpStatus !== 404
    && httpStatus !== 409;
  if (explicitClientFailure) return { action: "failed", reason: "request" };

  const startedAtMs = Date.parse(String(startedAt || ""));
  if (Number.isFinite(startedAtMs) && now - startedAtMs >= timeoutMs) {
    return { action: "failed", reason: "timeout" };
  }
  return { action: "waiting" };
}
