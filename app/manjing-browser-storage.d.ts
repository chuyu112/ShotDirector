export const MANJING_SERVER_SCOPE_KEY: string;

export type ManjingBrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear">;

export function manjingServerScope(userId: string, projectId: string): string;
export function setManjingServerScope(userId: string, projectId: string): string;
export function currentManjingServerScope(): string;
export function manjingBrowserStorage(serverConfigured: boolean): ManjingBrowserStorage | null;

export const manjingBrowserStorageInternals: {
  scopedStorage(storage: Storage, scope: string): ManjingBrowserStorage;
};
