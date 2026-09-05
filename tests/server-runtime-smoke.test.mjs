import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ManjingAuthStore } from "../server/auth-store.mjs";
import { createManjingGateway } from "../server/manjing-gateway.mjs";
import { TenantWorkerPool } from "../server/tenant-worker-pool.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function reservePort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForJson(url, child, stderr) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Worker 提前退出：${stderr()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // The loopback listener may not have bound yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`等待 Worker 健康状态超时：${stderr()}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolveWait) => setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolveWait();
    }, 2_000)),
  ]);
}

function cookiesFrom(response) {
  const raw = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie().join(",")
    : response.headers.get("set-cookie") || "";
  return ["manjing_session", "manjing_project"].flatMap((name) => {
    const value = raw.match(new RegExp(`(?:^|[, ])${name}=([^;]+)`))?.[1];
    return value ? [`${name}=${value}`] : [];
  }).join("; ");
}

test("real gateway starts an isolated GLM worker after registration", { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "manjing-runtime-"));
  const dataRoot = join(root, "data");
  const store = new ManjingAuthStore({ filename: join(dataRoot, "auth.sqlite") });
  const workerPool = new TenantWorkerPool({
    appRoot: resolve(fileURLToPath(new URL("..", import.meta.url))),
    dataRoot,
    maxWorkers: 2,
    maxWorkersPerUser: 1,
    shutdownWaitMs: 1_000,
    baseEnv: {
      ...process.env,
      MANJING_AI_PROVIDER: "glm",
      MANJING_GLM_API_KEY: "glm-smoke-test-placeholder",
      MANJING_GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      MANJING_GLM_MODEL: "glm-5.3-flash",
      MANJING_KIMI_API_KEY: "kimi-reviewer-smoke-test-placeholder",
      MANJING_KIMI_BASE_URL: "https://api.kimi.com/coding/v1",
      MANJING_KIMI_MODEL: "k3",
      OPENAI_API_KEY: "image-smoke-test-placeholder",
      LIBTV_BIN: "/usr/bin/false",
    },
  });
  const gateway = createManjingGateway({ store, workerPool, cookieSecure: false });
  const port = await listen(gateway.server);
  const base = `http://127.0.0.1:${port}`;

  try {
    const registration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "smoke@example.com", displayName: "联调导演", password: "runtime-password" }),
    });
    assert.equal(registration.status, 201);
    const cookie = cookiesFrom(registration);
    const registered = await registration.json();

    const healthResponse = await fetch(`${base}/api/health`, { headers: { Cookie: cookie } });
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.connected, true);
    assert.equal(health.serverMode, true);
    assert.deepEqual(health.modelProvider, {
      id: "glm",
      selectionId: "glm-5.3-flash",
      configured: true,
      model: "glm-5.3-flash",
      label: "GLM-5.3-Flash",
      supportsWebSearch: false,
      supportsImages: true,
      fallbackPolicy: "manual",
    });
    assert.deepEqual(health.reviewers.find(({ id }) => id === "kimi-k3"), {
      id: "kimi-k3",
      label: "Kimi K3",
      provider: "kimi",
      model: "k3",
      available: true,
      evidenceMode: "direct-images",
      lastCall: { status: "untested" },
    });
    assert.deepEqual(health.writingModels.map(({ id }) => id), [
      "glm-5.3-flash",
      "kimi-k3",
      "deepseek-v4-flash",
      "seed-2.1-pro",
      "deepseek-v4-pro",
      'ko-gpt-5.6-luna',
      "jk-gpt-5.6-sol",
      "jk-gpt-5.6-luna",
      "jk-gemini-3.8-flash",
      "jk-claude-opus-5",
      "jk-claude-sonnet-5",
    ]);
    assert.equal(health.writingModels.find(({ id }) => id === "glm-5.3-flash").selected, true);
    assert.equal(health.writingModels.find(({ id }) => id === "kimi-k3").available, true);
    assert.equal(health.writingModels.find(({ id }) => id === "jk-gpt-5.6-luna").available, false);
    assert.deepEqual(health.reasoningPolicy, {
      selected: "high",
      options: ["low", "high", "max"],
      taskOverrides: { mangaSplit: "low", completeShotPrompt: "max", strictReview: "max" },
    });
    assert.equal(health.pairingToken, undefined);
    assert.equal(health.tenantId, registered.user.id);
    const diagnostics = await fetch(`${base}/api/model-tests`, { headers: { Cookie: cookie } });
    assert.equal(diagnostics.status, 200);
    const diagnosticState = await diagnostics.json();
    assert.equal(diagnosticState.round, null);
    assert.ok(diagnosticState.models.some(model => model.id === 'glm-5.3-flash'));
    assert.ok(diagnosticState.models.some(model => model.id === 'glm-5.3'));
    assert.doesNotMatch(JSON.stringify(diagnosticState), /smoke-test-placeholder|apiKey|runtimeProvider/);

    const projectRoot = join(dataRoot, "tenants", registered.user.id, "projects", registered.activeProject.id);
    assert.equal(existsSync(join(projectRoot, "work")), true);
    assert.equal(existsSync(join(projectRoot, "project-source", "storyboard-data.ts")), true);
    assert.equal(workerPool.status().active, 1);

    const deferred = await fetch(`${base}/api/writing-model`, {
      method: "POST",
      headers: { Origin: base, Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "jk-gpt-5.6-luna" }),
    });
    assert.equal(deferred.status, 409);

    const selected = await fetch(`${base}/api/writing-model`, {
      method: "POST",
      headers: { Origin: base, Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "kimi-k3" }),
    });
    assert.equal(selected.status, 200);
    const selectedPayload = await selected.json();
    assert.equal(selectedPayload.modelProvider.id, "kimi");
    assert.equal(selectedPayload.modelProvider.model, "k3");
    assert.equal(selectedPayload.writingModels.find(({ id }) => id === "kimi-k3").selected, true);
    assert.equal(existsSync(join(projectRoot, "work", "writing-model-selection.json")), true);

    const reasoning = await fetch(`${base}/api/reasoning-effort`, {
      method: "POST",
      headers: { Origin: base, Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ effort: "max" }),
    });
    assert.equal(reasoning.status, 200);
    assert.equal((await reasoning.json()).reasoningPolicy.selected, "max");
    assert.equal(existsSync(join(projectRoot, "work", "writing-reasoning-selection.json")), true);

    const selectedHealth = await fetch(`${base}/api/health`, { headers: { Cookie: cookie } }).then((response) => response.json());
    assert.equal(selectedHealth.modelProvider.id, "kimi");
    assert.equal(selectedHealth.reasoningPolicy.selected, "max");
    assert.equal(selectedHealth.writingModels.find(({ id }) => id === "glm-5.3-flash").selected, false);
  } finally {
    if (gateway.server.listening) {
      gateway.server.close();
      await once(gateway.server, "close");
    }
    await gateway.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("server worker maps the legacy openai alias to JK GPT Sol and fails closed without its API key", { timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "manjing-openai-disabled-"));
  const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const port = await reservePort();
  const token = "server-disabled-provider-test-token";
  let stderr = "";
  const child = spawn(process.execPath, [join(appRoot, "scripts", "shotdirector-bridge.mjs")], {
    cwd: appRoot,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      MANJING_APP_ROOT: appRoot,
      MANJING_DATA_ROOT: root,
      MANJING_SERVER_WORKER: "1",
      MANJING_TENANT_ID: "disabled-provider-user",
      MANJING_PROJECT_ID: "disabled-provider-project",
      MANJING_INTERNAL_TOKEN: token,
      MANJING_BRIDGE_HOST: "127.0.0.1",
      MANJING_BRIDGE_PORT: String(port),
      MANJING_ALLOWED_ORIGINS: "http://localhost:3000",
      MANJING_ALLOWED_HOSTS: `127.0.0.1:${port}`,
      MANJING_AI_PROVIDER: "openai",
      JIEKOU_API_KEY: "",
      MANJING_JIEKOU_API_KEY: "",
      OPENAI_API_KEY: "must-not-enable-writing",
      MANJING_OPENAI_API_KEY: "",
      MANJING_OPENAI_API_URL: "",
      MANJING_OPENAI_BASE_URL: "",
      OPENAI_API_URL: "",
      OPENAI_BASE_URL: "",
      MANJING_OPENAI_MODEL: "gpt-5.6-luna",
      MANJING_OPENAI_SOL_MODEL: "",
      OPENAI_SOL_MODEL: "",
      MANJING_KIMI_API_KEY: "selectable-kimi-placeholder",
      MANJING_KIMI_BASE_URL: "https://api.kimi.com/coding/v1",
      MANJING_KIMI_MODEL: "k3",
      LIBTV_BIN: "/usr/bin/false",
    },
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });

  try {
    const base = `http://127.0.0.1:${port}`;
    const health = await waitForJson(`${base}/health`, child, () => stderr);
    assert.equal(health.connected, false);
    assert.equal(health.modelProvider.id, "jiekou-responses");
    assert.equal(health.modelProvider.selectionId, "jk-gpt-5.6-sol");
    assert.equal(health.modelProvider.configured, false);
    assert.equal(health.modelProvider.model, "gpt-5.6-sol");
    assert.equal(health.modelProvider.supportsImages, true);
    assert.equal(health.writingModels.find((model) => model.id === "jk-gpt-5.6-sol").selected, true);
    assert.equal(health.writingModels.find((model) => model.id === "jk-gpt-5.6-sol").available, false);

    const forbidden = await fetch(`${base}/writing-model`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-Manjing-Token": token,
      },
      body: JSON.stringify({ id: "jk-gpt-5.6-luna" }),
    });
    assert.equal(forbidden.status, 409);
  } finally {
    await stopChild(child);
    rmSync(root, { recursive: true, force: true });
  }
});
