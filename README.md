# 漫镜（Manjing）

漫镜（Manjing）是本地运行的 AI 导演工作台，用于把漫画、脚本或视频素材整理为可审核的分镜，并维护人物、物品、场景、提示词、白模布局和生成结果之间的同步关系。

项目同时提供可部署的服务器版：支持用户注册、项目隔离、服务端写作模型 API、Linux LibTV CLI，以及同一套桌面／手机响应式页面。部署与安全边界见 [漫镜服务器版部署](docs/漫镜-服务器版部署.md)。

## Pi Agent Harness 架构

文字生成、漫画分析、完整提示词与独立 Reviewer 统一进入 `@earendil-works/pi-coding-agent` 的 `AgentSession`。Pi Harness 负责 Session / Run、检查点恢复、取消、队列、compaction、工具隔离和脱敏事件；服务器只根据部署 env 中的 URL、Key 和模型 ID 建立推理边界，不在业务代码里替用户补齐未配置的模型。

- 创作 Agent 可按稳定 Session 恢复上下文；Reviewer 使用独立的 per-Run Session，不继承创作历史或工具。
- 本地账本位于 `work/manjing-harness/`，包含 Run 状态、Session 检查点和 JSONL 事件；Session 使用原子替换并保留最多 50 份历史快照。
- 桥接健康接口会返回 Harness 版本和最近 Run；工作台顶部会显示 Pi Agent Harness 连接状态。
- 顶部“Chat / Work 模型”菜单展示 GLM-5.3-Flash、Kimi K3、GPT-5.6 Luna、DeepSeek V4 Flash、Seed 2.1 Pro、GLM 5.3、GPT-5.6 Sol 和 DeepSeek V4 Pro。只有 env 的 URL、Key、模型 ID 三项完整时才可选择；未配置项继续显示但不可调用。
- 工作台分为“创作台”和“严格审核台”。创作台负责拆图、分析、重组和提示词；严格审核台只读原图和提示词，只返回问题与建议，不渲染改写、应用或批准控件。
- 原有漫画拆分、漫画分析、画格重组、白模、站位调度、提示词生成、Reviewer、资产图和 LibTV 视频包功能继续沿用；真实服务密钥只注入服务器 env，不进入仓库或浏览器。

参考 Kunpeng Director 的优点，项目 manifest 现在同时导出 Agent 操作契约：Agent 必须先读取真实稳定 ID，保留人工锁定，按“读取 → 提案 → 应用 → 验证”工作。锁定保护、状态验证和 50 份原子历史快照都有代码与测试覆盖。详细设计见 [Pi Agent Harness 架构](docs/漫镜-Pi-Agent-Harness-架构.md)。

当前仓库是空白净版：不包含历史漫画、既有项目草稿、生成图片、白模缓存、任务响应或浏览器本地数据。程序默认值是通用空白项目；工作规范位于 `config/`，故事背景、世界观和最终美术风格作为可替换模板保存在 `project-data/`，不会自动污染新漫画。

## 本地启动

环境要求：Node.js 22.13 或更高版本。

```powershell
npm install
npm run dev
```

- 工作台：`http://localhost:3000/`
- 本地桥接服务：`http://127.0.0.1:4317/`

## 验证

```powershell
npm test
```

该命令会先构建前端，再运行结构、桥接与工作流测试。

服务器专项回归：

```bash
npm run test:server
```

## 漫画生产主链路

当前工作台按“漫画入库 → 拆分编组 → 分镜 → 完整提示词 → 独立 AI Reviewer → 用户确认 → LibTV 视频包”展示真实阶段。项目和镜头分别使用稳定的 `projectUid`、`shotUid`；可编辑的 Shot 编号不再是唯一身份依据。服务器 API 模型路由没有联网搜索工具，所以不会伪装成已搜索或保存模型编造的来源。

“资产同步”里的全能参考会编译成唯一传图顺序（`@图片一`、`@图片二`……），并写入视频生成包。顶部“导出清单”会导出项目 manifest，供后续项目包、任务恢复和 LibTV CLI 生视频复用。当前 LibTV 已接入分镜图／资产图；视频提交仍处于“生成包就绪”阶段，不会自动付费。

桥接服务对带 `--run` 的付费生成采用保守失败语义：一旦识别到远端 task id，或提交后网络状态不明确，会要求先检查原画布，禁止自动重提。

## 独立 Reviewer

完整提示词只是讨论稿，必须先由一个独立 Reviewer 任务审查，再由用户明确批准。Reviewer 只返回报告，不改写原提示词、不自动应用修改、不能替用户批准。内置 Reviewer 为 Kimi K3、Seed 2.1 Pro、GLM 5.3、GPT-5.6 Sol 和 DeepSeek V4 Pro；审查每次使用全新的隔离 Run，即使与 Creator 使用同一基础模型，也不会复用 Creator 会话。支持图片的 Reviewer 直接看画格，不支持图片的 Reviewer 只能审核服务端整理的结构化画格证据，不能声称看过像素。Creator 和 Reviewer 的实际 provider、请求模型与响应模型都会写入结果血缘。

Creator 与 Reviewer 共用 `.env.server.example` 中列出的服务端变量，变量名与翠易的 runner env 保持一致。选择值写公开模型 ID，例如：

```bash
export MANJING_AI_PROVIDER="kimi-k3"
# KIMI_API_URL / KIMI_API_KEY / KIMI_MODEL 等值仅从服务器 env 注入。
```

其他 Reviewer 可通过 `MANJING_REVIEWERS_JSON` 注册。每个条目支持 `kind: "codex"` 或 `kind: "openai-compatible"`；后者使用 `id`、`label`、`model`、`baseUrl` 和 `apiKeyEnv`，密钥只从 `apiKeyEnv` 指向的环境变量读取。

## 数据边界

- 源代码：`app/`、`scripts/`、`worker/`、`tests/`
- 产品与交接文档：`docs/`
- 项目级规范：`app/global-settings.ts`
- 通用工作规范：`config/workflow-rules.json`
- 可替换项目模板：`project-data/templates/`
- 浏览器草稿：浏览器本地存储和 IndexedDB
- 运行结果：`work/`、`outputs/`、`review-output/`、`video-review/`

迁移净包不包含 `node_modules`、构建缓存、运行结果或用户素材。新电脑解压后执行 `npm install` 即可恢复依赖。

详细说明见：

- `docs/镜导-交接手册.md`（历史文件名，内容已更新为漫镜）
- `docs/镜导-PRD.md`（历史文件名，内容已更新为漫镜）
- `docs/漫镜-Pi-Agent-Harness-架构.md`
- `docs/漫镜-服务器版部署.md`
