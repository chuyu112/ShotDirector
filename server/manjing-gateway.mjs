import { request as httpRequest } from "node:http";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AuthStoreError,
  ManjingAuthStore,
  createAuthApiAdapter,
} from "./auth-store.mjs";
import { TenantWorkerPool } from "./tenant-worker-pool.mjs";
import { modelTestIds } from './model-tests.mjs';
import {
  assertAnnotationBatchShotLimit,
  dynamicAiModelCallBudget,
} from "./request-limits.mjs";

const JSON_LIMIT = 1024 * 1024;
const PROJECT_COOKIE = "manjing_project";
const execFileAsync = promisify(execFile);
const AI_MODEL_CALL_BUDGET_BY_ROUTE = new Map([
  ["/annotations", 2],
  ["/annotations-batch", 10],
  ["/complete-shot-prompt", 2],
  ["/shot-chat", 2],
  ["/review-shot-prompt", 2],
  ["/global-annotations", 2],
  ["/load-script", 2],
]);
const BUFFERED_AI_ROUTES = new Set(["/media-analyze", "/manga-recut-boxes", "/annotations-batch", "/model-tests"]);
const OPENAI_IMAGE_ROUTES = new Set(["/generate-asset-gpt"]);
const LIBTV_PAID_ROUTES = new Set(["/generate", "/generate-asset"]);
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);

function booleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return /^(?:1|true|yes|on)$/i.test(value);
}

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function readJson(req, limit = JSON_LIMIT) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        const error = new Error("请求内容过长");
        error.statusCode = 413;
        rejectBody(error);
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolveBody(body ? JSON.parse(body) : {}); }
      catch {
        const error = new Error("请求 JSON 格式无效");
        error.statusCode = 400;
        rejectBody(error);
      }
    });
    req.on("error", rejectBody);
  });
}

function normalizedPath(pathname) {
  if (pathname === "/api") return "/";
  return pathname.startsWith("/api/") ? pathname.slice(4) : pathname;
}

function cookieValue(header, name) {
  if (typeof header !== "string") return "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { return ""; }
  }
  return "";
}

function projectCookie(projectId, { secure, clear = false } = {}) {
  const attributes = [
    `${PROJECT_COOKIE}=${clear ? "deleted" : encodeURIComponent(projectId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${clear ? 0 : 31_536_000}`,
  ];
  if (secure) attributes.push("Secure");
  if (clear) attributes.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  return attributes.join("; ");
}

function mutation(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
}

function requestOriginAllowed(req, allowedOrigins, allowOriginless) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return allowOriginless;
  if (allowedOrigins.has(origin)) return true;
  try {
    return new URL(origin).host === String(req.headers.host || "");
  } catch {
    return false;
  }
}

function applyCorsHeaders(req, res, allowedOrigins) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin || !allowedOrigins.has(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Manjing-Project, X-Manjing-Token, X-ShotDirector-Token");
  res.setHeader("Vary", "Origin");
}

function requestClientKey(req, trustProxy, trustedProxyHops = 1) {
  if (trustProxy) {
    const forwardedValues = String(req.headers["x-forwarded-for"] || "").split(",").map((item) => item.trim()).filter(Boolean);
    const hops = Math.max(1, Number(trustedProxyHops) || 1);
    const forwarded = forwardedValues.at(-hops);
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || "unknown";
}

class SlidingRateLimiter {
  constructor({ limit, windowMs, maxEntries = 10_000 }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.lastCleanupAt = 0;
  }

  cleanup(now = Date.now(), { force = false } = {}) {
    if (!force && now - this.lastCleanupAt < this.windowMs && this.entries.size < this.maxEntries) return;
    const cutoff = now - this.windowMs;
    for (const [candidate, timestamps] of this.entries) {
      const valid = timestamps.filter((timestamp) => timestamp > cutoff);
      if (valid.length) this.entries.set(candidate, valid);
      else this.entries.delete(candidate);
    }
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    this.lastCleanupAt = now;
  }

  consume(key, now = Date.now()) {
    this.cleanup(now);
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    const cutoff = now - this.windowMs;
    const recent = (this.entries.get(key) || []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.limit) return false;
    recent.push(now);
    this.entries.set(key, recent);
    return true;
  }
}

function normalizedTimeZone(value) {
  const timeZone = String(value || "Asia/Shanghai").trim();
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(0);
    return timeZone;
  } catch {
    return "Asia/Shanghai";
  }
}

function dailyWindowKey(now = Date.now(), timeZone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function credentialRateKey(credentials) {
  const email = String(credentials?.email || "").normalize("NFKC").trim().toLowerCase();
  return createHash("sha256").update(email || "missing-email").digest("hex");
}

function usageRules(path, limits, req, payload = null) {
  const dynamicBudget = path === '/model-tests' ? modelTestIds(payload).length : dynamicAiModelCallBudget(path, payload);
  const aiModelCallBudget = dynamicBudget ?? AI_MODEL_CALL_BUDGET_BY_ROUTE.get(path);
  if (aiModelCallBudget !== undefined) return [{
    counterType: "ai-model-call-budget",
    limit: limits.ai,
    globalLimit: limits.globalAi,
    amount: aiModelCallBudget,
  }];
  if (OPENAI_IMAGE_ROUTES.has(path)) return [{
    counterType: "openai-image-request",
    limit: limits.image,
    globalLimit: limits.globalImage,
    amount: 1,
  }];
  if (LIBTV_PAID_ROUTES.has(path)) return [{
    counterType: "libtv-paid-request",
    limit: limits.libtv,
    globalLimit: limits.globalLibtv,
    amount: 1,
  }];
  if (path === "/libtv/login") return [{
    counterType: "libtv-login",
    limit: limits.libtvLogin,
    globalLimit: limits.globalLibtvLogin,
    amount: 1,
  }];
  if (path === "/media-upload") {
    const bytes = Number(req.headers["content-length"] || 0);
    if (!Number.isSafeInteger(bytes) || bytes < 1) {
      const error = new Error("服务器上传必须携带有效 Content-Length");
      error.statusCode = 411;
      throw error;
    }
    return [
      { counterType: "media-upload", limit: limits.upload, globalLimit: limits.globalUpload, amount: 1 },
      { counterType: "media-upload-bytes", limit: limits.uploadBytes, globalLimit: limits.globalUploadBytes, amount: bytes },
    ];
  }
  return [];
}

function normalizeLimit(value, fallback) {
  return Number.isSafeInteger(Number(value)) && Number(value) >= 0
    ? Number(value)
    : fallback;
}

function normalizeDailyLimits(limits) {
  const ai = normalizeLimit(limits?.ai, 10);
  return {
    ai,
    superadminAi: normalizeLimit(limits?.superadminAi, ai),
    globalAi: normalizeLimit(limits?.globalAi, null),
    image: normalizeLimit(limits?.image, 0),
    globalImage: normalizeLimit(limits?.globalImage, null),
    libtv: normalizeLimit(limits?.libtv, 0),
    globalLibtv: normalizeLimit(limits?.globalLibtv, null),
    libtvLogin: normalizeLimit(limits?.libtvLogin, 5),
    globalLibtvLogin: normalizeLimit(limits?.globalLibtvLogin, null),
    upload: normalizeLimit(limits?.upload, 100),
    globalUpload: normalizeLimit(limits?.globalUpload, null),
    uploadBytes: normalizeLimit(limits?.uploadBytes, 1024 * 1024 * 1024),
    globalUploadBytes: normalizeLimit(limits?.globalUploadBytes, null),
  };
}

function dailyLimitsForUser(limits, user) {
  return user?.role === "superadmin"
    ? { ...limits, ai: limits.superadminAi }
    : limits;
}

function createLibtvVersionProbe({
  executable = process.env.LIBTV_BIN || "libtv",
  ttlMs = 60_000,
} = {}) {
  let cached = null;
  let pending = null;
  return async () => {
    if (cached && Date.now() - cached.checkedAtMs < ttlMs) return cached.value;
    if (pending) return pending;
    pending = execFileAsync(executable, ["--version"], {
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
      env: { PATH: process.env.PATH || "", LANG: process.env.LANG || "C" },
    }).then(({ stdout, stderr }) => ({
      configured: true,
      available: true,
      installed: true,
      version: String(stdout || stderr || "").trim().split(/\r?\n/u)[0].slice(0, 200) || "unknown",
    })).catch((error) => ({
      configured: true,
      available: false,
      installed: false,
      version: null,
      error: error?.code === "ENOENT" ? "LibTV CLI 未安装" : "LibTV CLI 版本探针失败",
    })).then((value) => {
      cached = { checkedAtMs: Date.now(), value };
      return value;
    }).finally(() => { pending = null; });
    return pending;
  };
}

function createFfmpegVersionProbe({
  executable = process.env.MANJING_FFMPEG_BIN || process.env.FFMPEG_PATH || "ffmpeg",
  ttlMs = 60_000,
} = {}) {
  let cached = null;
  let pending = null;
  return async () => {
    if (cached && Date.now() - cached.checkedAtMs < ttlMs) return cached.value;
    if (pending) return pending;
    pending = execFileAsync(executable, ["-version"], {
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
      env: { PATH: process.env.PATH || "", LANG: process.env.LANG || "C" },
    }).then(({ stdout, stderr }) => {
      const line = String(stdout || stderr || "").trim().split(/\r?\n/u)[0];
      const version = line.match(/^ffmpeg version\s+(\S+)/iu)?.[1] || line || "unknown";
      return { configured: true, available: true, version: version.slice(0, 120) };
    }).catch(() => ({
      configured: true,
      available: false,
      version: null,
    })).then((value) => {
      cached = { checkedAtMs: Date.now(), value };
      return value;
    }).finally(() => { pending = null; });
    return pending;
  };
}

function activeProjectFor(store, userId, req) {
  const requested = String(req.headers["x-manjing-project"] || cookieValue(req.headers.cookie, PROJECT_COOKIE) || "").trim();
  if (requested) {
    const project = store.getProjectById(requested, { userId });
    if (project) return project;
    const error = new Error("项目不属于当前用户");
    error.statusCode = 403;
    throw error;
  }
  return store.getDefaultProject(userId);
}

function proxyHeaders(req, worker, bufferedBody = null) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "host" || lower === "cookie" || lower === "origin" || lower === "x-manjing-token" || lower === "x-shotdirector-token") continue;
    if (value !== undefined) headers[name] = value;
  }
  headers.host = `127.0.0.1:${worker.port}`;
  headers.origin = "http://localhost:3000";
  headers["x-manjing-token"] = worker.token;
  if (bufferedBody !== null) headers["content-length"] = String(bufferedBody.length);
  return headers;
}

function proxyToWorker(req, res, worker, targetUrl, bufferedBody = null) {
  return new Promise((resolveProxy, rejectProxy) => {
    if (["/media-panel/", "/media-source/", "/media-preview/"].some((prefix) => targetUrl.pathname.startsWith(prefix))) {
      targetUrl.searchParams.set("token", worker.token);
    }
    const upstream = httpRequest({
      hostname: "127.0.0.1",
      port: worker.port,
      method: req.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: proxyHeaders(req, worker, bufferedBody),
    }, (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers, ...securityHeaders() };
      for (const name of HOP_BY_HOP) delete headers[name];
      delete headers["access-control-allow-origin"];
      delete headers["access-control-allow-methods"];
      delete headers["access-control-allow-headers"];
      delete headers["access-control-allow-private-network"];
      res.writeHead(upstreamResponse.statusCode || 502, headers);
      upstreamResponse.pipe(res);
      upstreamResponse.once("end", resolveProxy);
      upstreamResponse.once("error", rejectProxy);
    });
    upstream.once("error", rejectProxy);
    req.once("aborted", () => upstream.destroy());
    if (bufferedBody !== null) upstream.end(bufferedBody);
    else req.pipe(upstream);
  });
}

function publicAuthPayload(store, user, req) {
  const projects = store.listProjects(user.id);
  const activeProject = activeProjectFor(store, user.id, req);
  return { authenticated: true, serverMode: true, user, projects, activeProject };
}

export function createManjingGateway({
  store = new ManjingAuthStore({
    filename: process.env.MANJING_AUTH_DB_PATH || resolve(process.env.MANJING_DATA_ROOT || join(process.cwd(), "work", "manjing-server"), "auth.sqlite"),
    dataRoot: resolve(process.env.MANJING_DATA_ROOT || join(process.cwd(), "work", "manjing-server")),
  }),
  workerPool = new TenantWorkerPool(),
  registrationEnabled = booleanEnv("MANJING_REGISTRATION_ENABLED", true),
  cookieSecure = booleanEnv("MANJING_COOKIE_SECURE", true),
  allowedOrigins = new Set(String(process.env.MANJING_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean)),
  allowOriginlessMutations = booleanEnv("MANJING_ALLOW_ORIGINLESS_MUTATIONS", false),
  trustProxy = booleanEnv("MANJING_TRUST_PROXY", false),
  trustedProxyHops = positiveIntegerEnv("MANJING_TRUST_PROXY_HOPS", 1),
  maxProjectsPerUser = positiveIntegerEnv("MANJING_MAX_PROJECTS_PER_USER", 10),
  dailyLimits = {
    ai: nonNegativeIntegerEnv("MANJING_DAILY_AI_REQUESTS", 10),
    superadminAi: nonNegativeIntegerEnv("MANJING_DAILY_SUPERADMIN_AI_REQUESTS", 10),
    globalAi: nonNegativeIntegerEnv("MANJING_DAILY_GLOBAL_AI_REQUESTS", 200),
    image: nonNegativeIntegerEnv("MANJING_DAILY_IMAGE_REQUESTS", 0),
    globalImage: nonNegativeIntegerEnv("MANJING_DAILY_GLOBAL_IMAGE_REQUESTS", 20),
    libtv: nonNegativeIntegerEnv("MANJING_DAILY_LIBTV_REQUESTS", 0),
    globalLibtv: nonNegativeIntegerEnv("MANJING_DAILY_GLOBAL_LIBTV_REQUESTS", 0),
    libtvLogin: nonNegativeIntegerEnv("MANJING_DAILY_LIBTV_LOGIN_ATTEMPTS", 5),
    globalLibtvLogin: nonNegativeIntegerEnv("MANJING_DAILY_GLOBAL_LIBTV_LOGIN_ATTEMPTS", 100),
    upload: nonNegativeIntegerEnv("MANJING_DAILY_UPLOADS", 100),
    globalUpload: nonNegativeIntegerEnv("MANJING_DAILY_GLOBAL_UPLOADS", 2_000),
    uploadBytes: nonNegativeIntegerEnv("MANJING_DAILY_UPLOAD_BYTES", 1024 * 1024 * 1024),
    globalUploadBytes: nonNegativeIntegerEnv("MANJING_DAILY_GLOBAL_UPLOAD_BYTES", 20 * 1024 * 1024 * 1024),
  },
  quotaTimeZone = normalizedTimeZone(process.env.MANJING_QUOTA_TIME_ZONE),
  libtvVersionProbe = createLibtvVersionProbe(),
  ffmpegVersionProbe = createFfmpegVersionProbe(),
} = {}) {
  const effectiveDailyLimits = normalizeDailyLimits(dailyLimits);
  const auth = createAuthApiAdapter(store, { cookie: { secure: cookieSecure, sameSite: "Lax", path: "/" } });
  const authLimiter = new SlidingRateLimiter({ limit: 12, windowMs: 15 * 60 * 1000 });
  const accountLimiter = new SlidingRateLimiter({ limit: 12, windowMs: 15 * 60 * 1000 });
  const registerLimiter = new SlidingRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
  store.cleanupExpiredSessions();
  const maintenanceTimer = setInterval(() => {
    try {
      store.cleanupExpiredSessions();
      store.cleanupUsageCounters({ beforeWindowKey: dailyWindowKey(Date.now() - 8 * 24 * 60 * 60 * 1000, quotaTimeZone) });
      authLimiter.cleanup(Date.now(), { force: true });
      accountLimiter.cleanup(Date.now(), { force: true });
      registerLimiter.cleanup(Date.now(), { force: true });
    } catch {
      // Health checks expose database failures; maintenance must not crash active requests.
    }
  }, 60 * 60 * 1000);
  maintenanceTimer.unref();

  const server = createServer(async (req, res) => {
    const incomingUrl = new URL(req.url || "/", "http://gateway.local");
    incomingUrl.pathname = normalizedPath(incomingUrl.pathname);
    const path = incomingUrl.pathname;
    try {
      applyCorsHeaders(req, res, allowedOrigins);
      if (req.method === "GET" && path === "/healthz") {
        const [libtv, ffmpeg] = await Promise.all([
          libtvVersionProbe(),
          ffmpegVersionProbe(),
        ]);
        sendJson(res, 200, {
          ok: true,
          service: "manjing-gateway",
          database: store.inspectHealth(),
          workers: workerPool.status(),
          writingProvider: {
            requested: String(process.env.MANJING_AI_PROVIDER || "glm"),
            glmConfigured: Boolean(process.env.MANJING_GLM_API_KEY || process.env.GLM_API_KEY),
            kimiConfigured: Boolean(process.env.MANJING_KIMI_API_KEY || process.env.KIMI_API_KEY),
            openaiTextConfigured: Boolean((process.env.MANJING_OPENAI_API_KEY || process.env.OPENAI_API_KEY) && (process.env.MANJING_OPENAI_SOL_MODEL || process.env.OPENAI_SOL_MODEL || process.env.MANJING_OPENAI_MODEL || process.env.OPENAI_MODEL)),
            seedConfigured: Boolean((process.env.MANJING_DOUBAO_API_KEY || process.env.DOUBAO_API_KEY) && (process.env.MANJING_DOUBAO_MODEL || process.env.DOUBAO_MODEL)),
            deepseekConfigured: Boolean((process.env.MANJING_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY) && (process.env.MANJING_DEEPSEEK_PRO_MODEL || process.env.DEEPSEEK_PRO_MODEL || process.env.MANJING_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL)),
            jiekouConfigured: Boolean(process.env.MANJING_JIEKOU_API_KEY || process.env.JIEKOU_API_KEY),
          },
          openaiImageConfigured: Boolean(process.env.OPENAI_API_KEY),
          libtv,
          ffmpeg,
        });
        return;
      }

      if (req.method === "OPTIONS") {
        if (!requestOriginAllowed(req, allowedOrigins, allowOriginlessMutations)) {
          sendJson(res, 403, { error: "Origin not allowed" });
          return;
        }
        res.writeHead(204, securityHeaders());
        res.end();
        return;
      }

      if (mutation(req.method) && !requestOriginAllowed(req, allowedOrigins, allowOriginlessMutations)) {
        sendJson(res, 403, { error: "请求来源未获授权" });
        return;
      }

      if (req.method === "GET" && path === "/auth/me") {
        const session = auth.authenticate(req);
        sendJson(res, 200, session ? publicAuthPayload(store, session.user, req) : { authenticated: false, serverMode: true });
        return;
      }

      if (req.method === "POST" && (path === "/auth/register" || path === "/auth/login")) {
        const clientKey = requestClientKey(req, trustProxy, trustedProxyHops);
        if (!authLimiter.consume(`${path}:${clientKey}`) || (path === "/auth/register" && !registerLimiter.consume(clientKey))) {
          sendJson(res, 429, { error: "尝试次数过多，请稍后再试" }, { "Retry-After": "900" });
          return;
        }
        if (path === "/auth/register" && !registrationEnabled) {
          sendJson(res, 403, { error: "当前服务器暂未开放注册" });
          return;
        }
        const credentials = await readJson(req);
        if (!accountLimiter.consume(`${path}:${credentialRateKey(credentials)}`)) {
          sendJson(res, 429, { error: "该账户尝试次数过多，请稍后再试" }, { "Retry-After": "900" });
          return;
        }
        const result = path === "/auth/register" ? await auth.register(credentials) : await auth.login(credentials);
        const defaultProject = result.defaultProject || store.getDefaultProject(result.user.id);
        sendJson(res, path === "/auth/register" ? 201 : 200, {
          authenticated: true,
          serverMode: true,
          user: result.user,
          activeProject: defaultProject,
        }, { "Set-Cookie": [result.setCookie, projectCookie(defaultProject.id, { secure: cookieSecure })] });
        return;
      }

      if (req.method === "POST" && path === "/auth/logout") {
        const result = auth.logout(req);
        sendJson(res, 200, { authenticated: false, serverMode: true }, {
          "Set-Cookie": [result.setCookie, projectCookie("", { secure: cookieSecure, clear: true })],
        });
        return;
      }

      const session = auth.authenticate(req);
      if (!session) {
        sendJson(res, 401, { error: "请先登录漫镜", authenticated: false, serverMode: true });
        return;
      }

      if (req.method === "GET" && path === "/projects") {
        sendJson(res, 200, publicAuthPayload(store, session.user, req));
        return;
      }
      if (req.method === "POST" && path === "/projects") {
        const payload = await readJson(req);
        const project = store.createProject({
          userId: session.user.id,
          name: payload.name,
          maxProjects: maxProjectsPerUser,
        });
        sendJson(res, 201, { project });
        return;
      }
      if (req.method === "POST" && path === "/projects/select") {
        const payload = await readJson(req);
        const project = store.getProjectById(String(payload.projectId || ""), { userId: session.user.id });
        if (!project) {
          sendJson(res, 404, { error: "项目不存在" });
          return;
        }
        sendJson(res, 200, { activeProject: project }, { "Set-Cookie": projectCookie(project.id, { secure: cookieSecure }) });
        return;
      }
      if (req.method === "POST" && path === "/projects/rename") {
        const payload = await readJson(req);
        const project = store.renameProject({
          userId: session.user.id,
          projectId: payload.projectId,
          name: payload.name,
        });
        sendJson(res, 200, { project });
        return;
      }
      if (req.method === "GET" && path === "/global-files") {
        sendJson(res, 200, { files: store.listGlobalFiles(session.user.id) });
        return;
      }
      if (req.method === "GET" && path === "/global-files/load") {
        const file = store.getGlobalFile(incomingUrl.searchParams.get("id") || "", { userId: session.user.id });
        if (!file) {
          sendJson(res, 404, { error: "全局文件不存在" });
          return;
        }
        sendJson(res, 200, { file });
        return;
      }
      if (req.method === "POST" && path === "/global-files/save") {
        const payload = await readJson(req);
        const file = store.saveGlobalFile({
          userId: session.user.id,
          globalFileId: payload.globalFileId,
          name: payload.name,
          payload: payload.payload,
        });
        sendJson(res, payload.globalFileId ? 200 : 201, { file });
        return;
      }

      const project = activeProjectFor(store, session.user.id, req);
      if (!project) {
        sendJson(res, 409, { error: "当前账户没有可用项目" });
        return;
      }
      let bufferedBody = null;
      let inspectedPayload = null;
      if (req.method === "POST" && BUFFERED_AI_ROUTES.has(path)) {
        inspectedPayload = await readJson(req);
        if (path === "/annotations-batch") assertAnnotationBatchShotLimit(inspectedPayload);
        bufferedBody = Buffer.from(JSON.stringify(inspectedPayload), "utf8");
      }
      const accountDailyLimits = dailyLimitsForUser(effectiveDailyLimits, session.user);
      const rules = mutation(req.method) ? usageRules(path, accountDailyLimits, req, inspectedPayload) : [];
      for (const rule of rules) {
        if (rule.limit === 0 || rule.globalLimit === 0) {
          sendJson(res, 402, {
            error: `服务器尚未为当前账户开通 ${rule.counterType}`,
            code: "USAGE_NOT_ENABLED",
            quota: {
              allowed: false,
              scope: rule.limit === 0 ? "user" : "global",
              used: 0,
              remaining: 0,
              limit: 0,
            },
          });
          return;
        }
      }
      if (rules.length) {
        const usageBatch = store.consumeUsageBatch({
          userId: session.user.id,
          windowKey: dailyWindowKey(Date.now(), quotaTimeZone),
          entries: rules.map((rule) => ({
            counterType: rule.counterType,
            limit: rule.limit,
            globalLimit: rule.globalLimit,
            amount: rule.amount,
          })),
        });
        if (!usageBatch.allowed) {
          const usage = usageBatch.quota;
          const requested = rules.find((rule) => rule.counterType === usageBatch.counterType)?.amount || 0;
          sendJson(res, 429, {
            error: usage.scope === "global"
              ? `服务器今日的 ${usageBatch.counterType} 总额度不足：本次需要 ${requested}，今日剩余 ${usage.remaining}`
              : `当前账户今日的 ${usageBatch.counterType} 额度不足：本次需要 ${requested}，今日剩余 ${usage.remaining}`,
            code: "USAGE_QUOTA_EXCEEDED",
            quota: { ...usage, requested },
          }, { "Retry-After": "86400" });
          return;
        }
      }
      const workerKey = `${session.user.id}:${project.id}`;
      store.claimResource({
        userId: session.user.id,
        projectId: project.id,
        resourceType: "tenant-worker",
        resourceId: workerKey,
      });
      const worker = await workerPool.get({
        userId: session.user.id,
        projectId: project.id,
        userRole: session.user.role,
      });
      await proxyToWorker(req, res, worker, incomingUrl, bufferedBody);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = Number(error?.statusCode || error?.status || (error instanceof AuthStoreError ? error.status : 500));
      sendJson(res, status >= 400 && status <= 599 ? status : 500, {
        error: status >= 500 ? "服务器处理请求失败" : error instanceof Error ? error.message : "请求失败",
        ...(error instanceof AuthStoreError ? { code: error.code } : {}),
        ...(["ANNOTATION_BATCH_LIMIT_EXCEEDED", "MEDIA_BATCH_LIMIT_EXCEEDED", "AI_BUDGET_INPUT_INVALID"].includes(error?.code) ? {
          code: error.code,
          ...(error.limit === undefined ? {} : { limit: error.limit }),
          ...(error.received === undefined ? {} : { received: error.received }),
        } : {}),
      });
    }
  });

  const close = async () => {
    clearInterval(maintenanceTimer);
    await workerPool.stopAll();
    store.close();
  };
  return { server, store, workerPool, close };
}

async function startFromCli() {
  const host = String(process.env.MANJING_GATEWAY_HOST || "0.0.0.0");
  const port = Number(process.env.MANJING_GATEWAY_PORT || 8080);
  const gateway = createManjingGateway();
  gateway.server.listen(port, host, () => process.stdout.write(`漫镜服务器网关：http://${host}:${port}\n`));
  let shutdownPromise;
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    const serverClosed = new Promise((resolveClose) => gateway.server.close(resolveClose));
    gateway.server.closeIdleConnections?.();
    shutdownPromise = (async () => {
      try {
        await gateway.close();
        gateway.server.closeAllConnections?.();
        await serverClosed;
        process.exit(0);
      } catch (error) {
        gateway.server.closeAllConnections?.();
        process.stderr.write(`漫镜网关关机失败：${error instanceof Error ? error.message : "未知错误"}\n`);
        process.exit(1);
      }
    })();
    return shutdownPromise;
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startFromCli();
}
