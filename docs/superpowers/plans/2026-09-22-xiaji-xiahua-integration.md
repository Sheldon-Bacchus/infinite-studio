# 虾集与虾画整合实施计划

> 历史计划，已被 [2026-09-24 前端复用与画布连接器计划](2026-09-24-xiaji-xiahua-frontend-connector.md) 取代。本文中 DramaClaw 远程服务、Go 代理、`DRAMACLAW_BASE_URL`、源端写回及任务/API 扩展均不得作为当前实现要求。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 将 DramaClaw 虾集的影视分类、素材浏览和可移植前端接入 infinite-canvas；保留独立全页虾集、虾画内“添加虾集内容”入口，并让两条路径都能把真实虾集数据投影到无限画布。

**Architecture:** Go DramaClaw adapter 聚合集数、分镜、Freezone 分类素材和 beat-context；Next.js /xiaji 页面直接移植并适配 DramaClaw 的资产分类 UI；纯 TypeScript 投影函数同时服务虾集全页和画布内 picker；CanvasProject 仍由现有 useCanvasStore 保存。写回只接真实上游 upload、identity、push 和角色素材 history 语义。

**Tech Stack:** Go、Gin、net/http、Go testing/httptest、Next.js App Router、React、TypeScript、Bun test、Zustand、现有 Ant Design/Tailwind UI。

**Spec:** [2026-09-22-xiaji-xiahua-integration-design.md](../specs/2026-09-22-xiaji-xiahua-integration-design.md)

## Global Constraints

- 开始每项任务前执行 git status --short，并读取该任务目标文件当前内容。发现目标文件已有新改动时先整合其意图；不重置、清理或覆盖整个工作树。
- integrations/dramaclaw 是用户导入的源码快照，只读用于挑选和移植组件；不改其源码、不把整个目录夹带进功能提交。移植文件保留上游 SPDX/版权与来源信息。
- 允许在本功能边界内有意重构、替换或删除旧导入 UI，但每次都以新入口和对应测试为前提，保持 diff 可审查。
- 每个行为先加失败测试，运行 RED 并确认失败原因正确；再实现最小改动，运行 GREEN；最后重构并重跑相关验证。不要先写实现再补测试。
- 每个任务结束检查 git diff --check，按路径精确暂存该任务文件并提交。绝不暂存 integrations/dramaclaw、docs/h3、scripts 或其他用户改动。
- 导入只读取源数据、生成并保存画布节点/连线。不得从导入组件调用图片/视频/音频生成、MCP、AutoDL 或建立通用 jobs 服务。
- 本期只移植真实素材工作台，不放置没有对应内容的剧本/草图/合成空壳页面；以后移植 DramaClaw 阶段页时，dependsOn 不得阻断虾集素材浏览或导入。
- 画布内投影只承诺单个 CanvasProject 内用稳定来源键合并；不宣称跨设备/并发 exactly-once。revision 不进入 projectionKey。
- 写回需区分 Freezone 候选上传、新建角色 identity、canonical 槽位替换和角色素材历史。push 会备份并替换、没有幂等键；不盲重放超时请求，不称其为通用新增版本。
- 不新增测试框架。前端纯函数测试使用仓库已有的 Bun bun:test 文件格式；Go 测试使用 go test。

## Review Focus

- 目录中实际 assets 字段和错误状态能从 DramaClaw 路由读取；引用 ID 不伪造成完整实体。
- 分类资产的稳定投影身份区分 episode、媒体角色、投影角色及 preset；已有用户节点和连线保留。
- /xiaji 是独立工作区，画布工具栏也有当前画布可用的虾集选择器。
- 复制的 DramaClaw UI 只替换必要依赖，不整套复制其 TanStack Router、stores、API client 或阶段门禁。
- 写回操作与 DramaClaw 源端路由语义吻合，失败提示能说明候选文件残留、目标槽位、备份和是否可安全重试。
- UI 流程直接：选择素材或分镜、发送到目标画布；导入结束后由用户自行发起生成。

## Workflow and MCPs

- Superpowers brainstorming 已用于判断这是基于现有代码的集成设计；writing-plans 负责把核实后的设计拆成任务；实施按 test-driven-development 的 RED → GREEN → REFACTOR。
- before-you-build、architecture-analysis、architecture-patterns、api-and-interface-design 与 frontend-design 用于首期范围、边界、契约和前端适配；architecture-critic 在最终实现审查时再次检查方案与代码。
- subagent-driven-development 适合独立审阅或单任务代码审查；跨 Go adapter、CanvasProject 状态和双入口紧密耦合的实施建议由当前执行线程按本计划顺序推进。
- Context7 MCP 仅在具体依赖/框架 API 版本问题无法由仓库锁文件和本地文档确定时调用；GitHub MCP 仅在本地 integrations/dramaclaw 快照缺少必要实现或必须核实上游最新改动时做只读查询。
- 当前文档阶段以工作区内的 infinite-canvas 和 DramaClaw 源码快照为证据，没有调用 Context7/GitHub MCP。生成仍调用用户配置的虾画现有 provider/MCP/AutoDL，不新增 MCP 工具。

---

## Task 1: 用失败的 Go 测试锁定真实素材目录契约

**Files**

- Modify: service/drama_import_test.go

- [x] 在 httptest fixture 中加入 DramaClaw /freezone/assets 的真实字段形状：tab、kind、role、label、url、exists、media_type、meta、slot_target、pushable；加入 beat-context 响应，包含 episode/beat 和素材列表。
- [x] 增加测试：GetImportCatalog 返回分类实体，保留不存在文件的 asset 概念和 exists=false；媒体 URL 被改写为现有本地代理；revision 随资产内容变化；beat-context 的 episode/beat 查询被正确请求；assets 或 beat-context 失败时其余可读目录仍返回并附 warning。
- [x] RED：从仓库根目录运行 go test ./service -run 'TestGetImportCatalogIncludesFreezoneAssets|TestGetImportCatalogIncludesBeatContext' -count=1；确认因当前适配器不请求 Freezone 路由而失败。
- [x] 精确暂存 service/drama_import_test.go，提交 test(drama): specify freezone catalog contract。

## Task 2: 扩展 Go adapter 归一化资产与上下文

**Files**

- Modify: service/drama_import.go
- Modify: service/drama_import_test.go

- [x] 为 DramaImportCatalog 增加规范化 assets 与 beatContextAssets；保留上游 tab/kind/role/meta、存在状态、可写目标和 history capability，不将纯引用 ID转换成实体，也不向浏览器泄露上游直连 URL。
- [x] 将 service 方法签名改为接收可选 episode 与 beat；调用 /api/v1/projects/{project}/freezone/assets；episode 或 beat 参数存在时调用 /freezone/assets/beat-context，并正确编码 query。
- [x] 将 episode、beat、asset 和上下文原始响应纳入 sourceSnapshot.revision；扩展媒体 URL 改写以覆盖资产和上下文素材。
- [x] assets 或 beat-context 单独读取失败时保留其它成功目录数据，并在 catalog warnings 中报告失败接口；响应不得把失败分类伪装成成功的空目录。episodes/beats 核心读取失败仍返回错误。
- [x] GREEN：运行 Task 1 的两个测试及 go test ./service -count=1；再运行 go vet ./service。
- [x] 重构重复 JSON 解析/URL 处理，不改变来源字段；重跑相关测试。
- [x] 精确暂存 service/drama_import.go 与 service/drama_import_test.go，提交 feat(drama): include freezone assets in import catalog。

## Task 3: 让现有目录 Handler 传递素材范围与上游状态

**Files**

- Modify: handler/drama_import.go
- Modify: handler/drama_import_test.go

- [x] 先在 handler/drama_import_test.go 增加失败测试：import-catalog 的 episode/beat 查询传给 service，响应保留 assets、beatContextAssets、warnings 和 sourceSnapshot。
- [x] RED：运行 go test ./handler -run TestDramaImportCatalogIncludesAssets -count=1；确认新字段/参数尚未接线。
- [x] Handler 读取 episode 与 beat query 并传给 service；beat 没有 episode 时返回 400；沿用 router/router.go 中已有认证和 /api/v1/drama/projects/:project/import-catalog 路由，不新建平行目录 endpoint。
- [x] GREEN：运行 go test ./handler -run TestDramaImportCatalogIncludesAssets -count=1 和 go test ./handler -count=1。
- [x] 对未配置源、上游 4xx/5xx 和无效项目参数补充 handler 错误 envelope 断言。
- [x] 精确暂存两个文件，提交 feat(api): expose drama asset catalog fields。

## Task 4: 更新前端目录类型和读取客户端

**Files**

- Modify: web/src/services/api/drama-import.ts
- Add: web/src/services/api/drama-import.test.ts

- [x] 先为 decode/normalize helper 加 Bun 测试，覆盖四类资产、exists=false、slotTarget/history links 缺失、beat-context 空列表和 warnings。
- [x] RED：运行 bun test "web/src/services/api/drama-import.test.ts"；确认新增契约尚未通过。
- [x] 增加与 Go 响应一致的 DramaImportAsset、DramaBeatContextAsset、catalog warnings/capabilities 类型；添加 GET client 的 episode/beat query 参数构造。
- [x] 保留现有 episodes/beats/media 函数签名兼容；不得在浏览器请求中附加 DRAMACLAW API token。
- [x] GREEN：运行该 Bun 测试和现有 web/src/app/(user)/canvas/utils/drama-import.test.ts。
- [x] 精确暂存两份文件，提交 feat(web): type drama asset catalog responses。

## Task 5: 测试并扩展素材、分镜、场景与集数投影

**Files**

- Modify: web/src/app/(user)/canvas/utils/drama-import.ts
- Modify: web/src/app/(user)/canvas/utils/drama-import.test.ts

- [x] 先加失败测试：单图片/视频/音频/文本资产的节点映射；scene/beat/episode 的 Group 和边；同来源不同 media role 生成不同身份；revision 改变不制造新身份；重放投影复用节点；用户已有节点不在投影计划里被改写。
- [x] RED：运行 bun test "web/src/app/(user)/canvas/utils/drama-import.test.ts"；确认测试具体因缺少资产投影或身份区分而失败。
- [x] 扩展投影输入为 DramaImportCatalog、所选实体、episode/beat 上下文和可选 preset；每个节点写 sourceSystem/project/revision/entity/mediaRole/projectionRole/projectionKey。
- [x] projectionKey 纳入 source system、project、episode/entity、source media role、projection role、preset；不纳入 revision。
- [x] 生成节点/边差异，边的端点必须引用本次节点或已存在来源节点；不创建 generation task。
- [x] GREEN：运行 Bun 投影测试。
- [x] 重构节点 ID 与布局计算，重复投影结果保持一致；重跑测试。
- [x] 精确暂存两个文件，提交 feat(canvas): project drama assets with stable provenance。

## Task 6: 建立可测的虾集筛选和搜索规则

**Files**

- Add: web/src/features/xiaji/asset-query.ts
- Add: web/src/features/xiaji/asset-query.test.ts

- [x] 先写 Bun 测试：全部/文本/图片/视频/音频筛选、characters/scenes/props/voices 分类、大小写不敏感标签/名称搜索、exists=false 媒体仍可检索但不能预览、空查询返回全部。
- [x] RED：运行 bun test "web/src/features/xiaji/asset-query.test.ts"；确认模块不存在时测试失败。
- [x] 实现纯函数 filterDramaAssets 和 searchDramaAssets；媒体类型来自上游 media_type，不能仅凭展示文案猜类型。
- [x] GREEN：运行该文件测试。
- [x] 精确暂存新增文件，提交 feat(xiaji): define asset search and filter behavior。

## Task 7: 复制并适配 DramaClaw 的分类资产 UI

**Files**

- Add: web/src/features/xiaji/components/asset-tabs.tsx
- Add: web/src/features/xiaji/components/asset-card.tsx
- Add: web/src/features/xiaji/components/character-assets-panel.tsx
- Add: web/src/features/xiaji/components/scenes-panel.tsx
- Add: web/src/features/xiaji/components/props-panel.tsx
- Add: web/src/features/xiaji/components/voices-panel.tsx
- Source reference: integrations/dramaclaw/frontend/src/routes/_app/projects.$project/characters.lazy.tsx
- Source reference: integrations/dramaclaw/frontend/src/features/freezone/AssetLibraryPanel.tsx
- Source reference: integrations/dramaclaw/frontend/src/components/assets/scenes-panel.tsx
- Source reference: integrations/dramaclaw/frontend/src/components/assets/props-panel.tsx
- Source reference: integrations/dramaclaw/frontend/src/components/assets/character-voice-panel.tsx
- Source reference: integrations/dramaclaw/frontend/src/components/assets/narrator-voice-panel.tsx

- [x] 阅读上述源文件的 import graph，确认要复制的“我的素材/素材库”标签、资产卡片、筛选、预览和投影动作；以目标目录新组件承接代码，不修改 source reference 文件。
- [x] 在移植文件保留上游 SPDX/版权与改造说明；将目标数据输入改为 DramaImportCatalog/DramaImportAsset。
- [x] 复制/适配角色、场景、道具、声音四类排版和卡片行为；保留全部/文本/图片/视频/音频筛选、分类、标签、搜索、素材存在状态、来源、可执行动作和错误状态。
- [x] 用 infinite-canvas 当前主题、图标、按钮和表单组件替换 DramaClaw 的 UI 依赖；移除 TanStack Router、DramaClaw stores、React Query hooks 和上游 API 调用。
- [x] 不把原 episode-stage-registry 的 dependsOn 变成虾集素材浏览或导入门禁；当前任务只实现真实可用的资产工作台，不放置未接内容的阶段导航。
- [x] 使用 asset-query.test.ts 验证四个分类 panel 共用同一筛选结果；运行 bun test "web/src/features/xiaji/asset-query.test.ts"。
- [x] 精确暂存目标新增文件，不暂存 integrations/dramaclaw；提交 feat(xiaji): adapt DramaClaw asset panels。

## Task 8: 建立独立虾集全页工作区

**Files**

- Add: web/src/app/(user)/xiaji/page.tsx
- Add: web/src/app/(user)/xiaji/xiaji-client-page.tsx
- Add: web/src/features/xiaji/components/episode-browser.tsx
- Add: web/src/features/xiaji/components/beat-browser.tsx
- Add: web/src/features/xiaji/components/workbench-view.tsx
- Add: web/src/features/xiaji/components/workbench-view.test.tsx

- [x] 先为 presentational workbench view 写 Bun SSR 测试：四种资产分类、两种素材视图、筛选结果、无素材态、目录 warning 和“发送到虾画”入口均被正确呈现。
- [x] RED：运行 bun test "web/src/features/xiaji/components/workbench-view.test.tsx"；确认当前无工作区视图。
- [x] “我的素材”读取目标项目 useAssetStore 并使用现有添加/上传流程；“素材库”读取 DramaClaw 当前项目 assets/beat-context。筛选、分类、标签和搜索只作用于当前 tab。
- [x] 页面使用 App Router 的全页工作区布局：项目/集数上下文、“我的素材/素材库”视图、四种资产分类、全部/文本/图片/视频/音频、分类/标签/搜索、episode/beat 浏览、媒体预览与清晰空/错/加载态。
- [x] 页面加载和筛选只读 adapter；所有编辑/生成/写回按钮只在对应真实上游操作可用时显示。
- [x] 素材和分镜卡片保留“发送到虾画”操作；本任务先接本地回调，不直接调用 canvas generation API。
- [x] GREEN：运行 Bun catalog 与 asset query 测试，再从 web 目录运行 bun x tsc --noEmit（若仓库实际安装的 TypeScript 命令不同，使用 package.json 声明的本地版本）。
- [x] 精确暂存目标文件，提交 feat(xiaji): add independent asset workbench。

## Task 9: 把虾集加入主导航

**Files**

- Modify: web/src/constant/navigation-tools.ts
- Modify: web/src/components/layout/app-top-nav.tsx
- Add: web/src/constant/navigation-tools.test.ts

- [x] 先在 navigation-tools.test.ts 断言有且仅有一个 slug 为 xiaji 的顶级入口，且标签为“虾集”。
- [x] RED：运行 bun test "web/src/constant/navigation-tools.test.ts"；确认当前导航缺少虾集。
- [x] 为 navigationTools 增加独立“虾集”项和图标；现有 AppTopNav 与 MobileNavDrawer 继续复用同一列表和 active slug。
- [x] GREEN：运行该 Bun 测试；从 web 目录运行 bun x tsc --noEmit；通过前端构建验证 App Router 中 /xiaji 可解析。
- [x] 精确暂存三个文件，提交 feat(nav): add XiaJi as a top-level workspace。

## Task 10: 实现虾集全页“发送到虾画”

**Files**

- Add: web/src/features/xiaji/send-to-canvas.ts
- Add: web/src/features/xiaji/send-to-canvas.test.ts
- Modify: web/src/app/(user)/xiaji/xiaji-client-page.tsx

- [x] 先在 send-to-canvas.test.ts 写失败测试：新建项目时节点/边按投影计划保存；已有项目时保留既有 nodes/connections 并合并缺失 projectionKey；重放不重复新增；不同用户内容不被替换。
- [x] RED：运行 bun test "web/src/features/xiaji/send-to-canvas.test.ts"。
- [x] 实现纯 merge 函数和 CanvasProject 写入编排；调用现有 createProject/updateProject 并用 Next.js router 导航，不另设服务端投影 API。
- [x] /xiaji 的“发送到虾画”先显示目标画布选择器，支持新建或选择已有画布；完成后导航到该项目。投影到已有画布不清空原内容。
- [x] GREEN：运行 send-to-canvas.test.ts、drama-import.test.ts；检查 store 调用只写目标 canvas id。
- [x] 精确暂存三个目标文件，提交 feat(xiaji): send selected content to canvas。

## Task 11: 在当前虾画工具栏加入虾集 picker

**Files**

- Add: web/src/app/(user)/canvas/components/xiaji-asset-picker.tsx
- Modify: web/src/app/(user)/canvas/components/canvas-toolbar.tsx
- Modify: web/src/app/(user)/canvas/[id]/canvas-client-page.tsx
- Modify: web/src/app/(user)/canvas/utils/drama-import.ts
- Modify: web/src/app/(user)/canvas/utils/drama-import.test.ts

- [x] 先为投影合并 helper 加失败测试：把选中投影追加到既有 nodes/connections；不替换任何用户节点；重复调用不重复 append。
- [x] RED：运行 bun test "web/src/app/(user)/canvas/utils/drama-import.test.ts"。
- [x] CanvasToolbar 增加可见的“虾集内容”按钮；打开独立的 XiaJiAssetPicker，复用 /xiaji 的 catalog、筛选、卡片和“加入当前画布”行为。
- [x] 在 canvas-client-page.tsx 使用当前 nodes/connections 与现有 setNodes/setConnections/history/updateProject 持久化路径；projection 使用稳定来源 ID；不要经 createProject 创建第二个画布。
- [x] 媒体卡片仅在 exists 且 URL 可用时执行插入；文本、场景、分镜仍可按对应 projection 支持导入。
- [x] GREEN：运行 Bun projection、asset query 和 send-to-canvas 测试；确认导入路径不会触发 handleGenerateNode 或其它生成 client。
- [x] 精确暂存五个文件，提交 feat(canvas): add XiaJi picker to current canvas。

## Task 12: 迁移旧的画布列表入口

**Files**

- Modify: web/src/app/(user)/canvas/page.tsx
- Modify: web/src/app/(user)/canvas/components/drama-import-modal.tsx

- [x] 先加页面行为测试或对可测的 navigation helper 加 Bun 测试，验证画布列表的虾集入口到 /xiaji，且 /canvas/[id] 的 toolbar picker 仍可直接导入当前画布。
- [x] RED：运行相关 Bun 测试并确认旧入口还指向导入弹窗。
- [x] 将“虾集导入”列表按钮替换为进入 /xiaji 的“虾集”入口；删除旧 DramaImportModal 只有在 Task 8、10、11 的新路径已通过测试后执行。
- [x] 保留仍被投影代码使用的 API 与 utility；只删除失去调用点的旧 UI/state/import，不顺带改造无关 canvas 页面。
- [x] GREEN：运行受影响的 Bun 测试；从 web 目录运行 bun x tsc --noEmit 与 bun run build。
- [x] 精确暂存两个文件，提交 refactor(canvas): replace legacy drama import dialog。

## Task 13: 添加候选文件上传适配

**Files**

- Modify: service/drama_import.go
- Modify: service/drama_import_test.go
- Modify: handler/drama_import.go
- Modify: handler/drama_import_test.go
- Modify: router/router.go
- Modify: web/src/services/api/drama-import.ts
- Modify: config/config.go
- Modify: .env.example
- Add: web/src/services/api/drama-import-writeback.test.ts

- [x] 先用 httptest 写失败测试：infinite-canvas 接受 multipart 文件，转发到上游 /freezone/upload，解析并返回项目内 candidate URL；超过默认 100 MiB 上限返回 413；断言上游失败时返回安全错误且不泄漏凭据。
- [x] RED：运行 go test ./service ./handler -run 'TestDramaCandidateUpload' -count=1；确认当前服务没有上传适配。
- [x] 增加 DRAMACLAW_UPLOAD_MAX_BYTES 环境项，默认 104857600 字节；在 .env.example 说明该项和 DRAMACLAW_BASE_URL/API_TOKEN；handler 对文件流执行上限校验并返回 413。
- [x] 在 service 层以流式 multipart 代理文件，避免 Go 再复制完整媒体到内存；handler 使用现有用户认证/错误 envelope；target API 路径使用 /api/v1/drama/projects/{project}/freezone/upload。
- [x] 前端 drama-import.ts 增加候选上传函数和响应类型；在 drama-import-writeback.test.ts 增加 Bun 测试覆盖 multipart 与错误处理，不将 token 放入浏览器。
- [x] 候选上传无源端幂等键；超时结果不自动重试，提示用户先核对上游。服务端收到 candidate URL 后应保留该 URL 供后续 promote 操作。
- [x] GREEN：运行候选上传 Go/Bun 测试和相关既有测试。
- [x] 精确暂存本任务文件，提交 feat(api): proxy DramaClaw candidate uploads。

## Task 14: 代理新建角色 identity、canonical 替换与角色历史

**Files**

- Modify: service/drama_import.go
- Modify: service/drama_import_test.go
- Modify: handler/drama_import.go
- Modify: handler/drama_import_test.go
- Modify: router/router.go
- Modify: web/src/services/api/drama-import.ts
- Add: web/src/services/api/drama-import-writeback.test.ts

- [x] 先用 httptest 写失败测试：创建 identity 的字段映射、push target/mark_stale 映射、角色 asset-history 查询和 restore；验证非项目内 source_url 被拒绝或由上游安全拒绝，错误 envelope 可读。
- [x] RED：运行 go test ./service ./handler -run 'TestDramaIdentity|TestDramaPush|TestDramaAssetHistory' -count=1 与 bun test "web/src/services/api/drama-import-writeback.test.ts"。
- [x] 服务端仅代理已核实 API：/freezone/assets/identities、/freezone/push、characters/{name}/asset-history 和 history restore；push 写路由使用 /api/v1/drama/projects/{project}/freezone/push。
- [x] 新建 identity 或替换 canonical 槽位前要求该项目刚上传或已核实的 candidate URL；service 只接受 DramaClaw 配置 origin 下的项目内 URL，不从浏览器接任意远程 URL。第二步失败时保留候选 URL 与失败阶段，不伪装为原子事务。
- [x] push 超时或连接中断不得自动重发；API 结果返回上游 target_url、backup、stale_marked 和 affected_count。
- [x] GREEN：运行对应 Go/Bun 测试；确保没有 generic assets/version/job route。
- [x] 精确暂存本任务文件，提交 feat(api): proxy DramaClaw identity and slot operations。

## Task 15: 接入显式写回确认界面

**Files**

- Add: web/src/features/xiaji/components/writeback-dialog.tsx
- Add: web/src/features/xiaji/writeback.test.ts
- Modify: web/src/app/(user)/canvas/[id]/canvas-client-page.tsx
- Modify: web/src/app/(user)/xiaji/xiaji-client-page.tsx

- [x] 先写 Bun 测试：关闭对话框或取消确认不调用写 API；确认保存候选只调用 upload；新建角色 identity 调 upload 后再调用 identities；替换素材显示目标并只调用一次 push；history 只对上游提供链接的角色素材显示。
- [x] RED：运行 bun test "web/src/features/xiaji/writeback.test.ts" 并确认动作缺失时失败。
- [x] 增加明确动作文案：“保存候选”“创建角色身份”“替换素材”；替换前显示目标槽位、上游备份行为和可受影响的分镜信息。
- [x] 把虾画生成结果传给候选上传只允许用户显式点击；成功后显示返回 candidate URL 和后续可选动作；导入/生成完成不得自动写回。
- [x] 连接上游角色素材 history 浏览/restore；非角色类别只显示已确认存在的上游能力。
- [x] GREEN：运行 writeback.test.ts 与相关 API 测试；验证 uncertain push state 有“待核对”提示且不触发自动重试。
- [x] 精确暂存本任务文件，提交 feat(xiaji): add explicit result writeback controls。

## Task 16: 端到端审查和新鲜验证

**Files**

- Review: 本计划所有目标文件和 integrations/dramaclaw 来源引用
- No unrelated files

- [x] 运行 git status --short，核对只包含本功能 diff 和先前用户改动；确认 integrations/dramaclaw、docs/h3 和 scripts 未被功能提交跟踪。
- [x] 从干净命令输出运行 go test ./...。
- [x] 运行 bun test "web/src/services/api/drama-import.test.ts" "web/src/services/api/drama-import-writeback.test.ts" "web/src/app/(user)/canvas/utils/drama-import.test.ts" "web/src/features/xiaji/asset-query.test.ts" "web/src/features/xiaji/send-to-canvas.test.ts" "web/src/features/xiaji/writeback.test.ts" "web/src/constant/navigation-tools.test.ts"。
- [ ] 从 web 目录运行 bun x tsc --noEmit 与 bun run build；仅使用仓库当前安装的依赖和 package scripts。（生产构建已在最后一次 MIME 校验前通过；本次仅增类型白名单并由 TypeScript 与页面加载验证，未重跑构建以免覆盖当前本地 Next 输出。）
- [x] 使用独立 architecture-critic/code review 检查数据契约、复用边界、导入不触发生成、画布内入口、并发去重承诺和 writeback 准确性；发现问题先新增失败测试再修复。
- [ ] 手工核对两条入口：/xiaji 全页发送到新/已有画布；画布工具栏导入到当前画布；检查已有节点/连线仍在、重复导入不重复、源媒体错误可见、导入后没有后台生成任务。（已核对 /xiaji 页面结构；端到端点击未完成：当前本地会话未登录且页面尚未配置 DramaClaw 项目 ID。）
- [x] 核对 DramaClaw SPDX 与目标文件 attribution、保存所有审查 diff；只在最终验收后汇总实际验证命令和输出。
