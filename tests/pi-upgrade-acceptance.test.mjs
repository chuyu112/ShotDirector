import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runManjingAgentTurn } from "../runner/manjing-agent-runtime.mjs";
import { runPersistentManjingAgentTurn, ManjingHarnessStore } from "../runner/manjing-harness-store.mjs";
import { agentRoleContract } from "../runner/agent-role-contract.mjs";

/**
 * pi 升级验收测试（当前锁定 0.85.1）。
 *
 * 覆盖真实 AgentSession 的端到端路径：创作者带工具多轮、持久 Session
 * 恢复、Reviewer 隔离、memory 隔离。任何一层因 pi 版本变化而行为漂移
 * 都会在这里失败 —— 升 pi 版本后必须先跑这个文件。
 */

const PI_VERSION = (() => {
  const pkg = JSON.parse(readFileSync(new URL("../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url), "utf8"));
  return pkg.version;
})();

function recordingRunModel({ script } = {}) {
  const calls = [];
  const runModel = async ({ prompt }) => {
    calls.push(prompt);
    if (typeof script === "function") return script(prompt, calls.length);
    return "收到，已按真实项目状态完成本步，结果可验证。";
  };
  return { calls, runModel };
}

const echoTool = {
  name: "read_project_state",
  description: "读取项目真实状态（测试工具）",
  parameters: {
    type: "object",
    properties: { scope: { type: "string" } },
    required: ["scope"],
  },
  async execute(_toolCall, _ctx) {
    return { content: [{ type: "text", text: "shots: 2, approved: 1" }], isError: false };
  },
};

test(`pi ${PI_VERSION} 升级验收：创作者带工具执行并产出检查点`, async () => {
  const { calls, runModel } = recordingRunModel();
  const result = await runManjingAgentTurn({
    runId: "run-upgrade-creator",
    conversationId: "conv-upgrade",
    agentRole: "creator",
    prompt: "读取项目状态并总结进度",
    runModel,
    customTools: [echoTool],
  });
  assert.match(result.finalText, /收到/);
  assert.equal(result.harnessSessionId, "conv-upgrade");
  assert.ok(result.harnessCheckpoint.messages.length >= 2);
  assert.equal(result.harnessCheckpoint.messages.at(-1).role, "assistant");
  assert.ok(calls.length >= 1, "模型至少被调用一次");
});

test(`pi ${PI_VERSION} 升级验收：持久 Session 跨 Run 恢复创作者上下文`, async () => {
  const root = await mkdtemp(join(tmpdir(), "manjing-upgrade-"));
  try {
    const store = new ManjingHarnessStore(root);
    const first = await runPersistentManjingAgentTurn({
      store,
      job: { id: "run-upgrade-1", conversationId: "conv-upgrade-durable", agentRole: "creator", textModelId: "director-text" },
      prompt: "第一轮：项目里有两个 Shot，第一个已批准",
      runModel: async () => "第一轮完成，记住：第一个 Shot 已批准。",
    });
    assert.equal(first.harnessCheckpoint.baseStateVersion, 0);
    const second = await runPersistentManjingAgentTurn({
      store,
      job: { id: "run-upgrade-2", conversationId: "conv-upgrade-durable", agentRole: "creator", textModelId: "director-text" },
      prompt: "第二轮：上一轮我说了什么？",
      runModel: async ({ prompt }) => (prompt.includes("第一个 Shot 已批准") ? "恢复成功，上下文完整。" : "恢复失败"),
    });
    assert.match(second.finalText, /恢复成功/);
    assert.equal(second.harnessCheckpoint.baseStateVersion, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(`pi ${PI_VERSION} 升级验收：Reviewer 隔离——无历史、无工具、独立 Session`, async () => {
  const { calls, runModel } = recordingRunModel({
    script: (prompt) => (prompt.includes("创作者机密历史") ? "隔离失败：看到了创作者历史" : "审查完成：仅依据本次证据。"),
  });
  const seenEvents = [];
  const result = await runManjingAgentTurn({
    runId: "run-upgrade-review",
    conversationId: "conv-upgrade-durable",
    agentRole: "review",
    prompt: "审查本次提交。注意：上一轮我说了什么？",
    runModel,
    conversationHistory: [
      { role: "user", content: "创作者机密历史" },
      { role: "assistant", content: "第一个 Shot 已批准" },
    ],
    customTools: [echoTool],
    onHarnessEvent: (event) => seenEvents.push(event),
  });
  assert.equal(result.harnessSessionId, "conv-upgrade-durable.review.run-upgrade-review");
  assert.match(result.finalText, /审查完成/);
  const opened = seenEvents.find((event) => event.eventType === "manjing.session.opened");
  assert.equal(opened.payload.toolNames.length, 0, "Reviewer 不得注册自定义工具");
  assert.equal(opened.payload.restoredMessageCount, 0, "Reviewer 不得恢复历史");
  assert.equal(opened.payload.isolatedReview, true);
});

test(`pi ${PI_VERSION} 升级验收：memory 角色契约为隔离且不持久化`, () => {
  const contract = agentRoleContract("memory");
  assert.equal(contract.isolatedSession, true);
  assert.equal(contract.durableSession, false);
  assert.equal(contract.allowCustomTools, false);
  assert.equal(contract.allowCompaction, false);
});
