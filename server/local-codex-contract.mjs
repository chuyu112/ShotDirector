import { createHmac, timingSafeEqual } from 'node:crypto';

export const LOCAL_CODEX_SELECTION = 'local-codex-gpt-6';
export const LOCAL_CODEX_MODEL = 'gpt-6-astra';
export const LOCAL_CODEX_SOL_SELECTION = 'local-codex-gpt-5.6-sol';
export const LOCAL_CODEX_SOL_MODEL = 'gpt-5.6-sol';
export const LOCAL_CODEX_MODELS = Object.freeze([
  Object.freeze({ selection: LOCAL_CODEX_SELECTION, model: LOCAL_CODEX_MODEL, label: '本地 Codex GPT-6' }),
  Object.freeze({ selection: LOCAL_CODEX_SOL_SELECTION, model: LOCAL_CODEX_SOL_MODEL, label: '本地 Codex GPT-5.6 Sol' }),
]);
const LOCAL_CODEX_MODEL_IDS = new Set(LOCAL_CODEX_MODELS.map(({ model }) => model));
export const LOCAL_CODEX_PROVIDER = 'local-codex';
export const LOCAL_CODEX_MAX_BYTES = 32 * 1024 * 1024;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const taskIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function localCodexError(message, statusCode = 400, code = 'LOCAL_CODEX_INVALID_REQUEST') {
  return Object.assign(new Error(message), { statusCode, code });
}

export function isSupportedLocalCodexModel(model) {
  return LOCAL_CODEX_MODEL_IDS.has(String(model || '').trim());
}

export function localCodexCredentialMatches(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return b.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

export function localCodexWorkerToken(secret, userId, projectId) {
  if (!idPattern.test(userId) || !idPattern.test(projectId)) throw localCodexError('本地 Codex 项目身份无效');
  return createHmac('sha256', secret).update(`manjing-local-codex-v1:${userId}:${projectId}`).digest('hex');
}

export function localCodexWorkerEnvironment(env, userId, projectId) {
  if (env.MANJING_LOCAL_CODEX_OWNER_ID !== userId || String(env.MANJING_LOCAL_CODEX_TOKEN || '').length < 32) return {};
  return {
    MANJING_LOCAL_CODEX_RELAY_URL: env.MANJING_LOCAL_CODEX_RELAY_URL || 'http://127.0.0.1:8080/api/local-codex',
    MANJING_LOCAL_CODEX_WORKER_TOKEN: localCodexWorkerToken(env.MANJING_LOCAL_CODEX_TOKEN, userId, projectId),
  };
}

export function normalizeLocalCodexTask(input) {
  if (!input || !isSupportedLocalCodexModel(input.model)) throw localCodexError('本地 Codex 通道只接受已验证的 GPT-6 Astra 或 GPT-5.6 Sol');
  if (!taskIdPattern.test(input.id) || !idPattern.test(input.projectId) || !idPattern.test(input.userId)) throw localCodexError('本地 Codex 任务身份无效');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 2_000_000) throw localCodexError('本地 Codex 提示词为空或过长');
  if (!input.schema || typeof input.schema !== 'object' || Array.isArray(input.schema)) throw localCodexError('本地 Codex 任务缺少结构化输出规则');
  if (!['low', 'high', 'max'].includes(input.reasoningEffort)) throw localCodexError('本地 Codex 推理深度无效');
  if (['prompt-review', 'complete-shot-prompt', 'shot-chat'].includes(input.schemaName) && input.reasoningEffort !== 'max') throw localCodexError('完整提示词、Chat 与严格审核必须使用 MAX');
  const images = input.images || [];
  if (!Array.isArray(images) || images.length > 40) throw localCodexError('本地 Codex 图片数量超限');
  let bytes = 0;
  for (const image of images) {
    if (!image || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mime)
      || typeof image.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw localCodexError('本地 Codex 图片格式无效');
    bytes += Buffer.byteLength(image.data, 'base64');
  }
  if (bytes > 24 * 1024 * 1024) throw localCodexError('本地 Codex 图片总量超限');
  return {
    id: input.id, userId: input.userId, projectId: input.projectId,
    model: String(input.model), prompt: input.prompt,
    instructions: String(input.instructions || '').slice(0, 200_000),
    schema: input.schema, schemaName: String(input.schemaName || 'structured').slice(0, 80),
    reasoningEffort: input.reasoningEffort, images: images.map(({ mime, data }) => ({ mime, data })),
    timeoutMs: Math.max(1_000, Math.min(Number(input.timeoutMs) || 900_000, 1_800_000)),
  };
}
