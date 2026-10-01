# 本地工作区：编程 Skills、文档 MCP 与代码复用清单

这是 GPT-6 Luna 执行计划的必读附件。状态为设计稿，未执行产品改造。本文将编程技能、文档查询工具、画布操作工具和开发流程分开；Superpowers 只在最后登记一次，不逐任务重复罗列。

## 1. 实际技术栈，先核对再写

| 层 | 本仓库依据 | 本期使用 |
| --- | --- | --- |
| 前端 | studio/web/package.json | TypeScript 5、React 19.2.5、Zustand ^5.0.12、Vite ^7.3.0、React Router ^7.12.0、antd ^6.4.2 |
| 旧存储服务 | .recovery/studio/go.mod | Go 1.25、Gin 1.11.0、Gorm 1.31.1、glebarez/sqlite 1.11.0、modernc SQLite 驱动链 |
| Agent/MCP | canvas-agent/package.json | TypeScript ^5.8.0、MCP SDK ^1.12.1、Zod ^3.25.0、Express ^5.1.0 |
| 导出与浏览器存储 | studio/web/package.json | fflate ^0.8.3、localforage ^1.10.0 |

JSON 是交换/序列化格式，TypeScript 是前端和 Agent 编程语言，Go 是拟复用的存储服务语言，SQL 是数据库查询语言。不要把 JSON 当成后端语言，也不要为了使用某个 skill 更换后端或数据库。上表的 ^ 范围不是安装精确版本；Task 0 读取 lockfile 和实际安装记录后登记准确版本，不执行自动升级。

## 2. 已找到的编程技能及任务用途

用户级技能根为 C:/Users/ldc/.codex/skills/；以下名称、文件存在和适用描述已经核对。执行者在真正使用前读取完整 SKILL.md 及相关引用，不把本轮目录核对写成“已执行全部技能”。

| 技能文件（相对用户级根） | 使用任务 | 具体产物与限制 |
| --- | --- | --- |
| typescript-advanced-types/SKILL.md | 4、5、6、7 | 复用 CanvasProject/Asset 类型；定义 RecordEnvelope、WriteRequest、保存状态判别联合，API 外部数据先为 unknown；只用需要的泛型，不堆复杂类型 |
| react-state-management/SKILL.md | 4、5 | 区分 canonical 服务状态、当前编辑草稿、UI 状态；沿用 Zustand；hydrate 不写空数据，A 回包不覆盖 B 编辑；不另装 Redux/Jotai |
| go-concurrency-patterns/SKILL.md | 1、2、3、8 | 服务停止、在途写入、备份维护窗口和 context 生命周期；数据库 CAS 仍用事务/条件 SQL，不能用 Mutex 代替数据库一致性；不引入无需求 worker pool |
| sql-optimization-patterns/SKILL.md | 2、8 | 复合唯一约束、引用索引、按主键/CAS 查询检查；SQLite 使用 EXPLAIN QUERY PLAN，禁止照搬 PostgreSQL GIN/JSONB/EXPLAIN ANALYZE 语法；不是无依据性能优化 |
| api-design-principles--wshobson/SKILL.md | 1、2、3、6 | 既有接口的 HTTP 语义、404/409/422/503、文件读取和幂等提交；保留项目 {code,data,msg}，不重命名全套路由、不引入 GraphQL |
| error-handling-patterns/SKILL.md | 2、4、5、7 | 结构化失败：冲突、服务不可用、缺原件、已应用未落盘；保留草稿与操作身份；不静默增加自动重试/熔断/超时 |
| database-migration/SKILL.md | 1、6、8 | 仅提取备份、转换校验、回滚到副本的原则；实际执行 SQLite/Gorm 方案，不照搬 Sequelize/Prisma，不写无需求旧字段兼容 |
| javascript-testing-patterns/SKILL.md | 4、5、6、7 | 隔离 fixture、延迟提交 Promise、失败和并发行为用例；沿用现有测试器，不因技能示例安装 Jest/Vitest；测试执行遵循授权 |

仓库级技能根为 E:/all-agent-workspace/infinite-studio/.agents/skills/：

- vercel-react-best-practices/SKILL.md：任务 4/5 的订阅和 React 数据流，选择适用条目；当前是 Vite，不套 Next 服务组件架构。
- frontend-design/SKILL.md：任务 5 的保存状态/目录信息，使用现有画布主题；涉及 antd 先读 https://ant.design/llms-full.txt，匹配实际版本。

仓库插件技能：plugins/infinite-canvas/skills/canvas/SKILL.md、open-canvas/SKILL.md 用于任务 7/9 的画布目标与操作；新 local-workspace/SKILL.md 是待实现产物，不是已经安装的能力。

候选排除：nodejs-backend-patterns、postgresql、dotnet-backend-patterns 虽有本地文件，本期 Go/SQLite 存储不能因此改成 Node/PostgreSQL/.NET。未找到专门匹配的通用 JSON 校验或 SQLite 编程 skill，不虚构名称；这两项使用现有 Zod/Go JSON 和官方文档。

## 3. 技能发现、同名去重与 Agent 内复用

Luna 在 Task 0 执行以下只读发现，结果写入 docs/local-workspace-audit.md：

```powershell
rg --files C:/Users/ldc/.codex/skills C:/Users/ldc/.codex/plugins/cache E:/all-agent-workspace/infinite-studio/.agents E:/all-agent-workspace/infinite-studio/plugins | rg 'SKILL\.md$'
rg -n -i 'typescript|sqlite|sql|gorm|golang|json|schema|react|zustand|api|import|export|find.skills|search.skills' C:/Users/ldc/.codex/skills --glob SKILL.md
```

先按工作任务筛选，再读 name/description 和正文；记录实际绝对路径、适用任务、取用条目、排除原因。同 name 的不同来源保留来源区分，例如 api-design-principles--medical 与 --wshobson 不能当成两次必须执行的流程；本期指定后者。用户级重复安装和插件缓存版本只选一个适用副本，不一遍遍读。

目前未在上述目录发现专用 find-skills/search-skills 的 SKILL.md，不把它写成已经可调用的技能。执行环境如新增搜索技能，可先发现再读取；本期不安装外部技能包。仅目录存在也不代表当前模型已获得技能调用权限。

应用已有 Agent 技能发现链，先读：

- studio/web/src/services/api/canvas-agent.ts：fetchCodexSkills、fetchCodexSkill。
- canvas-agent/src/agent/codex-client.ts：listSkills 调用已有 skills/list，支持 forceReload。
- canvas-agent/src/skills/store.ts：技能读取/修订管理。

这是现有应用协议，不是任意环境里可直接调用的同名 MCP 工具。需要应用内展示或读取技能时复用这条链，不另造全局扫描后台、不复制技能全文进业务数据库。能力缺失写明文件级发现结果即可，不触碰凭证。

## 4. Context7：文档查询 MCP，必须落到任务

本会话实际可发现：mcp__context7__resolve_library_id、mcp__context7__query_docs。执行环境重新发现；不能把“已配置”与“查询已成功”混为一谈。

查询顺序：读取 package.json/go.mod/lockfile → resolve_library_id({libraryName,query}) → 选择对应官方库及精确版本 → query_docs({libraryId,query})。不得猜 libraryId；仅用户明确提供 ID 时可直接查询。没有精确版本则记录限制，转官方版本文档。每个技术问题遵守工具调用次数限制，不用一个宽泛查询塞全部库。

| 任务 | 库/官方文档 | 查询问题 | 必须记录的实现决策 |
| --- | --- | --- | --- |
| 1、2 | Gin、Gorm、Go database/sql | 事务回滚、条件 Updates 的 RowsAffected、唯一约束、请求校验与停止服务 | CAS 真正在事务内；零更新如何报冲突；不把 Gorm 零值更新规则猜错 |
| 2、8 | SQLite + glebarez/sqlite/modernc 驱动 | 写事务隔离、busy 错误、外键启用、WAL 与一致备份、实际驱动支持的备份方式 | 选用能由当前驱动执行的一致备份；不抄 mattn cgo 驱动独有 Backup API；busy 明确失败，不静默自定重试 |
| 4 | Zustand 5 | persist 的 skipHydration、rehydrate、hasHydrated、异步存储生命周期 | 仅为草稿/在线模式参考；canonical 保存独立等待服务确认；skipHydration 本身不能证明零写入 |
| 4 | Vite 7 | server.proxy 路径匹配、strictPort、环境变量暴露范围 | 只代理两类本地路径；VITE_ 变量进入浏览器，不能放秘密 |
| 4、5 | React 19、React Router 7 | Effect 清理、外部 store 订阅、离开页面前未保存处理 | 避免重复订阅；浏览器关闭提示不能承诺阻止所有退出 |
| 5、6 | localforage 1、fflate 0.8 | Blob 读取、导出/解包、已有 zip 包格式 | 完整导出原件；复用 lib/zip.ts，禁止手写 ZIP 解析 |
| 6、7 | Zod 3、TypeScript 5、Go encoding/json | 外部 JSON 校验、safeParse 错误、协议联合类型、数值/未知字段处理 | TS 类型断言不是运行时校验；Agent 用已有 Zod 3，不复制 Zod 4 API；前端未安装 Zod，不静默跨包新增依赖 |
| 7 | MCP TypeScript SDK 对应安装版本 | 工具结果失败表达、schema 定义、连接断开/请求归属 | 区分协议错误与业务未落盘，复用既有 schema/响应结构 |
| 9 | 浏览器同源与 IndexedDB 官方文档 | origin 对端口/浏览器配置的隔离、blob URL 生命周期 | 解释现象；验收仍要求真正多个浏览器读同一服务，文档查询不代替测试 |

本轮已通过 Context7 查询 /pmndrs/zustand/v5.0.12 的 persist 文档，定位到 skipHydration 与手动 rehydrate。官方依据：https://github.com/pmndrs/zustand/blob/v5.0.12/docs/reference/integrations/persisting-store-data.md 。这是方案依据，不代表代码已接入或测试通过。

未通过 Context7 查询过的条目全部是执行时查询清单。Context7 不可用/缺库时，用 web MCP 查询官方资料并保存直达链接：SQLite https://www.sqlite.org/docs.html 、Gorm https://gorm.io/docs/ 、Go https://pkg.go.dev/ 、Vite https://vite.dev/guide/ 、MCP SDK 官方仓库。只取与安装版本匹配的 API，不用第三方教程作为关键行为唯一证据。

每个实现任务的审计记录须含：库及安装版本、真实查询参数、返回 libraryId、官方来源链接、采用的 API、与现有实现差异。查询内容不得上传业务脚本、用户素材、API Key/token 或本机隐私。

## 5. 复用代码、文件格式和依赖清单

| 任务 | 先读并优先复用 | 允许的调整 |
| --- | --- | --- |
| 1、2、3 | .recovery/studio/service/local_workspace.go、repository/local_canvas_project.go、local_workspace_asset.go、local_workspace_references.go；handler/local_workspace.go 与既有文件模块 | 提取最小 Go 依赖闭包，补身份、逐记录 CAS、幂等与鉴权；不搬全部旧业务 |
| 4 | studio/web/src/stores/canvas/use-canvas-store.ts、lib/localforage-storage.ts | 复用项目结构/动作，拆清 canonical 确认与草稿持久化，不重写画布 |
| 5 | stores/use-asset-store.ts、services/image-storage.ts、file-storage.ts；services/api/audio.ts 的 storeGeneratedAudio | 保留媒体调用入口，统一磁盘 fileId，复用上传路径；嵌套素材引用也要覆盖 |
| 6 | studio/web/src/types/canvas-export.ts、lib/canvas/canvas-export.ts、lib/zip.ts；旧项目 import/reference 校验 | 沿用 ZIP/manifest 格式、媒体遍历和引用规则；新增磁盘导入预览/冲突结果，不再造第二个导出格式 |
| 7 | studio/web/src/lib/canvas/canvas-agent-ops.ts、pages/canvas/hooks/use-agent-bridge.ts、services/api/canvas-agent.ts；canvas-agent/src/canvas/{types,schemas,session,operations}.ts | 同一网页执行层加入 canonical ack；保持 thread/turn/item 归属，不开第二条操作通道 |
| 7 | canvas-agent 的 zod、@modelcontextprotocol/sdk、现有 Skill 管理 | 沿用 schema 校验和工具注册，不再装另一个全局 MCP |
| 8 | 当前 Go SQLite 驱动链、已确认的文件/hash 模块 | Go 标准库 crypto/sha256、encoding/json、受控文件 API；备份机制查驱动文档，不手写 SQLite 页格式 |

Task 0 给每项标 REUSE / ADAPT / NEW 并说明 NEW 必要性。文档/API/TypeScript/schema 多处表达同一契约时，沿用已有共享入口；没有跨语言代码生成设施则保持最小显式契约与一致性用例，不引入大型生成系统。不要因“复用”直接导入旧 Next 前端组件到 Vite。

## 6. MCP 职责划分与验收证据

- Context7 MCP：查库文档，不读写业务数据。
- Infinite Canvas MCP：现有 canvas_get_state、canvas_get_selection、canvas_apply_ops；先确认目标，任务 7 实现后等 canonical ack。本文未调用它们修改当前画布。
- 浏览器控制 mcp__cua_repl：任务 9 检查页面状态和隔离测试页；可用浏览器能力不足则标 BLOCKED，不关闭用户标签。
- exec_command / apply_patch：代码读取和修改、经授权的定向测试；不是画布业务写入绕行通道。
- 尚无已核实的 workspace_backup MCP：先实现服务/UI 的备份接口；不要把计划接口写成已经存在的工具。

技能帮助确定实现方法，Context7 查清库 API，现有代码确定接入点，MCP/浏览器验收验证行为。最终证据必须区分这四种来源，不能用“用了很多技能”代替功能可用。

## 7. Superpowers 流程技能：唯一登记，不重复阅读

已找到根：C:/Users/ldc/.codex/plugins/cache/openai-curated-remote/superpowers/6.4.2/skills/。执行时重新发现版本。Superpowers 不提供本任务的 TypeScript/SQL/Gorm 编程实现，流程只登记一次：

| 阶段 | skill | 触发 |
| --- | --- | --- |
| 设计 | brainstorming、writing-plans | 本轮完善规格与计划；后续设计有实质变化时才回到该阶段 |
| 实施 | executing-plans | Luna 按已批准计划推进 |
| 排障 | systematic-debugging | 实际遇到失败时定位根因 |
| 验证 | test-driven-development、verification-before-completion | 测试授权后编写行为用例；完成前核对真实证据 |

已读且未变更的同一 SKILL.md 不要求每项重读；只读当前阶段所需项。不自动调用派生 Agent、新建会话、提交/推送或运行构建。用户与项目规则优先，技能建议不能扩展任务授权。
