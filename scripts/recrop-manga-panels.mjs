import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { MANGA_PANEL_EDGE_SNAP_REVISION, refineMangaPanelPixelBounds } from "../server/manga-panel-edge-snap.mjs";

const [analysisArg, uploadDirArg, cropDirArg, backupRootArg] = process.argv.slice(2);
if (!analysisArg || !uploadDirArg || !cropDirArg || !backupRootArg) {
  throw new Error("用法: node scripts/recrop-manga-panels.mjs <analysis.json> <uploads-dir> <panel-crops-dir> <backup-root>");
}

const analysisPath = resolve(analysisArg);
const uploadDir = resolve(uploadDirArg);
const cropDir = resolve(cropDirArg);
const backupRoot = resolve(backupRootArg);
const analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
if (analysis.kind !== "manga" || !Array.isArray(analysis.mangaPages)) throw new Error("输入不是已完成的漫画分析结果");

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
  const suffixes = [...new Set([extname(source.originalName || ""), ".png", ".jpg", ".jpeg", ".webp"].filter(Boolean))];
  for (const suffix of suffixes) {
    const candidate = join(uploadDir, `${source.mediaId}${suffix.toLowerCase()}`);
    if (existsSync(candidate)) return candidate;
  }
  const original = join(uploadDir, basename(source.originalName || ""));
  if (existsSync(original)) return original;
  throw new Error(`找不到来源漫画页：${source.originalName || source.mediaId}`);
}

async function cropPanel({ imagePath, imageWidth, imageHeight, scale, panel, outputPath }) {
  const cropMasks = Array.isArray(panel.cropMasks) ? panel.cropMasks.filter((mask) => (
    mask && [mask.x, mask.y, mask.width, mask.height].every(Number.isFinite)
      && mask.width > 0 && mask.height > 0
  )) : [];
  const model = {
    left: Math.max(0, Math.min(imageWidth - 1, Math.floor((panel.bounds.x / scale) * imageWidth))),
    top: Math.max(0, Math.min(imageHeight - 1, Math.floor((panel.bounds.y / scale) * imageHeight))),
    right: Math.max(1, Math.min(imageWidth, Math.ceil(((panel.bounds.x + panel.bounds.width) / scale) * imageWidth))),
    bottom: Math.max(1, Math.min(imageHeight, Math.ceil(((panel.bounds.y + panel.bounds.height) / scale) * imageHeight))),
  };
  const bounds = cropMasks.length ? model : await refineMangaPanelPixelBounds({
    imagePath,
    imageWidth,
    imageHeight,
    bounds: model,
    missingEdges: panel.missingEdges,
  });
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  let pipeline = sharp(imagePath, { failOn: "none" })
    .autoOrient()
    .extract({ left: bounds.left, top: bounds.top, width, height });
  if (cropMasks.length) {
    const overlays = await Promise.all(cropMasks.map(async (mask) => {
      const left = Math.max(0, Math.min(width - 1, Math.floor((mask.x / 100) * width)));
      const top = Math.max(0, Math.min(height - 1, Math.floor((mask.y / 100) * height)));
      const right = Math.max(left + 1, Math.min(width, Math.ceil(((mask.x + mask.width) / 100) * width)));
      const bottom = Math.max(top + 1, Math.min(height, Math.ceil(((mask.y + mask.height) / 100) * height)));
      const input = await sharp({
        create: { width: right - left, height: bottom - top, channels: 4, background: mask.color || "#ffffff" },
      }).png().toBuffer();
      return { input, left, top };
    }));
    pipeline = pipeline.composite(overlays);
  }
  await pipeline.resize({ width: 900, withoutEnlargement: true }).webp({ quality: 88, effort: 4 }).toFile(outputPath);
}

mkdirSync(dirname(cropDir), { recursive: true });
mkdirSync(backupRoot, { recursive: true });
const stagingDir = `${cropDir}.staging-${randomUUID()}`;
mkdirSync(stagingDir, { recursive: true });
let count = 0;
for (const page of analysis.mangaPages) {
  const source = sourceForPage(page);
  if (!source?.mediaId) throw new Error(`第 ${page.scanIndex} 页缺少来源媒体 ID`);
  const imagePath = sourceImagePath(source);
  const metadata = await sharp(imagePath).metadata();
  const imageWidth = Number(metadata.autoOrient?.width || metadata.width || 0);
  const imageHeight = Number(metadata.autoOrient?.height || metadata.height || 0);
  if (!imageWidth || !imageHeight) throw new Error(`无法读取第 ${page.scanIndex} 页尺寸`);
  const scale = coordinateScale(page);
  for (const panel of page.panels || []) {
    if (!panel.includeInShots) continue;
    await cropPanel({
      imagePath,
      imageWidth,
      imageHeight,
      scale,
      panel,
      outputPath: join(stagingDir, `${panel.id}.webp`),
    });
    count += 1;
  }
}
if (!count) throw new Error("没有可重裁的画格");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join(backupRoot, `panel-crops-before-${MANGA_PANEL_EDGE_SNAP_REVISION}-${stamp}`);
if (existsSync(cropDir)) renameSync(cropDir, backupDir);
renameSync(stagingDir, cropDir);
console.log(JSON.stringify({ revision: MANGA_PANEL_EDGE_SNAP_REVISION, count, cropDir, backupDir }, null, 2));
