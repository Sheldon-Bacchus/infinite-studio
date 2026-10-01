# 无限片场单仓库文档索引

## 单仓库整合资料

- [实现与来源清单](../IMPLEMENTATIONS.md)
- [项目整合与对话纪要](conversations/project-consolidation.md)
- [历史验证与待验收状态](progress/pending-test.md)

## 项目介绍

- [快速开始](overview/quick-start.md)
- [功能介绍](overview/features.md)
- [Agent 与 MCP 运行时选择](overview/agent-runtime.md)
- [Docker 部署](overview/docker.md)
- [第三方 GitHub 提示词仓库](overview/third-party-prompt-repositories.md)

## 操作手册

- [画布节点操作手册](canvas/canvas-node-manual.md)
- [画布快捷键](canvas/canvas-shortcuts.md)

## 开发文档

- [本地开发](backend/local-development.md)
- [接口响应约定](backend/api-response.md)
- [系统配置数据结构](backend/system-settings.md)
- [后端数据库说明](backend/backend-database.md)
- [画布数据结构](backend/canvas-data-structure.md)

## 虾料、虾塘、虾镜与原生虾画

- [统一项目架构](architecture/2026-09-27-xiaji-single-project-workflow.md)
- [统一项目规格](superpowers/specs/2026-09-27-xiaji-single-project-workflow.md)
- [TDD 实施计划](superpowers/plans/2026-09-27-xiaji-single-project-workflow.md)
- [实施提示词（待用户确认）](superpowers/prompts/2026-09-27-xiaji-single-project-workflow-execution-prompt.md)

## 代码来源与复用记录

- [DramaClaw 来源版本与逐文件比对](superpowers/artifacts/dramaclaw-local-creative-suite/source-provenance.md)
- [DramaClaw 源码调用点与本地行为映射](superpowers/artifacts/dramaclaw-local-creative-suite/source-call-map.md)
- [DramaClaw 来源控件到 Infinite Canvas 映射及验收状态](superpowers/artifacts/dramaclaw-local-creative-suite/source-to-target-matrix.md)

## 商务合作

- [开源协议](business/license.md)
- [商务合作](business/business.md)

## 赞助支持

- [打赏支持](support/donate.md)

## 项目进度

- [待测试](progress/pending-test.md)
- [TODO](progress/todo.md)

## 说明

- 本机所有浏览器中的画布项目与“我的素材”索引统一保存到本地后端 `data/infinite-canvas.db`，媒体保存到 `data/files`；浏览器旧素材缓存会首次增量迁入并保留，不再作为权威数据源。
- 页面按约 3 秒轮询并在重新获得焦点时刷新；跨浏览器一致性依赖相同本地服务、数据库路径和媒体目录，不由相同网页 URL 自动保证。
- 本地直连模式下，AI API Key 保存在浏览器本地，并由前端直接请求 OpenAI 兼容接口。
