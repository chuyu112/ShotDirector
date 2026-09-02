import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

test("review policy cannot edit or approve", () => {
  assert.match(manjingAgentPolicies.review, /只能指出问题、证据和修改建议/);
  assert.match(manjingAgentPolicies.review, /禁止改写原提示词/);
  assert.match(manjingAgentPolicies.review, /替用户批准 Shot/);
});

