import { runPersistentManjingAgentTurn } from '../runner/manjing-harness-store.mjs';
import { modelTestFailureMessage } from './model-tests.mjs';
import { MODEL_TEST_PROMPT as prompt, MODEL_TEST_SCHEMA as schema, MODEL_TEST_RULES, modelTestFormatMatches } from '../app/model-test-contract.mjs';


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
        const response = await model.runtimeProvider.generate({ prompt, instructions: `${systemPrompt}\n本轮仅执行诊断，不输出创作报告。${MODEL_TEST_RULES}`, model: model.model, schema, schemaName: 'model_connectivity_test', diagnosticRawText: true, reasoningEffort: 'low', maxOutputTokens: 2048, stream: true, signal, timeoutMs });
        const formatStatus = modelTestFormatMatches(response.text) ? 'passed' : 'failed';
        // Keep only upstream-reported lineage; never pretend the requested model is an actual response.
        metadata = { model: response.reportedModel || null, responseId: response.responseId, connectionStatus: 'passed', formatStatus };
        // The Harness records a completed diagnostic, not a successful format check.
        if (formatStatus === 'failed') return '{"connectionStatus":"passed","formatStatus":"failed"}';
        return '{"ok":true}';
      } catch (error) {
        if (!signal.aborted && error?.code === 'invalid_output_format') {
          metadata = { model: error.reportedModel || null, responseId: error.responseId, connectionStatus: 'passed', formatStatus: 'failed' };
          return '{"connectionStatus":"passed","formatStatus":"failed"}';
        }
        // Sanitize before the Harness records a failure, not just before sending to the browser.
        const message = modelTestFailureMessage(signal.aborted ? signal.reason : error);
        throw Object.assign(new Error(message), { safeProbeMessage: message });
      }
    },
  });
  if (!metadata) throw Object.assign(new Error('Invalid probe'), { code: 'invalid_probe' });
  return metadata;
}
