# 虾镜上下文导入虾画：实施任务提示词

> **历史提示词，已被新方案取代。**只有在用户确认新的[统一项目执行提示词](2026-09-27-xiaji-single-project-workflow-execution-prompt.md)后才实施；不要运行本提示词。

实施前先阅读：

- [架构决策](../../architecture/2026-09-25-xiaji-beat-context-canvas-import.md)
- [功能规格](../specs/2026-09-25-xiaji-beat-context-canvas-import.md)
- [实施计划](../plans/2026-09-25-xiaji-beat-context-canvas-import.md)
- `AGENTS.md`、当前 `git status`、相关目标文件 diff，以及 `before-you-build`、`architecture-analysis`、`api-and-interface-design`、`architecture-patterns`、`architecture-critic`、Superpowers `brainstorming`、`writing-plans`、`test-driven-development`、`verification-before-completion` Skills。

只在用户审阅并确认规格和计划后开工。先读保护工作区的脏改动；不 reset、不覆盖、不批量清理、不提交。不得连接或访问 DramaClaw，不要求其 host/token，不新增后端/API/数据库，不调用图像/音频/视频生成。特别禁止 `generate_video`。

先完成计划 Task 0：修复并独立验证 episode → `scriptAssetId` 保存关联和刷新回读。此门禁未通过时不得报告或验收整集 `complete` 导入；预览必须明确返回剧本缺失阻断项。

按计划实施三个动态 `community_canvas` 工具：只读 `preview_xiaji_episode_context`、按 `complete|selected` 闭包及明确批准 ID 导入的 `import_xiaji_episode_context`、等待节点审阅后才调用的 `arrange_xiaji_episode_canvas`。`complete` 要包含已保存剧本、全部有效 Beat、显式引用素材和当前选中且可映射的媒体；缺必需项即阻断。`selected` 至少含剧本和一个 Beat，明确返回排除 ID、缺失关系并标记 `partial`。有媒体引用不代表文件可读；`fileOnly` 不可映射，预览、实际读取和保存状态分开报告。

使用本地 canonical Asset store 和 Infinite Canvas 原生保存能力，复用现有 Asset→Canvas mapping。为每次导入生成并持久化 `projectionId`、`projectionKey`、source digest、批准闭包和逐项来源 ID；导入响应返回 projectionId。刷新后从已保存锚点/metadata 重建索引，校验唯一性、闭包和摘要。相同来源 ID 内容变化时创建新投影或依用户选择拒绝，不能按 Asset ID 单独去重、覆盖旧节点或认领普通节点。

当前 Canvas 保存不是原子事务。写入前检查 canonical 基线、在所有可能写入者共用的单画布串行写入口或经验证的 CAS 内保存，再回读确认。若不能覆盖所有写入者，跨标签/客户端并发保护验收标 `BLOCKED` 并拒绝声称无冲突；保存失败只报告回读确认的已写/未写项，不声称回滚，不自动删除未知结果。拒绝跨项目/分集引用、旧预览和错误画布目标；每项说明 created/reused/skipped/failed；不覆盖用户节点与连线。

对每项行为严格执行 TDD：新模块先建立可导入的最小公开接口/夹具，再写一条具体行为断言；运行确认 RED 必须来自行为断言失败，不能是模块无法导入、语法或环境错误。然后实现最小改动、确认 GREEN、REFACTOR 并复跑。MCP 参数不提供工具层人工审批保证；调用流程必须先向用户展示预览并等待明确回复，用户逐阶段确认后才能导入，导入结果审阅完成并再次确认后才能排版连线。视频生成不属于本任务。

最终分开报告实际运行的单元、集成、MCP 代理、E2E、smoke、TypeScript、build 和浏览器 Network 验收结果；没有执行的一律标记 `NOT RUN`，无法观察的标记 `BLOCKED`。展示修改文件和关键差异，不声称仅靠单测完成整体验收。
