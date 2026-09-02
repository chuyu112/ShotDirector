export type PanelDropPlan = {
  groups: Array<{ originIndex: number; panelIds: string[] }>;
  targetIndex: number;
  draggedIds: string[];
  creating: boolean;
};

export function planPanelDrop(
  panelGroups: string[][],
  requestedIds: string[],
  target: { reviewIndex?: number; createShotAt?: number; position?: string; panelId?: string },
): PanelDropPlan | null;
