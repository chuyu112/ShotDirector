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
- 新的数据模型应使用稳定 UID；显示编号不能继续承担业务主键职责。
- 所有模型任务必须经 Pi Agent Harness 执行。Creator 可以恢复同一稳定 Session；Reviewer 必须使用包含 Run ID 的隔离 Session，禁止恢复 Creator checkpoint 或注册 Creator 工具。
- Harness 必须保留 Session / Run / 追加事件 / stateVersion 检查点语义。事件不得记录 token、cookie、密钥、隐藏推理或 chain-of-thought；旧 Run 不得覆盖更新 Session。
- Agent 修改工程前必须读取真实 ID，保留人工锁定，按“read-state → propose → apply → validate”执行。多步修改必须可撤销；不得通过重建对象绕过锁摘要。
- 产品名统一为“漫镜 Manjing”。旧 `shotdirector-*` 浏览器键、工作目录、脚本文件名、`X-ShotDirector-Token` 与 `SHOTDIRECTOR_*` 环境变量只作为兼容层保留，新代码优先使用 `X-Manjing-Token` 和 `MANJING_*`。
- 漫画主链路固定为“漫画入库 → 拆分编组 → 分镜 → 完整提示词 → 独立 AI Reviewer → 用户确认 → LibTV 生视频”。只有 provider 真正提供联网工具时才能开启联网补证；当前 GLM／Kimi 路由必须关闭该选项，禁止伪造 URL。任何模型审查都不能替代用户确认，确认前不得提交付费视频任务。
- 全能参考的上传顺序以视频包 `referenceBindings` 为唯一权威；提示词中的 `@图片N` 必须随绑定重排，禁止只改数组而留下旧编号。
- LibTV 付费任务一旦报告远端 task id，或提交后网络结果不明确，必须进入 `manual-check-required`，先检查／恢复原画布，禁止自动重提。
- 接入 LibTV 视频节点前必须用 `libtv model search --type video` 和 `libtv model <model>` 读取当前 schema，再决定 `modeType`、参考入边、时长、分辨率与声音参数；不得把网页印象或某个旧模型的字段硬编码成通用规则。`--run` 是同步等待终态命令，必须等待进程退出并读取 stdout JSON。
- 漫画拆镜按当前生成模型的时长上限设计：Seedance 2.0 为 6–15 秒，Seedance 2.5 为 6–30 秒。短促动作或单一反应可用 6 秒；人物、场地与时间连续时可以合并，但不得为凑时长硬合并。多画格 Shot 不平均分配时长；惊讶、回头、抓握等瞬时反应格可作为 0.3–1 秒动作节点。
- Shot 不只是剪辑单位，也是 AI 生成的稳定参考集合边界。当漫画从梦境切现实、外景切室内，或主要人物、服装、场景、光线、时间状态中有一组需要整体更换时，必须优先拆成新 Shot。同一 Shot 尽量只保留一套稳定的人物／服装／场景／灯光参考；只有这些参考都连续时才考虑合并相邻 Shot。
- 时长必须先核算再填写：成片中文对白默认按约 4 汉字/秒、换人加约 0.35 秒、独立构图至少 1–1.5 秒，不能与对白重叠的关键动作另加 0.5–2 秒；超出 15 秒时拆镜或压缩成片对白，不能让角色加速念完。每个 segment 必须用连续秒点覆盖完整 Shot。
- 漫画工作流必须先让用户审核、合并或删除 Shot。生成完整提示词只产生“讨论稿”，绝不自动批准。讨论稿必须交给一个全新、隔离的 Reviewer 任务审查；Reviewer 只返回问题、建议和“可讨论／需修改”结论，不能改写原提示词、不能自动应用修改、不能替用户批准。只有用户本人明确点击签字盖章，才批准并解锁该 Shot。
- Reviewer 使用可扩展注册表：内置 Kimi K3 与 GLM-5.3-Flash；GPT-5.6 不在默认文字链路中。Creator 与 Reviewer 可以使用同一种基础模型，但必须是不同的隔离任务、不同 requestId，不复用生成会话。每次结果必须保存请求模型、实际响应模型、provider 和 usage；人工改稿必须使旧审查过期。
- 顶部“Chat / Work 模型”目录初始顺序固定为 GLM-5.3-Flash、Kimi K3、GPT-5.6 Luna、DeepSeek V4 Flash、Seed 2.1 Pro；按截图要求，用户可在自己的项目界面拖动保存显示顺序。当前只有已配置并验收的 GLM／Kimi 可以选择；GPT-5.6 按当前发布要求保持停用，DeepSeek／Seed 在接口和密钥验收前只能显示明确原因，不得伪装可用。GLM／Kimi 的选择必须真正写入项目私有目录并影响后续 Worker 调用；任务进行中禁止切换，避免同一 Run 混用模型。
- Reviewer 报告必须绑定完整提示词文本、来源版本和 Reviewer ID。提示词、画格组合、时长、批注或 Reviewer 选择发生变化时，旧报告立即过期，并撤销尚未重新确认的批准状态；前端和桥接后端都必须校验版本，不能只靠界面禁用。
- 故事背景、最终美术风格和人物画像是跨 Shot 继承的全局连续层；每个 Shot 上传或生成的人物图、场景图、道具图、生图提示词、全能参考、分镜图和视频数据均按 Shot 独立存储。同名资产不得自动跨 Shot 覆盖或复用。
- 单镜完整提示词必须直接复核该 Shot 的全部裁图，并综合原文对白、逐格理解、逐格批注、单镜批注、项目故事背景与最终成片风格；联网只作作品背景、人物身份、年代地点和前后剧情补充，不得覆盖画格证据。重组画格、改变时长或修改相关批注后，必须撤销该 Shot 的确认并将旧提示词标为过期。
- 漫画裁框必须遵循 Box-to-Box 矩形分格：在原始分辨率上识别黑色画格线与白色分隔带，边界吸附到当前画格一侧的黑线；缺线时取白带内缘。两到三条可靠边即可补矩形，优先完整保留对白文字，允许真实叠格的矩形互相覆盖，忽略不影响叙事的小幅越界细节。界面黄色框是用户手画的标准答案，不属于漫画内容，不得擅自改写或同步回项目数据。
- 完整提示词固定包含五层资料：【故事背景】【时代烙印】【人物画像】【原作剧情依据】【最终美术风格】，再进入【本 Shot 执行】；缺失的项目级背景和风格可从当前漫画全片、相邻话连续性及可靠联网资料自动补全，不能要求用户重复手填已经提供过的上下文。
- 漫画拆镜审核的最小单位是裁出的单个画格图片。系统先逐格识别，再给出默认 Shot 分组；用户通常只检查默认分组，明显错误时才通过整组选中、Shift 连选、重新组合、并入前后组、拆成单格或删除画格进行调整。删除只影响当前成片结构，原漫画文件必须保留并可恢复。
- “新增手绘分镜”属于后续能力：未来允许在画格之间插入画师补画或空白分镜；未实现前只保留明确的禁用入口，不得伪装可用。
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
