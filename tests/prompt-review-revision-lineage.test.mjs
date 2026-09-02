import assert from "node:assert/strict";
import test from "node:test";

import { buildPromptReviewRevision } from "../app/video-package.ts";

const baseReviewRevisionInput = {
  shotId: "01",
  completePrompt: "A stable complete prompt",
  completePromptSourceRevision: "complete-source-v1",
  reviewerId: "kimi-k3",
};

test("prompt review revision is bound to the complete prompt generator", () => {
  const glmRevision = buildPromptReviewRevision({
    ...baseReviewRevisionInput,
    completePromptGeneratorId: "glm-5.3-flash",
  });
  const kimiRevision = buildPromptReviewRevision({
    ...baseReviewRevisionInput,
    completePromptGeneratorId: "k3",
  });
  const legacyRevision = buildPromptReviewRevision({
    ...baseReviewRevisionInput,
    completePromptGeneratorId: "legacy-unknown",
  });

  assert.notEqual(glmRevision, kimiRevision);
  assert.notEqual(glmRevision, legacyRevision);
  assert.notEqual(kimiRevision, legacyRevision);
  assert.equal(glmRevision, buildPromptReviewRevision({
    ...baseReviewRevisionInput,
    completePromptGeneratorId: "glm-5.3-flash",
  }));
});

