# Superadmin 配额放开与部署

用户要求取消超级管理员的每日 AI 模型调用配额限制，并推送 GitHub、部署服务器。本批于 **2026-09-17 20:31（Asia/Shanghai）** 完成部署，生产地址为 [漫镜](https://manjing.kakayiduo.cloud/)，服务器 `43.173.105.8`。

## 代码变更

- 提交：`badb7da`（`codex/local-codex-gpt6` 分支），已推送 GitHub。
- `server/manjing-gateway.mjs`：`dailyLimitsForUser()` 对 superadmin 将 `ai` 与 `globalAi` 设为 `Number.MAX_SAFE_INTEGER`，账户级与全服级配额都不再拦截；用户级与全服级用量计数照常写入，审计不丢。移除 `superadminAi` 配置与 `MANJING_DAILY_SUPERADMIN_AI_REQUESTS` 环境变量。
- `tests/server-gateway.test.mjs`：改为验证 superadmin 在上限压到 20 时连续 18 单位调用仍成功、普通用户仍被 10 单位拦截。
- `docs/漫镜-服务器版部署.md` 配额说明同步更新。
- 验证：`npm run test:server` 116/116 通过；`npm run build:server` 与 `npm run typecheck` 通过。

## 发布版本

- 发布编号：`20260917T122319Z-badb7da`；镜像 `manjing-server:release-20260917t122319z-badb7da`（镜像 ID `d12786c228d1`）。
- 分层构建自上一线上镜像 `release-20260917t072113z-07a1fd2`，仅替换 `dist`、`server/manjing-gateway.mjs`、部署文档等；锁文件未变，`runtimeDependenciesUnchanged: true`。
- 发布包 27,903,980 字节，SHA-256：`38fc1811b43f4f760df4036bcb871a65c1724ac34c97d9da1e62e17a8c44b4fb`；文件清单 403 项，发布前 `release-files.sha256` 全量校验通过，发布包密钥预检通过（不含任何 `.env*` 私有文件）。
- 发布包与解包位于服务器 `/opt/manjing/incoming/`，运行时位于 `/opt/manjing/releases/20260917T122319Z-badb7da`，`/opt/manjing/current` 已重指。

## 线上验证

- `manjing-web` / `manjing-gateway` / `manjing-nginx` 三个容器使用新镜像重建，状态 Up，无重启循环；数据卷 `manjing-data` 保留。
- 回环健康：`http://127.0.0.1:18180/healthz` 返回 `ok:true`、WAL、schema 4；Web `127.0.0.1:13300` 返回 200。
- 公网 `https://manjing.kakayiduo.cloud/` 返回 200，HTTP/2 正常；`/api/healthz` 正常。
- 容器内 `server/manjing-gateway.mjs` 已确认包含新配额逻辑（`MAX_SAFE_INTEGER`）。

## 备注

- 服务器 `.env.server` 中的 `MANJING_DAILY_SUPERADMIN_AI_REQUESTS` 已不被代码读取，属无害遗留，可择机删除。
- 普通用户约束未变：每日 10 个预算单位、全服 200 池；superadmin 用量仍计入全服计数（仅自身不被拦截）。
- 本次未发起任何真实模型调用、付费生成或 LibTV 任务；配额行为变更由本地回归测试覆盖。
