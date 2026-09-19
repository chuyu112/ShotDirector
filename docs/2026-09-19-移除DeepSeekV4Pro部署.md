# 移除 DeepSeek V4 Pro 创作模型部署

按用户要求从创作模型目录中删除 DeepSeek V4 Pro（`deepseek-v4-pro`），保留 DeepSeek V4 Flash（`deepseek-v4-flash`）。本批于 **2026-09-20 01:26（Asia/Shanghai）** 部署生产，地址 [漫镜](https://manjing.kakayiduo.cloud/)，服务器 `43.173.105.8`。

## 代码变更

- 提交：`9a7b258`（`codex/local-codex-gpt6` 分支），已推送 GitHub。
- `server/text-model-catalog.mjs`：删除 `deepseek-v4-pro` 目录条目（创作模型 10 → 9）。
- `app/page.tsx`：`WritingModelId` 联合类型与创作模型下拉列表同步删除；未知 id 走既有 `legacyUnknownModelId` 兜底，历史已存选择不会报错。
- `server/compatible-chat-structured-provider.mjs`：deepseek 兜底默认型号由 `deepseek-v4-pro` 改为 `deepseek-flash`（V4.1 官方名，旧名仅为兼容别名）。
- 测试期望列表同步移除（`tests/server-runtime-smoke`、`tests/text-model-catalog`、`tests/server-auth-ui`、`tests/fixtures/workbench-ui`）；`DEEPSEEK_PRO_MODEL` env 管道保留，Worker 白名单与部署合并行为不变。
- 验证：`npm test` 311/311、`npm run test:server` 116/116、`npm run test:harness` 16/16、lint 0 error（32 项既有警告）。

## 发布版本

- 发布编号：`20260919T172635Z-9a7b258`；镜像 `manjing-server:release-20260919t172635z-9a7b258`。
- 分层构建自上一线上镜像 `release-20260919t153755z-9e38212`（运行依赖未变，锁文件一致）。
- 发布包 416 个文件全部 SHA-256 校验通过（含 dist 117 个）；发布目录不含任何私有 `.env*` 文件。
- staging 首次组装的 `release-files.sha256` 因格式问题（误删 `./` 前缀）校验失败，已重新生成标准 GNU 格式后重传，二次校验 416/416 OK。

## 线上验证

- 三容器 `manjing-*` 使用新镜像重建，状态 Up 无重启循环；数据卷保留。
- 回环：`/healthz` 200（WAL、schema 4），Web 13300 200。
- 容器内确认 `server/text-model-catalog.mjs` 中 `deepseek-v4-pro` 残留为 0。
- 公网 `https://manjing.kakayiduo.cloud/` 200 + HTTP/2 正常。
- `/opt/manjing/current` 已重指新版本；上一版 `20260919T153755Z-9e38212` 保留作回滚，更早版本 `20260919T123751Z-4be03e9` 目录与镜像已清理。

## 发版后冒烟

- `node scripts/smoke-production.mjs` 全绿：scratch 容器（tmpfs 数据，不碰生产）+ 临时账户注册 + Creator 真模型拆镜 2 个（《巷口》）+ Reviewer 隔离金丝雀，镜像 tag 核对一致。

## 备注

- 本次改动不触碰业务逻辑、数据表或审核状态；仅收窄创作模型可选项。
- 若用户后续想重新上架该模型，恢复 catalog 条目 + 前端两行即可，env 管道（`MANJING_DEEPSEEK_PRO_MODEL`）从未拆除。
