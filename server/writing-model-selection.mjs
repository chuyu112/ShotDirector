const LEGACY_WRITING_MODEL_MIGRATIONS = Object.freeze({
  "codex-gpt-5.6-sol": { id: "jk-gpt-5.6-sol", provider: "jiekou-responses" },
  "gpt-5.6-sol": { id: "jk-gpt-5.6-sol", provider: "jiekou-responses" },
  "codex-gpt-5.6-luna": { id: "jk-gpt-5.6-luna", provider: "jiekou-responses" },
  "gpt-5.6-luna": { id: "jk-gpt-5.6-luna", provider: "jiekou-responses" },
});

export function migratedWritingModelSelection(saved, updatedAt = new Date().toISOString()) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
    return { selection: saved, migrated: false };
  }
  const currentId = String(saved.id || "").trim();
  const migration = LEGACY_WRITING_MODEL_MIGRATIONS[currentId];
  if (!migration) return { selection: saved, migrated: false };
  return {
    migrated: true,
    selection: {
      ...saved,
      id: migration.id,
      provider: migration.provider,
      updatedAt,
    },
  };
}

export function legacyWritingModelIds() {
  return Object.keys(LEGACY_WRITING_MODEL_MIGRATIONS);
}
