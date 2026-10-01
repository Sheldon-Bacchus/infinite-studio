# 固定本地工作区执行审计

本记录对应当前 `main` checkout 的只读审计与实现决策。审计期间未启动服务、未修改活动数据库、未浏览或导出业务记录，也未执行构建、语法检查或测试。

## 运行状态与数据边界

| 项目 | 已核实结果 | 执行约束 |
| --- | --- | --- |
| 仓库 | `E:/all-agent-workspace/infinite-studio`，本轮复核基线 `e63038e` | 留在当前 checkout；不 reset、clean 或切换 worktree |
| Git 状态 | 工作区保留大量既有 `studio/` 移动/删除及未跟踪文件；本轮复核时暂存区为空 | 不覆盖或提交这些全仓变更；只精确处理本任务文件，不使用 `git add .` |
| `43862` | 最近只读端口检查无监听；旧 Next 页面源码仍在恢复目录 | 不启动、不替换、不运行 `start-studio.ps1` |
| `8086` | 最近只读端口检查无监听 | 不启动服务；本地数据缺少 manifest，服务按设计拒绝打开 |
| `43863` | 最近只读端口检查无监听 | 新 Vite 模式配置严格使用该端口，不自动漂移 |
| 固定数据根 | `E:/all-agent-workspace/infinite-studio-data`；现有 `workspace.sqlite` 659456 字节、`files/` 为空；缺少 manifest、staging、previews、backups | 不更改或迁移活动目录；启动新服务必须拒绝无 manifest 的旧库 |
| SQLite 只读检查 | `integrity_check=ok`、journal mode `delete`；1 条 `canvas_projects`、2 条 `local_workspace_assets`，工作区键为 `local-workspace` | 只保留条数和结构证据；不能据此宣称内容、媒体或旧数据恢复完整 |
| 旧 API 只读检查 | 上次检查时 `/api/local/workspace` 为 404，画布/素材列表分别为 200、1 项/2 项；当前 43862、43863、8086 均无监听 | 旧 API 没有 manifest、revision 或 operationId 契约；当前无法复核服务端行为 |
| 私人画布 | 不属于本轮工作区 | 不访问、不迁移、不写入 |

`start-studio.ps1` 是用户既有未跟踪文件，目标为 `.recovery/studio`。本轮不读取秘密、不修改该脚本，也不关闭用户浏览器标签。

## 代码入口与复用决策

| 层 | 入口 | 决策 |
| --- | --- | --- |
| Go/SQLite 旧服务 | `.recovery/studio/repository/db.go`、`service/local_workspace.go`、`repository/local_canvas_project.go`、`repository/local_workspace_asset.go`、`repository/local_workspace_references.go`、`handler/local_workspace.go`、`service/local_storage.go` | **ADAPT** 接口和 SQLite 表形状；不直接复用旧 DB 初始化，因为 `DB()` 启动时会对全库 `AutoMigrate`，并且旧文件删除逻辑会物理删除媒体 |
| 新 Go 服务 | `workspace-service/` | **NEW** 最小独立工作区服务；只打开既有 SQLite 表，不带旧前端、帐户、DramaClaw 或云端存储业务；沿用 Go/Gorm/SQLite 技术栈 |
| Canvas 状态 | `studio/web/src/stores/canvas/use-canvas-store.ts`、`studio/web/src/pages/canvas/index.tsx`、`studio/web/src/pages/canvas/project.tsx` | **ADAPT** 现有 Zustand store；以服务回读 hydrate，按单记录提交；localforage 只保留草稿/在线模式用途 |
| 素材与媒体 | `studio/web/src/stores/use-asset-store.ts`、`services/image-storage.ts`、`services/file-storage.ts`、`lib/canvas/canvas-generation-helpers.ts` | **ADAPT** 现有生成、预览、ZIP 媒体入口；本地模式把原件上传服务并持久化 `fileId`，不运行 IndexedDB 原件清理 |
| ZIP | `studio/web/src/types/canvas-export.ts`、`lib/canvas/canvas-export.ts`、`lib/zip.ts`、`lib/local-workspace/import.ts` | 复用 v3 导出格式；新增本地模式预览、冲突/缺件校验与逐画布 CAS 导入，旧整库写入口保持禁用；仍需验证部分失败后的恢复 |
| Agent bridge | `studio/web/src/lib/canvas/canvas-agent-ops.ts`、`pages/canvas/hooks/use-agent-bridge.ts`、`canvas-agent/src/canvas/{session,schemas,operations}.ts`、`/api/local/operations/:operationId` | **ADAPT** 现有页面和 turn 定向协议；本地写入等待 CAS 回执，重放使用稳定 operationId 和服务端只读回执核验；未做运行验收 |
| 保存提示 | `studio/web/src/stores/use-local-workspace-store.ts`、`components/canvas/local-workspace-status.tsx` | **NEW** 保存/连接状态是跨页面服务状态，现有 canvas theme tokens 负责外观 |
| 数据结构与队列 | `studio/web/src/lib/local-workspace/{types,commit-queue,media-reference,import}.ts` | **NEW** 明确 envelope、逐条 CAS、operation 重放与 fileId 转换；前端没有 Zod 直接依赖，不额外引入 |
| 本地模式启动 | `studio/web/vite.config.ts`、`.env.local-workspace.example`、`start-workspace.ps1` | **ADAPT/NEW** 只代理 `/api/local` 与 `/api/files`；非 `VITE_` 访问凭证仅由 Vite 开发代理加入 header |

### 许可与依赖闭包

- `.recovery/studio` 声明 Go module `github.com/tigerowo/infinite-canvas`，许可为 AGPL-3.0；仓库根目录为 MIT。仅提取或派生的 Go 工作区模块需独立保留 AGPL 许可边界，不把旧全栈代码复制进主应用。
- Go 实际版本为 1.25.0；旧服务已固定 Gorm 1.31.1、`glebarez/sqlite` 1.11.0、其传递 SQLite 驱动 `modernc.org/sqlite` 1.23.1。Go `database/sql` 没有独立 Context7 package 条目，使用 Go 官方标准库文档。
- Web 已安装 TypeScript 5.9.3、React 19.2.5、Zustand 5.0.12、Vite 7.3.6、React Router 7.18.0、Ant Design 6.4.2、fflate 0.8.3、localforage 1.10.0。Agent 使用 TypeScript 5.9.3、Zod 3.25.76、MCP SDK 1.29.0、tsx 4.22.4。均不自动升级。
- Context7 按先 resolve 后 query：Zustand `/pmndrs/zustand/v5.0.12`（人工 hydrate 不代表服务端确认）；Vite `/vitejs/vite/v7.3.1`（只匹配前缀代理、`strictPort`、仅 `VITE_` 暴露给浏览器）；Gorm `/go-gorm/gorm.io`（事务、RowsAffected 与 map updates）；Gin `/websites/gin-gonic_en`；SQLite `/websites/sqlite_docs`；Go `/golang/go/go1_25_0`；React `/react/react`；localforage `/localforage/localforage`；fflate `/101arrowz/fflate`；Zod 3 `/websites/v3_zod_dev`；MCP SDK `/modelcontextprotocol/typescript-sdk/v1.29.0`。
- Ant Design 安装版是 6.4.2；Context7 找到 6.5.0 文档，版本不完全匹配。按根 `AGENTS.md` 打开了官方 [Ant Design 全量文档](https://ant.design/llms-full.txt)，实现时还须参考本地 6.4.2 类型与现有调用。
- `modernc.org/sqlite@v1.23.1` 暴露的主包没有 SQLite online backup API；不照搬 `mattn/go-sqlite3` 的驱动专属 Backup。备份使用 SQLite 官方 `VACUUM INTO` 一致快照，并在隔离恢复目录检查数据库、manifest 与文件 SHA-256。
- Ant Design MCP 文档仅作为组件 API 来源；不为简单保存状态提示额外引入组件或覆盖全局主题 token。

## 实现边界与验证状态

- 固定标识沿用 `local-workspace`。浏览器端口、clientId、threadId、turnId 与文件/业务 ID 分离。
- 启动读取缺失 manifest、未知 schema、manifest/DB 身份冲突或缺少凭证时必须失败，禁止悄悄创建空画布或自动回退到 IndexedDB。
- 旧活动数据库必须先一致备份、复制到隔离目录、预演迁移，再由用户显式切换；本轮不运行迁移命令，也不登记活动库身份。
- 资产不可通过整库快照覆盖；画布和资产使用逐记录 revision CAS 与 operationId 幂等回执。版本冲突和服务不可用保留草稿。
- 文件按 staging → 哈希/校验 → 磁盘落盘 → ready 登记；失败残留用于人工检查，不能自动清理。只有 ready `fileId` 可写入 canonical 记录。
- 备份期间暂停写和文件登记；备份可恢复到独立且空的目标目录。WAL 或 DB 文件直接复制不作为一致备份。
- 不增加上传大小限制、超时、重试次数、并发上限；不真实导入现有浏览器素材，不启动/替换服务。
- ZIP v3 导入与 Agent/MCP 的 operationId 持久回执校验已加入代码；跨项目中途失败恢复和运行行为未验收。Agent 图片素材使用稳定 fileId，重试不应生成重复原件。
- **所有构建、类型检查、测试、浏览器验收均为 NOT RUN**，遵循本任务执行约束；跨浏览器、重启及隔离恢复未验收。
