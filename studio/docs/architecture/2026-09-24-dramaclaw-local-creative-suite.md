# DramaClaw 创作模块本地移植架构

状态：范围已于 2026-09-25 调整；本文早期四模块方案中有关虾面的目标已被最新用户决定取代。以下历史架构内容用于追溯旧方案，不授权继续实施虾面或“回主线”。

当前虾镜 Beat 到原生虾画的连接设计已另行收敛，见[2026-09-25 架构决策](2026-09-25-xiaji-beat-context-canvas-import.md)。该方案的预览、导入和排版/连线分阶段确认；视频生成不在其范围。

## 当前范围更新（2026-09-25）

- 顶部导航中原虾塘入口改名为“无限虾”。
- 移除虾面页面、路由和所有用户可见的进入/继续操作；当前创作模块范围为虾料、虾塘、虾镜，虾画仍使用 Infinite Canvas 原生画布。
- 旧规格/计划中虾面的候选探索、Freezone 页面和结果“回主线”均已失效；其页面、路由、素材库和回主线实现已从源码删除。仅保留一项兼容过滤逻辑，把旧工作区里的回主线内部记录从用户素材列表隐藏。
- 本轮 4 个聚焦单测通过；排除测试文件和旧 `.next` 生成类型后的应用源码 TypeScript 检查通过。标准 `bunx tsc --noEmit` 仍被 `.next/types/validator.ts` 中指向已删除 Freezone 路由的旧生成引用阻塞。没有构建、重启服务或浏览器截图验收。

## 实施现状（2026-09-25）

- 已落地本地 LocalStudio 项目、原稿、分集、剧本和 Beat Asset 表示与 repository；新建项目和初始分集结构在本地保存。
- 虾塘有角色、场景、道具、声线本地页面和父子素材操作；源控件完整度及视觉一致性仍需对照 DramaClaw 原页面逐项验收。
- 虾镜已有项目/分集/脚本/Beat/合成路由组件；本轮完善分集统计卡片、剧本提示词及 Beat 台词字段。本地多镜头成片合成能力未确认，不应显示成已实现。
- 历史记录（当前已不属于产品范围）：曾实现虾面本地 Freezone/素材库和候选回主线辅助逻辑；页面、路由、专用素材库组件及回主线处理代码现已删除。
- 最新验证：`bun test` 57 files / 247 pass / 0 fail / 924 expect；`bunx tsc --noEmit` 通过。Turbopack 全站生产构建约 12–16 秒；本地启动器 health/API bridge 检查通过，CUA 的 `/xiaji/projects` 空状态可加载。完整创作 E2E、来源/目标截图逐页比较和 Network 面板仍未完成。
- 本轮静态搜索（Serena、Repomix）未发现指定 DramaClaw host/API 字串；这是静态结果，不能证明运行时无请求。逐文件许可清单及 Elastic-2.0 与目标仓库许可的组合分发结论仍待维护者审查。

### 本轮实际使用的工具

- **Skills：** `before-you-build`、`test-driven-development`、`frontend-design`。本轮没有重新运行 architecture critic 或子代理审查。
- **MCP：** Serena 用于目标源码静态搜索；Repomix 用于受限来源/目标代码包与字符串检索；CUA 用于查看飞书参考及确认本地页面登录重定向。
- **未调用：** Context7、GitHub MCP、子代理。本轮没有访问 DramaClaw 服务，也没有浏览器 Network 面板证据。

## 架构结论

原方案曾计划把 DramaClaw 虾料、虾塘、虾镜、虾面的真实 React 页面和组件移植到 Infinite Canvas。按最新范围，当前仅继续处理虾料、虾塘和虾镜；虾画仍使用 Infinite Canvas 原生 CanvasProject、节点、连线、生成和保存。

这是有边界的前端移植与本地适配，不是重画相似页面，也不是搬 DramaClaw 后端。来源代码依赖远端数据或任务服务的部分，拆出视图并替换数据适配器；不能把远端调用原样带进目标应用。

## 范围和不变量

- 当前移植范围：虾料、虾塘、虾镜。
- 虾面及其结果写回主线流程已从当前范围删除。
- 不做虾格、虾导、虾体及其他未列出的虾X模块；Infinite Canvas 现有助手不变。
- 不运行、部署或连接 DramaClaw，不访问其 host、API、数据库、项目服务、任务或生成服务；不需要 DRAMACLAW_BASE_URL 或 DRAMACLAW_API_TOKEN。
- 不移植 DramaClaw 后端，不增加 Go 路由、数据库或任务系统。
- 复用目标端现有 Asset、媒体文件和 Canvas 保存契约。模型生成使用 Infinite Canvas 已配置的模型与渠道。
- 保护当前所有工作区改动；实施阶段也不重置、覆盖、批量清理或提交未获要求的内容。

## 已核实事实与推断

### 已核实

- DramaClaw 前端源码在 integrations/dramaclaw/frontend，使用 React 与 TanStack Router。
- 虾料页面在 src/routes/_app/projects.$project/ingest.tsx。
- 虾塘角色页在 src/routes/_app/projects.$project/characters.lazy.tsx；真实资产控件分布在 src/components/assets 下的场景、道具、声线、搜索和统计组件。
- 虾镜入口包括 episodes.tsx、episodes.$episode/script.lazy.tsx、beats.lazy.tsx、compose.lazy.tsx。sketches.lazy.tsx 是跳转到 Beat 页“草图”子标签的路由，不是独立草图工作台。
- 虾面对应 features/freezone/FreezoneShell.tsx、AssetLibraryPanel.tsx 和 features/freezone/commit 下的结果提交 UI。页面壳、资产面板可以作为移植对象；依赖上游提交 API 的逻辑不能直接复用。
- 来源文件包含 Elastic-2.0 SPDX 与 ClaymoreLab 版权声明；来源仓库有 Elastic License 2.0。目标根 LICENSE 为 GNU AGPL-3.0。不能据此声称两者兼容或已完成分发许可审查。
- Infinite Canvas 有本地 Asset store、文件上传/保存、原生 CanvasProject 与等待保存完成的 saveProjectAndWait。CanvasProject 当前没有可依赖的 revision/CAS 参数。
- 目标已有虾塘本地模型 xia-tang-local-model.ts，以及虾塘页面、画布导入选择器和连接器的部分实现。
- 当前目标 `web/src/app/(user)/xiaji/episodes`、`[project]`、`project/[project]` 都是重定向到 `/xiaji` 的占位页面。新旧路径与 slug、Next 静态/动态优先级、`characters`、项目内 ingest、episode 数字到 Asset ID 的映射已写入 [route-map.md](../superpowers/artifacts/dramaclaw-local-creative-suite/route-map.md)。不能把任一旧占位页当成无兼容语义的空路由。
- 目标没有已确认的“完整多片段合成、旁白、字幕、音乐混音”本地等价能力，也没有可证明与来源端 Director World 服务等价的本地服务。

### 推断与设计决定

- 页面视图、样式、表单和领域字段可直接迁移或小幅适配；TanStack 路由钩子、DramaClaw React Query 请求、远端项目/任务状态、后端提交逻辑必须按依赖边界拆分。
- 不将 DramaClaw Freezone 画布壳或数据模型搬入 Infinite Canvas。虾面保留来源的资产面板和创作控件，主画布使用目标端原生 Canvas。
- 目标缺少 episode/beat 独立表时，先将项目、分集和 Beat 作为 Asset 记录存入现有本地 Asset 持久化；不为了领域名词先造后端表或 Go API。
- 本地不能完成的生成/3D/合成操作保留在原位置和层级，说明不可用原因并禁用；不显示虚假进度或成功状态。

## 页面与控件映射

| 来源页面 | 来源结构/控件 | Infinite Canvas 目标 | 复用和适配 |
| --- | --- | --- | --- |
| 虾料 | projects.$project/ingest.tsx：小说/剧本导入、项目类型、基础风格、结构预览 | `/xiaji/ingest` 与 `/xiaji/project/[projectAssetId]/ingest` | 新建入口与现有项目导入分开；数据保存在本地 Asset；结构生成走目标已配置模型；缺模型时显示真实能力缺口 |
| 虾塘 | characters.lazy.tsx；assets 下场景/道具/声线/角色搜索/统计控件 | `/xiaji` 全页；项目内来源页为 `/xiaji/project/[projectAssetId]/characters` | 迁移来源组件；保留已有 xia-tang-local-model 兼容；数据与媒体接本地 Asset store |
| 虾镜 | episodes.tsx、script.lazy.tsx、beats.lazy.tsx、compose.lazy.tsx；episode 子路由中的 index/overview/audio/video/sketches redirect | `/xiaji/project/[projectAssetId]/episodes/...` | 分集、剧本、Beat、镜头、合成和原子区导航按冻结路由表实施；ID 使用稳定本地 Asset ID |
| 虾面 | FreezoneShell、AssetLibraryPanel、AssetLibraryBrowser、CanvasesTab、CanvasOutlineList、capabilityRegistry、beatContextProjection、commit UI | `/xiaji/project/[projectAssetId]/freezone` → 原生 `/canvas/[id]` | 迁移来源控件和素材浏览交互；以目标原生 Canvas 取代 Freezone 画布存储；移除上游写回请求，使用本地回主线 outbox |
| 回主线 | commit 预览、槽位选择、候选选择和确认 | 虾面侧栏/对话框，目标本地项目 | 保留候选预览和用户确认；只追加带 source 关系的新版本；不静默覆盖目标素材 |

路由设计稿在 `artifacts/dramaclaw-local-creative-suite/route-map.md`；统一动态段名为 `[projectAssetId]`，stable episode 使用 `/episodes/by-id/[episodeAssetId]`，Beat 稳定 ID 与旧数字参数分域并定义普通选择同项规范化、focus 并存冲突、跨项目/分集校验和可恢复错误，另定义人物深链、search allowlist、Freezone canvas 消费和原生画布本地 context。第七轮只读最终复核确认 P0/P1/P2=0；实施仍须新增路由测试，文档定稿不表示路由已实现。

### 虾镜子路由逐项处置

| DramaClaw 子路由 | 本地源码行为 | 目标处置 |
| --- | --- | --- |
| episodes.$episode/index.lazy.tsx | 空 episode 路径跳到 script | 保留本地等价 redirect 到脚本页 |
| overview.lazy.tsx | 旧 overview 跳到 script 的 SourcePanel | 保留旧路径 redirect；SourcePanel 随脚本页移植 |
| script.lazy.tsx | 脚本主页面 | 移植真实页面和字段，本地 Asset 保存 |
| beats.lazy.tsx | Beat 页与多个子标签 | 移植真实页面与子标签 |
| sketches.lazy.tsx | redirect 到 beats?sub=sketch | 保留 redirect 与草图标签 |
| audio.lazy.tsx | redirect 到 beats?sub=audio | 保留 redirect 与音频标签 |
| video.lazy.tsx | redirect 到 beats?sub=video | 保留 redirect 与视频标签 |
| compose.lazy.tsx | 合成页面 | 移植控件；本地不支持项原位禁用和说明 |

项目级 assistant.tsx、styles.tsx、tasks.tsx 不整页移植；仅复用虾料所需的基础风格选择控件，不搬独立样式管理页，也不移植虾导/任务中心。该列表须与全局导航和飞书手册再次核对。

## 页面适配器契约

所有来源 view/container 的业务输入从 Next 页面适配层注入，不让源组件直接访问来源服务。除一般加载/保存外，LocalStudioAdapter 还需显式承接 `listImageSourceOptions`、`saveImageSourceSelection`、`listBeatReferences`、`prepareReturnOperation`、`recoverPendingReturnOperations`、`completeReturnOperation`；具体签名在阶段 0 依据字段映射冻结：

- 路由状态：project 参数映射为 projectAssetId；稳定 episode Asset 使用 `/episodes/by-id/[episodeAssetId]`，旧数字分集只走兼容解析；新 Beat selection/focus 使用 `beatAssetId`/`focusBeatAssetId`，必须属于路径项目和当前分集，旧数字参数只用于解析；**仅普通选择** `beatAssetId` + `beat` 同指一项时规范化，冲突或越界显示可恢复状态；`focusBeatAssetId` 与旧 `focusBeat` 同时出现时一律显示冲突，即使它们解析到同一项；sub 转换为本地受控子标签。
- 读取：按 project/episode/asset-kind 查询本地 Asset 与关联媒体；刷新采用 repository canonical snapshot，不依赖 TanStack Query cache invalidation。
- 写入：saveAssetBatch 接收稳定 ID 的 Asset 快照，调用现有本地同步 API，返回 canonical records 或明确失败；同一次请求事务全成或全败。
- 媒体：uploadMedia 返回本地文件 ID/storageKey/url/mimeType；文件与 Asset 不是共同事务，失败结果明确区分。
- 文本生成：generateText 使用 Infinite Canvas 已配置的 provider/channel，返回真实内容或可展示错误；不创建 DramaClaw job。
- 画布：saveCanvas 接受目标 CanvasProject，返回并核对 canonical project；不把异步 store sync 的完成误当成快照被接受。
- 错误统一分为 validation、missing-media、provider-unavailable、provider-failed、asset-sync-failed、canonical-conflict、canvas-save-failed；view 控件保留对应错误和重试入口。

移植前先按每个源页面填写其 route/query/service 依赖、可直接复用组件和需替代动作；源页面较大或直接调用 api.get/api.post 时，应将纯视图提取为受控子组件，不尝试仅机械替换 Router hooks。

`AssetBeatReferences` 的本地目标组件为 `web/src/features/xiaji/components/asset-beat-references.tsx`；Beat Asset 保存稳定 ID 数组 `referencedAssetIds`，反向索引按目标素材 ID 查询；展开时才加载，按分集序号和镜头序号排序，并深链到本地 Beat 详情/锚点。源端 prop 名称引用只有在别名解析唯一时才能映射成稳定 Asset ID；零匹配显示“引用未解析”，多匹配显示需处理状态，不能伪报“没有使用”。`CharacterImageSourceSelect` 的本地目标组件为 `web/src/features/xiaji/components/character-image-source-select.tsx`，保留在角色、场景和道具图像区；逐项映射源选项到 Infinite Canvas 已有本地图像能力，无法映射的选项保留位置、禁用并说明，不提交来源端配置语义。

## 来源服务调用迁移表（阶段 0 必须逐调用点完成）

| 来源页面/已核实调用 | 本地适配方向 | 无等价能力时 |
| --- | --- | --- |
| `ingest.tsx`：`useProject/useUpdateProject`、`useStyles`、`useTasks/useCancelTask`、`useGenerationCreditCost`，章节/知识图查询与失效 | 项目元数据和结构存入本地 Asset；结构生成只走已配置文本模型；本地 repository refresh 替换 query invalidation | 远端任务取消、远端费用和知识图服务不得保留请求；无本地等价功能时原位禁用并说明 |
| `episodes.tsx`：项目路由参数/导航、角色加载、episodes/episode detail/characters/scenes/props/pipelineStatus 缓存失效 | 本地 project/episode Asset 查询、排序、导航和 canonical refresh | 远端 pipelineStatus 不作为本地生成状态；没有本地状态源时不显示伪进度 |
| `script.lazy.tsx`：project/episode/character 查询、script generation/rewrite、generation-credit 查询及多资源缓存失效 | LocalStudioAdapter 读取本地剧本和角色 Asset；文本生成调用 Infinite Canvas 已配置模型；保存后重新读取 canonical Asset | 不请求 DramaClaw 任务或计费；本地 provider 缺失时保留控件并禁用 |
| `beats.lazy.tsx`：episode beats/detail、script、project update、video backends、tasks；grids/beats/sketchImageUsage/pipelineStatus 查询或失效 | Beat/shot Asset 和本地引用；已有图/视频能力经适配器调用；repository refresh 代替缓存失效 | 源端 backend 列表、任务和费用不复制；逐选项确认是否有目标端等价能力，否则禁用并给原因 |
| `compose.lazy.tsx`：compose/final-video、beats/detail/project 更新、pipelineStatus/videoPool/finalVideo；直接 `api.get/api.post` | 每个源请求按调用点拆成目标 adapter 操作，限于目标现有媒体、模型和 Canvas 保存能力 | 每个无法映射的 GET/POST handler 连同 UI 入口一并拦截，不得留 source API closure 或假成功 |
| `characters.lazy.tsx` 与 assets 组件：project/image-source selection、声线与 AssetBeatReferences 查询 | 本地角色/子 Asset/媒体查询；本地选择项通过 adapter 保存；Beat 反向引用从 `referencedAssetIds` 构建 | 来源服务的图片任务、声线生成或引用 API 不保留；仅保留目标确实支持的本地操作 |
| `freezone.lazy.tsx`/commit：项目列表、Capability、Beat 投影与提交 | 本地 project Asset、原生 Canvas、candidate/version Asset 和 durable outbox | 不搬来源 Canvas persistence、协作、任务或提交 API；未支持能力明确禁用 |

上述表是架构概览。首轮源码行号/参数/request/响应/副作用到本地处置已整理到 `artifacts/dramaclaw-local-creative-suite/source-call-map.md`，其中列出的本地 adapter 名称仍是拟议契约，不是已实现方法。实施前还需独立审阅、生成控件到目标文件/测试/截图的完整矩阵；任一来源调用没有归宿时，不进入该页面复制。

## 虾塘来源控件保真清单

控件名称以本地 DramaClaw 源码和飞书手册最终核对为准；本清单规定不能漏掉的领域：

- 角色：列表、搜索、统计、主角标记、添加/编辑/删除；角色资料、头像和参考图；身份/形象列表与编辑；年龄、外貌服装、体型、面部提示词、身份图、服装图、肖像和本地版本/历史。
- 场景：列表、搜索、添加/编辑/删除；基础场景与变体；时间、环境提示词、描述、备注；master、reverse、360 全景、空间布局、Director World/自定义 3D 区域和文件操作。
- 道具：列表、搜索、添加/编辑/删除；类型、别名、所属角色、视觉提示词、描述、备注、参考图和批量上传。
- 声线：角色声线与项目旁白；默认、儿童、青年、中年、老年槽位；上传、录制、试听、选择本地音频、裁剪、删除和状态。
- 页面共用：页头/项目标题、四类页签、来源已有搜索/筛选/图片来源选项、卡片、预览、确认框、加载/错误/空状态和移动端布局。

实现验收时每项必须链接到来源文件、目标位置、本地行为、自动化测试和截图。凡来源已有控件未映射，不得以“虾塘页面完成”收尾。

## 复用与移植实施方式

每个来源页面先建立依赖闭包清单，并分为四类：

1. 可原样复用：无 DramaClaw 路由、服务、数据对象依赖的纯 UI、图标、排版和控件。
2. 需适配后复用：视图依赖 TanStack Router、React Query、来源实体类型或 store；保留 DOM/视觉与控件层级，把路由和数据动作改为目标 props/hooks。
3. 只保留 UI、重写本地行为：请求 DramaClaw project/task/commit API 的操作；替换为本地 Asset、文件和 Canvas adapter。
4. 仅保留位置与说明：目标无等价能力的来源服务功能；显示不可用状态和原因，不实现假功能。

逐页面移植步骤：

1. Serena 符号和引用查询配合 rg 检索，枚举页面 import、子组件、CSS、图标、状态、请求、路由和生成依赖。
2. Repomix MCP 使用 `pack_codebase` 的 include 白名单，将页面依赖闭包打包到系统 Temp 供只读审阅；本次 MCP 输出未写入仓库。排除 `.env`、`.serena` 私有配置、`node_modules`、用户媒体/剧本和仓库内输出文件。
3. 建立“来源控件 → 目标组件/路由 → 本地动作 → 测试/截图”逐项映射。
4. 保留来源 JSX 层级、排序、文案和视觉参数；最小改动地抽离来源 Router / Query hooks，改由目标页面容器提供数据与回调。
5. 接入 feature-owned local studio adapter；模块 UI 不直接散布 fetch、LocalStorage 或 Go endpoint。
6. 静态搜索来源 host、/api/v1/drama、来源服务模块和任务接口调用；再做浏览器 Network 现场核验。
7. 对照来源页面截图和目标同尺寸截图，按控件表逐项复查；差异必须落实到具体行项，不以“整体像”作为验收。

依赖拆分已有源码证据：ingest.tsx 在页面主体使用 Route.useParams 和 useQueryClient；episodes.tsx 使用 route params/navigation/query cache；compose.lazy.tsx 直接执行 api.get/api.post。因此不能只替换几个 Router hook。先把来源视图拆成受控 View 与页面 Container，再把读取、保存、错误、query invalidation 和生成动作都接到上文 LocalStudioAdapter。源路由可迁移布局和控件，但含有上游请求的事件处理必须重接，不能直接保留原 closure。

复用单位是经过依赖审查的页面、控件、样式和交互，不是带有隐式远端耦合的整个 route module。

## 本地状态与数据契约

建议使用 Asset.metadata.localStudio，schemaVersion=1。领域模型先在前端类型、codec 和 repository 中表达，落到现有 Asset 持久化，不添加后端表。

| 记录 | 目标类型 | 关键字段 |
| --- | --- | --- |
| 项目 | text Asset | title；data.content 保存原始小说/剧本；metadata.localStudio.project 包含 projectType、baseStyle、schemaVersion、source、createdAt |
| 分集 | text Asset | metadata.localStudio.episode 包含 projectAssetId、order、title、summary、scriptAssetId |
| 剧本/结构预览 | text Asset | data.content 保存文本；metadata 标识 documentKind、projectAssetId、episodeAssetId 和生成配置摘要 |
| Beat/镜头/草图 | text/image/video Asset | metadata.localStudio.beat 包含 projectAssetId、episodeAssetId、order、shotIds、sourceNodeIds；媒体引用保留在现有 Asset/file 结构 |
| 虾塘角色/身份/场景/变体/道具/声线 | 延续已有虾塘 Asset 表示 | 保持现有 xiaTang metadata；子记录有稳定独立 ID 与 parentAssetId；媒体按 parentAssetId 和 slot 关联 |
| 虾面候选 | 现有 image/video/text Asset 或 Canvas 节点 | sourceCanvasId、sourceNodeId、项目/分集/Beat 来源、候选状态 |
| 回主线版本 | 新建目标 Asset 版本或子 Asset | targetKind、targetAssetId、versionAssetId、sourceAssetId/sourceCanvasId/sourceNodeId、slot、confirmedAt、confirmationId |
| 回主线确认操作 | 现有本地 Asset store 中的内部 text Asset；不是用户素材 | `metadata.localStudio.internalKind=return-to-mainline-operation` 保存状态和 ID；`data.content` 保存冻结的 JSON 请求载荷与媒体引用，不复制媒体二进制 |

版本字段语义：versionAssetId 是稳定记录身份，不是保证单调递增的版本号；confirmationId 对一次确认意图保持不变，重试沿用相同 versionAssetId 与 payload。不同确认意图可生成并存的新版本。无 CAS 的本地接口不能保证跨标签页并发分配顺序；需要选定当前版本时，必须先显示并比较 canonical 状态，再由用户确认冲突处理。

确认操作采用可恢复的两阶段本地 outbox：用户确认时先生成稳定 operation Asset ID、confirmationId、versionAssetId，并把不可变 payload 写入内部 Asset；读取 canonical 记录确认 intent 已持久化后，才写目标版本 Asset。目标版本保存返回不确定（例如服务端已提交但浏览器超时）时，刷新后读取 pending operation 和目标 canonical Asset：若 versionAssetId 已存在且 payload 相同，收敛为已提交；若不存在，使用保存的原 payload 和同一 ID 重试；若同 ID 内容不同，报告冲突并保留候选。只有核对目标 canonical Asset 后才把 operation 标记完成。普通素材列表、搜索、计数、筛选和选择器必须排除该内部记录；outbox 查询仍能按 ID 读取它。该方案只使用现有 Asset API/存储，不新增表或 Go route。

契约约束：

- 对既有 xiaTang metadata 向后兼容读取；新增命名空间和 schema version，不静默重命名旧字段。
- 前端 Asset 类型通过现有 /api/local/assets 与 /api/local/assets/sync 持久化；Go 的 model.Asset 是另一种领域对象，不能误当成前端 Asset schema。现有 useAssetStore.addAsset 只返回新 ID 并排入防抖同步，updateAsset 返回 void；不能把它们当作可等待、可确认的事务接口。
- 特殊写入必须使用 awaitable adapter/store action：取消或串行化本地待处理的防抖同步，调用现有同步 API，读取其返回的 canonical Asset 列表，再更新 UI store。同步 API 在后端单个数据库事务中处理传入快照，属于记录集全有或全败，不承诺逐条部分成功。
- Asset metadata 更新没有 CAS。比较服务返回的 canonical 记录与用户提交的记录；不相等时显示冲突和 canonical 值，保留用户候选供再次选择，不静默覆盖。
- 上传文件与 Asset 记录不在同一数据库事务中。文件上传成功、Asset 同步失败时，保留已上传文件的引用和待重试数据，报告为“媒体已保存、资产记录未提交”；不要自动删除文件或报整体成功。
- 项目、分集、Beat 的一个逻辑保存批次遵循全有或全败。若 UI 分批提交，则按明确批次分别返回成功/失败，不宣称同一个批次逐条部分成功。
- 用户确认回主线时，按上述 outbox 先持久化操作意图和冻结 payload，再写目标版本 Asset；重试不得重新生成 ID 或从已变动的源节点重建 payload。目标端无 CAS，不承诺并发递增版本号；版本以稳定 versionAssetId 表示，confirmedAt 仅用于展示排序。两个独立确认可并存为两个版本，不隐式决定哪一个覆盖目标。
- outbox Asset 必须在资产仓库的普通用户列表和所有选择器中隐藏，但必须可由 recovery repository 查询；内部记录写入失败时不得继续写目标素材。完成记录保留到有明确清理策略，不在成功后立即删除。
- Native Canvas 导入仍用现有 Canvas 保存适配器，但现有 saveProjectAndWait 会等待 sync 请求并丢弃 API 返回的 CanvasProject 列表。需要让虾面专用保存路径检查并应用返回的 canonical project；如果目标画布实际保留值与待写项目不同，报告冲突并保留候选，不把 Promise resolve 当成快照已落库的证明。
- 不创建连线、不覆盖已有节点、不使用旧 Canvas 快照写回。Canvas sync 同样没有应用层 CAS；冲突比较不能描述成服务器版本锁。

## 生成和不可用能力

| 操作 | 本地接入判断 | 行为 |
| --- | --- | --- |
| 小说结构、剧本和文字草稿 | 可通过 Infinite Canvas 已配置的文本模型能力，但需 feature-owned wrapper | 只提供用户发起的无工具文本请求；保留模型/渠道配置与错误反馈；不修改现有助手 |
| 图片生成、编辑 | 目标端已有原生画布能力 | 使用现有 Canvas 生成设置和任务交互 |
| 视频/音频生成 | 目标端已有对应生成能力 | 走 Infinite Canvas 自身已配置能力；配置无效时原位提示 |
| 镜头序列到成片、字幕/旁白/音乐混音 | 当前未核实有等价本地能力 | 保留合成页结构和选项位置，标记不可用原因；不模拟任务或进度 |
| Director World、上游远端 3D/全景能力 | 未核实有本地等价服务 | 可本地保存的结构和字段仍可浏览/编辑；依赖远端服务的动作禁用并解释 |
| 上游候选提交 API | 不调用 | 用本地回主线流程替换，用户确认后新增目标本地版本 |

## MCP、Skills 与移植复用工具清单

### 当前已实际使用

| 工具 | 本轮用途和结果 |
| --- | --- |
| Serena MCP | 激活 Infinite Canvas 项目；对 beat-workbench 检索 API/task 调用，确认 render-plan 与孤立 verify-chip 依赖。只读使用。 |
| Repomix MCP | `pack_codebase` 以 include 白名单打包 74 个来源文件；`grep_repomix_output` 返回 63 条直接 API/fetch/refetch 匹配。输出在系统 Temp，不在仓库内；未添加依赖。 |
| Context7 MCP | Resolve `/vercel/next.js` 后查询 App Router 同级静态/动态路由优先级；结果指向 Next.js 路由排序实现。 |
| GitHub 官方网页 | 查 DramaClaw 官方 README、release 和 issue；公开网页用于项目背景，具体控件依据仍是本地整合源码和飞书手册。 |
| GitNexus MCP | 已调用检查索引状态，发现没有可用仓库索引；没有运行 analyze，因此没有调用图结论。 |
| Luna 子代理 | 路由代理第七轮最终确认 P0/P1/P2=0。调用映射第二轮发现 2 项 P1、6 项 P2，已修订文档、待第三轮复核。架构 critic 最新增量报告为 REVISE：spec 路由摘要的 focus 歧义已修；仍有页面移植前置门禁未完成。以上均为只读，不代表浏览器或许可审阅。 |

### 可用但本轮未调用

| 工具 | 适用任务 | 约束 |
| --- | --- | --- |
| Browser/CUA | 来源手册与本地页面真实截图、交互、Network 核验 | 页面完成后使用；当前文档阶段不声称已完成浏览器验收 |
| GitHub MCP | GitHub 仓库文件/issue/API 结构化读取 | 当前会话工具表没有 GitHub MCP；公开页面用官方网页链接核对 |

### 用于移植与复用的 Skills

本轮已读取并用于当前方案：Superpowers brainstorming、before-you-build、architecture-analysis、api-and-interface-design、architecture-patterns、architecture-critic、frontend-design、web-component-design、writing-plans。它们分别确定移植范围、识别源码依赖与本地边界、约束页面复用和样式保真、形成可审阅计划。

实施阶段计划使用：test-driven-development（按行为执行 RED → GREEN → REFACTOR）、webapp-testing 与 e2e-testing-patterns（浏览器完整路径和截图）、verification-before-completion（分开记录各项验证）；独立审查由用户要求的只读子代理完成。Skills 是工作流程门禁，不会自动证明许可证兼容，也不代表已运行测试。

没有可用的专用 React 页面移植 Skill。angular-migration 与本项目不匹配；medical-scoped 的 integration-design 和 open-source-license-check 不用于这里的 React 迁移或 Elastic/AGPL 结论。

### 移植审查工具顺序

1. before-you-build + brainstorming 固定源页面、目标能力和排除项。
2. Serena / rg 建依赖图；Repomix 白名单提取可复现审查包。
3. 逐文件 SPDX/版权/license 盘点，检查样式、图标、依赖组件来源。
4. Context7 核实上游路由框架和目标框架文档，只将框架差异限制在 route/container。
5. architecture-analysis 与 api-and-interface-design 锁定 local adapter 和状态映射。
6. architecture-critic 子代理先审架构；frontend-design 与第二个只读代理按真实截图审查页面完整度。
7. 实施后用 TDD、Browser/CUA、静态请求检索和真实 Network 面板验证。

## 许可证边界

来源文件若搬入目标仓库，保留 SPDX、版权和 NOTICE/LICENSE 要求，并记录文件来源、修改内容和日期。先逐文件确认上游许可条款与分发方式，再由维护者审查组合分发路径。当前不作 Elastic-2.0 与 GNU AGPL-3.0 兼容结论；文件许可不能确认时，暂停复制该文件并报告，不能改写或删除声明。

integrations/dramaclaw/frontend/REUSE.toml 还单独标注 public/viewer-kit/quaternius 为 Quaternius CC0-1.0，且 public/fonts 的第三方字体许可核实待完成；不得将这些资源错误地并入 Elastic-2.0 声明。REUSE.toml 还说明 worker、wrangler 配置、GitHub workflows 和 .env 类文件不在公开镜像许可范围；不能因为这些文件在本地源码树中就复制。若拟移植页面依赖 Quaternius 模型或字体，必须作为单独条目纳入清单；字体许可未确认前不复制。

逐文件 manifest 必须包含上游仓库 URL、来源 tag/ref 与完整 commit SHA（若源码副本没有 Git 元数据，记录可验证的归档 URL 和 SHA-256；无法确定来源版本则标为未核实并暂停该文件分发）、source path、目标 path、文件类型、SPDX/copyright、逐项许可证据位置（文件 SPDX 行、REUSE.toml 段落、LICENSE/NOTICE 路径或第三方官方许可链接）、第三方资产/字体/图标许可、原样复用/适配/不复制决定、修改记录、随附 NOTICE/License 文件及维护者审阅状态。

`integrations/dramaclaw/.git` 是失效的 worktree 指针，不能读取其 HEAD。只读比对确认该前端副本以官方 `v2.0.5 / a09248410343158ba227ec40b5a4dbc1ba4b1444` 为文本基线：1,198 个文本文件中 1,180 个换行归一化后相同、18 个不同；1 个 GIF 二进制与 tag 原始 SHA-256 相同。49 个核心路由/资产/query 文件均文本相同；Repomix 补充闭包的 35 个文件中 33 个文本相同、`api/ops.ts` 与 `render-section.tsx` 不同。18 个本地差异未归因到其他上游 commit。具体清单和边界见 `artifacts/dramaclaw-local-creative-suite/source-provenance.md`。版本核验不等于许可证审阅；不同文件要做差异/归属审查，许可门禁仍未完成。

## 外部依据

- [DramaClaw 官方中文 README](https://github.com/dramaclaw/dramaclaw/blob/main/readme/README_zh.md)
- [DramaClaw Releases](https://github.com/dramaclaw/dramaclaw/releases)
- [DramaClaw issue 108](https://github.com/dramaclaw/dramaclaw/issues/108)
- [DramaClaw issue 197](https://github.com/dramaclaw/dramaclaw/issues/197)
- [用户提供的飞书产品手册](https://neo-flying.feishu.cn/docx/JGNTdsjJuo748TxJkxecoYs2nth)

官方 README、release 和 issue 是公开背景材料，不代替飞书页面和本地整合源码对控件的核验。
