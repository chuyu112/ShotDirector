import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LocalCodexRelay } from '../server/local-codex-relay.mjs';
import { LocalCodexProvider } from '../server/local-codex-provider.mjs';
import { LocalCodexRunner } from '../runner/local-codex-runner.mjs';
import { executeLocalCodexTask } from '../runner/local-codex-executor.mjs';
import { localCodexWorkerEnvironment, localCodexWorkerToken, normalizeLocalCodexTask } from '../server/local-codex-contract.mjs';
import { textModelConfigs } from '../server/text-model-catalog.mjs';
import { ManjingAuthStore } from '../server/auth-store.mjs';
import { createManjingGateway } from '../server/manjing-gateway.mjs';
import { TenantWorkerPool } from '../server/tenant-worker-pool.mjs';

const token = 'synthetic-device-token-not-a-secret-1234567890';
const ownerId = 'owner-fixture';
const projectId = 'project-fixture';
const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const task = (overrides = {}) => ({ id: randomUUID(), userId: ownerId, projectId, model: 'gpt-6-astra', prompt: 'Synthetic request', schema, schemaName: 'prompt-review', reasoningEffort: 'max', images: [], timeoutMs: 10_000, ...overrides });

async function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'manjing-local-codex-test-'));
  const relay = new LocalCodexRelay({ root: join(root, 'relay'), ownerId, token, ...options });
  const server = createServer(async (req, res) => {
    if (!await relay.handle(req, res, new URL(req.url, 'http://localhost').pathname.replace(/^\/api/, ''))) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const provider = new LocalCodexProvider({ baseUrl: `${base}/api/local-codex`, token: localCodexWorkerToken(token, ownerId, projectId), userId: ownerId, projectId, allowedRoots: [root], pollMs: 5 });
  const runnerRequest = async (path, payload) => fetch(`${base}/api/local-codex/runner${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  return { root, relay, server, base, provider, runnerRequest };
}

test('local Codex credentials and model catalog are scoped to the owning account and project', () => {
  const env = { MANJING_LOCAL_CODEX_OWNER_ID: ownerId, MANJING_LOCAL_CODEX_TOKEN: token };
  assert.deepEqual(localCodexWorkerEnvironment(env, 'other-user', projectId), {});
  const scoped = localCodexWorkerEnvironment(env, ownerId, projectId);
  assert.equal(scoped.MANJING_LOCAL_CODEX_TOKEN, undefined);
  assert.notEqual(scoped.MANJING_LOCAL_CODEX_WORKER_TOKEN, token);
  assert.notEqual(scoped.MANJING_LOCAL_CODEX_WORKER_TOKEN, localCodexWorkerEnvironment(env, ownerId, 'other-project').MANJING_LOCAL_CODEX_WORKER_TOKEN);
  assert.equal(textModelConfigs({}).some(model => model.localCodex), false);
  const model = textModelConfigs(scoped).find(model => model.localCodex);
  assert.equal(model.model, 'gpt-6-astra');
  assert.equal(model.configured, true);
  assert.equal(model.writingEnabled && model.reviewEnabled && model.supportsImages, true);
});

test('local Codex accepts only GPT-6, structured tasks and MAX for complete prompts and reviews', () => {
  for (const overrides of [{ model: 'gpt-5.6-sol' }, { schema: null }, { prompt: '' }, { reasoningEffort: 'low' }, { userId: '../outside' }, { id: '../outside' }, { id: 'not-a-uuid' }]) assert.throws(() => normalizeLocalCodexTask(task(overrides)));
  const normalized = normalizeLocalCodexTask(task({ command: 'must-not-execute', cwd: '/private', executable: 'sh' }));
  assert.equal(normalized.command, undefined);
  assert.equal(normalized.cwd, undefined);
  assert.equal(normalized.executable, undefined);
});

test('relay authenticates runner separately, rejects other projects and expires offline status', async t => {
  let now = 1_000;
  const { base, provider, relay, runnerRequest } = await fixture(t, { now: () => now, offlineAfterMs: 1_000 });
  assert.equal((await provider.refreshStatus()).ready, false);
  const before = relay.jobs.size;
  await assert.rejects(provider.generate(task()), /离线/);
  assert.equal(relay.jobs.size, before);
  await runnerRequest('/poll', { ready: true, model: 'gpt-6-astra', claim: false });
  assert.equal((await provider.refreshStatus()).ready, true);
  const denied = await fetch(`${base}/api/local-codex/runner/poll`, { method: 'POST', headers: { Authorization: `Bearer ${provider.token}` }, body: '{}' });
  assert.equal(denied.status, 401);
  const browser = await fetch(`${base}/api/local-codex/runner/poll`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://manjing.example' }, body: '{}' });
  assert.equal(browser.status, 403);
  now += 1_001;
  assert.equal((await provider.refreshStatus()).ready, false);
});

test('provider to durable relay to local runner returns only the completed result without duplicate execution', async t => {
  const { root, base, provider, relay } = await fixture(t);
  let executions = 0;
  const runner = new LocalCodexRunner({ server: base, token, ownerId, root: join(root, 'runner'),
    probe: async () => ({ ready: true, model: 'gpt-6-astra' }),
    execute: async received => { executions++; assert.equal(received.reasoningEffort, 'max'); return { text: '{"ok":true}', model: 'gpt-6-astra', responseId: 'synthetic-run', usage: { total_tokens: 3, hidden_reasoning: 'must-not-propagate' } }; },
  });
  await runner.tick();
  const response = provider.generate(task());
  const pump = setInterval(() => runner.tick().catch(() => {}), 10);
  let result;
  try { result = await response; } finally { clearInterval(pump); await runner.stop(); }
  assert.equal(result.text, '{"ok":true}');
  assert.deepEqual(result.usage, { total_tokens: 3 });
  assert.equal(executions, 1);
  const [record] = relay.jobs.values();
  const recovered = new LocalCodexRelay({ root: join(root, 'relay'), ownerId, token });
  assert.equal(recovered.jobs.get(record.task.id).status, 'completed');
  const originalCount = relay.jobs.size;
  await provider.request('/jobs', { payload: record.task });
  assert.equal(relay.jobs.size, originalCount);
  await assert.rejects(provider.request('/jobs', { payload: { ...record.task, prompt: 'different' } }), /另一份内容/);
  const wrongProject = new LocalCodexProvider({ baseUrl: `${base}/api/local-codex`, token: localCodexWorkerToken(token, ownerId, 'other-project'), userId: ownerId, projectId: 'other-project' });
  await assert.rejects(wrongProject.request(`/jobs/${record.task.id}`), /不存在/);
});

test('runner restart fails an interrupted execution without making another model call', async t => {
  const { root, provider, base, relay, runnerRequest } = await fixture(t);
  await runnerRequest('/poll', { ready: true, model: 'gpt-6-astra', claim: false });
  const input = task();
  await provider.request('/jobs', { payload: input });
  const claimed = await (await runnerRequest('/poll', { ready: true, model: 'gpt-6-astra', claim: true })).json();
  assert.equal(claimed.task.id, input.id);
  const runnerRoot = join(root, 'restart-runner');
  const first = new LocalCodexRunner({ server: base, token, ownerId, root: runnerRoot });
  first.persist({ id: input.id, status: 'running' });
  let calls = 0;
  const resumed = new LocalCodexRunner({ server: base, token, ownerId, root: runnerRoot, probe: async () => ({ ready: true }), execute: async () => { calls++; } });
  await resumed.tick();
  assert.equal(calls, 0);
  assert.equal(relay.jobs.get(input.id).status, 'failed');
});

test('local image forwarding rejects paths outside the current project', async t => {
  const { provider, runnerRequest } = await fixture(t);
  await runnerRequest('/poll', { ready: true, model: 'gpt-6-astra' });
  await assert.rejects(provider.generate({ ...task(), imagePaths: [fileURLToPath(new URL('../package.json', import.meta.url))] }), /不属于当前项目/);
});

test('a retained local result whose server task expired does not block future heartbeats', async t => {
  const { root, base, relay } = await fixture(t);
  const runner = new LocalCodexRunner({ server: base, token, ownerId, root: join(root, 'runner'), probe: async () => ({ ready: true }) });
  const id = randomUUID();
  runner.persist({ id, status: 'completed', result: { text: '{"ok":true}', model: 'gpt-6-astra' } });
  await runner.tick();
  assert.equal(runner.records.get(id).delivery, 'server-task-expired');
  assert.equal(relay.status().ready, true);
});

test('authenticated gateway and real tenant Worker route Codex through the Harness, with account isolation and offline status', { timeout: 30_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'manjing-codex-gateway-'));
  const store = new ManjingAuthStore({ filename: join(root, 'auth.sqlite') });
  const { user, defaultProject } = await store.registerUser({ email: 'owner@example.com', displayName: 'Owner fixture', password: 'synthetic-password' });
  const { user: other } = await store.registerUser({ email: 'other@example.com', displayName: 'Other fixture', password: 'synthetic-password' });
  let now = Date.now();
  const relay = new LocalCodexRelay({ root: join(root, 'relay'), ownerId: user.id, token, now: () => now });
  const workerPool = new TenantWorkerPool({ appRoot: fileURLToPath(new URL('..', import.meta.url)), dataRoot: root,
    shutdownWaitMs: 1_000, startupTimeoutMs: 5_000, baseEnv: { PATH: process.env.PATH, MANJING_AI_PROVIDER: 'glm-5.3-flash', MANJING_GLM_API_KEY: 'synthetic-unused-api-key', MANJING_GLM_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4', MANJING_GLM_MODEL: 'glm-5.3-flash', LIBTV_BIN: '/usr/bin/false', MANJING_LOCAL_CODEX_OWNER_ID: user.id, MANJING_LOCAL_CODEX_TOKEN: token } });
  const gateway = createManjingGateway({ store, workerPool, localCodexRelay: relay, cookieSecure: false });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${gateway.server.address().port}`;
  workerPool.localCodexEnv.MANJING_LOCAL_CODEX_RELAY_URL = `${base}/api/local-codex`;
  const cookie = `manjing_session=${store.createSession({ userId: user.id }).token}`;
  const otherCookie = `manjing_session=${store.createSession({ userId: other.id }).token}`;
  let calls = 0;
  const runner = new LocalCodexRunner({ server: base, token, ownerId: user.id, root: join(root, 'runner'),
    probe: async () => ({ ready: true }), execute: async task => {
      calls++;
      assert.equal(task.userId, user.id);
      assert.equal(task.projectId, defaultProject.id);
      assert.match(task.instructions, /诊断/);
      return { text: '{"ok":true}', model: 'gpt-6-astra', reportedModel: null, responseId: randomUUID(), usage: { total_tokens: 3 } };
    } });
  t.after(async () => { await runner.stop(); await gateway.close(); gateway.server.closeAllConnections(); await new Promise(resolve => gateway.server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  await runner.tick();
  const headers = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
  t.diagnostic('runner ready; starting real Worker health');
  const health = await (await fetch(`${base}/api/health`, { headers })).json();
  t.diagnostic('owner health returned');
  assert.equal(health.writingModels.find(m => m.id === 'local-codex-gpt-6').available, true);
  assert.equal(health.reviewers.find(m => m.id === 'local-codex-gpt-6').available, true);
  assert.doesNotMatch(JSON.stringify(health), /synthetic-device-token|WORKER_TOKEN|runtimeProvider/);
  assert.equal((await fetch(`${base}/api/writing-model`, { method: 'POST', headers, body: JSON.stringify({ id: 'local-codex-gpt-6' }) })).status, 200);
  const started = await fetch(`${base}/api/model-tests`, { method: 'POST', headers, body: JSON.stringify({ ids: ['local-codex-gpt-6'], requestId: randomUUID() }) });
  assert.equal(started.status, 202);
  t.diagnostic('model diagnostic submitted');
  let snapshot;
  const deadline = Date.now() + 10_000;
  do {
    await runner.tick();
    snapshot = await (await fetch(`${base}/api/model-tests`, { headers })).json();
    if (snapshot.round.status === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 30));
  } while (Date.now() < deadline);
  assert.equal(snapshot.models.find(m => m.id === 'local-codex-gpt-6').result.status, 'succeeded');
  assert.equal(calls, 1);
  t.diagnostic('model diagnostic completed');
  const secondHealth = await (await fetch(`${base}/api/health`, { headers: { Cookie: otherCookie } })).json();
  t.diagnostic('other account health returned');
  assert.equal(secondHealth.writingModels.some(m => m.id === 'local-codex-gpt-6'), false);
  now += 21_000;
  const offline = await (await fetch(`${base}/api/health`, { headers })).json();
  const selected = offline.writingModels.find(m => m.id === 'local-codex-gpt-6');
  assert.equal(selected.selected, true);
  assert.equal(selected.available, false);
  assert.match(selected.reason, /离线/);
  assert.equal(offline.reviewers.find(m => m.id === 'local-codex-gpt-6').available, false);
});

test('executor starts a fresh isolated model-only thread and does not emit private reasoning', async t => {
  const root = mkdtempSync(join(tmpdir(), 'manjing-executor-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const requests = [];
  let imagePath;
  const client = {
    listeners: new Set(), initialize: async () => {}, close: () => {},
    async request(method, params) {
      requests.push({ method, params });
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'config/read') return { config: { mcp_servers: { private: { enabled: true } } } };
      if (method === 'thread/start') return { thread: { id: randomUUID() }, model: 'gpt-6-astra' };
      if (method === 'turn/start') {
        imagePath = params.input.find(item => item.type === 'localImage').path;
        assert.equal(readFileSync(imagePath).toString(), 'synthetic-image');
        setImmediate(() => {
          for (const listener of client.listeners) {
            listener({ method: 'item/reasoning/textDelta', params: { threadId: params.threadId, delta: 'PRIVATE_REASONING_SENTINEL' } });
            listener({ method: 'item/completed', params: { threadId: params.threadId, item: { type: 'agentMessage', text: '{"ok":true}' } } });
            listener({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: 'synthetic-turn', status: 'completed' } } });
          }
        });
        return { turn: { id: 'synthetic-turn' } };
      }
    },
  };
  const result = await executeLocalCodexTask(task({ images: [{ mime: 'image/png', data: Buffer.from('synthetic-image').toString('base64') }] }), { scratchRoot: root, createClient: () => client });
  const start = requests.find(item => item.method === 'thread/start').params;
  assert.equal(start.ephemeral, true);
  assert.equal(start.permissions, 'manjing-model-only');
  assert.equal(start.config.mcp_servers.private.enabled, false);
  assert.equal(start.config.features.shell_tool, false);
  assert.equal(start.config.features.multi_agent, false);
  assert.deepEqual(start.config.permissions['manjing-model-only'].network, { enabled: false });
  assert.equal(requests.find(item => item.method === 'turn/start').params.effort, 'max');
  assert.equal(result.reportedModel, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REASONING/);
  assert.throws(() => readFileSync(imagePath));
});
