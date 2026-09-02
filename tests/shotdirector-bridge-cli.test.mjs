import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const bridgePath = new URL("../scripts/shotdirector-bridge.mjs", import.meta.url);
const mediaSchemaPath = new URL("../scripts/media-analysis.schema.json", import.meta.url);
const panelBoxesSchemaPath = new URL("../scripts/manga-panel-boxes.schema.json", import.meta.url);

test("bridge allows Codex tasks in source migration packages without git history", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /"--skip-git-repo-check"/);
});

test("reasoning depth is task-locked for manga split, shot prompts and strict review", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /const mangaSplitReasoningEffort = "low"/);
  assert.match(source, /const shotPromptReasoningEffort = "max"/);
  assert.match(source, /const strictReviewReasoningEffort = "max"/);
  assert.match(source, /schemaPath: mangaPanelBoxesSchema,[\s\S]{0,240}?reasoningEffort: mangaSplitReasoningEffort/);
  assert.match(source, /schemaPath: completeShotPromptSchema,\n\s+reasoningEffort: shotPromptReasoningEffort/);
  assert.match(source, /schemaPath: promptReviewSchema,\n\s+reasoningEffort: strictReviewReasoningEffort/);
  assert.match(source, /reasoningEffort: strictReviewReasoningEffort/);
  assert.match(source, /url\.pathname === "\/reasoning-effort"/);
});

test("manga analysis respects the selected generation model duration range", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /if \(!result\.shots\.every\(\(shot\) => hasValidDuration\(shot, payload\)\)\)/);
  assert.doesNotMatch(source, /漫画镜头草稿必须统一为 6–15 秒/);
});

test("full manga analysis uses one-page batches while compact panel geometry may batch four pages", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /const mangaModelBatchPageLimit = 4/);
  assert.match(source, /const mangaAnalysisBatchPageLimit = 1/);
  assert.match(source, /function mangaPageBatches\(mediaFiles, pageLimit = mangaModelBatchPageLimit\)/);
  assert.match(source, /runMangaAnalysisBatched[\s\S]*?mangaPageBatches\(mediaFiles, mangaAnalysisBatchPageLimit\)/);
  assert.match(source, /normalizeMangaAnalysisBatchNumbering\(candidate, scope\)/);
  assert.match(source, /payload\.kind === "manga" && mediaFiles\.length > mangaAnalysisBatchPageLimit/);
});

test("compatible writing models receive attachments and bounded inline video evidence", async () => {
  const source = await readFile(bridgePath, "utf8");

  assert.match(source, /function compatibleAttachmentOnlyMode\(\)/);
  assert.match(source, /当前 API 不提供 view_image 或本地路径读取工具/);
  assert.match(source, /function readBoundedTextEvidence\(filePath, maxBytes, label/);
  assert.match(source, /readSync\(descriptor, buffer, bytesRead, includedBytes - bytesRead, bytesRead\)/);
  assert.match(source, /summaryJson: readBoundedTextEvidence\(extraction\.summaryPath, videoTextEvidenceLimits\.summary/);
  assert.match(source, /mediaMetadata: readBoundedTextEvidence\(extraction\.metadataPath, videoTextEvidenceLimits\.metadata/);
  assert.match(source, /frameManifest: readBoundedTextEvidence\(extraction\.manifestPath, videoTextEvidenceLimits\.manifest/);
  assert.match(source, /audioSilence: readBoundedTextEvidence\(extraction\.audioSilencePath, videoTextEvidenceLimits\.audioSilence/);
  assert.match(source, /<video_text_evidence>/);
  assert.match(source, /promptVisiblePanelEvidence\(evidence/);
});

test("server Codex CLI uses isolated auth, image attachments and an explicit catalog transport", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /MANJING_CODEX_HOME/);
  assert.match(source, /existsSync\(join\(codexHome, "auth\.json"\)\)/);
  assert.match(source, /imagePaths\.flatMap\(\(imagePath\) => \["--image", imagePath\]\)/);
  assert.match(source, /env: \{ \.\.\.process\.env, CODEX_HOME: codexHome \}/);
  assert.match(source, /options\?\.transport === "codex-cli"/);
  assert.match(source, /filter\(\(item\) => !item\.restrictedToSuperadmin \|\| item\.available\)/);
});

test("compatible providers force requested research supplement off and reject claimed sources", async () => {
  const source = await readFile(bridgePath, "utf8");

  assert.match(source, /return primarySupportsWebSearch \? requestedMode : "off"/);
  assert.match(source, /downgraded: requestedMode === "supplement" && effectiveMode === "off"/);
  assert.match(source, /不得声称已搜索，不得编造查询、来源或事实引用/);
  assert.match(source, /if \(!primarySupportsWebSearch\) \{[\s\S]*research\.used \|\| research\.queries\.length \|\| research\.sources\.length \|\| research\.notes\.length/);
  assert.match(source, /committed\.researchPolicy = mediaResearchPolicy\(payload\)/);
});

test("media recovery is isolated by task id and uploaded source filenames", async () => {
  const bridgeSource = await readFile(bridgePath, "utf8");
  const mediaLabSource = await readFile(new URL("../app/media-lab.tsx", import.meta.url), "utf8");

  assert.match(bridgeSource, /matchesExpectedMediaSourceFiles\(result, expectedSourceFiles\)/);
  assert.match(bridgeSource, /recoverLatestMediaAnalysis\(kind, expectedSourceFiles\)/);
  assert.match(bridgeSource, /result = recoverMediaAnalysisResult\(payload\.requestId\);[\s\S]*?catch \{[\s\S]*?result = recoverLatestMediaAnalysis\(kind, expectedSourceFiles\);/);
  assert.match(mediaLabSource, /requestId:\s*job\?\.requestId/);
  assert.match(mediaLabSource, /sourceFiles:\s*visibleQueue\.map\(\(item\) => item\.name\)/);
  assert.match(bridgeSource, /webResearch:\s*result\?\.research\?\.mode === "supplement" \? "supplement" : "off"/);
  assert.match(bridgeSource, /defaultArtStyle:\s*String\(result\?\.shots\?\.\[0\]\?\.artStyle \|\| ""\)\.trim\(\)/);
});

test("media analysis schema does not combine $ref with sibling keywords", async () => {
  const schema = JSON.parse(await readFile(mediaSchemaPath, "utf8"));
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && Object.hasOwn(value, "$ref")) {
      assert.deepEqual(Object.keys(value), ["$ref"]);
    }
    Object.values(value).forEach(visit);
  };
  visit(schema);
});

test("panel box schema stays within structured-output JSON schema support", async () => {
  const schemaText = await readFile(panelBoxesSchemaPath, "utf8");
  assert.doesNotMatch(schemaText, /"uniqueItems"/);
});

test("panel box cache identity is ordered and content-addressed, never filename-addressed", async () => {
  const source = await readFile(bridgePath, "utf8");
  const blockStart = source.indexOf("function mangaScanIndex(");
  const blockEnd = source.indexOf("function mangaPageBatches(", blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart, "cache identity helper block must remain discoverable");
  const context = {
    Buffer,
    closeSync,
    createHash,
    existsSync,
    mangaPanelSourceIdentityVersion: "ordered-sha256-v1",
    openSync,
    readSync,
  };
  runInNewContext(source.slice(blockStart, blockEnd), context);

  const first = { originalName: "same-page.png", sha256: "a".repeat(64) };
  const second = { originalName: "same-page.png", sha256: "b".repeat(64) };
  const firstPlan = context.bindMangaPanelPlanToSources({ status: "completed" }, [first]);
  assert.equal(context.mangaPanelSourceIdentityMatches(firstPlan, [first]), true);
  assert.equal(context.mangaPanelSourceIdentityMatches(firstPlan, [second]), false, "same filename with different bytes must miss the cache");

  const orderedPlan = context.bindMangaPanelPlanToSources({ status: "completed" }, [first, second]);
  assert.equal(context.mangaPanelSourceIdentityMatches(orderedPlan, [second, first]), false, "the same pages in a different order must miss the cache");
  assert.equal(context.mangaPanelSourceIdentityMatches({ status: "completed" }, [first]), false, "legacy plans without hashes must never be reused");

  assert.match(source, /contentHash\.update\(chunk\)/);
  assert.match(source, /resolveBody\(\{ size, sha256: contentHash\.digest\("hex"\) \}\)/);
  assert.match(source, /manga-panel-boxes-\[a-f0-9-\]\{36\}[\s\S]*committed/);
  assert.match(source, /if \(!mangaPanelSourceIdentityMatches\(parsed, mediaFiles\)\) continue/);
});
