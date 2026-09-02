// An explicitly confirmed original-pixel rectangle outranks model proposals.
export function confirmedMangaPixelBounds(panel, imageWidth, imageHeight) {
  if (panel?.bbox_px === undefined) return null;
  const b = panel.bbox_px;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isInteger)
    || panel.source_width !== imageWidth || panel.source_height !== imageHeight
    || b[0] < 0 || b[1] < 0 || b[2] > imageWidth || b[3] > imageHeight
    || b[0] >= b[2] || b[1] >= b[3]) {
    throw new Error("已确认像素裁框无效或原图尺寸已改变，请重新人工核对；禁止回退到模型框");
  }
  return { left: b[0], top: b[1], right: b[2], bottom: b[3] };
}
