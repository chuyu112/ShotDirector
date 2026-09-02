import assert from "node:assert/strict";
import test from "node:test";
import { confirmedMangaPixelBounds } from "../server/manga-native-box.mjs";

test("confirmed native pixels are used verbatim, irrespective of stale model percentages", () => {
  const panel = { source_width: 2480, source_height: 1762, bbox_px: [1235, 900, 1700, 1760], bounds: { x: 0, y: 0, width: 1, height: 1 } };
  assert.deepEqual(confirmedMangaPixelBounds(panel, 2480, 1762), { left: 1235, top: 900, right: 1700, bottom: 1760 });
  assert.equal(confirmedMangaPixelBounds({}, 2480, 1762), null);
});

test("invalid native boxes never silently fall back to old model bounds", () => {
  const panel = { source_width: 2480, source_height: 1762 };
  for (const bbox_px of [[1.5, 2, 100, 200], [-1, 0, 100, 100], [10, 0, 5, 100], [0, 0, 2481, 1762], [1, 2, 3], null]) {
    assert.throws(() => confirmedMangaPixelBounds({ ...panel, bbox_px }, 2480, 1762), /像素裁框无效/);
  }
  assert.throws(() => confirmedMangaPixelBounds({ ...panel, bbox_px: [1, 2, 100, 200] }, 1240, 881), /原图尺寸已改变/);
});
