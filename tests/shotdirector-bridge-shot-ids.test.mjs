import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridgePath = new URL("../scripts/shotdirector-bridge.mjs", import.meta.url);

async function loadShotCanvasIndex() {
  const source = await readFile(bridgePath, "utf8");
  const start = source.indexOf("function shotCanvasIndex");
  const end = source.indexOf("const localVideoExtractorScript", start);
  assert.ok(start >= 0 && end > start, "bridge should expose the shot canvas helper");
  return Function(`${source.slice(start, end)}\nreturn shotCanvasIndex;`)();
}

test("numeric shots keep natural canvas cells and suffixes never collide", async () => {
  const shotCanvasIndex = await loadShotCanvasIndex();
  assert.equal(shotCanvasIndex("01"), 0);
  assert.equal(shotCanvasIndex("02"), 1);
  assert.notEqual(shotCanvasIndex("01A"), shotCanvasIndex("01B"));
  assert.notEqual(shotCanvasIndex("01A"), shotCanvasIndex("01"));
});

test("bridge validation requires fresh manga analyses to use sequential ids", async () => {
  const source = await readFile(bridgePath, "utf8");
  const validator = source.match(/function validateMediaAnalysisResult\(result, payload\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(validator, /result\.shots\.map\(\(_, index\) => String\(index \+ 1\)\.padStart\(2, "0"\)\)/);
  assert.doesNotMatch(validator, /knownMigratedShotIds/);
});
