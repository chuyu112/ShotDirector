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

  assert.match(layout, /漫镜 Manjing｜AI 导演工作台/);
  assert.match(layout, /NEXT_PUBLIC_MANJING_SITE_URL/);
  assert.match(layout, /metadataBase: new URL\(publicSiteUrl\)/);
  assert.doesNotMatch(layout, /localhost:3000/);
  assert.match(page, /const defaultProjectTitle = "未命名项目"/);
  assert.match(page, /sourceName: "空白项目模板"/);
  assert.match(page, /createReviews\(storyboardShots, false, projectUid\)/);
  assert.match(page, /ensureProjectUid\("", storyboardSourceRevision\)/);
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
  assert.match(rules, /临时导演预演分镜工作图/);
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

test("copy buttons fall back when the Clipboard API is unavailable or denied", async () => {
  const page = await read("../app/page.tsx");

  assert.match(page, /async function copyTextToClipboard/);
  assert.match(page, /navigator\.clipboard\?\.writeText/);
  assert.match(page, /document\.execCommand\("copy"\)/);
  assert.match(page, /copyTextToClipboard\(review\.completePrompt\)/);
  assert.match(page, /copyTextToClipboard\(targetPackage\.prompt\)/);
});

test("runs prompt review as an isolated non-approving reviewer task", async () => {
  const [page, bridge, schemaText] = await Promise.all([
    read("../app/page.tsx"),
    read("../scripts/shotdirector-bridge.mjs"),
    read("../scripts/prompt-review.schema.json"),
  ]);
  const schema = JSON.parse(schemaText);
  const strictReviewStart = page.indexOf('if (deskMode === "strict-review")');
  const creatorDeskStart = page.indexOf('<main className="app-shell">', strictReviewStart);
  const strictReviewBranch = page.slice(strictReviewStart, creatorDeskStart);

  assert.ok(strictReviewStart >= 0 && creatorDeskStart > strictReviewStart, "strict review must be an independent render branch");
  assert.match(strictReviewBranch, /strict-review-shell/);
  assert.match(strictReviewBranch, /STRICT REVIEW · 只审不改/);
  assert.match(strictReviewBranch, /没有编辑、重新生成、应用建议或批准入口/);
  assert.match(strictReviewBranch, /CREATOR PROMPT · READ ONLY/);
  assert.doesNotMatch(strictReviewBranch, /stampCurrentShot|generateCompleteShotPrompt|updateCompleteShotPrompt|<textarea/);
  assert.match(page, /promptReviewSourceRevision/);
  assert.match(page, /const promptReviewArtifactIsCurrent = review\.promptReviewStatus === "ready"/);
  assert.match(page, /const promptReviewIsCurrent = promptReviewArtifactIsCurrent[\s\S]*?verdict === "discussion-ready"/);
  assert.match(page, /operationMode: "strict-review"/);
  assert.match(bridge, /--ephemeral/);
  assert.match(bridge, /SHOTDIRECTOR_REVIEWERS_JSON/);
  assert.match(bridge, /review-shot-prompt/);
  assert.match(bridge, /不能输出修改后的完整提示词/);
  assert.match(bridge, /assertStrictReviewRequest\(payload\)/);
  assert.match(bridge, /reviewSnapshotHash/);
  assert.deepEqual(schema.properties.report.properties.verdict.enum, ["discussion-ready", "needs-revision"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.evidence.properties.mode.enum, ["direct-images", "structured-panel-evidence"]);
});

test("keeps Creator and Reviewer model lineage explicit across legacy state and UI selection", async () => {
  const page = await read("../app/page.tsx");

  assert.match(page, /const legacyUnknownModelId = "legacy-unknown"/);
  assert.match(page, /completePromptGeneratorId: result\.generatorId\?\.trim\(\) \|\| legacyUnknownModelId/);
  assert.match(page, /completePromptGeneratorProvider: result\.generatorProvider\?\.trim\(\) \|\| undefined/);
  assert.match(page, /completePromptRequestedGeneratorId: result\.requestedGeneratorId\?\.trim\(\) \|\| undefined/);
  assert.match(page, /const savedPromptReviewer = reviewerOptions\.find\(\(item\) => item\.id === review\.promptReviewerId\)/);
  assert.match(page, /const selectedPromptReviewer = savedPromptReviewer \|\| reviewerOptions\.find\(\(item\) => item\.available\) \|\| reviewerOptions\[0\]/);
  assert.match(page, /Creator 模型：/);
  assert.match(page, /Reviewer 模型/);
  assert.match(page, /evidenceMode\?: "direct-images" \| "structured-panel-evidence"/);
  assert.match(page, /promptReviewerModel: result\.reviewerModel\?\.trim\(\) \|\| undefined/);
  assert.match(page, /currentGeneratorId\.endsWith\("\+human-edited"\)/);
  assert.match(page, /currentGeneratorId \? `\$\{currentGeneratorId\}\+human-edited` : "human-edited"/);
  assert.match(page, /completePromptGeneratorProvider: "human-editor"/);
});

test("requires shot-structure approval before downstream generation", async () => {
  const [page, styles] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/globals.css"),
  ]);

  assert.match(page, /structureStatus: "draft"/);
  assert.match(page, /组合选中画格为一个 Shot/);
  assert.match(page, /删除选中画格/);
  assert.match(page, /选中画格拆成单格/);
  assert.match(page, /并入前一组/);
  assert.match(page, /撤销上一步/);
  assert.match(page, /新增手绘分镜（未来）/);
  assert.match(page, /放大查看图和文字/);
  assert.match(page, /panel-lightbox/);
  assert.match(page, /单击缩回小图/);
  assert.doesNotMatch(page, /\[1, 1\.5, 2\]/);
  assert.match(page, /画面理解/);
  assert.match(page, /对白原文/);
  assert.match(page, /出场人物/);
  assert.match(page, /人物关系与剧情/);
  assert.match(page, /panel-lightbox-understanding/);
  assert.match(page, /对这张图的批注/);
  assert.match(page, /自动保存到当前漫画草稿/);
  assert.match(page, /sourceMangaPanelAnnotations/);
  assert.match(page, /mangaPanelUnderstandingsFrom/);
  assert.match(page, /panel-shot-approved/);
  assert.match(page, /✓ 已批准/);
  assert.match(page, /panel-shot-groups-top/);
  assert.match(styles, /\.panel-shot-groups-top \{ position: sticky; top: 76px;/);
  assert.match(styles, /background: #175cff/);
  assert.match(page, /syncPanelAssemblyFromTop/);
  assert.match(page, /syncPanelAssemblyFromBottom/);
  assert.match(page, /ArrowLeft/);
  assert.match(page, /续传漫画/);
  assert.match(page, /生成完整提示词讨论稿/);
  assert.match(page, /进入严格审核台/);
  assert.match(page, /审核台是独立只读版本/);
  assert.match(page, /无修改权 · 无批准权/);
  assert.match(page, /onClick=\{\(\) => void stampCurrentShot\(\)\}/);
  assert.match(page, /签字盖章 · 审批通过/);
  assert.match(page, /buildPromptReviewRevision/);
  assert.match(page, /promptReviewIsCurrent/);
  assert.match(page, /approved: false/);
  assert.match(page, /批准当前 Shot 后，单独解锁本镜资产/);
  assert.match(page, /buildCompleteShotPromptRevision/);
  assert.match(page, /completePromptConfirmedAt/);
  assert.match(page, /complete-shot-prompt/);
  assert.match(page, /review\.completePromptStatus === "generating" && !matchingTerminalJob/);
  assert.match(page, /updateCurrentShotDuration/);
  assert.match(page, /\[6, 8, 10, 12, 15, 20, 25, 30\]/);
  assert.match(page, /id: "seedance-2\.5"[\s\S]*maxDuration: 30/);
  assert.match(page, /批准当前 Shot 后，单独解锁本镜资产/);
  assert.match(page, /state\.reviews\.filter\(\(item\) => item\.approved\)\.map/);
  assert.match(page, /shot-asset-v2::shot-/);
  assert.match(page, /只用于 Shot/);
  assert.doesNotMatch(page, /同名资产会在其他 Shot 自动复用/);
});

test("estimates shot timing from dialogue and visual action without double counting", async () => {
  const [page, bridge, rulesText] = await Promise.all([
    read("../app/page.tsx"),
    read("../scripts/shotdirector-bridge.mjs"),
    read("../config/workflow-rules.json"),
  ]);

  assert.match(page, /function estimateShotTiming/);
  assert.match(page, /return \[\.\.\.visible\]\.length \/ 7/);
  assert.match(page, /Math\.max\(dialogueSeconds, visualSeconds \+ actionReactionSeconds\)/);
  assert.match(page, /估算需/);
  assert.match(page, /按日语成片对白/);
  assert.match(bridge, /总时长=max（全部对白时间，完整视觉动作链时间）/);
  assert.match(bridge, /有效字符数÷7/);
  assert.match(rulesText, /允许对白与动作并行，不重复相加/);
});

test("City Hunter final video style stays strictly live action", async () => {
  const [page, bridge] = await Promise.all([
    read("../app/page.tsx"),
    read("../scripts/shotdirector-bridge.mjs"),
  ]);

  assert.match(page, /写实日本真人35mm电影风格/);
  assert.match(page, /所有角色均由真实日本演员出演/);
  assert.match(bridge, /最终成片必须严格服从项目已确认的写实真人电影风格/);
  assert.match(bridge, /research\.used \|\| research\.queries\.length \|\| research\.sources\.length \|\| research\.notes\.length/);
});

test("confirmed Shot prompt inspects panels and keeps verifiable research evidence", async () => {
  const [bridge, schema] = await Promise.all([
    read("../scripts/shotdirector-bridge.mjs"),
    read("../scripts/complete-shot-prompt.schema.json"),
  ]);

  assert.match(bridge, /completeShotPromptAgentPrompt/);
  assert.match(bridge, /createMangaPanelCrop/);
  assert.match(bridge, /view_image/);
  assert.match(bridge, /webSearch: primarySupportsWebSearch \? "live" : "disabled"/);
  assert.match(bridge, /当前任务没有提供联网工具/);
  assert.match(bridge, /不得声称已经搜索、不得伪造来源/);
  assert.match(bridge, /"\/complete-shot-prompt": generateCompleteShotPrompt/);
  assert.match(schema, /"imagesInspected"/);
  assert.match(schema, /"panelAnnotationCount"/);
  assert.match(schema, /"backgroundUsed"/);
  assert.match(schema, /"artStyleUsed"/);
});

test("Shot prompt controls use stable identities and do not globally block parallel prompt work", async () => {
  const page = await read("../app/page.tsx");

  assert.match(page, /function stableShotIdentity/);
  assert.match(page, /return identity\.shotUid \? shotUid === identity\.shotUid : shot\.id === identity\.fallbackId/);
  assert.match(page, /function completePromptResultMatchesStableShot/);
  assert.match(page, /function openCompleteShotPrompt/);
  assert.match(page, /scrollToCompleteShotPromptPanel/);
  assert.match(page, /const targetShotIdentity = stableShotIdentity\(targetReview\.shot\)/);
  assert.match(page, /matchesStableShotIdentity\(item\.shot, targetShotIdentity\)/);
  assert.match(page, /projectUid: submittedProjectUid/);
  assert.match(page, /promptJobs: Array\.isArray\(value\.promptJobs\)/);
  assert.match(page, /lastPromptJobs: Array\.isArray\(value\.lastPromptJobs\)/);
  assert.match(page, /const matchingLiveJob = \(bridge\.promptJobs \|\| \[\]\)\.find/);
  assert.match(page, /const matchingTerminalJob = \(bridge\.lastPromptJobs \|\| \[\]\)\.find/);
  assert.match(page, /const terminalJobStamp = matchingTerminalJob/);
  assert.match(page, /projectUid: state\.projectUid,[\s\S]*shotUid: recoveryShotIdentity\.shotUid,[\s\S]*shotId: recoveryShotIdentity\.fallbackId,[\s\S]*sourceRevision: recoverySourceRevision/);
  assert.match(page, /completePromptStatus: review\.completePromptStatus === "generating"[\s\S]*\? review\.completePromptStatus/);
  assert.match(page, /item\.completePromptStatus === "ready" && item\.completePrompt\?\.trim\(\)[\s\S]*openCompleteShotPrompt\(reviewIndex\)/);
  assert.match(page, /currentShot: targetIndex >= 0 \? targetIndex : previous\.currentShot/);
  assert.match(page, /已生成 · 查看／提交审查/);

  const topEntryStart = page.indexOf("top-shot-prompt-bar");
  const cardEntryStart = page.indexOf("complete-shot-prompt-button");
  const titleEntryStart = page.indexOf("shot-title-prompt-button");
  assert.ok(topEntryStart >= 0 && cardEntryStart >= 0 && titleEntryStart >= 0);
  const topEntry = page.slice(topEntryStart, page.indexOf("shot-structure-review", topEntryStart));
  const cardEntry = page.slice(cardEntryStart, page.indexOf("panel-shot-images", cardEntryStart));
  const titleEntry = page.slice(titleEntryStart, page.indexOf("shot-state", titleEntryStart));
  for (const entry of [topEntry, cardEntry, titleEntry]) {
    assert.match(entry, /openCompleteShotPrompt/);
    assert.doesNotMatch(entry, /disabled=\{bridge\.busy/);
  }
  assert.doesNotMatch(page, /className="button primary" disabled=\{bridge\.busy \|\| review\.completePromptStatus/);
  assert.match(page, /disabled=\{bridge\.busy \|\| review\.promptReviewStatus === "reviewing"/);
});

test("manga panel detection enforces Box-to-Box while allowing intentional overlap", async () => {
  const [bridge, boxSchema] = await Promise.all([
    read("../scripts/shotdirector-bridge.mjs"),
    read("../scripts/manga-panel-boxes.schema.json"),
  ]);

  assert.match(bridge, /每个矩形只对应一个独立漫画画格/);
  assert.match(bridge, /已有2–3条可信边/);
  assert.match(bridge, /多个矩形允许重叠/);
  assert.match(bridge, /小伞等非关键越界细节/);
  assert.match(bridge, /MANJING_MANGA_CROP_MODEL/);
  assert.match(bridge, /cropReviewRequired/);
  assert.match(bridge, /detecting-panel-boxes/);
  assert.match(bridge, /missingEdges/);
  assert.match(boxSchema, /detectionOrder/);
  assert.match(boxSchema, /readingOrder/);
});

test("completed manga analysis can reopen directly as an independent draft", async () => {
  const page = await read("../app/page.tsx");

  assert.match(page, /get\("importDraft"\)/);
  assert.match(page, /media-job-result\?requestId=/);
  assert.match(page, /media-recover/);
  assert.match(page, /recoverLatest/);
  assert.match(page, /JSON\.stringify\(\{ kind: "manga" \}\)/);
  assert.match(page, /createMaterialDraft\(result\)/);
  assert.match(page, /shotdirector-recent-material-draft-v1/);
  assert.match(page, /window\.location\.replace\(`\/\?draft=/);
  assert.match(page, /打开主工作区/);
  assert.match(page, /window\.location\.href = "\/\?main=1"/);
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

  assert.match(page, /Seedance 2\.0[^\n]*limit: 9[^\n]*minDuration: 6[^\n]*maxDuration: 15/);
  assert.match(page, /Seedance 2\.5[^\n]*limit: 50[^\n]*minDuration: 6[^\n]*maxDuration: 30/);
  assert.match(page, /absoluteMaxOmniReferences = 50/);
});

test("web research control follows the active writing provider capability", async () => {
  const [page, mediaLab] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/media-lab.tsx"),
  ]);

  assert.match(page, /modelProvider: value\.modelProvider/);
  assert.match(page, /supportsWebSearch=\{bridge\.modelProvider\?\.supportsWebSearch === true\}/);
  assert.match(mediaLab, /webResearch: kind === "manga" && supportsWebSearch && allowWebResearch \? "supplement" : "off"/);
  assert.match(mediaLab, /disabled=\{!supportsWebSearch\}/);
  assert.match(mediaLab, /当前 GLM\/Kimi 写作 API 没有联网工具，已强制关闭/);
  assert.match(mediaLab, /visibleResult\.researchPolicy\?\.downgraded/);
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
  assert.match(bridge, /shot\.duration >= minDuration && shot\.duration <= maxDuration/);
  assert.match(bridge, /不是“一格机械等于一镜”/);
  assert.match(bridge, /相同地点、时间和摄影机意图下的连续反应格可合并/);
  assert.match(bridge, /技术限制只能在 provider 适配层解决/);
  assert.doesNotMatch(bridge, /普通中文对白按每秒约 4 个汉字估算/);
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
