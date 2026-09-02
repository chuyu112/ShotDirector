export class PaidTaskCreatedError extends Error {
  constructor(message, taskId) {
    super(message);
    this.name = "PaidTaskCreatedError";
    this.taskId = taskId || undefined;
    this.retryPolicy = "manual-check-required";
  }
}

export class PaidSubmissionUnknownError extends Error {
  constructor(message) {
    super(message);
    this.name = "PaidSubmissionUnknownError";
    this.retryPolicy = "manual-check-required";
  }
}

export function extractPaidTaskId(text) {
  const source = String(text || "");
  const match = source.match(/\btask(?:Id)?\s*[=:]\s*([a-z0-9][a-z0-9_-]{5,})/i);
  return match?.[1];
}

export function isAmbiguousSubmissionFailure(text) {
  return /timed?\s*out|timeout|ECONNRESET|ECONNREFUSED|socket hang up|connection (?:closed|lost|reset)|network error|bad gateway|gateway timeout|\b50[0234]\b/i.test(String(text || ""));
}

export function paidFailureFor({ paidOperation, taskId, stderr, stdout, fallback }) {
  if (!paidOperation) return fallback;
  const resolvedTaskId = taskId || extractPaidTaskId(`${stderr || ""}\n${stdout || ""}`);
  if (resolvedTaskId) {
    return new PaidTaskCreatedError(`LibTV 已创建付费任务 ${resolvedTaskId}，但本地未能确认最终结果。请先在原画布检查或恢复该任务，禁止直接重复提交。`, resolvedTaskId);
  }
  if (isAmbiguousSubmissionFailure(`${stderr || ""}\n${stdout || ""}\n${fallback?.message || ""}`)) {
    return new PaidSubmissionUnknownError("LibTV 提交后的网络状态不明确，任务可能已经计费。请先检查原画布，禁止自动重试。");
  }
  return fallback;
}

export function mustNotAutoResubmit(error) {
  return error?.name === "PaidTaskCreatedError" || error?.name === "PaidSubmissionUnknownError" || error?.retryPolicy === "manual-check-required";
}

export function paidTaskId(error) {
  return typeof error?.taskId === "string" ? error.taskId : undefined;
}
