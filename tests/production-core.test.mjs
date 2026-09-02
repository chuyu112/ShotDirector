import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectManifest, deriveProductionPipeline, ensureProjectUid, ensureShotUid } from "../app/production-core.mjs";
import { buildCompleteShotPromptRevision, buildShotUpstreamRevision, buildVideoGenerationPackage } from "../app/video-package.ts";

const revisionGlobalSettings = {
  storyBackground: "项目背景",
  characters: ["人物规则"],
  props: ["道具规则"],
  locations: ["场景规则"],
  timeline: [],
  continuity: ["连续性规则"],
  finalVideoStyle: "35mm",
  storyboardImageStyle: "分镜风格",
  modelRules: [],
  negative: ["无字幕"],
};

const revisionShot = {
  shotUid: "shot-stable-a",
  id: "01",
  timecode: "00:00–00:08",
  duration: 8,
  title: "稳定镜头",
  sourceText: ["原文"],
  sourcePanels: ["P01-G01", "P01-G02"],
  artStyle: "成片风格",
  story: "剧情",
  scene: "场景",
  characters: ["人物"],
  props: ["道具"],
  omniReferences: [],
  composition: "构图",
  camera: "摄影机",
  action: "动作",
  dialogue: ["对白"],
  continuity: ["连续"],
  negative: ["禁止项"],
  segments: [{ label: "0–8s", beat: "节拍", framing: "中景", mustShow: ["P01-G01"] }],
};

function upstreamRevision(shot = revisionShot, globalSettings = revisionGlobalSettings) {
  return buildShotUpstreamRevision({
    projectTitle: "测试项目",
    modelId: "seedance-2.5",
    globalSettings,
    shot,
  });
}

function completeRevision(shot = revisionShot, overrides = {}) {
  return buildCompleteShotPromptRevision({
    projectTitle: "测试项目",
    modelId: "seedance-2.5",
    globalSettings: revisionGlobalSettings,
    shot,
    shotAnnotations: { note: "保留批注" },
    panelAnnotations: { "P01-G01": "画格批注" },
    sourceMangaRequestId: "manga-request-1",
    ...overrides,
  });
}

function videoPackage(shot = revisionShot, globalSettings = revisionGlobalSettings) {
  return buildVideoGenerationPackage({
    projectTitle: "测试项目",
    modelId: "seedance-2.5",
    modelLabel: "Seedance 2.5",
    referenceLimit: 50,
    minDuration: 6,
    maxDuration: 30,
    globalSettings,
    shot,
    approved: true,
    approvedAt: "2026-08-29T00:00:00.000Z",
    promptReviewCurrent: true,
    layoutViewKeys: [],
    directorViewKeys: [],
    whiteboxLocks: [],
    artworkStatus: "empty",
    artworkNames: [],
    selectedArtworkIndex: 0,
  });
}

test("stable identities survive display-number changes", () => {
  const projectUid = ensureProjectUid("", "chapter-01");
  const shotUid = ensureShotUid("", projectUid, "P01-G01|P01-G02");
  assert.equal(ensureProjectUid(projectUid, "different"), projectUid);
  assert.equal(ensureShotUid(shotUid, projectUid, "renumbered-to-09"), shotUid);
  assert.notEqual(ensureShotUid("", projectUid, "P01-G03"), shotUid);
});

test("pipeline never unlocks paid video before user confirmation", () => {
  const pipeline = deriveProductionPipeline({
    hasMangaSource: true,
    structureConfirmed: true,
    shotCount: 2,
    scriptAppliedCount: 2,
    promptReadyCount: 2,
    promptReviewedCount: 2,
    approvedCount: 0,
    videoReadyCount: 0,
  });
  assert.equal(pipeline.find((stage) => stage.id === "review")?.status, "completed");
  assert.equal(pipeline.find((stage) => stage.id === "video")?.status, "blocked");
});

test("manifest separates stable shot identity from editable display number", () => {
  const projectUid = ensureProjectUid("", "chapter-02");
  const shotUid = ensureShotUid("", projectUid, "P02-G01");
  const manifest = buildProjectManifest({
    projectUid,
    projectTitle: "测试项目",
    sourceName: "chapter-02.png",
    generationModel: "seedance-2.5",
    pipeline: [],
    shots: [{ shotUid, displayNumber: "07", title: "重编号镜头", sourcePanels: ["P02-G01"], approved: false }],
  });
  assert.equal(manifest.shots[0].shotUid, shotUid);
  assert.equal(manifest.shots[0].displayNumber, "07");
});

test("shot revisions survive display id and timecode changes for one stable shotUid", () => {
  const renumbered = { ...revisionShot, id: "09", timecode: "01:12–01:20" };
  assert.equal(upstreamRevision(renumbered), upstreamRevision());
  assert.equal(completeRevision(renumbered), completeRevision());

  const before = videoPackage();
  const after = videoPackage(renumbered);
  assert.equal(after.packageId, before.packageId);
  assert.equal(after.sourceRevision, before.sourceRevision);
  assert.equal(after.shotId, "09");
  assert.equal(after.timecode, "01:12–01:20");
});

test("shot revisions keep different stable shotUid values isolated", () => {
  const otherShot = { ...revisionShot, shotUid: "shot-stable-b" };
  assert.notEqual(upstreamRevision(otherShot), upstreamRevision());
  assert.notEqual(completeRevision(otherShot), completeRevision());
  assert.notEqual(videoPackage(otherShot).packageId, videoPackage().packageId);
  assert.notEqual(videoPackage(otherShot).sourceRevision, videoPackage().sourceRevision);
});

test("creative source, duration, annotations, and global settings still invalidate revisions", () => {
  const regrouped = { ...revisionShot, sourcePanels: ["P01-G01", "P01-G02", "P01-G03"] };
  const retimed = { ...revisionShot, duration: 12 };
  const revisedGlobalSettings = { ...revisionGlobalSettings, finalVideoStyle: "另一个35mm风格" };

  assert.notEqual(upstreamRevision(regrouped), upstreamRevision());
  assert.notEqual(upstreamRevision(retimed), upstreamRevision());
  assert.notEqual(upstreamRevision(revisionShot, revisedGlobalSettings), upstreamRevision());
  assert.notEqual(completeRevision(revisionShot, { shotAnnotations: { note: "修改后批注" } }), completeRevision());
  assert.notEqual(completeRevision(revisionShot, { panelAnnotations: { "P01-G01": "修改后画格批注" } }), completeRevision());
  assert.notEqual(videoPackage(regrouped).sourceRevision, videoPackage().sourceRevision);
  assert.notEqual(videoPackage(retimed).sourceRevision, videoPackage().sourceRevision);
  assert.notEqual(videoPackage(revisionShot, revisedGlobalSettings).sourceRevision, videoPackage().sourceRevision);
});
