import assert from "node:assert/strict";
import test from "node:test";

import {
  browserAgentRevision,
  browserDraftSnapshot,
  shouldApplyAgentDraft,
  shouldSurfaceMediaRecoveryFailure,
} from "../app/draft-sync-policy.mjs";

test("browser-authored saves never masquerade as a new Agent revision", () => {
  assert.equal(shouldApplyAgentDraft("", ""), false);
  assert.equal(shouldApplyAgentDraft("agent-1", "agent-1"), false);
  assert.equal(shouldApplyAgentDraft("agent-2", "agent-1"), true);
});

test("cross-tab browser snapshots retain the applied Agent revision", () => {
  const snapshot = browserDraftSnapshot({ reviews: [] }, "agent-7");
  assert.equal(browserAgentRevision(snapshot), "agent-7");
});

test("automatic latest-result misses stay silent while explicit recovery errors remain visible", () => {
  assert.equal(shouldSurfaceMediaRecoveryFailure({ directRequestId: "", recoverDraftUnderstandings: false }), false);
  assert.equal(shouldSurfaceMediaRecoveryFailure({ directRequestId: "request-1", recoverDraftUnderstandings: false }), true);
  assert.equal(shouldSurfaceMediaRecoveryFailure({ directRequestId: "", recoverDraftUnderstandings: true }), true);
});
