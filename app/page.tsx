"use client";

import { ChangeEvent, CSSProperties, ReactNode, UIEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { blockingPlans, type BlockingMarker, type BlockingMovement } from "./blocking-plans";
import { globalSettings as sourceGlobalSettings, type GlobalSettings } from "./global-settings";
import { defaultArtStyle, inferredVideoArtStyle, legacyStoryboardArtStyle, mistakenStoryboardAsVideoArtStyle, storyboardArtworkStyle, storyboardShots, type StoryboardShot, type StoryboardSegment } from "./storyboard-data";
import { buildCoverageReport, changedShotFields, defaultDirectorRecipeId, directorRecipes, getDirectorRecipe, sourceDocumentFromShots, sourceTextForShot, type CoverageStatus } from "./director-workflow";
import { MediaLab, type MediaAnalysisResult } from "./media-lab";
import { buildShotUpstreamRevision, buildVideoGenerationPackage, type VideoGenerationPackage, type VideoPackageStatus } from "./video-package";
import { WhiteboxEditor } from "./whitebox-stage";
import { createWhiteboxScene, ensureWhiteboxScenes, type WhiteboxScene } from "./whitebox-data";

type ViewId = "script" | "artwork" | "confirm";
type WorkspaceMode = "shots" | "global" | "materials" | "coverage" | "assets";
type SectionId = "characters" | "scene" | "story" | "action" | "continuity" | "style" | "director";
type GenerationModel = "seedance-2.0" | "seedance-2.5";
type DirectorVisualMode = "top" | "whitebox";
type ScriptStatus = "draft" | "sending" | "applied" | "error";
type ArtworkStatus = "empty" | "generating" | "ready" | "error";
type AssetFilter = "all" | "attention" | "ready" | "running";
type ShotAssetKind = "character" | "scene" | "prop";
type AssetImageModel = "Lib Image" | "General image Pro" | "Seedream 5.0 Pro";
type AssetImageRatio = "16:9" | "9:16" | "1:1" | "3:4" | "4:3" | "3:2" | "2:3" | "4:5" | "5:4" | "21:9";
type AssetImageResolution = "1K" | "2K" | "4K";

type ShotAssetImageSettings = {
  model: AssetImageModel;
  ratio: AssetImageRatio;
  resolution: AssetImageResolution;
};

type ShotAssetEntry = {
  id: string;
  kind: ShotAssetKind;
  name: string;
};

type ProjectAssetPrompt = {
  id: string;
  kind: ShotAssetKind;
  name: string;
  sourceObservation: string;
  prompt: string;
  negative: string[];
  sourcePanels: string[];
  shotIds: string[];
};

const assetImageModels: Array<{ id: AssetImageModel; label: string }> = [
  { id: "Lib Image", label: "Lib Image" },
  { id: "General image Pro", label: "General image Pro" },
  { id: "Seedream 5.0 Pro", label: "Seedream 5.0 Pro" },
];
const assetImageRatios: AssetImageRatio[] = ["16:9", "9:16", "1:1", "3:4", "4:3", "3:2", "2:3", "4:5", "5:4", "21:9"];
const assetImageResolutions: AssetImageResolution[] = ["1K", "2K", "4K"];

function assetImageRatiosFor(model: AssetImageModel) {
  return model === "Seedream 5.0 Pro"
    ? assetImageRatios.filter((ratio) => ratio !== "4:5" && ratio !== "5:4")
    : assetImageRatios;
}

function assetImageResolutionsFor(model: AssetImageModel) {
  return model === "Seedream 5.0 Pro"
    ? assetImageResolutions.filter((resolution) => resolution !== "4K")
    : assetImageResolutions;
}

type Revision = {
  version: number;
  createdAt: string;
  summary: string;
  shot: StoryboardShot;
  previousShot?: StoryboardShot;
  annotations?: Partial<Record<SectionId, string>>;
  recipeId?: string;
};

type AnnotationSubmission = {
  shotId: string;
  submittedAt: string;
  annotations: Record<SectionId, string>;
};

type AnnotationResult = {
  status?: string;
  shot: StoryboardShot;
  summary?: string;
  submittedAt?: string;
  requestId?: string;
  startedAt?: string;
  finishedAt?: string;
};

type AnnotationBatchResult = {
  status?: string;
  shots: StoryboardShot[];
  summary?: string;
  submittedAt?: string;
  requestId?: string;
  startedAt?: string;
  finishedAt?: string;
};

type ShotReview = {
  shot: StoryboardShot;
  annotations: Record<SectionId, string>;
  pendingSubmission?: AnnotationSubmission;
  scriptStatus: ScriptStatus;
  artworkStatus: ArtworkStatus;
  summary?: string;
  artworkName?: string;
  artworkNames?: string[];
  selectedArtworkIndex?: number;
  artworkAttempt?: number;
  artworkPrompt?: string;
  artworkSourceRevision?: string;
  artworkDependencyRevision?: string;
  videoPrompt?: string;
  videoPromptSourceRevision?: string;
  videoPackageSyncedAt?: string;
  selectedDirectorView?: string;
  whiteboxScenes: Record<string, WhiteboxScene>;
  whiteboxReferences?: Record<string, { lockedAt: string; sourceRevision?: string }>;
  seededAssetReferenceIds?: string[];
  approved: boolean;
  approvedAt?: string;
  versions: Revision[];
};

type ShotNavigationGroup = {
  key: string;
  label: string;
  indices: number[];
  reviews: ShotReview[];
};

const openingSubshotIds = new Set(["01A", "01B"]);

function isOpeningSubshotId(shotId: string) {
  return openingSubshotIds.has(shotId);
}

function openingSubshotNumber(shotId: string) {
  return shotId === "01B" ? "02" : "01";
}

function buildShotNavigationGroups(reviews: ShotReview[]): ShotNavigationGroup[] {
  const groups: ShotNavigationGroup[] = [];
  reviews.forEach((review, index) => {
    if (isOpeningSubshotId(review.shot.id)) {
      const existing = groups.find((group) => group.key === "opening");
      if (existing) {
        existing.indices.push(index);
        existing.reviews.push(review);
      } else {
        groups.push({ key: "opening", label: "01", indices: [index], reviews: [review] });
      }
      return;
    }
    groups.push({ key: review.shot.id, label: review.shot.id, indices: [index], reviews: [review] });
  });
  return groups;
}

type ReviewState = {
  stateSchemaVersion: number;
  projectTitle: string;
  sourceDocument: string;
  sourceName: string;
  selectedRecipeId: string;
  generationModel: GenerationModel;
  workspaceMode: WorkspaceMode;
  globalSettings: GlobalSettings;
  assetPrompts?: ProjectAssetPrompt[];
  globalAnnotation: string;
  globalStatus: ScriptStatus;
  globalSummary?: string;
  globalUpdatedAt?: string;
  sourceMangaRequestId?: string;
  currentShot: number;
  view: ViewId;
  reviews: ShotReview[];
};

type BridgeState = {
  connected: boolean;
  busy: boolean;
  pairingToken?: string;
  activeJob?: BridgeJob;
  lastJob?: BridgeJob;
  artworkJobs?: BridgeJob[];
  lastArtworkJobs?: BridgeJob[];
  assetJobs?: BridgeJob[];
  lastAssetJobs?: BridgeJob[];
  libtv?: LibtvState;
};

type LibtvState = {
  installed: boolean;
  status: "checking" | "missing" | "needs_login" | "logging_in" | "ready" | "error";
  message?: string;
  checkedAt?: string;
  accountName?: string;
  loginBusy?: boolean;
  model?: string;
  ratio?: string;
  resolution?: string;
  quality?: string;
  count?: number;
};

type ArtworkResult = {
  status?: string;
  artworkFile?: string;
  artworkUrl?: string;
  artworkFiles?: string[];
  artworkUrls?: string[];
  assetFile?: string;
  assetUrl?: string;
  assetFiles?: string[];
  assetUrls?: string[];
  summary?: string;
  canvasUrl?: string;
};

type BridgeJobEvent = {
  at: string;
  stage: string;
  message: string;
};

type BridgeJob = {
  type: "annotation" | "annotation-batch" | "global-annotation" | "artwork" | "asset-artwork" | "load-script";
  shotId: string;
  projectTitle?: string;
  assetId?: string;
  assetKind?: ShotAssetKind;
  assetName?: string;
  requestId?: string;
  status?: "running" | "completed" | "failed";
  stage?: string;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  events?: BridgeJobEvent[];
  error?: string;
};

const defaultProjectTitle = "未命名项目";
const storageKey = "shotdirector-storyboard-review-v12";
const materialDraftStoragePrefix = "shotdirector-storyboard-draft-v1::";
const legacyStorageKeys = ["shotdirector-storyboard-review-v11", "shotdirector-storyboard-review-v10", "shotdirector-storyboard-review-v9", "shotdirector-storyboard-review-v8", "shotdirector-storyboard-review-v7", "shotdirector-storyboard-review-v6", "shotdirector-storyboard-review-v5"];
const stateSchemaVersion = 12;
const artworkDb = "shotdirector-artwork-v1";
const bridgeBase = "http://127.0.0.1:4317";
const storyboardSourceRevision = "blank-project-v1";
const absoluteMaxOmniReferences = 50;
const staleSendingGraceMs = 4000;
const staleArtworkGraceMs = 4000;

const generationModels: Array<{ id: GenerationModel; label: string; limit: number; minDuration: number; maxDuration: number }> = [
  { id: "seedance-2.0", label: "Seedance 2.0", limit: 9, minDuration: 4, maxDuration: 15 },
  { id: "seedance-2.5", label: "Seedance 2.5", limit: 50, minDuration: 4, maxDuration: 30 },
];

function referenceLimitFor(model: GenerationModel) {
  return generationModels.find((item) => item.id === model)?.limit ?? 9;
}

function durationRangeFor(model: GenerationModel) {
  const target = generationModels.find((item) => item.id === model);
  return { min: target?.minDuration ?? 4, max: target?.maxDuration ?? 15 };
}

const sections: Array<{ id: SectionId; number: string; title: string; hint: string }> = [
  { id: "characters", number: "01", title: "人物", hint: "身份、外形、谁能露脸、谁绝不能露脸" },
  { id: "scene", number: "02", title: "物品和场景", hint: "关键车辆、道具、地点、时代、人物站位、朝向和构图" },
  { id: "story", number: "03", title: "剧情", hint: "这一镜究竟讲清什么，以及说了什么" },
  { id: "action", number: "04", title: "动作", hint: "机位、动作起止状态、遮挡与剪切点" },
  { id: "continuity", number: "05", title: "连续", hint: "从上一镜接什么，下一镜必须保留什么" },
  { id: "style", number: "06", title: "美术风格", hint: "画种、年代质感、线条、明暗、色彩与画幅要求" },
];

const directorSection: { id: SectionId; number: string; title: string; hint: string } = {
  id: "director",
  number: "DV",
  title: "DIRECTOR VIEW",
  hint: "道路、人物与车辆站位、朝向、机位和运镜轨迹",
};
const annotationSections = [...sections, directorSection];

function annotationCountFor(review: ShotReview) {
  return annotationSections.filter((section) => (review.annotations?.[section.id] || "").trim()).length;
}

type DirectorViewOption = {
  key: string;
  label: string;
  title: string;
  segment?: StoryboardSegment;
};

const directorPlanKeysByShot: Record<string, string[]> = {};
const directorViewTitles: Record<string, string> = {};

function getDirectorViews(shot: StoryboardShot, useDefaultProjectPlans = true): DirectorViewOption[] {
  const planKeys = useDefaultProjectPlans ? directorPlanKeysByShot[shot.id] : undefined;
  if (planKeys?.length && planKeys.every((key) => blockingPlans[key])) {
    return planKeys.map((key, index) => {
      const segment = shot.segments[index];
      const segmentTitle = segment?.label.replace(/^(\d+[A-Z])(?:\s*｜\s*|\s*\|\s*|\s*·\s*)?/i, "").trim();
      return {
        key,
        label: key,
        title: segmentTitle || directorViewTitles[key] || `分段 ${index + 1}`,
        segment,
      };
    });
  }
  return [{ key: shot.id, label: `SHOT ${shot.id}`, title: shot.title }];
}

const navItems: Array<{ id: ViewId; number: string; label: string }> = [
  { id: "script", number: "01", label: "脚本" },
  { id: "artwork", number: "02", label: "出图" },
  { id: "confirm", number: "03", label: "确认" },
];

function emptyAnnotations(): Record<SectionId, string> {
  return { characters: "", scene: "", story: "", action: "", continuity: "", style: "", director: "" };
}

const globalArrayFields: Array<keyof Pick<GlobalSettings, "characters" | "props" | "locations" | "timeline" | "continuity" | "modelRules" | "negative">> = [
  "characters", "props", "locations", "timeline", "continuity", "modelRules", "negative",
];

function cloneGlobalSettings(settings: GlobalSettings = sourceGlobalSettings): GlobalSettings {
  return {
    ...settings,
    storyBackground: typeof settings.storyBackground === "string" ? settings.storyBackground : sourceGlobalSettings.storyBackground,
    characters: [...settings.characters],
    props: [...settings.props],
    locations: [...settings.locations],
    timeline: [...settings.timeline],
    continuity: [...settings.continuity],
    modelRules: [...settings.modelRules],
    negative: [...settings.negative],
  };
}

function isGlobalSettings(value: unknown): value is GlobalSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Record<string, unknown>;
  return globalArrayFields.every((field) => Array.isArray(settings[field]) && (settings[field] as unknown[]).every((item) => typeof item === "string"))
    && (settings.storyBackground === undefined || typeof settings.storyBackground === "string")
    && typeof settings.finalVideoStyle === "string"
    && typeof settings.storyboardImageStyle === "string";
}

function createReview(sourceShot: StoryboardShot, useDefaultProjectPlans = true): ShotReview {
  const shot = normalizeShot(sourceShot);
  const directorViews = getDirectorViews(shot, useDefaultProjectPlans);
  return {
    shot,
    annotations: emptyAnnotations(),
    scriptStatus: "draft",
    artworkStatus: "empty",
    selectedDirectorView: directorViews[0].key,
    whiteboxScenes: ensureWhiteboxScenes(undefined, directorViews.map((view) => ({ key: view.key, title: view.title })), shot.id, useDefaultProjectPlans),
    seededAssetReferenceIds: [],
    approved: false,
    versions: [],
  };
}

function createReviews(shots: StoryboardShot[], useDefaultProjectPlans = true): ShotReview[] {
  return shots.map((shot) => createReview(shot, useDefaultProjectPlans));
}

function createInitialState(): ReviewState {
  return {
    stateSchemaVersion,
    projectTitle: defaultProjectTitle,
    sourceDocument: sourceDocumentFromShots(storyboardShots),
    sourceName: "空白项目模板",
    selectedRecipeId: defaultDirectorRecipeId,
    generationModel: "seedance-2.0",
    workspaceMode: "shots",
    globalSettings: cloneGlobalSettings(),
    assetPrompts: [],
    globalAnnotation: "",
    globalStatus: "applied",
    currentShot: 0,
    view: "script",
    reviews: createReviews(storyboardShots, false),
  };
}

function lines(value: string[]) {
  return value.join("\n");
}

function splitLines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isProjectAssetPrompt(value: unknown): value is ProjectAssetPrompt {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProjectAssetPrompt>;
  return typeof item.id === "string"
    && (item.kind === "character" || item.kind === "scene" || item.kind === "prop")
    && typeof item.name === "string"
    && typeof item.sourceObservation === "string"
    && typeof item.prompt === "string"
    && isStringArray(item.negative)
    && isStringArray(item.sourcePanels)
    && isStringArray(item.shotIds);
}

function normalizeProjectAssetPrompts(value: unknown): ProjectAssetPrompt[] {
  return Array.isArray(value) ? value.filter(isProjectAssetPrompt) : [];
}

function mergeProjectAssetPrompts(existing: unknown, incoming: unknown): ProjectAssetPrompt[] {
  const result = [...normalizeProjectAssetPrompts(existing)];
  for (const candidate of normalizeProjectAssetPrompts(incoming)) {
    const candidateName = candidate.name.normalize("NFKC").trim().toLocaleLowerCase();
    const index = result.findIndex((item) => item.id === candidate.id || (
      item.kind === candidate.kind
      && item.name.normalize("NFKC").trim().toLocaleLowerCase() === candidateName
    ));
    if (index < 0) {
      result.push(candidate);
      continue;
    }
    const current = result[index];
    result[index] = {
      ...candidate,
      ...current,
      sourceObservation: current.sourceObservation.trim() || candidate.sourceObservation,
      prompt: current.prompt.trim() || candidate.prompt,
      negative: current.negative.length ? current.negative : candidate.negative,
      sourcePanels: [...new Set([...candidate.sourcePanels, ...current.sourcePanels])],
      shotIds: [...new Set([...candidate.shotIds, ...current.shotIds])],
    };
  }
  return result;
}

function normalizeShot(shot: StoryboardShot, _migrateLegacyProject = false): StoryboardShot {
  const sourceArtStyle = typeof shot.artStyle === "string" ? shot.artStyle.trim() : "";
  const artStyle = !sourceArtStyle
    || sourceArtStyle === legacyStoryboardArtStyle
    || sourceArtStyle === inferredVideoArtStyle
    || sourceArtStyle === mistakenStoryboardAsVideoArtStyle
    ? defaultArtStyle
    : sourceArtStyle;
  return {
    ...shot,
    sourceText: sourceTextForShot(shot),
    artStyle,
    omniReferences: [...new Set(shot.omniReferences || [])].slice(0, absoluteMaxOmniReferences),
  };
}

function isLegacyDefaultTimelineState(_incoming: ReviewState) {
  return false;
}

function isBlankInitialReviewState(incoming: ReviewState) {
  return incoming.reviews.length > 0 && incoming.reviews.every((review) => (
    !review.approved
    && review.scriptStatus === "draft"
    && review.artworkStatus === "empty"
    && review.versions.length === 0
    && Object.values(review.annotations || {}).every((value) => !String(value || "").trim())
  ));
}

function normalizeReviewForResume(review: ShotReview, _useDefaultProjectPlans = false): ShotReview {
  const shot = normalizeShot(review.shot);
  const hasRecoverableSubmission = review.pendingSubmission?.shotId === shot.id;
  const directorViews = getDirectorViews(shot, false);
  const whiteboxScenes = ensureWhiteboxScenes(
    review.whiteboxScenes,
    directorViews.map((view) => ({ key: view.key, title: view.title })),
    shot.id,
    false,
  );
  const whiteboxReferences = Object.fromEntries(Object.entries(review.whiteboxReferences || {}).filter(([key, value]) => (
    directorViews.some((view) => view.key === key)
    && typeof value?.lockedAt === "string"
  )));
  const artworkNames = Array.isArray(review.artworkNames) && review.artworkNames.length
    ? review.artworkNames
    : review.artworkName ? [review.artworkName] : undefined;
  const selectedArtworkIndex = Math.min(
    Math.max(0, review.selectedArtworkIndex || 0),
    Math.max(0, (artworkNames?.length || 1) - 1),
  );
  return {
    ...review,
    shot,
    annotations: { ...emptyAnnotations(), ...(review.annotations || {}) },
    scriptStatus: review.scriptStatus === "sending" && !hasRecoverableSubmission ? "draft" : review.scriptStatus,
    artworkNames,
    selectedArtworkIndex,
    artworkSourceRevision: artworkSourceRevisionForShot(shot.id),
    videoPrompt: typeof review.videoPrompt === "string" ? review.videoPrompt : undefined,
    videoPromptSourceRevision: typeof review.videoPrompt === "string"
      ? review.videoPromptSourceRevision || "legacy-unsynced"
      : undefined,
    videoPackageSyncedAt: typeof review.videoPackageSyncedAt === "string" ? review.videoPackageSyncedAt : undefined,
    seededAssetReferenceIds: Array.isArray(review.seededAssetReferenceIds)
      ? review.seededAssetReferenceIds.filter((item) => typeof item === "string")
      : [],
    selectedDirectorView: directorViews.some((view) => view.key === review.selectedDirectorView)
      ? review.selectedDirectorView
      : directorViews[0].key,
    whiteboxScenes,
    whiteboxReferences,
  };
}

function normalizeStateForResume(incoming: ReviewState): ReviewState {
  const requiresExplicitRestamp = !incoming.stateSchemaVersion || incoming.stateSchemaVersion < 7;
  const sourceReviews = incoming.reviews.length ? incoming.reviews : createReviews(storyboardShots, false);
  const reviews = sourceReviews.map((review) => {
    const normalized = normalizeReviewForResume(review);
    return requiresExplicitRestamp ? { ...normalized, approved: false, approvedAt: undefined } : normalized;
  });
  const currentShot = Math.min(Math.max(0, incoming.currentShot || 0), Math.max(0, reviews.length - 1));
  return {
    ...incoming,
    stateSchemaVersion,
    projectTitle: incoming.projectTitle || defaultProjectTitle,
    sourceDocument: typeof incoming.sourceDocument === "string" && incoming.sourceDocument.trim()
      ? incoming.sourceDocument
      : sourceDocumentFromShots(reviews.map((review) => review.shot)),
    sourceName: typeof incoming.sourceName === "string" && incoming.sourceName.trim()
      ? incoming.sourceName
      : "载入项目",
    selectedRecipeId: getDirectorRecipe(incoming.selectedRecipeId).id,
    generationModel: incoming.generationModel || "seedance-2.0",
    workspaceMode: incoming.workspaceMode === "global"
      || incoming.workspaceMode === "materials"
      || incoming.workspaceMode === "coverage"
      || incoming.workspaceMode === "assets"
      ? incoming.workspaceMode
      : "shots",
    globalSettings: cloneGlobalSettings(isGlobalSettings(incoming.globalSettings) ? incoming.globalSettings : sourceGlobalSettings),
    assetPrompts: normalizeProjectAssetPrompts(incoming.assetPrompts),
    globalAnnotation: typeof incoming.globalAnnotation === "string" ? incoming.globalAnnotation : "",
    globalStatus: incoming.globalStatus === "sending"
      || incoming.globalStatus === "error"
      || incoming.globalStatus === "draft"
      ? incoming.globalStatus
      : "applied",
    globalSummary: typeof incoming.globalSummary === "string" ? incoming.globalSummary : undefined,
    globalUpdatedAt: typeof incoming.globalUpdatedAt === "string" ? incoming.globalUpdatedAt : undefined,
    sourceMangaRequestId: /^[a-f0-9-]{36}$/i.test(incoming.sourceMangaRequestId || "")
      ? incoming.sourceMangaRequestId
      : undefined,
    currentShot,
    view: requiresExplicitRestamp ? "script" : incoming.view,
    reviews,
  };
}

function repairKnownMangaDraftState(incoming: ReviewState, fallbackRequestId = ""): ReviewState {
  const hasSourcePanels = incoming.reviews?.some((review) => review.shot.sourcePanels?.length);
  const requestId = /^[a-f0-9-]{36}$/i.test(incoming.sourceMangaRequestId || "")
    ? incoming.sourceMangaRequestId as string
    : hasSourcePanels && /^[a-f0-9-]{36}$/i.test(fallbackRequestId) ? fallbackRequestId : "";
  return requestId ? { ...incoming, sourceMangaRequestId: requestId } : incoming;
}

function applyAnnotationResultToState(
  previous: ReviewState,
  targetShotId: string,
  result: AnnotationResult,
  expectedSubmissionAt?: string,
): ReviewState {
  const reviewIndex = previous.reviews.findIndex((item) => item.shot.id === targetShotId);
  if (reviewIndex < 0 || !isStoryboardShot(result.shot) || result.shot.id !== targetShotId) return previous;

  const current = previous.reviews[reviewIndex];
  if (expectedSubmissionAt && current.pendingSubmission?.submittedAt !== expectedSubmissionAt) return previous;
  if (current.scriptStatus === "applied" && !current.pendingSubmission) return previous;

  const summary = result.summary || "GPT已应用批注";
  const version = (current.versions.at(-1)?.version ?? 0) + 1;
  const reviews = [...previous.reviews];
  reviews[reviewIndex] = {
    ...current,
    shot: normalizeShot(result.shot, previous.projectTitle === defaultProjectTitle),
    annotations: emptyAnnotations(),
    pendingSubmission: undefined,
    scriptStatus: "applied",
    artworkStatus: "empty",
    artworkName: undefined,
    artworkNames: undefined,
    artworkDependencyRevision: undefined,
    selectedArtworkIndex: 0,
    artworkPrompt: undefined,
    whiteboxReferences: undefined,
    approved: false,
    approvedAt: undefined,
    summary,
    versions: [...current.versions, {
      version,
      createdAt: result.finishedAt || new Date().toISOString(),
      summary,
      shot: normalizeShot(result.shot, previous.projectTitle === defaultProjectTitle),
      previousShot: current.shot,
      annotations: current.pendingSubmission?.annotations || current.annotations,
      recipeId: previous.selectedRecipeId,
    }],
  };
  return {
    ...previous,
    reviews,
    view: "script",
  };
}

function applyBatchAnnotationResultToState(
  previous: ReviewState,
  result: AnnotationBatchResult,
  expectedSubmissionAt?: string,
): ReviewState {
  if (!Array.isArray(result.shots) || !result.shots.length || !result.shots.every(isStoryboardShot)) return previous;
  const returned = new Map(result.shots.map((shot) => [
    shot.id,
    normalizeShot(shot, previous.projectTitle === defaultProjectTitle),
  ]));
  let appliedCount = 0;
  const reviews = previous.reviews.map((current) => {
    const revisedShot = returned.get(current.shot.id);
    if (!revisedShot) return current;
    if (expectedSubmissionAt && current.pendingSubmission?.submittedAt !== expectedSubmissionAt) return current;
    if (current.scriptStatus === "applied" && !current.pendingSubmission) return current;

    appliedCount += 1;
    const summary = result.summary || "GPT已应用全片批注";
    const version = (current.versions.at(-1)?.version ?? 0) + 1;
    return {
      ...current,
      shot: revisedShot,
      annotations: emptyAnnotations(),
      pendingSubmission: undefined,
      scriptStatus: "applied" as ScriptStatus,
      artworkStatus: "empty" as ArtworkStatus,
      artworkName: undefined,
      artworkNames: undefined,
      artworkDependencyRevision: undefined,
      selectedArtworkIndex: 0,
      artworkPrompt: undefined,
      whiteboxReferences: undefined,
      approved: false,
      approvedAt: undefined,
      summary,
      versions: [...current.versions, {
        version,
        createdAt: result.finishedAt || new Date().toISOString(),
        summary,
        shot: revisedShot,
        previousShot: current.shot,
        annotations: current.pendingSubmission?.annotations || current.annotations,
        recipeId: previous.selectedRecipeId,
      }],
    };
  });
  return appliedCount ? { ...previous, reviews, view: "script" } : previous;
}

function isStoryboardShot(value: unknown): value is StoryboardShot {
  if (!value || typeof value !== "object") return false;
  const shot = value as Record<string, unknown>;
  return typeof shot.id === "string"
    && typeof shot.timecode === "string"
    && typeof shot.duration === "number"
    && typeof shot.title === "string"
    && (shot.sourceText === undefined || isStringArray(shot.sourceText))
    && (shot.sourcePanels === undefined || isStringArray(shot.sourcePanels))
    && (shot.artStyle === undefined || typeof shot.artStyle === "string")
    && typeof shot.story === "string"
    && typeof shot.scene === "string"
    && isStringArray(shot.characters)
    && isStringArray(shot.props)
    && (shot.omniReferences === undefined || (isStringArray(shot.omniReferences) && shot.omniReferences.length <= absoluteMaxOmniReferences))
    && typeof shot.composition === "string"
    && typeof shot.camera === "string"
    && typeof shot.action === "string"
    && isStringArray(shot.dialogue)
    && isStringArray(shot.continuity)
    && isStringArray(shot.negative)
    && Array.isArray(shot.segments)
    && shot.segments.every((segment) => {
      if (!segment || typeof segment !== "object") return false;
      const item = segment as Record<string, unknown>;
      return typeof item.label === "string"
        && typeof item.beat === "string"
        && typeof item.framing === "string"
        && isStringArray(item.mustShow);
    });
}

function globalRulesForShot(shot: StoryboardShot, settings: GlobalSettings) {
  const shotText = [shot.title, shot.story, shot.scene, ...shot.characters, ...shot.props, ...shot.continuity].join("\n");
  const ruleMatches = (rule: string, candidates: string[]) => candidates.some((candidate) => {
    const name = candidate.replace(/（.*$/, "").trim();
    return Boolean(name) && (rule.includes(name) || shotText.includes(rule.split(/[：:]/, 1)[0].trim()));
  });
  const characterRules = settings.characters.filter((rule) => ruleMatches(rule, shot.characters));
  const propRules = settings.props.filter((rule) => ruleMatches(rule, shot.props));
  const locationRules = settings.locations.filter((rule) => ruleMatches(rule, [shot.scene]));
  const timelineRules = settings.timeline.filter((rule) => rule.includes(`Shot ${shot.id}`));
  return [...characterRules, ...propRules, ...locationRules, ...timelineRules, ...settings.continuity, ...settings.negative];
}

function getArtworkPrompt(shot: StoryboardShot, projectTitle: string, generationModel: GenerationModel, settings: GlobalSettings) {
  const referenceLimit = referenceLimitFor(generationModel);
  const omniReferences = shot.omniReferences ?? [];
  const segments = shot.segments.length
    ? `\n同一张分镜纸上画 ${shot.segments.length} 个连续小格：\n${shot.segments.map((segment, index) =>
        `${index + 1}. ${segment.label}：${segment.beat}；${segment.framing}；必须出现：${segment.mustShow.join("、")}`,
      ).join("\n")}`
    : "";
  const globalRules = globalRulesForShot(shot, settings);

  return `只生成《${projectTitle}》镜头 ${shot.id}，不要生成其他镜头。\n出图模型：Lib Image。\n用途：为 ${generationModels.find((item) => item.id === generationModel)?.label} 视频生成准备临时赛璐璐风格分镜参考图；它只负责锁定剧情、场景、站位和动作，不代表最终视频美术风格，也不是视频提示词的复制品。\n项目故事背景（只作时代与因果上下文，不得覆盖本镜证据）：${settings.storyBackground}\n临时工作分镜画法：${settings.storyboardImageStyle || storyboardArtworkStyle}\n适用于本镜的全局硬锁（优先级最高）：${globalRules.join("；")}\n人物：${shot.characters.join("；")}\n关键物品：${shot.props.join("；")}\n场景：${shot.scene}\n全能参考（${omniReferences.length}/${referenceLimit}）：${omniReferences.join("；")}\n剧情：${shot.story}\n站位与构图：${shot.composition}\n镜头：${shot.camera}\n动作：${shot.action}${segments}\n\n连续性：${shot.continuity.join("；")}\n禁止：${shot.negative.join("；")}\n\n全能参考总数严禁超过 ${referenceLimit} 个；普通物品不占参考位。无对白气泡、无水印。让导演一眼看懂剧情、物品、场景、站位、视线和动作路径。不要把这张临时赛璐璐分镜的画风反推为最终视频画风。`;
}

function openArtworkDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(artworkDb, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("images")) request.result.createObjectStore("images");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putArtworks(shotId: string, dataUrls: string[]) {
  const db = await openArtworkDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("images", "readwrite");
    transaction.objectStore("images").put(dataUrls, shotId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getArtworks(shotId: string): Promise<string[]> {
  const db = await openArtworkDb();
  const value = await new Promise<string | string[] | undefined>((resolve, reject) => {
    const request = db.transaction("images", "readonly").objectStore("images").get(shotId);
    request.onsuccess = () => resolve(request.result as string | string[] | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return Array.isArray(value) ? value : value ? [value] : [];
}

async function deleteArtworks(shotId: string) {
  const db = await openArtworkDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("images", "readwrite");
    transaction.objectStore("images").delete(shotId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function artworkStorageKey(projectTitle: string, shotId: string) {
  return `${projectTitle}::${artworkSourceRevisionForShot(shotId)}::${shotId}`;
}

function cleanShotAssetName(value: string, kind: ShotAssetKind) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (kind === "scene") return normalized.split(/[（(]/, 1)[0].trim() || normalized;
  if (kind === "character") return normalized.replace(/[（(][^）)]*[）)]/g, "").trim() || normalized;
  return normalized;
}

function shotAssetId(kind: ShotAssetKind, name: string) {
  return `${kind}:${name.normalize("NFKC").toLocaleLowerCase("zh-CN")}`;
}

function deriveShotAssets(shot: StoryboardShot): ShotAssetEntry[] {
  const candidates: Array<{ kind: ShotAssetKind; name: string }> = [
    ...shot.characters.map((name) => ({ kind: "character" as const, name })),
    ...(shot.scene.trim() ? [{ kind: "scene" as const, name: shot.scene }] : []),
    ...shot.props.map((name) => ({ kind: "prop" as const, name })),
  ];
  const seen = new Set<string>();
  return candidates.flatMap(({ kind, name }) => {
    const cleanName = cleanShotAssetName(name, kind);
    const id = shotAssetId(kind, cleanName);
    if (!cleanName || seen.has(id)) return [];
    seen.add(id);
    return [{ id, kind, name: cleanName }];
  });
}

function targetSourcePanelsForAsset(asset: ShotAssetEntry, reviews: ShotReview[]) {
  return [...new Set(reviews.flatMap((review) => (
    deriveShotAssets(review.shot).some((candidate) => candidate.id === asset.id)
      ? review.shot.sourcePanels || []
      : []
  )))];
}

function shotAssetStorageKey(projectTitle: string, asset: ShotAssetEntry) {
  return `${projectTitle}::shot-asset-v1::${asset.kind}::${encodeURIComponent(asset.name.normalize("NFKC"))}`;
}

function shotAssetAttemptStorageKey(projectTitle: string, asset: ShotAssetEntry) {
  return `${shotAssetStorageKey(projectTitle, asset)}::attempt`;
}

function defaultShotAssetPrompt(asset: ShotAssetEntry, shot: StoryboardShot, settings: GlobalSettings) {
  const finalVideoStyle = settings.finalVideoStyle.trim() || shot.artStyle;
  const compactStyle = finalVideoStyle;
  const backgroundSummary = settings.storyBackground.split("。").map((item) => item.trim()).filter(Boolean).slice(0, 2).join("。 ");
  const style = compactStyle.trim() && compactStyle !== defaultArtStyle
    ? `最终视频美术风格：${compactStyle}。`
    : "最终视频美术风格尚未确认；只锁定漫画可见身份与外观，不擅自套用漫画、赛璐璐或真人风格。";
  const sourcePanels = shot.sourcePanels?.length ? `漫画来源格：${shot.sourcePanels.join("、")}。` : "";
  const common = `${backgroundSummary ? `项目背景：${backgroundSummary}。` : ""}${style}${sourcePanels}单一资产参考图，不是剧情分镜，不做多格拼图；干净背景，无文字、无水印，不生成无关人物或物品。`;
  if (asset.kind === "character") {
    const matchingReference = shot.omniReferences.find((item) => isShotAssetReference(item, asset));
    return `人物资产：${asset.name}。从漫画画格中提取并保持该人物可见的年龄感、体型、脸型、发型、服装、身份气质和表情特征；漫画未画清的颜色、纹样或身体细节不要臆测。角色依据：${matchingReference || asset.name}。本镜身份与行为：${shot.story} ${shot.action}。制作清晰、可复用的单人角色设定参考图，全身为主，站姿自然，正面略带三分之二角度，双手完整可见。${common}`;
  }
  if (asset.kind === "scene") {
    return `场景资产：${asset.name}。制作干净的场景空间参考图，清楚表现建筑结构、出入口、楼梯、可站位区域与纵深；本镜场景依据：${shot.scene}。画面内不出现人物。${common}`;
  }
  return `关键道具资产：${asset.name}。制作单件道具的清晰外观参考图，完整展示轮廓、材质、比例与关键结构，物体居中且不被遮挡。${common}`;
}

function projectAssetPromptFor(prompts: ProjectAssetPrompt[] | undefined, asset: ShotAssetEntry) {
  return (prompts || []).find((item) => item.id === asset.id)
    || (prompts || []).find((item) => item.kind === asset.kind && shotAssetId(item.kind, cleanShotAssetName(item.name, item.kind)) === asset.id);
}

function projectAssetPromptText(record?: ProjectAssetPrompt) {
  if (!record?.prompt.trim()) return "";
  return record.negative.length
    ? `${record.prompt.trim()}\n禁止：${record.negative.join("；")}`
    : record.prompt.trim();
}

function defaultShotAssetImageSettings(asset: ShotAssetEntry): ShotAssetImageSettings {
  return {
    model: "Lib Image",
    ratio: asset.kind === "character" ? "3:4" : asset.kind === "prop" ? "1:1" : "16:9",
    resolution: "2K",
  };
}

function shotAssetReferenceLabel(asset: ShotAssetEntry) {
  if (asset.kind === "character") return `${asset.name}（角色身份与外观参考）`;
  if (asset.kind === "scene") return `${asset.name}（场景空间与结构参考）`;
  return `${asset.name}（关键道具外观与比例参考）`;
}

function isShotAssetReference(reference: string, asset: ShotAssetEntry) {
  const value = String(reference || "").trim();
  return value === asset.name
    || value === shotAssetReferenceLabel(asset)
    || value.startsWith(`${asset.name}（`)
    || value.startsWith(`${asset.name} (`);
}

function whiteboxReferenceStorageKey(projectTitle: string, shotId: string, planKey: string) {
  return `${projectTitle}::${artworkSourceRevisionForShot(shotId)}::${shotId}::whitebox::${planKey}`;
}

function artworkSourceRevisionForShot(shotId: string) {
  void shotId;
  return storyboardSourceRevision;
}

async function getArtworksForShot(projectTitle: string, shotId: string) {
  return getArtworks(artworkStorageKey(projectTitle, shotId));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function TextField({ label, value, rows = 4, onChange }: { label: string; value: string; rows?: number; onChange: (value: string) => void }) {
  return (
    <label className="sheet-field">
      <span>{label}</span>
      <textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ArtworkPlaceholder({ shotId, generating = false }: { shotId: string; generating?: boolean }) {
  return (
    <div className={`artwork-placeholder ${generating ? "is-generating" : ""}`} role="status" aria-label={`Shot ${shotId} 分镜图占位`}>
      <span>SHOT {shotId} · 16:9</span>
      <b>{generating ? "Lib Image 正在生成…" : "分镜图占位"}</b>
      <small>{generating ? "完成后会自动替换这里" : "尚未生成"}</small>
    </div>
  );
}

function mangaPanelCropUrl(requestId: string, panelId: string, pairingToken?: string) {
  const url = new URL(`/media-panel/${encodeURIComponent(requestId)}/${encodeURIComponent(panelId)}`, bridgeBase);
  if (pairingToken) url.searchParams.set("token", pairingToken);
  return url.toString();
}

function MangaPanelCard({ requestId, panelId, pairingToken }: { requestId: string; panelId: string; pairingToken?: string }) {
  const url = mangaPanelCropUrl(requestId, panelId, pairingToken);
  const [failedUrl, setFailedUrl] = useState("");
  const failed = failedUrl === url;
  return (
    <figure className={`source-manga-card ${failed ? "is-missing" : ""}`}>
      {failed || !pairingToken ? (
        <div className="source-manga-missing" role="status">
          <b>{panelId}</b>
          <span>{pairingToken ? "来源漫画格暂时无法读取" : "正在连接本地漫画原图…"}</span>
        </div>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" title={`打开原作漫画格 ${panelId}`}>
          <img src={url} alt={`Shot 来源漫画格 ${panelId}`} loading="eager" onError={() => setFailedUrl(url)} />
        </a>
      )}
      <figcaption><b>{panelId}</b><span>原作裁图</span></figcaption>
    </figure>
  );
}

function MangaPanelStrip({ requestId, panelIds, pairingToken }: { requestId: string; panelIds: string[]; pairingToken?: string }) {
  if (!requestId || !panelIds.length) return null;
  return (
    <section className="source-manga-strip" aria-label="本镜对应的原作漫画格">
      <header><div><span>ORIGINAL MANGA PANELS</span><h2>本镜原作漫画格</h2></div><small>{panelIds.length} 格 · 可横向滑动 · 点击放大</small></header>
      <div className="source-manga-track">
        {panelIds.map((panelId) => <MangaPanelCard key={panelId} requestId={requestId} panelId={panelId} pairingToken={pairingToken} />)}
      </div>
    </section>
  );
}

function ScriptBlock({
  section,
  annotation,
  onAnnotation,
  children,
}: {
  section: (typeof sections)[number];
  annotation: string;
  onAnnotation: (value: string) => void;
  children: ReactNode;
}) {
  const note = annotation || "";
  return (
    <article className={`script-block ${note.trim() ? "has-note" : ""}`}>
      <header>
        <span>{section.number}</span>
        <div><h2>{section.title}</h2><p>{section.hint}</p></div>
        {note.trim() ? <b>已批注</b> : <b className="quiet">待查看</b>}
      </header>
      <div className="script-content">{children}</div>
      <label className="annotation-box">
        <span>批注 · 只写你要改的地方</span>
        <textarea
          rows={3}
          value={note}
          placeholder={`给“${section.title}”写批注；可以先写，最后统一发送给 GPT`}
          onChange={(event) => onAnnotation(event.target.value)}
        />
      </label>
    </article>
  );
}

function facingAngle(facing: BlockingMarker["facing"]) {
  return facing === "down" ? 90 : facing === "left" ? 180 : facing === "up" ? -90 : 0;
}

function trimVehicleMovement(movement: BlockingMovement, markers: BlockingMarker[]) {
  if (movement.kind !== "vehicle") return movement;

  const deltaX = movement.toX - movement.fromX;
  const deltaY = movement.toY - movement.fromY;
  const length = Math.max(1, Math.hypot(deltaX, deltaY));
  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const vehicles = markers.filter((marker) => marker.kind === "vehicle");
  const touchesVehicle = (x: number, y: number) => vehicles.some((vehicle) => Math.hypot(x - vehicle.x, y - vehicle.y) <= 90);
  let startInset = touchesVehicle(movement.fromX, movement.fromY) ? 112 : 0;
  let endInset = touchesVehicle(movement.toX, movement.toY) ? 112 : 0;
  const totalInset = startInset + endInset;
  if (totalInset > length - 24) {
    const scale = Math.max(0, length - 24) / totalInset;
    startInset *= scale;
    endInset *= scale;
  }

  return {
    ...movement,
    fromX: movement.fromX + unitX * startInset,
    fromY: movement.fromY + unitY * startInset,
    toX: movement.toX - unitX * endInset,
    toY: movement.toY - unitY * endInset,
  };
}

function StageSketch({
  shot,
  planKey = shot.id,
  viewLabel = `SHOT ${shot.id}`,
  caption = shot.composition,
  textVisibility,
  onToggleText,
  useDefaultProjectPlan = true,
}: {
  shot: StoryboardShot;
  planKey?: string;
  viewLabel?: string;
  caption?: string;
  textVisibility: { names: boolean; actions: boolean; notes: boolean };
  onToggleText: (field: "names" | "actions" | "notes") => void;
  useDefaultProjectPlan?: boolean;
}) {
  const plan = useDefaultProjectPlan ? blockingPlans[planKey] || blockingPlans[shot.id] : undefined;
  const svgId = useId().replace(/:/g, "");
  if (!plan) {
    return <div className="stage-sketch"><div className="sketch-scene">{shot.scene}</div><p>{shot.composition}</p></div>;
  }

  const arrowIds = {
    camera: `camera-arrow-${svgId}`,
    vehicle: `vehicle-arrow-${svgId}`,
    action: `action-arrow-${svgId}`,
  };

  return (
    <div className={`stage-sketch blocking-map ${textVisibility.names ? "names-visible" : "names-hidden"} ${textVisibility.actions ? "actions-visible" : "actions-hidden"} ${textVisibility.notes ? "notes-visible" : "notes-hidden"}`} aria-label={`${viewLabel} 俯视站位与机位图`}>
      <div className="blocking-map-heading">
        <span>TOP VIEW · {viewLabel}</span>
        <div className="blocking-map-filter">
          <b>{textVisibility.notes ? plan.orientation : "名字保留 · 小字按需"}</b>
          <button type="button" aria-pressed={textVisibility.names} onClick={() => onToggleText("names")}>显示名字</button>
          <button type="button" aria-pressed={textVisibility.actions} onClick={() => onToggleText("actions")}>显示动作</button>
          <button type="button" aria-pressed={textVisibility.notes} onClick={() => onToggleText("notes")}>显示注释</button>
        </div>
      </div>
      <svg viewBox="0 0 1000 560" role="img" aria-label="道路、人物、车辆、摄影机和运动轨迹俯视图">
        <defs>
          <marker id={arrowIds.camera} markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L0,7 L9,3.5 z" /></marker>
          <marker id={arrowIds.vehicle} markerWidth="24" markerHeight="16" refX="23" refY="8" orient="auto" markerUnits="userSpaceOnUse">
            <path className="vehicle-arrowhead" d="M0 5 L12 5 L12 0 L24 8 L12 16 L12 11 L0 11 Z" />
          </marker>
          <marker id={arrowIds.action} markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L0,7 L9,3.5 z" /></marker>
        </defs>

        {plan.zones.map((zone) => (
          <g className={`blocking-zone zone-${zone.kind}`} key={zone.id}>
            <rect x={zone.x} y={zone.y} width={zone.width} height={zone.height} />
            {zone.kind === "road" ? <line className="lane-divider" x1={zone.x + 18} y1={zone.y + zone.height / 2} x2={zone.x + zone.width - 18} y2={zone.y + zone.height / 2} /> : null}
            {zone.kind === "side-street" ? <line className="lane-divider side-street-divider" x1={zone.x + zone.width / 2} y1={zone.y + 18} x2={zone.x + zone.width / 2} y2={zone.y + zone.height - 18} /> : null}
            <text x={zone.x + 14} y={zone.y + 24}>{zone.label}</text>
          </g>
        ))}

        {plan.cameras.map((camera, cameraIndex) => {
          const deltaX = camera.targetX - camera.x;
          const deltaY = camera.targetY - camera.y;
          const distance = Math.max(1, Math.hypot(deltaX, deltaY));
          const perpendicularX = -deltaY / distance;
          const perpendicularY = deltaX / distance;
          const halfWidth = Math.min(240, Math.tan(((camera.fov ?? 35) * Math.PI) / 360) * distance);
          const leftX = camera.targetX + perpendicularX * halfWidth;
          const leftY = camera.targetY + perpendicularY * halfWidth;
          const rightX = camera.targetX - perpendicularX * halfWidth;
          const rightY = camera.targetY - perpendicularY * halfWidth;
          return <polygon className={`camera-cone camera-tone-${cameraIndex % 4}`} key={`cone-${camera.id}`} points={`${camera.x},${camera.y} ${leftX},${leftY} ${rightX},${rightY}`} />;
        })}

        {plan.movements.map((movement) => {
          const visibleMovement = trimVehicleMovement(movement, plan.markers);
          const arrowId = movement.kind === "camera" ? arrowIds.camera : movement.kind === "vehicle" ? arrowIds.vehicle : arrowIds.action;
          const middleX = (visibleMovement.fromX + visibleMovement.toX) / 2;
          const middleY = (visibleMovement.fromY + visibleMovement.toY) / 2;
          return (
            <g className={`blocking-movement movement-${movement.kind}`} key={movement.id}>
              {movement.kind === "vehicle" ? (
                <polyline
                  points={`${visibleMovement.fromX},${visibleMovement.fromY} ${middleX},${middleY} ${visibleMovement.toX},${visibleMovement.toY}`}
                  markerMid={`url(#${arrowId})`}
                />
              ) : (
                <line x1={visibleMovement.fromX} y1={visibleMovement.fromY} x2={visibleMovement.toX} y2={visibleMovement.toY} markerEnd={`url(#${arrowId})`} />
              )}
              <text x={middleX} y={middleY - (movement.kind === "vehicle" ? 22 : 10)}>{movement.label}</text>
            </g>
          );
        })}

        {plan.cameras.map((camera, cameraIndex) => {
          const angle = Math.atan2(camera.targetY - camera.y, camera.targetX - camera.x) * 180 / Math.PI;
          return (
            <g className={`blocking-camera camera-tone-${cameraIndex % 4}`} key={camera.id}>
              <line className="camera-sight" x1={camera.x} y1={camera.y} x2={camera.targetX} y2={camera.targetY} markerEnd={`url(#${arrowIds.camera})`} />
              <g transform={`translate(${camera.x} ${camera.y}) rotate(${angle})`}>
                <rect x="-22" y="-15" width="32" height="30" rx="5" />
                <path d="M10 -11 L29 0 L10 11 Z" />
              </g>
              <text className="camera-label" x={camera.x} y={camera.y - 27}>{camera.id} · {camera.lens}</text>
              <text className="camera-note" x={camera.x} y={camera.y + 31}>{camera.label}</text>
            </g>
          );
        })}

        {plan.markers.map((marker) => {
          const rotation = facingAngle(marker.facing);
          const propHalfSize = marker.id === "scarf" ? 6 : 12;
          return (
            <g className={`blocking-marker marker-${marker.kind}`} key={marker.id}>
              {marker.kind === "vehicle" ? (
                <g transform={`translate(${marker.x} ${marker.y}) rotate(${rotation})`}>
                  <rect className="vehicle-body" x="-52" y="-23" width="108" height="46" rx="14" />
                  <path className="vehicle-nose" d="M25 -21 C42 -21 55 -16 62 -9 L62 9 C55 16 42 21 25 21 Z" />
                  <path className="vehicle-rear-glass" d="M-28 -15 L-8 -18 L-8 18 L-28 15 Z" />
                  <path className="vehicle-front-glass" d="M1 -18 L25 -15 L33 -10 L33 10 L25 15 L1 18 Z" />
                  <line className="vehicle-hood-line" x1="39" y1="-14" x2="39" y2="14" />
                  <rect className="vehicle-headlight" x="53" y="-14" width="7" height="8" rx="2" />
                  <rect className="vehicle-headlight" x="53" y="6" width="7" height="8" rx="2" />
                  <path className="vehicle-front-bumper" d="M58 -9 Q66 0 58 9" />
                  <line className="vehicle-wheel" x1="-39" y1="-27" x2="-20" y2="-27" /><line className="vehicle-wheel" x1="18" y1="-27" x2="38" y2="-27" />
                  <line className="vehicle-wheel" x1="-39" y1="27" x2="-20" y2="27" /><line className="vehicle-wheel" x1="18" y1="27" x2="38" y2="27" />
                </g>
              ) : marker.kind === "person" ? (
                <g transform={`translate(${marker.x} ${marker.y}) rotate(${rotation})`}>
                  <circle r="17" />
                  <path className="facing-nose" d="M12 -7 L27 0 L12 7 Z" />
                </g>
              ) : (
                <rect
                  className={`prop-body ${marker.id === "scarf" ? "prop-scarf" : ""}`}
                  x={marker.x - propHalfSize}
                  y={marker.y - propHalfSize}
                  width={propHalfSize * 2}
                  height={propHalfSize * 2}
                  transform={`rotate(45 ${marker.x} ${marker.y})`}
                />
              )}
              <text className="marker-label" x={marker.x} y={marker.y - (marker.kind === "vehicle" ? 38 : 29)}>{marker.label}</text>
              {marker.note ? <text className="marker-note" x={marker.x} y={marker.y + (marker.kind === "vehicle" ? 43 : 37)}>{marker.note}</text> : null}
            </g>
          );
        })}
      </svg>
      <div className="blocking-legend">
        {plan.cameras.map((camera, index) => (
          <span className={`camera camera-${["a", "b", "c", "d"][index % 4]}`} key={`legend-${camera.id}`}><i />{camera.id}：{["蓝", "紫", "青", "粉"][index % 4]}色虚线</span>
        ))}
        <span className="vehicle"><i />红线：车辆行驶与靠边轨迹</span>
        <span className="action"><i />橙线：人物动作路径</span>
      </div>
      <p className="blocking-caption">{caption}</p>
    </div>
  );
}

export default function Home() {
  const [state, setState] = useState<ReviewState>(createInitialState);
  const [hydrated, setHydrated] = useState(false);
  const [activeStorageKey, setActiveStorageKey] = useState(storageKey);
  const [materialDraftMode, setMaterialDraftMode] = useState(false);
  const [bridge, setBridge] = useState<BridgeState>({ connected: false, busy: false });
  const [artworkRecord, setArtworkRecord] = useState<{ shotId: string; dataUrls: string[] }>({ shotId: "", dataUrls: [] });
  const [toast, setToast] = useState("");
  const [showLoader, setShowLoader] = useState(false);
  const [loadingScript, setLoadingScript] = useState(false);
  const [loggingIntoLibtv, setLoggingIntoLibtv] = useState(false);
  const [stampingShotId, setStampingShotId] = useState("");
  const [savingGlobalSettings, setSavingGlobalSettings] = useState(false);
  const [lastGlobalSubmission, setLastGlobalSubmission] = useState<{ annotation: string; submittedAt: string }>();
  const [naturalScript, setNaturalScript] = useState("");
  const [lastSubmission, setLastSubmission] = useState<AnnotationSubmission>();
  const [lastBatchSubmissions, setLastBatchSubmissions] = useState<Record<string, AnnotationSubmission>>({});
  const [directorVisualMode, setDirectorVisualMode] = useState<DirectorVisualMode>("top");
  const [topViewTextVisibility, setTopViewTextVisibility] = useState({ names: true, actions: false, notes: false });
  const [coverageFilter, setCoverageFilter] = useState<CoverageStatus | "all">("all");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [assetSelectedShotId, setAssetSelectedShotId] = useState("");
  const [assetPreviewRecord, setAssetPreviewRecord] = useState<{ shotId: string; dataUrls: string[] }>({ shotId: "", dataUrls: [] });
  const [shotAssetImages, setShotAssetImages] = useState<Record<string, string[]>>({});
  const [shotAssetPrompts, setShotAssetPrompts] = useState<Record<string, string>>({});
  const [shotAssetImageSettings, setShotAssetImageSettings] = useState<Record<string, ShotAssetImageSettings>>({});
  const [generatingShotAssetKeys, setGeneratingShotAssetKeys] = useState<Record<string, boolean>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const scriptInput = useRef<HTMLInputElement>(null);
  const artworkScroller = useRef<HTMLDivElement>(null);
  const staleSendingSince = useRef<Record<string, number>>({});
  const staleArtworkSince = useRef<Record<string, number>>({});
  const recoveringAnnotationJob = useRef("");
  const recoveringArtworkJob = useRef("");
  const currentShotIdRef = useRef("");

  const review = state.reviews[state.currentShot];
  const shot = normalizeShot(review.shot, state.projectTitle === defaultProjectTitle);
  const shotNavigationGroups = useMemo(() => buildShotNavigationGroups(state.reviews), [state.reviews]);
  const isOpeningSubshot = isOpeningSubshotId(shot.id);
  const generationModel = state.generationModel || "seedance-2.0";
  const workspaceScope = materialDraftMode ? "material-draft" : "main";
  const projectStorageTitle = materialDraftMode ? `${state.projectTitle}::${activeStorageKey}` : state.projectTitle;
  const projectScopeId = materialDraftMode ? activeStorageKey.slice(materialDraftStoragePrefix.length) : "main";
  const mangaSourceRequestId = /^[a-f0-9-]{36}$/i.test(state.sourceMangaRequestId || "")
    ? state.sourceMangaRequestId as string
    : materialDraftMode && shot.sourcePanels?.length && /^[a-f0-9-]{36}$/i.test(projectScopeId) ? projectScopeId : "";
  const shotAssets = useMemo(
    () => deriveShotAssets(shot),
    [shot.characters.join("\n"), shot.props.join("\n"), shot.scene],
  );
  const shotAssetSignature = shotAssets.map((asset) => `${asset.kind}:${asset.name}`).join("|");
  const projectAssetSignature = state.reviews.map((item) => {
    const itemShot = normalizeShot(item.shot, state.projectTitle === defaultProjectTitle);
    return `${itemShot.id}:${deriveShotAssets(itemShot).map((asset) => asset.id).join(",")}`;
  }).join("|");
  function resolvedShotAssetPrompt(asset: ShotAssetEntry, targetShot = shot) {
    const assetKey = shotAssetStorageKey(projectStorageTitle, asset);
    if (Object.prototype.hasOwnProperty.call(shotAssetPrompts, assetKey)) return shotAssetPrompts[assetKey];
    const analyzedPrompt = projectAssetPromptText(projectAssetPromptFor(state.assetPrompts, asset));
    return analyzedPrompt || defaultShotAssetPrompt(asset, targetShot, state.globalSettings);
  }

  function updateShotAssetPrompt(asset: ShotAssetEntry, value: string) {
    const assetKey = shotAssetStorageKey(projectStorageTitle, asset);
    setShotAssetPrompts((current) => ({ ...current, [assetKey]: value }));
    setState((previous) => {
      const prompts = normalizeProjectAssetPrompts(previous.assetPrompts);
      const existing = projectAssetPromptFor(prompts, asset);
      const existingIndex = existing ? prompts.findIndex((item) => item.id === existing.id) : -1;
      const nextRecord: ProjectAssetPrompt = {
        id: existing?.id || asset.id,
        kind: asset.kind,
        name: asset.name,
        sourceObservation: existing?.sourceObservation || "由漫画分镜资产清单自动建立；外观观察待复核。",
        prompt: value,
        negative: [],
        sourcePanels: existing?.sourcePanels || targetSourcePanelsForAsset(asset, previous.reviews),
        shotIds: [...new Set([...(existing?.shotIds || []), shot.id])],
      };
      const assetPrompts = [...prompts];
      if (existingIndex >= 0) assetPrompts[existingIndex] = nextRecord;
      else assetPrompts.push(nextRecord);
      return { ...previous, assetPrompts };
    });
  }
  const selectedArtworkIndex = Math.min(Math.max(0, review.selectedArtworkIndex || 0), Math.max(0, artworkRecord.dataUrls.length - 1));
  const artworkCandidates = artworkRecord.shotId === shot.id ? artworkRecord.dataUrls : [];
  const artwork = (review.artworkNames?.length || review.artworkName) ? artworkCandidates[selectedArtworkIndex] : undefined;
  const defaultArtworkPrompt = useMemo(() => getArtworkPrompt(shot, state.projectTitle, generationModel, state.globalSettings), [shot, state.projectTitle, generationModel, state.globalSettings]);
  const artworkPrompt = review.artworkPrompt !== undefined ? review.artworkPrompt : defaultArtworkPrompt;
  const useDefaultProjectPlans = false;
  const directorViews = getDirectorViews(shot, useDefaultProjectPlans);
  const selectedDirectorView = directorViews.find((view) => view.key === review.selectedDirectorView) || directorViews[0];
  const whiteboxScene = review.whiteboxScenes?.[selectedDirectorView.key]
    || createWhiteboxScene(selectedDirectorView.key, shot.id, selectedDirectorView.title, useDefaultProjectPlans);
  const whiteboxReferenceCount = Object.keys(review.whiteboxReferences || {}).length;
  const selectedWhiteboxReferenceLocked = Boolean(review.whiteboxReferences?.[selectedDirectorView.key]);
  const hasSegmentedDirectorViews = directorViews.length > 1;
  const artworkPromptEdited = review.artworkPrompt !== undefined;
  const noteCount = annotationSections.filter((section) => (review.annotations[section.id] || "").trim()).length;
  const annotatedReviews = state.reviews.filter((item) => annotationCountFor(item) > 0);
  const batchShotCount = annotatedReviews.length;
  const batchNoteCount = annotatedReviews.reduce((total, item) => total + annotationCountFor(item), 0);
  const approvedCount = state.reviews.filter((item) => item.approved).length;
  const selectedRecipe = getDirectorRecipe(state.selectedRecipeId);
  const coverageReport = useMemo(
    () => buildCoverageReport(state.sourceDocument, state.reviews.map((item) => item.shot)),
    [state.reviews, state.sourceDocument],
  );
  const videoPackages = useMemo(() => {
    const model = generationModels.find((item) => item.id === generationModel) || generationModels[0];
    return state.reviews.map((item) => {
      const views = getDirectorViews(item.shot, useDefaultProjectPlans);
      const layoutViewKeys = views
        .map((view) => view.key)
        .filter((key) => useDefaultProjectPlans && Boolean(blockingPlans[key] || (key === item.shot.id && blockingPlans[item.shot.id])));
      const artworkNames = item.artworkNames?.length
        ? item.artworkNames
        : item.artworkName ? [item.artworkName] : [];
      return buildVideoGenerationPackage({
        projectTitle: state.projectTitle,
        modelId: model.id,
        modelLabel: model.label,
        referenceLimit: model.limit,
        minDuration: model.minDuration,
        maxDuration: model.maxDuration,
        globalSettings: state.globalSettings,
        shot: item.shot,
        approved: item.approved,
        approvedAt: item.approvedAt,
        layoutViewKeys,
        directorViewKeys: views.map((view) => view.key),
        whiteboxLocks: Object.entries(item.whiteboxReferences || {}).map(([key, value]) => ({
          key,
          lockedAt: value.lockedAt,
          sourceRevision: value.sourceRevision,
        })),
        artworkStatus: item.artworkStatus,
        artworkNames,
        selectedArtworkIndex: Math.min(Math.max(0, item.selectedArtworkIndex || 0), Math.max(0, artworkNames.length - 1)),
        artworkDependencyRevision: item.artworkDependencyRevision,
        customPrompt: item.videoPrompt,
        customPromptSourceRevision: item.videoPromptSourceRevision,
      });
    });
  }, [generationModel, state.globalSettings, state.projectTitle, state.reviews, useDefaultProjectPlans]);
  const currentVideoPackage = videoPackages.find((item) => item.shotId === shot.id) || videoPackages[0];
  const selectedAssetShotId = assetSelectedShotId || shot.id;
  const selectedAssetPackage = videoPackages.find((item) => item.shotId === selectedAssetShotId) || videoPackages[0];
  const selectedAssetReview = state.reviews.find((item) => item.shot.id === selectedAssetPackage?.shotId) || state.reviews[0];
  const assetReadyCount = videoPackages.filter((item) => item.status === "ready").length;
  const assetAttentionCount = videoPackages.filter((item) => item.status === "blocked" || item.status === "stale" || item.status === "warning").length;
  const assetRunningCount = videoPackages.filter((item) => item.status === "running").length;
  const annotationBusy = bridge.busy && (
    (bridge.activeJob?.type === "annotation" && bridge.activeJob.shotId === shot.id)
    || bridge.activeJob?.type === "annotation-batch"
  );
  const globalBusy = bridge.busy && bridge.activeJob?.type === "global-annotation";
  const artworkJob = bridge.artworkJobs?.find((job) => job.shotId === shot.id && (!job.projectTitle || job.projectTitle === projectStorageTitle));
  const scriptLocked = review.scriptStatus === "sending"
    || stampingShotId === shot.id
    || review.artworkStatus === "generating"
    || Boolean(artworkJob);
  const lastArtworkJob = bridge.lastArtworkJobs?.find((job) => job.shotId === shot.id && (!job.projectTitle || job.projectTitle === projectStorageTitle));
  const libtvReady = bridge.libtv?.status === "ready";
  const referenceLimit = referenceLimitFor(generationModel);
  const durationRange = durationRangeFor(generationModel);
  const referenceCount = shot.omniReferences.length;
  const referencesOverLimit = referenceCount > referenceLimit;
  const durationOutOfRange = shot.duration < durationRange.min || shot.duration > durationRange.max;
  const lastJobType = bridge.lastJob?.type;
  const lastJobShotId = bridge.lastJob?.shotId;
  const lastJobStatus = bridge.lastJob?.status;
  const lastJobStartedAt = bridge.lastJob?.startedAt;
  const lastJobFinishedAt = bridge.lastJob?.finishedAt;

  useEffect(() => {
    currentShotIdRef.current = shot.id;
  }, [shot.id]);

  useEffect(() => {
    if (state.view !== "artwork" || artworkCandidates.length < 2) return;
    const frame = window.requestAnimationFrame(() => {
      const scroller = artworkScroller.current;
      const target = scroller?.querySelector<HTMLElement>(`[data-candidate-index="${selectedArtworkIndex}"]`);
      if (scroller && target) scroller.scrollTo({ left: target.offsetLeft, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [artworkCandidates.length, selectedArtworkIndex, shot.id, state.view]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const query = new URLSearchParams(window.location.search);
        const resetRequested = query.get("reset") === "all";
        if (resetRequested) {
          window.localStorage.clear();
          window.sessionStorage.clear();
          window.indexedDB.deleteDatabase(artworkDb);
          window.history.replaceState({}, "", window.location.pathname);
        }
        const requestedDraftId = resetRequested ? "" : query.get("draft") || "";
        const validDraftId = /^[a-f0-9-]{36}$/i.test(requestedDraftId) ? requestedDraftId : "";
        const targetStorageKey = validDraftId ? `${materialDraftStoragePrefix}${validDraftId}` : storageKey;
        setActiveStorageKey(targetStorageKey);
        setMaterialDraftMode(Boolean(validDraftId));
        const currentSaved = resetRequested ? null : localStorage.getItem(targetStorageKey);
        const legacySaved = resetRequested || validDraftId ? null : legacyStorageKeys.map((key) => localStorage.getItem(key)).find(Boolean) || null;
        let saved = currentSaved || legacySaved;
        if (currentSaved && legacySaved) {
          const currentCandidate = JSON.parse(currentSaved) as ReviewState;
          const legacyCandidate = JSON.parse(legacySaved) as ReviewState;
          const legacyHasProgress = legacyCandidate.reviews?.some((review) => review.approved || review.versions?.length || review.scriptStatus !== "draft");
          if (isBlankInitialReviewState(currentCandidate) && isLegacyDefaultTimelineState(legacyCandidate) && legacyHasProgress) {
            saved = legacySaved;
          }
        }
        if (saved) {
          const parsed = JSON.parse(saved) as ReviewState;
          if (parsed.reviews?.length && parsed.reviews.every((item) => isStoryboardShot(item.shot))) {
            setState(normalizeStateForResume(repairKnownMangaDraftState(parsed, validDraftId)));
          }
        }
      } catch {
        // A damaged local draft should not block the tool.
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(activeStorageKey, JSON.stringify(state));
  }, [activeStorageKey, state, hydrated]);

  useEffect(() => {
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key !== activeStorageKey || !event.newValue) return;
      try {
        const incoming = JSON.parse(event.newValue) as ReviewState;
        if (incoming.reviews?.length && incoming.reviews.every((item) => isStoryboardShot(item.shot))) {
          setState(normalizeStateForResume(repairKnownMangaDraftState(incoming, projectScopeId)));
        }
      } catch {
        // Ignore incomplete writes from another local tab.
      }
    };
    window.addEventListener("storage", syncAcrossTabs);
    return () => window.removeEventListener("storage", syncAcrossTabs);
  }, [activeStorageKey, projectScopeId]);

  useEffect(() => {
    let active = true;
    const checkBridge = () => {
      fetch(`${bridgeBase}/health`, { cache: "no-store" })
        .then((response) => response.json())
        .then((value) => {
          if (active) setBridge({
            connected: Boolean(value.connected),
            busy: Boolean(value.busy),
            pairingToken: value.pairingToken,
            activeJob: value.activeJob,
            lastJob: value.lastJob,
            artworkJobs: Array.isArray(value.artworkJobs) ? value.artworkJobs : [],
            lastArtworkJobs: Array.isArray(value.lastArtworkJobs) ? value.lastArtworkJobs : [],
            assetJobs: Array.isArray(value.assetJobs) ? value.assetJobs : [],
            lastAssetJobs: Array.isArray(value.lastAssetJobs) ? value.lastAssetJobs : [],
            libtv: value.libtv,
          });
        })
        .catch(() => {
          if (active) setBridge({ connected: false, busy: false });
        });
    };
    checkBridge();
    const timer = window.setInterval(checkBridge, 1200);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (lastJobType !== "annotation" || lastJobShotId !== shot.id || lastJobStatus !== "completed" || !bridge.pairingToken) return;

    const pendingSubmission = review.pendingSubmission?.shotId === shot.id
      ? review.pendingSubmission
      : undefined;
    if (!pendingSubmission) return;

    const jobStartedAt = lastJobStartedAt ? Date.parse(lastJobStartedAt) : 0;
    const submittedAt = Date.parse(pendingSubmission.submittedAt);
    if (jobStartedAt && submittedAt && jobStartedAt + 2000 < submittedAt) return;

    const recoveryKey = `${shot.id}:${lastJobStartedAt || lastJobFinishedAt || "completed"}`;
    if (recoveringAnnotationJob.current === recoveryKey) return;
    recoveringAnnotationJob.current = recoveryKey;
    let active = true;

    const recoveryUrl = `${bridgeBase}/job-result?type=annotation&shotId=${encodeURIComponent(shot.id)}&submittedAt=${encodeURIComponent(pendingSubmission.submittedAt)}`;
    fetch(recoveryUrl, {
      cache: "no-store",
      headers: { "X-ShotDirector-Token": bridge.pairingToken },
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "无法取回已完成的批注结果");
        return result as AnnotationResult;
      })
      .then((result) => {
        if (!active || !isStoryboardShot(result.shot) || result.shot.id !== shot.id) return;
        if (result.submittedAt !== pendingSubmission.submittedAt) throw new Error("完成结果不属于当前这次批注，已停止自动应用");
        if (result.shot.omniReferences.length > referenceLimit) throw new Error("取回结果的全能参考数量超过当前模型上限");
        setLastSubmission(pendingSubmission);
        setState((previous) => applyAnnotationResultToState(previous, shot.id, result, pendingSubmission.submittedAt));
        setToast("已取回 GPT 完成的批注修改，等待当前 Shot 签字盖章");
      })
      .catch((error) => {
        if (active) setToast(error instanceof Error ? error.message : "无法取回已完成的批注结果");
      });

    return () => { active = false; };
  }, [
    bridge.pairingToken,
    lastJobFinishedAt,
    lastJobShotId,
    lastJobStartedAt,
    lastJobStatus,
    lastJobType,
    referenceLimit,
    review.pendingSubmission,
    shot.id,
  ]);

  useEffect(() => {
    if (lastJobType !== "annotation-batch" || lastJobShotId !== "all" || lastJobStatus !== "completed" || !bridge.pairingToken) return;
    const pendingReviews = state.reviews.filter((item) => item.scriptStatus === "sending" && item.pendingSubmission);
    if (!pendingReviews.length) return;
    const pendingSubmittedAt = pendingReviews[0]?.pendingSubmission?.submittedAt;
    if (!pendingSubmittedAt || pendingReviews.some((item) => item.pendingSubmission?.submittedAt !== pendingSubmittedAt)) return;
    const recoveryKey = `all:${lastJobStartedAt || lastJobFinishedAt || "completed"}`;
    if (recoveringAnnotationJob.current === recoveryKey) return;
    recoveringAnnotationJob.current = recoveryKey;
    let active = true;

    const recoveryUrl = `${bridgeBase}/job-result?type=annotation-batch&shotId=all&submittedAt=${encodeURIComponent(pendingSubmittedAt)}`;
    fetch(recoveryUrl, {
      cache: "no-store",
      headers: { "X-ShotDirector-Token": bridge.pairingToken },
    })
      .then(async (response) => {
        const result = await response.json() as AnnotationBatchResult & { error?: string };
        if (!response.ok) throw new Error(result.error || "无法取回全片批改结果");
        return result;
      })
      .then((result) => {
        if (!active || !Array.isArray(result.shots) || !result.shots.every(isStoryboardShot)) return;
        if (result.submittedAt !== pendingSubmittedAt) throw new Error("完成结果不属于当前这次全片批注，已停止自动应用");
        setState((previous) => applyBatchAnnotationResultToState(previous, result, pendingSubmittedAt));
        setToast(`已取回 ${result.shots.length} 个 Shot 的全片批改，等待逐镜签字盖章`);
      })
      .catch((error) => {
        if (active) setToast(error instanceof Error ? error.message : "无法取回全片批改结果");
      })
      .finally(() => { recoveringAnnotationJob.current = ""; });

    return () => { active = false; };
  }, [bridge.pairingToken, lastJobFinishedAt, lastJobShotId, lastJobStartedAt, lastJobStatus, lastJobType, state.reviews]);

  useEffect(() => {
    if (review.scriptStatus !== "sending") {
      delete staleSendingSince.current[shot.id];
      return;
    }
    if (!hydrated || !bridge.connected) return;

    const liveAnnotationJob = bridge.activeJob?.type === "annotation"
      && bridge.activeJob.shotId === shot.id
      && bridge.activeJob.status !== "completed"
      && bridge.activeJob.status !== "failed";
    if (bridge.busy || liveAnnotationJob) {
      delete staleSendingSince.current[shot.id];
      return;
    }

    const matchingLastJob = bridge.lastJob?.type === "annotation" && bridge.lastJob.shotId === shot.id
      ? bridge.lastJob
      : undefined;
    const firstObservedAt = staleSendingSince.current[shot.id] ?? Date.now();
    staleSendingSince.current[shot.id] = firstObservedAt;

    if (matchingLastJob?.status !== "failed" && Date.now() - firstObservedAt < staleSendingGraceMs) return;

    const failed = matchingLastJob?.status === "failed";
    const message = matchingLastJob?.error || "GPT任务未在运行，已恢复为可重新发送";
    setState((previous) => {
      const reviewIndex = previous.reviews.findIndex((item) => item.shot.id === shot.id);
      if (reviewIndex < 0 || previous.reviews[reviewIndex].scriptStatus !== "sending") return previous;
      const reviews = [...previous.reviews];
      reviews[reviewIndex] = {
        ...reviews[reviewIndex],
        pendingSubmission: undefined,
        scriptStatus: failed ? "error" : "draft",
        summary: failed ? message : undefined,
      };
      return { ...previous, reviews };
    });
    setLastSubmission((current) => current?.shotId === shot.id ? undefined : current);
    delete staleSendingSince.current[shot.id];
    setToast(failed ? message : "旧的‘GPT正在修改’状态已清除，批注仍然保留");
  }, [bridge, hydrated, review.scriptStatus, shot.id]);

  useEffect(() => {
    if (review.artworkStatus !== "generating") {
      delete staleArtworkSince.current[shot.id];
      return;
    }
    if (!hydrated || !bridge.connected) return;
    if (artworkJob?.status === "running") {
      delete staleArtworkSince.current[shot.id];
      return;
    }

    const recoveryKey = `${shot.id}:${lastArtworkJob?.requestId || "latest"}`;
    if (lastArtworkJob?.status === "completed" && bridge.pairingToken && recoveringArtworkJob.current !== recoveryKey) {
      recoveringArtworkJob.current = recoveryKey;
      fetch(`${bridgeBase}/job-result?type=artwork&shotId=${encodeURIComponent(shot.id)}&projectTitle=${encodeURIComponent(projectStorageTitle)}`, {
        cache: "no-store",
        headers: { "X-ShotDirector-Token": bridge.pairingToken },
      })
        .then(async (response) => {
          const result = await response.json() as ArtworkResult & { error?: string };
          if (!response.ok) throw new Error(result.error || "无法恢复出图结果");
          await applyArtworkResult(projectStorageTitle, shot.id, result);
          setToast(`Shot ${shot.id} 的 2 张 Lib Image 结果已恢复`);
        })
        .catch((error) => {
          updateReview((current) => ({ ...current, artworkStatus: "error", summary: error instanceof Error ? error.message : "出图恢复失败" }));
        })
        .finally(() => { recoveringArtworkJob.current = ""; });
      return;
    }

    if (lastArtworkJob?.status === "failed") {
      const message = lastArtworkJob.error || lastArtworkJob.message || "LibTV 出图失败";
      recoveringArtworkJob.current = recoveryKey;
      window.setTimeout(() => {
        updateReview((current) => ({ ...current, artworkStatus: "error", summary: message }));
        setToast(message);
        recoveringArtworkJob.current = "";
      }, 0);
      return;
    }

    const firstObservedAt = staleArtworkSince.current[shot.id] ?? Date.now();
    staleArtworkSince.current[shot.id] = firstObservedAt;
    if (Date.now() - firstObservedAt < staleArtworkGraceMs) return;
    delete staleArtworkSince.current[shot.id];
    window.setTimeout(() => {
      updateReview((current) => current.artworkStatus === "generating"
        ? { ...current, artworkStatus: "empty", summary: "旧的出图状态没有对应任务，已恢复为可重试" }
        : current);
      setToast("旧的‘出图中’状态已清除，可以重新提交");
    }, 0);
  }, [artworkJob, bridge.connected, bridge.pairingToken, hydrated, lastArtworkJob, projectStorageTitle, review.artworkStatus, shot.id]);

  useEffect(() => {
    let active = true;
    getArtworksForShot(projectStorageTitle, shot.id).then((dataUrls) => {
      if (active) setArtworkRecord({ shotId: shot.id, dataUrls });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [projectStorageTitle, shot.id]);

  useEffect(() => {
    let active = true;
    Promise.all(shotAssets.map(async (asset) => {
      const key = shotAssetStorageKey(projectStorageTitle, asset);
      return [key, await getArtworks(key)] as const;
    })).then((entries) => {
      if (!active) return;
      setShotAssetImages((current) => ({ ...current, ...Object.fromEntries(entries) }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [projectStorageTitle, shot.id, shotAssetSignature]);

  useEffect(() => {
    setShotAssetImageSettings((current) => ({
      ...current,
      ...Object.fromEntries(shotAssets.map((asset) => {
        const key = shotAssetStorageKey(projectStorageTitle, asset);
        return [key, current[key] || defaultShotAssetImageSettings(asset)];
      })),
    }));
  }, [projectStorageTitle, shot.id, shotAssetSignature]);

  useEffect(() => {
    if (!hydrated) return;
    setState((previous) => {
      let stateChanged = false;
      const reviews = previous.reviews.map((current) => {
        const currentShot = normalizeShot(current.shot, previous.projectTitle === defaultProjectTitle);
        const assets = deriveShotAssets(currentShot);
        if (!assets.length) return current;
        const seeded = new Set(current.seededAssetReferenceIds || []);
        const newAssets = assets.filter((asset) => !seeded.has(asset.id));
        if (!newAssets.length) return current;
        const omniReferences = [...(currentShot.omniReferences || [])];
        for (const asset of newAssets) {
          seeded.add(asset.id);
          if (!omniReferences.some((reference) => isShotAssetReference(reference, asset))) {
            omniReferences.push(shotAssetReferenceLabel(asset));
          }
        }
        const referencesChanged = omniReferences.length !== (currentShot.omniReferences || []).length;
        stateChanged = true;
        return {
          ...current,
          shot: referencesChanged ? { ...currentShot, omniReferences } : current.shot,
          seededAssetReferenceIds: [...seeded],
          scriptStatus: referencesChanged ? "draft" as const : current.scriptStatus,
          approved: referencesChanged ? false : current.approved,
          approvedAt: referencesChanged ? undefined : current.approvedAt,
          artworkStatus: referencesChanged ? "empty" as const : current.artworkStatus,
          artworkName: referencesChanged ? undefined : current.artworkName,
          artworkNames: referencesChanged ? undefined : current.artworkNames,
          summary: referencesChanged ? "人物、场景与关键道具已首次自动加入全能参考；可逐项取消，取消后不会回填" : current.summary,
        };
      });
      return stateChanged ? { ...previous, reviews } : previous;
    });
  }, [activeStorageKey, hydrated, projectAssetSignature, state.projectTitle]);

  useEffect(() => {
    if (state.workspaceMode !== "assets" || !selectedAssetPackage) return;
    let active = true;
    getArtworksForShot(projectStorageTitle, selectedAssetPackage.shotId).then((dataUrls) => {
      if (active) setAssetPreviewRecord({ shotId: selectedAssetPackage.shotId, dataUrls });
    }).catch(() => {
      if (active) setAssetPreviewRecord({ shotId: selectedAssetPackage.shotId, dataUrls: [] });
    });
    return () => { active = false; };
  }, [projectStorageTitle, selectedAssetPackage?.shotId, state.workspaceMode]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function updateReview(mutator: (current: ShotReview) => ShotReview) {
    setState((previous) => ({
      ...previous,
      reviews: previous.reviews.map((item, index) => index === previous.currentShot ? mutator(item) : item),
    }));
  }

  function updateReviewByShotId(shotId: string, mutator: (current: ShotReview) => ShotReview) {
    setState((previous) => ({
      ...previous,
      reviews: previous.reviews.map((item) => item.shot.id === shotId ? mutator(item) : item),
    }));
  }

  function invalidate(current: ShotReview): ShotReview {
    setArtworkRecord({ shotId: "", dataUrls: [] });
    return {
      ...current,
      scriptStatus: "draft",
      artworkStatus: "empty",
      artworkName: undefined,
      artworkNames: undefined,
      artworkDependencyRevision: undefined,
      selectedArtworkIndex: 0,
      artworkAttempt: 0,
      artworkPrompt: undefined,
      whiteboxReferences: undefined,
      approved: false,
      approvedAt: undefined,
      summary: undefined,
    };
  }

  function updateField<K extends keyof StoryboardShot>(field: K, value: StoryboardShot[K]) {
    updateReview((current) => {
      const draft = invalidate(current);
      return { ...draft, shot: { ...draft.shot, [field]: value } };
    });
  }

  function updateAnnotation(section: SectionId, value: string) {
    updateReview((current) => ({
      ...current,
      scriptStatus: "draft",
      approved: false,
      approvedAt: undefined,
      annotations: { ...current.annotations, [section]: value },
    }));
  }

  function updateSegment(index: number, patch: Partial<StoryboardSegment>) {
    updateField("segments", shot.segments.map((segment, itemIndex) => itemIndex === index ? { ...segment, ...patch } : segment));
  }

  function selectDirectorView(key: string) {
    if (!directorViews.some((view) => view.key === key)) return;
    updateReview((current) => ({ ...current, selectedDirectorView: key }));
  }

  function updateWhiteboxScene(nextScene: WhiteboxScene) {
    setArtworkRecord({ shotId: "", dataUrls: [] });
    updateReview((current) => {
      const whiteboxReferences = { ...(current.whiteboxReferences || {}) };
      delete whiteboxReferences[selectedDirectorView.key];
      return {
        ...current,
        whiteboxScenes: { ...(current.whiteboxScenes || {}), [selectedDirectorView.key]: nextScene },
        whiteboxReferences,
        approved: false,
        approvedAt: undefined,
        artworkStatus: "empty",
        artworkName: undefined,
        artworkNames: undefined,
        artworkDependencyRevision: undefined,
        selectedArtworkIndex: 0,
        artworkAttempt: 0,
        summary: "3D白模已修改，请重新检查摄影机画面、重新锁定结构参考并盖章",
      };
    });
  }

  function resetWhiteboxScene() {
    updateWhiteboxScene(createWhiteboxScene(selectedDirectorView.key, shot.id, selectedDirectorView.title, useDefaultProjectPlans));
    setToast(`${selectedDirectorView.label} 已从 TOP VIEW 重新生成3D白模`);
  }

  async function lockWhiteboxReference(dataUrl: string) {
    const key = selectedDirectorView.key;
    await putArtworks(whiteboxReferenceStorageKey(projectStorageTitle, shot.id, key), [dataUrl]);
    updateReview((current) => ({
      ...current,
      whiteboxReferences: {
        ...(current.whiteboxReferences || {}),
        [key]: {
          lockedAt: new Date().toISOString(),
          sourceRevision: buildShotUpstreamRevision({
            projectTitle: state.projectTitle,
            modelId: generationModel,
            globalSettings: state.globalSettings,
            shot: current.shot,
          }),
        },
      },
    }));
    setToast(`${selectedDirectorView.label} 的纯净3D白模已锁定；Lib Image 会把它作为结构参考`);
  }

  async function unlockWhiteboxReference() {
    const key = selectedDirectorView.key;
    await deleteArtworks(whiteboxReferenceStorageKey(projectStorageTitle, shot.id, key));
    updateReview((current) => {
      const whiteboxReferences = { ...(current.whiteboxReferences || {}) };
      delete whiteboxReferences[key];
      return { ...current, whiteboxReferences };
    });
    setToast(`${selectedDirectorView.label} 已取消白模结构参考`);
  }

  function selectGenerationModel(model: GenerationModel) {
    setState((previous) => ({ ...previous, generationModel: model }));
    const limit = referenceLimitFor(model);
    const range = durationRangeFor(model);
    setToast(`已选择 ${generationModels.find((item) => item.id === model)?.label}：每镜 ${range.min}–${range.max} 秒，最多 ${limit} 个全能参考`);
  }

  function updateOmniReferences(value: string) {
    const items = splitLines(value);
    if (items.length > referenceLimit) {
      setToast(`${generationModels.find((item) => item.id === generationModel)?.label} 最多 ${referenceLimit} 个全能参考`);
    }
    updateField("omniReferences", items);
  }

  function toggleShotAssetReference(asset: ShotAssetEntry, enabled: boolean) {
    const withoutAsset = shot.omniReferences.filter((reference) => !isShotAssetReference(reference, asset));
    if (enabled && withoutAsset.length >= referenceLimit) {
      setToast(`当前模型最多 ${referenceLimit} 个全能参考，请先移除一项再加入“${asset.name}”`);
      return;
    }
    const next = enabled ? [...withoutAsset, shotAssetReferenceLabel(asset)] : withoutAsset;
    updateOmniReferences(next.join("\n"));
    setToast(enabled ? `“${asset.name}”已纳入全能参考` : `“${asset.name}”已移出全能参考；刷新后不会自动加回`);
  }

  function setView(view: ViewId) {
    if (view !== "script" && referencesOverLimit) {
      setToast(`当前模型最多 ${referenceLimit} 个全能参考，请先精简`);
      return;
    }
    if (view !== "script" && durationOutOfRange) {
      setToast(`当前模型要求每个 Shot 为 ${durationRange.min}–${durationRange.max} 秒，请先调整时长`);
      return;
    }
    if (view === "artwork" && (review.scriptStatus !== "applied" || !review.approved)) {
      setToast(review.scriptStatus !== "applied" ? "先上传或确认当前 Shot 的脚本" : "当前 Shot 还没有签字盖章");
      return;
    }
    if (view === "confirm" && !artwork) {
      setToast("先生成或放入当前镜头的分镜图");
      return;
    }
    setState((previous) => ({ ...previous, view }));
  }

  function selectShot(index: number) {
    const target = state.reviews[index];
    const targetView: ViewId = target?.approved && target?.artworkStatus === "ready"
      ? "confirm"
      : target?.approved && (target?.artworkStatus === "generating" || target?.scriptStatus === "applied") ? "artwork" : "script";
    setState((previous) => ({ ...previous, currentShot: index, view: targetView }));
  }

  function continueToNextShot() {
    if (state.currentShot >= state.reviews.length - 1) {
      setToast("已经是最后一个 Shot");
      return;
    }
    const nextShot = state.reviews[state.currentShot + 1].shot;
    setState((previous) => ({ ...previous, currentShot: previous.currentShot + 1, view: "script" }));
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    setToast(`进入 Shot ${nextShot.id}；Shot ${shot.id} 可随时返回出图`);
  }

  function applyLoadedScript(projectTitle: string, shots: StoryboardShot[], sourceDocument = "", sourceName = "") {
    const normalizedShots = shots.map((item) => normalizeShot(item));
    setArtworkRecord({ shotId: "", dataUrls: [] });
    setLastSubmission(undefined);
    setLastBatchSubmissions({});
    setState({
      stateSchemaVersion,
      projectTitle: projectTitle.trim() || "未命名脚本",
      sourceDocument: sourceDocument.trim() || sourceDocumentFromShots(normalizedShots),
      sourceName: sourceName.trim() || "载入脚本（原文依据由镜头恢复，需复核）",
      selectedRecipeId: defaultDirectorRecipeId,
      generationModel,
      workspaceMode: "shots",
      globalSettings: cloneGlobalSettings(),
      globalAnnotation: "",
      globalStatus: "applied",
      currentShot: 0,
      view: "script",
      reviews: createReviews(normalizedShots, projectTitle.trim() === defaultProjectTitle),
    });
    setNaturalScript("");
    setShowLoader(false);
    setToast(`已载入《${projectTitle.trim() || "未命名脚本"}》，共 ${shots.length} 个 Shot`);
  }

  async function loadScriptThroughGpt(content: string, fileName: string, sourceType: "file" | "natural-language") {
    if (!bridge.connected || !bridge.pairingToken) {
      setToast("GPT直连未启动，暂时不能解析自然语言脚本");
      return;
    }
    if (bridge.busy) {
      setToast("GPT正在处理当前任务，完成后才能载入新脚本");
      return;
    }
    if (!content.trim()) {
      setToast("先输入脚本内容或自然语言描述");
      return;
    }
    setLoadingScript(true);
    setBridge((current) => ({ ...current, busy: true }));
    try {
      const response = await fetch(`${bridgeBase}/load-script`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ShotDirector-Token": bridge.pairingToken,
        },
        body: JSON.stringify({
          fileName,
          content,
          sourceType,
          generationModel,
          defaultArtStyle,
          directorRecipe: selectedRecipe,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "GPT解析脚本失败");
      if (!result.projectTitle || !Array.isArray(result.shots) || !result.shots.length || !result.shots.every(isStoryboardShot)) {
        throw new Error("GPT返回的脚本格式不完整");
      }
      applyLoadedScript(result.projectTitle, result.shots, content, fileName);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "载入脚本失败");
    } finally {
      setLoadingScript(false);
      setBridge((current) => ({ ...current, busy: false }));
    }
  }

  async function onScriptFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const content = await file.text();
      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(content) as unknown;
        const source: { projectTitle?: unknown; title?: unknown; artStyle?: unknown; sourceDocument?: unknown; sourceName?: unknown; shots?: unknown } = Array.isArray(parsed)
          ? { projectTitle: file.name.replace(/\.json$/i, ""), shots: parsed }
          : parsed as { projectTitle?: unknown; title?: unknown; artStyle?: unknown; sourceDocument?: unknown; sourceName?: unknown; shots?: unknown };
        const title = typeof source.projectTitle === "string"
          ? source.projectTitle
          : typeof source.title === "string" ? source.title : file.name.replace(/\.json$/i, "");
        if (!Array.isArray(source.shots) || !source.shots.length || !source.shots.every(isStoryboardShot)) {
          throw new Error("JSON中没有可用的结构化 Shot");
        }
        const projectArtStyle = typeof source.artStyle === "string" && source.artStyle.trim()
          ? source.artStyle.trim()
          : defaultArtStyle;
        const shots = source.shots.map((sourceShot) => ({
          ...sourceShot,
          artStyle: sourceShot.artStyle?.trim() || projectArtStyle,
        }));
        const originalDocument = typeof source.sourceDocument === "string" ? source.sourceDocument : sourceDocumentFromShots(shots);
        const originalName = typeof source.sourceName === "string" ? source.sourceName : file.name;
        applyLoadedScript(title, shots, originalDocument, originalName);
        return;
      }
      await loadScriptThroughGpt(content, file.name, "file");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "读取脚本文件失败");
    }
  }

  function loadNaturalScript() {
    void loadScriptThroughGpt(naturalScript, "GPT自然语言输入", "natural-language");
  }

  function openGlobalSettings() {
    setShowLoader(false);
    setState((previous) => ({ ...previous, workspaceMode: "global" }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openMaterialLab() {
    setShowLoader(false);
    setState((previous) => ({ ...previous, workspaceMode: "materials" }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openCoverageReview() {
    setShowLoader(false);
    setState((previous) => ({ ...previous, workspaceMode: "coverage" }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openAssetLedger() {
    setShowLoader(false);
    setAssetSelectedShotId(shot.id);
    setState((previous) => ({ ...previous, workspaceMode: "assets" }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectRecipe(recipeId: string) {
    const recipe = getDirectorRecipe(recipeId);
    setState((previous) => ({ ...previous, selectedRecipeId: recipe.id }));
    setToast(`已切换导演配方：${recipe.name}`);
  }

  function openShotFromCoverage(shotId: string) {
    const index = state.reviews.findIndex((item) => item.shot.id === shotId);
    if (index < 0) return;
    setState((previous) => ({ ...previous, workspaceMode: "shots", currentShot: index, view: "script" }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openShotFromAssets(shotId: string, targetView: ViewId = "script") {
    const index = state.reviews.findIndex((item) => item.shot.id === shotId);
    if (index < 0) return;
    setState((previous) => ({ ...previous, workspaceMode: "shots", currentShot: index, view: targetView }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateVideoPrompt(shotId: string, value: string, sourceRevision: string) {
    updateReviewByShotId(shotId, (current) => ({
      ...current,
      videoPrompt: value,
      videoPromptSourceRevision: sourceRevision,
      videoPackageSyncedAt: undefined,
    }));
  }

  function restoreAutomaticVideoPrompt(targetPackage: VideoGenerationPackage) {
    updateReviewByShotId(targetPackage.shotId, (current) => ({
      ...current,
      videoPrompt: undefined,
      videoPromptSourceRevision: targetPackage.sourceRevision,
      videoPackageSyncedAt: new Date().toISOString(),
    }));
    setToast(`Shot ${targetPackage.shotId} 已重新按最新脚本、布局、白模和分镜图编译`);
  }

  function confirmVideoPackageSync(targetPackage: VideoGenerationPackage) {
    updateReviewByShotId(targetPackage.shotId, (current) => ({
      ...current,
      videoPromptSourceRevision: targetPackage.sourceRevision,
      videoPackageSyncedAt: new Date().toISOString(),
    }));
    setToast(`Shot ${targetPackage.shotId} 视频生成包已同步到当前版本`);
  }

  async function copyVideoPrompt(targetPackage: VideoGenerationPackage) {
    try {
      await navigator.clipboard.writeText(targetPackage.prompt);
      setToast(`Shot ${targetPackage.shotId} 视频提示词已复制`);
    } catch {
      setToast("无法写入剪贴板，请手动复制提示词");
    }
  }

  function downloadVideoPackage(targetPackage: VideoGenerationPackage) {
    const payload = {
      ...targetPackage,
      projectTitle: state.projectTitle,
      exportedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.projectTitle}-shot-${targetPackage.shotId}-video-package.json`.replace(/[\\/:*?"<>|]/g, "-");
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function returnToShots() {
    setState((previous) => ({ ...previous, workspaceMode: "shots" }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function createMaterialDraft(result: MediaAnalysisResult, targetShotId?: string) {
    if (!result.projectTitle?.trim() || !Array.isArray(result.shots) || !result.shots.length || !result.shots.every(isStoryboardShot)) {
      setToast("素材分析结果还不能创建镜导草稿");
      return;
    }
    const materialShotIds = result.shots.map((shot) => shot.id);
    const shotIdCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
    const validShotIds = materialShotIds.every((shotId) => /^\d{2}[A-Z]?$/.test(shotId))
      && new Set(materialShotIds).size === materialShotIds.length
      && materialShotIds.every((shotId, index) => index === 0 || shotIdCollator.compare(materialShotIds[index - 1], shotId) < 0);
    if (!validShotIds) {
      setToast("素材分析结果的 Shot 编号格式、顺序或唯一性无效，暂不能创建镜导草稿");
      return;
    }
    const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    const analysisAssetPrompts = normalizeProjectAssetPrompts((result as MediaAnalysisResult & { assetPrompts?: unknown }).assetPrompts);
    const artStyles = unique(result.shots.map((shot) => shot.artStyle));
    const draftGlobalSettings: GlobalSettings = {
      storyBackground: result.projectBackground?.trim() || state.globalSettings.storyBackground || sourceGlobalSettings.storyBackground,
      characters: unique(result.shots.flatMap((shot) => shot.characters)),
      props: unique(result.shots.flatMap((shot) => shot.props)),
      locations: unique(result.shots.map((shot) => shot.scene)),
      timeline: result.shots.map((shot) => `Shot ${shot.id} · ${shot.timecode} · ${shot.title}`),
      continuity: unique(result.shots.flatMap((shot) => shot.continuity)),
      finalVideoStyle: artStyles.length === 1 ? artStyles[0] : "最终视频风格按各 Shot 的 artStyle 分别执行，未确认前不套用原项目画风。",
      storyboardImageStyle: sourceGlobalSettings.storyboardImageStyle,
      modelRules: generationModel === "seedance-2.5"
        ? ["Seedance 2.5：每镜 4–30 秒，最多 50 个全能参考。"]
        : ["Seedance 2.0：每镜 4–15 秒，最多 9 个全能参考。"],
      negative: unique(result.shots.flatMap((shot) => shot.negative)),
    };
    const targetShotIndex = Math.max(0, targetShotId ? result.shots.findIndex((shot) => shot.id === targetShotId) : 0);
    const draftId = /^[a-f0-9-]{36}$/i.test(result.requestId || "") ? result.requestId as string : crypto.randomUUID();
    const draftStorageKey = `${materialDraftStoragePrefix}${draftId}`;
    let draftState: ReviewState = {
      stateSchemaVersion,
      projectTitle: result.projectTitle.trim(),
      sourceDocument: sourceDocumentFromShots(result.shots),
      sourceName: "素材拉片／漫画拆解结果（依据待复核）",
      selectedRecipeId: defaultDirectorRecipeId,
      generationModel,
      workspaceMode: "shots",
      globalSettings: draftGlobalSettings,
      assetPrompts: analysisAssetPrompts,
      globalAnnotation: "",
      globalStatus: "applied",
      sourceMangaRequestId: result.kind === "manga" && /^[a-f0-9-]{36}$/i.test(result.requestId || "") ? result.requestId : undefined,
      currentShot: targetShotIndex,
      view: "script",
      reviews: createReviews(result.shots, false),
    };
    try {
      const existing = localStorage.getItem(draftStorageKey);
      if (existing) {
        const parsed = repairKnownMangaDraftState(JSON.parse(existing) as ReviewState, draftId);
        const sameShotStructure = parsed.reviews?.length === result.shots.length
          && result.shots.every((sourceShot, index) => (
            parsed.reviews[index]?.shot.id === sourceShot.id
          ));
        if (parsed.projectTitle === result.projectTitle.trim() && sameShotStructure) {
          draftState = repairKnownMangaDraftState({
            ...parsed,
            sourceMangaRequestId: result.kind === "manga" ? result.requestId || parsed.sourceMangaRequestId : undefined,
            workspaceMode: "shots",
            currentShot: targetShotIndex,
            view: "script",
            assetPrompts: mergeProjectAssetPrompts(parsed.assetPrompts, analysisAssetPrompts),
            reviews: parsed.reviews.map((review, index) => ({
              ...review,
              shot: {
                ...review.shot,
                sourcePanels: result.shots[index].sourcePanels,
                sourceText: [...new Set([...(review.shot.sourceText || []), ...(result.shots[index].sourceText || [])])],
              },
            })),
          }, draftId);
        }
      }
      draftState = repairKnownMangaDraftState(draftState, draftId);
      localStorage.setItem(draftStorageKey, JSON.stringify(draftState));
    } catch {
      setToast("无法保存漫画分镜草稿，请检查浏览器本地存储空间");
      return;
    }
    const draftUrl = `/?draft=${encodeURIComponent(draftId)}`;
    window.location.assign(draftUrl);
  }

  function updateGlobalArray(field: (typeof globalArrayFields)[number], value: string) {
    setState((previous) => ({
      ...previous,
      globalStatus: "draft",
      globalSettings: { ...previous.globalSettings, [field]: splitLines(value) },
    }));
  }

  function updateGlobalString(field: "storyBackground" | "finalVideoStyle" | "storyboardImageStyle", value: string) {
    setState((previous) => ({
      ...previous,
      globalStatus: "draft",
      globalSettings: { ...previous.globalSettings, [field]: value },
    }));
  }

  function updateGlobalAnnotation(value: string) {
    setState((previous) => ({ ...previous, globalAnnotation: value, globalStatus: value.trim() ? "draft" : previous.globalStatus }));
  }

  async function saveGlobalSettings() {
    if (!bridge.connected || !bridge.pairingToken) {
      setToast("本地桥接未启动，暂时不能回写全局设定源文件");
      return;
    }
    if (bridge.busy) {
      setToast("GPT正在处理当前任务，完成后再保存全局设定");
      return;
    }
    setSavingGlobalSettings(true);
    const normalizedSettings = cloneGlobalSettings(state.globalSettings);
    try {
      const response = await fetch(`${bridgeBase}/source-global-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ShotDirector-Token": bridge.pairingToken },
        body: JSON.stringify({ projectTitle: state.projectTitle, workspaceScope, settings: normalizedSettings }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "全局设定源文件回写失败");
      const updatedAt = result.savedAt || new Date().toISOString();
      setState((previous) => ({
        ...previous,
        globalSettings: normalizedSettings,
        globalStatus: "applied",
        globalUpdatedAt: updatedAt,
        globalSummary: materialDraftMode ? "独立素材草稿的全局设定已保存；主项目源文件未修改" : "全局设定已回写源文件",
      }));
      setToast(materialDraftMode ? "全局设定已保存到独立素材草稿；主项目未修改" : "全局设定已保存到独立源文件，不计入单镜 Shot");
    } catch (error) {
      setState((previous) => ({ ...previous, globalStatus: "draft", globalSummary: `保存失败：${error instanceof Error ? error.message : "全局设定保存失败"}` }));
      setToast(error instanceof Error ? error.message : "全局设定保存失败");
    } finally {
      setSavingGlobalSettings(false);
    }
  }

  async function sendGlobalAnnotation() {
    const annotation = state.globalAnnotation.trim();
    if (!annotation) {
      setToast("先填写全局批注");
      return;
    }
    if (!bridge.connected || !bridge.pairingToken) {
      setToast("GPT直连未启动，请保持本地桥接服务运行");
      return;
    }
    if (bridge.busy) {
      setToast(bridge.activeJob?.type === "global-annotation" ? "全局批注已经上传，GPT正在处理" : "GPT正在处理另一个任务，完成后再发送全局批注");
      return;
    }
    const submittedAt = new Date().toISOString();
    const normalizedSettings = cloneGlobalSettings(state.globalSettings);
    setLastGlobalSubmission({ annotation, submittedAt });
    setState((previous) => ({ ...previous, globalStatus: "sending", globalSummary: "全局批注已发送，正在整理项目设定" }));
    setBridge((current) => ({ ...current, busy: true }));
    try {
      const response = await fetch(`${bridgeBase}/global-annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ShotDirector-Token": bridge.pairingToken },
        body: JSON.stringify({
          projectTitle: state.projectTitle,
          workspaceScope,
          submittedAt,
          settings: normalizedSettings,
          annotation,
        }),
      });
      const result = await response.json() as { settings?: GlobalSettings; summary?: string; submittedAt?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "全局批注处理失败");
      if (!isGlobalSettings(result.settings) || result.submittedAt !== submittedAt) throw new Error("GPT返回的全局设定与本次提交不匹配");
      setState((previous) => ({
        ...previous,
        globalSettings: cloneGlobalSettings(result.settings),
        globalAnnotation: "",
        globalStatus: "applied",
        globalSummary: result.summary || (materialDraftMode ? "GPT已应用全局批注；主项目源文件未修改" : "GPT已应用全局批注并反推源文件"),
        globalUpdatedAt: new Date().toISOString(),
      }));
      setToast(materialDraftMode ? "全局批注已应用到独立素材草稿；主项目未修改" : "全局批注已应用并反推独立源文件；单镜 Shot 未被混入本次任务");
    } catch (error) {
      const message = error instanceof Error ? error.message : "全局批注处理失败";
      setState((previous) => ({ ...previous, globalStatus: "error", globalSummary: message }));
      setToast(message);
    } finally {
      setBridge((current) => ({ ...current, busy: false }));
    }
  }

  async function sendAllAnnotations() {
    if (stampingShotId) {
      setToast(`Shot ${stampingShotId} 正在回写并盖章，完成后再上传全片批注`);
      return;
    }
    const targets = state.reviews.filter((item) => annotationCountFor(item) > 0);
    if (!targets.length) {
      setToast("全片没有待上传批注；当前 Shot 可直接签字盖章");
      return;
    }
    if (bridge.busy) {
      setToast(bridge.activeJob?.type === "annotation-batch" ? "全片批注已经上传，GPT 正在处理" : "GPT正在处理另一个任务，完成后再上传全片批注");
      return;
    }
    if (!bridge.connected || !bridge.pairingToken) {
      setToast("GPT直连未启动，请保持本地桥接服务运行");
      return;
    }
    const invalidReferences = targets.filter((item) => item.shot.omniReferences.length > referenceLimit).map((item) => item.shot.id);
    if (invalidReferences.length) {
      setToast(`Shot ${invalidReferences.join("、")} 的全能参考超过 ${referenceLimit} 个`);
      return;
    }
    const invalidDurations = targets.filter((item) => item.shot.duration < durationRange.min || item.shot.duration > durationRange.max).map((item) => item.shot.id);
    if (invalidDurations.length) {
      setToast(`Shot ${invalidDurations.join("、")} 的时长不在 ${durationRange.min}–${durationRange.max} 秒范围内`);
      return;
    }
    const generatingTargets = targets.filter((item) => item.artworkStatus === "generating").map((item) => item.shot.id);
    if (generatingTargets.length) {
      setToast(`Shot ${generatingTargets.join("、")} 正在出图；完成后再上传这些镜头的批注`);
      return;
    }

    const submittedAt = new Date().toISOString();
    const submissions = Object.fromEntries(targets.map((item) => [item.shot.id, {
      shotId: item.shot.id,
      submittedAt,
      annotations: { ...emptyAnnotations(), ...item.annotations },
    } satisfies AnnotationSubmission]));
    setLastSubmission(undefined);
    setLastBatchSubmissions(submissions);
    setState((previous) => ({
      ...previous,
      reviews: previous.reviews.map((item) => submissions[item.shot.id] ? {
        ...item,
        pendingSubmission: submissions[item.shot.id],
        scriptStatus: "sending" as ScriptStatus,
        approved: false,
        approvedAt: undefined,
      } : item),
    }));
    setBridge((current) => ({ ...current, busy: true }));
    let responseReceived = false;
    try {
      const response = await fetch(`${bridgeBase}/annotations-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ShotDirector-Token": bridge.pairingToken },
        body: JSON.stringify({
          projectTitle: state.projectTitle,
          workspaceScope,
          generationModel,
          globalSettings: state.globalSettings,
          sourceDocument: state.sourceDocument,
          directorRecipe: selectedRecipe,
          submittedAt,
          items: targets.map((item) => ({
            shot: item.shot,
            annotations: { ...emptyAnnotations(), ...item.annotations },
          })),
        }),
      });
      responseReceived = true;
      const result = await response.json() as AnnotationBatchResult & { error?: string };
      if (!response.ok) throw new Error(result.error || "全片批改失败");
      if (!Array.isArray(result.shots) || result.shots.length !== targets.length || !result.shots.every(isStoryboardShot)) throw new Error("GPT返回的全片批改结果不完整");
      if (result.submittedAt !== submittedAt) throw new Error("GPT返回结果与本次全片批注不匹配");
      setState((previous) => applyBatchAnnotationResultToState(previous, result, submittedAt));
      setToast(materialDraftMode
        ? `GPT已应用 ${result.shots.length} 个 Shot 的批注到独立素材草稿；主项目未修改，现在请逐镜签字盖章`
        : `GPT已应用 ${result.shots.length} 个 Shot 的批注并反推源文件；现在请逐镜签字盖章`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "全片批改失败";
      if (!responseReceived) {
        setState((previous) => ({
          ...previous,
          reviews: previous.reviews.map((item) => item.pendingSubmission?.submittedAt === submittedAt
            ? { ...item, summary: "连接中断，正在自动查询本次批改结果" }
            : item),
        }));
        setToast("连接中断，但本次批改可能仍在后台完成；镜导会按本次提交编号自动取回，勿重复上传");
        return;
      }
      const busyConflict = message.includes("GPT正在处理另一个任务");
      setState((previous) => {
        const reviews = previous.reviews.map((item) => item.pendingSubmission?.submittedAt === submittedAt && item.scriptStatus === "sending" ? {
          ...item,
          pendingSubmission: undefined,
          scriptStatus: (busyConflict ? "draft" : "error") as ScriptStatus,
          summary: busyConflict ? undefined : message,
        } : item);
        return { ...previous, reviews };
      });
      setToast(busyConflict ? "全片批改已经在处理，请勿重复上传" : message);
    } finally {
      setBridge((current) => ({ ...current, busy: false }));
    }
  }

  async function stampCurrentShot() {
    if (review.approved) return;
    if (stampingShotId) {
      setToast(`Shot ${stampingShotId} 正在回写并盖章，请稍候`);
      return;
    }
    if (review.scriptStatus === "sending" || annotationBusy) {
      setToast("GPT 还在批改当前 Shot，完成后才能盖章");
      return;
    }
    if (noteCount > 0) {
      setToast("当前 Shot 仍有未上传批注；请先点“批改一键上传”");
      return;
    }
    if (referencesOverLimit || durationOutOfRange) {
      setToast(referencesOverLimit ? `先把全能参考精简到 ${referenceLimit} 个以内` : `当前 Shot 时长需为 ${durationRange.min}–${durationRange.max} 秒`);
      return;
    }

    const targetShotId = shot.id;
    const targetShot = shot;
    const targetShotSnapshot = JSON.stringify(targetShot);
    setStampingShotId(targetShotId);
    try {
      if (review.scriptStatus !== "applied") {
        if (!bridge.connected || !bridge.pairingToken) {
          setToast("本地桥接未启动，暂时不能回写并盖章");
          return;
        }
        if (bridge.busy) {
          setToast("GPT正在处理全片批改，完成后再给当前 Shot 盖章");
          return;
        }
        const response = await fetch(`${bridgeBase}/source-shot`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-ShotDirector-Token": bridge.pairingToken },
          body: JSON.stringify({ projectTitle: state.projectTitle, workspaceScope, generationModel, shot: targetShot }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "脚本源文件回写失败");
      }

      const approvedAt = new Date().toISOString();
      setState((previous) => ({
        ...previous,
        reviews: previous.reviews.map((item) => {
          if (item.shot.id !== targetShotId || JSON.stringify(item.shot) !== targetShotSnapshot || annotationCountFor(item) > 0) return item;
          return {
            ...item,
            scriptStatus: "applied" as ScriptStatus,
            approved: true,
            approvedAt,
            summary: item.summary || (materialDraftMode ? "已保存独立素材草稿并完成审批盖章；主项目源文件未修改" : "已回写脚本源文件并完成审批盖章"),
          };
        }),
      }));
      setToast(materialDraftMode
        ? `Shot ${targetShotId} 已在独立素材草稿中签字盖章；主项目未修改`
        : `Shot ${targetShotId} 已签字盖章 · 审批通过`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "脚本源文件回写失败");
    } finally {
      setStampingShotId("");
    }
  }

  async function applyArtworkResult(
    targetProjectTitle: string,
    targetShotId: string,
    result: ArtworkResult,
    dependencyRevision?: string,
  ) {
    const artworkUrls = Array.isArray(result.artworkUrls) && result.artworkUrls.length
      ? result.artworkUrls
      : result.artworkUrl ? [result.artworkUrl] : [];
    if (!artworkUrls.length) throw new Error("LibTV 没有返回可读取的图片地址");
    const imageResponses = await Promise.all(artworkUrls.map((url) => fetch(url, { cache: "no-store" })));
    if (imageResponses.some((response) => !response.ok)) throw new Error("LibTV 已生成图片，但镜导读取失败");
    const dataUrls = await Promise.all(imageResponses.map(async (response) => blobToDataUrl(await response.blob())));
    await putArtworks(artworkStorageKey(targetProjectTitle, targetShotId), dataUrls);
    const artworkNames = Array.isArray(result.artworkFiles) && result.artworkFiles.length
      ? result.artworkFiles
      : [result.artworkFile || `shot-${targetShotId}.png`];
    const viewingTarget = currentShotIdRef.current === targetShotId;
    if (viewingTarget) setArtworkRecord({ shotId: targetShotId, dataUrls });
    setState((previous) => {
      const targetIndex = previous.reviews.findIndex((item) => item.shot.id === targetShotId);
      if (targetIndex < 0) return previous;
      const reviews = [...previous.reviews];
      const current = reviews[targetIndex];
      reviews[targetIndex] = {
        ...current,
        artworkStatus: "ready",
        artworkName: artworkNames[0],
        artworkNames,
        artworkSourceRevision: artworkSourceRevisionForShot(targetShotId),
        artworkDependencyRevision: dependencyRevision || current.artworkDependencyRevision || buildShotUpstreamRevision({
          projectTitle: previous.projectTitle,
          modelId: previous.generationModel,
          globalSettings: previous.globalSettings,
          shot: current.shot,
        }),
        selectedArtworkIndex: 0,
        summary: result.summary || current.summary,
      };
      return { ...previous, reviews, view: previous.currentShot === targetIndex ? "confirm" : previous.view };
    });
    return { viewingTarget, count: dataUrls.length };
  }

  async function loginLibtv() {
    if (!bridge.connected || !bridge.pairingToken) {
      setToast("镜导本地桥接尚未启动，暂时不能登录 LibTV");
      return;
    }
    if (loggingIntoLibtv || bridge.libtv?.loginBusy) return;
    setLoggingIntoLibtv(true);
    setToast("已打开 LibTV 登录页，请在浏览器完成登录");
    try {
      const response = await fetch(`${bridgeBase}/libtv/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ShotDirector-Token": bridge.pairingToken },
        body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "LibTV 登录失败");
      setBridge((current) => ({ ...current, libtv: result.libtv }));
      setToast("LibTV 登录完成，现在可以用 Lib Image 出图");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "LibTV 登录失败");
    } finally {
      setLoggingIntoLibtv(false);
    }
  }

  async function generateShotAsset(asset: ShotAssetEntry, provider: "libtv" | "gpt") {
    const assetKey = shotAssetStorageKey(projectStorageTitle, asset);
    const attemptKey = shotAssetAttemptStorageKey(projectStorageTitle, asset);
    const targetAttempt = Math.max(1, Number(window.localStorage.getItem(attemptKey) || 0) + 1);
    const prompt = resolvedShotAssetPrompt(asset).trim();
    const settings = shotAssetImageSettings[assetKey] || defaultShotAssetImageSettings(asset);
    if (!prompt) {
      setToast(`${asset.name} 的生图提示词不能为空`);
      return;
    }
    if (!bridge.connected || !bridge.pairingToken) {
      setToast("镜导本地桥接未启动，暂时不能生成资产图");
      return;
    }
    if (provider === "libtv" && !libtvReady) {
      setToast(bridge.libtv?.message || "请先登录 LibTV");
      return;
    }
    if (generatingShotAssetKeys[assetKey]) {
      setToast(`“${asset.name}”已经在生成中`);
      return;
    }

    const targetShotId = shot.id;
    setGeneratingShotAssetKeys((current) => ({ ...current, [assetKey]: true }));
    const providerLabel = provider === "libtv" ? settings.model : "GPT Image";
    setToast(`正在用 ${providerLabel} 生成“${asset.name}”资产参考图`);
    try {
      const endpoint = provider === "libtv" ? "generate-asset" : "generate-asset-gpt";
      const response = await fetch(`${bridgeBase}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ShotDirector-Token": bridge.pairingToken },
        body: JSON.stringify({
          projectTitle: projectStorageTitle,
          projectScopeId,
          shotId: targetShotId,
          assetId: asset.id,
          kind: asset.kind,
          name: asset.name,
          prompt,
          attempt: targetAttempt,
          model: settings.model,
          ratio: settings.ratio,
          resolution: settings.resolution,
        }),
      });
      const result = await response.json() as ArtworkResult & { error?: string };
      if (!response.ok) throw new Error(result.error || "资产图生成失败");
      const urls = result.assetUrls?.length
        ? result.assetUrls
        : result.artworkUrls?.length
          ? result.artworkUrls
          : result.assetUrl ? [result.assetUrl] : result.artworkUrl ? [result.artworkUrl] : [];
      if (!urls.length) throw new Error(`${providerLabel} 没有返回可读取的资产图片`);
      const imageResponses = await Promise.all(urls.map((url) => fetch(url, { cache: "no-store" })));
      if (imageResponses.some((item) => !item.ok)) throw new Error(`${providerLabel} 已生成资产图，但镜导读取失败`);
      const dataUrls = await Promise.all(imageResponses.map(async (item) => blobToDataUrl(await item.blob())));
      await putArtworks(assetKey, dataUrls);
      window.localStorage.setItem(attemptKey, String(targetAttempt));
      setShotAssetImages((current) => ({ ...current, [assetKey]: dataUrls }));
      setToast(`“${asset.name}”已生成 ${dataUrls.length} 张资产图；全能参考勾选状态保持不变`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "资产图生成失败");
    } finally {
      setGeneratingShotAssetKeys((current) => {
        const next = { ...current };
        delete next[assetKey];
        return next;
      });
    }
  }

  async function acceptShotAssetFile(asset: ShotAssetEntry, file: File) {
    if (!file.type.startsWith("image/")) {
      setToast("请选择 PNG、JPG 或 WebP 图片");
      return;
    }
    const assetKey = shotAssetStorageKey(projectStorageTitle, asset);
    const dataUrl = await blobToDataUrl(file);
    await putArtworks(assetKey, [dataUrl]);
    setShotAssetImages((current) => ({ ...current, [assetKey]: [dataUrl] }));
    setToast(`已上传“${asset.name}”参考图；同名资产会在其他 Shot 自动复用`);
  }

  function onShotAssetFile(asset: ShotAssetEntry, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void acceptShotAssetFile(asset, file);
    event.target.value = "";
  }

  async function generateArtwork() {
    if (review.scriptStatus !== "applied") {
      setToast("请先确认当前 Shot 的脚本");
      return;
    }
    if (!review.approved) {
      setToast("当前 Shot 尚未签字盖章，不能出图");
      return;
    }
    if (review.artworkStatus === "generating" || artworkJob) {
      setToast(`Shot ${shot.id} 已在后台出图，请勿重复提交`);
      return;
    }
    if (!artworkPrompt.trim()) {
      setToast("Lib Image 提示词不能为空；可以恢复默认值后再生成");
      return;
    }
    if (referencesOverLimit) {
      setToast(`当前模型最多使用 ${referenceLimit} 个全能参考，暂不能出图`);
      return;
    }
    if (durationOutOfRange) {
      setToast(`当前模型要求每个 Shot 为 ${durationRange.min}–${durationRange.max} 秒，暂不能出图`);
      return;
    }
    if (!bridge.connected || !bridge.pairingToken) {
      setToast("镜导本地桥接未启动，暂时不能出图");
      return;
    }
    if (!libtvReady) {
      setToast(bridge.libtv?.message || "请先登录 LibTV");
      return;
    }

    const targetDependencyRevision = buildShotUpstreamRevision({
      projectTitle: state.projectTitle,
      modelId: generationModel,
      globalSettings: state.globalSettings,
      shot,
    });
    const staleWhiteboxKeys = Object.entries(review.whiteboxReferences || {})
      .filter(([, lock]) => lock.sourceRevision !== targetDependencyRevision)
      .map(([planKey]) => planKey);
    if (staleWhiteboxKeys.length) {
      setToast(`${staleWhiteboxKeys.join("、")} 白模来自旧版脚本、全局设定或模型，请重新锁定后再出图`);
      return;
    }

    let targetWhiteboxReferences: Array<{ planKey: string; label: string; dataUrl: string }> = [];
    try {
      targetWhiteboxReferences = (await Promise.all(Object.keys(review.whiteboxReferences || {}).map(async (planKey) => {
        const [dataUrl] = await getArtworks(whiteboxReferenceStorageKey(projectStorageTitle, shot.id, planKey));
        if (!dataUrl) throw new Error(`${planKey} 的白模结构参考已丢失，请回到 DIRECTOR VIEW 重新锁定`);
        const view = directorViews.find((item) => item.key === planKey);
        return { planKey, label: view?.label || planKey, dataUrl };
      }))).filter((item) => item.dataUrl);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "读取白模结构参考失败");
      return;
    }

    const targetShotId = shot.id;
    const targetShot = shot;
    const targetShotIndex = state.currentShot;
    const targetProjectTitle = projectStorageTitle;
    const targetGenerationModel = generationModel;
    const targetArtworkPrompt = artworkPrompt;
    const targetPairingToken = bridge.pairingToken;
    const targetRevision = Math.max(1, review.versions.length || 1);
    const targetAttempt = (review.artworkAttempt || 0) + 1;
    const nextShot = state.reviews[targetShotIndex + 1]?.shot;
    setState((previous) => {
      const targetIndex = previous.reviews.findIndex((item) => item.shot.id === targetShotId);
      if (targetIndex < 0) return previous;
      const reviews = [...previous.reviews];
      reviews[targetIndex] = {
        ...reviews[targetIndex],
        artworkStatus: "generating",
        artworkAttempt: targetAttempt,
        artworkSourceRevision: artworkSourceRevisionForShot(targetShotId),
        artworkDependencyRevision: targetDependencyRevision,
      };
      if (previous.currentShot === targetIndex && targetIndex < reviews.length - 1) {
        return { ...previous, reviews, currentShot: targetIndex + 1, view: "script" };
      }
      return { ...previous, reviews };
    });
    setToast(nextShot
      ? `Shot ${targetShotId} 已盖章；Lib Image 正在后台生成 2 张图${targetWhiteboxReferences.length ? `（含 ${targetWhiteboxReferences.length} 张白模结构参考）` : ""}，继续审核 Shot ${nextShot.id}`
      : `Shot ${targetShotId} 已盖章；Lib Image 正在后台生成 2 张图${targetWhiteboxReferences.length ? `（含 ${targetWhiteboxReferences.length} 张白模结构参考）` : ""}`);
    try {
      const response = await fetch(`${bridgeBase}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ShotDirector-Token": targetPairingToken },
        body: JSON.stringify({
          projectTitle: targetProjectTitle,
          projectScopeId,
          sourceRevision: artworkSourceRevisionForShot(targetShotId),
          generationModel: targetGenerationModel,
          shot: targetShot,
          prompt: targetArtworkPrompt,
          whiteboxReferences: targetWhiteboxReferences,
          revision: targetRevision,
          attempt: targetAttempt,
        }),
      });
      const result = await response.json() as ArtworkResult & { error?: string };
      if (!response.ok) throw new Error(result.error || "出图失败");
      const { viewingTarget, count } = await applyArtworkResult(targetProjectTitle, targetShotId, result, targetDependencyRevision);
      setToast(viewingTarget
        ? `Shot ${targetShotId} 的 ${count} 张分镜图已生成，可选择一张`
        : `Shot ${targetShotId} 的 ${count} 张分镜图已完成，点击上方 ${targetShotId} 查看`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "出图失败";
      updateReviewByShotId(targetShotId, (current) => ({
        ...current,
        artworkStatus: "error",
        summary: message,
      }));
      setToast(`Shot ${targetShotId} 出图失败：${message}`);
    }
  }

  async function acceptFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setToast("请选择 PNG、JPG 或 WebP 图片");
      return;
    }
    const dataUrl = await blobToDataUrl(file);
    await putArtworks(artworkStorageKey(projectStorageTitle, shot.id), [dataUrl]);
    setArtworkRecord({ shotId: shot.id, dataUrls: [dataUrl] });
    updateReview((current) => ({
      ...current,
      artworkStatus: "ready",
      artworkName: file.name,
      artworkNames: [file.name],
      artworkSourceRevision: artworkSourceRevisionForShot(shot.id),
      artworkDependencyRevision: buildShotUpstreamRevision({
        projectTitle: state.projectTitle,
        modelId: generationModel,
        globalSettings: state.globalSettings,
        shot: current.shot,
      }),
      selectedArtworkIndex: 0,
    }));
    setState((previous) => ({ ...previous, view: "confirm" }));
    setToast("分镜图已放入，进入确认");
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void acceptFile(file);
    event.target.value = "";
  }

  function updateArtworkPrompt(value: string) {
    updateReview((current) => ({ ...current, artworkPrompt: value }));
  }

  function restoreDefaultArtworkPrompt() {
    updateReview((current) => ({ ...current, artworkPrompt: undefined }));
    setToast("已恢复当前 Shot 的默认 Lib Image 提示词");
  }

  function selectArtworkCandidate(index: number, announce = true, scrollIntoView = false) {
    updateReview((current) => ({
      ...current,
      selectedArtworkIndex: index,
      artworkName: current.artworkNames?.[index] || current.artworkName,
    }));
    if (scrollIntoView) {
      window.requestAnimationFrame(() => {
        const target = artworkScroller.current?.querySelector<HTMLElement>(`[data-candidate-index="${index}"]`);
        target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      });
    }
    if (announce) setToast(`已选择方案 ${String.fromCharCode(65 + index)}`);
  }

  function selectArtworkOnScroll(event: UIEvent<HTMLDivElement>) {
    const scroller = event.currentTarget;
    const cards = [...scroller.querySelectorAll<HTMLElement>("[data-candidate-index]")];
    if (cards.length < 2) return;
    const viewportCenter = scroller.scrollLeft + scroller.clientWidth / 2;
    const nearest = cards.reduce((best, card, index) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distance = Math.abs(cardCenter - viewportCenter);
      return distance < best.distance ? { index, distance } : best;
    }, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
    if (nearest !== selectedArtworkIndex) selectArtworkCandidate(nearest, false);
  }

  function keepArtworkAndNext() {
    if (!artwork) {
      setToast("没有分镜图，无法保留");
      return;
    }
    setState((previous) => {
      if (previous.currentShot < previous.reviews.length - 1) {
        return { ...previous, currentShot: previous.currentShot + 1, view: "script" };
      }
      return { ...previous, view: "confirm" };
    });
    setToast(state.currentShot < state.reviews.length - 1 ? `Shot ${shot.id} 当前图片已保留，返回下一 Shot` : "当前图片已保留");
  }

  function renderTaskProgress() {
    const submission = lastBatchSubmissions[shot.id]
      || (lastSubmission?.shotId === shot.id
      ? lastSubmission
      : review.pendingSubmission?.shotId === shot.id ? review.pendingSubmission : undefined);
    const activeJob = bridge.activeJob?.type === "annotation-batch" && submission
      ? bridge.activeJob
      : bridge.activeJob?.type === "annotation" && bridge.activeJob.shotId === shot.id
      ? bridge.activeJob
      : undefined;
    const matchingLastJob = bridge.lastJob?.type === "annotation-batch" && submission
      ? bridge.lastJob
      : bridge.lastJob?.type === "annotation" && bridge.lastJob.shotId === shot.id
      ? bridge.lastJob
      : undefined;
    const job = activeJob || matchingLastJob;
    if (!submission && !job && review.scriptStatus !== "sending" && review.scriptStatus !== "error") return null;

    const failed = review.scriptStatus === "error" || job?.status === "failed";
    const succeeded = review.scriptStatus === "applied";
    const awaitingWriteback = review.scriptStatus === "sending" && job?.status === "completed";
    const recoveringResult = review.scriptStatus !== "applied" && job?.status === "completed";
    const reconciling = review.scriptStatus === "sending" && !bridge.busy && !activeJob;
    const statusLabel = failed
      ? "处理失败"
      : succeeded
        ? "修改已应用"
        : awaitingWriteback || recoveringResult
          ? "GPT 已完成，正在取回修改"
          : reconciling
            ? "正在核对任务状态"
            : "GPT 正在处理";
    const startedAt = job?.startedAt || submission?.submittedAt;
    const finishedAt = job?.finishedAt;
    const elapsed = startedAt && finishedAt
      ? Math.max(0, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000))
      : 0;
    const events = job?.events?.length ? job.events : [
      { at: submission?.submittedAt || "", stage: "received", message: "页面已收到批注，并发送给本地 GPT 助手。" },
      ...(review.scriptStatus === "sending" ? [{
        at: "",
        stage: reconciling ? "reconciling" : "waiting",
        message: reconciling ? "实时服务未发现运行中的任务，正在恢复页面状态。" : "等待 GPT 返回结构化修改结果。",
      }] : []),
    ];
    const submittedNotes = submission
      ? annotationSections.filter((section) => (submission.annotations[section.id] || "").trim())
      : [];

    return (
      <section className={`task-monitor ${failed ? "failed" : succeeded ? "succeeded" : "running"}`} aria-live="polite">
        <header>
          <div><span>{job?.type === "annotation-batch" ? `GPT TASK · 全片批改 · 当前 SHOT ${shot.id}` : `GPT TASK · SHOT ${shot.id}`}</span><h2>{statusLabel}</h2></div>
          <div className="task-runtime"><i />{finishedAt ? `${elapsed} 秒` : "实时同步"}</div>
        </header>
        <div className="task-monitor-body">
          <ol className="task-timeline">
            {events.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><b>{event.message}</b><small>{event.at ? new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false }) : "刚刚"}</small></div>
              </li>
            ))}
          </ol>
          <div className="submitted-batch">
            <span>本次收到的批注</span>
            {submittedNotes.length ? submittedNotes.map((section) => (
              <div key={section.id}><b>{section.title}</b><p>{submission?.annotations[section.id]}</p></div>
            )) : job ? <p>该任务由另一个“镜导”标签页发起；这里会同步显示处理进度。请勿重复发送。</p> : <p>本次没有文字批注，直接确认脚本。</p>}
          </div>
        </div>
        {failed ? <div className="task-error"><b>错误</b><p>{job?.error || review.summary || "GPT处理失败，请重试。"}</p></div> : null}
      </section>
    );
  }

  function renderGlobalTaskProgress() {
    const job = bridge.activeJob?.type === "global-annotation"
      ? bridge.activeJob
      : bridge.lastJob?.type === "global-annotation" ? bridge.lastJob : undefined;
    if (!lastGlobalSubmission && !job) return null;
    const failed = state.globalStatus === "error" || job?.status === "failed";
    const succeeded = state.globalStatus === "applied" && Boolean(lastGlobalSubmission);
    const events = job?.events?.length ? job.events : [{
      at: lastGlobalSubmission?.submittedAt || "",
      stage: "received",
      message: "页面已收到全局批注，并发送给本地 GPT 助手。",
    }];
    return (
      <section className={`task-monitor global-task-monitor ${failed ? "failed" : succeeded ? "succeeded" : "running"}`} aria-live="polite">
        <header>
          <div><span>GPT TASK · 全局设定</span><h2>{failed ? "处理失败" : succeeded ? "全局修改已应用" : "GPT 正在处理全局批注"}</h2></div>
          <div className="task-runtime"><i />不属于任何 Shot</div>
        </header>
        <div className="task-monitor-body">
          <ol className="task-timeline">
            {events.map((event, index) => (
              <li key={`${event.at}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{event.message}</b><small>{event.at ? new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false }) : "刚刚"}</small></div></li>
            ))}
          </ol>
          <div className="submitted-batch"><span>本次全局批注</span><p>{lastGlobalSubmission?.annotation || "该任务由另一个镜导标签页发起。"}</p></div>
        </div>
        {failed ? <div className="task-error"><b>错误</b><p>{job?.error || state.globalSummary || "全局批注处理失败，请重试。"}</p></div> : null}
      </section>
    );
  }

  function renderCoveragePage() {
    const visibleUnits = coverageFilter === "all"
      ? coverageReport.units
      : coverageReport.units.filter((unit) => unit.status === coverageFilter);
    const statusLabel: Record<CoverageStatus, string> = {
      covered: "已覆盖",
      duplicate: "重复引用",
      missing: "未覆盖",
    };
    return (
      <section className="coverage-page">
        <div className="coverage-heading">
          <div>
            <span>SCRIPT TRACE · SOURCE COVERAGE</span>
            <h1>脚本体检</h1>
            <p>逐条核对原文有没有进入 Shot；导演新增设计和原始依据分开保存。</p>
          </div>
          <button className="button secondary" type="button" onClick={returnToShots}>返回镜头审核</button>
        </div>

        <section className="coverage-summary-card">
          <div className="coverage-score"><strong>{coverageReport.coveragePercent}%</strong><span>原文覆盖率</span></div>
          <div className="coverage-meter"><i style={{ width: `${coverageReport.coveragePercent}%` }} /></div>
          <dl>
            <div><dt>原文条目</dt><dd>{coverageReport.units.length}</dd></div>
            <div><dt>已进入镜头</dt><dd>{coverageReport.coveredUnits}</dd></div>
            <div><dt>未覆盖</dt><dd>{coverageReport.missingUnits}</dd></div>
            <div><dt>重复引用</dt><dd>{coverageReport.duplicateUnits}</dd></div>
          </dl>
          <p><b>依据来源：</b>{state.sourceName || "未命名来源"}</p>
        </section>

        <section className="director-recipes-panel">
          <div className="coverage-section-heading">
            <span>DIRECTOR RECIPES</span>
            <h2>导演配方</h2>
            <p>配方会随批注一起交给 GPT，只影响拆解与优化方法，不会自动审批或改变最终美术风格。</p>
          </div>
          <div className="director-recipe-grid">
            {directorRecipes.map((recipe) => (
              <button
                key={recipe.id}
                type="button"
                className={selectedRecipe.id === recipe.id ? "active" : ""}
                onClick={() => selectRecipe(recipe.id)}
              >
                <span>{recipe.shortName}</span>
                <b>{recipe.name}</b>
                <small>{recipe.summary}</small>
              </button>
            ))}
          </div>
          <div className="active-recipe-rules">
            <b>当前：{selectedRecipe.name}</b>
            <ol>{selectedRecipe.rules.map((rule) => <li key={rule}>{rule}</li>)}</ol>
          </div>
        </section>

        <section className="coverage-ledger">
          <div className="coverage-section-heading">
            <span>SOURCE LEDGER</span>
            <h2>原文覆盖账本</h2>
            <p>“重复引用”不一定是错误，但需要确认是否为有意的多镜拆分。</p>
          </div>
          <div className="coverage-filters" role="group" aria-label="原文覆盖筛选">
            {(["all", "missing", "duplicate", "covered"] as const).map((filter) => (
              <button key={filter} type="button" className={coverageFilter === filter ? "active" : ""} onClick={() => setCoverageFilter(filter)}>
                {filter === "all" ? `全部 ${coverageReport.units.length}` : `${statusLabel[filter]} ${coverageReport.units.filter((unit) => unit.status === filter).length}`}
              </button>
            ))}
          </div>
          <ol className="coverage-unit-list">
            {visibleUnits.map((unit) => (
              <li key={`${unit.index}-${unit.text.slice(0, 24)}`} className={`is-${unit.status}`}>
                <span className="coverage-unit-index">{String(unit.index).padStart(3, "0")}</span>
                <p>{unit.text}</p>
                <div>
                  <b>{statusLabel[unit.status]}</b>
                  {unit.shotIds.map((shotId) => <button key={shotId} type="button" onClick={() => openShotFromCoverage(shotId)}>SHOT {shotId}</button>)}
                </div>
              </li>
            ))}
          </ol>
          {!visibleUnits.length ? <p className="coverage-empty">当前筛选下没有条目。</p> : null}
        </section>
      </section>
    );
  }

  function renderAssetLedgerPage() {
    const statusLabel: Record<VideoPackageStatus, string> = {
      blocked: "被脚本或模型规则阻塞",
      running: "素材生成中",
      stale: "上游已修改，待同步",
      warning: "可用但参考不完整",
      ready: "视频生成包就绪",
    };
    const filterPackages = videoPackages.filter((item) => {
      if (assetFilter === "all") return true;
      if (assetFilter === "ready") return item.status === "ready";
      if (assetFilter === "running") return item.status === "running";
      return item.status === "blocked" || item.status === "stale" || item.status === "warning";
    });
    const targetPackage = selectedAssetPackage;
    const targetReview = selectedAssetReview;
    if (!targetPackage || !targetReview) return null;
    const targetArtworkUrls = assetPreviewRecord.shotId === targetPackage.shotId ? assetPreviewRecord.dataUrls : [];
    const targetArtworkIndex = Math.min(Math.max(0, targetReview.selectedArtworkIndex || 0), Math.max(0, targetArtworkUrls.length - 1));
    const targetArtwork = targetArtworkUrls[targetArtworkIndex];
    const synced = targetReview.videoPackageSyncedAt
      ? new Date(targetReview.videoPackageSyncedAt).toLocaleString("zh-CN", { hour12: false })
      : "自动编译中";

    return (
      <section className="asset-ledger-page">
        <div className="asset-ledger-heading">
          <div>
            <span>PROJECT ASSETS · VIDEO PACKAGE</span>
            <h1>资产同步</h1>
            <p>把脚本、TOP VIEW、3D白模、临时分镜图和视频提示词锁到同一个 Shot；上游修改后，旧提示词会明确标记失效。</p>
          </div>
          <button className="button secondary" type="button" onClick={returnToShots}>返回镜头审核</button>
        </div>

        <section className="asset-ledger-summary">
          <div><strong>{state.reviews.length}</strong><span>Shot 总数</span></div>
          <div><strong>{state.reviews.filter((item) => item.approved).length}</strong><span>脚本已盖章</span></div>
          <div><strong>{state.reviews.reduce((total, item) => total + Object.keys(item.whiteboxReferences || {}).length, 0)}</strong><span>已锁定白模</span></div>
          <div><strong>{state.reviews.filter((item) => Boolean(item.artworkNames?.length || item.artworkName)).length}</strong><span>已有分镜图</span></div>
          <div className="ready"><strong>{assetReadyCount}</strong><span>生成包就绪</span></div>
          <div className={assetAttentionCount ? "attention" : "ready"}><strong>{assetAttentionCount}</strong><span>需要处理</span></div>
        </section>

        <div className="asset-ledger-layout">
          <section className="asset-shot-ledger">
            <div className="asset-ledger-toolbar">
              <div><span>SHOT LEDGER</span><h2>逐镜资产账本</h2></div>
              <div className="asset-ledger-filters" role="group" aria-label="资产状态筛选">
                {(["all", "attention", "ready", "running"] as const).map((filter) => {
                  const count = filter === "all" ? videoPackages.length
                    : filter === "attention" ? assetAttentionCount
                    : filter === "ready" ? assetReadyCount : assetRunningCount;
                  return <button key={filter} type="button" className={assetFilter === filter ? "active" : ""} onClick={() => setAssetFilter(filter)}>
                    {filter === "all" ? "全部" : filter === "attention" ? "待处理" : filter === "ready" ? "就绪" : "生成中"} {count}
                  </button>;
                })}
              </div>
            </div>
            <div className="asset-shot-list">
              {filterPackages.map((item) => (
                <button
                  type="button"
                  key={item.packageId}
                  className={`asset-shot-row status-${item.status} ${item.shotId === targetPackage.shotId ? "selected" : ""}`}
                  onClick={() => setAssetSelectedShotId(item.shotId)}
                >
                  <span className="asset-shot-number">{item.shotId}</span>
                  <span className="asset-shot-copy"><b>{item.title}</b><small>{item.timecode} · {item.duration}秒</small></span>
                  <span className="asset-shot-chips">
                    <i className={item.dependencies[1].status === "ready" ? "ready" : "missing"}>布局 {item.assets.layoutViews.length}</i>
                    <i className={item.dependencies[2].status === "ready" ? "ready" : "missing"}>白模 {item.assets.whiteboxReferences.length}</i>
                    <i className={item.dependencies[3].status === "ready" ? "ready" : item.dependencies[3].status}>分镜 {item.assets.artworkCandidates.length}</i>
                  </span>
                  <span className="asset-shot-status">{statusLabel[item.status]}</span>
                </button>
              ))}
              {!filterPackages.length ? <p className="asset-ledger-empty">当前筛选下没有 Shot。</p> : null}
            </div>
          </section>

          <section className={`video-package-panel status-${targetPackage.status}`}>
            <header className="video-package-heading">
              <div><span>VIDEO PACKAGE · SHOT {targetPackage.shotId}</span><h2>{targetPackage.title}</h2><p>{targetPackage.packageId} · {targetPackage.sourceRevision}</p></div>
              <b>{statusLabel[targetPackage.status]}</b>
            </header>

            <div className="video-package-dependencies">
              {targetPackage.dependencies.map((dependency) => (
                <article key={dependency.id} className={`dependency-${dependency.status}`}>
                  <span>{dependency.label}</span><b>{dependency.status === "ready" ? "已同步" : dependency.status === "running" ? "生成中" : dependency.status === "stale" ? "已失效" : dependency.status === "blocked" ? "被阻塞" : "待补充"}</b><small>{dependency.detail}</small>
                </article>
              ))}
            </div>

            <div className="video-package-assets">
              <article className="asset-preview-card">
                <div><span>SELECTED STORYBOARD</span><b>当前分镜参考图</b></div>
                <div className="asset-preview-frame">{targetArtwork ? <img src={targetArtwork} alt={`Shot ${targetPackage.shotId} 已选临时分镜图`} /> : <ArtworkPlaceholder shotId={targetPackage.shotId} />}</div>
                <small>{targetPackage.assets.selectedArtwork || "尚未选图"} · 只锁定剧情、构图、站位与动作</small>
                <button type="button" className="text-button" onClick={() => openShotFromAssets(targetPackage.shotId, "artwork")}>进入本镜出图页</button>
              </article>
              <article className="asset-reference-card">
                <div><span>DIRECTOR REFERENCES</span><b>导演结构参考</b></div>
                <dl>
                  <div><dt>TOP VIEW</dt><dd>{targetPackage.assets.layoutViews.join("、") || "未配置"}</dd></div>
                  <div><dt>3D白模</dt><dd>{targetPackage.assets.whiteboxReferences.map((item) => item.key).join("、") || "未锁定"}</dd></div>
                  <div><dt>全能参考</dt><dd>{targetPackage.assets.omniReferences.length}/{referenceLimitFor(generationModel)}</dd></div>
                  <div><dt>同步时间</dt><dd>{synced}</dd></div>
                </dl>
                <button type="button" className="text-button" onClick={() => openShotFromAssets(targetPackage.shotId, "script")}>打开脚本与DIRECTOR VIEW</button>
              </article>
            </div>

            {targetPackage.warnings.length ? <div className="video-package-warnings"><b>同步检查</b><ul>{targetPackage.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}

            <label className={`video-prompt-editor ${targetPackage.promptMode === "custom" ? "custom" : "automatic"}`}>
              <span><b>Seedance 视频提示词</b><small>{targetPackage.promptMode === "custom" ? "自定义版本；上游变化会标记失效" : "由脚本、布局、白模和已选分镜图自动编译"}</small></span>
              <textarea rows={24} value={targetPackage.prompt} onChange={(event) => updateVideoPrompt(targetPackage.shotId, event.target.value, targetPackage.sourceRevision)} />
              <em>{targetPackage.prompt.length} 字符 · 与 Lib Image 生图提示词分开</em>
            </label>

            <div className="video-package-actions">
              <button className="button secondary" type="button" onClick={() => restoreAutomaticVideoPrompt(targetPackage)}>按最新导演数据重编译</button>
              <button className="button secondary" type="button" onClick={() => void copyVideoPrompt(targetPackage)}>复制视频提示词</button>
              <button className="button secondary" type="button" onClick={() => downloadVideoPackage(targetPackage)}>下载生成包 JSON</button>
              <button className="button primary" type="button" disabled={targetPackage.status === "blocked" || targetPackage.status === "running"} onClick={() => confirmVideoPackageSync(targetPackage)}>确认同步当前版本</button>
            </div>
          </section>
        </div>
      </section>
    );
  }

  function renderGlobalSettingsPage() {
    const locked = savingGlobalSettings || globalBusy;
    return (
      <section className="global-settings-page">
        <div className="global-page-heading">
          <div><span>PROJECT LEVEL · NOT A SHOT</span><h1>全局设定</h1><p>这里只维护整部脚本共用的规则。它不占 Shot 编号，不进入单镜批注计数，也不代替逐镜签字盖章。</p></div>
          <button className="button secondary" type="button" onClick={returnToShots}>返回镜头审核</button>
        </div>
        {renderGlobalTaskProgress()}
        <fieldset className="global-settings-fields" disabled={locked} aria-busy={locked}>
          <section className="global-setting-card project-background-canon">
            <div className="global-setting-heading"><span>00 · WORLD</span><h2>项目故事背景</h2><p>整套漫画只写一次。它负责时代、世界观和改编边界；每格漫画仍是剧情、台词、动作和站位的最高证据。</p></div>
            <TextField label="故事背景／世界观" value={state.globalSettings.storyBackground} rows={9} onChange={(value) => updateGlobalString("storyBackground", value)} />
          </section>
          <section className="global-setting-card character-canon">
            <div className="global-setting-heading"><span>01 · CHARACTERS</span><h2>人物全局设定</h2><p>身份、发型、服装、表演边界和露脸限制只在这里定义一次。</p></div>
            <TextField label="人物设定（每行一条）" value={lines(state.globalSettings.characters)} rows={10} onChange={(value) => updateGlobalArray("characters", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>02 · PROPS</span><h2>关键物品</h2><p>维护跨镜道具的唯一性、外观、比例和状态时间线。</p></div>
            <TextField label="关键物品规则（每行一条）" value={lines(state.globalSettings.props)} rows={9} onChange={(value) => updateGlobalArray("props", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>03 · LOCATIONS</span><h2>地点与时代</h2><p>防止新宿站、ALTA、歌舞伎町牌楼和餐厅空间混在一起。</p></div>
            <TextField label="地点与时代规则（每行一条）" value={lines(state.globalSettings.locations)} rows={8} onChange={(value) => updateGlobalArray("locations", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>04 · TIMELINE</span><h2>剧情日期与时间线</h2><p>失踪当晚、次日新闻和姐姐委托分开记录。</p></div>
            <TextField label="全片时间线（每行一条）" value={lines(state.globalSettings.timeline)} rows={8} onChange={(value) => updateGlobalArray("timeline", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>05 · CONTINUITY</span><h2>连续性硬锁</h2><p>所有相关镜头都必须服从的空间、身份与状态规则。</p></div>
            <TextField label="连续性规则（每行一条）" value={lines(state.globalSettings.continuity)} rows={9} onChange={(value) => updateGlobalArray("continuity", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>06 · STYLE</span><h2>美术风格分层</h2><p>最终视频与临时分镜图严格分开，互不反推。</p></div>
            <TextField label="最终视频美术风格" value={state.globalSettings.finalVideoStyle} rows={6} onChange={(value) => updateGlobalString("finalVideoStyle", value)} />
            <TextField label="Lib Image 临时分镜图风格" value={state.globalSettings.storyboardImageStyle} rows={6} onChange={(value) => updateGlobalString("storyboardImageStyle", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>07 · MODEL</span><h2>生成模型规范</h2><p>时长、全能参考上限与动作最小时长。</p></div>
            <TextField label="模型规范（每行一条）" value={lines(state.globalSettings.modelRules)} rows={8} onChange={(value) => updateGlobalArray("modelRules", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>08 · NEGATIVE</span><h2>全局禁止项</h2><p>任何镜头都不能违反的禁令。</p></div>
            <TextField label="全局禁止项（每行一条）" value={lines(state.globalSettings.negative)} rows={8} onChange={(value) => updateGlobalArray("negative", value)} />
          </section>
        </fieldset>

        <section className="global-annotation-panel">
          <div className="global-annotation-copy"><span>独立通道 · 不与单镜批注混合</span><h2>全局批注</h2><p>人物、道具、车辆、地点、时代或美术等通用问题只写一次，并同步到引用这些资产的镜头。</p></div>
          <textarea
            aria-label="全局批注"
            rows={6}
            disabled={locked}
            value={state.globalAnnotation}
            placeholder="例如：主角的发型、服装和露脸限制固定；同一关键道具跨镜保持唯一外观，并严格按照时间线出现。"
            onChange={(event) => updateGlobalAnnotation(event.target.value)}
          />
          <div className="global-annotation-actions">
            <button className="button secondary" type="button" disabled={locked || bridge.busy || !bridge.connected} onClick={() => void saveGlobalSettings()}>{savingGlobalSettings ? "正在回写源文件…" : "保存全局设定"}</button>
            <button className="button primary" type="button" disabled={locked || bridge.busy || !bridge.connected || !state.globalAnnotation.trim()} onClick={() => void sendGlobalAnnotation()}>{globalBusy ? "全局批注处理中…" : "发送全局批注"}</button>
          </div>
          <div className={`global-setting-status ${state.globalStatus}`}><i /><b>{state.globalStatus === "sending" ? "GPT正在处理全局批注" : state.globalStatus === "error" ? "全局设定处理失败" : state.globalStatus === "draft" ? "全局设定有未保存修改" : "全局设定已写入源文件"}</b><small>{state.globalSummary || "所有Shot将读取已生效的全局规则。"}</small></div>
        </section>
      </section>
    );
  }

  function renderScript() {
    const assetKindOrder: ShotAssetKind[] = ["character", "scene", "prop"];
    const assetKindLabels: Record<ShotAssetKind, { eyebrow: string; title: string; empty: string }> = {
      character: { eyebrow: "CHARACTERS", title: "人物", empty: "本镜没有出镜人物" },
      scene: { eyebrow: "LOCATION", title: "场景", empty: "本镜尚未填写场景" },
      prop: { eyebrow: "KEY PROPS", title: "关键道具", empty: "本镜无关键道具" },
    };
    return (
      <section className="script-sheet">
        <div className="sheet-heading">
          <div><span>STEP 01 · SCRIPT</span><h1>脚本</h1><p>人物、物品和场景、剧情、动作、连续、美术风格写在同一页；批注最后统一发送。</p></div>
          <div className={`bridge-status ${bridge.connected ? "online" : ""}`}><i />{bridge.connected ? "GPT直连已连接" : "GPT直连未启动"}</div>
        </div>

        <MangaPanelStrip requestId={mangaSourceRequestId} panelIds={shot.sourcePanels || []} pairingToken={bridge.pairingToken} />

        <section className="shot-asset-board" aria-label={`Shot ${shot.id} 人物、场景与关键道具资产`}>
          <header className="shot-asset-heading">
            <div><span>SHOT ASSETS · SHOT {shot.id}</span><h2>本镜资产</h2><p>按镜头自动整理人物、场景和关键道具。每项可用 LibTV CLI、GPT Image 生图，或上传已有参考图；同名资产会跨 Shot 复用。</p></div>
            <small>默认全部纳入全能参考 · 你可逐项取消 · 取消后刷新也不会自动加回</small>
          </header>
          <div className="shot-asset-groups">
            {assetKindOrder.map((kind) => {
              const groupAssets = shotAssets.filter((asset) => asset.kind === kind);
              const labels = assetKindLabels[kind];
              return (
                <section className={`shot-asset-group kind-${kind}`} key={kind}>
                  <div className="shot-asset-group-title"><span>{labels.eyebrow}</span><b>{labels.title}</b><em>{groupAssets.length}</em></div>
                  {groupAssets.length ? <div className="shot-asset-cards">{groupAssets.map((asset) => {
                    const assetKey = shotAssetStorageKey(projectStorageTitle, asset);
                    const images = shotAssetImages[assetKey] || [];
                    const settings = shotAssetImageSettings[assetKey] || defaultShotAssetImageSettings(asset);
                    const availableRatios = assetImageRatiosFor(settings.model);
                    const availableResolutions = assetImageResolutionsFor(settings.model);
                    const remoteAssetJob = bridge.assetJobs?.find((job) => job.shotId === shot.id
                      && job.assetId === asset.id
                      && (!job.projectTitle || job.projectTitle === projectStorageTitle));
                    const generating = Boolean(generatingShotAssetKeys[assetKey] || remoteAssetJob);
                    const referenced = shot.omniReferences.some((reference) => isShotAssetReference(reference, asset));
                    const analyzedAssetPrompt = projectAssetPromptFor(state.assetPrompts, asset);
                    const promptValue = resolvedShotAssetPrompt(asset);
                    return (
                      <article className={`shot-asset-card ${images.length ? "is-ready" : "is-empty"}`} key={asset.id}>
                        <div className="shot-asset-card-head">
                          <div><span>{labels.title}</span><h3>{asset.name}</h3></div>
                          <b>{generating ? "生成中" : images.length ? `已有 ${images.length} 张` : "待准备"}</b>
                        </div>
                        <label className={`shot-asset-reference-toggle ${referenced ? "is-on" : ""}`}>
                          <input type="checkbox" checked={referenced} onChange={(event) => toggleShotAssetReference(asset, event.target.checked)} />
                          <span>{referenced ? "已纳入全能参考" : "未纳入全能参考"}</span>
                        </label>
                        <div className={`shot-asset-preview kind-${kind} ${images.length ? "has-image" : "is-placeholder"}`}>
                          {images.length ? (
                            <div className="shot-asset-image-track">
                              {images.map((dataUrl, index) => <img key={`${assetKey}-${index}`} src={dataUrl} alt={`${asset.name} 资产候选 ${index + 1}`} />)}
                            </div>
                          ) : <div className="shot-asset-empty-preview"><i>{kind === "character" ? "人" : kind === "scene" ? "景" : "物"}</i><span>{generating ? "资产图正在生成…" : "空框占位，等待生图或上传"}</span></div>}
                        </div>
                        <div className="shot-asset-settings">
                          <label><span>LibTV 模型</span><select
                            value={settings.model}
                            onChange={(event) => {
                              const model = event.target.value as AssetImageModel;
                              const nextRatios = assetImageRatiosFor(model);
                              const nextResolutions = assetImageResolutionsFor(model);
                              setShotAssetImageSettings((current) => ({
                                ...current,
                                [assetKey]: {
                                  model,
                                  ratio: nextRatios.includes(settings.ratio) ? settings.ratio : "16:9",
                                  resolution: nextResolutions.includes(settings.resolution) ? settings.resolution : "2K",
                                },
                              }));
                            }}
                          >{assetImageModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
                          <label><span>画幅</span><select value={settings.ratio} onChange={(event) => setShotAssetImageSettings((current) => ({ ...current, [assetKey]: { ...settings, ratio: event.target.value as AssetImageRatio } }))}>{availableRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select></label>
                          <label><span>尺寸</span><select value={settings.resolution} onChange={(event) => setShotAssetImageSettings((current) => ({ ...current, [assetKey]: { ...settings, resolution: event.target.value as AssetImageResolution } }))}>{availableResolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}</select></label>
                        </div>
                        <details className="shot-asset-prompt" open>
                          <summary>生图提示词 · 已自动生成，可直接修改</summary>
                          {analyzedAssetPrompt?.sourceObservation.trim() ? <p className="shot-asset-source-observation"><b>漫画外观观察</b>{analyzedAssetPrompt.sourceObservation}</p> : null}
                          <textarea
                            aria-label={`${asset.name} 生图提示词`}
                            rows={10}
                            value={promptValue}
                            onChange={(event) => updateShotAssetPrompt(asset, event.target.value)}
                          />
                        </details>
                        <div className="shot-asset-actions">
                          <button type="button" className="button secondary" disabled={generating || !bridge.connected || !libtvReady} onClick={() => void generateShotAsset(asset, "libtv")}>
                            {generating ? "生成中…" : "LibTV CLI 生图"}
                          </button>
                          <button type="button" className="button secondary" disabled={generating || !bridge.connected} onClick={() => void generateShotAsset(asset, "gpt")}>
                            {generating ? "生成中…" : "GPT Image 生图"}
                          </button>
                          <label className="button secondary shot-asset-upload">
                            手动上传
                            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onShotAssetFile(asset, event)} />
                          </label>
                        </div>
                      </article>
                    );
                  })}</div> : <p className="shot-asset-group-empty">{labels.empty}</p>}
                </section>
              );
            })}
          </div>
        </section>

        <fieldset className="script-fields" disabled={scriptLocked} aria-busy={scriptLocked}>
        <ScriptBlock section={sections[0]} annotation={review.annotations.characters} onAnnotation={(value) => updateAnnotation("characters", value)}>
          <TextField label="出镜人物（每行一人）" value={lines(shot.characters)} rows={5} onChange={(value) => updateField("characters", splitLines(value))} />
        </ScriptBlock>

        <ScriptBlock section={sections[1]} annotation={review.annotations.scene} onAnnotation={(value) => updateAnnotation("scene", value)}>
          <div className="sheet-grid">
            <TextField label="关键物品（车辆也算物品，每行一件）" value={lines(shot.props)} rows={5} onChange={(value) => updateField("props", splitLines(value))} />
            <TextField label="场景" value={shot.scene} rows={4} onChange={(value) => updateField("scene", value)} />
            <TextField label="人物站位、朝向与构图" value={shot.composition} rows={6} onChange={(value) => updateField("composition", value)} />
          </div>
          <div className={`reference-budget ${referencesOverLimit ? "over-limit" : ""}`}>
            <div className="reference-budget-heading">
              <div><span>SEEDANCE · OMNI REFERENCES</span><h3>全能参考清单</h3><p>只列必须锁定外观的角色、车辆、招牌、独特场景和连续道具；普通物品不占参考位。</p></div>
              <strong>{referenceCount} / {referenceLimit}</strong>
            </div>
            <div className="reference-meter" aria-label={`已使用 ${referenceCount} 个，共 ${referenceLimit} 个参考位`}><i style={{ width: `${Math.min(100, (referenceCount / referenceLimit) * 100)}%` }} /></div>
            <textarea
              rows={Math.min(10, Math.max(5, referenceCount + 1))}
              value={lines(shot.omniReferences)}
              placeholder="每行一个全能参考，例如：主角角色参考、关键车辆、核心地点"
              onChange={(event) => updateOmniReferences(event.target.value)}
            />
            <small>当前模型：{generationModels.find((item) => item.id === generationModel)?.label} · 硬上限 {referenceLimit} 个</small>
          </div>
        </ScriptBlock>

        <ScriptBlock section={sections[2]} annotation={review.annotations.story} onAnnotation={(value) => updateAnnotation("story", value)}>
          <TextField label={`Shot ${shot.id} 剧情`} value={shot.story} rows={6} onChange={(value) => updateField("story", value)} />
          <TextField label="对白 / 声音（每行一条）" value={lines(shot.dialogue)} rows={4} onChange={(value) => updateField("dialogue", splitLines(value))} />
          {shot.sourcePanels?.length ? (
            <div className="source-panel-trace">
              <span>MANGA SOURCE PANELS</span>
              <div>{shot.sourcePanels.map((panelId) => <b key={panelId}>{panelId}</b>)}</div>
              <small>来源格会随本镜批注和全片批改保留；只有重新执行漫画分格映射时才改变。</small>
            </div>
          ) : null}
          <div className="source-evidence-field">
            <div className="source-evidence-heading">
              <div><span>SOURCE TRACE</span><b>原文依据</b><small>这里只放脚本原句；导演改写仍写在上面的剧情和动作里。</small></div>
              <button type="button" onClick={openCoverageReview}>查看全片覆盖率 {coverageReport.coveragePercent}%</button>
            </div>
            <textarea
              rows={Math.min(8, Math.max(4, sourceTextForShot(shot).length + 1))}
              value={lines(sourceTextForShot(shot))}
              placeholder="每行一条对应原文。没有原文依据时留空，并到“脚本体检”查看未覆盖内容。"
              onChange={(event) => updateField("sourceText", splitLines(event.target.value))}
            />
            <small>当前 Shot 对应 {coverageReport.units.filter((unit) => unit.shotIds.includes(shot.id)).length} 条原文；依据来源：{state.sourceName}</small>
          </div>
        </ScriptBlock>

        <ScriptBlock section={sections[3]} annotation={review.annotations.action} onAnnotation={(value) => updateAnnotation("action", value)}>
          <div className="sheet-grid">
            <TextField label="机位 / 景别 / 运动" value={shot.camera} rows={5} onChange={(value) => updateField("camera", value)} />
            <TextField label="完整动作链" value={shot.action} rows={6} onChange={(value) => updateField("action", value)} />
          </div>
          {shot.segments.length ? (
            <div className="segment-list">
              {shot.segments.map((segment, index) => (
                <div className="segment-row" key={segment.label}>
                  <b>{segment.label}</b>
                  <textarea rows={3} value={segment.beat} onChange={(event) => updateSegment(index, { beat: event.target.value })} />
                  <textarea rows={3} value={segment.framing} onChange={(event) => updateSegment(index, { framing: event.target.value })} />
                  <textarea rows={3} value={lines(segment.mustShow)} onChange={(event) => updateSegment(index, { mustShow: splitLines(event.target.value) })} />
                </div>
              ))}
            </div>
          ) : null}
        </ScriptBlock>

        <ScriptBlock section={sections[4]} annotation={review.annotations.continuity} onAnnotation={(value) => updateAnnotation("continuity", value)}>
          <div className="sheet-grid">
            <TextField label="连续性硬锁（每行一条）" value={lines(shot.continuity)} rows={7} onChange={(value) => updateField("continuity", splitLines(value))} />
            <TextField label="禁止项（每行一条）" value={lines(shot.negative)} rows={7} onChange={(value) => updateField("negative", splitLines(value))} />
          </div>
        </ScriptBlock>

        <ScriptBlock section={sections[5]} annotation={review.annotations.style} onAnnotation={(value) => updateAnnotation("style", value)}>
          <TextField label="最终视频美术风格（默认从脚本源文件提取）" value={shot.artStyle} rows={6} onChange={(value) => updateField("artStyle", value)} />
          <p className="field-help">这里严格记录脚本中的最终视频风格；Lib Image 的赛璐璐分镜只是人物参考未上传时的临时工作图，两者互不覆盖。</p>
        </ScriptBlock>
        </fieldset>

        <div className="send-panel">
          <div><span>全片统一提交 · {selectedRecipe.name}</span><h2>{batchShotCount ? `${batchShotCount} 个 Shot · 共 ${batchNoteCount} 类批注等待上传` : "全片没有待上传批注"}</h2><p>一次上传全片所有已写批注；GPT按当前导演配方统一修改并反推源文件，但不会自动审批任何 Shot。</p></div>
          <div className="send-panel-actions">
            <button className="button primary" disabled={!batchShotCount || bridge.busy || Boolean(stampingShotId) || !bridge.connected} onClick={() => void sendAllAnnotations()}>
              {annotationBusy ? "全片批注处理中…" : bridge.busy ? "等待当前 GPT 任务…" : batchShotCount ? `批改一键上传（${batchShotCount} Shot）` : "没有待上传批注"}
            </button>
            <button className={`button approval-stamp ${review.approved ? "stamped" : ""}`} disabled={review.approved || scriptLocked || Boolean(stampingShotId) || noteCount > 0 || bridge.busy} onClick={() => void stampCurrentShot()}>
              {review.approved
                ? "✓ 已签字盖章 · 审批通过"
                : stampingShotId === shot.id
                  ? "正在回写并盖章…"
                  : noteCount > 0
                    ? `先上传本镜 ${noteCount} 类批注`
                    : review.scriptStatus === "sending"
                      ? "批注处理中，完成后可盖章"
                      : "签字盖章 · 审批通过"}
            </button>
            {noteCount > 0 ? <small className="approval-lock-reason">当前 Shot 仍有 {noteCount} 类未上传批注；点击上方“批改一键上传”，应用完成后才能盖章。</small> : null}
          </div>
        </div>
        {review.versions.length || review.approvedAt ? (
          <details className="revision-history" open={review.versions.length > 0}>
            <summary><span>VERSION TRACE</span><b>批改与审批记录</b><small>{review.versions.length} 次批改 · {review.approved ? "已盖章" : "未盖章"}</small></summary>
            <ol>
              {review.versions.map((version) => {
                const changed = version.previousShot ? changedShotFields(version.previousShot, version.shot) : [];
                const annotationCount = version.annotations
                  ? Object.values(version.annotations).filter((value) => String(value || "").trim()).length
                  : 0;
                return (
                  <li key={`${version.version}-${version.createdAt}`}>
                    <div><b>V{version.version}</b><time>{new Date(version.createdAt).toLocaleString("zh-CN")}</time></div>
                    <p>{version.summary}</p>
                    <small>导演配方：{getDirectorRecipe(version.recipeId).name} · 收到 {annotationCount} 类批注</small>
                    <span>{changed.length ? `修改字段：${changed.join("、")}` : "旧版本未记录字段差异"}</span>
                  </li>
                );
              })}
              {review.approvedAt ? <li className="approval-event"><div><b>审批盖章</b><time>{new Date(review.approvedAt).toLocaleString("zh-CN")}</time></div><p>当前版本已签字盖章，审批通过。</p></li> : null}
            </ol>
          </details>
        ) : null}
        {review.scriptStatus === "error" && !lastSubmission ? <div className="inline-error">{review.summary}</div> : null}
      </section>
    );
  }

  function renderArtwork() {
    return (
      <section className="stage-page">
        <div className="stage-page-heading"><span>STEP 02 · ARTWORK</span><h1>出图</h1><p>只有已签字盖章的 Shot 才能出图；生成在后台运行，不会改变审批状态。</p></div>
        <div className="artwork-stage">
          <div className="artwork-frame">
            {artworkCandidates.length ? (
              <div className="artwork-carousel">
                <div ref={artworkScroller} className={`artwork-candidates ${artworkCandidates.length === 1 ? "single" : ""}`} onScroll={selectArtworkOnScroll}>
                  {artworkCandidates.map((candidate, index) => (
                    <button
                      type="button"
                      data-candidate-index={index}
                      className={selectedArtworkIndex === index ? "selected" : ""}
                      key={`${review.artworkNames?.[index] || "artwork"}-${index}`}
                      onClick={() => selectArtworkCandidate(index)}
                    >
                      <img src={candidate} alt={`Shot ${shot.id} 分镜方案 ${String.fromCharCode(65 + index)}`} />
                      <span>方案 {String.fromCharCode(65 + index)}{selectedArtworkIndex === index ? " · 已选择" : ""}</span>
                    </button>
                  ))}
                </div>
                <div className="candidate-selection">
                  <b>已选择方案 {String.fromCharCode(65 + selectedArtworkIndex)}</b>
                  <div>
                    {artworkCandidates.map((_, index) => (
                      <button
                        type="button"
                        aria-label={`选择方案 ${String.fromCharCode(65 + index)}`}
                        className={selectedArtworkIndex === index ? "selected" : ""}
                        key={`dot-${index}`}
                        onClick={() => selectArtworkCandidate(index, true, true)}
                      />
                    ))}
                  </div>
                  <small>{artworkCandidates.length > 1 ? "左右滑动切换，停在哪张就自动选中哪张" : "当前只有 1 张历史图片；重新生成后会出现 A/B 两张"}</small>
                </div>
              </div>
            ) : <ArtworkPlaceholder shotId={shot.id} generating={review.artworkStatus === "generating" || Boolean(artworkJob)} />}
          </div>
          <div className="artwork-command">
            <span>当前只生成 SHOT {shot.id} · Lib Image · 16:9 · 2K · 中画质 · 2 张</span>
            <h2>{shot.title}</h2>
            <p>{shot.story}</p>
            <div className={`prompt-editor ${artworkPromptEdited ? "edited" : "default"}`}>
              <span>
                <b>LIB IMAGE 提示词</b>
                <small>{artworkPromptEdited ? "已修改 · 实际按这里出图" : "默认值 · 可直接修改"}</small>
                <button type="button" disabled={!artworkPromptEdited} onClick={restoreDefaultArtworkPrompt}>恢复默认</button>
              </span>
              <textarea
                aria-label="Lib Image 提示词"
                rows={18}
                value={artworkPrompt}
                placeholder="请输入 Lib Image 生图提示词"
                onChange={(event) => updateArtworkPrompt(event.target.value)}
              />
              <em>{artworkPrompt.trim().length} 字符 · 两张候选图共用此提示词</em>
            </div>
            <div className={`whitebox-reference-status ${whiteboxReferenceCount ? "ready" : "optional"}`}>
              <div>
                <b>{whiteboxReferenceCount ? `已锁定 ${whiteboxReferenceCount} 张纯净3D白模结构参考` : "尚未锁定3D白模结构参考"}</b>
                <small>{whiteboxReferenceCount
                  ? `${Object.keys(review.whiteboxReferences || {}).join("、")} 会通过 LibTV CLI 连到本次 Lib Image 节点；只约束透视、站位、朝向、尺度和动作重心。`
                  : "可以直接出图；若镜头空间、人物朝向或复杂动作容易跑偏，建议先在 DIRECTOR VIEW 锁定白模。"}</small>
              </div>
              <button type="button" className="button secondary" onClick={() => { setDirectorVisualMode("whitebox"); setView("script"); }}>查看并锁定白模</button>
            </div>
            <div className={`libtv-status ${libtvReady ? "ready" : "blocked"}`}>
              <div>
                <b>{artworkJob?.message || (libtvReady ? `LibTV 已连接${bridge.libtv?.accountName ? ` · ${bridge.libtv.accountName}` : ""}` : bridge.libtv?.message || "正在检查 LibTV")}</b>
                <small>{artworkJob ? "后台任务真实运行中；完成后自动回填两张候选图" : libtvReady ? "预计约 60 秒；出图期间可继续审核下一 Shot" : "登录完成前不会提交或计费"}</small>
              </div>
              {!libtvReady ? (
                <button className="button secondary" type="button" disabled={loggingIntoLibtv || bridge.libtv?.status === "checking" || !bridge.connected} onClick={() => void loginLibtv()}>
                  {loggingIntoLibtv || bridge.libtv?.status === "logging_in" ? "等待登录完成…" : bridge.libtv?.status === "missing" ? "CLI 未安装" : "登录 LibTV"}
                </button>
              ) : null}
            </div>
            <button className="button primary" disabled={review.scriptStatus !== "applied" || !review.approved || !artworkPrompt.trim() || referencesOverLimit || durationOutOfRange || !bridge.connected || !libtvReady || review.artworkStatus === "generating" || Boolean(artworkJob)} onClick={() => void generateArtwork()}>
              {review.scriptStatus !== "applied" ? "先上传新批注" : !review.approved ? "先签字盖章" : !artworkPrompt.trim() ? "先填写提示词" : review.artworkStatus === "generating" || artworkJob ? "Lib Image 后台生成 2 张图…" : artwork ? "重新生成 2 张" : "用 Lib Image 生成 2 张"}
            </button>
            {state.currentShot < state.reviews.length - 1 ? (
              <button className="button secondary" onClick={continueToNextShot}>暂不出图，进入下一 Shot</button>
            ) : null}
            <button className="text-button" onClick={() => fileInput.current?.click()}>或手动放入图片</button>
            <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} />
            {review.artworkStatus === "error" ? <div className="inline-error">{review.summary}</div> : null}
          </div>
        </div>
      </section>
    );
  }

  function renderConfirm() {
    return (
      <section className="stage-page">
        <div className="stage-page-heading"><span>STEP 03 · RESULT</span><h1>确认</h1><p>这里用于查看和选择出图结果；审批以脚本页的独立签字盖章为准。</p></div>
        <div className="confirm-stage">
          <div className="confirm-image">{artwork ? <img src={artwork} alt={`Shot ${shot.id} 待确认分镜图`} /> : <ArtworkPlaceholder shotId={shot.id} generating={review.artworkStatus === "generating" || Boolean(artworkJob)} />}</div>
          <div className="confirm-copy">
            <span>SHOT {shot.id} · FINAL CHECK</span>
            <h2>{shot.title}</h2>
            {artworkCandidates.length > 1 ? (
              <div className="candidate-picker" aria-label="选择分镜方案">
                {artworkCandidates.map((candidate, index) => (
                  <button type="button" className={selectedArtworkIndex === index ? "selected" : ""} key={`pick-${index}`} onClick={() => selectArtworkCandidate(index)}>
                    <img src={candidate} alt={`方案 ${String.fromCharCode(65 + index)}`} />
                    <span>{String.fromCharCode(65 + index)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <dl>
              <div><dt>剧情</dt><dd>{shot.story}</dd></div>
              <div><dt>物品</dt><dd>{shot.props.join("；")}</dd></div>
              <div><dt>场景</dt><dd>{shot.scene}</dd></div>
              <div><dt>动作</dt><dd>{shot.action}</dd></div>
              <div><dt>连续</dt><dd>{shot.continuity.join("；")}</dd></div>
            </dl>
            <button className="button primary approve" disabled={!artwork} onClick={keepArtworkAndNext}>保留当前图，返回下一 Shot</button>
            <button className="button secondary" onClick={() => setView("artwork")}>再生成一次</button>
            <button className="text-button" onClick={() => setView("script")}>镜头方案有问题，回脚本写批注</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block"><span className="brand-mark">镜导</span><div><b>镜导</b><small>SHOTDIRECTOR · 分镜导演工具</small></div></div>
        <div className={`save-status ${materialDraftMode ? "draft-mode" : ""}`}><i />{materialDraftMode ? "素材分析草稿 · 独立保存" : hydrated ? "本机自动保存" : "读取工作稿"}</div>
      </header>

      <section className="loaded-script">
        <div className="loaded-script-copy">
          <span>已载入脚本</span>
          <h1>{state.projectTitle}</h1>
          <small>{state.reviews.length} SHOTS</small>
        </div>
        <div className="loaded-script-actions">
          {materialDraftMode ? (
            <button className="button secondary material-original-project" type="button" onClick={() => { window.location.href = "/"; }}>
              <b>返回原项目</b><small>当前草稿不会覆盖原审批</small>
            </button>
          ) : null}
          <button className={`button global-settings-entry ${state.workspaceMode === "global" ? "active" : ""}`} type="button" onClick={state.workspaceMode === "global" ? returnToShots : openGlobalSettings}>
            <b>{state.workspaceMode === "global" ? "返回镜头审核" : "全局设定"}</b>
            <small>{state.globalStatus === "draft" ? "有未保存修改" : "独立批注 · 不计入Shot"}</small>
          </button>
          <button className={`button material-lab-entry ${state.workspaceMode === "materials" ? "active" : ""}`} type="button" onClick={state.workspaceMode === "materials" ? returnToShots : openMaterialLab}>
            <b>{state.workspaceMode === "materials" ? "返回镜头审核" : "漫画转分镜"}</b>
            <small>上传漫画 · 自动拆成可审 Shot</small>
          </button>
          <button className={`button coverage-entry ${state.workspaceMode === "coverage" ? "active" : ""}`} type="button" onClick={state.workspaceMode === "coverage" ? returnToShots : openCoverageReview}>
            <b>{state.workspaceMode === "coverage" ? "返回镜头审核" : "脚本体检"}</b>
            <small>{coverageReport.coveragePercent}% 覆盖 · {coverageReport.missingUnits} 条未覆盖</small>
          </button>
          <button className={`button asset-ledger-entry ${state.workspaceMode === "assets" ? "active" : ""}`} type="button" onClick={state.workspaceMode === "assets" ? returnToShots : openAssetLedger}>
            <b>{state.workspaceMode === "assets" ? "返回镜头审核" : "资产同步"}</b>
            <small>{assetReadyCount} 包就绪 · {assetAttentionCount} 个待处理{assetRunningCount ? ` · ${assetRunningCount} 生成中` : ""}</small>
          </button>
          <div className="model-switch" role="group" aria-label="Seedance生成模型">
            {generationModels.map((model) => (
              <button key={model.id} className={generationModel === model.id ? "active" : ""} onClick={() => selectGenerationModel(model.id)}>
                <b>{model.label}</b><small>{model.minDuration}–{model.maxDuration} 秒 · {model.limit} 个参考</small>
              </button>
            ))}
          </div>
          <button className="button secondary load-script-button" onClick={() => setShowLoader((current) => !current)}>
            {showLoader ? "收起" : "载入脚本"}
          </button>
        </div>
      </section>

      {showLoader ? (
        <section className="script-loader" aria-label="载入脚本">
          <div className="loader-heading">
            <span>LOAD SCRIPT</span>
            <h2>载入新的脚本</h2>
            <p>可以选择已有文件，也可以直接用自然语言告诉 GPT 要载入什么。</p>
          </div>
          <div className="loader-options">
            <div className="loader-option">
              <span>方式 01</span>
              <h3>选择脚本文件</h3>
              <p>JSON 会直接载入；Markdown 或 TXT 会交给 GPT 自动整理成逐镜 Shot。</p>
              <button className="button secondary" disabled={bridge.busy || loadingScript} onClick={() => scriptInput.current?.click()}>
                {loadingScript ? "GPT正在整理…" : "选择文件"}
              </button>
              <input ref={scriptInput} hidden type="file" accept="application/json,.json,.md,.markdown,.txt,text/plain,text/markdown" onChange={onScriptFile} />
            </div>
            <div className="loader-option natural-loader">
              <span>方式 02 · GPT</span>
              <h3>用自然语言载入</h3>
              <textarea
                rows={6}
                value={naturalScript}
                placeholder="例如：输入项目名称、故事起点、主要人物、地点、关键事件与必须遵守的连续性。"
                onChange={(event) => setNaturalScript(event.target.value)}
              />
              <button className="button primary" disabled={bridge.busy || loadingScript || !naturalScript.trim() || !bridge.connected} onClick={loadNaturalScript}>
                {loadingScript ? "GPT正在整理并载入…" : "让 GPT 整理并载入"}
              </button>
              {!bridge.connected ? <small>本地 GPT 直连启动后即可使用</small> : null}
            </div>
          </div>
        </section>
      ) : null}

      {state.workspaceMode === "global" ? renderGlobalSettingsPage() : state.workspaceMode === "coverage" ? renderCoveragePage() : state.workspaceMode === "assets" ? renderAssetLedgerPage() : state.workspaceMode === "materials" ? (
        <MediaLab
          bridgeBase={bridgeBase}
          pairingToken={bridge.pairingToken}
          connected={bridge.connected}
          generationModel={generationModel}
          defaultStoryBackground={state.globalSettings.storyBackground}
          defaultArtStyle={state.globalSettings.finalVideoStyle?.trim() || defaultArtStyle}
          initialKind="manga"
          onBack={returnToShots}
          onCreateDraft={createMaterialDraft}
        />
      ) : <>
      <section className="progress-bar">
        <div className="progress-copy"><span>当前进度</span><strong>{approvedCount} / {state.reviews.length} Shot 已批准</strong></div>
        <div className="shot-strip" style={{ "--shot-count": shotNavigationGroups.length } as CSSProperties}>
          {shotNavigationGroups.map((group) => {
            const current = group.indices.includes(state.currentShot);
            const approved = group.reviews.every((item) => item.approved);
            const generating = group.reviews.some((item) => item.artworkStatus === "generating");
            const hasArtwork = group.reviews.some((item) => item.artworkStatus === "ready" && !item.approved);
            const firstIndex = group.indices[0];
            return (
              <button
                key={group.key}
                className={`${current ? "is-current" : ""} ${approved ? "is-done" : ""} ${generating ? "is-generating" : ""} ${hasArtwork ? "has-artwork" : ""}`}
                title={generating ? `Shot ${group.label} 后台出图中` : hasArtwork ? `Shot ${group.label} 已出图，等待确认` : undefined}
                onClick={() => selectShot(firstIndex)}
              >{group.label}</button>
            );
          })}
        </div>
        <div className="single-rule"><span>规则</span><b>出图后台运行，可继续审下一 Shot</b></div>
      </section>

      <nav className="three-step-nav" aria-label="当前 Shot 工作流程">
        {navItems.map((item) => {
          const disabled = (item.id !== "script" && (referencesOverLimit || durationOutOfRange)) || (item.id === "artwork" && (review.scriptStatus !== "applied" || !review.approved)) || (item.id === "confirm" && !artwork);
          const done = item.id === "script" ? review.approved : item.id === "artwork" ? Boolean(artwork) : Boolean(artwork);
          return (
            <button key={item.id} className={`${state.view === item.id ? "active" : ""} ${done ? "done" : ""}`} disabled={disabled} onClick={() => setView(item.id)}>
              <span>{done ? "✓" : item.number}</span><b>{item.label}</b>
            </button>
          );
        })}
      </nav>

      <section className={`workspace workflow-workspace ${directorVisualMode === "whitebox" ? "whitebox-open" : ""}`}>
        <div className="review-column">
          {isOpeningSubshot ? (
            <div className="shot-subshot-switch" aria-label="SHOT 01 内部分镜">
              <span className="shot-subshot-heading">SHOT 01 内部分镜</span>
              <div className="shot-subshot-options">
                {shotNavigationGroups.find((group) => group.key === "opening")?.indices.map((index) => {
                  const subshotReview = state.reviews[index];
                  const active = index === state.currentShot;
                  return (
                    <button type="button" key={subshotReview.shot.id} className={active ? "active" : ""} onClick={() => selectShot(index)}>
                      <b>分镜 {openingSubshotNumber(subshotReview.shot.id)}</b>
                      <small>{subshotReview.shot.title}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="shot-title-row">
            <div className="shot-number">
              {isOpeningSubshot ? "SHOT 01" : `SHOT ${shot.id}`}
              {isOpeningSubshot ? <small>分镜 {openingSubshotNumber(shot.id)}</small> : null}
            </div>
            <div className="shot-title"><span>{shot.timecode} · {shot.duration} SEC</span><h1>{shot.title}</h1></div>
            <div className={`shot-state ${review.approved ? "locked" : ""}`}>{review.approved ? "已批准" : `版本 ${review.versions.length + 1}`}</div>
          </div>
          {renderTaskProgress()}
          {state.view === "script" ? renderScript() : state.view === "artwork" ? renderArtwork() : renderConfirm()}
        </div>

        <aside className="director-column">
          <div className="visual-card">
            <div className="visual-heading"><span>DIRECTOR VIEW</span><b>{selectedDirectorView.label}</b></div>
            <div className="director-visual-switch" role="tablist" aria-label="导演视图模式">
              <button type="button" role="tab" aria-selected={directorVisualMode === "top"} className={directorVisualMode === "top" ? "active" : ""} onClick={() => setDirectorVisualMode("top")}><b>TOP VIEW</b><small>站位、轨迹、机位</small></button>
              <button type="button" role="tab" aria-selected={directorVisualMode === "whitebox"} className={directorVisualMode === "whitebox" ? "active" : ""} onClick={() => setDirectorVisualMode("whitebox")}><b>3D 白模</b><small>纯净空间与动作骨架</small></button>
            </div>
            {hasSegmentedDirectorViews ? (
              <div className="director-view-switch" role="tablist" aria-label={`Shot ${shot.id} DIRECTOR VIEW 切换`}>
                {directorViews.map((view) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedDirectorView.key === view.key}
                    className={selectedDirectorView.key === view.key ? "active" : ""}
                    key={view.key}
                    onClick={() => selectDirectorView(view.key)}
                  >
                    <b>{view.label}</b>
                    <small>{view.title}</small>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="story-readout"><span>{hasSegmentedDirectorViews ? selectedDirectorView.label : "剧情"}</span><p>{selectedDirectorView.segment?.beat || shot.story}</p></div>
            {directorVisualMode === "top" ? <>
              <div className="visual-frame">
                <StageSketch
                  shot={shot}
                  planKey={selectedDirectorView.key}
                  viewLabel={selectedDirectorView.label}
                  caption={selectedDirectorView.segment?.framing || shot.composition}
                  textVisibility={topViewTextVisibility}
                  onToggleText={(field) => setTopViewTextVisibility((current) => ({ ...current, [field]: !current[field] }))}
                  useDefaultProjectPlan={useDefaultProjectPlans}
                />
              </div>
              <div className="frame-caption"><span>{hasSegmentedDirectorViews ? `${selectedDirectorView.label} · 独立机位图` : "16:9"}</span><span>俯视站位图 · 不被生图替换</span></div>
            </> : <WhiteboxEditor
              scene={whiteboxScene}
              shotId={shot.id}
              viewLabel={selectedDirectorView.label}
              onChange={updateWhiteboxScene}
              onReset={resetWhiteboxScene}
              onLockReference={lockWhiteboxReference}
              onUnlockReference={unlockWhiteboxReference}
              referenceLocked={selectedWhiteboxReferenceLocked}
            />}
            <div className="director-annotation">
              <span><b>DIRECTOR VIEW 批注</b><small>单独修改站位、车头方向、机位朝向和运镜轨迹</small></span>
              <textarea
                aria-label="DIRECTOR VIEW 批注"
                rows={4}
                disabled={scriptLocked}
                value={review.annotations.director || ""}
                placeholder="例如：标明车辆朝向、机位A与机位B的位置、摄影机朝向和横移轨迹。"
                onChange={(event) => updateAnnotation("director", event.target.value)}
              />
              {(review.annotations.director || "").trim() && state.view !== "script" ? (
                <button className="text-button" type="button" onClick={() => setView("script")}>回到脚本页统一发送这条批注</button>
              ) : null}
            </div>
          </div>

          {currentVideoPackage ? (
            <div className="director-prompt-card">
              <div className="visual-heading">
                <span>VIDEO PROMPT</span>
                <b>SHOT {shot.id}</b>
              </div>
              <div className="director-prompt-body">
                <div className="director-prompt-status">
                  <b>Seedance 视频提示词</b>
                  <span>{currentVideoPackage.promptMode === "custom" ? "已手动修改" : "跟随脚本自动生成"}</span>
                </div>
                <textarea
                  aria-label={`Shot ${shot.id} 视频提示词`}
                  rows={14}
                  spellCheck={false}
                  value={currentVideoPackage.prompt}
                  onChange={(event) => updateVideoPrompt(shot.id, event.target.value, currentVideoPackage.sourceRevision)}
                />
                <div className="director-prompt-actions">
                  <button type="button" className="text-button" onClick={() => copyVideoPrompt(currentVideoPackage)}>复制提示词</button>
                  {currentVideoPackage.promptMode === "custom" ? (
                    <button type="button" className="text-button" onClick={() => restoreAutomaticVideoPrompt(currentVideoPackage)}>恢复自动提示词</button>
                  ) : null}
                </div>
                <small>这里是生视频提示词；临时分镜图提示词仍在“出图”页单独编辑。</small>
              </div>
            </div>
          ) : null}

          <div className="annotation-summary">
            <div className="visual-heading"><span>ANNOTATIONS</span><b>本 Shot 批注汇总</b></div>
            {noteCount ? annotationSections.map((section) => (review.annotations[section.id] || "").trim() ? (
              <div className="summary-note" key={section.id}><span>{section.title}</span><p>{review.annotations[section.id]}</p></div>
            ) : null) : <p className="empty-summary">还没有批注。可以直接改正文，也可以在六个脚本分区下面分别写批注。</p>}
          </div>

          <div className="hard-lock-card">
            <div className="visual-heading"><span>HARD LOCKS</span><b>后续不能丢</b></div>
            <ol>{shot.continuity.slice(0, 5).map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></li>)}</ol>
          </div>
        </aside>
      </section>

      <footer className="action-dock">
        <div><span>当前</span><b>Shot {shot.id} · {navItems.find((item) => item.id === state.view)?.label}</b><small>{state.view === "script" ? `${noteCount} 类本镜批注；全片 ${batchShotCount} 个 Shot 待上传` : state.view === "artwork" ? "已独立盖章；出图可后台继续" : "可查看结果或再次生成"}</small></div>
        <div className={`dock-status ${annotationBusy || artworkJob || review.artworkStatus === "generating" ? "busy" : review.approved ? "done" : ""}`} aria-label="当前处理状态">
          <span>状态</span>
          <b>{referencesOverLimit
            ? `参考超限：${referenceCount}/${referenceLimit}`
            : durationOutOfRange
            ? `时长不符：${shot.duration}秒（需${durationRange.min}–${durationRange.max}秒）`
            : annotationBusy
            ? "批注处理中"
            : state.view === "script"
              ? review.approved ? "已签字盖章 · 审批通过" : review.scriptStatus === "applied" ? "批改已应用 · 等待盖章" : noteCount ? "等待一键上传批注" : "等待签字盖章"
              : state.view === "artwork"
                ? artworkJob || review.artworkStatus === "generating"
                  ? artworkJob?.message || "Lib Image 后台生成中（2 张）"
                  : artwork ? `已生成 ${artworkCandidates.length} 张，可选择方案` : libtvReady ? "尚未启动出图" : "LibTV 未登录"
                : review.approved ? "已签字盖章" : "等待签字盖章"}</b>
        </div>
      </footer>
      </>}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  );
}
