import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("clean package starts from a neutral project", async () => {
  const [layout, page, shots, blocking] = await Promise.all([
    read("../app/layout.tsx"),
    read("../app/page.tsx"),
    read("../app/storyboard-data.ts"),
    read("../app/blocking-plans.ts"),
  ]);

  assert.match(layout, /镜导 ShotDirector｜AI 导演工作台/);
  assert.match(page, /const defaultProjectTitle = "未命名项目"/);
  assert.match(page, /sourceName: "空白项目模板"/);
  assert.match(page, /createReviews\(storyboardShots, false\)/);
  assert.match(shots, /title: "未命名镜头"/);
  assert.match(shots, /characters: \[\]/);
  assert.match(shots, /props: \[\]/);
  assert.match(blocking, /blockingPlans[^=]*= \{\}/);
});

test("retains specification, worldview and separated art-style layers", async () => {
  const [settings, rules, templateText] = await Promise.all([
    read("../app/global-settings.ts"),
    read("../config/workflow-rules.json"),
    read("../project-data/templates/city-hunter-showa60.json"),
  ]);
  const template = JSON.parse(templateText);

  assert.match(settings, /storyBackground: ""/);
  assert.match(settings, /finalVideoStyle: ""/);
  assert.match(settings, /characters: \[\]/);
  assert.match(settings, /props: \[\]/);
  assert.match(settings, /timeline: \[\]/);
  assert.match(rules, /临时赛璐璐动画导演分镜工作图/);
  assert.match(rules, /最终视频美术风格、临时分镜图风格和3D白模材质分层保存/);
  assert.match(template.storyBackground, /昭和60年（1985年）的东京新宿/);
  assert.match(template.storyBackground, /城市猎人在警方与普通社会触及不到的灰色地带/);
  assert.match(template.finalVideoStyle, /SHOWA_UPSWING_CITY_ACTION_1985/);
  assert.match(template.finalVideoStyle, /写实日本真人短片/);
});

test("keeps the three-step review and explicit approval workflow", async () => {
  const page = await read("../app/page.tsx");

  assert.match(page, /label: "脚本"/);
  assert.match(page, /label: "出图"/);
  assert.match(page, /label: "确认"/);
  assert.match(page, /签字盖章/);
  assert.match(page, /全局批注/);
  assert.match(page, /全能参考/);
  assert.match(page, /DIRECTOR VIEW/);
});

test("keeps manga analysis, asset sync, video review and whitebox entry points", async () => {
  const [page, mediaLab] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/media-lab.tsx"),
  ]);

  assert.match(mediaLab, /漫画/);
  assert.match(mediaLab, /视频/);
  assert.match(page, /assetPrompts/);
  assert.match(page, /WhiteboxEditor/);
  assert.match(page, /buildVideoGenerationPackage/);
});

test("keeps model duration and omni-reference limits", async () => {
  const page = await read("../app/page.tsx");

  assert.match(page, /Seedance 2\.0[^\n]*limit: 9[^\n]*minDuration: 4[^\n]*maxDuration: 15/);
  assert.match(page, /Seedance 2\.5[^\n]*limit: 50[^\n]*minDuration: 4[^\n]*maxDuration: 30/);
  assert.match(page, /absoluteMaxOmniReferences = 50/);
});

test("bridge uses structured schemas for analysis and preserves generic shot numbering", async () => {
  const [bridge, mediaSchema, shotSchema] = await Promise.all([
    read("../scripts/shotdirector-bridge.mjs"),
    read("../scripts/media-analysis.schema.json"),
    read("../scripts/shot-revision.schema.json"),
  ]);
  const media = JSON.parse(mediaSchema);
  const shot = JSON.parse(shotSchema);

  assert.match(bridge, /expectedShotIds/);
  assert.match(bridge, /padStart\(2, "0"\)/);
  assert.ok(media.required.includes("shots"));
  assert.ok(media.required.includes("assetPrompts"));
  assert.equal(shot.type, "object");
});

test("project-specific manga migrations are disabled in the clean package", async () => {
  const sources = await Promise.all([
    read("../app/page.tsx"),
    read("../app/storyboard-data.ts"),
    read("../app/blocking-plans.ts"),
    read("../app/manga-panel-mapping.mjs"),
  ]);
  const text = sources.join("\n");

  assert.match(text, /repairedPanelIds: \[\]/);
  assert.match(text, /changed: false/);
  assert.match(text, /blockingPlans[^=]*= \{\}/);
});
