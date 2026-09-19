import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runManjingAgentTurn } from '../runner/manjing-agent-runtime.mjs';
import { ManjingHarnessStore } from '../runner/manjing-harness-store.mjs';
import { CompatibleChatStructuredProvider } from '../server/compatible-chat-structured-provider.mjs';
import { OpenAIResponsesProvider } from '../server/openai-responses-provider.mjs';
import { AnthropicStructuredProvider } from '../server/anthropic-structured-provider.mjs';
import { DoubaoResponsesProvider } from '../server/doubao-responses-provider.mjs';
import { runModelProbe } from '../server/model-probe.mjs';

const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const options = { apiKey: 'fixture-key', baseUrl: 'http://127.0.0.1:9999/v1', model: 'fixture-model' };
const sse = frames => new Response(frames.map(frame => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`).join(''), {
  headers: { 'content-type': 'text/event-stream' },
});
const chatPayload = text => ({ id: 'response-fixture', model: 'fixture-model', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] });
const responsesPayload = text => ({ id: 'response-fixture', model: 'fixture-model', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const providers = [
  { name: 'GLM Chat', create: fetchImpl => new CompatibleChatStructuredProvider({ ...options, kind: 'glm', fetchImpl }), response: text => Response.json(chatPayload(text)) },
  { name: 'GPT Responses SSE', create: fetchImpl => new OpenAIResponsesProvider({ ...options, fetchImpl }), response: text => sse([
    { type: 'response.output_text.delta', delta: text },
    { type: 'response.completed', response: responsesPayload(text) },
  ]) },
  { name: 'Claude Messages SSE', create: fetchImpl => new AnthropicStructuredProvider({ ...options, baseUrl: 'http://127.0.0.1:9999/anthropic/v1', fetchImpl }), response: text => sse([
    { type: 'message_start', message: { id: 'response-fixture', model: 'fixture-model' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'PRIVATE_THINKING' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ]) },
  { name: 'Seed Responses', create: fetchImpl => new DoubaoResponsesProvider({ ...options, fetchImpl }), response: text => Response.json(responsesPayload(text)) },
];

const runProvider = (provider, agentRole = 'creator', signal) => runManjingAgentTurn({
  agentRole, signal, runId: `retry-${agentRole}`, conversationId: 'retry-project-shot', prompt: '只核对本镜证据并返回 JSON',
  runModel: async ({ prompt, systemPrompt, signal: modelSignal }) => (await provider.generate({
    prompt, instructions: systemPrompt, schema, schemaName: 'result', signal: modelSignal, reasoningEffort: 'max', stream: true,
  })).text,
});

for (const spec of providers) {
  for (const role of ['creator', 'review']) test(`${spec.name} 的完整空响应经 ${role} Harness 重试后成功`, async () => {
    let calls = 0;
    const bodies = [];
    const provider = spec.create(async (_, init) => {
      calls++;
      bodies.push(init.body);
      return spec.response(calls === 1 ? ' \n ' : '{"ok":true}');
    });
    const result = await runProvider(provider, role);
    assert.equal(calls, 2);
    assert.equal(bodies[0], bodies[1], '重试保持相同证据与请求配置');
    assert.equal(result.finalText, '{"ok":true}');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_THINKING|fixture-key/);
  });

  test(`${spec.name} 连续空响应最多尝试三次，诊断仍只请求一次`, async t => {
    let calls = 0;
    const provider = spec.create(async () => { calls++; return spec.response(''); });
    await assert.rejects(runProvider(provider), error => error.code === 'empty_model_output');
    assert.equal(calls, 3);
    const root = await mkdtemp(join(tmpdir(), 'manjing-empty-probe-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    calls = 0;
    const probe = await runModelProbe(new ManjingHarnessStore(root), { model: 'fixture-model', runtimeProvider: provider }, {
      signal: new AbortController().signal, requestId: 'empty-fixture', timeoutMs: 1000,
    });
    assert.equal(calls, 1);
    assert.deepEqual(probe, { model: 'fixture-model', responseId: 'response-fixture', connectionStatus: 'passed', formatStatus: 'failed' });
  });
}

test('普通格式错误、拒答、工具错误、缺失结束标记和 HTTP 错误均不自动重试', async () => {
  const cases = [
    ['格式错误', () => Response.json(chatPayload('not-json')), 'invalid_output_format'],
    ['缺失结束标记', () => Response.json({ choices: [{ message: { content: '' } }] }), 'invalid_output_format'],
    ['输出截断', () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '' } }] }), 'output_limit'],
    ['拒答', () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'declined' } }] }), 'invalid_output_format'],
    ['无效工具结果', () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '', tool_calls: [{ function: { name: 'result', arguments: '' } }] } }] }), 'invalid_output_format'],
    ['断流', () => sse([{ choices: [{ finish_reason: 'stop', delta: { content: '' } }] }]), 'incomplete_stream'],
    ['HTTP 504', () => Response.json({ error: { message: 'PRIVATE_UPSTREAM_ERROR' } }, { status: 504 }), 'upstream_http'],
  ];
  for (const [label, response, code] of cases) {
    let calls = 0;
    const provider = providers[0].create(async () => { calls++; return response(); });
    await assert.rejects(runProvider(provider), error => error.code === code, label);
    assert.equal(calls, 1, label);
  }
});

test('取消任务优先于空响应重试', async () => {
  const controller = new AbortController();
  let calls = 0;
  const provider = providers[0].create(async () => {
    calls++;
    controller.abort(new DOMException('fixture cancel', 'AbortError'));
    return Response.json(chatPayload(''));
  });
  await assert.rejects(runProvider(provider, 'creator', controller.signal), error => error.name === 'AbortError');
  assert.equal(calls, 1);
});
