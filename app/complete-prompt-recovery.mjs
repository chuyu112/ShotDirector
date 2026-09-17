export const completePromptRecoveryGraceMs = 10_000;

export function completePromptRecoveryPlan({
  status = "",
  sourceRevision = "",
  generationStartedAt = "",
  hasActiveJob = false,
  hasTerminalJob = false,
  now = Date.now(),
  graceMs = completePromptRecoveryGraceMs,
} = {}) {
  if (status !== "generating") return { action: "ignore" };
  if (hasActiveJob) return { action: "wait" };

  const startedAt = Date.parse(String(generationStartedAt || ""));
  const age = Number.isFinite(startedAt) ? now - startedAt : Number.POSITIVE_INFINITY;
  const insideSubmissionGrace = age >= -graceMs && age < graceMs;
  if (!hasTerminalJob && insideSubmissionGrace) return { action: "wait" };
  if (!String(sourceRevision || "").trim()) {
    return {
      action: "unlock",
      message: "上次生成缺少版本信息，已解除占用，请重新生成。",
    };
  }
  return { action: "query" };
}

export function completePromptRecoveryHttpAction(httpStatus, payloadStatus = "") {
  if (httpStatus === 202 && ["queued", "running"].includes(payloadStatus)) return "wait";
  if (httpStatus >= 200 && httpStatus < 300 && payloadStatus === "completed") return "recover";
  if ([400, 404, 410, 422, 500].includes(httpStatus)) return "unlock";
  return "retry";
}
