const BROWSER_AGENT_REVISION_FIELD = "__manjingAgentRevision";

export function normalizedAgentRevision(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function browserAgentRevision(snapshot) {
  return normalizedAgentRevision(snapshot?.[BROWSER_AGENT_REVISION_FIELD]);
}

export function browserDraftSnapshot(state, revision) {
  const normalizedRevision = normalizedAgentRevision(revision);
  return {
    ...state,
    ...(normalizedRevision ? { [BROWSER_AGENT_REVISION_FIELD]: normalizedRevision } : {}),
  };
}

export function shouldApplyAgentDraft(revision, appliedRevision) {
  const normalizedRevision = normalizedAgentRevision(revision);
  return Boolean(normalizedRevision && normalizedRevision !== normalizedAgentRevision(appliedRevision));
}

export function shouldSurfaceMediaRecoveryFailure({ directRequestId, recoverDraftUnderstandings } = {}) {
  return Boolean(normalizedAgentRevision(directRequestId) || recoverDraftUnderstandings);
}
