# 漫镜工程约定

漫镜（ShotDirector）是云端多租户的 AI 漫画导演服务：Next.js (vinext) 前端 + Node 网关/Worker + SQLite (drizzle-orm) + Docker 部署，Agent 底座为 Pi Agent Harness。

## 必须遵守

- 包管理用 **npm**（有 package-lock.json），不用 pnpm/yarn/bun。
- 注释、日志和用户可见的工程文档优先使用中文，保留必要技术术语。
- Agent runtime 只用 **Pi（@earendil-works/pi-\*）**，不引入 Claude Agent SDK 等其他 Agent 框架。
- **pi 依赖边界**：`@earendil-works/*` 只允许 import 到 `runner/manjing-pi-harness.mjs`（由 eslint `no-restricted-imports` 强制）。其他模块一律消费 harness 与 `runner/agent-role-contract.mjs` 导出的领域类型，保证 pi 升级时上层零改动。
- **角色能力唯一来源**：Agent 角色（creator/review/memory）的系统策略、会话隔离、历史继承、工具可见性、压缩、持久 Session 全部定义在 `runner/agent-role-contract.mjs`，harness / runtime / store 只读契约，不得散落硬编码 `agentRole === "xxx"` 判断。调整隔离边界只改契约文件。
- 持久化写盘（JSON/JSONL/SQLite 之外的文件写）必须走原子写：临时文件 + rename；会话/检查点写路径用 `runner/manjing-harness-store.mjs` 的串行化封装，不直接 `writeFileSync`。
- **多租户边界**：任何项目数据访问必须显式携带 tenant/project 标识并在授权范围内解析；不得按 cwd、祖先目录或环境变量隐式发现其他租户的项目数据。
- 会话事件、运行记录对外输出前必须经 `eventSafeValue` 一类脱敏（authorization/cookie/token 等键名打码）。
- 改动 Agent 工具、权限、额度或上下文路径时，检查租户隔离、会话恢复与 Creator/Reviewer 隔离的回归。

## 常用命令

```bash
npm run dev            # 站点 + 本地 bridge
npm test               # typecheck + build + 全量 node:test
npm run test:server    # 服务端测试子集
npm run test:harness   # pi harness / 契约测试
npm run typecheck
npm run lint
```

单一变更先跑最小相关测试（如 `node --test tests/agent-role-contract.test.mjs`），再跑 `npm run typecheck` 与 `npm run lint`；涉及 Agent 运行时的改动至少跑 `npm run test:harness`。

## 目录与边界

```text
app/            前端组件与页面逻辑（shot-content-review 等纯函数在这里）
server/         网关、Worker、Provider 适配、调度（shot-work-scheduler 等）
runner/         Agent 运行时：pi 边界（manjing-pi-harness）、角色契约、持久化
scripts/        本地 bridge / 构建与发布脚本
tests/          node:test 测试；与源码同域命名
docs/           架构与发布文档
deploy/         服务器端部署脚本
```

### Agent 分层

```text
runner/agent-role-contract.mjs   角色契约（唯一角色定义来源）
runner/manjing-agent-runtime.mjs 单轮运行编排（系统策略、取消、检查点组装）
runner/manjing-pi-harness.mjs    唯一允许 import pi 的边界（Session/事件/压缩）
runner/manjing-harness-store.mjs 持久化（原子写、版本冲突、50 份历史快照）
```

### 测试纪律

- 行为改动配可执行测试，至少覆盖正常路径和主要边界。
- 安全不变量（review/memory 隔离、人工锁不可静默修改、额度上限）必须有测试强制。
- 提交前检查 `git diff`，不覆盖用户已有改动，不提交无关文件。
