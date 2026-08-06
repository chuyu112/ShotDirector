"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  createWhiteboxActor,
  createWhiteboxObject,
  normalizeWhiteboxBodyType,
  normalizeWhiteboxPose,
  normalizeWhiteboxPoseName,
  whiteboxBodyTypeLabels,
  whiteboxPoseLabels,
  whiteboxPosePresets,
  type WhiteboxActor,
  type WhiteboxBodyType,
  type WhiteboxCamera,
  type WhiteboxObject,
  type WhiteboxObjectKind,
  type WhiteboxPose,
  type WhiteboxPoseName,
  type WhiteboxScene,
  type WhiteboxVector,
} from "./whitebox-data";

type WhiteboxViewMode = "shot" | "orbit";
type WhiteboxShotSize = "close" | "bust" | "medium" | "full" | "wide";
type WhiteboxShotAngle = "high" | "eye" | "low";

const shotSizeLabels: Record<WhiteboxShotSize, string> = {
  close: "特写",
  bust: "胸像",
  medium: "中景",
  full: "全身",
  wide: "远景",
};

const shotAngleLabels: Record<WhiteboxShotAngle, string> = {
  high: "俯拍",
  eye: "平视",
  low: "仰拍",
};

export type WhiteboxStageHandle = {
  captureCleanPng: () => string | undefined;
};

type WhiteboxStageProps = {
  sceneData: WhiteboxScene;
  viewMode: WhiteboxViewMode;
  selectedEntityId?: string;
  onSelectEntity?: (id: string) => void;
};

const degrees = THREE.MathUtils.degToRad;

function whiteMaterial(color = 0xe8e6df) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02 });
}

function makeMesh(geometry: THREE.BufferGeometry, material: THREE.Material, entityId?: string) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (entityId) mesh.userData.entityId = entityId;
  return mesh;
}

function disposeObjectTree(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!object.userData.storyboarderSharedGeometry) object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

function makeLimb(length: number, radius: number, material: THREE.Material, entityId: string) {
  const pivot = new THREE.Group();
  pivot.userData.entityId = entityId;
  const limb = makeMesh(new THREE.CapsuleGeometry(radius, Math.max(0.03, length - radius * 2), 8, 16), material, entityId);
  limb.position.y = -length / 2;
  pivot.add(limb);
  const joint = makeMesh(new THREE.SphereGeometry(radius * 1.1, 18, 12), material, entityId);
  joint.position.y = -length;
  pivot.add(joint);
  return pivot;
}

function makeEllipsoid(
  radius: number,
  scale: WhiteboxVector,
  material: THREE.Material,
  entityId: string,
) {
  const mesh = makeMesh(new THREE.SphereGeometry(radius, 18, 12), material, entityId);
  mesh.scale.set(scale.x, scale.y, scale.z);
  return mesh;
}

type BodyProfile = {
  shoulder: number;
  waist: number;
  hip: number;
  arm: number;
  thigh: number;
  head: number;
  depth: number;
};

const bodyProfiles: Record<WhiteboxBodyType, BodyProfile> = {
  "adult-male": { shoulder: 0.3, waist: 0.205, hip: 0.205, arm: 0.066, thigh: 0.08, head: 1, depth: 0.68 },
  "adult-female": { shoulder: 0.255, waist: 0.175, hip: 0.235, arm: 0.058, thigh: 0.076, head: 0.98, depth: 0.64 },
  "teen-male": { shoulder: 0.238, waist: 0.172, hip: 0.185, arm: 0.055, thigh: 0.071, head: 1.04, depth: 0.63 },
  "teen-female": { shoulder: 0.218, waist: 0.16, hip: 0.198, arm: 0.052, thigh: 0.069, head: 1.04, depth: 0.61 },
  neutral: { shoulder: 0.27, waist: 0.19, hip: 0.215, arm: 0.061, thigh: 0.076, head: 1, depth: 0.66 },
};

const storyboarderModelUrls: Record<WhiteboxBodyType, string | undefined> = {
  "adult-male": "/shot-generator/adult-male.glb",
  "adult-female": "/shot-generator/adult-female.glb",
  "teen-male": "/shot-generator/teen-male.glb",
  "teen-female": "/shot-generator/teen-female.glb",
  // The original Shot Generator adult base is our shared unisex blocking rig.
  // Users can opt into the specialised silhouettes from the inspector.
  neutral: "/shot-generator/adult-male.glb",
};

const shotGeneratorObjectUrls = {
  building: "/shot-generator/objects/building_one_storey.glb",
  car: "/shot-generator/objects/vehicle-car.glb",
  chair: "/shot-generator/objects/chair.glb",
  barChair: "/shot-generator/objects/chair-bar.glb",
  doubleDoor: "/shot-generator/objects/door-double-frame.glb",
  singleDoor: "/shot-generator/objects/door-single-frame.glb",
  pistol: "/shot-generator/objects/object-pistol.glb",
  primitive: "/shot-generator/objects/primitive-cylinder.glb",
  barTable: "/shot-generator/objects/table-bar.glb",
  counter: "/shot-generator/objects/table-counter.glb",
  rectangleTable: "/shot-generator/objects/table-sit-rectangle.glb",
  squareTable: "/shot-generator/objects/table-sit-square.glb",
  window: "/shot-generator/objects/window-1.glb",
} as const;

type ShotGeneratorObjectUrl = typeof shotGeneratorObjectUrls[keyof typeof shotGeneratorObjectUrls];

const storyboarderPoseIds: Record<WhiteboxPoseName, string> = {
  neutral: "79BBBD0D-6BA2-4D84-9B71-EE661AB6E5AE",
  sit: "0557DA72-A5E3-4C71-94F9-6B318AE35D7F",
  walk: "BCB6107B-9ED5-4DDA-B3A2-FC37C87BE3FD",
  run: "8552E431-65F7-4048-AECA-73694738B03C",
  point: "50952648-BBAA-4100-B966-F65D54E89A74",
  lean: "A8F2963A-56EB-4A5A-9F74-3C2E4FDF018D",
  grab: "af634751-7cfc-4d03-84d1-511a94c9b456",
  pull: "B10E1AAD-2E4F-4C95-89A3-140DA6FFB7A7",
  struggle: "9ffb3116-5c35-425c-8569-302e12c6e07f",
  crouch: "03C869F5-9689-4477-877A-DF482EF3B6AB",
};

type StoryboarderPoseState = {
  id?: string;
  name?: string;
  keywords?: string | string[];
  state?: { skeleton?: Record<string, { rotation?: { x: number; y: number; z: number } }> };
};

type StoryboarderPoseCategory = "all" | "gun" | "stand" | "walk" | "run" | "sit" | "crouch" | "action";

type StoryboarderPoseEntry = {
  id: string;
  name: string;
  keywords: string;
  category: Exclude<StoryboarderPoseCategory, "all">;
};

const storyboarderPoseCategoryLabels: Record<StoryboarderPoseCategory, string> = {
  all: "全部",
  gun: "持枪",
  stand: "站立",
  walk: "行走",
  run: "奔跑",
  sit: "坐姿",
  crouch: "蹲跪",
  action: "动作 / 格斗",
};

function storyboarderPoseCategory(name: string, keywords: string): Exclude<StoryboarderPoseCategory, "all"> {
  const text = `${name} ${keywords}`.toLowerCase();
  if (/gun|pistol|rifle|shotgun|shoot|aim|weapon|firearm/.test(text)) return "gun";
  if (/sit|seated|couch|chair/.test(text)) return "sit";
  if (/run|sprint|jog/.test(text)) return "run";
  if (/walk|step|stroll/.test(text)) return "walk";
  if (/crouch|kneel|knee|crawl/.test(text)) return "crouch";
  if (/stand|idle|default|pose/.test(text)) return "stand";
  return "action";
}

const storyboarderLoader = new GLTFLoader();
const storyboarderModelCache = new Map<string, Promise<THREE.Group>>();
let storyboarderPoseCache: Promise<Record<string, StoryboarderPoseState>> | undefined;

function loadStoryboarderModel(url: string) {
  const cached = storyboarderModelCache.get(url);
  if (cached) return cached;
  const request = new Promise<THREE.Group>((resolve, reject) => {
    storyboarderLoader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
  storyboarderModelCache.set(url, request);
  return request;
}

function loadStoryboarderPoses() {
  storyboarderPoseCache ||= fetch("/shot-generator/poses.json")
    .then((response) => {
      if (!response.ok) throw new Error(`Storyboarder pose library failed: ${response.status}`);
      return response.json() as Promise<Record<string, StoryboarderPoseState>>;
    });
  return storyboarderPoseCache;
}

function applyPoseDelta(model: THREE.Group, actor: WhiteboxActor) {
  const poseName = normalizeWhiteboxPoseName(actor.poseName);
  const baseline = whiteboxPosePresets[poseName];
  const pose = normalizeWhiteboxPose(poseName, actor.pose);
  const rotate = (name: string, x = 0, y = 0, z = 0) => {
    const bone = model.getObjectByName(name);
    if (!bone) return;
    bone.rotation.x += degrees(x);
    bone.rotation.y += degrees(y);
    bone.rotation.z += degrees(z);
  };
  rotate("Spine", pose.torsoPitch - baseline.torsoPitch, 0, pose.torsoRoll - baseline.torsoRoll);
  rotate("Head", pose.headPitch - baseline.headPitch, pose.headYaw - baseline.headYaw, 0);
  rotate("LeftArm", pose.leftShoulderPitch - baseline.leftShoulderPitch, 0, pose.leftShoulderRoll - baseline.leftShoulderRoll);
  rotate("RightArm", pose.rightShoulderPitch - baseline.rightShoulderPitch, 0, pose.rightShoulderRoll - baseline.rightShoulderRoll);
  rotate("LeftForeArm", pose.leftElbow - baseline.leftElbow);
  rotate("RightForeArm", pose.rightElbow - baseline.rightElbow);
  rotate("LeftUpLeg", pose.leftHipPitch - baseline.leftHipPitch, 0, pose.leftHipRoll - baseline.leftHipRoll);
  rotate("RightUpLeg", pose.rightHipPitch - baseline.rightHipPitch, 0, pose.rightHipRoll - baseline.rightHipRoll);
  rotate("LeftLeg", pose.leftKnee - baseline.leftKnee);
  rotate("RightLeg", pose.rightKnee - baseline.rightKnee);
}

async function makeStoryboarderActor(actor: WhiteboxActor) {
  const bodyType = normalizeWhiteboxBodyType(actor.bodyType);
  const poseName = normalizeWhiteboxPoseName(actor.poseName);
  const url = storyboarderModelUrls[bodyType];
  if (!url) return undefined;
  const [base, poses] = await Promise.all([loadStoryboarderModel(url), loadStoryboarderPoses()]);
  const model = cloneSkeleton(base) as THREE.Group;
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) meshes.push(object);
  });
  meshes.forEach((mesh) => {
    mesh.visible = /LOD0/i.test(mesh.name) || (!meshes.some((candidate) => /LOD0/i.test(candidate.name)) && mesh === meshes[0]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.entityId = actor.id;
    mesh.userData.storyboarderSharedGeometry = true;
    mesh.material = new THREE.MeshStandardMaterial({ color: 0xf0efeb, roughness: 0.88, metalness: 0 });
    mesh.skeleton.pose();
  });
  model.updateMatrixWorld(true);
  const standingBox = new THREE.Box3().setFromObject(model);
  const modelHeight = Math.max(0.1, standingBox.max.y - standingBox.min.y);
  const poseId = actor.storyboarderPoseId || storyboarderPoseIds[poseName];
  const pose = poses[poseId]?.state?.skeleton || {};
  Object.entries(pose).forEach(([name, state]) => {
    const bone = model.getObjectByName(name);
    if (!bone || !state.rotation) return;
    bone.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
  });
  applyPoseDelta(model, actor);
  model.updateMatrixWorld(true);
  const posedBox = new THREE.Box3().setFromObject(model);
  model.position.set(-((posedBox.min.x + posedBox.max.x) / 2), -posedBox.min.y, -((posedBox.min.z + posedBox.max.z) / 2));

  const root = new THREE.Group();
  root.name = actor.label;
  root.userData.entityId = actor.id;
  root.userData.storyboarderRig = true;
  root.position.set(actor.position.x, actor.position.y, actor.position.z);
  root.rotation.y = degrees(actor.yaw);
  root.scale.setScalar(actor.height / modelHeight);
  root.add(model);
  return root;
}

async function makeShotGeneratorObject(
  url: ShotGeneratorObjectUrl,
  entityId: string,
  label: string,
  position: WhiteboxVector,
  yaw: number,
  targetSize: WhiteboxVector,
) {
  const base = await loadStoryboarderModel(url);
  const model = base.clone(true);
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.entityId = entityId;
    object.userData.storyboarderSharedGeometry = true;
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const sourceName = `${object.name} ${sourceMaterials.map((material) => material.name).join(" ")}`;
    const glassDetail = url === shotGeneratorObjectUrls.window || /glass|window/i.test(sourceName);
    const darkDetail = /wheel|tire|tyre|metal/i.test(sourceName);
    const detailColor = glassDetail ? 0xcbd6d8 : darkDetail ? 0xb8bab8 : 0xe8e7e2;
    object.material = new THREE.MeshStandardMaterial({
      color: detailColor,
      roughness: glassDetail ? 0.28 : 0.86,
      metalness: 0.015,
      transparent: glassDetail,
      opacity: glassDetail ? 0.3 : 1,
      depthWrite: !glassDetail,
      side: glassDetail ? THREE.DoubleSide : THREE.FrontSide,
    });
  });
  model.updateMatrixWorld(true);
  const sourceBox = new THREE.Box3().setFromObject(model);
  const sourceSize = sourceBox.getSize(new THREE.Vector3());
  const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
  model.position.set(-sourceCenter.x, -sourceBox.min.y, -sourceCenter.z);

  const scaler = new THREE.Group();
  scaler.scale.set(
    targetSize.x / Math.max(0.001, sourceSize.x),
    targetSize.y / Math.max(0.001, sourceSize.y),
    targetSize.z / Math.max(0.001, sourceSize.z),
  );
  scaler.add(model);

  const root = new THREE.Group();
  root.name = label;
  root.userData.entityId = entityId;
  root.userData.storyboarderAsset = true;
  root.position.set(position.x, position.y, position.z);
  root.rotation.y = degrees(yaw);
  root.add(scaler);
  return root;
}

function objectAsset(item: WhiteboxObject): { url: ShotGeneratorObjectUrl; size: WhiteboxVector } {
  const label = item.label;
  if (item.kind === "vehicle") return { url: shotGeneratorObjectUrls.car, size: item.size };
  if (/左轮|手枪|枪|pistol/i.test(label)) return { url: shotGeneratorObjectUrls.pistol, size: { x: 0.28, y: 0.16, z: 0.08 } };
  if (/吧台|柜台|counter/i.test(label)) return { url: shotGeneratorObjectUrls.counter, size: { x: Math.max(1.2, item.size.x), y: Math.max(0.95, item.size.y), z: Math.max(0.55, item.size.z) } };
  if (/吧椅|高脚椅/.test(label)) return { url: shotGeneratorObjectUrls.barChair, size: { x: 0.48, y: 1.05, z: 0.48 } };
  if (/椅|座椅|chair/i.test(label)) return { url: shotGeneratorObjectUrls.chair, size: { x: 0.55, y: 0.92, z: 0.58 } };
  if (/桌|table/i.test(label) || item.kind === "table") return { url: shotGeneratorObjectUrls.rectangleTable, size: { x: Math.max(1.2, item.size.x), y: Math.max(0.74, item.size.y), z: Math.max(0.72, item.size.z) } };
  if (/双开门|双门/.test(label)) return { url: shotGeneratorObjectUrls.doubleDoor, size: { x: Math.max(1.6, item.size.x), y: Math.max(2.2, item.size.y), z: Math.max(0.16, item.size.z) } };
  if (/门/.test(label)) return { url: shotGeneratorObjectUrls.singleDoor, size: { x: Math.max(0.9, item.size.x), y: Math.max(2.1, item.size.y), z: Math.max(0.14, item.size.z) } };
  if (/窗/.test(label)) return { url: shotGeneratorObjectUrls.window, size: { x: Math.max(1.4, item.size.x), y: Math.max(1.2, item.size.y), z: Math.max(0.12, item.size.z) } };
  return { url: shotGeneratorObjectUrls.primitive, size: item.size };
}

function zoneAsset(zone: WhiteboxScene["zones"][number]): { url: ShotGeneratorObjectUrl; size: WhiteboxVector } | undefined {
  if (zone.kind === "building") return { url: shotGeneratorObjectUrls.building, size: zone.size };
  if (zone.kind === "entrance") return { url: shotGeneratorObjectUrls.doubleDoor, size: zone.size };
  if (zone.kind === "window") return { url: shotGeneratorObjectUrls.window, size: zone.size };
  if (zone.kind !== "table") return undefined;
  if (/吧台|柜台/.test(zone.label)) return { url: shotGeneratorObjectUrls.counter, size: zone.size };
  if (/吧桌|高桌/.test(zone.label)) return { url: shotGeneratorObjectUrls.barTable, size: zone.size };
  if (zone.size.x > zone.size.z * 1.35) return { url: shotGeneratorObjectUrls.rectangleTable, size: zone.size };
  return { url: shotGeneratorObjectUrls.squareTable, size: zone.size };
}

function makeTorsoHull(profile: BodyProfile, material: THREE.Material, entityId: string) {
  const points = [
    new THREE.Vector2(profile.hip * 0.88, 0),
    new THREE.Vector2(profile.waist, 0.17),
    new THREE.Vector2(profile.shoulder * 0.94, 0.47),
    new THREE.Vector2(profile.shoulder, 0.53),
    new THREE.Vector2(profile.shoulder * 0.78, 0.59),
    new THREE.Vector2(0.09, 0.61),
  ];
  const torso = makeMesh(new THREE.LatheGeometry(points, 32), material, entityId);
  torso.scale.z = profile.depth;
  return torso;
}

function makeActor(actor: WhiteboxActor) {
  const root = new THREE.Group();
  root.name = actor.label;
  root.userData.entityId = actor.id;
  root.position.set(actor.position.x, actor.position.y, actor.position.z);
  root.rotation.y = degrees(actor.yaw);
  root.scale.setScalar(actor.height / 1.75);

  const material = whiteMaterial();
  const jointMaterial = whiteMaterial(0xf3f1ec);
  const bodyType = normalizeWhiteboxBodyType(actor.bodyType);
  const poseName = normalizeWhiteboxPoseName(actor.poseName);
  const pose = normalizeWhiteboxPose(poseName, actor.pose);
  const profile = bodyProfiles[bodyType];
  // A seated pelvis must be lowered to chair height. Keeping the standing hip
  // height while rotating only the legs makes the figure float and exaggerates
  // any joint-angle error.
  const hipY = poseName === "sit" ? 0.52 : 0.88;

  // A rounded pelvis keeps the rig readable without looking like a stray box
  // hanging between the torso and legs.
  const pelvis = makeEllipsoid(0.18, { x: profile.hip / 0.18, y: 0.72, z: profile.depth }, material, actor.id);
  pelvis.position.y = hipY;
  root.add(pelvis);

  const torso = new THREE.Group();
  torso.userData.entityId = actor.id;
  torso.position.y = hipY + 0.08;
  torso.rotation.x = degrees(pose.torsoPitch);
  torso.rotation.z = degrees(pose.torsoRoll);
  root.add(torso);

  const chest = makeTorsoHull(profile, material, actor.id);
  chest.position.y = 0.04;
  torso.add(chest);

  const neck = makeMesh(new THREE.CylinderGeometry(0.075, 0.085, 0.12, 12), jointMaterial, actor.id);
  neck.position.y = 0.64;
  torso.add(neck);

  const headPivot = new THREE.Group();
  headPivot.userData.entityId = actor.id;
  headPivot.position.y = 0.78;
  headPivot.rotation.y = degrees(pose.headYaw);
  headPivot.rotation.x = degrees(pose.headPitch);
  torso.add(headPivot);
  const head = makeMesh(new THREE.SphereGeometry(0.145, 28, 20), jointMaterial, actor.id);
  head.scale.set(0.88 * profile.head, 1.08 * profile.head, 0.92 * profile.head);
  headPivot.add(head);
  // No mouth or facial expression on the blocking mannequin. A tiny raised
  // nose ridge is enough to communicate head direction without reading as lips.
  const nose = makeMesh(new THREE.ConeGeometry(0.018, 0.048, 12), jointMaterial, actor.id);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.018, 0.142);
  headPivot.add(nose);

  const addArm = (side: "left" | "right") => {
    const sign = side === "left" ? -1 : 1;
    const shoulderJoint = makeEllipsoid(profile.arm * 1.26, { x: 1, y: 1.06, z: 0.92 }, material, actor.id);
    shoulderJoint.position.set(sign * profile.shoulder, 0.54, 0);
    torso.add(shoulderJoint);
    const upper = makeLimb(0.34, profile.arm, material, actor.id);
    upper.position.set(sign * profile.shoulder, 0.54, 0);
    upper.rotation.x = degrees(pose[`${side}ShoulderPitch`]);
    upper.rotation.z = degrees(pose[`${side}ShoulderRoll`]);
    torso.add(upper);
    const lower = makeLimb(0.3, profile.arm * 0.88, jointMaterial, actor.id);
    lower.position.y = -0.34;
    lower.rotation.x = degrees(-pose[`${side}Elbow`]);
    upper.add(lower);
    const hand = makeEllipsoid(0.075, { x: 0.72, y: 1.05, z: 0.48 }, jointMaterial, actor.id);
    hand.position.y = -0.365;
    lower.add(hand);
  };
  addArm("left");
  addArm("right");

  const addLeg = (side: "left" | "right") => {
    const sign = side === "left" ? -1 : 1;
    const hipX = profile.hip * 0.55;
    const hipJoint = makeEllipsoid(profile.thigh * 1.18, { x: 1, y: 1.08, z: 0.92 }, material, actor.id);
    hipJoint.position.set(sign * hipX, hipY - 0.05, 0);
    root.add(hipJoint);
    const upper = makeLimb(0.43, profile.thigh, material, actor.id);
    upper.position.set(sign * hipX, hipY - 0.05, 0);
    upper.rotation.x = degrees(pose[`${side}HipPitch`]);
    upper.rotation.z = degrees(pose[`${side}HipRoll`]);
    root.add(upper);
    const lower = makeLimb(0.42, profile.thigh * 0.86, jointMaterial, actor.id);
    lower.position.y = -0.43;
    lower.rotation.x = degrees(pose[`${side}Knee`]);
    upper.add(lower);
    const foot = makeEllipsoid(0.1, { x: 0.72, y: 0.48, z: 1.36 }, material, actor.id);
    foot.position.set(0, -0.45, 0.075);
    lower.add(foot);
  };
  addLeg("left");
  addLeg("right");

  return root;
}

function makeVehicle(item: WhiteboxObject) {
  const root = new THREE.Group();
  root.name = item.label;
  root.userData.entityId = item.id;
  root.position.set(item.position.x, item.position.y, item.position.z);
  root.rotation.y = degrees(item.yaw);
  const sx = item.size.x / 4.5;
  const sy = item.size.y / 1.45;
  const sz = item.size.z / 1.8;
  root.scale.set(sx, sy, sz);
  const bodyMaterial = whiteMaterial(0xe3e2de);
  const glassMaterial = whiteMaterial(0xc9cdd0);
  const wheelMaterial = whiteMaterial(0x777a7d);

  const lower = makeMesh(new THREE.BoxGeometry(3.55, 0.55, 1.72), bodyMaterial, item.id);
  lower.position.set(-0.15, 0.55, 0);
  root.add(lower);
  const hood = makeMesh(new THREE.BoxGeometry(1.0, 0.32, 1.66), bodyMaterial, item.id);
  hood.position.set(1.95, 0.72, 0);
  root.add(hood);
  const cabin = makeMesh(new THREE.BoxGeometry(1.95, 0.72, 1.5), glassMaterial, item.id);
  cabin.position.set(0.2, 1.08, 0);
  cabin.rotation.z = degrees(-2);
  root.add(cabin);
  const rear = makeMesh(new THREE.BoxGeometry(0.72, 0.42, 1.65), bodyMaterial, item.id);
  rear.position.set(-2.0, 0.72, 0);
  root.add(rear);
  for (const x of [-1.45, 1.35]) {
    for (const z of [-0.86, 0.86]) {
      const wheel = makeMesh(new THREE.CylinderGeometry(0.34, 0.34, 0.18, 16), wheelMaterial, item.id);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.36, z);
      root.add(wheel);
    }
  }
  const bumper = makeMesh(new THREE.BoxGeometry(0.12, 0.22, 1.55), bodyMaterial, item.id);
  bumper.position.set(2.48, 0.45, 0);
  root.add(bumper);
  return root;
}

function makeObject(item: WhiteboxObject) {
  if (item.kind === "vehicle") return makeVehicle(item);
  const root = new THREE.Group();
  root.name = item.label;
  root.userData.entityId = item.id;
  root.position.set(item.position.x, item.position.y + item.size.y / 2, item.position.z);
  root.rotation.y = degrees(item.yaw);
  const mesh = makeMesh(new THREE.BoxGeometry(item.size.x, item.size.y, item.size.z), whiteMaterial(0xdeddd8), item.id);
  root.add(mesh);
  return root;
}

function makeZone(zone: WhiteboxScene["zones"][number]) {
  const root = new THREE.Group();
  root.name = zone.label;
  root.position.set(zone.position.x, zone.position.y, zone.position.z);
  const surfaceColor = zone.kind === "road" ? 0xbfc2c3 : zone.kind === "sidewalk" ? 0xd6d4ce : zone.kind === "building" ? 0xe4e1da : 0xdedbd4;
  if (zone.kind === "entrance") {
    const material = whiteMaterial(0xd8d4cb);
    const pillarWidth = Math.min(0.32, zone.size.x * 0.12);
    const pillar = new THREE.BoxGeometry(pillarWidth, zone.size.y, Math.max(0.18, zone.size.z));
    const left = makeMesh(pillar, material);
    left.position.x = -zone.size.x / 2 + pillarWidth / 2;
    const right = makeMesh(pillar, material);
    right.position.x = zone.size.x / 2 - pillarWidth / 2;
    const beam = makeMesh(new THREE.BoxGeometry(zone.size.x, 0.3, Math.max(0.18, zone.size.z)), material);
    beam.position.y = zone.size.y / 2 - 0.15;
    root.add(left, right, beam);
    return root;
  }
  const mesh = makeMesh(new THREE.BoxGeometry(Math.max(0.03, zone.size.x), Math.max(0.03, zone.size.y), Math.max(0.03, zone.size.z)), whiteMaterial(surfaceColor));
  root.add(mesh);
  return root;
}

function safeCameraPosition(data: WhiteboxScene, camera: WhiteboxCamera, aspect: number) {
  if (camera.autoFrame === false) return camera.position;
  const dx = camera.position.x - camera.target.x;
  const dz = camera.position.z - camera.target.z;
  const originalDistance = Math.max(0.1, Math.hypot(dx, dz));
  const direction = { x: dx / originalDistance, z: dz / originalDistance };
  const horizontalTan = Math.max(0.12, Math.tan(degrees(camera.fov / 2)) * aspect);
  const subjects = [
    ...data.actors.map((actor) => ({ position: actor.position, radius: Math.max(0.38, actor.height * 0.26) })),
    ...data.objects.map((item) => ({
      position: item.position,
      radius: item.kind === "vehicle" ? Math.hypot(item.size.x, item.size.z) * 0.5 : Math.max(0.25, Math.hypot(item.size.x, item.size.z) * 0.5),
    })),
  ];
  let requiredDistance = originalDistance;
  let lateralOffset = 0;
  subjects.forEach((subject) => {
    const relativeX = subject.position.x - camera.target.x;
    const relativeZ = subject.position.z - camera.target.z;
    const forward = relativeX * direction.x + relativeZ * direction.z;
    const signedLateral = relativeX * direction.z - relativeZ * direction.x;
    const lateral = Math.abs(signedLateral);
    requiredDistance = Math.max(requiredDistance, forward + 0.85 + (lateral + subject.radius) / horizontalTan);
    const proximity = Math.hypot(subject.position.x - camera.position.x, subject.position.z - camera.position.z);
    const collisionDistance = subject.radius + 0.7;
    if (proximity < collisionDistance) {
      const side = Math.abs(signedLateral) < 0.08 ? 1 : signedLateral > 0 ? -1 : 1;
      lateralOffset += side * (collisionDistance - proximity);
    }
  });
  const distance = Math.min(20, Math.max(1.6, requiredDistance));
  const safeLateral = THREE.MathUtils.clamp(lateralOffset, -2.4, 2.4);
  const cameraAt = (offset: number) => ({
    x: camera.target.x + direction.x * distance - direction.z * offset,
    y: camera.position.y,
    z: camera.target.z + direction.z * distance + direction.x * offset,
  });
  const isInsideSolid = (position: WhiteboxVector) => data.zones.some((zone) => (
    zone.kind === "building"
    && Math.abs(position.x - zone.position.x) < zone.size.x / 2 + 0.18
    && Math.abs(position.z - zone.position.z) < zone.size.z / 2 + 0.18
  ));
  const offsets = [safeLateral, -safeLateral, 0, 1.2, -1.2, 2.4, -2.4];
  const resolvedOffset = offsets.find((offset) => !isInsideSolid(cameraAt(offset))) ?? 0;
  return {
    ...cameraAt(resolvedOffset),
  };
}

function shotCameraFor(data: WhiteboxScene, aspect: number, source?: WhiteboxCamera) {
  const active = source || data.cameras.find((camera) => camera.id === data.activeCameraId) || data.cameras[0];
  const camera = new THREE.PerspectiveCamera(active?.fov || 42, aspect, 0.05, 120);
  if (active) {
    const position = safeCameraPosition(data, active, aspect);
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(active.target.x, active.target.y, active.target.z);
  } else {
    camera.position.set(0, 2, 7);
    camera.lookAt(0, 1, 0);
  }
  return camera;
}

export const WhiteboxStage = forwardRef<WhiteboxStageHandle, WhiteboxStageProps>(function WhiteboxStage(
  { sceneData, viewMode, selectedEntityId, onSelectEntity },
  forwardedRef,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    helpers: THREE.Group;
    shotCamera: THREE.PerspectiveCamera;
    orbitCamera: THREE.PerspectiveCamera;
    width: number;
    height: number;
  }>();

  useImperativeHandle(forwardedRef, () => ({
    captureCleanPng() {
      const runtime = runtimeRef.current;
      if (!runtime) return undefined;
      const { renderer, scene, helpers, shotCamera, width, height } = runtime;
      helpers.visible = false;
      renderer.setSize(2048, 1152, false);
      shotCamera.aspect = 16 / 9;
      shotCamera.updateProjectionMatrix();
      renderer.render(scene, shotCamera);
      const dataUrl = renderer.domElement.toDataURL("image/png");
      renderer.setSize(width, height, false);
      shotCamera.aspect = width / height;
      shotCamera.updateProjectionMatrix();
      helpers.visible = viewMode === "orbit";
      return dataUrl;
    },
  }), [viewMode]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f0eb);
    const content = new THREE.Group();
    const helpers = new THREE.Group();
    scene.add(content, helpers);
    let disposed = false;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x7c8388, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(-5, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -14;
    key.shadow.camera.right = 14;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -14;
    scene.add(key);

    const replaceFallback = (fallback: THREE.Object3D, request: Promise<THREE.Group>, label: string) => {
      void request.then((asset) => {
        if (disposed) {
          disposeObjectTree(asset);
          return;
        }
        content.remove(fallback);
        disposeObjectTree(fallback);
        content.add(asset);
      }).catch((error) => {
        console.warn(`Shot Generator object unavailable for ${label}; using smooth fallback.`, error);
      });
    };

    sceneData.zones.forEach((zone) => {
      const fallback = makeZone(zone);
      content.add(fallback);
      const asset = zoneAsset(zone);
      if (!asset) return;
      const floorY = zone.position.y - zone.size.y / 2;
      replaceFallback(
        fallback,
        makeShotGeneratorObject(asset.url, zone.id, zone.label, { ...zone.position, y: floorY }, 0, asset.size),
        zone.label,
      );
    });
    sceneData.objects.forEach((item) => {
      const fallback = makeObject(item);
      content.add(fallback);
      const asset = objectAsset(item);
      replaceFallback(
        fallback,
        makeShotGeneratorObject(asset.url, item.id, item.label, item.position, item.yaw, asset.size),
        item.label,
      );
    });
    sceneData.actors.forEach((actor) => {
      const fallback = makeActor(actor);
      content.add(fallback);
      void makeStoryboarderActor(actor).then((rig) => {
        if (!rig) return;
        if (disposed) {
          disposeObjectTree(rig);
          return;
        }
        content.remove(fallback);
        disposeObjectTree(fallback);
        content.add(rig);
      }).catch((error) => {
        console.warn(`Storyboarder rig unavailable for ${actor.label}; using smooth fallback.`, error);
      });
    });

    const floor = makeMesh(new THREE.PlaneGeometry(32, 24), whiteMaterial(0xe7e5df));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.025;
    floor.receiveShadow = true;
    content.add(floor);

    const grid = new THREE.GridHelper(30, 60, 0x3877d6, 0xaeb4bb);
    grid.position.y = 0.015;
    (grid.material as THREE.Material).opacity = 0.42;
    (grid.material as THREE.Material).transparent = true;
    helpers.add(grid);

    sceneData.cameras.forEach((item) => {
      const camera = shotCameraFor(sceneData, 16 / 9, item);
      camera.far = 30;
      camera.updateMatrixWorld();
      const helper = new THREE.CameraHelper(camera);
      (helper.material as THREE.LineBasicMaterial).color.set(item.id === sceneData.activeCameraId ? 0x155eef : 0x8d5be8);
      helper.userData.entityId = item.id;
      helpers.add(helper);
    });

    if (selectedEntityId) {
      const selected = content.children.find((child) => child.userData.entityId === selectedEntityId);
      if (selected) helpers.add(new THREE.BoxHelper(selected, 0x155eef));
    }

    const width = Math.max(320, host.clientWidth || 640);
    const height = Math.max(180, host.clientHeight || Math.round(width * 9 / 16));
    renderer.setSize(width, height, false);
    const shotCamera = shotCameraFor(sceneData, width / height);
    const orbitCamera = new THREE.PerspectiveCamera(44, width / height, 0.05, 160);
    orbitCamera.position.set(8, 8, 10);
    const controls = new OrbitControls(orbitCamera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.9, 0);
    controls.update();
    helpers.visible = viewMode === "orbit";
    runtimeRef.current = { renderer, scene, helpers, shotCamera, orbitCamera, width, height };

    const render = () => {
      controls.enabled = viewMode === "orbit";
      controls.update();
      helpers.visible = viewMode === "orbit";
      renderer.render(scene, viewMode === "orbit" ? orbitCamera : shotCamera);
    };
    renderer.setAnimationLoop(render);

    let lastWidth = width;
    let lastHeight = height;
    let resizeFrame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        const nextWidth = Math.round(Math.max(320, host.clientWidth || 640));
        const nextHeight = Math.round(Math.max(180, host.clientHeight || Math.round(nextWidth * 9 / 16)));
        if (nextWidth === lastWidth && nextHeight === lastHeight) return;
        lastWidth = nextWidth;
        lastHeight = nextHeight;
        renderer.setSize(nextWidth, nextHeight, false);
        shotCamera.aspect = nextWidth / nextHeight;
        orbitCamera.aspect = nextWidth / nextHeight;
        shotCamera.updateProjectionMatrix();
        orbitCamera.updateProjectionMatrix();
        if (runtimeRef.current) {
          runtimeRef.current.width = nextWidth;
          runtimeRef.current.height = nextHeight;
        }
      });
    });
    resize.observe(host);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handleClick = (event: MouseEvent) => {
      if (viewMode !== "orbit" || !onSelectEntity) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, orbitCamera);
      const hit = raycaster.intersectObjects(content.children, true).find((candidate) => {
        let object: THREE.Object3D | null = candidate.object;
        while (object) {
          if (object.userData.entityId) return true;
          object = object.parent;
        }
        return false;
      });
      if (!hit) return;
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.entityId) object = object.parent;
      if (object?.userData.entityId) onSelectEntity(String(object.userData.entityId));
    };
    renderer.domElement.addEventListener("click", handleClick);

    return () => {
      disposed = true;
      resize.disconnect();
      cancelAnimationFrame(resizeFrame);
      renderer.domElement.removeEventListener("click", handleClick);
      renderer.setAnimationLoop(null);
      controls.dispose();
      disposeObjectTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
      runtimeRef.current = undefined;
    };
  }, [onSelectEntity, sceneData, selectedEntityId, viewMode]);

  return <div className="whitebox-canvas" ref={hostRef} aria-label="可旋转的三维白模预演画布" />;
});

function NumberField({ label, value, step = 0.1, min, max, onChange }: { label: string; value: number; step?: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return <label className="whitebox-number"><span>{label}</span><input type="number" value={Number(value.toFixed(3))} step={step} min={min} max={max} onChange={(event) => onChange(Number(event.target.value) || 0)} /></label>;
}

function SliderField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="whitebox-slider"><span>{label}<b>{Math.round(value)}°</b></span><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function VectorEditor({ title, value, onChange, includeY = true }: { title: string; value: WhiteboxVector; onChange: (value: WhiteboxVector) => void; includeY?: boolean }) {
  return (
    <div className="whitebox-vector">
      <b>{title}</b>
      <NumberField label="X" value={value.x} onChange={(x) => onChange({ ...value, x })} />
      {includeY ? <NumberField label="Y" value={value.y} onChange={(y) => onChange({ ...value, y })} /> : null}
      <NumberField label="Z" value={value.z} onChange={(z) => onChange({ ...value, z })} />
    </div>
  );
}

type SelectedEntity =
  | { type: "actor"; value: WhiteboxActor }
  | { type: "object"; value: WhiteboxObject }
  | { type: "camera"; value: WhiteboxCamera };

export function WhiteboxEditor({
  scene,
  shotId,
  viewLabel,
  onChange,
  onReset,
  onLockReference,
  onUnlockReference,
  referenceLocked = false,
}: {
  scene: WhiteboxScene;
  shotId: string;
  viewLabel: string;
  onChange: (scene: WhiteboxScene) => void;
  onReset: () => void;
  onLockReference: (dataUrl: string) => void | Promise<void>;
  onUnlockReference: () => void | Promise<void>;
  referenceLocked?: boolean;
}) {
  const stageRef = useRef<WhiteboxStageHandle>(null);
  const [viewMode, setViewMode] = useState<WhiteboxViewMode>("shot");
  const [shotAngle, setShotAngle] = useState<WhiteboxShotAngle>("eye");
  const [poseLibrary, setPoseLibrary] = useState<StoryboarderPoseEntry[]>([]);
  const [poseQuery, setPoseQuery] = useState("");
  const [poseCategory, setPoseCategory] = useState<StoryboarderPoseCategory>("all");
  const [selectedId, setSelectedId] = useState(scene.actors[0]?.id || scene.objects[0]?.id || scene.cameras[0]?.id || "");
  const entityIds = useMemo(
    () => [...scene.actors, ...scene.objects, ...scene.cameras].map((item) => item.id),
    [scene.actors, scene.objects, scene.cameras],
  );
  const activeSelectedId = entityIds.includes(selectedId) ? selectedId : entityIds[0] || "";

  const selected = useMemo<SelectedEntity | undefined>(() => {
    const actor = scene.actors.find((item) => item.id === activeSelectedId);
    if (actor) return { type: "actor", value: actor };
    const object = scene.objects.find((item) => item.id === activeSelectedId);
    if (object) return { type: "object", value: object };
    const camera = scene.cameras.find((item) => item.id === activeSelectedId);
    return camera ? { type: "camera", value: camera } : undefined;
  }, [scene, activeSelectedId]);
  const framingActor = selected?.type === "actor" ? selected.value : scene.actors[0];
  const filteredPoseLibrary = useMemo(() => {
    const query = poseQuery.trim().toLowerCase();
    return poseLibrary.filter((entry) => (
      (poseCategory === "all" || entry.category === poseCategory)
      && (!query || `${entry.name} ${entry.keywords}`.toLowerCase().includes(query))
    ));
  }, [poseCategory, poseLibrary, poseQuery]);

  useEffect(() => {
    let cancelled = false;
    void loadStoryboarderPoses().then((poses) => {
      if (cancelled) return;
      const entries = Object.entries(poses).map(([id, pose]) => {
        const name = pose.name?.trim() || `Pose ${id.slice(0, 8)}`;
        const keywords = Array.isArray(pose.keywords) ? pose.keywords.join(" ") : pose.keywords || "";
        return { id, name, keywords, category: storyboarderPoseCategory(name, keywords) } satisfies StoryboarderPoseEntry;
      }).sort((a, b) => a.name.localeCompare(b.name, "en"));
      setPoseLibrary(entries);
    }).catch((error) => {
      console.warn("Storyboarder pose library unavailable.", error);
    });
    return () => { cancelled = true; };
  }, []);

  function commit(next: WhiteboxScene) {
    onChange({ ...next, updatedAt: new Date().toISOString() });
  }

  function updateActor(patch: Partial<WhiteboxActor>) {
    if (selected?.type !== "actor") return;
    commit({ ...scene, actors: scene.actors.map((item) => item.id === selected.value.id ? { ...item, ...patch } : item) });
  }

  function updateActorPose(field: keyof WhiteboxPose, value: number) {
    if (selected?.type !== "actor") return;
    updateActor({ poseName: selected.value.poseName, pose: { ...selected.value.pose, [field]: value } });
  }

  function selectPose(name: WhiteboxPoseName) {
    updateActor({ poseName: name, storyboarderPoseId: undefined, storyboarderPoseName: undefined, pose: { ...whiteboxPosePresets[name] } });
  }

  function selectStoryboarderPose(id: string) {
    const entry = poseLibrary.find((item) => item.id === id);
    if (!entry) return;
    updateActor({
      poseName: "neutral",
      storyboarderPoseId: entry.id,
      storyboarderPoseName: entry.name,
      pose: { ...whiteboxPosePresets.neutral },
    });
  }

  function updateObject(patch: Partial<WhiteboxObject>) {
    if (selected?.type !== "object") return;
    commit({ ...scene, objects: scene.objects.map((item) => item.id === selected.value.id ? { ...item, ...patch } : item) });
  }

  function updateCamera(patch: Partial<WhiteboxCamera>) {
    if (selected?.type !== "camera") return;
    commit({ ...scene, cameras: scene.cameras.map((item) => item.id === selected.value.id ? { ...item, ...patch } : item) });
  }

  function applyShotPreset(size: WhiteboxShotSize) {
    if (!framingActor) return;
    const activeCamera = scene.cameras.find((camera) => camera.id === scene.activeCameraId) || scene.cameras[0];
    if (!activeCamera) return;
    const currentDx = activeCamera.position.x - activeCamera.target.x;
    const currentDz = activeCamera.position.z - activeCamera.target.z;
    const currentDistance = Math.hypot(currentDx, currentDz);
    const directionX = currentDistance > 0.01 ? currentDx / currentDistance : 0;
    const directionZ = currentDistance > 0.01 ? currentDz / currentDistance : 1;
    const scale = framingActor.height / 1.75;
    const framing = {
      close: { distance: 1.25, targetRatio: 0.86, fov: 36, lens: "50mm · 特写" },
      bust: { distance: 2.05, targetRatio: 0.74, fov: 38, lens: "50mm · 胸像" },
      medium: { distance: 3.15, targetRatio: 0.58, fov: 40, lens: "35mm · 中景" },
      full: { distance: 4.75, targetRatio: 0.5, fov: 42, lens: "35mm · 全身" },
      wide: { distance: 7.4, targetRatio: 0.48, fov: 48, lens: "28mm · 远景" },
    }[size];
    const targetY = framingActor.position.y + framingActor.height * framing.targetRatio;
    const cameraY = shotAngle === "high"
      ? targetY + Math.max(1.25, framing.distance * 0.28)
      : shotAngle === "low"
        ? Math.max(0.35, targetY - Math.max(0.65, framing.distance * 0.17))
        : targetY + 0.08;
    const distance = framing.distance * scale;
    const nextCamera: WhiteboxCamera = {
      ...activeCamera,
      lens: framing.lens,
      fov: framing.fov,
      autoFrame: false,
      position: {
        x: framingActor.position.x + directionX * distance,
        y: cameraY,
        z: framingActor.position.z + directionZ * distance,
      },
      target: {
        x: framingActor.position.x,
        y: targetY,
        z: framingActor.position.z,
      },
    };
    commit({
      ...scene,
      activeCameraId: nextCamera.id,
      cameras: scene.cameras.map((camera) => camera.id === nextCamera.id ? nextCamera : camera),
    });
    setViewMode("shot");
  }

  function addActor() {
    const actor = createWhiteboxActor(scene.actors.length + 1);
    commit({ ...scene, actors: [...scene.actors, actor] });
    setSelectedId(actor.id);
    setViewMode("orbit");
  }

  function addObject(kind: WhiteboxObjectKind) {
    const object = createWhiteboxObject(kind, scene.objects.length + 1);
    commit({ ...scene, objects: [...scene.objects, object] });
    setSelectedId(object.id);
    setViewMode("orbit");
  }

  function removeSelected() {
    if (!selected || selected.type === "camera") return;
    if (!window.confirm(`删除“${selected.value.label}”白模？`)) return;
    commit({
      ...scene,
      actors: scene.actors.filter((item) => item.id !== selected.value.id),
      objects: scene.objects.filter((item) => item.id !== selected.value.id),
    });
  }

  function downloadCleanFrame() {
    const dataUrl = stageRef.current?.captureCleanPng();
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `镜导-${shotId}-${viewLabel}-3D白模-16x9.png`;
    link.click();
  }

  async function lockCleanReference() {
    const dataUrl = stageRef.current?.captureCleanPng();
    if (!dataUrl) return;
    await onLockReference(dataUrl);
  }

  return (
    <section className="whitebox-editor">
      <div className="whitebox-toolbar">
        <div className="whitebox-view-tabs" role="group" aria-label="白模查看模式">
          <button type="button" className={viewMode === "shot" ? "active" : ""} onClick={() => setViewMode("shot")}>摄影机白模</button>
          <button type="button" className={viewMode === "orbit" ? "active" : ""} onClick={() => setViewMode("orbit")}>可编辑预演</button>
        </div>
        <div className="whitebox-output-actions">
          <button type="button" className={referenceLocked ? "whitebox-lock locked" : "whitebox-lock"} onClick={() => void (referenceLocked ? onUnlockReference() : lockCleanReference())}>{referenceLocked ? "✓ 已锁定 · 点此取消" : "锁定为生图结构参考"}</button>
          <button type="button" className="whitebox-download" onClick={downloadCleanFrame}>导出纯净16:9 PNG</button>
        </div>
      </div>
      <div className="whitebox-stage-wrap">
        <WhiteboxStage ref={stageRef} sceneData={scene} viewMode={viewMode} selectedEntityId={viewMode === "orbit" ? activeSelectedId : undefined} onSelectEntity={setSelectedId} />
        <div className="whitebox-frame-badge"><b>{viewMode === "shot" ? "CLEAN CAMERA" : "EDIT MODE"}</b><span>{viewMode === "shot" ? "无文字 · 无箭头 · 无网格" : "拖动旋转 · 滚轮缩放 · 点击模型选择"}</span></div>
      </div>

      <div className="whitebox-shot-generator" aria-label="Shot Generator 自动构图">
        <div className="whitebox-shot-generator-heading">
          <div><b>SHOT GENERATOR</b><span>{framingActor ? `以“${framingActor.label}”为构图主体` : "请先添加或选择人物"}</span></div>
          <small>保留当前水平方向，自动生成镜别、俯仰角和摄影机距离</small>
        </div>
        <div className="whitebox-shot-generator-row">
          <span>镜别</span>
          {Object.entries(shotSizeLabels).map(([key, label]) => <button type="button" key={key} disabled={!framingActor} onClick={() => applyShotPreset(key as WhiteboxShotSize)}>{label}</button>)}
        </div>
        <div className="whitebox-shot-generator-row">
          <span>角度</span>
          {Object.entries(shotAngleLabels).map(([key, label]) => <button type="button" key={key} className={shotAngle === key ? "active" : ""} onClick={() => setShotAngle(key as WhiteboxShotAngle)}>{label}</button>)}
        </div>
      </div>

      <div className="whitebox-entity-toolbar">
        <button type="button" onClick={addActor}>＋ 自建小人白模</button>
        <button type="button" onClick={() => addObject("vehicle")}>＋ 车辆白模</button>
        <button type="button" onClick={() => addObject("box")}>＋ 物体白模</button>
        <button type="button" className="reset" onClick={() => { if (window.confirm("恢复为当前 TOP VIEW 自动生成的白模？手工调整会被清除。")) onReset(); }}>从TOP VIEW重建</button>
      </div>

      <div className="whitebox-entity-list" aria-label="白模对象列表">
        {scene.actors.map((item) => <button type="button" className={activeSelectedId === item.id ? "active actor" : "actor"} key={item.id} onClick={() => { setSelectedId(item.id); setViewMode("orbit"); }}><span>人</span><b>{item.label}</b><small>{item.storyboarderPoseName || whiteboxPoseLabels[item.poseName]}</small></button>)}
        {scene.objects.map((item) => <button type="button" className={activeSelectedId === item.id ? "active object" : "object"} key={item.id} onClick={() => { setSelectedId(item.id); setViewMode("orbit"); }}><span>{item.kind === "vehicle" ? "车" : "物"}</span><b>{item.label}</b><small>{item.kind}</small></button>)}
        {scene.cameras.map((item) => <button type="button" className={activeSelectedId === item.id ? "active camera" : "camera"} key={item.id} onClick={() => { setSelectedId(item.id); setViewMode("orbit"); }}><span>机</span><b>{item.id}</b><small>{item.lens}</small></button>)}
      </div>

      {selected ? (
        <div className="whitebox-inspector">
          <div className="whitebox-inspector-heading"><div><span>{selected.type === "actor" ? "HUMANOID RIG" : selected.type === "camera" ? "CAMERA" : "OBJECT"}</span><h3>{selected.value.label}</h3></div>{selected.type !== "camera" ? <button type="button" onClick={removeSelected}>删除</button> : null}</div>
          {selected.type === "actor" ? (
            <>
              <label className="whitebox-text"><span>人物名称</span><input value={selected.value.label} onChange={(event) => updateActor({ label: event.target.value })} /></label>
              <div className="whitebox-control-grid">
                <VectorEditor title="站位（米）" value={selected.value.position} includeY={false} onChange={(position) => updateActor({ position })} />
                <div className="whitebox-control-stack">
                  <NumberField label="身高 / 米" min={1.2} max={2.2} step={0.01} value={selected.value.height} onChange={(height) => updateActor({ height })} />
                  <label className="whitebox-select"><span>人偶体型</span><select value={selected.value.bodyType || "neutral"} onChange={(event) => updateActor({ bodyType: event.target.value as WhiteboxBodyType })}>{Object.entries(whiteboxBodyTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  <SliderField label="身体朝向" value={selected.value.yaw} min={-180} max={180} onChange={(yaw) => updateActor({ yaw })} />
                  <label className="whitebox-select"><span>基础动作预设</span><select value={selected.value.storyboarderPoseId ? "__storyboarder__" : selected.value.poseName} onChange={(event) => { if (event.target.value !== "__storyboarder__") selectPose(event.target.value as WhiteboxPoseName); }}>{selected.value.storyboarderPoseId ? <option value="__storyboarder__">Storyboarder · {selected.value.storyboarderPoseName}</option> : null}{Object.entries(whiteboxPoseLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                </div>
              </div>
              <label className="whitebox-text"><span>动作意图 / 接触关系</span><textarea rows={2} value={selected.value.actionNote} placeholder="例如：右手抓住对方右腕；身体重心后移" onChange={(event) => updateActor({ actionNote: event.target.value })} /></label>
              <details className="whitebox-pose-library" open>
                <summary><span>STORYBOARDER 姿势库</span><b>{poseLibrary.length ? `${filteredPoseLibrary.length} / ${poseLibrary.length}` : "载入中…"}</b></summary>
                <div className="whitebox-pose-library-body">
                  <label className="whitebox-pose-search"><span>搜索姿势</span><input value={poseQuery} placeholder="例如：gun、aim、sit、run" onChange={(event) => setPoseQuery(event.target.value)} /></label>
                  <div className="whitebox-pose-categories" role="group" aria-label="姿势分类">
                    {Object.entries(storyboarderPoseCategoryLabels).map(([key, label]) => <button type="button" key={key} className={poseCategory === key ? "active" : ""} onClick={() => setPoseCategory(key as StoryboarderPoseCategory)}>{label}</button>)}
                  </div>
                  <label className="whitebox-pose-results"><span>全部可用姿势 · 可滚动选择</span><select size={9} value={selected.value.storyboarderPoseId || ""} onChange={(event) => selectStoryboarderPose(event.target.value)}>{filteredPoseLibrary.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.keywords && entry.keywords.toLowerCase() !== entry.name.toLowerCase() ? ` · ${entry.keywords}` : ""}</option>)}</select></label>
                  <p>{selected.value.storyboarderPoseId ? `当前：${selected.value.storyboarderPoseName}` : "当前使用基础动作；从上方列表选择后切换为 Storyboarder 原版姿势。"}</p>
                </div>
              </details>
              <details className="whitebox-rig-controls" open>
                <summary>骨骼动作细调</summary>
                <div>
                  <SliderField label="躯干前后" value={selected.value.pose.torsoPitch} min={-60} max={70} onChange={(value) => updateActorPose("torsoPitch", value)} />
                  <SliderField label="躯干左右" value={selected.value.pose.torsoRoll} min={-60} max={60} onChange={(value) => updateActorPose("torsoRoll", value)} />
                  <SliderField label="头部转向" value={selected.value.pose.headYaw} min={-80} max={80} onChange={(value) => updateActorPose("headYaw", value)} />
                  <SliderField label="左臂前后" value={selected.value.pose.leftShoulderPitch} min={-130} max={130} onChange={(value) => updateActorPose("leftShoulderPitch", value)} />
                  <SliderField label="左肘弯曲" value={selected.value.pose.leftElbow} min={0} max={145} onChange={(value) => updateActorPose("leftElbow", value)} />
                  <SliderField label="右臂前后" value={selected.value.pose.rightShoulderPitch} min={-130} max={130} onChange={(value) => updateActorPose("rightShoulderPitch", value)} />
                  <SliderField label="右肘弯曲" value={selected.value.pose.rightElbow} min={0} max={145} onChange={(value) => updateActorPose("rightElbow", value)} />
                  <SliderField label="左腿前后" value={selected.value.pose.leftHipPitch} min={-100} max={110} onChange={(value) => updateActorPose("leftHipPitch", value)} />
                  <SliderField label="左膝弯曲" value={selected.value.pose.leftKnee} min={0} max={145} onChange={(value) => updateActorPose("leftKnee", value)} />
                  <SliderField label="右腿前后" value={selected.value.pose.rightHipPitch} min={-100} max={110} onChange={(value) => updateActorPose("rightHipPitch", value)} />
                  <SliderField label="右膝弯曲" value={selected.value.pose.rightKnee} min={0} max={145} onChange={(value) => updateActorPose("rightKnee", value)} />
                </div>
              </details>
            </>
          ) : selected.type === "object" ? (
            <>
              <label className="whitebox-text"><span>物体名称</span><input value={selected.value.label} onChange={(event) => updateObject({ label: event.target.value })} /></label>
              <div className="whitebox-control-grid">
                <VectorEditor title="站位（米）" value={selected.value.position} includeY={false} onChange={(position) => updateObject({ position })} />
                <VectorEditor title="尺寸（米）" value={selected.value.size} onChange={(size) => updateObject({ size })} />
              </div>
              <SliderField label="物体朝向" value={selected.value.yaw} min={-180} max={180} onChange={(yaw) => updateObject({ yaw })} />
            </>
          ) : (
            <>
              <div className="whitebox-control-grid">
                <VectorEditor title="摄影机位置（米）" value={selected.value.position} onChange={(position) => updateCamera({ position })} />
                <VectorEditor title="镜头目标（米）" value={selected.value.target} onChange={(target) => updateCamera({ target })} />
              </div>
              <div className="whitebox-camera-controls">
                <NumberField label="视场角 FOV" min={8} max={95} step={1} value={selected.value.fov} onChange={(fov) => updateCamera({ fov })} />
                <button type="button" className={selected.value.autoFrame !== false ? "active" : ""} onClick={() => updateCamera({ autoFrame: selected.value.autoFrame === false })}>{selected.value.autoFrame !== false ? "自动防穿模：开" : "精确机位：开"}</button>
                <button type="button" className={scene.activeCameraId === selected.value.id ? "active" : ""} onClick={() => commit({ ...scene, activeCameraId: selected.value.id })}>{scene.activeCameraId === selected.value.id ? "当前摄影机" : "设为当前摄影机"}</button>
              </div>
            </>
          )}
        </div>
      ) : null}
      <p className="whitebox-footnote">所有人物默认使用同一套本地 Storyboarder Shot Generator 通用骨骼；需要区分成年男女或少年少女时，可在人偶体型中单独切换。白模只锁定空间、站位、朝向、动作重心和摄影机；导出的PNG不会包含名称、网格、箭头、骨骼控制线或最终人物外观。</p>
    </section>
  );
}
