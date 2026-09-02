import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const requestId = "a7501ea0-9880-47b3-a61a-8ebcadb2f46f";
const draftPath = join(process.cwd(), "work", "shotdirector-draft-state", `${requestId}.json`);
const backupPath = join(process.cwd(), "work", "shotdirector-draft-state", `${requestId}.pre-shot06-prompt-refresh-${Date.now()}.json`);
const draft = JSON.parse(readFileSync(draftPath, "utf8"));
const review = draft.state.reviews.find((item) => item?.shot?.id === "06");
if (!review?.completePrompt) throw new Error("找不到 Shot 06 已生成的完整提示词");

copyFileSync(draftPath, backupPath);

const replacements = [
  [
    "厚布帘、显像管电视及大型木质电视柜",
    "厚布帘、显像管电视及小型正方形木质电视柜",
  ],
  [
    "本Shot不得出现其身体、面孔、声音或反制动作；床上只呈现无法判断内容物的鼓起被褥，不生成第二个獠。",
    "本Shot不得出现其身体、面孔、对白或反制动作；只允许从鼓起被褥方向传出一次持续、低沉且自然的鼾声。菜摘呼唤后仍完全叫不醒他；床上只呈现无法判断内容物的鼓起被褥，不生成第二个獠。",
  ],
  [
    "大型正方形电视柜贴下墙并足以遮住蹲下的菜摘，柜上是1987年显像管电视",
    "小型正方形电视柜按户型图尺寸贴住下墙，柜上是笨重的1987年显像管电视；菜摘蹲到最低后，由电视柜、显像管电视和墙角阴影共同形成足够遮挡",
  ],
  [
    "肩背小包和中型手提箱继续留在右侧沙发附近，不丢失、不进入动作焦点。",
    "",
  ],
  [
    "菜摘穿过完全拉满布帘的边缘通道进入左区，摄影机不穿透布料，也不改变布帘位置。",
    "菜摘从完全拉满的布帘边缘揀开仅供一人通过的窄缝进入左区；她通过后布帘立即自然回落，继续完全遮挡两区。摄影机不穿透布料，布帘轨道和整体位置不变。",
  ],
  [
    "蹲到贴下墙的大型正方形电视柜后",
    "蹲到贴下墙的小型正方形电视柜与笨重显像管电视后",
  ],
  [
    "菜摘服装、长发、行李、电视柜、床、门、窗、沙发和完全拉满的布帘位置不重置。",
    "菜摘服装、长发、电视柜、床、门、窗、沙发和完全拉满的布帘位置不重置。",
  ],
  [
    "床上只显示鼓起被褥，獠不露面、不回应、不反制；",
    "床上只显示鼓起被褥，獠不露面、不说话、不回应、不反制；只保留被褥方向一次持续低沉鼾声；",
  ],
  [
    "禁止电视柜缩小、消失、移动或无法遮住菜摘",
    "禁止改变户型图中电视柜和显像管电视的尺寸、位置或比例；禁止两者消失、移动或无法共同遮住压低身体的菜摘",
  ],
];

let prompt = review.completePrompt;
for (const [from, to] of replacements) {
  if (!prompt.includes(from)) throw new Error(`提示词缺少待替换片段：${from}`);
  prompt = prompt.replace(from, to);
}

review.completePrompt = prompt;
review.completePromptStatus = "ready";
review.completePromptSummary = "Shot 06完整提示词已刷新：保留原著鼾声和叫不醒的情节，删除行李，并修正穿帘与电视柜遮挡逻辑。";
review.completePromptGeneratedAt = new Date().toISOString();
review.annotations.scene = review.annotations.scene
  .replace("大型正方形电视柜", "户型图中的小型正方形电视柜与笨重显像管电视");
review.annotations.action = review.annotations.action
  .replace("删除重复鼾声", "床铺方向只保留一次持续低沉鼻声，删除重复鼻声");

draft.savedAt = new Date().toISOString();
draft.agentRevision = `shot06-prompt-refresh-${Date.now()}`;
draft.agentPending = true;
writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ draftPath, backupPath, revision: draft.agentRevision, promptLength: prompt.length }, null, 2));
