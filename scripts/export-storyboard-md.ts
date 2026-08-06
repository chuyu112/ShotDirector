import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { globalSettings } from "../app/global-settings";
import { storyboardShots } from "../app/storyboard-data";

const projectTitle = process.argv[2]?.trim() || "未命名项目";
const requestedOutput = process.argv[3]?.trim();
const outputPath = requestedOutput
  ? resolve(process.cwd(), requestedOutput)
  : resolve(process.cwd(), `${projectTitle}-完整分镜脚本.md`);

function bullets(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- 无";
}

function field(label: string, value: string) {
  return `**${label}**\n\n${value || "无"}`;
}

const globalSections = [
  ["人物全局设定", globalSettings.characters],
  ["关键物品", globalSettings.props],
  ["地点与时代", globalSettings.locations],
  ["剧情日期与时间线", globalSettings.timeline],
  ["连续性硬锁", globalSettings.continuity],
  ["生成模型规范", globalSettings.modelRules],
  ["全局禁止项", globalSettings.negative],
] as const;

const markdown = [
  `# ${projectTitle}`,
  "",
  "> 镜导 ShotDirector 导出的完整 Markdown 脚本。全局设定优先于单镜旧描述；逐镜审批状态不写入故事内容。",
  "",
  "## 全局设定",
  "",
  "### 项目故事背景",
  "",
  globalSettings.storyBackground,
  "",
  ...globalSections.flatMap(([title, items]) => [`### ${title}`, "", bullets([...items]), ""]),
  "### 最终视频美术风格",
  "",
  globalSettings.finalVideoStyle,
  "",
  "### Lib Image 临时分镜图风格",
  "",
  globalSettings.storyboardImageStyle,
  "",
  "---",
  "",
  "## 分镜脚本",
  "",
  ...storyboardShots.flatMap((shot) => {
    const segments = shot.segments.length
      ? [
          "#### 连续动作分段",
          "",
          ...shot.segments.flatMap((segment, index) => [
            `##### ${index + 1}. ${segment.label}`,
            "",
            field("剧情节拍", segment.beat),
            "",
            field("画面与机位", segment.framing),
            "",
            "**必须出现**",
            "",
            bullets(segment.mustShow),
            "",
          ]),
        ]
      : [];

    return [
      `### Shot ${shot.id}｜${shot.timecode}｜${shot.duration}秒`,
      "",
      `#### ${shot.title}`,
      "",
      field("最终视频美术风格", shot.artStyle),
      "",
      field("剧情", shot.story),
      "",
      field("场景", shot.scene),
      "",
      "**人物**",
      "",
      bullets(shot.characters),
      "",
      "**关键物品**",
      "",
      bullets(shot.props),
      "",
      "**全能参考**",
      "",
      bullets(shot.omniReferences),
      "",
      field("人物站位、朝向与构图", shot.composition),
      "",
      field("机位／景别／运动", shot.camera),
      "",
      field("完整动作链", shot.action),
      "",
      "**对白／声音**",
      "",
      bullets(shot.dialogue),
      "",
      "**连续性硬锁**",
      "",
      bullets(shot.continuity),
      "",
      "**禁止项**",
      "",
      bullets(shot.negative),
      "",
      ...segments,
      "---",
      "",
    ];
  }),
].join("\n");

writeFileSync(outputPath, `${markdown.trim()}\n`, "utf8");
process.stdout.write(outputPath);
