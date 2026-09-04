"use client";

import { ChangeEvent, CSSProperties, DragEvent, FormEvent, Fragment, ReactNode, UIEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { blockingPlans, type BlockingMarker, type BlockingMovement } from "./blocking-plans";
import { globalSettings as sourceGlobalSettings, type CharacterProfile, type GlobalSettings } from "./global-settings";
import { defaultArtStyle, inferredVideoArtStyle, legacyStoryboardArtStyle, mistakenStoryboardAsVideoArtStyle, storyboardArtworkStyle, storyboardShots, type StoryboardShot, type StoryboardSegment } from "./storyboard-data";
import { buildCoverageReport, changedShotFields, defaultDirectorRecipeId, directorRecipes, getDirectorRecipe, sourceDocumentFromShots, sourceTextForShot, type CoverageStatus } from "./director-workflow";
import { MediaLab, type MediaAnalysisResult } from "./media-lab";
import { buildCompleteShotPromptRevision, buildPromptReviewRevision, buildShotUpstreamRevision, buildVideoGenerationPackage, type VideoGenerationPackage, type VideoPackageStatus } from "./video-package";
import { buildProjectManifest, deriveProductionPipeline, ensureProjectUid, ensureShotUid } from "./production-core.mjs";
import { MANJING_SAVE_PROJECT_EVENT, ManjingAuthGate, manjingScopedBrowserStorage, manjingSessionFetch, useManjingWorkspaceScope, type ManjingSaveProjectEventDetail } from "./manjing-auth-client";
import { WhiteboxEditor } from "./whitebox-stage";
import { ShotChat, type ShotChatState, type ShotChatPending, type ShotChatResult } from "./shot-chat";
import { chatReplyCanApply, reviewSuggestionsText } from "./shot-chat-state.mjs";
import { planPanelDrop } from "./panel-drag-grouping.mjs";
import { buildMangaReadingOrder, correctMangaReviewOrder, normalizeMangaAnalysisReadingOrder, type ReadingPage } from "./manga-reading-order.mjs";
import { dialogueMetrics, visualTimingMetrics } from "./shot-timing-metrics.mjs";
import { promptReviewControls, promptReviewShotLabel } from "./prompt-review-controls.mjs";
import { persistProjectSnapshot } from "./project-save.mjs";
import { LineListField, LineListTextarea } from "./line-list-field";
import { TextInputDialog } from "./text-input-dialog";
import { createWhiteboxScene, ensureWhiteboxScenes, type WhiteboxScene } from "./whitebox-data";
import {
  browserAgentRevision,
  browserDraftSnapshot,
  shouldApplyAgentDraft,
  shouldSurfaceMediaRecoveryFailure,
} from "./draft-sync-policy.mjs";

type ViewId = "script" | "artwork" | "confirm";
type WorkspaceMode = "shots" | "global" | "materials" | "coverage" | "assets";
type DeskMode = "creator" | "strict-review";
type ReasoningEffort = "low" | "high" | "max";
type SectionId = "characters" | "scene" | "story" | "action" | "continuity" | "style" | "director";
type GenerationModel = "seedance-2.0" | "seedance-2.5";
type DirectorVisualMode = "top" | "whitebox";
type ScriptStatus = "draft" | "sending" | "applied" | "error";
type StructureStatus = "draft" | "confirmed";
type ArtworkStatus = "empty" | "generating" | "ready" | "error";
type CompleteShotPromptStatus = "empty" | "generating" | "ready" | "stale" | "error";
type PromptReviewStatus = "empty" | "reviewing" | "ready" | "stale" | "error";
type PromptReviewVerdict = "discussion-ready" | "needs-revision";
type PromptReviewSeverity = "blocking" | "warning" | "suggestion";
type AssetFilter = "all" | "attention" | "ready" | "running";
type PanelDropTarget = {
  reviewIndex: number;
  position: "end";
  createShotAt?: number;
};
type WritingModelId = "glm-5.3-flash" | "kimi-k3" | "deepseek-v4-flash" | "deepseek-v4-pro" | "seed-2.1-pro" | "jk-gpt-5.6-sol" | "jk-gpt-5.6-luna" | "jk-gemini-3.8-flash" | "jk-claude-opus-5" | "jk-claude-sonnet-5";
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

type GlobalFileSummary = {
  id: string;
  name: string;
  updatedAt?: string;
};

type GlobalFilePayload = {
  schemaVersion: number;
  settings: GlobalSettings;
  assetPrompts: ProjectAssetPrompt[];
  referenceAssets: Array<{ id: string; kind: ShotAssetKind; name: string; fileId?: string; url?: string }>;
};

const assetImageModels: Array<{ id: AssetImageModel; label: string }> = [
  { id: "Lib Image", label: "Lib Image" },
  { id: "General image Pro", label: "General image Pro" },
  { id: "Seedream 5.0 Pro", label: "Seedream 5.0 Pro" },
];
const assetImageRatios: AssetImageRatio[] = ["16:9", "9:16", "1:1", "3:4", "4:3", "3:2", "2:3", "4:5", "5:4", "21:9"];
const assetImageResolutions: AssetImageResolution[] = ["1K", "2K", "4K"];

async function copyTextToClipboard(value: string) {
  if (!value) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Public-IP HTTP pages and restricted webviews may expose the API but deny writes.
      // Fall through to the selection-based copy path while the click is still active.
    }
  }

  if (typeof document === "undefined" || !document.body) return false;
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    position: "fixed",
    top: "0",
    left: "-9999px",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    activeElement?.focus({ preventScroll: true });
  }
  return copied;
}

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

type CompleteShotPromptResearch = {
  used: boolean;
  queries: string[];
  sources: Array<{ title: string; url: string; usedFor: string }>;
  notes: string[];
};

type CompleteShotPromptResult = {
  status: "completed";
  shotId: string;
  projectUid?: string;
  shotUid?: string;
  generatorId?: string;
  generatorProvider?: string;
  requestedGeneratorId?: string;
  summary: string;
  prompt: string;
  research: CompleteShotPromptResearch;
  warnings: string[];
  sourceRevision: string;
  generatedAt: string;
  error?: string;
};

type ReviewerOption = {
  id: string;
  label: string;
  provider: string;
  model: string;
  available: boolean;
  reason?: string;
  evidenceMode?: "direct-images" | "structured-panel-evidence";
};

type WritingModelOption = {
  id: WritingModelId;
  label: string;
  hint: string;
  provider: string;
  model: string;
  available: boolean;
  selected?: boolean;
  reason?: string;
  supportsImages?: boolean;
};

const writingModelCatalog: WritingModelOption[] = [
  { id: "glm-5.3-flash", label: "GLM-5.3-Flash", hint: "默认 · 多模态", provider: "glm", model: "glm-5.3-flash", available: false, reason: "正在读取服务器状态" },
  { id: "kimi-k3", label: "Kimi K3", hint: "聊天与创作 · 多模态", provider: "kimi", model: "k3", available: false, reason: "正在读取服务器状态" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", hint: "快速文字创作", provider: "deepseek", model: "deepseek-v4-flash", available: false, reason: "正在读取服务器 env" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", hint: "复杂文字创作", provider: "deepseek", model: "deepseek-v4-pro", available: false, reason: "正在读取服务器 env" },
  { id: "seed-2.1-pro", label: "Seed 2.1 Pro", hint: "长篇文字与创意写作", provider: "doubao-responses", model: "doubao-seed-2-1-pro-260628", available: false, reason: "正在读取服务器 env" },
  { id: "jk-gpt-5.6-sol", label: "JK GPT-5.6 Sol", hint: "API · 复杂推理与正式交付", provider: "jiekou-responses", model: "gpt-5.6-sol", available: false, reason: "正在读取服务器 env" },
  { id: "jk-gpt-5.6-luna", label: "JK GPT-5.6 Luna", hint: "API · 通用问答与长文创作", provider: "jiekou-responses", model: "gpt-5.6-luna", available: false, reason: "正在读取服务器 env" },
  { id: "jk-gemini-3.8-flash", label: "JK Gemini 3.8 Flash", hint: "API · 快速推理与多模态", provider: "jiekou-chat", model: "gemini-3.8-flash", available: false, reason: "正在读取服务器 env" },
  { id: "jk-claude-opus-5", label: "JK Claude Opus 5", hint: "API · 复杂分析与高质量创作", provider: "jiekou-anthropic", model: "claude-opus-5", available: false, reason: "正在读取服务器 env" },
  { id: "jk-claude-sonnet-5", label: "JK Claude Sonnet 5", hint: "API · 通用分析与创作", provider: "jiekou-anthropic", model: "claude-sonnet-5", available: false, reason: "正在读取服务器 env" },
];
const serverSelectableWritingModelIds = new Set<WritingModelId>(writingModelCatalog.map((model) => model.id));

type PromptReviewFinding = {
  id: string;
  severity: PromptReviewSeverity;
  category: string;
  title: string;
  detail: string;
  suggestion: string;
  panelIds: string[];
};

type PromptReviewReport = {
  verdict: PromptReviewVerdict;
  summary: string;
  strengths: string[];
  checks: {
    sourceBoundary: boolean;
    characterContinuity: boolean;
    timingFeasible: boolean;
    dialogueFeasible: boolean;
    cameraAndActionCoherent: boolean;
    soundAndNegativeComplete: boolean;
  };
  findings: PromptReviewFinding[];
};

type PromptReviewResult = {
  status: "completed";
  shotId: string;
  reviewerId: string;
  reviewerModel?: string;
  reviewerLabel: string;
  report: PromptReviewReport;
  sourceRevision: string;
  reviewedAt: string;
  requestId?: string;
  error?: string;
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
  completePromptStatus?: CompleteShotPromptStatus;
  completePrompt?: string;
  completePromptSummary?: string;
  completePromptResearch?: CompleteShotPromptResearch;
  completePromptWarnings?: string[];
  completePromptGeneratedAt?: string;
  completePromptSourceRevision?: string;
  completePromptConfirmedAt?: string;
  completePromptGeneratorId?: string;
  completePromptGeneratorProvider?: string;
  completePromptRequestedGeneratorId?: string;
  promptReviewerId?: string;
  promptReviewerModel?: string;
  promptReviewStatus?: PromptReviewStatus;
  promptReviewReport?: PromptReviewReport;
  promptReviewSourceRevision?: string;
  promptReviewedAt?: string;
  promptReviewRequestId?: string;
  promptReviewError?: string;
  selectedDirectorView?: string;
  chat?: ShotChatState;
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
  projectUid: string;
  projectTitle: string;
  sourceDocument: string;
  sourceName: string;
  selectedRecipeId: string;
  generationModel: GenerationModel;
  workspaceMode: WorkspaceMode;
  globalSettings: GlobalSettings;
  globalFileId?: string;
  globalFileName?: string;
  assetPrompts?: ProjectAssetPrompt[];
  globalAnnotation: string;
  globalStatus: ScriptStatus;
  globalSummary?: string;
  globalUpdatedAt?: string;
  sourceMangaRequestId?: string;
  sourceMangaPanels?: Record<string, MangaPanelUnderstanding>;
  sourceMangaPanelUnderstandingVersion?: number;
  sourceMangaPanelAnnotations?: Record<string, string>;
  sourceMangaReadingDirection?: "right-to-left" | "left-to-right";
  sourceMangaReadingPages?: ReadingPage[];
  structureStatus?: StructureStatus;
  structureConfirmedAt?: string;
  currentShot: number;
  view: ViewId;
  reviews: ShotReview[];
};

type MangaPanelUnderstanding = {
  sourceObservation: string;
  textSummary: string;
  dialogue: Array<{ speaker: string; text: string; confidence: "high" | "medium" | "low" }>;
  characters: string[];
  relationAndPlot: string;
};

const mangaPanelUnderstandingVersion = 2;

type BridgeState = {
  connected: boolean;
  busy: boolean;
  draining?: boolean;
  serverMode?: boolean;
  modelProvider?: {
    id: string;
    selectionId?: WritingModelId;
    model: string;
    label?: string;
    configured: boolean;
    supportsWebSearch?: boolean;
    supportsImages?: boolean;
  };
  pairingToken?: string;
  activeJob?: BridgeJob;
  lastJob?: BridgeJob;
  shotWork?: { limit: number; active: number; queued: number };
  promptJobs?: BridgeJob[];
  lastPromptJobs?: BridgeJob[];
  artworkJobs?: BridgeJob[];
  lastArtworkJobs?: BridgeJob[];
  assetJobs?: BridgeJob[];
  lastAssetJobs?: BridgeJob[];
  libtv?: LibtvState;
  writingModels?: WritingModelOption[];
  reasoningPolicy?: {
    selected: ReasoningEffort;
    options: ReasoningEffort[];
    taskOverrides: {
      mangaSplit: "low";
      completeShotPrompt: "max";
      strictReview: "max";
    };
  };
  reviewers?: ReviewerOption[];
  harness?: {
    harnessVersion: string;
    runs: Array<{
      runId: string;
      agentRole: "creator" | "review" | "memory";
      kind?: string | null;
      status: "running" | "completed" | "failed" | "aborted";
      updatedAt?: string;
    }>;
  };
};

type LibtvState = {
  installed: boolean;
  status: "checking" | "missing" | "needs_login" | "needs_code" | "logging_in" | "ready" | "error";
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
  type: "annotation" | "annotation-batch" | "global-annotation" | "complete-shot-prompt" | "shot-chat" | "prompt-review" | "artwork" | "asset-artwork" | "load-script";
  shotId: string;
  projectUid?: string;
  shotUid?: string;
  sourceRevision?: string;
  projectTitle?: string;
  assetId?: string;
  assetKind?: ShotAssetKind;
  assetName?: string;
  requestId?: string;
  status?: "running" | "completed" | "failed";
  stage?: string;
  message?: string;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  events?: BridgeJobEvent[];
  error?: string;
  remoteTaskId?: string;
  retryPolicy?: "manual-check-required" | "manual-retry-allowed";
};

const defaultProjectTitle = "未命名项目";
const legacyUnknownModelId = "legacy-unknown";
const defaultPromptReviewerId = "kimi-k3";
const storageKey = "shotdirector-storyboard-review-v15";
const materialDraftStoragePrefix = "shotdirector-storyboard-draft-v1::";
const recentMaterialDraftKey = "shotdirector-recent-material-draft-v1";
const legacyStorageKeys = ["shotdirector-storyboard-review-v14", "shotdirector-storyboard-review-v13", "shotdirector-storyboard-review-v12", "shotdirector-storyboard-review-v11", "shotdirector-storyboard-review-v10", "shotdirector-storyboard-review-v9", "shotdirector-storyboard-review-v8", "shotdirector-storyboard-review-v7", "shotdirector-storyboard-review-v6", "shotdirector-storyboard-review-v5"];
const stateSchemaVersion = 16;
const artworkDb = "shotdirector-artwork-v1";
const configuredApiBase = process.env.NEXT_PUBLIC_MANJING_API_BASE?.trim();
const bridgeBase = (configuredApiBase || "http://127.0.0.1:4317").replace(/\/+$/, "");
const bridgeFetch = manjingSessionFetch;
// In server mode the browser authenticates with its HttpOnly session cookie and
// the gateway injects the real per-tenant worker token. Keep a non-secret local
// sentinel so the existing local-bridge guards stay usable without exposing the
// internal worker credential to the browser.
const serverGatewayPairingSentinel = "server-session";
const storyboardSourceRevision = "blank-project-v1";
const absoluteMaxOmniReferences = 50;
const staleSendingGraceMs = 4000;
const staleArtworkGraceMs = 4000;

const generationModels: Array<{ id: GenerationModel; label: string; limit: number; minDuration: number; maxDuration: number }> = [
  { id: "seedance-2.0", label: "Seedance 2.0", limit: 9, minDuration: 6, maxDuration: 15 },
  { id: "seedance-2.5", label: "Seedance 2.5", limit: 50, minDuration: 6, maxDuration: 30 },
];

const defaultGenerationModel: GenerationModel = "seedance-2.5";

function referenceLimitFor(model: GenerationModel) {
  return generationModels.find((item) => item.id === model)?.limit ?? 50;
}

function durationRangeFor(model: GenerationModel) {
  const target = generationModels.find((item) => item.id === model);
  return { min: target?.minDuration ?? 6, max: target?.maxDuration ?? 30 };
}

type ShotTimingEstimate = {
  segmentCount: number;
  estimatedFromPanels: boolean;
  dialogueCharacters: number;
  dialogueLineCount: number;
  dialogueSeconds: number;
  visualSeconds: number;
  actionReactionSeconds: number;
  requiredSeconds: number;
  deltaSeconds: number;
  localWindowOverrunSeconds: number;
  status: "comfortable" | "tight" | "over" | "over-model";
  dialogueSource: "generated-japanese" | "source-dialogue" | "none";
};

type TimingDialogueLine = { speaker: string; text: string; windowSeconds?: number };

function splitTimingDialogueLine(value: string): TimingDialogueLine {
  const cleaned = value.replace(/^\s*\d+[.、)）]\s*/, "").trim();
  const match = cleaned.match(/^([^：:\n｜]{1,32})[：:]\s*(.+)$/);
  return match ? { speaker: match[1].trim(), text: match[2].trim() } : { speaker: "", text: cleaned };
}

function generatedJapaneseDialogue(prompt?: string): TimingDialogueLine[] {
  if (!prompt?.trim()) return [];
  const results: TimingDialogueLine[] = [];
  let currentWindow: number | undefined;
  let pendingSpeaker = "";
  let simpleDialogueSection = false;
  for (const rawLine of prompt.split(/\r?\n/)) {
    const line = rawLine.trim();
    const range = line.match(/(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*秒/);
    if (range) currentWindow = Math.max(0, Number(range[2]) - Number(range[1]));
    else if (/^【[^】]+】/.test(line)) currentWindow = undefined;
    if (/^(?:【[^】]*】\s*)?(?:成片)?日语对白[：:]?$/.test(line) || /^成片对白严格限定/.test(line)) {
      simpleDialogueSection = true;
      currentWindow = undefined;
      pendingSpeaker = "";
      continue;
    }
    if (/^(?:中文备注|声音|声音氛围|禁止|跨镜连续性)[：:]/.test(line)) simpleDialogueSection = false;

    const sameLine = line.match(/^\s*(?:\d+[.、)）]\s*)?([^：:\n｜]{1,32})（日(?:语|語)）[：:]\s*[「“\"]?([^｜」”\"]+)[」”\"]?/);
    if (sameLine) {
      results.push({ speaker: sameLine[1].trim(), text: sameLine[2].trim(), windowSeconds: currentWindow });
      pendingSpeaker = "";
      continue;
    }
    const speakerOnly = line.match(/^([^：:\n｜]{1,32})（日(?:语|語)）[：:]\s*$/);
    if (speakerOnly) {
      pendingSpeaker = speakerOnly[1].trim();
      continue;
    }
    if (pendingSpeaker) {
      const quoted = line.match(/^[「“\"](.+?)[」”\"]$/);
      if (quoted) results.push({ speaker: pendingSpeaker, text: quoted[1].trim(), windowSeconds: currentWindow });
      pendingSpeaker = "";
      continue;
    }
    if (simpleDialogueSection) {
      const quotedLine = line.match(/^([^：:\n｜]{1,32})[：:]\s*[「“\"](.+?)[」”\"]$/);
      if (quotedLine) results.push({ speaker: quotedLine[1].trim(), text: quotedLine[2].trim() });
    }
  }
  return results;
}

function dialogueLineSeconds(text: string) {
  return dialogueMetrics(text).seconds;
}

function estimateShotTiming(input: {
  dialogue?: string[];
  completePrompt?: string;
  panelCount: number;
  segmentCount?: number;
  assignedDuration: number;
  model: GenerationModel;
}): ShotTimingEstimate {
  const promptDialogue = generatedJapaneseDialogue(input.completePrompt);
  const sourceDialogue = (input.dialogue || []).map(splitTimingDialogueLine)
    .filter((item) => item.text && !/^(?:拟声词|画面文字|画面符号)$/.test(item.speaker) && dialogueMetrics(item.text).characters > 0);
  const lines = promptDialogue.length ? promptDialogue : sourceDialogue;
  let speakerChanges = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index - 1].speaker && lines[index].speaker && lines[index - 1].speaker !== lines[index].speaker) speakerChanges += 1;
  }
  const dialogueSeconds = lines.reduce((total, item) => total + dialogueLineSeconds(item.text), 0);
  const visual = visualTimingMetrics(input.panelCount, input.segmentCount, speakerChanges);
  const { visualSeconds, actionReactionSeconds } = visual;
  // Speech and action can overlap; this is an estimate, never a command to split or truncate a Shot.
  const rawSeconds = Math.max(dialogueSeconds, visualSeconds + actionReactionSeconds);
  const requiredSeconds = Math.ceil(rawSeconds);
  const localWindowOverrunSeconds = lines.reduce((largest, item) => item.windowSeconds === undefined
    ? largest
    : Math.max(largest, dialogueLineSeconds(item.text) - item.windowSeconds), 0);
  const range = durationRangeFor(input.model);
  const deltaSeconds = input.assignedDuration - requiredSeconds;
  const status = requiredSeconds > range.max
    ? "over-model"
    : deltaSeconds < 0 || localWindowOverrunSeconds > 0.15
      ? "over"
      : deltaSeconds < 1.5
        ? "tight"
        : "comfortable";
  return {
    segmentCount: visual.segmentCount,
    estimatedFromPanels: visual.estimatedFromPanels,
    dialogueCharacters: lines.reduce((total, item) => total + dialogueMetrics(item.text).characters, 0),
    dialogueLineCount: lines.length,
    dialogueSeconds,
    visualSeconds,
    actionReactionSeconds,
    requiredSeconds,
    deltaSeconds,
    localWindowOverrunSeconds,
    status,
    dialogueSource: promptDialogue.length ? "generated-japanese" : sourceDialogue.length ? "source-dialogue" : "none",
  };
}

function timingEstimateLabel(estimate: ShotTimingEstimate, assignedDuration: number) {
  if (estimate.status === "over-model") return `估算需 ${estimate.requiredSeconds}s · 超出当前模型上限`;
  if (estimate.deltaSeconds < 0) return `估算需 ${estimate.requiredSeconds}s · 当前 ${assignedDuration}s · 超时 ${Math.abs(estimate.deltaSeconds)}s`;
  if (estimate.localWindowOverrunSeconds > 0.15) return `整体可装下 · 单句窗口抢词 ${estimate.localWindowOverrunSeconds.toFixed(1)}s`;
  if (estimate.deltaSeconds === 0) return `估算需 ${estimate.requiredSeconds}s · 当前 ${assignedDuration}s · 刚好`;
  if (estimate.status === "tight") return `估算需 ${estimate.requiredSeconds}s · 当前 ${assignedDuration}s · 偏挤`;
  return `估算需 ${estimate.requiredSeconds}s · 当前 ${assignedDuration}s · 余量 ${estimate.deltaSeconds}s`;
}

function timingEvidenceLabel(estimate: ShotTimingEstimate) {
  const visual = `${estimate.estimatedFromPanels ? "暂按画格估" : "预估"} ${estimate.segmentCount} 个分镜`;
  const speech = estimate.dialogueSource === "none" ? "暂无对白数据，待核对"
    : `${estimate.dialogueSource === "generated-japanese" ? "日语" : "原文暂估"} ${estimate.dialogueCharacters} 字 · ${estimate.dialogueLineCount} 句`;
  return `${visual} · ${speech}`;
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
    adaptationFocus: typeof settings.adaptationFocus === "string" ? settings.adaptationFocus : "",
    characterProfiles: normalizeCharacterProfiles(settings.characterProfiles),
    characters: [...settings.characters],
    props: [...settings.props],
    locations: [...settings.locations],
    timeline: [...settings.timeline],
    continuity: [...settings.continuity],
    modelRules: [...settings.modelRules],
    negative: [...settings.negative],
  };
}

function normalizeCharacterProfiles(value: unknown): CharacterProfile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const profile = item as Partial<CharacterProfile>;
    const text = (field: keyof CharacterProfile) => typeof profile[field] === "string" ? String(profile[field]).trim() : "";
    const name = text("name");
    if (!name) return [];
    return [{
      id: text("id") || `character-${index + 1}`,
      name,
      japaneseName: text("japaneseName"),
      biography: text("biography"),
      identity: text("identity"),
      appearance: text("appearance"),
      wardrobe: text("wardrobe"),
      performanceBoundary: text("performanceBoundary"),
      faceRestriction: text("faceRestriction"),
    }];
  });
}

function characterProfileRule(profile: CharacterProfile) {
  return [
    profile.name,
    profile.japaneseName ? `日文名：${profile.japaneseName}` : "",
    profile.biography ? `人物传：${profile.biography}` : "",
    profile.identity ? `身份关系：${profile.identity}` : "",
    profile.appearance ? `外形定妆：${profile.appearance}` : "",
    profile.wardrobe ? `服装：${profile.wardrobe}` : "",
    profile.performanceBoundary ? `表演边界：${profile.performanceBoundary}` : "",
    profile.faceRestriction ? `露脸限制：${profile.faceRestriction}` : "",
  ].filter(Boolean).join("；");
}

function allCharacterRules(settings: GlobalSettings) {
  return [...normalizeCharacterProfiles(settings.characterProfiles).map(characterProfileRule), ...settings.characters];
}

function cityHunterEpisodeNumber(projectTitle: string) {
  if (!/城市猎人|CITY\s*HUNTER/i.test(projectTitle)) return undefined;
  const matched = projectTitle.match(/第\s*(\d+)\s*[话話]/);
  return matched ? Number(matched[1]) : undefined;
}

function stripEpisode5BandageContamination(value: string) {
  return value
    // Episode 5 starts after the old hand-injury continuity. Keep legitimate
    // right-hand actions from the panels, but remove inherited injury rules.
    .replace(/獠的左掌包扎、/g, "")
    .replace(/左掌包扎、/g, "")
    .replace(/(?:本话)?(?:延续)?左掌贯通伤[^。；\n]*[。；]?/g, "")
    .replace(/(?:冴羽獠|獠)?的?左掌[^。；\n]*(?:包扎|绷带|贯通伤|伤口|受伤)[^。；\n]*[。；]?/g, "")
    .replace(/(?:完整)?(?:包扎|绷带)[^。；\n]*(?:左掌|左手)[^。；\n]*[。；]?/g, "")
    .replace(/左手[^。；\n]*(?:承重|抓握|发力|持枪|托枪|参与)[^。；\n]*[。；]?/g, "")
    .replace(/负责判断风险并处理獠的左掌伤口/g, "负责判断风险并提供情报支援")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/，\s*，/g, "，")
    .replace(/；\s*；/g, "；")
    .replace(/。\s*。/g, "。")
    .replace(/：\s*[；。]/g, "：")
    .trim();
}

function sanitizeEpisode5Value<T>(value: T): T {
  if (typeof value === "string") return stripEpisode5BandageContamination(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeEpisode5Value(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeEpisode5Value(item)])) as T;
  }
  return value;
}

function completeGlobalSettingsForReviews(projectTitle: string, reviews: ShotReview[], settings: GlobalSettings): GlobalSettings {
  const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  const episodeNumber = cityHunterEpisodeNumber(projectTitle);
  const isCityHunterProject = episodeNumber !== undefined || /城市猎人|CITY\s*HUNTER/i.test(projectTitle);
  const isCityHunterEpisode3 = episodeNumber === 3;
  const isCityHunterEpisode5 = episodeNumber === 5;
  const projectSettings = isCityHunterEpisode5 ? sanitizeEpisode5Value(cloneGlobalSettings(settings)) : cloneGlobalSettings(settings);
  const shots = reviews.map((review) => normalizeShot(review.shot));
  if (!shots.some((shot) => shot.sourcePanels?.length)) return projectSettings;
  const characters = unique(shots.flatMap((shot) => shot.characters));
  const props = unique(shots.flatMap((shot) => shot.props));
  const locations = unique(shots.map((shot) => shot.scene));
  const continuity = unique(shots.flatMap((shot) => shot.continuity));
  const negative = unique(shots.flatMap((shot) => shot.negative));
  const timeline = shots.map((shot) => `Shot ${shot.id} · ${shot.timecode} · ${shot.title}：${shot.story}`);
  const styleCandidates = unique(shots.map((shot) => shot.artStyle).filter((style) => (
    style && !/待从原始|未明确前|不向视频提示词擅自添加/.test(style)
  )));
  const cityHunterProfiles: Record<string, string> = {
    "冴羽獠": `冴羽獠：全名固定为冴羽獠，30岁，身高186cm，肩宽、身体强壮；以东京新宿为据点的地下清道夫“城市猎人”，枪法精准、观察与犯罪心理判断敏锐。日常状态嘻嘻哈哈、爱开玩笑、略带无赖和轻佻感，表情活跃；只有真正涉及死亡、灭口、保护委托人或进入战斗的大事时，才短暂转为严肃正经、冷静果断。严肃状态结束后自然恢复轻松，不得全程板脸。${isCityHunterEpisode3 ? "本话延续左掌贯通伤并完成包扎，主要持枪和控制动作由右手完成。" : ""}`,
    "槇村": `槇村秀幸：全名固定为槇村秀幸，32岁，身高180cm，体型偏瘦；冴羽獠在故事早期的搭档与情报支援者，理性、稳重，负责判断风险并提供情报支援；不能误写成槇村香。${isCityHunterEpisode3 ? "本话负责处理獠的左掌伤口。" : ""}`,
    "槇村秀幸": `槇村秀幸：全名固定为槇村秀幸，32岁，身高180cm，体型偏瘦；冴羽獠在故事早期的搭档与情报支援者，理性、稳重，负责判断风险并提供情报支援；不能误写成槇村香。${isCityHunterEpisode3 ? "本话负责处理獠的左掌伤口。" : ""}`,
    "槇村香": "槇村香：19岁，身高170cm，槇村秀幸的妹妹；真实日本年轻女演员，短发、带女孩稚气，外形与服装具有偏男性化的中性气质，但声音明确为自然年轻女声。她直率、倔强、行动果断，不能误写成男性或槇村秀幸。",
    "香": "槇村香：19岁，身高170cm，槇村秀幸的妹妹；真实日本年轻女演员，短发、带女孩稚气，外形与服装具有偏男性化的中性气质，但声音明确为自然年轻女声。她直率、倔强、行动果断，不能误写成男性或槇村秀幸。",
    "亜月菜摘": "亜月菜摘：24岁，身高167cm，遇害少女亜月裕子的姐姐和本案委托人；自然披散长发，因追查妹妹死因雇佣城市猎人。她勇敢、直率但并非职业战斗人员，本话既是需要保护的委托人，也被獠作为引出凶手的公开诱饵。",
    "菜摘": "亜月菜摘：24岁，身高167cm，遇害少女亜月裕子的姐姐和本案委托人；自然披散长发，因追查妹妹死因雇佣城市猎人。她勇敢、直率但并非职业战斗人员，本话既是需要保护的委托人，也被獠作为引出凶手的公开诱饵。",
    "亜月裕子": "亜月裕子：17岁高中生、菜摘的妹妹，上一话被BMW恶魔杀害；她是案件的受害者与菜摘委托獠的直接动因，本话不得让她无依据复活或重新佩戴已经失去连续依据的象牙白围巾。",
    "裕子": "亜月裕子：17岁高中生、菜摘的妹妹，上一话被BMW恶魔杀害；她是案件的受害者与菜摘委托獠的直接动因，本话不得让她无依据复活或重新佩戴已经失去连续依据的象牙白围巾。",
    "幕后男子": "BMW男子／幕后老板：与杀害裕子的黑色BMW案件相关的连环凶手或幕后者，享乐主义、冷酷且会灭口情报贩子；五官继续隐藏，不能提前把其他刺客或情报贩子自动等同于他。",
    "BMW男子": "BMW男子／幕后老板：与杀害裕子的黑色BMW案件相关的连环凶手或幕后者，享乐主义、冷酷且会灭口情报贩子；五官继续隐藏，不能提前把其他刺客或情报贩子自动等同于他。",
    "情报贩子": "情报贩子：为BMW男子提供街头消息的下线；察觉菜摘雇佣城市猎人后拒绝继续合作，并因失去利用价值被老板开枪灭口。",
    "刺客": "公寓刺客：受命进入公寓刺杀城市猎人的执行者，使用半自动手枪并误射床铺；不自动等同BMW司机，最终被獠从侧后方以右手持枪控制。",
  };
  const profiledCharacters = isCityHunterProject
    ? unique(unique([...(projectSettings.characters || []), ...characters]).map((name) => (
        cityHunterProfiles[name]
        || Object.entries(cityHunterProfiles).find(([key]) => key.length >= 2 && name.includes(key))?.[1]
        || name
      )))
    : projectSettings.characters.length ? projectSettings.characters : characters;
  const derivedBackground = isCityHunterEpisode3
    ? `《城市猎人》第3话紧接第2话“BMW的恶魔”事件，时代与空间锁定为昭和62年（1987年）冬季的东京新宿。冴羽獠30岁、186cm、肩宽强壮，是以新宿为据点、拥有顶尖枪法与敏锐洞察力的地下清道夫“城市猎人”；搭档槇村秀幸32岁、180cm、体型偏瘦；本案委托人亜月菜摘24岁、167cm，是遇害少女亜月裕子的姐姐。裕子遭黑色BMW相关凶手杀害后，菜摘雇佣獠追查；BMW男子仍未落网，司机五官不能提前揭示。獠在上一话追查中左掌受到贯通伤，本话开始由槇村秀幸完成清洁和包扎，因此左手持续受伤并保持绷带，持枪和主要控制动作由右手完成。黑色BMW只是獠公开放出的诱饵线索，他的目的是真正引出掌握街头情报、已经连续杀害五名女性的幕后凶手。本话从情报贩子向老板发出最后警告并遭灭口开始，随后转入獠、槇村秀幸与菜摘的公寓诱敌、夜袭反制及翌夜歌舞伎町威胁。全片角色只说自然日语，画面、字幕与声音中不得出现中文；全程无BGM，只保留日语对白、同期环境声和动作音效。漫画画格、原文对白和用户批注是最高事实依据；联网资料只补充人物身份、作品时代与新宿世界观，不得改写本话事件。`
    : isCityHunterEpisode5
      ? `《城市猎人》第5话《闇からの狙撃者！之卷》。时间固定为昭和62年（1987年）春季东京新宿。冴羽獠与槇村秀幸仍是“城市猎人”搭档，19岁的槇村香在本话进入故事。香因偏男性化的中性装束引发街头性别误会，随后被卷入精品店人口贩卖组织设置的试衣间机关；獠进入黑暗空间救援，并面对占据夜视优势的敌人。具体人物身份、对白、动作、枪械、服装、场景和结果全部以本次上传的原作画格与用户批注为最高证据；不得混入第4话BMW案件、亜月菜摘、亜月裕子、港区追逐或冬季天气。全片角色只说自然日语，中文只作制作备注；全程无BGM，只保留日语对白、同期环境声和动作音效。`
    : `${projectTitle}。故事按当前漫画画格顺序连续展开。主要人物：${characters.join("、") || "以画格为准"}。主要地点：${locations.join("、") || "以画格为准"}。剧情链：${timeline.join("；")}。漫画画格、原文对白和用户批注是最高事实依据，背景只补充时代、人物关系和因果，不得替画格编造事件。`;
  const cityHunterStyle = isCityHunterEpisode5
    ? "昭和62年（1987年）春季东京新宿背景的写实日本真人35mm电影风格。所有角色由真实日本演员出演，并按现实世界重新选角、化妆和造型；保留冴羽獠肩宽强壮的体格、槇村秀幸偏瘦的轮廓与槇村香19岁、170cm、带稚气的中性气质。摄影采用1980年代日本35mm彩色胶片质感，颗粒细密，反差克制，高光轻微晕染，暗部保留层次；春季自然日光、旧式荧光灯和钨丝灯形成可信混合光。街道、公寓、精品店、地下仓库、招牌、电话、枪械、服装与室内陈设严格符合1987年日本。表演遵循真人物理，视线先行、重心清楚、动作利落，幽默、警惕和危险落在细小表情与人物距离上。角色五官、体型、参考服装和场景光色跨镜统一。整体保持真实摄影、真实布景、真实材质与克制调色，避免塑料质感、现代数字设备、现代车辆、过度霓虹、水印、乱码文字和任何中文画面文字。"
    : "昭和62年（1987年）东京新宿背景的写实日本真人35mm电影风格。所有角色均由真实日本演员出演，并按现实世界重新选角、化妆和造型，呈现真实皮肤纹理、毛发、眼神、呼吸、肌肉受力与衣料褶皱。摄影采用1980年代日本35mm胶片质感，颗粒细密，反差克制，高光轻微晕染，暗部保留层次；街道、公寓、招牌、电话、枪械、车辆、服装与室内陈设严格符合1987年日本。表演和动作遵循真人物理，视线先行、重心转移清楚。整体保持真实摄影、真实布景、真实材质与克制调色，避免塑料质感、现代数字设备、现代车辆、过度霓虹、水印、乱码文字和任何中文画面文字。";
  const currentStyle = projectSettings.finalVideoStyle?.trim();
  const rejectedCityHunterAnimationStyle = isCityHunterProject && /\u8d5b\u7490\u7490|\u624b\u7ed8\u52a8\u753b|\u7981\u6b62\u771f\u4eba\u5199\u5b9e/.test(currentStyle || "");
  const validCurrentStyle = currentStyle && !rejectedCityHunterAnimationStyle && !/待从原始|未明确前|不向视频提示词擅自添加/.test(currentStyle);
  const enforceShowa62 = (value: string) => {
    const normalized = value
      .replaceAll("昭和60年（1985年）", "昭和62年（1987年）")
      .replaceAll("昭和60年", "昭和62年")
      .replaceAll("1985年", "1987年");
    return /昭和62年/.test(normalized) ? normalized : `时代硬锁：昭和62年（1987年）。${normalized}`;
  };
  return {
    ...projectSettings,
    storyBackground: isCityHunterProject
      ? enforceShowa62(projectSettings.storyBackground?.trim() || derivedBackground)
      : projectSettings.storyBackground?.trim() || derivedBackground,
    characters: profiledCharacters,
    props: projectSettings.props.length ? projectSettings.props : props,
    locations: projectSettings.locations.length ? projectSettings.locations : locations,
    timeline: unique([
      ...(isCityHunterProject ? [isCityHunterEpisode5
        ? "时代烙印：昭和62年（1987年）春季东京新宿；街道、公寓、精品店、车辆、枪械、服装、电话和室内设施均保持昭和末期形态，禁止任何现代数字生活痕迹。"
        : "时代烙印：昭和62年（1987年）东京新宿；街道、公寓、车辆、枪械、服装、电话和室内设施均保持昭和末期形态，禁止任何现代数字生活痕迹。"] : []),
      ...(projectSettings.timeline.length ? projectSettings.timeline : timeline),
    ]),
    continuity: unique([
      ...(projectSettings.continuity || []),
      ...continuity,
      ...(isCityHunterProject ? [
        "全片对白统一为自然日语；中文原文只作制作理解依据，不得成为角色台词、旁白、字幕或画面文字。",
        "全程无BGM；只保留日语对白、同期环境声、脚步、枪械、衣料、车辆和其他剧情动作音效。",
        "中文只允许作为导演阅读的制作备注；日语台词后的中文释义不得朗读、不得上字幕、不得出现在画面中。",
        "人物表演遵循触发—行动—反应：说话时有明确对象，眼神先于头部和身体，动作完成后保留可见的情绪结果与关系反馈。",
      ] : []),
    ]),
    finalVideoStyle: isCityHunterProject
      ? enforceShowa62(validCurrentStyle ? currentStyle : cityHunterStyle)
      : validCurrentStyle ? currentStyle : styleCandidates[0] || "以当前漫画画格的角色与场景证据为准，保持跨镜统一的传统手绘动画成片风格。",
    modelRules: unique([
      ...(projectSettings.modelRules || []),
      ...(isCityHunterProject ? [
        "活人感表演：每镜只有一个主事件，明确触发、执行和结果；主要人物发起动作，其他人物依次回应，禁止所有人同步乱动。",
        "说话、动作、眼神和情绪必须互相因果：先看见或听见，再理解，再行动，最后让情绪落在眼睛、嘴角、下颌、肩颈、手部停顿和身体重心上。",
        "小动作低频且有目的，优先目光追随、重心转移、空间让位、手部停顿、道具交接和同伴反馈；禁止靠反复眨眼、摸头发、拉衣服或叹气伪装自然。",
      ] : []),
    ]),
    negative: unique([
      ...(projectSettings.negative || []),
      ...negative,
      ...(isCityHunterProject ? ["禁止成片出现中文对白、中文字幕、中文旁白和中文画面文字；提示词中的中文制作备注不属于成片内容。", "禁止任何背景音乐、配乐、主题曲或情绪音乐。"] : []),
    ]),
  };
}

function isGlobalSettings(value: unknown): value is GlobalSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Record<string, unknown>;
  return globalArrayFields.every((field) => Array.isArray(settings[field]) && (settings[field] as unknown[]).every((item) => typeof item === "string"))
    && (settings.storyBackground === undefined || typeof settings.storyBackground === "string")
    && (settings.adaptationFocus === undefined || typeof settings.adaptationFocus === "string")
    && (settings.characterProfiles === undefined || normalizeCharacterProfiles(settings.characterProfiles).length === (settings.characterProfiles as unknown[]).length)
    && typeof settings.finalVideoStyle === "string"
    && typeof settings.storyboardImageStyle === "string";
}

function createReview(sourceShot: StoryboardShot, useDefaultProjectPlans = true, projectUid = "project-legacy", identitySeed = sourceShot.id): ShotReview {
  const normalized = normalizeShot(sourceShot);
  const shot = {
    ...normalized,
    shotUid: ensureShotUid(normalized.shotUid, projectUid, `${identitySeed}::${(normalized.sourcePanels || []).join("|")}`),
  };
  const directorViews = getDirectorViews(shot, useDefaultProjectPlans);
  return {
    shot,
    annotations: emptyAnnotations(),
    scriptStatus: "draft",
    artworkStatus: "empty",
    selectedDirectorView: directorViews[0].key,
    whiteboxScenes: ensureWhiteboxScenes(undefined, directorViews.map((view) => ({ key: view.key, title: view.title })), shot.id, useDefaultProjectPlans),
    seededAssetReferenceIds: [],
    promptReviewStatus: "empty",
    approved: false,
    versions: [],
  };
}

function invalidatePromptReview(review: ShotReview): ShotReview {
  return {
    ...review,
    promptReviewStatus: review.promptReviewReport ? "stale" : "empty",
    promptReviewSourceRevision: undefined,
    promptReviewedAt: undefined,
    promptReviewRequestId: undefined,
    promptReviewError: undefined,
    approved: false,
    approvedAt: undefined,
  };
}

function invalidateCompletePrompt(review: ShotReview): ShotReview {
  if (!review.completePromptConfirmedAt && !review.completePrompt && !review.promptReviewReport) return review;
  return {
    ...invalidatePromptReview(review),
    completePromptStatus: review.completePrompt ? "stale" : "empty",
    completePromptConfirmedAt: undefined,
  };
}

function createReviews(shots: StoryboardShot[], useDefaultProjectPlans = true, projectUid = "project-legacy"): ShotReview[] {
  return shots.map((shot, index) => createReview(shot, useDefaultProjectPlans, projectUid, `${index}::${shot.id}`));
}

function createInitialState(): ReviewState {
  const projectUid = ensureProjectUid("", storyboardSourceRevision);
  return {
    stateSchemaVersion,
    projectUid,
    projectTitle: defaultProjectTitle,
    sourceDocument: sourceDocumentFromShots(storyboardShots),
    sourceName: "空白项目模板",
    selectedRecipeId: defaultDirectorRecipeId,
    generationModel: defaultGenerationModel,
    workspaceMode: "shots",
    globalSettings: cloneGlobalSettings(),
    assetPrompts: [],
    globalAnnotation: "",
    globalStatus: "applied",
    structureStatus: "confirmed",
    currentShot: 0,
    view: "script",
    reviews: createReviews(storyboardShots, false, projectUid),
  };
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

function normalizeMangaPanelUnderstandings(value: unknown): Record<string, MangaPanelUnderstanding> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([panelId, candidate]) => {
    if (!/^P\d{2}-(?:[RL]-)?G\d{2}$/i.test(panelId) || !candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<MangaPanelUnderstanding>;
    if (typeof item.sourceObservation !== "string" || typeof item.textSummary !== "string") return [];
    const dialogue = Array.isArray(item.dialogue) ? item.dialogue.flatMap((line) => (
      line && typeof line === "object"
      && typeof line.speaker === "string"
      && typeof line.text === "string"
      && (line.confidence === "high" || line.confidence === "medium" || line.confidence === "low")
        ? [{ speaker: line.speaker, text: line.text, confidence: line.confidence }]
        : []
    )) : [];
    return [[panelId, {
      sourceObservation: item.sourceObservation,
      textSummary: item.textSummary,
      dialogue,
      characters: isStringArray(item.characters) ? item.characters : [],
      relationAndPlot: typeof item.relationAndPlot === "string" ? item.relationAndPlot : item.textSummary,
    }]];
  }));
}

function mangaPanelUnderstandingsFrom(result: MediaAnalysisResult): Record<string, MangaPanelUnderstanding> {
  return Object.fromEntries((result.mangaPages || []).flatMap((page) => page.panels.map((panel) => {
    const sourceShot = result.shots.find((shot) => shot.sourcePanels.includes(panel.id));
    const dialogue = result.sourceText
      .filter((line) => line.location === panel.id)
      .map((line) => ({ speaker: line.speaker, text: line.text, confidence: line.confidence }));
    const characters = sourceShot?.characters || [...new Set(dialogue.map((line) => line.speaker).filter((speaker) => !/^(旁白|拟声词|画面文字|标题)$/.test(speaker)))];
    const relationAndPlot = sourceShot
      ? `${panel.textSummary} 本格属于“${sourceShot.title}”：${sourceShot.story}`
      : panel.textSummary;
    return [panel.id, { sourceObservation: panel.sourceObservation, textSummary: panel.textSummary, dialogue, characters, relationAndPlot }];
  })));
}

function normalizeMangaPanelAnnotations(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([panelId, note]) => /^P\d{2}-(?:[RL]-)?G\d{2}$/i.test(panelId) && typeof note === "string"));
}

function mergeProjectAssetPrompts(existing: unknown, incoming: unknown): ProjectAssetPrompt[] {
  const result = [...normalizeProjectAssetPrompts(existing)];
  for (const candidate of normalizeProjectAssetPrompts(incoming)) {
    const index = result.findIndex((item) => item.id === candidate.id);
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

type StableShotIdentity = {
  shotUid: string;
  fallbackId: string;
};

function stableShotIdentity(shot: StoryboardShot): StableShotIdentity {
  return {
    shotUid: String(shot.shotUid || "").trim(),
    fallbackId: shot.id,
  };
}

function matchesStableShotIdentity(shot: StoryboardShot, identity: StableShotIdentity) {
  const shotUid = String(shot.shotUid || "").trim();
  return identity.shotUid ? shotUid === identity.shotUid : shot.id === identity.fallbackId;
}

function bridgeJobMatchesStableShot(job: BridgeJob | undefined, projectUid: string, identity: StableShotIdentity) {
  if (!job) return false;
  if (job.projectUid && job.projectUid !== projectUid) return false;
  const jobShotUid = String(job.shotUid || "").trim();
  if (identity.shotUid && jobShotUid) return identity.shotUid === jobShotUid;
  return job.shotId === identity.fallbackId;
}

function completePromptResultMatchesStableShot(result: CompleteShotPromptResult, projectUid: string, identity: StableShotIdentity) {
  if (result.projectUid && result.projectUid !== projectUid) return false;
  const resultShotUid = String(result.shotUid || "").trim();
  if (identity.shotUid && resultShotUid) return identity.shotUid === resultShotUid;
  return result.shotId === identity.fallbackId;
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

function normalizeReviewForResume(review: ShotReview, projectUid = "project-legacy", identitySeed = review.shot.id, _useDefaultProjectPlans = false): ShotReview {
  const normalizedShot = normalizeShot(review.shot);
  const shot = {
    ...normalizedShot,
    shotUid: ensureShotUid(normalizedShot.shotUid, projectUid, `${identitySeed}::${(normalizedShot.sourcePanels || []).join("|")}`),
  };
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
    completePromptStatus: review.completePromptStatus === "generating"
      || review.completePromptStatus === "ready"
      || review.completePromptStatus === "stale"
      || review.completePromptStatus === "error"
      ? review.completePromptStatus
      : "empty",
    completePrompt: typeof review.completePrompt === "string" ? review.completePrompt : undefined,
    completePromptSummary: typeof review.completePromptSummary === "string" ? review.completePromptSummary : undefined,
    completePromptResearch: review.completePromptResearch && typeof review.completePromptResearch === "object"
      ? review.completePromptResearch
      : undefined,
    completePromptWarnings: Array.isArray(review.completePromptWarnings) ? review.completePromptWarnings.filter((item) => typeof item === "string") : [],
    completePromptGeneratedAt: typeof review.completePromptGeneratedAt === "string" ? review.completePromptGeneratedAt : undefined,
    completePromptSourceRevision: typeof review.completePromptSourceRevision === "string" ? review.completePromptSourceRevision : undefined,
    completePromptConfirmedAt: typeof review.completePromptConfirmedAt === "string" ? review.completePromptConfirmedAt : undefined,
    completePromptGeneratorId: typeof review.completePromptGeneratorId === "string" && review.completePromptGeneratorId.trim()
      ? review.completePromptGeneratorId.trim()
      : review.completePrompt ? legacyUnknownModelId : undefined,
    completePromptGeneratorProvider: typeof review.completePromptGeneratorProvider === "string" && review.completePromptGeneratorProvider.trim()
      ? review.completePromptGeneratorProvider.trim()
      : undefined,
    completePromptRequestedGeneratorId: typeof review.completePromptRequestedGeneratorId === "string" && review.completePromptRequestedGeneratorId.trim()
      ? review.completePromptRequestedGeneratorId.trim()
      : undefined,
    promptReviewerId: typeof review.promptReviewerId === "string" && review.promptReviewerId.trim()
      ? review.promptReviewerId.trim()
      : defaultPromptReviewerId,
    promptReviewerModel: typeof review.promptReviewerModel === "string" && review.promptReviewerModel.trim()
      ? review.promptReviewerModel.trim()
      : undefined,
    promptReviewStatus: review.promptReviewStatus === "reviewing"
      ? "stale"
      : review.promptReviewStatus === "ready" || review.promptReviewStatus === "stale" || review.promptReviewStatus === "error"
        ? review.promptReviewStatus
        : "empty",
    promptReviewReport: review.promptReviewReport && typeof review.promptReviewReport === "object"
      ? review.promptReviewReport
      : undefined,
    promptReviewSourceRevision: typeof review.promptReviewSourceRevision === "string" ? review.promptReviewSourceRevision : undefined,
    promptReviewedAt: typeof review.promptReviewedAt === "string" ? review.promptReviewedAt : undefined,
    promptReviewRequestId: typeof review.promptReviewRequestId === "string" ? review.promptReviewRequestId : undefined,
    promptReviewError: typeof review.promptReviewError === "string" ? review.promptReviewError : undefined,
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
  const serializedIncoming = JSON.stringify(incoming);
  const episode5HadBandageContamination = cityHunterEpisodeNumber(incoming.projectTitle || "") === 5
    && /左掌贯通伤|左掌包扎|左掌[^。；\n]*(?:绷带|包扎|贯通伤|伤口|受伤)|(?:绷带|包扎)[^。；\n]*(?:左掌|左手)|左手[^。；\n]*(?:承重|抓握|发力|持枪|托枪|参与)|处理獠的左掌伤口/.test(serializedIncoming);
  if (episode5HadBandageContamination) incoming = sanitizeEpisode5Value(incoming);
  const requiresExplicitRestamp = !incoming.stateSchemaVersion || incoming.stateSchemaVersion < 7;
  const projectUid = ensureProjectUid(incoming.projectUid, `${incoming.sourceMangaRequestId || ""}::${incoming.projectTitle || defaultProjectTitle}::${incoming.sourceName || ""}`);
  const sourceReviews = incoming.reviews.length ? incoming.reviews : createReviews(storyboardShots, false, projectUid);
  const reviews = sourceReviews.map((review, index) => {
    const normalized = normalizeReviewForResume(review, projectUid, `${index}::${review.shot.id}`);
    return requiresExplicitRestamp ? { ...normalized, approved: false, approvedAt: undefined } : normalized;
  });
  const currentShot = Math.min(Math.max(0, incoming.currentShot || 0), Math.max(0, reviews.length - 1));
  const resumedGlobalSettings = completeGlobalSettingsForReviews(
    incoming.projectTitle || defaultProjectTitle,
    reviews,
    cloneGlobalSettings(isGlobalSettings(incoming.globalSettings) ? incoming.globalSettings : sourceGlobalSettings),
  );
  const replacedCityHunterAnimationStyle = /城市猎人|CITY\s*HUNTER/i.test(incoming.projectTitle || "")
    && /\u8d5b\u7490\u7490|\u624b\u7ed8\u52a8\u753b|\u7981\u6b62\u771f\u4eba\u5199\u5b9e/.test(incoming.globalSettings?.finalVideoStyle || "")
    && /写实日本真人都市动作电影/.test(resumedGlobalSettings.finalVideoStyle);
  const resumedReviews = replacedCityHunterAnimationStyle
    ? reviews.map((item) => ({
        ...item,
        completePromptStatus: "empty" as CompleteShotPromptStatus,
        completePrompt: undefined,
        completePromptSummary: "最终美术风格已改为写实真人电影，请按新风格重新生成。",
        completePromptResearch: undefined,
        completePromptWarnings: [],
        completePromptGeneratedAt: undefined,
        completePromptSourceRevision: undefined,
        completePromptConfirmedAt: undefined,
      }))
    : reviews;
  const migratedReviews = episode5HadBandageContamination
    ? resumedReviews.map((item) => ({
        ...invalidatePromptReview(item),
        completePromptStatus: item.completePrompt ? "stale" as CompleteShotPromptStatus : item.completePromptStatus,
        completePromptSummary: item.completePrompt
          ? "已全局移除第5话误继承的左掌伤势与包扎规则；请继续讨论或重新生成后再审查。"
          : item.completePromptSummary,
      }))
    : resumedReviews;
  return {
    ...incoming,
    stateSchemaVersion,
    projectUid,
    projectTitle: incoming.projectTitle || defaultProjectTitle,
    sourceDocument: typeof incoming.sourceDocument === "string" && incoming.sourceDocument.trim()
      ? incoming.sourceDocument
      : sourceDocumentFromShots(reviews.map((review) => review.shot)),
    sourceName: typeof incoming.sourceName === "string" && incoming.sourceName.trim()
      ? incoming.sourceName
      : "载入项目",
    selectedRecipeId: getDirectorRecipe(incoming.selectedRecipeId).id,
    generationModel: incoming.generationModel === "seedance-2.0" || incoming.generationModel === "seedance-2.5"
      ? incoming.generationModel
      : defaultGenerationModel,
    workspaceMode: incoming.workspaceMode === "global"
      || incoming.workspaceMode === "materials"
      || incoming.workspaceMode === "coverage"
      || incoming.workspaceMode === "assets"
      ? incoming.workspaceMode
      : "shots",
    globalSettings: resumedGlobalSettings,
    globalFileId: typeof incoming.globalFileId === "string" ? incoming.globalFileId : undefined,
    globalFileName: typeof incoming.globalFileName === "string" ? incoming.globalFileName : undefined,
    assetPrompts: normalizeProjectAssetPrompts(incoming.assetPrompts),
    globalAnnotation: typeof incoming.globalAnnotation === "string" ? incoming.globalAnnotation : "",
    globalStatus: incoming.globalStatus === "sending"
      || incoming.globalStatus === "error"
      || incoming.globalStatus === "draft"
      ? incoming.globalStatus
      : "applied",
    globalSummary: episode5HadBandageContamination
      ? "已迁移第5话项目：全局移除误继承自旧话的左掌伤势、绷带及左手限制。"
      : typeof incoming.globalSummary === "string" ? incoming.globalSummary : undefined,
    globalUpdatedAt: typeof incoming.globalUpdatedAt === "string" ? incoming.globalUpdatedAt : undefined,
    sourceMangaRequestId: /^[a-f0-9-]{36}$/i.test(incoming.sourceMangaRequestId || "")
      ? incoming.sourceMangaRequestId
      : undefined,
    sourceMangaPanels: normalizeMangaPanelUnderstandings(incoming.sourceMangaPanels),
    sourceMangaPanelUnderstandingVersion: incoming.sourceMangaPanelUnderstandingVersion === mangaPanelUnderstandingVersion
      ? mangaPanelUnderstandingVersion
      : undefined,
    sourceMangaPanelAnnotations: normalizeMangaPanelAnnotations(incoming.sourceMangaPanelAnnotations),
    sourceMangaReadingDirection: incoming.sourceMangaReadingDirection === "left-to-right" ? "left-to-right" : "right-to-left",
    sourceMangaReadingPages: Array.isArray(incoming.sourceMangaReadingPages) ? incoming.sourceMangaReadingPages : undefined,
    structureStatus: replacedCityHunterAnimationStyle || episode5HadBandageContamination
      ? "draft"
      : incoming.structureStatus === "draft" || incoming.structureStatus === "confirmed"
      ? incoming.structureStatus
      : incoming.sourceMangaRequestId ? "draft" : "confirmed",
    structureConfirmedAt: replacedCityHunterAnimationStyle || episode5HadBandageContamination
      ? undefined
      : typeof incoming.structureConfirmedAt === "string" ? incoming.structureConfirmedAt : undefined,
    currentShot,
    view: requiresExplicitRestamp ? "script" : incoming.view,
    reviews: migratedReviews,
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

  const summary = result.summary || "写作模型已应用批注";
  const version = (current.versions.at(-1)?.version ?? 0) + 1;
  const revisedShot = normalizeShot({ ...result.shot, shotUid: current.shot.shotUid }, previous.projectTitle === defaultProjectTitle);
  const reviews = [...previous.reviews];
  reviews[reviewIndex] = {
    ...current,
    shot: revisedShot,
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
      shot: revisedShot,
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
  const returned = new Map(result.shots.map((shot) => [shot.id, shot]));
  let appliedCount = 0;
  const reviews = previous.reviews.map((current) => {
    const returnedShot = returned.get(current.shot.id);
    if (!returnedShot) return current;
    const revisedShot = normalizeShot({ ...returnedShot, shotUid: current.shot.shotUid }, previous.projectTitle === defaultProjectTitle);
    if (expectedSubmissionAt && current.pendingSubmission?.submittedAt !== expectedSubmissionAt) return current;
    if (current.scriptStatus === "applied" && !current.pendingSubmission) return current;

    appliedCount += 1;
    const summary = result.summary || "写作模型已应用全片批注";
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
  const characterRules = allCharacterRules(settings).filter((rule) => ruleMatches(rule, shot.characters));
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

  return `只生成《${projectTitle}》镜头 ${shot.id}，不要生成其他镜头。\n出图模型：Lib Image。\n用途：为 ${generationModels.find((item) => item.id === generationModel)?.label} 视频生成准备临时导演预演分镜参考图；它只负责锁定剧情、场景、站位和动作，不代表最终视频美术风格，也不是视频提示词的复制品。\n项目故事背景（只作时代与因果上下文，不得覆盖本镜证据）：${settings.storyBackground}\n临时工作分镜画法：${settings.storyboardImageStyle || storyboardArtworkStyle}\n适用于本镜的全局硬锁（优先级最高）：${globalRules.join("；")}\n人物：${shot.characters.join("；")}\n关键物品：${shot.props.join("；")}\n场景：${shot.scene}\n全能参考（${omniReferences.length}/${referenceLimit}）：${omniReferences.join("；")}\n剧情：${shot.story}\n站位与构图：${shot.composition}\n镜头：${shot.camera}\n动作：${shot.action}${segments}\n\n连续性：${shot.continuity.join("；")}\n禁止：${shot.negative.join("；")}\n\n全能参考总数严禁超过 ${referenceLimit} 个；普通物品不占参考位。无对白气泡、无水印。让导演一眼看懂剧情、物品、场景、站位、视线和动作路径。临时工作图只提供构图与动作依据，不改变最终视频画风。`;
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

async function putArtworks(storageScope: string, shotId: string, dataUrls: string[]) {
  if (!storageScope) throw new Error("图片租户作用域尚未确认");
  const db = await openArtworkDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("images", "readwrite");
    transaction.objectStore("images").put(dataUrls, `${storageScope}::${shotId}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getArtworks(storageScope: string, shotId: string): Promise<string[]> {
  if (!storageScope) throw new Error("图片租户作用域尚未确认");
  const db = await openArtworkDb();
  const value = await new Promise<string | string[] | undefined>((resolve, reject) => {
    const request = db.transaction("images", "readonly").objectStore("images").get(`${storageScope}::${shotId}`);
    request.onsuccess = () => resolve(request.result as string | string[] | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return Array.isArray(value) ? value : value ? [value] : [];
}

async function deleteArtworks(storageScope: string, shotId: string) {
  if (!storageScope) throw new Error("图片租户作用域尚未确认");
  const db = await openArtworkDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("images", "readwrite");
    transaction.objectStore("images").delete(`${storageScope}::${shotId}`);
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

function shotAssetStorageKey(projectTitle: string, shotId: string, asset: ShotAssetEntry) {
  return `${projectTitle}::shot-asset-v2::shot-${encodeURIComponent(shotId)}::${asset.kind}::${encodeURIComponent(asset.name.normalize("NFKC"))}`;
}

function shotAssetAttemptStorageKey(projectTitle: string, shotId: string, asset: ShotAssetEntry) {
  return `${shotAssetStorageKey(projectTitle, shotId, asset)}::attempt`;
}

function defaultShotAssetPrompt(asset: ShotAssetEntry, shot: StoryboardShot, settings: GlobalSettings) {
  const finalVideoStyle = settings.finalVideoStyle.trim() || shot.artStyle;
  const compactStyle = finalVideoStyle;
  const backgroundSummary = settings.storyBackground.split("。").map((item) => item.trim()).filter(Boolean).slice(0, 2).join("。 ");
  const style = compactStyle.trim() && compactStyle !== defaultArtStyle
    ? `最终视频美术风格：${compactStyle}。`
    : "最终视频美术风格尚未确认；只锁定来源中可见的身份与外观，不擅自套用任何画风。";
  const sourcePanels = shot.sourcePanels?.length ? `漫画来源格：${shot.sourcePanels.join("、")}。` : "";
  const common = `${backgroundSummary ? `项目背景：${backgroundSummary}。` : ""}${style}${sourcePanels}单一资产参考图，不是剧情分镜，不做多格拼图；干净背景，无文字、无水印，不生成无关人物或物品。`;
  if (asset.kind === "character") {
    const matchingReference = shot.omniReferences.find((item) => isShotAssetReference(item, asset));
    const profile = allCharacterRules(settings).find((item) => item.includes(asset.name)) || asset.name;
    return `人物资产：${asset.name}。全局人物画像：${profile}。从漫画画格中提取并保持该人物可见的年龄感、体型、脸型、发型、服装、身份气质和表情特征；漫画未画清的颜色、纹样或身体细节不要臆测。角色依据：${matchingReference || asset.name}。本镜身份与行为：${shot.story} ${shot.action}。只生成 Shot ${shot.id} 使用的独立人物参考图，不自动覆盖或替换其他 Shot 的资产。全身为主，站姿自然，正面略带三分之二角度，双手完整可见。${common}`;
  }
  if (asset.kind === "scene") {
    return `场景资产：${asset.name}。制作干净的场景空间参考图，清楚表现建筑结构、出入口、楼梯、可站位区域与纵深；本镜场景依据：${shot.scene}。画面内不出现人物。${common}`;
  }
  return `关键道具资产：${asset.name}。制作单件道具的清晰外观参考图，完整展示轮廓、材质、比例与关键结构，物体居中且不被遮挡。${common}`;
}

function projectAssetPromptFor(prompts: ProjectAssetPrompt[] | undefined, asset: ShotAssetEntry, shotId: string) {
  return (prompts || []).find((item) => item.shotIds.length === 1 && item.shotIds[0] === shotId && item.kind === asset.kind && shotAssetId(item.kind, cleanShotAssetName(item.name, item.kind)) === asset.id);
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

async function getArtworksForShot(storageScope: string, projectTitle: string, shotId: string) {
  return getArtworks(storageScope, artworkStorageKey(projectTitle, shotId));
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

function CharacterTextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="character-profile-field compact">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function CharacterTextArea({ label, value, rows = 3, onChange }: { label: string; value: string; rows?: number; onChange: (value: string) => void }) {
  return (
    <label className="character-profile-field">
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
  const path = `${bridgeBase}/media-panel/${encodeURIComponent(requestId)}/${encodeURIComponent(panelId)}`;
  return pairingToken ? `${path}?token=${encodeURIComponent(pairingToken)}` : path;
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
  children,
}: {
  section: (typeof sections)[number];
  children: ReactNode;
}) {
  return (
    <article className="script-block">
      <header>
        <span>{section.number}</span>
        <div><h2>{section.title}</h2><p>{section.hint}</p></div>
      </header>
      <div className="script-content">{children}</div>
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
    return <div className="stage-sketch"><div role="status"><b>尚未生成当前 Shot 的站位图</b><p>当前提示词尚未转换为人物坐标、朝向与机位数据。下方文字是构图说明，不是已经生成的站位图。</p></div><div className="sketch-scene">{shot.scene}</div><p>{shot.composition}</p></div>;
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

function DirectorDesk() {
  const tenantScope = useManjingWorkspaceScope();
  const scopedBrowserStorage = useMemo(
    () => manjingScopedBrowserStorage(tenantScope),
    [tenantScope],
  );
  const artworkStorageScope = tenantScope.storageScope;
  const [state, setState] = useState<ReviewState>(createInitialState);
  const [deskMode, setDeskMode] = useState<DeskMode>("creator");
  const [hydrated, setHydrated] = useState(false);
  const [projectArchiveLoaded, setProjectArchiveLoaded] = useState(tenantScope.mode === "local");
  const [activeStorageKey, setActiveStorageKey] = useState(storageKey);
  const [materialDraftMode, setMaterialDraftMode] = useState(false);
  const [bridge, setBridge] = useState<BridgeState>({ connected: false, busy: false });
  const [artworkRecord, setArtworkRecord] = useState<{ shotId: string; dataUrls: string[] }>({ shotId: "", dataUrls: [] });
  const [toast, setToast] = useState("");
  const [editingProjectTitle, setEditingProjectTitle] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [showLoader, setShowLoader] = useState(false);
  const [loadingScript, setLoadingScript] = useState(false);
  const [switchingWritingModelId, setSwitchingWritingModelId] = useState<WritingModelId | "">("");
  const [switchingReasoningEffort, setSwitchingReasoningEffort] = useState(false);
  const [writingModelOrder, setWritingModelOrder] = useState<WritingModelId[]>(() => writingModelCatalog.map((model) => model.id));
  const [dragOverWritingModelId, setDragOverWritingModelId] = useState<WritingModelId | "">("");
  const [loggingIntoLibtv, setLoggingIntoLibtv] = useState(false);
  const [stampingShotId, setStampingShotId] = useState("");
  const [savingGlobalSettings, setSavingGlobalSettings] = useState(false);
  const [globalFiles, setGlobalFiles] = useState<GlobalFileSummary[]>([]);
  const [selectedGlobalFileId, setSelectedGlobalFileId] = useState("");
  const [globalFileBusy, setGlobalFileBusy] = useState(false);
  const [globalFileNameDialog, setGlobalFileNameDialog] = useState<{ open: boolean; createNew: boolean }>({ open: false, createNew: false });
  const [globalFileNameDraft, setGlobalFileNameDraft] = useState("");
  const [globalFileNameError, setGlobalFileNameError] = useState("");
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
  const [selectedStructurePanelIds, setSelectedStructurePanelIds] = useState<string[]>([]);
  const [panelSelectionAnchor, setPanelSelectionAnchor] = useState("");
  const [structureHistory, setStructureHistory] = useState<ShotReview[][]>([]);
  const [draggedStructurePanelIds, setDraggedStructurePanelIds] = useState<string[]>([]);
  const [panelDropTarget, setPanelDropTarget] = useState<PanelDropTarget | null>(null);
  const [zoomedStructurePanelId, setZoomedStructurePanelId] = useState("");
  const [panelAssemblyScrollMetrics, setPanelAssemblyScrollMetrics] = useState({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const scriptInput = useRef<HTMLInputElement>(null);
  const artworkScroller = useRef<HTMLDivElement>(null);
  const panelAssemblyBottomScroller = useRef<HTMLDivElement>(null);
  const panelAssemblyScrollFrame = useRef(0);
  const draggedStructurePanelIdsRef = useRef<string[]>([]);
  const suppressStructurePanelClickRef = useRef(false);
  const importingMaterialDraftId = useRef("");
  const staleSendingSince = useRef<Record<string, number>>({});
  const staleArtworkSince = useRef<Record<string, number>>({});
  const recoveringAnnotationJob = useRef("");
  const recoveringArtworkJob = useRef("");
  const recoveringCompletePrompt = useRef("");
  const recoveringPromptReview = useRef("");
  const promptReviewSubmission = useRef(new Set<string>());
  const currentShotIdRef = useRef("");
  const writingModelMenuRef = useRef<HTMLDetailsElement>(null);
  const draggedWritingModelIdRef = useRef<WritingModelId | "">("");
  const touchWritingModelPointerRef = useRef<number | null>(null);
  const touchWritingModelTargetRef = useRef<WritingModelId | "">("");
  const suppressWritingModelClickRef = useRef(false);
  const appliedAgentDraftRevision = useRef("");

  const review = state.reviews[state.currentShot];
  const shot = normalizeShot(review.shot, state.projectTitle === defaultProjectTitle);
  const listProjectScope = `${state.projectUid}:${activeStorageKey}`;
  const shotListScope = `${listProjectScope}:${shot.shotUid || shot.id}`;
  const structureConfirmed = state.structureStatus !== "draft";
  const structurePanelEntries = state.reviews.flatMap((item, reviewIndex) => (item.shot.sourcePanels || []).map((panelId) => ({
    panelId,
    reviewIndex,
    shotId: item.shot.id,
    title: item.shot.title,
  })));
  const panelAssemblyLayoutSignature = state.reviews
    .map((item) => `${item.shot.id}:${(item.shot.sourcePanels || []).join(",")}`)
    .join("|");
  const zoomedStructurePanelIndex = structurePanelEntries.findIndex((entry) => entry.panelId === zoomedStructurePanelId);
  const shotNavigationGroups = useMemo(() => buildShotNavigationGroups(state.reviews), [state.reviews]);
  const isOpeningSubshot = isOpeningSubshotId(shot.id);
  const generationModel = state.generationModel || defaultGenerationModel;
  const writingModelOptions = useMemo(() => {
    const live = new Map((bridge.writingModels || []).map((model) => [model.id, model]));
    return writingModelCatalog.map((fallback) => {
      const remote = live.get(fallback.id);
      const serverSelectable = serverSelectableWritingModelIds.has(fallback.id);
      const available = serverSelectable && Boolean(remote?.available);
      return {
        ...fallback,
        model: serverSelectable && remote?.model ? remote.model : fallback.model,
        available,
        selected: available && Boolean(remote?.selected),
        reason: serverSelectable ? remote?.reason || (available ? undefined : fallback.reason) : fallback.reason,
      };
      });
  }, [bridge.writingModels, tenantScope.mode, tenantScope.role]);
  const orderedWritingModels = useMemo(() => {
    const models = new Map(writingModelOptions.map((model) => [model.id, model]));
    return [
      ...writingModelOrder.flatMap((id) => models.has(id) ? [models.get(id)!] : []),
      ...writingModelOptions.filter((model) => !writingModelOrder.includes(model.id)),
    ];
  }, [writingModelOptions, writingModelOrder]);
  const activeWritingModel = writingModelOptions.find((model) => model.selected && model.available)
    || (bridge.modelProvider?.configured
      ? writingModelOptions.find((model) => model.id === bridge.modelProvider?.selectionId && model.available)
        || writingModelOptions.find((model) => model.provider === bridge.modelProvider?.id && model.available)
      : undefined);
  const writingModelSummary = switchingWritingModelId
    ? "切换中…"
    : activeWritingModel?.label || (bridge.connected ? "暂无可用模型" : "未连接");
  const selectedReasoningEffort = bridge.reasoningPolicy?.selected || "high";
  const reviewerOptions = bridge.reviewers?.length ? bridge.reviewers : [{ id: defaultPromptReviewerId, label: "正在加载审核模型…", provider: "kimi", model: "k3", available: false, reason: "尚未收到审核模型目录，请等待服务连接。" }];
  const savedPromptReviewer = reviewerOptions.find((item) => item.id === review.promptReviewerId);
  const selectedPromptReviewer = savedPromptReviewer || reviewerOptions.find((item) => item.available) || reviewerOptions[0];
  const selectedPromptReviewerId = selectedPromptReviewer?.id || defaultPromptReviewerId;
  const currentPromptReviewRevision = review.completePrompt?.trim() ? buildPromptReviewRevision({
    shotId: shot.id,
    completePrompt: review.completePrompt,
    completePromptSourceRevision: review.completePromptSourceRevision,
    completePromptGeneratorId: review.completePromptGeneratorId || legacyUnknownModelId,
    reviewerId: review.promptReviewerId || selectedPromptReviewerId,
  }) : "";
  const promptReviewArtifactIsCurrent = review.promptReviewStatus === "ready"
    && Boolean(review.promptReviewReport)
    && review.promptReviewSourceRevision === currentPromptReviewRevision;
  const promptReviewIsCurrent = promptReviewArtifactIsCurrent
    && review.promptReviewReport?.verdict === "discussion-ready";
  const workspaceScope = materialDraftMode ? "material-draft" : "main";
  const projectStorageTitle = materialDraftMode ? `${state.projectTitle}::${activeStorageKey}` : state.projectTitle;
  const projectScopeId = materialDraftMode ? activeStorageKey.slice(materialDraftStoragePrefix.length) : "main";
  const mangaSourceRequestId = /^[a-f0-9-]{36}$/i.test(state.sourceMangaRequestId || "")
    ? state.sourceMangaRequestId as string
    : materialDraftMode && shot.sourcePanels?.length && /^[a-f0-9-]{36}$/i.test(projectScopeId) ? projectScopeId : "";
  const reviewControls = promptReviewControls({
    review, reviewer: selectedPromptReviewer, bridge,
    hasSource: Boolean(mangaSourceRequestId && shot.sourcePanels?.length),
  });
  const zoomedStructurePanelUrl = zoomedStructurePanelId && mangaSourceRequestId
    ? mangaPanelCropUrl(mangaSourceRequestId, zoomedStructurePanelId, bridge.pairingToken)
    : "";
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
    const assetKey = shotAssetStorageKey(projectStorageTitle, targetShot.id, asset);
    if (Object.prototype.hasOwnProperty.call(shotAssetPrompts, assetKey)) return shotAssetPrompts[assetKey];
    const analyzedPrompt = projectAssetPromptText(projectAssetPromptFor(state.assetPrompts, asset, targetShot.id));
    return analyzedPrompt || defaultShotAssetPrompt(asset, targetShot, state.globalSettings);
  }

  function updateShotAssetPrompt(asset: ShotAssetEntry, value: string) {
    const assetKey = shotAssetStorageKey(projectStorageTitle, shot.id, asset);
    setShotAssetPrompts((current) => ({ ...current, [assetKey]: value }));
    setState((previous) => {
      const prompts = normalizeProjectAssetPrompts(previous.assetPrompts);
      const existing = projectAssetPromptFor(prompts, asset, shot.id);
      const existingIndex = existing ? prompts.findIndex((item) => item.id === existing.id) : -1;
      const nextRecord: ProjectAssetPrompt = {
        id: existing?.id || `${shot.id}::${asset.id}`,
        kind: asset.kind,
        name: asset.name,
        sourceObservation: existing?.sourceObservation || "由漫画分镜资产清单自动建立；外观观察待复核。",
        prompt: value,
        negative: [],
        sourcePanels: existing?.sourcePanels || shot.sourcePanels || [],
        shotIds: [shot.id],
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
  const approvedCount = state.reviews.filter((item) => item.approved).length;
  const selectedRecipe = getDirectorRecipe(state.selectedRecipeId);
  const coverageReport = useMemo(
    () => buildCoverageReport(state.sourceDocument, state.reviews.map((item) => item.shot)),
    [state.reviews, state.sourceDocument],
  );
  const videoPackages = useMemo(() => {
    const model = generationModels.find((item) => item.id === generationModel) || generationModels[0];
    return state.reviews.filter((item) => item.approved).map((item) => {
      const views = getDirectorViews(item.shot, useDefaultProjectPlans);
      const layoutViewKeys = views
        .map((view) => view.key)
        .filter((key) => useDefaultProjectPlans && Boolean(blockingPlans[key] || (key === item.shot.id && blockingPlans[item.shot.id])));
      const artworkNames = item.artworkNames?.length
        ? item.artworkNames
        : item.artworkName ? [item.artworkName] : [];
      const reviewerId = item.promptReviewerId || "kimi-k3";
      const promptReviewCurrent = item.promptReviewStatus === "ready"
        && item.promptReviewReport?.verdict === "discussion-ready"
        && Boolean(item.completePrompt?.trim())
        && item.promptReviewSourceRevision === buildPromptReviewRevision({
          shotId: item.shot.id,
          completePrompt: item.completePrompt || "",
          completePromptSourceRevision: item.completePromptSourceRevision,
          completePromptGeneratorId: item.completePromptGeneratorId || legacyUnknownModelId,
          reviewerId,
        });
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
        promptReviewCurrent,
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
  const currentVideoPackage = videoPackages.find((item) => item.shotId === shot.id);
  const selectedAssetShotId = assetSelectedShotId || shot.id;
  const selectedAssetPackage = videoPackages.find((item) => item.shotId === selectedAssetShotId) || videoPackages[0];
  const selectedAssetReview = state.reviews.find((item) => item.shot.id === selectedAssetPackage?.shotId) || state.reviews[0];
  const assetReadyCount = videoPackages.filter((item) => item.status === "ready").length;
  const assetAttentionCount = videoPackages.filter((item) => item.status === "blocked" || item.status === "stale" || item.status === "warning").length;
  const assetRunningCount = videoPackages.filter((item) => item.status === "running").length;
  const productionPipeline = useMemo(() => deriveProductionPipeline({
    hasMangaSource: Boolean(state.sourceMangaRequestId || state.reviews.some((item) => item.shot.sourcePanels?.length)),
    structureConfirmed,
    shotCount: state.reviews.length,
    scriptAppliedCount: state.reviews.filter((item) => item.scriptStatus === "applied").length,
    promptReadyCount: state.reviews.filter((item) => item.completePromptStatus === "ready" && item.completePrompt?.trim()).length,
    promptReviewedCount: state.reviews.filter((item) => {
      if (item.promptReviewStatus !== "ready" || item.promptReviewReport?.verdict !== "discussion-ready" || !item.completePrompt?.trim()) return false;
      const reviewerId = item.promptReviewerId || "kimi-k3";
      return item.promptReviewSourceRevision === buildPromptReviewRevision({
        shotId: item.shot.id,
        completePrompt: item.completePrompt,
        completePromptSourceRevision: item.completePromptSourceRevision,
        completePromptGeneratorId: item.completePromptGeneratorId || legacyUnknownModelId,
        reviewerId,
      });
    }).length,
    approvedCount,
    videoReadyCount: assetReadyCount,
  }), [approvedCount, assetReadyCount, state.reviews, state.sourceMangaRequestId, structureConfirmed]);
  const annotationBusy = bridge.busy && (
    (bridge.activeJob?.type === "annotation" && bridge.activeJob.shotId === shot.id)
    || bridge.activeJob?.type === "annotation-batch"
  );
  const globalBusy = bridge.busy && bridge.activeJob?.type === "global-annotation";
  const artworkJob = bridge.artworkJobs?.find((job) => job.shotId === shot.id && (!job.projectTitle || job.projectTitle === projectStorageTitle));
  const scriptLocked = Boolean(review.chat?.pending) || review.scriptStatus === "sending"
    || stampingShotId === shot.id
    || review.artworkStatus === "generating"
    || Boolean(artworkJob);
  const lastArtworkJob = bridge.lastArtworkJobs?.find((job) => job.shotId === shot.id && (!job.projectTitle || job.projectTitle === projectStorageTitle));
  const libtvReady = bridge.libtv?.status === "ready";
  const referenceLimit = referenceLimitFor(generationModel);
  const durationRange = durationRangeFor(generationModel);
  const shotTimingEstimate = estimateShotTiming({
    dialogue: shot.dialogue,
    completePrompt: review.completePrompt,
    panelCount: shot.sourcePanels?.length || 1,
    segmentCount: shot.segments?.length,
    assignedDuration: shot.duration,
    model: generationModel,
  });
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
    const requested = new URL(window.location.href).searchParams.get("mode");
    if (requested === "review" || requested === "strict-review") setDeskMode("strict-review");
  }, []);

  useEffect(() => {
    if (structureConfirmed) return;
    const bottomScroller = panelAssemblyBottomScroller.current;
    if (!bottomScroller) return;

    const updateScrollMetrics = () => {
      window.cancelAnimationFrame(panelAssemblyScrollFrame.current);
      panelAssemblyScrollFrame.current = window.requestAnimationFrame(() => {
        setPanelAssemblyScrollMetrics({
          scrollLeft: bottomScroller.scrollLeft,
          scrollWidth: bottomScroller.scrollWidth,
          clientWidth: bottomScroller.clientWidth,
        });
      });
    };
    updateScrollMetrics();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollMetrics);
    resizeObserver?.observe(bottomScroller);
    [...bottomScroller.children].forEach((child) => resizeObserver?.observe(child));
    window.addEventListener("resize", updateScrollMetrics);

    return () => {
      window.cancelAnimationFrame(panelAssemblyScrollFrame.current);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScrollMetrics);
    };
  }, [panelAssemblyLayoutSignature, structureConfirmed]);

  function syncPanelAssemblyFromTop(event: FormEvent<HTMLInputElement>) {
    const bottomScroller = panelAssemblyBottomScroller.current;
    const scrollLeft = Number(event.currentTarget.value);
    if (bottomScroller && Math.abs(bottomScroller.scrollLeft - scrollLeft) > 0.5) {
      bottomScroller.scrollLeft = scrollLeft;
    }
    setPanelAssemblyScrollMetrics((current) => ({ ...current, scrollLeft }));
  }

  function syncPanelAssemblyFromBottom(event: UIEvent<HTMLDivElement>) {
    const bottomScroller = event.currentTarget;
    window.cancelAnimationFrame(panelAssemblyScrollFrame.current);
    panelAssemblyScrollFrame.current = window.requestAnimationFrame(() => {
      setPanelAssemblyScrollMetrics({
        scrollLeft: bottomScroller.scrollLeft,
        scrollWidth: bottomScroller.scrollWidth,
        clientWidth: bottomScroller.clientWidth,
      });
    });
  }

  function beginRenameProject() {
    setProjectTitleDraft(state.projectTitle);
    setEditingProjectTitle(true);
  }

  function cancelRenameProject() {
    setProjectTitleDraft("");
    setEditingProjectTitle(false);
  }

  function renameProject() {
    const nextTitle = projectTitleDraft.trim();
    if (!nextTitle) {
      setToast("项目名称不能为空");
      return;
    }
    if (nextTitle === state.projectTitle) {
      cancelRenameProject();
      return;
    }
    setState((previous) => ({
      ...previous,
      projectTitle: nextTitle,
      reviews: previous.reviews.map(invalidateCompletePrompt),
      structureStatus: "draft",
      structureConfirmedAt: undefined,
    }));
    setEditingProjectTitle(false);
    setProjectTitleDraft("");
    setToast(`项目已改名为《${nextTitle}》；旧提示词已标记为待更新`);
  }

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
      void (async () => {
        let redirectingToRecentDraft = false;
        try {
        const query = new URLSearchParams(window.location.search);
        const resetRequested = query.get("reset") === "all";
        if (resetRequested) {
          scopedBrowserStorage.clear();
          if (tenantScope.mode === "local") window.sessionStorage.clear();
          if (tenantScope.mode === "local") window.indexedDB.deleteDatabase(artworkDb);
          window.history.replaceState({}, "", window.location.pathname);
        }
        const requestedDraftId = resetRequested ? "" : query.get("draft") || "";
        const validDraftId = /^[a-f0-9-]{36}$/i.test(requestedDraftId) ? requestedDraftId : "";
        const mainWorkspaceRequested = query.get("main") === "1";
        if (!resetRequested && !validDraftId && !mainWorkspaceRequested) {
          const recentDraftId = scopedBrowserStorage.getItem(recentMaterialDraftKey) || "";
          const recentDraftStorageKey = `${materialDraftStoragePrefix}${recentDraftId}`;
          if (/^[a-f0-9-]{36}$/i.test(recentDraftId) && scopedBrowserStorage.getItem(recentDraftStorageKey)) {
            redirectingToRecentDraft = true;
            window.location.replace(`/?draft=${encodeURIComponent(recentDraftId)}`);
            return;
          }
        }
        const targetStorageKey = validDraftId ? `${materialDraftStoragePrefix}${validDraftId}` : storageKey;
        setActiveStorageKey(targetStorageKey);
        setMaterialDraftMode(Boolean(validDraftId));
        if (validDraftId) scopedBrowserStorage.setItem(recentMaterialDraftKey, validDraftId);
        const currentSaved = resetRequested ? null : scopedBrowserStorage.getItem(targetStorageKey);
        const legacySaved = resetRequested || validDraftId || tenantScope.mode === "server" ? null : legacyStorageKeys.map((key) => scopedBrowserStorage.getItem(key)).find(Boolean) || null;
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
            const storedAgentRevision = browserAgentRevision(parsed);
            if (storedAgentRevision) appliedAgentDraftRevision.current = storedAgentRevision;
            setState(normalizeStateForResume(repairKnownMangaDraftState(parsed, validDraftId)));
          }
        }
        } catch {
        // A damaged local draft should not block the tool.
        } finally {
          if (!redirectingToRecentDraft) setHydrated(true);
        }
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [scopedBrowserStorage, tenantScope.mode]);

  useEffect(() => {
    if (!hydrated || tenantScope.mode !== "server" || !bridge.connected || !bridge.pairingToken) return;
    let active = true;
    setProjectArchiveLoaded(false);
    bridgeFetch(`${bridgeBase}/draft-state?scopeId=${encodeURIComponent(projectScopeId || "main")}`, {
      cache: "no-store",
      headers: { "X-Manjing-Token": bridge.pairingToken },
    }).then(async (response) => {
      if (response.status === 404) return null;
      const snapshot = await response.json();
      if (!response.ok) throw new Error(snapshot?.error || "项目存档加载失败");
      return snapshot;
    }).then((snapshot) => {
      if (!active) return;
      if (!snapshot) {
        setProjectArchiveLoaded(true);
        return;
      }
      const incoming = snapshot.state as ReviewState | undefined;
      if (!incoming?.reviews?.length || !incoming.reviews.every((item) => isStoryboardShot(item.shot))) {
        throw new Error("服务器项目存档不完整，已禁止浏览器覆盖");
      }
      const revision = typeof snapshot.agentRevision === "string" ? snapshot.agentRevision : "";
      if (revision) appliedAgentDraftRevision.current = revision;
      setState(normalizeStateForResume(repairKnownMangaDraftState(incoming, projectScopeId)));
      setProjectArchiveLoaded(true);
    }).catch((error) => {
      if (active) setToast(error instanceof Error ? error.message : "项目存档加载失败");
    });
    return () => { active = false; };
  }, [bridge.connected, bridge.pairingToken, hydrated, projectScopeId, tenantScope.mode]);

  useEffect(() => {
    if (hydrated && projectArchiveLoaded) scopedBrowserStorage.setItem(activeStorageKey, JSON.stringify(
      browserDraftSnapshot(state, appliedAgentDraftRevision.current),
    ));
  }, [activeStorageKey, hydrated, projectArchiveLoaded, scopedBrowserStorage, state]);

  useEffect(() => {
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key !== activeStorageKey || !event.newValue) return;
      try {
        const incoming = JSON.parse(event.newValue) as ReviewState;
        if (incoming.reviews?.length && incoming.reviews.every((item) => isStoryboardShot(item.shot))) {
          const incomingAgentRevision = browserAgentRevision(incoming);
          // Ignore another tab until it has applied the same server revision.
          // Its server POST is rejected by the matching revision guard too.
          if (appliedAgentDraftRevision.current && incomingAgentRevision !== appliedAgentDraftRevision.current) return;
          if (incomingAgentRevision) appliedAgentDraftRevision.current = incomingAgentRevision;
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
      bridgeFetch(`${bridgeBase}/health`, { cache: "no-store" })
        .then((response) => response.json())
        .then((value) => {
          if (active) setBridge({
            connected: Boolean(value.connected),
            busy: Boolean(value.busy),
            draining: Boolean(value.draining),
            serverMode: Boolean(value.serverMode),
            modelProvider: value.modelProvider,
            pairingToken: value.pairingToken || (value.serverMode ? serverGatewayPairingSentinel : undefined),
            activeJob: value.activeJob,
            lastJob: value.lastJob,
            shotWork: value.shotWork,
            promptJobs: Array.isArray(value.promptJobs) ? value.promptJobs : [],
            lastPromptJobs: Array.isArray(value.lastPromptJobs) ? value.lastPromptJobs : [],
            artworkJobs: Array.isArray(value.artworkJobs) ? value.artworkJobs : [],
            lastArtworkJobs: Array.isArray(value.lastArtworkJobs) ? value.lastArtworkJobs : [],
            assetJobs: Array.isArray(value.assetJobs) ? value.assetJobs : [],
            lastAssetJobs: Array.isArray(value.lastAssetJobs) ? value.lastAssetJobs : [],
            writingModels: Array.isArray(value.writingModels) ? value.writingModels : [],
            reviewers: Array.isArray(value.reviewers) ? value.reviewers : [],
            harness: value.harness && Array.isArray(value.harness.runs) ? value.harness : undefined,
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
    const defaults = writingModelCatalog.map((model) => model.id);
    let nextOrder = defaults;
    try {
      const parsed = JSON.parse(scopedBrowserStorage.getItem("manjing-writing-model-order:v1") || "[]") as unknown;
      if (Array.isArray(parsed)) {
        const allowed = new Set<WritingModelId>(defaults);
        const saved = [...new Set(parsed.filter((id): id is WritingModelId => typeof id === "string" && allowed.has(id as WritingModelId)))];
        nextOrder = [...saved, ...defaults.filter((id) => !saved.includes(id))];
      }
    } catch {
      // A damaged browser preference must not block the writing workflow.
    }
    const frame = window.requestAnimationFrame(() => setWritingModelOrder(nextOrder));
    return () => window.cancelAnimationFrame(frame);
  }, [scopedBrowserStorage, tenantScope.storageScope]);

  function persistWritingModelOrder(nextOrder: WritingModelId[]) {
    setWritingModelOrder(nextOrder);
    try {
      scopedBrowserStorage.setItem("manjing-writing-model-order:v1", JSON.stringify(nextOrder));
    } catch {
      // Browser storage may be disabled; the current tab still keeps the order.
    }
  }

  function moveWritingModelBefore(source: WritingModelId, target: WritingModelId) {
    if (source === target) return;
    const nextOrder = orderedWritingModels.map((model) => model.id).filter((id) => id !== source);
    const targetIndex = nextOrder.indexOf(target);
    nextOrder.splice(targetIndex < 0 ? nextOrder.length : targetIndex, 0, source);
    persistWritingModelOrder(nextOrder);
  }

  function moveWritingModelByOffset(source: WritingModelId, offset: -1 | 1) {
    const nextOrder = orderedWritingModels.map((model) => model.id);
    const sourceIndex = nextOrder.indexOf(source);
    const targetIndex = Math.max(0, Math.min(nextOrder.length - 1, sourceIndex + offset));
    if (sourceIndex < 0 || sourceIndex === targetIndex) return;
    [nextOrder[sourceIndex], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[sourceIndex]];
    persistWritingModelOrder(nextOrder);
  }

  function beginTouchWritingModelDrag(event: React.PointerEvent<HTMLSpanElement>, model: WritingModelOption) {
    if (event.pointerType === "mouse" || !model.available || !bridge.connected || bridge.busy || switchingWritingModelId) return;
    event.preventDefault();
    event.stopPropagation();
    touchWritingModelPointerRef.current = event.pointerId;
    touchWritingModelTargetRef.current = model.id;
    draggedWritingModelIdRef.current = model.id;
    setDragOverWritingModelId(model.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveTouchWritingModelDrag(event: React.PointerEvent<HTMLSpanElement>) {
    if (touchWritingModelPointerRef.current !== event.pointerId || !draggedWritingModelIdRef.current) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-writing-model-id]")?.dataset.writingModelId;
    if (writingModelCatalog.some((model) => model.id === target)) {
      touchWritingModelTargetRef.current = target as WritingModelId;
      setDragOverWritingModelId(target as WritingModelId);
    }
  }

  function finishTouchWritingModelDrag(event: React.PointerEvent<HTMLSpanElement>, canceled = false) {
    if (touchWritingModelPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const source = draggedWritingModelIdRef.current;
    const target = touchWritingModelTargetRef.current;
    if (!canceled && source && target) moveWritingModelBefore(source, target);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    touchWritingModelPointerRef.current = null;
    touchWritingModelTargetRef.current = "";
    draggedWritingModelIdRef.current = "";
    setDragOverWritingModelId("");
    suppressWritingModelClickRef.current = true;
    window.setTimeout(() => { suppressWritingModelClickRef.current = false; }, 0);
  }

  async function selectWritingModelOption(model: WritingModelOption) {
    if (!model.available || !bridge.connected || !bridge.pairingToken || bridge.busy || switchingWritingModelId) return;
    if (model.id === activeWritingModel?.id) {
      writingModelMenuRef.current?.removeAttribute("open");
      return;
    }
    setSwitchingWritingModelId(model.id);
    try {
      const response = await bridgeFetch(`${bridgeBase}/writing-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Manjing-Token": bridge.pairingToken as string },
        body: JSON.stringify({ id: model.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "写作模型切换失败");
      setBridge((current) => ({
        ...current,
        modelProvider: result.modelProvider || current.modelProvider,
        writingModels: Array.isArray(result.writingModels) ? result.writingModels : current.writingModels,
      }));
      writingModelMenuRef.current?.removeAttribute("open");
      setToast(`写作模型已切换为 ${model.label}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "写作模型切换失败");
    } finally {
      setSwitchingWritingModelId("");
    }
  }

  async function selectReasoningEffort(effort: ReasoningEffort) {
    if (!bridge.connected || !bridge.pairingToken || bridge.busy || switchingReasoningEffort) return;
    setSwitchingReasoningEffort(true);
    try {
      const response = await bridgeFetch(`${bridgeBase}/reasoning-effort`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Manjing-Token": bridge.pairingToken as string },
        body: JSON.stringify({ effort }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "推理深度切换失败");
      setBridge((current) => ({
        ...current,
        reasoningPolicy: result.reasoningPolicy || current.reasoningPolicy,
      }));
      setToast(`一般创作推理深度已切换为 ${effort.toUpperCase()}；拆图仍固定 LOW，逐 Shot 提示词与审核仍固定 MAX`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "推理深度切换失败");
    } finally {
      setSwitchingReasoningEffort(false);
    }
  }

  useEffect(() => {
    if (!hydrated || !projectArchiveLoaded || !bridge.connected || !bridge.pairingToken) return;
    let active = true;
    const receiveAgentDraftUpdate = () => {
      bridgeFetch(`${bridgeBase}/draft-state?scopeId=${encodeURIComponent(projectScopeId || "main")}`, {
        cache: "no-store",
        headers: { "X-Manjing-Token": bridge.pairingToken as string },
      }).then((response) => response.json()).then((snapshot) => {
        const revision = typeof snapshot?.agentRevision === "string" ? snapshot.agentRevision : "";
        const incoming = snapshot?.state as ReviewState | undefined;
        // Every open tab must apply a revision it has not seen. `agentPending`
        // is only an acknowledgement flag and may already have been cleared by
        // a different tab, so using it as a receive gate leaves stale tabs open.
        if (!active || !shouldApplyAgentDraft(revision, appliedAgentDraftRevision.current)) return;
        if (!incoming?.reviews?.length || !incoming.reviews.every((item) => isStoryboardShot(item.shot))) return;
        appliedAgentDraftRevision.current = revision;
        setState(normalizeStateForResume(repairKnownMangaDraftState(incoming, projectScopeId)));
        setSelectedStructurePanelIds([]);
        setPanelSelectionAnchor("");
        setToast("已强制刷新 Agent 最新版本");
      }).catch(() => {
        // Keep the current browser draft when the local mirror is unavailable.
      });
    };
    receiveAgentDraftUpdate();
    const receiveTimer = window.setInterval(receiveAgentDraftUpdate, 900);
    return () => {
      active = false;
      window.clearInterval(receiveTimer);
    };
  }, [bridge.connected, bridge.pairingToken, hydrated, projectArchiveLoaded, projectScopeId]);

  useEffect(() => {
    if (!hydrated || !projectArchiveLoaded || !bridge.connected || !bridge.pairingToken) return;
    // Capture the revision that was current when this browser-state save was
    // scheduled. If an Agent draft arrives before the debounce expires, this
    // save still contains the previous browser state and must not overwrite the
    // newly received draft on disk.
    const scheduledAgentRevision = appliedAgentDraftRevision.current;
    const timer = window.setTimeout(() => {
      if (scheduledAgentRevision !== appliedAgentDraftRevision.current) return;
      bridgeFetch(`${bridgeBase}/draft-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Manjing-Token": bridge.pairingToken as string },
        body: JSON.stringify({
          scopeId: projectScopeId || "main",
          storageKey: activeStorageKey,
          state,
          appliedAgentRevision: appliedAgentDraftRevision.current,
        }),
      }).catch(() => {
        // Browser-local persistence remains authoritative if the local bridge is temporarily unavailable.
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeStorageKey, bridge.connected, bridge.pairingToken, hydrated, projectArchiveLoaded, projectScopeId, state]);

  useEffect(() => {
    if (!hydrated || !bridge.connected || !bridge.pairingToken || !shot.sourcePanels?.length || (review.completePrompt && review.completePromptStatus !== "generating")) return;
    if (review.completePromptSummary === "最终美术风格已改为写实真人电影，请按新风格重新生成。") return;
    const recoveryShotIdentity = stableShotIdentity(shot);
    const matchingLiveJob = (bridge.promptJobs || []).find((job) => (
      job.type === "complete-shot-prompt"
      && job.status === "running"
      && bridgeJobMatchesStableShot(job, state.projectUid, recoveryShotIdentity)
    ));
    if (matchingLiveJob) return;
    const matchingTerminalJob = (bridge.lastPromptJobs || []).find((job) => (
      job.type === "complete-shot-prompt"
      && job.status !== "running"
      && bridgeJobMatchesStableShot(job, state.projectUid, recoveryShotIdentity)
    ));
    if (review.completePromptStatus === "generating" && !matchingTerminalJob) return;
    const recoveryShotKey = recoveryShotIdentity.shotUid || recoveryShotIdentity.fallbackId;
    const terminalJobStamp = matchingTerminalJob
      ? matchingTerminalJob.finishedAt || matchingTerminalJob.updatedAt || "latest"
      : "disk";
    const recoveryKey = `${activeStorageKey}:${recoveryShotKey}:${terminalJobStamp}`;
    if (recoveringCompletePrompt.current === recoveryKey) return;
    recoveringCompletePrompt.current = recoveryKey;
    const recoveryGlobalSettings = completeGlobalSettingsForReviews(state.projectTitle, state.reviews, state.globalSettings);
    const recoveryPanelAnnotations = Object.fromEntries((shot.sourcePanels || []).map((panelId) => [
      panelId,
      state.sourceMangaPanelAnnotations?.[panelId] || "",
    ]));
    const currentSourceRevision = buildCompleteShotPromptRevision({
      projectTitle: state.projectTitle,
      modelId: generationModel,
      globalSettings: recoveryGlobalSettings,
      shot,
      shotAnnotations: review.annotations,
      panelAnnotations: recoveryPanelAnnotations,
      sourceMangaRequestId: mangaSourceRequestId,
    });
    const recoverySourceRevision = review.completePromptStatus === "generating" && review.completePromptSourceRevision
      ? review.completePromptSourceRevision
      : currentSourceRevision;
    let active = true;
    let recovered = false;
    const recoveryQuery = new URLSearchParams({
      type: "complete-shot-prompt",
      projectUid: state.projectUid,
      shotUid: recoveryShotIdentity.shotUid,
      shotId: recoveryShotIdentity.fallbackId,
      sourceRevision: recoverySourceRevision,
    });
    bridgeFetch(`${bridgeBase}/job-result?${recoveryQuery.toString()}`, {
      cache: "no-store",
      headers: { "X-Manjing-Token": bridge.pairingToken },
    }).then(async (response) => {
      const result = await response.json() as CompleteShotPromptResult;
      if (!response.ok) throw new Error(result.error || "没有可恢复的完整提示词");
      if (result.status !== "completed" || !completePromptResultMatchesStableShot(result, state.projectUid, recoveryShotIdentity) || !result.prompt?.trim()) throw new Error("恢复的完整提示词与当前 Shot 不一致");
      if (!active) return;
      recovered = true;
      setState((previous) => {
        const reviews = previous.reviews.map((item) => matchesStableShotIdentity(item.shot, recoveryShotIdentity) ? {
          ...invalidatePromptReview(item),
          completePromptStatus: "ready" as CompleteShotPromptStatus,
          completePrompt: result.prompt,
          completePromptSummary: result.summary,
          completePromptResearch: result.research,
          completePromptWarnings: result.warnings,
          completePromptGeneratedAt: result.generatedAt,
          completePromptSourceRevision: result.sourceRevision,
          completePromptConfirmedAt: item.completePromptConfirmedAt || result.generatedAt || new Date().toISOString(),
          completePromptGeneratorId: result.generatorId?.trim() || legacyUnknownModelId,
          completePromptGeneratorProvider: result.generatorProvider?.trim() || undefined,
          completePromptRequestedGeneratorId: result.requestedGeneratorId?.trim() || undefined,
        } : item);
        const allReady = reviews.every((item) => item.completePromptConfirmedAt && item.completePromptStatus === "ready");
        return {
          ...previous,
          reviews,
          assetPrompts: mergeProjectAssetPrompts(
            previous.assetPrompts,
            confirmedAssetPrompts(reviews.filter((item) => matchesStableShotIdentity(item.shot, recoveryShotIdentity)), previous.globalSettings),
          ),
          structureStatus: allReady ? "confirmed" : previous.structureStatus,
          structureConfirmedAt: allReady ? previous.structureConfirmedAt || new Date().toISOString() : previous.structureConfirmedAt,
        };
      });
      setToast(`已从本地恢复 Shot ${shot.id} 的完整提示词讨论稿；仍需独立审查`);
    }).catch(() => {
      if (recoveringCompletePrompt.current === recoveryKey) recoveringCompletePrompt.current = "";
      if (!active) return;
      if (review.completePromptStatus !== "generating") return;
      setState((previous) => ({
        ...previous,
        reviews: previous.reviews.map((item) => matchesStableShotIdentity(item.shot, recoveryShotIdentity) && item.completePromptStatus === "generating" ? {
          ...item,
          completePromptStatus: "error" as CompleteShotPromptStatus,
          completePromptSummary: "上次生成已经结束，但没有找到可恢复结果，请重新生成。",
        } : item),
      }));
    });
    return () => {
      active = false;
      if (!recovered && recoveringCompletePrompt.current === recoveryKey) recoveringCompletePrompt.current = "";
    };
  }, [activeStorageKey, bridge.connected, bridge.lastPromptJobs, bridge.pairingToken, bridge.promptJobs, generationModel, hydrated, mangaSourceRequestId, review.annotations, review.completePrompt, review.completePromptSourceRevision, review.completePromptStatus, review.completePromptSummary, shot, state.globalSettings, state.projectTitle, state.projectUid, state.reviews, state.sourceMangaPanelAnnotations]);

  useEffect(() => {
    if (!hydrated || !bridge.connected || !bridge.pairingToken || !review.completePrompt?.trim()) return;
    if (promptReviewSubmission.current.has(shot.shotUid || shot.id)) return;
    if (promptReviewIsCurrent) return;
    const matchingLiveJob = (bridge.promptJobs || []).find(job => job.type === "prompt-review" && job.shotUid === shot.shotUid && job.status === "running") || (bridge.activeJob?.type === "prompt-review" && bridge.activeJob.shotId === shot.id && bridge.activeJob.status === "running" ? bridge.activeJob : undefined);
    if (matchingLiveJob) return;
    const matchingTerminalJob = (bridge.lastPromptJobs || []).find(job => job.type === "prompt-review" && job.shotUid === shot.shotUid && job.status !== "running") || (bridge.lastJob?.type === "prompt-review" && bridge.lastJob.shotId === shot.id && bridge.lastJob.status !== "running" ? bridge.lastJob : undefined);
    if (review.promptReviewStatus !== "reviewing" && !matchingTerminalJob) return;
    const recoveryReviewerId = review.promptReviewerId || selectedPromptReviewerId;
    const sourceRevision = buildPromptReviewRevision({
      shotId: shot.id,
      completePrompt: review.completePrompt,
      completePromptSourceRevision: review.completePromptSourceRevision,
      completePromptGeneratorId: review.completePromptGeneratorId || legacyUnknownModelId,
      reviewerId: recoveryReviewerId,
    });
    const recoveryKey = `${activeStorageKey}:${shot.id}:${sourceRevision}:${matchingTerminalJob?.finishedAt || "disk"}`;
    if (recoveringPromptReview.current === recoveryKey) return;
    recoveringPromptReview.current = recoveryKey;
    let active = true;
    bridgeFetch(`${bridgeBase}/job-result?type=prompt-review&projectUid=${encodeURIComponent(state.projectUid)}&shotUid=${encodeURIComponent(shot.shotUid || "")}&shotId=${encodeURIComponent(shot.id)}&sourceRevision=${encodeURIComponent(sourceRevision)}`, {
      cache: "no-store",
      headers: { "X-Manjing-Token": bridge.pairingToken },
    }).then(async (response) => {
      const result = await response.json() as PromptReviewResult;
      if (!response.ok) throw new Error(result.error || "没有可恢复的独立审查报告");
      if (!active || result.shotId !== shot.id || result.reviewerId !== recoveryReviewerId || result.sourceRevision !== sourceRevision || !result.report) return;
      setState((previous) => previous.projectUid !== state.projectUid ? previous : ({
        ...previous,
        reviews: previous.reviews.map((item) => item.shot.shotUid === shot.shotUid && item.promptReviewSourceRevision === review.promptReviewSourceRevision ? {
          ...item,
          approved: false,
          approvedAt: undefined,
          promptReviewerId: result.reviewerId,
          promptReviewerModel: result.reviewerModel?.trim() || undefined,
          promptReviewStatus: "ready" as PromptReviewStatus,
          promptReviewReport: result.report,
          promptReviewSourceRevision: result.sourceRevision,
          promptReviewedAt: result.reviewedAt,
          promptReviewRequestId: result.requestId,
          promptReviewError: undefined,
        } : item),
      }));
      setToast(`已恢复 ${result.reviewerLabel || result.reviewerId} 的独立审查报告`);
    }).catch(() => {
      if (!active || review.promptReviewStatus !== "reviewing") return;
      setState((previous) => previous.projectUid !== state.projectUid ? previous : ({
        ...previous,
        reviews: previous.reviews.map((item) => item.shot.shotUid === shot.shotUid && item.promptReviewSourceRevision === sourceRevision && item.promptReviewStatus === "reviewing" ? {
          ...item,
          promptReviewStatus: "error" as PromptReviewStatus,
          promptReviewError: "上次独立审查已经结束，但没有找到与当前提示词匹配的报告，请重新提交。",
        } : item),
      }));
    });
    return () => { active = false; };
  }, [activeStorageKey, bridge.activeJob, bridge.connected, bridge.lastJob, bridge.promptJobs, bridge.lastPromptJobs, bridge.pairingToken, hydrated, promptReviewIsCurrent, review.completePrompt, review.completePromptGeneratorId, review.completePromptSourceRevision, review.promptReviewerId, review.promptReviewStatus, selectedPromptReviewerId, shot.id, shot.shotUid, state.projectUid, review.promptReviewSourceRevision]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requestId = query.get("importDraft") || "";
    const validRequestId = /^[a-f0-9-]{36}$/i.test(requestId) ? requestId : "";
    const activeDraftId = query.get("draft") || "";
    const validActiveDraftId = /^[a-f0-9-]{36}$/i.test(activeDraftId) ? activeDraftId : "";
    const recoverDraftUnderstandings = hydrated
      && Boolean(validActiveDraftId)
      && (state.sourceMangaPanelUnderstandingVersion !== mangaPanelUnderstandingVersion || !state.sourceMangaReadingPages?.length);
    const recoverLatest = !requestId && !activeDraftId && query.get("main") !== "1" && window.location.pathname === "/";
    const recoveryKey = validRequestId || (recoverDraftUnderstandings ? `panel-notes:${validActiveDraftId}` : recoverLatest ? "latest" : "");
    const directRequestId = validRequestId || (recoverDraftUnderstandings ? validActiveDraftId : "");
    if (!recoveryKey || !bridge.pairingToken || importingMaterialDraftId.current === recoveryKey) return;
    importingMaterialDraftId.current = recoveryKey;
    bridgeFetch(directRequestId
      ? `${bridgeBase}/media-job-result?requestId=${encodeURIComponent(directRequestId)}`
      : `${bridgeBase}/media-recover`, {
      method: directRequestId ? "GET" : "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Manjing-Token": bridge.pairingToken },
      body: directRequestId ? undefined : JSON.stringify({ kind: "manga" }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || payload?.status !== "completed" || !payload?.result) {
          throw new Error(payload?.error || "素材分析结果尚未完成");
        }
        return payload.result as MediaAnalysisResult;
      })
      .then((result) => {
        if (recoverDraftUnderstandings) {
          setState((previous) => ({
            ...previous,
            sourceMangaPanels: mangaPanelUnderstandingsFrom(result),
            sourceMangaPanelUnderstandingVersion: mangaPanelUnderstandingVersion,
            sourceMangaReadingDirection: result.readingDirection || previous.sourceMangaReadingDirection || "right-to-left",
            sourceMangaReadingPages: result.mangaPages,
          }));
          return;
        }
        createMaterialDraft(result);
      })
      .catch((error) => {
        if (!shouldSurfaceMediaRecoveryFailure({ directRequestId, recoverDraftUnderstandings })) return;
        importingMaterialDraftId.current = "";
        setToast(error instanceof Error ? error.message : "无法恢复本地漫画草稿");
      });
  }, [bridge.pairingToken, hydrated, state.sourceMangaPanels]);

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
    bridgeFetch(recoveryUrl, {
      cache: "no-store",
      headers: { "X-Manjing-Token": bridge.pairingToken },
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
        setToast("已取回写作模型完成的批注修改，等待当前 Shot 签字盖章");
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
    bridgeFetch(recoveryUrl, {
      cache: "no-store",
      headers: { "X-Manjing-Token": bridge.pairingToken },
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
    const message = matchingLastJob?.error || "写作模型任务未在运行，已恢复为可重新发送";
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
    setToast(failed ? message : "旧的‘写作模型正在修改’状态已清除，批注仍然保留");
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
      bridgeFetch(`${bridgeBase}/job-result?type=artwork&shotId=${encodeURIComponent(shot.id)}&projectTitle=${encodeURIComponent(projectStorageTitle)}`, {
        cache: "no-store",
        headers: { "X-Manjing-Token": bridge.pairingToken },
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
    getArtworksForShot(artworkStorageScope, projectStorageTitle, shot.id).then((dataUrls) => {
      if (active) setArtworkRecord({ shotId: shot.id, dataUrls });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [artworkStorageScope, projectStorageTitle, shot.id]);

  useEffect(() => {
    let active = true;
    Promise.all(shotAssets.map(async (asset) => {
      const key = shotAssetStorageKey(projectStorageTitle, shot.id, asset);
      return [key, await getArtworks(artworkStorageScope, key)] as const;
    })).then((entries) => {
      if (!active) return;
      setShotAssetImages((current) => ({ ...current, ...Object.fromEntries(entries) }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [artworkStorageScope, projectStorageTitle, shot.id, shotAssetSignature]);

  useEffect(() => {
    setShotAssetImageSettings((current) => ({
      ...current,
      ...Object.fromEntries(shotAssets.map((asset) => {
        const key = shotAssetStorageKey(projectStorageTitle, shot.id, asset);
        return [key, current[key] || defaultShotAssetImageSettings(asset)];
      })),
    }));
  }, [projectStorageTitle, shot.id, shotAssetSignature]);

  useEffect(() => {
    if (!hydrated || approvedCount === 0) return;
    setState((previous) => {
      let stateChanged = false;
      const reviews = previous.reviews.map((current) => {
        if (!current.approved) return current;
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
          summary: referencesChanged ? "本镜人物、场景与关键道具已加入本 Shot 的全能参考；不会影响其他 Shot" : current.summary,
        };
      });
      return stateChanged ? { ...previous, reviews } : previous;
    });
  }, [activeStorageKey, approvedCount, hydrated, projectAssetSignature, state.projectTitle]);

  useEffect(() => {
    if (state.workspaceMode !== "assets" || !selectedAssetPackage) return;
    let active = true;
    getArtworksForShot(artworkStorageScope, projectStorageTitle, selectedAssetPackage.shotId).then((dataUrls) => {
      if (active) setAssetPreviewRecord({ shotId: selectedAssetPackage.shotId, dataUrls });
    }).catch(() => {
      if (active) setAssetPreviewRecord({ shotId: selectedAssetPackage.shotId, dataUrls: [] });
    });
    return () => { active = false; };
  }, [artworkStorageScope, projectStorageTitle, selectedAssetPackage?.shotId, state.workspaceMode]);

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
    return invalidateCompletePrompt({
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
    });
  }

  function updateField<K extends keyof StoryboardShot>(field: K, value: StoryboardShot[K]) {
    updateReview((current) => {
      const draft = invalidate(current);
      return { ...draft, shot: { ...draft.shot, [field]: value } };
    });
    setState((previous) => ({ ...previous, structureStatus: "draft", structureConfirmedAt: undefined }));
  }

  function updateSegment(index: number, patch: Partial<StoryboardSegment>) {
    updateField("segments", shot.segments.map((segment, itemIndex) => itemIndex === index ? { ...segment, ...patch } : segment));
  }

  function structureTimecode(startSeconds: number, duration: number) {
    const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    return `${clock(startSeconds)}–${clock(startSeconds + duration)}`;
  }

  function resetReviewForStructure(reviewToReset: ShotReview, nextShot: StoryboardShot): ShotReview {
    return {
      ...createReview(nextShot, false, state.projectUid, `${nextShot.id}::${(nextShot.sourcePanels || []).join("|")}`),
      annotations: { ...emptyAnnotations(), ...(reviewToReset.annotations || {}) },
    };
  }

  function renumberStructure(reviews: ShotReview[]) {
    let elapsed = 0;
    const range = durationRangeFor(generationModel);
    return reviews.map((item, index) => {
      const normalized = normalizeShot(item.shot);
      const duration = Math.max(range.min, Math.min(range.max, Math.round(normalized.duration || range.min)));
      const nextShot = {
        ...normalized,
        id: String(index + 1).padStart(2, "0"),
        duration,
        timecode: structureTimecode(elapsed, duration),
      };
      elapsed += duration;
      const structureUnchanged = item.shot.id === nextShot.id
        && item.shot.timecode === nextShot.timecode
        && item.shot.duration === nextShot.duration
        && JSON.stringify(item.shot.sourcePanels || []) === JSON.stringify(nextShot.sourcePanels || []);
      return structureUnchanged ? { ...item, shot: nextShot } : resetReviewForStructure(item, nextShot);
    });
  }

  function updateShotDuration(reviewIndex: number, durationValue: number) {
    if (structureConfirmed) {
      setToast("镜头结构已经确认；需要调整时请先重新打开结构编辑");
      return;
    }
    const range = durationRangeFor(generationModel);
    const duration = Math.max(range.min, Math.min(range.max, Math.round(durationValue || range.min)));
    const targetShotId = state.reviews[reviewIndex]?.shot.id || shot.id;
    setStructureHistory((history) => [...history.slice(-19), state.reviews]);
    setArtworkRecord({ shotId: "", dataUrls: [] });
    setState((previous) => {
      const updated = previous.reviews.map((item, index) => index === reviewIndex
        ? resetReviewForStructure(item, { ...normalizeShot(item.shot), duration })
        : item);
      const reviews = renumberStructure(updated);
      return {
        ...previous,
        reviews,
        sourceDocument: sourceDocumentFromShots(reviews.map((item) => item.shot)),
        assetPrompts: [],
        structureStatus: "draft",
        structureConfirmedAt: undefined,
        view: "script",
      };
    });
    setToast(`Shot ${targetShotId} 已改为 ${duration} 秒；后续时间码已自动顺延`);
  }

  function updateCurrentShotDuration(durationValue: number) {
    updateShotDuration(state.currentShot, durationValue);
  }

  function toggleStructurePanel(panelId: string, extendRange = false) {
    if (extendRange && panelSelectionAnchor) {
      const orderedIds = structurePanelEntries.map((entry) => entry.panelId);
      const anchorIndex = orderedIds.indexOf(panelSelectionAnchor);
      const targetIndex = orderedIds.indexOf(panelId);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        const range = orderedIds.slice(start, end + 1);
        setSelectedStructurePanelIds((current) => [...new Set([...current, ...range])]);
        return;
      }
    }
    setPanelSelectionAnchor(panelId);
    setSelectedStructurePanelIds((current) => current.includes(panelId) ? current.filter((id) => id !== panelId) : [...current, panelId]);
  }

  function beginStructurePanelDrag(event: DragEvent<HTMLButtonElement>, panelId: string) {
    if (structureConfirmed) {
      event.preventDefault();
      return;
    }
    const selectedIds = selectedStructurePanelIds.includes(panelId)
      ? structurePanelEntries.filter((entry) => selectedStructurePanelIds.includes(entry.panelId)).map((entry) => entry.panelId)
      : [panelId];
    draggedStructurePanelIdsRef.current = selectedIds;
    suppressStructurePanelClickRef.current = true;
    setDraggedStructurePanelIds(selectedIds);
    setPanelDropTarget(null);
    if (!selectedStructurePanelIds.includes(panelId)) {
      setSelectedStructurePanelIds([panelId]);
      setPanelSelectionAnchor(panelId);
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", selectedIds.join("\n"));
  }

  function autoScrollPanelAssemblyForDrag(clientX: number) {
    const scroller = panelAssemblyBottomScroller.current;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const edge = Math.min(80, rect.width * 0.16);
    const leftDistance = clientX - rect.left;
    const rightDistance = rect.right - clientX;
    if (leftDistance < edge) scroller.scrollLeft -= Math.ceil(8 + ((edge - leftDistance) / edge) * 24);
    else if (rightDistance < edge) scroller.scrollLeft += Math.ceil(8 + ((edge - rightDistance) / edge) * 24);
  }

  function markStructurePanelDrop(event: DragEvent<HTMLElement>, target: PanelDropTarget) {
    if (!draggedStructurePanelIdsRef.current.length) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    autoScrollPanelAssemblyForDrag(event.clientX);
    setPanelDropTarget(target);
  }

  function finishStructurePanelDrag() {
    draggedStructurePanelIdsRef.current = [];
    setDraggedStructurePanelIds([]);
    setPanelDropTarget(null);
    window.setTimeout(() => { suppressStructurePanelClickRef.current = false; }, 0);
  }

  function openStructurePanelZoom(panelId: string) {
    setZoomedStructurePanelId(panelId);
  }

  function closeStructurePanelZoom() {
    setZoomedStructurePanelId("");
  }

  function moveStructurePanelZoom(direction: -1 | 1) {
    if (!structurePanelEntries.length) return;
    const nextIndex = (Math.max(0, zoomedStructurePanelIndex) + direction + structurePanelEntries.length) % structurePanelEntries.length;
    setZoomedStructurePanelId(structurePanelEntries[nextIndex].panelId);
  }

  function scrollToCompleteShotPromptPanel() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById("complete-shot-prompt-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function openCompleteShotPrompt(reviewIndex: number) {
    const targetShot = state.reviews[reviewIndex]?.shot;
    if (!targetShot) return;
    const targetShotIdentity = stableShotIdentity(targetShot);
    setState((previous) => {
      const targetIndex = previous.reviews.findIndex((item) => matchesStableShotIdentity(item.shot, targetShotIdentity));
      if (targetIndex < 0) return previous;
      return { ...previous, currentShot: targetIndex, view: "script" };
    });
    scrollToCompleteShotPromptPanel();
    setToast(`已打开 Shot ${targetShot.id} 的完整提示词讨论稿`);
  }

  function chatContext(currentState: ReviewState, target: ShotReview) {
    const panelAnnotations = Object.fromEntries((target.shot.sourcePanels || []).map(id => [id, currentState.sourceMangaPanelAnnotations?.[id] || ""]));
    const input = { projectTitle: currentState.projectTitle, modelId: currentState.generationModel || defaultGenerationModel, globalSettings: currentState.globalSettings, shot: target.shot, shotAnnotations: target.annotations, panelAnnotations, sourceMangaRequestId: currentState.sourceMangaRequestId || "" };
    return { ...input, generationModel: input.modelId, sourceRevision: buildCompleteShotPromptRevision(input), projectUid: currentState.projectUid, currentPrompt: target.completePrompt || "", allowRevision: !target.approved };
  }

  function updateChatDraft(value: string) {
    updateReview(current => ({ ...current, chat: { ...current.chat, draft: value } }));
  }

  function finishShotChat(projectUid: string, shotUid: string, pending: ShotChatPending, result: ShotChatResult) {
    if (result.projectUid !== projectUid || result.shotUid !== shotUid || result.chatTurnId !== pending.turnId || result.sourceRevision !== pending.sourceRevision) return;
    setState(previous => {
      if (previous.projectUid !== projectUid) return previous;
      return { ...previous, reviews: previous.reviews.map(item => {
        if (item.shot.shotUid !== shotUid || item.chat?.pending?.turnId !== pending.turnId) return item;
        const apply = chatReplyCanApply({ projectUid, shotUid, currentPrompt: item.completePrompt || "", currentSourceRevision: chatContext(previous, item).sourceRevision, approved: item.approved, pending, result });
        const notice = result.action === "revise" ? apply ? "\n\n已更新本 Shot 提示词讨论稿，旧稿已保留；请重新严格审核。" : "\n\n本镜内容或锁定状态已经改变，未覆盖正文；候选稿已保留。" : "";
        const chat: ShotChatState = { ...item.chat, pending: undefined, error: undefined,
          messages: [...(item.chat.messages || []), { id: `${pending.turnId}-assistant`, role: "assistant", text: result.reply + notice, at: result.generatedAt }],
          previousPrompt: apply ? item.completePrompt : item.chat.previousPrompt,
          candidate: result.action === "revise" && !apply ? result.prompt : item.chat.candidate };
        if (!apply) return { ...item, chat };
        return { ...invalidatePromptReview(item), chat, completePrompt: result.prompt, completePromptStatus: "ready" as CompleteShotPromptStatus,
          completePromptSummary: result.reply, completePromptSourceRevision: result.sourceRevision, completePromptGeneratedAt: result.generatedAt,
          completePromptConfirmedAt: new Date().toISOString(), completePromptGeneratorId: result.generatorId, completePromptGeneratorProvider: result.generatorProvider,
          completePromptResearch: undefined, completePromptWarnings: [], videoPromptSourceRevision: undefined, artworkDependencyRevision: undefined };
      }) };
    });
  }

  async function recoverShotChat(pending: ShotChatPending) {
    if (!bridge.pairingToken) return;
    const projectUid = state.projectUid, shotUid = shot.shotUid!;
    const query = new URLSearchParams({ type: "shot-chat", chatTurnId: pending.turnId, projectUid, shotUid, sourceRevision: pending.sourceRevision });
    const response = await bridgeFetch(`${bridgeBase}/job-result?${query}`, { headers: { "X-Manjing-Token": bridge.pairingToken }, cache: "no-store" });
    const result = await response.json() as ShotChatResult;
    if (response.status === 202) {
      setState(previous => previous.projectUid !== projectUid ? previous : { ...previous, reviews: previous.reviews.map(item => item.shot.shotUid === shotUid && item.chat?.pending?.turnId === pending.turnId && item.chat.pending.stage !== result.message ? { ...item, chat: { ...item.chat, pending: { ...item.chat.pending, stage: result.message } } } : item) });
      return;
    }
    if (response.ok && result.status === "completed") finishShotChat(projectUid, shotUid, pending, result);
    else if (result.status === "failed" || (response.status === 404 && Date.now() - Date.parse(pending.startedAt) > 60000)) {
      setState(previous => previous.projectUid !== projectUid ? previous : { ...previous, reviews: previous.reviews.map(item => item.shot.shotUid === shotUid && item.chat?.pending?.turnId === pending.turnId ? { ...item, chat: { ...item.chat, pending: undefined, error: result.error || "任务中断，请确认后重新发送" } } : item) });
    }
  }

  async function sendShotChat() {
    const message = review.chat?.draft?.trim() || "";
    if (!message || review.chat?.pending) return;
    if (!bridge.connected || !bridge.pairingToken || bridge.draining) throw new Error("主力 Agent 未连接或正在维护");
    if (review.completePromptStatus === "generating" || review.promptReviewStatus === "reviewing") throw new Error("当前 Shot 正在生成或审核，请等待完成");
    if (!mangaSourceRequestId || !shot.sourcePanels?.length) throw new Error("当前 Shot 尚未关联原作画格");
    const context = chatContext(state, review);
    const projectUid = state.projectUid, shotUid = shot.shotUid!;
    const pending: ShotChatPending = { turnId: crypto.randomUUID(), sourceRevision: context.sourceRevision, basePrompt: review.completePrompt || "", startedAt: new Date().toISOString() };
    const history = (review.chat?.messages || []).slice(-20).map(({ role, text }) => ({ role, text: text.slice(0, 16000) }));
    setState(previous => previous.projectUid !== projectUid ? previous : { ...previous, reviews: previous.reviews.map(item => item.shot.shotUid === shotUid ? { ...item, chat: { ...item.chat, draft: "", pending, error: undefined, messages: [...(item.chat?.messages || []), { id: pending.turnId, role: "user" as const, text: message, at: pending.startedAt }] } } : item) });
    try {
      const response = await bridgeFetch(`${bridgeBase}/shot-chat`, { method: "POST", headers: { "Content-Type": "application/json", "X-Manjing-Token": bridge.pairingToken }, body: JSON.stringify({ ...context, message, history, chatTurnId: pending.turnId }) });
      const result = await response.json() as ShotChatResult;
      if (!response.ok) {
        setState(previous => previous.projectUid !== projectUid ? previous : { ...previous, reviews: previous.reviews.map(item => item.shot.shotUid === shotUid && item.chat?.pending?.turnId === pending.turnId ? { ...item, chat: { ...item.chat, pending: undefined, error: result.error || "Chat 失败；旧稿保留" } } : item) });
        return;
      }
      finishShotChat(projectUid, shotUid, pending, result);
    } catch {
      // Keep the turn pending. Poll its durable result instead of resubmitting.
      setState(previous => previous.projectUid !== projectUid ? previous : { ...previous, reviews: previous.reviews.map(item => item.shot.shotUid === shotUid && item.chat?.pending?.turnId === pending.turnId ? { ...item, chat: { ...item.chat, error: "连接中断，正在查询原任务；不会重复发送" } } : item) });
    }
  }

  async function copyReviewSuggestions() {
    if (!review.promptReviewReport) return;
    const copied = await copyTextToClipboard(reviewSuggestionsText(shot.id, review.promptReviewReport, review.promptReviewSourceRevision));
    setToast(copied ? "审核建议已复制；到本 Shot Chat 粘贴发送，由主力 Agent 修改" : "复制失败，请选中审核建议手动复制");
  }

  async function generateCompleteShotPrompt(reviewIndex: number) {
    const targetReview = state.reviews[reviewIndex];
    if (!targetReview) return;
    if (targetReview.chat?.pending || targetReview.completePromptStatus === "generating" || targetReview.promptReviewStatus === "reviewing") { setToast("当前 Shot 已有任务运行或排队，请等待完成"); return; }
    const targetShotIdentity = stableShotIdentity(targetReview.shot);
    const submittedShotId = targetReview.shot.id;
    const submittedProjectUid = state.projectUid;
    if (!bridge.connected || !bridge.pairingToken) {
      setToast("本地 Agent 未连接，暂时不能生成完整提示词");
      return;
    }
    if (!mangaSourceRequestId || !targetReview.shot.sourcePanels?.length) {
      setToast("当前 Shot 没有关联可读取的漫画画格");
      return;
    }
    const effectiveGlobalSettings = completeGlobalSettingsForReviews(state.projectTitle, state.reviews, state.globalSettings);

    const panelAnnotations = Object.fromEntries(targetReview.shot.sourcePanels.map((panelId) => [
      panelId,
      state.sourceMangaPanelAnnotations?.[panelId] || "",
    ]));
    const sourceRevision = buildCompleteShotPromptRevision({
      projectTitle: state.projectTitle,
      modelId: generationModel,
      globalSettings: effectiveGlobalSettings,
      shot: targetReview.shot,
      shotAnnotations: targetReview.annotations,
      panelAnnotations,
      sourceMangaRequestId: mangaSourceRequestId,
    });
    const confirmedAt = new Date().toISOString();
    setState((previous) => {
      const targetIndex = previous.reviews.findIndex((item) => matchesStableShotIdentity(item.shot, targetShotIdentity));
      return {
        ...previous,
        currentShot: targetIndex >= 0 ? targetIndex : previous.currentShot,
        view: "script",
        globalSettings: effectiveGlobalSettings,
        globalStatus: "applied",
        globalSummary: "已根据漫画全片、上一话连续性和可靠资料自动补全故事背景与最终成片美术风格",
        globalUpdatedAt: new Date().toISOString(),
        reviews: previous.reviews.map((item) => matchesStableShotIdentity(item.shot, targetShotIdentity) ? {
          ...invalidatePromptReview(item),
          completePromptStatus: "generating",
          completePromptConfirmedAt: confirmedAt,
          completePromptSourceRevision: sourceRevision,
        } : item),
      };
    });
    setToast(`Shot ${submittedShotId} 的完整提示词讨论稿正在生成；生成后还需独立审查和你的批准`);
    scrollToCompleteShotPromptPanel();
    try {
      const response = await bridgeFetch(`${bridgeBase}/complete-shot-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Manjing-Token": bridge.pairingToken },
        body: JSON.stringify({
          projectUid: submittedProjectUid,
          projectTitle: state.projectTitle,
          generationModel,
          globalSettings: effectiveGlobalSettings,
          sourceMangaRequestId: mangaSourceRequestId,
          sourceRevision,
          shot: targetReview.shot,
          shotAnnotations: targetReview.annotations,
          panelAnnotations,
        }),
      });
      const result = await response.json() as CompleteShotPromptResult;
      if (!response.ok) throw new Error(result.error || "完整提示词生成失败");
      if (result.status !== "completed" || !completePromptResultMatchesStableShot(result, submittedProjectUid, targetShotIdentity) || result.sourceRevision !== sourceRevision || !result.prompt?.trim()) {
        throw new Error("Agent 返回结果与本次确认的 Shot 不一致");
      }
      setState((previous) => {
        if (previous.projectUid !== submittedProjectUid) return previous;
        const reviews = previous.reviews.map((item) => matchesStableShotIdentity(item.shot, targetShotIdentity) && item.completePromptStatus === "generating" && item.completePromptSourceRevision === sourceRevision ? {
          ...invalidatePromptReview(item),
          completePromptStatus: "ready" as CompleteShotPromptStatus,
          completePrompt: result.prompt,
          completePromptSummary: result.summary,
          completePromptResearch: result.research,
          completePromptWarnings: result.warnings,
          completePromptGeneratedAt: result.generatedAt,
          completePromptSourceRevision: sourceRevision,
          completePromptConfirmedAt: item.completePromptConfirmedAt || confirmedAt,
          completePromptGeneratorId: result.generatorId?.trim() || legacyUnknownModelId,
          completePromptGeneratorProvider: result.generatorProvider?.trim() || undefined,
          completePromptRequestedGeneratorId: result.requestedGeneratorId?.trim() || undefined,
        } : item);
        const allReady = reviews.every((item) => item.completePromptConfirmedAt && item.completePromptStatus === "ready");
        const targetIndex = reviews.findIndex((item) => matchesStableShotIdentity(item.shot, targetShotIdentity));
        const completedReview = targetIndex >= 0 ? reviews[targetIndex] : undefined;
        return {
          ...previous,
          currentShot: previous.currentShot,
          view: previous.view,
          reviews,
          structureStatus: allReady ? "confirmed" : "draft",
          structureConfirmedAt: allReady ? new Date().toISOString() : undefined,
          assetPrompts: mergeProjectAssetPrompts(
            previous.assetPrompts,
            confirmedAssetPrompts(completedReview ? [completedReview] : [], previous.globalSettings),
          ),
        };
      });
      setToast(`Shot ${submittedShotId} 完整提示词讨论稿已生成，请提交独立 Reviewer 审查`);
      scrollToCompleteShotPromptPanel();
    } catch (error) {
      const message = error instanceof Error ? error.message : "完整提示词生成失败";
      setState((previous) => {
        if (previous.projectUid !== submittedProjectUid) return previous;
        const targetIndex = previous.reviews.findIndex((item) => matchesStableShotIdentity(item.shot, targetShotIdentity));
        return {
          ...previous,
          currentShot: previous.currentShot,
          view: previous.view,
          reviews: previous.reviews.map((item) => matchesStableShotIdentity(item.shot, targetShotIdentity) && item.completePromptStatus === "generating" && item.completePromptSourceRevision === sourceRevision ? {
            ...item,
            completePromptStatus: "error",
            completePromptSummary: message,
          } : item),
          structureStatus: "draft",
          structureConfirmedAt: undefined,
        };
      });
      setToast(message);
      scrollToCompleteShotPromptPanel();
    }
  }

  function updateCompleteShotPrompt(value: string) {
    updateReview((current) => {
      const currentGeneratorId = current.completePromptGeneratorId?.trim() || "";
      const editedGeneratorId = currentGeneratorId.endsWith("+human-edited")
        ? currentGeneratorId
        : currentGeneratorId ? `${currentGeneratorId}+human-edited` : "human-edited";
      return {
        ...invalidatePromptReview(current),
        completePrompt: value,
        completePromptStatus: current.completePromptStatus === "stale" || current.completePromptStatus === "error"
          ? current.completePromptStatus
          : "ready",
        completePromptGeneratorId: editedGeneratorId,
        completePromptGeneratorProvider: "human-editor",
      };
    });
  }

  async function copyCompleteShotPrompt() {
    if (!review.completePrompt?.trim()) return;
    const copied = await copyTextToClipboard(review.completePrompt);
    setToast(copied ? `Shot ${shot.id} 完整提示词已复制` : "无法写入剪贴板，请选中文本后手动复制");
  }

  function selectPromptReviewer(reviewerId: string) {
    if (reviewControls.selectingDisabled || promptReviewSubmission.current.has(shot.shotUid || shot.id)) return;
    if (!reviewerOptions.some((item) => item.id === reviewerId && item.available)) return;
    updateReview((current) => ({
      ...invalidatePromptReview(current),
      promptReviewerId: reviewerId,
    }));
  }

  async function reviewCompletePrompt() {
    if (promptReviewSubmission.current.has(shot.shotUid || shot.id)) return;
    if (reviewControls.submitDisabled || !selectedPromptReviewer?.available || !bridge.pairingToken || !review.completePrompt?.trim()) {
      setToast(reviewControls.reason || "所选 Reviewer 暂不可用");
      return;
    }
    const submissionShotKey = shot.shotUid || shot.id;
    promptReviewSubmission.current.add(submissionShotKey);
    const panelAnnotations = Object.fromEntries((shot.sourcePanels || []).map((panelId) => [panelId, state.sourceMangaPanelAnnotations?.[panelId] || ""]));
    // Older saved projects can contain a valid ready prompt created before
    // prompt lineage was persisted. Bind that unchanged draft to the current
    // evidence snapshot at review time so the read-only Reviewer can inspect
    // it without forcing a regeneration loop through the Creator desk.
    const completePromptSourceRevision = review.completePromptSourceRevision || buildCompleteShotPromptRevision({
      projectTitle: state.projectTitle,
      modelId: generationModel,
      globalSettings: completeGlobalSettingsForReviews(state.projectTitle, state.reviews, state.globalSettings),
      shot,
      shotAnnotations: review.annotations,
      panelAnnotations,
      sourceMangaRequestId: mangaSourceRequestId,
    });
    const sourceRevision = buildPromptReviewRevision({
      shotId: shot.id,
      completePrompt: review.completePrompt,
      completePromptSourceRevision,
      completePromptGeneratorId: review.completePromptGeneratorId || legacyUnknownModelId,
      reviewerId: selectedPromptReviewer.id,
    });
    setState((previous) => previous.projectUid !== state.projectUid ? previous : ({
      ...previous,
      reviews: previous.reviews.map((item) => item.shot.shotUid === shot.shotUid ? {
        ...item,
        completePromptSourceRevision,
        approved: false,
        approvedAt: undefined,
        promptReviewerId: selectedPromptReviewer.id,
        promptReviewStatus: "reviewing" as PromptReviewStatus,
        promptReviewReport: undefined,
        promptReviewerModel: undefined,
        promptReviewSourceRevision: sourceRevision,
        promptReviewedAt: undefined,
        promptReviewRequestId: undefined,
        promptReviewError: undefined,
      } : item),
    }));
    setToast(`已交给 ${selectedPromptReviewer.label} 的独立 Agent 审查；它不能改稿或批准`);
    try {
      const response = await bridgeFetch(`${bridgeBase}/review-shot-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Manjing-Token": bridge.pairingToken },
        body: JSON.stringify({
          operationMode: "strict-review",
          projectUid: state.projectUid,
          projectTitle: state.projectTitle,
          generationModel,
          globalSettings: state.globalSettings,
          sourceMangaRequestId: mangaSourceRequestId,
          sourceRevision,
          completePromptSourceRevision,
          reviewerId: selectedPromptReviewer.id,
          completePromptGeneratorId: review.completePromptGeneratorId || legacyUnknownModelId,
          completePrompt: review.completePrompt,
          shot,
          shotAnnotations: review.annotations,
          panelAnnotations,
        }),
      });
      const result = await response.json() as PromptReviewResult;
      if (!response.ok) throw new Error(result.error || "独立审查失败");
      if (result.status !== "completed" || result.shotId !== shot.id || result.reviewerId !== selectedPromptReviewer.id || result.sourceRevision !== sourceRevision) {
        throw new Error("Reviewer 返回报告与当前提示词版本不一致");
      }
      setState((previous) => previous.projectUid !== state.projectUid ? previous : ({
        ...previous,
        reviews: previous.reviews.map((item) => item.shot.shotUid === shot.shotUid && item.promptReviewSourceRevision === sourceRevision ? {
          ...item,
          approved: false,
          approvedAt: undefined,
          promptReviewStatus: "ready" as PromptReviewStatus,
          promptReviewReport: result.report,
          promptReviewerModel: result.reviewerModel?.trim() || undefined,
          promptReviewedAt: result.reviewedAt,
          promptReviewRequestId: result.requestId,
          promptReviewError: undefined,
        } : item),
      }));
      setToast(result.report.verdict === "needs-revision"
        ? `${selectedPromptReviewer.label} 发现需要修改的问题，请先讨论或改稿`
        : `${selectedPromptReviewer.label} 审查完成；报告只供讨论，仍需你亲自批准`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "独立审查失败";
      setState((previous) => previous.projectUid !== state.projectUid ? previous : ({
        ...previous,
        reviews: previous.reviews.map((item) => item.shot.shotUid === shot.shotUid && item.promptReviewSourceRevision === sourceRevision ? {
          ...item,
          promptReviewStatus: "error" as PromptReviewStatus,
          promptReviewError: message,
        } : item),
      }));
      setToast(message);
    } finally {
      promptReviewSubmission.current.delete(submissionShotKey);
    }
  }

  function toggleStructurePanelGroup(panelIds: string[]) {
    const allSelected = panelIds.every((panelId) => selectedStructurePanelIds.includes(panelId));
    setSelectedStructurePanelIds((current) => allSelected
      ? current.filter((panelId) => !panelIds.includes(panelId))
      : [...new Set([...current, ...panelIds])]);
    setPanelSelectionAnchor(panelIds[0] || "");
  }

  function undoStructureChange() {
    const previousReviews = structureHistory[structureHistory.length - 1];
    if (!previousReviews) {
      setToast("还没有可撤销的镜头结构修改");
      return;
    }
    const reviews = renumberStructure(previousReviews);
    setArtworkRecord({ shotId: "", dataUrls: [] });
    setState((previous) => ({
      ...previous,
      reviews,
      currentShot: Math.min(previous.currentShot, reviews.length - 1),
      sourceDocument: sourceDocumentFromShots(reviews.map((item) => item.shot)),
      assetPrompts: [],
      structureStatus: "draft",
      structureConfirmedAt: undefined,
      view: "script",
    }));
    setStructureHistory((history) => history.slice(0, -1));
    setSelectedStructurePanelIds([]);
    setPanelSelectionAnchor("");
    setToast("已撤销上一步镜头结构修改");
  }

  function atomicPanelReview(origin: ShotReview, panelId: string): ShotReview {
    const originShot = normalizeShot(origin.shot);
    const sourceText = (originShot.sourceText || []).filter((line) => line.startsWith(`${panelId}｜`) || line.startsWith(`${panelId} `));
    const sourceCopy = sourceText.map((line) => line.replace(new RegExp(`^${panelId}(?:｜|\\s+)`), "").trim()).filter(Boolean);
    const dialogue = sourceCopy.filter((line) => !/^(拟声词|画面文字|画面符号)：/.test(line));
    const panelStory = sourceCopy.join(" ") || `${panelId} 原作画格，剧情与构图以裁图为准。`;
    const evidencedCharacters = (originShot.characters || []).filter((name) => sourceCopy.some((line) => line.includes(name)));
    const evidencedProps = (originShot.props || []).filter((name) => sourceCopy.some((line) => line.includes(name)));
    const panelShot: StoryboardShot = {
      ...originShot,
      shotUid: ensureShotUid("", state.projectUid, `panel::${panelId}`),
      id: originShot.id,
      title: `画格 ${panelId}`,
      duration: 6,
      timecode: "00:00–00:06",
      sourcePanels: [panelId],
      sourceText,
      story: panelStory,
      scene: `${panelId} 裁图中的原作空间；具体地点和时间重新按本格证据确认。`,
      characters: evidencedCharacters,
      props: evidencedProps,
      omniReferences: [],
      dialogue,
      camera: "当前为逐格编组单位，沿用原作画格的景别、人物站位与视线方向。",
      composition: `画格 ${panelId} 独立构图；不得把相邻画格内容提前混入。`,
      action: "当前只锁定这一格的可见动作与状态；与其他画格组合成 Shot 后再统一生成完整动作链。",
      continuity: [`只使用 ${panelId} 画格可见事实；不继承原 Shot 中已移到其他 Shot 的场景、人物、动作和结果。`],
      negative: ["禁止混入当前 sourcePanels 之外的相邻画格剧情。"],
      segments: [{ label: "0–6s", beat: panelStory, framing: "按原作画格构图", mustShow: [panelId] }],
    };
    return resetReviewForStructure(origin, panelShot);
  }

  function combinedPanelReview(panelReviews: ShotReview[]): ShotReview {
    const panelShots = panelReviews.map((item) => normalizeShot(item.shot));
    const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    const sourcePanels = unique(panelShots.flatMap((item) => item.sourcePanels || []));
    const sourceText = unique(panelShots.flatMap((item) => item.sourceText || []));
    const dialogue = unique(panelShots.flatMap((item) => item.dialogue || []));
    const range = durationRangeFor(generationModel);
    const timing = estimateShotTiming({
      dialogue,
      panelCount: sourcePanels.length,
      assignedDuration: range.max,
      model: generationModel,
    });
    const duration = Math.max(range.min, Math.min(range.max, timing.requiredSeconds));
    const segments = panelShots.map((item, index): StoryboardSegment => {
      const start = Number(((duration * index) / panelShots.length).toFixed(1));
      const end = Number(((duration * (index + 1)) / panelShots.length).toFixed(1));
      const format = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);
      return {
        label: `${format(start)}–${format(end)}s`,
        beat: item.story,
        framing: item.camera || "按原作画格构图",
        mustShow: item.sourcePanels?.length ? item.sourcePanels : [item.title],
      };
    });
    const first = panelShots[0];
    const combinedShot: StoryboardShot = {
      ...first,
      shotUid: ensureShotUid("", state.projectUid, `panels::${sourcePanels.join("|")}`),
      id: first.id,
      title: sourcePanels.length === 1 ? `画格 ${sourcePanels[0]}` : `画格组合 ${sourcePanels[0]}–${sourcePanels[sourcePanels.length - 1]}`,
      duration,
      timecode: structureTimecode(0, duration),
      sourcePanels,
      sourceText,
      story: unique(panelShots.map((item) => item.story)).join(" "),
      scene: unique(panelShots.map((item) => item.scene)).join("；"),
      characters: unique(panelShots.flatMap((item) => item.characters)),
      props: unique(panelShots.flatMap((item) => item.props)),
      omniReferences: unique(panelShots.flatMap((item) => item.omniReferences)),
      composition: `按原作阅读顺序组合 ${sourcePanels.join(" → ")}；每张画格都是一个独立构图节点。`,
      camera: `按 ${sourcePanels.length} 个原作构图依次完成镜头节拍；构图切换与下方秒点严格对应。`,
      action: `按 ${sourcePanels.join(" → ")} 的顺序生成完整动作链；按日语约7个有效字符/秒、中文约4字/秒，并允许对白与动作并行，估算需要 ${timing.requiredSeconds} 秒${timing.requiredSeconds > range.max ? `，超过当前模型 ${range.max} 秒上限，需压缩或拆分` : `，当前设置为 ${duration} 秒`}。`,
      dialogue,
      continuity: unique(panelShots.flatMap((item) => item.continuity)),
      negative: unique([
        ...panelShots.flatMap((item) => item.negative),
        `禁止引用 ${sourcePanels[0]} 之前或 ${sourcePanels[sourcePanels.length - 1]} 之后的相邻 Shot 剧情。`,
      ]),
      segments,
    };
    return resetReviewForStructure(panelReviews[0], combinedShot);
  }

  function applyPanelGrouping(mode: "combine" | "split" | "exclude", panelIds = selectedStructurePanelIds) {
    if (structureConfirmed) {
      setToast("镜头结构已经确认；需要调整时请先重新打开结构编辑");
      return;
    }
    const selected = new Set(panelIds);
    if (!selected.size) {
      setToast("请先点击选择漫画画格");
      return;
    }
    const entries = state.reviews.flatMap((origin, originIndex) => (origin.shot.sourcePanels || []).map((panelId) => ({
      panelId,
      origin,
      originIndex,
      atomic: atomicPanelReview(origin, panelId),
    })));
    const selectedIndexes = entries.map((entry, index) => selected.has(entry.panelId) ? index : -1).filter((index) => index >= 0);
    if (mode === "combine" && selectedIndexes.some((index, order) => order > 0 && index !== selectedIndexes[order - 1] + 1)) {
      setToast("只能把阅读顺序中相邻的画格组合成一个 Shot");
      return;
    }
    const firstSelected = selectedIndexes[0];
    const lastSelected = selectedIndexes[selectedIndexes.length - 1];
    const groups: typeof entries[] = [];
    let cursor = 0;
    while (cursor < entries.length) {
      if (mode === "exclude" && selected.has(entries[cursor].panelId)) {
        cursor += 1;
        continue;
      }
      if (mode === "combine" && cursor === firstSelected) {
        groups.push(entries.slice(firstSelected, lastSelected + 1));
        cursor = lastSelected + 1;
        continue;
      }
      if (mode === "split" && selected.has(entries[cursor].panelId)) {
        groups.push([entries[cursor]]);
        cursor += 1;
        continue;
      }
      const originIndex = entries[cursor].originIndex;
      const group = [entries[cursor]];
      cursor += 1;
      while (cursor < entries.length
        && entries[cursor].originIndex === originIndex
        && !(mode === "combine" && cursor >= firstSelected && cursor <= lastSelected)
        && !(mode === "split" && selected.has(entries[cursor].panelId))
        && !(mode === "exclude" && selected.has(entries[cursor].panelId))) {
        group.push(entries[cursor]);
        cursor += 1;
      }
      groups.push(group);
    }
    if (!groups.length) {
      setToast("项目至少需要保留一个漫画画格");
      return;
    }
    const reviews = renumberStructure(groups.map((group) => {
      const originPanels = group[0].origin.shot.sourcePanels || [];
      const groupPanels = group.map((entry) => entry.panelId);
      const isWholeOrigin = group.every((entry) => entry.originIndex === group[0].originIndex)
        && originPanels.length === groupPanels.length
        && originPanels.every((panelId, index) => panelId === groupPanels[index]);
      return isWholeOrigin ? group[0].origin : combinedPanelReview(group.map((entry) => entry.atomic));
    }));
    const targetIndex = Math.max(0, groups.findIndex((group) => group.some((entry) => selected.has(entry.panelId))));
    setStructureHistory((history) => [...history.slice(-19), state.reviews]);
    setArtworkRecord({ shotId: "", dataUrls: [] });
    setState((previous) => ({
      ...previous,
      reviews,
      currentShot: targetIndex,
      sourceDocument: sourceDocumentFromShots(reviews.map((item) => item.shot)),
      assetPrompts: [],
      structureStatus: "draft",
      structureConfirmedAt: undefined,
      view: "script",
    }));
    setSelectedStructurePanelIds([]);
    setPanelSelectionAnchor("");
    setToast(mode === "combine"
      ? `已把 ${selected.size} 张相邻画格组合为一个 Shot`
      : mode === "split"
        ? `已把 ${selected.size} 张画格拆成独立编组单位`
        : `已从成片结构中排除 ${selected.size} 张画格；原漫画文件仍保留`);
  }

  function moveStructurePanelsByDrag(event: DragEvent<HTMLElement>, target: PanelDropTarget) {
    event.preventDefault();
    event.stopPropagation();
    if (structureConfirmed) {
      finishStructurePanelDrag();
      setToast("镜头结构已经确认；需要调整时请先重新打开结构编辑");
      return;
    }
    // Only accept a drag started by this board, never external image/text payloads.
    const plan = planPanelDrop(state.reviews.map((item) => item.shot.sourcePanels || []), draggedStructurePanelIdsRef.current, target);
    if (!plan) {
      finishStructurePanelDrag();
      setToast("画格位置没有变化");
      return;
    }
    const { groups, draggedIds, targetIndex, creating } = plan;
    const atomicByPanelId = new Map<string, ShotReview>();
    state.reviews.forEach((origin) => (origin.shot.sourcePanels || []).forEach((panelId) => {
      atomicByPanelId.set(panelId, atomicPanelReview(origin, panelId));
    }));
    const reviews = renumberStructure(groups.map((group) => {
      const origin = state.reviews[group.originIndex];
      const originPanels = origin?.shot.sourcePanels || [];
      const unchanged = origin && originPanels.length === group.panelIds.length
        && originPanels.every((panelId, index) => panelId === group.panelIds[index]);
      if (unchanged) return origin;
      const atomicReviews = group.panelIds
        .map((panelId) => atomicByPanelId.get(panelId))
        .filter((item): item is ShotReview => Boolean(item));
      return combinedPanelReview(atomicReviews);
    }));
    setStructureHistory((history) => [...history.slice(-19), state.reviews]);
    setArtworkRecord({ shotId: "", dataUrls: [] });
    setState((previous) => ({
      ...previous,
      reviews,
      currentShot: targetIndex,
      sourceDocument: sourceDocumentFromShots(reviews.map((item) => item.shot)),
      assetPrompts: [],
      structureStatus: "draft",
      structureConfirmedAt: undefined,
      view: "script",
    }));
    setSelectedStructurePanelIds(draggedIds);
    setPanelSelectionAnchor(draggedIds[0] || "");
    const targetShotId = reviews[targetIndex]?.shot.id || String(targetIndex + 1).padStart(2, "0");
    finishStructurePanelDrag();
    setToast(`${creating ? "已新建" : "已移入"} Shot ${targetShotId}（${draggedIds.length} 张画格）；可用“撤销上一步”恢复`);
  }

  function renderNewShotDropZone(index: number, atEnd = false) {
    const target: PanelDropTarget = { reviewIndex: -1, position: "end", createShotAt: index };
    return (
      <div
        className={`panel-new-shot-drop ${atEnd ? "is-end" : "is-between"} ${panelDropTarget?.createShotAt === index ? "is-drop-target" : ""}`}
        role="region"
        aria-label={atEnd ? "拖到这里新建 Shot" : `在 Shot ${index + 1} 前新建 Shot`}
        onDragEnter={(event) => markStructurePanelDrop(event, target)}
        onDragOver={(event) => markStructurePanelDrop(event, target)}
        onDrop={(event) => moveStructurePanelsByDrag(event, target)}
      >
        <b>＋</b><span>{atEnd ? "拖到这里新建 Shot" : "新建 Shot"}</span>
        {atEnd ? <small>将一张或选中的多张画格拖入</small> : null}
      </div>
    );
  }

  function moveSelectedPanelsToAdjacent(direction: -1 | 1) {
    if (!selectedStructurePanelIds.length) {
      setToast("请先选择要移动的漫画画格");
      return;
    }
    const selectedEntries = structurePanelEntries.filter((entry) => selectedStructurePanelIds.includes(entry.panelId));
    const reviewIndexes = [...new Set(selectedEntries.map((entry) => entry.reviewIndex))];
    if (reviewIndexes.length !== 1) {
      setToast("移动画格时，请只选择同一个 Shot 里的相邻画格");
      return;
    }
    const originIndex = reviewIndexes[0];
    const targetIndex = originIndex + direction;
    const targetPanels = state.reviews[targetIndex]?.shot.sourcePanels || [];
    const originPanels = state.reviews[originIndex]?.shot.sourcePanels || [];
    if (!targetPanels.length) {
      setToast(direction < 0 ? "前面没有可并入的 Shot" : "后面没有可并入的 Shot");
      return;
    }
    const selectedSet = new Set(selectedStructurePanelIds);
    const selectedPositions = originPanels.map((panelId, index) => selectedSet.has(panelId) ? index : -1).filter((index) => index >= 0);
    const touchesBoundary = direction < 0
      ? selectedPositions[0] === 0
      : selectedPositions[selectedPositions.length - 1] === originPanels.length - 1;
    if (!touchesBoundary) {
      setToast(direction < 0 ? "要并入前一组，请选择当前 Shot 最前面的连续画格" : "要并入后一组，请选择当前 Shot 最后面的连续画格");
      return;
    }
    applyPanelGrouping("combine", direction < 0 ? [...targetPanels, ...selectedStructurePanelIds] : [...selectedStructurePanelIds, ...targetPanels]);
  }

  function renderPanelAssemblyActions(position: "top" | "bottom") {
    return (
      <div className={`panel-assembly-actions is-${position}`} aria-label={`画格编组操作栏（${position === "top" ? "顶部" : "底部"}）`}>
        <span>已选 {selectedStructurePanelIds.length} 张 · Shift 连选 · 拖入 Shot 尾部，不改变两组内部顺序 · 拖到 ＋ 新建 Shot</span>
        <button type="button" className="button secondary" disabled={!state.sourceMangaReadingPages?.length} onClick={correctStructureReadingOrder}>按原页校正阅读顺序</button>
        <button type="button" className="button secondary" disabled={selectedStructurePanelIds.length < 2} onClick={() => applyPanelGrouping("combine")}>组合选中画格为一个 Shot</button>
        <button type="button" className="button secondary" disabled={!selectedStructurePanelIds.length} onClick={() => moveSelectedPanelsToAdjacent(-1)}>并入前一组</button>
        <button type="button" className="button secondary" disabled={!selectedStructurePanelIds.length} onClick={() => moveSelectedPanelsToAdjacent(1)}>并入后一组</button>
        <button type="button" className="button secondary" disabled={!selectedStructurePanelIds.length} onClick={() => applyPanelGrouping("split")}>选中画格拆成单格</button>
        <button type="button" className="button danger" disabled={!selectedStructurePanelIds.length} onClick={() => applyPanelGrouping("exclude")}>删除选中画格</button>
        <button type="button" className="button secondary" disabled title="未来支持上传画师补画或新建空白分镜">＋ 新增手绘分镜（未来）</button>
        <button type="button" className="text-button" disabled={!selectedStructurePanelIds.length} onClick={() => { setSelectedStructurePanelIds([]); setPanelSelectionAnchor(""); }}>取消选择</button>
        <button type="button" className="text-button" disabled={!structureHistory.length} onClick={undoStructureChange}>撤销上一步</button>
      </div>
    );
  }

  function correctStructureReadingOrder() {
    if (structureConfirmed || !state.sourceMangaReadingPages?.length) return;
    const order = buildMangaReadingOrder(state.sourceMangaReadingPages, state.sourceMangaReadingDirection);
    const corrected = correctMangaReviewOrder(state.reviews, order.panelIds);
    if (corrected.changedShotIds.length) {
      setStructureHistory((history) => [...history.slice(-19), state.reviews]);
      setState((previous) => ({ ...previous, reviews: corrected.reviews, structureStatus: "draft", structureConfirmedAt: undefined }));
    }
    setToast([
      corrected.changedShotIds.length ? `已校正 ${corrected.changedShotIds.length} 个 Shot 的阅读顺序；不重裁、不改分组，旧讨论稿待复核，可撤销。` : "当前可校正的 Shot 已符合原页顺序。",
      corrected.blockedShotIds.length ? `Shot ${corrected.blockedShotIds.join("、")} 已批准或任务进行中，未改动。` : "",
      order.issues.length ? `${order.issues.length} 处叠格顺序需人工核对，未强行排列。` : "",
    ].filter(Boolean).join(" "));
  }

  function mergeCurrentWithNext() {
    if (structureConfirmed) {
      setToast("镜头结构已经确认；需要调整时请先重新打开结构编辑");
      return;
    }
    const nextReview = state.reviews[state.currentShot + 1];
    if (!nextReview) {
      setToast("已经是最后一个 Shot，不能再向后合并");
      return;
    }
    const currentShot = normalizeShot(state.reviews[state.currentShot].shot);
    const nextShot = normalizeShot(nextReview.shot);
    const combinedDuration = Math.round(currentShot.duration + nextShot.duration);
    const range = durationRangeFor(generationModel);
    if (combinedDuration > range.max) {
      setToast(`合并后约 ${combinedDuration} 秒，超过 ${range.max} 秒；请保留为两个 Shot`);
      return;
    }
    const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    const omniReferences = unique([...(currentShot.omniReferences || []), ...(nextShot.omniReferences || [])]);
    if (omniReferences.length > referenceLimitFor(generationModel)) {
      setToast("合并后的全能参考超过当前模型上限，不能直接合并");
      return;
    }
    const makeSegment = (source: StoryboardShot, label: string): StoryboardSegment => ({
      label,
      beat: source.story,
      framing: source.composition,
      mustShow: unique([...source.characters, ...source.props]),
    });
    const sourceSegments = currentShot.segments.length ? currentShot.segments : [makeSegment(currentShot, "A")];
    const followingSegments = nextShot.segments.length ? nextShot.segments : [makeSegment(nextShot, "B")];
    const segments = [...sourceSegments, ...followingSegments].map((segment, index) => ({
      ...segment,
      label: String.fromCharCode(65 + index),
    }));
    const mergedShot: StoryboardShot = {
      ...currentShot,
      title: `${currentShot.title}／${nextShot.title}`,
      duration: Math.max(6, combinedDuration),
      sourceText: unique([...(currentShot.sourceText || []), ...(nextShot.sourceText || [])]),
      sourcePanels: unique([...(currentShot.sourcePanels || []), ...(nextShot.sourcePanels || [])]),
      story: `${currentShot.story} 随后，${nextShot.story}`,
      scene: currentShot.scene === nextShot.scene ? currentShot.scene : `${currentShot.scene}；随后进入${nextShot.scene}`,
      characters: unique([...currentShot.characters, ...nextShot.characters]),
      props: unique([...currentShot.props, ...nextShot.props]),
      omniReferences,
      composition: `${currentShot.composition}；随后${nextShot.composition}`,
      camera: `${currentShot.camera}；随后${nextShot.camera}`,
      action: `${currentShot.action}；随后${nextShot.action}`,
      dialogue: unique([...currentShot.dialogue, ...nextShot.dialogue]),
      continuity: unique([...currentShot.continuity, ...nextShot.continuity]),
      negative: unique([...currentShot.negative, ...nextShot.negative]),
      segments,
    };
    const mergeAnnotations = Object.fromEntries(annotationSections.map((section) => {
      const values = [state.reviews[state.currentShot].annotations[section.id], nextReview.annotations[section.id]].map((value) => value?.trim()).filter(Boolean);
      return [section.id, values.join("\n")];
    })) as Record<SectionId, string>;
    const mergedReview = { ...resetReviewForStructure(state.reviews[state.currentShot], mergedShot), annotations: mergeAnnotations };
    setStructureHistory((history) => [...history.slice(-19), state.reviews]);
    setArtworkRecord({ shotId: "", dataUrls: [] });
    setState((previous) => {
      const reviews = renumberStructure([
        ...previous.reviews.slice(0, previous.currentShot),
        mergedReview,
        ...previous.reviews.slice(previous.currentShot + 2),
      ]);
      return {
        ...previous,
        reviews,
        sourceDocument: sourceDocumentFromShots(reviews.map((item) => item.shot)),
        assetPrompts: [],
        structureStatus: "draft",
        structureConfirmedAt: undefined,
        view: "script",
      };
    });
    setToast(`已合并为一个 ${Math.max(6, combinedDuration)} 秒 Shot；后续镜头已自动重编号`);
  }

  function deleteCurrentShot() {
    if (structureConfirmed) {
      setToast("镜头结构已经确认；需要调整时请先重新打开结构编辑");
      return;
    }
    if (state.reviews.length <= 1) {
      setToast("项目至少需要保留一个 Shot");
      return;
    }
    if (!window.confirm(`删除 Shot ${shot.id}「${shot.title}」？来源漫画不会删除，后续镜头会自动重编号。`)) return;
    setStructureHistory((history) => [...history.slice(-19), state.reviews]);
    setArtworkRecord({ shotId: "", dataUrls: [] });
    setState((previous) => {
      const reviews = renumberStructure(previous.reviews.filter((_, index) => index !== previous.currentShot));
      return {
        ...previous,
        reviews,
        currentShot: Math.min(previous.currentShot, reviews.length - 1),
        sourceDocument: sourceDocumentFromShots(reviews.map((item) => item.shot)),
        assetPrompts: [],
        structureStatus: "draft",
        structureConfirmedAt: undefined,
        view: "script",
      };
    });
    setToast("当前 Shot 已删除；来源漫画仍保留，可返回漫画拆解结果恢复");
  }

  function confirmedAssetPrompts(reviews: ShotReview[], settings: GlobalSettings): ProjectAssetPrompt[] {
    const prompts: ProjectAssetPrompt[] = [];
    reviews.forEach((item) => {
      const targetShot = normalizeShot(item.shot);
      deriveShotAssets(targetShot).forEach((asset) => {
        const sourcePanels = targetShot.sourcePanels || [];
        prompts.push({
          id: `${targetShot.id}::${asset.id}`,
          kind: asset.kind,
          name: asset.name,
          sourceObservation: targetShot.sourcePanels?.length
            ? `Shot ${targetShot.id} 批准后独立建立；来源画格：${targetShot.sourcePanels.join("、")}。外观细节以本镜原作裁图为准。`
            : `Shot ${targetShot.id} 批准后独立建立；外观细节待补充参考。`,
          prompt: defaultShotAssetPrompt(asset, targetShot, settings),
          negative: [...targetShot.negative],
          sourcePanels,
          shotIds: [targetShot.id],
        });
      });
    });
    return prompts;
  }

  function reopenShotStructure() {
    if (!window.confirm("重新编辑镜头结构会清空现有资产提示词、出图和审批状态；来源漫画与脚本内容会保留。继续吗？")) return;
    setArtworkRecord({ shotId: "", dataUrls: [] });
    setState((previous) => ({
      ...previous,
      structureStatus: "draft",
      structureConfirmedAt: undefined,
      assetPrompts: [],
      view: "script",
      reviews: renumberStructure(previous.reviews),
    }));
    setToast("已重新打开镜头结构编辑");
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
    await putArtworks(artworkStorageScope, whiteboxReferenceStorageKey(projectStorageTitle, shot.id, key), [dataUrl]);
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
    await deleteArtworks(artworkStorageScope, whiteboxReferenceStorageKey(projectStorageTitle, shot.id, key));
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
    const projectUid = ensureProjectUid("", `${projectTitle.trim() || "未命名脚本"}::${sourceName || "载入脚本"}::${Date.now()}`);
    setArtworkRecord({ shotId: "", dataUrls: [] });
    setLastSubmission(undefined);
    setLastBatchSubmissions({});
    setState({
      stateSchemaVersion,
      projectUid,
      projectTitle: projectTitle.trim() || "未命名脚本",
      sourceDocument: sourceDocument.trim() || sourceDocumentFromShots(normalizedShots),
      sourceName: sourceName.trim() || "载入脚本（原文依据由镜头恢复，需复核）",
      selectedRecipeId: defaultDirectorRecipeId,
      generationModel,
      workspaceMode: "shots",
      globalSettings: cloneGlobalSettings(),
      globalAnnotation: "",
      globalStatus: "applied",
      structureStatus: "confirmed",
      structureConfirmedAt: new Date().toISOString(),
      currentShot: 0,
      view: "script",
      reviews: createReviews(normalizedShots, projectTitle.trim() === defaultProjectTitle, projectUid),
    });
    setNaturalScript("");
    setShowLoader(false);
    setToast(`已载入《${projectTitle.trim() || "未命名脚本"}》，共 ${shots.length} 个 Shot`);
  }

  async function loadScriptThroughWritingModel(content: string, fileName: string, sourceType: "file" | "natural-language") {
    if (!bridge.connected || !bridge.pairingToken) {
      setToast("Pi Agent Harness 未启动，暂时不能解析自然语言脚本");
      return;
    }
    if (bridge.busy) {
      setToast("写作模型正在处理当前任务，完成后才能载入新脚本");
      return;
    }
    if (!content.trim()) {
      setToast("先输入脚本内容或自然语言描述");
      return;
    }
    setLoadingScript(true);
    setBridge((current) => ({ ...current, busy: true }));
    try {
      const response = await bridgeFetch(`${bridgeBase}/load-script`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Manjing-Token": bridge.pairingToken,
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
      if (!response.ok) throw new Error(result.error || "写作模型解析脚本失败");
      if (!result.projectTitle || !Array.isArray(result.shots) || !result.shots.length || !result.shots.every(isStoryboardShot)) {
        throw new Error("写作模型返回的脚本格式不完整");
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
      await loadScriptThroughWritingModel(content, file.name, "file");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "读取脚本文件失败");
    }
  }

  function loadNaturalScript() {
    void loadScriptThroughWritingModel(naturalScript, "写作模型自然语言输入", "natural-language");
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
    const firstApproved = state.reviews.find((item) => item.approved);
    if (!firstApproved) {
      setToast("先批准至少一个 Shot，再准备该 Shot 的资产");
      return;
    }
    setShowLoader(false);
    setAssetSelectedShotId(review.approved ? shot.id : firstApproved.shot.id);
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
    const copied = await copyTextToClipboard(targetPackage.prompt);
    setToast(copied ? `Shot ${targetPackage.shotId} 视频提示词已复制` : "无法写入剪贴板，请手动复制提示词");
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

  function downloadProjectManifest() {
    const packagesByShot = new Map(videoPackages.map((item) => [item.shotId, item]));
    const payload = {
      ...buildProjectManifest({
        projectUid: state.projectUid,
        projectTitle: state.projectTitle,
        sourceName: state.sourceName,
        sourceMangaRequestId: state.sourceMangaRequestId,
        generationModel,
        pipeline: productionPipeline,
        shots: state.reviews.map((item) => {
          const videoPackage = packagesByShot.get(item.shot.id);
          return {
            shotUid: item.shot.shotUid,
            displayNumber: item.shot.id,
            title: item.shot.title,
            sourcePanels: item.shot.sourcePanels || [],
            scriptStatus: item.scriptStatus,
            completePromptStatus: item.completePromptStatus || "empty",
            promptReviewStatus: item.promptReviewStatus || "empty",
            promptReviewVerdict: item.promptReviewReport?.verdict,
            approved: item.approved,
            approvedAt: item.approvedAt,
            videoPackageStatus: videoPackage?.status || "blocked",
            sourceRevision: videoPackage?.sourceRevision,
          };
        }),
      }),
      exportedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.projectTitle}-manifest.json`.replace(/[\\/:*?"<>|]/g, "-");
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setToast("项目清单已导出；它将作为后续项目包与 LibTV 生视频的身份依据");
  }

  function returnToShots() {
    setState((previous) => ({ ...previous, workspaceMode: "shots" }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function createMaterialDraft(result: MediaAnalysisResult, targetShotId?: string) {
    result = normalizeMangaAnalysisReadingOrder(result, result.readingDirection);
    if (!result.projectTitle?.trim() || !Array.isArray(result.shots) || !result.shots.length || !result.shots.every(isStoryboardShot)) {
      setToast("素材分析结果还不能创建漫镜草稿");
      return;
    }
    const materialShotIds = result.shots.map((shot) => shot.id);
    const shotIdCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
    const validShotIds = materialShotIds.every((shotId) => /^\d{2}[A-Z]?$/.test(shotId))
      && new Set(materialShotIds).size === materialShotIds.length
      && materialShotIds.every((shotId, index) => index === 0 || shotIdCollator.compare(materialShotIds[index - 1], shotId) < 0);
    if (!validShotIds) {
      setToast("素材分析结果的 Shot 编号格式、顺序或唯一性无效，暂不能创建漫镜草稿");
      return;
    }
    const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    const analysisAssetPrompts = normalizeProjectAssetPrompts((result as MediaAnalysisResult & { assetPrompts?: unknown }).assetPrompts);
    const analysisMangaPanels = mangaPanelUnderstandingsFrom(result);
    const artStyles = unique(result.shots.map((shot) => shot.artStyle));
    const draftGlobalSettings: GlobalSettings = {
      storyBackground: result.projectBackground?.trim() || state.globalSettings.storyBackground || sourceGlobalSettings.storyBackground,
      adaptationFocus: state.globalSettings.adaptationFocus,
      characterProfiles: normalizeCharacterProfiles(state.globalSettings.characterProfiles),
      characters: unique(result.shots.flatMap((shot) => shot.characters)),
      props: unique(result.shots.flatMap((shot) => shot.props)),
      locations: unique(result.shots.map((shot) => shot.scene)),
      timeline: result.shots.map((shot) => `Shot ${shot.id} · ${shot.timecode} · ${shot.title}`),
      continuity: unique(result.shots.flatMap((shot) => shot.continuity)),
      finalVideoStyle: artStyles.length === 1 ? artStyles[0] : "最终视频风格按各 Shot 的 artStyle 分别执行，未确认前不套用原项目画风。",
      storyboardImageStyle: sourceGlobalSettings.storyboardImageStyle,
      modelRules: generationModel === "seedance-2.5"
        ? ["Seedance 2.5：每镜 4–30 秒，最多 50 个全能参考。"]
        : ["Seedance 2.0：每镜 6–15 秒，最多 9 个全能参考。"],
      negative: unique(result.shots.flatMap((shot) => shot.negative)),
    };
    const targetShotIndex = Math.max(0, targetShotId ? result.shots.findIndex((shot) => shot.id === targetShotId) : 0);
    const draftId = /^[a-f0-9-]{36}$/i.test(result.requestId || "") ? result.requestId as string : crypto.randomUUID();
    const draftStorageKey = `${materialDraftStoragePrefix}${draftId}`;
    let draftState: ReviewState = {
      stateSchemaVersion,
      projectUid: ensureProjectUid("", `manga-draft::${draftId}`),
      projectTitle: result.projectTitle.trim(),
      sourceDocument: sourceDocumentFromShots(result.shots),
      sourceName: "素材拉片／漫画拆解结果（依据待复核）",
      selectedRecipeId: defaultDirectorRecipeId,
      generationModel,
      workspaceMode: "shots",
      globalSettings: draftGlobalSettings,
      assetPrompts: [],
      globalAnnotation: "",
      globalStatus: "applied",
      structureStatus: "draft",
      structureConfirmedAt: undefined,
      sourceMangaRequestId: result.kind === "manga" && /^[a-f0-9-]{36}$/i.test(result.requestId || "") ? result.requestId : undefined,
      sourceMangaPanels: analysisMangaPanels,
      sourceMangaPanelUnderstandingVersion: mangaPanelUnderstandingVersion,
      sourceMangaPanelAnnotations: {},
      sourceMangaReadingDirection: result.readingDirection || "right-to-left",
      sourceMangaReadingPages: result.mangaPages,
      currentShot: targetShotIndex,
      view: "script",
      reviews: createReviews(result.shots, false, ensureProjectUid("", `manga-draft::${draftId}`)),
    };
    try {
      const existing = scopedBrowserStorage.getItem(draftStorageKey);
      if (existing) {
        const parsed = repairKnownMangaDraftState(JSON.parse(existing) as ReviewState, draftId);
        const sameShotStructure = parsed.reviews?.length === result.shots.length
          && result.shots.every((sourceShot, index) => (
            parsed.reviews[index]?.shot.id === sourceShot.id
          ));
        if (parsed.projectTitle === result.projectTitle.trim() && sameShotStructure) {
          const parsedProjectUid = ensureProjectUid(parsed.projectUid, `manga-draft::${draftId}`);
          draftState = repairKnownMangaDraftState({
            ...parsed,
            projectUid: parsedProjectUid,
            sourceMangaRequestId: result.kind === "manga" ? result.requestId || parsed.sourceMangaRequestId : undefined,
            sourceMangaPanels: result.kind === "manga" ? analysisMangaPanels : parsed.sourceMangaPanels,
            sourceMangaReadingDirection: result.readingDirection || parsed.sourceMangaReadingDirection || "right-to-left",
            sourceMangaReadingPages: result.kind === "manga" ? result.mangaPages : parsed.sourceMangaReadingPages,
            sourceMangaPanelUnderstandingVersion: result.kind === "manga"
              ? mangaPanelUnderstandingVersion
              : parsed.sourceMangaPanelUnderstandingVersion,
            workspaceMode: "shots",
            currentShot: targetShotIndex,
            view: "script",
            assetPrompts: parsed.structureStatus === "confirmed"
              ? mergeProjectAssetPrompts(parsed.assetPrompts, analysisAssetPrompts)
              : [],
            reviews: parsed.reviews.map((review, index) => parsed.structureStatus === "draft"
              ? {
                  ...createReview(result.shots[index], false, parsedProjectUid, `${index}::${result.shots[index].id}`),
                  annotations: { ...emptyAnnotations(), ...(review.annotations || {}) },
                }
              : {
                  ...review,
                  shot: {
                    ...review.shot,
                    sourcePanels: result.shots[index].sourcePanels,
                    sourceText: [...new Set([...(review.shot.sourceText || []), ...(result.shots[index].sourceText || [])])],
                  },
                }),
          }, draftId);
        }
      }
      draftState = repairKnownMangaDraftState(draftState, draftId);
      scopedBrowserStorage.setItem(draftStorageKey, JSON.stringify(draftState));
      scopedBrowserStorage.setItem(recentMaterialDraftKey, draftId);
    } catch {
      setToast("无法保存漫画分镜草稿，请检查浏览器本地存储空间");
      return;
    }
    const draftUrl = `/?draft=${encodeURIComponent(draftId)}`;
    window.location.assign(draftUrl);
  }

  function updateGlobalArray(field: (typeof globalArrayFields)[number], value: string[]) {
    setState((previous) => ({
      ...previous,
      globalStatus: "draft",
      globalSettings: { ...previous.globalSettings, [field]: value },
      reviews: previous.reviews.map(invalidateCompletePrompt),
      structureStatus: "draft",
      structureConfirmedAt: undefined,
    }));
  }

  function updateCharacterProfile(profileId: string, field: keyof Omit<CharacterProfile, "id">, value: string) {
    setState((previous) => ({
      ...previous,
      globalStatus: "draft",
      globalSettings: {
        ...previous.globalSettings,
        characterProfiles: normalizeCharacterProfiles(previous.globalSettings.characterProfiles).map((profile) => (
          profile.id === profileId ? { ...profile, [field]: value } : profile
        )),
      },
      reviews: previous.reviews.map(invalidateCompletePrompt),
      structureStatus: "draft",
      structureConfirmedAt: undefined,
    }));
  }

  function addCharacterProfile() {
    const profile: CharacterProfile = {
      id: `character-${crypto.randomUUID()}`,
      name: "新人物",
      japaneseName: "",
      biography: "",
      identity: "",
      appearance: "",
      wardrobe: "",
      performanceBoundary: "",
      faceRestriction: "",
    };
    setState((previous) => ({
      ...previous,
      globalStatus: "draft",
      globalSettings: {
        ...previous.globalSettings,
        characterProfiles: [...normalizeCharacterProfiles(previous.globalSettings.characterProfiles), profile],
      },
      reviews: previous.reviews.map(invalidateCompletePrompt),
      structureStatus: "draft",
      structureConfirmedAt: undefined,
    }));
  }

  function removeCharacterProfile(profileId: string) {
    setState((previous) => ({
      ...previous,
      globalStatus: "draft",
      globalSettings: {
        ...previous.globalSettings,
        characterProfiles: normalizeCharacterProfiles(previous.globalSettings.characterProfiles).filter((profile) => profile.id !== profileId),
      },
      reviews: previous.reviews.map(invalidateCompletePrompt),
      structureStatus: "draft",
      structureConfirmedAt: undefined,
    }));
  }

  function updateGlobalString(field: "storyBackground" | "adaptationFocus" | "finalVideoStyle" | "storyboardImageStyle", value: string) {
    setState((previous) => ({
      ...previous,
      globalStatus: "draft",
      globalSettings: { ...previous.globalSettings, [field]: value },
      reviews: previous.reviews.map(invalidateCompletePrompt),
      structureStatus: "draft",
      structureConfirmedAt: undefined,
    }));
  }

  async function persistProjectNow(detail: ManjingSaveProjectEventDetail) {
    if (!bridge.connected || !bridge.pairingToken || !projectArchiveLoaded) {
      throw new Error("项目存档尚未加载完成，请稍后再保存");
    }
    return persistProjectSnapshot({
      fetcher: bridgeFetch, apiBase: bridgeBase, snapshot: state,
      scopeId: projectScopeId || "main", storageKey: activeStorageKey,
      appliedAgentRevision: appliedAgentDraftRevision.current,
      pairingToken: bridge.pairingToken, materialDraftMode, workspaceScope,
      serverProjectId: tenantScope.mode === "server" ? tenantScope.projectId : undefined,
      signal: detail.signal, onProgress: detail.onProgress,
    });
  }

  useEffect(() => {
    const receiveSaveProject = (event: Event) => {
      const detail = (event as CustomEvent<ManjingSaveProjectEventDetail>).detail;
      if (!detail) return;
      detail.handled = true;
      void persistProjectNow(detail).then(detail.resolve).catch((error) => {
        detail.reject(error instanceof Error ? error.message : "项目保存失败");
      });
    };
    window.addEventListener(MANJING_SAVE_PROJECT_EVENT, receiveSaveProject);
    return () => window.removeEventListener(MANJING_SAVE_PROJECT_EVENT, receiveSaveProject);
  });

  async function saveGlobalSettings() {
    if (!bridge.connected || !bridge.pairingToken) {
      setToast("本地桥接未启动，暂时不能回写全局设定源文件");
      return;
    }
    if (bridge.busy) {
      setToast("写作模型正在处理当前任务，完成后再保存全局设定");
      return;
    }
    setSavingGlobalSettings(true);
    const normalizedSettings = cloneGlobalSettings(state.globalSettings);
    try {
      const response = await bridgeFetch(`${bridgeBase}/source-global-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Manjing-Token": bridge.pairingToken },
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

  async function refreshGlobalFiles(preferredId = "") {
    if (tenantScope.mode !== "server") return [] as GlobalFileSummary[];
    const response = await bridgeFetch(`${bridgeBase}/global-files`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "全局文件列表加载失败");
    const files = Array.isArray(result.files) ? result.files.filter((item: unknown): item is GlobalFileSummary => {
      const candidate = item as Partial<GlobalFileSummary>;
      return typeof candidate?.id === "string" && typeof candidate.name === "string";
    }) : [];
    setGlobalFiles(files);
    const nextId = preferredId || state.globalFileId || selectedGlobalFileId || files[0]?.id || "";
    setSelectedGlobalFileId(files.some((item) => item.id === nextId) ? nextId : files[0]?.id || "");
    return files;
  }

  function openGlobalFileNameDialog(createNew: boolean) {
    setGlobalFileNameDraft(createNew ? state.globalFileName || "" : "");
    setGlobalFileNameError("");
    setGlobalFileNameDialog({ open: true, createNew });
  }

  async function saveGlobalFile({ createNew = false, requestedName = "" }: { createNew?: boolean; requestedName?: string } = {}) {
    if (tenantScope.mode !== "server") {
      setToast("全局文件库需要登录服务器后使用");
      return;
    }
    const current = globalFiles.find((item) => item.id === (state.globalFileId || selectedGlobalFileId));
    const normalizedName = requestedName.trim() || (!createNew ? current?.name || state.globalFileName : "");
    if (!normalizedName) {
      openGlobalFileNameDialog(createNew);
      return;
    }
    setGlobalFileBusy(true);
    setGlobalFileNameError("");
    try {
      const payload: GlobalFilePayload = {
        schemaVersion: 1,
        settings: cloneGlobalSettings(state.globalSettings),
        assetPrompts: normalizeProjectAssetPrompts(state.assetPrompts),
        referenceAssets: [],
      };
      const response = await bridgeFetch(`${bridgeBase}/global-files/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          globalFileId: createNew ? undefined : current?.id,
          name: normalizedName,
          payload,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.file?.id) throw new Error(result.error || "全局文件保存失败");
      setState((previous) => ({
        ...previous,
        globalFileId: result.file.id,
        globalFileName: result.file.name,
        globalStatus: "applied",
        globalUpdatedAt: result.file.updatedAt || new Date().toISOString(),
        globalSummary: `已保存全局文件「${result.file.name}」，可跨项目加载`,
      }));
      await refreshGlobalFiles(result.file.id);
      setToast(`全局文件「${result.file.name}」已保存`);
      setGlobalFileNameDialog({ open: false, createNew: false });
      setGlobalFileNameDraft("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "全局文件保存失败";
      setToast(message);
      if (globalFileNameDialog.open) setGlobalFileNameError(message);
    } finally {
      setGlobalFileBusy(false);
    }
  }

  async function loadGlobalFile() {
    if (!selectedGlobalFileId) {
      setToast("请先选择要加载的全局文件");
      return;
    }
    setGlobalFileBusy(true);
    try {
      const response = await bridgeFetch(`${bridgeBase}/global-files/load?id=${encodeURIComponent(selectedGlobalFileId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      const payload = result.file?.payload as Partial<GlobalFilePayload> | undefined;
      if (!response.ok || !result.file?.id || !isGlobalSettings(payload?.settings)) {
        throw new Error(result.error || "全局文件内容不完整");
      }
      const settings = cloneGlobalSettings(payload.settings);
      setState((previous) => ({
        ...previous,
        globalFileId: result.file.id,
        globalFileName: result.file.name,
        globalSettings: settings,
        assetPrompts: normalizeProjectAssetPrompts(payload.assetPrompts),
        globalStatus: "applied",
        globalUpdatedAt: new Date().toISOString(),
        globalSummary: `已从全局文件「${result.file.name}」加载到当前项目`,
        reviews: previous.reviews.map(invalidateCompletePrompt),
        structureStatus: "draft",
        structureConfirmedAt: undefined,
      }));
      setToast(`已加载「${result.file.name}」，当前项目的 Shot 与素材未改动`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "全局文件加载失败");
    } finally {
      setGlobalFileBusy(false);
    }
  }

  useEffect(() => {
    if (state.workspaceMode !== "global" || tenantScope.mode !== "server") return;
    void refreshGlobalFiles().catch((error) => setToast(error instanceof Error ? error.message : "全局文件列表加载失败"));
  }, [state.workspaceMode, tenantScope.mode]);

  async function stampCurrentShot() {
    if (review.approved) return;
    if (stampingShotId) {
      setToast(`Shot ${stampingShotId} 正在回写并盖章，请稍候`);
      return;
    }
    if (review.scriptStatus === "sending" || annotationBusy) {
      setToast("写作模型还在批改当前 Shot，完成后才能盖章");
      return;
    }
    if (!promptReviewIsCurrent) {
      setToast("当前完整提示词还没有通过独立 Reviewer 审查，或审查报告已过期");
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
          setToast("写作模型正在处理全片批改，完成后再给当前 Shot 盖章");
          return;
        }
        const response = await bridgeFetch(`${bridgeBase}/source-shot`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Manjing-Token": bridge.pairingToken },
          body: JSON.stringify({ projectTitle: state.projectTitle, workspaceScope, generationModel, shot: targetShot }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "脚本源文件回写失败");
      }

      const approvedAt = new Date().toISOString();
      setState((previous) => ({
        ...previous,
        reviews: previous.reviews.map((item) => {
          if (item.shot.id !== targetShotId || JSON.stringify(item.shot) !== targetShotSnapshot || item.promptReviewSourceRevision !== review.promptReviewSourceRevision || item.completePrompt !== review.completePrompt) return item;
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
    const imageResponses = await Promise.all(artworkUrls.map((url) => bridgeFetch(url, { cache: "no-store" })));
    if (imageResponses.some((response) => !response.ok)) throw new Error("LibTV 已生成图片，但漫镜读取失败");
    const dataUrls = await Promise.all(imageResponses.map(async (response) => blobToDataUrl(await response.blob())));
    await putArtworks(artworkStorageScope, artworkStorageKey(targetProjectTitle, targetShotId), dataUrls);
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
      setToast("漫镜本地桥接尚未启动，暂时不能登录 LibTV");
      return;
    }
    if (loggingIntoLibtv || bridge.libtv?.loginBusy) return;
    setLoggingIntoLibtv(true);
    setToast(bridge.serverMode ? "正在连接 LibTV 手机号登录" : "已打开 LibTV 登录页，请在浏览器完成登录");
    try {
      const requestLogin = async (payload: Record<string, unknown>) => {
        const response = await bridgeFetch(`${bridgeBase}/libtv/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Manjing-Token": bridge.pairingToken as string },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok && response.status !== 202) throw new Error(result.error || "LibTV 登录失败");
        return result;
      };
      let result;
      if (bridge.serverMode) {
        const phone = window.prompt("输入用于 LibTV 的 11 位手机号（仅发送给你的服务器和 LibTV）")?.trim();
        if (!phone) throw new Error("已取消 LibTV 登录");
        try {
          result = await requestLogin({ phone });
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (!/captcha|人机|验证/iu.test(message)) throw error;
          const captcha = window.prompt("LibTV 要求人机验证。请在 LibTV 验证页完成后，粘贴返回的 captcha JSON 参数")?.trim();
          if (!captcha) throw new Error("未填写 captcha，已停止登录");
          result = await requestLogin({ phone, captcha });
        }
        const code = window.prompt("短信验证码已发送，请输入 6 位验证码")?.trim();
        if (!code) throw new Error("验证码未填写，可稍后重新登录");
        result = await requestLogin({ phone, code });
      } else {
        result = await requestLogin({});
      }
      setBridge((current) => ({ ...current, libtv: result.libtv }));
      setToast("LibTV 登录完成，现在可以用 Lib Image 出图");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "LibTV 登录失败");
    } finally {
      setLoggingIntoLibtv(false);
    }
  }

  async function generateShotAsset(asset: ShotAssetEntry, provider: "libtv" | "gpt") {
    const assetKey = shotAssetStorageKey(projectStorageTitle, shot.id, asset);
    const attemptKey = shotAssetAttemptStorageKey(projectStorageTitle, shot.id, asset);
    const targetAttempt = Math.max(1, Number(scopedBrowserStorage.getItem(attemptKey) || 0) + 1);
    const prompt = resolvedShotAssetPrompt(asset).trim();
    const settings = shotAssetImageSettings[assetKey] || defaultShotAssetImageSettings(asset);
    if (!prompt) {
      setToast(`${asset.name} 的生图提示词不能为空`);
      return;
    }
    if (!bridge.connected || !bridge.pairingToken) {
      setToast("漫镜本地桥接未启动，暂时不能生成资产图");
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
      const response = await bridgeFetch(`${bridgeBase}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Manjing-Token": bridge.pairingToken },
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
      const imageResponses = await Promise.all(urls.map((url) => bridgeFetch(url, { cache: "no-store" })));
      if (imageResponses.some((item) => !item.ok)) throw new Error(`${providerLabel} 已生成资产图，但漫镜读取失败`);
      const dataUrls = await Promise.all(imageResponses.map(async (item) => blobToDataUrl(await item.blob())));
      await putArtworks(artworkStorageScope, assetKey, dataUrls);
      scopedBrowserStorage.setItem(attemptKey, String(targetAttempt));
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
    const assetKey = shotAssetStorageKey(projectStorageTitle, shot.id, asset);
    const dataUrl = await blobToDataUrl(file);
    await putArtworks(artworkStorageScope, assetKey, [dataUrl]);
    setShotAssetImages((current) => ({ ...current, [assetKey]: [dataUrl] }));
    setToast(`已上传“${asset.name}”参考图；只用于 Shot ${shot.id}`);
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
      setToast("漫镜本地桥接未启动，暂时不能出图");
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
        const [dataUrl] = await getArtworks(artworkStorageScope, whiteboxReferenceStorageKey(projectStorageTitle, shot.id, planKey));
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
      const response = await bridgeFetch(`${bridgeBase}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Manjing-Token": targetPairingToken },
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
    await putArtworks(artworkStorageScope, artworkStorageKey(projectStorageTitle, shot.id), [dataUrl]);
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

  function switchDeskMode(nextMode: DeskMode) {
    setDeskMode(nextMode);
    const url = new URL(window.location.href);
    if (nextMode === "strict-review") url.searchParams.set("mode", "review");
    else url.searchParams.delete("mode");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
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
          ? "写作模型已完成，正在取回修改"
          : reconciling
            ? "正在核对任务状态"
            : "写作模型正在处理";
    const startedAt = job?.startedAt || submission?.submittedAt;
    const finishedAt = job?.finishedAt;
    const elapsed = startedAt && finishedAt
      ? Math.max(0, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000))
      : 0;
    const events = job?.events?.length ? job.events : [
      { at: submission?.submittedAt || "", stage: "received", message: "页面已收到批注，并发送给写作模型。" },
      ...(review.scriptStatus === "sending" ? [{
        at: "",
        stage: reconciling ? "reconciling" : "waiting",
        message: reconciling ? "实时服务未发现运行中的任务，正在恢复页面状态。" : "等待写作模型返回结构化修改结果。",
      }] : []),
    ];
    const submittedNotes = submission
      ? annotationSections.filter((section) => (submission.annotations[section.id] || "").trim())
      : [];

    return (
      <section className={`task-monitor ${failed ? "failed" : succeeded ? "succeeded" : "running"}`} aria-live="polite">
        <header>
          <div><span>{job?.type === "annotation-batch" ? `AI TASK · 全片批改 · 当前 SHOT ${shot.id}` : `AI TASK · SHOT ${shot.id}`}</span><h2>{statusLabel}</h2></div>
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
            )) : job ? <p>该任务由另一个“漫镜”标签页发起；这里会同步显示处理进度。请勿重复发送。</p> : <p>本次没有文字批注，直接确认脚本。</p>}
          </div>
        </div>
        {failed ? <div className="task-error"><b>错误</b><p>{job?.error || review.summary || "写作模型处理失败，请重试。"}</p></div> : null}
      </section>
    );
  }

  function renderGlobalTaskProgress() {
    const job = bridge.activeJob?.type === "global-annotation"
      ? bridge.activeJob
      : bridge.lastJob?.type === "global-annotation" ? bridge.lastJob : undefined;
    if (!job) return null;
    const failed = state.globalStatus === "error" || job?.status === "failed";
    const succeeded = job.status === "completed";
    const events = job?.events?.length ? job.events : [{
      at: job.startedAt || "",
      stage: "received",
      message: "页面已收到全局批注，并发送给写作模型。",
    }];
    return (
      <section className={`task-monitor global-task-monitor ${failed ? "failed" : succeeded ? "succeeded" : "running"}`} aria-live="polite">
        <header>
          <div><span>AI TASK · 全局设定</span><h2>{failed ? "处理失败" : succeeded ? "全局修改已应用" : "写作模型正在处理全局批注"}</h2></div>
          <div className="task-runtime"><i />不属于任何 Shot</div>
        </header>
        <div className="task-monitor-body">
          <ol className="task-timeline">
            {events.map((event, index) => (
              <li key={`${event.at}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{event.message}</b><small>{event.at ? new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false }) : "刚刚"}</small></div></li>
            ))}
          </ol>
          <div className="submitted-batch"><span>历史任务</span><p>保留已启动任务的处理进度。</p></div>
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
            <p>配方提供拆解与优化方法，不会自动审批或改变最终美术风格。</p>
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
                  <div><dt>传图顺序</dt><dd>{targetPackage.assets.referenceBindings.map((item) => `${item.token}=${item.label}`).join("；") || "无参考图"}</dd></div>
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
    const locked = savingGlobalSettings || globalBusy || globalFileBusy;
    return (
      <section className="global-settings-page">
        <div className="global-page-heading">
          <div><span>PROJECT LEVEL · NOT A SHOT</span><h1>全局设定</h1><p>这里只维护整部脚本共用的规则。它不占 Shot 编号，也不代替逐镜签字盖章。</p></div>
          <button className="button secondary" type="button" onClick={returnToShots}>返回镜头审核</button>
        </div>
        <section className="global-file-toolbar" aria-label="跨项目全局文件">
          <div><span>GLOBAL FILE LIBRARY</span><b>{state.globalFileName || "当前项目尚未关联全局文件"}</b><small>世界观、美术风格、改编重点及参考资产可跨第6话、第7话等项目复用。</small></div>
          <select aria-label="选择全局文件" value={selectedGlobalFileId} disabled={locked || tenantScope.mode !== "server"} onChange={(event) => setSelectedGlobalFileId(event.target.value)}>
            <option value="">{globalFiles.length ? "选择全局文件" : "暂无全局文件"}</option>
            {globalFiles.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
          </select>
          <button className="button secondary" type="button" disabled={locked || tenantScope.mode !== "server"} onClick={() => openGlobalFileNameDialog(true)}>新建全局文件</button>
          <button className="button secondary" type="button" disabled={locked || tenantScope.mode !== "server" || !selectedGlobalFileId} onClick={() => void loadGlobalFile()}>加载全局文件</button>
          <button className="button primary" type="button" disabled={locked || tenantScope.mode !== "server"} onClick={() => void saveGlobalFile()}>{globalFileBusy ? "保存中…" : "保存全局文件"}</button>
        </section>
        {renderGlobalTaskProgress()}
        <fieldset className="global-settings-fields" disabled={locked} aria-busy={locked}>
          <section className="global-setting-card project-background-canon">
            <div className="global-setting-heading"><span>00 · WORLD</span><h2>项目故事背景</h2><p>整套漫画只写一次。它负责时代、世界观和改编边界；每格漫画仍是剧情、台词、动作和站位的最高证据。</p></div>
            <TextField label="故事背景／世界观" value={state.globalSettings.storyBackground} rows={9} onChange={(value) => updateGlobalString("storyBackground", value)} />
            <TextField label="视频改编重点" value={state.globalSettings.adaptationFocus} rows={7} onChange={(value) => updateGlobalString("adaptationFocus", value)} />
          </section>
          <section className="global-setting-card character-canon">
            <div className="global-setting-heading character-heading">
              <div><span>01 · CHARACTERS</span><h2>人物全局设定</h2><p>每个人物建立一份可跨项目复用的档案；人物传、造型和表演约束只定义一次。</p></div>
              <button className="button secondary" type="button" onClick={addCharacterProfile}>新增人物</button>
            </div>
            <div className="character-profile-list">
              {normalizeCharacterProfiles(state.globalSettings.characterProfiles).map((profile, index) => (
                <article className="character-profile-card" key={profile.id}>
                  <header>
                    <div><span>CHARACTER {String(index + 1).padStart(2, "0")}</span><h3>{profile.name}</h3></div>
                    <button type="button" className="text-button danger" onClick={() => removeCharacterProfile(profile.id)}>删除</button>
                  </header>
                  <div className="character-profile-name-row">
                    <CharacterTextInput label="角色名" value={profile.name} onChange={(value) => updateCharacterProfile(profile.id, "name", value)} />
                    <CharacterTextInput label="日文名" value={profile.japaneseName} onChange={(value) => updateCharacterProfile(profile.id, "japaneseName", value)} />
                  </div>
                  <CharacterTextArea label="人物传" value={profile.biography} rows={5} onChange={(value) => updateCharacterProfile(profile.id, "biography", value)} />
                  <CharacterTextArea label="身份与人物关系" value={profile.identity} onChange={(value) => updateCharacterProfile(profile.id, "identity", value)} />
                  <CharacterTextArea label="外形与定妆" value={profile.appearance} onChange={(value) => updateCharacterProfile(profile.id, "appearance", value)} />
                  <CharacterTextArea label="常用服装与年代约束" value={profile.wardrobe} onChange={(value) => updateCharacterProfile(profile.id, "wardrobe", value)} />
                  <CharacterTextArea label="表演边界" value={profile.performanceBoundary} onChange={(value) => updateCharacterProfile(profile.id, "performanceBoundary", value)} />
                  <CharacterTextArea label="露脸限制" value={profile.faceRestriction} rows={2} onChange={(value) => updateCharacterProfile(profile.id, "faceRestriction", value)} />
                </article>
              ))}
              {!normalizeCharacterProfiles(state.globalSettings.characterProfiles).length ? <div className="character-profile-empty">尚未建立人物档案。点击“新增人物”开始录入。</div> : null}
            </div>
            <LineListField scopeKey={`${listProjectScope}:global:${state.globalFileId || "project"}`} label="人物补充规则（每行一条，兼容旧项目）" value={state.globalSettings.characters} rows={5} onChange={(value) => updateGlobalArray("characters", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>02 · PROPS</span><h2>关键物品</h2><p>维护跨镜道具的唯一性、外观、比例和状态时间线。</p></div>
            <LineListField scopeKey={`${listProjectScope}:global:${state.globalFileId || "project"}`} label="关键物品规则（每行一条）" value={state.globalSettings.props} rows={9} onChange={(value) => updateGlobalArray("props", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>03 · LOCATIONS</span><h2>地点与时代</h2><p>防止新宿站、ALTA、歌舞伎町牌楼和餐厅空间混在一起。</p></div>
            <LineListField scopeKey={`${listProjectScope}:global:${state.globalFileId || "project"}`} label="地点与时代规则（每行一条）" value={state.globalSettings.locations} rows={8} onChange={(value) => updateGlobalArray("locations", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>04 · TIMELINE</span><h2>剧情日期与时间线</h2><p>失踪当晚、次日新闻和姐姐委托分开记录。</p></div>
            <LineListField scopeKey={`${listProjectScope}:global:${state.globalFileId || "project"}`} label="全片时间线（每行一条）" value={state.globalSettings.timeline} rows={8} onChange={(value) => updateGlobalArray("timeline", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>05 · CONTINUITY</span><h2>连续性硬锁</h2><p>所有相关镜头都必须服从的空间、身份与状态规则。</p></div>
            <LineListField scopeKey={`${listProjectScope}:global:${state.globalFileId || "project"}`} label="连续性规则（每行一条）" value={state.globalSettings.continuity} rows={9} onChange={(value) => updateGlobalArray("continuity", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>06 · STYLE</span><h2>美术风格分层</h2><p>最终视频与临时分镜图严格分开，互不反推。</p></div>
            <TextField label="最终视频美术风格" value={state.globalSettings.finalVideoStyle} rows={6} onChange={(value) => updateGlobalString("finalVideoStyle", value)} />
            <TextField label="Lib Image 临时分镜图风格" value={state.globalSettings.storyboardImageStyle} rows={6} onChange={(value) => updateGlobalString("storyboardImageStyle", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>07 · MODEL</span><h2>生成模型规范</h2><p>时长、全能参考上限与动作最小时长。</p></div>
            <LineListField scopeKey={`${listProjectScope}:global:${state.globalFileId || "project"}`} label="模型规范（每行一条）" value={state.globalSettings.modelRules} rows={8} onChange={(value) => updateGlobalArray("modelRules", value)} />
          </section>
          <section className="global-setting-card">
            <div className="global-setting-heading"><span>08 · NEGATIVE</span><h2>全局禁止项</h2><p>任何镜头都不能违反的禁令。</p></div>
            <LineListField scopeKey={`${listProjectScope}:global:${state.globalFileId || "project"}`} label="全局禁止项（每行一条）" value={state.globalSettings.negative} rows={8} onChange={(value) => updateGlobalArray("negative", value)} />
          </section>
        </fieldset>

        <section className="global-save-panel">
          <button className="button secondary" type="button" disabled={locked || bridge.busy || !bridge.connected} onClick={() => void saveGlobalSettings()}>{savingGlobalSettings ? "正在保存项目副本…" : "保存到当前项目"}</button>
          <div className={`global-setting-status ${state.globalStatus}`}><i /><b>{state.globalStatus === "draft" ? "全局设定有未保存修改" : state.globalStatus === "error" ? "全局设定保存失败" : "全局设定已保存"}</b><small>{state.globalSummary || "所有 Shot 读取已保存的全局规则。"}</small></div>
        </section>
      </section>
    );
  }

  function renderShotWorkStatus() {
    const pool = bridge.shotWork;
    return <div className="shot-work-status" role="status"><b>Shot 工作队列</b><span>工作中 {pool?.active ?? 0} / {pool?.limit ?? 5} · 排队 {pool?.queued ?? 0}</span><small>提示词生成、Chat、严格审核共用名额；同一 Shot 串行</small></div>;
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
          <div><span>STEP 01 · SCRIPT</span><h1>脚本</h1><p>人物、物品和场景、剧情、动作、连续、美术风格可直接编辑；讨论与改稿统一使用本镜 Chat。</p></div>
          <div className={`bridge-status ${bridge.connected ? "online" : ""}`}><i />{bridge.connected ? `Pi Agent Harness 已连接 · ${bridge.modelProvider?.label || bridge.modelProvider?.model || "写作模型"}${bridge.harness?.runs?.length ? ` · ${bridge.harness.runs.length} Runs` : ""}` : "Pi Agent Harness 未启动"}</div>
        </div>

        {renderShotWorkStatus()}
        <MangaPanelStrip requestId={mangaSourceRequestId} panelIds={shot.sourcePanels || []} pairingToken={bridge.pairingToken} />

        {!review.approved ? (
          <section className="shot-structure-pending" aria-label="下游生成尚未开始">
            <span>WAITING FOR THIS SHOT</span>
            <h2>批准当前 Shot 后，单独解锁本镜资产</h2>
            <p>每个 Shot 独立运行。批准本镜后，只解锁本镜的人物／场景／道具上传和生成；其他 Shot 不会被连带解锁或修改。</p>
          </section>
        ) : null}

        {review.approved ? (
        <section className="shot-asset-board" aria-label={`Shot ${shot.id} 人物、场景与关键道具资产`}>
          <header className="shot-asset-heading">
            <div><span>SHOT ASSETS · SHOT {shot.id}</span><h2>本镜资产</h2><p>按当前 Shot 独立整理人物、场景和关键道具。每项可用 LibTV CLI、GPT Image 生图，或上传已有参考图；上传和生成结果只属于本镜。</p></div>
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
                    const assetKey = shotAssetStorageKey(projectStorageTitle, shot.id, asset);
                    const images = shotAssetImages[assetKey] || [];
                    const settings = shotAssetImageSettings[assetKey] || defaultShotAssetImageSettings(asset);
                    const availableRatios = assetImageRatiosFor(settings.model);
                    const availableResolutions = assetImageResolutionsFor(settings.model);
                    const remoteAssetJob = bridge.assetJobs?.find((job) => job.shotId === shot.id
                      && job.assetId === asset.id
                      && (!job.projectTitle || job.projectTitle === projectStorageTitle));
                    const generating = Boolean(generatingShotAssetKeys[assetKey] || remoteAssetJob);
                    const referenced = shot.omniReferences.some((reference) => isShotAssetReference(reference, asset));
                    const analyzedAssetPrompt = projectAssetPromptFor(state.assetPrompts, asset, shot.id);
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
        ) : null}

        <fieldset className="script-fields" disabled={scriptLocked} aria-busy={scriptLocked}>
        <ScriptBlock section={sections[0]}>
          <LineListField scopeKey={shotListScope} label="出镜人物（每行一人）" value={shot.characters} rows={5} onChange={(value) => updateField("characters", value)} />
        </ScriptBlock>

        <ScriptBlock section={sections[1]}>
          <div className="sheet-grid">
            <LineListField scopeKey={shotListScope} label="关键物品（车辆也算物品，每行一件）" value={shot.props} rows={5} onChange={(value) => updateField("props", value)} />
            <TextField label="场景" value={shot.scene} rows={4} onChange={(value) => updateField("scene", value)} />
            <TextField label="人物站位、朝向与构图" value={shot.composition} rows={6} onChange={(value) => updateField("composition", value)} />
          </div>
          <div className={`reference-budget ${referencesOverLimit ? "over-limit" : ""}`}>
            <div className="reference-budget-heading">
              <div><span>SEEDANCE · OMNI REFERENCES</span><h3>全能参考清单</h3><p>只列必须锁定外观的角色、车辆、招牌、独特场景和连续道具；普通物品不占参考位。</p></div>
              <strong>{referenceCount} / {referenceLimit}</strong>
            </div>
            <div className="reference-meter" aria-label={`已使用 ${referenceCount} 个，共 ${referenceLimit} 个参考位`}><i style={{ width: `${Math.min(100, (referenceCount / referenceLimit) * 100)}%` }} /></div>
            <LineListTextarea scopeKey={shotListScope}
              rows={Math.min(10, Math.max(5, referenceCount + 1))}
              value={shot.omniReferences}
              aria-label="全能参考清单"
              placeholder="每行一个全能参考，例如：主角角色参考、关键车辆、核心地点"
              onChange={(items) => updateOmniReferences(items.join("\n"))}
            />
            <small>当前模型：{generationModels.find((item) => item.id === generationModel)?.label} · 硬上限 {referenceLimit} 个</small>
          </div>
        </ScriptBlock>

        <ScriptBlock section={sections[2]}>
          <TextField label={`Shot ${shot.id} 剧情`} value={shot.story} rows={6} onChange={(value) => updateField("story", value)} />
          <LineListField scopeKey={shotListScope} label="对白 / 声音（每行一条）" value={shot.dialogue} rows={4} onChange={(value) => updateField("dialogue", value)} />
          {shot.sourcePanels?.length ? (
            <div className="source-panel-trace">
              <span>MANGA SOURCE PANELS</span>
              <div>{shot.sourcePanels.map((panelId) => <b key={panelId}>{panelId}</b>)}</div>
              <small>来源格随本镜保留；Chat 改稿和严格审核不会改变画格归属或阅读顺序。</small>
            </div>
          ) : null}
          <div className="source-evidence-field">
            <div className="source-evidence-heading">
              <div><span>SOURCE TRACE</span><b>原文依据</b><small>这里只放脚本原句；导演改写仍写在上面的剧情和动作里。</small></div>
              <button type="button" onClick={openCoverageReview}>查看全片覆盖率 {coverageReport.coveragePercent}%</button>
            </div>
            <LineListTextarea scopeKey={shotListScope}
              rows={Math.min(8, Math.max(4, sourceTextForShot(shot).length + 1))}
              value={sourceTextForShot(shot)}
              aria-label="原文依据"
              placeholder="每行一条对应原文。没有原文依据时留空，并到“脚本体检”查看未覆盖内容。"
              onChange={(items) => updateField("sourceText", items)}
            />
            <small>当前 Shot 对应 {coverageReport.units.filter((unit) => unit.shotIds.includes(shot.id)).length} 条原文；依据来源：{state.sourceName}</small>
          </div>
        </ScriptBlock>

        <ScriptBlock section={sections[3]}>
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
                  <LineListTextarea scopeKey={`${shotListScope}:${segment.label}`} aria-label={`${segment.label} 必须呈现`} rows={3} value={segment.mustShow} onChange={(items) => updateSegment(index, { mustShow: items })} />
                </div>
              ))}
            </div>
          ) : null}
        </ScriptBlock>

        <ScriptBlock section={sections[4]}>
          <div className="sheet-grid">
            <LineListField scopeKey={shotListScope} label="连续性硬锁（每行一条）" value={shot.continuity} rows={7} onChange={(value) => updateField("continuity", value)} />
            <LineListField scopeKey={shotListScope} label="禁止项（每行一条）" value={shot.negative} rows={7} onChange={(value) => updateField("negative", value)} />
          </div>
        </ScriptBlock>

        <ScriptBlock section={sections[5]}>
          <TextField label="最终视频美术风格（默认从脚本源文件提取）" value={shot.artStyle} rows={6} onChange={(value) => updateField("artStyle", value)} />
          <p className="field-help">这里严格记录脚本中的最终视频风格；Lib Image 只生成临时导演预演工作图，两者互不覆盖。</p>
        </ScriptBlock>
        </fieldset>

        <ShotChat key={shotListScope} shotId={shot.id} model={writingModelSummary} chat={review.chat || {}} approved={review.approved} disabledReason={!bridge.connected ? "主力 Agent 未连接" : bridge.draining ? "服务维护中" : review.completePromptStatus === "generating" || review.promptReviewStatus === "reviewing" ? "当前 Shot 正在生成或审核" : !mangaSourceRequestId || !shot.sourcePanels?.length ? "当前 Shot 尚未关联原作画格" : undefined} onDraft={updateChatDraft} onSend={sendShotChat} onRecover={recoverShotChat} onCopy={(text) => { void copyTextToClipboard(text).then(ok => setToast(ok ? "已复制" : "复制失败，请手动选择文本")); }} />

        <div className="send-panel">
          <div><span>当前 SHOT · 人工确认</span><h2>独立审核后签字盖章</h2><p>需要改稿时，在本镜 Chat 向主力 Agent 提出；修改后必须重新审核。</p></div>
          <div className="send-panel-actions">
            <button className={`button approval-stamp ${review.approved ? "stamped" : ""}`} disabled={review.approved || scriptLocked || Boolean(stampingShotId) || bridge.busy || !promptReviewIsCurrent} onClick={() => void stampCurrentShot()}>{review.approved ? "✓ 已签字盖章 · 审批通过" : stampingShotId === shot.id ? "正在回写并盖章…" : !promptReviewIsCurrent ? "先完成独立 Reviewer 审查" : "签字盖章 · 审批通过"}</button>
            {!promptReviewIsCurrent ? <small className="approval-lock-reason">完整提示词须由独立 Reviewer 审查；报告绑定当前文本，改稿后必须重审。</small> : null}
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
              {review.scriptStatus !== "applied" ? "先保存并确认脚本" : !review.approved ? "先签字盖章" : !artworkPrompt.trim() ? "先填写提示词" : review.artworkStatus === "generating" || artworkJob ? "Lib Image 后台生成 2 张图…" : artwork ? "重新生成 2 张" : "用 Lib Image 生成 2 张"}
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
            <button className="text-button" onClick={() => setView("script")}>返回脚本与 Chat</button>
          </div>
        </div>
      </section>
    );
  }

  if (deskMode === "strict-review") {
    const evidenceModeLabel = selectedPromptReviewer?.evidenceMode === "direct-images"
      ? "直接核对原图"
      : "核对已固化画格证据";
    return (
      <main className="app-shell strict-review-shell">
        <header className="topbar strict-review-topbar">
          <div className="brand-block"><span className="brand-mark">漫镜</span><div><b>漫镜 · 严格审核台</b><small>STRICT REVIEW · 只审不改</small></div></div>
          <div className="desk-mode-switch" role="tablist" aria-label="漫镜工作版本">
            <button type="button" role="tab" aria-selected="false" onClick={() => switchDeskMode("creator")}><b>创作台</b><small>拆图 · 分析 · 重组 · 提示词</small></button>
            <button type="button" role="tab" aria-selected="true" className="active"><b>严格审核台</b><small>挑问题 · 给建议 · 不修改</small></button>
          </div>
        </header>

        <section className="strict-review-hero">
          <div><span>READ-ONLY REVIEW WORKSPACE</span><h1>{state.projectTitle}</h1><p>这里只展示原图证据、Creator 提示词和 Reviewer 报告。没有编辑、重新生成、应用建议或批准入口。</p></div>
          <div className={`strict-review-guard ${bridge.connected ? "ready" : "offline"}`}><i />{bridge.connected ? "只读审核边界已启用" : "正在连接审核服务"}</div>
        </section>

        {renderShotWorkStatus()}
        <nav className="strict-review-shot-nav" aria-label="选择待审核 Shot">
          {state.reviews.map((item, index) => {
            const active = index === state.currentShot;
            const reportReady = item.promptReviewStatus === "ready";
            return <button type="button" key={item.shot.shotUid || item.shot.id} className={`${active ? "active" : ""} ${reportReady ? "reviewed" : ""}`} onClick={() => selectShot(index)}><b>SHOT {item.shot.id}</b><small>{promptReviewShotLabel(item)}</small></button>;
          })}
        </nav>

        <section className="strict-review-grid">
          <div className="strict-review-evidence-column">
            <section className="strict-review-shot-heading"><span>CURRENT SNAPSHOT</span><h2>SHOT {shot.id} · {shot.title}</h2><p>{shot.duration} 秒 · 稳定 ID：{shot.shotUid || "缺失"} · 来源画格 {(shot.sourcePanels || []).join("、") || "无"}</p></section>
            <MangaPanelStrip requestId={mangaSourceRequestId} panelIds={shot.sourcePanels || []} pairingToken={bridge.pairingToken} />
            <section className="strict-review-prompt-card" aria-label={`Shot ${shot.id} 待审提示词只读快照`}>
              <header><div><span>CREATOR PROMPT · READ ONLY</span><h2>待审完整提示词</h2></div><small>{review.completePromptGeneratorId ? `Creator：${review.completePromptGeneratorId}` : "尚无 Creator 模型记录"}</small></header>
              {review.completePrompt?.trim()
                ? <pre>{review.completePrompt}</pre>
                : <div className="strict-review-empty"><b>当前 Shot 还没有提示词讨论稿</b><p>请返回创作台完成拆图、画格分析、重新组合与提示词生成；审核台不会代为生成或修改。</p><button type="button" className="button secondary" onClick={() => switchDeskMode("creator")}>返回创作台</button></div>}
            </section>
          </div>

          <aside className="strict-review-report-column">
            <section className="strict-review-control-card">
              <div><span>INDEPENDENT REVIEWER</span><h2>严格审核</h2><p>每次都是隔离的新 Agent Session，只输出问题、证据与建议。</p></div>
              <label><span>Reviewer 审核模型（不影响 Creator）</span><select value={selectedPromptReviewerId} disabled={reviewControls.selectingDisabled} onChange={(event) => selectPromptReviewer(event.target.value)}>{reviewerOptions.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{item.available ? "" : " · 暂不可用"}</option>)}</select></label>
              <p className="strict-review-evidence-mode"><b>证据方式：</b>{evidenceModeLabel}<br /><b>推理深度：</b>MAX（服务端锁定）</p>
              {!selectedPromptReviewer?.available ? <p className="prompt-review-config">{selectedPromptReviewer?.reason || "当前 Reviewer 的 env 尚未配置完整"}</p> : null}
              {reviewControls.reason ? <div id="strict-review-blocked-reason" className="strict-review-blocked" role="status"><p>{reviewControls.reason}</p>{reviewControls.action === "creator" ? <button type="button" className="button secondary" onClick={() => { switchDeskMode("creator"); openCompleteShotPrompt(state.currentShot); }}>到创作台处理当前提示词</button> : null}</div> : <p className="strict-review-ready" role="status">当前 Shot 已可审核，无需等待其他 Shot 生成完成。</p>}
              <button type="button" className="button primary" disabled={reviewControls.submitDisabled} aria-describedby={reviewControls.reason ? "strict-review-blocked-reason" : undefined} onClick={() => void reviewCompletePrompt()}>{review.promptReviewStatus === "reviewing" ? "严格审核中…" : promptReviewArtifactIsCurrent ? "重新审核当前只读快照" : "提交严格审核"}</button>
              <small>本按钮只创建审核报告，不会改写提示词、Shot、源文件或批准状态。</small>
            </section>

            {review.promptReviewStatus === "error" ? <p className="prompt-review-error">{review.promptReviewError || "严格审核失败，请重试。"}</p> : null}
            {review.promptReviewStatus === "stale" ? <p className="prompt-review-stale">Creator 内容已改变；旧报告只读保留，必须针对当前快照重新审核。</p> : null}
            {review.promptReviewStatus === "reviewing" ? <div className="strict-review-running">{(bridge.promptJobs || []).find(job => job.type === "prompt-review" && job.shotUid === shot.shotUid)?.message || "Reviewer 正在排队或核对当前只读快照，不会修改任何内容…"}</div> : null}
            {review.promptReviewReport ? (
              <section className={`strict-review-report ${review.promptReviewReport.verdict}`}>
                <header><span>REVIEW REPORT</span><h2>{review.promptReviewReport.verdict === "needs-revision" ? "发现问题，需要返回创作台处理" : "未发现阻断问题，可进入人工讨论"}</h2><p>{review.promptReviewReport.summary}</p><small>{review.promptReviewerModel || legacyUnknownModelId} · {review.promptReviewedAt ? new Date(review.promptReviewedAt).toLocaleString("zh-CN") : ""} · 无修改权 · 无批准权</small></header>
                <div className="prompt-review-checks">{Object.entries(review.promptReviewReport.checks).map(([key, passed]) => <span key={key} className={passed ? "pass" : "fail"}>{passed ? "✓" : "!"} {{ sourceBoundary: "剧情边界", characterContinuity: "人物连续性", timingFeasible: "时长可执行", dialogueFeasible: "对白可执行", cameraAndActionCoherent: "镜头动作", soundAndNegativeComplete: "声音禁止项" }[key as keyof PromptReviewReport["checks"]]}</span>)}</div>
                {review.promptReviewReport.findings.length ? <ol className="prompt-review-findings">{review.promptReviewReport.findings.map((finding) => <li key={finding.id} className={finding.severity}><div><span>{finding.severity === "blocking" ? "阻断" : finding.severity === "warning" ? "警告" : "建议"}</span><b>{finding.title}</b><small>{finding.category}{finding.panelIds.length ? ` · ${finding.panelIds.join("、")}` : ""}</small></div><p>{finding.detail}</p><strong>建议方向：{finding.suggestion}</strong></li>)}</ol> : <p className="prompt-review-clean">未发现需要列出的具体问题。</p>}
                {review.promptReviewReport.strengths.length ? <p className="prompt-review-strengths">已确认：{review.promptReviewReport.strengths.join("；")}</p> : null}
                <footer><p>审核只给建议，不改稿。复制后到本 Shot Chat 粘贴发送，由主力 Agent 处理。</p><button type="button" className="button primary" onClick={() => void copyReviewSuggestions()}>复制审核建议</button><button type="button" className="button secondary" onClick={() => { switchDeskMode("creator"); setView("script"); window.setTimeout(() => document.getElementById("shot-chat")?.scrollIntoView({ behavior: "smooth" }), 100); }}>返回创作台 Chat</button></footer>
              </section>
            ) : null}
          </aside>
        </section>
        {toast ? <div className="toast" role="status">{toast}</div> : null}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block"><span className="brand-mark">漫镜</span><div><b>漫镜</b><small>MANJING · 漫画导演工作台</small></div></div>
        <div className="topbar-actions">
          <div className="desk-mode-switch compact" role="tablist" aria-label="漫镜工作版本">
            <button type="button" role="tab" aria-selected="true" className="active"><b>创作台</b><small>拆图 · 分析 · 重组 · 提示词</small></button>
            <button type="button" role="tab" aria-selected="false" onClick={() => switchDeskMode("strict-review")}><b>严格审核台</b><small>只审不改</small></button>
          </div>
          <details ref={writingModelMenuRef} className="writing-model-picker">
            <summary aria-label={`当前 Chat / Work 模型：${writingModelSummary}`}>
              <span>Chat / Work 模型</span><strong>{writingModelSummary}</strong><i aria-hidden="true">⌄</i>
            </summary>
            <div className="writing-model-menu" role="listbox" aria-label="选择并拖动排列写作模型">
              <header><strong>Chat / Work 模型</strong><small>按住可用模型拖动排序</small></header>
              {orderedWritingModels.map((model) => (
                <button
                  key={model.id}
                  data-writing-model-id={model.id}
                  type="button"
                  role="option"
                  aria-selected={model.id === activeWritingModel?.id}
                  className={`${model.id === activeWritingModel?.id ? "active" : ""} ${dragOverWritingModelId === model.id ? "drag-over" : ""}`.trim()}
                  disabled={!model.available || !bridge.connected || bridge.busy || Boolean(switchingWritingModelId)}
                  draggable={model.available && bridge.connected && !bridge.busy && !switchingWritingModelId}
                  title={model.available ? `使用 ${model.label}` : model.reason || "待接入"}
                  onDragStart={(event) => {
                    draggedWritingModelIdRef.current = model.id;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", model.id);
                  }}
                  onDragOver={(event) => {
                    if (!draggedWritingModelIdRef.current) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverWritingModelId(model.id);
                  }}
                  onDragLeave={() => setDragOverWritingModelId((current) => current === model.id ? "" : current)}
                  onDrop={(event) => {
                    event.preventDefault();
                    const source = draggedWritingModelIdRef.current || event.dataTransfer.getData("text/plain") as WritingModelId;
                    if (source) moveWritingModelBefore(source, model.id);
                    draggedWritingModelIdRef.current = "";
                    setDragOverWritingModelId("");
                  }}
                  onDragEnd={() => {
                    draggedWritingModelIdRef.current = "";
                    setDragOverWritingModelId("");
                  }}
                  onKeyDown={(event) => {
                    if (!event.altKey || !model.available) return;
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                      event.preventDefault();
                      moveWritingModelByOffset(model.id, event.key === "ArrowUp" ? -1 : 1);
                    }
                  }}
                  onClick={() => {
                    if (suppressWritingModelClickRef.current) {
                      suppressWritingModelClickRef.current = false;
                      return;
                    }
                    void selectWritingModelOption(model);
                  }}
                >
                  <span
                    className="writing-model-grip"
                    aria-hidden="true"
                    onPointerDown={(event) => beginTouchWritingModelDrag(event, model)}
                    onPointerMove={moveTouchWritingModelDrag}
                    onPointerUp={(event) => finishTouchWritingModelDrag(event)}
                    onPointerCancel={(event) => finishTouchWritingModelDrag(event, true)}
                  >⣿</span>
                  <span><strong>{model.label}</strong><small>{model.available ? model.hint : model.reason || "待接入"}</small></span>
                  <em>{model.id === activeWritingModel?.id ? "✓" : model.available ? "" : "待接入"}</em>
                </button>
              ))}
            </div>
          </details>
          <label className="reasoning-effort-picker" title="Chat / Work 可调；拆图固定 LOW，逐 Shot 完整提示词和严格审核固定 MAX">
            <span>推理深度</span>
            <select
              aria-label="Chat / Work 推理深度"
              value={selectedReasoningEffort}
              disabled={!bridge.connected || bridge.busy || switchingReasoningEffort}
              onChange={(event) => void selectReasoningEffort(event.target.value as ReasoningEffort)}
            >
              <option value="low">LOW · 快速</option>
              <option value="high">HIGH · 深度</option>
              <option value="max">MAX · 最大</option>
            </select>
            <small>拆图 LOW · 单镜提示词/审核 MAX</small>
          </label>
          <div className={`save-status ${materialDraftMode ? "draft-mode" : ""}`}><i />{materialDraftMode ? "素材分析草稿 · 独立保存" : !hydrated || !projectArchiveLoaded ? "读取项目存档" : tenantScope.mode === "server" ? "服务器项目自动保存" : "本机自动保存"}</div>
        </div>
      </header>

      <section className="loaded-script">
        <div className="loaded-script-copy">
          <span>当前项目</span>
          <div className="loaded-script-title-line">
            <div className="project-title-row">
              {editingProjectTitle ? (
                <form className="project-title-form" onSubmit={(event) => { event.preventDefault(); renameProject(); }}>
                  <input
                    autoFocus
                    aria-label="项目名称"
                    value={projectTitleDraft}
                    onChange={(event) => setProjectTitleDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Escape") cancelRenameProject(); }}
                  />
                  <button className="project-title-edit" type="submit">保存</button>
                  <button className="project-title-edit" type="button" onClick={cancelRenameProject}>取消</button>
                </form>
              ) : (
                <>
                  <h1>{state.projectTitle}</h1>
                  <button className="project-title-edit" type="button" onClick={beginRenameProject} aria-label="修改项目名称">修改名称</button>
                </>
              )}
            </div>
            <button className="project-manifest-button" type="button" onClick={downloadProjectManifest}>导出清单</button>
          </div>
          <small>{state.reviews.length} SHOTS <i aria-hidden="true">·</i> {state.projectUid}</small>
        </div>
        <div className="loaded-script-actions">
          <div className="loaded-script-action-group workspace-action-group">
            <span className="loaded-script-group-label">工作区</span>
            <div>
              {materialDraftMode ? (
                <button className="button secondary material-original-project" type="button" onClick={() => { window.location.href = "/?main=1"; }}>
                  <b>打开主工作区</b><small>当前草稿不会覆盖原审批</small>
                </button>
              ) : null}
              <button className={`button global-settings-entry ${state.workspaceMode === "global" ? "active" : ""}`} type="button" onClick={state.workspaceMode === "global" ? returnToShots : openGlobalSettings}>
                <b>{state.workspaceMode === "global" ? "返回镜头审核" : "全局设定"}</b>
                <small>{state.globalStatus === "draft" ? "有未保存修改" : "项目共用规则"}</small>
              </button>
              <button className={`button coverage-entry ${state.workspaceMode === "coverage" ? "active" : ""}`} type="button" onClick={state.workspaceMode === "coverage" ? returnToShots : openCoverageReview}>
                <b>{state.workspaceMode === "coverage" ? "返回镜头审核" : "脚本体检"}</b>
                <small>{coverageReport.coveragePercent}% 覆盖 · {coverageReport.missingUnits} 条未覆盖</small>
              </button>
              <button className={`button asset-ledger-entry ${state.workspaceMode === "assets" ? "active" : ""}`} type="button" disabled={approvedCount === 0 && state.workspaceMode !== "assets"} onClick={state.workspaceMode === "assets" ? returnToShots : openAssetLedger}>
                <b>{state.workspaceMode === "assets" ? "返回镜头审核" : "资产同步"}</b>
                <small>{approvedCount ? `${approvedCount} 镜已解锁 · ${assetReadyCount} 包就绪${assetRunningCount ? ` · ${assetRunningCount} 生成中` : ""}` : "批准单镜后解锁"}</small>
              </button>
            </div>
          </div>
          <div className="loaded-script-action-group video-action-group">
            <span className="loaded-script-group-label">视频输出 · 默认 30s</span>
            <div className="model-switch" role="group" aria-label="Seedance生成模型">
              {generationModels.map((model) => (
                <button key={model.id} className={generationModel === model.id ? "active" : ""} onClick={() => selectGenerationModel(model.id)}>
                  <b>{model.label}</b><small>{model.minDuration}–{model.maxDuration} 秒 · {model.limit} 个参考</small>
                </button>
              ))}
            </div>
          </div>
          <div className="loaded-script-action-group import-action-group">
            <span className="loaded-script-group-label">导入</span>
            <div>
              <button className={`button material-lab-entry ${state.workspaceMode === "materials" ? "active" : ""}`} type="button" onClick={state.workspaceMode === "materials" ? returnToShots : openMaterialLab}>
                <b>{state.workspaceMode === "materials" ? "返回镜头审核" : materialDraftMode ? "续传漫画" : "漫画转分镜"}</b>
                <small>{materialDraftMode ? "追加漫画页" : "上传漫画并拆分"}</small>
              </button>
              <button className="button secondary load-script-button" onClick={() => setShowLoader((current) => !current)}>
                {showLoader ? "收起" : "载入脚本"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="production-pipeline" aria-label="漫画到视频生产阶段">
        <div className="production-pipeline-heading"><span>PRODUCTION</span><b>漫画 → 拆分 → 分镜 → 提示词 → 审核 → 确认 → 视频</b></div>
        <ol>
          {productionPipeline.map((stage, index) => (
            <li className={`production-stage ${stage.status}`} key={stage.id} title={stage.detail}>
              <i>{String(index + 1).padStart(2, "0")}</i>
              <span><b>{stage.label}</b><small>{stage.detail}</small></span>
            </li>
          ))}
        </ol>
      </section>

      {showLoader ? (
        <section className="script-loader" aria-label="载入脚本">
          <div className="loader-heading">
            <span>LOAD SCRIPT</span>
            <h2>载入新的脚本</h2>
            <p>可以选择已有文件，也可以直接用自然语言告诉当前写作模型要载入什么。</p>
          </div>
          <div className="loader-options">
            <div className="loader-option">
              <span>方式 01</span>
              <h3>选择脚本文件</h3>
              <p>JSON 会直接载入；Markdown 或 TXT 会交给当前写作模型自动整理成逐镜 Shot。</p>
              <button className="button secondary" disabled={bridge.busy || loadingScript} onClick={() => scriptInput.current?.click()}>
                {loadingScript ? "写作模型正在整理…" : "选择文件"}
              </button>
              <input ref={scriptInput} hidden type="file" accept="application/json,.json,.md,.markdown,.txt,text/plain,text/markdown" onChange={onScriptFile} />
            </div>
            <div className="loader-option natural-loader">
              <span>方式 02 · 写作模型</span>
              <h3>用自然语言载入</h3>
              <textarea
                rows={6}
                value={naturalScript}
                placeholder="例如：输入项目名称、故事起点、主要人物、地点、关键事件与必须遵守的连续性。"
                onChange={(event) => setNaturalScript(event.target.value)}
              />
              <button className="button primary" disabled={bridge.busy || loadingScript || !naturalScript.trim() || !bridge.connected} onClick={loadNaturalScript}>
                {loadingScript ? "写作模型正在整理并载入…" : "让写作模型整理并载入"}
              </button>
              {!bridge.connected ? <small>本地 Pi Agent Harness 启动后即可使用</small> : null}
            </div>
          </div>
        </section>
      ) : null}

      {state.workspaceMode === "global" ? renderGlobalSettingsPage() : state.workspaceMode === "coverage" ? renderCoveragePage() : state.workspaceMode === "assets" ? renderAssetLedgerPage() : state.workspaceMode === "materials" ? (
        <MediaLab
          bridgeBase={bridgeBase}
          sessionScope={tenantScope}
          pairingToken={bridge.pairingToken}
          connected={bridge.connected}
          supportsWebSearch={bridge.modelProvider?.supportsWebSearch === true}
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
        <div className="single-rule"><span>规则</span><b>每个 Shot 独立批准、独立解锁，不互相阻塞</b></div>
      </section>

      {shot.sourcePanels?.length ? (
        <section className={`top-shot-prompt-bar ${review.completePromptStatus || "empty"}`} aria-label={`当前 Shot ${shot.id} 完整提示词操作`}>
          <div>
            <span>CURRENT SHOT</span>
            <b>SHOT {shot.id}</b>
            <p>{review.completePromptStatus === "ready"
              ? promptReviewIsCurrent ? "完整提示词已审查，等待你明确批准" : "完整提示词讨论稿已生成，等待独立 Reviewer"
              : review.completePromptStatus === "generating"
                ? "Agent 正在逐图检查并生成提示词"
                : "这一镜尚未生成完整提示词讨论稿"}</p>
          </div>
          <button
            type="button"
            disabled={review.completePromptStatus === "generating"}
            onClick={() => review.completePromptStatus === "ready" && review.completePrompt?.trim()
              ? openCompleteShotPrompt(state.currentShot)
              : void generateCompleteShotPrompt(state.currentShot)}
          >{review.completePromptStatus === "generating"
            ? "正在生成…"
            : review.completePromptStatus === "ready"
              ? promptReviewIsCurrent ? "✓ 已审查 · 查看讨论稿" : "已生成 · 查看／提交审查"
              : `生成 SHOT ${shot.id} 完整提示词讨论稿`}</button>
        </section>
      ) : null}

      <section className={`shot-structure-review ${structureConfirmed ? "is-confirmed" : "is-draft"}`} aria-label="镜头结构审核">
        <div className="shot-structure-copy">
          <span>STEP 00 · SHOT STRUCTURE</span>
          <h2>{structureConfirmed ? "镜头结构已确认" : "先按画格图片检查默认分组"}</h2>
          <p>{structureConfirmed
            ? `当前 ${state.reviews.length} 个 Shot 已锁定；资产、分镜图和视频提示词已经解锁。`
            : `已把 ${structurePanelEntries.length} 张有效画格按阅读顺序分进 ${state.reviews.length} 个建议 Shot。先看每张图归在哪一组；只有明显错误时才需要调整。`}</p>
        </div>
        {!structureConfirmed && structurePanelEntries.length ? (
          <section className="panel-assembly-board" aria-label="漫画画格编组台">
            <header className="panel-assembly-heading">
              <div><span>PANEL ASSEMBLY</span><h3>画格编组台</h3><p>每张卡片就是一格漫画；黄色边框表示已选。默认分组可直接确认，也可以选择相邻画格重新组合、拆成单格或排除。</p><p>阅读方向：{state.sourceMangaReadingDirection === "left-to-right" ? "每行从左到右，再向下" : "日漫 · 每行从右到左，再向下"}。角标是阅读位置，画格 ID 不代表先后；旧顺序可用「按原页校正阅读顺序」修正。</p></div>
              <strong>{structurePanelEntries.length} 张图 · {state.reviews.length} 个 Shot</strong>
            </header>
            <div
              className="panel-shot-groups-top"
              role="region"
              aria-label="画格编组台顶部横向滚动条"
            >
              <b>横向浏览</b>
              <input
                type="range"
                min={0}
                max={Math.max(0, panelAssemblyScrollMetrics.scrollWidth - panelAssemblyScrollMetrics.clientWidth)}
                step={1}
                value={Math.min(
                  panelAssemblyScrollMetrics.scrollLeft,
                  Math.max(0, panelAssemblyScrollMetrics.scrollWidth - panelAssemblyScrollMetrics.clientWidth),
                )}
                disabled={panelAssemblyScrollMetrics.scrollWidth <= panelAssemblyScrollMetrics.clientWidth}
                onInput={syncPanelAssemblyFromTop}
                aria-label="拖动画格编组台"
                style={{
                  "--panel-scroll-thumb-width": `${Math.max(
                    8,
                    Math.min(
                      100,
                      panelAssemblyScrollMetrics.scrollWidth
                        ? (panelAssemblyScrollMetrics.clientWidth / panelAssemblyScrollMetrics.scrollWidth) * 100
                        : 100,
                    ),
                  )}%`,
                } as CSSProperties}
              />
              <output>
                {panelAssemblyScrollMetrics.scrollWidth > panelAssemblyScrollMetrics.clientWidth
                  ? `${Math.round(panelAssemblyScrollMetrics.scrollLeft)} / ${Math.round(panelAssemblyScrollMetrics.scrollWidth - panelAssemblyScrollMetrics.clientWidth)}`
                  : "全部可见"}
              </output>
            </div>
            {renderPanelAssemblyActions("top")}
            <div className="panel-shot-groups" ref={panelAssemblyBottomScroller} onScroll={syncPanelAssemblyFromBottom}>
              {state.reviews.map((item, reviewIndex) => {
                const panelIds = item.shot.sourcePanels || [];
                const itemTiming = estimateShotTiming({
                  dialogue: item.shot.dialogue,
                  completePrompt: item.completePrompt,
                  panelCount: panelIds.length || 1,
                  segmentCount: item.shot.segments?.length,
                  assignedDuration: item.shot.duration,
                  model: generationModel,
                });
                return (
                  <Fragment key={`${item.shot.id}-${panelIds.join("-")}`}>
                  {renderNewShotDropZone(reviewIndex)}
                  <article
                    className={`panel-shot-group ${reviewIndex === state.currentShot ? "is-current" : ""} ${item.completePromptConfirmedAt ? "is-confirmed" : ""} ${item.approved ? "is-approved" : ""} ${panelDropTarget?.reviewIndex === reviewIndex ? "is-drop-target" : ""}`}
                    onDragEnter={(event) => markStructurePanelDrop(event, { reviewIndex, position: "end" })}
                    onDragOver={(event) => markStructurePanelDrop(event, { reviewIndex, position: "end" })}
                    onDrop={(event) => moveStructurePanelsByDrag(event, { reviewIndex, position: "end" })}
                  >
                    <div className="panel-shot-group-title">
                      <div className="panel-shot-main" title={timingEstimateLabel(itemTiming, item.shot.duration)}>
                        <button type="button" onClick={() => selectShot(reviewIndex)}>
                          <b>SHOT {item.shot.id}{item.approved ? <i className="panel-shot-approved">✓ 已批准</i> : null}</b>
                        </button>
                        <span className="panel-shot-duration-line">
                          {panelIds.length} 张图 ·
                          <label className="panel-shot-duration-input" title={`直接修改 Shot ${item.shot.id} 的目标时长`}>
                            <input
                              key={`${item.shot.id}-${item.shot.duration}`}
                              type="number"
                              min={durationRange.min}
                              max={durationRange.max}
                              defaultValue={item.shot.duration}
                              aria-label={`Shot ${item.shot.id} 目标时长，秒`}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              onBlur={(event) => updateShotDuration(reviewIndex, Number(event.currentTarget.value))}
                            />
                            <i>s</i>
                          </label>
                          {item.completePromptConfirmedAt ? " · 讨论稿已生成" : ""}
                          <em className={`panel-shot-timing ${itemTiming.status}`}>估 {itemTiming.requiredSeconds}s</em>
                        </span>
                      </div>
                      <button type="button" className="panel-group-select" onClick={() => toggleStructurePanelGroup(panelIds)}>{panelIds.every((panelId) => selectedStructurePanelIds.includes(panelId)) ? "取消整组" : "选择整组"}</button>
                    </div>
                    <p className={`panel-shot-timing-detail ${itemTiming.status}`}>
                      <span>{timingEvidenceLabel(itemTiming)}</span>
                      <strong>{timingEstimateLabel(itemTiming, item.shot.duration)}</strong>
                    </p>
                    <button
                      type="button"
                      className={`complete-shot-prompt-button ${item.completePromptStatus || "empty"}`}
                      disabled={item.completePromptStatus === "generating"}
                      onClick={() => item.completePromptStatus === "ready" && item.completePrompt?.trim()
                        ? openCompleteShotPrompt(reviewIndex)
                        : void generateCompleteShotPrompt(reviewIndex)}
                    >
                      {item.completePromptStatus === "generating"
                        ? "Agent 正在逐图生成…"
                        : item.completePromptStatus === "ready"
                          ? item.promptReviewStatus === "ready" ? "✓ 已审查 · 查看讨论稿" : "已生成 · 查看／提交审查"
                          : item.completePromptStatus === "stale"
                            ? "内容已变更 · 重新生成讨论稿"
                            : item.completePromptStatus === "error"
                              ? "重试生成完整提示词讨论稿"
                              : "生成完整提示词讨论稿"}
                    </button>
                    <div
                      className="panel-shot-images"
                      dir={state.sourceMangaReadingDirection === "left-to-right" ? "ltr" : "rtl"}
                      onDragOver={(event) => markStructurePanelDrop(event, { reviewIndex, position: "end" })}
                      onDrop={(event) => moveStructurePanelsByDrag(event, { reviewIndex, position: "end" })}
                    >
                      {panelIds.map((panelId, readingIndex) => {
                        const selected = selectedStructurePanelIds.includes(panelId);
                        const url = mangaSourceRequestId ? mangaPanelCropUrl(mangaSourceRequestId, panelId, bridge.pairingToken) : "";
                        return (
                          <div className="panel-assembly-card-shell" key={panelId}>
                            <b className="panel-reading-index" aria-label={`阅读顺序 ${readingIndex + 1}`}>{readingIndex + 1}</b>
                            <button
                              type="button"
                              draggable
                              className={`panel-assembly-card ${selected ? "is-selected" : ""} ${draggedStructurePanelIds.includes(panelId) ? "is-dragging" : ""}`}
                              aria-pressed={selected}
                              aria-label={`${selected ? "取消选择" : "选择"}画格 ${panelId}`}
                              title="拖到目标 Shot 的任意位置，按原顺序接在尾部"
                              onClick={(event) => {
                                if (suppressStructurePanelClickRef.current) return;
                                toggleStructurePanel(panelId, event.shiftKey);
                              }}
                              onDragStart={(event) => beginStructurePanelDrag(event, panelId)}
                              onDragEnd={finishStructurePanelDrag}
                            >
                              {url && bridge.pairingToken ? <img draggable={false} src={url} alt={`漫画画格 ${panelId}`} /> : <i>等待裁图</i>}
                              <span>{panelId}</span>
                            </button>
                            <button type="button" className="panel-card-zoom" aria-label={`放大画格 ${panelId}`} title="放大查看图和文字" onClick={() => openStructurePanelZoom(panelId)}>⛶</button>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                  </Fragment>
                );
              })}
              {renderNewShotDropZone(state.reviews.length, true)}
            </div>
            {renderPanelAssemblyActions("bottom")}
          </section>
        ) : null}
        <div className="shot-structure-actions">
          {!structureConfirmed ? <>
            <div className="shot-duration-control" aria-label={`Shot ${shot.id} 时长设置`}>
              <span>当前镜头</span>
              {(durationRange.max > 15 ? [6, 8, 10, 12, 15, 20, 25, 30] : [6, 8, 10, 12, 15]).map((seconds) => (
                <button type="button" key={seconds} className={shot.duration === seconds ? "active" : ""} onClick={() => updateCurrentShotDuration(seconds)}>{seconds}s</button>
              ))}
            </div>
            <div
              className={`shot-timing-estimate ${shotTimingEstimate.status}`}
              title={`公式：对白与动作并行，取较长者。对白 ${shotTimingEstimate.dialogueSeconds.toFixed(1)}s；构图 ${shotTimingEstimate.visualSeconds.toFixed(1)}s；动作反应 ${shotTimingEstimate.actionReactionSeconds.toFixed(1)}s。${shotTimingEstimate.dialogueSource === "generated-japanese" ? "已按完整提示词中的日语对白重算。" : "当前按漫画对白预估；生成日语对白后会自动重算。"}`}
            >
              <b>{timingEstimateLabel(shotTimingEstimate, shot.duration)}</b>
              <span>{timingEvidenceLabel(shotTimingEstimate)}</span>
              <span>对白 {shotTimingEstimate.dialogueSeconds.toFixed(1)}s · 画面动作 {(shotTimingEstimate.visualSeconds + shotTimingEstimate.actionReactionSeconds).toFixed(1)}s · 可并行时取较长者；未试读</span>
            </div>
            <button type="button" className="button secondary" disabled={state.currentShot >= state.reviews.length - 1} onClick={mergeCurrentWithNext}>当前整组与下一组组合</button>
            <button type="button" className="button danger" disabled={state.reviews.length <= 1} onClick={deleteCurrentShot}>删除当前整组</button>
            <span className="shot-confirmation-progress">已生成讨论稿 {state.reviews.filter((item) => item.completePromptStatus === "ready").length} / {state.reviews.length} 镜 · 已独立审查 {state.reviews.filter((item) => item.promptReviewStatus === "ready").length} 镜 · 已批准 {approvedCount} 镜</span>
          </> : (
            <button type="button" className="button secondary" onClick={reopenShotStructure}>重新编辑镜头结构</button>
          )}
        </div>
      </section>

      {shot.sourcePanels?.length ? (
        <section id="complete-shot-prompt-panel" className={`complete-shot-prompt-panel ${review.completePromptStatus || "empty"}`} aria-label={`Shot ${shot.id} 完整提示词`}>
          <header>
            <div>
              <span>SHOT PROMPT DRAFT</span>
              <h2>Shot {shot.id} 完整提示词讨论稿</h2>
              <p>{review.completePromptStatus === "generating"
                ? "Agent 正在逐图查看、整理对白与批注，并补充可靠的联网背景。"
                : review.completePromptStatus === "stale"
                  ? "这个 Shot 的图片、时长或批注已经改变，请重新确认生成。"
                  : review.completePromptStatus === "error"
                    ? review.completePromptSummary || "生成失败，请重新尝试。"
                    : review.completePromptSummary || "当前 Shot 还没有生成完整提示词讨论稿。"}</p>
            </div>
            <div className="complete-shot-prompt-actions">
              <button type="button" className="button secondary" disabled={!review.completePrompt?.trim()} onClick={copyCompleteShotPrompt}>复制</button>
              <button type="button" className="button primary" disabled={review.completePromptStatus === "generating"} onClick={() => generateCompleteShotPrompt(state.currentShot)}>{review.completePrompt ? "重新生成讨论稿" : "生成完整提示词讨论稿"}</button>
            </div>
          </header>
          {review.completePrompt ? (
            <p className="complete-shot-lineage">
              Creator 模型：<strong>{review.completePromptGeneratorId || legacyUnknownModelId}</strong>
              {review.completePromptRequestedGeneratorId && review.completePromptRequestedGeneratorId !== review.completePromptGeneratorId
                ? ` · 请求模型：${review.completePromptRequestedGeneratorId}`
                : ""}
              {review.completePromptGeneratorProvider ? ` · ${review.completePromptGeneratorProvider}` : ""}
            </p>
          ) : null}
          {review.completePrompt ? (
            <div className="complete-shot-prompt-content">
              <button type="button" className="complete-shot-copy-mini" onClick={copyCompleteShotPrompt} aria-label="复制完整提示词内容" title="复制内容">
                <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
                复制内容
              </button>
              <textarea aria-label={`Shot ${shot.id} 完整提示词内容`} value={review.completePrompt} onChange={(event) => updateCompleteShotPrompt(event.target.value)} />
            </div>
          ) : (
            <div className="complete-shot-prompt-waiting">{review.completePromptStatus === "generating"
              ? "正在生成完整提示词…"
              : review.completePromptStatus === "error"
                ? review.completePromptSummary || "生成失败，请重试。"
                : `Shot ${shot.id} 尚未生成完整提示词`}</div>
          )}
          {review.completePromptResearch?.sources?.length ? (
            <div className="complete-shot-research">
              <b>联网资料</b>
              {review.completePromptResearch.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<small>{source.usedFor}</small></a>)}
            </div>
          ) : null}
          {review.completePromptWarnings?.length ? <p className="complete-shot-warnings">注意：{review.completePromptWarnings.join("；")}</p> : null}
          {review.completePrompt?.trim() ? (
            <section className="creator-review-handoff" aria-label={`Shot ${shot.id} 严格审核入口`}>
              <div><span>STRICT REVIEW ISOLATED</span><h3>提示词已准备好，可送往严格审核台</h3><p>审核台是独立只读版本：只挑问题、列证据、给建议，不提供编辑、应用或批准控件。</p></div>
              <button type="button" className="button primary" onClick={() => switchDeskMode("strict-review")}>{promptReviewArtifactIsCurrent ? "查看当前严格审核报告" : "进入严格审核台"}</button>
            </section>
          ) : null}
        </section>
      ) : null}

      <nav className="three-step-nav" aria-label="当前 Shot 工作流程">
        {navItems.map((item) => {
          const disabled = (!review.approved && item.id !== "script") || (item.id !== "script" && (referencesOverLimit || durationOutOfRange)) || (item.id === "artwork" && (review.scriptStatus !== "applied" || !review.approved)) || (item.id === "confirm" && !artwork);
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
            {shot.sourcePanels?.length ? (
              <button
                type="button"
                className={`shot-title-prompt-button ${review.completePromptStatus || "empty"}`}
                disabled={review.completePromptStatus === "generating"}
                onClick={() => review.completePromptStatus === "ready" && review.completePrompt?.trim()
                  ? openCompleteShotPrompt(state.currentShot)
                  : void generateCompleteShotPrompt(state.currentShot)}
              >{review.completePromptStatus === "generating"
                ? "生成中…"
                : review.completePromptStatus === "ready"
                  ? review.promptReviewStatus === "ready" ? "✓ 已审查 · 查看提示词" : "已生成 · 查看／提交审查"
                  : "生成提示词讨论稿"}</button>
            ) : null}
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
          </div>

          {review.approved && currentVideoPackage ? (
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

          <div className="hard-lock-card">
            <div className="visual-heading"><span>HARD LOCKS</span><b>后续不能丢</b></div>
            <ol>{shot.continuity.slice(0, 5).map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></li>)}</ol>
          </div>
        </aside>
      </section>

      <footer className="action-dock">
        <div><span>当前</span><b>Shot {shot.id} · {navItems.find((item) => item.id === state.view)?.label}</b><small>{state.view === "script" ? "可编辑正文，或通过本镜 Chat 讨论改稿" : state.view === "artwork" ? "已独立盖章；出图可后台继续" : "可查看结果或再次生成"}</small></div>
        <div className={`dock-status ${annotationBusy || artworkJob || review.artworkStatus === "generating" ? "busy" : review.approved ? "done" : ""}`} aria-label="当前处理状态">
          <span>状态</span>
          <b>{referencesOverLimit
            ? `参考超限：${referenceCount}/${referenceLimit}`
            : durationOutOfRange
            ? `时长不符：${shot.duration}秒（需${durationRange.min}–${durationRange.max}秒）`
            : annotationBusy
            ? "批注处理中"
            : state.view === "script"
              ? review.approved ? "已签字盖章 · 审批通过" : review.scriptStatus === "applied" ? "正文已保存 · 等待盖章" : "等待签字盖章"
              : state.view === "artwork"
                ? artworkJob || review.artworkStatus === "generating"
                  ? artworkJob?.message || "Lib Image 后台生成中（2 张）"
                  : artwork ? `已生成 ${artworkCandidates.length} 张，可选择方案` : libtvReady ? "尚未启动出图" : "LibTV 未登录"
                : review.approved ? "已签字盖章" : "等待签字盖章"}</b>
        </div>
      </footer>
      </>}
      {zoomedStructurePanelId && zoomedStructurePanelUrl && bridge.pairingToken ? (
        <div
          className="panel-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`放大查看画格 ${zoomedStructurePanelId}`}
          tabIndex={-1}
          autoFocus
          onClick={closeStructurePanelZoom}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeStructurePanelZoom();
            if (event.key === "ArrowLeft") moveStructurePanelZoom(-1);
            if (event.key === "ArrowRight") moveStructurePanelZoom(1);
          }}
        >
          <section className="panel-lightbox-window" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><span>漫画原裁图</span><b>{zoomedStructurePanelId}</b></div>
              <div className="panel-lightbox-controls">
                <button type="button" className="panel-lightbox-close" onClick={closeStructurePanelZoom}>关闭 Esc</button>
              </div>
            </header>
            <div className="panel-lightbox-body">
              <div className="panel-lightbox-stage">
                <img
                  src={zoomedStructurePanelUrl}
                  alt={`放大的漫画画格 ${zoomedStructurePanelId}`}
                  title="单击缩回小图"
                  onClick={closeStructurePanelZoom}
                />
              </div>
              <aside className="panel-lightbox-understanding">
                <section><span>画面理解</span><p>{state.sourceMangaPanels?.[zoomedStructurePanelId]?.sourceObservation || "正在读取本格画面理解…"}</p></section>
                <section>
                  <span>对白原文</span>
                  {state.sourceMangaPanels?.[zoomedStructurePanelId]?.dialogue?.length ? state.sourceMangaPanels[zoomedStructurePanelId].dialogue.map((line, index) => (
                    <div className="panel-lightbox-dialogue" key={`${line.speaker}-${index}`}><b>{line.speaker}</b><p>{line.text}</p>{line.confidence !== "high" ? <i>{line.confidence === "medium" ? "待复核" : "低置信"}</i> : null}</div>
                  )) : <em>本格未识别到对白或文字</em>}
                </section>
                <section><span>出场人物</span><p>{state.sourceMangaPanels?.[zoomedStructurePanelId]?.characters?.length ? state.sourceMangaPanels[zoomedStructurePanelId].characters.join("、") : "本格人物待复核"}</p></section>
                <section><span>人物关系与剧情</span><p>{state.sourceMangaPanels?.[zoomedStructurePanelId]?.relationAndPlot || state.sourceMangaPanels?.[zoomedStructurePanelId]?.textSummary || "正在整理本格剧情作用…"}</p></section>
              </aside>
            </div>
            <footer>
              <button type="button" onClick={() => moveStructurePanelZoom(-1)}>← 上一张</button>
              <span>{zoomedStructurePanelIndex + 1} / {structurePanelEntries.length} · 方向键切换</span>
              <button type="button" onClick={() => moveStructurePanelZoom(1)}>下一张 →</button>
            </footer>
          </section>
        </div>
      ) : null}
      <TextInputDialog
        open={globalFileNameDialog.open}
        title={globalFileNameDialog.createNew ? "新建全局文件" : "保存全局文件"}
        description="全局文件独立于项目，可在其他话数的项目中加载复用。"
        label="全局文件名称"
        value={globalFileNameDraft}
        placeholder="例如：城市猎人"
        confirmLabel={globalFileNameDialog.createNew ? "新建并保存" : "保存"}
        busyLabel="正在保存…"
        busy={globalFileBusy}
        error={globalFileNameError}
        onChange={(value) => {
          setGlobalFileNameDraft(value);
          if (globalFileNameError) setGlobalFileNameError("");
        }}
        onCancel={() => {
          setGlobalFileNameDialog({ open: false, createNew: false });
          setGlobalFileNameDraft("");
          setGlobalFileNameError("");
        }}
        onConfirm={() => void saveGlobalFile({ createNew: globalFileNameDialog.createNew, requestedName: globalFileNameDraft })}
      />
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  );
}

export default function Home() {
  return (
    <ManjingAuthGate apiBase={bridgeBase} serverConfigured={Boolean(configuredApiBase)}>
      <DirectorDesk />
    </ManjingAuthGate>
  );
}
