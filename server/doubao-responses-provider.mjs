const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_TOKENS = 32_768;
const MAX_OUTPUT_TOKENS = 65_536;
const ARK_DOMAIN = "ark.cn-beijing.volces.com";

function localTestHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function normalizedResponsesUrl(value) {
  const configured = String(value || "").trim();
  if (!configured) return "";
  const url = new URL(configured);
  if (url.username || url.password) throw new Error("Seed 2.1 Pro API 地址不能包含账号或密码");
  const local = localTestHost(url.hostname);
  if (!local && url.protocol !== "https:") throw new Error("Seed 2.1 Pro API 必须使用 HTTPS");
  if (local && url.protocol !== "http:" && url.protocol !== "https:") throw new Error("本地测试 API 只支持 HTTP 或 HTTPS");
  if (!local && url.hostname !== ARK_DOMAIN) {
    throw new Error(`Seed 2.1 Pro API 必须使用 ${ARK_DOMAIN}`);
  }
  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/responses") ? path : `${path}/responses`;
  return url.toString();
}

function safeSchemaName(value) {
  return String(value || "manjing_structured_result")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "manjing_structured_result";
}

function responseOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === "output_text" || item?.type === "text")
    .map((item) => typeof item?.text === "string" ? item.text : "")
    .join("")
    .trim();
}

function normalizedMaxOutputTokens(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.max(1, Math.min(MAX_OUTPUT_TOKENS, Math.floor(requested)));
}

function combinedSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export class DoubaoResponsesProvider {
  constructor({
    apiKey,
    baseUrl,
    model,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.id = "doubao";
    this.label = "Seed 2.1 Pro";
    this.apiKey = String(apiKey || "").trim();
    this.baseUrl = normalizedResponsesUrl(baseUrl);
    this.model = String(model || "").trim();
    this.fetchImpl = fetchImpl;
    this.supportsImages = false;
  }

  get configured() {
    return Boolean(this.apiKey && this.baseUrl && this.model);
  }

  async generate({
    prompt,
    instructions,
    schema,
    schemaName,
    reasoningEffort = "medium",
    maxOutputTokens,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = {}) {
    if (!this.configured) throw new Error("Seed 2.1 Pro 的 DOUBAO_API_URL、DOUBAO_API_KEY 或 DOUBAO_MODEL 尚未配置");
    if (typeof this.fetchImpl !== "function") throw new Error("当前运行时不支持 fetch");
    if (typeof prompt !== "string" || !prompt.trim()) throw new Error("模型提示词为空");
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("结构化输出 Schema 无效");

    const schemaContract = `\n\n<required_json_schema name="${safeSchemaName(schemaName)}">\n${JSON.stringify(schema)}\n</required_json_schema>\n只输出一个符合上述 Schema 的严格 JSON 对象，不要 Markdown 代码块或额外文字。`;
    const body = {
      model: this.model,
      instructions: String(instructions || "").trim() || undefined,
      input: `${prompt.trim()}${schemaContract}`,
      store: false,
      thinking: { type: String(reasoningEffort || "").toLowerCase() === "none" ? "disabled" : "enabled" },
      max_output_tokens: normalizedMaxOutputTokens(maxOutputTokens),
    };

    let response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: combinedSignal(signal, Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new Error("Seed 2.1 Pro API 请求超时或已取消");
      }
      throw new Error(`Seed 2.1 Pro API 连接失败：${error instanceof Error ? error.message : "未知错误"}`);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = String(payload?.error?.message || `HTTP ${response.status}`).slice(0, 500);
      const error = new Error(`Seed 2.1 Pro API 失败：${message}`);
      error.statusCode = response.status;
      throw error;
    }
    if (["failed", "cancelled", "incomplete"].includes(payload?.status)) {
      throw new Error(`Seed 2.1 Pro API 未完成：${payload?.error?.message || payload?.incomplete_details?.reason || payload.status}`);
    }
    const text = responseOutputText(payload);
    if (!text) throw new Error("Seed 2.1 Pro API 没有返回结构化文本");
    return {
      text,
      responseId: payload.id,
      reportedModel: typeof payload.model === 'string' ? payload.model : null,
      model: String(payload.model || this.model),
      usage: payload.usage || null,
      provider: this.id,
    };
  }
}

export function createDoubaoResponsesProvider(options) {
  return new DoubaoResponsesProvider(options);
}

export const doubaoResponsesInternals = {
  normalizedResponsesUrl,
  responseOutputText,
  safeSchemaName,
};
