import test from 'node:test';
import assert from 'node:assert/strict';
import { readProviderResponse, providerFailure } from '../server/provider-response.mjs';

function sse(items) {
  const bytes = new TextEncoder().encode(items.map(item => `data: ${typeof item === 'string' ? item : JSON.stringify(item)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(controller) {
    // Split in the middle of UTF-8 characters and SSE delimiters.
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}

test('chat stream preserves schema arguments and usage but never reasoning', async () => {
  const progress = [];
  const result = await readProviderResponse(sse([
    { id: 'r1', model: 'glm-5.3', choices: [{ delta: { reasoning_content: 'PRIVATE_REASON', tool_calls: [{ index: 0, function: { name: 'result', arguments: '{"标题":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"审核"}' } }] } }] },
    { choices: [{ finish_reason: 'tool_calls', delta: {} }], usage: { completion_tokens: 80, completion_tokens_details: { reasoning_tokens: 70 }, secret: 'PRIVATE_REASON' } },
    '[DONE]',
  ]), { protocol: 'chat', label: 'GLM', onProgress: p => progress.push(p) });
  assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{"标题":"审核"}');
  assert.equal(result.usage.completion_tokens_details.reasoning_tokens, 70);
  assert.doesNotMatch(JSON.stringify([result, progress]), /PRIVATE_REASON/);
});

test('Anthropic stream assembles tool JSON and requires message_stop', async () => {
  const frames = [
    { type: 'message_start', message: { id: 'msg_1', model: 'claude-opus-5', usage: { input_tokens: 90 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'PRIVATE' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'PRIVATE' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'result', id: 'tool1', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"ok":true}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 32 } },
  ];
  await assert.rejects(readProviderResponse(sse(frames), { protocol: 'anthropic', label: 'Claude' }), e => e.code === 'incomplete_stream');
  await assert.rejects(readProviderResponse(sse([...frames, '[DONE]']), { protocol: 'anthropic', label: 'Claude' }), e => e.code === 'incomplete_stream');
  const result = await readProviderResponse(sse([...frames, { type: 'message_stop' }]), { protocol: 'anthropic', label: 'Claude' });
  assert.deepEqual(result.content[0].input, { ok: true });
  assert.deepEqual(result.usage, { input_tokens: 90, output_tokens: 32 });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|thinking/);
});

test('truncation and HTTP failures retain safe diagnosis without accepting partial JSON', async () => {
  const result = await readProviderResponse(sse([
    { type: 'message_start', message: { id: 'msg_x' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'result' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"broken":' } },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 65536 } },
    { type: 'message_stop' },
  ]), { protocol: 'anthropic', label: 'Claude' });
  const error = providerFailure('Claude', { payload: result, limit: 65536 });
  assert.equal(error.code, 'output_limit');
  assert.equal(error.diagnostics.usage.output_tokens, 65536);
  await assert.rejects(readProviderResponse(new Response(JSON.stringify({ error: { message: 'secret' } }), { status: 504 }), { label: 'Claude' }), error => {
    assert.equal(error.diagnostics.httpStatus, 504);
    assert.doesNotMatch(JSON.stringify(error), /secret/);
    return true;
  });
});
