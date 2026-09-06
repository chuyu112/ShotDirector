import assert from "node:assert/strict";
import test from "node:test";

import {
  activeShotWorkJob,
  latestTerminalShotWorkJob,
  matchesShotWorkJob,
} from "../app/shot-work-reconciliation.mjs";

const identity = { projectUid: "project-a", shotUid: "shot-a", shotId: "01" };

test("Shot work reconciliation uses project and stable Shot identity", () => {
  assert.equal(matchesShotWorkJob({ projectUid: "project-a", shotUid: "shot-a", shotId: "99" }, identity), true);
  assert.equal(matchesShotWorkJob({ projectUid: "project-b", shotUid: "shot-a", shotId: "01" }, identity), false);
  assert.equal(matchesShotWorkJob({ projectUid: "project-a", shotUid: "shot-b", shotId: "01" }, identity), false);
});

test("queued and running tasks are both active", () => {
  const jobs = [
    { ...identity, type: "complete-shot-prompt", status: "queued" },
    { ...identity, type: "prompt-review", status: "running" },
  ];
  assert.equal(activeShotWorkJob(jobs, identity, "complete-shot-prompt"), jobs[0]);
  assert.equal(activeShotWorkJob(jobs, identity, "prompt-review"), jobs[1]);
  assert.equal(activeShotWorkJob(jobs, identity, "prompt-review", (job) => job.status === "queued"), undefined);
});

test("latest terminal result wins across tabs and earlier model versions", () => {
  const older = { ...identity, type: "complete-shot-prompt", status: "completed", finishedAt: "2026-09-06T10:00:00Z", sourceRevision: "model-a" };
  const newer = { ...identity, type: "complete-shot-prompt", status: "completed", finishedAt: "2026-09-06T11:00:00Z", sourceRevision: "model-b" };
  assert.equal(latestTerminalShotWorkJob([older, newer], identity, "complete-shot-prompt"), newer);
});
