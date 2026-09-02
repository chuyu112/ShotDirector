import test from "node:test";
import assert from "node:assert/strict";
import { buildMangaReadingOrder, correctMangaReviewOrder, normalizeMangaAnalysisReadingOrder, orderPanelIds } from "../app/manga-reading-order.mjs";

const panel = (id, x, y, width, height) => ({ id, bounds: { x, y, width, height } });
const right = [
  panel("P02-R-G01", 50.1, 0, 23.2, 32.2), // photos (old ID order is wrong)
  panel("P02-R-G02", 73.8, 0, 21.4, 32.2), // man
  panel("P02-R-G03", 50.1, 33.5, 45.1, 15.5),
  panel("P02-R-G04", 50.1, 50.4, 32.1, 49.6), // existing compound crop stays intact
  panel("P02-R-G05", 82.5, 50.4, 12.7, 18.5),
  panel("P02-R-G06", 82.5, 69.1, 12.7, 30.9),
];
const left = [panel("P02-L-G01", 5, 0, 43, 30), panel("P02-L-G02", 5, 32, 43, 65)];
const page = { scanIndex: 2, layout: "double-page", panels: [...right, ...left] };
const expected = ["P02-R-G02", "P02-R-G01", "P02-R-G03", "P02-R-G05", "P02-R-G06", "P02-R-G04", ...left.map(p => p.id)];

test("Japanese scan: right leaf first, rows top down, nested right column before left", () => {
  const before = structuredClone(page);
  const result = buildMangaReadingOrder([page]);
  assert.deepEqual(result.panelIds, expected);
  assert.equal(result.issues.length, 0);
  assert.deepEqual(page, before, "does not recrop, mutate bounds or rename IDs");
});
test("LTR selection is respected; page sequence is never globally reversed", () => {
  const first = { scanIndex: 1, layout: "single-page", panels: [panel("P01-G01", 0, 0, 100, 100)] };
  const result = buildMangaReadingOrder([page, first], "left-to-right");
  assert.deepEqual(result.panelIds, ["P01-G01", ...left.map(p => p.id), ...right.map(p => p.id)]);
});
test("tall right panel precedes the stacked panels on its left", () => {
  const p = { scanIndex: 1, layout: "single-page", panels: [panel("top", 0, 0, 40, 40), panel("bottom", 0, 45, 40, 55), panel("tall", 42, 0, 50, 100)] };
  assert.deepEqual(buildMangaReadingOrder([p]).panelIds, ["tall", "top", "bottom"]);
});
test("genuine overlapping panels are flagged, not guessed or dropped", () => {
  const p = { scanIndex: 1, layout: "single-page", panels: [panel("a", 0, 0, 60, 70), panel("b", 30, 40, 65, 60)] };
  assert.equal(buildMangaReadingOrder([p]).issues.length, 1);
  assert.deepEqual(buildMangaReadingOrder([p]).panelIds, ["a", "b"]);
  assert.deepEqual(orderPanelIds(["manual", "b", "a"], ["a", "b"]), ["manual", "b", "a"]);
});
test("an unresolved region nested inside a cut retains original order", () => {
  const panels = [panel("right", 32, 0, 25, 60), panel("middle", 20, 17, 15, 45), panel("left", 0, 0, 34, 47), panel("wide", 0, 53, 50, 17), panel("bottom", 0, 73, 60, 25)];
  const order = buildMangaReadingOrder([{ scanIndex: 1, layout: "single-page", panels }]);
  assert.ok(order.issues.length);
  assert.deepEqual(order.panelIds, panels.map(p => p.id));
});
test("review correction changes only order, stales old prompt, preserves groups and artifacts", () => {
  const reviews = [{ shot: { id: "01", shotUid: "keep", duration: 30, sourcePanels: right.map(p => p.id) }, annotations: { story: "keep" }, completePrompt: "old prompt", completePromptStatus: "ready", artworkNames: ["keep.png"] }, { shot: { id: "02", sourcePanels: left.map(p => p.id) } }];
  const copy = structuredClone(reviews);
  const result = correctMangaReviewOrder(reviews, expected);
  assert.deepEqual(result.changedShotIds, ["01"]);
  assert.deepEqual(result.reviews[0].shot.sourcePanels, expected.slice(0, 6));
  assert.equal(result.reviews[0].completePromptStatus, "stale");
  assert.equal(result.reviews[0].completePrompt, "old prompt");
  assert.deepEqual(result.reviews[0].annotations, copy[0].annotations);
  assert.deepEqual(result.reviews[0].artworkNames, ["keep.png"]);
  assert.equal(result.reviews[0].shot.shotUid, "keep");
  assert.equal(result.reviews[0].shot.duration, 30);
  assert.equal(result.reviews[1], reviews[1]);
  assert.deepEqual(reviews, copy);
  assert.deepEqual(correctMangaReviewOrder(result.reviews, expected).changedShotIds, []);
});
test("approved, generating and reviewing shots cannot be silently reordered", () => {
  for (const lock of [{ approved: true }, { completePromptStatus: "generating" }, { promptReviewStatus: "reviewing" }]) {
    const reviews = [{ ...lock, shot: { id: "01", sourcePanels: right.map(p => p.id) } }];
    const result = correctMangaReviewOrder(reviews, expected);
    assert.deepEqual(result.blockedShotIds, ["01"]);
    assert.equal(result.reviews[0], reviews[0]);
  }
});
test("new analyses share authoritative order without swapping image IDs or coordinates", () => {
  const result = { kind: "manga", mangaPages: [page], shots: [{ id: "01", sourcePanels: right.map(p => p.id) }] };
  const updated = normalizeMangaAnalysisReadingOrder(result);
  assert.deepEqual(updated.mangaPages[0].readingOrder, expected);
  assert.equal(updated.mangaPages[0].panels, page.panels);
  assert.deepEqual(updated.shots[0].sourcePanels, expected.slice(0, 6));
});
