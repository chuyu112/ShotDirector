import { runPersistentManjingAgentTurn } from '../runner/manjing-harness-store.mjs';
import { modelTestFailureMessage } from './model-tests.mjs';

const prompt = '这是独立 API 文字连通性测试，不是项目或 Shot 创作任务。不访问文件或网络，不调用其他工具。仅按结构化输出要求返回 {"ok":true}。';
const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean', const: true } } };

export async function runModelProbe(store, model, { signal, requestId, timeoutMs }) {
  let metadata;
  let called = false;
  await runPersistentManjingAgentTurn({
    store, signal, prompt,
    job: { id: `run-${requestId}`, conversationId: `model-test-${requestId}`, kind: 'model-test', agentRole: 'creator', modelId: model.model, textModelId: model.model },
    runModel: async ({ systemPrompt }) => {
      try {
        if (called) throw new Error('Probe cannot repeat');
        called = true;
        const response = await model.runtimeProvider.generate({ prompt, instructions: systemPrompt, model: model.model, schema, schemaName: 'model_connectivity_test', reasoningEffort: 'low', maxOutputTokens: 2048, stream: true, signal, timeoutMs });
        let value;
        try { value = JSON.parse(response.text); } catch { /* Reject free text. */ }
        if (value?.ok !== true || Object.keys(value).length !== 1) throw Object.assign(new Error('Invalid probe'), { code: 'invalid_probe' });
        // Keep only upstream-reported lineage; never pretend the requested model is an actual response.
        metadata = { model: response.reportedModel || null, responseId: response.responseId };
        return '{"ok":true}';
      } catch (error) {
        // Sanitize before the Harness records a failure, not just before sending to the browser.
        const message = modelTestFailureMessage(signal.aborted ? signal.reason : error);
        throw Object.assign(new Error(message), { safeProbeMessage: message });
      }
    },
  });
  if (!metadata) throw Object.assign(new Error('Invalid probe'), { code: 'invalid_probe' });
  return metadata;
}
