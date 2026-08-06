import assert from "node:assert/strict";
import test from "node:test";

import { repairKnownMangaPanelCoverage } from "../app/manga-panel-mapping.mjs";

test("does not apply deleted project-specific manga migrations", () => {
  const input = {
    requestId: "new-project",
    shots: [{ id: "01", sourcePanels: ["P01-G01"] }],
  };
  assert.deepEqual(repairKnownMangaPanelCoverage(input), {
    result: input,
    repairedPanelIds: [],
    changed: false,
    changedShotIds: [],
    shotIdMap: {},
  });
});
