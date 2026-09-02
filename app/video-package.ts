import type { GlobalSettings } from "./global-settings";
import type { StoryboardShot } from "./storyboard-data";
import { buildOmniReferenceBindings, referenceSignature, validatePromptReferenceCoverage } from "./reference-contract.mjs";

export type VideoPackageStatus = "blocked" | "running" | "stale" | "warning" | "ready";

export type WhiteboxLock = {
  key: string;
  lockedAt: string;
  sourceRevision?: string;
};

export type VideoPackageInput = {
  projectTitle: string;
  modelId: string;
  modelLabel: string;
  referenceLimit: number;
  minDuration: number;
  maxDuration: number;
  globalSettings: GlobalSettings;
  shot: StoryboardShot;
  approved: boolean;
  approvedAt?: string;
  promptReviewCurrent: boolean;
  layoutViewKeys: string[];
  directorViewKeys: string[];
  whiteboxLocks: WhiteboxLock[];
  artworkStatus: "empty" | "generating" | "ready" | "error";
  artworkNames: string[];
  selectedArtworkIndex: number;
  artworkDependencyRevision?: string;
  customPrompt?: string;
  customPromptSourceRevision?: string;
};

export type VideoGenerationPackage = {
  packageId: string;
  shotUid?: string;
  shotId: string;
  title: string;
  timecode: string;
  duration: number;
  model: string;
  status: VideoPackageStatus;
  sourceRevision: string;
  prompt: string;
  defaultPrompt: string;
  promptMode: "automatic" | "custom";
  warnings: string[];
  dependencies: Array<{
    id: "script" | "layout" | "whitebox" | "artwork" | "prompt";
    label: string;
    status: "blocked" | "missing" | "stale" | "running" | "ready";
    detail: string;
  }>;
  assets: {
    layoutViews: string[];
    whiteboxReferences: WhiteboxLock[];
    artworkCandidates: string[];
    selectedArtwork?: string;
    omniReferences: string[];
    referenceBindings: Array<{
      id: string;
      label: string;
      kind: "scene" | "character" | "prop" | "extra";
      imageIndex: number;
      token: string;
    }>;
    referenceSignature: string;
  };
};

function compact(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Keep asynchronous-generation revisions tied to the stable Shot identity and
 * the creative source, not to editable timeline labels. Renumbering/reordering
 * may change `id` and `timecode` while the underlying Shot remains the same.
 *
 * Legacy Shots without a `shotUid` still fall back to `id` so two otherwise
 * identical legacy Shots cannot accidentally share a revision.
 */
function shotSourceRevisionPayload(shot: StoryboardShot) {
  const { id, timecode: _timecode, shotUid, ...source } = shot;
  return {
    shotIdentity: shotUid || `legacy-shot:${id}`,
    ...source,
  };
}

export function buildShotUpstreamRevision(input: {
  projectTitle: string;
  modelId: string;
  globalSettings: GlobalSettings;
  shot: StoryboardShot;
}) {
  return `up-${hashText(JSON.stringify({
    projectTitle: input.projectTitle,
    modelId: input.modelId,
    globalSettings: input.globalSettings,
    shot: shotSourceRevisionPayload(input.shot),
  }))}`;
}

export function buildCompleteShotPromptRevision(input: {
  projectTitle: string;
  modelId: string;
  globalSettings: GlobalSettings;
  shot: StoryboardShot;
  shotAnnotations: Record<string, string>;
  panelAnnotations: Record<string, string>;
  sourceMangaRequestId: string;
}) {
  return `complete-${hashText(JSON.stringify({
    projectTitle: input.projectTitle,
    modelId: input.modelId,
    globalSettings: input.globalSettings,
    shot: shotSourceRevisionPayload(input.shot),
    shotAnnotations: input.shotAnnotations,
    panelAnnotations: input.panelAnnotations,
    sourceMangaRequestId: input.sourceMangaRequestId,
  }))}`;
}

export function buildPromptReviewRevision(input: {
  shotId: string;
  completePrompt: string;
  completePromptSourceRevision?: string;
  completePromptGeneratorId: string;
  reviewerId: string;
}) {
  return `review-${hashText(JSON.stringify({
    shotId: input.shotId,
    completePrompt: input.completePrompt,
    completePromptSourceRevision: input.completePromptSourceRevision || "",
    completePromptGeneratorId: input.completePromptGeneratorId || "legacy-unknown",
    reviewerId: input.reviewerId,
  }))}`;
}

function normalizeShotRuleId(value: string) {
  const match = String(value || "").trim().toUpperCase().match(/^(\d+)([A-Z]*)$/);
  if (!match) return undefined;
  return { number: Number.parseInt(match[1], 10), suffix: match[2] };
}

/**
 * Match one timeline rule to one exact shot identity.
 *
 * A suffixed shot is a separate generation unit: `Shot 01` must not leak
 * into `01A` or `01B`. Suffixed shots only match an explicit suffixed token
 * (`Shot 01A`) or an explicit suffixed range (`Shot 01A–01B`).
 */
export function shotNumberFromRule(rule: string, shotId: string) {
  if (!/Shot\s*\d/i.test(rule)) return true;
  const target = normalizeShotRuleId(shotId);
  if (!target) return false;

  const ranges = [...rule.matchAll(/Shot\s*(\d+[A-Z]*)(?:\s*[-–—~～至]\s*(?:Shot\s*)?(\d+[A-Z]*))?/gi)];
  return ranges.some((match) => {
    const start = normalizeShotRuleId(match[1]);
    const end = normalizeShotRuleId(match[2] || match[1]);
    if (!start || !end) return false;

    // Never collapse 01A/01B into numeric Shot 01 or a numeric range.
    if (target.suffix && (!start.suffix || !end.suffix)) return false;
    if (!target.suffix && (start.suffix || end.suffix)) return false;

    if (!target.suffix) {
      return target.number >= Math.min(start.number, end.number)
        && target.number <= Math.max(start.number, end.number);
    }

    // A suffixed range is meaningful only inside the same numeric shot root.
    if (start.number !== end.number || target.number !== start.number) return false;
    const [lower, upper] = start.suffix.localeCompare(end.suffix) <= 0
      ? [start.suffix, end.suffix]
      : [end.suffix, start.suffix];
    return target.suffix.localeCompare(lower) >= 0 && target.suffix.localeCompare(upper) <= 0;
  });
}

function relevantNamedRules(rules: string[], shotText: string) {
  return rules.filter((rule) => {
    const label = rule.split(/[：:]/, 1)[0].replace(/（.*?）/g, "").trim();
    return !label || label.length < 2 || shotText.includes(label);
  });
}

function relevantGlobalRules(settings: GlobalSettings, shot: StoryboardShot, modelLabel: string) {
  const positiveShotText = [
    shot.title,
    shot.story,
    shot.scene,
    ...shot.characters,
    ...shot.props,
    shot.composition,
    shot.camera,
    shot.action,
    ...shot.dialogue,
  ].join("\n");
  return compact([
    ...relevantNamedRules(settings.characters, positiveShotText),
    ...relevantNamedRules(settings.props, positiveShotText),
    ...relevantNamedRules(settings.locations, positiveShotText),
    ...settings.timeline.filter((rule) => shotNumberFromRule(rule, shot.id)),
    ...settings.continuity,
    ...settings.modelRules.filter((rule) => !/^Seedance\s*\d/i.test(rule) || rule.includes(modelLabel)),
  ]);
}

function actionTimeline(shot: StoryboardShot) {
  if (!shot.segments.length) return shot.action;
  return shot.segments.map((segment, index) => {
    const mustShow = segment.mustShow.length ? `；必须出现：${segment.mustShow.join("、")}` : "";
    return `${index + 1}. ${segment.label}：${segment.beat}；画面/机位：${segment.framing}${mustShow}`;
  }).join("\n");
}

function buildDefaultPrompt(input: VideoPackageInput, selectedArtwork: string | undefined, referenceBindings: ReturnType<typeof buildOmniReferenceBindings>) {
  const shot = input.shot;
  const globalRules = relevantGlobalRules(input.globalSettings, shot, input.modelLabel);
  const finalVideoStyle = input.globalSettings.finalVideoStyle.trim() || shot.artStyle;
  const whiteboxLine = input.whiteboxLocks.length
    ? `${input.whiteboxLocks.map((item) => item.key).join("、")} 的纯净3D白模只约束空间透视、人物/车辆尺度、朝向、站位、动作重心和摄影机关系，不继承白模外观。`
    : "本镜尚未锁定白模；严格执行文字中的站位、朝向和摄影机关系。";
  const layoutLine = input.layoutViewKeys.length
    ? `${input.layoutViewKeys.join("、")} TOP VIEW 只作为站位、轨迹与机位依据，忽略其中的文字标签和箭头样式。`
    : "本镜没有独立TOP VIEW，按构图与摄影机文字执行。";
  const artworkLine = selectedArtwork
    ? `已选临时分镜图：${selectedArtwork}。只借其剧情、构图、站位与动作，不改变最终成片风格。`
    : "尚未选定临时分镜图；不得自行补充新剧情或新造型。";

  return compact([
    `只生成《${input.projectTitle}》Shot ${shot.id}，不要生成其他镜头。`,
    `模型：${input.modelLabel}；成片时长 ${shot.duration} 秒；画幅 16:9。`,
    `项目故事背景（只作时代、人物关系与因果上下文，不得覆盖本镜证据）：${input.globalSettings.storyBackground}`,
    `项目统一最终视频美术风格（跨 Shot 硬锁）：${finalVideoStyle}`,
    "本镜必须与同项目其他镜头保持同一年代、真人化方向、胶片质感、曝光逻辑、肤色、材质与调色；漫画原图、临时分镜图、白模和单镜旧美术描述都不得覆盖项目统一风格。",
    `剧情：${shot.story}`,
    `人物：${shot.characters.join("；")}`,
    `关键物品与场景：${[...shot.props, shot.scene].join("；")}`,
    `站位与构图：${shot.composition}`,
    `摄影机：${shot.camera}`,
    `时间轴与动作：\n${actionTimeline(shot)}`,
    shot.dialogue.length ? `日语对白（中文人物名与说明只作制作备注，不得作为字幕或口播）：${shot.dialogue.join("；")}` : "",
    "声音：只保留与画面同步的现场环境声、动作音效、枪声和自然日语对白；中文内容只作制作备注。无旁白、无内心独白、无BGM。",
    `连续性硬锁：${shot.continuity.join("；")}`,
    globalRules.length ? `本镜相关全局规则：${globalRules.join("；")}` : "",
    `导演结构参考：${layoutLine}${whiteboxLine}${artworkLine}`,
    referenceBindings.length
      ? `参考图绑定（上传顺序唯一权威）：${referenceBindings.map((item) => `${item.token}=${item.label}`).join("；")}。提示词中的 ${referenceBindings.map((item) => item.token).join("、")} 必须与该顺序一致。`
      : "参考图绑定：无。不得虚构 @图片 引用。",
    `全能参考（${shot.omniReferences.length}/${input.referenceLimit}）：${referenceBindings.map((item) => item.label).join("；") || "无"}`,
    `禁止：${compact([...input.globalSettings.negative, ...shot.negative]).join("；")}`,
    "不要生成字幕、对白气泡、水印或乱码文字。不得添加BGM、旁白或内心独白。不得把生图提示词、白模材质或临时分镜画风复制成最终视频风格。",
  ]).join("\n\n");
}

export function buildVideoGenerationPackage(input: VideoPackageInput): VideoGenerationPackage {
  const selectedArtwork = input.artworkNames[input.selectedArtworkIndex] || input.artworkNames[0];
  const referenceBindings = buildOmniReferenceBindings(input.shot.omniReferences, { limit: input.referenceLimit });
  const bindingsSignature = referenceSignature(referenceBindings);
  const upstreamRevision = buildShotUpstreamRevision(input);
  const staleWhiteboxLocks = input.whiteboxLocks.filter((item) => item.sourceRevision !== upstreamRevision);
  const activeWhiteboxLocks = input.whiteboxLocks.filter((item) => item.sourceRevision === upstreamRevision);
  const artworkStale = Boolean(selectedArtwork) && input.artworkDependencyRevision !== upstreamRevision;
  const promptInput = { ...input, whiteboxLocks: activeWhiteboxLocks };
  const revisionPayload = {
    projectTitle: input.projectTitle,
    modelId: input.modelId,
    globalSettings: input.globalSettings,
    shot: shotSourceRevisionPayload(input.shot),
    approved: input.approved,
    approvedAt: input.approvedAt,
    layoutViewKeys: input.layoutViewKeys,
    directorViewKeys: input.directorViewKeys,
    whiteboxLocks: input.whiteboxLocks,
    selectedArtwork,
    bindingsSignature,
  };
  const sourceRevision = `vp-${hashText(JSON.stringify(revisionPayload))}`;
  const defaultPrompt = buildDefaultPrompt(promptInput, artworkStale ? undefined : selectedArtwork, referenceBindings);
  const hasCustomPrompt = typeof input.customPrompt === "string";
  const customPromptStale = hasCustomPrompt
    && Boolean(input.customPromptSourceRevision)
    && input.customPromptSourceRevision !== sourceRevision;
  const warnings: string[] = [];
  if (!input.approved) warnings.push("脚本尚未独立盖章");
  if (input.approved && !input.approvedAt) warnings.push("审批记录缺少签字时间");
  if (!input.promptReviewCurrent) warnings.push("完整提示词尚未通过当前版本的独立审查");
  if (input.shot.duration < input.minDuration || input.shot.duration > input.maxDuration) {
    warnings.push(`时长不符合 ${input.modelLabel} 的 ${input.minDuration}–${input.maxDuration} 秒限制`);
  }
  if (input.shot.omniReferences.length > input.referenceLimit) warnings.push("全能参考数量超限");
  if (!input.layoutViewKeys.length) warnings.push("没有可用的TOP VIEW布局图");
  if (!input.whiteboxLocks.length) warnings.push("尚未锁定纯净3D白模结构参考");
  if (staleWhiteboxLocks.length) warnings.push(`${staleWhiteboxLocks.map((item) => item.key).join("、")} 白模来自旧版脚本或全局设定`);
  if (!selectedArtwork) warnings.push("尚未选定临时分镜图");
  if (artworkStale) warnings.push("已选临时分镜图来自旧版脚本或全局设定");
  if (input.artworkStatus === "error") warnings.push("最近一次分镜出图失败");
  if (customPromptStale) warnings.push("自定义视频提示词来自旧版脚本或旧资产");
  const referenceCoverage = validatePromptReferenceCoverage(hasCustomPrompt ? input.customPrompt || "" : defaultPrompt, referenceBindings);
  if (referenceCoverage.missing.length) warnings.push(`提示词缺少参考图绑定：${referenceCoverage.missing.join("、")}`);
  if (referenceCoverage.unknown.length) warnings.push(`提示词包含不存在的参考图编号：${referenceCoverage.unknown.join("、")}`);

  const approvalReady = input.approved && Boolean(input.approvedAt) && input.promptReviewCurrent;
  const blocked = !approvalReady
    || input.shot.duration < input.minDuration
    || input.shot.duration > input.maxDuration
    || input.shot.omniReferences.length > input.referenceLimit;
  const status: VideoPackageStatus = blocked
    ? "blocked"
    : input.artworkStatus === "generating"
      ? "running"
      : customPromptStale || staleWhiteboxLocks.length > 0 || artworkStale || !referenceCoverage.valid
        ? "stale"
        : !activeWhiteboxLocks.length || !selectedArtwork || !input.layoutViewKeys.length
          ? "warning"
          : "ready";

  return {
    packageId: `video-package-${hashText(`${input.projectTitle}::${input.shot.shotUid || input.shot.id}`)}`,
    shotUid: input.shot.shotUid,
    shotId: input.shot.id,
    title: input.shot.title,
    timecode: input.shot.timecode,
    duration: input.shot.duration,
    model: input.modelLabel,
    status,
    sourceRevision,
    prompt: hasCustomPrompt ? input.customPrompt || "" : defaultPrompt,
    defaultPrompt,
    promptMode: hasCustomPrompt ? "custom" : "automatic",
    warnings,
    dependencies: [
      {
        id: "script",
        label: "分镜脚本",
        status: approvalReady ? "ready" : "blocked",
        detail: !input.approved
          ? "需要单独签字盖章"
          : !input.approvedAt
            ? "审批记录缺少签字时间"
            : !input.promptReviewCurrent
              ? "独立 Reviewer 报告已过期或尚未通过"
              : `已盖章 · ${input.approvedAt}`,
      },
      {
        id: "layout",
        label: "TOP VIEW布局",
        status: input.layoutViewKeys.length ? "ready" : "missing",
        detail: input.layoutViewKeys.length ? input.layoutViewKeys.join("、") : "没有可用布局图",
      },
      {
        id: "whitebox",
        label: "3D白模",
        status: staleWhiteboxLocks.length ? "stale" : activeWhiteboxLocks.length ? "ready" : "missing",
        detail: staleWhiteboxLocks.length
          ? `${staleWhiteboxLocks.map((item) => item.key).join("、")} 来自旧版，需要重新锁定`
          : activeWhiteboxLocks.length ? `${activeWhiteboxLocks.length} 张已锁定：${activeWhiteboxLocks.map((item) => item.key).join("、")}` : "可继续生成，但空间与动作约束较弱",
      },
      {
        id: "artwork",
        label: "临时分镜图",
        status: input.artworkStatus === "generating" ? "running" : artworkStale ? "stale" : selectedArtwork ? "ready" : "missing",
        detail: input.artworkStatus === "generating" ? "Lib Image 后台生成中" : artworkStale ? `历史选图需要复核：${selectedArtwork}` : selectedArtwork ? `已选：${selectedArtwork}` : "尚未选图",
      },
      {
        id: "prompt",
        label: "视频提示词",
        status: customPromptStale ? "stale" : "ready",
        detail: customPromptStale ? "上游发生修改，需要重新编译或确认" : hasCustomPrompt ? "自定义版本与当前上游同步" : "根据脚本、布局、白模与分镜图自动编译",
      },
    ],
    assets: {
      layoutViews: input.layoutViewKeys,
      whiteboxReferences: input.whiteboxLocks,
      artworkCandidates: input.artworkNames,
      selectedArtwork,
      omniReferences: input.shot.omniReferences,
      referenceBindings,
      referenceSignature: bindingsSignature,
    },
  };
}
