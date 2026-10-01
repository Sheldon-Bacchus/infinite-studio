# Agent 与 MCP 运行时选择

## 根目录应用

根目录是 Infinite Studio 主应用，Agent 配置唯一来源为 `canvas-agent/agent-runtime.json`。根应用 MCP 服务名为 `infinite-canvas-core`；Codex 插件与直接 MCP 使用 `@tigerowo/canvas-agent@latest` 连接根应用画布。插件安装、手动启动和移除说明见 [`canvas-agent/README.md`](../../canvas-agent/README.md)。

应用 GitHub 仓库为 `Sheldon-Bacchus/infinite-studio`；Agent npm 包仍由其上游包名 `@tigerowo/canvas-agent` 分发。仓库地址与 npm 包名表示不同来源，不要混写。

## 来源快照

仓库内的 `implementations/infinite-canvas/` 和 `implementations/infinite-canvas-mcp/` 用于保存完整源码、文档、插件和许可证。它们保留原始配置及运行方式，不会被根目录插件自动加载。需要移植功能时，先核对来源提交和许可证，再更新根目录实现与唯一运行时清单。

## 连接约定

- 网页 Agent、画布内 Codex、Codex 插件和直接 MCP 使用根目录唯一 Agent 配置。
- 多画布调用前应显式选择目标画布；工具列表变更和断线恢复需要按 [`docs/progress/pending-test.md`](../progress/pending-test.md) 中的清单验收。
- 不把来源快照的 MCP 服务名、连接 Token 或本机路径复制到根配置。
