const GLOBAL_SETTINGS_ARRAY_FIELDS = [
  "characters",
  "props",
  "locations",
  "timeline",
  "continuity",
  "modelRules",
  "negative",
];

const GLOBAL_SETTINGS_STRING_FIELDS = [
  "storyBackground",
  "finalVideoStyle",
  "storyboardImageStyle",
];

export function isGlobalSettings(value) {
  if (!value || typeof value !== "object") return false;
  return GLOBAL_SETTINGS_ARRAY_FIELDS.every((field) => (
    Array.isArray(value[field]) && value[field].every((item) => typeof item === "string")
  )) && GLOBAL_SETTINGS_STRING_FIELDS.every((field) => typeof value[field] === "string")
    && (value.adaptationFocus === undefined || typeof value.adaptationFocus === "string")
    && (value.characterProfiles === undefined || (
      Array.isArray(value.characterProfiles)
      && value.characterProfiles.every((profile) => profile && typeof profile === "object"
        && ["id", "name", "japaneseName", "biography", "identity", "appearance", "wardrobe", "performanceBoundary", "faceRestriction"]
          .every((field) => typeof profile[field] === "string"))
    ));
}
