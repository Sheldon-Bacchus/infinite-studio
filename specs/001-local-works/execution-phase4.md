# Execution Report: Phase 4 (US2 迁移) 落地实现 (T011–T014)

**执行者**: AGY (依主模型批准的 Phase 4 架构设计与约束实施)  
**执行范围**:
1. [`plugins/canvas/infinite-xia/src/migration.ts`](file:///E:/all-agent-workspace/infinite-studio/plugins/canvas/infinite-xia/src/migration.ts)
2. [`studio/web/src/lib/works/migration-source.ts`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/lib/works/migration-source.ts)
3. [`workspace-service/internal/works/migration.go`](file:///E:/all-agent-workspace/infinite-studio/workspace-service/internal/works/migration.go) (含 [`model.go`](file:///E:/all-agent-workspace/infinite-studio/workspace-service/internal/works/model.go)、[`path.go`](file:///E:/all-agent-workspace/infinite-studio/workspace-service/internal/works/path.go)、[`http.go`](file:///E:/all-agent-workspace/infinite-studio/workspace-service/internal/works/http.go) 必要迁移接入)
4. [`studio/web/src/services/api/works.ts`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/services/api/works.ts)
5. [`studio/web/src/pages/works/migration.tsx`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/pages/works/migration.tsx)
6. [`studio/web/src/router.tsx`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/router.tsx)
7. [`specs/001-local-works/execution-phase4.md`](file:///E:/all-agent-workspace/infinite-studio/specs/001-local-works/execution-phase4.md)

**验证状态**: 静态审查已完成；**严格遵守规则，未执行任何编译、构建、测试、typecheck、gofmt、服务启动或真实数据迁移**；所有任务保持未勾选，待主模型审阅验收。

---

## 一、Phase 4 各任务实施细节

### 1. T011 [US2] 旧来源只读导出与可恢复原件打包
- **Infinite Xia 领域数据导出** ([`plugins/canvas/infinite-xia/src/migration.ts`](file:///E:/all-agent-workspace/infinite-studio/plugins/canvas/infinite-xia/src/migration.ts)):
  - 以完全只读模式读取 `workspace-v1` 资产集合，绝不修改原有 IndexedDB 数据；
  - **稳定来源身份与确定性映射**:
    - 基于项目资产提取稳定 `sourceId`（`infinite-xia:${projectAsset.id}` 或 `infinite-xia:default`）；
    - 实现 `deterministicId32(sourceId, oldId)`，以 SHA-256 哈希截取前 32 位十六进制生成全局符合 `[0-9a-f]{32}` 的稳定实体 ID；
  - **镜头 Supersedes 版本链解析**:
    - 遍历 beats，沿 `supersedesAssetId` 链路溯源至根 beat，将同一链条的所有修订划归同一稳定 `Shot` 实体；
    - 每个 beat 独立投影为不可变 `ShotRevision`（包含 dialogueText、referencedAssetIds 等实际原件元数据）；
    - 将未被取代的最终 beat 标定为当前 Shot 的 `currentRevision`；
  - **原件提取与缺件登记**:
    - 从 dataUrl（Base64 解码）或宿主存储读取二进制数据并计算 SHA-256；
    - 匹配已知规范 MIME 类型确定安全扩展名，物理路径固定为 `files/${sha256}${safeExt}`；
    - 无法提取二进制原件的非文本素材严格登记到 `missingFiles`，严禁伪造或虚构数据；
  - **实质内容摘要 `sourceDigest` 计算**:
    - 归一化实体 JSON 与文件 SHA-256 列表后排序复合计算 SHA-256，不包含导出时间戳与随机 ID，保证多次导出内容指纹完全一致。
- **浏览器宿主集成与 ZIP 打包** ([`studio/web/src/lib/works/migration-source.ts`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/lib/works/migration-source.ts)):
  - 接入 `fflate.zipSync`，构造标准 ZIP 包：
    - `manifest.json`: 规范清单（`schemaVersion: 1`、`sourceId`、`sourceDigest`、实体关系、文件索引与缺件表）；
    - `source.json`: 完整原始业务快照（只读原样保留）；
    - `files/<sha256>.<safeExt>`: 全部可恢复物理原件；
  - 支持导出「无限虾」与「本地画布与素材库」两类旧来源；
  - 提供 `inspectMigrationZip`（前端解包预验清单）与 `downloadBlob`（保障用户本地备份原件安全）。

### 2. T012 [US2] 后端迁移预览、隔离归档与原子发布
- **模型与定位器扩展** ([`model.go`](file:///E:/all-agent-workspace/infinite-studio/workspace-service/internal/works/model.go), [`path.go`](file:///E:/all-agent-workspace/infinite-studio/workspace-service/internal/works/path.go)):
  - 在 `model.go` 中定义 `MigrationManifest`、`MigrationFileInfo`、`MissingFileInfo`、`ConflictInfo`、`OperationInfo`、`MigrationPreviewResult` 及 `MigrationCommitResult`；
  - 在 `path.go` 中为 `PathLocator` 增加 `BackupsDir()`、`BackupDir(backupID)`、`BackupPackagePath(backupID)` 与 `BackupManifestPath(backupID)`，全量施加根边界与重解析点安全核验。
- **迁移核心业务实现** ([`workspace-service/internal/works/migration.go`](file:///E:/all-agent-workspace/infinite-studio/workspace-service/internal/works/migration.go)):
  - **ZIP 安全性与穿越拦截**: 实现 `validateZipSecurity`，拦截 `..`、绝对路径、Windows 保留设备名称（`CON`、`PRN` 等）及 ADS 冒号流注入；
  - **预览分析 (`PreviewMigration`)**:
    - 纳入 `beginOp` 生命周期；
    - 解析 ZIP 中 `manifest.json` 与 `source.json`，强校验 `schemaVersion == 1`；
    - 流式比对包内所有原件的实际内容哈希与大小，发现缺失或篡改一律计入 `missingFiles`；
    - 检查当前作品历史提交与记录，识别同一 `sourceId` 的已有版本：同摘要标记 `already_migrated`，不同摘要标记 `source_digest_conflict`；
    - 汇总操作概要，当且仅当无缺件且无摘要冲突时置 `canCommit: true`；
  - **显式提交 (`CommitMigration`)**:
    - **严格遵循锁序**: `s.beginOp() -> s.maintenanceMu.RLock() -> workLock.Lock() -> idx.mu.Lock()`；
    - **原件完整性强校验**: 存在缺失原件或哈希不符时返回 `ErrCorruptData`，严禁静默发布；
    - **来源幂等与防覆盖**: 同一 `sourceId` 且同摘要直接幂等复用返回已有版本；不同摘要返回 `ErrConflict`；
    - **持久化备份归档**: 先将上传的原始 ZIP 包与清单通过 `moveFileNoReplace` 持久落盘至 `root/backups/<backupID>/`（拒绝覆盖、检查重解析点）；
    - **媒体去重与实体发布**: 在 `workLock` 下将媒体流写入暂存并去重发布到 `media/`，构建 `RecordTypeMedia` 与映射；将转换后的分集、剧本、镜头、镜头修订、资产及 `RecordTypeMigration` 元数据记录发布至 `records/`；
    - **权威指针原子切换与索引同步**: 执行 `validateFinalRecords` 完整性校验，发布 `Commit` 清单，使用 `replaceFileOnly` 单次原子替换 `work.json`，回读确认后同步更新 SQLite 索引。
- **HTTP 路由与参数解析** ([`workspace-service/internal/works/http.go`](file:///E:/all-agent-workspace/infinite-studio/workspace-service/internal/works/http.go)):
  - 增加 `/api/local/works/{workId}/migrations/preview` 与 `.../commit` 路由；
  - 兼容 `multipart/form-data`（表单字段 `package`、`operationId`、`baseRevision`）与直接二进制流模式；
  - 继承 Host/Origin 门禁与常量时间访问令牌核验。

### 3. T013 [US2] 前端 API 客户端接入
- **文件**: [`studio/web/src/services/api/works.ts`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/services/api/works.ts)
- **实现细节**:
  - 声明强类型契约接口（`Work`、`Commit`、`CommitResult`、`MigrationPreviewResult`、`MigrationCommitResult` 等）；
  - 实现全套运行时类型守卫（`isWork`、`isCommitResult`、`isMigrationPreviewResult` 等），拒绝空类型强转；
  - 封装 `previewMigration(workId, zipBlob)` 与 `commitMigration(workId, baseRevision, operationId, zipBlob)`；
  - 包含标准的 `WorksError` 分类错误抛出与处理，复用 Vite 可信代理路径 `/api/local`。

### 4. T014 [US2] 迁移交互页面与路由挂载
- **页面实现** ([`studio/web/src/pages/works/migration.tsx`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/pages/works/migration.tsx)):
  - 采用 Ant Design 6 与 Tailwind 样式，文案保持中文，遵循全局主题 Token；
  - **分步导航设计**:
    1. **第一步（备份与导出）**: 选择「无限虾」或「本地画布与素材库」，一键生成并本地下载备份 ZIP，同时自动载入缓冲区；亦支持手动拖拽上传本地旧 ZIP；支持目标作品选择与一键新建空白作品；
    2. **第二步（映射与预览）**: 自动触发后端预览核验，直观展示来源信息、内容指纹、预期业务操作表格；若存在缺失原件或版本冲突，以醒目 Alert 与表格阻断提交；
    3. **第三步（发布与显式切换）**: 仅在 `canCommit === true` 时允许点击「确认迁移」，提交成功后展示新版本 Revision、Commit ID、Backup ID、实体统计；提供「显式切换并前往该作品画布」按钮，由用户显式触发跳转，不执行静默自动切换。
- **路由挂载** ([`studio/web/src/router.tsx`](file:///E:/all-agent-workspace/infinite-studio/studio/web/src/router.tsx)):
  - 挂载 `/works/migration` 与 `/works/:workId/migration` 路由至 `UserLayout`，确保页面完全可达。

---

## 二、任务落实对照表（待主模型静态审阅并勾选）

| 任务编号 | 任务说明 | 目标文件 | 静态落地状态 |
| :--- | :--- | :--- | :--- |
| **T011** | 原来源只读导出，含可恢复原件、稳定身份及摘要 | `plugins/canvas/infinite-xia/src/migration.ts`<br>`studio/web/src/lib/works/migration-source.ts` | **已完成** |
| **T012** | 备份清单、来源映射、预览、隔离归档发布及幂等 | `workspace-service/internal/works/migration.go`<br>`model.go`, `path.go`, `http.go` | **已完成** |
| **T013** | 契约校验与迁移接口，复用可信代理 | `studio/web/src/services/api/works.ts` | **已完成** |
| **T014** | 缺件/冲突/映射预览和显式切换页面及路由 | `studio/web/src/pages/works/migration.tsx`<br>`studio/web/src/router.tsx` | **已完成** |

---

## 三、Phase 4 聚焦修正落地记录 (phase4-corrections.md 10 项)

1. **复用锁内提交与原件发布内核**: 将原 Commit 抽为 `commitLocked`，将 RegisterMedia 抽为 `registerMediaLocked`；`CommitMigration` 在持有 `workLock` 内读 head/幂等/CAS 并复用上述锁内核，绝不重复持锁或无 Sync 发布。
2. **严格实体模型注入与解码错误拦截**: 仅为模型含 `workId` 字段的实体注入作品 ID；`shot_revision` 与 `prompt_revision` 归属 `shotId`，不注入未知字段；已有 `RecordTypeMigration` 记录严格反序列化，解码失败准确报错。
3. **实质摘要与 sourceSnapshotDigest 强校验**: ZIP 打包阶段计算 `source.json` 的字节 SHA-256 并填入 `sourceSnapshotDigest`；前后端统一以 `[sourceId, sourceType, sourceSnapshotDigest, sortedEntityHashes, sortedFileHashes]` 计算实质内容摘要；Go 后端用 `SetEscapeHTML(false)` 编码去换行比对，`digest[:]` 切片传入 `hex.EncodeToString`。
4. **ZIP 路径安全与实体覆盖预警**: 拦截大小写重复条目、符号链接、反斜杠、绝对路径、ADS、DOS 设备名及 `..` 路径段；校验 `files/<hash><safeExt>` 扩展名匹配；检测已有实体覆盖与破坏性关系并在 `preview.canCommit` 中阻断。
5. **备份文件持久安全发布**: 备份 `package.zip` 与 `manifest.json` 使用 `O_CREATE|O_EXCL`、`Sync`、`Close` 及前后重解析点核验，确保落盘且未损坏后才推进权威指针。
6. **CAS 前幂等与回执一致性**: 在 CAS 之前完成重复来源校验，同源同摘要返回已持久化的原始回执与实际 `indexState`；同一 `operationId` 不同摘要明确报告冲突；丢回执重试不受旧 `baseRevision` 阻断。
7. **镜头修订内容与版本链强校验**: `shot_revision` 的 `content` 使用 `beat.data.content`；检测并拒绝 supersedes 环、缺失父级与多活动版本；无限虾来源数据必须通过 `parseWorkspace` 校验。
8. **真实多源原件提取与未知 MIME 拦截**: 复用 `getImageBlob`/`getMediaBlob` 支持 `storageKey`、`fileId`、`data:`、`blob:` 真实字节原件；宿主原件缺失必须列入 `missingFiles`；未知 MIME 严禁伪造 `.bin`；JSON 解析损坏明确报错，不当作空来源。
9. **一作品一来源项目/画布导出**: 导出 UI 提供无限虾项目与画布下拉选择，单次仅导出一个项目/画布；非当前项目的独立无归属素材明确标记为待归档 (`archived: true`)。
10. **前端预览版本追踪与请求幂等**: 预览绑定请求修订号，丢弃过时响应；更改包或作品重置状态；捕获预览时的 `baseRevision` 与稳定 `operationId` 供提交和重试复用；`works.ts` 实现逐项守卫；`inspectMigrationZip` 失败返回 `manifest: null`。

---

## 四、合规与安全自查确认

1. **写边界隔离**: 所有改动严格限定于授权文件列表内，未修改 `main.go`、`canvas-agent`、Agent stores、AGV、旧工作区或公共文档。
2. **锁序防死锁**: 严格执行 `beginOp -> maintenanceMu.RLock() -> workLock.Lock() -> idx.mu.Lock()`，杜绝锁重入或锁倒序。
3. **数据完整性保障**: 缺失原件时绝对阻断发布；发布前必须将完整原包落地至 `root/backups/<backupID>/`；旧数据源严格只读，杜绝静默写入或破坏旧数据。
4. **无自动化指令执行**: 未执行任何 `go test`、`bun test`、`build`、`gofmt`、`typecheck` 或服务启动命令。
