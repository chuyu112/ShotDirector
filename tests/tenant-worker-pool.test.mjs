import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import test from "node:test";
import { TenantWorkerPool } from "../server/tenant-worker-pool.mjs";

class FakeChild extends EventEmitter {
  constructor({ ignoreSigterm = false } = {}) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.signals = [];
    this.ignoreSigterm = ignoreSigterm;
    this.exitCode = null;
    this.signalCode = null;
  }

  kill(signal) {
    this.signals.push(signal);
    if (signal === "SIGTERM" && this.ignoreSigterm) return true;
    this.signalCode = signal;
    queueMicrotask(() => this.emit("exit", 0, signal));
    return true;
  }
}

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "manjing-pool-"));
  const spawns = [];
  let port = 46_000;
  const childFactory = options.childFactory || (() => new FakeChild());
  const poolOptions = { ...options };
  delete poolOptions.childFactory;
  const pool = new TenantWorkerPool({
    appRoot: resolve(fileURLToPath(new URL("..", import.meta.url))),
    dataRoot: root,
    reservePortImpl: async () => ++port,
    spawnImpl(executable, args, spawnOptions) {
      const child = childFactory();
      spawns.push({ executable, args, options: spawnOptions, child });
      return child;
    },
    fetchImpl: async () => new Response(JSON.stringify({
      connected: true,
      modelProvider: { configured: true },
      busy: false,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    shutdownWaitMs: 1_000,
    terminateTimeoutMs: 100,
    killTimeoutMs: 100,
    ...poolOptions,
  });
  t.after(async () => {
    await pool.stopAll();
    rmSync(root, { recursive: true, force: true });
  });
  return { pool, spawns };
}

test("worker pool forwards only an environment allowlist and caps active projects per user", async (t) => {
  const { pool, spawns } = fixture(t, {
    maxWorkers: 4,
    maxWorkersPerUser: 1,
    baseEnv: {
      PATH: "/usr/bin",
      MANJING_AI_PROVIDER: "glm",
      MANJING_GLM_API_KEY: "glm-server-key",
      MANJING_GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      MANJING_GLM_MODEL: "glm-5.3-flash",
      MANJING_GLM_MAX_OUTPUT_TOKENS: "16384",
      MANJING_KIMI_API_KEY: "kimi-reviewer-key",
      MANJING_KIMI_BASE_URL: "https://api.kimi.com/coding/v1",
      MANJING_KIMI_MODEL: "k3",
      MANJING_KIMI_MAX_OUTPUT_TOKENS: "16384",
      MANJING_KIMI_REASONING_EFFORT: "high",
      MANJING_KIMI_REASONING_EFFORT_REASONING: "max",
      MANJING_JIEKOU_API_KEY: "jk-server-key",
      MANJING_JIEKOU_BASE_URL: "https://api.highwayapi.ai/openai",
      MANJING_JIEKOU_RESPONSES_BASE_URL: "https://api.highwayapi.ai/openai/v1",
      MANJING_JIEKOU_MAX_OUTPUT_TOKENS: "16384",
      MANJING_CODEX_ENABLED: "true",
      MANJING_CODEX_BIN: "/usr/local/bin/codex",
      MANJING_CODEX_HOME: "/var/lib/manjing/codex-superadmin",
      MANJING_CODEX_MODEL: "gpt-5.6-sol",
      MANJING_CODEX_ALLOWED_TENANT_IDS: "user-a",
      MANJING_MANGA_CROP_MODEL: "glm-5.3-flash",
      KIMI_API_KEY: "legacy-kimi-key",
      KIMI_API_URL: "https://api.kimi.com/coding/v1",
      KIMI_MODEL: "k3",
      KIMI_REASONING_EFFORT: "high",
      KIMI_REASONING_EFFORT_REASONING: "max",
      GLM_API_KEY: "legacy-glm-key",
      GLM_API_URL: "https://open.bigmodel.cn/api/paas/v4",
      GLM_MODEL: "glm-5.3",
      GLM_FLASH_MODEL: "glm-5.3-flash",
      GLM_REASONING_EFFORT: "medium",
      KIMI_BIN: "/secret/kimi-cli",
      GLM_ASR_API_URL: "https://speech.example.invalid",
      GLM_ASR_MODEL: "private-asr-model",
      MANJING_KIMI_INTERNAL_SECRET: "must-not-forward",
      MANJING_GLM_ASR_API_KEY: "must-not-forward",
      OPENAI_API_KEY: "image-server-key",
      OPENAI_API_URL: "https://text.example.invalid/v1",
      OPENAI_MODEL: "gpt-5.6-luna",
      OPENAI_SOL_MODEL: "gpt-5.6-sol",
      MANJING_OPENAI_API_KEY: "text-server-key",
      MANJING_OPENAI_IMAGE_MODEL: "gpt-image-2",
      MANJING_OPENAI_MODEL: "gpt-5.6-luna",
      MANJING_OPENAI_REASONING_EFFORT: "high",
      DEEPSEEK_API_KEY: "deepseek-server-key",
      DEEPSEEK_API_URL: "https://api.deepseek.com",
      DEEPSEEK_MODEL: "deepseek-v4-flash",
      DEEPSEEK_PRO_MODEL: "deepseek-v4-pro",
      DOUBAO_API_KEY: "doubao-server-key",
      DOUBAO_API_URL: "https://ark.cn-beijing.volces.com/api/v3",
      DOUBAO_MODEL: "doubao-seed-2-1-pro-260628",
      OPENAI_TEXT_ONLY_SECRET: "must-not-forward",
      MANJING_AUTH_DB_PATH: "/secret/auth.sqlite",
      MANJING_COOKIE_SECURE: "true",
      MANJING_LIBTV_SMS_COOLDOWN_MS: "60000",
      UNRELATED_SECRET: "must-not-forward",
    },
    fetchImpl: async () => new Response(JSON.stringify({
      connected: true,
      modelProvider: { configured: true },
      busy: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });
  const first = await pool.get({ userId: "user-a", projectId: "project-a", userRole: "superadmin" });
  assert.equal(first.userId, "user-a");
  assert.equal(first.userRole, "superadmin");
  assert.equal(spawns[0].options.env.MANJING_TENANT_ROLE, "superadmin");
  assert.equal(spawns[0].options.env.MANJING_AI_PROVIDER, "glm");
  assert.equal(spawns[0].options.env.MANJING_GLM_API_KEY, "glm-server-key");
  assert.equal(spawns[0].options.env.MANJING_GLM_BASE_URL, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(spawns[0].options.env.MANJING_GLM_MODEL, "glm-5.3-flash");
  assert.equal(spawns[0].options.env.MANJING_GLM_MAX_OUTPUT_TOKENS, "16384");
  assert.equal(spawns[0].options.env.MANJING_KIMI_API_KEY, "kimi-reviewer-key");
  assert.equal(spawns[0].options.env.MANJING_KIMI_BASE_URL, "https://api.kimi.com/coding/v1");
  assert.equal(spawns[0].options.env.MANJING_KIMI_MODEL, "k3");
  assert.equal(spawns[0].options.env.MANJING_KIMI_MAX_OUTPUT_TOKENS, "16384");
  assert.equal(spawns[0].options.env.MANJING_KIMI_REASONING_EFFORT, "high");
  assert.equal(spawns[0].options.env.MANJING_KIMI_REASONING_EFFORT_REASONING, "max");
  assert.equal(spawns[0].options.env.MANJING_CODEX_ENABLED, undefined);
  assert.equal(spawns[0].options.env.MANJING_CODEX_BIN, undefined);
  assert.equal(spawns[0].options.env.MANJING_CODEX_HOME, undefined);
  assert.equal(spawns[0].options.env.MANJING_CODEX_MODEL, undefined);
  assert.equal(spawns[0].options.env.MANJING_CODEX_ALLOWED_TENANT_IDS, undefined);
  assert.equal(spawns[0].options.env.MANJING_MANGA_CROP_MODEL, "glm-5.3-flash");
  assert.equal(spawns[0].options.env.MANJING_JIEKOU_API_KEY, "jk-server-key");
  assert.equal(spawns[0].options.env.MANJING_JIEKOU_BASE_URL, "https://api.highwayapi.ai/openai");
  assert.equal(spawns[0].options.env.MANJING_JIEKOU_RESPONSES_BASE_URL, "https://api.highwayapi.ai/openai/v1");
  assert.equal(spawns[0].options.env.KIMI_API_KEY, "legacy-kimi-key");
  assert.equal(spawns[0].options.env.KIMI_API_URL, "https://api.kimi.com/coding/v1");
  assert.equal(spawns[0].options.env.KIMI_MODEL, "k3");
  assert.equal(spawns[0].options.env.KIMI_REASONING_EFFORT, "high");
  assert.equal(spawns[0].options.env.KIMI_REASONING_EFFORT_REASONING, "max");
  assert.equal(spawns[0].options.env.GLM_API_KEY, "legacy-glm-key");
  assert.equal(spawns[0].options.env.GLM_API_URL, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(spawns[0].options.env.GLM_MODEL, "glm-5.3");
  assert.equal(spawns[0].options.env.GLM_FLASH_MODEL, "glm-5.3-flash");
  assert.equal(spawns[0].options.env.GLM_REASONING_EFFORT, "medium");
  assert.equal(spawns[0].options.env.KIMI_BIN, undefined);
  assert.equal(spawns[0].options.env.GLM_ASR_API_URL, undefined);
  assert.equal(spawns[0].options.env.GLM_ASR_MODEL, undefined);
  assert.equal(spawns[0].options.env.MANJING_KIMI_INTERNAL_SECRET, undefined);
  assert.equal(spawns[0].options.env.MANJING_GLM_ASR_API_KEY, undefined);
  assert.equal(spawns[0].options.env.OPENAI_API_KEY, "image-server-key");
  assert.equal(spawns[0].options.env.OPENAI_API_URL, "https://text.example.invalid/v1");
  assert.equal(spawns[0].options.env.OPENAI_MODEL, "gpt-5.6-luna");
  assert.equal(spawns[0].options.env.OPENAI_SOL_MODEL, "gpt-5.6-sol");
  assert.equal(spawns[0].options.env.MANJING_OPENAI_API_KEY, "text-server-key");
  assert.equal(spawns[0].options.env.MANJING_OPENAI_IMAGE_MODEL, "gpt-image-2");
  assert.equal(spawns[0].options.env.MANJING_OPENAI_MODEL, "gpt-5.6-luna");
  assert.equal(spawns[0].options.env.MANJING_OPENAI_REASONING_EFFORT, "high");
  assert.equal(spawns[0].options.env.DEEPSEEK_API_KEY, "deepseek-server-key");
  assert.equal(spawns[0].options.env.DEEPSEEK_API_URL, "https://api.deepseek.com");
  assert.equal(spawns[0].options.env.DEEPSEEK_MODEL, "deepseek-v4-flash");
  assert.equal(spawns[0].options.env.DEEPSEEK_PRO_MODEL, "deepseek-v4-pro");
  assert.equal(spawns[0].options.env.DOUBAO_API_KEY, "doubao-server-key");
  assert.equal(spawns[0].options.env.DOUBAO_API_URL, "https://ark.cn-beijing.volces.com/api/v3");
  assert.equal(spawns[0].options.env.DOUBAO_MODEL, "doubao-seed-2-1-pro-260628");
  assert.equal(spawns[0].options.env.OPENAI_TEXT_ONLY_SECRET, undefined);
  assert.equal(spawns[0].options.env.MANJING_AUTH_DB_PATH, undefined);
  assert.equal(spawns[0].options.env.MANJING_COOKIE_SECURE, undefined);
  assert.equal(spawns[0].options.env.MANJING_LIBTV_SMS_COOLDOWN_MS, "60000");
  assert.equal(spawns[0].options.env.UNRELATED_SECRET, undefined);
  assert.equal(spawns[0].options.env.MANJING_DATA_ROOT, first.projectRoot);

  await assert.rejects(
    pool.get({ userId: "user-a", projectId: "project-b" }),
    (error) => error?.statusCode === 429,
  );
});

test("worker pool restarts a tenant worker when the authenticated role changes", async (t) => {
  const { pool, spawns } = fixture(t, { maxWorkers: 2, maxWorkersPerUser: 1 });
  const adminWorker = await pool.get({ userId: "user-role", projectId: "project-role", userRole: "superadmin" });
  assert.equal(adminWorker.userRole, "superadmin");
  assert.equal(spawns[0].options.env.MANJING_TENANT_ROLE, "superadmin");

  const regularWorker = await pool.get({ userId: "user-role", projectId: "project-role", userRole: "user" });
  assert.notEqual(regularWorker, adminWorker);
  assert.deepEqual(spawns[0].child.signals, ["SIGTERM"]);
  assert.equal(spawns[1].options.env.MANJING_TENANT_ROLE, "user");
});

test("worker pool evicts an idle non-busy worker before admitting another tenant", async (t) => {
  const { pool, spawns } = fixture(t, { maxWorkers: 1, maxWorkersPerUser: 1, idleTimeoutMs: 10_000 });
  const first = await pool.get({ userId: "user-a", projectId: "project-a" });
  first.lastUsedAt = Date.now() - 20_000;
  const second = await pool.get({ userId: "user-b", projectId: "project-b" });
  assert.equal(second.userId, "user-b");
  assert.deepEqual(spawns[0].child.signals, ["SIGTERM"]);
  assert.equal(pool.status().active, 1);
});

test("worker startup waits for connected JSON health with a configured model provider", async (t) => {
  let probes = 0;
  const healthResponses = [
    new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }),
    new Response(JSON.stringify({ connected: false, modelProvider: { id: "glm", configured: false } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    new Response(JSON.stringify({ connected: false, modelProvider: { id: "unsupported", configured: false } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    new Response(JSON.stringify({ connected: true, modelProvider: { id: "glm", configured: true }, busy: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ];
  const { pool } = fixture(t, {
    fetchImpl: async () => healthResponses[Math.min(probes++, healthResponses.length - 1)].clone(),
  });

  const worker = await pool.get({ userId: "user-health", projectId: "project-health" });
  assert.equal(worker.userId, "user-health");
  assert.equal(probes, 4, "HTTP 200, invalid JSON, empty provider and unsupported provider must not report ready");
});

test("idle reaper enforces TTL for non-busy workers", async (t) => {
  const { pool, spawns } = fixture(t, { idleTimeoutMs: 10_000 });
  const worker = await pool.get({ userId: "user-a", projectId: "project-a" });
  worker.lastUsedAt = Date.now() - 20_000;
  assert.equal(await pool.reapIdleWorkers(), 1);
  assert.deepEqual(spawns[0].child.signals, ["SIGTERM"]);
  assert.equal(pool.status().active, 0);
});

test("stopAll covers a pending reservation without spawning a late worker", async (t) => {
  let releasePort;
  const reservedPort = new Promise((resolvePort) => { releasePort = resolvePort; });
  const { pool, spawns } = fixture(t, {
    reservePortImpl: async () => reservedPort,
  });
  const pending = pool.get({ userId: "user-a", projectId: "project-a" });
  await new Promise((resolveTurn) => setImmediate(resolveTurn));
  const stopping = pool.stopAll();
  releasePort(47_000);
  await assert.rejects(pending, /已经关闭/u);
  await stopping;
  assert.equal(spawns.length, 0);
  assert.deepEqual(pool.status(), {
    active: 0,
    starting: 0,
    maximum: 32,
    maximumPerUser: 3,
  });
});

test("stopAll escalates from SIGTERM to SIGKILL and waits for exit", async (t) => {
  const { pool, spawns } = fixture(t, {
    childFactory: () => new FakeChild({ ignoreSigterm: true }),
  });
  await pool.get({ userId: "user-a", projectId: "project-a" });
  await pool.stopAll();
  assert.deepEqual(spawns[0].child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(pool.status().active, 0);
});

test("stopAll does not wait the full drain window for an already exited worker", async (t) => {
  const { pool, spawns } = fixture(t, { shutdownWaitMs: 5_000 });
  await pool.get({ userId: "user-a", projectId: "project-a" });
  spawns[0].child.exitCode = 0;
  const startedAt = Date.now();
  await pool.stopAll();
  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(spawns[0].child.signals, []);
});
