import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { createWorkbenchFixtureServer, workbenchFixtureOrigin } from './fixtures/workbench-ui.mjs';

test('isolated UI fixture serves synthetic state and never invokes a model', async (t) => {
  const server = createWorkbenchFixtureServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const { port, address } = server.address();
  assert.equal(address, '127.0.0.1');
  assert.notEqual(port, 3349, 'use an ephemeral listener, not the running visual fixture');

  let forbiddenOutboundCalls = 0;
  const denyOutbound = () => { forbiddenOutboundCalls++; throw new Error('Test forbids outbound network requests'); };
  // Fixture reads use the allowlisted loopback client below. A future accidental
  // provider/proxy call through fetch, HTTP or HTTPS fails this regression test.
  const originalHttpRequest = http.request;
  t.mock.method(globalThis, 'fetch', denyOutbound);
  t.mock.method(https, 'request', denyOutbound);
  t.mock.method(https, 'get', denyOutbound);
  t.mock.method(http, 'get', denyOutbound);
  t.mock.method(http, 'request', (options, callback) => {
    if (options?.hostname !== '127.0.0.1' || options?.port !== port) return denyOutbound();
    return originalHttpRequest(options, callback);
  });

  function request(path, method = 'GET', body) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port, path, method, agent: false,
        headers: { Origin: workbenchFixtureOrigin, 'Content-Type': 'application/json' },
      }, (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { responseBody += chunk; });
        res.on('error', reject);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(responseBody) }); }
          catch (error) { reject(error); }
        });
      });
      req.setTimeout(5000, () => req.destroy(new Error('Loopback fixture test timed out')));
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  await t.test('starts with no model tests, generation attempts or outbound calls', async () => {
    const result = await request('/__fixture/status');
    assert.equal(result.status, 200);
    assert.equal(result.headers['access-control-allow-origin'], workbenchFixtureOrigin);
    assert.match(result.body.notice, /UI 验收测试数据/);
    assert.equal(result.body.counters.modelTestAttempts, 0);
    assert.equal(result.body.counters.generationAttempts, 0);
    assert.equal(result.body.counters.outboundRequests, 0);
    assert.deepEqual(result.body.denied, []);
  });

  await t.test('health, project and diagnostic polling return clearly synthetic read-only data', async () => {
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.fixture, true);
    assert.equal(health.body.connected, true);
    assert.equal(health.body.shotWork.limit, 5);
    assert.equal(health.body.shotWork.active, 0);

    const auth = await request('/auth/me');
    assert.equal(auth.status, 200);
    assert.match(auth.body.user.email, /@example\.test$/);
    const draft = await request('/draft-state');
    assert.equal(draft.status, 200);
    assert.equal(draft.body.state.reviews.length, 7);
    assert.match(draft.body.state.projectTitle, /UI 验收测试/);
    assert.match(draft.body.state.reviews[0].completePrompt, /非 AI 生成结果/);
    assert.equal(draft.body.state.reviews.flatMap(review => review.shot.sourcePanels).length, 23);
    const recent = await request('/draft-state-recent');
    assert.match(recent.body.scopeId, /^[a-f0-9-]{36}$/);
    assert.match(recent.body.projectTitle, /UI 验收测试/);

    const diagnostics = await request('/model-tests');
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.body.fixture, true);
    assert.ok(diagnostics.body.models.length > 0);
    const status = (await request('/__fixture/status')).body;
    assert.equal(status.counters.modelTestReads, 1);
    assert.equal(status.counters.modelTestAttempts, 0);
    assert.equal(status.counters.generationAttempts, 0);
    assert.equal(status.counters.draftSaves, 0);
    assert.equal(status.counters.outboundRequests, 0);
  });

  await t.test('manual LLM probes, Chat, prompt/review, image and video requests are rejected locally', async () => {
    const probe = await request('/model-tests', 'POST', { ids: ['jk-gpt-5.6-sol'], requestId: 'fixture-attempt' });
    assert.equal(probe.status, 403);
    assert.equal(probe.body.retryPolicy, 'never');
    assert.match(probe.body.error, /没有发起真实请求/);

    const generationPaths = ['/shot-chat', '/complete-shot-prompt', '/review-shot-prompt', '/generate-image', '/libtv/video'];
    for (const path of generationPaths) {
      const result = await request(path, 'POST', { prompt: 'Synthetic test; must not run' });
      assert.equal(result.status, 403, path);
      assert.equal(result.body.fixture, true, path);
      assert.equal(result.body.retryPolicy, 'never', path);
    }
    const status = (await request('/__fixture/status')).body;
    assert.equal(status.counters.modelTestAttempts, 1);
    assert.equal(status.counters.generationAttempts, generationPaths.length);
    assert.equal(status.counters.outboundRequests, 0);
    assert.equal(status.denied.length, generationPaths.length + 1);
    assert.equal(forbiddenOutboundCalls, 0, 'not even an attempted external provider call is permitted');
  });
});
