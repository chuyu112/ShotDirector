import {
  MANJING_PI_HARNESS_VERSION,
  createManjingPiHarnessCheckpoint,
  createManjingPiHarnessSession,
  visibleMessageText,
} from "./manjing-pi-harness.mjs";
import { AGENT_ROLE_CONTRACT, agentRoleContract, normalizeAgentRole } from "./agent-role-contract.mjs";

function systemPolicyFor(agentRole) {
  return agentRoleContract(agentRole).systemPolicy;
}

function abortCause(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The operation was aborted", "AbortError");
}

function finalAssistantText(messages) {
  const message = [...messages].reverse().find((item) => item?.role === "assistant");
  return visibleMessageText(message).trim();
}

function normalizedJob({
  job,
  agentRole,
  modelId,
  prompt,
  conversationId,
  runId,
  conversationHistory,
  harnessSession,
  responseMode,
}) {
  const id = String(job?.id || runId || `run-${crypto.randomUUID()}`);
  const role = normalizeAgentRole(job?.agentRole || agentRole);
  return {
    ...(job || {}),
    id,
    conversationId: String(
      job?.conversationId || conversationId || `conversation-${id}`,
    ),
    agentRole: role,
    modelId: String(job?.modelId || modelId || "director-text"),
    textModelId: String(job?.textModelId || job?.modelId || modelId || "director-text"),
    responseMode: job?.responseMode || responseMode || "reasoning",
    conversationHistory: Array.isArray(job?.conversationHistory)
      ? job.conversationHistory
      : Array.isArray(conversationHistory)
        ? conversationHistory
        : [],
    ...(harnessSession || job?.harnessSession
      ? { harnessSession: harnessSession || job.harnessSession }
      : {}),
    prompt,
  };
}

/**
 * Run one 漫镜 turn through the mature Pi AgentSession harness.
 *
 * The provider stays replaceable through `runModel`; Pi owns Session state,
 * tool loops, cancellation, steering/follow-up queues, compaction and events.
 * Callers may pass a durable checkpoint to resume a creator Session. Review
 * always receives an isolated per-Run Session and never inherits creator state.
 */
export async function runManjingAgentTurn({
  job,
  agentRole = "creator",
  modelId = "director-text",
  prompt,
  runModel,
  signal,
  conversationId,
  runId,
  conversationHistory = [],
  harnessSession,
  responseMode = "reasoning",
  onHarnessEvent,
  driveSession,
  customTools = [],
  createHarnessSession = createManjingPiHarnessSession,
}) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("缺少 Agent 提示词");
  if (typeof runModel !== "function") throw new TypeError("缺少本地模型执行器");
  if (typeof createHarnessSession !== "function") throw new TypeError("createHarnessSession 必须是函数");
  if (signal?.aborted) throw abortCause(signal);

  const task = normalizedJob({
    job,
    agentRole,
    modelId,
    prompt: prompt.trim(),
    conversationId,
    runId,
    conversationHistory,
    harnessSession,
    responseMode,
  });
  const systemPrompt = systemPolicyFor(task.agentRole);
  let harness;
  let removeAbortListener = () => {};

  try {
    harness = await createHarnessSession({
      job: task,
      systemPrompt,
      onHarnessEvent,
      customTools,
      runModel: (input) => runModel({
        ...input,
        agentRole: task.agentRole,
        modelId: task.textModelId,
        systemPrompt,
        originalPrompt: task.prompt,
      }),
    });
    if (!harness?.session || typeof harness.session.prompt !== "function" || !harness.session.state) {
      throw new TypeError("Pi AgentSession 初始化失败");
    }

    if (signal) {
      const abort = () => void harness.session.abort?.();
      signal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", abort);
    }

    const deliveredInputs = typeof driveSession === "function"
      ? await driveSession({ session: harness.session, prompt: task.prompt, signal })
      : (await harness.session.prompt(task.prompt, {
          expandPromptTemplates: false,
          source: "sdk",
        }), []);

    if (signal?.aborted) throw abortCause(signal);
    if (harness.runFailure) throw harness.runFailure;
    const finalText = finalAssistantText(harness.session.state.messages);
    if (!finalText) throw new Error("Agent 没有返回可用内容");

    const harnessCheckpoint = createManjingPiHarnessCheckpoint(
      task,
      finalText,
      deliveredInputs,
      harness.checkpointCompaction?.() || null,
    );
    harness.finish("completed");
    return {
      finalText,
      agentRole: task.agentRole,
      modelId: task.textModelId,
      runId: task.id,
      conversationId: task.conversationId,
      harnessVersion: MANJING_PI_HARNESS_VERSION,
      harnessSessionId: harness.sessionId,
      harnessEvents: [...harness.events],
      harnessCheckpoint,
      deliveredInputs,
    };
  } catch (error) {
    const aborted = signal?.aborted || error?.name === "AbortError";
    if (harness?.session?.isStreaming) {
      await harness.session.abort?.().catch?.(() => undefined);
    }
    harness?.finish(aborted ? "aborted" : "failed", {
      publicMessage: aborted ? "Agent 已取消" : "Agent 执行失败",
    });
    throw error;
  } finally {
    removeAbortListener();
    harness?.dispose?.();
  }
}

export const manjingAgentPolicies = Object.freeze({
  creator: AGENT_ROLE_CONTRACT.creator.systemPolicy,
  review: AGENT_ROLE_CONTRACT.review.systemPolicy,
  memory: AGENT_ROLE_CONTRACT.memory.systemPolicy,
});
