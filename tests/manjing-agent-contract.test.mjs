import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHumanLocksPreserved,
  assertStrictReviewRequest,
  buildManjingAgentContract,
  validateManjingAgentState,
} from "../app/manjing-agent-contract.mjs";

function manifest() {
  return {
    project: { projectUid: "project-alpha123", title: "测试漫画" },
    shots: [
      {
        shotUid: "shot-alpha001",
        displayNumber: "01",
        title: "走廊",
        sourcePanels: ["P01-G01", "P01-G02"],
        sourceRevision: "revision-1",
        approved: true,
        approvedAt: "2026-08-28T00:00:00.000Z",
      },
      {
        shotUid: "shot-alpha002",
        displayNumber: "02",
        title: "卧室",
        sourcePanels: ["P01-G03"],
        approved: false,
      },
    ],
  };
}

test("agent contract exposes stable ids, human locks and validate-last sequence", () => {
  const state = buildManjingAgentContract(manifest());
  assert.deepEqual(state.requiredSequence, ["read-state", "propose", "apply", "validate"]);
  assert.equal(state.shots[0].humanLocked, true);
  assert.match(state.shots[0].lockDigest, /^lock-/);
  assert.deepEqual(state.validation.issues, []);
});

test("human lock guard rejects silent edits but accepts an explicit unlock", () => {
  const previous = buildManjingAgentContract(manifest());
  const next = structuredClone(previous);
  next.shots[0].title = "被 Agent 静默修改";
  assert.throws(() => assertHumanLocksPreserved(previous, next), /不能修改人工锁定/);
  assert.equal(assertHumanLocksPreserved(previous, next, {
    explicitlyUnlockedShotUids: ["shot-alpha001"],
  }), true);
});

test("validation catches duplicate source panels", () => {
  const state = buildManjingAgentContract(manifest());
  state.shots[1].sourcePanels.push("P01-G01");
  assert.match(validateManjingAgentState(state).join("\n"), /重复引用/);
});

test("strict reviewer accepts only read-only strict-review requests", () => {
  assert.equal(assertStrictReviewRequest({ operationMode: "strict-review", completePrompt: "只读快照" }), true);
  assert.throws(() => assertStrictReviewRequest({ operationMode: "creator" }), /strict-review/);
  for (const field of ["approved", "apply", "replacementPrompt", "shotPatch"]) {
    assert.throws(
      () => assertStrictReviewRequest({ operationMode: "strict-review", [field]: false }),
      new RegExp(field),
    );
  }
});
