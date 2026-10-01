---
title: TODO
description: 当前项目后续值得处理的事项
---

# TODO

本文档用来记录当前项目后续比较值得处理的事项。

开发门禁与当前规格/计划索引见 [Superpowers README](../superpowers/README.md)。

- [ ] **统一项目身份与可审阅导入：实施中，2026-09-28 已获用户授权。** 无分集保存、固定提交与恢复、单机项目—画布绑定、Agent 包跨页待审、项目结构/单集分阶段画布导入已实现并有定向测试；当前虾X 42 个文件 218 pass、标准 TypeScript、production build 和 HTTP smoke 通过。来源截图、完整页面复用验收、登录后 E2E、MCP 动态导入、Network 与截图对照仍未完成；当前 MCP 只读查询无已连接画布。细节见[统一项目架构](../architecture/2026-09-27-xiaji-single-project-workflow.md)、[规格](../superpowers/specs/2026-09-27-xiaji-single-project-workflow.md)、[TDD 计划与执行记录](../superpowers/plans/2026-09-27-xiaji-single-project-workflow.md)和[执行提示词](../superpowers/prompts/2026-09-27-xiaji-single-project-workflow-execution-prompt.md)。
- [ ] **画布页 diff 收敛：** `canvas-client-page.tsx` 有全文件 Prettier 重排且没有格式化前工作区快照；保留现状，按 diff 块审阅语义改动。不整文件回退或再次格式化；完成真实浏览器验收后再评估是否拆分模块。
- [ ] **通用本地素材 MCP 工具验收：** 已撤下 SHOT 专用 `import_local_assets`。页面代码已有 `import_assets_to_canvas`，后续需确认它的实际 MCP 暴露、支持的素材类型、保存与刷新回读，再决定是否需要重新设计通用工具 contract。
- [ ] **多画布连接选择与断连语义：** 在客户端列表中清晰显示具体画布和窗口；每轮明确锁定一个目标，提供显式切换/断连反馈，并验证目标关闭时请求失败而不会写入其他画布。
- [ ] **用户自定义 AutoDL 工作流 JSON：** 当前应用通过 AutoDL API 查询 workflow 名称与 `input_rules`，据此映射已有输入槽；用户自己的完整 JSON 不在仓库中，且本应用没有写回 AutoDL 远端工作流的能力。若需修改特定工作流结构，先由用户提供导出的 JSON，再按其确切 schema 处理；本轮只增加按输入槽超限时报错的前端校验。

- [ ] 按更新后的[来源控件矩阵](../superpowers/artifacts/dramaclaw-local-creative-suite/source-to-target-matrix.md)逐项复核虾料、虾塘、虾镜真实页面移植；已更新静态代码映射。来源截图和交互未重新逐项验收前，不把矩阵或历史测试结果当作完整移植证明。
- [ ] **历史浏览器缺陷需重新确认，不作为当前已复现问题：**2026-09-25 E2E 记录曾报告剧本刷新回读丢失、Beat 保存反馈误报、虾塘枚举/身份名称显示异常；后续代码与数据模型已多次改动，当前无浏览器复测证据。剩余媒体操作、跨项目伪造引用/重复序号、Network 面板和来源截图比较未验收。查看[旧运行记录](../superpowers/artifacts/dramaclaw-local-creative-suite/e2e-run-2026-09-25.md)、[验收规格](../superpowers/specs/2026-09-25-xiaji-three-module-e2e-validation.md)、[计划](../superpowers/plans/2026-09-25-xiaji-three-module-e2e.md)与[验收架构](../architecture/2026-09-25-xiaji-three-module-validation.md)。
