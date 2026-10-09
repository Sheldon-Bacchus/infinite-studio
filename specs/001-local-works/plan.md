# Implementation Plan: 本地作品仓库与双向归档

**Branch**: 共享分支保持不变 | **Spec**: spec.md
**Input**: spec.md；docs/plans/studio-local-works-project.md

## Summary

先在 workspace-service 增加独立 works 模块，保留旧工作区接口作为迁移来源；再将无限虾 repository 接到统一本地作品接口，最后补充画布回存、历史与恢复。用户确认本次只复用 Spec Kit 流程，不修改 AGV 组件。

## Technical Context

**Language/Version**: Go 1.25；现有 TypeScript/React。
**Primary Dependencies**: 已有 GORM/SQLite、localforage、Zustand；Go 标准库 ZIP/sha256/json；排他锁使用 golang.org/x/sys/windows；文件替换使用 Windows 原语，不手写底层锁。
**Storage**: 作品目录与不可变记录为权威，SQLite 为索引。
**Testing**: 隔离目录故障/并发/迁移/ZIP 场景。按 AGENTS 本轮不运行测试、语法检查或构建；测试命令作为后续用户验收说明。
**Target Platform**: Windows 本机可信前端。
**Project Type**: 现有本地服务与 Web 前端重构。
**Performance Goals**: 媒体流式写入；不将视频/音频原件复制进每次提交；不规定未确认吞吐边界。
**Constraints**: 单服务写权限、基准修订、幂等、保留旧数据、排他锁、同卷提交、ID 路径、中文文案。
**Scale/Scope**: 现有个人作品、多标签页和插件入口；不引入跨作品去重、多画布或云协作。

## Constitution Check

设计前/后均符合现有结构和数据保护。项目原则允许本地服务能力，不修改外部 AI 直连规则。不执行真实数据迁移、浏览器、服务重启、生成。用户已明确指定 AGY 执行，替代此前 DeepSeek 路由；主模型负责规划与审阅。

## Project Structure

```text
workspace-service/internal/works/    新模块：model/store/commit/media/migration/archive/package/http
workspace-service/main.go           最后阶段挂载服务，不静默更换旧数据根
plugins/canvas/infinite-xia/src/     业务模型与 repository，存储 adapter
studio/web/src/services/api/works.ts
studio/web/src/stores/use-works-store.ts
studio/web/src/pages/works/         作品入口及迁移/归档动作
studio/web/src/lib/works/           画布归属/回存与快照
specs/001-local-works/              本 Feature 唯一规格与计划任务
```

**Structure Decision**: 先独立 works 包，不将目录契约散落到旧 SQLite records；前端使用全局 store/API，不通过 props 层层传全局状态。主模型负责复杂设计、视觉和整合审查。

## Phase 0 Research

见 research.md：权威清单、提交协议、Windows API、迁移来源、既有服务安全、哈希范围已明确。真实数据清点与路由恢复是执行输入，不阻碍隔离实现设计。

## Phase 1 Design

见 data-model.md、contracts/works.md 与 quickstart.md。媒体按作品哈希存一份；修改提交只新增变化对象记录，提交清单引用完整当前实体集合及历史。指针切换是提交线性化点；已切换而索引失败必须返回已提交状态并记录索引待重建。

## Execution Slices

A：纯 works 包（T001–T008），不改启动器、旧数据或前端。
B：迁移与统一入口（T009–T016），需预览且显式切换。
C：画布回存与历史（T017–T022），仅对相关文件局部追加，避免覆盖已有视频改动。
D：归档/ZIP/恢复与文档（T023–T027）。
每批由主模型审阅；未运行行为保持待验收，未完成任务不勾选。

用户续接要求：代码实现并经主模型静态审阅后即勾选实现任务，继续下一阶段。测试、构建与用户验收独立记入 pending-test，不作为 SDD 实施门槛；本轮仍禁止运行这些命令。T003–T010 已完成，执行者继续按 Phase 4→5→6 顺序完成剩余计划。

## Complexity Tracking

新增 works 包由权威存储格式变化要求，旧 API 保留仅作为迁移来源，非无限期兼容逻辑。

