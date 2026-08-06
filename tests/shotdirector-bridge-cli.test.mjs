import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridgePath = new URL("../scripts/shotdirector-bridge.mjs", import.meta.url);
const mediaSchemaPath = new URL("../scripts/media-analysis.schema.json", import.meta.url);

test("bridge allows Codex tasks in source migration packages without git history", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /"--skip-git-repo-check"/);
});

test("media analysis schema does not combine $ref with sibling keywords", async () => {
  const schema = JSON.parse(await readFile(mediaSchemaPath, "utf8"));
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && Object.hasOwn(value, "$ref")) {
      assert.deepEqual(Object.keys(value), ["$ref"]);
    }
    Object.values(value).forEach(visit);
  };
  visit(schema);
});
