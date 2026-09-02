export const projectSaveTimeoutMs: number;
export type SaveProjectDetail = {
  handled: boolean;
  signal: AbortSignal;
  onProgress: (message: string) => void;
  resolve: (message?: string) => void;
  reject: (message: string) => void;
};
export function requestProjectSave(target: EventTarget, eventName: string, options?: { timeoutMs?: number; onProgress?: (message: string) => void }): Promise<string>;
export function persistProjectSnapshot(input: {
  fetcher: typeof fetch;
  apiBase: string;
  snapshot: { projectTitle: string; globalSettings: unknown };
  scopeId: string;
  storageKey: string;
  appliedAgentRevision: string;
  pairingToken: string;
  materialDraftMode: boolean;
  workspaceScope: string;
  serverProjectId?: string;
  signal: AbortSignal;
  onProgress: (message: string) => void;
}): Promise<string>;
