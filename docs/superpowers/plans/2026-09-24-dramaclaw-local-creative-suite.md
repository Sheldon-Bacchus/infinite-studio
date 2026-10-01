# DramaClaw 创作模块完整前端移植实施计划

> 历史计划：本计划原含虾面阶段；该范围已于 2026-09-25 被最新用户决定取代。不得继续执行本计划中的虾面、Freezone 或“回主线”阶段。当前范围与进度以 `docs/progress/todo.md` 及架构范围更新为准。

虾镜上下文导入虾画另有[当前规格](../specs/2026-09-25-xiaji-beat-context-canvas-import.md)和[独立计划](2026-09-25-xiaji-beat-context-canvas-import.md)；本历史计划的媒体生成与虾面步骤不能套用到该工作。

**目标：** 将 DramaClaw 虾料、虾塘、虾镜、虾面前端真实页面和组件移植进 Infinite Canvas；数据、媒体、生成和 Canvas 行为全部由 Infinite Canvas 本地能力提供；虾面候选经用户确认后以新版本回主线。

**架构：** 保留已核实源页面的控件、布局与视觉层级，抽离 TanStack Router、React Query、DramaClaw 请求/任务/提交逻辑。用 feature-owned local studio adapter 接 Infinite Canvas Asset/file/model/Canvas 能力。虾画由 Infinite Canvas 原生 Canvas 承载。项目、分集、Beat 优先在 Asset.metadata.localStudio 中表达，不新增 Go API 或数据库。

**技术栈：** React / Next.js、TypeScript、现有本地 Asset 与 file service、Infinite Canvas CanvasProject 保存、现有测试工具。是否使用新依赖须另行说明，不默认安装。

**规格：** ../specs/2026-09-24-dramaclaw-local-creative-suite.md

**架构：** ../../architecture/2026-09-24-dramaclaw-local-creative-suite.md

## 执行边界

- 开始后严格按 TDD：每个行为先写失败测试并单独观察 RED，再实现 GREEN，最后 REFACTOR。
- 保留工作区现有改动；开始前和每阶段完成后核对 git status/diff。不得重置、覆盖、清理或提交未获要求的内容。
- 不运行、部署或连接 DramaClaw；不发起任何 DramaClaw host/API/数据库/项目/任务/生成请求；不配置 DramaClaw URL/token。
- 不移植 DramaClaw 后端，不新增 Go 路由、后端数据库或任务系统。
- 来源文件版权声明、SPDX 和修改记录必须保留；Elastic/AGPL 组合许可未获维护者审阅前，不扩散复制文件。
- 任何复用组件必须先过源代码依赖闭包审查，不得因复制 route 文件将上游请求带入 Infinite Canvas。

## 开始前：工具与证据

### Skills

- Superpowers brainstorming、before-you-build：再次确认目标、范围和不可用能力。
- architecture-analysis、api-and-interface-design、architecture-patterns：检查本地数据表示、适配器和失败恢复。
- architecture-critic：实现前独立检查架构与数据流。
- frontend-design、web-component-design：对照来源截图和源码控件，审查直接移植范围与视觉保真。
- writing-plans：本计划的阶段边界与文件/测试映射。
- test-driven-development：各阶段行为的 RED → GREEN → REFACTOR。
- webapp-testing、e2e-testing-patterns、verification-before-completion：浏览器验收和结果报告。

### MCP / 工具

- Serena MCP：逐页面获取符号、import、引用与本地 store/service 调用关系。
- Repomix MCP：以精确页面依赖闭包 include patterns 运行 `pack_codebase`，并用 `grep_repomix_output` 检查调用；输出放系统 Temp，不写入仓库；排除 .env、.serena 私有内容、node_modules、用户素材。
- Context7 MCP：需要核对 React/Next/TanStack/测试工具具体 API 时查询官方文档。
- Browser/CUA：来源/目标页面实际截图、交互和 Network 检查。
- GitNexus：若后续用户同意建立索引，辅助静态依赖/影响图；当前 MCP 没有 repo index。
- GitHub MCP：当前不可用，不能在执行报告中写成调用过；公开源码证据可用官方 GitHub 网页。
- 子代理：拆成两项只读审查：A 审 localStudio 数据/保存/版本和回主线；B 审源组件依赖闭包/视觉控件映射/许可风险。用户要求 Luna 最高档时分别请求 gpt-6-luna reasoning=max，记录工具实际返回；禁止子代理改文件、跑测试或连 DramaClaw。

## 阶段 0：保护基线与锁定复用清单

- [ ] 保存并逐项复核当前 git status、已修改文件及 untracked 文件。为已有用户改动建立只读清单，不将它们纳入覆盖式 patch。
- [ ] 重新读取飞书虾料、虾塘、虾镜、虾面章节和截图；记录页面名、视口和截图位置。截取来源页面后实际打开核对。
- [ ] 用 Serena + rg 为 ingest、characters/assets、episodes/index/overview/script/beats/sketches/audio/video/compose、FreezoneShell、AssetLibraryPanel/Browser、CanvasesTab、CanvasOutlineList、capabilityRegistry、beatContextProjection、commit 生成 import/call/request/CSS/icon/store 依赖闭包。
- [ ] 用 Repomix 只打包审阅白名单；记录命令、文件清单、输出方式与排除项；不得写入用户文稿或仓库文件。
- [ ] 建立页面矩阵：每个来源控件、来源组件与样式、目标位置、本地行为、目标能力缺口、测试、截图。
- [x] 路由设计稿已写入 `artifacts/dramaclaw-local-creative-suite/route-map.md`；第七轮只读最终复核 P0/P1/P2=0。设计统一 `[projectAssetId]` 动态段，以 `/episodes/by-id/[episodeAssetId]` 区分稳定 ID 与旧数字别名，拆分人物深链稳定 `assetId` 和来源旧 `id`，定义 `beatAssetId`/`focusBeatAssetId`、普通选择参数同项规范化/冲突、focus 参数并存一律冲突、项目与分集归属、compose search allowlist 及 Freezone `?canvas` 消费。实施阶段须按用例表新增路由回归测试；当前没有实现或测试。
- [ ] 将 `AssetBeatReferences` 明确映射为角色/场景/道具详情内按需展开的“出现于镜头”反向索引；定义 Beat `referencedAssetIds`、source prop 名/别名唯一解析、未解析状态和本地 Beat 深链。为 `CharacterImageSourceSelect` 列出各原选项及本地可用/禁用依据。
- [x] 逐调用点映射稿已写入 `artifacts/dramaclaw-local-creative-suite/source-call-map.md`：包含来源行号/传参、HTTP 请求/响应/缓存副作用、目标本地映射或禁用边界；包括 Freezone mount 预取/sync/素材/push、虾料 upload/task/SSE、Beat 子面板及 render plan/settings/execute/重投、compose 下载。调用映射第二轮发现 2 项 P1、6 项 P2；本版按意见修订，待第三轮独立复核。
- [x] 上游基线已确认是 `v2.0.5 / a09248410343158ba227ec40b5a4dbc1ba4b1444`，详见 `artifacts/dramaclaw-local-creative-suite/source-provenance.md`。全量 1,199 项中，1,198 个文本文件有 1,180 个归一化后相同、18 个不同，另 1 个 GIF 二进制原始 SHA-256 相同；Repomix 74 文件依赖闭包含 35 个新增补充文件，其中 33 个文本相同、2 个有本地差异。18 个差异未推定来源提交或改动者；许可证和分发批准仍是独立待办。
- [ ] 逐文件盘点 Elastic-2.0 SPDX、copyright、LICENSE/NOTICE、第三方图标/模型/字体和依赖；license manifest 要记录上游 repo/tag/SHA、逐项许可证据、source/target path、复用/适配/排除、修改记录和维护者状态。18 个本地不同文件单独说明来源/修改归属；不能只凭 v2.0.5 基线继承许可结论。核读 REUSE.toml：不复制标注不在公开镜像范围内的 worker、wrangler、`.github/workflows`、`.env` 类文件；public/fonts 许可未核实前不复制，Quaternius CC0 单列。
- [ ] 只读子代理独立审阅矩阵和架构，合并意见或保留逐条裁决。

阶段 0 的审阅产物固定保存在 `docs/superpowers/artifacts/dramaclaw-local-creative-suite/`：`source-to-target-matrix.md`（已建立，逐页面细节仍在补）、`source-call-map.md`（调用行号/参数/请求副作用映射已建，仍可能需按实际移植修订）、`route-map.md`（路由方案已建；路由实现需继续补回归测试）、`source-provenance.md`（上游 tag 与本地差异已核对）、`license-manifest.csv`（逐文件许可证据仍待完成）。这些是实施追踪材料，不再作为“禁止开工”的审批门槛；复制/分发每个来源文件前仍要保留声明并记录该文件许可证据。

**退出条件：** 将此阶段作为完整性追踪：控件矩阵、来源调用点、反向引用/图片来源、路由用例、来源版本和许可证据最终逐项闭合。当前已实现部分页面和测试，但矩阵、许可清单、完整截图对照及运行时 Network 验证未闭合；继续实施不等于这些项目通过。

## 阶段 1：本地数据类型与 repository adapter

拟新增/调整范围，具体文件名以仓库现状为准：

- web/src/features/xiaji/local-studio-model.ts
- web/src/features/xiaji/local-studio-model.test.ts
- web/src/features/xiaji/local-studio-repository.ts
- web/src/features/xiaji/local-studio-repository.test.ts
- web/src/features/xiaji/xia-tang-local-model.ts 及既有测试
- web/src/stores/use-asset-store.ts 与对应测试：增加可等待的本地持久化 action，协调待处理 debounce/sync，再将 canonical 返回值写回 store
- web/src/features/xiaji/return-operation-outbox.ts 与对应测试：用现有 local Asset sync 保存隐藏的内部 operation Asset 与冻结 payload；按 canonical 目标记录恢复超时确认
- web/src/services/api/local-workspace.ts 现有接口作为 adapter 调用，不增加 Go route

行为循环：

- [ ] RED：metadata codec 对 project/episode/script/beat/source relation 的新 schema、旧 xiaTang 数据兼容、非法字段拒绝和 ID/父子关系测试失败。
- [ ] GREEN：实现 localStudio namespace、codec、稳定关联 ID 和最小迁移读取。
- [ ] RED：store action 在已有 250ms 防抖写入待处理时执行强制保存、收到 canonical Asset、后端失败、并发更新和超时的测试失败。
- [ ] GREEN：用现有 /api/local/assets/sync 的 Asset[] → canonical Asset[] 契约实现可等待保存；序列化本地写入并清理过期 debounce；不要把 Go model.Asset 当成前端类型。
- [ ] RED：repository 创建/更新、同步批次全有或全败、canonical 不一致冲突、上传文件成功但 Asset 事务失败、相同 confirmationId 重试的测试失败。
- [ ] RED：回主线 intent 先持久化、内部 operation Asset 不出现在普通列表/计数/选择器、pending intent 刷新可读的测试失败。
- [ ] RED：模拟目标 Asset 已在服务端提交但响应超时；刷新后凭持久 operation 读到 canonical versionAssetId/payload 并完成收敛，不创建第二个版本。目标不存在时同 ID/同 payload 重试；同 ID 不同 payload 显示冲突。
- [ ] GREEN：接现有 Asset/file API。Asset 同步批次失败时保留候选和已上传文件引用供重试，不自动清理媒体；展示该批次全败，不伪报逐条部分成功。
- [ ] REFACTOR：抽取类型守卫和错误分类，保持来源端字段名到本地字段映射可追踪。
- [ ] 记录现有 API 返回 canonical 列表、单请求数据库事务、timestamp merge 和无 CAS 的并发边界。

## 阶段 2：目标文本模型 adapter

拟新增文件：

- web/src/features/xiaji/local-studio-text-generation.ts
- web/src/features/xiaji/local-studio-text-generation.test.ts

- [ ] RED：测试仅调用 Infinite Canvas 已配置的模型/渠道、无工具请求、未配置、拒绝/超时/错误和响应缺失。
- [ ] GREEN：使用本地现有 Canvas Agent provider 能力写 feature-owned wrapper；不改 Infinite Canvas 助手，不创建 DramaClaw 配置。
- [ ] REFACTOR：将模型错误归一化到来源 UI 能显示的状态；禁止虚构任务百分比或完成事件。
- [ ] 浏览器/静态网络检查确保请求目的地为已配置模型能力而非 DramaClaw。

## 阶段 3：虾料真实页面移植

来源：integrations/dramaclaw/frontend/src/routes/_app/projects.$project/ingest.tsx。

目标候选：web/src/app/(user)/xiaji/ingest/page.tsx 和 web/src/features/xiaji/ingest/。

- [ ] RED：覆盖文件上传/粘贴、项目类型、基础风格、字段验证、结构生成状态、预览、本地项目保存、刷新读取和错误恢复。
- [ ] GREEN：优先移植来源组件与样式；仅改 route loader/actions、React Query 数据钩子为目标 local studio adapter。
- [ ] REFACTOR：保留来源控件层级与截图比对尺寸；去除不必要的源端 route 依赖。
- [ ] 用来源和目标截图对照导入表单、选项、预览、空/错误态。

## 阶段 4：虾塘真实页面移植

来源：characters.lazy.tsx、components/assets 下角色/场景/道具/声线与搜索统计控件。

目标：web/src/app/(user)/xiaji/page.tsx、web/src/features/xiaji 既有本地虾塘组件/模型。

拟新增映射组件与测试：`web/src/features/xiaji/components/character-image-source-select.tsx` / `.test.tsx`、`web/src/features/xiaji/components/asset-beat-references.tsx` / `.test.tsx`；具体 props 和 metadata codec 以阶段 0 冻结的映射为准。

- [ ] RED：先为每个来源控件逐项建立行为测试，包括 CharacterImageSourceSelect 的本地选项映射/禁用提示，AssetBeatReferences 的按需加载/排序/Beat 深链/prop 别名唯一解析，角色身份/年龄/外貌/服装/头像/参考图/主角、场景/变体/master/reverse/360/空间字段、道具关联/批量上传、NarratorVoicePanel/声线槽位/项目旁白、搜索统计、编辑/删除确认与媒体操作。
- [ ] RED：真实声线点击、录制/上传/试听/本地音频选择、裁剪、错误和缺失媒体场景均有测试。
- [ ] GREEN：逐组件移植真实来源布局、选项和表单；本地状态通过 repository adapter；保留现有虾塘资产与媒体 ID。
- [ ] GREEN：来源服务提供而本地没有的导演世界/3D/全景生成动作原位禁用并说明；如有纯本地字段编辑仍可正常保存。
- [ ] REFACTOR：统一事件和表单状态但不把不同领域资产压平为同一通用表单。
- [ ] 对比来源与目标截图，完成角色、场景、道具、声线四组截图和控件差异表。

## 阶段 5：虾镜页面移植

来源：episodes.tsx、episode index.lazy.tsx、overview.lazy.tsx、script.lazy.tsx、beats.lazy.tsx、sketches.lazy.tsx、audio.lazy.tsx、video.lazy.tsx、compose.lazy.tsx。

目标候选：web/src/app/(user)/xiaji/episodes 与 web/src/features/xiaji/episodes。

- [ ] RED：覆盖分集新增/排序/编辑、剧本编辑和保存、Beat/草图/音频/视频标签、镜头关系、状态恢复、筛选和各错误态；index/overview/sketches/audio/video 旧路径跳转到正确目标。
- [ ] RED：本地 generation adapter 成功/失败/取消/缺配置行为；无法支持的合成、字幕/旁白/混音能力测试其 disabled reason。
- [ ] GREEN：移植真实来源页面与控件；sketch 页面保持到 Beat 草图标签的对应导航语义。
- [ ] GREEN：用 Asset parent IDs 关联 project/episode/script/beat/shot；目标媒体能力引用现有 generation 和 file 保存。
- [ ] REFACTOR：按阶段 0 冻结的 Next route mapping 实施；回归旧用户路径和 slug 保留行为，不临时挪动项目路径。
- [ ] 截图逐项对照分集、剧本、Beat、草图和合成页。

## 阶段 6：虾面移植与 Infinite Canvas 原生画布

来源：FreezoneShell.tsx、AssetLibraryPanel.tsx、AssetLibraryBrowser.tsx、CanvasesTab.tsx、CanvasOutlineList.tsx、capabilityRegistry.ts、beatContextProjection.ts、freezone.lazy.tsx、commit UI。

目标候选：web/src/app/(user)/xiaji/freezone 与现有 web/src/app/(user)/canvas。

- [ ] RED：覆盖虾面资产面板、来源选择、多参考输入、多候选/版本浏览、空状态、错误状态和分集镜头跳入。
- [ ] RED：目标 Canvas node mappings、缺媒体、重复导入、同步事务失败、Canvas canonical 返回与提交快照不一致、保存失败和刷新后持久化测试失败。
- [ ] GREEN：移植来源面板与自由创作控件；画布以目标 Infinite Canvas 原生实现；通过可检查 canonical 项目的保存路径调用现有 Canvas sync API。不得仅凭 saveProjectAndWait resolve 就报告快照已保存。
- [ ] GREEN：候选保留 sourceAssetId/sourceCanvasId/sourceNodeId 和关联 Beat/Episode；不自动生成连线。
- [ ] REFACTOR：移除所有 Freezone canvas persistence、协作/任务 API 和 DramaClaw route/query 依赖。
- [ ] 截图对照虾面入口、资产面板、多参考、候选浏览和目标原生画布。

## 阶段 7：用户确认的本地回主线

拟新增文件：

- web/src/features/xiaji/return-to-mainline.ts
- web/src/features/xiaji/return-to-mainline.test.ts
- 与虾面对应的结果预览/确认组件及 UI 测试

- [ ] RED：按角色、场景、道具、Beat 草图、渲染图/首帧、视频分别验证候选→目标槽位映射。
- [ ] RED：未经确认、源媒体缺失、目标删除、同一确认重试、不同确认并存、部分关联媒体失败、保存失败和目标已有数据均有明确测试；另覆盖“服务端已提交、浏览器超时、刷新后从持久 outbox 恢复”的故障路径。
- [ ] GREEN：每次确认先把 confirmationId、versionAssetId 和冻结 payload 持久化为隐藏 operation Asset，并核对 canonical intent；同一操作的 retry 使用同 ID 和同 payload。目标 canonical Asset 已存在且一致时收敛完成，不重复新增。版本以稳定 ID 表示，不宣称 CAS 下的递增版本号；不覆盖原素材。
- [ ] GREEN：保存失败时不清空候选选择；重试不产生重复版本；Asset 批次遵循现有 all-or-none 事务语义。
- [ ] REFACTOR：将预览 diff、用户确认和持久化拆分为可审计动作。
- [ ] 验证刷新后版本历史、来源关系和目标引用仍在。

## 阶段 8：集成、回归与浏览器验收

- [ ] 通过页面矩阵确认四模块每项控件均有“复用/适配/禁用说明”和本地行为结果。
- [ ] 单元、集成、E2E、smoke、TypeScript 分开执行并逐项记录实际命令/结果；失败测试保留证据。
- [ ] 浏览器完整路径：新小说/剧本 → 项目结构 → 虾塘角色/场景/道具/声线 → 虾镜分集/脚本/Beat/镜头 → 虾面候选 → 用户确认回主线 → 刷新验证。
- [ ] 真实 Network 面板确认无 DramaClaw host、/api/v1/drama/*、上游项目/任务请求。面板不可读时直接报告不能验收。
- [ ] 来源和目标同等视口截图逐张打开，按页面矩阵核对控件、排版、状态和缺项。修正明显遗漏后重截。
- [ ] 查看 git diff 与 git status，确认既有工作区改动仍在、只更改授权文件、不提交。
- [ ] 输出单测/集成/E2E/smoke/类型/浏览器/Network 结果、未实现来源能力与许可审查状态。

## 实施进度（2026-09-25）

- **已实现的代码片段：** LocalStudio 本地项目/原稿/分集模型与 repository；虾料结构/文本生成提示词；虾塘本地页面和领域素材编辑；虾镜分集卡片统计、脚本编辑/生成提示词、Beat 台词与关联资产；虾面候选返回主线的本地逻辑与成功状态守卫。逐项映射见 `artifacts/dramaclaw-local-creative-suite/source-to-target-matrix.md`。
- **本轮验证：** `cd web && bun test`：57 files、247 pass、0 fail、924 expect；`cd web && bunx tsc --noEmit`：通过。Turbopack 全站生产构建约 12–16 秒，启动器健康/API bridge 检查通过；相关功能经历 RED→GREEN；这不代表 E2E/页面完整移植通过。
- **当前浏览器状态：** 生产 `/xiaji/projects` 已加载并显示空项目状态；没有项目数据，尚未跑创作/导入/回主线/刷新完整流程。Network 面板未检查，来源/目标截图未完成逐页比较。
- **仍待完成：** 来源控件逐项保真移植与差异修正、登录后完整浏览器流程和刷新验证、Network 运行时检查、来源与目标截图、逐文件许可证 manifest/维护者审阅、Director World 与成片合成等无本地等价能力项的准确标示。
- **持续约束：** 不连接或运行 DramaClaw；不提交；不清理或覆盖现有工作区改动；不把静态检索或单元测试称为浏览器验收。
