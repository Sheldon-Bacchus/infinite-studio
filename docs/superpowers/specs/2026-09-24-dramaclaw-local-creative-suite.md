# DramaClaw 创作模块本地移植规格

状态：历史规格，已于 2026-09-25 被最新范围决定部分取代。本文原定的虾面页面、Freezone 和“回主线”不再实施；当前范围见 [架构范围更新](../../architecture/2026-09-24-dramaclaw-local-creative-suite.md#当前范围更新2026-09-25)。其余记录保留作历史审计，不代表虾面仍在当前产品中。

虾镜整集导入原生虾画的当前规格不在本文；以[2026-09-25 Beat 上下文导入规格](2026-09-25-xiaji-beat-context-canvas-import.md)为准。本文早期生成/回主线接口不授权实施。
架构依据：../../architecture/2026-09-24-dramaclaw-local-creative-suite.md

## 1. 目标

把 DramaClaw 虾料、虾塘、虾镜、虾面四个真实前端模块移植并整合进 Infinite Canvas。优先复用核实过的源组件、布局、视觉结构和交互，再替换不兼容的路由、数据、任务与存储实现。

虾画必须继续使用 Infinite Canvas 原生 CanvasProject、节点、连线、生成配置和保存。虾面可调用目标端原生画布能力，也能把候选结果交给“回主线”流程；用户逐项确认后保存为本地新版本，并保留来源关系。

## 2. 交付范围

### 2.1 虾料

- 对照 DramaClaw ingest 页面迁移上传/粘贴小说或剧本、项目类型、基础风格选择、提交、解析状态、结构预览和错误/空状态。
- 文稿原文和项目结构作为本地 Asset 持久化；基础风格是项目字段，不增加虾格模块。
- 结构生成仅通过 Infinite Canvas 已配置的模型能力。未配置模型时提供真实的不可用原因和可恢复操作，不伪造结构或进度。

### 2.2 虾塘

- /xiaji 是独立全页，不是通用素材筛选页。
- 保留 DramaClaw 虾塘真实角色、场景、道具、声线区域和四类切换；按源控件清单覆盖搜索、统计、主角、详情、表单、预览、筛选、确认、媒体上传/录制/试听/裁剪、本地历史/版本、空态、错误态及响应式布局。
- 角色身份及身份媒体、场景变体及空间信息、道具字段、声线槽位和项目旁白等领域数据保存在本地 Asset metadata 中，保持父子 ID 和关联媒体。
- 对本地不能实现的来源服务操作保留来源位置与语义，禁用并解释原因。

虾塘控件覆盖清单：

- 角色：列表、搜索、统计条、主角标记、添加/编辑/删除；资料、头像和参考图；身份/形象列表与编辑；年龄、外貌服装、体型、面部提示词、身份图、服装图、肖像和本地版本/历史管理。
- 场景：列表、搜索、添加/编辑/删除；基础场景和变体；时间、环境提示词、描述、备注；master、reverse、360 全景、空间布局、自定义 3D/Director World 区域和文件操作。
- 道具：列表、搜索、添加/编辑/删除；类型、别名、所属角色、视觉提示词、描述、备注、参考图和批量上传。
- 声线：角色声线与项目旁白；默认、儿童、青年、中年、老年槽位；上传、录制、试听、从本地素材选音频、裁剪、删除和状态。
- 共用：虾塘页头/项目标题、四类页签、来源搜索/筛选/图片来源选项、卡片、预览、确认框、加载/错误/空状态与移动端排版。

逐项矩阵必须链接来源控件到目标文件、本地行为、测试和截图。来源存在但目标无等价能力的控件也要记录，保留位置并说明禁用原因。

### 2.3 虾镜

- 移植分集列表、剧本、Beat/草图、镜头制作和合成对应的 DramaClaw 前端页面及控件。
- 来源 sketches.lazy.tsx 是跳转到 beats 页面草图子标签的路由，需移植目标页面及跳转语义，不得误判为独立工作台。
- 本地项目、分集、剧本、Beat 与镜头关系沿现有 Asset 持久化表示。按当前已配置的图像、视频、音频能力接通能真实运行的操作。
- 目前尚未核实 Infinite Canvas 有多镜头合成、字幕/旁白/音乐混音等同等本地能力。合成页先保留原布局与可用控件，不能实现的控件标明缺少什么能力，不展示虚假任务进度或成功。

### 2.4 虾面与回主线

- 移植 Freezone 的自由创作入口、资产浏览面板、多参考探索、候选预览/选择和提交交互。
- 不搬 Freezone 画布壳、协作存储、DramaClaw API 和远端提交逻辑。主画布采用 Infinite Canvas 原生 Canvas 页面与节点保存。
- 虾镜中的镜头、Beat 或资产可以作为虾面候选来源并保留 source ID。
- “回主线”让用户选目标类型及目标项目/槽位，预览变更和来源，逐项确认后追加本地新版本。不得静默覆盖原素材；目标数据不完整或保存失败时保留候选并报告结果。
- 目标类型包含角色、场景、道具、Beat 草图、渲染图/首帧和视频。只有在源与目标数据形态均可核实的类型才允许确认保存。

## 3. 明确排除

- 虾格、虾导、虾体及其他未列明的虾X模块。
- 替换 Infinite Canvas 画布、节点模型、连线、助手、生成服务或保存机制。
- 运行、部署或连接 DramaClaw；访问其 host、API、数据库、项目/任务/生成服务。
- 配置 DRAMACLAW_BASE_URL、DRAMACLAW_API_TOKEN，或新增指向 DramaClaw 的代理/连接器。
- 移植 DramaClaw 后端、数据库、Go route、远端 job 状态或源端写回功能。
- 虚构模型能力、任务状态、进度、保存结果、无错误的成功提示。

## 4. 来源文件与移植规则

首批依据：

- integrations/dramaclaw/frontend/REUSE.toml
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/ingest.tsx
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/characters.lazy.tsx
- integrations/dramaclaw/frontend/src/components/assets/ 下场景、道具、声线、角色搜索、统计组件
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/episodes.tsx
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/episodes.$episode/index.lazy.tsx
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/episodes.$episode/overview.lazy.tsx
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/episodes.$episode/script.lazy.tsx
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/episodes.$episode/beats.lazy.tsx
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/episodes.$episode/audio.lazy.tsx
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/episodes.$episode/video.lazy.tsx
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/episodes.$episode/compose.lazy.tsx
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/episodes.$episode/sketches.lazy.tsx
- integrations/dramaclaw/frontend/src/components/assets/character-image-source-select.tsx
- integrations/dramaclaw/frontend/src/components/assets/narrator-voice-panel.tsx
- integrations/dramaclaw/frontend/src/components/assets/asset-beat-references.tsx
- integrations/dramaclaw/frontend/src/routes/_app/projects.$project/freezone.lazy.tsx
- integrations/dramaclaw/frontend/src/features/freezone/FreezoneShell.tsx
- integrations/dramaclaw/frontend/src/features/freezone/AssetLibraryPanel.tsx
- integrations/dramaclaw/frontend/src/features/freezone/AssetLibraryBrowser.tsx
- integrations/dramaclaw/frontend/src/features/freezone/CanvasesTab.tsx
- integrations/dramaclaw/frontend/src/features/freezone/CanvasOutlineList.tsx
- integrations/dramaclaw/frontend/src/features/freezone/capabilities/capabilityRegistry.ts
- integrations/dramaclaw/frontend/src/features/freezone/context/beatContextProjection.ts
- integrations/dramaclaw/frontend/src/features/freezone/commit/

具体相对路径须在实现前用 Serena、rg 和 Repomix 重新验证；此清单不是将来源模块无审查地复制进目标的授权。

### 当前来源到目标的控件映射基线

本表是审阅基线。阶段 0 补齐 import 闭包、所有表单/弹窗/子标签及截图后，必须把具体目标文件和测试 ID 补完整；这张表不能留待实现结束才写。

| 来源页面/控件 | 目标页面/组件 | 目标本地行为 | 必须验证 |
| --- | --- | --- | --- |
| ingest：DramaClaw 项目内上传/粘贴、项目类型、基础风格、结构预览 | `/xiaji/project/[projectAssetId]/ingest`；新建本地项目时由 `/xiaji/ingest` 创建 project Asset 后进入 | 上传文稿与项目记录保存为本地 Asset；结构生成走本地配置模型。来源页对应已有项目上下文；新建入口是目标本地导航 | 字段校验、上传/粘贴、生成成功/失败、重开读取；检查新建和已有项目两条路径 |
| characters/assets：角色列表、搜索、统计、主角、身份表单 | `/xiaji/project/[projectAssetId]/characters` 项目虾塘页及角色详情组件；全局本地虾塘仍为 `/xiaji` | localStudio repository + 现有 xiaTang 字段与媒体关系 | 角色增删改、身份/肖像/参考图、主角状态、来源控件截图 |
| CharacterImageSourceSelect：角色、场景、道具图像区的来源选择 | `web/src/features/xiaji/components/character-image-source-select.tsx`；置于各自资产编辑表单 | adapter 提供目标端确实支持的选项与保存行为；不继承 DramaClaw 配置写入语义 | 原选项逐项盘点、可用/禁用理由、刷新后状态及失败提示 |
| components/assets：场景、场景变体、空间/全景字段 | /xiaji 场景页 | 本地 Asset 子关系；服务端 3D 操作按能力禁用 | 时间/环境/描述、变体、文件/媒体、禁用原因 |
| components/assets：道具类型、别名、角色关联、参考图/批量上传 | /xiaji 道具页 | 本地 Asset 与媒体上传 | CRUD、关联对象、批量上传部分错误 |
| components/assets：角色声线、narrator-voice-panel、声线槽位 | /xiaji 声线页 | 本地音频 Asset、槽位/旁白元数据 | 上传/录制/试听/本地选择/裁剪/删除/错误状态 |
| LazyAssetBeatReferences：角色/场景/道具“出现于镜头”可展开引用及 Beat 深链 | `web/src/features/xiaji/components/asset-beat-references.tsx`；嵌入角色、场景、道具详情 | 从本地 Beat Asset 的 `referencedAssetIds` 按需查询，排序并跳到本地 Beat 锚点；道具名/别名必须唯一解析到稳定 ID | 懒加载、空/加载/未解析状态、分集/镜头排序、跳转目标和引用变更后刷新 |
| episodes.tsx：分集列表 | `/xiaji/project/[projectAssetId]/episodes`；`/xiaji/episodes` 仅作兼容选择器别名 | project/episode Asset parent IDs | 新建、排序、打开、刷新后读取；无项目参数时到项目选择器 |
| script.lazy.tsx + index/overview redirects | `/xiaji/project/[projectAssetId]/episodes/by-id/[episodeAssetId]/script` | script Asset 与 ingest 文稿关系；新 canonical URL 用静态 `by-id` 段；来源数字分集路由按 `sourceEpisodeNumber` 唯一解析、必要时回退唯一 order | 编辑/保存/来源面板/旧 URL 跳转；缺失或重复序号显示冲突 |
| beats.lazy.tsx + sketches/audio/video redirects | `/xiaji/project/[projectAssetId]/episodes/by-id/[episodeAssetId]/beats` | Beat/shot Asset、媒体引用；`sub=text|sketch|render|audio|video`；新持久选择用 `beatAssetId`、一次性定位用 `focusBeatAssetId`，旧数字 `beat`/`focusBeat` 仅兼容；稳定 ID 必须属于路径项目和分集 | 草图/渲染/音频/视频标签、历史 redirect、保存与恢复、focus 消费；仅普通新旧选择同指一项时规范化；新旧 focus 参数并存一律冲突；其他冲突或越界显示可恢复状态 |
| compose.lazy.tsx：镜头组合和成片控件 | `/xiaji/project/[projectAssetId]/episodes/by-id/[episodeAssetId]/compose` | 仅调用目标本地已有能力；compose 跳转只保留 allowlist 中的 `sub` 并写 stable `focusBeatAssetId` | 可用项真实运行；不可用项保留位置、禁用原因和截图 |
| Freezone AssetLibraryPanel/Browser、CanvasesTab、CanvasOutlineList | `/xiaji/project/[projectAssetId]/freezone` + `/canvas/[id]` 原生主画布 | 本地 Asset 选择、CanvasProject 保存；`?canvas` 消费为 Canvas 路径 ID；不搬来源画布壳 | 资产筛选/来源、画布大纲、Canvas 导入/保存/刷新；缺少/无效画布时的恢复路径 |
| Freezone capabilityRegistry/beatContextProjection、commit dialogs | `/xiaji/project/[projectAssetId]/freezone` 候选与“回主线” | 现有画布节点与本地版本 Asset，通过 confirmationId 幂等 | 多参考/多候选/版本、预览确认、冲突/失败恢复 |

虾镜源 index.lazy.tsx 与 overview.lazy.tsx 是保留的跳转；sketches/audio/video.lazy.tsx 分别跳到 beats 的 sketch/audio/video 标签。必须迁移这些导航语义，不得误做重复页面。项目级 assistant.tsx、styles.tsx、tasks.tsx 不整页移植；虾料仍保留基础风格选项。此路由排除须与飞书章节核对。

逐页面建立“来源控件 → 来源组件/样式 → 目标路由/组件 → 本地数据动作 → 测试 → 截图”矩阵。先看源码依赖闭包，再确定复制粒度。保留上游布局和字段；拆离 TanStack Router、React Query、DramaClaw 服务及远端任务代码；本地动作从目标 page adapter 注入。来源文件中任何 Elastic-2.0 SPDX、版权或 NOTICE 内容必须按文件保留并记录修改。开始复制前由维护者审阅许可；不宣称 Elastic-2.0 与目标 AGPL-3.0 兼容。

`LazyAssetBeatReferences` 源控件是按需展开的反向索引：列出资产出现的 episode/beat，按顺序排序并链接到具体 Beat。目标 Beat Asset 使用稳定素材 ID 数组 `referencedAssetIds`；展开时查询本地关系。来源 prop 名称和别名只有在唯一映射到本地 prop Asset 时才写入该数组；找不到或匹配多条时显示未解析状态，不显示成“没有使用”。`CharacterImageSourceSelect` 在角色、场景、道具图像区保留原位置与选项层级；阶段 0 逐项比对 Infinite Canvas 可用的本地图像能力，目标没有等价来源的选项禁用并解释，不向 DramaClaw 保存配置。

### 来源 query/service 调用到本地 adapter 的映射

下表是调用类别概览。逐调用点的源码行号、传参、来源 HTTP 契约、响应/缓存副作用、本地处理或禁用方式已列入 [source-call-map.md](../artifacts/dramaclaw-local-creative-suite/source-call-map.md)。第二轮独立审查发现 2 项 P1、6 项 P2，本版已补完整 render plan/settings 路径、响应字段、缓存订阅方、Beat URL 行为及来源文件清单，待第三轮复核。LocalStudioRepository 方法名是拟议边界；adapter 尚未实现。

| 来源调用与数据域 | 本地 adapter / 行为 | 本地不支持时 |
| --- | --- | --- |
| `ingest.tsx`：`useProject/useUpdateProject`、`useStyles`、`useTasks/useCancelTask`、`useGenerationCreditCost`、章节/知识图数据 | 本地 project/style metadata Asset、文本生成、repository canonical refresh | 远端任务、取消、费用、知识图请求不保留；控件原位禁用并说明 |
| `episodes.tsx`：路由参数/导航、episodes、episode detail、characters/scenes/props、pipelineStatus | 本地 project/episode/asset 查询、保存、排序和路由导航 | 不展示远端 pipeline 状态或伪生成进度 |
| `script.lazy.tsx`：project/episode/characters、script generation/rewrite、generation cost、相关 query invalidation | 本地剧本与角色 Asset；Infinite Canvas 已配置文本模型；保存后读取 canonical Asset | 无本地 provider 或任务状态时原位禁用，保留草稿和错误 |
| `beats.lazy.tsx`：episode beats/detail、script、project update、video backends、tasks；grids/beats/sketchImageUsage/pipelineStatus | 本地 Beat/shot Asset 和媒体关系；现有本地图像/视频能力；repository refresh | 不调用来源 backend/task/credit 服务；逐个生成选项映射或禁用 |
| `compose.lazy.tsx`：compose/final-video、beats/detail/project、pipelineStatus/videoPool/finalVideo 与直接 `api.get/api.post` | 每个 HTTP 调用逐一映射至已有本地媒体/模型/Canvas 能力 | 没有等价调用时拦截源 handler 并禁用入口，不留 DramaClaw 请求 closure |
| `characters.lazy.tsx` 和 assets hooks：角色图像来源、声线、AssetBeatReferences | `listImageSourceOptions/saveImageSourceSelection/listBeatReferences`；本地 Asset、媒体和 Beat 反向索引 | 不保留来源项目设置、远端生成或 references endpoint |
| `freezone.lazy.tsx`/commit：项目列表、能力查询、Beat 投影与提交 | 本地项目 Asset、原生 Canvas、candidate/version Asset 和 operation outbox | 移除来源画布存储、协作、任务和提交 API |

阶段 0 的迁移矩阵还必须记录 query key、HTTP method/路径、mutation、缓存失效副作用、目标 LocalStudioAdapter 方法或禁用文案、测试 ID、来源截图。已知直接请求调用（包括 compose 中 `api.get/api.post`）逐个关闭前不得复制对应 route。

许可 manifest 逐行记录上游仓库 URL、来源 tag/ref 与完整 commit SHA；若源码副本没有 Git 元数据，记录可验证的归档 URL 和 SHA-256，无法确定来源版本则标为未核实并暂停该文件分发。另记录 source path、target path、文件类型、SPDX/copyright、逐项许可证据位置（文件 SPDX 行、REUSE.toml 段落、LICENSE/NOTICE 路径或第三方官方许可链接）、第三方图标/模型/字体许可、原样复用/适配/不复制的决定、变更记录、随附 NOTICE/LICENSE 和维护者审阅状态。按 REUSE.toml，public/viewer-kit/quaternius 是独立 CC0-1.0 资源，public/fonts 许可仍待确认；worker、wrangler、.github/workflows、.env 类文件不在公开镜像许可范围，不纳入复制闭包。字体许可未核实前不复制。

`integrations/dramaclaw/.git` 指向不存在的 linked worktree gitdir，不能读取本地 HEAD。现已从官方 tag 核实 v2.0.5 的完整 commit 为 `a09248410343158ba227ec40b5a4dbc1ba4b1444`。全量 1,199 项按类型比较：1,198 个文本文件中 1,180 个换行归一化后相同、18 个不同；1 个 GIF 二进制原始 SHA-256 相同。Repomix 74 文件依赖闭包中 35 个不在 49 项核心清单内，33 个文本相同、2 个不同（`api/ops.ts`、beat-workbench `render-section.tsx`）。详细文件清单、方法与边界见 [source-provenance.md](../artifacts/dramaclaw-local-creative-suite/source-provenance.md)。这不代表本地副本整个目录等同于官方 tag，也不代表许可证已批准；不同文件先做差异/归属审查。

## 5. 本地数据和接口约束

使用 Infinite Canvas 现有本地 Asset 与文件能力；不增加 Go handler、表或外部服务。

建议 metadata 命名空间 localStudio，schemaVersion=1：

- project：projectType、baseStyle、原文 Asset 引用与创建信息。
- episode：projectAssetId、必填且项目内唯一的正整数 `order`、可选的来源 `sourceEpisodeNumber`、标题、概要和 scriptAssetId。导入时初始 `order=sourceEpisodeNumber`；后续排序只改 `order`，不改来源序号。
- script/structure：documentKind、projectAssetId、episodeAssetId；正文保存在 text Asset 的 data.content。
- beat/shot：projectAssetId、episodeAssetId、必填且分集内唯一的正整数 `order`、可选的来源 `sourceBeatNumber`、文本/图像/视频候选 ID 和来源 Canvas node ID。新 URL 用稳定 `beatAssetId` / `focusBeatAssetId`，并必须在当前项目和分集内唯一解析；旧数字 `beat` / `focusBeat` 按来源序号唯一解析，手工创建项没有来源序号时才按 order 解析。新旧普通选择参数同时出现时分别解析，同指一项才规范化到稳定键；冲突、无效或跨项目/分集时进入可恢复错误状态。一次性 focus 的 `focusBeatAssetId` 与旧 `focusBeat` 同时出现时一律显示冲突，即使两者解析到同一 Beat。
- xiaTang：延续当前 xiaTang metadata 模型，新增字段先兼容读取；身份、变体、声线槽位作为稳定子 Asset，媒体引用 parentAssetId 与 slot。
- candidate/version：sourceCanvasId、sourceNodeId、sourceAssetId、目标类型、目标/槽位、稳定 versionAssetId、确认时间和本地 confirmationId。

版本和幂等约束：versionAssetId 是稳定版本记录 ID，不承诺递增整数。每次用户确认动作先生成并保存 confirmationId/versionAssetId；相同动作重试必须复用相同 ID 和相同 payload，以稳定 Asset ID 防重复记录。不同确认动作保留为独立版本。没有 CAS 时不承诺跨标签页顺序或单活跃版本指针；若要切换当前版本，先比对 canonical 状态并由用户确认冲突处理。

### “回主线”刷新恢复与幂等 outbox

确认意图必须在目标版本写入前，作为现有本地 Asset store 中的内部 text Asset 持久化：Asset metadata 标记 `localStudio.internalKind=return-to-mainline-operation`，保存状态、confirmationId、versionAssetId、source/target IDs；`data.content` 存放冻结的 JSON payload（包括领域字段和媒体引用，不包含二进制媒体）。这不新增 Go 路由、数据库表或远端服务。内部操作 Asset 必须从普通素材列表、搜索、数量统计、筛选和选择器中过滤，只能由 recovery repository 访问。

写入顺序与恢复：

1. 先用可等待的 Asset sync 保存 operation intent，并核对返回的 canonical operation；失败时不能触碰目标 Asset。
2. 用 intent 中原样保存的 versionAssetId 和冻结 payload 写目标版本 Asset。
3. 若请求超时或客户端无法确认结果，刷新后扫描待处理 intent 并读取目标 canonical Asset：同 ID 且 payload 相同则认定提交已完成；目标记录不存在则沿用同 ID 和同 payload 重试；同 ID 但 payload 不同则报冲突、保留候选并停止自动覆盖。
4. 核对目标 Asset 后将 operation 更新为完成。若此状态更新失败，下次恢复仍通过目标 canonical Asset 收敛，不重复创建版本。

必须覆盖“服务端已提交但响应丢失，浏览器刷新后恢复”的测试路径；确认意图和冻结 payload 不可只存在 React 状态或未持久化队列中。

适配要求：

- 在 page/container 边界创建 feature-owned repository/adapter；视图不自行拼远端 URL，不散布文件 I/O。
- 前端 Asset 使用 /api/local/assets 与 /api/local/assets/sync；不要把 Go model.Asset 当成同一套前端 Asset 联合类型。现有 useAssetStore.addAsset 只返回 ID 并排入防抖同步，updateAsset 返回 void。特殊流程必须有可等待的持久化 action，调用现有本地 sync API 并读取返回的 canonical Asset 列表后才报告成功、更新 UI store。
- /api/local/assets/sync 对单次请求采用数据库事务：一个逻辑批次全有或全败，不提供逐条部分成功。UI 分批提交时，按批次反馈；任一批次失败不把失败记录从候选或表单清掉。
- 文件上传与 Asset 同步不在同一事务。文件上传成功而 Asset 批次失败时保留文件引用供安全重试，反馈“媒体已保存、资产记录未提交”；不能报整体成功或自动删文件。
- 依据 canonical Asset 比较用户提交的目标记录。若现有时间戳 merge 让服务保留了其他内容，报告冲突，保留候选和用户输入供显式处理；不宣称有 CAS。
- 复用目标 Canvas node 类型与 Canvas sync API。当前 saveProjectAndWait 等待请求但丢弃返回的 canonical 项目列表；虾面专用路径必须检查同步接口返回值与目标项目是否一致，不一致则提示冲突并保留候选。不创建连线、不覆盖已有节点、不用旧快照写回。
- 生成请求使用本地已配置模型与渠道；不加入新 provider 配置的隐式假设。

适配器接口在实现前定型为页面容器注入的 LocalStudioAdapter：loadProject、loadEpisode、listAssets、saveAssetBatch、uploadMedia、generateText、调用已有图/视频生成入口、saveCanvas、listImageSourceOptions、saveImageSourceSelection、listBeatReferences、prepareReturnOperation、recoverPendingReturnOperations、completeReturnOperation。加载采用本地 canonical snapshot；写入返回 canonical records 或可区分的 validation、missing-media、provider-unavailable、provider-failed、asset-sync-failed、canonical-conflict、canvas-save-failed。来源页面的 query invalidation 转为本地 repository refresh；视图不直接请求 DramaClaw。各方法的参数和返回类型要在阶段 0 对照来源组件实际消费字段冻结。

资产类型字段映射必须逐字段审查现有 xia-tang-local-model.ts 的 unknown metadata，再用 codec/schema 校验源字段和旧数据兼容；不得把来源字段宽松塞入 Record 后就当迁移完成。

## 6. 路由与交互验收

最终目标路由以 [route-map.md](../artifacts/dramaclaw-local-creative-suite/route-map.md) 为准：`/xiaji` 虾塘全页；`/xiaji/ingest` 新建虾料；`/xiaji/projects` 本地项目选择器；DramaClaw 项目 ingest 和虾塘分别映射到 `/xiaji/project/[projectAssetId]/ingest` 与 `/xiaji/project/[projectAssetId]/characters`；分集页面 canonical path 以静态 `/episodes/by-id/[episodeAssetId]` 段区分旧数字 URL；其下含 script、beats、compose，另有项目级 freezone；原生虾画 URL 为 `/canvas/[id]`（现有目录参数名），Freezone 入口携带可校验的本地项目上下文。`/xiaji/episodes` 仅作兼容 alias。数字分集/镜头、`beatAssetId`/`focusBeatAssetId`、`sub` 和 `?canvas` 解析规则已定义，但路由实现/回归用例尚未进行。

每个界面验收包括：

- 控件、选项、标签和表单字段与来源页面逐项对照。
- 页面宽屏和窄屏排版、弹窗层级、卡片状态、空态、加载态、错误态和禁用态。
- 页面截图应有相同或可比较视口与交互状态，并在来源/目标间逐项复查。
- 不以截图相似代替真实行为，不以通用素材 CRUD 代替来源功能。

## 7. TDD 与验证验收

实施每个行为使用 Superpowers TDD：

1. 写明确描述预期行为的失败测试。
2. 单独运行该测试，记录观察到的 RED。
3. 写最小实现使测试 GREEN。
4. REFACTOR 并重跑相关测试。

验证分层报告真实执行结果：

- 单元：metadata schema/codec、父子关系、过滤、media slot、映射、去重与失败分项。
- 集成：本地 Asset repository、文件上传、本地 generation adapter、Canvas 导入与保存、回主线追加版本及失败恢复。
- E2E：虾料新建项目 → 虾塘编辑 → 虾镜分集/Beat/镜头 → 虾面多参考候选 → 确认回主线 → 刷新读取确认结果。
- Smoke：模块路由可加载，关键入口可操作，禁用操作给出原因，既有画布可正常打开。
- TypeScript：执行项目已配置的类型检查命令。
- 浏览器 Network：现场检查没有 DramaClaw host、/api/v1/drama/* 或上游项目/任务请求。若浏览器工具不能访问 Network 面板，清楚报告限制，不把源码检索说成 Network 验收。
- 截图：来源与目标页面分别保存、实际打开查看，按控件矩阵标记差异。

不得用单测通过代表整体验收通过。每次报告必须区分单测、集成、E2E、smoke、类型检查、浏览器交互、截图对照和 Network 检查；未实际完成的项目保持未验收。

## 8. MCP、Skills 与审阅声明

### 前期方案核对中实际使用

- Serena MCP：在 Infinite Canvas 根激活项目；搜索 beat-workbench 内 API /任务调用，确认 `render-plan-dialog` 的费用直请求，并确认 `verify-chip` 是当前源码未引用的孤立导出。
- Repomix MCP：`pack_codebase` 用精确 include patterns 打包 74 个来源文件（1,626,720 字符、379,321 tokens）；`grep_repomix_output` 搜到 63 条直接 API/fetch/refetch 匹配。MCP 输出存放在系统 Temp 目录，没有写进仓库或添加依赖。
- Context7 MCP：先 resolve `/vercel/next.js`，再查询 App Router 同级静态/动态段优先级；结果引用 Next.js 的路由排序实现。规格中的保留静态段规则据此保留。
- PowerShell `rg` 与官方 Git 只读查询：核对源调用行号、`verify-chip` 无引用，以及 `v2.0.5` tag / `main` tip；完整提交与归一化比较口径见 [来源版本核验](../artifacts/dramaclaw-local-creative-suite/source-provenance.md)。
- 路由代理第七轮最终只读确认 P0/P1/P2=0：稳定分集路径、普通 Beat 选择参数同项规范化、focus 新旧参数并存一律冲突、项目/分集归属、人物新旧深链、compose search allowlist 与 Canvas `[id]` 在 route-map/spec/architecture/plan 中一致。调用映射第二轮发现的 2 项 P1、6 项 P2 已逐项修订，待第三轮复核；静态核对包含 `render-plan-dialog`、孤立 `verify-chip` 与 Beat query hook。控件矩阵、逐文件许可证清单和维护者许可审阅仍未完成，页面移植门禁未关闭。

### 本轮实施续作（2026-09-25）实际使用

- Serena MCP：激活 Infinite Canvas 项目并静态搜索虾塘路由中的 `DRAMACLAW_BASE_URL`、`DRAMACLAW_API_TOKEN`、`/api/v1/drama`，没有命中；这是源码检索，不是运行时请求证明。
- Repomix MCP：打包来源/目标审查闭包（216 个文件，临时输出），并检索上述 DramaClaw host/API 字串，未命中；输出保留在系统临时区，不写入仓库。
- CUA 浏览器：查看飞书手册虾塘与虾镜脚本章节；2026-09-25 本地生产服务启动后，`/xiaji/projects` 成功加载并显示空项目状态。没有项目数据，因此本次只确认路由加载；未读取 DevTools Network，也未跑创作/连接器/刷新 E2E。
- GitHub MCP、Context7 MCP、子代理：本轮未调用；不把前期方案记录当成本轮复审或浏览器验收。

### Skills

- 本轮实际读取并应用：before-you-build（收敛本轮可实现范围）、test-driven-development（新增行为测试先 RED 再 GREEN）、frontend-design（参考飞书虾塘/虾镜真实页面结构）。
- 本轮未重跑 architecture-analysis、api-and-interface-design、architecture-patterns、architecture-critic 或 writing-plans；其已有方案结论是设计依据，不代表本轮新审查。
- webapp-testing、e2e-testing-patterns、verification-before-completion 尚未用于真实登录后 E2E；浏览器登录门槛解除后再执行。
- 专项迁移流程由 Serena 依赖闭包、Repomix 证据包、Context7 框架文档、SPDX/license 逐文件审查和双路只读审阅组成；不存在本项目可用的专用 React 移植 Skill。

## 9. 当前实施记录（2026-09-25）

### 已实现并自动验证的部分

- 虾料本地项目/原稿/分集记录、结构解析及项目文本生成提示词；目标数据写入 Infinite Canvas 本地 Asset。
- 虾塘已有本地角色、场景、道具、声线页面与素材关系；本轮补充声线年龄槽位布局/主线声线状态及来源关联细节。它尚未通过来源/目标逐控件截图对照，不能标为完整像素/交互移植。
- 虾镜分集卡片显示脚本/Beat/资产规划统计；脚本页增加原稿与资产规划、剧本编辑/生成和 Beat 预览；Beat 保存台词/解说词与本地资产引用。
- 虾面本地 Freezone 页面、素材浏览/原生画布入口和候选回主线代码已有实现；回主线现在要求候选节点明确为 `success`，测试覆盖追加新版本和保留来源节点。持久 outbox 刷新恢复、完整目标冲突恢复和浏览器路径仍需验收。
- 本轮 `bun test`：56 个文件、241 项通过、0 失败、894 次断言；`bunx tsc --noEmit` 通过。TDD RED→GREEN 证据包括回主线状态守卫、分集“查看详情”、剧本提示词模块和 Beat 台词持久化测试。

### 尚未验收或尚缺实现

- [来源控件矩阵](../artifacts/dramaclaw-local-creative-suite/source-to-target-matrix.md)记录了目前的目标代码、自动化证据和未完成项；完整来源布局、全部选项/表单/弹窗及窄屏行为还未逐项映射完成。
- 当前浏览器生产版 `/xiaji/projects` 可加载；启动器的服务健康和本地 API 桥接检查已通过。项目级创作/连接器/刷新流程仍未完成真实浏览器 E2E；来源/目标截图逐页对照也未完成。
- 本轮未读取浏览器 DevTools Network。Serena/Repomix 静态检索没有发现指定 DramaClaw host/API 字串，只能作为静态证据，不能替代运行时 Network 验证。
- 逐文件许可证 manifest 和对 Elastic-2.0/目标 AGPL-3.0 组合分发的维护者审查仍未完成；来源文件继续按文件核验，不宣称许可兼容。
- 无本地等价服务的多镜头成片合成、旁白/字幕/音乐混音、Director World 3D 远端操作仍不得伪造成功。

以上记录取代早期文档中“等待用户确认后才开始实施”的状态。实现继续受既定集成边界、工作区保护和验证标准约束。
