export type LineListDraft = { text: string; source: string; items: string[] };
export function editLineListDraft(text: string): LineListDraft;
export function reconcileLineListDraft(draft: LineListDraft | null, items: string[]): LineListDraft;
