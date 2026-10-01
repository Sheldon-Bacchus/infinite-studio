# Infinite 项目整合清单

本仓库作为 Infinite Studio、Infinite Canvas 与画布 MCP 资料的唯一公开仓库。根目录仍是 Infinite Studio 主应用；`implementations/` 保存独立来源项目的完整 Git 版本快照，便于查阅与后续选择性移植。快照不是子模块，也没有被改写成同一个运行时。

GitHub 目标仓库：[`Sheldon-Bacchus/infinite-studio`](https://github.com/Sheldon-Bacchus/infinite-studio)。

## 目录与来源

| 目录 | 内容 | 来源提交 | 许可证 |
| --- | --- | --- | --- |
| 根目录 | Infinite Studio 主应用：虾料/虾塘/虾镜、画布工作流、本地工作区、Codex 插件与本机 Agent | 本地 Studio 分支 `cdaf419` 及其后续工作；同时合入 GitHub `main` 的 RunningHub / ComfyUI Bridge 更新 | 以根目录 `LICENSE` 及各文件声明为准 |
| [`implementations/infinite-canvas/`](implementations/infinite-canvas/) | Infinite Canvas 源码、文档、插件、Agent、素材组/H3 功能、localForage 存储代码及已提交的导演台静态资源 | `tigerowo/infinite-canvas`，`81aa89030c5c6a839a58723262750be11e0e80d1` | AGPL-3.0；保留目录内 `LICENSE` 与第三方资源声明 |
| [`implementations/infinite-canvas-mcp/`](implementations/infinite-canvas-mcp/) | 社区 Canvas MCP、工具定义、桥接实现与使用文档 | `Sheldon-Bacchus/infinite-canvas-mcp`，`e225a282466e9eb55ebcb14ebf4ea59c25a94bbb` | MIT；保留目录内 `LICENSE` |
| [`docs/conversations/project-consolidation.md`](docs/conversations/project-consolidation.md) | 相关 Codex 对话的脱敏项目纪要和旧交接状态说明 | 当前整合任务及列出的历史对话 ID | 本仓库文档 |

来源快照保留各自的 package、插件、构建入口和版权文件。交接文档中的本机路径与过期运行说明已替换成历史索引；源码代码与来源许可证未因此改写。不要把不同目录的包名、许可证或 MCP 运行配置当成已经统一；若后续把代码移入根应用，先检查该文件及依赖的来源许可。

## 内容分类

### 已收录的源码与资料

- 无限画布的素材组连接与 H3 时长设置代码、项目文档和路线资料。
- 画布 localForage/工作区存储代码；Infinite Studio 的本地项目、媒体持久化和虾料相关实现与说明。
- Canvas Agent、Codex 插件、社区 MCP 源码及工具文档。
- Infinite Canvas H3 界面草图：[`docs/reference/infinite-canvas-h3-ui-sketch.svg`](docs/reference/infinite-canvas-h3-ui-sketch.svg)。
- `implementations/infinite-canvas/web/public/director/` 下已由来源仓库跟踪的导演台静态构建文件。此项是仓库已有的静态产物，不代表本次重新构建；本次没有生成新的 Windows 安装包。
- 历史 Codex 对话的项目决策摘要；未复制完整聊天转储、个人创作原文或本机路径、Token、数据库和媒体文件。

### 旧验证记录

[`docs/progress/pending-test.md`](docs/progress/pending-test.md) 保留原项目的测试/构建记录和人工验收清单。记录里的自动化测试通过数字只表示当时记录的范围与代码状态；整合时没有重跑，不能视为当前合并树已通过。

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
- 根目录启动器只启动 Infinite Studio。`implementations/` 中的独立快照保留各自入口和运行说明。
- 项目文档与交接历史中的旧仓库拆分说明是历史状态；当前单仓库决策以用户本轮明确指令为准。
