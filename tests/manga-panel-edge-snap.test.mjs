import assert from "node:assert/strict";
import test from "node:test";
import { snapMangaPanelBoundsFromGray } from "../server/manga-panel-edge-snap.mjs";

function canvas(width, height, color = 255) {
  return new Uint8Array(width * height).fill(color);
}

function fillRect(gray, width, x, y, rectWidth, rectHeight, color) {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) gray[row * width + column] = color;
  }
}

test("snaps approximate bounds to continuous black panel borders", () => {
  const width = 240;
  const height = 180;
  const gray = canvas(width, height);
  fillRect(gray, width, 98, 20, 3, 141, 0);
  fillRect(gray, width, 218, 20, 3, 141, 0);
  fillRect(gray, width, 98, 20, 123, 3, 0);
  fillRect(gray, width, 98, 158, 123, 3, 0);
  // Interior art must not be mistaken for a panel boundary.
  fillRect(gray, width, 112, 55, 2, 50, 0);

  const result = snapMangaPanelBoundsFromGray({
    gray,
    width,
    height,
    bounds: { left: 92, top: 16, right: 225, bottom: 166 },
  });
  assert.deepEqual(
    { left: result.left, top: result.top, right: result.right, bottom: result.bottom },
    { left: 98, top: 20, right: 221, bottom: 161 },
  );
  assert.equal(result.edges.left.kind, "black-line");
});

test("uses a white gutter when a panel side has no drawn border", () => {
  const width = 220;
  const height = 160;
  const gray = canvas(width, height, 215);
  fillRect(gray, width, 94, 0, 12, height, 255);
  // Add sparse texture to both panels.
  for (let row = 8; row < height; row += 13) {
    fillRect(gray, width, 8, row, 70, 1, 80);
    fillRect(gray, width, 120, row, 70, 1, 80);
  }
  const result = snapMangaPanelBoundsFromGray({
    gray,
    width,
    height,
    bounds: { left: 99, top: 0, right: 219, bottom: 160 },
  });
  assert.ok(result.left >= 104 && result.left <= 107);
  assert.equal(result.edges.left.kind, "white-gutter");
});

test("a white separator chooses the frame on the panel side, not the adjacent frame", () => {
  const width = 220;
  const height = 180;
  const gray = canvas(width, height, 210);
  fillRect(gray, width, 20, 70, 181, 3, 0);
  fillRect(gray, width, 20, 74, 181, 14, 255);
  fillRect(gray, width, 20, 89, 181, 3, 0);
  const result = snapMangaPanelBoundsFromGray({
    gray,
    width,
    height,
    bounds: { left: 20, top: 80, right: 201, bottom: 170 },
    missingEdges: ["left", "right", "bottom"],
  });
  assert.equal(result.top, 89);
  assert.equal(result.edges.top.kind, "white-gutter");
});

test("a thin two-pixel gutter still separates an adjacent left sliver", () => {
  const width = 220;
  const height = 180;
  const gray = canvas(width, height, 210);
  fillRect(gray, width, 78, 20, 3, 141, 0);
  fillRect(gray, width, 81, 20, 2, 141, 255);
  fillRect(gray, width, 83, 20, 3, 141, 0);
  const result = snapMangaPanelBoundsFromGray({
    gray,
    width,
    height,
    bounds: { left: 79, top: 20, right: 200, bottom: 161 },
    missingEdges: ["top", "right", "bottom"],
  });
  assert.equal(result.left, 83);
  assert.equal(result.edges.left.kind, "white-gutter");
});

test("does not use a short speech-bubble-like stroke as a frame line", () => {
  const width = 200;
  const height = 160;
  const gray = canvas(width, height);
  fillRect(gray, width, 90, 55, 2, 24, 0);
  const result = snapMangaPanelBoundsFromGray({
    gray,
    width,
    height,
    bounds: { left: 87, top: 20, right: 180, bottom: 145 },
  });
  assert.equal(result.left, 87);
  assert.equal(result.edges.left.kind, "model");
});

test("a declared missing edge stays on the model bound while other sides snap", () => {
  const width = 200;
  const height = 160;
  const gray = canvas(width, height);
  fillRect(gray, width, 40, 20, 2, 121, 0);
  fillRect(gray, width, 160, 20, 2, 121, 0);
  fillRect(gray, width, 40, 20, 122, 2, 0);
  fillRect(gray, width, 40, 139, 122, 2, 0);
  const result = snapMangaPanelBoundsFromGray({
    gray,
    width,
    height,
    bounds: { left: 36, top: 16, right: 165, bottom: 146 },
    missingEdges: ["左"],
  });
  assert.equal(result.left, 36);
  assert.equal(result.edges.left.kind, "missing-edge");
  assert.equal(result.right, 162);
  assert.equal(result.bottom, 141);
});

test("keeps page edges exact", () => {
  const width = 180;
  const height = 120;
  const gray = canvas(width, height);
  const result = snapMangaPanelBoundsFromGray({
    gray,
    width,
    height,
    bounds: { left: 1, top: 0, right: 179, bottom: 120 },
  });
  assert.equal(result.left, 0);
  assert.equal(result.top, 0);
  assert.equal(result.right, width);
  assert.equal(result.bottom, height);
});
