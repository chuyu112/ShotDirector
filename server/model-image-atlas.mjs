import { chmod, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import sharp from "sharp";

const MIB = 1024 * 1024;
const MAX_MODEL_ATTACHMENTS = 9;
const MAX_SOURCE_IMAGES = 360;
const MAX_SOURCE_DIMENSION = 32_768;
const MAX_SOURCE_PIXELS = 80_000_000;
const MAX_ATLAS_BYTES = 10 * MIB;
const MAX_TOTAL_ATLAS_BYTES = 30 * MIB;
const MAX_ATLAS_DIMENSION = 7_000;
const MAX_ATLAS_PIXELS = 20_000_000;
const DESIRED_TILE_EDGE = 1_024;
const MIN_TILE_EDGE = 256;
const GUTTER = 12;

export const MODEL_IMAGE_ATLAS_LIMITS = Object.freeze({
  maxAttachments: MAX_MODEL_ATTACHMENTS,
  maxSourceImages: MAX_SOURCE_IMAGES,
  maxSourceDimension: MAX_SOURCE_DIMENSION,
  maxSourcePixels: MAX_SOURCE_PIXELS,
  maxAtlasBytes: MAX_ATLAS_BYTES,
  maxTotalAtlasBytes: MAX_TOTAL_ATLAS_BYTES,
  maxAtlasDimension: MAX_ATLAS_DIMENSION,
  maxAtlasPixels: MAX_ATLAS_PIXELS,
});

function checkedImagePaths(imagePaths) {
  if (!Array.isArray(imagePaths)) throw new TypeError("imagePaths 必须是数组");
  if (imagePaths.length > MAX_SOURCE_IMAGES) {
    throw new Error(`源图过多：最多支持 ${MAX_SOURCE_IMAGES} 张`);
  }
  return imagePaths.map((imagePath, index) => {
    if (typeof imagePath !== "string" || !imagePath.trim()) {
      throw new TypeError(`第 ${index + 1} 个图片路径无效`);
    }
    return imagePath;
  });
}

function checkedMaxImages(maxImages) {
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > MAX_MODEL_ATTACHMENTS) {
    throw new RangeError(`maxImages 必须是 1-${MAX_MODEL_ATTACHMENTS} 的整数`);
  }
  return maxImages;
}

function insideRoot(path, root) {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function checkedAllowedSources(imagePaths, allowedRoots) {
  if (!Array.isArray(allowedRoots)) throw new TypeError("allowedRoots 必须是数组");
  if (!allowedRoots.length) return imagePaths;
  const roots = await Promise.all(allowedRoots.map(async (root) => (
    realpath(resolve(String(root || ""))).catch(() => resolve(String(root || "")))
  )));
  return Promise.all(imagePaths.map(async (imagePath) => {
    const actual = await realpath(resolve(imagePath));
    if (!roots.some((root) => insideRoot(actual, root))) {
      throw new Error("atlas 源图路径不属于当前用户工作区");
    }
    return actual;
  }));
}

function safePrefix(prefix) {
  const value = String(prefix || "model-atlas")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 64);
  return value || "model-atlas";
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compactName(imagePath) {
  const name = basename(imagePath)
    .normalize("NFKC")
    .replace(/\p{C}+/gu, " ")
    .replace(/[<>{}`]/g, "_")
    .trim();
  return name.length > 42 ? `${name.slice(0, 39)}...` : name;
}

function balancedGroups(imagePaths, groupCount) {
  const baseSize = Math.floor(imagePaths.length / groupCount);
  const extra = imagePaths.length % groupCount;
  const groups = [];
  let cursor = 0;
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const size = baseSize + (groupIndex < extra ? 1 : 0);
    groups.push(imagePaths.slice(cursor, cursor + size).map((imagePath, localIndex) => ({
      imagePath,
      sourceIndex: cursor + localIndex,
    })));
    cursor += size;
  }
  return groups;
}

function gridFor(count) {
  const columns = Math.ceil(Math.sqrt(count));
  return { columns, rows: Math.ceil(count / columns) };
}

function labelHeightFor(tileEdge) {
  return Math.max(48, Math.min(88, Math.round(tileEdge * 0.085)));
}

function atlasGeometry(count, tileEdge) {
  const { columns, rows } = gridFor(count);
  const labelHeight = labelHeightFor(tileEdge);
  const width = GUTTER + columns * (tileEdge + GUTTER);
  const height = GUTTER + rows * (tileEdge + labelHeight + GUTTER);
  return { columns, rows, labelHeight, width, height, tileEdge };
}

function geometryFits(geometry) {
  return geometry.width <= MAX_ATLAS_DIMENSION
    && geometry.height <= MAX_ATLAS_DIMENSION
    && geometry.width * geometry.height <= MAX_ATLAS_PIXELS;
}

function bestGeometry(count) {
  let low = MIN_TILE_EDGE;
  let high = DESIRED_TILE_EDGE;
  let best = null;
  while (low <= high) {
    const candidateEdge = Math.floor((low + high) / 2);
    const candidate = atlasGeometry(count, candidateEdge);
    if (geometryFits(candidate)) {
      best = candidate;
      low = candidateEdge + 1;
    } else {
      high = candidateEdge - 1;
    }
  }
  if (!best) throw new Error("单张 atlas 内的源图过多，无法在安全尺寸内排版");
  return best;
}

function labelSvg({ width, height, sourceIndex, imagePath }) {
  const order = String(sourceIndex + 1).padStart(3, "0");
  const fontSize = Math.max(24, Math.floor(height * 0.43));
  const secondarySize = Math.max(18, Math.floor(fontSize * 0.66));
  const filename = xmlEscape(compactName(imagePath));
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="18" y="${Math.round(height * 0.66)}" fill="#ffffff"
        font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700">#${order}</text>
      <text x="${Math.round(fontSize * 2.9)}" y="${Math.round(height * 0.64)}" fill="#cbd5e1"
        font-family="Arial, Helvetica, sans-serif" font-size="${secondarySize}">${filename}</text>
    </svg>
  `);
}

async function checkedSourceMetadata(imagePath, sourceIndex) {
  let metadata;
  try {
    metadata = await sharp(imagePath, {
      failOn: "error",
      limitInputPixels: MAX_SOURCE_PIXELS,
      sequentialRead: true,
    }).metadata();
  } catch (error) {
    throw new Error(`无法读取源图 #${String(sourceIndex + 1).padStart(3, "0")}: ${error.message}`, { cause: error });
  }
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height || width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION
    || width * height > MAX_SOURCE_PIXELS) {
    throw new Error(`源图 #${String(sourceIndex + 1).padStart(3, "0")} 的尺寸超出安全上限`);
  }
  return metadata;
}

async function tileBuffer(item, geometry) {
  await checkedSourceMetadata(item.imagePath, item.sourceIndex);
  try {
    return await sharp(item.imagePath, {
      failOn: "error",
      limitInputPixels: MAX_SOURCE_PIXELS,
      sequentialRead: true,
    })
      .rotate()
      .resize(geometry.tileEdge, geometry.tileEdge, {
        fit: "contain",
        background: { r: 30, g: 41, b: 59, alpha: 1 },
      })
      .flatten({ background: "#1e293b" })
      .png({ compressionLevel: 6 })
      .toBuffer();
  } catch (error) {
    throw new Error(`无法处理源图 #${String(item.sourceIndex + 1).padStart(3, "0")}: ${error.message}`, { cause: error });
  }
}

async function atlasComposites(group, geometry) {
  const tiles = await Promise.all(group.map((item) => tileBuffer(item, geometry)));
  return group.flatMap((item, index) => {
    const column = index % geometry.columns;
    const row = Math.floor(index / geometry.columns);
    const left = GUTTER + column * (geometry.tileEdge + GUTTER);
    const top = GUTTER + row * (geometry.tileEdge + geometry.labelHeight + GUTTER);
    return [
      {
        input: labelSvg({
          width: geometry.tileEdge,
          height: geometry.labelHeight,
          sourceIndex: item.sourceIndex,
          imagePath: item.imagePath,
        }),
        left,
        top,
      },
      { input: tiles[index], left, top: top + geometry.labelHeight },
    ];
  });
}

async function renderAtlas(group, maxBytes = MAX_ATLAS_BYTES) {
  const geometry = bestGeometry(group.length);
  const composites = await atlasComposites(group, geometry);
  const qualities = [86, 78, 68, 56, 44, 32];
  let smallest = null;
  for (const quality of qualities) {
    const buffer = await sharp({
      create: {
        width: geometry.width,
        height: geometry.height,
        channels: 3,
        background: "#0f172a",
      },
    })
      .composite(composites)
      .jpeg({ quality, chromaSubsampling: "4:2:0", mozjpeg: true })
      .toBuffer();
    smallest = buffer;
    if (buffer.length <= maxBytes) return buffer;
  }

  let width = geometry.width;
  let height = geometry.height;
  while (smallest.length > maxBytes && width > 512 && height > 512) {
    width = Math.max(512, Math.floor(width * 0.82));
    height = Math.max(512, Math.floor(height * 0.82));
    smallest = await sharp(smallest, { limitInputPixels: MAX_ATLAS_PIXELS })
      .resize(width, height, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 32, chromaSubsampling: "4:2:0", mozjpeg: true })
      .toBuffer();
  }
  if (smallest.length > maxBytes) throw new Error("atlas 无法压缩到模型附件总量限额内");
  return smallest;
}

function directMappingText(imagePaths) {
  if (!imagePaths.length) return "";
  return imagePaths.map((imagePath, index) => (
    `附件 ${index + 1} → #${String(index + 1).padStart(3, "0")} ${compactName(imagePath)}`
  )).join("\n");
}

function atlasMappingText(groups) {
  return groups.map((group, atlasIndex) => {
    const sources = group.map((item) => (
      `  - #${String(item.sourceIndex + 1).padStart(3, "0")} → ${compactName(item.imagePath)}`
    )).join("\n");
    return `附件 ${atlasIndex + 1} (JPEG atlas)\n${sources}`;
  }).join("\n");
}

export async function prepareModelImageInputs({
  imagePaths,
  outputDir,
  prefix = "model-atlas",
  maxImages = MAX_MODEL_ATTACHMENTS,
  allowedRoots = [],
}) {
  const sources = await checkedAllowedSources(checkedImagePaths(imagePaths), allowedRoots);
  const attachmentLimit = checkedMaxImages(maxImages);
  if (sources.length <= attachmentLimit) {
    return {
      imagePaths: [...sources],
      generatedPaths: [],
      mappingText: directMappingText(sources),
    };
  }
  if (typeof outputDir !== "string" || !outputDir.trim()) {
    throw new TypeError("生成 atlas 时 outputDir 不能为空");
  }

  const targetDir = resolve(outputDir);
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const groups = balancedGroups(sources, attachmentLimit);
  const perAtlasByteBudget = Math.min(MAX_ATLAS_BYTES, Math.floor(MAX_TOTAL_ATLAS_BYTES / groups.length));
  const generatedPaths = [];
  const outputPrefix = safePrefix(prefix);
  try {
    for (let index = 0; index < groups.length; index += 1) {
      const outputPath = join(targetDir, `${outputPrefix}-${String(index + 1).padStart(2, "0")}.jpg`);
      const buffer = await renderAtlas(groups[index], perAtlasByteBudget);
      await writeFile(outputPath, buffer, { flag: "wx", mode: 0o600 });
      await chmod(outputPath, 0o600);
      generatedPaths.push(outputPath);
    }
  } catch (error) {
    await Promise.all(generatedPaths.map((generatedPath) => unlink(generatedPath).catch(() => {})));
    throw error;
  }

  return {
    imagePaths: [...generatedPaths],
    generatedPaths,
    mappingText: atlasMappingText(groups),
  };
}
