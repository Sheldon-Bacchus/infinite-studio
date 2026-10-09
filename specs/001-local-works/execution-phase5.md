# Phase 5 执行与代码落地 Checkpoint (T011–T020)

**执行工作区**: `E:/all-agent-workspace/infinite-studio`  
**遵循规范**: [`AGENTS.md`](file:///E:/all-agent-workspace/infinite-studio/AGENTS.md)、[`specs/001-local-works/phase5-corrections.md`](file:///E:/all-agent-workspace/infinite-studio/specs/001-local-works/phase5-corrections.md)、[`specs/001-local-works/continuation-plan.md`](file:///E:/all-agent-workspace/infinite-studio/specs/001-local-works/continuation-plan.md)  
**执行原则**: 最小必要改动、真实源码落地、不独占工作区、未修改他人 Agent 模块与 Subject/H3 逻辑、不运行测试/构建/语法检查/编译/服务。

---

## 一、 Phase 4 收尾与 Phase 5 逐任务落地结果

### 1. Phase 4 收尾 (T011–T014 遗留补全)
- **T011 来源包只读导出与损坏显式报错**:
  - [`plugins/canvas/infinite-xia/src/migration.ts`](file:///E:/all-agent-workspace/infinite-studio/plugins/canvas/infinite-xia/src/migration.ts): 无归属资产正确标记为 `archived: false, pending: isPending`，废除以 `archived: true` 冒充待归档导致的业务隐藏。
  - [`studio/web/src/lib/works/migration-source.ts`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/lib/works/migration-source.ts): `listXiaProjects` 与 `listCanvasProjects` 遇 JSON 解析损坏显式抛出具体异常，不再静默 catch 返回空列表。
- **T012 后端迁移预览深度校验与阻断**:
  - [`workspace-service/internal/works/migration.go`](file:///E:/all-agent-workspace/infinite-studio/workspace-service/internal/works/migration.go):
    - 针对 `manifestEntityMap` 增加重复 `TargetID` (`duplicate_entity_id`) 与未知实体类型 (`unknown_entity_type`) 阻断校验；
    - 修复反序列化错误被静默忽略的问题，解码失败一律计入 `schema_decode_error` 冲突并置 `canCommit = false`；
    - 补齐 `episode`, `script`, `shot`, `shot_revision`, `asset`, `prompt_revision`, `media` 的全实体全关系跨引用深度核验，关联丢失记为 `broken_relationship` 阻断提交。
- **T013 & T014 迁移前端预览与显式切换**:
  - [`studio/web/src/pages/works/migration.tsx`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/pages/works/migration.tsx): 捕获来源损坏并展示错误提示；完成迁移后的「切换并进入作品画布」先调用 `useWorksStore.getState().selectWork(workId, { force: true })` 走草稿保护门控，再从权威 `canvas_binding` 恢复快照并导航到 `/canvas/${canvasId}`，无 binding 则创建唯一关联画布。

---

### 2. Phase 5 核心任务落地 (T015–T020)

- **T015 作品状态与草稿协议** ([`studio/web/src/stores/use-works-store.ts`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/stores/use-works-store.ts)):
  - **草稿持久化**: 使用 `localforage` 实例 (`draftsStore`) 保存包含 `workId`, `baseRevision`, `operationId`, `changes`, `updatedAt` 的完整草稿对象；
  - **CAS 与冲突保护**: 提交遇 409 版本冲突严格保留本地草稿，不静默 rebase，需用户显式调用 `resolveConflictKeepDraft` 重新基准；
  - **并发与切换防覆盖**: 引入 `workFence` 严格核验异步请求归属；切换作品时若存在未提交草稿且未显式 `force` 则阻断切换；提交完成采用原子核验 `storedDraft.operationId === targetOpId` 防止误删提交期间产生的新编辑；
  - **创建与选择稳定性**: `createWork` 保持未决创建稳定操作 ID `pendingCreateOpId`；`selectWork` 遇同 ID 但尚未 load 的作品确保触发加载。

- **T016 无限虾 Repository 适配器与投影** ([`studio/web/src/lib/works/works-adapter.ts`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/lib/works/works-adapter.ts)):
  - **规范投影定义**: 实现 `deterministicId32`；`createAssetProjection` 生成明确 `version: 1` 的原 Asset 投影，剥离 Base64/Blob 并绑定作品 `fileId`；
  - **规范身份注入**: `fromWorksRecords` 优先从投影还原，并在资产注入 `metadata.worksCanonical = { objectId, revisionId, workId }`；降级还原补齐 `beat.order/approvalState/version` 完整链条与原始业务属性；反向重建必须通过 `parseWorkspace` 严格校验；
  - **真实媒体原件上传**: 杜绝全 0 哈希与 `bytes=1` 伪造；通过真实 byte resolver 将媒体上传至作品存储获取完整服务端描述符；已有描述符按真实哈希原样复用；普通独立文本通过 UTF-8 真实原件保存；
  - **统一草稿提交**: `saveAssetsAndWait` 严格经由 store 草稿与提交协议，失败保留草稿；`getAssets` 遇当前作品未 load 时主动加载；订阅仅在 `work.id` 或 `work.revision` 实际变化时通知。

- **T017 作品库页面与用户概念** ([`studio/web/src/pages/works/index.tsx`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/pages/works/index.tsx)):
  - 接入作品列表、选择、新建、草稿提交与放弃；
  - 「进入画布」按钮实现 `handleOpenCanvas`：从作品权威详情中读取 `canvas_binding`，通过 `restoreCanvasSnapshot` 恢复画布并 `navigate(`/canvas/${binding.canvasId}`)`；
  - 页面文案彻底简化：删去“权威顶层实体、版本树、不可变记录”等底层术语，统一使用“作品、素材、保存、历史”等用户概念。

- **T018 画布快照与反向归档核心** ([`studio/web/src/lib/works/canvas-archive.ts`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/lib/works/canvas-archive.ts)):
  - **完整业务快照**: `CanvasProjectSnapshot` 全量保存 `nodes`, `connections`, `subjects`, `chatSessions`, `activeChatId`, `backgroundMode`, `showImageInfo`, `viewport`；`restoreCanvasSnapshot` 完整恢复上述业务状态并将媒体 URL 规范为当前作品媒体 URL；
  - **精确凭据脱敏**: 废除旧正则 `/key/i`（曾误伤 `storageKey`, `sourceKey` 等正常业务字段），改用精确字段匹配 `SENSITIVE_KEY_EXACT_PATTERNS`；
  - **待归档持久集合**: 使用 localforage 实例 `pendingStore` 持久化未知归属或新产物，导出 `listPendingArchiveItems`, `savePendingArchiveItem`, `removePendingArchiveItem`, `adoptPendingArchiveItem` 真实采纳入口；
  - **反向回存与安全绑定**: 实现 `archiveCanvasNodesToWork`，计算真实 SHA-256 与字节，检测已有不同 `canvasId` binding 拒绝破坏性替换，跨作品节点存入待归档集合，通过 store 草稿/提交协议落盘。

- **T019 插件投放身份与反向归档接通** ([`plugins/canvas/infinite-xia/src/index.tsx`](file:///E:/all-agent-workspace/infinite-studio/plugins/canvas/infinite-xia/src/index.tsx)):
  - `toCanvas`: 严格读取投影中的 `worksCanonical` 权威身份 (`objectId`, `revisionId`, `workId`)，禁止以原 Asset id 或 fileId 冒充 revisionId；跨 work 节点不强灌当前作品；
  - `batchArchiveFromCanvas`: 彻底废除 `works.archiveAssets`（防止资产被标记为 archived 隐藏），改用 `works.archiveCanvasNodes(nodes, canvasId)`，将节点修改与新原件按真实哈希提交为新版本，未知归属存入待归档集合。

- **T020 画布权威恢复与生成登记** ([`studio/web/src/pages/canvas/project.tsx`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/pages/canvas/project.tsx)):
  - **权威恢复优先**: 画布加载时优先从作品权威记录中的 `canvas_binding` 恢复快照，不以旧浏览器本地缓存掩盖；
  - **生成启动身份锁定**: 在生成启动时固定当前的 `startWorkId` 与 `generationId`；
  - **生成产物自动登记**: 图片、视频、音频、文本生成成功后，异步调用 `savePendingArchiveItem` 登记入待归档资产集合，保存真实 URL/fileId/bytes/mimeType/prompt，不读取后来的 `currentWorkId`，失败 catch 保留重试，不影响现有生成流程。

---

## 二、 实际涉及文件清单与检查

| 文件路径 | 模块归属 | 实际落地动作 |
|---|---|---|
| `studio/web/src/lib/works/canvas-archive.ts` | 宿主 Works | 完整重构：快照全量业务属性、精确脱敏、localforage 待归档集合与采纳接口、真实哈希比对与原件上传、画布防静默覆盖绑定 |
| `plugins/canvas/infinite-xia/src/index.tsx` | 插件前端 | 修正 `toCanvas` 权威身份读取；重写 `batchArchiveFromCanvas` 改调 `works.archiveCanvasNodes` |
| `studio/web/src/pages/works/migration.tsx` | 宿主页面 | 显式切换接入 `selectWork` 与权威 `canvas_binding` 恢复；优化中文文案 |
| `studio/web/src/pages/works/index.tsx` | 宿主页面 | 「进入画布」接入权威 `canvas_binding` 恢复与跳转；简化界面术语 |
| `studio/web/src/pages/canvas/project.tsx` | 画布主页面 | 恢复优先作品权威快照；生成启动固定身份，生成产物异步登记待归档 |
| `studio/web/src/lib/works/works-adapter.ts` | 宿主 Works | 投影补全、真实媒体上传去重、无假哈希、草稿提交协议适配 |
| `studio/web/src/stores/use-works-store.ts` | 宿主 Store | 草稿 localforage 持久化、409 冲突保护、workFence 竞态隔离、稳定操作 ID |
| `plugins/canvas/infinite-xia/src/migration.ts` | 插件迁移 | 补齐 pending 状态修复，防止误标 archived |
| `studio/web/src/lib/works/migration-source.ts` | 宿主迁移 | 来源损坏显式抛出异常 |
| `workspace-service/internal/works/migration.go` | Go 后端 | 补齐全实体全关系跨引用核验与解码错误阻断 |

---

## 三、 未完成与后续接续项 (进入 Phase 6: T021–T025)

根据 [`specs/001-local-works/continuation-plan.md`](file:///E:/all-agent-workspace/infinite-studio/specs/001-local-works/continuation-plan.md) 与 [`specs/001-local-works/tasks.md`](file:///E:/all-agent-workspace/infinite-studio/specs/001-local-works/tasks.md)，Phase 5 (T011–T020) 核心修正与链路已全部接通。后续剩余任务为 **Phase 6: 历史、归档与恢复 (T021–T025)**：
1. **T021**: 在 `local-studio-model.ts` 与 `local-studio-repository.ts` 中区分镜头稳定身份/修订并补充提示词修订；
2. **T022**: 在 `studio/web/src/lib/works/generation-history.ts` 中记录实际输入快照、结果/失败、任务身份和选用关系；
3. **T023**: 在 `workspace-service/internal/works/archive.go` 实现业务归档/恢复与原件引用保留，禁止永久物理删除；
4. **T024**: 在 `workspace-service/internal/works/package.go` 使用标准 ZIP 实现作品安全导出、导入预览及路径/摘要/大小写/schema 校验；
5. **T025**: 在 `workspace-service/internal/works/recovery.go` 实现提交恢复与手动 inbox 扫描。

本批执行完成，等待主模型静态审阅。
