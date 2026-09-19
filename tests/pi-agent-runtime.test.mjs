import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  manjingAgentPolicies,
  runManjingAgentTurn,
} from "../runner/manjing-agent-runtime.mjs";
import {
  ManjingHarnessStore,
  runPersistentManjingAgentTurn,
} from "../runner/manjing-harness-store.mjs";
import { MANJING_PI_HARNESS_VERSION } from "../runner/manjing-pi-harness.mjs";

test("creator and reviewer run through mature Pi AgentSession with isolated roles", async () => {
  const contexts = [];
  const creator = await runManjingAgentTurn({
    agentRole: "creator",
    conversationId: "conversation-creator",
    runId: "run-creator",
    prompt: "生成 Shot 01 讨论稿",
    runModel: ({ context, systemPrompt }) => {
      contexts.push({ role: "creator", context, systemPrompt });
      return '{"status":"completed","prompt":"draft"}';
    },
  });
  const reviewer = await runManjingAgentTurn({
    agentRole: "review",
    conversationId: "conversation-creator",
    runId: "run-review",
    prompt: "审查 Shot 01 讨论稿",
    conversationHistory: [{ role: "user", content: "生成器私有历史" }],
    runModel: ({ context, systemPrompt }) => {
      contexts.push({ role: "review", context, systemPrompt });
      return '{"status":"completed","report":"review"}';
    },
  });

  assert.equal(contexts.length, 2);
  assert.match(contexts[0].systemPrompt, /漫镜当前任务专用的创作 Agent/);
  assert.match(contexts[1].systemPrompt, /独立 Reviewer Agent/);
  assert.match(contexts[1].systemPrompt, /禁止改写原提示词/);
  assert.doesNotMatch(JSON.stringify(contexts[1].context), /生成器私有历史/);
  assert.equal(creator.harnessVersion, MANJING_PI_HARNESS_VERSION);
  assert.equal(creator.harnessSessionId, "conversation-creator");
  assert.match(reviewer.harnessSessionId, /^conversation-creator\.review\.run-review$/);
  assert.equal(creator.harnessEvents[0].eventType, "manjing.session.opened");
  assert.equal(creator.harnessEvents.at(-1).eventType, "manjing.session.closed");
  assert.equal(reviewer.agentRole, "review");
});

test("durable local Harness restores creator context and records Run/event/checkpoint state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "manjing-harness-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ManjingHarnessStore(root);
  const first = await runPersistentManjingAgentTurn({
    store,
    job: {
      id: "run-1",
      conversationId: "project-alpha-shot-01",
      agentRole: "creator",
      modelId: "gpt-5.6-sol",
    },
    prompt: "先记住 Shot 01 是夜景。",
    runModel: () => "已记录：Shot 01 是夜景。",
  });
  let providerPrompt = "";
  const second = await runPersistentManjingAgentTurn({
    store,
    job: {
      id: "run-2",
      conversationId: "project-alpha-shot-01",
      agentRole: "creator",
      modelId: "gpt-5.6-sol",
    },
    prompt: "继续生成镜头提示词。",
    runModel: ({ prompt }) => {
      providerPrompt = prompt;
      return "夜景镜头提示词讨论稿。";
    },
  });

  assert.match(providerPrompt, /Shot 01 是夜景/);
  assert.equal(first.harnessCheckpoint.baseStateVersion, 0);
  assert.equal(second.harnessCheckpoint.baseStateVersion, 1);
  const status = await store.status();
  assert.equal(status.harnessVersion, MANJING_PI_HARNESS_VERSION);
  assert.equal(status.runs.length, 2);
  assert.equal(status.runs.every((run) => run.status === "completed"), true);
  const ledger = await readFile(join(root, "events.jsonl"), "utf8");
  assert.match(ledger, /"eventType":"pi\.turn_start"/);
  assert.match(ledger, /"eventType":"manjing\.session\.closed"/);
});

test("Harness persists an accepted asynchronous review Run before model execution", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "manjing-harness-queued-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ManjingHarnessStore(root);
  const job = {
    id: "run-11111111-2222-4333-8444-555555555555",
    conversationId: "manjing-review-11111111-2222-4333-8444-555555555555",
    agentRole: "review",
    modelId: "claude-opus-5",
    kind: "prompt-review",
  };

  const queued = await store.queueRun(job, {
    requestId: "11111111-2222-4333-8444-555555555555",
    projectUid: "project-alpha",
    shotUid: "shot-alpha",
    sourceRevision: "review-revision-1",
  });
  assert.equal(queued.status, "queued");
  assert.match(queued.sessionId, /\.review\.run-/);
  assert.deepEqual(await store.getRun(job.id), queued);

  const running = await store.beginRun(job);
  assert.equal(running.status, "running");
  assert.equal(running.requestId, queued.requestId);
  assert.equal(running.sourceRevision, queued.sourceRevision);
});

test("review policy cannot edit or approve", () => {
  assert.match(manjingAgentPolicies.review, /只能指出问题、证据和修改建议/);
  assert.match(manjingAgentPolicies.review, /禁止改写原提示词/);
  assert.match(manjingAgentPolicies.review, /替用户批准 Shot/);
});

for (const role of ['review', 'memory']) test(`${role} 保留 Run 与事件，但不加载或写入持久会话`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'manjing-isolated-role-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ManjingHarnessStore(root);
  store.loadSession = async () => assert.fail('隔离角色不得读取持久会话');
  store.saveCheckpoint = async () => assert.fail('隔离角色不得写入持久会话');
  const job = { id: `run-${role}-isolated`, conversationId: 'shared-conversation', agentRole: role };
  const result = await runPersistentManjingAgentTurn({
    store, job, prompt: '只检查本次证据',
    conversationHistory: [{ role: 'user', content: 'PRIVATE_CREATOR_HISTORY' }],
    runModel: async ({ prompt }) => {
      assert.doesNotMatch(prompt, /PRIVATE_CREATOR_HISTORY/);
      return '检查完成';
    },
  });
  assert.equal(result.finalText, '检查完成');
  const run = await store.getRun(job.id);
  assert.equal(run.status, 'completed');
  assert.ok(run.eventCount > 0);
  assert.equal(Object.hasOwn(run, 'checkpointStateVersion'), false);
  const paths = await readdir(root);
  assert.equal(paths.includes('sessions'), false);
  assert.equal(paths.includes('history'), false);
  assert.match(await readFile(store.eventsPath, 'utf8'), /manjing\.session\.closed/);
});

test("transient empty runModel result is retried and then succeeds", async () => {
  let calls = 0;
  const result = await runManjingAgentTurn({
    agentRole: "creator",
    conversationId: "conversation-empty-retry",
    runId: "run-empty-retry",
    prompt: "生成 Shot 02 讨论稿",
    runModel: () => {
      calls += 1;
      return calls < 2 ? "   " : '{"status":"completed","prompt":"draft"}';
    },
  });
  assert.equal(calls, 2);
  assert.match(result.harnessSessionId, /^conversation-empty-retry/);
});

test("persistent empty runModel result fails after bounded retries", async () => {
  let calls = 0;
  await assert.rejects(
    runManjingAgentTurn({
      agentRole: "creator",
      conversationId: "conversation-empty-always",
      runId: "run-empty-always",
      prompt: "生成 Shot 03 讨论稿",
      runModel: () => {
        calls += 1;
        return "";
      },
    }),
    /runModel 必须返回正文或工具调用/,
  );
  assert.equal(calls, 3);
});
