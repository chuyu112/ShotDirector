import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const workspace = process.cwd();
const requestId = "a7501ea0-9880-47b3-a61a-8ebcadb2f46f";
const analysisPath = join(workspace, "work", "shotdirector-responses", `media-analysis-${requestId}.committed.json`);
const boxPlanPath = join(workspace, "work", "shotdirector-responses", "manga-panel-boxes-152cd028-2dfc-475b-8a9e-eac1502a5dfc.json");
const draftPath = join(workspace, "work", "shotdirector-draft-state", `${requestId}.json`);
const cropDir = join(workspace, "work", "shotdirector-media", "jobs", requestId, "panel-crops");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join(workspace, "work", "shotdirector-recut-backups", stamp);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function area(bounds) {
  return Math.max(0, bounds.width) * Math.max(0, bounds.height);
}

function intersection(left, right) {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function overlapScore(left, right) {
  const overlap = intersection(left, right);
  if (!overlap) return 0;
  // Prefer the old crop that explains most of the new frame. This also maps
  // newly discovered small frames out of a formerly over-large aggregate.
  return overlap / Math.max(0.0001, area(left));
}

function bestOldPanel(newBounds, oldPanels) {
  return oldPanels
    .map((panel) => ({ panel, score: overlapScore(newBounds, panel.bounds) }))
    .sort((a, b) => b.score - a.score)[0]?.panel;
}

function pageSide(box) {
  const centerX = box.bounds.x + box.bounds.width / 2;
  return centerX >= 50 ? "R" : "L";
}

function panelId(scanIndex, side, index) {
  return `P${String(scanIndex).padStart(2, "0")}-${side}-G${String(index).padStart(2, "0")}`;
}

function replaceAffectedPanelIds(ids, replacementByOldId) {
  return ids.flatMap((id) => replacementByOldId.get(id) || (affectedPanelId(id) ? [] : [id]));
}

function affectedPanelId(id) {
  const match = /^P(\d{2})-([RL])-G\d{2}$/.exec(id);
  if (!match) return false;
  const scanIndex = Number(match[1]);
  if (scanIndex > 4) return true;
  return scanIndex === 4 && match[2] === "L" && id >= "P04-L-G03";
}

for (const required of [analysisPath, boxPlanPath, draftPath]) {
  if (!existsSync(required)) throw new Error(`缺少切图迁移输入：${required}`);
}

mkdirSync(backupDir, { recursive: true });
cpSync(analysisPath, join(backupDir, basename(analysisPath)));
cpSync(draftPath, join(backupDir, basename(draftPath)));
if (existsSync(cropDir)) cpSync(cropDir, join(backupDir, "panel-crops"), { recursive: true });

const analysis = readJson(analysisPath);
const boxPlan = readJson(boxPlanPath);
const draft = readJson(draftPath);
const correctedBoxPlan = structuredClone(boxPlan);
const nestedPage = correctedBoxPlan.pages.find((page) => page.scanIndex === 8);
if (nestedPage) {
  nestedPage.boxes = nestedPage.boxes.flatMap((box) => {
    if (box.tempId === "B10") {
      return [
        { ...box, tempId: "B10A", bounds: { x: 20.1, y: 49, width: 12.7, height: 21.2 }, readingOrder: 10 },
        { ...box, tempId: "B10B", bounds: { x: 20.1, y: 71.5, width: 12.7, height: 20.7 }, readingOrder: 10.1 },
      ];
    }
    if (box.tempId === "B11") {
      return [
        { ...box, tempId: "B11A", bounds: { x: 5.7, y: 49, width: 14.1, height: 21.2 }, readingOrder: 11 },
        { ...box, tempId: "B11B", bounds: { x: 5.7, y: 71.5, width: 14.1, height: 20.7 }, readingOrder: 11.1 },
      ];
    }
    return [box];
  });
}
const replacementByOldId = new Map();
const oldPanelForNewId = new Map();
const newPanelsByShot = new Map();
const existingUnderstanding = draft.state.sourceMangaPanels || {};
const existingAnnotations = draft.state.sourceMangaPanelAnnotations || {};
const newUnderstanding = Object.fromEntries(
  Object.entries(existingUnderstanding).filter(([id]) => !affectedPanelId(id)),
);
const newAnnotations = Object.fromEntries(
  Object.entries(existingAnnotations).filter(([id]) => !affectedPanelId(id)),
);

const shotForSide = new Map([
  ["4-L", "04"], ["5-R", "04"], ["5-L", "05"],
  ["6-R", "06"], ["6-L", "07"], ["7-R", "08"],
  ["8-R", "09"], ["8-L", "10"], ["9-R", "11"],
  ["9-L", "12"], ["10-R", "13"], ["10-L", "14"],
  ["11-R", "15"], ["11-L", "16"], ["12-R", "17"],
]);

for (const page of analysis.mangaPages) {
  if (page.scanIndex < 4) continue;
  const planPage = correctedBoxPlan.pages.find((item) => item.scanIndex === page.scanIndex);
  if (!planPage?.boxes?.length) throw new Error(`第 ${page.scanIndex} 页没有新框`);

  const untouched = page.scanIndex === 4
    ? page.panels.filter((panel) => !affectedPanelId(panel.id))
    : [];
  const oldAffected = page.panels.filter((panel) => affectedPanelId(panel.id));
  const sideCounters = { R: 0, L: 0 };
  const generated = [];

  for (const box of [...planPage.boxes].sort((a, b) => a.readingOrder - b.readingOrder)) {
    const side = pageSide(box);
    sideCounters[side] += 1;
    const id = panelId(page.scanIndex, side, sideCounters[side]);
    if (page.scanIndex === 4 && !affectedPanelId(id)) continue;
    const oldPanel = bestOldPanel(box.bounds, oldAffected);
    const panel = {
      ...(oldPanel || {}),
      id,
      bounds: box.bounds,
      kind: "story",
      includeInShots: true,
    };
    delete panel.cropMasks;
    generated.push(panel);
    if (oldPanel) {
      oldPanelForNewId.set(id, oldPanel.id);
      const replacements = replacementByOldId.get(oldPanel.id) || [];
      replacements.push(id);
      replacementByOldId.set(oldPanel.id, replacements);
      if (existingUnderstanding[oldPanel.id]) newUnderstanding[id] = structuredClone(existingUnderstanding[oldPanel.id]);
      if (existingAnnotations[oldPanel.id]) newAnnotations[id] = existingAnnotations[oldPanel.id];
    }
    const shotId = shotForSide.get(`${page.scanIndex}-${side}`);
    if (shotId) {
      const ids = newPanelsByShot.get(shotId) || [];
      ids.push(id);
      newPanelsByShot.set(shotId, ids);
    }
  }

  page.panels = [...untouched, ...generated];
  page.readingOrder = page.panels.filter((panel) => panel.includeInShots).map((panel) => panel.id);
}

// Keep the reusable media result internally consistent for future imports.
for (const shot of analysis.shots || []) {
  shot.sourcePanels = replaceAffectedPanelIds(shot.sourcePanels || [], replacementByOldId);
}
analysis.panelBoxPlan = correctedBoxPlan;
analysis.completedAt = new Date().toISOString();

for (const review of draft.state.reviews) {
  const shotId = review.shot.id;
  if (Number.parseInt(shotId, 10) < 4) continue;
  const sourcePanels = newPanelsByShot.get(shotId) || [];
  review.shot.sourcePanels = sourcePanels;
  review.shot.sourceText = sourcePanels.map((id) => {
    const oldId = oldPanelForNewId.get(id);
    const oldLine = review.shot.sourceText?.find((line) => oldId && line.startsWith(`${oldId} `));
    return oldLine ? oldLine.replace(oldId, id) : `${id} 原作画格，剧情与构图以新裁图为准。`;
  });
  review.approved = false;
  delete review.approvedAt;
  review.completePromptStatus = "empty";
  review.completePrompt = "";
  review.completePromptSummary = "";
  review.completePromptWarnings = [];
}

draft.state.sourceMangaPanels = newUnderstanding;
draft.state.sourceMangaPanelAnnotations = newAnnotations;
draft.agentRevision = `recut-shot04-${Date.now()}`;
draft.agentPending = true;
draft.savedAt = new Date().toISOString();

writeJson(analysisPath, analysis);
writeJson(draftPath, draft);

if (existsSync(cropDir)) {
  const archivedCropDir = `${cropDir}.pre-recut-${stamp}`;
  renameSync(cropDir, archivedCropDir);
}

const counts = analysis.mangaPages
  .filter((page) => page.scanIndex >= 4)
  .map((page) => ({ scanIndex: page.scanIndex, panels: page.panels.length }));
console.log(JSON.stringify({ backupDir, agentRevision: draft.agentRevision, counts, shots: Object.fromEntries(newPanelsByShot) }, null, 2));
