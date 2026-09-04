import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const WORKER_ENV_KEYS = new Set([
  "PATH", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "NODE_ENV",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "SSL_CERT_FILE",
  "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "MANJING_PYTHON", "FFMPEG_PATH",
  "VIDEO_SHOT_REVIEW_SKILL", "MANJING_REVIEWERS_JSON", "LIBTV_API_BASE_URL",
  "LIBTV_LOGIN_WEB_URL", "LIBTV_LOGIN_WEB_PATH", "LIBTV_BIN",
  "MANJING_AI_PROVIDER",
  "KIMI_API_KEY", "KIMI_API_URL", "KIMI_MODEL",
  "KIMI_REASONING_EFFORT", "KIMI_REASONING_EFFORT_REASONING",
  "GLM_API_KEY", "GLM_API_URL", "GLM_MODEL", "GLM_FLASH_MODEL", "GLM_REASONING_EFFORT",
  "DEEPSEEK_API_KEY", "DEEPSEEK_API_URL", "DEEPSEEK_MODEL", "DEEPSEEK_PRO_MODEL",
  "DOUBAO_API_KEY", "DOUBAO_API_URL", "DOUBAO_MODEL",
  "JIEKOU_API_KEY", "JIEKOU_BASE_URL", "JIEKOU_RESPONSES_BASE_URL",
  "MANJING_KIMI_API_KEY", "MANJING_KIMI_API_URL", "MANJING_KIMI_BASE_URL", "MANJING_KIMI_MODEL",
  "MANJING_KIMI_REASONING_EFFORT", "MANJING_KIMI_REASONING_EFFORT_REASONING", "MANJING_KIMI_MAX_OUTPUT_TOKENS",
  "MANJING_GLM_API_KEY", "MANJING_GLM_API_URL", "MANJING_GLM_BASE_URL", "MANJING_GLM_MODEL",
  "MANJING_GLM_FLASH_MODEL", "MANJING_GLM_REASONING_EFFORT", "MANJING_GLM_REASONING_EFFORT_REASONING", "MANJING_GLM_MAX_OUTPUT_TOKENS",
  "MANJING_WRITING_REASONING_EFFORT",
  "MANJING_MANGA_CROP_MODEL",
  "MANJING_JIEKOU_API_KEY", "MANJING_JIEKOU_BASE_URL", "MANJING_JIEKOU_RESPONSES_BASE_URL",
  "MANJING_JIEKOU_GPT_SOL_MODEL", "MANJING_JIEKOU_GPT_LUNA_MODEL", "MANJING_JIEKOU_GEMINI_MODEL",
  "MANJING_JIEKOU_CLAUDE_OPUS_MODEL", "MANJING_JIEKOU_CLAUDE_SONNET_MODEL", "MANJING_JIEKOU_MAX_OUTPUT_TOKENS",
  "MANJING_DEEPSEEK_API_KEY", "MANJING_DEEPSEEK_API_URL", "MANJING_DEEPSEEK_BASE_URL", "MANJING_DEEPSEEK_MODEL", "MANJING_DEEPSEEK_PRO_MODEL",
  "MANJING_DEEPSEEK_REASONING_EFFORT", "MANJING_DEEPSEEK_MAX_OUTPUT_TOKENS",
  "MANJING_DOUBAO_API_KEY", "MANJING_DOUBAO_API_URL", "MANJING_DOUBAO_BASE_URL", "MANJING_DOUBAO_MODEL",
  "MANJING_DOUBAO_REASONING_EFFORT", "MANJING_DOUBAO_MAX_OUTPUT_TOKENS",
  "SHOTDIRECTOR_KIMI_API_KEY", "SHOTDIRECTOR_KIMI_BASE_URL", "SHOTDIRECTOR_KIMI_MODEL",
  "SHOTDIRECTOR_GLM_API_KEY", "SHOTDIRECTOR_GLM_BASE_URL", "SHOTDIRECTOR_GLM_MODEL",
  "OPENAI_API_KEY", "OPENAI_API_URL", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_SOL_MODEL", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID",
  "MANJING_OPENAI_API_KEY", "MANJING_OPENAI_API_URL", "MANJING_OPENAI_BASE_URL", "MANJING_OPENAI_MODEL", "MANJING_OPENAI_SOL_MODEL", "MANJING_OPENAI_SOL_ENABLED",
  "MANJING_OPENAI_REASONING_EFFORT", "MANJING_OPENAI_MAX_OUTPUT_TOKENS", "MANJING_OPENAI_IMAGE_DETAIL", "MANJING_OPENAI_SERVICE_TIER",
  "MANJING_LIBTV_SMS_COOLDOWN_MS", "MANJING_LIBTV_SMS_WINDOW_MS",
  "MANJING_LIBTV_SMS_MAX_PER_WINDOW",
]);
const WORKER_ENV_PREFIXES = [
  "MANJING_OPENAI_IMAGE_", "MANJING_REVIEWER_SECRET_", "MANJING_JIEKOU_",
];

function safeId(label, value) {
  const id = String(value || "").trim();
  if (!SAFE_ID.test(id)) throw new TypeError(`${label} 不合法`);
  return id;
}

function reservePort(host = "127.0.0.1") {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.once("error", rejectPort);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

function appendLimited(current, chunk, limit = 120_000) {
  return (current + chunk.toString()).slice(-limit);
}

function workerBaseEnvironment(baseEnv) {
  return Object.fromEntries(Object.entries(baseEnv || {}).filter(([key, value]) => (
    typeof value === "string" && value && (
      WORKER_ENV_KEYS.has(key) || WORKER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    )
  )));
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForWorker(worker, timeoutMs, fetchImpl) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (worker.exited) throw new Error(`租户 Worker 启动失败：${worker.stderr.trim().split(/\r?\n/).slice(-2).join("；") || "进程提前退出"}`);
    try {
      const response = await fetchImpl(`http://127.0.0.1:${worker.port}/health`, {
        headers: { Origin: "http://localhost:3000", "X-Manjing-Token": worker.token },
        signal: AbortSignal.timeout(1_000),
      });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
      } else {
        try {
          const health = await response.json();
          if (health?.connected === true && health?.modelProvider?.configured === true) return;
          lastError = new Error("Worker 尚未连接已配置的文字模型");
        } catch {
          lastError = new Error("Worker 健康检查没有返回有效 JSON");
        }
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`租户 Worker 启动超时：${lastError instanceof Error ? lastError.message : "未知错误"}`);
}

export class TenantWorkerPool {
  constructor({
    appRoot = process.env.MANJING_APP_ROOT || process.cwd(),
    dataRoot = process.env.MANJING_DATA_ROOT || join(process.cwd(), "work", "manjing-server"),
    maxWorkers = Number(process.env.MANJING_MAX_TENANT_WORKERS || 32),
    maxWorkersPerUser = Number(process.env.MANJING_MAX_WORKERS_PER_USER || 3),
    idleTimeoutMs = Number(process.env.MANJING_WORKER_IDLE_TIMEOUT_MS || 20 * 60 * 1000),
    idleSweepIntervalMs = Number(process.env.MANJING_WORKER_IDLE_SWEEP_INTERVAL_MS || 60_000),
    shutdownWaitMs = Number(process.env.MANJING_WORKER_SHUTDOWN_WAIT_MS || 30_000),
    terminateTimeoutMs = Number(process.env.MANJING_WORKER_TERMINATE_TIMEOUT_MS || 5_000),
    killTimeoutMs = Number(process.env.MANJING_WORKER_KILL_TIMEOUT_MS || 2_000),
    startupTimeoutMs = Number(process.env.MANJING_WORKER_STARTUP_TIMEOUT_MS || 30_000),
    publicApiBase = process.env.MANJING_PUBLIC_API_BASE || "/api",
    nodeExecutable = process.execPath,
    spawnImpl = spawn,
    reservePortImpl = reservePort,
    baseEnv = process.env,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.appRoot = resolve(appRoot);
    this.dataRoot = resolve(dataRoot);
    this.maxWorkers = Math.max(1, Number(maxWorkers) || 32);
    this.maxWorkersPerUser = Math.max(1, Number(maxWorkersPerUser) || 3);
    this.idleTimeoutMs = Math.max(10_000, Number(idleTimeoutMs) || 20 * 60 * 1000);
    this.idleSweepIntervalMs = Math.max(1_000, Number(idleSweepIntervalMs) || 60_000);
    this.shutdownWaitMs = Math.max(1_000, Number(shutdownWaitMs) || 30_000);
    this.terminateTimeoutMs = Math.max(100, Number(terminateTimeoutMs) || 5_000);
    this.killTimeoutMs = Math.max(100, Number(killTimeoutMs) || 2_000);
    this.startupTimeoutMs = Math.max(1_000, Number(startupTimeoutMs) || 30_000);
    this.publicApiBase = String(publicApiBase || "/api");
    this.nodeExecutable = nodeExecutable;
    this.spawnImpl = spawnImpl;
    this.reservePortImpl = reservePortImpl;
    this.baseEnv = workerBaseEnvironment(baseEnv);
    this.fetchImpl = fetchImpl;
    this.workers = new Map();
    this.pending = new Map();
    this.startingWorkers = new Set();
    this.admissionTail = Promise.resolve();
    this.closed = false;
    this.bridgeScript = join(this.appRoot, "scripts", "shotdirector-bridge.mjs");
    if (!existsSync(this.bridgeScript)) throw new Error(`找不到漫镜 Bridge：${this.bridgeScript}`);
    mkdirSync(this.dataRoot, { recursive: true, mode: 0o700 });
    this.idleSweepTimer = setInterval(() => {
      void this.reapIdleWorkers().catch(() => {
        // A failed health probe must not crash the gateway; the next sweep retries.
      });
    }, this.idleSweepIntervalMs);
    this.idleSweepTimer.unref?.();
  }

  keyFor(userId, projectId) {
    return `${safeId("用户 ID", userId)}:${safeId("项目 ID", projectId)}`;
  }

  async #withAdmissionLock(work) {
    const previous = this.admissionTail;
    let release;
    this.admissionTail = new Promise((resolveLock) => { release = resolveLock; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  async get({ userId, projectId, userRole = "user" }) {
    if (this.closed) throw new Error("租户 Worker 池已经关闭");
    const safeUserId = safeId("用户 ID", userId);
    const safeProjectId = safeId("项目 ID", projectId);
    const safeUserRole = userRole === "superadmin" ? "superadmin" : "user";
    const key = this.keyFor(safeUserId, safeProjectId);
    const existing = this.workers.get(key);
    if (existing && !existing.exited && existing.userRole === safeUserRole) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    if (this.pending.has(key)) return this.pending.get(key);
    const reservation = await this.#withAdmissionLock(async () => {
      if (this.closed) throw new Error("租户 Worker 池已经关闭");
      const current = this.workers.get(key);
      if (current && !current.exited && current.userRole !== safeUserRole) {
        await this.#stopWorker(current, { waitForIdle: false });
      } else if (current && !current.exited) {
        current.lastUsedAt = Date.now();
        return { worker: current };
      }
      const alreadyStarting = this.pending.get(key);
      if (alreadyStarting) return { starting: alreadyStarting, owner: false };

      await this.#reapIdleWorkers();
      const userPrefix = `${safeUserId}:`;
      let userWorkerCount = [...this.workers.keys(), ...this.pending.keys()].filter((candidate) => candidate.startsWith(userPrefix)).length;
      if (userWorkerCount >= this.maxWorkersPerUser) {
        await this.#evictLeastRecentlyUsed(safeUserId);
        userWorkerCount = [...this.workers.keys(), ...this.pending.keys()].filter((candidate) => candidate.startsWith(userPrefix)).length;
      }
      if (userWorkerCount >= this.maxWorkersPerUser) {
        const error = new Error(`每个账户最多同时启动 ${this.maxWorkersPerUser} 个项目工作区`);
        error.statusCode = 429;
        throw error;
      }
      if (this.workers.size + this.pending.size >= this.maxWorkers) {
        await this.#evictLeastRecentlyUsed();
      }
      if (this.workers.size + this.pending.size >= this.maxWorkers) {
        const error = new Error("服务器当前活跃工作区已满，请稍后重试");
        error.statusCode = 503;
        throw error;
      }
      const starting = this.#start({ key, userId: safeUserId, projectId: safeProjectId, userRole: safeUserRole });
      this.pending.set(key, starting);
      return { starting, owner: true };
    });
    if (reservation.worker) return reservation.worker;
    if (!reservation.owner) return reservation.starting;
    try {
      return await reservation.starting;
    } finally {
      if (this.pending.get(key) === reservation.starting) this.pending.delete(key);
    }
  }

  async #start({ key, userId, projectId, userRole }) {
    const port = await this.reservePortImpl("127.0.0.1");
    if (this.closed) throw new Error("租户 Worker 池已经关闭");
    const token = randomUUID();
    const projectRoot = join(this.dataRoot, "tenants", userId, "projects", projectId);
    mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
    const child = this.spawnImpl(this.nodeExecutable, [this.bridgeScript], {
      cwd: this.appRoot,
      shell: false,
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...this.baseEnv,
        MANJING_APP_ROOT: this.appRoot,
        MANJING_DATA_ROOT: projectRoot,
        MANJING_SERVER_WORKER: "1",
        MANJING_AI_PROVIDER: this.baseEnv.MANJING_AI_PROVIDER
          || (this.baseEnv.MANJING_GLM_API_KEY || this.baseEnv.GLM_API_KEY
            ? "glm-5.3-flash"
            : this.baseEnv.MANJING_KIMI_API_KEY || this.baseEnv.KIMI_API_KEY
              ? "kimi-k3"
              : "glm-5.3-flash"),
        MANJING_TENANT_ID: userId,
        MANJING_TENANT_ROLE: userRole,
        MANJING_PROJECT_ID: projectId,
        MANJING_INTERNAL_TOKEN: token,
        MANJING_BRIDGE_HOST: "127.0.0.1",
        MANJING_BRIDGE_PORT: String(port),
        MANJING_ALLOWED_ORIGINS: "http://localhost:3000",
        MANJING_ALLOWED_HOSTS: `127.0.0.1:${port}`,
        MANJING_PUBLIC_API_BASE: this.publicApiBase,
        LIBTV_SERVER_STATE_DIR: join(projectRoot, "libtv-server"),
      },
    });
    const worker = {
      key,
      userId,
      userRole,
      projectId,
      projectRoot,
      port,
      token,
      child,
      stdout: "",
      stderr: "",
      exited: false,
      startedAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    this.startingWorkers.add(worker);
    child.stdout?.on("data", (chunk) => { worker.stdout = appendLimited(worker.stdout, chunk); });
    child.stderr?.on("data", (chunk) => { worker.stderr = appendLimited(worker.stderr, chunk); });
    child.once("exit", () => {
      worker.exited = true;
      this.startingWorkers.delete(worker);
      if (this.workers.get(key) === worker) this.workers.delete(key);
    });
    child.once("error", (error) => { worker.stderr = appendLimited(worker.stderr, error.message); });
    try {
      await waitForWorker(worker, this.startupTimeoutMs, this.fetchImpl);
      if (this.closed) {
        await this.#stopWorker(worker, { waitForIdle: false });
        throw new Error("租户 Worker 池已在关闭");
      }
      this.startingWorkers.delete(worker);
      this.workers.set(key, worker);
      return worker;
    } catch (error) {
      if (!worker.exited) await this.#stopWorker(worker, { waitForIdle: false });
      throw error;
    }
  }

  async #health(worker) {
    if (worker.exited) return null;
    try {
      const response = await this.fetchImpl(`http://127.0.0.1:${worker.port}/health`, {
        headers: { Origin: "http://localhost:3000", "X-Manjing-Token": worker.token },
        signal: AbortSignal.timeout(1_000),
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  async #workerBusy(worker) {
    if (worker.exited || worker.child?.exitCode != null || worker.child?.signalCode != null) {
      worker.exited = true;
      return false;
    }
    const health = await this.#health(worker);
    if (health === null) return true;
    return Boolean(
      health.busy ||
      health.activeJob ||
      [
        health.promptJobs,
        health.artworkJobs,
        health.assetJobs,
        health.mediaJobs,
      ].some((jobs) => Array.isArray(jobs) && jobs.some((job) => job?.status === "running")),
    );
  }

  async #waitForExit(worker, timeoutMs) {
    if (worker.exited) return true;
    return new Promise((resolveExit) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveExit(value);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      worker.child.once("exit", () => finish(true));
    });
  }

  async #stopWorker(worker, { waitForIdle = true } = {}) {
    if (!worker || worker.exited) return;
    if (worker.stopPromise) return worker.stopPromise;
    worker.stopPromise = (async () => {
      if (waitForIdle) {
        const deadline = Date.now() + this.shutdownWaitMs;
        while (Date.now() < deadline && await this.#workerBusy(worker)) {
          await delay(Math.min(1_000, Math.max(1, deadline - Date.now())));
        }
      }
      if (!worker.exited) worker.child.kill("SIGTERM");
      if (!await this.#waitForExit(worker, this.terminateTimeoutMs) && !worker.exited) {
        worker.child.kill("SIGKILL");
        await this.#waitForExit(worker, this.killTimeoutMs);
      }
      this.workers.delete(worker.key);
      this.startingWorkers.delete(worker);
    })();
    return worker.stopPromise;
  }

  async #reapIdleWorkers() {
    const cutoff = Date.now() - this.idleTimeoutMs;
    const candidates = [...this.workers.values()].filter((worker) => worker.lastUsedAt < cutoff);
    await Promise.all(candidates.map(async (worker) => {
      if (!await this.#workerBusy(worker)) await this.#stopWorker(worker, { waitForIdle: false });
    }));
  }

  async reapIdleWorkers() {
    if (this.closed) return 0;
    const before = this.workers.size;
    await this.#reapIdleWorkers();
    return before - this.workers.size;
  }

  async #evictLeastRecentlyUsed(userId) {
    const candidates = [...this.workers.values()]
      .filter((worker) => !userId || worker.userId === userId)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    for (const worker of candidates) {
      if (await this.#workerBusy(worker)) continue;
      await this.#stopWorker(worker, { waitForIdle: false });
      return true;
    }
    return false;
  }

  async stopAll() {
    clearInterval(this.idleSweepTimer);
    this.closed = true;
    await this.admissionTail;
    const activeWorkers = new Set(this.workers.values());
    const workers = [...new Set([...activeWorkers, ...this.startingWorkers])];
    const pending = [...this.pending.values()];
    this.workers.clear();
    await Promise.all([
      Promise.all(workers.map((worker) => this.#stopWorker(worker, {
        waitForIdle: activeWorkers.has(worker),
      }))),
      Promise.allSettled(pending),
    ]);
    const lateWorkers = [...new Set([...this.workers.values(), ...this.startingWorkers])];
    await Promise.all(lateWorkers.map((worker) => this.#stopWorker(worker, { waitForIdle: false })));
    this.workers.clear();
    this.pending.clear();
  }

  status() {
    return {
      active: this.workers.size,
      starting: this.pending.size,
      maximum: this.maxWorkers,
      maximumPerUser: this.maxWorkersPerUser,
    };
  }
}

export function createTenantWorkerPool(options) {
  return new TenantWorkerPool(options);
}
