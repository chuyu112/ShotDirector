import test from "node:test";
import assert from "node:assert/strict";
import { planPanelDrop } from "../app/panel-drag-grouping.mjs";

const groups = [["a", "b", "c"], ["d", "e", "f"], ["g", "h"]];
const panels = (plan) => plan.groups.map((group) => group.panelIds);

test("cross-Shot drops always append, independent of the card hit position", () => {
  for (const panelId of [undefined, "a", "b", "c"]) {
    for (const position of ["before", "after", "end"]) {
      assert.deepEqual(panels(planPanelDrop(groups, ["e", "d"], { reviewIndex: 0, panelId, position })),
        [["a", "b", "c", "d", "e"], ["f"], ["g", "h"]]);
    }
  }
  for (const panelId of [undefined, "d", "e", "f"]) {
    assert.deepEqual(panels(planPanelDrop(groups, ["c", "b"], { reviewIndex: 1, panelId, position: "after" })),
      [["a"], ["d", "e", "f", "b", "c"], ["g", "h"]]);
  }
});

test("multi-source selection merges deterministically, including selected target cards", () => {
  assert.deepEqual(panels(planPanelDrop(groups, ["g", "e", "b"], { reviewIndex: 1, panelId: "e", position: "after" })),
    [["a", "c"], ["d", "e", "f", "b", "g"], ["h"]]);
});

test("same-Shot drops never reorder panels", () => {
  assert.equal(planPanelDrop(groups, ["a"], { reviewIndex: 0, panelId: "b", position: "after" }), null);
  assert.equal(planPanelDrop(groups, ["a"], { reviewIndex: 0, panelId: "a", position: "after" }), null);
});

test("new Shots can be inserted at every boundary without losing or duplicating panels", () => {
  for (let index = 0; index <= groups.length; index++) {
    const plan = planPanelDrop(groups, ["e"], { createShotAt: index });
    assert.equal(plan.targetIndex, index);
    assert.deepEqual(plan.groups[index], { originIndex: -1, panelIds: ["e"] });
    assert.deepEqual(panels(plan).flat().sort(), groups.flat().sort());
  }
  const plan = planPanelDrop(groups, ["d", "e", "f"], { createShotAt: 3 });
  assert.deepEqual(panels(plan), [["a", "b", "c"], ["g", "h"], ["d", "e", "f"]]);
  assert.equal(plan.targetIndex, 2);
});

test("empty source Shots are removed and target index follows the surviving group", () => {
  const plan = planPanelDrop(groups, ["a", "b", "c"], { reviewIndex: 1, position: "end" });
  assert.deepEqual(panels(plan), [["d", "e", "f", "a", "b", "c"], ["g", "h"]]);
  assert.equal(plan.targetIndex, 0);
});

test("invalid/no-op drops do not mutate original groups", () => {
  const snapshot = structuredClone(groups);
  for (const target of [{ createShotAt: -1 }, { createShotAt: 4 }, { createShotAt: 1.5 }, { reviewIndex: 9 }]) {
    assert.equal(planPanelDrop(groups, ["a"], target), null);
  }
  assert.equal(planPanelDrop(groups, ["unknown"], { reviewIndex: 0 }), null);
  assert.equal(planPanelDrop(groups, groups[0], { createShotAt: 0 }), null);
  assert.deepEqual(groups, snapshot);
});
