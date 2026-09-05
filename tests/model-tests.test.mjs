import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelTests, modelTestIds } from '../server/model-tests.mjs';
import { runModelProbe } from '../server/model-probe.mjs';
import { ManjingHarnessStore } from '../runner/manjing-harness-store.mjs';
import { CompatibleChatStructuredProvider } from '../server/compatible-chat-structured-provider.mjs';
import { MODEL_TEST_CASE_ID, MODEL_TEST_SCHEMA, modelTestFormatMatches } from '../app/model-test-contract.mjs';
import { modelTestStatusLabel } from '../app/model-test-status.mjs';

const catalog = () => ['a', 'b', 'c', 'd'].map(id => ({ id, label: id, model: `request-${id}`, provider: 'fake', available: id !== 'd' }));
const payload = ids => ({ ids, requestId: randomUUID() });

test('manual model tests cap concurrency at two, skip unavailable, persist real lineage, and never repeat a request', async () => {
  let active = 0, maximum = 0, calls = 0;
  const tests = new ModelTests({ catalog, invoke: async model => {
    calls++; maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 10)); active--;
    return { model: `actual-${model.id}`, responseId: 'response-1' };
  } });
  const input = payload(['a', 'b', 'c', 'd']);
  tests.start(input); tests.start(input);
  assert.throws(() => tests.start(payload(['a'])), { statusCode: 409 });
  await tests.pending;
  assert.equal(calls, 3); assert.equal(maximum, 2); assert.equal(tests.active, false);
  tests.start(input); assert.equal(calls, 3);
  assert.throws(() => tests.start(payload(['a'])), { statusCode: 429 });
  const rows = tests.snapshot().models;
  assert.equal(rows[3].result.status, 'skipped');
  for (const row of rows.slice(0, 3)) {
    assert.equal(row.result.actualModel, `actual-${row.id}`);
    assert.equal(row.result.requestedModel, `request-${row.id}`);
    assert.ok(row.result.durationMs >= 0); assert.ok(Date.parse(row.result.finishedAt));
  }
  assert.equal(rows[0].runtimeProvider, undefined);
});

test('model tests reject malformed IDs before invoking and sanitize errors without retry', async () => {
  assert.deepEqual(modelTestIds(payload(['glm-5.3-flash', 'jk-gpt-5.6-sol'])), ['glm-5.3-flash', 'jk-gpt-5.6-sol']);
  for (const ids of [[], ['a','a'], ['../bad'], Array(17).fill('a')]) assert.throws(() => modelTestIds(payload(ids)), { statusCode: 400 });
  assert.throws(() => modelTestIds({ ids: ['a'] }), { statusCode: 400 });
  let calls = 0;
  const tests = new ModelTests({ catalog, invoke: async () => { calls++; throw new Error('secret-API-key private reasoning'); } });
  assert.throws(() => tests.start(payload(['missing'])), { statusCode: 400 });
  tests.start(payload(['a'])); await tests.pending;
  assert.equal(calls, 1); assert.equal(tests.snapshot().models[0].result.status, 'failed');
  assert.doesNotMatch(JSON.stringify(tests.snapshot()), /secret|private reasoning/);
});

test('timeout aborts the provider and releases test workers without automatic retry', async () => {
  let calls = 0;
  const tests = new ModelTests({ catalog, timeoutMs: 10, invoke: async (_, { signal }) => {
    calls++; await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  tests.start(payload(['a', 'b', 'c'])); await tests.pending;
  assert.equal(calls, 3); assert.equal(tests.active, false);
  assert.match(tests.snapshot().models[0].result.error, /超时/);
});

test('restart recovers cached results but interrupts unfinished rounds without resubmitting', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'model-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = join(dir, 'state.json');
  const input = payload(['a']);
  await writeFile(filename, JSON.stringify({ round: { id: input.requestId, status: 'running' }, results: { a: { status: 'running' } }, seenIds: [input.requestId] }));
  const tests = new ModelTests({ filename, catalog, invoke: () => assert.fail('must not resume paid requests') });
  assert.equal(tests.snapshot().round.status, 'interrupted');
  assert.equal(tests.snapshot().models[0].result.status, 'interrupted');
  assert.equal(JSON.parse(await readFile(filename, 'utf8')).round.status, 'interrupted');
});

test('probe runs once through isolated Harness, uses LOW small request, and hides raw response and errors', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'model-probe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new ManjingHarnessStore(dir);
  let calls = 0;
  const model = { model: 'requested-model', runtimeProvider: { generate: async input => {
    assert.equal(input.model, 'requested-model');
    calls++; assert.equal(input.reasoningEffort, 'low'); assert.equal(input.maxOutputTokens, 2048);
    assert.equal(input.stream, true); assert.equal(input.imagePaths, undefined);
    return { text: '{"ok":true}', model: 'requested-model', reportedModel: 'actual-model', reasoning_content: 'secret-reasoning', responseId: 'resp-1' };
  } } };
  const options = () => ({ signal: new AbortController().signal, timeoutMs: 1000, requestId: randomUUID() });
  assert.deepEqual(await runModelProbe(store, model, options()), { model: 'actual-model', responseId: 'resp-1', connectionStatus: 'passed', formatStatus: 'passed' });
  assert.equal(calls, 1);
  model.runtimeProvider.generate = async () => ({ text: '{"ok":true}', model: 'requested-model' });
  assert.equal((await runModelProbe(store, model, options())).model, null);
  model.runtimeProvider.generate = async () => { throw new Error('secret-api-key'); };
  await assert.rejects(runModelProbe(store, model, options()));
  const files = await readdir(dir, { recursive: true });
  for (const file of files.filter(name => /\.(json|jsonl)$/.test(name))) assert.doesNotMatch(await readFile(join(dir, file), 'utf8'), /secret-api-key|secret-reasoning/);
});

test('versioned test case enforces explicit JSON conditions while allowing whitespace', () => {
  assert.equal(MODEL_TEST_CASE_ID, 'connectivity-json-v1');
  assert.equal(MODEL_TEST_SCHEMA.additionalProperties, false);
  assert.deepEqual(MODEL_TEST_SCHEMA.required, ['ok']);
  for (const text of ['{"ok":true}', ' \n{ "ok" : true }\n']) assert.equal(modelTestFormatMatches(text), true);
  for (const text of ['{"ok":"true"}', '{"ok":false}', '{"ok":true,"q1":1}', '{"OK":true}', '{}', 'null', '[]', 'true', '好的 {"ok":true}', '```json\n{"ok":true}\n```']) assert.equal(modelTestFormatMatches(text), false, text);
});

test('test labels distinguish format warning from interface failure and keep legacy evidence honest', () => {
  assert.equal(modelTestStatusLabel({ status: 'succeeded' }, true), '接口正常　格式正常✅');
  assert.equal(modelTestStatusLabel({ status: 'format_warning' }, true), '接口正常　格式错误⚠️');
  assert.equal(modelTestStatusLabel({ status: 'failed', error: '返回内容未通过测试格式校验' }, true), '接口正常　格式错误⚠️');
  assert.equal(modelTestStatusLabel({ status: 'failed', error: '上游网关超时' }, true), '接口错误　格式错误❌');
  assert.equal(modelTestStatusLabel(null, false), '未配置');
  assert.equal(modelTestStatusLabel({ status: 'interrupted' }, true), '已中断，结果未知');
});

test('complete DeepSeek response with bad format warns, HTTP error fails, and neither is retried or leaks text', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'model-format-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new ManjingHarnessStore(join(dir, 'harness'));
  let calls = 0;
  const models = ['valid', 'extra', 'fenced', 'unauthorized', 'interrupted'].map(id => ({ id, label: id, available: true, provider: 'deepseek', model: 'deepseek-v4-flash', runtimeProvider: new CompatibleChatStructuredProvider({
    kind: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'secret-key', fetchImpl: async (_, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.match(body.messages[1].content, /connectivity-json-v1/);
      assert.match(body.messages[0].content, /唯一|仅允许 ok/);
      assert.deepEqual(body.tools[0].function.parameters, MODEL_TEST_SCHEMA);
      assert.equal(body.diagnosticRawText, undefined);
      if (id === 'unauthorized') return new Response('{"error":{"message":"secret-provider-error"}}', { status: 401 });
      if (id === 'interrupted') return new Response('data: {"choices":[{"delta":{"content":"secret-incomplete"}}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      const content = id === 'valid' ? '{"ok":true}' : id === 'extra' ? '{"ok":true,"extra":"secret-text"}' : '```json\n{"ok":true}\n```';
      return new Response(JSON.stringify({ id: 'resp-test', model: 'deepseek-v4-flash', choices: [{ finish_reason: 'stop', message: { content } }] }), { headers: { 'Content-Type': 'application/json' } });
    },
  }) }));
  const tests = new ModelTests({ filename: join(dir, 'state.json'), catalog: () => models, invoke: (model, options) => runModelProbe(store, model, options) });
  tests.start(payload(models.map(m => m.id))); await tests.pending;
  assert.equal(calls, 5);
  const rows = tests.snapshot().models;
  assert.deepEqual(rows.map(r => r.result.status), ['succeeded', 'format_warning', 'format_warning', 'failed', 'failed']);
  for (const row of rows.slice(0, 3)) {
    assert.equal(row.result.connectionStatus, 'passed');
    assert.equal(row.result.actualModel, 'deepseek-v4-flash');
    assert.equal(row.available, true);
    assert.equal(row.result.testCaseId, MODEL_TEST_CASE_ID);
  }
  assert.equal(rows[3].result.formatStatus, 'not_checked');
  assert.match(rows[3].result.error, /认证/);
  assert.match(rows[4].result.error, /中断|未收到/);
  const restored = new ModelTests({ filename: join(dir, 'state.json'), catalog: () => models, invoke: () => assert.fail('no automatic repeat') });
  assert.equal(restored.snapshot().models[1].result.status, 'format_warning');
  for (const file of (await readdir(dir, { recursive: true })).filter(name => /\.(json|jsonl)$/.test(name))) {
    assert.doesNotMatch(await readFile(join(dir, file), 'utf8'), /secret-key|secret-text|secret-provider-error|secret-incomplete/);
  }
});
