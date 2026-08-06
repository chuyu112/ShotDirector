import type { StoryboardShot } from "./storyboard-data";

export type DirectorRecipe = {
  id: string;
  name: string;
  shortName: string;
  summary: string;
  rules: string[];
};

export type CoverageStatus = "covered" | "duplicate" | "missing";

export type CoverageUnit = {
  index: number;
  text: string;
  shotIds: string[];
  status: CoverageStatus;
};

export type CoverageReport = {
  units: CoverageUnit[];
  coveredUnits: number;
  missingUnits: number;
  duplicateUnits: number;
  coveragePercent: number;
  shotsWithoutEvidence: string[];
  hasOriginalDocument: boolean;
};

export const directorRecipes: DirectorRecipe[] = [
  {
    id: "faithful-coverage",
    name: "原文忠实与防漏",
    shortName: "防漏",
    summary: "逐句建立原文依据，优先保证人物、动作、对白、反应和事件先后没有遗漏。",
    rules: [
      "每个 Shot 的 sourceText 必须引用对应原文，不得用改写后的剧情冒充原文。",
      "按原文顺序覆盖开头到结尾；无法归入镜头的内容必须明确列为未覆盖。",
      "新增导演设计可以优化表达，但不能覆盖、删除或篡改原文事实。",
    ],
  },
  {
    id: "dialogue-reaction",
    name: "对白与反应细拆",
    shortName: "对白",
    summary: "把提问、回答、停顿、视线和反应拆清，避免长对白全部压进一个镜头。",
    rules: [
      "按说话者切换、信息揭示和可见反应决定正反打，不机械逐句切镜。",
      "保留听者的表情、停顿和视线变化；长台词必须匹配可读时长。",
      "台词来自原文；没有可靠依据时不得补写对白。",
    ],
  },
  {
    id: "physical-action",
    name: "动作可信度",
    shortName: "动作",
    summary: "锁定动作起点、接触点、受力方向、遮挡剪切和动作结束状态。",
    rules: [
      "复杂动作按准备、接触、受力、遮挡、结果拆成可生成的连续节拍。",
      "明确人物重心、手脚位置、接触物和空间障碍，禁止瞬移与肢体融合。",
      "每个关键动作至少获得足以辨认的画面时长，并与下一镜起始姿态衔接。",
    ],
  },
  {
    id: "vehicle-continuity",
    name: "车辆与空间连续",
    shortName: "车辆",
    summary: "锁定道路、车头、左右舵、座位、人物所在车门与行驶轨迹。",
    rules: [
      "逐镜写清车辆朝向、车头方向、道路侧、驾驶位、门窗和人物相对位置。",
      "正反打只改变摄影机，不镜像车辆结构，不交换座位和车门。",
      "行驶轨迹、机位轨迹和人物动作路径分开描述。",
    ],
  },
  {
    id: "emotion-performance",
    name: "表情与心理外化",
    shortName: "表演",
    summary: "把抽象情绪变成眼神、呼吸、嘴角、手部和身体重心等可见表演。",
    rules: [
      "不用单独的抽象情绪词代替表演，必须描述摄影机能看见的表情与身体反应。",
      "情绪变化要有触发点、过渡和结果，不让人物在相邻镜头无故换状态。",
      "主反应和次反应分清叙事重心，避免所有人物同时夸张表演。",
    ],
  },
];

export const defaultDirectorRecipeId = directorRecipes[0].id;

export function getDirectorRecipe(recipeId?: string) {
  return directorRecipes.find((recipe) => recipe.id === recipeId) || directorRecipes[0];
}

export function sourceTextForShot(shot: StoryboardShot) {
  const explicit = Array.isArray(shot.sourceText)
    ? shot.sourceText.map((item) => item.trim()).filter(Boolean)
    : [];
  if (explicit.length) return [...new Set(explicit)];
  return [shot.story.trim(), ...shot.dialogue.map((item) => item.trim())].filter(Boolean);
}

export function sourceDocumentFromShots(shots: StoryboardShot[]) {
  return shots
    .flatMap((shot) => sourceTextForShot(shot))
    .filter(Boolean)
    .join("\n\n");
}

export function splitSourceUnits(sourceDocument: string) {
  const normalized = String(sourceDocument || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const units = paragraphs.flatMap((paragraph) => {
    if (paragraph.length <= 120) return [paragraph];
    const sentences = paragraph.match(/[^。！？!?；;\n]+[。！？!?；;]?/g)
      ?.map((item) => item.trim())
      .filter(Boolean) || [];
    return sentences.length ? sentences : [paragraph];
  });
  return units.filter((unit) => !/^#{1,6}\s/.test(unit) && !/^[-*_]{3,}$/.test(unit));
}

function comparisonText(value: string) {
  return String(value || "")
    .toLocaleLowerCase("zh-CN")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function evidenceMatchesUnit(evidence: string, unit: string) {
  const evidenceText = comparisonText(evidence);
  const unitText = comparisonText(unit);
  if (!evidenceText || !unitText) return false;
  if (evidenceText.includes(unitText) || unitText.includes(evidenceText)) {
    return Math.min(evidenceText.length, unitText.length) >= Math.min(8, unitText.length);
  }

  const sampleLength = Math.min(18, unitText.length);
  if (sampleLength < 8) return false;
  const samples = [
    unitText.slice(0, sampleLength),
    unitText.slice(Math.max(0, Math.floor((unitText.length - sampleLength) / 2)), Math.max(0, Math.floor((unitText.length - sampleLength) / 2)) + sampleLength),
    unitText.slice(-sampleLength),
  ];
  return samples.filter((sample) => evidenceText.includes(sample)).length >= 2;
}

export function buildCoverageReport(sourceDocument: string, shots: StoryboardShot[]): CoverageReport {
  const explicitDocument = String(sourceDocument || "").trim();
  const document = explicitDocument || sourceDocumentFromShots(shots);
  const evidence = shots.map((shot) => ({ shotId: shot.id, items: sourceTextForShot(shot) }));
  const units = splitSourceUnits(document).map((text, index): CoverageUnit => {
    const shotIds = evidence
      .filter((shot) => shot.items.some((item) => evidenceMatchesUnit(item, text)))
      .map((shot) => shot.shotId);
    return {
      index: index + 1,
      text,
      shotIds,
      status: shotIds.length > 1 ? "duplicate" : shotIds.length === 1 ? "covered" : "missing",
    };
  });
  const coveredUnits = units.filter((unit) => unit.status !== "missing").length;
  const missingUnits = units.filter((unit) => unit.status === "missing").length;
  const duplicateUnits = units.filter((unit) => unit.status === "duplicate").length;
  return {
    units,
    coveredUnits,
    missingUnits,
    duplicateUnits,
    coveragePercent: units.length ? Math.round((coveredUnits / units.length) * 100) : 0,
    shotsWithoutEvidence: shots.filter((shot) => !sourceTextForShot(shot).length).map((shot) => shot.id),
    hasOriginalDocument: Boolean(explicitDocument),
  };
}

export function changedShotFields(before: StoryboardShot, after: StoryboardShot) {
  const labels: Partial<Record<keyof StoryboardShot, string>> = {
    title: "标题",
    sourceText: "原文依据",
    artStyle: "美术风格",
    story: "剧情",
    scene: "场景",
    characters: "人物",
    props: "物品",
    omniReferences: "全能参考",
    composition: "站位构图",
    camera: "机位运镜",
    action: "动作",
    dialogue: "对白",
    continuity: "连续性",
    negative: "禁止项",
    segments: "动作分段",
  };
  return (Object.keys(labels) as Array<keyof StoryboardShot>)
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => labels[field] || String(field));
}
