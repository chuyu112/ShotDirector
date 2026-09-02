export type StoryboardSegment = {
  label: string;
  beat: string;
  framing: string;
  mustShow: string[];
};

export type StoryboardShot = {
  /** Stable internal identity. `id` remains the editable/display Shot number. */
  shotUid?: string;
  id: string;
  timecode: string;
  duration: number;
  title: string;
  sourceText?: string[];
  sourcePanels?: string[];
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
  segments: StoryboardSegment[];
};

export const legacyStoryboardArtStyle = "黑白青年漫画级电影分镜，1980年代日本硬派写实漫画风；专业铅笔草稿与墨线，清楚的空间透视、人物站位和动作重心，适度网点阴影、速度线与电影感明暗；16:9，不是海报，不是彩色成片。";

export const inferredVideoArtStyle = "写实彩色电影级成片风格；真实街景、车辆与材质，克制的冷暖对比与35mm胶片颗粒；人物按已上传参考图保持真实外观和服装，参考图未上传时不擅自固定面孔；16:9，保持真实摄影表达。";

export const mistakenStoryboardAsVideoArtStyle = "\u5f69\u8272\u6f2b\u753b\u7ea7\u7535\u5f71\u5206\u955c\u4e0e\u624b\u7ed8\u8d5b\u7490\u7490\u98ce\u683c\uff1b\u8be5\u63cf\u8ff0\u53ea\u7528\u4e8e\u8bc6\u522b\u65e7\u6570\u636e\u4e2d\u7684\u9519\u8bef\u98ce\u683c\u5c42\u7ea7\uff0c\u4e0d\u5f97\u4f5c\u4e3a\u6700\u7ec8\u89c6\u9891\u98ce\u683c\u3002";

export const defaultArtStyle = "待从原始脚本或已确认的项目美术设定中提取；未明确前，不向视频提示词擅自添加任何画风。";

export const storyboardArtworkStyle = "临时导演预演分镜工作图；使用清楚轮廓、简洁色块、易读的冷暖分区与必要的动作线，准确表达剧情、场景、人物占位、视线、动作重心和摄影机关系。人物面孔只作占位，不锁定最终演员外观；这不是最终视频画风。";

/**
 * Neutral starter only. Historical scripts, manga panels, assets and generated
 * results are intentionally not bundled with the application.
 */
export const storyboardShots: StoryboardShot[] = [
  {
    id: "01",
    timecode: "00:00–00:04",
    duration: 4,
    title: "未命名镜头",
    sourceText: [],
    sourcePanels: [],
    artStyle: defaultArtStyle,
    story: "",
    scene: "",
    characters: [],
    props: [],
    omniReferences: [],
    composition: "",
    camera: "",
    action: "",
    dialogue: [],
    continuity: [],
    negative: [],
    segments: [],
  },
];
