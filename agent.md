# Manjing 项目协作说明

## 项目目标

漫镜（Manjing）是本地优先的 AI 导演工作台，用于把脚本、漫画或视频素材整理为可审核的 Shot，并维护证据、全局设定、资产、导演布局、白模、提示词、生成结果和审批状态之间的关系。

## 技术与入口

- 前端：React 19、TypeScript、Vinext/Vite。
- 本地桥接：`scripts/shotdirector-bridge.mjs`，默认监听 `127.0.0.1:4317`。
- 服务器公开网关：`server/manjing-gateway.mjs`，处理注册、Session、项目选择、CSRF/CORS、持久化额度和 Worker 代理。
- 租户 Worker 池：`server/tenant-worker-pool.mjs`；服务端文字模型：`server/compatible-chat-structured-provider.mjs`（只允许 GLM／Kimi）；OpenAI Responses 仅保留为本地兼容层，GPT 图片为独立且默认额度为 0 的可选能力；LibTV：`server/libtv-worker.mjs`。
- 直接生产部署：`deploy/manjing-web.service`、`deploy/manjing-gateway.service`、`deploy/nginx.manjing.systemd.conf`；可回滚发布入口为 `deploy/apply-release-systemd.sh`。
- 视频拆帧：`scripts/extract_every_second.py`；Alibaba Cloud Linux x86_64 的固定 FFmpeg 安装器为 `deploy/install-ffmpeg-static.sh`。
- Pi AgentSession 核心：`runner/manjing-pi-harness.mjs`。
- Creator / Reviewer 运行时：`runner/manjing-agent-runtime.mjs`。
- 本地 Session / Run / 事件账本：`runner/manjing-harness-store.mjs`，默认写入 `work/manjing-harness/`。
- Agent 工程契约：`app/manjing-agent-contract.mjs`。
- 主页面：`app/page.tsx`。
- 素材分析：`app/media-lab.tsx`。
- 3D 白模：`app/whitebox-stage.tsx`。
- 提示词包：`app/video-package.ts`。
- 产品文档：`docs/镜导-PRD.md`（为兼容旧链接保留历史文件名）。
- 迁移说明：`docs/镜导-交接手册.md`（为兼容旧链接保留历史文件名）。

## 常用验证

```bash
npm run dev
npm run test:harness
npm run test:server
npm test
npm run lint
```

## 必须维护的业务约束

- 原文和漫画画格是证据层，导演建议和提示词是创作层；不得互相覆盖。
- 批注、源文件回写、出图和选图都不等于审批；只有独立盖章才批准 Shot。
- 最终视频风格、临时分镜图风格和白模材质必须分层。
- 异步任务必须可恢复，结果必须回到正确项目和 Shot。
- Reviewer 模型选择是当前 Shot 的本地选择，不是全局写作模型切换。其他 Shot 生成中的全局 busy 不得锁住当前已就绪 Shot 的选择和审核；仅当前审核运行时锁定其模型，独占审核/批注通道占用时阻止重复提交，并显示原因。过期、缺稿、断线或模型不可用须有明确提示，不能只留灰色按钮。
- 保存项目必须有覆盖事件回调、请求与响应读取的超时及失败出口，成功以服务器写入回执为准；刷新账户目录不得延长保存锁。保存完成不得重新应用旧快照覆盖期间到达的 Agent 结果或人工修改。海外 HTTPS 入口启用 HTTP/2，避免多个长生成请求耗尽浏览器 HTTP/1.1 连接而阻塞保存和健康检查。
- 新的数据模型应使用稳定 UID；显示编号不能继续承担业务主键职责。
- 所有模型任务必须经 Pi Agent Harness 执行。Creator 可以恢复同一稳定 Session；Reviewer 必须使用包含 Run ID 的隔离 Session，禁止恢复 Creator checkpoint 或注册 Creator 工具。
- Harness 必须保留 Session / Run / 追加事件 / stateVersion 检查点语义。事件不得记录 token、cookie、密钥、隐藏推理或 chain-of-thought；旧 Run 不得覆盖更新 Session。
- Agent 修改工程前必须读取真实 ID，保留人工锁定，按“read-state → propose → apply → validate”执行。多步修改必须可撤销；不得通过重建对象绕过锁摘要。
- 产品名统一为“漫镜 Manjing”。旧 `shotdirector-*` 浏览器键、工作目录、脚本文件名、`X-ShotDirector-Token` 与 `SHOTDIRECTOR_*` 环境变量只作为兼容层保留，新代码优先使用 `X-Manjing-Token` 和 `MANJING_*`。
- 漫画主链路固定为“漫画入库 → 拆分编组 → 分镜 → 完整提示词 → 独立 AI Reviewer → 用户确认 → LibTV 生视频”。只有 provider 真正提供联网工具时才能开启联网补证；当前 GLM／Kimi 路由必须关闭该选项，禁止伪造 URL。任何模型审查都不能替代用户确认，确认前不得提交付费视频任务。
- 全能参考的上传顺序以视频包 `referenceBindings` 为唯一权威；提示词中的 `@图片N` 必须随绑定重排，禁止只改数组而留下旧编号。
- LibTV 付费任务一旦报告远端 task id，或提交后网络结果不明确，必须进入 `manual-check-required`，先检查／恢复原画布，禁止自动重提。
- 接入 LibTV 视频节点前必须用 `libtv model search --type video` 和 `libtv model <model>` 读取当前 schema，再决定 `modeType`、参考入边、时长、分辨率与声音参数；不得把网页印象或某个旧模型的字段硬编码成通用规则。`--run` 是同步等待终态命令，必须等待进程退出并读取 stdout JSON。
- 漫画默认 Shot 编组恢复为项目初始规则：不是“一格机械等于一镜”；相同地点、时间和摄影机意图下的连续反应格可以合并为一个 Shot 的 `segments`，只有地点、时间、轴线或叙事目的改变时才拆成新 Shot。画格必须按阅读顺序进入 `sourcePanels`，不得漏格；封面、广告、作者后记和空白图可以排除。用户之后仍可手工重新组合或拆分。
- Shot 编组是漫镜业务层规则，必须独立于 GLM、Kimi、GPT、上下文窗口、单次输出 Token 上限、API 批次大小和重试次数。同一组上传图片更换文字模型后，默认 Shot 层次和 `sourcePanels` 归属不应因技术调用方式而改变。模型调用批次、页批次或恢复检查点绝不能成为 Shot 边界，也不能泄漏成显示编号。
- Kimi K3 或其他模型出现输出截断、Token 上限、超时或结构化结果过大时，只能在该 provider 的适配层处理：缩小单次分析批次、按阶段调用、分页返回、保存检查点、续写缺失部分或仅重试失败批次，然后由服务器按稳定源文件 ID 合并。禁止通过增加 Shot 数量、拆散既有 `sourcePanels`、修改阅读顺序或改变所有 provider 共用的业务提示词来规避模型限制。
- 针对 Kimi K3 的能力优化必须局部化：可为 Kimi 单独配置最大输入页数、最大输出、超时、结构化拆段和重试策略；不得让 Kimi 专属限制影响 GLM／GPT 路由。Kimi 若仍不能稳定完成整页分析，可降级为单 Shot 审核或切换已验收的 Creator，但不得静默改变项目 Shot 结构。
- 漫画 Shot 时长受目标生成模型约束：Seedance 2.0 为 6–15 秒，Seedance 2.5 为 6–30 秒。多画格不平均分秒；对白、动作和构图用完整 `segments` 表达。时长判断服务于可执行性，但不得把 provider 的输出长度问题伪装成剧情拆镜理由。
- 新项目默认选择 Seedance 2.5，并以 30 秒作为新建空白 Shot 的默认时长；已保存项目中用户明确选择的模型与时长必须原样保留，不得在迁移时强制覆盖。
- 必须增加跨 provider 回归验收：同一批漫画分别走 GLM、Kimi、GPT 或测试替身时，断言阅读顺序和画格覆盖不变，并验证 Kimi 截断、技术分批和重试不会额外增加 Shot 或打散原有 `sourcePanels`。
- 漫画工作流必须先让用户审核、合并或删除 Shot。生成完整提示词只产生“讨论稿”，绝不自动批准。讨论稿必须交给一个全新、隔离的 Reviewer 任务审查；Reviewer 只返回问题、建议和“可讨论／需修改”结论，不能改写原提示词、不能自动应用修改、不能替用户批准。只有用户本人明确点击签字盖章，才批准并解锁该 Shot。
- Reviewer 使用可扩展注册表：内置 Kimi K3 与 GLM-5.3-Flash；GPT-5.6 不在默认文字链路中。Creator 与 Reviewer 可以使用同一种基础模型，但必须是不同的隔离任务、不同 requestId，不复用生成会话。每次结果必须保存请求模型、实际响应模型、provider 和 usage；人工改稿必须使旧审查过期。
- 顶部“Chat / Work 模型”目录初始顺序固定为 GLM-5.3-Flash、Kimi K3、GPT-5.6 Luna、DeepSeek V4 Flash、Seed 2.1 Pro；按截图要求，用户可在自己的项目界面拖动保存显示顺序。当前只有已配置并验收的 GLM／Kimi 可以选择；GPT-5.6 按当前发布要求保持停用，DeepSeek／Seed 在接口和密钥验收前只能显示明确原因，不得伪装可用。GLM／Kimi 的选择必须真正写入项目私有目录并影响后续 Worker 调用；任务进行中禁止切换，避免同一 Run 混用模型。
- Reviewer 报告必须绑定完整提示词文本、来源版本和 Reviewer ID。提示词、画格组合、时长、批注或 Reviewer 选择发生变化时，旧报告立即过期，并撤销尚未重新确认的批准状态；前端和桥接后端都必须校验版本，不能只靠界面禁用。
- 故事背景、最终美术风格和人物画像是跨 Shot 继承的全局连续层；每个 Shot 上传或生成的人物图、场景图、道具图、生图提示词、全能参考、分镜图和视频数据均按 Shot 独立存储。同名资产不得自动跨 Shot 覆盖或复用。
- 项目与全局文件是两层独立概念。项目保存单话或单个制作任务的漫画素材、Shot、批注、审核和产物；用户级全局文件保存作品共用的世界观、最终美术风格、改编重点及人物／场景／道具参考资产。例如「城市猎人」全局文件可分别加载到「第6话」和「第7话」项目，但不得合并或覆盖各项目的 Shot 与素材。
- 人物设定使用结构化 `characterProfiles`：每个人物独立保存姓名、日文名、人物传、身份关系、外形定妆、服装年代约束、表演边界和露脸限制。档案随用户级全局文件跨项目复用，`characters` 只保留旧项目与无法归入单人的补充规则。Shot 和资产提示词必须同时读取结构化档案与补充规则。
- 项目界面必须显式提供「新建项目／加载项目／保存项目」；全局设定界面必须另外提供「新建全局文件／加载全局文件／保存全局文件」。服务器项目存档未加载完成前禁止浏览器草稿回写，空值不得覆盖已保存全局设定。
- 未来 Chat 与 Work 分工固定：Chat 用于与隔离 Agent 多轮讨论世界观、Shot、提示词和审核意见；Work 用于执行拆图、分镜、生图、审核及 Markdown 等产物生成。Chat 产生的候选稿必须经用户确认才能进入最终稿或触发 Work，Agent 不得在讨论中静默覆盖已批准内容。
- 单镜完整提示词必须直接复核该 Shot 的全部裁图，并综合原文对白、逐格理解、逐格批注、单镜批注、项目故事背景与最终成片风格；联网只作作品背景、人物身份、年代地点和前后剧情补充，不得覆盖画格证据。重组画格、改变时长或修改相关批注后，必须撤销该 Shot 的确认并将旧提示词标为过期。
- 漫画裁框必须遵循 Box-to-Box 矩形分格：在原始分辨率上识别黑色画格线与白色分隔带，边界吸附到当前画格一侧的黑线；缺线时取白带内缘。两到三条可靠边即可补矩形，优先完整保留对白文字，允许真实叠格的矩形互相覆盖，忽略不影响叙事的小幅越界细节。界面黄色框是用户手画的标准答案，不属于漫画内容，不得擅自改写或同步回项目数据。
- 完整提示词固定包含五层资料：【故事背景】【时代烙印】【人物画像】【原作剧情依据】【最终美术风格】，再进入【本 Shot 执行】；缺失的项目级背景和风格可从当前漫画全片、相邻话连续性及可靠联网资料自动补全，不能要求用户重复手填已经提供过的上下文。
- 漫画拆镜审核的最小单位是裁出的单个画格图片。系统先逐格识别，再给出默认 Shot 分组；用户通常只检查默认分组，明显错误时才通过整组选中、Shift 连选、重新组合、并入前后组、拆成单格或删除画格进行调整。删除只影响当前成片结构，原漫画文件必须保留并可恢复。
- “新增手绘分镜”属于后续能力：未来允许在画格之间插入画师补画或空白分镜；未实现前只保留明确的禁用入口，不得伪装可用。
- 画格拖放只调整归属，一律接在目标 Shot 尾部；目标原有画格顺序不变，拖入画格按拖动前顺序作为整体追加。禁止按鼠标落点插到卡片之间，同组内拖动不重排。整列（含标题、空白处）均应接收拖放，组间与末尾提供明确的新建 Shot 落点，支持撤销且不得丢失或重复画格。
- 漫画阅读顺序以原页空间结构为依据：日漫双页先右页后左页，页内先识别行列分区，从上到下、同排从右到左；嵌套小格按所在列连续读完。左到右漫画尊重项目选择。严禁把检测顺序、数组位置或 G01/G02 编号当作阅读顺序，严禁整个列表倒序或镜像翻转图片。界面排列、sourcePanels 与交给 Agent 的图片次序必须一致。
- 「校正阅读顺序」与裁剪、拖放和重新编组是独立操作：只重排现有 Shot 内的画格，不重裁、不交换 ID 对应的图片/框坐标、不改变 Shot 归属、数量、时长、UID 或批注。拖放仍只追加到目标尾部，不能触发自动排序。叠格无法确定唯一顺序时保留原序并提示人工核对；已批准或生成/审核中的 Shot 不得静默修改。受顺序修改影响的旧提示词/审核标记过期，保留文本和产物供复核，不自动重新生成；人工校正可撤销。
- Shot 时长评估必须显示预计内部分镜数、对白有效字数与句数、语言依据和超时提示。没有对白识别数据时明确标为待核对，不能把占位说明当作台词；原文暂估与生成后的日语台词必须区分。估算不等于试读实测，不能截断超限估算或自动改动用户已确定的 Shot 数量与分组。
- 删除必须基于明确的项目清单和边界，不能使用模糊路径或标题匹配。
- 服务器模式下 API Key 只能存在 Gateway/Worker 环境，不得进入 `NEXT_PUBLIC_*`、浏览器响应、任务事件或 Harness 账本。Worker 内部令牌不得返回给浏览器；公开页面只使用 `gateway-managed` 占位语义。
- 用户、项目、浏览器草稿、IndexedDB 图片、素材、结果、Harness 和 LibTV 凭据都必须按 `userId + projectId` 隔离。认证 scope 尚未确定时不得挂载导演台状态逻辑。
- 公开注册不能等于无限调用共享算力。AI、LibTV 付费提交、登录短信和上传必须经持久化每日额度；项目数、单用户 Worker 和全局 Worker 必须有上限与空闲回收。
- 当前独立进程／目录是数据误串防线，不是恶意租户的 OS 安全沙箱。对完全不可信的公众租户上线前，必须增加每租户容器／UID／网络、邮箱验证、entitlement 和总费用熔断。
- 服务器 LibTV 固定为经 SHA-256 校验的 Linux CLI，使用手机号／短信两步无头登录和私有 `LIBTV_CONFIG_DIR`。升级 CLI 时必须重新核对 `login phone --help` 及模型 schema，不得执行未固定的 latest 脚本。
- 服务器视频拆帧脚本必须兼容 Python 3.6 语法，FFmpeg 发行物必须校验 wheel 与二进制两层 SHA-256，并确保 `drawtext` 探针通过。
- 目标机直接发布必须先停 Gateway 并保存 SQLite/运行时/systemd/Nginx 可回滚备份，再替换包和重启。HTTP IP 只允许联调；域名 HTTPS 之前不得引导真实用户使用常用密码。
- 修改业务代码后至少运行与改动相关的测试；触及主流程时运行 `npm test` 和 `npm run lint`。

## 当前结构性注意事项

- `app/page.tsx` 和 `scripts/shotdirector-bridge.mjs` 体积较大，改动时优先抽离边界清晰的模块，避免继续堆叠状态与路由。
- 浏览器、源 TS 文件和 `work/` 目录仍是分散的数据源；引入 Project Manifest 前不要假设它们具有事务一致性。
- 当前已为项目和 Shot 增加稳定 `projectUid`、`shotUid`，并提供 manifest JSON；显示编号仍沿用 `shot.id`，完整 `displayNumber` 数据迁移、项目包 ZIP 与项目级删除仍未完成。
