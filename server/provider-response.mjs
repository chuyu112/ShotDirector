// Only numeric usage and protocol metadata may leave the provider boundary.
// Never retain or emit thinking deltas, signatures, raw headers or error bodies.
export function safeUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const keys = ['input_tokens', 'output_tokens', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'cached_tokens', 'reasoning_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
  const result = {};
  for (const key of keys) if (Number.isFinite(value[key]) && value[key] >= 0) result[key] = value[key];
  for (const key of ['completion_tokens_details', 'output_tokens_details', 'prompt_tokens_details']) {
    const nested = safeUsage(value[key]);
    if (nested) result[key] = nested;
  }
  return Object.keys(result).length ? result : null;
}

export function providerFailure(label, { status, payload, limit, code } = {}) {
  const finishReason = payload?.stop_reason || payload?.choices?.[0]?.finish_reason;
  const truncated = code === 'output_limit' || (!code && (finishReason === 'length' || finishReason === 'max_tokens'));
  const reason = truncated ? `输出达到 Token 上限（本次预算 ${limit}），未接受截断报告`
    : status === 504 ? '上游 API 返回 HTTP 504（网关超时）'
      : status ? `API 返回 HTTP ${status}` : '响应流中断或未返回完整结束标记';
  const error = new Error(`${label} ${reason}`);
  error.code = truncated ? 'output_limit' : code || (status ? 'upstream_http' : 'incomplete_stream');
  error.statusCode = status || 502;
  error.diagnostics = {
    code: error.code,
    ...(status ? { httpStatus: status } : {}),
    ...(limit ? { outputTokenLimit: limit } : {}),
    ...(typeof finishReason === 'string' && /^[\w-]{1,48}$/.test(finishReason) ? { finishReason } : {}),
    ...(typeof payload?.id === 'string' && /^[\w-]{1,160}$/.test(payload.id) ? { responseId: payload.id } : {}),
    usage: safeUsage(payload?.usage),
  };
  return error;
}

async function* events(response, label, payload) {
  if (!response.body) throw providerFailure('模型');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read().catch(() => {
        throw providerFailure(label, { code: 'incomplete_stream', payload });
      });
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      total += value?.byteLength || 0;
      if (total > 16 * 1024 * 1024) throw providerFailure('模型', { code: 'response_too_large' });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) yield data;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readProviderResponse(response, { protocol, label, onProgress } = {}) {
  if (!response.ok) {
    // Read only JSON metadata for diagnostics, never forward the raw error body.
    const payload = await response.json().catch(() => ({}));
    throw providerFailure(label, { status: response.status, payload });
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json();
  const anthropic = protocol === 'anthropic';
  const payload = anthropic ? { content: [], usage: {} } : { choices: [{ message: { content: '', tool_calls: [] } }] };
  const blocks = new Map();
  let ended = false;
  let lastProgress = 0;
  for await (const data of events(response, label, payload)) {
    if (data === '[DONE]') { ended = !anthropic; break; }
    let event;
    try { event = JSON.parse(data); } catch { throw providerFailure(label); }
    if (event.type === 'error' || event.error) throw providerFailure(label, { code: 'stream_error' });
    if (Date.now() - lastProgress > 5000) {
      onProgress?.({ phase: 'receiving' });
      lastProgress = Date.now();
    }
    if (anthropic) {
      if (event.type === 'message_start') {
        payload.id = event.message?.id;
        payload.model = event.message?.model;
        payload.usage = safeUsage(event.message?.usage) || {};
      } else if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block?.type === 'tool_use') blocks.set(event.index, { type: 'tool_use', id: block.id, name: block.name, input: block.input, json: '' });
        if (block?.type === 'text') blocks.set(event.index, { type: 'text', text: block.text || '' });
      } else if (event.type === 'content_block_delta') {
        const block = blocks.get(event.index);
        if (block?.type === 'tool_use' && event.delta?.type === 'input_json_delta') block.json += event.delta.partial_json || '';
        if (block?.type === 'text' && event.delta?.type === 'text_delta') block.text += event.delta.text || '';
      } else if (event.type === 'message_delta') {
        payload.stop_reason = event.delta?.stop_reason;
        payload.usage = { ...payload.usage, ...safeUsage(event.usage) };
      } else if (event.type === 'message_stop') { ended = true; break; }
    } else {
      payload.id ||= event.id;
      payload.model ||= event.model;
      if (event.usage) payload.usage = safeUsage(event.usage);
      const choice = event.choices?.[0];
      const message = payload.choices[0].message;
      if (choice?.finish_reason) payload.choices[0].finish_reason = choice.finish_reason;
      if (typeof choice?.delta?.content === 'string') message.content += choice.delta.content;
      for (const call of choice?.delta?.tool_calls || []) {
        if (!Number.isInteger(call.index) || call.index < 0 || call.index > 32) throw providerFailure(label);
        const target = message.tool_calls[call.index] ||= { type: 'function', function: { name: '', arguments: '' } };
        if (call.id) target.id = call.id;
        if (call.function?.name) target.function.name += call.function.name;
        if (call.function?.arguments) target.function.arguments += call.function.arguments;
      }
    }
  }
  const finish = anthropic ? payload.stop_reason : payload.choices[0].finish_reason;
  if (!ended || !finish) throw providerFailure(label, { payload, code: 'incomplete_stream' });
  if (anthropic && finish !== 'max_tokens') {
    payload.content = [...blocks.values()].map(block => {
      if (block.type === 'text') return block;
      let input;
      try { input = block.json ? JSON.parse(block.json) : block.input; } catch { throw providerFailure(label, { code: 'invalid_json' }); }
      return { type: block.type, id: block.id, name: block.name, input };
    });
  }
  return payload;
}
