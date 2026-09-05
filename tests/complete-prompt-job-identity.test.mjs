import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  completePromptIdentity,
  completePromptIdentityFromPayload,
  completePromptJobKey,
  completePromptResultMatches,
} from "../scripts/complete-prompt-job-identity.mjs";

const bridgePath = new URL("../scripts/shotdirector-bridge.mjs", import.meta.url);

test("complete prompt key follows stable project and shot UIDs across display renumbering", () => {
  const original = completePromptIdentity({
    projectUid: "project-uid-1",
    shotUid: "shot-uid-5",
    shotId: "SHOT 05",
    sourceRevision: "revision-a",
  });
  const renumbered = completePromptIdentity({
    projectUid: "project-uid-1",
    shotUid: "shot-uid-5",
    shotId: "SHOT 06",
    sourceRevision: "revision-a",
  });

  assert.equal(completePromptJobKey(original), completePromptJobKey(renumbered));
});

test("complete prompt jobs are isolated by project, stable shot, and source revision", () => {
  const base = completePromptIdentity({
    projectUid: "project-uid-1",
    shotUid: "shot-uid-5",
    shotId: "SHOT 05",
    sourceRevision: "revision-a",
  });
  const identities = [
    completePromptIdentity({ ...base, projectUid: "project-uid-2" }),
    completePromptIdentity({ ...base, shotUid: "shot-uid-6" }),
    completePromptIdentity({ ...base, sourceRevision: "revision-b" }),
  ];

  for (const identity of identities) {
    assert.notEqual(completePromptJobKey(base), completePromptJobKey(identity));
  }
});

test("display shot id is used only as a fallback when no stable shot UID exists", () => {
  const identity = completePromptIdentity({
    projectUid: "project-uid-1",
    shotId: "SHOT 05",
    sourceRevision: "revision-a",
  });
  assert.equal(
    completePromptJobKey(identity),
    JSON.stringify(["project-uid-1", "SHOT 05", "revision-a"]),
  );
});

test("payload identity reads the stable UID from the shot", () => {
  assert.deepEqual(
    completePromptIdentityFromPayload({
      projectUid: "project-uid-1",
      sourceRevision: "revision-a",
      shot: { shotUid: "shot-uid-5", id: "SHOT 05" },
    }),
    {
      projectUid: "project-uid-1",
      shotUid: "shot-uid-5",
      shotId: "SHOT 05",
      sourceRevision: "revision-a",
    },
  );
});

test("complete prompt recovery requires exact stable identity and rejects legacy UID-less results", () => {
  const identity = completePromptIdentity({
    projectUid: "project-uid-1",
    shotUid: "shot-uid-5",
    shotId: "SHOT 05",
    sourceRevision: "revision-a",
  });
  const exact = { ...identity, status: "completed", prompt: "prompt" };

  assert.equal(completePromptResultMatches(exact, identity), true);
  assert.equal(completePromptResultMatches({ ...exact, projectUid: "project-uid-2" }, identity), false);
  assert.equal(completePromptResultMatches({ ...exact, shotUid: "shot-uid-6" }, identity), false);
  assert.equal(completePromptResultMatches({ ...exact, sourceRevision: "revision-b" }, identity), false);
  assert.equal(completePromptResultMatches({ shotId: "SHOT 05", sourceRevision: "revision-a" }, identity), false);
});

test("stable recovery identity rejects ambiguous requests", () => {
  for (const input of [
    { shotUid: "shot-uid-5", sourceRevision: "revision-a" },
    { projectUid: "project-uid-1", sourceRevision: "revision-a" },
    { projectUid: "project-uid-1", shotUid: "shot-uid-5" },
  ]) {
    assert.throws(
      () => completePromptIdentity(input),
      (error) => error instanceof Error && error.statusCode === 400,
    );
  }
});

test("bridge shares the five-Shot queue while binding each task to its submission-time model", async () => {
  const source = await readFile(bridgePath, "utf8");

  assert.match(source, /return withCompletePromptJob\(identity,/);
  assert.doesNotMatch(source, /withJob\("complete-shot-prompt"/);
  assert.match(source, /return withCompletePromptJob\(completePromptIdentityFromPayload\(payload\)/);
  assert.match(source, /shotWorkScheduler\.run\(job/);
  assert.doesNotMatch(source, /return withJob\("prompt-review"/);
  assert.match(source, /promptJobs:\s*\[\.\.\.activeCompletePromptJobs\.values\(\)\]/);
  assert.match(source, /lastPromptJobs:\s*\[\.\.\.lastCompletePromptJobs\.values\(\)\]/);
  assert.match(
    source,
    /function hasActiveWritingModelWork\(\)[\s\S]*?shuttingDown[\s\S]*?activeCompletePromptJobs\.size[\s\S]*?activeArtworkJobs\.size[\s\S]*?activeAssetJobs\.size[\s\S]*?activeMediaJobs\.size[\s\S]*?libtvLoginPromise/,
  );
  assert.match(source, /busy:\s*hasActiveWritingModelWork\(\)/);
  assert.doesNotMatch(source, /if \(hasActiveWritingModelWork\(\)\)[\s\S]*?完成后再切换/);
  assert.match(source, /const shotWorkScheduler = new ShotWorkScheduler\(\)/);
  assert.match(source, /const writingModelTaskContext = new AsyncLocalStorage\(\)/);
  assert.match(source, /const taskRuntime = writingRuntimeContext\(\);[\s\S]*?writingModelTaskContext\.run\(taskRuntime/);
  assert.match(source, /shotWorkScheduler\.run\(job, \(\) => writingModelTaskContext\.run\(taskRuntime/);
  assert.match(source, /writingModelId: taskRuntime\.selectionId, writingModelLabel: taskRuntime\.label/);
  assert.match(source, /Chat \/ Work 模型已变化，请按当前模型重新提交/);
  assert.match(source, /reviewer\.runtimeProvider\.generate\(/);
  assert.doesNotMatch(source, /CODEX_HOME|codex-cli/);
});
