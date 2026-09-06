type Review = { shot: { id: string; shotUid?: string }; chat?: { pending?: unknown }; promptReviewStatus?: string; completePromptStatus?: string; completePrompt?: string; completePromptSourceRevision?: string };
export function promptReviewControls(input: {
  review: Review;
  reviewer?: { available: boolean; reason?: string };
  bridge: { connected: boolean; pairingToken?: string; busy?: boolean; draining?: boolean; activeJob?: { type?: string; status?: string; shotId?: string; shotUid?: string; projectUid?: string }; promptJobs?: Array<{ type?: string; status?: string; shotId?: string; shotUid?: string; projectUid?: string }> };
  hasSource: boolean;
  projectUid?: string;
  currentReviewSourceRevision?: string;
}): { selectingDisabled: boolean; submitDisabled: boolean; reason: string; action: string };
export function promptReviewShotLabel(review: Review): string;
