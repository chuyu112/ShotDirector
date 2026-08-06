# ShotDirector 项目协作说明

## 项目目标

镜导（ShotDirector）是本地优先的 AI 导演工作台，用于把脚本、漫画或视频素材整理为可审核的 Shot，并维护证据、全局设定、资产、导演布局、白模、提示词、生成结果和审批状态之间的关系。

## 技术与入口

- 前端：React 19、TypeScript、Vinext/Vite。
- 本地桥接：`scripts/shotdirector-bridge.mjs`，默认监听 `127.0.0.1:4317`。
- 主页面：`app/page.tsx`。
- 素材分析：`app/media-lab.tsx`。
- 3D 白模：`app/whitebox-stage.tsx`。
- 提示词包：`app/video-package.ts`。
- 产品文档：`docs/镜导-PRD.md`。
- 迁移说明：`docs/镜导-交接手册.md`。

## 常用验证

```bash
npm run dev
npm test
npm run lint
```

## 必须维护的业务约束

- 原文和漫画画格是证据层，导演建议和提示词是创作层；不得互相覆盖。
- 批注、源文件回写、出图和选图都不等于审批；只有独立盖章才批准 Shot。
- 最终视频风格、临时分镜图风格和白模材质必须分层。
- 异步任务必须可恢复，结果必须回到正确项目和 Shot。
- 新的数据模型应使用稳定 UID；显示编号不能继续承担业务主键职责。
- 删除必须基于明确的项目清单和边界，不能使用模糊路径或标题匹配。
- 修改业务代码后至少运行与改动相关的测试；触及主流程时运行 `npm test` 和 `npm run lint`。

## 当前结构性注意事项

- `app/page.tsx` 和 `scripts/shotdirector-bridge.mjs` 体积较大，改动时优先抽离边界清晰的模块，避免继续堆叠状态与路由。
- 浏览器、源 TS 文件和 `work/` 目录仍是分散的数据源；引入 Project Manifest 前不要假设它们具有事务一致性。
- 当前代码尚未完整实现 PRD 中的 `projectUid`、`shotUid`、`displayNumber` 和项目级删除。

