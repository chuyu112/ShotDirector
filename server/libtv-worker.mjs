import { spawn as nodeSpawn } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, resolve, sep } from "node:path";

const DEFAULT_STATE_ROOT = resolve(process.cwd(), "work", "libtv-server");
const DEFAULT_STDOUT_LIMIT = 16 * 1024 * 1024;
const DEFAULT_STDERR_LIMIT = 1024 * 1024;
const DEFAULT_SMS_COOLDOWN_MS = 60 * 1000;
const DEFAULT_SMS_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_SMS_MAX_PER_WINDOW = 5;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// HOME and application secrets are intentionally absent. LIBTV_CONFIG_DIR is
// always supplied by the worker and cannot be inherited or overridden.
export const LIBTV_ENV_ALLOWLIST = Object.freeze([
  "PATH",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "LIBTV_API_BASE_URL",
  "LIBTV_LOGIN_WEB_URL",
  "LIBTV_LOGIN_WEB_PATH",
]);

function assertSafeIdentifier(label, value) {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ID.test(normalized)) {
    throw new TypeError(`${label} 只能包含字母、数字、下划线和连字符，长度为 1-64`);
  }
  return normalized;
}

function assertCliPath(value) {
  const cliPath = String(value || "libtv").trim();
  if (!cliPath || cliPath.includes("\0")) throw new TypeError("LibTV CLI 路径无效");
  if (!isAbsolute(cliPath) && !/^[A-Za-z0-9._-]+$/.test(cliPath)) {
    throw new TypeError("LibTV CLI 必须是绝对路径或 PATH 中的安全命令名");
  }
  return cliPath;
}

function assertStateRoot(value) {
  const root = resolve(String(value || DEFAULT_STATE_ROOT));
  if (root === parse(root).root) throw new TypeError("LibTV 状态根目录不能是文件系统根目录");
  return root;
}

function insideRoot(path, root) {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function ensurePrivatePath(root, segments) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const actualRoot = await realpath(root);
  let cursor = actualRoot;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    await mkdir(cursor, { mode: 0o700 }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("LibTV 租户状态路径不安全");
    }
  }
  const actualPath = await realpath(cursor);
  if (!insideRoot(actualPath, actualRoot)) throw new Error("LibTV 租户状态路径越界");
  return { actualRoot, actualPath };
}

function safeArgumentList(args) {
  if (!Array.isArray(args) || args.length === 0 || args.length > 128) {
    throw new TypeError("LibTV 命令参数必须是 1-128 项的数组");
  }
  return args.map((value) => {
    if (typeof value !== "string" || value.length === 0 || value.length > 64 * 1024 || value.includes("\0")) {
      throw new TypeError("LibTV 命令包含非法参数");
    }
    return value;
  });
}

function hasRunFlag(args) {
  return args.includes("--run") || args.includes("-r");
}

function assertHeadless(args) {
  if (args.includes("--open") || (args[0] === "login" && args[1] === "web")) {
    throw new TypeError("服务器 Worker 不允许启动浏览器登录，请使用手机号两步登录");
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactLibtvText(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of [...new Set(secrets.filter(Boolean).map(String))].sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED]");
  }
  return text
    .replace(/\b1\d{10}\b/g, "[REDACTED_PHONE]")
    .replace(/(Bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(captcha\s*[=:：]\s*)\{[^\r\n]*\}/gi, "$1[REDACTED]")
    .replace(/("(?:ticket|randstr|token|usertoken|code)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/((?:authorization|usertoken|token|captcha|code|验证码)\s*[=:：]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(-c\s+)\d{6}\b/g, "$1[REDACTED]");
}

export function parseLibtvStdout(stdout) {
  const text = String(stdout ?? "").trim().replace(/^\uFEFF/, "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const frames = [];
    for (const line of lines) {
      try {
        frames.push(JSON.parse(line));
      } catch {
        throw new LibtvWorkerError("LibTV CLI 没有返回可解析的 JSON", { code: "LIBTV_INVALID_JSON" });
      }
    }
    return frames.length === 1 ? frames[0] : frames;
  }
}

function normalizedPhone(value) {
  const phone = String(value ?? "").trim();
  if (!/^1\d{10}$/.test(phone)) throw new TypeError("手机号必须是 11 位中国大陆手机号");
  return phone;
}

function normalizedCode(value) {
  const code = String(value ?? "").trim();
  if (!/^\d{6}$/.test(code)) throw new TypeError("短信验证码必须是 6 位数字");
  return code;
}

function normalizedCaptcha(value) {
  if (value === undefined || value === null || value === "") return null;
  let payload;
  let serialized;
  try {
    if (typeof value === "string") {
      serialized = value.trim();
      payload = JSON.parse(serialized);
    } else {
      payload = value;
      serialized = JSON.stringify(value);
    }
  } catch {
    throw new TypeError("人机验证 captcha 必须是有效 JSON 对象");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || serialized.length > 16 * 1024) {
    throw new TypeError("人机验证 captcha 必须是有效 JSON 对象");
  }
  return serialized;
}

function extractedTaskId(stderr) {
  return String(stderr || "").match(/\[(?:run|run-group)\][^\n]*\btask(?:Id)?\s*[=:]\s*([A-Za-z0-9._:-]+)/i)?.[1] || null;
}

function conciseFailure(stderr, stdout, secrets) {
  const source = String(stderr || "").trim() || String(stdout || "").trim();
  const lines = redactLibtvText(source, secrets).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-3).join("；").slice(0, 1500);
}

export class LibtvWorkerError extends Error {
  constructor(message, {
    code = "LIBTV_CLI_FAILED",
    statusCode = null,
    retryAfterSeconds = null,
    exitCode = null,
    signal = null,
    taskId = null,
    retrySafe = true,
    details = "",
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "LibtvWorkerError";
    this.code = code;
    this.statusCode = Number.isInteger(statusCode) ? statusCode : null;
    this.retryAfterSeconds = Number.isInteger(retryAfterSeconds) ? retryAfterSeconds : null;
    this.exitCode = exitCode;
    this.signal = signal;
    this.taskId = taskId;
    this.retrySafe = retrySafe;
    this.details = details;
  }
}

function filteredEnvironment(baseEnv, overrides, configDir, allowedKeys) {
  const env = {};
  for (const key of allowedKeys) {
    const value = baseEnv?.[key];
    if (typeof value === "string" && value) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides || {})) {
    if (key === "LIBTV_CONFIG_DIR" || !allowedKeys.has(key)) {
      throw new TypeError(`LibTV Worker 不允许传入环境变量 ${key}`);
    }
    if (value !== undefined && value !== null && value !== "") env[key] = String(value);
  }
  env.LIBTV_CONFIG_DIR = configDir;
  return env;
}

function emitProgress(onProgress, line, secrets) {
  const safeLine = redactLibtvText(line, secrets).trim();
  if (!safeLine || typeof onProgress !== "function") return;
  try {
    onProgress({ type: "libtv.progress", line: safeLine.slice(0, 2000), at: new Date().toISOString() });
  } catch {
    // Progress consumers must never be able to interrupt a paid CLI process.
  }
}

export class LibtvServerWorker {
  constructor({
    cliPath = process.env.LIBTV_BIN || "libtv",
    stateRoot = process.env.LIBTV_SERVER_STATE_DIR || DEFAULT_STATE_ROOT,
    spawnImpl = nodeSpawn,
    baseEnv = process.env,
    envOverrides = {},
    envAllowlist = LIBTV_ENV_ALLOWLIST,
    stdoutLimit = DEFAULT_STDOUT_LIMIT,
    stderrLimit = DEFAULT_STDERR_LIMIT,
    smsCooldownMs = process.env.MANJING_LIBTV_SMS_COOLDOWN_MS,
    smsWindowMs = process.env.MANJING_LIBTV_SMS_WINDOW_MS,
    smsMaxPerWindow = process.env.MANJING_LIBTV_SMS_MAX_PER_WINDOW,
    now = Date.now,
  } = {}) {
    if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl 必须是函数");
    if (typeof now !== "function") throw new TypeError("now 必须是函数");
    this.cliPath = assertCliPath(cliPath);
    this.stateRoot = assertStateRoot(stateRoot);
    this.spawnImpl = spawnImpl;
    this.baseEnv = baseEnv || {};
    this.envOverrides = envOverrides || {};
    this.envAllowlist = new Set(envAllowlist);
    this.stdoutLimit = Math.max(1024, Number(stdoutLimit) || DEFAULT_STDOUT_LIMIT);
    this.stderrLimit = Math.max(1024, Number(stderrLimit) || DEFAULT_STDERR_LIMIT);
    this.smsCooldownMs = Math.max(0, Number.isFinite(Number(smsCooldownMs)) && smsCooldownMs !== "" && smsCooldownMs !== undefined
      ? Number(smsCooldownMs)
      : DEFAULT_SMS_COOLDOWN_MS);
    this.smsWindowMs = Math.max(1_000, Number.isFinite(Number(smsWindowMs)) && smsWindowMs !== "" && smsWindowMs !== undefined
      ? Number(smsWindowMs)
      : DEFAULT_SMS_WINDOW_MS);
    this.smsMaxPerWindow = Math.max(1, Math.floor(Number.isFinite(Number(smsMaxPerWindow)) && smsMaxPerWindow !== "" && smsMaxPerWindow !== undefined
      ? Number(smsMaxPerWindow)
      : DEFAULT_SMS_MAX_PER_WINDOW));
    this.now = now;
    this.queues = new Map();
    this.smsRequests = new Map();
  }

  async #context({ tenantId, accountId, projectId }) {
    const tenant = assertSafeIdentifier("tenantId", tenantId);
    const account = assertSafeIdentifier("accountId", accountId);
    const project = assertSafeIdentifier("projectId", projectId);
    const config = await ensurePrivatePath(this.stateRoot, ["tenants", tenant, "accounts", account, "config"]);
    const working = await ensurePrivatePath(this.stateRoot, ["tenants", tenant, "accounts", account, "projects", project]);
    return {
      tenant,
      account,
      project,
      configDir: config.actualPath,
      cwd: working.actualPath,
      queueKey: `${tenant}\0${project}`,
    };
  }

  #enqueue(key, operation) {
    const previous = this.queues.get(key) || Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.queues.set(key, tail);
    tail.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return result;
  }

  #smsRateLimitError(retryAfterMs, message) {
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return new LibtvWorkerError(`${message}，请在 ${retryAfterSeconds} 秒后重试`, {
      code: "LIBTV_SMS_RATE_LIMITED",
      statusCode: 429,
      retryAfterSeconds,
      retrySafe: true,
    });
  }

  #assertSmsRequestAllowed(key) {
    const now = Number(this.now());
    if (!Number.isFinite(now)) throw new TypeError("now 必须返回有效时间戳");
    const previous = this.smsRequests.get(key);
    if (!previous) return;
    if (now - previous.windowStartedAt >= this.smsWindowMs) {
      this.smsRequests.delete(key);
      return;
    }
    const cooldownRemaining = previous.lastSentAt + this.smsCooldownMs - now;
    if (cooldownRemaining > 0) {
      throw this.#smsRateLimitError(cooldownRemaining, "短信发送过于频繁");
    }
    if (previous.count >= this.smsMaxPerWindow) {
      throw this.#smsRateLimitError(previous.windowStartedAt + this.smsWindowMs - now, "本用户项目的 LibTV 短信登录请求已达上限");
    }
  }

  #recordSmsSent(key) {
    const now = Number(this.now());
    if (!Number.isFinite(now)) throw new TypeError("now 必须返回有效时间戳");
    const previous = this.smsRequests.get(key);
    const entry = !previous || now - previous.windowStartedAt >= this.smsWindowMs
      ? { windowStartedAt: now, count: 0, lastSentAt: now }
      : previous;
    entry.count += 1;
    entry.lastSentAt = now;
    this.smsRequests.set(key, entry);
    if (this.smsRequests.size > 1024) {
      for (const [candidateKey, candidate] of this.smsRequests) {
        if (now - candidate.windowStartedAt >= this.smsWindowMs) this.smsRequests.delete(candidateKey);
      }
    }
  }

  async #invoke(args, context, {
    parseJson = true,
    paid = false,
    stdin = null,
    onProgress,
    secrets = [],
  } = {}) {
    return new Promise((resolveRun, rejectRun) => {
      const env = filteredEnvironment(this.baseEnv, this.envOverrides, context.configDir, this.envAllowlist);
      let child;
      try {
        child = this.spawnImpl(this.cliPath, args, {
          cwd: context.cwd,
          env,
          shell: false,
          detached: false,
          windowsHide: true,
          stdio: [stdin === null ? "ignore" : "pipe", "pipe", "pipe"],
        });
      } catch (error) {
        rejectRun(new LibtvWorkerError("无法启动 LibTV CLI", {
          code: "LIBTV_SPAWN_FAILED",
          retrySafe: true,
          details: redactLibtvText(error instanceof Error ? error.message : "", secrets).slice(0, 500),
        }));
        return;
      }

      let stdout = "";
      let stderr = "";
      let progressRemainder = "";
      let observedTaskId = null;
      let stdoutOverflow = false;
      let settled = false;

      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        rejectRun(error);
      };
      const resolveOnce = (value) => {
        if (settled) return;
        settled = true;
        resolveRun(value);
      };

      child.stdout?.on("data", (chunk) => {
        if (stdoutOverflow) return;
        const text = chunk.toString();
        if (stdout.length + text.length > this.stdoutLimit) {
          stdout += text.slice(0, Math.max(0, this.stdoutLimit - stdout.length));
          stdoutOverflow = true;
        } else {
          stdout += text;
        }
      });
      child.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        stderr = (stderr + text).slice(-this.stderrLimit);
        observedTaskId ||= extractedTaskId(text) || extractedTaskId(stderr);
        progressRemainder = (progressRemainder + text).slice(-this.stderrLimit);
        const lines = progressRemainder.split(/\r?\n/);
        progressRemainder = lines.pop() || "";
        for (const line of lines) emitProgress(onProgress, line, secrets);
      });
      child.once?.("error", (error) => {
        rejectOnce(new LibtvWorkerError("无法启动 LibTV CLI", {
          code: "LIBTV_SPAWN_FAILED",
          retrySafe: true,
          details: redactLibtvText(error instanceof Error ? error.message : "", secrets).slice(0, 500),
        }));
      });
      child.once?.("close", (exitCode, signal) => {
        if (progressRemainder) emitProgress(onProgress, progressRemainder, secrets);
        const taskId = observedTaskId || extractedTaskId(stderr);
        if (exitCode !== 0) {
          const details = conciseFailure(stderr, stdout, secrets);
          const loginRequired = /(?:\b401\b|unauthorized|not logged in|未登录|尚未登录)/i.test(`${stderr}\n${stdout}`);
          const ambiguousPaidFailure = paid && /(?:timeout|timed out|gateway|ECONNRESET|connection reset|socket hang up|502|503|504)/i.test(`${stderr}\n${stdout}`);
          rejectOnce(new LibtvWorkerError(details || `LibTV CLI 执行失败（退出码 ${Number.isInteger(exitCode) ? exitCode : "未知"}）`, {
            code: loginRequired ? "LIBTV_LOGIN_REQUIRED" : paid && taskId ? "LIBTV_PAID_TASK_CREATED" : ambiguousPaidFailure ? "LIBTV_PAID_SUBMISSION_UNKNOWN" : "LIBTV_CLI_FAILED",
            exitCode: Number.isInteger(exitCode) ? exitCode : null,
            signal: signal || null,
            taskId,
            retrySafe: !(paid && (taskId || ambiguousPaidFailure)),
            details,
          }));
          return;
        }
        if (stdoutOverflow) {
          rejectOnce(new LibtvWorkerError("LibTV CLI stdout 超过服务器上限", {
            code: "LIBTV_OUTPUT_TOO_LARGE",
            taskId,
            retrySafe: !paid,
          }));
          return;
        }
        try {
          const json = parseJson ? parseLibtvStdout(stdout) : null;
          resolveOnce({ ok: true, exitCode: 0, json, stdout: parseJson ? undefined : redactLibtvText(stdout, secrets).trim() });
        } catch (error) {
          rejectOnce(new LibtvWorkerError(error instanceof Error ? error.message : "LibTV CLI 输出无效", {
            code: paid ? "LIBTV_PAID_RESULT_UNREADABLE" : "LIBTV_INVALID_JSON",
            taskId,
            retrySafe: !paid,
            cause: error,
          }));
        }
      });

      if (stdin !== null) {
        try {
          child.stdin?.end(String(stdin));
        } catch {
          // The process close/error event remains the source of truth.
        }
      }
    });
  }

  async #run({ tenantId, accountId, projectId, args, paid, parseJson, stdin, onProgress, secrets, beforeInvoke, afterSuccess }) {
    const safeArgs = safeArgumentList(args);
    assertHeadless(safeArgs);
    if (paid && !hasRunFlag(safeArgs)) throw new TypeError("paid 命令必须显式包含 --run 或 -r");
    if (!paid && hasRunFlag(safeArgs)) throw new TypeError("含 --run 的付费生成必须使用 runPaidCommand");
    const tenant = assertSafeIdentifier("tenantId", tenantId);
    const account = assertSafeIdentifier("accountId", accountId);
    const project = assertSafeIdentifier("projectId", projectId);
    // Register the queue entry before asynchronous directory preparation so
    // same-project calls preserve their invocation order.
    return this.#enqueue(`${tenant}\0${project}`, async () => {
      const context = await this.#context({ tenantId: tenant, accountId: account, projectId: project });
      if (typeof beforeInvoke === "function") beforeInvoke();
      const execution = await this.#invoke(safeArgs, context, {
        paid,
        parseJson,
        stdin,
        onProgress,
        secrets,
      });
      if (typeof afterSuccess === "function") afterSuccess();
      return execution;
    });
  }

  async getVersion({ tenantId, accountId, projectId = "account", onProgress } = {}) {
    const execution = await this.#run({
      tenantId,
      accountId,
      projectId,
      args: ["--version"],
      paid: false,
      parseJson: false,
      stdin: null,
      onProgress,
      secrets: [],
    });
    return execution.stdout;
  }

  async getAccountInfo({ tenantId, accountId, projectId = "account", onProgress } = {}) {
    const execution = await this.#run({
      tenantId,
      accountId,
      projectId,
      args: ["account", "info"],
      paid: false,
      parseJson: true,
      stdin: null,
      onProgress,
      secrets: [],
    });
    return execution.json;
  }

  accountInfo(options) {
    return this.getAccountInfo(options);
  }

  async requestPhoneCode({ tenantId, accountId, projectId = "account", phone, captcha, onProgress } = {}) {
    const safePhone = normalizedPhone(phone);
    const safeCaptcha = normalizedCaptcha(captcha);
    const safeTenant = assertSafeIdentifier("tenantId", tenantId);
    const safeProject = assertSafeIdentifier("projectId", projectId);
    const throttleKey = `${safeTenant}\0${safeProject}`;
    const args = ["login", "phone", "-p", safePhone];
    if (safeCaptcha) args.push("--captcha", safeCaptcha);
    await this.#run({
      tenantId,
      accountId,
      projectId: safeProject,
      args,
      paid: false,
      parseJson: false,
      stdin: null,
      onProgress,
      secrets: [safePhone, safeCaptcha],
      beforeInvoke: () => this.#assertSmsRequestAllowed(throttleKey),
      // A CAPTCHA challenge or CLI/network failure does not prove that an SMS
      // was sent. Record only a successful first-stage terminal result, while
      // keeping the check inside the project queue so concurrent calls cannot
      // bypass the limit.
      afterSuccess: () => this.#recordSmsSent(throttleKey),
    });
    return { ok: true, stage: "code_sent" };
  }

  sendPhoneCode(options) {
    return this.requestPhoneCode(options);
  }

  async completePhoneLogin({ tenantId, accountId, projectId = "account", phone, code, onProgress } = {}) {
    const safePhone = normalizedPhone(phone);
    const safeCode = normalizedCode(code);
    const args = ["login", "phone", "-p", safePhone, "-c", safeCode];
    await this.#run({
      tenantId,
      accountId,
      projectId,
      args,
      paid: false,
      parseJson: false,
      stdin: null,
      onProgress,
      secrets: [safePhone, safeCode],
    });
    return { ok: true, stage: "authenticated" };
  }

  loginWithPhoneCode(options) {
    return this.completePhoneLogin(options);
  }

  runCommand({ tenantId, accountId, projectId, args, stdin = null, parseJson = true, onProgress } = {}) {
    return this.#run({
      tenantId,
      accountId,
      projectId,
      args,
      paid: false,
      parseJson,
      stdin,
      onProgress,
      secrets: [],
    });
  }

  // LibTV --run is already synchronous: this queue waits for the child process
  // close event and deliberately adds no polling, backgrounding or timeout.
  runPaidCommand({ tenantId, accountId, projectId, args, stdin = null, onProgress } = {}) {
    return this.#run({
      tenantId,
      accountId,
      projectId,
      args,
      paid: true,
      parseJson: true,
      stdin,
      onProgress,
      secrets: [],
    });
  }

  runPaid(options) {
    return this.runPaidCommand(options);
  }

  async whenIdle() {
    while (this.queues.size > 0) {
      await Promise.allSettled([...this.queues.values()]);
    }
  }

  status() {
    return { pendingProjectQueues: this.queues.size };
  }
}

export function createLibtvServerWorker(options) {
  return new LibtvServerWorker(options);
}

export const libtvWorkerInternals = {
  assertSafeIdentifier,
  hasRunFlag,
  normalizedCaptcha,
  parseLibtvStdout,
  redactLibtvText,
};
