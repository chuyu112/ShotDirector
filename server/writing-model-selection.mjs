const LEGACY_WRITING_MODEL_IDS = Object.freeze({
  "codex-gpt-5.6-sol": "jk-gpt-5.6-sol",
  "gpt-5.6-sol": "jk-gpt-5.6-sol",
  "codex-gpt-5.6-luna": "jk-gpt-5.6-luna",
  "gpt-5.6-luna": "jk-gpt-5.6-luna",
});

export function migratedWritingModelSelection(saved, updatedAt = new Date().toISOString()) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
    return { selection: saved, migrated: false };
  }
  const currentId = String(saved.id || "").trim();
  const migratedId = LEGACY_WRITING_MODEL_IDS[currentId];
  if (!migratedId) return { selection: saved, migrated: false };
  return {
    migrated: true,
    selection: {
      ...saved,
      id: migratedId,
      provider: "jiekou-responses",
      updatedAt,
    },
  };
}

export function legacyWritingModelIds() {
  return Object.keys(LEGACY_WRITING_MODEL_IDS);
}
