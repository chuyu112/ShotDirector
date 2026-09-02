import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import sharp from "sharp";
import { refineMangaPanelPixelBounds } from "../server/manga-panel-edge-snap.mjs";

const [analysisArg, imageDirArg, outputDirArg] = process.argv.slice(2);
if (!analysisArg || !imageDirArg || !outputDirArg) {
  throw new Error("用法: node scripts/audit-manga-panel-edge-snap.mjs <analysis.json> <source-image-dir> <output-dir>");
}

const analysisPath = resolve(analysisArg);
const imageDir = resolve(imageDirArg);
const outputDir = resolve(outputDirArg);
const cropDir = join(outputDir, "crops");
mkdirSync(cropDir, { recursive: true });
const analysis = JSON.parse(readFileSync(analysisPath, "utf8"));

function coordinateScale(page) {
  const panels = Array.isArray(page?.panels) ? page.panels : [];
  return panels.length && panels.every((panel) => {
    const bounds = panel?.bounds || {};
    return [bounds.x, bounds.y, bounds.width, bounds.height].every((value) => Number.isFinite(value) && value <= 1.001)
      && bounds.x + bounds.width <= 1.001
      && bounds.y + bounds.height <= 1.001;
  }) ? 1 : 100;
}

function sourceForPage(page) {
  return analysis.sourceFiles?.[page.scanIndex - 1]
    || analysis.sourceFiles?.find((source) => source.originalName === page.sourceFile);
}

function sourceImagePath(source) {
  const direct = join(imageDir, `${source.mediaId}.png`);
  if (existsSync(direct)) return direct;
  const original = join(imageDir, basename(source.originalName || ""));
  if (existsSync(original)) return original;
  throw new Error(`找不到第 ${source.originalName || source.mediaId} 页原图`);
}

function xml(value) {
  return String(value).replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[character]);
}

const report = [];
for (const page of analysis.mangaPages || []) {
  const source = sourceForPage(page);
  const imagePath = sourceImagePath(source);
  const metadata = await sharp(imagePath).metadata();
  const imageWidth = Number(metadata.autoOrient?.width || metadata.width);
  const imageHeight = Number(metadata.autoOrient?.height || metadata.height);
  const scale = coordinateScale(page);
  const tiles = [];

  for (const panel of page.panels || []) {
    if (!panel.includeInShots) continue;
    const model = {
      left: Math.floor((panel.bounds.x / scale) * imageWidth),
      top: Math.floor((panel.bounds.y / scale) * imageHeight),
      right: Math.ceil(((panel.bounds.x + panel.bounds.width) / scale) * imageWidth),
      bottom: Math.ceil(((panel.bounds.y + panel.bounds.height) / scale) * imageHeight),
    };
    const refined = await refineMangaPanelPixelBounds({
      imagePath,
      imageWidth,
      imageHeight,
      bounds: model,
      missingEdges: panel.missingEdges,
    });
    const cropWidth = refined.right - refined.left;
    const cropHeight = refined.bottom - refined.top;
    const cropPath = join(cropDir, `${panel.id}.webp`);
    await sharp(imagePath, { failOn: "none" })
      .autoOrient()
      .extract({ left: refined.left, top: refined.top, width: cropWidth, height: cropHeight })
      .resize({ width: 260, height: 220, fit: "contain", background: "white", withoutEnlargement: false })
      .extend({ top: 28, background: "white" })
      .composite([{
        input: Buffer.from(`<svg width="260" height="28"><rect width="260" height="28" fill="white"/><text x="8" y="20" font-family="sans-serif" font-size="16" fill="black">${xml(panel.id)}</text></svg>`),
        left: 0,
        top: 0,
      }])
      .webp({ quality: 88 })
      .toFile(cropPath);
    tiles.push(cropPath);
    report.push({
      panelId: panel.id,
      page: page.scanIndex,
      model,
      refined: { left: refined.left, top: refined.top, right: refined.right, bottom: refined.bottom },
      delta: {
        left: refined.left - model.left,
        top: refined.top - model.top,
        right: refined.right - model.right,
        bottom: refined.bottom - model.bottom,
      },
      edgeKinds: Object.fromEntries(Object.entries(refined.edges).map(([side, edge]) => [side, edge.kind])),
    });
  }

  const columns = Math.min(4, Math.max(1, tiles.length));
  const rows = Math.ceil(tiles.length / columns);
  const composites = await Promise.all(tiles.map(async (path, index) => ({
    input: await sharp(path).toBuffer(),
    left: (index % columns) * 260,
    top: Math.floor(index / columns) * 248,
  })));
  await sharp({ create: { width: columns * 260, height: rows * 248, channels: 3, background: "#d9d9d9" } })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toFile(join(outputDir, `page-${String(page.scanIndex).padStart(2, "0")}.jpg`));
}

writeFileSync(join(outputDir, "edge-snap-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const moved = report.filter((entry) => Object.values(entry.delta).some((value) => value !== 0));
console.log(JSON.stringify({ panels: report.length, moved: moved.length, outputDir }, null, 2));
