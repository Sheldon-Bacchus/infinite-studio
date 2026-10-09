# Phase 6 执行检查点与落地报告：T021–T025

**完成时间**: 2026-10-08
**执行规范遵循**:
- 严格遵循 `AGENTS.md`，不运行测试、构建、语法检查、服务、浏览器或真实迁移。
- 遵循 Fail-Fast 原则，中文错误提示，不采用破坏性覆盖或 fallback 静默降级。
- 严格在 `E:/all-agent-workspace/infinite-studio` 范围内修改代码，不修改其他项目或仓库。

---

## 一、主模型审查与集成缺陷修复 (Review Findings Addressed)

1. **待归档素材 (Pending Archive Items) 可达性与采纳 UI**:
   - 在 `studio/web/src/pages/works/index.tsx` 页面顶栏及当前活跃作品卡片中分别提供「待归档素材」入口，附带未采纳数量 Badge 标记。
   - 实现 `PendingDrawer` 抽屉：支持展示产物预览（图片缩略图、音视频文本分类标签）、生成提示词、登记时间、单项「采纳进作品」、单项「舍弃」、「全部采纳进当前作品」及「清空待归档」。
2. **采纳操作安全持久化与文本项有效性**:
   - `adoptPendingArchiveItem` (`studio/web/src/lib/works/canvas-archive.ts`) 规范化文本资产与媒体原件处理：文本项创建 UTF-8 文本 Blob 上传至作品媒体存储，分配服务端 `fileId`、计算 SHA-256 及字节数，写入规范 `asset` 记录。
   - 经由同一 `useWorksStore.commitDraft()` 提交权威确认后，才从 localforage `pendingStore` 移除；若提交未决或失败，草稿与待归档记录完整保留，杜绝数据丢失。
3. **远端临时/过期生成媒体持久化保护 (Expiring URLs)**:
   - 在 `PendingArchiveItem` 模型中增加持久化 `blob?: Blob` 支持。
   - `savePendingArchiveItem` 检测到远端临时 URL（非本地 `/api/local/works/`）时，立即拉取二进制 Blob 缓存；若已有绑定作品，直接上传作品媒体存储固化；若无作品绑定，在 localforage 中妥善缓存 Blob。
   - `adoptPendingArchiveItem` 采纳时优先使用本地缓存的 Blob，彻底杜绝外部模型临时 URL（如 AWS S3 预签名 URL、OpenAI 1小时过期链接）在用户稍后采纳时已过期失效的问题。
4. **Go 严格解码 (`DisallowUnknownFields`) 与 Shot Revision 契约**:
   - 核对 `ShotRevisionData` 服务端结构体字段：`id`, `shotId`, `content`, `dialogue`, `referenceAssetIds`, `promptRevisionIds`, `projection`。
   - `studio/web/src/lib/works/works-adapter.ts` 已移除顶层 `order`, `approvalState`, `version`，上述字段完整收纳于 `projection.originalAsset` 中，避免 Go 严格 JSON 解码器抛出未知字段错误。
5. **素材库与 Works Adapter 边界定位**:
   - 梳理确认：主画布「我的素材」(`pages/assets/index.tsx` / `useAssetStore`) 管理浏览器本地画布通用素材。
   - 作品库「无限虾/虾集/虾塘」(`plugins/canvas/infinite-xia/` / `works-adapter.ts`) 管理各作品独立的版本化剧本、分镜、角色/场景/道具资产；并在作品库页面提供全量记录归档恢复与外部收件箱直接采纳能力。

---

## 二、Phase 6 核心任务落地清单

### T021 镜头身份与提示词修订 (Shot Identity & Prompt Revisions)
- **代码文件**:
  - `plugins/canvas/infinite-xia/src/core/local-studio-model.ts`:
    - 新增 `LocalStudioPromptRecord`（`recordType: "prompt"`, `schemaVersion: 1`），包含 `shotId`, `sourceRevision`, `imagePrompt`, `videoPrompt`。
    - 在 `LocalStudioBeatRecord` 中增加稳定 `shotId` 与 `currentPromptAssetId` 字段。
    - 导出 `listLocalStudioPrompts` 工具函数。
  - `plugins/canvas/infinite-xia/src/core/local-studio-repository.ts`:
    - `createBeat` 自动生成持久化稳定 `shotId`。
    - `updateBeat` 继承并保留稳定 `shotId`，更新分镜不回写旧版本内容。
    - 新增 `savePromptRevision` 与 `listPrompts(shotId)` 方法。
  - `plugins/canvas/infinite-xia/src/index.tsx`:
    - 在分镜编辑面板中接入图片提示词与视频提示词的多行文本编辑区及版本切换选择器。
  - `studio/web/src/lib/works/works-adapter.ts`:
    - 双向映射 `prompt_revision` 记录与 `LocalStudioPromptRecord`。

### T022 生成历史 (Generation History)
- **代码文件**:
  - `studio/web/src/lib/works/generation-history.ts`:
    - 严格密钥凭据过滤：`sanitizeGenerationParameters` 剔除所有匹配 `api_?key|token|secret|password|auth|credential` 的敏感字段。
    - `startGenerationHistory`: 捕获启动时的 `workId`、分镜/分集归属与编译后输入快照，初始状态 `running`。
    - `updateGenerationHistory`: 支持更新远程 `taskId`、产物 `outputFileIds`、完成 `succeeded` 或失败 `failed` 状态及错误原因。
    - `commitGenerationToWork`: 将历史条目转化为规范 `RecordTypeGeneration` 记录并持久化提交至当前作品提交链。
  - `studio/web/src/pages/canvas/project.tsx`:
    - 在图片生成、视频生成（启动及后台轮询完成/失败）、音频生成及文本生成的成功与异常分支中全量接入 `startGenerationHistory`、`updateGenerationHistory` 和 `commitGenerationToWork`。

### T023 业务归档与恢复 (Business Archive & Restore)
- **代码文件**:
  - `workspace-service/internal/works/archive.go`:
    - `ArchiveEntities`: 持有作品排他锁，进行 CAS 基准修订校验，记录 `RecordTypeArchive` 不可变事件，并将目标资产的 `archived` 状态置为 `true`，通过 `commitLocked` 原子推进提交。
    - `RestoreEntities`: 类似逻辑将 `archived` 置为 `false`，生成恢复提交。所有历史记录与媒体原件妥善保留，严禁物理清理。
  - `workspace-service/internal/works/http.go`:
    - 路由挂载 `POST /api/local/works/{workId}/archive` 与 `POST /api/local/works/{workId}/restore`。
  - `studio/web/src/services/api/works.ts`:
    - 导出 `archiveEntities` 与 `restoreEntities` 客户端接口。
  - `studio/web/src/stores/use-works-store.ts`:
    - 状态机动作 `archiveEntities` 与 `restoreEntities`，提交成功后自动刷新权威视图。
  - `studio/web/src/pages/works/index.tsx`:
    - 在当前作品卡片中提供「素材与记录归档」按钮，打开 `ArchiveModal`，支持按全部/活跃/已归档过滤查看各实体，并提供可达的「归档」与「恢复」动作。

### T024 作品 ZIP 工程包导出与导入 (Work ZIP Package Export & Import)
- **代码文件**:
  - `workspace-service/internal/works/package.go`:
    - `ExportWorkZip`: 将当前作品的 `work.json` 清单、可达提交链、所有不可变记录、以及记录引用的物理媒体原件打包为标准 ZIP 流输出。
    - `PreviewWorkZip`: 严格校验条目相对路径，拒绝反斜杠、绝对路径、`..` 路径穿越、NTFS 备用数据流 (ADS)、Windows DOS 设备名保留字及同名大小写冲突；校验清单与不可变记录 Schema，校验物理媒体 SHA-256 摘要与字节数；若目标作品 ID 已存在报告冲突。
    - `ImportWorkZip`: 在隔离临时目录 `staging/import_{opId}` 构造并核验全包，核验全部通过后使用 `moveFileNoReplace` 原子发布至 `workspaces/{workId}`，杜绝半包泄露。
  - `workspace-service/internal/works/http.go`:
    - 路由挂载 `GET /api/local/works/{workId}/export`、`POST /api/local/works/packages/preview`、`POST /api/local/works/packages/commit`。
  - `studio/web/src/services/api/works.ts`:
    - 导出 `getExportWorkUrl`、`previewWorkPackage`、`commitWorkPackage`。
  - `studio/web/src/pages/works/index.tsx`:
    - 当前作品卡片提供「导出工程包 (ZIP)」直接下载。
    - 顶栏提供「导入工程包」按钮，打开 `ImportPackageModal`，支持拖拽选择 ZIP，实时展示校验摘要（提交数、记录数、媒体数、冲突项）并确认原子导入。

### T025 恢复审计与手动收件箱 (Recovery Audit & Manual Inbox)
- **代码文件**:
  - `workspace-service/internal/works/path.go`:
    - 新增 `InboxDir` 与 `RootStagingDir` 规范路径生成器。
  - `workspace-service/internal/works/store.go`:
    - `createWork` 显式新建作品时自动初始化 `inbox/` 目录。
  - `workspace-service/internal/works/recovery.go`:
    - `VerifyAndAuditWork`: 在排他锁保护下遍历 `commits/` 验证提交链连贯性，核验记录文件 SHA-256，核对实际物理媒体 SHA-256 与字节数，扫描并报告孤立记录、孤立媒体、孤立提交及残留 staging 目录，生成 `WorkAuditReport`。
    - `ScanInbox`: 扫描该作品 `inbox/` 目录下的普通文件，计算哈希与大小，对比作品媒体库已有记录标记 `new` 或 `duplicate`。
    - `AdoptInboxFiles`: 采纳前再次校验 SHA-256 防止并发篡改，通过 `registerMediaLocked` 录入媒体，生成 `media` 与 `asset` 不可变记录，通过 `commitLocked` 推进提交，确认提交成功后从 `inbox/` 安全删除该文件。
  - `workspace-service/internal/works/http.go`:
    - 路由挂载 `POST /api/local/works/{workId}/audit`、`POST /api/local/works/{workId}/inbox/scan`、`POST /api/local/works/{workId}/inbox/adopt`。
  - `studio/web/src/services/api/works.ts`:
    - 导出 `auditWork`、`scanInbox`、`adoptInbox`、`rebuildWorkIndex`。
  - `studio/web/src/pages/works/index.tsx`:
    - 提供「工程审计」按钮与 `AuditModal`，展示健康状态、提交数、记录数、媒体数及孤立项统计，并提供「重建 SQLite 索引」操作。
    - 提供「文件收件箱」按钮与 `InboxDrawer`，支持扫描 `inbox/`、查看新增/重复状态、多选并执行「采纳选中文件」。

---

## 三、涉及修改的实际文件列表 (Exact Files Changed)

### 服务端 (Go)
1. `workspace-service/internal/works/archive.go` (新建: 归档与恢复业务逻辑)
2. `workspace-service/internal/works/package.go` (新建: ZIP 导出、安全校验预览与原子导入)
3. `workspace-service/internal/works/recovery.go` (新建: 工程审计、提交链核验、收件箱扫描与采纳)
4. `workspace-service/internal/works/path.go` (扩展: InboxDir, RootStagingDir)
5. `workspace-service/internal/works/store.go` (扩展: 创建作品时初始化 inbox 目录)
6. `workspace-service/internal/works/http.go` (扩展: 挂载 archive, restore, export, package preview/commit, audit, inbox scan/adopt 路由)

### 前端与插件 (TypeScript / React)
7. `plugins/canvas/infinite-xia/src/core/local-studio-model.ts` (扩展: PromptRecord 模型与 shotId)
8. `plugins/canvas/infinite-xia/src/core/local-studio-repository.ts` (扩展: 稳定 shotId 继承与提示词修订方法)
9. `plugins/canvas/infinite-xia/src/index.tsx` (扩展: 分镜提示词编辑与版本切换 UI)
10. `studio/web/src/lib/works/works-adapter.ts` (扩展: shot_revision 严格字段规范，prompt_revision 双向映射)
11. `studio/web/src/lib/works/generation-history.ts` (新建: 敏感凭据过滤、生成历史记录与作品提交)
12. `studio/web/src/lib/works/canvas-archive.ts` (修复: 待归档素材 Blob 缓存防止临时 URL 过期，安全提交确认后再删除)
13. `studio/web/src/pages/canvas/project.tsx` (扩展: 图片、视频、音频生成接入生成历史与持久化待归档)
14. `studio/web/src/services/api/works.ts` (扩展: 导出 archive, restore, package, audit, inbox 等接口与类型契约)
15. `studio/web/src/stores/use-works-store.ts` (扩展: archiveEntities, restoreEntities, saveDraftChanges)
16. `studio/web/src/pages/works/index.tsx` (扩展: 待归档素材抽屉、工程包导入导出、业务归档/恢复、工程审计、收件箱抽屉完整可达 UI)

---

## 四、收尾状态

- **T026–T027**: 主模型已完成静态审阅并更新 tasks、review、CHANGELOG、todo、pending-test 与 HANDOFF；运行验收未作为实施门槛。
- **用户运行验收**: 待用户按 `docs/content/docs/progress/pending-test.mdx` 验收迁移、媒体回存、生成历史、提示词修订、ZIP 导入导出、归档恢复、审计与收件箱采纳。用户确认前不更新正式功能说明。
