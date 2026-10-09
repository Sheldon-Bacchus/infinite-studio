# Tasks: 本地作品仓库与双向归档

**Input**: spec.md、plan.md、research.md、data-model.md、contracts/works.md
**Status**: T001–T027 已实现并经主模型源码静态审阅；运行验收仍单列 pending-test，不作为实施或完成勾选的前置条件。未运行测试、构建、类型/语法检查、服务或浏览器。
**Tests**: 本轮不运行语法检查、测试或构建。实现后写入 pending-test 供用户验收。

## Phase 1 Setup

- [x] T001 通过官方 specify CLI 安装 .specify/ 与 .agents/skills/speckit-*。
- [x] T002 将批准方向整理到 specs/001-local-works/spec.md、plan.md、contracts/works.md 和 data-model.md。

## Phase 2 Foundational

- [x] T003 在 workspace-service/internal/works/model.go 定义版本化作品/提交/记录与统一媒体模型。
- [x] T004 在 workspace-service/internal/works/path.go 实现 ID locator、根边界与 Windows 重解析点拒绝，核对最终路径预算。
- [x] T005 在 workspace-service/internal/works/lock_windows.go 用 Windows 原语实现持续持有排他锁和文件安全替换。

## Phase 3 US1 安全作品保存

独立验收：隔离保存、重启、两个客户端冲突、第二服务锁与提交中断。

- [x] T006 [US1] 在 workspace-service/internal/works/store.go 实现打开/显式新建与不可变记录读取。
- [x] T007 [US1] 在 workspace-service/internal/works/commit.go 实现基准修订、operationId 摘要/回执及单清单切换。
- [x] T008 [US1] 在 workspace-service/internal/works/media.go 实现作品内流式哈希去重与原件登记。
- [x] T009 [US1] 在 workspace-service/internal/works/index.go 实现可重建索引，已提交但索引失败不误报未提交。
- [x] T010 [US1] 在 workspace-service/internal/works/http.go 定义受限 HTTP 能力；局部挂载 workspace-service/main.go，保留现有鉴权及旧数据根，不启动服务。

## Phase 4 US2 迁移

独立验收：备份含原件，重复导入不新增，失败旧数据可读，冲突/缺件明确。

- [x] T011 [US2] 在 plugins/canvas/infinite-xia/src/migration.ts 与 studio/web/src/lib/works/migration-source.ts 实现原来源只读导出，含可恢复原件及摘要。
- [x] T012 [US2] 在 workspace-service/internal/works/migration.go 实现备份清单、来源身份映射、预览、隔离发布及幂等。
- [x] T013 [US2] 在 studio/web/src/services/api/works.ts 实现契约校验与迁移接口，复用可信代理。
- [x] T014 [US2] 在 studio/web/src/pages/works/migration.tsx 提供缺件/冲突/映射预览和显式切换，不运行真实迁移。

## Phase 5 US3 统一入口和画布回存

独立验收：同作品跨模块与刷新一致，未知归属待归档，重复回存幂等。

- [x] T015 [US3] 在 studio/web/src/stores/use-works-store.ts 实现作品加载、草稿、提交、冲突及切换归属状态。
- [x] T016 [US3] 在 plugins/canvas/infinite-xia/src/storage.ts、workspace.ts、index.tsx 为现有 repository 接入统一 adapter，保留显式迁移旧来源；同步宿主音频类型与 API 校验。
- [x] T017 [US3] 在 studio/web/src/pages/works/index.tsx 与 router.tsx 接入作品库入口，沿用现有 UI/全局状态。
- [x] T018 [US3] 在 studio/web/src/lib/works/canvas-archive.ts 定义对象/版本/节点身份与重复归档判定。
- [x] T019 [US3] 在 plugins/canvas/infinite-xia/src/index.tsx 补齐投放来源和反向批量归档，沿用唯一作品画布。
- [x] T020 [US3] 在 studio/web/src/pages/canvas/project.tsx 与生成完成路径局部接入自动登记待归档，不覆盖已有视频绑定改动，不自动选用结果。

## Phase 6 US4 历史、归档与恢复

独立验收：旧输入不可变、归档可恢复、ZIP 关系/摘要一致、索引可重建。

- [x] T021 [US4] 在 plugins/canvas/infinite-xia/src/core/local-studio-model.ts、local-studio-repository.ts 区分镜头稳定身份/修订并补充提示词修订。
- [x] T022 [US4] 在 studio/web/src/lib/works/generation-history.ts 与既有生成路径记录实际输入快照、结果/失败、任务身份和选用关系。
- [x] T023 [US4] 在 workspace-service/internal/works/archive.go 实现业务归档/恢复与原件引用保留，禁止永久清理。
- [x] T024 [US4] 在 workspace-service/internal/works/package.go 用标准 ZIP 完成导出/预览导入与穿越、大小写、schema、摘要校验。
- [x] T025 [US4] 在 workspace-service/internal/works/recovery.go 实现提交恢复与手动 inbox 扫描，不实时监听、自动合并或直接修改剧本。

## Phase 7 Polish

- [x] T026 在 specs/001-local-works/review.md 逐任务记录主模型静态审阅和实际验证边界，未经实现不得勾选。
- [x] T027 根据实际行为更新 CHANGELOG.md、docs/content/docs/progress/todo.mdx、pending-test.mdx 与 docs/HANDOFF.md，用户确认后更新正式功能说明。

## Dependencies

T001–T002 → T003–T005 → T006–T010 → T011–T014 → T015–T020 → T021–T025 → T026–T027。
媒体模型和服务契约稳定后才能接前端。只允许分批执行；当前不派并行 worker，避免共有入口冲突。

## Implementation Strategy

首批 executor 仅拥有 workspace-service/internal/works/（T003–T008）与本 Feature 的执行报告，不改 main.go、go.mod、旧 workspace 包、前端、共享文档或真实作品目录。新增依赖须先交主模型审查。不运行测试/build/typecheck，不启动服务。主模型审阅后再发布下一批。




