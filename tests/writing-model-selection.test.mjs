import assert from "node:assert/strict";
import test from "node:test";
import { legacyWritingModelIds, migratedWritingModelSelection } from "../server/writing-model-selection.mjs";

test("legacy GPT writing selections migrate to the matching JK API model", () => {
  const expected = new Map([
    ["codex-gpt-5.6-sol", "jk-gpt-5.6-sol"],
    ["gpt-5.6-sol", "jk-gpt-5.6-sol"],
    ["codex-gpt-5.6-luna", "jk-gpt-5.6-luna"],
    ["gpt-5.6-luna", "jk-gpt-5.6-luna"],
  ]);
  assert.deepEqual(new Set(legacyWritingModelIds()), new Set(expected.keys()));
  for (const [legacyId, nextId] of expected) {
    const result = migratedWritingModelSelection({ id: legacyId, provider: "codex" }, "2026-09-05T00:00:00.000Z");
    assert.equal(result.migrated, true);
    assert.deepEqual(result.selection, {
      id: nextId,
      provider: "jiekou-responses",
      updatedAt: "2026-09-05T00:00:00.000Z",
    });
  }
});

test("current API writing selections remain byte-for-byte eligible", () => {
  const saved = { id: "jk-gpt-5.6-sol", provider: "jiekou-responses", updatedAt: "kept" };
  const result = migratedWritingModelSelection(saved);
  assert.equal(result.migrated, false);
  assert.equal(result.selection, saved);
});
