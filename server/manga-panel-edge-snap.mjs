import { statSync } from "node:fs";
import sharp from "sharp";

export const MANGA_PANEL_EDGE_SNAP_REVISION = "box-to-box-native-resolution-v2";

const DEFAULT_CACHE_SIZE = 8;
const imageCache = new Map();

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedMissingEdges(missingEdges) {
  const aliases = new Map([
    ["top", "top"], ["上", "top"], ["上边", "top"], ["上边框", "top"],
    ["right", "right"], ["右", "right"], ["右边", "right"], ["右边框", "right"],
    ["bottom", "bottom"], ["下", "bottom"], ["下边", "bottom"], ["下边框", "bottom"],
    ["left", "left"], ["左", "left"], ["左边", "left"], ["左边框", "left"],
  ]);
  return new Set((Array.isArray(missingEdges) ? missingEdges : [])
    .map((value) => aliases.get(String(value || "").trim().toLowerCase()))
    .filter(Boolean));
}

function pixelAt(gray, width, x, y) {
  return gray[y * width + x];
}

function axisSample(gray, width, height, orientation, coordinate, orthStart, orthEnd, bandRadius, predicate) {
  const axisLimit = orientation === "vertical" ? width : height;
  const orthLimit = orientation === "vertical" ? height : width;
  const axisStart = clamp(Math.round(coordinate) - bandRadius, 0, axisLimit - 1);
  const axisEnd = clamp(Math.round(coordinate) + bandRadius, 0, axisLimit - 1);
  const start = clamp(Math.round(orthStart), 0, orthLimit - 1);
  const end = clamp(Math.round(orthEnd), start + 1, orthLimit);
  let passing = 0;
  let longestRun = 0;
  let currentRun = 0;
  let samples = 0;

  for (let orth = start; orth < end; orth += 1) {
    let minimum = 255;
    let total = 0;
    let count = 0;
    for (let axis = axisStart; axis <= axisEnd; axis += 1) {
      const value = orientation === "vertical"
        ? pixelAt(gray, width, axis, orth)
        : pixelAt(gray, width, orth, axis);
      minimum = Math.min(minimum, value);
      total += value;
      count += 1;
    }
    const passed = predicate({ minimum, mean: total / Math.max(1, count) });
    samples += 1;
    if (passed) {
      passing += 1;
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return {
    support: passing / Math.max(1, samples),
    continuity: longestRun / Math.max(1, samples),
  };
}

function findDarkLineCandidate({ gray, width, height, orientation, predicted, orthStart, orthEnd, radius }) {
  const axisLimit = orientation === "vertical" ? width : height;
  const start = clamp(Math.floor(predicted - radius), 0, axisLimit - 1);
  const end = clamp(Math.ceil(predicted + radius), 0, axisLimit - 1);
  let best = null;

  for (let coordinate = start; coordinate <= end; coordinate += 1) {
    const sample = axisSample(
      gray,
      width,
      height,
      orientation,
      coordinate,
      orthStart,
      orthEnd,
      0,
      ({ minimum }) => minimum <= 72,
    );
    if (sample.support < 0.56 || sample.continuity < 0.3) continue;
    const distance = Math.abs(coordinate - predicted) / Math.max(1, radius);
    const score = sample.support * 0.62 + sample.continuity * 0.33 - distance * 0.05;
    if (!best || score > best.score) best = { coordinate, score, ...sample, kind: "black-line" };
  }
  if (!best) return null;

  // Expand across the antialiased/thick line so the crop keeps its own frame.
  let lineStart = best.coordinate;
  let lineEnd = best.coordinate;
  for (let coordinate = best.coordinate - 1; coordinate >= Math.max(start, best.coordinate - 5); coordinate -= 1) {
    const sample = axisSample(gray, width, height, orientation, coordinate, orthStart, orthEnd, 0, ({ minimum }) => minimum <= 105);
    if (sample.support < 0.42) break;
    lineStart = coordinate;
  }
  for (let coordinate = best.coordinate + 1; coordinate <= Math.min(end, best.coordinate + 5); coordinate += 1) {
    const sample = axisSample(gray, width, height, orientation, coordinate, orthStart, orthEnd, 0, ({ minimum }) => minimum <= 105);
    if (sample.support < 0.42) break;
    lineEnd = coordinate;
  }
  return { ...best, lineStart, lineEnd };
}

function findWhiteGutterCandidate({ gray, width, height, orientation, predicted, orthStart, orthEnd, radius, side }) {
  const axisLimit = orientation === "vertical" ? width : height;
  const start = clamp(Math.floor(predicted - radius), 0, axisLimit - 1);
  const end = clamp(Math.ceil(predicted + radius), 0, axisLimit - 1);
  const white = [];
  for (let coordinate = start; coordinate <= end; coordinate += 1) {
    const sample = axisSample(
      gray,
      width,
      height,
      orientation,
      coordinate,
      orthStart,
      orthEnd,
      0,
      ({ mean, minimum }) => mean >= 247 && minimum >= 228,
    );
    white.push({ coordinate, ...sample, accepted: sample.support >= 0.72 && sample.continuity >= 0.48 });
  }

  const runs = [];
  let runStart = null;
  for (let index = 0; index <= white.length; index += 1) {
    const item = white[index];
    if (item?.accepted && runStart === null) runStart = index;
    if ((!item?.accepted || index === white.length) && runStart !== null) {
      const runEnd = index - 1;
      const run = white.slice(runStart, runEnd + 1);
      // A real gutter must have observable content or a frame on both sides.
      // Reject a white field that simply fills the whole search window (for
      // example a speech bubble or a mostly blank splash page).
      const boundedOnBothSides = runStart > 0 && runEnd < white.length - 1;
      if (run.length >= 2 && boundedOnBothSides) {
        const averageSupport = run.reduce((sum, entry) => sum + entry.support, 0) / run.length;
        const averageContinuity = run.reduce((sum, entry) => sum + entry.continuity, 0) / run.length;
        let interiorCoordinate = side === "left" || side === "top"
          ? run[run.length - 1].coordinate + 1
          : run[0].coordinate;
        const interiorDirection = side === "left" || side === "top" ? 1 : -1;
        for (let step = 0; step <= 6; step += 1) {
          const coordinate = interiorCoordinate + interiorDirection * step;
          if (coordinate < 0 || coordinate >= axisLimit) break;
          const dark = axisSample(
            gray,
            width,
            height,
            orientation,
            coordinate,
            orthStart,
            orthEnd,
            0,
            ({ minimum }) => minimum <= 105,
          );
          if (dark.support < 0.42) continue;
          interiorCoordinate = side === "right" || side === "bottom" ? coordinate + 1 : coordinate;
          break;
        }
        const distance = Math.abs(interiorCoordinate - predicted) / Math.max(1, radius);
        const score = averageSupport * 0.54 + averageContinuity * 0.36 + Math.min(1, run.length / 10) * 0.1 - distance * 0.08;
        runs.push({
          coordinate: clamp(interiorCoordinate, 0, axisLimit),
          runStart: run[0].coordinate,
          runEnd: run[run.length - 1].coordinate,
          score,
          support: averageSupport,
          continuity: averageContinuity,
          kind: "white-gutter",
        });
      }
      runStart = null;
    }
  }
  return runs.sort((left, right) => right.score - left.score)[0] || null;
}

function snapOneSide({ gray, width, height, bounds, side }) {
  const vertical = side === "left" || side === "right";
  const orientation = vertical ? "vertical" : "horizontal";
  const axisLimit = vertical ? width : height;
  const predicted = side === "left" ? bounds.left
    : side === "right" ? bounds.right
      : side === "top" ? bounds.top
        : bounds.bottom;

  if (predicted <= 2) return { coordinate: 0, kind: "page-edge", score: 1 };
  if (predicted >= axisLimit - 2) return { coordinate: axisLimit, kind: "page-edge", score: 1 };

  const rawOrthStart = vertical ? bounds.top : bounds.left;
  const rawOrthEnd = vertical ? bounds.bottom : bounds.right;
  const orthLength = rawOrthEnd - rawOrthStart;
  const inset = Math.min(12, Math.max(2, Math.round(orthLength * 0.035)));
  const orthStart = rawOrthStart + inset;
  const orthEnd = rawOrthEnd - inset;
  const radius = Math.max(8, Math.min(64, Math.round(axisLimit * 0.035)));

  const dark = findDarkLineCandidate({ gray, width, height, orientation, predicted, orthStart, orthEnd, radius });
  const gutter = findWhiteGutterCandidate({ gray, width, height, orientation, predicted, orthStart, orthEnd, radius, side });
  if (!dark && !gutter) return { coordinate: predicted, kind: "model", score: 0 };

  // A separator gutter resolves the otherwise ambiguous pair of black lines:
  // one is the adjacent panel's outer frame, the other is this panel's frame.
  // Only a nearly continuous white run gets this priority, so speech bubbles and
  // ordinary blank interiors do not override a reliable black frame.
  const strongGutter = gutter && gutter.support >= 0.88 && gutter.continuity >= 0.72;
  let candidate = strongGutter ? gutter : dark || gutter;
  if (candidate.kind === "black-line") {
    candidate = {
      ...candidate,
      coordinate: side === "left" || side === "top" ? candidate.lineStart : candidate.lineEnd + 1,
    };
  }
  return candidate.score >= 0.48 ? candidate : { coordinate: predicted, kind: "model", score: candidate.score };
}

export function snapMangaPanelBoundsFromGray({ gray, width, height, bounds, missingEdges = [] }) {
  if (!(gray instanceof Uint8Array || Buffer.isBuffer(gray))) throw new TypeError("gray must be an 8-bit pixel buffer");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || gray.length < width * height) {
    throw new TypeError("invalid grayscale image dimensions");
  }
  const original = {
    left: clamp(Number(bounds.left), 0, width - 1),
    top: clamp(Number(bounds.top), 0, height - 1),
    right: clamp(Number(bounds.right), 1, width),
    bottom: clamp(Number(bounds.bottom), 1, height),
  };
  if (original.right <= original.left || original.bottom <= original.top) throw new TypeError("invalid panel bounds");
  const missing = normalizedMissingEdges(missingEdges);
  const edges = {};
  for (const side of ["left", "top", "right", "bottom"]) {
    edges[side] = missing.has(side)
      ? { coordinate: original[side], kind: "missing-edge", score: 0 }
      : snapOneSide({ gray, width, height, bounds: original, side });
  }

  const minimumWidth = Math.max(4, Math.round(width * 0.01));
  const minimumHeight = Math.max(4, Math.round(height * 0.01));
  let left = clamp(Math.round(edges.left.coordinate), 0, width - 1);
  let top = clamp(Math.round(edges.top.coordinate), 0, height - 1);
  let right = clamp(Math.round(edges.right.coordinate), left + 1, width);
  let bottom = clamp(Math.round(edges.bottom.coordinate), top + 1, height);
  if (right - left < minimumWidth) {
    left = Math.round(original.left);
    right = Math.round(original.right);
    edges.left = { coordinate: left, kind: "model", score: 0 };
    edges.right = { coordinate: right, kind: "model", score: 0 };
  }
  if (bottom - top < minimumHeight) {
    top = Math.round(original.top);
    bottom = Math.round(original.bottom);
    edges.top = { coordinate: top, kind: "model", score: 0 };
    edges.bottom = { coordinate: bottom, kind: "model", score: 0 };
  }
  return { left, top, right, bottom, edges };
}

async function loadAnalysisImage(imagePath) {
  const modifiedAt = statSync(imagePath).mtimeMs;
  const key = `${imagePath}:${modifiedAt}:native`;
  if (imageCache.has(key)) {
    const cached = imageCache.get(key);
    imageCache.delete(key);
    imageCache.set(key, cached);
    return cached;
  }
  const { data, info } = await sharp(imagePath, { failOn: "none" })
    .autoOrient()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const value = { gray: data, width: info.width, height: info.height };
  imageCache.set(key, value);
  while (imageCache.size > DEFAULT_CACHE_SIZE) imageCache.delete(imageCache.keys().next().value);
  return value;
}

export async function refineMangaPanelPixelBounds({ imagePath, imageWidth, imageHeight, bounds, missingEdges = [] }) {
  const analysis = await loadAnalysisImage(imagePath);
  const xRatio = analysis.width / imageWidth;
  const yRatio = analysis.height / imageHeight;
  const snapped = snapMangaPanelBoundsFromGray({
    ...analysis,
    bounds: {
      left: bounds.left * xRatio,
      top: bounds.top * yRatio,
      right: bounds.right * xRatio,
      bottom: bounds.bottom * yRatio,
    },
    missingEdges,
  });
  return {
    left: clamp(Math.floor(snapped.left / xRatio), 0, imageWidth - 1),
    top: clamp(Math.floor(snapped.top / yRatio), 0, imageHeight - 1),
    right: clamp(Math.ceil(snapped.right / xRatio), 1, imageWidth),
    bottom: clamp(Math.ceil(snapped.bottom / yRatio), 1, imageHeight),
    edges: snapped.edges,
    revision: MANGA_PANEL_EDGE_SNAP_REVISION,
  };
}

export function clearMangaPanelEdgeSnapCache() {
  imageCache.clear();
}
