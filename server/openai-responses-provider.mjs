import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 35 * 60 * 1000;
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function normalizedBaseUrl(value) {
  const baseUrl = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("OpenAI API Base URL 必须使用 HTTPS");
  }
  return baseUrl;
}

function safeSchemaName(value) {
  const name = String(value || "manjing_structured_output")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return name || "manjing_structured_output";
}

function mimeFor(path) {
  switch (extname(path).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    default: throw new Error(`不支持作为模型输入的图片格式：${extname(path) || "未知"}`);
  }
}

function insideRoot(path, root) {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function checkedImagePath(path, allowedRoots) {
  const absolute = resolve(String(path || ""));
  const actual = await realpath(absolute);
  const actualRoots = await Promise.all(allowedRoots.map(async (root) => realpath(root).catch(() => resolve(root))));
  if (actualRoots.length && !actualRoots.some((root) => insideRoot(actual, root))) {
    throw new Error("模型图片路径不属于当前用户工作区");
  }
  return actual;
}

function sanitizedMetadata(metadata) {
  return Object.fromEntries(Object.entries(metadata || {}).slice(0, 16).flatMap(([key, value]) => {
    const safeKey = String(key).replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 64);
    const safeValue = String(value ?? "").slice(0, 512);
    return safeKey && safeValue ? [[safeKey, safeValue]] : [];
  }));
}

function stableSafetyIdentifier(value) {
  const normalized = String(value || "anonymous");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 64);
}

function responseOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const chunks = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== "message") continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if ((content?.type === "output_text" || content?.type === "text") && typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("").trim();
}

function combinedSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export class OpenAIResponsesProvider {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    baseUrl = process.env.OPENAI_BASE_URL,
    organization = process.env.OPENAI_ORG_ID,
    project = process.env.OPENAI_PROJECT_ID,
    fetchImpl = globalThis.fetch,
    allowedRoots = [],
    maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  } = {}) {
    this.apiKey = String(apiKey || "").trim();
    this.baseUrl = normalizedBaseUrl(baseUrl);
    this.organization = String(organization || "").trim();
    this.project = String(project || "").trim();
    this.fetchImpl = fetchImpl;
    this.allowedRoots = allowedRoots.map((root) => resolve(root));
    this.maxImageBytes = Math.max(1, Number(maxImageBytes) || DEFAULT_MAX_IMAGE_BYTES);
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async imageContent(imagePaths, detail = "high") {
    const uniquePaths = [...new Set((imagePaths || []).filter(Boolean))];
    return Promise.all(uniquePaths.map(async (path) => {
      const actual = await checkedImagePath(path, this.allowedRoots);
      const info = await stat(actual);
      if (!info.isFile()) throw new Error("模型图片输入不是文件");
      if (info.size > this.maxImageBytes) throw new Error(`模型图片超过 ${Math.round(this.maxImageBytes / 1024 / 1024)}MB 限制`);
      const bytes = await readFile(actual);
      return {
        type: "input_image",
        image_url: `data:${mimeFor(actual)};base64,${bytes.toString("base64")}`,
        detail: ["low", "high", "original", "auto"].includes(detail) ? detail : "high",
      };
    }));
  }

  async generate({
    prompt,
    instructions,
    model = "gpt-5.6-sol",
    schema,
    schemaName,
    imagePaths = [],
    imageDetail = "high",
    webSearch = false,
    reasoningEffort = "high",
    serviceTier = "default",
    maxOutputTokens,
    metadata,
    safetyIdentifier,
    promptCacheKey,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    if (!this.configured) throw new Error("服务器尚未配置 OPENAI_API_KEY");
    if (typeof this.fetchImpl !== "function") throw new Error("当前运行时不支持 fetch");
    if (typeof prompt !== "string" || !prompt.trim()) throw new Error("模型提示词为空");
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("结构化输出 Schema 无效");

    const images = await this.imageContent(imagePaths, imageDetail);
    const body = {
      model,
      instructions: String(instructions || "").trim() || undefined,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt.trim() }, ...images] }],
      reasoning: { effort: reasoningEffort },
      text: {
        format: {
          type: "json_schema",
          name: safeSchemaName(schemaName),
          strict: true,
          schema,
        },
      },
      store: false,
      service_tier: serviceTier,
      safety_identifier: stableSafetyIdentifier(safetyIdentifier),
      metadata: sanitizedMetadata(metadata),
      ...(promptCacheKey ? { prompt_cache_key: String(promptCacheKey).slice(0, 128) } : {}),
      ...(Number.isFinite(maxOutputTokens) ? { max_output_tokens: Math.max(1, Math.floor(maxOutputTokens)) } : {}),
      ...(webSearch ? { tools: [{ type: "web_search" }] } : {}),
    };
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      ...(this.organization ? { "OpenAI-Organization": this.organization } : {}),
      ...(this.project ? { "OpenAI-Project": this.project } : {}),
    };
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal(signal, Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new Error("OpenAI Responses API 请求超时或已取消");
      throw new Error(`OpenAI Responses API 连接失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = String(payload?.error?.message || `HTTP ${response.status}`).slice(0, 500);
      const error = new Error(`OpenAI Responses API 失败：${message}`);
      error.statusCode = response.status;
      throw error;
    }
    if (payload.status === "failed" || payload.status === "cancelled" || payload.status === "incomplete") {
      throw new Error(`OpenAI Responses API 未完成：${payload?.error?.message || payload?.incomplete_details?.reason || payload.status}`);
    }
    const text = responseOutputText(payload);
    if (!text) throw new Error("OpenAI Responses API 没有返回结构化文本");
    return {
      text,
      responseId: payload.id,
      model: payload.model || model,
      serviceTier: payload.service_tier,
      usage: payload.usage || null,
    };
  }
}

export function createOpenAIResponsesProvider(options) {
  return new OpenAIResponsesProvider(options);
}

export const openAIResponsesInternals = {
  responseOutputText,
  safeSchemaName,
  stableSafetyIdentifier,
};
