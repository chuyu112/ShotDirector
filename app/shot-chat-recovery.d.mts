import type { ShotChatPending, ShotChatState } from './shot-chat';

export type ShotChatRecoveryTarget = { scopeId: string; projectUid: string; shotUid: string; pending: ShotChatPending };
export type ShotChatRecover = (target: ShotChatRecoveryTarget, signal: AbortSignal) => Promise<void>;
export function pendingShotChats(scopeId: string, projectUid: string, reviews: Array<{ shot: { shotUid?: string }; chat?: ShotChatState }>): ShotChatRecoveryTarget[];
export class ShotChatRecoveryPoller {
  update(targets: ShotChatRecoveryTarget[], recover: ShotChatRecover): void;
  dispose(): void;
}
