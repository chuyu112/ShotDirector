type Review = { shot: { id: string }; promptReviewStatus?: string; completePromptStatus?: string; completePrompt?: string; completePromptSourceRevision?: string };
export function promptReviewControls(input: {
  review: Review;
  reviewer?: { available: boolean; reason?: string };
  bridge: { connected: boolean; pairingToken?: string; busy?: boolean; draining?: boolean; activeJob?: { type?: string; status?: string; shotId?: string } };
  hasSource: boolean;
}): { selectingDisabled: boolean; submitDisabled: boolean; reason: string; action: string };
export function promptReviewShotLabel(review: Review): string;
