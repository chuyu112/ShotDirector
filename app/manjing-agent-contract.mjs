const stableProjectUid = /^project-[a-z0-9][a-z0-9-]{5,}$/i;
const stableShotUid = /^shot-[a-z0-9][a-z0-9-]{5,}$/i;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function lockedShotPayload(shot) {
  return canonical({
    shotUid: shot.shotUid,
    displayNumber: shot.displayNumber,
    title: shot.title,
    sourcePanels: Array.isArray(shot.sourcePanels) ? shot.sourcePanels : [],
    sourceRevision: shot.sourceRevision || null,
    approved: Boolean(shot.approved),
    approvedAt: shot.approvedAt || null,
  });
}

export function lockedShotDigest(shot) {
  return `lock-${hashText(JSON.stringify(lockedShotPayload(shot)))}`;
}

export function validateManjingAgentState(value) {
  const issues = [];
  const projectUid = value?.project?.projectUid;
  if (!stableProjectUid.test(String(projectUid || ""))) issues.push("projectUid 不是稳定项目 ID");
  const shots = Array.isArray(value?.shots) ? value.shots : [];
  const seenShotUids = new Set();
  const seenPanels = new Set();
  for (const shot of shots) {
    if (!stableShotUid.test(String(shot?.shotUid || ""))) {
      issues.push(`Shot ${shot?.displayNumber || "?"} 缺少稳定 shotUid`);
    } else if (seenShotUids.has(shot.shotUid)) {
      issues.push(`重复 shotUid：${shot.shotUid}`);
    } else {
      seenShotUids.add(shot.shotUid);
    }
    for (const panelId of Array.isArray(shot?.sourcePanels) ? shot.sourcePanels : []) {
      const key = String(panelId || "").trim();
      if (!key) issues.push(`Shot ${shot?.displayNumber || "?"} 包含空画格 ID`);
      else if (seenPanels.has(key)) issues.push(`画格 ${key} 被多个 Shot 重复引用`);
      else seenPanels.add(key);
    }
    if (shot?.humanLocked && shot.lockDigest !== lockedShotDigest(shot)) {
      issues.push(`Shot ${shot?.displayNumber || "?"} 的人工锁摘要无效`);
    }
  }
  return issues;
}

export function buildManjingAgentContract(manifest) {
  const shots = (Array.isArray(manifest?.shots) ? manifest.shots : []).map((shot) => ({
    ...shot,
    humanLocked: Boolean(shot.approved),
    lockDigest: Boolean(shot.approved) ? lockedShotDigest(shot) : null,
  }));
  const state = {
    contractVersion: 1,
    product: "漫镜 Manjing",
    project: manifest?.project || {},
    shots,
    requiredSequence: ["read-state", "propose", "apply", "validate"],
    rules: [
      "只使用状态中真实存在的 projectUid、shotUid、画格 ID、资产 ID 和白模元素 ID",
      "人工锁定内容不得被 Agent 静默覆盖",
      "多步修改必须可撤销，并在完成后执行验证",
      "Reviewer 只能审查，用户确认前不得批准或提交付费视频任务",
    ],
  };
  return {
    ...state,
    validation: {
      checkedAt: new Date().toISOString(),
      issues: validateManjingAgentState(state),
    },
  };
}

export function assertHumanLocksPreserved(previousState, nextState, options = {}) {
  const explicitlyUnlocked = new Set(
    Array.isArray(options.explicitlyUnlockedShotUids) ? options.explicitlyUnlockedShotUids : [],
  );
  const nextShots = new Map((Array.isArray(nextState?.shots) ? nextState.shots : [])
    .map((shot) => [shot.shotUid, shot]));
  for (const shot of Array.isArray(previousState?.shots) ? previousState.shots : []) {
    if (!shot?.humanLocked || explicitlyUnlocked.has(shot.shotUid)) continue;
    const next = nextShots.get(shot.shotUid);
    if (!next) throw new Error(`Agent 不能删除人工锁定的 Shot：${shot.shotUid}`);
    if (lockedShotDigest(next) !== shot.lockDigest) {
      throw new Error(`Agent 不能修改人工锁定的 Shot：${shot.shotUid}`);
    }
  }
  return true;
}

const strictReviewMutationFields = Object.freeze([
  "apply",
  "approved",
  "autoApprove",
  "modifiedPrompt",
  "mutation",
  "patch",
  "replacementPrompt",
  "shotPatch",
]);

export function assertStrictReviewRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("严格审核请求必须是对象");
  }
  if (value.operationMode !== "strict-review") {
    throw new Error("Reviewer 只接受 strict-review 模式的只读审查请求");
  }
  const mutationField = strictReviewMutationFields.find((field) => Object.hasOwn(value, field));
  if (mutationField) {
    throw new Error(`严格审核请求禁止携带修改字段：${mutationField}`);
  }
  return true;
}

export const manjingStrictReviewContract = Object.freeze({
  operationMode: "strict-review",
  forbiddenFields: strictReviewMutationFields,
  allowedActions: ["inspect", "review", "suggest"],
});
