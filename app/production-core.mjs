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
  const scriptAppliedCount = Math.max(0, Number(input.scriptAppliedCount) || 0);
  const promptReadyCount = Math.max(0, Number(input.promptReadyCount) || 0);
  const promptReviewedCount = Math.max(0, Number(input.promptReviewedCount) || 0);
  const approvedCount = Math.max(0, Number(input.approvedCount) || 0);
  const videoReadyCount = Math.max(0, Number(input.videoReadyCount) || 0);
  const hasMangaSource = Boolean(input.hasMangaSource);
  const structureConfirmed = Boolean(input.structureConfirmed);
  const approvalChainValid = approvedCount <= shotCount
    && approvedCount <= scriptAppliedCount
    && approvedCount <= promptReadyCount
    && approvedCount <= promptReviewedCount;
  const videoBlocked = approvedCount === 0 || !approvalChainValid;

  return [
    stage("manga", "漫画入库", hasMangaSource ? "completed" : "pending", hasMangaSource ? "原漫画与画格证据已关联" : "等待上传漫画", hasMangaSource ? 1 : 0),
    stage("split", "拆分编组", !hasMangaSource ? "pending" : structureConfirmed ? "completed" : "active", !hasMangaSource ? "漫画入库后开始" : structureConfirmed ? `${shotCount} 个 Shot 结构已确认` : "正在拆格、合并与确认 Shot 边界", shotCount),
    stage("storyboard", "分镜", !structureConfirmed ? "pending" : shotCount > 0 && scriptAppliedCount === shotCount ? "completed" : "active", `${scriptAppliedCount}/${shotCount} 镜脚本已应用`, scriptAppliedCount),
    stage("prompt", "提示词", !scriptAppliedCount ? "pending" : shotCount > 0 && promptReadyCount === shotCount ? "completed" : "active", `${promptReadyCount}/${shotCount} 镜完整提示词已生成`, promptReadyCount),
    stage("review", "审核", !promptReadyCount ? "pending" : shotCount > 0 && promptReviewedCount === shotCount ? "completed" : "active", `${promptReviewedCount}/${shotCount} 镜通过独立 AI Reviewer；保留联网证据`, promptReviewedCount),
    stage("confirm", "确认", !promptReviewedCount ? "pending" : shotCount > 0 && approvedCount === shotCount ? "completed" : "active", `${approvedCount}/${shotCount} 镜已由用户签字确认`, approvedCount),
    stage("video", "LibTV 生视频", videoBlocked ? "blocked" : videoReadyCount > 0 ? "ready" : "active", videoBlocked
      ? approvedCount ? "审批状态与脚本、提示词或独立审核不一致，禁止提交" : "用户确认前禁止提交"
      : `${videoReadyCount}/${approvedCount} 个视频包可提交；当前仅准备，不自动付费`, videoReadyCount),
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
