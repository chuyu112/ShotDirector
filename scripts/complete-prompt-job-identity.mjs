function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error(`缺少${label}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

export function completePromptIdentity({ projectUid, shotUid, shotId, sourceRevision }) {
  const normalizedProjectUid = requiredText(projectUid, "项目稳定 UID");
  const normalizedShotUid = String(shotUid || "").trim();
  const normalizedShotId = String(shotId || "").trim();
  if (!normalizedShotUid && !normalizedShotId) {
    const error = new Error("缺少 Shot 稳定 UID 或显示编号");
    error.statusCode = 400;
    throw error;
  }
  return {
    projectUid: normalizedProjectUid,
    shotUid: normalizedShotUid,
    shotId: normalizedShotId,
    sourceRevision: requiredText(sourceRevision, "完整提示词来源版本"),
  };
}

export function completePromptIdentityFromPayload(payload) {
  return completePromptIdentity({
    projectUid: payload?.projectUid,
    shotUid: payload?.shot?.shotUid,
    shotId: payload?.shot?.id,
    sourceRevision: payload?.sourceRevision,
  });
}

export function completePromptJobKey(identity) {
  return JSON.stringify([
    identity.projectUid,
    identity.shotUid || identity.shotId,
    identity.sourceRevision,
  ]);
}

export function completePromptResultMatches(result, identity) {
  if (!result || result.projectUid !== identity.projectUid || result.sourceRevision !== identity.sourceRevision) return false;
  if (identity.shotUid) return result.shotUid === identity.shotUid;
  return String(result.shotId || "") === identity.shotId;
}
