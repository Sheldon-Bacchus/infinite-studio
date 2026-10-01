# DramaClaw 虾塘移植与无限画布连接设计

历史稿说明：本稿已被后续虾塘规格取代；四模块及回主线的当前总体范围见 docs/superpowers/specs/2026-09-24-dramaclaw-local-creative-suite.md。

状态：历史稿 v18，已被 `2026-09-24-xiaji-xiahua-frontend-connector.md` 取代。本文关于 DramaClaw 运行服务、`DRAMACLAW_BASE_URL`、上游 API 代理、生成任务和写回的决定全部废止；不要据此继续实施。
修订日期：2026-09-23

## 1. 产品目标与边界

- 虾画继续使用用户选定的 tigerowo/infinite-canvas，保留其 CanvasProject、节点/连线、文件存储和生成配置。
- 虾塘是 infinite-canvas 内独立的 /xiaji 全页。“整个虾塘”按 DramaClaw 项目资产页 `/projects/{project}/characters` 界定：完整移植该页角色、场景、道具、声线四个页签及其真实领域操作，并保留项目上下文/生命周期。虾塘不是画布侧栏中的通用素材库；虾集内的虾料、虾镜、虾导、虾格等兄弟工作区另行排除。目标仓库当前 `/xiaji` 路由承载旧 episode/beat 导入页；该旧流程迁至 `/xiaji/episodes` 并保留独立入口和原有 `DramaCanvasProjection` 语义，新 `/xiaji` 资产工作区不把 episode/beat 当作领域主模型。
- 虾塘与虾画通过两个显式动作连接：虾塘的“发送到虾画”；虾画工具栏的“虾塘素材”入口。虾画入口打开挑选器，不把完整虾塘页面嵌成侧栏。
- 本期不强制“虾料→虾塘→虾镜”等流水线顺序。分镜、集数、虾料、虾镜、虾格、虾条、虾导等独立模块不纳入本期；虾塘场景页内的导演世界、全景及 3GS 操作属于虾塘真实能力，保留。DramaClaw 的 /projects/{project}/freezone 是另一套画布工作区，不移植其画布壳、画布存储或协作逻辑；它的候选上传、影响预览和槽位 push API 只作为虾塘写回的后端能力复用。
- 本阶段只完成设计与独立评级，不写产品代码、不安装依赖、不运行项目、不运行构建或测试。

### 1.1 成功标准

1. /xiaji 能选择 DramaClaw 项目并展示完整的角色、场景、道具、声线页面；各页沿用 DramaClaw 的信息布局和不同领域操作，不压成文本/图片/视频/音频通用卡片页。
2. 项目总览保留源端项目选择、新建、设置、归档/恢复/软删除/永久清理；角色、场景、道具、声线页覆盖源端真实领域操作及专有异步状态。
3. 用户可从虾塘选择单个或多个实体/媒体角色发送到新画布或已有画布；也可在虾画当前画布直接打开虾塘挑选器并添加。
4. 导入只将用户选中且源数据可读取的内容投影到无限画布节点；不自动生成媒体、不导入未选的分镜/集数，不覆盖源端数据、用户创建的节点或连线。普通节点只追加；同一虾塘来源组的 3D 当前快照可将用户新选且尚未导入的资源追加到该虾塘创建的 Director 节点，保留其现有节点和项目字段；显式新快照才创建新 Director 节点。图片/全景/视频/音频/文本使用现有节点。
5. 普通图像生成沿用 infinite-canvas 已有图像服务与用户配置；AutoDL/MCP 仅在确有可调用 API 或返回媒体/任务的 MCP 契约时接入；当前 AutoDL helper 只证实 workflow 查询，不证实在线文生图。虾塘没有的音频生成不额外创造。DramaClaw 独有的构建、全景、导演世界和 3GS 继续走对应领域接口，不建泛化 /jobs。
6. 生成结果只有在用户明确确认后才写回虾塘，并按“保存候选、创建角色身份、替换具体槽位、恢复角色素材历史”等源端真实语义执行。
7. 缺失媒体、上游错误、部分导入、画布本地保存失败、写回结果未知均显示为不同状态，不伪装成成功或空目录。
8. 旧 episode/beat 导入在 `/xiaji/episodes` 保持独立可达；其数据源、投影、写回和重复导入语义不被新虾塘页面改写。
验收逐项对照（每一行均须在对应页面可实际完成；按钮存在但没有真实 API/状态映射不算完成）：

| 页面 | 必须可用的操作与状态 |
|---|---|
| 项目 | 列表/筛选/选择；新建、读取/编辑配置、归档/取消归档、软删除/恢复、权限允许时永久清理；无永久清理权限时禁用操作并说明原因；加载、空列表、无权限和服务不可达状态 |
| 角色 | 列表/详情/CRUD/build；头像；身份 CRUD、身份主图/头像/服装、attempts、素材历史/恢复；角色 voice sample 上传/录制/裁剪/删除 |
| 场景 | 列表/详情/变体/plate preview、CRUD/build；master、reverse、pano、custom、director-world、3GS；每类源端任务进度、失败和结果刷新。3D 预览/源端操作照常展示；发送到虾画只开放已有实际 manifest 样本和目标 Director schema 映射的格式，其余格式明确禁用并保留在虾塘 |
| 道具 | 列表/CRUD、参考图候选与 impact/push 写回确认；空状态和源端错误 |
| 声线 | 角色与旁白声线读取/来源、上传/录制/复制/裁剪/删除；播放器及加载/失败状态 |
| 共用任务与写回 | task list/limits/SSE/取消确认；provider 等待、超时未知、刷新核对；写回的候选/身份/槽位目标与 stale 响应 |

上述必需动作须逐条对应 §6.2 的源端 method/path 与成功刷新。源 UI 中不在首期支持的动作必须在界面明确禁用并说明原因；不得把未接通的按钮计作可用。

### 1.2 主质量属性

- 领域保真：虾塘四类资源的真实字段、操作和状态保持可用。
- 来源可追溯：画布投影可以追溯到 DramaClaw 项目、实体和媒体槽位。
- 可恢复性：跨系统失败不丢失用户选择，不盲目重试非幂等写回。
- 本期规模假设：单个本地 infinite-canvas 实例、单一 DramaClaw 服务凭据、同一画布单活跃写入窗口；多用户权限映射和跨标签并发写入不在首期承诺内。媒体服务以流式方式写入临时文件并增量计算存储校验和，不把完整媒体文件读入内存。

## 2. 用户界面证据与代码依据

### 2.1 布局依据

- 用户提供的窄图是虾画内素材选择面板示例，只能说明画布内挑选入口，不是完整虾塘页面。
- 已查看用户提供的飞书手册中角色、场景、道具、声线，以及虾镜/虾画入口截图。角色页采用角色列表与详情组织；场景/道具各有自己的资源与操作区；声线页有播放器、上传/录制/裁剪操作。实施视觉验收应逐页对照这些实页。
- integrations/dramaclaw/assets/readme/asset-library.jpg 是 README 概念图，不是产品界面证据。
- 飞书手册链接：https://neo-flying.feishu.cn/docx/JGNTdsjJuo748TxJkxecoYs2nth

### 2.2 DramaClaw 源码依据

- 四页入口及角色页：integrations/dramaclaw/frontend/src/routes/_app/projects.$project/characters.lazy.tsx
- 角色接口 hooks：integrations/dramaclaw/frontend/src/lib/queries/characters.ts
- 场景接口 hooks/组件：integrations/dramaclaw/frontend/src/lib/queries/scenes.ts、components/assets/scenes-panel.tsx
- 道具接口 hooks/组件：integrations/dramaclaw/frontend/src/lib/queries/props.ts、components/assets/props-panel.tsx
- 角色/旁白声线页面：components/assets/character-voice-panel.tsx、narrator-voice-panel.tsx
- 项目资产页和分类组件：integrations/dramaclaw/frontend/src/routes/_app/projects.$project/characters.lazy.tsx、components/assets/；这些页中的 openPresetProjectionInMyCanvas 按钮指向 DramaClaw Freezone。目标端将该动作改为发送到无限画布。
- 源 Freezone 路由与组件：integrations/dramaclaw/frontend/src/routes/_app/projects.$project/freezone.lazy.tsx、features/freezone/；它是独立画布，不属于虾塘页面移植范围。
- 后端路由：integrations/dramaclaw/src/novelvideo/api/routes/characters.py、scenes.py、props.py、projects.py、tasks.py、freezone.py
- 场景 3D viewer：integrations/dramaclaw/frontend/src/features/viewer-kit/three-d/ThreeDStageCanvas.tsx、engine/viewerApp.ts、directorManifest.ts；源端 viewer 识别 .ply、.sog、.splat、.ksplat 等 3GS URL。
- API 根路径由源端 api_router 设置为 /api/v1；本规格下文列出的源端路径均相对于该根路径。

### 2.3 infinite-canvas 当前实现依据

- 当前 `web/src/app/(user)/xiaji/page.tsx` 将 `/xiaji` 路由指向 `web/src/features/xiaji/xiaji-client-page.tsx`，后者承载旧 episode/beat 导入工作流，不是完整 DramaClaw 虾塘。设计将旧工作流保留为 `/xiaji/episodes`，由新虾塘全页替换 `/xiaji` 路由壳；旧入口从主导航明确可达。
- 当前 Go 路由已桥接 import-catalog、媒体、候选上传、identity 创建、push、impact、角色 history/restore：router/router.go 与 service/drama_import.go。现有 GET /api/v1/drama/media?url=... 仅检查上游 same-origin，未把静态路径与用户选择的 projectId 绑定；虾塘新页面及旧 episode 迁移后的媒体读取须传 projectId 并强化该路径校验。
- 当前投影已有 DramaCanvasProjection、mergeDramaCanvasProjection、projectionKey 和 DramaClaw 来源元数据：web/src/app/(user)/canvas/utils/drama-import.ts。
- 当前 CanvasProject 由 useCanvasStore 管理，通过本地工作区服务持久化：web/src/app/(user)/canvas/stores/use-canvas-store.ts。
- 后端另有单项保存、批量 sync、文件导入和删除路由；本设计要求 router/router.go 中的 POST /api/local/canvas/projects、/sync、/import、/delete 全部使用同一 revision CAS。
- 当前本地上传 handler 对完整 multipart 请求体（含 framing）设置 512 MiB 上限，通过 FormFile 取得 part，再由 UploadLocalStorageReader 流式写临时文件并增量计算 SHA-256；service/local_storage.go 现有 StorageObject 按 SHA-256 去重，但当前没有持久化请求收据，rename 后才保存 StorageObject 记录，进程崩溃仍可能留下无记录文件。目标方案保留现有内容去重语义，增加有界 multipart 解析和持久化 receipt 以关闭崩溃窗口。单文件/单批 payload 上限为 510 MiB，媒体串行传输。
- 目标已有 CanvasNodeType.Director、metadata.directorProject 和 web/src/app/(user)/canvas/components/canvas-director.tsx；现有模型导入 UI 接受 .fbx/.obj。仓库当前构建产物 web/public/director/assets/index-oQuo7db8.js 中的根对象校验要求 version=1、assets/objects/cameras 为数组，且 scene.backgroundColor 为字符串；默认项目另含 activeCameraId、panoramaAssetId、timeline。它只证明根 envelope 与部分必需字段，不证明模型 asset 条目的字段、存储和加载语义，后者仍须按真实样本适配。
- 当前目标尚无画布内虾塘资源选择器；本设计新增工具栏入口，但复用同一个投影函数，不新增投影 HTTP 服务。

## 3. 已锁定的系统边界

| 数据/行为 | 系统记录与执行方 | infinite-canvas 职责 |
|---|---|---|
| DramaClaw 项目、角色、场景、道具、声线与源媒体 | DramaClaw 服务为唯一记录源 | 同源 API 代理、认证与错误呈现 |
| 虾塘领域页面操作和 DramaClaw 特有任务 | DramaClaw 对应 API/task | 适配组件与 API 根路径；展示源端状态 |
| CanvasProject、画布节点和连线 | infinite-canvas 本地工作区 | 保存所选内容的静态投影及来源元数据 |
| 虾塘标准图像生成 | infinite-canvas 当前图像 provider 配置与 image service | 生成并预览；用户确认后才调用 DramaClaw 槽位写接口 |
| 生成文件尚未写回虾塘时的候选 | DramaClaw freezone 候选区 | 先上传候选；用户确认后执行源端身份创建或槽位替换 |

### 3.1 后端承载决策：采用 DramaClaw 领域服务 + Go 同源适配器

本期选定方案 A：保留 DramaClaw 作为虾塘数据、领域操作、媒体和专有任务的系统记录方；本地集成启动/连接该服务，infinite-canvas Go 服务以 DRAMACLAW_BASE_URL 和服务端 DRAMACLAW_API_TOKEN 代理允许的 API。无需把角色/场景/道具/声线数据模型再复制一份到 Go，也不做双写。现有目录、媒体和写回桥接继续保留。

选择依据：目标是完整复用虾塘的页面行为和源端语义；这些操作包含文件系统、项目角色权限、特殊场景任务和专属状态，全部移植成 Go 会形成第二套实现和迁移一致性问题。A 的运行代价是目标部署必须能启动或访问 DramaClaw 服务，并继续满足其 Python/数据目录/模型配置依赖。

单实例身份约束：Go 只在服务端持有配置的 DramaClaw 凭据；浏览器不获得上游 token。项目选择列表使用该凭据实际可访问的项目。首期假设一个本地用户/一个上游授权主体。如果目标以多用户方式部署，必须先为每个目标用户建立独立上游身份或受控项目映射，不能让所有用户共用一个高权限 token。

未配置或上游不可达时，独立虾集页面显示明确的“服务未配置/连接失败”状态及重试入口，不要求用户手输项目 ID，也不显示伪空目录。
### 3.2 备选方案与重审条件

| 方案 | 决定 | 理由与代价 |
|---|---|---|
| A. DramaClaw 服务保留数据/领域逻辑，Go 精确 allowlist 代理，页面移植到 Next.js | 采用 | 复用真实的文件、项目权限、专有任务和槽位写回语义；代价是部署必须持续提供 DramaClaw 服务及其数据目录 |
| B. 把角色/场景/道具/声线后端整体迁入 Go | 本期不采用 | 会复制领域逻辑与存储，形成第二记录源和迁移责任；只有 DramaClaw 无法在目标部署运行、且已定数据迁移与兼容策略时才重审 |
| C. 浏览器直接请求 DramaClaw | 不采用 | 会把上游认证与跨域/权限边界暴露给浏览器，不满足同源凭据约束 |

若部署从单机本地转为多用户服务，或无法让 Go 访问 DramaClaw 服务/数据目录，必须重新比较 A/B 并先定用户身份映射；不得默默改变记录方。

## 4. 页面移植与项目上下文

### 4.1 虾塘全页

- 独立路由 /xiaji；虾塘全页和虾画挑选器共用项目摘要查询契约与缓存 key。角色/场景/道具/声线详情和可导入素材分别使用自己的领域 query key，不共用全页生命周期状态缓存。源端摘要接口为 GET /projects/summaries?status=visible；visible 包含未软删除项目，不包含已删除项目。归档项目按源端 UI 状态筛选显示。
- 项目总览保留 DramaClaw 当前用户可见的项目生命周期操作：新建、项目配置读取/编辑、归档/取消归档、软删除/恢复及源端 UI 提供的永久清理。永久清理沿用源端权限和二次确认，不在 Go 中实现另一套项目状态机。
- 当前项目上下文优先级固定为 URL 查询参数 sourceProjectId → 当前标签页 sessionStorage 中最近使用项目 → 项目选择器。项目不可访问或已删除时清除无效上下文并要求重新选择。
- 画布挑选器优先使用虾塘页面传入的 projectId，其次使用同标签页最近项目，否则显示相同项目选择器。CanvasProject 不与某个 DramaClaw 项目永久绑定。
- 项目 ID 不作为日常手工输入项；必要的手工 ID 只作为诊断入口，不进入主流程。
- 四类领域页面直接移植 DramaClaw 当前组件与交互，再将 TanStack Router、认证/API 客户端、query hooks 和 UI 依赖接到 Next.js/infinite-canvas；保留源端真实字段、动作、错误态和布局层级。角色/场景/道具页现有 openPresetProjectionInMyCanvas 入口改为“发送到虾画”，保存到 infinite-canvas 选中的新画布或已有画布，不再打开 DramaClaw Freezone。
- 每类资源继续使用自己的领域模型与组件。角色身份/服装、场景主图/背面/全景/自定义资源/导演世界和声线 slot 不压成通用素材卡片。
- 当前 `/xiaji` 中的 `XiaJiClientPage` 不随路由替换而删除：迁至 `/xiaji/episodes`，保留 episode/beat 目录、旧 `DramaImportAsset`/`DramaCanvasProjection`、媒体处理和写回行为；新虾塘组件使用独立 `XiaTangProjectionSelection`/builder。旧工作流由主导航“集数/分镜导入”入口进入；画布内“虾塘素材”挑选器仅接新四类领域目录，不混入旧 episode/beat 分类，也不改变旧投影 key 或数据语义。
- 旧路由兼容按当前源码行为冻结：`/xiaji/episodes` 必须支持直接访问和刷新并加载原 `XiaJiClientPage`；当前页面没有 URL query 状态，`sourceProjectId` 是手工输入的组件状态，刷新后需重新输入并读取项目，不新增 query 参数或伪称能恢复旧页面状态。旧页面继续走 `DramaImportAsset`、episode/beat 目录、旧媒体处理、写回和旧 `projectionKey`；新 `/xiaji` 与画布“虾塘素材”挑选器不得调用 episode/beat catalog API。导航分别指向新 `/xiaji` 与旧 `/xiaji/episodes`。
- 普通角色/身份/场景/道具图片生成改用 infinite-canvas 已有图像生成服务和用户选定配置；生成结果先预览，确认后调用源端对应上传或写回槽位。DramaClaw 特有的构建、全景和 3GS 操作仍调用源端领域接口。
- 用户点击“发送到虾画”后，选择新建或已有 CanvasProject；目标画布成功保存导入项后再导航过去。

### 4.2 虾画内入口

- 虾画顶部工具栏提供“虾塘素材”入口；打开独立挑选器弹窗，不依赖右键命中区，也不把完整虾塘页面放进画布侧栏。
- 挑选器只负责只读浏览、分类、搜索、选择项目/实体/媒体角色和确认导入；不在弹窗内创建、编辑、上传、生成或删除虾塘资源。需要编辑时用“在虾塘打开”跳到独立 /xiaji 页面。
- 选择数到 50 项时禁用继续选择并显示上限；能读取文件长度时显示本批剩余 MiB 并在超过 510 MiB 前阻止确认。未知长度由服务端流式计数，超限逐项提示并保留其它有效选择；前端估算不取代后端强制限制。
- 两个入口共享 projectSelectedXiaTangAssets 投影动作和媒体准备流程。虾塘入口由用户选择目标画布，虾画入口使用当前画布。

## 5. 端到端数据流与投影语义

1. Go 以服务端配置的 DramaClaw 身份读取可见项目摘要；虾塘全页和画布挑选器使用同一查询及 sourceProjectId 上下文。
2. 四类页面使用源端 Character、Scene、Prop、CharacterVoiceSample、NarratorVoice 领域模型和各自 typed query/mutation。现有 DramaImportAsset 只继续服务 episode/beat 导入。
3. 画布投影输入是独立的 XiaTangProjectionSelection：sourceProjectId、entityType、entityId、mediaRole、mediaType、displayLabel、用户明确选择的 displayText、sourceMediaUrl、源端 revision（仅源端确实提供时）及读取时间。sourceSystem 不由浏览器传入，由连接器固定设置为 "dramaclaw"。不保存完整源端 JSON、凭据或任意 meta map。
4. 用户明确选择实体与具体媒体角色。选择角色不自动选择全部身份/服装/声线，选择场景不自动选择所有空间文件；只有用户勾选项进入画布。文本节点只含明确选择的展示字段，媒体节点关联已复制到目标存储的媒体。
5. 虾塘“发送到虾画”和虾画挑选器调用同一个前端操作：projectSelectedXiaTangAssets({ batchId, sourceProjectId, targetCanvasId, selections })。输入项按源实体和具体媒体角色区分；返回每项 added、skipped 或 failed 及可读错误。
6. 先读取所选源实体和媒体；媒体经固定 DramaClaw 同源媒体代理读取，再使用 infinite-canvas 本地媒体接口复制。单批最多 50 个选择项、媒体 payload 累计不超过 510 MiB，单个文件也不得超过 510 MiB；目标 multipart 请求体总上限为 512 MiB，为 framing 和字段预留余量。媒体逐项串行传输；已知长度先校验，未知长度在有界流读取中校验，超限文件不上传。超过批次上限时提示拆分成多批。不同项独立记录状态；准备失败项保留选择，成功项可继续，不把失败显示成空素材。
7. 所有选择准备完成后，一次性提交到最新 CanvasProject.nodes/connections；普通节点和用户创建的节点/连线只追加、不修改。唯一允许更新的是 sourceKey 匹配的虾塘创建 Director 节点：当前快照只追加用户本次选择且尚未存在的资源条目，不改变节点 ID/位置、已存资源和用户编辑字段；显式新快照创建独立节点。不从角色关系推断强制影视流程或自动连线。
8. 稳定 sourceKey 由 sourceSystem、sourceProjectId、entityType、entityId、mediaRole 构成。普通节点默认 snapshotId=current，重复来源跳过；显式“作为新快照添加”才分配 UUID 并保留旧节点。3D current 组按 §6.4 只追加缺失资源。sourceRevision/ETag 是不透明字符串，只用于确认同一 DramaClaw 源快照，不得比较大小或推断版本先后；CanvasProject.revision 是目标端本地 CAS 版本，二者不互相替代。源端没有版本标识时，恢复未完成上传必须重新读取实体元数据和媒体内容并计算 SHA-256：与原 selection/已确认 digest 相同才沿用原 snapshotId、batchId、mediaRequestId；内容或可投影字段不同则暂停并要求用户确认“作为新快照”，创建新的 snapshotId、batchId 和 mediaRequestId。不得以确认绕过内容变化或对旧 storageKey 作乐观假设。存储完整性校验和另在媒体复制时增量计算，不用于推断上游修订。
9. batchId 在开始准备前生成。投影恢复 journal 使用 schemaVersion=1，写入浏览器 localStorage，最多记录本批 50 个选择项且序列化体积不得超过 256 KiB；包含 batchId、targetCanvasId、源实体/槽位 ID、可用的 sourceRevision/ETag、snapshotId、逐项状态、稳定 mediaRequestId 和已确认的目标 storageKey。不保存素材正文、媒体内容、prompt、sourceMediaUrl 或凭据。journal 必须先成功写入才开始复制媒体；若空间不足或写入失败，停止上传并让用户拆批或取消。schemaVersion 不兼容时标记“不可恢复”，保留原始选择摘要并要求重新读取。每项上传确认后再更新 journal。页面重开时提供“恢复/丢弃”入口；上传结果未知时以原 mediaRequestId 重放相同请求；画布保存结果未知时重读 CanvasProject 和 batchId。记录在成功提交并完成核对后清除；丢弃时调用 §6.4 的 batch abandon API，由服务端先核对无画布引用再标记 abandoned/GC。浏览器站点数据被清除时 journal 无法恢复，此限制明确告知。同一重试沿用 batchId、snapshotId 和 mediaRequestId；只有用户再次明确选“作为新快照”才分配新 UUID 和新媒体 request ID。
10. useCanvasStore 的自动保存、显式单项目保存、批量 sync 和虾塘投影共用同一串行写入队列与 revision 规则。autosave 只发送相对已确认基线发生变化的项目，不递增未修改项目的 revision；投影须等待当前 250ms debounce 和所有在途写入结束，再读取最新内存画布。每次确认响应后推进服务端 revision 基线；若请求期间又有本地编辑，只把响应 revision 合并到该项目的较新内存状态并继续排队保存，不能用旧响应覆盖新内容。任何保存路径都不得绕过 CAS 提交旧快照；冲突后暂停队列并保留本地脏状态。
11. 所有修改 CanvasProject 持久化行的入口都共享同一整数 revision CAS：POST /api/local/canvas/projects、POST /api/local/canvas/projects/sync、POST /api/local/canvas/projects/import、POST /api/local/canvas/projects/delete。revision 是独立持久化列和 API envelope 字段，不写入 CanvasProject.nodes 或用户业务 data；定义 CanvasProjectRecord={project, revision}，列表/读取返回每个 canonical project 及其 revision，单项保存和 sync/import 成功返回保存后的 canonical records，delete 返回已删 ID 与被比较的 revision，409 返回当前 canonical record。单项更新/覆盖携带 expectedRevision 并以条件 UPDATE 原子比较、写入及 revision+1；新建 expectedRevision=0 并只 INSERT；删除携带每个项目的 expectedRevision 并以条件 DELETE 执行。archive/file import 新 ID 使用 expectedRevision=0；ID 已存在必须显式选择 replace 并携带当前 expectedRevision，否则冲突。既有行迁移时 revision=1；旧浏览器缺 revision 时先读取 canonical record，不得把已有项目当作 0。批量 sync、archive import、delete 在单一 DB 事务中处理，任一冲突整批回滚并返回 409 与当前版本，不部分成功。所有前端写入口共用串行队列和 repository CAS；updatedAt 仅用于展示/排序，不再作为并发判据。当前实现尚无此契约，这是待实施差距而非本设计阶段已完成的功能。
上线迁移在单进程停写窗口初始化既有行 revision=1，再开放 CAS 路由；本地首期不支持新旧后端并行双写。旧浏览器或旧客户端未携带 expectedRevision 时 fail-closed 返回 428 与当前 canonical record，不执行写入；新版 UI 读取该 record 后由用户确认刷新或重放，不静默覆盖。
12. 前端仅在服务端确认保存后发布带新 revision 的 CanvasProjectRecord 并清除已提交选择/journal。任何写路径遇到 409 时，保留 journal 与本地脏状态、暂停该画布队列，向用户展示服务端当前 record；用户选择刷新/放弃本地更改，或基于当前服务端版本重放尚未提交的投影。不得自动覆盖、不自动重试。任何 save/sync/import/delete 请求结果未知时先 GET /api/local/canvas/projects：更新/覆盖以 revision=expectedRevision+1 且 canonical project data 等于提交快照（忽略 envelope revision）确认；新建以 ID 存在、revision=1 且数据相等确认；删除以所有目标 ID 均不存在确认。若原版本仍在（新建时 ID 仍不存在），只重放同一 CAS 请求一次；批量 all-or-none 请求按整批比较。其余版本或内容差异按冲突停止队列。投影保存结果也按 batchId 核对。媒体上传结果未知时用原 mediaRequestId 重放；启动恢复在接受新上传前处理 receipt：receiving 删除不完整临时文件并置 retryable；staged 校验 checksum，临时文件完整则继续 rename，最终文件已落盘则补齐 StorageObject 和 committed receipt；缺文件/损坏则清理临时文件并置 retryable；committed 校验 StorageObject 记录和文件存在后返回同一 storageKey。若 committed 对象记录或文件缺失/损坏，receipt 保留原 storageObjectID/objectKey/digest 并转 retryable；只有相同 payload digest 与请求元数据重放成功才可修复到原路径，禁止分配新对象 ID 冒充成功。未完成 receiving 没有完整 payload 可恢复；有 sourceRevision/ETag 时必须匹配，缺少源版本标识时要求用户确认重新读取当前素材。abandoned receipt 不得静默重建或返回已删除的 storageKey。未核对结果前不得盲目换 requestId。
13. 新项目由虾塘入口创建时，先构造未发布的空 CanvasProject，再走“ID 不存在”条件创建；服务端确认后才加入画布列表并打开。创建失败不留下本地假画布。
14. 投影只保存用户选中的独立快照，不生成媒体、不写回 DramaClaw，也不要求经过虾料或虾镜。

## 6. API 与数据契约

### 6.1 同源上游适配

DramaClaw 源端 API 根为 /api/v1。目标新增受限适配前缀，路由挂在现有 /api/v1 UserAuth 组中并沿用 infinite-canvas 登录态。浏览器端目标 path 固定为 `/api/v1/drama/upstream` + 本表源端 path；Go 从静态 route manifest 构造 `/api/v1` + 源端 path，不从请求 URL 拼接：

- GET /api/v1/drama/upstream/projects/summaries?status=visible → DramaClaw GET /api/v1/projects/summaries?status=visible。
- 浏览器只能调用 6.2 列出的 /api/v1/drama/upstream exact method/path；每项一对一转发到源端 /api/v1 对应 route。Go 不注册任意 /projects/{project}/... 通配代理；标准图像生成不开放 DramaClaw 源端生成 route。
- multipart 上传、JSON body、上游 HTTP 状态和 SSE 流按源端语义透传；媒体 URL 重写为现有同源 /api/v1/drama/media，流媒体不缓冲成整段 JSON。
- 上游 host 固定为服务端配置的 DRAMACLAW_BASE_URL；不接受浏览器传入的上游 URL/path，不作为任意反向代理。项目 ID 必须先经上游项目列表/访问校验；响应中的文件 URL 仅允许配置源 host 和该项目。
- 源端不可达返回明确上游错误，不转成 ok:true 空列表。认证凭据不进入前端、画布节点、URL 查询参数或日志。

### 6.2 逐页面操作的 API 契约

下表是 Go allowlist 的准入清单，按 HTTP method + 路径模板精确匹配；不允许用 /projects/{project}/... 作为任意通配。每条 allowlist 记录须固定 method、代码构造的上游路径、允许的 query key/value schema、JSON/Pydantic body schema 或 multipart 字段、请求体上限、读/写属性、幂等与重试类别、成功后的 query invalidation，以及源端 Python route 与前端 hook 的文件位置。query 参数拒绝未知键、重复键和值类型不符；JSON/multipart 只接受源端 schema 允许字段。上游 path 由已校验的项目/实体 ID 逐段编码构造，不拼接浏览器传入的 URL/path；路径解码一次后若含 `/`、`\\`、`.`/`..` 段、控制字符、额外尾段或大小写变体即拒绝。响应 envelope、错误响应和 cache invalidation 沿用 integrations/dramaclaw/frontend/src/lib/queries 中同名 hook 及对应 Python route schema。媒体 URL 另按真实 DramaClaw 响应样本形成 host + path-family allowlist；在该清单固化前，未知 URL 不代理。未知方法、路径、query 或 body 字段 fail-closed，Go 不提供透明反向代理。

| 页面/操作 | 源端 method + path（相对 /api/v1） | 移植后的行为与成功刷新 |
|---|---|---|
| 项目列表 | GET /projects；GET /projects/summaries?status=visible；GET /projects/summaries?status=all | 使用源端有效身份可见项目；保留 active/archived/deleted 状态筛选 |
| 新建/读取/编辑项目 | POST /projects（JSON {name}）；GET /projects/{project}；PATCH /projects/{project} | 沿用 ProjectConfig 与源端校验；新建/更新后刷新项目摘要及详情 |
| 项目生命周期 | POST /projects/{project}/archive；POST /projects/{project}/unarchive；POST /projects/{project}/delete；POST /projects/{project}/restore；POST /projects/{project}/purge | 逐条 allowlist；purge 仅源端具备权限且二次确认后开放；完成后刷新摘要 |
| 角色列表/详情 | GET /projects/{project}/characters?summary=true；GET /projects/{project}/characters?summary=false&names={name} | 打开详情时只取所选角色完整数据；沿用源 query keys |
| 角色创建/编辑/删除/补全 | POST /projects/{project}/characters；PATCH /projects/{project}/characters/{name}；POST /projects/{project}/characters/{name}/delete；POST /projects/{project}/characters/build（JSON {}） | 创建字段按 Character schema；编辑字段为 Partial<Character>；成功后刷新角色列表/详情；build 的 task_type、episode、scope 交给源端任务查询 |
| 角色图片使用统计 | GET /projects/{project}/character-image-usage | 只读统计继续显示；不包含生成权限或模型凭据 |
| 角色图片来源/模型设置 | GET/PATCH /projects/{project}/character-image-selection；GET/PATCH /projects/{project}/image-source-selection/{asset_kind} | 源端自身的模型/图像服务选择不代理；移植页显示目标端用户配置的 provider 与参数，生成调用 infinite-canvas 现有图像服务。项目视觉风格仍从 ProjectConfig 读取 |
| 角色头像 | POST /projects/{project}/characters/{name}/portrait/upload（multipart file） | target provider 生成并预览后，用户确认才上传；成功刷新角色列表和详情。源端 POST /portrait、POST /portrait-async 不调用 |
| 角色身份 | GET/POST /projects/{project}/characters/{name}/identities；PATCH/DELETE /projects/{project}/characters/{name}/identities/{identity_id} | 创建/编辑/删除沿用源端 Identity schema；更新 identity_id 或归属后刷新 identities 和角色列表 |
| 身份图片/服装/尝试记录 | POST /projects/{project}/characters/{name}/identities/{identity_name}/upload；POST /projects/{project}/characters/{name}/identities/{identity_id}/portrait/upload；POST /projects/{project}/characters/{name}/identities/{identity_id}/costume/upload；POST /projects/{project}/characters/{name}/identities/{identity_id}/costume/delete；POST /projects/{project}/characters/{name}/identities/{identity_id}/image/delete；GET /projects/{project}/characters/{name}/identities/{identity_id}/attempts | 上传均用 multipart file；删除或替换后刷新 identity/角色详情。标准图像由目标 provider 生成；源端 identity generate/generate-async routes 不调用 |
| 角色素材历史 | GET /projects/{project}/characters/{name}/asset-history；POST /projects/{project}/characters/{name}/asset-history/restore | 仅恢复源端明确支持的角色素材 kind；成功后刷新角色、identity 和 history |
| 角色声线样本 | GET /projects/{project}/characters/{name}/voice-samples；POST /projects/{project}/characters/{name}/voice-samples/{slot}/upload；POST /projects/{project}/characters/{name}/voice-samples/{slot}/record；POST /projects/{project}/characters/{name}/voice-samples/{slot}/trim；POST /projects/{project}/characters/{name}/voice-samples/{slot}/delete | upload 为 multipart file；record/trim JSON 字段沿用源 hook（data_url、source_path、start_seconds、duration_seconds）；成功更新 slot 并刷新 voice samples |
| 场景列表/详情/预览 | GET /projects/{project}/scenes?summary=true；GET /projects/{project}/scenes?summary=false&names={name}；GET /projects/{project}/scenes/plate-preview?scene_id={scene_id}&variant_id={variant_id}&time_of_day={time_of_day} | 保留场景变体与 plate-preview 语义；按源端 query key 刷新 |
| 场景创建/编辑/删除/补全 | POST /projects/{project}/scenes；PATCH /projects/{project}/scenes/{name}；POST /projects/{project}/scenes/{name}/delete；POST /projects/{project}/scenes/build（JSON {}） | 沿用 ScenePayload；CRUD 后刷新场景，build task 查询源端 tasks |
| 场景主图 | POST /projects/{project}/scenes/{name}/master/upload；POST /projects/{project}/scenes/{name}/master/delete | target provider 生成后预览，用户确认才上传；成功刷新场景 |
| 场景背面图 | 无源端 direct upload route；目标 provider 生成并预览后，使用现有 freezone upload → impact(target scene_reverse_master) → 用户确认 → push | 不调用源端 /reverse/generate-async；push 成功后刷新场景并检查源端影响/stale 响应 |
| 场景全景 | GET /projects/{project}/scenes/{name}/pano/manifest；PATCH /projects/{project}/scenes/{name}/pano/correction；POST /projects/{project}/scenes/{name}/pano/upload；POST /projects/{project}/scenes/{name}/pano/delete；POST /projects/{project}/scenes/{name}/pano/generate-async | pano 生成与校正保留 DramaClaw 专有语义；生成 body 的 source 字段和 task response 沿用源 hook；上传 multipart file |
| 场景自定义空间包 | POST /projects/{project}/scenes/{name}/custom/upload；POST /projects/{project}/scenes/{name}/custom/delete | multipart file；遵循源端扩展名、大小和格式校验；成功刷新场景详情 |
| 场景导演世界 | GET /projects/{project}/scenes/{name}/director-stage/manifest；POST /projects/{project}/scenes/{name}/director-stage/world；POST /projects/{project}/scenes/{name}/director-stage/world/source；POST /projects/{project}/scenes/{name}/director-stage/world/clear | JSON 结构沿用 DirectorStageManifest/ThreeDSceneSnapshot hook；成功刷新 director-stage manifest 和场景 |
| 场景 3GS | POST /projects/{project}/scenes/{name}/3gs/master-ply/generate-async；POST /projects/{project}/scenes/{name}/3gs/reverse-ply/generate-async；POST /projects/{project}/scenes/{name}/3gs/pano-ply/generate-async | 只用 DramaClaw 3GS 操作；返回 task_type、scope、source 等字段进入源端 task 查询 |
| 道具列表/创建/编辑/删除 | GET /projects/{project}/props?summary=true；POST /projects/{project}/props；PATCH /projects/{project}/props/{name}；POST /projects/{project}/props/{name}/delete | 沿用 PropPayload；成功刷新道具列表/详情 |
| 道具参考图 | 无源端 direct upload route；目标 provider 生成并预览，调用现有 freezone upload → impact(target prop_ref, prop_id) → 用户确认 → push | 不调用源端 /props/{name}/reference/generate-async；成功刷新道具并显示影响/stale 响应 |
| 旁白声线 | GET /projects/{project}/narrator-voice；GET /projects/{project}/narrator-voice/sources；POST /projects/{project}/narrator-voice/upload；POST /projects/{project}/narrator-voice/record；POST /projects/{project}/narrator-voice/copy；POST /projects/{project}/narrator-voice/trim；POST /projects/{project}/narrator-voice/delete | 上传为 multipart file，record/copy/trim body 沿用源端 schema；成功刷新旁白 voice |
| 源端任务中心 | GET /projects/{project}/tasks；GET /projects/{project}/tasks/limits；GET /projects/{project}/tasks/{task_type}/{episode}?beat_num={beat_num}&scope={scope}；GET /projects/{project}/tasks/stream；GET /projects/{project}/tasks/{task_type}/{episode}/stream?beat_num={beat_num}&scope={scope}；DELETE /projects/{project}/tasks/completed；DELETE /projects/{project}/tasks/{task_type}/{episode}?beat_num={beat_num}&scope={scope}&force={force}&acknowledge_no_refund={acknowledge_no_refund} | SSE 原样透传；保留源端 409 运行中取消确认；task_type、episode、beat_num、scope 不改名；不新增 /jobs |
| 源端媒体 | infinite-canvas 已有 GET /api/v1/drama/media?projectId={project}&url={sourceUrl} | 同源之外还校验 projectId 与 allowlist 媒体 path 中的 project 段一致；首期只允许从真实源响应验证的 `/static/projects/{project}/...` 与 `/api/v1/projects/{project}/media/...` 路径族读取。拒绝 userinfo、fragment、额外 query、路径穿越、编码斜杠/反斜杠、其它 project 和未知 path family；重定向也必须保持 host 与同一 project scope。旧 episode 媒体请求一并补传 projectId 并保持其现有输出字段。 |

项目摘要使用源端 status=visible；归档/回收站视图用 status=all 再按源端状态筛选。所有表内 JSON/multipart 形状、响应 envelope、权限错误及 cache invalidation 以对应源端 hook、route schema 为准，前端移植时保持领域字段名。所有 allowlist path/query/body schema 以逐条 route manifest 记录并带源端 route 与 hook 文件位置；manifest 未核实的 route 不注册、不显示可用按钮。标准生图源端 routes 的 allowlist 明确排除：角色 portrait/identity generation、场景 master/reverse generation、道具 reference generation；表中列出的 build、pano 和 3GS 等源端专有能力仍开放。Go allowlist 和前端 API client 均必须以本表为边界。已有的 /drama/projects/{project}/freezone/upload、/impact、/push、/assets/identities、角色 asset-history/restore 路由继续复用，写回语义见 6.5。

### 6.3 生成能力归属

- 普通角色、身份、场景主图/背面图、道具参考图使用用户在 infinite-canvas 选择的图像配置；复用 web/src/services/api/image.ts 的 requestGeneration、requestEdit 或 createCanvasImageTask/pollCanvasImageTaskStatus，不新建泛化生成后端。移植组件负责提供源端已有字段生成的 prompt、选择目标 provider、预览结果和确认写回。
- 代码核对结果：当前 AutoDL helper 查询 workflow，现有预设指向 H3 多模态视频工作流；它本身不能证明存在 AutoDL 文生图契约。首期普通图像按现有目标端 image service 的兼容渠道调用。若要将 AutoDL 在线网页用于角色/场景图片，须先确认其可调用 JSON 请求、图片结果及状态字段；只有在此基础上增加一个贴合现有 image service 的小型 provider adapter，或使用确实返回文件/URL与任务状态的 MCP 工具。当前不把 AutoDL 图片能力写成已存在事实。
- DramaClaw 专有操作继续走源端：角色/场景 build、场景 pano generation、导演世界、3GS。其任务使用 DramaClaw tasks API；目标图像 provider 任务使用 infinite-canvas 当前 task/status 能力。
- 移植页不暴露源端项目 image-source-selection 作为模型选择；调用的模型、endpoint、参数由目标端用户配置决定。生成结果先预览；明确确认后才进入 6.5 的源端槽位写入。
- 不创建统一 /jobs，也不把不支持异步查询的 provider 伪装成后台任务。provider 有任务查询或幂等键时，超时后先用原 task/idempotency key 查询或重放同一幂等请求；没有这些能力时显示“结果未知”，不得自动重发。用户可显式选择“重新提交”，操作前说明可能再次生成或计费；若只是想避免重复，则保持未知并稍后核对。

### 6.4 画布投影契约

虾画挑选器与虾塘发送入口共享 projectSelectedXiaTangAssets({ batchId, sourceProjectId, targetCanvasId, selections })。新虾塘导入使用独立 XiaTangProjectionSelection、独立 builder 和 xiaji-projection-v1 key namespace；既有 DramaCanvasProjection/builder/key 只服务 episode/beat 导入，不改既有导入语义，不跨两类来源去重。selection 仅含 sourceProjectId、entityType、entityId、mediaRole、mediaType、明确选择的展示字段及可选 sourceRevision/ETag；不把完整源端实体 JSON 写进 CanvasNodeData。

普通映射复用现有 CanvasNodeData、CanvasConnection、节点类型和布局工具：文本/描述→Text，静态图片→Image，符合全景格式的媒体→Panorama，视频→Video，音频→Audio。媒体确认复制后，节点只保存目标 storageKey 与来源标识、sourceRevision/ETag、导入时间；不保存 sourceMediaUrl/sourceUrl 或上游凭据。
每个 POST /api/local/files 请求仅携带一个媒体文件。完整 multipart HTTP body 上限为 512 MiB；每文件及每批累计 payload 上限为 510 MiB，超限返回 413；若已创建 receiving receipt 则改为 retryable 并清理未完成临时文件，不提交 CanvasProject。服务端使用 MaxBytesReader 限制整包并通过 MultipartReader 对 part 做有界流式复制、增量哈希和 staging 落盘；不得用 FormFile/ParseMultipartForm 造成整段 multipart 二次缓存，也不得 io.ReadAll 文件内容。首期约束一个进程独占写入本地工作区 DB 与媒体目录，启动恢复完成前不接收上传。
上传携带稳定 Idempotency-Key，作为 receipt.request_id。共享 helper 对 UTF-8 编码的 JSON.stringify(["xiaji-upload-v1", batchId, projectionKey, snapshotId]) 计算 SHA-256，并以 `xiaji1_` + 无填充 base64url 编码作为固定长度 key；服务端按 metadata 重算并拒绝不匹配的 key。新增 local_storage_upload_batches，主键为 (workspace_id, batch_id)，保存 sourceProjectId、targetCanvasId、selectionCount、projectionKeys、state、payloadBytes、terminalResults、createdAt、updatedAt；terminalResults 在 complete 前为空，complete 的状态切换与逐项终态结果必须在同一事务持久化，以支持完成响应未知时的权威查询。批次状态为 open、complete、abandon_requested、abandoned。新增 local_storage_upload_receipts，唯一键为 (workspace_id, request_id)，状态 receiving、staged、committed、retryable、abandoned，记录 batchId、固定 objectKey/objectID、payload SHA-256、规范 MIME、安全扩展名、sourceProjectId、entityType、entityId、mediaRole、sourceRevision/ETag、temp key、bytes 和 storageObjectID。payloadDigest 定义为首次完整接收的原始文件 part bytes 的 SHA-256。重放身份由 requestId 与规范化的来源/槽位/版本/格式 metadata 构成：metadata 不同返回 409；metadata 相同且 receipt 已 committed 时返回同一 storageKey，不消费重放请求的 file part，也不替换首次 payload。首次接收时实际 payloadDigest 仍须用于格式校验、完整性恢复和对象去重。requestId 由 batchId、projectionKey、snapshotId 派生，因此同一 requestId 总由同一个 batch lock 串行化，不另设 request lock。安全文件名不参与身份。内容级去重仅在 payloadDigest、规范 MIME、安全扩展名都相同时共享 StorageObject；相同 bytes 但 MIME/格式语义不同不得复用对象元数据。
MIME/格式验证使用版本化 xiaji-media-type-v1 registry，键为 entityType+mediaRole+sourceFormat，值定义 canonical MIME、规范扩展名、允许的内容探测器和目标节点类型。MIME 解析按 RFC media-type 语法拆分，type/subtype 转小写 ASCII 并剥离参数；显式 alias 表至少将 image/jpg 归一到 image/jpeg、audio/x-wav 归一到 audio/wav，未知 alias 拒绝。part 的 Content-Type 和原始文件名均为不可信提示。canonical MIME 与安全扩展名以 registry 为准；文件名只取最后一个路径段并剥除路径分隔符及控制字符，已知扩展名与 registry 冲突时拒绝，缺少/未知扩展名不影响判定且绝不原样保存。服务端对受支持的 raster/audio/video 执行有界签名探测；.fbx/.obj 只有在来源 format allowlist 与对应结构探测均通过时才接受，MIME 统一记作 registry 规定值，安全扩展名由 registry 导出。声明 MIME、探测类型、sourceFormat 或已知扩展名互相冲突、未知格式时返回 415，不创建可提交对象。sourceFormat 必须是 registry token；源 ID/role 必须非空，按 DramaClaw 返回的大小写及 Unicode code point 原样处理，不 trim、不折叠大小写、不做 Unicode 重写。首期支持的每一行 registry 都需在实施前以 DramaClaw 实际样本固化，包含源字段、原 MIME、canonical MIME、safe suffix、detector 和目标节点/loader；缺样本的媒体格式不显示可导入。
MIME registry 每行在固化前须附格式/媒体角色、源端响应字段、样本来源、原始 MIME/扩展名、canonical MIME、安全后缀、探测器、最大字节数、适用的图像尺寸/音视频时长限制、目标节点类型及 loader。实现只开放通过这些真实样本核验的行；没有可靠探测器或目标节点约束的格式标记为不支持。

状态转移：在 batch lock 下以 request_id 唯一键 claim/INSERT receiving receipt 并固定 objectID/objectKey；retryable 通过条件状态更新取得重试权。上传 handler 解析 metadata 后先只读检查 receipt：同一规范 metadata 已 committed 则返回原结果而不读取 file part；已 receiving 则返回 HTTP 202、data.state=receiving 和 Retry-After: 1。若无可复用 receipt，则按 §6.4 锁顺序 claim receiving，再开始文件流。完整流式写入、flush/sync 并计算 digest 后，将元数据写入 staged；原子 rename 到最终路径后，在同一数据库事务 INSERT/恢复 StorageObject 并置 receipt=committed。若内容去重命中已有同 digest/MIME/扩展名对象，在事务中让 receipt 指向该 object 并置 committed，再清理本次 temp。进程崩溃后由下次启动恢复。
启动时持有工作区独占写锁，并先恢复 receipt 再开放上传：receiving 删除不完整 temp 并置 retryable；staged 校验 temp/final checksum，完整 temp 继续 rename，final 已落盘则补齐对象记录并提交；文件缺失/损坏时清理 temp 并置 retryable；committed 校验对象记录与文件。若 committed 对象不完整，保留 objectID/key/digest 转 retryable，重放只可验证并修复到原 objectID/key。abandoned 是用户丢弃且经全局引用核对后的持久清理标记；同 key 后续重放返回 410，必须由新 batchId 创建新操作。GC 仅在无 CanvasProject 引用且无其他非 abandoned receipt 引用时删除对象。GC 先保留带 objectKey 的 tombstone，再幂等 unlink 文件并完成记录清理；失败保留 tombstone 供重试。任何未确认 unreferenced 的对象均不删除。
文本节点只含用户勾选的展示字段；默认不自动连线。

#### 本地媒体导入批次 API

服务端 batch/receipt 持久层只服务三项明确保证：跨浏览器重开/进程崩溃查询同一上传结果；多请求累计执行 510 MiB 上限；在 CanvasProject CAS 保存与垃圾回收之间以同一 workspace 写锁防止先删后引。批次列表只用于 localStorage journal 丢失后的人工恢复/丢弃，不是通用任务队列。receipt/GC 必须保留，是因为现有 StorageObject 按内容去重，清理时必须核对跨画布/receipt 引用；不另加 request lock，依靠 requestId 绑定的 batch lock、进程 writer lock 和单一 workspaceMutationLock 即可覆盖本地单用户并发。它不承担多用户 lease 或跨设备同步。进程重启先把遗留 receiving 转 retryable 并恢复 staged；open 批次保留到用户显式 abandon。

批次先于媒体上传创建，request journal 已成功持久化后调用；创建请求体为 {batchId,sourceProjectId,targetCanvasId,projectionKeys}。projectionKeys 是本次用户所选项的稳定、不可变 projectionKey 集合，不重复且数量为 1–50；selectionCount 由服务端从其长度派生。创建请求幂等，batchId 相同且 sourceProjectId、targetCanvasId、projectionKeys 均相同且原批次仍为 open 时返回原批次；字段不同或原批次已进入 complete/abandon_requested 返回 409，已 abandoned 返回 410。不存在追加 projectionKey 的 endpoint；用户要增加选择项时必须创建新的 batchId。失败项重试只能使用原集合中的 key 和原 requestId。

批次行为由 local_storage_upload_batches 持久化：state=open/complete/abandon_requested/abandoned、selectionCount、projectionKeys、payloadBytes、terminalResults。每 workspace 仅一个服务进程持有独占 writer lock；同一 batch 同时只允许一个 receiving 上传。服务端取得 batch lock 后，以已提交且未 abandoned 的唯一 receipts 之 bytes 作为 payloadBytes；本次文件通过有界流读取时用流内计数器验证 `payloadBytes + currentFileBytes <= 510 MiB`，仅 receipt 从 staged 条件转为 committed 的同一事务可增加 payloadBytes，并按该 requestId 最多一次更新；崩溃恢复走同一条件更新，避免重计。若 receipt 后续转为 abandoned，则在同一事务扣减一次。失败/中断不消耗预算，原 mediaRequestId 重试成功只计一次；同 batch 其它上传排队，因此无需持久化 reservation。媒体 receipt 的 projectionKey 必须属于批次 projectionKeys，receipt 数不得超过 selectionCount；text-only selection 不产生 file receipt。只有所有所选项有 added/skipped/failed 终态后才可调用 complete；若 failed 项仍准备重试，批次保持 open。未知上传响应可由 GET batch 读到已确认 receipt；新批次不会覆盖旧 batch 状态。

不设自动 lease/expiry：关闭浏览器不应令可恢复导入被后台静默删除；用户显式 complete 或 abandon 才结束批次。为覆盖 localStorage 被清除后的孤儿批次，分页列表接口按 workspace 列出 open 与 abandon_requested；不引入多用户 owner、lease 续期或自动清理时限。

批次记录同时保存 UTC createdAt/updatedAt；所有状态、payloadBytes 或 receipt 变化在同一数据库事务中更新 updatedAt。列表按 (updatedAt,batchId) 稳定排序并用 opaque cursor 续页。

#### 并发锁顺序与事务边界

锁的含义与职责固定如下：进程级 writer lock 在工作区打开期间保证只有一个服务进程写该 DB/媒体目录；batch lock 串行化同批上传、完成、放弃与投影；workspaceMutationLock 是进程内单一工作区写互斥锁，保护所有 DB 写事务、CanvasProject 引用变更、最终文件 rename、tombstone 与 unlink。所有 DB 写事务都须先持有 workspaceMutationLock；列表/状态读取可使用只读事务，不得持有只读事务再申请写锁。写操作锁顺序固定为 `batch lock(s, batchId 字典序) → workspaceMutationLock → SQLite write transaction`；任何代码不得持有 SQLite transaction 后再申请锁。创建 batch 时记录尚不存在，因此只取 workspaceMutationLock 并以唯一键处理同 batchId 并发；无批次关联的普通 CanvasProject 写入也只取 workspaceMutationLock。GC 由启动恢复、完成/放弃或释放画布引用触发；运行期只取 workspaceMutationLock，不反向申请 batch lock。requestId 由所属 batch 的稳定键派生，不另设 request lock；该设计明确首期单进程，不承诺第二个 Go 进程同时写同一 workspace。

- 上传解析 metadata 后先用只读查询检查同一 requestId：若 receipt=receiving，立即返回 202，不等待上传锁；若 metadata 相同且 receipt=committed，返回原结果。其它情况取得 batch lock 后必须再次读取 receipt，避免两个并发首次请求都在锁外看到“不存在”；只有重读后仍不存在或为 retryable 才能 claim/INSERT receiving receipt，metadata 不同则 409，batch 非 open 则拒绝。claim 在 workspaceMutationLock 下以短事务完成；保留 batch lock，对 multipart file part 有界流式落 staging。flush/sync、digest 与容量校验完成后按 `batch → workspace → transaction` 取得写锁，在短事务写入 staged receipt；原子 rename 后再以短事务提交/恢复 StorageObject、receipt=committed 和 payloadBytes。若中间崩溃，服务启动恢复按 receiving/staged 状态处理，外部请求须等恢复结束。网络读取期间不持有 workspaceMutationLock 或 SQLite transaction。客户端断开或 `XIAJI_UPLOAD_IDLE_TIMEOUT` 连续读空闲超时（默认 120 秒）会取消流、清理 temp、使用独立的短时清理 context 在 workspaceMutationLock 下将 receiving 转 retryable，再通过 defer 释放 batch lock；不设总上传时长上限。同批串行上传是单用户首期的明确取舍，用于准确执行 510 MiB 聚合上限；不同 batch 可并行传输。
- CanvasProject mutation 若候选新增 XiaTang provenance tuple，先按字典序取得这些 tuple 的 batch lock，再取得 workspaceMutationLock 和 SQLite transaction；在同一事务中检查 expectedRevision、batch targetCanvasId/state 和所引用的 committed receipts，再保存 project/revision。complete 与 abandon 也先取得 batch lock，再取得 workspaceMutationLock 和事务；complete 原子保存 terminalResults 并关闭 batch，abandon 原子进入 abandon_requested。等待中的上传或投影请求按锁序列化，不会越过终态转换。
- GC 取得 workspaceMutationLock 后，在事务中再次核对 CanvasProject storageKey 引用、非 abandoned receipt 引用，并写 tombstone；保持该锁时 unlink 最终文件，再以事务删除/完成记录。CanvasProject 写入口须拒绝新增长期指向不存在或已 tombstone 的 StorageObject 的引用。每个文件只在 tombstone 持久化后删除。任何引用关系变更与该判定互斥，因此没有“先判未引用、后新增引用、再删除文件”的窗口。
- 崩溃恢复：receiving → 删除不完整 temp 并置 retryable；staged 且 temp digest 正确 → rename 后补齐 StorageObject/committed；staged 且 final 已存在且 digest 正确 → 补齐 DB 提交；GC tombstone 存在且文件仍在 → 幂等 unlink；文件已不存在 → 完成 DB 清理。其他 checksum/引用不一致都保留 receipt/tombstone 并报告恢复错误，不猜测成功、不盲删。
- `abandon_requested` 若仍有画布引用，保持只读并报告 retained_referenced；在该批次关联的 CanvasProject 被更新/删除后以及服务启动恢复时，重新核对该批次。只有所有 receipts 均无引用、GC 完成后才转为 abandoned。无需后台每分钟轮询。

批次状态迁移固定为 `open → complete`（用户提交每个 projectionKey 的终态）或 `open/complete → abandon_requested → abandoned`（用户显式丢弃且引用安全清理完成）；不存在自动超时迁移。complete 后不接受新媒体或投影；其中无 CanvasProject 引用的 committed receipts 可由 GC 标记 abandoned 并清理，共享且仍被其它画布/receipt 引用的对象保留。abandon_requested 后若仍有画布引用则保持该状态、拒绝新引用；引用删除并完成 GC 后转 abandoned。receipt 状态迁移为 `receiving → staged → committed`、`receiving → retryable → receiving`、以及仅在 GC 安全确认后进入 abandoned。

| 方法与路径 | 请求/响应及语义 |
|---|---|
| POST /api/local/file-batches | JSON 请求 {batchId, sourceProjectId, targetCanvasId, projectionKeys:[...]}；服务端校验 1–50 个不重复 key 并派生 selectionCount；成功返回统一 response envelope，其中 data 含 batchId、state=open、selectionCount、projectionKeys、payloadLimitBytes=534773760、requestLimitBytes=536870912。 |
| GET /api/local/file-batches?state=open,abandon_requested&limit=20&cursor=... | 返回当前 workspace 未结束批次的分页摘要（batchId、sourceProjectId、targetCanvasId、state、updatedAt、selectionCount、payloadBytes）；limit 最大 100。用于 journal 丢失后恢复/丢弃，不返回凭据、源 URL 或媒体内容。 |
| GET /api/local/file-batches/{batchId} | 返回 batch state、projectionKeys、每个 request receipt 的 requestId/state/bytes/storageKey 或错误码、terminalResults（open 时为空；complete 后为不可变操作结果）、累计 payloadBytes，以及从当前 CanvasProject provenance 读出的 currentCanvasProjectionKeys（与本 batch projectionKeys 取交集）、派生的 canvasContainsBatch 和当前 CanvasProject revision；未知 batch 返回 404。terminalResults 记录完成当时的导入结果；currentCanvasProjectionKeys 反映之后节点被用户移除/编辑后的当前状态，二者分别表示历史操作与当前画布，不互相覆盖。不得返回源 URL、token 或素材内容。 |
| POST /api/local/file-batches/{batchId}/complete | body 为 {expectedCanvasRevision,results:[{projectionKey,status:"added"|"skipped"|"failed",errorCode?}],discardFailures:boolean}，必须覆盖全部 projectionKeys 且无重复。若 batch 已 complete，仅相同 results 返回既有终态结果，不再以当前 revision 重验；不同 results 返回 409。若仍 open，则在 workspaceMutationLock 和同一事务内核对 batch 状态、expectedCanvasRevision、每个 added/skipped key 当前存在（added 必须含本批来源 tuple；skipped 可对应已有来源 tuple）、该 projection 的媒体 receipt 已 committed（若其含媒体），以及 failed key 未新增本批来源 tuple。含 failed 时必须用户明确确认 discardFailures=true。核验通过后原子写 terminalResults 与 state=complete；结果此后不可改写。revision 冲突时不关闭批次，前端读最新项目、重算结果后重试。响应未知时 GET batch 核对，不另建 batch；完成后的 GET 同时返回不可变 terminalResults 与当前 projection key 集。
| POST /api/local/file-batches/{batchId}/abandon | 用户确认放弃后调用，body 为空；open/complete 取得 batch lock 后转为 abandon_requested，拒绝新上传和新投影，并按 receipts 逐项查所有 CanvasProject 引用；未引用 receipt 标记 abandoned 并进入 GC，有引用项保持可用并返回 retained_referenced。只有所有引用消失且 GC 完成后 batch 才变为 abandoned；重复请求幂等并重新核对引用。运行中的上传先由 UI 取消请求、handler 清理 temp 并释放锁，再执行 abandon。客户端不能传 storageKey 列表。 |
| POST /api/local/files | 必须带 Idempotency-Key 并先传 metadata 再传 file；首次完整上传返回 HTTP 200 与 {requestId,state:"committed",storageKey,bytes,canonicalMime}；同 key 且规范 metadata 相同并已 committed 时返回原 HTTP 200 结果、不消费 file part；同 key metadata 不同返回 HTTP 409；同 key 仍 receiving 时返回 HTTP 202、state=receiving、Retry-After: 1。超过限额返回 HTTP 413，MIME/格式不匹配返回 HTTP 415；body 使用 {code,msg,data} envelope。 |

典型成功响应为 HTTP 200：{ "code": 0, "data": { "batchId": "b1", "state": "open", "selectionCount": 2, "projectionKeys": ["p1","p2"], "payloadLimitBytes": 534773760, "requestLimitBytes": 536870912, "payloadBytes": 0 }, "msg": "ok"}。GET batch 返回同一 envelope，data.receipts 列出各状态并提供 canvasContainsBatch/currentCanvasRevision；complete 返回 state=complete 与逐项结果；abandon 返回 data.results=[{requestId,state:"abandoned"|"retained_referenced"}]。创建、complete 和 abandon 均幂等；未知状态查询返回 HTTP 404，不泄露别的 workspace 的 batch。

失败响应继续使用 handler 的 {code,msg,data} 形状，HTTP 状态为权威错误分类：202 data.kind=upload_in_progress 且包含 requestId；409 data.kind=revision_conflict、request_conflict、batch_abandoning、batch_closed、batch_not_resolved、projection_conflict 或 media_not_committed；413 data.kind=payload_too_large 且包含 limitBytes；415 data.kind=unsupported_media 且返回稳定 reasonCode；410 data.kind=receipt_abandoned。前端不得仅以 body.msg 文本分支。

POST /api/local/files 仍一次仅上传一个媒体文件，并要求 Idempotency-Key。multipart 必须先有 metadata JSON part（不超过 64 KiB），后有一个 file part；metadata 包含 batchId、projectionKey、snapshotId、sourceProjectId、entityType、entityId、mediaRole、sourceRevision/ETag（可选）、sourceFormat 和 declaredMime。请求没有 sourceMediaUrl。服务端先解析 metadata 并校验 batch/request identity；新请求创建 receiving receipt 后才读取 file part。对 receiving 或已 committed 的早期重放响应，HTTP/1.1 必须附 `Connection: close` 并关闭该请求连接，禁止连接复用；HTTP/2 只结束/重置该请求流，不关闭共享连接；服务端不 drain 文件体。浏览器使用标准 Fetch 时遵循 half-duplex：浏览器先发送完整请求体再处理响应，不能假定能在文件上传中途观察到 `202` 或用 AbortController 中止仍在发送的 body（[Fetch Standard](https://fetch.spec.whatwg.org/#dom-request-duplex)）。因此客户端不得把 `202` 作为唯一恢复依据，也不得假定连接关闭一定能完整读到响应：

| 客户端观察到的结果 | 后续动作 |
|---|---|
| 收到完整 200，state=committed | 使用返回的 storageKey，禁止再次上传该 requestId。 |
| 收到 202，state=receiving | 用原 batchId/requestId 查询 GET batch；按 Retry-After 轮询，直到 committed、retryable、abandoned 或服务端确认无该 receipt。 |
| 收到 409/410/413/415 | 按稳定错误码停止该上传；409/410 不换 ID 重发，413/415 需修正选择/格式后由用户创建新的明确操作。 |
| 上传中连接关闭、响应体不完整或任意 transport error | 标记 `upload_response_unknown`，只 GET 原 batch；GET 失败则保留 journal 并等待用户重试查询，不上传、不换 batch。 |
| GET 显示 receiving | 等待 Retry-After 后继续查询，不发送 file part。 |
| GET 显示 committed/abandoned | 分别使用既有 storageKey / 停止，均不发送 file part。 |
| GET 确认 batch 仍 open 且该 requestId receipt 为 retryable 或不存在 | 仅可用原 batchId、原 key、原 metadata 和原 requestId 重传；不存在 receipt 表示服务端尚未 claim 请求。 |
| GET 显示 batch 不存在 | 仅用 journal 保存的完全相同 batchId/sourceProjectId/targetCanvasId/projectionKeys 幂等重建 batch；若返回 410/409 则停止并保留状态供人工核对。 |

任何状态都不得因 response/body 读取错误自动生成新 requestId 或 batchId。服务端返回早响应的语义仍用于阻止重复处理和复用连接；浏览器传输是否节省上传带宽不作为正确性保证。只有服务端查询确认 receipt 为 retryable 或不存在且 batch 仍 open 时，才能按表中规则重传。

服务端在 workspace 数据库锁下按 batchId 串行化上传，按该批所有非 abandoned、唯一且 committed 的 request receipt bytes 计算累计 payload；有界流计数器逐块检查剩余额度，不把文件读入内存。文件 part 超过单文件 510 MiB 或累计 batch 510 MiB 即提前停止、清理 temp、将 receipt 置 retryable 并返回 HTTP 413。请求总体 512 MiB 上限由 MaxBytesReader 执行。完成 receipt 重放不二次计入预算；同批并发请求排队，不能以并发绕过上限。selectionCount、receipt 数、payloadBytes 都在服务端数据库事务中校验，不依赖 localStorage 计数。

每个虾塘投影条目在目标节点 `metadata.xiaTangImports` 中登记 `{batchId, projectionKey, mediaRequestIds}`；普通节点每个来源投影一条，Director 节点每个追加的资源一条，text-only 条目的 mediaRequestIds 为空。字段不含上游 URL/凭据。GC 用 mediaRequestIds 映射到 receipt/object 追踪 Director 资源；目标节点移除对应资源时须同步移除该 provenance 条目。无法证明对象已无引用时宁可保留，不猜测可删除。

所选媒体准备失败时可保留 journal 并在同一批次重试，但只能重试该批创建时已登记、尚未完成的 projectionKey；不得为同批追加新 key。已提交 tuple 的 requestId 集合不可被替换。只有查询确认原批次不存在或仍为 open 且原 key 的 receipt 为 retryable/不存在时，才能用同一 batchId、projectionKey 和 requestId 恢复；状态未知时不得创建新 batch 规避原 receipt。需要增加选择项或在已完成批次中重试失败项时，用户明确发起新批次。

每个 CanvasProject CAS 写入都在 workspaceMutationLock/数据库事务内比较候选与当前项目的 `metadata.xiaTangImports`。新增加的 `(batchId,projectionKey)` tuple 须按 batchId 字典序取得 batch lock，验证该 key 已包含在批次创建时固定的 projectionKeys、批次 targetCanvasId 与当前画布相同、state=open、每个 mediaRequestId 属于该 batch 且 receipt=committed；同一 tuple 若改写 mediaRequestIds 返回 409 projection_conflict。验证和 revision CAS、CanvasProject 写入处于同一事务；失败返回 409 batch_abandoning/media_not_committed/projection_conflict 且无任何写入。已存在且未改变的 tuple 不因 batch 后续 abandon_requested 阻塞普通编辑。abandon/GC 使用相同锁序和工作区锁，保证“放弃后不能新建引用、被引用时不能清理”。

GET batch 是未知上传响应的权威恢复入口；若响应不确定，客户端按原 batchId/requestId 查询，随后以相同请求重放或展示已确认 storageKey。`metadata.xiaTangImports` 中的 batchId/projectionKey tuple 用于核对画布保存结果；batch 进入 abandon_requested 后拒绝新上传和新 tuple，abandoned 的 requestId 重放返回 HTTP 410，不重新创建对象；同 batch 再次选择新快照必须生成新 batchId。GC 是服务内部维护，不暴露任意文件删除 endpoint：在启动恢复、abandon 请求以及任何释放 CanvasProject 引用的成功写入后，重查 abandon_requested 批次和 tombstone；不设定时轮询。所有改变 CanvasProject 引用的写入与 abandon/GC 检查使用同一 workspaceMutationLock。




3D 导入从虾塘页或虾画挑选器进入同一全屏 Director 会话，不在侧栏打开。新节点会话使用尚未发布到 CanvasProject 的临时 nodeId 和空项目；current 追加会话加载原 Director 节点的已保存 directorProject 私有副本。iframe 中的导入改动在父组件 CAS 保存前不发布到画布 store；显式新快照以空项目启动。导入请求 envelope 为 {type:"storyai:director-import-xiaji-assets",schemaVersion:1,requestId,batchId,targetNodeId,items:[{sourceKey,snapshotId,mediaRole,storageKey,sourceFormat,canonicalMime,label}]}；结果 envelope 为 {type:"storyai:director-import-result",schemaVersion:1,requestId,candidateDirectorProject,items:[{sourceKey,snapshotId,status,errorCode?}]}。iframe 返回逐项结果后，父组件校验 requestId、schemaVersion、event.source=该 iframe、origin=配置的同源 origin；单批最多 50 个资源，请求 JSON 不超过 1 MiB，含 candidateDirectorProject 的完整响应不超过 8 MiB；超过上限返回 target_project_too_large，不保存。逐项错误码限于 unsupported_format、manifest_mismatch、media_unavailable、loader_unavailable、target_schema_rejected；随后通过 CanvasProject CAS 保存，成功才发布/退出。失败则丢弃副本并恢复原选择器与选择项，已有节点状态不变。

3D 投影按源场景分组。sourceKey/current 首次导入该场景时创建一个现有 CanvasNodeType.Director 节点；再次导入时复用该虾塘投影节点，只把其 directorProject 中缺少的所选资源追加进去，按每项 sourceKey+snapshotId 跳过重复项，保留用户已有资源、布局、变换和编辑字段，不替换整份项目。每个新追加资源同时新增一条 `metadata.xiaTangImports` provenance entry。用户显式选择“作为新快照添加”时创建 UUID snapshotId 和新的独立 Director 节点。所选模型资源先复制到 infinite-canvas 存储，再按 §6.4 首段定义的 iframe 请求/响应协议导入目标端原生数据结构；不复制 DramaClaw Freezone 画布状态。显式映射 DramaClaw ThreeDSceneSnapshot/DirectorWorldSource 到目标端类型，不把源端 JSON 塞进 directorProject 的 unknown 字段。Director 节点组级 sourceKey 固定为 sourceProjectId/sceneId/mediaRole=director-world，projectionKey 再含 snapshotId；directorProject 内每份资源另存自己的 sourceKey/snapshotId。current 组重复导入复用旧节点并追加缺项；显式 UUID snapshot 分组始终建新节点。可复用源代码位于 integrations/dramaclaw/frontend/src/features/viewer-kit/three-d；复用 ThreeDStage/SOG loader 前必须核实其依赖能否进入目标 Director bundle，以及实际支持的 .ply/.sog/.splat/.ksplat 格式。目标现有本地模型选择器只接 .fbx/.obj，故其导入白名单和 iframe 消息处理均需补齐；不新增通用 File 节点。运行时按资源逐项判定：根 envelope 无效则整次拒绝；单个条目 manifest/schema/loader 不匹配时该项返回稳定 errorCode、留在虾塘，已验证的同批其它条目仍可进入 candidateDirectorProject；仅当至少一项成功时才保存画布项目并创建/更新 Director 节点。格式或数据映射未通过实际样本核验的资源应明确拒绝并留在虾塘，不伪装已导入。


3D 来源到目标的准入映射：

| DramaClaw 来源字段/格式 | 虾画表示 | v1 规则 |
|---|---|---|
| 独立全景媒体，类型为 pano360 且满足目标 Panorama 的图像/MIME/尺寸校验 | 现有 Panorama 节点 | 复制到本地 storageKey 后导入；不进入 Director world 列表 |
| DirectorWorldSource 的 mesh，实际资源为目标现有 loader 接受的 .fbx/.obj | 现有 Director 节点原生模型条目 | 必须按实际 manifest 与目标 directorProject schema 明确字段映射并用真实样本验收 |
| .ply、.sog、.splat、.ksplat、.spz 及未知扩展名 | 无默认映射 | 在确定兼容 loader、许可、依赖和真实样本前拒绝导入并保留在虾塘；不得仅靠扩展名宣称可用 |

当前 CanvasNodeData.metadata.directorProject 在 TypeScript 中仍为 unknown。构建 bundle 能核实的只有 §2 已列的 Director 根 envelope，不等于模型 asset 条目 schema、文件 URL 生命周期或 loader 输入契约已知。DramaClaw 3D loader 的复用还须记录上游版本/提交、目标 bundle 依赖、许可结论及真实样本的输入 manifest、完整输出 directorProject、字段级 source→target 映射和拒绝错误码；该映射表及 JSON schema 是实现 Director 导入代码前的硬门槛，不阻塞虾塘普通素材与其它页面移植。没有已审阅的映射产物时，3D 导入按钮禁用并说明原因。
来源身份只由共享 helper buildXiaTangSourceKey 生成，其规范序列化为 JSON.stringify(["xiaji", "dramaclaw", sourceProjectId, entityType, entityId, mediaRole])；其中 "xiaji" 是目标投影命名空间，"dramaclaw" 是连接器固定 sourceSystem 常量，不接受客户端覆盖。所有虾塘入口使用同一 helper 和字段次序，不复用 DramaCanvasProjection 的 episode/beat key。sourceProjectId/entityId/mediaRole 必须非空；保留 DramaClaw 返回的大小写和 Unicode code point，不 trim、不折叠大小写、不做 Unicode 重写。常规首次导入使用 snapshotId=current；显式“作为新快照添加”时分配 UUID，旧节点保留。节点 projectionKey 由共享 helper buildXiaTangProjectionKey 生成，规范序列化为 JSON.stringify(["xiaji-projection-v1", sourceKey, snapshotId])，作为跨重试去重键；不得混入时间戳、随机节点 ID 或展示字段。同一重试复用 snapshotId 和 batchId；只有用户再次选择新快照才生成新 UUID。sourceRevision/ETag 仅作为 DramaClaw 快照版本证明；CanvasProject.revision 才是目标端并发条件。

#### CanvasProjectRecord JSON 契约示例

成功沿用 handler response envelope {code:0,data:...,msg:"ok"}；revision 与 project JSON 分开。P 是完整 CanvasProject 示例，省略的只有可选 importKey/pendingAgentRequest：

    {"id":"canvas-1","title":"虾塘导入","createdAt":"2026-09-23T10:00:00Z","updatedAt":"2026-09-23T10:00:00Z","nodes":[],"connections":[],"chatSessions":[],"activeChatId":null,"agentConfig":null,"autoTitlePending":false,"backgroundMode":"lines","showImageInfo":false,"viewport":{"x":0,"y":0,"k":1},"sidePanel":{"open":true,"width":280},"agentPanel":{"open":false,"width":464}}

| 操作 | 请求 data | 成功响应 data |
|---|---|---|
| 新建 POST /api/local/canvas/projects | {project:P, expectedRevision:0} | {project:P, revision:1} |
| 更新 POST /api/local/canvas/projects | {project:P, expectedRevision:3} | {project:P, revision:4} |
| 批量 sync | {projects:[{project:P, expectedRevision:3}]} | {projects:[{project:P, revision:4}]}；整体单事务 |
| archive/file import | 每项为 {mode:"create", project:P, expectedRevision:0} 或用户显式确认后的 {mode:"replace", project:P, expectedRevision:3}；同批重复 id 返回 400 且不写入 | {projects:[{project:P, revision:1}]}；整体单事务 |
| delete | {projects:[{id:"canvas-1", expectedRevision:3}]} | {deleted:[{id:"canvas-1", previousRevision:3}]}；整体单事务 |

409 冲突的 HTTP body 使用 {code:1, msg:"revision_conflict", data:{applied:false, conflicts:[{id:"canvas-1", expectedRevision:3, current:{project:P, revision:4}}]}}；批量请求全部回滚。缺少 expectedRevision 返回 HTTP 428，data={kind:"revision_required", current:{project:P, revision:4}} 且不写入。更新响应内 canonical project data 等于提交快照且 revision=expectedRevision+1 才确认成功；删除未知结果则重读列表并核验所有目标 ID 均不存在。HTTP status 是错误分类权威值，body 仍沿目标端 code/data/msg envelope。

GET /api/local/canvas/projects 的成功 data 为 CanvasProjectRecord[]；单项 save 成功 data 为一个 record，sync/import 成功 data.projects 为 records 数组，delete 成功 data.deleted 为 [{id,previousRevision}]。服务端的 409 conflicts 必须逐项返回 current record；旧浏览器未带 expectedRevision 时不写入并返回 428 与当前 record。P 表示上方完整 JSON 对象，不是传输中的字符串占位符。




每批只生成一个 batchId 并写到该批节点来源元数据。批量导入允许有效项成功、失败项保留；响应未知时从当前 CanvasProject 检查 batchId 和各 selection 的 sourceKey。媒体准备过程不改 Zustand 项目状态；只有全部成功项组装成一个候选 CanvasProject 后才提交本地保存。保存确认后再发布到 store。

CanvasProject 的 250ms debounce 与投影提交共享有序写入队列。自动保存或批量 sync 响应未知时，暂停队列并按 §5.12 读回 canonical 项目逐项比较；仅在已确认提交或安全重放后恢复。不同标签页/设备同时编辑同一 CanvasProject 不在首期承诺范围。

单项目保存、autosave 批量 sync、archive/file import、delete 四类修改 CanvasProject 的路由，都携带 expectedRevision 并调用同一 CAS repository 与 store 队列。sync/import/delete 在单一 DB 事务中处理输入项，任一冲突整批回滚并返回当前版本；删除条件也包含 revision。新建仅 INSERT，唯一键冲突返回 409。成功返回 canonical 项目和新 revision。当前这些路由没有统一 CAS；前端不把内存更新当作持久化成功。

媒体明确保存失败时，仅删除记录在 journal 中且经所有 CanvasProject 引用检查确认为未引用的 storageKey；内容去重返回的对象若已被任一画布引用则绝不删除。结果未知时先按 batchId 重读画布，未确认前不清理可能已被引用的媒体。暂存媒体清理失败单独提示为残留文件，不显示为完整回滚。

### 6.5 从虾画写回虾塘

统一用户交互为：目标 provider 生成 → 预览 → 用户点“写回虾塘” → 按目标槽位执行源端写入 → 刷新源端 query。不同源槽位沿用真实写接口，不先抽象成通用 asset-version API。

- 角色头像：POST /projects/{project}/characters/{name}/portrait/upload，multipart file。
- 身份主图、portrait、costume：分别调用 /identities/{identity_name}/upload、/identities/{identity_id}/portrait/upload、/identities/{identity_id}/costume/upload；删除仍用 image/delete、costume/delete。
- 场景 master、pano、自定义空间包：分别使用 master/upload、pano/upload、custom/upload。各自删除走对应 delete route。
- 场景 reverse master 与道具参考图没有对称的直接上传槽位：调用 infinite-canvas 现有 POST /api/v1/drama/projects/{project}/freezone/upload，随后 POST /impact 查看影响；用户确认后调用 POST /push。target 分别为 scene_reverse_master（scene_id）和 prop_ref（prop_id）。目标服务现有的 target required-fields 规则是实施映射依据。
- 新建角色身份可使用现有 POST /freezone/assets/identities；角色资产历史恢复走现有 GET asset-history 与 POST restore。
- 直接上传路由在用户点确认前绝不调用，因为源端上传会立即改 canonical 槽位。freezone 上传只存候选；仅 push 才替换对应槽位。

正常成功后按源 hook 刷新角色、identity、scene、prop 或 voice 查询；响应中的 stale/受影响 beat 信息原样展示。直接上传或 push 超时/断线进入“结果未知”：先重新读取对应源端资源并比较目标槽位；能确认已写入则结束，不能确认则保持未知，不自动重发非幂等写入。候选上传结果未知不改变 canonical 槽位，可在核对候选目录后再由用户决定上传。

## 7. 错误、安全与一致性

- 上游 host 固定为服务端 DRAMACLAW_BASE_URL；DRAMACLAW_API_TOKEN 只进入服务端 Authorization Bearer header。浏览器只访问 infinite-canvas 同源 API。
- Go 使用 6.2 明确的 method/path allowlist、项目访问校验、上传大小/媒体类型限制和 URL 来源校验；拒绝任意 URL、任意路径和跨项目静态媒体。上游重定向不得把媒体代理带到配置 host 之外。
- JSON、multipart、SSE 保留对应 content-type/status/body；SSE 按流转发，不缓冲成一次性 JSON。客户端断开时取消上游请求。
- 上游 401/403 显示凭据或项目权限错误；404 显示资源不存在；5xx/网络失败显示上游失败。读操作可重试；直接上传、项目生命周期和 push 的结果未知时先读回核对，不自动重复。
- 源版本缺失时的重读按可判定结果分支：源端 401/403/404/5xx、媒体读取超时或 digest 计算失败均停在 `source_recheck_required`，保留 journal、已确认 receipt 和原画布状态，仅提供“重试读取/在虾塘打开/放弃本批”；只有元数据与媒体 digest 成功读出并匹配才继续原 snapshot。读出不同内容则进入 `source_changed`，用户确认“作为新快照”后新建 snapshotId/batchId，旧批次仍可独立恢复或丢弃；不能把读取失败当作内容已变化或相同。
- DramaClaw 是项目、实体、领域任务和媒体的唯一记录源；没有源 revision 的表单更新不伪装成乐观锁。源端冲突按原状态展示并要求刷新。
- CanvasProject 只存已选内容快照、目标存储媒体引用和来源标识；不保存 token、完整源端响应或任意 meta map。
- 画布存储失败、媒体下载/复制失败、DramaClaw 写入失败、provider 失败各自有明确状态，任何一层失败都不能展示整体成功。
- 画布保存响应未知时显示“正在核对保存状态”；若 canonical 项目读取也失败，显示“暂时无法确认，导入已保留”，暂停重复提交并保留 journal，提供人工刷新/重试核对入口。只有服务端读取确认原 revision 未变时才重放同一 CAS 一次；不把“GET 暂时不可达”显示成失败或允许新 batch 绕过。
- 目标部署需要可访问 DramaClaw Python 服务及其媒体/数据目录。单实例单上游主体为首期假设；多用户场景不得共享高权限 token，需另行定义身份映射。

## 8. 风险与实施切片（仅用于规格评估，不是开工计划）

1. 运行承载核验：验证 DramaClaw 服务能与目标实例按指定 URL/凭据运行；确认用户/项目权限主体。
2. 接口移植核对：实施前形成并审阅逐路由 manifest，逐一对照 6.2 每条 route 的源端 Python route、前端 hook、method/path、query 与 JSON/multipart schema、成功/错误 envelope、幂等/重试类别、上传限制和 query invalidation；任何源端特殊 API 不做“猜字段”代理，未核实 route 不注册且对应按钮禁用。确认 source viewer-kit 与目标 Director 的依赖/许可、3D 导入消息协议、SOG/PLY 持久化和导入格式映射。Director 导入编码前必须产出并审阅真实 manifest→directorProject 映射样例与 JSON schema；未通过时只禁用 3D 导入，不能伪造目标字段。
3. 虾塘全页：以新资产工作区接管 `/xiaji`，移植四页真实布局和数据操作；保留旧 `XiaJiClientPage` 在 `/xiaji/episodes` 的 episode/beat 工作流和主导航中的独立入口；未接上的按钮显示禁用原因，不宣称完成。
4. 虾画工具栏挑选器：按实体和媒体角色浏览/勾选，走共享投影操作；从虾塘页发送也调用同一操作。DramaClaw 3D 源格式导入现有 Director 节点，保留可查看、可追溯的 storageKey。
5. 生成和写回闭环：常规媒体生成接目标 provider；用户确认后候选/身份/槽位写回；完成未知结果核对界面。
6. 单元与端到端验证：获准实施后按 TDD RED → GREEN → REFACTOR；覆盖源端代理、四类操作、SSE、媒体来源检查、重复投影、部分失败、写回未知恢复和视觉截图对照；另覆盖 multipart framing 上限/流式内存上界、单批并发预算和重复 receipt、Fetch half-duplex 下早 202/连接关闭/transport error 的读取表现及 GET batch 恢复、未知时不重传、receipt 缺失时同 requestId 恢复、MIME/扩展名冲突、receiving/staged/rename/DB commit 各崩溃点恢复、批次 abandon 与 GC、同 requestId 同/异 metadata、archive import 冲突、CAS envelope 和 Director schema 拒绝/逐项回执。旧 `/xiaji/episodes` 验收需直接访问及刷新该路径；确认当前无旧 URL query 状态、项目 ID 仍由页面输入且刷新后重新输入，再验证旧 catalog、媒体、写回及重复导入沿用旧 projectionKey；确认新虾塘挑选器不请求 episode/beat catalog，也不修改旧入口数据。当前不执行这些测试。

主要风险为：部署必须运行 DramaClaw 服务；源端 API 字段和错误语义多；AutoDL 图片调用契约尚未证实；Elastic-2.0 与目标仓库 AGPL-3.0 的代码复用/分发组合需要逐文件与分发方式核验；目标配置凭据目前对应单一上游主体。

## 9. 许可证与来源

integrations/dramaclaw 快照声明 Elastic License 2.0；目标仓库声明 AGPL-3.0。首选逐文件核验后直接移植可复用页面与组件，保留源文件 SPDX/版权声明、上游来源及变更记录；不把两方许可描述成已兼容。实施前建立实际复制文件清单并核验许可证与产品分发方式；未核验前不发布含源代码的分发包。若某文件/组件不能获准复制，回退到按已核实行为与截图独立实现，不复制其代码、样式资产或运行时模块；若 3D loader 不能复用，则选用许可明确兼容的目标端 loader，未找到兼容实现前明确禁用受影响格式，不宣称支持。

## 10. 工作流与门禁

- 架构评审评级范围：判断本规格是否把边界、数据/状态契约、迁移步骤和验收条件定义到可供后续审阅的程度。当前源码缺少本规格要求的新能力，属于实施差距，不单独作为架构设计不合格；若规格没有说明如何补齐或验证，才据此降级。不得把“目标功能尚未实现”误报为已实现或作为唯一 REVISE 理由。

- Superpowers brainstorming：本任务分类为架构设计，目标是把源页面与领域能力移到目标 app，并将所选素材投影到现有画布。
- before-you-build：本期范围是虾塘项目总览及生命周期、角色/场景/道具/声线页、明确导入和生成结果写回；虾料、虾镜、虾格、虾条、虾导等其它模块不迁入。主风险是后端依赖、接口差异、媒体迁移与复用许可。
- architecture-analysis：以上表固定源数据、适配器、页面/provider、CanvasProject 四个记录与执行边界；失败按源端操作、投影和写回分别恢复。
- api-and-interface-design / architecture-patterns：复用 DramaClaw 领域 API，通过固定前缀且精确 allowlist 的 BFF 适配；投影是前端数据转换，经 useCanvasStore 有序条件保存后发布；不增加独立微服务、不增加泛化 assets/jobs/projections 后端。
- frontend-design：以飞书实页截图和源组件布局作迁移参照，目标产品只调整品牌/token/路由；DramaClaw Freezone 画布及其导航不移植，源资源页的画布动作改接 infinite-canvas。
- architecture-critic：本版本由未参与设计的独立子代理按 architecture-critic 七维评级；报告作为单独版本文件保存。评级是建议，不替用户决定是否继续。
- TDD：仅在之后单独批准的实施阶段使用 RED → GREEN → REFACTOR；当前不写代码、不安装依赖、不运行项目、测试或构建。
- 只读证据：本规格定位源端实际页面/hooks/路由和目标端当前 Go 路由、DramaImportCatalog、投影工具及 CanvasProject store；飞书手册作为布局证据，README 概念图不作为界面证据。

## 11. 本版本已做出的设计决定

1. 后端：DramaClaw 服务保持虾塘数据与领域任务记录方；目标 Go 仅以固定 host 和精确 allowlist 代理源端页面 API。
2. 页面：新虾塘工作区接管 `/xiaji`，移植项目总览生命周期及角色、场景、道具、声线页面；角色/场景/道具领域模型独立保留。旧 `XiaJiClientPage` 移至 `/xiaji/episodes`，原 episode/beat API、投影和写回兼容语义保留，并从主导航作为单独入口，不进入新资产页分类。DramaClaw Freezone 画布不移植；其来源页“打开画布”操作改为发送到 infinite-canvas。虾画挑选器只读选取，不替代虾塘页面。
3. 项目上下文：源摘要接口使用 status=visible；归档与回收站按源端状态筛选。项目来自当前上游身份可见清单，不手工输入 ID。
4. 生成：普通图像使用 infinite-canvas 现有图像服务/provider 配置；AutoDL/MCP 只有满足实际请求/结果契约时才能作为 provider。角色/场景构建、场景全景、导演世界及 3GS 继续走 DramaClaw。
5. 写回：源端槽位各用真实上传/候选/push/history 接口；用户确认前不更改 canonical 槽位，不新增泛化 jobs 或 assets API。
6. 投影：两入口共用前端函数；普通素材只追加。重复资源默认跳过；用户选“新快照”才另建节点。3D 当前快照复用虾塘创建的同场景 Director 节点，并只追加缺失资源；不改用户创建的节点或已有资源。文本/图像/全景/视频/音频使用现有节点；3D 文件/世界状态进入现有 Director 节点，采用独立格式适配。
7. 保存：自动保存、归档导入和删除只写 dirty/selected projects；单项保存与所有批量 mutating routes 共用有序队列、revision 原子 CAS 和未知结果读回核对；任一冲突暂停队列并显式保留本地脏状态，此能力是规格所需改动，当前代码尚未提供。
8. 并发范围：首期单本地用户、单 DramaClaw 凭据、同一画布单活跃写入窗口；跨标签页/设备同时写入需后续设计。
9. 许可证：integrations/dramaclaw 声明 Elastic-2.0，目标声明 AGPL-3.0；实施前逐文件清单和分发方式核验仍是发布前条件，规格不宣称许可兼容。
