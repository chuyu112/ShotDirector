"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { manjingScopedBrowserStorage, manjingSessionFetch, type ManjingWorkspaceScope } from "./manjing-auth-client";
import { repairKnownMangaPanelCoverage } from "./manga-panel-mapping.mjs";

export type MediaKind = "video" | "manga";
export type ReadingDirection = "right-to-left" | "left-to-right";
export type MediaJobStatus = "running" | "completed" | "failed";

export type MediaJobEvent = {
  at: string;
  stage: string;
  message: string;
};

export type MediaAnalysisJob = {
  type?: string;
  shotId?: string;
  kind?: MediaKind;
  requestId: string;
  status: MediaJobStatus;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  stage?: string;
  message?: string;
  error?: string;
  events?: MediaJobEvent[];
};

export type MediaUpload = {
  mediaId: string;
  kind: MediaKind;
  originalName: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  uploadedAt?: string;
};

export type MediaSourceText = {
  location: string;
  speaker: string;
  text: string;
  confidence: "high" | "medium" | "low";
};

export type MediaTimelineItem = {
  index: number;
  timecode: string;
  story: string;
  sourceObservation: string;
  adaptationSuggestion: string;
  shotSize: string;
  camera: string;
  movement: string;
  editing: string;
  performance: string;
  sound: string;
  keep: string[];
  issues: string[];
};

export type MediaMangaPanel = {
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  kind: "story" | "splash" | "cover" | "editorial" | "blank";
  includeInShots: boolean;
  sourceObservation: string;
  textSummary: string;
};

export type MediaMangaPage = {
  scanIndex: number;
  sourceFile: string;
  layout: "single-page" | "double-page" | "mixed";
  classification: "story" | "splash" | "cover" | "editorial" | "mixed";
  readingOrder: string[];
  includeInShots: boolean;
  notes: string;
  panels: MediaMangaPanel[];
};

export type MediaAssetPrompt = {
  id: string;
  kind: "character" | "scene" | "prop";
  name: string;
  sourceObservation: string;
  prompt: string;
  negative: string[];
  sourcePanels: string[];
  shotIds: string[];
};

export type MediaResearch = {
  mode: "off" | "supplement";
  used: boolean;
  queries: string[];
  sources: Array<{ title: string; url: string; usedFor: string }>;
  notes: Array<{ fact: string; sourceUrls: string[]; confidence: "high" | "medium" | "low" }>;
};

export type MediaDraftSegment = {
  label: string;
  beat: string;
  framing: string;
  mustShow: string[];
};

export type MediaDraftShot = {
  id: string;
  timecode: string;
  duration: number;
  title: string;
  sourceText: string[];
  sourcePanels: string[];
  artStyle: string;
  story: string;
  scene: string;
  characters: string[];
  props: string[];
  omniReferences: string[];
  composition: string;
  camera: string;
  action: string;
  dialogue: string[];
  continuity: string[];
  negative: string[];
  segments: MediaDraftSegment[];
};

export type MediaAnalysisResult = {
  status: "completed";
  kind: MediaKind;
  projectTitle: string;
  /** Client-side project context carried into the newly created review draft. */
  projectBackground?: string;
  summary: string;
  sourceText: MediaSourceText[];
  cameraNotes: string[];
  timeline: MediaTimelineItem[];
  mangaPages?: MediaMangaPage[];
  /** Generated analyses always include this; optional keeps persisted pre-feature results readable. */
  assetPrompts?: MediaAssetPrompt[];
  /** Optional keeps analyses made before research provenance was introduced readable. */
  research?: MediaResearch;
  researchPolicy?: {
    requestedMode: "off" | "supplement";
    effectiveMode: "off" | "supplement";
    supportsWebSearch: boolean;
    downgraded: boolean;
    provider: string;
  };
  shots: MediaDraftShot[];
  scriptMarkdown: string;
  requestId?: string;
  sourceFiles?: MediaUpload[];
  extraction?: Record<string, unknown>;
  previewUrls?: string[];
  completedAt?: string;
};

export type MediaLabProps = {
  bridgeBase: string;
  sessionScope: ManjingWorkspaceScope;
  pairingToken?: string;
  connected: boolean;
  supportsWebSearch?: boolean;
  generationModel: "seedance-2.0" | "seedance-2.5";
  defaultStoryBackground: string;
  defaultArtStyle: string;
  initialKind?: MediaKind;
  onBack: () => void;
  onCreateDraft: (result: MediaAnalysisResult, targetShotId?: string) => void;
};

type QueueStatus = "queued" | "uploading" | "uploaded" | "error";

type QueueItem = {
  localId: string;
  kind: MediaKind;
  name: string;
  mime: string;
  size: number;
  status: QueueStatus;
  file?: File;
  mediaId?: string;
  uploadedAt?: string;
  previewUrl?: string;
  error?: string;
};

type PersistedMediaState = {
  kind?: MediaKind;
  readingDirection?: ReadingDirection;
  brief?: string;
  storyBackground?: string;
  finalArtStyle?: string;
  allowWebResearch?: boolean;
  job?: MediaAnalysisJob;
  result?: MediaAnalysisResult;
  uploads?: Array<Omit<QueueItem, "file" | "previewUrl">>;
};

const storageKey = "shotdirector-material-analysis-v1";
const authenticatedFetch = manjingSessionFetch;
const videoExtensions = new Set(["mp4", "mov", "mkv", "webm", "m4v", "avi"]);
const mangaExtensions = new Set(["png", "jpg", "jpeg", "webp"]);
const cityHunterLiveActionStyle = "昭和62年（1987年）东京新宿背景的写实日本真人都市犯罪动作电影。全部人物由真实日本演员出演，呈现真实皮肤纹理、毛发、汗液、呼吸、眼神焦点、肌肉受力、衣料褶皱、车辆重量和可信物理动作。采用1980年代日本35mm彩色胶片质感：细密有机颗粒、中等反差、黑位略抬、高光轻微晕染、暗部保留人物与建筑细节；自然暖中性日本人肤色。冬季新宿使用冷蓝环境光、暖黄钨丝灯与少量红紫霓虹反射的真实混合光。摄影硬朗、轴线和空间方向清楚，动作遵循真实物理路径；表演遵循先看见或听见、理解、行动、结果停顿，不同人物不得同步做相同表情。全程自然日语对白、无BGM，中文仅作制作备注。禁止漫画、动画、赛璐璐、二次元、游戏CG、3D塑料人物、现代数码锐化、过度霓虹、现代车辆、智能手机、LED屏、字幕、水印和乱码文字。";
const unconfirmedArtStylePattern = /待从原始|未明确前|不向视频提示词擅自添加/;

function readPersistedState(sessionScope: ManjingWorkspaceScope): PersistedMediaState {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(manjingScopedBrowserStorage(sessionScope).getItem(storageKey) || "{}") as PersistedMediaState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function fileExtension(name: string) {
  return name.toLowerCase().split(".").pop() || "";
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatClock(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("zh-CN", { hour12: false });
}

function errorMessage(value: unknown, fallback: string) {
  if (value instanceof Error && value.message) return value.message;
  return fallback;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`服务返回了无法读取的内容（HTTP ${response.status}）`);
  }
}

function serverError(payload: Record<string, unknown>, fallback: string) {
  return typeof payload.error === "string" && payload.error.trim() ? payload.error : fallback;
}

function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim() || "漫镜素材分析";
}

function authorizedPreviewUrl(value: string, pairingToken?: string) {
  if (!pairingToken) return value;
  try {
    const parsed = new URL(value);
    if ((parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
      && (parsed.pathname.startsWith("/media-preview/") || parsed.pathname.startsWith("/media-source/"))) {
      parsed.searchParams.set("token", pairingToken);
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

function confidenceLabel(value: MediaSourceText["confidence"]) {
  return value === "high" ? "高" : value === "medium" ? "中" : "低";
}

function queueStatusLabel(value: QueueStatus) {
  if (value === "uploading") return "上传中";
  if (value === "uploaded") return "已上传";
  if (value === "error") return "失败";
  return "待上传";
}

function mangaClassificationLabel(value: MediaMangaPage["classification"]) {
  if (value === "story") return "剧情页";
  if (value === "splash") return "跨页／插画";
  if (value === "cover") return "封面";
  if (value === "editorial") return "作者后记／资料";
  return "混合内容";
}

function mangaLayoutLabel(value: MediaMangaPage["layout"]) {
  if (value === "double-page") return "双页扫描";
  if (value === "single-page") return "单页";
  return "混合版式";
}

function assetKindLabel(value: MediaAssetPrompt["kind"]) {
  if (value === "character") return "人物";
  if (value === "scene") return "场景";
  return "关键道具";
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

const naturalPageCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function MediaLab({
  bridgeBase,
  sessionScope,
  pairingToken,
  connected,
  supportsWebSearch = false,
  generationModel,
  defaultStoryBackground,
  defaultArtStyle,
  initialKind = "manga",
  onBack,
  onCreateDraft,
}: MediaLabProps) {
  const mediaBrowserStorage = useMemo(
    () => manjingScopedBrowserStorage(sessionScope),
    [sessionScope],
  );
  const [restored] = useState(() => readPersistedState(sessionScope));
  const [kind, setKind] = useState<MediaKind>(initialKind || (restored.kind === "manga" ? "manga" : "video"));
  const [readingDirection, setReadingDirection] = useState<ReadingDirection>(
    restored.readingDirection === "left-to-right" ? "left-to-right" : "right-to-left",
  );
  const [brief, setBrief] = useState(restored.brief || "");
  const [storyBackground, setStoryBackground] = useState(restored.storyBackground?.trim() || defaultStoryBackground);
  const [finalArtStyle, setFinalArtStyle] = useState(restored.finalArtStyle?.trim() || defaultArtStyle);
  const [allowWebResearch, setAllowWebResearch] = useState(Boolean(restored.allowWebResearch));
  const [queue, setQueue] = useState<QueueItem[]>(() =>
    (restored.uploads || []).map((item) => ({
      ...item,
      status: item.mediaId ? "uploaded" : "error",
      error: item.mediaId ? undefined : "页面刷新后需要重新选择本地文件",
    })),
  );
  const [job, setJob] = useState<MediaAnalysisJob | undefined>(restored.job);
  const [result, setResult] = useState<MediaAnalysisResult | undefined>(restored.result);
  const [submitting, setSubmitting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const recentUploadsRecoveryRef = useRef<Set<MediaKind>>(new Set());

  const visibleQueue = useMemo(() => queue.filter((item) => item.kind === kind), [kind, queue]);
  const visibleResult = useMemo(() => {
    const matchingResult = result?.kind === kind ? result : undefined;
    return repairKnownMangaPanelCoverage(matchingResult).result as MediaAnalysisResult | undefined;
  }, [kind, result]);
  const shotIdsByPanel = useMemo(() => {
    const index = new Map<string, string[]>();
    for (const shot of visibleResult?.shots || []) {
      for (const panelId of shot.sourcePanels || []) {
        const shotIds = index.get(panelId) || [];
        if (!shotIds.includes(shot.id)) shotIds.push(shot.id);
        index.set(panelId, shotIds);
      }
    }
    return index;
  }, [visibleResult]);
  const jobRunning = job?.status === "running";
  const backgroundConfirmed = Boolean(storyBackground.trim());
  const resolvedFinalArtStyle = /城市猎人|CITY\s*HUNTER/i.test(storyBackground)
    && (!finalArtStyle.trim() || unconfirmedArtStylePattern.test(finalArtStyle))
    ? cityHunterLiveActionStyle
    : finalArtStyle;
  const artStyleConfirmed = Boolean(resolvedFinalArtStyle.trim()) && !unconfirmedArtStylePattern.test(resolvedFinalArtStyle);
  const analyzeBlockers = [
    !connected || !pairingToken ? "本地桥接未连接" : "",
    !visibleQueue.length ? "尚未选择漫画" : "",
    !backgroundConfirmed ? "项目故事背景" : "",
    !artStyleConfirmed ? "最终视频美术风格" : "",
  ].filter(Boolean);
  const canAnalyze = connected && Boolean(pairingToken) && visibleQueue.length > 0 && backgroundConfirmed && artStyleConfirmed && !submitting && !jobRunning;

  useEffect(() => {
    const serializableQueue = queue
      .filter((item) => item.mediaId)
      .map((item) => ({
        localId: item.localId,
        kind: item.kind,
        name: item.name,
        mime: item.mime,
        size: item.size,
        status: item.status,
        mediaId: item.mediaId,
        uploadedAt: item.uploadedAt,
        error: item.error,
      }));
    const value: PersistedMediaState = { kind, readingDirection, brief, storyBackground, finalArtStyle, allowWebResearch, job, result, uploads: serializableQueue };
    try {
      mediaBrowserStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Analysis remains usable when private browsing or a storage quota blocks persistence.
    }
  }, [allowWebResearch, brief, finalArtStyle, job, kind, mediaBrowserStorage, queue, readingDirection, result, storyBackground]);

  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (!connected || !pairingToken || visibleQueue.length || submitting || jobRunning) return;
    if (recentUploadsRecoveryRef.current.has(kind)) return;
    recentUploadsRecoveryRef.current.add(kind);
    let cancelled = false;

    const recoverRecentUploads = async () => {
      try {
        const response = await authenticatedFetch(`${bridgeBase}/media-recent-uploads?kind=${kind}&maxAgeMinutes=1440`, {
          headers: { "x-shotdirector-token": pairingToken },
          cache: "no-store",
        });
        const payload = await responseJson(response);
        if (!response.ok) throw new Error(serverError(payload, "无法恢复最近上传的素材"));
        const uploads = Array.isArray(payload.uploads) ? payload.uploads as MediaUpload[] : [];
        if (cancelled || !uploads.length) return;
        const restoredQueue = uploads.map((upload): QueueItem => ({
          localId: `recovered-${upload.mediaId}`,
          kind: upload.kind,
          name: upload.originalName,
          mime: upload.mime,
          size: upload.size,
          status: "uploaded",
          mediaId: upload.mediaId,
          uploadedAt: upload.uploadedAt,
          previewUrl: authorizedPreviewUrl(`${bridgeBase}/media-source/${upload.mediaId}`, pairingToken),
        }));
        setQueue((current) => current.some((item) => item.kind === kind) ? current : [...current, ...restoredQueue]);
        setResult((current) => current?.kind === kind ? undefined : current);
        setError("");
        setNotice(`已自动恢复最近上传的 ${uploads.length} 张${kind === "manga" ? "漫画" : "视频素材"}，不用重新上传`);
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught, "无法恢复最近上传的素材"));
      }
    };

    void recoverRecentUploads();
    return () => { cancelled = true; };
  }, [bridgeBase, connected, jobRunning, kind, pairingToken, submitting, visibleQueue.length]);

  useEffect(() => {
    if (!jobRunning || !job?.requestId || !pairingToken) return;
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const requestId = job.requestId;
    const schedule = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(poll, delay);
    };

    const poll = async () => {
      controller = new AbortController();
      try {
        const response = await authenticatedFetch(`${bridgeBase}/media-job-result?requestId=${encodeURIComponent(requestId)}`, {
          headers: { "x-shotdirector-token": pairingToken },
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await responseJson(response);
        if (cancelled) return;
        const incomingJob = payload.job as MediaAnalysisJob | undefined;
        if (response.status === 202) {
          if (incomingJob?.requestId) {
            setJob((current) => ({
              ...incomingJob,
              kind: current?.kind || (incomingJob.type === "media-manga" ? "manga" : "video"),
            }));
          }
          setNotice(incomingJob?.message || "素材仍在分析，请保持漫镜页面打开");
          setError("");
          schedule(2000);
          return;
        }
        if (response.ok && payload.result) {
          const completed = payload.result as MediaAnalysisResult;
          setResult(completed);
          setJob((current) => incomingJob?.requestId
            ? { ...incomingJob, kind: current?.kind || completed.kind }
            : current
              ? { ...current, status: "completed", finishedAt: completed.completedAt }
              : { requestId, status: "completed", finishedAt: completed.completedAt });
          setNotice(completed.kind === "video" ? "视频拉片完成" : "漫画文字与运镜整理完成");
          setError("");
          return;
        }
        if (response.status >= 500 || payload.status === "failed") {
          const message = serverError(payload, incomingJob?.error || "素材分析失败");
          setJob((current) => incomingJob?.requestId
            ? { ...incomingJob, kind: current?.kind || (incomingJob.type === "media-manga" ? "manga" : "video") }
            : current
              ? { ...current, status: "failed", error: message }
              : { requestId, status: "failed", error: message });
          setError(message);
          return;
        }
        if (response.status === 404) {
          const preservedCount = visibleQueue.length;
          const message = `服务重启导致这次素材任务暂停；${preservedCount ? `${preservedCount} 张素材与` : ""}已完成的拆图进度仍已保留。点击「继续分析」即可从已保存进度继续，无需清空或重新上传。`;
          setJob((current) => current
            ? { ...current, status: "failed", error: message, message }
            : { requestId, status: "failed", error: message, message });
          setNotice("");
          setError(message);
          return;
        }
        throw new Error(serverError(payload, `查询分析任务失败（HTTP ${response.status}）`));
      } catch (caught) {
        if (cancelled || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setNotice(`暂时无法取得最新状态：${errorMessage(caught, "网络连接失败")}，将自动重试`);
        schedule(3000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [bridgeBase, job?.requestId, jobRunning, pairingToken, visibleQueue.length]);

  const revokePreview = (item: QueueItem) => {
    if (!item.previewUrl) return;
    URL.revokeObjectURL(item.previewUrl);
    previewUrlsRef.current.delete(item.previewUrl);
  };

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    const files = kind === "manga"
      ? selectedFiles.sort((left, right) => naturalPageCollator.compare(left.name, right.name))
      : selectedFiles;
    event.target.value = "";
    if (!files.length) return;
    const allowed = kind === "video" ? videoExtensions : mangaExtensions;
    const invalid = files.find((file) => !allowed.has(fileExtension(file.name)));
    if (invalid) {
      setError(kind === "video"
        ? `${invalid.name} 不是支持的视频；请选择 MP4、MOV、MKV、WebM、M4V 或 AVI。`
        : `${invalid.name} 不是支持的漫画图片；请选择 PNG、JPG 或 WebP。`);
      return;
    }
    if (kind === "video" && files.length !== 1) {
      setError("视频拉片每次只能选择一个视频。");
      return;
    }
    const currentCount = kind === "manga" ? visibleQueue.length : 0;
    if (kind === "manga" && currentCount + files.length > 40) {
      setError("漫画一次最多上传 40 张扫描图，请减少图片数量。");
      return;
    }

    const additions = files.map((file, index): QueueItem => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return {
        localId: `${Date.now()}-${index}-${file.name}`,
        kind,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        status: "queued",
        file,
        previewUrl,
      };
    });

    setQueue((current) => {
      if (kind === "video") {
        current.filter((item) => item.kind === "video").forEach(revokePreview);
        return [...current.filter((item) => item.kind !== "video"), additions[0]];
      }
      return [...current, ...additions];
    });
    setResult((current) => current?.kind === kind ? undefined : current);
    setNotice(kind === "video" ? "视频已加入拉片队列" : `${additions.length} 张扫描图已按文件名自然页序加入；仍可手动上下调整`);
    setError("");
  };

  const removeQueueItem = (localId: string) => {
    setQueue((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target) revokePreview(target);
      return current.filter((item) => item.localId !== localId);
    });
  };

  const moveQueueItem = (localId: string, offset: -1 | 1) => {
    setQueue((current) => {
      const sameKind = current.filter((item) => item.kind === kind);
      const index = sameKind.findIndex((item) => item.localId === localId);
      const targetIndex = index + offset;
      if (index < 0 || targetIndex < 0 || targetIndex >= sameKind.length) return current;
      [sameKind[index], sameKind[targetIndex]] = [sameKind[targetIndex], sameKind[index]];
      let cursor = 0;
      return current.map((item) => item.kind === kind ? sameKind[cursor++] : item);
    });
  };

  const updateQueueItem = (localId: string, patch: Partial<QueueItem>) => {
    setQueue((current) => current.map((item) => item.localId === localId ? { ...item, ...patch } : item));
  };

  const uploadOne = async (item: QueueItem): Promise<QueueItem> => {
    if (item.mediaId) return { ...item, status: "uploaded", error: undefined };
    if (!item.file) throw new Error(`${item.name} 需要重新选择后才能上传`);
    updateQueueItem(item.localId, { status: "uploading", error: undefined });
    const query = new URLSearchParams({ kind: item.kind, name: item.name, mime: item.mime });
    const response = await authenticatedFetch(`${bridgeBase}/media-upload?${query.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": item.mime || "application/octet-stream",
        "x-shotdirector-token": pairingToken || "",
      },
      body: item.file,
    });
    const payload = await responseJson(response);
    if (!response.ok || typeof payload.mediaId !== "string") {
      throw new Error(serverError(payload, `${item.name} 上传失败（HTTP ${response.status}）`));
    }
    const uploaded = {
      ...item,
      mediaId: payload.mediaId,
      uploadedAt: typeof payload.uploadedAt === "string" ? payload.uploadedAt : new Date().toISOString(),
      status: "uploaded" as const,
      error: undefined,
    };
    updateQueueItem(item.localId, uploaded);
    return uploaded;
  };

  const startAnalysis = async (resumeRequestId = "") => {
    if (!connected || !pairingToken) {
      setError("本地 Pi Agent Harness 尚未连接，暂时不能上传素材。");
      return;
    }
    if (!backgroundConfirmed) {
      setError("请先填写“项目故事背景／世界观”。已经选择的漫画不会丢失。");
      return;
    }
    if (!artStyleConfirmed) {
      setError("请先填写并确认“最终视频美术风格”。已经选择的漫画不会丢失。");
      return;
    }
    if (kind === "video" && visibleQueue.length !== 1) {
      setError("视频拉片需要且只能选择一个视频。");
      return;
    }
    if (kind === "manga" && (visibleQueue.length < 1 || visibleQueue.length > 40)) {
      setError("漫画转换需要 1–40 张扫描图。");
      return;
    }

    setSubmitting(true);
    setError("");
    setNotice(resumeRequestId ? "正在从已保存的拆图进度继续……" : "正在上传素材……");
    try {
      const uploaded: QueueItem[] = [];
      for (const item of visibleQueue) {
        try {
          uploaded.push(await uploadOne(item));
        } catch (caught) {
          const message = errorMessage(caught, `${item.name} 上传失败`);
          updateQueueItem(item.localId, { status: "error", error: message });
          throw caught;
        }
      }
      setNotice(kind === "video" ? "视频上传完成，正在启动完整拉片……" : "漫画上传完成，正在启动逐页拆解……");
      const response = await authenticatedFetch(`${bridgeBase}/media-analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-shotdirector-token": pairingToken },
        body: JSON.stringify({
          kind,
          mediaIds: uploaded.map((item) => item.mediaId),
          generationModel,
          storyBackground: storyBackground.trim(),
          defaultArtStyle: resolvedFinalArtStyle.trim(),
          webResearch: kind === "manga" && supportsWebSearch && allowWebResearch ? "supplement" : "off",
          readingDirection,
          brief: brief.trim(),
          submittedAt: new Date().toISOString(),
          ...(resumeRequestId ? { resumeRequestId } : {}),
        }),
      });
      const payload = await responseJson(response);
      const incomingJob = payload.job as MediaAnalysisJob | undefined;
      if (!response.ok || !incomingJob?.requestId) {
        throw new Error(serverError(payload, `无法启动素材分析（HTTP ${response.status}）`));
      }
      setJob({ ...incomingJob, kind, status: "running" });
      setResult((current) => current?.kind === kind ? undefined : current);
      setNotice(incomingJob.message || (resumeRequestId
        ? "已从保存进度继续，页面会自动更新处理状态"
        : "任务已开始，页面会自动更新处理状态"));
    } catch (caught) {
      setError(errorMessage(caught, "无法启动素材分析"));
      setNotice("");
    } finally {
      setSubmitting(false);
    }
  };

  const recoverGeneratedResult = async () => {
    if (!connected || !pairingToken) {
      setError("本地 Pi Agent Harness 尚未连接，暂时不能恢复结果。");
      return;
    }
    setRecovering(true);
    setError("");
    setNotice("正在检查本地已经生成的完整结果……");
    try {
      const response = await authenticatedFetch(`${bridgeBase}/media-recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-shotdirector-token": pairingToken },
        body: JSON.stringify({
          kind,
          requestId: job?.requestId,
          sourceFiles: visibleQueue.map((item) => item.name),
        }),
      });
      const payload = await responseJson(response);
      const recovered = payload.result as MediaAnalysisResult | undefined;
      const incomingJob = payload.job as MediaAnalysisJob | undefined;
      if (!response.ok || !recovered) {
        throw new Error(serverError(payload, "没有找到可恢复的已生成结果"));
      }
      setResult(recovered);
      setJob(incomingJob?.requestId
        ? { ...incomingJob, kind, status: "completed" }
        : {
            requestId: recovered.requestId || "recovered",
            kind,
            status: "completed",
            finishedAt: recovered.completedAt,
            stage: "recovered",
            message: "已从本地完整结果恢复，无需重新分析",
          });
      setNotice(kind === "manga" ? "漫画拆解结果已恢复，无需重新分析" : "视频拉片结果已恢复，无需重新分析");
      setError("");
    } catch (caught) {
      setError(errorMessage(caught, "恢复已生成结果失败"));
      setNotice("");
    } finally {
      setRecovering(false);
    }
  };

  const clearCurrent = () => {
    queue.filter((item) => item.kind === kind).forEach(revokePreview);
    setQueue((current) => current.filter((item) => item.kind !== kind));
    if (job?.kind === kind || result?.kind === kind) setJob(undefined);
    if (result?.kind === kind) setResult(undefined);
    setNotice("");
    setError("");
  };

  return (
    <section className="media-lab" aria-labelledby="media-lab-title">
      <header className="media-header">
        <div className="media-header-copy">
          <p className="media-eyebrow">漫画直接进入逐镜审核</p>
          <h1 id="media-lab-title">漫画转分镜与视频拉片</h1>
          <p>先保留每页、每格和原文证据，再拆成可单点修改、可全局批改、可反推源文件的 Shot 草稿。</p>
        </div>
        <button type="button" className="media-back" onClick={onBack}>返回漫镜</button>
      </header>

      <div className="media-tabs" role="tablist" aria-label="素材分析类型">
        <button
          type="button"
          role="tab"
          aria-selected={kind === "manga"}
          className={kind === "manga" ? "media-tab is-active" : "media-tab"}
          onClick={() => setKind("manga")}
        >
          漫画转分镜
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === "video"}
          className={kind === "video" ? "media-tab is-active" : "media-tab"}
          onClick={() => setKind("video")}
        >
          视频拉片
        </button>
      </div>

      <section className="media-input-panel" aria-labelledby="media-input-title">
        <div className="media-section-heading">
          <div>
            <p className="media-step">01 · 上传</p>
            <h2 id="media-input-title">{kind === "video" ? "上传想模仿的视频" : "上传想视频化的漫画"}</h2>
          </div>
          <span className={connected ? "media-connection is-connected" : "media-connection"}>
            {connected ? "Pi Agent Harness 已连接" : "Pi Agent Harness 未连接"}
          </span>
        </div>

        <label className="media-file-picker">
          <span>{kind === "video" ? "选择一个视频文件" : "选择一页或多页漫画"}</span>
          <input
            type="file"
            accept={kind === "video" ? ".mp4,.mov,.mkv,.webm,.m4v,.avi,video/*" : ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"}
            multiple={kind === "manga"}
            onChange={selectFiles}
            disabled={submitting || jobRunning}
            aria-label={kind === "video" ? "选择待拉片视频" : "选择待转换漫画图片"}
          />
          <small>{kind === "video" ? "支持 MP4 / MOV / MKV / WebM / M4V / AVI，完整拉片最长 10 分钟" : "支持 PNG / JPG / WebP，最多 40 张扫描图、总计 300 MB；自动自然排序并识别单双页"}</small>
        </label>

        {kind === "manga" ? (
          <fieldset className="media-reading-direction">
            <legend>漫画阅读方向</legend>
            <label>
              <input
                type="radio"
                name="media-reading-direction"
                value="right-to-left"
                checked={readingDirection === "right-to-left"}
                onChange={() => setReadingDirection("right-to-left")}
              />
              日漫：从右向左
            </label>
            <label>
              <input
                type="radio"
                name="media-reading-direction"
                value="left-to-right"
                checked={readingDirection === "left-to-right"}
                onChange={() => setReadingDirection("left-to-right")}
              />
              从左向右
            </label>
          </fieldset>
        ) : null}

        <label className="media-brief">
          <span>项目故事背景／世界观（整套漫画固定）</span>
          <textarea
            value={storyBackground}
            onChange={(event) => setStoryBackground(event.target.value)}
            rows={5}
            maxLength={6000}
            placeholder="例如：填写项目的年代、地点、社会秩序、人物关系和叙事边界。"
          />
          {!backgroundConfirmed ? <small className="media-inline-error">请先填写项目故事背景；它只提供时代与世界观，不能覆盖漫画画格证据。</small> : null}
        </label>

        {kind === "manga" ? (
          <label className="media-research-toggle">
            <input
              type="checkbox"
              checked={supportsWebSearch && allowWebResearch}
              disabled={!supportsWebSearch}
              onChange={(event) => setAllowWebResearch(event.target.checked)}
            />
            <span><strong>联网补充公开剧情背景</strong><small>{supportsWebSearch
              ? "默认关闭。开启后只补充作品、人物、时代和地点背景；漫画画格仍是剧情、对白、动作和站位的最高证据。"
              : "当前 GLM/Kimi 写作 API 没有联网工具，已强制关闭；模型不会把编造的来源当成证据。"}</small></span>
          </label>
        ) : null}

        <label className="media-brief">
          <span>最终视频美术风格（自动写入全部资产提示词）</span>
          <textarea
            value={resolvedFinalArtStyle}
            onChange={(event) => setFinalArtStyle(event.target.value)}
            rows={3}
            maxLength={3000}
            placeholder="例如：填写最终视频的媒介、年代质感、色彩、照明、摄影和禁止风格。"
          />
          {!artStyleConfirmed ? <small className="media-inline-error">请先确认最终成片风格；来源素材的画法不会自动当作视频风格。</small> : null}
        </label>

        <label className="media-brief">
          <span>{kind === "video" ? "重点想模仿什么（可选）" : "视频改编重点（可选）"}</span>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={3}
            maxLength={4000}
            placeholder={kind === "video"
              ? "例如：重点分析车内拉拽动作、摄影机遮挡和快速离场的剪辑节奏"
              : "例如：保留原对白，重点把静态画格整理成有明确起止点的运镜"}
          />
        </label>

        <div className="media-queue" aria-label="素材上传队列">
          <div className="media-queue-heading">
            <h3>上传队列</h3>
            <span>{visibleQueue.length}{kind === "manga" ? " 张扫描图" : " 个文件"}</span>
          </div>
          {visibleQueue.length ? (
            <ol>
              {visibleQueue.map((item, index) => (
                <li key={item.localId} className={`media-queue-item is-${item.status}`}>
                  <div className="media-queue-preview">
                    {/* Blob previews cannot use the Next image optimizer. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {item.previewUrl && item.kind === "manga" ? <img src={item.previewUrl} alt={`漫画第 ${index + 1} 页预览`} /> : null}
                    {item.previewUrl && item.kind === "video" ? <video src={item.previewUrl} controls preload="metadata" aria-label="待拉片视频预览" /> : null}
                  </div>
                  <div className="media-queue-meta">
                    <strong>{kind === "manga" ? `P${String(index + 1).padStart(2, "0")} · ` : ""}{item.name}</strong>
                    <span>{formatBytes(item.size)} · {queueStatusLabel(item.status)}</span>
                    {item.error ? <small className="media-inline-error">{item.error}</small> : null}
                  </div>
                  <div className="media-queue-actions">
                    {kind === "manga" ? (
                      <>
                        <button type="button" onClick={() => moveQueueItem(item.localId, -1)} disabled={index === 0 || submitting || jobRunning} aria-label={`将 ${item.name} 上移一页`}>↑</button>
                        <button type="button" onClick={() => moveQueueItem(item.localId, 1)} disabled={index === visibleQueue.length - 1 || submitting || jobRunning} aria-label={`将 ${item.name} 下移一页`}>↓</button>
                      </>
                    ) : null}
                    <button type="button" onClick={() => removeQueueItem(item.localId)} disabled={submitting || jobRunning}>移除</button>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="media-empty">尚未选择素材。</p>}
        </div>

        <div className="media-submit-row">
          <div>
            <strong>{generationModel === "seedance-2.5" ? "Seedance 2.5" : "Seedance 2.0"}</strong>
            <span>{generationModel === "seedance-2.5" ? " · 每镜 6–30 秒 · 适合连续多画格" : " · 每镜 6–15 秒 · 最多 9 个全能参考"}</span>
          </div>
          <button
            type="button"
            className="media-primary"
            onClick={() => { void startAnalysis(); }}
            disabled={submitting || jobRunning}
            aria-disabled={!canAnalyze}
            title={analyzeBlockers.length ? `尚缺：${analyzeBlockers.join("、")}` : "开始上传并拆解漫画"}
          >
            {submitting ? "正在上传……" : kind === "video" ? "开始完整拉片" : "开始拆成可审核分镜"}
          </button>
          <button type="button" className="media-secondary" onClick={clearCurrent} disabled={submitting || jobRunning || (!visibleQueue.length && !visibleResult)}>清空当前</button>
        </div>

        {!submitting && !jobRunning && analyzeBlockers.length ? (
          <p className="media-inline-error" role="status">按钮尚未解锁：请先填写或确认「{analyzeBlockers.join("、")}」。已选的漫画仍保留在队列中。</p>
        ) : null}

        {!pairingToken && connected ? <p className="media-inline-error">桥接已响应，但页面还没有配对令牌；请刷新漫镜后重试。</p> : null}
        {notice ? <p className="media-notice" role="status" aria-live="polite">{notice}</p> : null}
        {error ? <p className="media-error" role="alert">{error}</p> : null}
      </section>

      {job ? (
        <section className="media-job-panel" aria-labelledby="media-job-title">
          <div className="media-section-heading">
            <div>
              <p className="media-step">02 · 处理状态</p>
              <h2 id="media-job-title">{job.kind === "manga" ? "漫画拆解任务" : "视频拉片任务"}</h2>
            </div>
            <span className={`media-job-status is-${job.status}`}>
              {job.status === "running" ? "处理中" : job.status === "completed" ? "已完成" : "失败"}
            </span>
          </div>
          <p className="media-job-message" aria-live="polite">{job.message || job.error || "等待处理状态"}</p>
          <dl className="media-job-meta">
            <div><dt>任务编号</dt><dd>{job.requestId}</dd></div>
            {job.startedAt ? <div><dt>开始</dt><dd>{formatClock(job.startedAt)}</dd></div> : null}
            {job.updatedAt ? <div><dt>最近更新</dt><dd>{formatClock(job.updatedAt)}</dd></div> : null}
          </dl>
          {job.events?.length ? (
            <ol className="media-job-events">
              {job.events.map((event, index) => (
                <li key={`${event.at}-${event.stage}-${index}`}>
                  <time>{formatClock(event.at)}</time>
                  <strong>{event.stage}</strong>
                  <span>{event.message}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {job.status === "failed" ? (
            <div className="media-job-actions">
              <button type="button" className="media-primary" onClick={() => { void startAnalysis(job.requestId); }} disabled={recovering || submitting}>
                继续分析
              </button>
              <button type="button" className="media-primary" onClick={recoverGeneratedResult} disabled={recovering || submitting}>
                {recovering ? "正在恢复……" : "恢复已生成结果"}
              </button>
              <span>「继续分析」保留原素材并复用已完成的拆图进度；「恢复已生成结果」只读取已写完的文件，不会再次调用写作模型。</span>
            </div>
          ) : null}
        </section>
      ) : null}

      {visibleResult ? (
        <section className="media-result" aria-labelledby="media-result-title">
          <div className="media-result-header">
            <div>
              <p className="media-step">03 · 分析结果</p>
              <h2 id="media-result-title">{visibleResult.projectTitle}</h2>
              <p>{visibleResult.summary}</p>
            </div>
            <div className="media-export-actions">
              <button type="button" onClick={recoverGeneratedResult} disabled={recovering || submitting || jobRunning}>{recovering ? "正在重新读取……" : "重新读取本地结果"}</button>
              <button type="button" onClick={() => downloadText(`${safeFileName(visibleResult.projectTitle)}.json`, JSON.stringify(visibleResult, null, 2), "application/json;charset=utf-8")}>下载 JSON</button>
              <button type="button" onClick={() => downloadText(`${safeFileName(visibleResult.projectTitle)}.md`, visibleResult.scriptMarkdown, "text/markdown;charset=utf-8")}>下载 Markdown</button>
              <button type="button" className="media-create-draft" onClick={() => onCreateDraft({ ...visibleResult, projectBackground: storyBackground.trim() })}>进入逐镜审核（独立草稿）</button>
            </div>
          </div>

          {visibleResult.research ? (
            <section className="media-result-section media-research-result" aria-labelledby="media-research-title">
              <h3 id="media-research-title">联网背景溯源</h3>
              <p>{visibleResult.researchPolicy?.downgraded
                ? `本次曾请求联网补充，但 ${visibleResult.researchPolicy.provider} 没有联网工具，已降级为 off；结果只依据项目设定与上传素材。`
                : visibleResult.research.mode === "off" ? "本次未启用联网补充；结果只依据项目设定与上传素材。" : visibleResult.research.used ? `已用 ${visibleResult.research.sources.length} 个公开来源补充背景；未用于改写漫画证据。` : "已允许联网，但没有采用可确认的外部资料。"}</p>
              {visibleResult.research.sources.length ? (
                <ul>
                  {visibleResult.research.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><span>{source.usedFor}</span></li>)}
                </ul>
              ) : null}
            </section>
          ) : null}

          {visibleResult.previewUrls?.length ? (
            <section className="media-result-section media-previews" aria-labelledby="media-previews-title">
              <h3 id="media-previews-title">{kind === "video" ? "逐秒接触表" : "漫画页面"}</h3>
              <div className="media-preview-strip">
                {visibleResult.previewUrls.map((url, index) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {/* Bridge previews are local, short-lived URLs outside Next image optimization. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={authorizedPreviewUrl(url, pairingToken)} alt={kind === "video" ? `视频接触表 ${index + 1}` : `漫画第 ${index + 1} 页`} />
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {kind === "manga" && visibleResult.mangaPages?.length ? (
            <section className="media-result-section media-panel-audit" aria-labelledby="media-panel-audit-title">
              <div className="media-panel-audit-heading">
                <div><h3 id="media-panel-audit-title">扫描与分格校验</h3><p>黄色框为进入剧情的画格，灰色框为封面、插画、留白或作者后记；先核对这里，再进入逐镜审核。</p></div>
                <strong>{visibleResult.mangaPages.reduce((total, page) => total + page.panels.filter((panel) => panel.includeInShots).length, 0)} 个剧情格</strong>
              </div>
              <div className="media-manga-page-grid">
                {visibleResult.mangaPages.map((page) => {
                  const previewUrl = visibleResult.previewUrls?.[page.scanIndex - 1];
                  return (
                    <article key={`${page.scanIndex}-${page.sourceFile}`} className={page.includeInShots ? "media-manga-page" : "media-manga-page is-excluded"}>
                      <header>
                        <div><span>SCAN {String(page.scanIndex).padStart(2, "0")}</span><strong>{page.sourceFile}</strong></div>
                        <em>{mangaLayoutLabel(page.layout)} · {mangaClassificationLabel(page.classification)}</em>
                      </header>
                      {previewUrl ? (
                        <div className="media-manga-panel-map">
                          {/* Local bridge images are displayed directly so panel coordinates stay aligned. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={authorizedPreviewUrl(previewUrl, pairingToken)} alt={`扫描 ${page.scanIndex} 分格校验`} />
                          {page.panels.map((panel) => (
                            <span
                              key={panel.id}
                              className={panel.includeInShots ? "media-panel-box is-story" : "media-panel-box is-excluded"}
                              style={{
                                left: `${clampPercent(panel.bounds.x)}%`,
                                top: `${clampPercent(panel.bounds.y)}%`,
                                width: `${clampPercent(panel.bounds.width)}%`,
                                height: `${clampPercent(panel.bounds.height)}%`,
                              }}
                              title={`${panel.id} · ${panel.sourceObservation}`}
                            ><b>{panel.id}</b></span>
                          ))}
                        </div>
                      ) : null}
                      <div className="media-manga-page-notes">
                        <p>{page.notes}</p>
                        <small>阅读顺序：{page.readingOrder.join(" → ") || "未确认"}</small>
                        <ol>{page.panels.map((panel) => {
                          const targetShotIds = shotIdsByPanel.get(panel.id) || [];
                          return (
                            <li key={panel.id}>
                              <b>{panel.id}</b>
                              <span>{panel.sourceObservation}</span>
                              {panel.includeInShots && targetShotIds.length ? (
                                <button
                                  type="button"
                                  className="media-panel-enter"
                                  onClick={() => onCreateDraft(visibleResult, targetShotIds[0])}
                                  title={targetShotIds.length > 1 ? `该画格用于 Shot ${targetShotIds.join("、")}；先进入 Shot ${targetShotIds[0]}` : `进入 Shot ${targetShotIds[0]}`}
                                >进入 Shot {targetShotIds[0]}</button>
                              ) : <em>{panel.includeInShots ? "未映射" : "排除"}</em>}
                            </li>
                          );
                        })}</ol>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {visibleResult.assetPrompts?.length ? (
            <section className="media-result-section" aria-labelledby="media-assets-title">
              <h3 id="media-assets-title">自动资产生图提示词 · {visibleResult.assetPrompts.length} 项</h3>
              <p>漫画可见事实与最终成片转译分开记录；同一资产可复用于它关联的全部 Shot。</p>
              <div className="media-shot-list">
                {visibleResult.assetPrompts.map((asset) => (
                  <details key={asset.id} className="media-shot-card">
                    <summary>
                      <span>{assetKindLabel(asset.kind)} · {asset.id}</span>
                      <strong>{asset.name}</strong>
                      <em>Shot {asset.shotIds.join("、")}</em>
                    </summary>
                    <dl>
                      <div><dt>来源画格</dt><dd>{asset.sourcePanels.join("、") || "视频时间轴观察"}</dd></div>
                      <div><dt>漫画外观观察</dt><dd>{asset.sourceObservation}</dd></div>
                      <div><dt>可直接生图提示词</dt><dd>{asset.prompt}</dd></div>
                      <div><dt>负面提示词</dt><dd>{asset.negative.join("；") || "无额外禁止项"}</dd></div>
                    </dl>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          <section className="media-result-section" aria-labelledby="media-text-title">
            <h3 id="media-text-title">原素材文字整理</h3>
            {visibleResult.sourceText.length ? (
              <div className="media-source-text">
                {visibleResult.sourceText.map((item, index) => (
                  <article key={`${item.location}-${index}`}>
                    <div><strong>{item.location}</strong><span>置信度：{confidenceLabel(item.confidence)}</span></div>
                    <p><b>{item.speaker}</b>：{item.text}</p>
                  </article>
                ))}
              </div>
            ) : <p className="media-empty">素材中没有可可靠确认的文字或对白。</p>}
          </section>

          <section className="media-result-section" aria-labelledby="media-camera-title">
            <h3 id="media-camera-title">运镜与剪辑语法</h3>
            {visibleResult.cameraNotes.length ? <ul>{visibleResult.cameraNotes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul> : <p className="media-empty">没有额外运镜备注。</p>}
          </section>

          <section className="media-result-section" aria-labelledby="media-timeline-title">
            <h3 id="media-timeline-title">完整时间轴／画格顺序</h3>
            <div className="media-timeline">
              {visibleResult.timeline.map((item) => (
                <article key={`${item.index}-${item.timecode}`} className="media-timeline-item">
                  <header><span>{String(item.index).padStart(2, "0")}</span><strong>{item.timecode}</strong><h4>{item.story}</h4></header>
                  <div className="media-evidence-suggestion">
                    <div><b>原素材观察</b><p>{item.sourceObservation}</p></div>
                    <div><b>视频改编建议</b><p>{item.adaptationSuggestion}</p></div>
                  </div>
                  <dl>
                    <div><dt>景别</dt><dd>{item.shotSize}</dd></div>
                    <div><dt>机位</dt><dd>{item.camera}</dd></div>
                    <div><dt>运镜</dt><dd>{item.movement}</dd></div>
                    <div><dt>剪辑</dt><dd>{item.editing}</dd></div>
                    <div><dt>表演／动作</dt><dd>{item.performance}</dd></div>
                    <div><dt>声音</dt><dd>{item.sound || "未确认"}</dd></div>
                  </dl>
                  {item.keep.length ? <p className="media-keep"><b>建议保留：</b>{item.keep.join("；")}</p> : null}
                  {item.issues.length ? <p className="media-issues"><b>风险：</b>{item.issues.join("；")}</p> : null}
                </article>
              ))}
            </div>
          </section>

          <section className="media-result-section" aria-labelledby="media-shots-title">
            <h3 id="media-shots-title">可进入漫镜的 Shot 草稿 · {visibleResult.shots.length} 镜</h3>
            <div className="media-shot-list">
              {visibleResult.shots.map((shot) => (
                <details key={shot.id} className="media-shot-card">
                  <summary><span>SHOT {shot.id}</span><strong>{shot.title}</strong><em>{shot.timecode} · {shot.duration}s</em></summary>
                  <dl>
                    <div><dt>来源画格</dt><dd>{shot.sourcePanels?.join("、") || "旧结果未记录，请重新拆解"}</dd></div>
                    <div><dt>剧情</dt><dd>{shot.story}</dd></div>
                    <div><dt>人物</dt><dd>{shot.characters.join("；") || "无"}</dd></div>
                    <div><dt>物品和场景</dt><dd>{[shot.scene, ...shot.props].filter(Boolean).join("；")}</dd></div>
                    <div><dt>站位与构图</dt><dd>{shot.composition}</dd></div>
                    <div><dt>机位／运镜</dt><dd>{shot.camera}</dd></div>
                    <div><dt>动作</dt><dd>{shot.action}</dd></div>
                    <div><dt>对白</dt><dd>{shot.dialogue.join("；") || "无"}</dd></div>
                    <div><dt>连续性</dt><dd>{shot.continuity.join("；") || "无"}</dd></div>
                    <div><dt>美术风格</dt><dd>{shot.artStyle}</dd></div>
                  </dl>
                </details>
              ))}
            </div>
          </section>

          <section className="media-result-section" aria-labelledby="media-markdown-title">
            <h3 id="media-markdown-title">导演分析稿</h3>
            <pre className="media-markdown">{visibleResult.scriptMarkdown}</pre>
          </section>
        </section>
      ) : null}
    </section>
  );
}

export default MediaLab;
