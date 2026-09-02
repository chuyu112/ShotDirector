export type ReadingPage = {
  scanIndex: number;
  layout: string;
  readingOrder?: string[];
  panels: Array<{ id: string; bounds: { x: number; y: number; width: number; height: number } }>;
};
export const mangaReadingOrderVersion: number;
export function buildMangaReadingOrder(pages?: ReadingPage[], direction?: string): {
  direction: "right-to-left" | "left-to-right";
  pages: Array<{ scanIndex: number; panelIds: string[] }>;
  panelIds: string[];
  issues: Array<{ panelIds: string[]; reason: string }>;
};
export function orderPanelIds(ids: string[], readingOrder: string[]): string[];
export function correctMangaReviewOrder<T extends { shot: { id: string; sourcePanels?: string[] }; approved?: boolean; completePromptStatus?: string; promptReviewStatus?: string }>(reviews: T[], readingOrder: string[]): { reviews: T[]; changedShotIds: string[]; blockedShotIds: string[] };
export function normalizeMangaAnalysisReadingOrder<T>(result: T, direction?: string): T;
