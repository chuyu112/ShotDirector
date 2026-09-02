import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workspace = process.cwd();
const requestId = "a7501ea0-9880-47b3-a61a-8ebcadb2f46f";
const draftPath = join(workspace, "work", "shotdirector-draft-state", `${requestId}.json`);
const backupPath = join(workspace, "work", "shotdirector-draft-state", `${requestId}.pre-shot06-simplify-${Date.now()}.json`);
const draft = JSON.parse(readFileSync(draftPath, "utf8"));
const reviews = draft.state.reviews;
const review = reviews.find((item) => item?.shot?.id === "06");
if (!review) throw new Error("找不到 Shot 06");

copyFileSync(draftPath, backupPath);

const panels = [
  "P06-R-G05", "P06-R-G06", "P06-R-G07",
  "P06-L-G01", "P06-L-G02", "P06-L-G03",
  "P07-R-G04", "P07-R-G05", "P07-R-G06", "P07-R-G07", "P07-R-G08", "P07-R-G09",
  "P08-R-G01", "P08-R-G02", "P08-R-G03", "P08-R-G04", "P08-R-G05", "P08-R-G06",
  "P08-L-G01", "P08-L-G02", "P08-L-G04", "P08-L-G05", "P08-L-G06", "P08-L-G07",
];

const dialogue = [
  "亜月菜摘（日语）：冴羽さん……起きて。誰か上がってくる！｜中文备注：冴羽先生……快醒醒，有人上楼了！",
  "BMW男（日语）：ふん、シティーハンターもこの程度か。あっけないな。｜中文备注：哼，城市猎人也不过如此，真是不堪一击。",
  "楼下女住客（画外日语）：銃声よ！ 獠ちゃんの部屋！｜中文备注：是枪声！小獠的房间！",
];

review.shot = {
  ...review.shot,
  id: "06",
  title: "BMW男夜袭獠的卧室",
  timecode: "01:36–02:06",
  duration: 30,
  sourcePanels: panels,
  sourceText: panels.map((id) => `${id} 原作画格，作为动作、人物神态或空间节拍参考；以用户确认的30秒简化剧情为最高优先级。`),
  story: "BMW男驾驶同一辆黑色BMW来到公寓，目的明确：进入卧室杀死冴羽獠。全段在BMW男逼近与菜摘逐步警觉之间持续交叉剪辑。菜摘听见动静后起身呼唤獠却叫不醒；BMW男脚步越来越近，她穿过中间帘，躲到贴下墙的大型正方形电视柜后，从侧缘刚好看见门口。BMW男推门时，菜摘看清他的真面目并强忍惊恐；BMW男举枪连续射击他确信獠所在的床铺，自信感叹杀掉城市猎人太容易。听见楼下住客正上楼，他立即撤离。獠本人本Shot不露面，床上是否有人不在本Shot揭示；不得把BMW男的明确刺杀行为写成误杀。",
  scene: "同一栋1987年新宿旧式公寓的连续空间：楼前窄车道与黑色BMW → 外置楼梯与平台 → Shot 05同一卧室。卧室继续使用最终户型图：左侧床头贴上墙的大床、贴下墙的电视与电视柜、中部偏右完全拉满的帘、右侧贴窗沙发、左下入口门。",
  characters: [
    "BMW男（同一黑色BMW司机、上楼者和持枪者）",
    "亜月菜摘",
    "冴羽獠（仅被菜摘呼唤，本Shot不露面）",
    "楼下女住客（结尾只使用画外声音）",
  ],
  props: [
    "黑色1987年日本右舵BMW",
    "同一把半自动手枪",
    "床头贴上墙的大床与鼓起的被褥",
    "贴下墙的大型正方形电视柜",
    "中间分隔帘",
    "卧室房门与机械门锁",
  ],
  omniReferences: [
    "CHAR-02",
    "CHAR-05",
    "SCENE-02",
    "SCENE-03",
    "PROP-02",
    "PROP-03",
    "Shot 05卧室户型图：/shot-references/shot05-bedroom-floorplan.png（卧室空间硬参考）",
  ],
  composition: "将24张关键画格整合为八个连续构图段，但从第一秒就持续交叉剪辑BMW男与菜摘：BMW驶近／菜摘不安 → BMW停车下车／菜摘侧耳 → BMW上楼／菜摘叫獠 → 脚步逼近／菜摘躲电视柜后 → 推门、菜摘看清真面目 → 三枪射击床铺 → 自信感叹 → 楼下住客上楼、BMW男撤离。切换间隔从约1.5秒逐步压缩至门口段的0.4–0.7秒，制造越来越强的紧张感。删除重复鼾声、重复拍被和重复惊恐近景；删除P08-L-G03的獠反制揭示。",
  camera: "全程采用BMW男与菜摘的平行交叉剪辑，不按场景顺序平铺。0–8秒平均1.3–1.8秒一切；8–16秒平均0.8–1.2秒一切；门把转动至开枪前平均0.4–0.7秒一切。进入卧室后锁定门—床射线和电视柜掩体关系；枪击不跳轴，菜摘的藏身位置与门口观察线始终清楚。禁止慢镜头、长停顿和无意义空镜。",
  action: "BMW男驾驶黑色BMW逼近公寓的同时，菜摘在贴窗沙发上逐渐警觉；两条动作线持续交叉。BMW男停车、持同一把半自动手枪上楼；菜摘听见脚步，起身穿过中间帘呼唤獠，床侧只有鼓起的被褥和鼾声，没有回应。BMW男脚步越来越近，菜摘迅速蹲到贴下墙的大型正方形电视柜后，只从柜体侧缘看到房门。BMW男推门，菜摘看清他的真面目，瞳孔骤紧、压住呼吸不出声。BMW男确认床铺后举枪朝床上被褥中心连续开三枪；菜摘不在射线上。BMW男确信刺杀成功并短促自信感叹，随后听见楼下女住客与多人脚步上楼，笑意骤停，立即撤离。",
  dialogue,
  continuity: [
    "BMW司机、BMW男、上楼刺客和持枪者锁定为同一个人，不得复制角色",
    "使用同一辆黑色1987年日本右舵BMW与同一把半自动手枪",
    "BMW男开车与上楼阶段可用侧影遮挡；推门后必须让菜摘看清其正面五官，并使用CHAR-05保持一致",
    "菜摘承接Shot 05的浅粉色一件式长袖棉质睡裙",
    "菜摘从右侧贴窗沙发起身，穿过中间帘后躲到左区大型正方形电视柜后",
    "BMW男的目标从始至终都是冴羽獠；他主动进入卧室实施刺杀，不得改写为误杀",
    "床上只显示鼓起的被褥，不生成第二个獠，也不显示人体中弹",
    "獠本人本Shot不露面、不说话；床上是否有人及獠的真实位置留待后续揭示",
    "三发子弹全部击中床铺与被褥，菜摘不在射线内且没有受伤",
    "结尾BMW男已撤离；Shot 07从楼下住客上来查看中弹床铺开始",
  ],
  negative: [
    "不把BMW司机和持枪者生成成两个人",
    "不把刺杀改成误伤、误杀、走火或临时起意",
    "不在床上生成清晰可见的獠，不生成两个獠",
    "不提前出现獠从背后反制，不使用P08-L-G03的揭示动作",
    "不让菜摘主动开门、持枪、攻击或中弹",
    "不让电视柜消失、移动或小到无法遮挡蹲下的菜摘",
    "不让枪口对准菜摘，不显示人体中弹、血雾或尸体",
    "只开三枪，不增加扫射、爆炸或第二轮枪击",
    "不重复Shot 07住客进入卧室后的现场反应",
    "不出现现代BMW、现代导航、智能手机、现代门禁或LED设备",
    "无字幕、无中文画面文字、无BGM",
  ],
  segments: [
    {
      label: "0–4.0s",
      beat: "黑色BMW快速驶近公寓；交叉切菜摘在贴窗沙发睁眼，察觉远处引擎声与异常动静。",
      framing: "BMW冬夜外景低机位与菜摘室内近景约1.5秒一次交替，不展示现代车辆或清晰车牌。",
      mustShow: ["同一辆1987黑色右舵BMW", "菜摘开始警觉", "第一秒即交叉剪辑"],
    },
    {
      label: "4.0–8.0s",
      beat: "BMW停车，BMW男下车并持枪进入；交叉切菜摘坐起侧耳，目光转向中间帘和门口方向。",
      framing: "车门、持枪手、鞋步与菜摘呼吸近景快速交替，约1.2–1.5秒一切。",
      mustShow: ["BMW男与司机为同一人", "半自动手枪", "菜摘不安加深"],
    },
    {
      label: "8.0–12.0s",
      beat: "BMW男踏上楼梯；交叉切菜摘穿过中间帘叫獠。床上被褥鼓起，只有鼾声，没有回应。",
      framing: "上楼鞋步、金属栏杆、菜摘焦急近景和床铺方向以0.8–1.2秒节拍交替。",
      mustShow: ["脚步由远变近", "菜摘叫不醒獠", "獠本人不露面"],
    },
    {
      label: "12.0–16.0s",
      beat: "BMW男接近平台，脚步和金属回声骤然变近；菜摘判断来不及叫醒獠，迅速蹲到贴下墙的大型正方形电视柜后。",
      framing: "BMW男上楼与菜摘移动持续交叉，切换压缩至0.6–0.9秒；明确电视柜、入口门和床的位置。",
      mustShow: ["声音越来越近", "菜摘躲电视柜后", "菜摘刚好能观察门口"],
    },
    {
      label: "16.0–19.5s",
      beat: "门外脚步停住，机械门锁转动。BMW男推门进入；菜摘从电视柜侧缘看清他的正面真容，瞳孔骤紧、惊恐但死死压住声音。BMW男只盯住床铺。",
      framing: "门把、菜摘眼睛、门缝、BMW男正脸、床铺以0.4–0.7秒极短切换制造峰值紧张。",
      mustShow: ["菜摘看到BMW男真面目", "BMW男看向床", "菜摘惊恐但未暴露"],
    },
    {
      label: "19.5–22.5s",
      beat: "BMW男抬起半自动手枪，对准床上被褥中心连续开三枪；填充物飞散，床铺受损。",
      framing: "保持门—床射线，枪械侧面和床铺交替，菜摘始终不在射线中。",
      mustShow: ["准确三枪", "床铺中弹", "无人体与血雾"],
    },
    {
      label: "22.5–25.5s",
      beat: "BMW男确信自己完成了对獠的刺杀，短促、自信地感叹城市猎人不堪一击；菜摘在电视柜后压住呼吸。",
      framing: "BMW男侧逆光中近景，背景保留破损床铺。",
      mustShow: ["确信刺杀成功", "破损床铺", "不揭示獠"],
    },
    {
      label: "25.5–30.0s",
      beat: "楼下传来女住客喊声与多人上楼脚步。BMW男笑意骤停，回头确认声音后迅速退出房门；菜摘继续隐藏。",
      framing: "BMW男反应近景 → 门口撤离 → 破损床铺与电视掩体收尾。",
      mustShow: ["楼下画外人声", "BMW男撤离", "菜摘未暴露", "衔接Shot 07"],
    },
  ],
};

review.annotations = {
  characters: "BMW司机、上楼者和持枪者是同一个BMW男；菜摘在场并在推门时看清其真面目；獠本人不露面，床上只显示鼓起被褥。",
  scene: "从楼前黑色BMW、外置楼梯到Shot 05同一卧室持续交叉剪辑；菜摘从贴窗沙发起身，最后藏在贴下墙的大型正方形电视柜后观察门口。",
  story: "BMW男明确来刺杀獠；BMW逼近与菜摘警觉持续交叉 → 菜摘叫不醒獠 → 脚步越来越近、菜摘躲电视柜后 → BMW男推门，菜摘看清真面目 → BMW男向床开三枪并确信得手 → 听见楼下住客上楼后撤离。不是误杀。",
  action: "固定30秒但不拖时长；交叉剪辑从约1.5秒一切逐步加快到0.4–0.7秒一切。删除重复鼾声和反复惊恐近景；不显示獠反制，结尾只拍BMW男撤离。",
  continuity: "同一BMW男、同一半自动手枪、同一卧室户型；BMW男从始至终主动刺杀獠，菜摘不在射线内；Shot 07承接住客上来查看现场。",
  style: "1987年昭和真人35mm都市犯罪电影，无动画、无字幕、无BGM。",
  director: "三句日语压缩为短句，正常语速约6秒；其余时间全部用于越来越快的平行交叉剪辑、脚步逼近、藏身、推门、三枪和撤离。禁止慢镜头与长停顿。",
};

review.approved = false;
delete review.approvedAt;
review.scriptStatus = "draft";
review.artworkStatus = "empty";
review.completePromptStatus = "empty";
review.completePrompt = "";
review.completePromptSummary = "Shot 06已简化为30秒高速交叉剪辑：BMW男主动刺杀獠，菜摘警觉并目睹真面目，BMW男枪击床铺后撤离；待用户检查确认。";
review.completePromptWarnings = [];
delete review.completePromptConfirmedAt;
delete review.completePromptGeneratedAt;
delete review.completePromptSourceRevision;
review.summary = "Shot 06已按用户确认剧情重组为30秒，尚未批准";

function parseTimecode(value) {
  const [minutes, seconds] = value.split(":").map(Number);
  return minutes * 60 + seconds;
}

function formatTimecode(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

for (const item of reviews) {
  if (Number(item.shot.id) <= 6) continue;
  const [startText, endText] = item.shot.timecode.split("–");
  item.shot.timecode = `${formatTimecode(parseTimecode(startText) + 7)}–${formatTimecode(parseTimecode(endText) + 7)}`;
}

const now = new Date().toISOString();
draft.state.currentShot = "06";
draft.state.view = "script";
draft.state.structureStatus = "draft";
draft.state.globalUpdatedAt = now;
draft.savedAt = now;
draft.agentRevision = `shot06-simplify-30s-${Date.now()}`;
draft.agentPending = true;

writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ draftPath, backupPath, agentRevision: draft.agentRevision, panels: panels.length, duration: review.shot.duration }, null, 2));
