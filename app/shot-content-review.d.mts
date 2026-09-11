import type { StoryboardShot } from './storyboard-data';
export type HumanPanelCheck = {
  panelId: string; checked: boolean; decision: string; observation: string; textStatus: string;
  sourceText: Array<{ speaker: string; text: string }>; note: string;
};
export type ContentWorksheet = {
  panels: HumanPanelCheck[]; action: string;
  segments: Array<{ start: number | null; end: number | null; beat: string; framing: string; panelIds: string[]; mustShow?: string[] }>;
  negative: string[]; continuity: string[]; timeline: string[]; confirmedBy: string;
};
export type ContentReviewSession = {
  id: string; scopeId: string; projectUid: string; shotUid: string; createdAt: string; status: string; baseHash: string;
  worksheet: ContentWorksheet;
  timelineReference: Array<{ shotId: string; timecode: string; duration: number; panelCount: number }>;
  evidence: Array<{ panelId: string; cropHash: string; imagePath: string; sourceObservation: string; textSummary: string; sourceText: unknown[] }>;
  before: { shot: StoryboardShot; completePrompt?: string; report?: unknown; reviewerId?: string; reviewerModel?: string;
    reviewRevision?: string; requestId?: string; runId?: string; reviewedAt?: string; chat?: unknown; timeline: string[] };
};
export function contentReviewTarget(shot: StoryboardShot): boolean;
export function contentReviewGuard(state: unknown): string;
export function segmentSeconds(label: string): [number | null, number | null];
export function initialContentWorksheet(review: { shot: StoryboardShot }, timeline: string[]): ContentWorksheet;
export function validateContentWorksheet(sheet: ContentWorksheet, panelIds: string[]): string[];
export function contentStructurePatch(sheet: ContentWorksheet): Pick<StoryboardShot, 'action' | 'segments' | 'negative' | 'continuity'>;
