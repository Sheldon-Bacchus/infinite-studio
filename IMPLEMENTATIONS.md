# Infinite 项目清单（历史记录）

> 当前仓库仅保留 studio/。下文为此前整合来源记录，其中 canvas/ 及其 MCP 已移除，相关路径不再有效。独立私人画布仓库未修改。

本仓库只包含两个项目：无限片场 `studio/` 与无限画布 `canvas/`。MCP 和插件作为所属项目中的普通子目录保存，不是第三个项目，也不是单独仓库。

GitHub 目标仓库：[`Sheldon-Bacchus/infinite-studio`](https://github.com/Sheldon-Bacchus/infinite-studio)。

## 目录与来源

| 项目目录 | 内容 | 来源提交 | 许可证 |
| --- | --- | --- | --- |
| [`studio/`](studio/README.md) | Infinite Studio：无限虾工作流、API、前端、本地工作区；Studio Canvas Agent 插件位于 `studio/canvas-agent/` | Studio 本地分支 `cdaf419` 及后续工作，并合入 GitHub `main` 的 RunningHub / ComfyUI Bridge 更新 | 以 `studio/LICENSE` 和各文件声明为准 |
| [`canvas/`](canvas/README.md) | Infinite Canvas 完整源码、文档、素材组/H3 功能、localForage 存储及已提交的导演台静态资源；社区 MCP 位于 [`canvas/mcp/`](canvas/mcp/) | `tigerowo/infinite-canvas`，`81aa89030c5c6a839a58723262750be11e0e80d1`；MCP 来源 `Sheldon-Bacchus/infinite-canvas-mcp`，`e225a282466e9eb55ebcb14ebf4ea59c25a94bbb` | Canvas 保留上游 `LICENSE` 与第三方资源声明；MCP 保留 `canvas/mcp/LICENSE` |
| [`studio/docs/conversations/project-consolidation.md`](studio/docs/conversations/project-consolidation.md) | 相关 Codex 对话的脱敏项目纪要和历史交接状态 | 当前整合任务及列出的历史对话 ID | 本仓库文档 |

两个项目各自保留 package、构建入口、插件与版权文件。MCP 和插件放在对应项目目录内；各自的依赖、启动方式和许可证仍按所属目录说明，不表示它们已统一成一个运行时。

## 内容分类

### 已收录的源码与资料

- 无限画布的素材组连接与 H3 时长设置代码、项目文档和路线资料，见 `canvas/`。
- 画布 localForage/工作区存储代码；Infinite Studio 的本地项目、媒体持久化和虾料相关实现与说明。
- Canvas Agent、Codex 插件和社区 MCP 源码及工具文档，分别收在 Studio 与 Canvas 项目目录。
- Infinite Canvas H3 界面草图：[`canvas/docs/reference/infinite-canvas-h3-ui-sketch.svg`](canvas/docs/reference/infinite-canvas-h3-ui-sketch.svg)。
- `canvas/web/public/director/` 下由来源仓库跟踪的导演台静态构建文件。此项是仓库已有的静态产物，不代表本次重新构建；本次没有生成新的 Windows 安装包。
- 历史 Codex 对话的项目决策摘要；未复制完整聊天转储、个人创作原文或本机路径、Token、数据库和媒体文件。

### 旧验证记录

[`studio/docs/progress/pending-test.md`](studio/docs/progress/pending-test.md) 保留原项目的测试/构建记录和人工验收清单。记录里的自动化测试通过数字只表示当时记录的范围与代码状态；本次没有重跑，不能视为当前整合树已通过。

### 仍需验收

- 本地 Codex Agent 手动连接与 Token 保存、刷新恢复和断开行为。
- 画布素材组到视频/AutoDL 配置的实际拖放与输入槽数量校验。
- 无限虾项目流程的浏览器端验收、跨页面刷新与本地媒体/项目持久化验收。
- 多画布 MCP 目标锁定、工具列表刷新、ZIP 导入及断线恢复。
- 根应用的 RunningHub / ComfyUI Bridge 合并后安装、构建与端到端行为。

这些内容在当前记录中属于待人工验证或未验证；本次整合没有运行测试、构建、服务或安装器。

## 本地与公开内容边界

- 本机 `.env`、`data/` 下的 SQLite 数据库、媒体、日志、`node_modules`、Next.js 缓存和 `.serena/` 不属于源码快照，不上传至公开仓库。
- `.env.example` 仅是模板；API Key 与 Agent Token 不应写入 Git。
- `studio/` 与 `canvas/` 各自保留入口和运行说明；根目录 README 仅用于导航。
- 项目文档与交接历史中的旧仓库拆分说明是历史状态；当前单仓库决策以用户本轮明确指令为准。
