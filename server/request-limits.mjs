export const MAX_ANNOTATION_BATCH_SHOTS = 20;
export const MAX_MANGA_BATCH_PAGES = 40;
export const MODEL_IMAGE_BATCH_SIZE = 4;

function budgetInputError(message, { code = "AI_BUDGET_INPUT_INVALID", limit, received } = {}) {
  const error = new Error(message);
  error.statusCode = code === "MEDIA_BATCH_LIMIT_EXCEEDED" ? 413 : 400;
  error.code = code;
  if (limit !== undefined) error.limit = limit;
  if (received !== undefined) error.received = received;
  return error;
}

function auditedMediaIdCount(payload, routeLabel) {
  if (!Array.isArray(payload?.mediaIds) || !payload.mediaIds.length) {
    throw budgetInputError(`${routeLabel}缺少可审计的 mediaIds`);
  }
  if (payload.mediaIds.some((mediaId) => typeof mediaId !== "string" || !mediaId.trim())) {
    throw budgetInputError(`${routeLabel}的 mediaIds 格式无效`);
  }
  if (new Set(payload.mediaIds).size !== payload.mediaIds.length) {
    throw budgetInputError(`${routeLabel}的 mediaIds 不得重复`);
  }
  if (payload.mediaIds.length > MAX_MANGA_BATCH_PAGES) {
    throw budgetInputError(`${routeLabel}单次最多提交 ${MAX_MANGA_BATCH_PAGES} 页（收到 ${payload.mediaIds.length} 页）`, {
      code: "MEDIA_BATCH_LIMIT_EXCEEDED",
      limit: MAX_MANGA_BATCH_PAGES,
      received: payload.mediaIds.length,
    });
  }
  return payload.mediaIds.length;
}

export function dynamicAiModelCallBudget(path, payload) {
  if (path === "/media-analyze") {
    const count = auditedMediaIdCount(payload, "素材分析请求");
    if (payload?.kind === "video") {
      if (count !== 1) throw budgetInputError("视频拉片每次必须且只能提交 1 个 mediaId");
      return 2;
    }
    if (payload?.kind !== "manga") throw budgetInputError("素材分析类型必须是 manga 或 video");
    return 6 * Math.ceil(count / MODEL_IMAGE_BATCH_SIZE);
  }
  if (path === "/manga-recut-boxes") {
    const count = auditedMediaIdCount(payload, "漫画重裁请求");
    return 2 * Math.ceil(count / MODEL_IMAGE_BATCH_SIZE);
  }
  return null;
}

export function assertAnnotationBatchShotLimit(payload) {
  if (!Array.isArray(payload?.items)) return 0;
  const received = payload.items.length;
  if (received <= MAX_ANNOTATION_BATCH_SHOTS) return received;

  const error = new Error(
    `全片批注单次最多提交 ${MAX_ANNOTATION_BATCH_SHOTS} 个 Shot（收到 ${received} 个）`,
  );
  error.statusCode = 413;
  error.code = "ANNOTATION_BATCH_LIMIT_EXCEEDED";
  error.limit = MAX_ANNOTATION_BATCH_SHOTS;
  error.received = received;
  throw error;
}
