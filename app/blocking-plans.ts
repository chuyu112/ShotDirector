export type BlockingZone = {
  id: string;
  label: string;
  kind: "building" | "sidewalk" | "road" | "side-street" | "interior" | "window" | "table" | "entrance";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BlockingMarker = {
  id: string;
  label: string;
  kind: "person" | "vehicle" | "prop";
  x: number;
  y: number;
  facing?: "up" | "down" | "left" | "right";
  note?: string;
};

export type BlockingCamera = {
  id: string;
  label: string;
  lens: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  fov?: number;
};

export type BlockingMovement = {
  id: string;
  label: string;
  kind: "action" | "vehicle" | "camera";
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

export type BlockingPlan = {
  orientation: string;
  zones: BlockingZone[];
  markers: BlockingMarker[];
  cameras: BlockingCamera[];
  movements: BlockingMovement[];
};

/** New projects create blocking plans from their own Shot evidence. */
export const blockingPlans: Record<string, BlockingPlan> = {};
