const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

function baseUrlFor(value) {
  const baseUrl = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("OpenAI API Base URL 必须使用 HTTPS");
  }
  return baseUrl;
}

function sizeForRatio(ratio) {
  if (ratio === "9:16" || ratio === "3:4") return "1024x1536";
  if (ratio === "1:1") return "1024x1024";
  return "1536x1024";
}

function decodedImage(value) {
  if (typeof value !== "string" || !value) throw new Error("OpenAI Image API 没有返回图片数据");
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("OpenAI Image API 返回的图片大小无效");
  return bytes;
}

export class OpenAIImageProvider {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    baseUrl = process.env.OPENAI_BASE_URL,
    organization = process.env.OPENAI_ORG_ID,
    project = process.env.OPENAI_PROJECT_ID,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.apiKey = String(apiKey || "").trim();
    this.baseUrl = baseUrlFor(baseUrl);
    this.organization = String(organization || "").trim();
    this.project = String(project || "").trim();
    this.fetchImpl = fetchImpl;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async generate({
    prompt,
    ratio = "16:9",
    count = 2,
    model = process.env.MANJING_OPENAI_IMAGE_MODEL || "gpt-image-2",
    quality = process.env.MANJING_OPENAI_IMAGE_QUALITY || "medium",
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    if (!this.configured) throw new Error("服务器尚未配置 OPENAI_API_KEY");
    if (typeof prompt !== "string" || prompt.trim().length < 8) throw new Error("GPT 图片提示词内容不足");
    const imageCount = Math.max(1, Math.min(4, Number(count) || 1));
    const response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(this.organization ? { "OpenAI-Organization": this.organization } : {}),
        ...(this.project ? { "OpenAI-Project": this.project } : {}),
      },
      body: JSON.stringify({
        model,
        prompt: prompt.trim(),
        n: imageCount,
        size: sizeForRatio(ratio),
        quality: ["low", "medium", "high"].includes(quality) ? quality : "medium",
      }),
      signal: AbortSignal.timeout(Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)),
    }).catch((error) => {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new Error("OpenAI Image API 请求超时");
      throw new Error(`OpenAI Image API 连接失败：${error instanceof Error ? error.message : "未知错误"}`);
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`OpenAI Image API 失败：${String(payload?.error?.message || `HTTP ${response.status}`).slice(0, 500)}`);
    const images = (Array.isArray(payload.data) ? payload.data : []).map((item) => decodedImage(item?.b64_json));
    if (images.length !== imageCount) throw new Error(`OpenAI Image API 应返回 ${imageCount} 张图片，实际为 ${images.length} 张`);
    return { images, model, size: sizeForRatio(ratio), quality, usage: payload.usage || null };
  }
}

export const openAIImageInternals = { sizeForRatio };

