/** Reading order is spatial metadata, never a crop operation or an ID sort. */
export const mangaReadingOrderVersion = 1;

function validBounds(panel) {
  const b = panel?.bounds;
  return b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0;
}

// Recursive gutter cuts retain the hierarchy: rows before columns, then the
// full right column (including stacked small panels) before the next column.
function gutterGroups(panels, axis) {
  const size = axis === "x" ? "width" : "height";
  const sorted = [...panels].sort((a, b) => a.bounds[axis] - b.bounds[axis]);
  const groups = [];
  let group = [], edge = -Infinity, edgeSize = 0;
  for (const panel of sorted) {
    const start = panel.bounds[axis], length = panel.bounds[size];
    // Small crop-border overlaps do not erase an otherwise continuous gutter.
    const tolerance = Math.min(1, Math.min(edgeSize, length) * 0.08);
    if (group.length && start >= edge - tolerance) {
      groups.push(group);
      group = [];
      edge = -Infinity;
    }
    group.push(panel);
    if (start + length > edge) { edge = start + length; edgeSize = length; }
  }
  if (group.length) groups.push(group);
  // A later unresolved overlap must retain the original evidence order, not
  // the temporary axis sorting used to find the gutter.
  return groups.map((items) => panels.filter((panel) => items.includes(panel)));
}

function regionOrder(panels, rtl, issues) {
  if (panels.length < 2) return panels;
  const rows = gutterGroups(panels, "y");
  if (rows.length > 1) return rows.flatMap((row) => regionOrder(row, rtl, issues));
  const columns = gutterGroups(panels, "x");
  if (columns.length > 1) {
    if (rtl) columns.reverse();
    return columns.flatMap((column) => regionOrder(column, rtl, issues));
  }
  // True overlapping/diagonal panels need human judgement, not a guessed sort.
  issues.push({ panelIds: panels.map((p) => p.id), reason: "叠格边界无法确定唯一阅读顺序，保留原序，待人工核对" });
  return panels;
}

export function buildMangaReadingOrder(pages, direction = "right-to-left") {
  const rtl = direction !== "left-to-right", issues = [], orderedPages = [];
  for (const page of [...(pages || [])].sort((a, b) => a.scanIndex - b.scanIndex)) {
    const panels = page.panels || [];
    const rank = new Map((page.readingOrder || []).map((id, i) => [id, i]));
    const original = [...panels].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
    if (panels.some((p) => !validBounds(p)) || new Set(panels.map((p) => p.id)).size !== panels.length) {
      issues.push({ panelIds: panels.map((p) => p.id), reason: "画格位置缺失或 ID 重复，保留原序，待人工核对" });
      orderedPages.push({ scanIndex: page.scanIndex, panelIds: original.map((p) => p.id) });
      continue;
    }
    let regions = [original];
    if (page.layout === "double-page") {
      // R/L identifies the physical leaf, not the reading rank. Do not infer
      // order from G01/G02: those IDs may have been assigned incorrectly.
      const labeled = original.every((p) => /^P\d+-[RL]-G\d+$/i.test(p.id));
      const left = original.filter((p) => labeled ? /-L-/i.test(p.id) : p.bounds.x + p.bounds.width / 2 < 50);
      const right = original.filter((p) => !left.includes(p));
      regions = rtl ? [right, left] : [left, right];
    }
    orderedPages.push({ scanIndex: page.scanIndex, panelIds: regions.flatMap((r) => regionOrder(r, rtl, issues)).map((p) => p.id) });
  }
  return { direction: rtl ? "right-to-left" : "left-to-right", pages: orderedPages, panelIds: orderedPages.flatMap((p) => p.panelIds), issues };
}

export function orderPanelIds(ids, readingOrder) {
  const rank = new Map(readingOrder.map((id, i) => [id, i]));
  // No partial sorting around unknown/manual panels: that could change intent.
  if (ids.some((id) => !rank.has(id))) return [...ids];
  return [...ids].sort((a, b) => rank.get(a) - rank.get(b));
}

/** Preserve all crops, IDs, annotations, Shot membership, durations and UIDs. */
export function correctMangaReviewOrder(reviews, readingOrder) {
  const changedShotIds = [], blockedShotIds = [];
  const corrected = reviews.map((review) => {
    const ids = review.shot.sourcePanels || [];
    const next = orderPanelIds(ids, readingOrder);
    if (JSON.stringify(ids) === JSON.stringify(next)) return review;
    if (review.approved || review.completePromptStatus === "generating" || review.promptReviewStatus === "reviewing") {
      blockedShotIds.push(review.shot.id);
      return review;
    }
    changedShotIds.push(review.shot.id);
    return {
      ...review,
      shot: { ...review.shot, sourcePanels: next },
      completePromptStatus: review.completePrompt?.trim() ? "stale" : "empty",
      completePromptConfirmedAt: undefined,
      completePromptSourceRevision: undefined,
      completePromptSummary: "已按原页位置校正阅读顺序；旧文字理解与讨论稿需对照裁图重新复核。未重裁或自动重新生成。",
      promptReviewStatus: review.promptReviewReport ? "stale" : "empty",
      promptReviewSourceRevision: undefined,
    };
  });
  return { reviews: corrected, changedShotIds, blockedShotIds };
}

/** New analysis metadata only. Never remap bounds to a different panel ID. */
export function normalizeMangaAnalysisReadingOrder(result, direction = "right-to-left") {
  if (result.kind !== "manga" || !Array.isArray(result.mangaPages) || !Array.isArray(result.shots)) return result;
  const order = buildMangaReadingOrder(result.mangaPages, direction);
  return {
    ...result,
    readingDirection: order.direction,
    readingOrderVersion: mangaReadingOrderVersion,
    readingOrderIssues: order.issues,
    mangaPages: result.mangaPages.map((page) => ({ ...page, readingOrder: order.pages.find((p) => p.scanIndex === page.scanIndex).panelIds })),
    shots: result.shots.map((shot) => ({ ...shot, sourcePanels: orderPanelIds(shot.sourcePanels || [], order.panelIds) })),
  };
}
