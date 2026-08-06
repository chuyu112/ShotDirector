# 镜导（ShotDirector）

镜导（ShotDirector）是本地运行的 AI 导演工作台，用于把漫画、脚本或视频素材整理为可审核的分镜，并维护人物、物品、场景、提示词、白模布局和生成结果之间的同步关系。

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

- `docs/镜导-交接手册.md`
- `docs/镜导-PRD.md`
