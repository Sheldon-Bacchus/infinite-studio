# 无限片场固定本地工作区 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans，由 GPT-6 Luna 单执行者按任务推进。步骤使用 checkbox；不默认派生子 Agent。

**Goal:** 在 43863 Vite 新基底实现磁盘权威画布、资产与媒体，同机多浏览器和 MCP 共用数据。
**Architecture:** 提取旧 Go/Gorm/SQLite 必要模块，新前端同源访问 /api/local 和 /api/files，以稳定身份、版本 CAS、operationId 实现提交与恢复。
**Tech Stack:** 现有 Go/Gorm/SQLite、Vite/React Router/TypeScript/Zustand/localforage、Canvas Agent/MCP。
**Spec:** [../../local-workspace-plan.md](../../local-workspace-plan.md)，执行者必须同时阅读。

**Engineering resources:** [编程 Skills、Context7/MCP、代码复用清单](../../local-workspace-engineering-resources.md)，同样必读。Superpowers 只按附件第 7 节读一次；下列任务明确选择编程技能、库文档和代码入口，不重复套流程名称。

## Global Constraints

- 用户已授权在当前仓库实施固定工作区；不迁移或改写活动数据、不清理、不推送、不修改私人画布。
- 正式目标 studio/web、43863 strictPort；43862 旧恢复入口不能代表移植完成。
- 本轮仅修改 Infinite Studio 仓库内的画布页面、配套 Canvas Agent 与工作区服务；独立 Infinite Canvas 项目及其插件/技能文档不在范围内。
- 数据固定 E:/all-agent-workspace/infinite-studio-data；workspaceId 不从端口/Token/账号派生。
- .recovery/studio 仅参考，提取必要服务到 workspace-service/；不移动或覆盖运行目录、不部署第二个 8086。
- 用户已有改动不能回滚；不 git reset/clean/add .；不默认提交/推送 main。
- AGENTS.md 禁止自动执行构建、语法检查和测试。所有未运行的测试与浏览器验收标记 NOT RUN，不以静态审阅代替通过。
- 不静默新增文件大小、超时、重试次数、并发边界；不删用户数据库或浏览器缓存。
- 操作前重新发现 skills 并阅读 SKILL.md；缺失记明。不因计划列出工具就假装工具已存在。

## Current Implementation Status

- 已添加 workspace-service 的严格数据身份校验、单记录 CAS、文件原件 API、维护备份与独立恢复入口，以及固定本地启动配置。
- 已将画布、素材、媒体和保存状态接入本地工作区；Agent/MCP 写入等待 canonical CAS 回执，重放使用 operationId 查询服务端原始写入回执；Agent 图片原件上传使用稳定文件 ID。
- 已添加 ZIP v3 显式预览/校验/逐画布导入；冲突与缺件会拒绝提交，前面已提交的画布会立即进入列表，重选同一 ZIP 可跳过同内容画布后继续；旧整库导入和 WebDAV 整库写入保持禁用，恢复路径仍需运行验收。
- 未运行构建、语法检查、测试或浏览器验收；未启动服务、未迁移数据。任务复选框中的验收项保持未勾选。

## Review Focus

1. hydrate 前空状态写回，任务 4 验证零写入。
2. 提交 A 在途又编辑 B，任务 4 验证 B 不被 A 的回包覆盖。
3. 文件落盘而 DB 失败，任务 3 验证未发布引用、不自动删恢复文件。
4. 嵌套素材/旧 blob URL，任务 5/6 验证映射，不只顶层图片。
5. MCP 页面切换、掉线重试，任务 7 验证目标和 operationId 不漂移。

## Task 0：事实审计与执行条件

**Files:** 读取 AGENTS.md、规格、旧 .recovery/studio 服务模块与新 studio/web；创建 docs/local-workspace-audit.md。
**Produces:** 文件责任地图、数据与端口归属、许可及接口差异。

- [ ] 核对规格/计划及定向测试授权；按资源附件发现实际技能并登记来源/去重。当前阶段读取 executing-plans；其他流程技能按触发使用，不每项全读。
- [ ] 读取 package.json、go.mod 与 lockfile，记录准确依赖版本；按附件列明 REUSE/ADAPT/NEW，不因技能名称引入新数据库/后端/测试器。
- [ ] 确认可用 Context7 resolve_library_id/query_docs 和浏览器工具；技能发现优先复用已有 skills/list 链。缺失写明，不假装工具存在。
- [ ] git status --short；Get-NetTCPConnection 查 43862/43863/8086 并确认进程工作目录；不打印凭证。
- [ ] rg -n 'canvas_apply_ops|applyOps|CanvasSnapshot' studio/web/src canvas-agent/src，登记真实网页工具适配文件；不能猜路径。
- [ ] 查实际数据库、文件和只读 API；记录旧数据未知，不新建同名空项目冒充找回。
- [ ] 读取旧 repository/{local_canvas_project,local_workspace_asset,local_workspace_references}.go、service/local_workspace.go、handler/local_workspace.go、router 和文件依赖，列最小提取闭包及原许可证。
- [ ] 若事实不符，先修改方案，不带错误假设继续编码。

## Task 1：提取服务与稳定工作区身份

**Engineering inputs:** go-concurrency-patterns、api-design-principles--wshobson、database-migration；Context7 查 Gin/Gorm/Go 生命周期与驱动版本；复用旧服务最小闭包，记录身份/鉴权依赖。 具体版本查询、路径及适用限制见资源附件；测试时读取 javascript-testing-patterns（TS）并遵守授权。

**Files:** workspace-service/{go.mod,go.sum,main.go,config,model,repository,service,handler,router} 必要模块；service/workspace_identity.go；根 start-workspace.ps1。
**Interfaces:** GET /api/local/workspace → 规格 WorkspaceInfo；旧本地 API 路径保留。

- [ ] 测试 workspace_identity_test.go：同根重启 ID 相同；已有库保留 local-workspace；manifest/DB 不匹配拒绝；未显式初始化不创建空项目。
- [ ] 获授权后在服务目录 go test ./service -run TestWorkspaceIdentity：RED→最小实现→GREEN。
- [ ] 提取任务 0 依赖闭包，保留声明；默认绝对数据根、回环绑定、Host/Origin/访问身份校验。不能把旧无鉴权接口原样当最终安全契约。
- [ ] workspace.json 与数据库登记一致；旧库版本升级先一致备份，测试副本成功才升级活动库。
- [ ] 启动脚本识别进程归属，端口冲突明确失败，不自动漂移；服务切换先完成在途保存和备份。

## Task 2：逐记录 CAS 与幂等保存

**Engineering inputs:** sql-optimization-patterns、api-design-principles--wshobson、error-handling-patterns；Context7 查 Gorm 条件更新/RowsAffected 与 SQLite 事务/约束；复用旧 repository，明确 CAS SQL 与幂等唯一键。 具体版本查询、路径及适用限制见资源附件；测试时读取 javascript-testing-patterns（TS）并遵守授权。

**Files:** repository/local_canvas_project.go、local_workspace_asset.go、workspace_operation.go；model/workspace_operation.go；service/handler/local_workspace.go 及 tests。
**Consumes/Produces:** 规格 WriteRequest<T>、WriteResult<T>、RecordEnvelope<T>；单项目查询与资产逐记录写入。

- [ ] TestCanvasCASAndReplay：同版本两次不同修改仅一方成功；同 operationId 同摘要重放不加版本；不同摘要冲突。
- [ ] TestAssetCASDoesNotReplaceCollection：更新一条资产不删除另一浏览器新增资产；同资产版本冲突。
- [ ] TestRejectMissingReference、TestDeletedRecordRejectsStaleWrite：缺件拒绝，未知 ID GET 404，不创建。
- [ ] 获授权后 go test ./repository ./service ./handler -run 'Test(CanvasCAS|AssetCAS|RejectMissingReference|DeletedRecord)'，RED/GREEN。
- [ ] SQL 条件更新实现版本检查，不只用进程互斥锁。文档/引用/revision/operation 回执同事务，失败整笔回滚。
- [ ] 旧 bulk sync 不供新 Vite 写入；旧 expected 契约只做受控适配，不绕开统一 CAS。
- [ ] 用 404/409/422/503 明确失败；不返回 200 空数组掩盖错误。

## Task 3：文件原件与引用

**Engineering inputs:** api-design-principles--wshobson、error-handling-patterns，生命周期涉及 Go 时读 go-concurrency-patterns；查 Go/Gin 文件与 Range API；复用旧 file handler，不手写协议或路径解析。 具体版本查询、路径及适用限制见资源附件；测试时读取 javascript-testing-patterns（TS）并遵守授权。

**Files:** 任务 0 确认的旧文件 handler/repository，新增 model/workspace_file.go、service/workspace_file.go 和 tests。
**Interfaces:** POST /api/local/files → {fileId,storageKey,sha256,bytes,mimeType,url}；GET /api/files/:id/content，视频 Range。

- [ ] TestFileUploadReadHash、TestFileRange：回读字节/哈希正确。
- [ ] TestFileCommitFailureDoesNotPublish：rename 后 DB 失败，无 ready 引用，孤立原件报告而非删除。
- [ ] TestFilePathEscapeRejected：路径穿越、越界链接、未知 fileId 拒绝；缺文件不删画布。
- [ ] 获授权后 go test ./service ./handler -run TestFile，RED/GREEN。
- [ ] staging→校验/落盘→数据库登记；只引用 ready。持久化只存稳定 fileId，展示名不作路径。
- [ ] 不自动物理清理媒体；预览可重建，不当原件备份。

## Task 4：Vite 本地模式与提交队列

**Engineering inputs:** typescript-advanced-types、react-state-management、vercel-react-best-practices；Context7 查 Zustand 5 hydrate、Vite 7 proxy、React Effect；沿用 store 类型和 localforage 草稿，不能把 persist 当 canonical ack。 具体版本查询、路径及适用限制见资源附件；测试时读取 javascript-testing-patterns（TS）并遵守授权。

**Files:** services/api/local-workspace.ts；lib/local-workspace/{types,commit-queue}.ts；stores/use-local-workspace-store.ts；现有 stores/canvas/use-canvas-store.ts；vite.config.ts、.env.example。
**Interfaces:** loadWorkspace():Promise<WorkspaceInfo>；getCanvas(id):Promise<RecordEnvelope<CanvasProject>>；commitCanvas(req):Promise<WriteResult<CanvasProject>>。
CommitQueue<T> 暴露 enqueue(data:T):void、flush():Promise<WriteResult<T>>、dirty/saving/saved/error/conflict 订阅状态。按资源串行，同一提交重试保持 operationId。

- [ ] commit-queue.test.ts：testHydrationDoesNotWrite、testEditBPreservedAfterAckA、testReplaySameOperation、testConflictKeepsDraft、testOfflineDoesNotFallback。
- [ ] 获授权后 studio/web 中 bun test ./src/lib/local-workspace/commit-queue.test.ts，RED/GREEN。
- [ ] VITE_STORAGE_MODE=local-workspace 显式选择模式；初始读取 workspace 信息后加载项目，失败不回退空浏览器库。
- [ ] 确认 A 返回只推进 canonical/revision，保留后续编辑 B 并继续提交；Zustand persist setItem 不是保存成功证据。
- [ ] Vite 只转发 /api/local 和 /api/files 到 8086；不泛化代理模型请求。strictPort=43863。
- [ ] 关闭前未保存提示；草稿可 IndexedDB 按 workspaceId/canvasId 留存，但不列为权威项目。

## Task 5：资产与媒体适配、保存状态

**Engineering inputs:** typescript-advanced-types、react-state-management、error-handling-patterns，UI 时读 frontend-design；查 antd 6/React/媒体 API；复用 image-storage/file-storage 与现有生成入口。 具体版本查询、路径及适用限制见资源附件；测试时读取 javascript-testing-patterns（TS）并遵守授权。

**Files:** stores/use-asset-store.ts、services/{image-storage,file-storage}.ts、services/api/local-workspace.ts；lib/local-workspace/media-reference.ts；components/canvas/local-workspace-status.tsx；画布页。
**Interfaces:** loadAssets():Promise<RecordEnvelope<Asset>[]>；commitAsset(req):Promise<WriteResult<Asset>>；uploadFile(blob,filename):Promise<FileReference>；resolveFile(fileId) 返回稳定同源 URL。

- [ ] testSharedAssetUsesOneFile、testMissingMediaKeepsNode、testPersistentDocumentContainsNoBlobURL、testOnlineModeUnchanged；覆盖嵌套引用、生成结果、附件和 text/image/video/audio。
- [ ] 获授权后 bun test ./src/lib/local-workspace/media-reference.test.ts，RED/GREEN。
- [ ] 本地资产逐记录 CAS；先上传原件再保存资产/节点，禁止旧整库 snapshot 覆盖 canonical。
- [ ] 本地模式禁止浏览器 cleanupUnusedImages/Media 删除共享原件；在线模式保持原行为。
- [ ] 页面显示真实目录、workspaceId、保存状态和缺失 fileId，主题 token 与图片比例沿用原版，不改无限虾。

## Task 6：备份优先、显式导入

**Engineering inputs:** typescript-advanced-types、database-migration、error-handling-patterns；Context7 查 fflate/localforage/JSON 校验；复用 canvas-export.ts、canvas-export 类型与 lib/zip.ts；运行时校验不得只用 as。 具体版本查询、路径及适用限制见资源附件；测试时读取 javascript-testing-patterns（TS）并遵守授权。

**Files:** lib/local-workspace/import.ts/import.test.ts；任务 0 确认的现有画布/资产导入文件；服务 import handler/service/repository。
**Interfaces:** `prepareLocalWorkspaceImport(file)` 解析 ZIP v3 并返回冲突/错误预览；`commitLocalWorkspaceImport(plan,onCommitted?)` 逐画布上传原件并使用 CAS 提交，成功一项后立即通知页面更新列表。

- [ ] testImportPreservesIds、testRepeatImportNoDuplicates、testIdCollisionRejectsOverwrite、testMissingFileDoesNotPublishProject、testNestedReferenceMapping。
- [ ] 获授权后 bun test ./src/lib/local-workspace/import.test.ts 与服务对应 TestImport，RED/GREEN。
- [ ] 原浏览器来源完整导出含媒体备份；记录来源配置/域名端口，不能仅导出 JSON 或 blob URL。
- [ ] 预览冲突和缺件；保留 canvas/node/connection/asset ID；不按标题匹配、不自动重新编号。
- [ ] 原件齐全后一次事务提交此次文档/引用，失败不发布半个项目；同 operation 可恢复。
- [ ] canonical 回读数量和 hash；保留来源数据。真实迁移前展示目标/备份/冲突清单取得已有范围内确认，测试不等同真实迁移授权。

## Task 7：Agent/MCP 落盘确认与技能

**Engineering inputs:** typescript-advanced-types、error-handling-patterns、仓库 canvas/open-canvas 技能；Context7 查已安装 MCP SDK 和 Zod 3；复用 canvas-agent-ops.ts、use-agent-bridge.ts、skills/list，不新开写入通道。 具体版本查询、路径及适用限制见资源附件；测试时读取 javascript-testing-patterns（TS）并遵守授权。

**Files:** canvas-agent/src/canvas/{types,schemas,session,operations}.ts 及 session.test.ts/operations.test.ts；任务 0 定位的 Infinite Studio 网页适配器。独立 Infinite Canvas 插件中的 SKILL.md 不属于本轮改动目标。
**Interfaces:** snapshot 携 workspaceId/canvasRevision；成功 ack={workspaceId,canvasId,operationId,revision,persisted:true}；失败 APPLIED_NOT_PERSISTED/WORKSPACE_UNAVAILABLE/CONFLICT。与现有工具响应结构适配。

- [ ] testMcpAckAfterCanonicalCommit：数据库 Promise 未完成时不能成功。
- [ ] testMcpRetryKeepsTargetAndOperation：换焦点/掉线不改 turn 目标、不重复节点。
- [ ] testMcpStorageFailureReported、testMcpWorkspaceMismatchRejected、testUnconnectedCanvasUnavailable。
- [ ] 获授权后 canvas-agent 中 npx --no-install tsx --test src/canvas/session.test.ts src/canvas/operations.test.ts，沿用现有 Node/tsx 测试器，新增 RED/GREEN，保留现有附件/focus 回归。
- [ ] 所有写操作经任务 4/5 提交层；禁止 Agent 直接写 SQLite。clientId/thread/turn 不作为数据主键。
- [ ] Infinite Studio 的 Agent 写操作先读取当前目标；只在 canonical ack 成功后报告完成，失败时保留 operationId 且不重复创建节点。
- [ ] 存储版本独立于 AGENT_PROTOCOL_VERSION，协议变化按现有协商策略处理，不静默破坏旧客户端。

## Task 8：一致备份与隔离恢复

**Engineering inputs:** database-migration、go-concurrency-patterns、sql-optimization-patterns；查 SQLite/WAL 与当前 glebarez/modernc 驱动备份能力；标准库 JSON/SHA256，禁止照抄另一驱动 Backup API。 具体版本查询、路径及适用限制见资源附件；测试时读取 javascript-testing-patterns（TS）并遵守授权。

**Files:** service/workspace_backup.go、handler/workspace_backup.go、workspace_backup_test.go；scripts/verify-workspace-backup.ps1。
**Interfaces:** createWorkspaceBackup():BackupManifest；verifyWorkspaceBackup(path):VerificationReport；restoreWorkspaceBackup(backup,targetRoot):RestoreReport。

- [ ] TestBackupIncludesCommittedDataAndFiles、TestBackupMissingFileFails、TestRestoreHashesAndIdentity、TestUnsupportedSchemaRejected。
- [ ] 获授权后 go test ./service -run 'Test(Backup|Restore|UnsupportedSchema)'，RED/GREEN。
- [ ] 维护窗口暂停新写入/原件登记，完成在途提交，用成熟 SQLite 一致备份；禁止复制活动 sqlite 忽略 WAL。
- [ ] manifest/受引用原件/hash 全核验；失败标不完整，恢复只到独立目录，禁止覆盖活动根。
- [ ] 校验通过才可显式切服务目录，保留原 workspaceId 与原数据。

## Task 9：跨浏览器、重启及失败验收

**Engineering inputs:** javascript-testing-patterns 用于授权后的 TS 行为用例，Go 用既有测试习惯；浏览器 MCP 验收共享数据，官方同源文档解释 origin；前端 bun、Agent Node/tsx，不擅换测试器。 具体版本查询、路径及适用限制见资源附件；测试时读取 javascript-testing-patterns（TS）并遵守授权。

**Files:** docs/local-workspace-verification.md；artifacts/local-workspace/ 证据，无凭证；测试进程只管理自己启动的实例。

- [ ] 独立 fixture：2 画布、共享图片、文本、音频、视频、组及连线；不用收费生成。
- [ ] 内置浏览器保存后，Edge/Chrome 读相同 workspaceId/canvasId，核对节点/连线/fileId/素材与媒体，不是各导入一份。
- [ ] A 修改→B 刷新一致；同版本并发一方明确 conflict 且保留草稿。
- [ ] 重启测试服务与前端、改变临时前端端口仍读同数据；恢复固定端口。
- [ ] 仅清独立测试浏览器缓存后重读完整；不能清用户配置。
- [ ] 断服务/写失败/缺原件不虚假成功、不保存空画布；恢复后重试幂等。
- [ ] 备份恢复至隔离目录，记录/hash 一致；截图保存并展示。
- [ ] 浏览器不可控标 BLOCKED，不以 API 多次读取冒充跨浏览器；每项 PASS/FAIL/BLOCKED/NOT RUN。

## Task 10：文档与私人画布准入

**Files:** CHANGELOG.md Unreleased；docs/content/docs/progress/{todo,pending-test}.mdx；docs/index.md；README.md；规格/计划状态。

- [ ] 简洁标唯一正式入口与磁盘目录，旧恢复入口仅参考；未验收不能宣称统一完成。
- [ ] 完成 todo 移 pending-test；用户确认前不写 features。保留实际未验证项。
- [ ] 自审规格覆盖、接口一致、失败行为及证据；Task 9 未通过不标 complete。
- [ ] 私人画布下一轮只移存储适配/API/启动/必要技能，不带无限虾或旧前端；先核对仓库路径与新授权。

## 给 GPT-6 Luna 的启动提示词

先读 E:/all-agent-workspace/infinite-studio/AGENTS.md、docs/local-workspace-plan.md、本计划和 docs/local-workspace-engineering-resources.md，核对已有执行/测试授权，不重复索取。单执行者先 Task 0，再按依赖推进。按每任务 Engineering inputs 读取真实 TypeScript/React/Go/SQL/API 技能，使用 Context7 先 resolve 再 query，登记安装版本和官方来源；Superpowers 流程按附件一次登记，不冒充编程技能。先查复用表，保留现有类型、ZIP 导入、媒体服务、Agent bridge、Zod/MCP 协议，再做必要调整。目标是 43863 Vite 磁盘共享，不是启动 43862 旧版就完成。不碰私人画布、不推送、不清理。MCP 固定工作区/画布并等 canonical 保存。未授权测试不自动 build/check；未授权真实迁移仅隔离 fixture。每项报告改动、库文档依据、复用/新增原因、证据及未验收项。
