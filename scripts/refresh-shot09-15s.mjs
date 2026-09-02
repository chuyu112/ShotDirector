import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const requestId = "a7501ea0-9880-47b3-a61a-8ebcadb2f46f";
const draftPath = join(process.cwd(), "work", "shotdirector-draft-state", `${requestId}.json`);
const backupPath = join(process.cwd(), "work", "shotdirector-draft-state", `${requestId}.pre-shot09-15s-${Date.now()}.json`);
const draft = JSON.parse(readFileSync(draftPath, "utf8"));
const review = draft.state.reviews.find((item) => item?.shot?.id === "09");
if (!review) throw new Error("找不到 Shot 09");
copyFileSync(draftPath, backupPath);

const dialogue = [
  "街头揽客者（日语）：兄さん、美人いるよ！｜中文备注：小哥，有漂亮姑娘哦！",
  "亜月菜摘（日语）：狙われたら、生きて帰れないって？｜中文备注：不是说被他盯上就活着回不来吗？",
  "冴羽獠（日语）：俺には朝飯前さ。｜中文备注：对我来说不过是小菜一碟。",
  "BMW男（日语）：兄さん、これ！ 新規開店、よろしく！｜中文备注：小哥，给你这个！新开张，请多关照！",
  "冴羽獠（日语）：ふん……。｜中文备注：哼……",
  "冴羽獠（日语）：こ、これは……。｜中文备注：这、这是……",
  "冴羽獠（日语）：狙われた者は、誰も生きて帰れない――。｜中文备注：被他盯上的人，没有一个能活着回来——",
];

let completePrompt = review.completePrompt || "";
completePrompt = completePrompt
  .replace("陌生街头派单者借普通开业传单的方式", "BMW男本人伪装成普通街头派单者，借开业传单的方式")
  .replace(
    /街头派单者：普通歌舞伎町揽客者，冬季外套和帽子符合1987年；唯一主动作是把纸张塞递给獠，随后被行人遮没。不得拍清其可供识别的正脸，不得暗示或确认其为BMW男子、幕后老板或威胁纸条作者。/,
    "BMW男（CHAR-05）：与Shot 01和Shot 06完全相同的BMW男子、同一真实日本男演员、相同五官与体型。本Shot换穿符合1987年的深色冬季长外套和帽子，伪装成歌舞伎町派单者。他唯一主动作是亲手把夹有威胁纸条的开业传单塞给獠，随后立即转身混入人群。帽檐可在递纸瞬间遮住部分上脸，但下半张脸、体型和CHAR-05连续性必须让观众确认是BMW男。獠此前没有看清过BMW男，菜摘走在前方且没有回头看递纸过程，因此两人当场都没有拦住他。"
  )
  .replace("只形成拥挤遮挡与无法辨认投递者的结果", "只形成拥挤遮挡，让BMW男在递纸后迅速消失的结果")
  .replace("不得暗示或确认其为BMW男子、幕后老板或威胁纸条作者", "递纸者必须明确为BMW男本人和威胁纸条送达者")
  .replace("把署有“CITY HUNTER”的陪葬威胁递给獠", "把末尾以“CITY HUNTER”点名收件人的陪葬威胁递给獠")
  .replace("日文威胁和拉丁字母署名", "日文威胁和拉丁字母收件人称呼")
  .replace("禁止把“CITY HUNTER”署名解释为獠本人书写", "禁止把纸条末尾“CITY HUNTER”解释为署名或獠本人书写；它是在点名威胁收件人")
  .replace("本Shot不出现BMW、司机、刺客或枪械", "本Shot不出现BMW车辆或枪械；BMW男本人以伪装派单者身份出现")
  .replace("投递者身份始终未知", "递纸者就是BMW男本人，身份对观众明确；獠和菜摘当场未能拦住")
  .replace("禁止揭示或追上派单者", "禁止让獠追上BMW男")
  .replace("禁止把派单者生成成BMW男子或复制角色", "禁止把BMW男替换成普通派单者或复制角色")
  .replace(/Shot 09，成片总时长严格(?:9|15)秒，单一完整视频；/, "Shot 09，成片总时长严格15秒，时间码02:51–03:06，单一完整视频；")
  .replace(/总时长按对白链与完整视觉动作链的较长者控制在(?:9|15)秒。/, "总时长按对白链与完整视觉动作链的较长者控制在15秒。")
  .replace(
    /主动作链与摄影机调度：[\s\S]*?成片对白严格只有以下7句，全部为自然日语；中文释义仅供导演核对，不朗读、不上字幕、不进入画面。各句按约7个日语有效字符\/秒执行，动作与运镜同步：/,
    `主动作链与摄影机调度：
0.00–1.40秒｜P11-L-G01：24–28mm广角街道建立镜头，略低于人眼高度缓慢前移。竖式招牌夹出纵深，冬装人流错落穿行；獠与菜摘从中景进入。街头揽客者在侧后方完整说第1句，保持真实空间距离。
1.40–4.75秒｜P11-L-G02：切85mm侧面压缩近景。菜摘先看向同行的獠，在行走中完整说第2句；前句结束后獠才稍偏头，以轻松无赖的笑完整说第3句。两句共保留3.35秒，步伐连续、不停下摆姿势。
4.75–7.20秒｜P11-L-G03：切35mm高位俯拍。伪装成派单者的BMW男本人从獠右前方伸来纸张并完整说第4句；獠先看见递来的纸，再用右手顺势接住。左掌绷带贴近腹侧且完全不受力。菜摘已走在前方，没有回头看见BMW男。BMW男完成递纸后立即转身，被横穿行人遮住；同一CHAR-05的下半张脸、体型和动作连续性必须让观众确认其身份，但獠此时只把他当成普通派单者。
7.20–7.55秒｜P11-L-G04：50mm正面中近景。獠仍向前迈半步，右手把纸抬到胸前，轻松嘴角收住并短促说第5句。
7.55–8.30秒｜P11-L-G05：獠反应特写。文字含义击中他，视线瞬间凝住、眉间收紧、呼吸停半拍，完整说第6句；不做漫画式夸张。
8.30–9.40秒｜P12-R-G01：85mm纸条插入特写。右手拇指与食指夹住纸角，纸面威胁日文和末尾“CITY HUNTER”清晰准确；“CITY HUNTER”是被威胁的收件人称呼，不是敌方署名，也不是獠亲笔书写。纸张受街风轻颤，纸条内容不被朗读。
9.40–10.10秒｜P12-R-G02：獠脸部紧特写，额角出现冷汗。职业警觉完全接管表情，眼神从纸面快速转向人群。
10.10–10.80秒｜P12-R-G03：越肩近景。獠视线先扫向来路，头与右肩随后转动；右手仍把纸控制在胸前，左手不参与。摄影机顺势小幅横摇。
10.80–12.40秒｜P12-R-G04：切纵向长焦人流远景。獠在画面中央回身搜寻，行人自然穿越并反复遮挡视线；BMW男已经混入人群，无法再次锁定，不揭示其具体去向。
12.40–15.00秒｜P12-R-G05：菜摘担忧的侧脸占据巨大前景，獠在后方停住、右手握纸，压低声音完整说第7句。菜摘听完才把目光转向他，肩颈微收。最后保留约0.15秒关系停顿，让獠的轻松彻底消失。

成片对白严格只有以下7句，全部为自然日语；中文释义仅供导演核对，不朗读、不上字幕、不进入画面。各句按约7个日语有效字符/秒执行，动作与运镜同步：`
  )
  .replace(/街头揽客者（日语，[^）]+）/, "街头揽客者（日语，0.00–1.40秒）")
  .replace(/亜月菜摘（日语，[^）]+）/, "亜月菜摘（日语，1.40–3.55秒）")
  .replace(/冴羽獠（日语，3\.15–4\.15秒）/, "冴羽獠（日语，3.55–4.75秒）")
  .replace(/街头派单者（日语，[^）]+）/, "BMW男（日语，4.75–7.20秒）")
  .replace(/BMW男（日语，[^）]+）/, "BMW男（日语，4.75–7.20秒）")
  .replace(/冴羽獠（日语，6\.01–6\.30秒）/, "冴羽獠（日语，7.20–7.55秒）")
  .replace(/冴羽獠（日语，6\.30–6\.87秒）/, "冴羽獠（日语，7.55–8.30秒）")
  .replace(/冴羽獠（日语，6\.87–9\.00秒，压低声音）/, "冴羽獠（日语，12.40–15.00秒，压低声音）");

review.shot = {
  ...review.shot,
  title: "歌舞伎町的陪葬威胁",
  timecode: "02:51–03:06",
  duration: 15,
  story: "翌夜，獠与菜摘穿行1987年歌舞伎町。BMW男本人伪装成派单者，亲手把夹在开业传单中的威胁纸条递给獠后隐入人群；獠读到以CITY HUNTER点名自己的陪葬威胁，立即回身搜寻，却已找不到BMW男。",
  scene: "昭和62年冬夜的新宿歌舞伎町街道。",
  characters: ["冴羽獠", "亜月菜摘", "BMW男（CHAR-05，伪装成派单者）", "行人群"],
  props: ["PROP-04威胁纸条", "1987年纸质开业传单"],
  action: "严格15秒：同行对话 → BMW男本人伪装派单并亲手递纸 → 獠右手接传单 → 阅读威胁 → 神情骤变 → 回身搜索BMW男 → 菜摘察觉异常。CITY HUNTER是纸条点名的威胁对象，不是署名。",
  dialogue,
  segments: [
    { label: "0–1.4s", beat: "歌舞伎町建立，侧后方揽客声响起。", framing: "24–28mm街道广角。", mustShow: ["1987年歌舞伎町", "错落人流", "獠与菜摘同行"] },
    { label: "1.4–4.75s", beat: "菜摘质疑，獠轻松回应。", framing: "85mm同行侧面近景。", mustShow: ["先菜摘后獠", "不抢词", "行走连续"] },
    { label: "4.75–7.2s", beat: "BMW男本人伪装成派单者，亲手递纸后被人群遮没。", framing: "35mm高位俯拍。", mustShow: ["CHAR-05身份连续", "纸张从BMW男手中进入", "獠右手接纸", "菜摘未回头", "左掌不受力"] },
    { label: "7.2–8.3s", beat: "獠阅读并骤然警觉。", framing: "正面中近景转反应特写。", mustShow: ["轻松笑意消失", "真实瞳孔聚焦", "无夸张表情"] },
    { label: "8.3–9.4s", beat: "威胁纸条清楚出现。", framing: "85mm纸条插入特写。", mustShow: ["日文威胁", "CITY HUNTER为收件人称呼", "右手持纸"] },
    { label: "9.4–12.4s", beat: "獠回身在人群中搜寻BMW男。", framing: "脸部特写、越肩和长焦人流远景。", mustShow: ["BMW男已混入人群", "人群自然遮挡", "左手不参与"] },
    { label: "12.4–15s", beat: "獠低声重复警告，菜摘察觉危险。", framing: "菜摘前景、獠后景关系构图。", mustShow: ["完整最后一句", "菜摘听完才转眼", "结尾短暂停顿"] },
  ],
};

review.annotations = {
  ...review.annotations,
  story: "翌夜歌舞伎町，BMW男本人伪装成派单者，亲手把威胁纸条递给獠后隐入人群；獠读完后回身搜索BMW男。",
  action: "15秒紧凑完成同行对白、递纸、读纸、回身搜索和菜摘反应。",
  continuity: "递纸者明确是同一CHAR-05 BMW男本人；菜摘走在前方未看见递纸过程；獠左掌绷带不受力，只用右手接纸；CITY HUNTER是被点名的威胁对象。",
};
review.completePrompt = completePrompt;
review.completePromptStatus = "ready";
review.completePromptSummary = "Shot 09已调整为15秒：完整保留7句日语、递纸阅读和回身搜索；CITY HUNTER明确为威胁对象而非署名。";
review.completePromptGeneratedAt = new Date().toISOString();
review.approved = true;
review.approvedAt ||= new Date().toISOString();
review.summary = "Shot 09完整提示词已调整为15秒";

draft.state.currentShot = draft.state.reviews.findIndex((item) => item?.shot?.id === "09");
draft.state.view = "script";
draft.savedAt = new Date().toISOString();
draft.agentRevision = `shot09-15s-${Date.now()}`;
draft.agentPending = true;
writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ draftPath, backupPath, revision: draft.agentRevision, duration: review.shot.duration, dialogue: dialogue.length }, null, 2));
