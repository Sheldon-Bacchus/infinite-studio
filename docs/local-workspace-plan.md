# 无限片场固定本地工作区设计规格

状态：实现中。用户已授权在本仓库实现固定本地工作区；不得迁移或改写现有数据。服务、单记录 CAS、媒体文件、ZIP v3 预览导入和 Agent 持久回执已有代码初版；构建、测试、启动和运行验收均未执行。详细状态见[执行计划](superpowers/plans/local-workspace-implementation.md)。

## 1. 目标与非目标

目标：在同一台电脑使用 Edge、Chrome 和 Codex 内置浏览器，打开同一个 workspaceId/canvasId，读到同一份节点、连线、文本和媒体原件。重启前端、服务或改变前端端口不改变业务身份。保存状态必须反映本机服务已确认提交；并发修改不静默覆盖。

本轮只在无限片场仓库的 `studio/web` 画布与配套 `canvas-agent`、`workspace-service` 实现。独立 Infinite Canvas 大项目、其插件目录和技能文档均不在改动范围内；将来若要移植或修改，需另行授权。当前不扩展无限虾工作流，不复制 DramaClaw 全套页面，不改变模型提供商、MCP 生成行为、计费或用户密钥存储。

## 2. 当前事实与未验证事项

| 范围 | 已核实事实 | 不能据此宣称 |
| --- | --- | --- |
| 43863 | studio/web，Vite/React Router，basketikun v0.19.0；画布/资产/媒体来自浏览器 localforage | 已使用磁盘权威存储 |
| 43862 / 8086 | 旧 Next/Go 入口与旧 API；最近只读端口检查均无监听 | 服务正在运行或新旧入口已经合并 |
| 43863 | 当前 Vite/React Router 基底；最近只读端口检查无监听 | 已完成固定工作区运行验收 |
| 本机数据 | E:/all-agent-workspace/infinite-studio-data 存在旧 SQLite；files/ 为空，缺 workspace.json、staging、previews、backups | 已找回旧项目或通过跨浏览器、重启验收；新服务可直接打开旧库 |
| 新工作区服务 | workspace-service/ 已添加严格身份校验、单记录 CAS、文件 API 与维护备份入口 | 活动数据库已登记、数据已迁移或备份恢复已验收 |
| 旧完整备份 | 先前备份目录现在不在原路径；Git 可恢复已提交源码 | 可恢复未提交源码、原数据库或原件 |
| MCP | 当前 Agent 会话管理 clientId、画布快照和待确认操作 | clientId/Connect Token 是持久数据身份 |

代码改动前重新核验目录、Git status、监听进程及文件。禁止凭本文启动描述判断服务仍在线。缺失旧数据记为未知，不创建同名空项目冒充恢复。

## 3. 方案选择

A：继续 IndexedDB，固定端口。只能减少来源变化，不能让不同浏览器共享，淘汰。
B：WebDAV 同步浏览器副本。可做备份/同步，但依然存在多副本冲突，不满足本机唯一权威数据目标，本期不采用。
C：本机 SQLite + 文件原件，浏览器通过 API 读写。选用此方案，优先复用旧服务，补齐身份、版本、幂等、文件和恢复契约。

不创建第二个 Go 数据库服务。将旧服务必要源码提取到稳定的 workspace-service/，保持当前 Go/Gorm/SQLite 技术栈，不把 .recovery 当长期生产目录。保留旧服务模块声明和许可证；不要整体复制旧前端或重写为另一语言。8086 只允许一个已确认的工作区服务实例，实验期间旧页和新页可同时读取服务。

## 4. 存储与身份

固定默认数据根：E:/all-agent-workspace/infinite-studio-data。它位于 Git checkout 外。页面显示真实路径及 workspaceId。

```text
infinite-studio-data/
  workspace.json
  workspace.sqlite
  files/
  previews/
  staging/
  backups/
```

workspace.json 保存 schemaVersion、workspaceId、product=infinite-studio。只在明确初始化时创建一次。数据库保存一致身份；不一致或未知格式拒绝加载。现有数据库已使用 local-workspace，因此此次登记保留这个 ID，不静默更换为随机 UUID；新工作区才生成 UUID。备份还原是同一身份的独立恢复，克隆为新工作区需另行显式命令，不在本期增加。

| ID | 定义 | 禁止用途 |
| --- | --- | --- |
| workspaceId | 当前数据根中的稳定数据域 | 不从端口、账号、Cookie、token 派生 |
| canvasId | 画布永久主键，允许 nanoid | 打开不存在 ID 不能自动新建 |
| assetId | 统一素材库记录 ID | 不按标题自动合并 |
| fileId | 原件记录 ID，指向受控相对路径及校验信息 | blob URL 不作为永久地址 |
| nodeId | 画布内节点 ID | 不替代素材或文件 ID |
| revision | 记录服务端提交版本 | 不以客户端时间戳代替并发版本 |
| operationId | 一次逻辑提交身份 | 断网重试不能另生成新身份 |
| clientId/threadId/turnId | 页面连接与 Agent 对话归属 | 不决定项目/素材数据位置 |

ID 可查到确切记录不等于素材与画布一对一。一个 asset/file 可以被多个节点或画布引用，原件不因此复制多份。引用是明确字段；旧 storageKey 到 fileId 的映射在迁移时保存，不通过字符串标题猜测。

## 5. 数据与接口契约

沿用旧 /api/local/canvas/projects、/api/local/assets、/api/local/files 和原件读取路由，避免另建同义 /api/workspace/canvases 接口。新增 GET /api/local/workspace、GET /api/local/canvas/projects/:id 与 GET /api/local/operations/:operationId（读取已提交操作回执）；逐记录读写与版本接口在现有路由上扩展。

统一响应沿用 {code,data,msg}，并明确 HTTP 404/409/422/503 与应用错误码，不把错误用 200 空数组隐藏。

WorkspaceInfo = {schemaVersion:1,workspaceId:string,dataRoot:string,storage:'sqlite',serviceInstanceId:string}。serviceInstanceId 每次启动变化，只用于识别连接变化，不改变 workspaceId。

RecordEnvelope<T> = {workspaceId:string,id:string,revision:number,data:T}。
WriteRequest<T> = {workspaceId:string,operationId:string,baseRevision:number|null,data:T}。
WriteResult<T> = RecordEnvelope<T> & {operationId:string}。

- 新建 baseRevision=null，只允许 ID 尚不存在。更新必须匹配当前 revision，成功增加 1。
- 相同 operationId、相同请求摘要重放返回原结果；相同 operationId 不同摘要返回冲突。页面重载后通过只读操作回执端点确认原提交，不能用当前 revision 或客户端状态冒充操作确认。
- 写入画布文档、引用、版本与 operation 结果在同一数据库事务。expected 旧契约可作为提取参考，新 Vite 只使用明确 revision；恢复旧页仅在迁移期通过受控适配器使用，不能绕过统一冲突校验。
- 资产也按记录 CAS，不能上传旧浏览器整库快照覆盖服务中新增资产。旧 bulk sync 未完成安全审查前不得作为新模式写入路径。
- files 记录至少含 id、workspaceId、relativePath、sha256、mimeType、bytes；用户文件名只作为展示属性。
- 文件先写 staging、校验并完成落盘，再事务登记为 ready；节点只能引用 ready 文件。文件系统和 SQLite 不是同一个事务：崩溃可能留下孤立原件，启动检查将其记录待处理，禁止误删。不得宣称二者原子提交。
- GET 原件接口支持图片/音频读取、视频 Range；响应失败保留节点并标注 fileId。路径由服务生成，拒绝路径穿越、工作区外文件与符号链接逃逸。
- 初期不自动物理清理原件，不新增重试次数、并发上限、文件大小上限或超时值；确需边界先说明默认值和失败行为，再取得确认。

## 6. 前端本地模式

studio/web 仍是 Vite/React Router。新增 services/api/local-workspace.ts 承担 API；stores 管共享业务状态；services/image-storage.ts、file-storage.ts 在本地模式使用原件 API。在线浏览器模式保持原逻辑。模式由启动配置显式决定，服务故障不自动切换模式。

固定 127.0.0.1:43863 为本地新基底入口，strictPort；Vite 同源转发 /api/local 与 /api/files 到 8086。保持在线模型请求浏览器直连，不将所有 /api 或外部模型 URL 泛化代理。后端与前端端口没有数据身份含义。

状态：loading → ready；编辑 clean → dirty → saving → saved；失败为 error，版本冲突为 conflict。保存中的编辑 B 不能被较早提交 A 的返回覆盖：A 仅推进确认版本，B 继续 dirty，再以 A 的新版本提交。按资源串行提交，不全局阻塞所有画布。

页面初始 hydrate 完成前禁止写入空状态。不得用 Zustand persist 的 setItem 返回完成代表 canonical 保存。服务不在线显示工作区未连接并保留草稿；关闭前提示未保存。草稿可存在 IndexedDB 作为恢复材料，不能冒充权威项目。workspaceId 与 canvasId 纳入草稿键。

页面显示数据目录、workspaceId、画布保存状态；缺文件显示媒体缺失，不能删除整个节点。图片原始比例及原版主题保持不变。不增加无限虾页面或模型生成操作。

其他浏览器刷新后读取最新版本是第一期必达；自动实时同步不是默认承诺。若补充 SSE/通知，其事件仅使缓存失效并重新读取 canonical，不以事件快照直接覆盖未保存草稿。

## 7. Agent、Skills 与 MCP

Agent 是内容和操作执行者；skills 是操作规程；MCP 是调用通道；工作区服务才是权威存储。模型型号、订阅和连接 token 都不替代数据库。

沿用 canvas-agent/src/canvas/session.ts 的当前页面/turn 绑定。操作前 canvas_get_state，需要选区时 canvas_get_selection。不能给清理线程、另一浏览器或最后焦点画布误发操作。网页缺连接时返回明确 unavailable，不靠端口猜测目标。

当前协议只确认工具在页面执行，不等于服务已保存。新增本地模式持久确认：Snapshot 包含 workspaceId、canvasRevision；写工具成功返回 workspaceId、canvasId、revision、operationId、persisted=true，只有 canonical 保存成功才能返回。内存队列丢失后使用 GET /api/local/operations/:operationId 读取服务端原回执，并校验工作区、记录和操作身份。网页已应用但未落盘应报告 applied-not-persisted 并保留 operationId；MCP 不应因重试重复创建节点。

读取失败不可制造空画布。MCP 创建、更新、连线、删除与 UI 都经过同一提交层，不允许 Agent 直接改 SQLite。媒体 assets_add/附件经过统一文件上传与素材存储；连接会话中 dataURL 不是永久引用。

MCP 在本地模式拒绝对未知 workspaceId 或错 canvasId 操作。clientId 是路由线索，不是保存主键。不要把业务存储版本绑定 AGENT_PROTOCOL_VERSION=6；新增持久确认字段如改变兼容协议，应按现有协议协商策略升级并测试，不能静默破坏旧客户端。

执行者先读根 AGENTS.md、子目录规则与[编程 Skills、文档 MCP 和代码复用清单](local-workspace-engineering-resources.md)。该清单是实施必读附件，已列出本机找到的 TypeScript、React 状态、Go 并发、SQL、API、错误处理、导入与测试技能，及各任务的 Context7 查询问题、版本依据和复用文件。

Superpowers 流程只在附件第 7 节登记一次，不在每个任务重复列举。编程技能不能由流程技能替代；实际执行前阅读选中 SKILL.md，Context7 先解析 libraryId 再查询，与安装版本核对。未知 JSON 必须做运行时校验，不能用 TypeScript 类型断言假装校验完成。SQL 技能的 PostgreSQL 示例不得照搬进 SQLite。

本期不修改模型配置，不安装另一个全局 MCP，不创建凭证或触碰私人画布。连接口令不得写文档、日志截图或业务记录。HTTP 仅回环绑定，校验 Host/Origin 和访问身份；旧本地 API 无鉴权能力不能直接沿用为最终安全契约。沿用成熟验证机制，工作区凭证与 MCP token 分离。

## 8. 旧数据导入

先记录浏览器、配置、协议/主机/端口、来源项目 ID 和素材数量。在原有来源页面导出包含媒体的备份，不能只保存 JSON/blob URL。权限不足或原件已缺失，明确列缺项，不能标为迁移成功。

显式预览 → 校验 → 导入 → canonical 回读核验。保留 canvasId、nodeId、connectionId、assetId；文件进入磁盘后重写稳定 fileId 映射。相同内容重复导入幂等跳过；同 ID 不同内容显示冲突、拒绝覆盖，本期不提供自动重新编号策略。所有文件上传完成后一次事务提交此次文档与引用；失败不发布半个项目。暂存文件可保留作恢复，不自动删除。

旧浏览器数据和备份保留，验证完成后也不自动清理。旧 .recovery 数据库存量需先备份，再按受控版本升级登记，升级失败不在原库上反复试验。GPT-6 Luna 不允许执行全盘清理或按目录名删除所谓冗余项目。

## 9. 备份与恢复

SQLite 使用一致快照机制，不能运行时简单复制 workspace.sqlite 忽略 WAL。选择维护备份窗口暂停新写入和文件登记，完成已在途提交，再通过成熟 SQLite 备份能力导出数据库和 manifest、受引用文件清单及 SHA-256。写入中断、文件缺失、哈希不一致均使备份标为失败，不展示成功。

恢复先到独立测试目录校验，不覆盖活动工作区；确认 manifest/db 身份、格式及原件哈希匹配后才可显式切换服务数据根。改路径后服务读取原 workspaceId，不新建身份。跨电脑恢复不在本期保证范围。

## 10. 验收与授权边界

用户已授权在当前仓库实现固定本地工作区。授权范围不包括迁移或改写活动数据、启动/停止服务、私人画布或无限虾改动。根 AGENTS.md 禁止自动构建、语法检查与测试；未执行的代码和运行验收均标记 NOT RUN，不得用静态审阅冒充通过。

必达验收：Edge、Chrome、内置浏览器同一工作区读取一致画布/素材/媒体；修改后另一端刷新一致；并发旧版本失败不覆盖；重启前后 ID 不变；测试浏览器缓存清理不影响磁盘数据；断服务/写失败/缺文件不虚假保存；重复导入无副本；一致备份在独立目录恢复并通过哈希。

浏览器工具不可用时，只能完成 API/仓库级证明，跨浏览器标 BLOCKED，不能称完成。用户现有标签不关闭；缓存破坏测试仅新建隔离测试配置，不能清空用户浏览器。

当前剩余工作：在允许的验收条件下检查 ZIP 中途失败后页面状态和重试恢复、构建、服务启动、跨浏览器、重启、并发冲突、Agent/MCP 重放和隔离备份恢复。真实数据迁移必须另行取得明确指示，并先给出备份及冲突清单。
