import { blockingPlans, type BlockingPlan, type BlockingZone } from "./blocking-plans";

export type WhiteboxVector = { x: number; y: number; z: number };

export type WhiteboxPoseName =
  | "neutral"
  | "walk"
  | "run"
  | "sit"
  | "point"
  | "lean"
  | "grab"
  | "pull"
  | "struggle"
  | "crouch";

export type WhiteboxBodyType = "adult-male" | "adult-female" | "teen-male" | "teen-female" | "neutral";

export type WhiteboxPose = {
  torsoPitch: number;
  torsoRoll: number;
  headYaw: number;
  headPitch: number;
  leftShoulderPitch: number;
  leftShoulderRoll: number;
  leftElbow: number;
  rightShoulderPitch: number;
  rightShoulderRoll: number;
  rightElbow: number;
  leftHipPitch: number;
  leftHipRoll: number;
  leftKnee: number;
  rightHipPitch: number;
  rightHipRoll: number;
  rightKnee: number;
};

export type WhiteboxActor = {
  id: string;
  label: string;
  position: WhiteboxVector;
  yaw: number;
  height: number;
  bodyType: WhiteboxBodyType;
  poseName: WhiteboxPoseName;
  storyboarderPoseId?: string;
  storyboarderPoseName?: string;
  pose: WhiteboxPose;
  actionNote: string;
};

export type WhiteboxObjectKind = "box" | "vehicle" | "table" | "wall" | "prop";

export type WhiteboxObject = {
  id: string;
  label: string;
  kind: WhiteboxObjectKind;
  position: WhiteboxVector;
  yaw: number;
  size: WhiteboxVector;
};

export type WhiteboxZone = {
  id: string;
  label: string;
  kind: BlockingZone["kind"];
  position: WhiteboxVector;
  size: WhiteboxVector;
};

export type WhiteboxCamera = {
  id: string;
  label: string;
  lens: string;
  position: WhiteboxVector;
  target: WhiteboxVector;
  fov: number;
  autoFrame?: boolean;
};

export type WhiteboxScene = {
  version: 10;
  planSource?: "default-project" | "generic";
  shotId: string;
  planKey: string;
  title: string;
  activeCameraId: string;
  actors: WhiteboxActor[];
  objects: WhiteboxObject[];
  zones: WhiteboxZone[];
  cameras: WhiteboxCamera[];
  updatedAt: string;
};

export const whiteboxBodyTypeLabels: Record<WhiteboxBodyType, string> = {
  "adult-male": "成年男性",
  "adult-female": "成年女性",
  "teen-male": "少年",
  "teen-female": "少女",
  neutral: "通用骨骼（默认）",
};

export function normalizeWhiteboxBodyType(value: unknown): WhiteboxBodyType {
  if (value === "adult-male" || value === "adult-female" || value === "teen-male" || value === "teen-female" || value === "neutral") return value;
  if (value === "male" || value === "man" || value === "adultMale") return "adult-male";
  if (value === "female" || value === "woman" || value === "adultFemale") return "adult-female";
  if (value === "boy" || value === "teenMale") return "teen-male";
  if (value === "girl" || value === "teenFemale") return "teen-female";
  return "neutral";
}

export function normalizeWhiteboxPoseName(value: unknown): WhiteboxPoseName {
  return typeof value === "string" && value in whiteboxPosePresets
    ? value as WhiteboxPoseName
    : "neutral";
}

const neutralPose: WhiteboxPose = {
  torsoPitch: 0,
  torsoRoll: 0,
  headYaw: 0,
  headPitch: 0,
  leftShoulderPitch: 0,
  leftShoulderRoll: -8,
  leftElbow: 4,
  rightShoulderPitch: 0,
  rightShoulderRoll: 8,
  rightElbow: 4,
  leftHipPitch: 0,
  leftHipRoll: -3,
  leftKnee: 0,
  rightHipPitch: 0,
  rightHipRoll: 3,
  rightKnee: 0,
};

export const whiteboxPoseLabels: Record<WhiteboxPoseName, string> = {
  neutral: "自然站立",
  walk: "行走",
  run: "奔跑",
  sit: "坐姿",
  point: "抬手指向",
  lean: "俯身靠近",
  grab: "伸手抓取",
  pull: "向后拉拽",
  struggle: "失衡挣扎",
  crouch: "屈膝下蹲",
};

export const whiteboxPosePresets: Record<WhiteboxPoseName, WhiteboxPose> = {
  neutral: neutralPose,
  walk: { ...neutralPose, leftShoulderPitch: -28, rightShoulderPitch: 28, leftHipPitch: 24, rightHipPitch: -22, rightKnee: 25 },
  run: { ...neutralPose, torsoPitch: 18, leftShoulderPitch: -55, rightShoulderPitch: 50, leftElbow: 55, rightElbow: 65, leftHipPitch: 38, leftKnee: 28, rightHipPitch: -42, rightKnee: 72 },
  // The actor faces +Z. Negative hip pitch sends the thighs forward; the
  // opposite sign folds them behind the pelvis and makes the seated pose look
  // anatomically reversed. Positive knee pitch then returns the calves down.
  sit: {
    ...neutralPose,
    torsoPitch: 5,
    leftShoulderPitch: -12,
    rightShoulderPitch: -12,
    leftElbow: 22,
    rightElbow: 22,
    leftHipPitch: -88,
    rightHipPitch: -88,
    leftKnee: 88,
    rightKnee: 88,
  },
  point: { ...neutralPose, rightShoulderPitch: -75, rightShoulderRoll: 4, rightElbow: 12, headYaw: -12 },
  lean: { ...neutralPose, torsoPitch: 28, headPitch: -8, leftHipPitch: -8, rightHipPitch: 10, rightKnee: 12 },
  grab: { ...neutralPose, torsoPitch: 12, rightShoulderPitch: -82, rightShoulderRoll: 4, rightElbow: 18, leftShoulderPitch: -24, leftElbow: 32 },
  pull: { ...neutralPose, torsoPitch: -18, torsoRoll: -8, rightShoulderPitch: -52, rightShoulderRoll: 10, rightElbow: 76, leftShoulderPitch: 30, leftElbow: 58, leftHipPitch: 20, leftKnee: 18, rightHipPitch: -18 },
  struggle: { ...neutralPose, torsoPitch: 30, torsoRoll: 20, headYaw: -32, leftShoulderPitch: -74, leftShoulderRoll: -35, leftElbow: 44, rightShoulderPitch: 34, rightShoulderRoll: 28, rightElbow: 72, leftHipPitch: 32, leftKnee: 38, rightHipPitch: -34, rightKnee: 20 },
  crouch: { ...neutralPose, torsoPitch: 22, leftHipPitch: 48, rightHipPitch: 48, leftKnee: 68, rightKnee: 68 },
};

export function normalizeWhiteboxPose(name: unknown, pose: Partial<WhiteboxPose> | undefined): WhiteboxPose {
  const normalizedName = normalizeWhiteboxPoseName(name);
  return { ...whiteboxPosePresets[normalizedName], ...(pose || {}) };
}

function clonePose(name: WhiteboxPoseName): WhiteboxPose {
  return { ...whiteboxPosePresets[name] };
}

function worldX(value: number) {
  return Number(((value - 500) / 82).toFixed(3));
}

function worldZ(value: number) {
  return Number(((value - 280) / 82).toFixed(3));
}

function actorYaw(facing?: "up" | "down" | "left" | "right") {
  return facing === "up" ? 180 : facing === "left" ? -90 : facing === "right" ? 90 : 0;
}

function vehicleYaw(facing?: "up" | "down" | "left" | "right") {
  return facing === "up" ? 90 : facing === "down" ? -90 : facing === "left" ? 180 : 0;
}

function inferredPose(label: string, note = ""): WhiteboxPoseName {
  const text = `${label} ${note}`;
  // Avoid treating generic words such as “卡座” or “驾驶员侧” as proof that
  // this particular actor is seated. Those phrases often describe the set.
  if (/坐姿|坐在|坐着|落座|就座|驾驶位内|驾驶座上|坐进驾驶座|座椅上/.test(text)) return "sit";
  if (/奔|跑|疾/.test(text)) return "run";
  if (/指|示意/.test(text)) return "point";
  if (/挣扎|失衡|滑|踉跄/.test(text)) return "struggle";
  if (/抓|握/.test(text)) return "grab";
  if (/拉|拽/.test(text)) return "pull";
  if (/蹲|屈膝/.test(text)) return "crouch";
  if (/俯|靠近|探身/.test(text)) return "lean";
  if (/走|经过|寻找|移动/.test(text)) return "walk";
  return "neutral";
}

function isSeatedByLayout(plan: BlockingPlan, x: number, y: number, actionText: string) {
  // Table zones also include service counters, so only real guest seating areas
  // count. An explicit departure/standing action always wins over the layout.
  if (/起身|站起|站着|离席|冲向|走向|跑向|进入|离开|移动|端酒|俯身/.test(actionText)) return false;
  return plan.zones.some((zone) => (
    zone.kind === "table"
    && /卡座|桌椅|号桌/.test(zone.label)
    && x >= zone.x
    && x <= zone.x + zone.width
    && y >= zone.y
    && y <= zone.y + zone.height
  ));
}

function cameraHeight(label: string, lens: string) {
  const text = `${label} ${lens}`;
  if (/低机位|贴地/.test(text)) return 0.8;
  if (/俯视|高机位|航拍/.test(text)) return 4.8;
  if (/车内|座位/.test(text)) return 1.2;
  return 1.65;
}

function zoneHeight(zone: BlockingZone) {
  if (zone.kind === "building") return 3.6;
  if (zone.kind === "entrance") return 3.2;
  if (zone.kind === "window") return 2.5;
  if (zone.kind === "table") return 0.72;
  if (zone.kind === "interior") return 0.08;
  if (zone.kind === "sidewalk") return 0.12;
  return 0.04;
}

function planToScene(plan: BlockingPlan, planKey: string, shotId: string, title: string): WhiteboxScene {
  const actors = plan.markers.filter((marker) => marker.kind === "person").map((marker) => {
    const nearbyMovements = plan.movements.filter((movement) => (
      Math.min(
        Math.hypot(movement.fromX - marker.x, movement.fromY - marker.y),
        Math.hypot(movement.toX - marker.x, movement.toY - marker.y),
      ) < 95
    )).map((movement) => movement.label).join("；");
    const actionText = `${marker.note || ""} ${nearbyMovements}`;
    const poseName = isSeatedByLayout(plan, marker.x, marker.y, actionText)
      ? "sit"
      : inferredPose(marker.label, actionText);
    return {
      id: marker.id,
      label: marker.label,
      position: { x: worldX(marker.x), y: 0, z: worldZ(marker.y) },
      yaw: actorYaw(marker.facing),
      height: /少女|女孩|儿童/.test(marker.label) ? 1.62 : 1.75,
      bodyType: "neutral",
      poseName,
      pose: clonePose(poseName),
      actionNote: [marker.note, nearbyMovements].filter(Boolean).join("；"),
    } satisfies WhiteboxActor;
  });

  const objects = plan.markers.filter((marker) => marker.kind !== "person").map((marker) => {
    const vehicle = marker.kind === "vehicle";
    return {
      id: marker.id,
      label: marker.label,
      kind: vehicle ? "vehicle" : "prop",
      position: { x: worldX(marker.x), y: 0, z: worldZ(marker.y) },
      yaw: vehicle ? vehicleYaw(marker.facing) : 0,
      size: vehicle ? { x: 4.5, y: 1.45, z: 1.8 } : { x: 0.45, y: 0.45, z: 0.45 },
    } satisfies WhiteboxObject;
  });

  const zones = plan.zones.map((zone) => {
    const height = zoneHeight(zone);
    return {
      id: zone.id,
      label: zone.label,
      kind: zone.kind,
      position: {
        x: worldX(zone.x + zone.width / 2),
        y: zone.kind === "building" || zone.kind === "entrance" || zone.kind === "window" || zone.kind === "table" ? height / 2 : 0,
        z: worldZ(zone.y + zone.height / 2),
      },
      size: { x: zone.width / 82, y: height, z: zone.height / 82 },
    } satisfies WhiteboxZone;
  });

  const cameras = plan.cameras.map((camera) => {
    const height = cameraHeight(camera.label, camera.lens);
    return {
      id: camera.id,
      label: camera.label,
      lens: camera.lens,
      position: { x: worldX(camera.x), y: height, z: worldZ(camera.y) },
      target: { x: worldX(camera.targetX), y: /近景|胸像|脸/.test(camera.lens) ? 1.35 : 1.05, z: worldZ(camera.targetY) },
      fov: camera.fov || 35,
      autoFrame: true,
    } satisfies WhiteboxCamera;
  });

  if (!cameras.length) {
    cameras.push({
      id: "机位A",
      label: "默认摄影机",
      lens: "35mm",
      position: { x: 0, y: 1.65, z: 6 },
      target: { x: 0, y: 1.1, z: 0 },
      fov: 42,
      autoFrame: true,
    });
  }

  return {
    version: 10,
    shotId,
    planKey,
    title,
    activeCameraId: cameras[0].id,
    actors,
    objects,
    zones,
    cameras,
    updatedAt: new Date().toISOString(),
  };
}

export function createWhiteboxScene(planKey: string, shotId: string, title: string, useDefaultProjectPlan = true): WhiteboxScene {
  const plan = useDefaultProjectPlan ? blockingPlans[planKey] || blockingPlans[shotId] : undefined;
  const scene = plan
    ? planToScene(plan, planKey, shotId, title)
    : planToScene({ orientation: "", zones: [], markers: [], cameras: [], movements: [] }, planKey, shotId, title);
  return { ...scene, planSource: useDefaultProjectPlan ? "default-project" : "generic" };
}

export function createWhiteboxActor(index: number): WhiteboxActor {
  return {
    id: `actor-${Date.now()}-${index}`,
    label: `自建小人 ${index}`,
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    height: 1.72,
    bodyType: "neutral",
    poseName: "neutral",
    pose: clonePose("neutral"),
    actionNote: "",
  };
}

export function createWhiteboxObject(kind: WhiteboxObjectKind, index: number): WhiteboxObject {
  const vehicle = kind === "vehicle";
  return {
    id: `${kind}-${Date.now()}-${index}`,
    label: vehicle ? `自建车辆 ${index}` : `自建物体 ${index}`,
    kind,
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    size: vehicle ? { x: 4.5, y: 1.45, z: 1.8 } : { x: 1, y: 1, z: 1 },
  };
}

export function ensureWhiteboxScenes(
  existing: Record<string, WhiteboxScene> | undefined,
  options: Array<{ key: string; title: string }>,
  shotId: string,
  useDefaultProjectPlan = true,
) {
  return Object.fromEntries(options.map((option) => {
    const current = existing?.[option.key];
    const expectedPlanSource = useDefaultProjectPlan ? "default-project" : "generic";
    const currentPlanSource = current?.planSource || "default-project";
    const valid = current
      && Array.isArray(current.actors)
      && Array.isArray(current.objects)
      && Array.isArray(current.zones)
      && Array.isArray(current.cameras)
      && currentPlanSource === expectedPlanSource;
    if (!valid) return [option.key, createWhiteboxScene(option.key, shotId, option.title, useDefaultProjectPlan)];
    const upgradingLegacyRig = Number((current as { version?: number }).version) < 10;
    return [option.key, {
      ...current,
      version: 10,
      planSource: expectedPlanSource,
      actors: current.actors.map((actor) => {
        const poseName = normalizeWhiteboxPoseName(actor.poseName);
        const normalizedBodyType = normalizeWhiteboxBodyType(actor.bodyType);
        return {
          ...actor,
          // Version 10 resets legacy cast markers to one shared Storyboarder
          // base rig. After migration, explicit user-selected body types are
          // preserved and can be customised per character.
          bodyType: upgradingLegacyRig ? "neutral" : normalizedBodyType,
          poseName,
          pose: normalizeWhiteboxPose(poseName, actor.pose),
        };
      }),
    }];
  }));
}
