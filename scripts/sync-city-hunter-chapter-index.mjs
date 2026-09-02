import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const catalogUrl = "https://ebookjapan.yahoo.co.jp/stories/all/118125/";
const officialSeriesUrl = "https://comic-zenon.com/episode/14079602755177340361";
const outputPath = resolve("knowledge/city-hunter/chapter-index.json");

const html = execFileSync("curl", [
  "-L", "--fail", "--silent", "--show-error",
  "--retry", "3", "--retry-all-errors", "--connect-timeout", "20",
  "--user-agent", "ShotDirector/1.0 chapter metadata synchronizer",
  catalogUrl,
], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

const entries = [];
const pattern = /<span[^>]*story-caption__tagtext[^>]*>[\s\S]*?#(\d+)[\s\S]*?<p[^>]*story-caption__title[^>]*>[\s\S]*?<!---->([^<]+)<\/p>/g;
for (const match of html.matchAll(pattern)) {
  const number = Number(match[1]);
  const titleJa = match[2].replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim();
  if (!Number.isInteger(number) || !titleJa || entries.some((item) => item.number === number)) continue;
  entries.push({ number, titleJa });
}
entries.sort((a, b) => a.number - b.number);
if (entries.length !== 336 || entries[0]?.number !== 1 || entries.at(-1)?.number !== 336) {
  throw new Error(`目录解析不完整：得到 ${entries.length} 话，预期 336 话`);
}

const payload = {
  work: "CITY HUNTER / シティーハンター",
  chapterCount: entries.length,
  fetchedAt: new Date().toISOString(),
  sourcePolicy: "本文件只保存公开目录元数据。逐话剧情必须以用户上传的正版漫画扫描为最高证据，不绕过付费阅读，不复制漫画正文。",
  sources: [
    { name: "ebookjapan 完全版336话目录", url: catalogUrl, purpose: "全话编号与日文原题" },
    { name: "ゼノンプラス 第4话官方授权页面", url: officialSeriesUrl, purpose: "出版社授权逐话页面校验入口" },
  ],
  chapters: entries,
};

await mkdir(resolve("knowledge/city-hunter"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`已保存 ${entries.length} 话目录：${outputPath}`);
