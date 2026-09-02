import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const requestId = "a7501ea0-9880-47b3-a61a-8ebcadb2f46f";
const draftPath = join(process.cwd(), "work", "shotdirector-draft-state", `${requestId}.json`);
const backupPath = join(process.cwd(), "work", "shotdirector-draft-state", `${requestId}.pre-shot08-correct-${Date.now()}.json`);
const draft = JSON.parse(readFileSync(draftPath, "utf8"));
const review = draft.state.reviews.find((item) => item?.shot?.id === "08");
if (!review) throw new Error("找不到 Shot 08");
copyFileSync(draftPath, backupPath);

const previousDuration = Number(review.shot.duration || 0);
const panels = [
  "P10-L-G01", "P10-L-G02", "P10-L-G03", "P10-L-G04", "P10-L-G05", "P10-L-G06", "P10-L-G07",
  "P11-R-G01", "P11-R-G02", "P11-R-G03", "P11-R-G04", "P11-R-G05", "P11-R-G06",
];
const dialogue = [
  "亜月菜摘（日语）：そこに隠れてたの……。｜中文备注：原来你躲在那里……",
  "冴羽獠（日语）：五人殺して、過信した。｜中文备注：他杀了五个人后变得过度自信。",
  "冴羽獠（日语）：格上には隙を見せる。｜中文备注：面对更高明的对手就会露出破绽。",
  "亜月菜摘（日语）：狙いはあなた？｜中文备注：真正被盯上的是你？",
  "冴羽獠（日语）：そう、俺だ。｜中文备注：对，是我。",
  "亜月菜摘（日语）：なぜ私を！｜中文备注：那为什么把我带来！",
  "冴羽獠（日语）：奴の顔は見たな？｜中文备注：你看清那家伙的脸了吧？",
  "亜月菜摘（日语）：ええ、はっきり。｜中文备注：嗯，看得很清楚。",
  "亜月菜摘（日语）：私を目撃者に？｜中文备注：你还把我当成目击者？",
  "冴羽獠（日语）：五人分、きっちり償わせる。｜中文备注：我要让他偿还五条人命。",
  "冴羽獠（日语）：プロの俺に挑んだ。大間違いだ。｜中文备注：他竟然挑战身为行家的我，这是大错。",
];

const completePrompt = `【故事背景】
《城市猎人》第3话《犯下大错！之卷》，紧接Shot 07。BMW男已经在Shot 06开枪后逃离，三名女住客也已在Shot 07离开卧室；房间内绝对没有袭击者、俘虏或第三人。菜摘刚发现床上中枪的是玩偶，真正的獠藏在床板下。獠解释自己利用BMW男连续杀人后形成的过度自信，引诱对方主动暴露；菜摘由此明白真正的刺杀目标是獠，而自己既是诱饵，也是已经看清袭击者正脸的目击者。獠没有立刻抓人，是为了继续追到幕后并让凶手为五名女性偿命。结尾硬切翌夜新宿街道，案件继续。

【时代烙印】
时间严格锁定昭和62年（1987年）冬季东京新宿。公寓为Shot 05户型图和Shot 06、07连续使用的同一旧式卧室：木质门框、机械门锁、钨丝灯、显像管电视、小型正方形电视柜、中间布帘、窗边沙发和遭三发子弹破坏的床铺。结尾的新宿夜街使用1987年建筑、日文灯箱、钨丝与少量霓虹，不出现现代车辆、巨型LED屏、智能手机、监控、现代门禁或乱码招牌。

【人物画像】
冴羽獠：30岁、186cm，肩宽强壮的真实日本男演员。赤裸上身、穿中蓝色直筒牛仔裤；左掌白色绷带完整，左手不抓握、不承重。右手低位控制柯尔特蟒蛇左轮，枪口始终斜向地板。他开头带着圈套奏效后的轻松自信；说到五名死者和挑战行家时笑意收住，转为冷静、危险但不咆哮的严肃。
亜月菜摘：24岁、167cm，真实日本女演员，自然披散长发，穿浅粉色一件式长袖棉质睡裙。她在Shot 06从电视柜后清楚看见BMW男正脸；本Shot不得改成没有看清。情绪依次为惊讶、理解、愤怒质问、意识到自己被当成目击者、最后沉默消化。她只短促按住獠未受伤一侧的右肩一次，不攻击、不持枪。
人物关系：全程只有獠与菜摘两人。BMW男已经逃离，不得以真人、倒地者、影子、回忆或声音出现。

【原作画格与剧情硬参考】
保持P10-L-G01至P11-R-G06共13格为同一Shot。原画真实内容是：菜摘惊讶獠藏在床板下；獠说明五次杀人令凶手过度自信，面对更高明的对手会露出破绽；菜摘确认真正目标是獠并愤怒追问为什么把自己带来；獠确认她已看清袭击者面孔；菜摘意识到自己也被用作目击者并短促推开獠；獠说明不能轻易结束，必须让凶手偿还五条人命，并指出挑战行家是一个大错；菜摘沉默；最后切翌夜新宿。原画中被菜摘按住的人是冴羽獠，不是袭击者。禁止把任何床上人物、玩偶或獠误识别成“受控袭击者”。

【最终美术风格】
16:9写实日本真人都市犯罪动作电影。真实日本演员、真实皮肤、毛发、汗液、呼吸、肌肉受力、睡裙与牛仔布褶皱、床品破损和枪械重量。采用1980年代日本35mm胶片质感：细密颗粒、克制反差、高光轻微晕染、暗部保留层次。摄影硬朗、轴线清楚、节奏紧凑；菜摘的愤怒保留短促喜剧反差，獠的结尾严肃落在眼神和嘴角。禁止动画、插画、塑料皮肤、现代数字锐化、过度霓虹和无意义手持晃动。

【本Shot执行】
Shot 08《真正目标与行家的挑战》，成片严格15秒，时间码02:36–02:51，生成一个完整视频，不拆分。卧室部分只有獠和菜摘；结尾硬切翌夜1987年新宿街景。床铺三个弹孔、破损被褥和人形玩偶保持Shot 07结束时的位置，不出现任何倒地袭击者。

0.00–1.15秒：P10-L-G01。菜摘胸像近景。她看向獠刚钻出的床板开口，眼睛短暂睁大，肩膀仍紧，低声完整说第1句。
1.15–3.90秒：P10-L-G02至G03。切獠坐在床侧的中近景。右手左轮低位朝地，左掌绷带贴近身体。獠先扫一眼门口确认BMW男已经撤离，再看向菜摘，带一瞬自信笑意连续说第2、3句；两句共保留2.75秒，说到“格上”时笑意略收。
3.90–5.50秒：P10-L-G04至G05。菜摘近景完整问第4句；前句结束后獠才以第5句简短确认。两句共保留1.60秒。菜摘听到答案后眉间收紧，重心移向前脚。
5.50–6.25秒：P10-L-G06至G07。菜摘只向前跨半步，提高声音完整说第6句。她不挥手、不攻击；獠不后退，右手枪口继续朝地。
6.25–8.40秒：P11-R-G01。紧凑双人侧面近景。獠略微靠近、压低音量完整问第7句；前句结束后菜摘直视他，以第8句确认自己在Shot 06已经清楚看见BMW男的正脸。两句共保留2.15秒，不得说“没看见”或“躲着看不见”。
8.40–9.40秒：P11-R-G02。菜摘终于明白自己也是目击者，完整说第9句；她只用右手短促按住獠的右肩或右胸一次，把他推开少许后立即松手。不得碰受伤左掌。獠顺势让出半步，右手枪械仍然低位稳定。
9.40–11.30秒：P11-R-G03。双人中近景。獠确认菜摘松手后看向破损床铺和三个弹孔，语气转冷，完整说第10句。菜摘不插话，肩颈从愤怒转为僵住倾听。
11.30–13.45秒：P11-R-G04。獠面部大特写。眼神稳定、下颌收紧、嘴角保留极淡且危险的自信，以低而清楚的声音完整说第11句。不举枪、不新增开枪。
13.45–14.25秒：P11-R-G05。菜摘无对白近景。她双手在身前交握一次，目光略降后重新看向獠，让担忧和理解停在眼睛里。
14.25–15.00秒：P11-R-G06。硬切翌夜新宿夜街固定外景，轻微向前推进。室内对白已经结束，只保留冬风、远处昭和车辆与城市底噪，明确案件尚未结束。

【成片对白】
只允许以下11个自然日语对白单元；中文仅供制作理解，不朗读、不上字幕、不进入画面：
${dialogue.map((line, index) => `${index + 1}. ${line}`).join("\n")}
台词按紧凑自然语速说出，发声窗口不得短于有效日语字符数除以7；第7、8句为一问一答，可在前句尾音结束后立即接话，但不得抢掉关键词。

【声音】
全程绝对无BGM、无主题曲、无情绪音乐。只保留日语对白、呼吸、睡裙与牛仔布摩擦、床架轻微受力、枪械低位持握的极轻金属声和室内冬夜底噪；没有枪声、袭击者声音或第三人声音。翌夜街景只保留冬风、远处1987年车辆和稀疏行人底噪。无旁白、无字幕。

【跨镜连续性】
BMW男已在Shot 06逃走，Shot 07也没有抓住他；本Shot没有俘虏。菜摘在Shot 06已经清楚看见其正脸，因此回答“ええ、はっきり”。床上仍是中三枪的人形玩偶，真正的獠已经从床板下现身。獠赤裸上身、穿中蓝色直筒牛仔裤；左掌绷带完整，柯尔特蟒蛇只由右手低位控制。结尾跳至翌夜，不能表现BMW男已被捕。

【禁止项】
禁止受控袭击者、倒地袭击者、第三人或CHAR-05出现在卧室；禁止让菜摘说没看清脸；禁止把獠误认成袭击者或让菜摘攻击陌生人；禁止重演枪击、BMW逃跑、五起命案、警方调查、审讯、抓捕、血雾、尸体或新增伤口；禁止袭击者供述；禁止菜摘持枪、受伤、碰獠的左掌或进入枪口射线；禁止獠用左手持枪、抓握、撑床、承重或做手势；禁止枪口指向菜摘；禁止新增武器或改变柯尔特蟒蛇；禁止改变三个弹孔、破损床铺、人形玩偶、服装、绷带和公寓布局；禁止亲吻、露骨接触或色情化镜头；禁止现代车辆、现代门禁、监控、导航、智能手机、LED屏、中文画面文字、字幕、水印、乱码及任何BGM。`;

review.shot = {
  ...review.shot,
  id: "08",
  title: "真正目标与行家的挑战",
  timecode: "02:36–02:51",
  duration: 15,
  sourcePanels: panels,
  sourceText: panels.map((id) => `${id} 原作画格，按菜摘质问獠与獠解释诱敌计划的真实人物关系复核。`),
  story: "BMW男已经逃走，卧室内只有菜摘和獠。菜摘得知真正目标是獠，愤怒追问自己为何被带来；她确认已看清BMW男正脸，并意识到自己同时是诱饵和目击者。獠表示要让凶手偿还五条人命，并以挑战行家是大错作结。",
  scene: "Shot 05户型硬锁的同一枪击后卧室，结尾硬切翌夜1987年新宿街道。",
  characters: ["冴羽獠", "亜月菜摘"],
  props: ["柯尔特蟒蛇左轮", "三个弹孔的破损床铺", "真人大小獠形玩偶", "床板下夹层"],
  omniReferences: ["CHAR-01", "CHAR-02", "SCENE-03", "PROP-01", "SCENE-04", "Shot 05卧室户型图：/shot-references/shot05-bedroom-floorplan.png"],
  composition: "P10-L-G01至P11-R-G06共13格保持一个15秒Shot：发现藏身处 → 解释过度自信 → 确认真正目标 → 菜摘质问 → 确认看清正脸 → 意识到目击者用途 → 五条人命与行家宣言 → 翌夜新宿。",
  camera: "卧室内沿床侧双人轴线完成近景、中近景和獠的大特写；菜摘短促推肩时保持枪口低位；结尾硬切翌夜新宿固定外景。",
  action: "严格15秒。房间内只有獠和菜摘；菜摘只向前半步并短促按推獠右肩一次，獠始终右手低位持枪、左掌不受力。",
  dialogue,
  continuity: [
    "BMW男已逃走，卧室没有受控袭击者或第三人",
    "菜摘在Shot 06已清楚看见BMW男正脸",
    "床上是中三枪的人形玩偶，獠已从床板下现身",
    "獠赤裸上身、中蓝色直筒牛仔裤，左掌绷带完整",
    "柯尔特蟒蛇只由獠右手低位控制",
    "结尾切翌夜新宿，案件尚未结束",
  ],
  negative: [
    "不出现受控袭击者、倒地刺客、第三人或CHAR-05",
    "不让菜摘说没有看清脸",
    "不重演枪击、逃跑、抓捕、审讯或命案回放",
    "不把獠误认成袭击者",
    "不让菜摘持枪、受伤或碰獠的左掌",
    "不让獠用左手抓握、承重、撑床或持枪",
    "不让枪口指向菜摘",
    "不改变床铺弹孔、玩偶、公寓布局、服装和绷带",
    "不出现字幕、中文画面文字、水印、乱码或BGM",
  ],
  segments: [
    { label: "0–1.15s", beat: "菜摘惊讶獠藏在床板下。", framing: "菜摘胸像近景。", mustShow: ["菜摘睡裙", "床板开口", "惊讶不尖叫"] },
    { label: "1.15–3.9s", beat: "獠解释五次杀人令凶手过度自信。", framing: "床侧獠中近景。", mustShow: ["右手低位持枪", "左掌绷带不受力", "轻松转冷静"] },
    { label: "3.9–6.25s", beat: "菜摘确认目标是獠并质问为何带她来。", framing: "反打近景与双人中近景。", mustShow: ["菜摘前进一步", "獠简短确认", "无第三人"] },
    { label: "6.25–9.4s", beat: "菜摘确认看清BMW男正脸，意识到自己是目击者。", framing: "紧凑双人侧面近景。", mustShow: ["正确回答看清正脸", "短促按推右肩", "不碰左掌"] },
    { label: "9.4–13.45s", beat: "獠宣告让凶手偿还五条人命，挑战行家是大错。", framing: "双人中近景转獠面部大特写。", mustShow: ["獠严肃收束", "无举枪", "菜摘安静倾听"] },
    { label: "13.45–15s", beat: "菜摘沉默，硬切翌夜新宿。", framing: "菜摘反应近景转街道外景。", mustShow: ["交握双手", "翌夜新宿", "案件未结束"] },
  ],
};

review.annotations = {
  characters: "卧室内只有獠和菜摘；BMW男已经逃走，不存在受控袭击者。",
  scene: "同一枪击后卧室，结尾硬切翌夜1987年新宿街道。",
  story: "菜摘得知獠才是真正目标，并确认自己既是诱饵也是已经看清BMW男正脸的目击者；獠宣告追究五条人命。",
  action: "15秒；菜摘只前进一步并短促按推獠右肩，獠右手低位持枪、左掌不受力。",
  continuity: "Shot 06 BMW男逃走；Shot 07床上是玩偶、獠从床板下现身；菜摘已经看清BMW男正脸。",
  style: "1987年昭和真人35mm都市犯罪电影，无动画、无字幕、无BGM。",
  director: "前半保持菜摘的愤怒喜剧反差，后半由獠收住笑意完成严肃宣战。",
};
review.completePrompt = completePrompt;
review.completePromptStatus = "ready";
review.completePromptSummary = "Shot 08已纠正：卧室没有袭击者，菜摘已看清BMW男正脸；15秒完成质问、目击者确认与行家宣言。";
review.completePromptGeneratedAt = new Date().toISOString();
review.approved = true;
review.approvedAt ||= new Date().toISOString();
review.summary = "Shot 08完整提示词已按Shot 06–07连续性刷新";

for (const id of panels) {
  const item = draft.state.sourceMangaPanels?.[id];
  if (!item) continue;
  item.characters = id === "P11-R-G06" ? [] : ["冴羽獠", "亜月菜摘"];
  item.relationAndPlot = "BMW男已经逃走，卧室内只有獠和菜摘。菜摘质问诱敌计划并确认自己已看清BMW男正脸；獠说明要让凶手偿还五条人命。";
}

function parseTimecode(value) {
  const [minutes, seconds] = value.split(":").map(Number);
  return minutes * 60 + seconds;
}
function formatTimecode(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
const durationDelta = 15 - previousDuration;
for (const item of draft.state.reviews) {
  if (Number(item.shot.id) <= 8 || durationDelta === 0) continue;
  const [startText, endText] = item.shot.timecode.split("–");
  item.shot.timecode = `${formatTimecode(parseTimecode(startText) + durationDelta)}–${formatTimecode(parseTimecode(endText) + durationDelta)}`;
}

draft.state.currentShot = draft.state.reviews.findIndex((item) => item?.shot?.id === "08");
draft.state.view = "script";
draft.savedAt = new Date().toISOString();
draft.agentRevision = `shot08-correct-continuity-${Date.now()}`;
draft.agentPending = true;
writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ draftPath, backupPath, revision: draft.agentRevision, duration: review.shot.duration, panels: panels.length }, null, 2));
