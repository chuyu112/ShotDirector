import { buildManjingAgentContract } from "./manjing-agent-contract.mjs";

const uidPattern = /^(?:project|shot)-[a-z0-9][a-z0-9-]{5,}$/i;

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function stableUid(kind, seed) {
  const prefix = kind === "project" ? "project" : "shot";
  return `${prefix}-${hashText(`${prefix}::${String(seed || "unseeded")}`)}`;
}

export function ensureProjectUid(candidate, seed) {
  const value = String(candidate || "").trim();
  return uidPattern.test(value) && value.startsWith("project-") ? value : stableUid("project", seed);
}

export function ensureShotUid(candidate, projectUid, seed) {
  const value = String(candidate || "").trim();
  return uidPattern.test(value) && value.startsWith("shot-")
    ? value
    : stableUid("shot", `${ensureProjectUid(projectUid, "legacy-project")}::${String(seed || "unseeded-shot")}`);
}

function stage(id, label, status, detail, count) {
  return { id, label, status, detail, count };
}

/**
 * Build the visible production state from durable project facts. The UI does
 * not manually advance these stages, so reopening an older project cannot
 * falsely mark work as completed.
 */
export function deriveProductionPipeline(input) {
  const shotCount = Math.max(0, Number(input.shotCount) || 0);
  const promptReadyCount = Math.max(0, Number(input.promptReadyCount) || 0);
  const promptReviewedCount = Math.max(0, Number(input.promptReviewedCount) || 0);
  const approvedCount = Math.max(0, Number(input.approvedCount) || 0);
  const hasGlobalDefinition = input.hasGlobalDefinition === undefined ? true : Boolean(input.hasGlobalDefinition);
  const hasMangaUpload = Boolean(input.hasMangaUpload ?? input.hasMangaSource);
  const croppedPanelCount = Math.max(0, Number(input.croppedPanelCount) || (hasMangaUpload ? 1 : 0));
  const analyzedPanelCount = Math.max(0, Number(input.analyzedPanelCount) || (input.hasMangaSource ? croppedPanelCount : 0));
  const structureConfirmed = Boolean(input.structureConfirmed);
  const approvalChainValid = approvedCount <= shotCount
    && approvedCount <= promptReadyCount
    && approvedCount <= promptReviewedCount;

  return [
    stage("global", "全局定义", hasGlobalDefinition ? "completed" : "active", hasGlobalDefinition ? "故事背景与最终风格已定义" : "先定义故事背景与最终风格", hasGlobalDefinition ? 1 : 0),
    stage("upload", "上传漫画", !hasGlobalDefinition ? "pending" : hasMangaUpload ? "completed" : "active", hasMangaUpload ? "漫画原图已保存" : "等待上传漫画原图", hasMangaUpload ? 1 : 0),
    stage("crop", "裁剪漫画", !hasMangaUpload ? "pending" : croppedPanelCount > 0 ? "completed" : "active", croppedPanelCount ? `${croppedPanelCount} 个画格已裁出` : "等待确认并裁出画格", croppedPanelCount),
    stage("analyze", "分析漫画", !croppedPanelCount ? "pending" : analyzedPanelCount >= croppedPanelCount ? "completed" : "active", `${Math.min(analyzedPanelCount, croppedPanelCount)}/${croppedPanelCount} 个画格已分析`, analyzedPanelCount),
    stage("group", "组合分镜", analyzedPanelCount < croppedPanelCount ? "pending" : structureConfirmed ? "completed" : "active", structureConfirmed ? `${shotCount} 个 Shot 组合已确认` : "等待检查和确认 Shot 组合", shotCount),
    stage("prompt", "生成提示词", !structureConfirmed ? "pending" : shotCount > 0 && promptReadyCount === shotCount ? "completed" : "active", `${promptReadyCount}/${shotCount} 镜完整提示词已生成`, promptReadyCount),
    stage("review", "审核", !promptReadyCount ? "pending" : shotCount > 0 && promptReviewedCount === shotCount ? "completed" : "active", `${promptReviewedCount}/${shotCount} 镜通过独立 AI Reviewer；保留联网证据`, promptReviewedCount),
    stage("confirm", "确认终稿", !promptReviewedCount || !approvalChainValid ? "pending" : shotCount > 0 && approvedCount === shotCount ? "completed" : "active", `${approvedCount}/${shotCount} 镜已由用户确认终稿`, approvedCount),
  ];
}

export function buildProjectManifest(input) {
  const pipeline = Array.isArray(input.pipeline) ? input.pipeline : [];
  const shots = Array.isArray(input.shots) ? input.shots : [];
  const manifest = {
    manifestVersion: 1,
    product: "漫镜 Manjing",
    project: {
      projectUid: ensureProjectUid(input.projectUid, `${input.projectTitle || "未命名项目"}::${input.sourceName || ""}`),
      title: String(input.projectTitle || "未命名项目"),
      sourceName: String(input.sourceName || ""),
      generationModel: String(input.generationModel || ""),
      sourceMangaRequestId: input.sourceMangaRequestId || undefined,
    },
    pipeline,
    shots: shots.map((item, index) => ({
      shotUid: ensureShotUid(item.shotUid, input.projectUid, `${item.displayNumber || index + 1}::${(item.sourcePanels || []).join("|")}`),
      displayNumber: String(item.displayNumber || String(index + 1).padStart(2, "0")),
      title: String(item.title || ""),
      sourcePanels: Array.isArray(item.sourcePanels) ? item.sourcePanels : [],
      scriptStatus: item.scriptStatus,
      completePromptStatus: item.completePromptStatus,
      promptReviewStatus: item.promptReviewStatus,
      promptReviewVerdict: item.promptReviewVerdict,
      approved: Boolean(item.approved),
      approvedAt: item.approvedAt,
      videoPackageStatus: item.videoPackageStatus,
      sourceRevision: item.sourceRevision,
    })),
  };
  return {
    ...manifest,
    agentContract: buildManjingAgentContract(manifest),
  };
}

// Chinese labels for the seven script sections users fill per shot.
const scriptSectionLabels = {
  characters: "人物",
  scene: "物品和场景",
  story: "剧情",
  action: "动作",
  continuity: "连续",
  style: "美术风格",
  director: "DIRECTOR VIEW",
};

const scriptSectionOrder = ["characters", "scene", "story", "action", "continuity", "style", "director"];

/**
 * Export the full production script: global art settings plus every shot's
 * script text, structured fields, complete prompt and approval state. This is
 * the handoff document for video generation; statuses alone live in the
 * manifest above.
 */
export function buildProjectScript(input) {
  const shots = Array.isArray(input.shots) ? input.shots : [];
  const projectUid = ensureProjectUid(input.projectUid, `${input.projectTitle || "未命名项目"}::${input.sourceName || ""}`);
  return {
    scriptVersion: 1,
    product: "漫镜 Manjing",
    project: {
      projectUid,
      title: String(input.projectTitle || "未命名项目"),
      sourceName: String(input.sourceName || ""),
      generationModel: String(input.generationModel || ""),
    },
    globalSettings: input.globalSettings && typeof input.globalSettings === "object" ? input.globalSettings : {},
    shots: shots.map((item, index) => {
      const annotations = item.annotations && typeof item.annotations === "object" ? item.annotations : {};
      const script = {};
      for (const sectionId of scriptSectionOrder) {
        const text = String(annotations[sectionId] || "").trim();
        if (text) script[scriptSectionLabels[sectionId]] = text;
      }
      const shot = item.shot && typeof item.shot === "object" ? item.shot : {};
      return {
        shotUid: ensureShotUid(item.shotUid, projectUid, `${item.displayNumber || index + 1}::${(item.sourcePanels || []).join("|")}`),
        displayNumber: String(item.displayNumber || String(index + 1).padStart(2, "0")),
        title: String(item.title || shot.title || ""),
        timecode: shot.timecode || undefined,
        duration: typeof shot.duration === "number" ? shot.duration : undefined,
        sourcePanels: Array.isArray(item.sourcePanels) ? item.sourcePanels : [],
        script,
        shot: {
          story: shot.story || "",
          scene: shot.scene || "",
          characters: Array.isArray(shot.characters) ? shot.characters : [],
          props: Array.isArray(shot.props) ? shot.props : [],
          composition: shot.composition || "",
          camera: shot.camera || "",
          action: shot.action || "",
          dialogue: Array.isArray(shot.dialogue) ? shot.dialogue : [],
          continuity: Array.isArray(shot.continuity) ? shot.continuity : [],
          negative: Array.isArray(shot.negative) ? shot.negative : [],
          artStyle: shot.artStyle || "",
        },
        completePrompt: item.completePrompt || undefined,
        completePromptSummary: item.completePromptSummary || undefined,
        approved: Boolean(item.approved),
        approvedAt: item.approvedAt,
      };
    }),
  };
}
