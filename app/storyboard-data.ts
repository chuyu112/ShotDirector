export type StoryboardSegment = {
  label: string;
  beat: string;
  framing: string;
  mustShow: string[];
};

export type StoryboardShot = {
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

export const inferredVideoArtStyle = "写实彩色电影级成片风格；真实街景、车辆与材质，克制的冷暖对比与35mm胶片颗粒；人物按已上传参考图保持真实外观和服装，参考图未上传时不擅自固定面孔；16:9，不漫画化，不动漫化。";

export const mistakenStoryboardAsVideoArtStyle = "彩色漫画级电影分镜与手绘赛璐璐风格；该描述只用于识别旧数据中的错误风格层级，不得作为最终视频风格。";

export const defaultArtStyle = "待从原始脚本或已确认的项目美术设定中提取；未明确前，不向视频提示词擅自添加漫画、赛璐璐、真人写实或其他画风。";

export const storyboardArtworkStyle = "临时赛璐璐动画导演分镜工作图，1980年代日本手绘动画质感；清楚轮廓线、简洁平涂色块、易读的冷暖分区与必要的速度线，准确表达剧情、场景、人物占位、视线、动作重心和摄影机关系。人物面孔只作占位，不锁定最终演员外观；这不是最终视频画风。";

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
