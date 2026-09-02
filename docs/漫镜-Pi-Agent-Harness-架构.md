# 漫镜 Pi Agent Harness 架构

## 目标

漫镜把原有漫画导演工作台升级为 Pi Agent Harness，而不是把业务重写成一个通用聊天产品。漫画原图与画格仍是证据层；漫画拆分、分析、白模、站位调度、完整提示词、独立 Reviewer 和 LibTV 视频包继续是同一条生产链。

## 分层

```text
React 漫画导演工作台
  ├─ 漫画入库 / 拆格 / 编组 / 批注
  ├─ 白模 / 人物站位 / 摄影机
  └─ 提示词 / Reviewer / 用户批准
                │
                ▼
本地桥接（旧 URL 与存储键保持兼容）
                │
                ▼
漫镜 Pi Agent Harness
  ├─ Session：同一创作上下文，可恢复 checkpoint
  ├─ Run：每次模型或工具执行的持久状态
  ├─ Role：creator / review / memory 隔离
  ├─ Queue：steer / follow-up
  ├─ Events：追加式、脱敏 JSONL
  └─ Compaction：由 Pi AgentSession 管理
                │
                ▼
可替换模型边界（本地 Codex / OpenAI-compatible）
```

## 从翠易内部导演台资产库移植的部分

- `AgentSession`、`SessionManager`、`SettingsManager` 与禁用隐式 Skills / 扩展的资源加载边界。
- 创作 Session 恢复、Reviewer per-Run 隔离、checkpoint、compaction 恢复。
- Pi turn / message / tool / queue / compaction 事件标准化和敏感字段脱敏。
- 运行取消、模型失败传播、tool loop 与 provider 可替换边界。

没有移植员工账号、权限、公司知识库、OSS、生产 Runner token、部署脚本、密钥或翠易资产数据。

## 本地持久化

`work/manjing-harness/` 下保存：

- `sessions/*.json`：Pi Session 当前 checkpoint；
- `runs/*.json`：每次 Run 的 running / completed / failed / aborted 状态；
- `events.jsonl`：完整追加式事件；
- `history/*.json`：更新 Session 前的原子快照，每个 Session 最多 50 份。

写入采用同目录临时文件后 `rename` 的原子替换。检查点使用 `stateVersion` 乐观并发校验，旧 Run 不能覆盖更新的 Session。

## Creator 与 Reviewer 隔离

- Creator 的 Session ID 使用稳定 conversation ID，可恢复之前的 user / assistant 消息。
- Review 的 Session ID 包含本次 Run ID；即使选择相同模型，也不会恢复 Creator checkpoint。
- Review 不注册 Creator 工具，只能输出问题、证据和建议，不能改稿或批准。
- 用户批准仍是独立业务动作；Harness、Reviewer 和模型均无权代替。

## 参考 Kunpeng Director 的设计优点

参考的是公开 MIT 项目 [Kunpeng Director](https://github.com/pengfeiqiao/kunpeng-director) 在 commit `1c629c9` 展示的工程理念：

1. Agent 操作前先读取真实工程状态和稳定 ID；
2. 人工锁定不能被 Agent 静默覆盖；
3. 多步编辑完成后必须验证；
4. 状态修改可撤销，并以原子快照保存；
5. Agent 与用户操作同一份结构化工程，而不是交换一次性描述。

漫镜没有直接替换现有白模实现，而是把这些原则落在 `app/manjing-agent-contract.mjs`、项目 manifest 与 Harness store 中，避免破坏原有漫画工作流。

## 兼容策略

- 产品可见名称统一为“漫镜 Manjing”。
- 新前端使用 `X-Manjing-Token`；桥接仍接受旧 `X-ShotDirector-Token`。
- 新环境变量使用 `MANJING_*`；桥接仍读取旧 `SHOTDIRECTOR_*` 作为回退。
- 浏览器旧 storage key、旧 `work/shotdirector-*` 数据目录、旧脚本文件名与文档文件名暂时保留，避免用户现有草稿和生成结果失联。
- LibTV 优先使用“漫镜 Manjing”工作区；已有桥接绑定或旧“镜导 ShotDirector”工作区仍可恢复。

