import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_ROLE_CONTRACT,
  AGENT_ROLES,
  agentRoleContract,
  normalizeAgentRole,
} from "../runner/agent-role-contract.mjs";
import { manjingAgentPolicies } from "../runner/manjing-agent-runtime.mjs";
import { manjingHarnessSessionId } from "../runner/manjing-pi-harness.mjs";

test("角色契约覆盖全部角色且隔离不变量成立", () => {
  assert.deepEqual(AGENT_ROLES, ["creator", "review", "memory"]);
  for (const role of AGENT_ROLES) {
    const contract = AGENT_ROLE_CONTRACT[role];
    assert.ok(contract, `${role} 缺少契约`);
    assert.equal(typeof contract.systemPolicy, "string");
    assert.ok(contract.systemPolicy.length > 50, `${role} 系统策略为空`);
    for (const key of [
      "isolatedSession",
      "inheritConversationHistory",
      "allowCustomTools",
      "allowCompaction",
      "durableSession",
    ]) {
      assert.equal(typeof contract[key], "boolean", `${role}.${key} 必须是布尔`);
    }
  }
  // 隔离角色安全不变量：不继承历史、无工具、无压缩、不持久化。
  for (const role of ["review", "memory"]) {
    const contract = AGENT_ROLE_CONTRACT[role];
    assert.equal(contract.isolatedSession, true, `${role} 必须是隔离 Session`);
    assert.equal(contract.inheritConversationHistory, false, `${role} 不得继承历史`);
    assert.equal(contract.allowCustomTools, false, `${role} 不得注册自定义工具`);
    assert.equal(contract.allowCompaction, false, `${role} 不得做上下文压缩`);
    assert.equal(contract.durableSession, false, `${role} 不得产生持久 Session`);
  }
  // creator 是唯一全能力角色。
  assert.deepEqual(
    {
      isolatedSession: AGENT_ROLE_CONTRACT.creator.isolatedSession,
      inheritConversationHistory: AGENT_ROLE_CONTRACT.creator.inheritConversationHistory,
      allowCustomTools: AGENT_ROLE_CONTRACT.creator.allowCustomTools,
      allowCompaction: AGENT_ROLE_CONTRACT.creator.allowCompaction,
      durableSession: AGENT_ROLE_CONTRACT.creator.durableSession,
    },
    {
      isolatedSession: false,
      inheritConversationHistory: true,
      allowCustomTools: true,
      allowCompaction: true,
      durableSession: true,
    },
  );
});

test("未知角色回落 creator，契约对象冻结", () => {
  assert.equal(normalizeAgentRole("review"), "review");
  assert.equal(normalizeAgentRole("memory"), "memory");
  for (const value of ["creator", undefined, null, "", "admin", "SUPERADMIN"]) {
    assert.equal(normalizeAgentRole(value), "creator", `${String(value)} 应回落 creator`);
    assert.equal(agentRoleContract(value), AGENT_ROLE_CONTRACT.creator);
  }
  assert.equal(normalizeAgentRole("review"), "review");
  assert.equal(agentRoleContract("review"), AGENT_ROLE_CONTRACT.review);
  assert.ok(Object.isFrozen(AGENT_ROLE_CONTRACT));
  assert.ok(Object.isFrozen(AGENT_ROLE_CONTRACT.review));
});

test("运行时导出的系统策略与角色契约一致", () => {
  for (const role of AGENT_ROLES) {
    assert.equal(manjingAgentPolicies[role], AGENT_ROLE_CONTRACT[role].systemPolicy);
  }
  assert.match(manjingAgentPolicies.review, /只能指出问题、证据和修改建议/);
  assert.match(manjingAgentPolicies.review, /禁止改写原提示词/);
  assert.match(manjingAgentPolicies.memory, /不得创作镜头/);
});

test("隔离角色的 Session ID 带角色后缀，creator 保持原会话 ID", () => {
  const base = { id: "run-1", conversationId: "conv-1" };
  assert.equal(manjingHarnessSessionId({ ...base, agentRole: "review" }), "conv-1.review.run-1");
  assert.equal(manjingHarnessSessionId({ ...base, agentRole: "memory" }), "conv-1.memory.run-1");
  assert.equal(manjingHarnessSessionId({ ...base, agentRole: "creator" }), "conv-1");
  // 未知角色不得伪装成隔离角色拿到隔离命名空间。
  assert.equal(manjingHarnessSessionId({ ...base, agentRole: " Review " }), "conv-1");
});
