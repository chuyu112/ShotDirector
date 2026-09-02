import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { ManjingAuthStore } from "../server/auth-store.mjs";
import { createManjingGateway } from "../server/manjing-gateway.mjs";
import {
  MAX_ANNOTATION_BATCH_SHOTS,
  MAX_MANGA_BATCH_PAGES,
  assertAnnotationBatchShotLimit,
  dynamicAiModelCallBudget,
} from "../server/request-limits.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

function sessionCookies(response) {
  const raw = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie().join(",")
    : response.headers.get("set-cookie") || "";
  const cookies = [];
  for (const name of ["manjing_session", "manjing_project"]) {
    const value = raw.match(new RegExp(`(?:^|[, ])${name}=([^;]+)`))?.[1];
    if (value) cookies.push(`${name}=${value}`);
  }
  return cookies.join("; ");
}

function replaceCookie(cookieHeader, response, name) {
  const incoming = sessionCookies(response).split("; ").find((item) => item.startsWith(`${name}=`));
  if (!incoming) return cookieHeader;
  return [...cookieHeader.split("; ").filter((item) => !item.startsWith(`${name}=`)), incoming].join("; ");
}

test("gateway registers users, restores sessions, isolates projects and injects worker credentials", async (t) => {
  let backendRequest;
  const backend = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      backendRequest = { url: req.url, headers: req.headers, body };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const backendPort = await listen(backend);
  const poolCalls = [];
  const workerPool = {
    async get(input) {
      poolCalls.push(input);
      return { ...input, port: backendPort, token: "internal-worker-token" };
    },
    status() { return { active: 1, starting: 0, maximum: 4 }; },
    async stopAll() {},
  };
  const store = new ManjingAuthStore({ filename: ":memory:" });
  const gateway = createManjingGateway({
    store,
    workerPool,
    cookieSecure: false,
    maxProjectsPerUser: 2,
    dailyLimits: { ai: 6, libtv: 1, libtvLogin: 2, upload: 2, uploadBytes: 10 },
  });
  const port = await listen(gateway.server);
  const base = `http://127.0.0.1:${port}`;
  const origin = base;
  t.after(async () => {
    await close(gateway.server);
    await gateway.close();
    await close(backend);
  });

  let response = await fetch(`${base}/api/auth/me`);
  assert.deepEqual(await response.json(), { authenticated: false, serverMode: true });

  response = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "director@example.com", displayName: "导演", password: "correct-horse" }),
  });
  assert.equal(response.status, 201);
  const firstRegistration = await response.json();
  const firstCookie = sessionCookies(response);
  assert.match(firstCookie, /manjing_session=/);
  assert.match(firstCookie, /manjing_project=/);

  response = await fetch(`${base}/api/auth/me`, { headers: { Cookie: firstCookie } });
  const session = await response.json();
  assert.equal(session.authenticated, true);
  assert.equal(session.user.email, "director@example.com");
  assert.equal(session.activeProject.id, firstRegistration.activeProject.id);

  response = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { Cookie: firstCookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "第二项目" }),
  });
  assert.equal(response.status, 201);
  const secondProject = (await response.json()).project;
  response = await fetch(`${base}/api/projects/select`, {
    method: "POST",
    headers: { Cookie: firstCookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: secondProject.id }),
  });
  assert.equal(response.status, 200);
  const secondProjectCookie = replaceCookie(firstCookie, response, "manjing_project");
  response = await fetch(`${base}/api/auth/me`, { headers: { Cookie: secondProjectCookie } });
  assert.equal((await response.json()).activeProject.id, secondProject.id);
  response = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { Cookie: firstCookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "超出上限" }),
  });
  assert.equal(response.status, 409);

  response = await fetch(`${base}/api/echo?frame=12`, {
    method: "POST",
    headers: { Cookie: firstCookie, Origin: origin, "Content-Type": "application/json", "X-Manjing-Token": "browser-forgery" },
    body: JSON.stringify({ shot: "01" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(backendRequest.url, "/echo?frame=12");
  assert.equal(backendRequest.headers["x-manjing-token"], "internal-worker-token");
  assert.equal(backendRequest.headers.origin, "http://localhost:3000");
  assert.equal(backendRequest.headers.cookie, undefined);
  assert.equal(backendRequest.body, '{"shot":"01"}');
  assert.deepEqual(poolCalls[0], {
    userId: session.user.id,
    projectId: session.activeProject.id,
    userRole: "user",
  });

  response = await fetch(`${base}/api/media-analyze`, {
    method: "POST",
    headers: { Cookie: firstCookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "manga", mediaIds: ["page-1"] }),
  });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/media-analyze`, {
    method: "POST",
    headers: { Cookie: firstCookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "manga", mediaIds: ["page-1"] }),
  });
  assert.equal(response.status, 429);
  const aiDenied = await response.json();
  assert.equal(aiDenied.quota.limit, 6);
  assert.equal(aiDenied.quota.used, 6);
  assert.equal(aiDenied.quota.requested, 6);
  assert.match(aiDenied.error, /本次需要 6，今日剩余 0/);
  assert.match(aiDenied.error, /ai-model-call-budget/);

  response = await fetch(`${base}/api/media-upload`, {
    method: "POST",
    headers: { Cookie: firstCookie, Origin: origin, "Content-Type": "application/octet-stream" },
    body: "123456",
  });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/media-upload`, {
    method: "POST",
    headers: { Cookie: firstCookie, Origin: origin, "Content-Type": "application/octet-stream" },
    body: "123456",
  });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).quota.limit, 10);
  response = await fetch(`${base}/api/media-upload`, {
    method: "POST",
    headers: { Cookie: firstCookie, Origin: origin, "Content-Type": "application/octet-stream" },
    body: "1",
  });
  assert.equal(response.status, 200, "failed byte quota must not partially consume upload-count quota");
  response = await fetch(`${base}/api/media-upload`, {
    method: "POST",
    headers: { Cookie: firstCookie, Origin: origin, "Content-Type": "application/octet-stream" },
    body: "1",
  });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).quota.limit, 2);

  response = await fetch(`${base}/api/generate-asset-gpt`, {
    method: "POST",
    headers: { Cookie: firstCookie, Origin: origin, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 402);
  assert.equal((await response.json()).code, "USAGE_NOT_ENABLED");

  response = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "other@example.com", displayName: "其他用户", password: "correct-horse" }),
  });
  const secondCookie = sessionCookies(response);
  response = await fetch(`${base}/api/health`, {
    headers: { Cookie: secondCookie, "X-Manjing-Project": session.activeProject.id },
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /不属于当前用户/);

  response = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: firstCookie, Origin: origin } });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/health`, { headers: { Cookie: firstCookie } });
  assert.equal(response.status, 401);
});

test("gateway rejects cross-site state changes before reading credentials", async (t) => {
  const store = new ManjingAuthStore({ filename: ":memory:" });
  const workerPool = { status: () => ({}), stopAll: async () => {}, get: async () => assert.fail("must not start") };
  const gateway = createManjingGateway({ store, workerPool, cookieSecure: false });
  const port = await listen(gateway.server);
  t.after(async () => {
    await close(gateway.server);
    await gateway.close();
  });
  const response = await fetch(`http://127.0.0.1:${port}/auth/register`, {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "x@example.com", displayName: "X", password: "password-1" }),
  });
  assert.equal(response.status, 403);
});

test("gateway emits credentialed CORS only for an explicit allowed origin", async (t) => {
  const allowedOrigin = "https://mobile.manjing.example";
  const store = new ManjingAuthStore({ filename: ":memory:" });
  const workerPool = { status: () => ({}), stopAll: async () => {}, get: async () => assert.fail("must not start") };
  const gateway = createManjingGateway({ store, workerPool, cookieSecure: false, allowedOrigins: new Set([allowedOrigin]) });
  const port = await listen(gateway.server);
  t.after(async () => {
    await close(gateway.server);
    await gateway.close();
  });
  const response = await fetch(`http://127.0.0.1:${port}/auth/register`, {
    method: "OPTIONS",
    headers: {
      Origin: allowedOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.match(response.headers.get("access-control-allow-headers"), /Content-Type/);
});

test("gateway trusts only the configured right-most XFF hop for registration limits", async (t) => {
  const store = new ManjingAuthStore({ filename: ":memory:" });
  const workerPool = { status: () => ({}), stopAll: async () => {}, get: async () => assert.fail("must not start") };
  const gateway = createManjingGateway({
    store,
    workerPool,
    cookieSecure: false,
    trustProxy: true,
    trustedProxyHops: 1,
  });
  const port = await listen(gateway.server);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await close(gateway.server);
    await gateway.close();
  });

  const register = (index, trustedHop) => fetch(`${base}/auth/register`, {
    method: "POST",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      "X-Forwarded-For": `198.51.100.${index + 1}, ${trustedHop}`,
    },
    body: JSON.stringify({
      email: `proxy-${index}@example.com`,
      displayName: `Proxy ${index}`,
      password: "proxy-password",
    }),
  });
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await register(index, "203.0.113.10")).status, 201);
  }
  assert.equal((await register(5, "203.0.113.10")).status, 429);
  assert.equal((await register(6, "203.0.113.11")).status, 201);
});

test("gateway health probes real tool versions and enforces a global AI budget", async (t) => {
  const backend = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
  const backendPort = await listen(backend);
  const store = new ManjingAuthStore({ filename: ":memory:" });
  const workerPool = {
    async get(input) { return { ...input, port: backendPort, token: "worker-token" }; },
    status() { return { active: 0, starting: 0, maximum: 4 }; },
    async stopAll() {},
  };
  const gateway = createManjingGateway({
    store,
    workerPool,
    cookieSecure: false,
    dailyLimits: { ai: 12, globalAi: 6 },
    libtvVersionProbe: async () => ({ configured: true, available: true, installed: true, version: "1.2.3" }),
    ffmpegVersionProbe: async () => ({ configured: true, available: true, version: "4.2.2" }),
  });
  const port = await listen(gateway.server);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await close(gateway.server);
    await gateway.close();
    await close(backend);
  });

  let response = await fetch(`${base}/healthz`);
  const health = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(health.libtv, { configured: true, available: true, installed: true, version: "1.2.3" });
  assert.deepEqual(health.ffmpeg, { configured: true, available: true, version: "4.2.2" });

  const register = async (email, displayName) => {
    const registered = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ email, displayName, password: "global-budget-password" }),
    });
    assert.equal(registered.status, 201);
    return sessionCookies(registered);
  };
  const aliceCookie = await register("budget-alice@example.com", "Alice");
  const bobCookie = await register("budget-bob@example.com", "Bob");
  response = await fetch(`${base}/media-analyze`, {
    method: "POST",
    headers: { Cookie: aliceCookie, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "manga", mediaIds: ["page-1"] }),
  });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/media-analyze`, {
    method: "POST",
    headers: { Cookie: bobCookie, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "manga", mediaIds: ["page-1"] }),
  });
  assert.equal(response.status, 429);
  const denied = await response.json();
  assert.equal(denied.code, "USAGE_QUOTA_EXCEEDED");
  assert.equal(denied.quota.scope, "global");
  assert.equal(denied.quota.used, 6);
  assert.match(denied.error, /ai-model-call-budget/);
});

test("superadmin receives an independent 100-unit AI budget while regular users stay at 10", async (t) => {
  const backend = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
  const backendPort = await listen(backend);
  const store = new ManjingAuthStore({ filename: ":memory:" });
  const workerPool = {
    async get(input) { return { ...input, port: backendPort, token: "worker-token" }; },
    status() { return { active: 0, starting: 0, maximum: 4 }; },
    async stopAll() {},
  };
  const gateway = createManjingGateway({
    store,
    workerPool,
    cookieSecure: false,
    dailyLimits: { ai: 10, superadminAi: 100, globalAi: 200 },
  });
  const port = await listen(gateway.server);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await close(gateway.server);
    await gateway.close();
    await close(backend);
  });

  const register = async (email, displayName) => {
    const response = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ email, displayName, password: "role-budget-password" }),
    });
    assert.equal(response.status, 201);
    return { cookie: sessionCookies(response), payload: await response.json() };
  };
  const admin = await register("quota-admin@example.com", "Quota Admin");
  const regular = await register("quota-user@example.com", "Quota User");
  store.setUserRole(admin.payload.user.id, "superadmin");
  const mediaIds = Array.from({ length: 11 }, (_, index) => `page-${index + 1}`);

  let response = await fetch(`${base}/media-analyze`, {
    method: "POST",
    headers: { Cookie: admin.cookie, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "manga", mediaIds }),
  });
  assert.equal(response.status, 200);
  const adminUsage = Number(store.database.prepare(`
    SELECT amount FROM usage_counters
    WHERE owner_user_id = ? AND counter_type = 'ai-model-call-budget'
  `).get(admin.payload.user.id)?.amount || 0);
  assert.equal(adminUsage, 18);

  response = await fetch(`${base}/media-analyze`, {
    method: "POST",
    headers: { Cookie: regular.cookie, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "manga", mediaIds }),
  });
  assert.equal(response.status, 429);
  const denied = await response.json();
  assert.equal(denied.quota.limit, 10);
  assert.equal(denied.quota.used, 0);
  assert.equal(denied.quota.remaining, 10);
  assert.equal(denied.quota.requested, 18);
  assert.match(denied.error, /本次需要 18，今日剩余 10/);
});

test("gateway reserves and replays page-scaled manga model-call budgets", async (t) => {
  const forwarded = [];
  const backend = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      forwarded.push({ path: req.url, payload: JSON.parse(body) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  const backendPort = await listen(backend);
  let workerStarts = 0;
  const workerPool = {
    async get(input) {
      workerStarts += 1;
      return { ...input, port: backendPort, token: "worker-token" };
    },
    status() { return { active: 0, starting: 0, maximum: 8 }; },
    async stopAll() {},
  };
  const store = new ManjingAuthStore({ filename: ":memory:" });
  const gateway = createManjingGateway({
    store,
    workerPool,
    cookieSecure: false,
    trustProxy: true,
    trustedProxyHops: 1,
    dailyLimits: { ai: 80, globalAi: 1_000 },
  });
  const port = await listen(gateway.server);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await close(gateway.server);
    await gateway.close();
    await close(backend);
  });

  const boundaries = [
    [1, 6, 2],
    [4, 6, 2],
    [5, 12, 4],
    [MAX_MANGA_BATCH_PAGES, 60, 20],
  ];
  for (const [index, [pageCount, analysisBudget, recutBudget]] of boundaries.entries()) {
    const registration = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        "X-Forwarded-For": `198.51.100.${index + 30}`,
      },
      body: JSON.stringify({
        email: `manga-budget-${pageCount}@example.com`,
        displayName: `Manga Budget ${pageCount}`,
        password: "manga-budget-password",
      }),
    });
    assert.equal(registration.status, 201);
    const cookie = sessionCookies(registration);
    const registered = await registration.json();
    const mediaIds = Array.from({ length: pageCount }, (_, pageIndex) => `page-${pageIndex + 1}`);

    let response = await fetch(`${base}/media-analyze`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "manga", mediaIds }),
    });
    assert.equal(response.status, 200);
    let used = Number(store.database.prepare(`
      SELECT amount FROM usage_counters
      WHERE owner_user_id = ? AND counter_type = 'ai-model-call-budget'
    `).get(registered.user.id)?.amount || 0);
    assert.equal(used, analysisBudget, `${pageCount} manga pages must reserve the analysis worst case`);

    response = await fetch(`${base}/manga-recut-boxes`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ sourceRequestId: `source-${pageCount}`, mediaIds }),
    });
    assert.equal(response.status, 200);
    used = Number(store.database.prepare(`
      SELECT amount FROM usage_counters
      WHERE owner_user_id = ? AND counter_type = 'ai-model-call-budget'
    `).get(registered.user.id)?.amount || 0);
    assert.equal(used, analysisBudget + recutBudget, `${pageCount} manga pages must reserve the recut worst case`);
  }

  assert.equal(dynamicAiModelCallBudget("/media-analyze", { kind: "video", mediaIds: ["video-1"] }), 2);
  assert.throws(
    () => dynamicAiModelCallBudget("/media-analyze", {
      kind: "manga",
      mediaIds: Array.from({ length: MAX_MANGA_BATCH_PAGES + 1 }, (_, index) => `page-${index}`),
    }),
    (error) => error?.statusCode === 413 && error?.code === "MEDIA_BATCH_LIMIT_EXCEEDED",
  );
  assert.equal(workerStarts, boundaries.length * 2);
  assert.equal(forwarded.length, boundaries.length * 2);
  assert.deepEqual(forwarded.map((item) => item.payload.mediaIds.length), [1, 1, 4, 4, 5, 5, 40, 40]);
});

test("annotation batches stop at 20 shots before quota charging or worker startup", async (t) => {
  let backendCalls = 0;
  let backendPayload;
  const backend = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      backendCalls += 1;
      backendPayload = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  const backendPort = await listen(backend);
  let workerStarts = 0;
  const workerPool = {
    async get(input) {
      workerStarts += 1;
      return { ...input, port: backendPort, token: "worker-token" };
    },
    status() { return { active: 0, starting: 0, maximum: 8 }; },
    async stopAll() {},
  };
  const store = new ManjingAuthStore({ filename: ":memory:" });
  const gateway = createManjingGateway({
    store,
    workerPool,
    cookieSecure: false,
    dailyLimits: { ai: 10 },
  });
  const port = await listen(gateway.server);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await close(gateway.server);
    await gateway.close();
    await close(backend);
  });

  const registration = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "annotation-limit@example.com",
      displayName: "Annotation Limit",
      password: "annotation-limit-password",
    }),
  });
  assert.equal(registration.status, 201);
  const cookie = sessionCookies(registration);
  const annotationItem = (index) => ({
    shot: { id: `SHOT ${String(index + 1).padStart(2, "0")}` },
    annotations: { action: "keep" },
  });

  const overflowItems = Array.from({ length: MAX_ANNOTATION_BATCH_SHOTS + 1 }, (_, index) => annotationItem(index));
  let response = await fetch(`${base}/annotations-batch`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ items: overflowItems }),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: `全片批注单次最多提交 ${MAX_ANNOTATION_BATCH_SHOTS} 个 Shot（收到 ${MAX_ANNOTATION_BATCH_SHOTS + 1} 个）`,
    code: "ANNOTATION_BATCH_LIMIT_EXCEEDED",
    limit: MAX_ANNOTATION_BATCH_SHOTS,
    received: MAX_ANNOTATION_BATCH_SHOTS + 1,
  });
  assert.equal(workerStarts, 0);
  assert.equal(backendCalls, 0);

  const allowedItems = overflowItems.slice(0, MAX_ANNOTATION_BATCH_SHOTS);
  response = await fetch(`${base}/annotations-batch`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ items: allowedItems }),
  });
  assert.equal(response.status, 200, "the rejected request must not consume its 10-unit budget");
  assert.equal(workerStarts, 1);
  assert.equal(backendCalls, 1);
  assert.deepEqual(backendPayload.items, allowedItems);

  response = await fetch(`${base}/annotations-batch`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [annotationItem(0)] }),
  });
  assert.equal(response.status, 429);
  assert.equal(workerStarts, 1);
  assert.equal(backendCalls, 1);
});

test("bridge applies the shared annotation batch limit before creating a model job", async () => {
  assert.equal(
    assertAnnotationBatchShotLimit({ items: Array.from({ length: MAX_ANNOTATION_BATCH_SHOTS }, () => ({})) }),
    MAX_ANNOTATION_BATCH_SHOTS,
  );
  assert.throws(
    () => assertAnnotationBatchShotLimit({ items: Array.from({ length: MAX_ANNOTATION_BATCH_SHOTS + 1 }, () => ({})) }),
    (error) => error?.statusCode === 413 && error?.code === "ANNOTATION_BATCH_LIMIT_EXCEEDED",
  );

  const bridgeSource = await readFile(new URL("../scripts/shotdirector-bridge.mjs", import.meta.url), "utf8");
  const reviseShotsSource = bridgeSource.slice(
    bridgeSource.indexOf("async function reviseShots(payload)"),
    bridgeSource.indexOf("async function reviseGlobalSettings", bridgeSource.indexOf("async function reviseShots(payload)")),
  );
  assert.match(reviseShotsSource, /assertAnnotationBatchShotLimit\(payload\)/);
  assert.ok(
    reviseShotsSource.indexOf("assertAnnotationBatchShotLimit(payload)") < reviseShotsSource.indexOf('withJob("annotation-batch"'),
    "the Bridge must reject an oversized request before starting a job or calling a model",
  );
});

test("gateway charges conservative model-call budget weights for every AI route", async (t) => {
  let backendCalls = 0;
  const backend = createServer((_req, res) => {
    backendCalls += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
  const backendPort = await listen(backend);
  const store = new ManjingAuthStore({ filename: ":memory:" });
  const workerPool = {
    async get(input) { return { ...input, port: backendPort, token: "worker-token" }; },
    status() { return { active: 0, starting: 0, maximum: 8 }; },
    async stopAll() {},
  };
  const gateway = createManjingGateway({
    store,
    workerPool,
    cookieSecure: false,
    trustProxy: true,
    trustedProxyHops: 1,
    dailyLimits: { ai: 10 },
  });
  const port = await listen(gateway.server);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await close(gateway.server);
    await gateway.close();
    await close(backend);
  });

  const cases = [
    ["/media-analyze", 6, { kind: "manga", mediaIds: ["page-1"] }],
    ["/manga-recut-boxes", 2, { sourceRequestId: "source-1", mediaIds: ["page-1"] }],
    ["/annotations", 2, {}],
    ["/annotations-batch", 10, {}],
    ["/complete-shot-prompt", 2, {}],
    ["/review-shot-prompt", 2, {}],
    ["/global-annotations", 2, {}],
    ["/load-script", 2, {}],
  ];

  for (const [index, [path, weight, body]] of cases.entries()) {
    const forwardedFor = `198.51.100.${index + 1}`;
    const registration = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        "X-Forwarded-For": forwardedFor,
      },
      body: JSON.stringify({
        email: `budget-route-${index}@example.com`,
        displayName: `Budget ${index}`,
        password: "route-budget-password",
      }),
    });
    assert.equal(registration.status, 201);
    const cookie = sessionCookies(registration);
    const allowedCalls = Math.floor(10 / weight);
    for (let call = 0; call < allowedCalls; call += 1) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200, `${path} call ${call + 1} should fit its budget`);
    }
    const deniedResponse = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(deniedResponse.status, 429, `${path} must stop at its weighted budget`);
    const denied = await deniedResponse.json();
    assert.equal(denied.code, "USAGE_QUOTA_EXCEEDED");
    assert.equal(denied.quota.used, allowedCalls * weight);
    assert.equal(denied.quota.remaining, 10 - (allowedCalls * weight));
    assert.match(denied.error, /ai-model-call-budget/);
  }
  assert.equal(backendCalls, cases.reduce((total, [, weight]) => total + Math.floor(10 / weight), 0));
});
