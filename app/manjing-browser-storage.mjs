export const MANJING_SERVER_SCOPE_KEY = "manjing-server-storage-scope-v1";

function safeScopePart(value, fallback) {
  const normalized = String(value || "").trim();
  return normalized && normalized.length <= 180
    ? encodeURIComponent(normalized)
    : fallback;
}

export function manjingServerScope(userId, projectId) {
  return `${safeScopePart(userId, "unknown-user")}::${safeScopePart(projectId, "unknown-project")}`;
}

export function setManjingServerScope(userId, projectId) {
  if (typeof window === "undefined") return "server-render";
  const scope = manjingServerScope(userId, projectId);
  window.sessionStorage.setItem(MANJING_SERVER_SCOPE_KEY, scope);
  return scope;
}

export function currentManjingServerScope() {
  if (typeof window === "undefined") return "server-render";
  return window.sessionStorage.getItem(MANJING_SERVER_SCOPE_KEY) || "pending-session";
}

function scopedStorage(storage, scope) {
  const prefix = `manjing:${scope}:`;
  return {
    getItem(key) {
      return storage.getItem(`${prefix}${key}`);
    },
    setItem(key, value) {
      storage.setItem(`${prefix}${key}`, value);
    },
    removeItem(key) {
      storage.removeItem(`${prefix}${key}`);
    },
    clear() {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    },
  };
}

export function manjingBrowserStorage(serverConfigured) {
  if (typeof window === "undefined") return null;
  return serverConfigured
    ? scopedStorage(window.sessionStorage, currentManjingServerScope())
    : window.localStorage;
}

export const manjingBrowserStorageInternals = { scopedStorage };
