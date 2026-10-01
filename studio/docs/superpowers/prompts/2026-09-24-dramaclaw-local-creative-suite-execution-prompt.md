# 可审阅的执行提示词：DramaClaw 创作模块移植到 Infinite Canvas

> 历史提示词：本文原含虾面、回主线和媒体生成相关任务，不用于当前实施。当前 Beat 上下文导入任务请用[2026-09-25 执行提示词](2026-09-25-xiaji-beat-context-canvas-import-execution-prompt.md)，并先确认该任务规格与计划。

请先完整阅读以下文档并按其边界执行：

- 规格：docs/superpowers/specs/2026-09-24-dramaclaw-local-creative-suite.md
- 架构：docs/architecture/2026-09-24-dramaclaw-local-creative-suite.md
- 计划：docs/superpowers/plans/2026-09-24-dramaclaw-local-creative-suite.md
- 本任务还需对照用户提供的飞书产品手册与 integrations/dramaclaw/frontend 中的真实源码。

## 开始门禁

现在是设计审阅阶段。先报告你已读取的规格、任何冲突和待澄清项，等待用户明确确认规格与计划。确认前不改业务代码、不启动项目、不运行测试或构建、不安装依赖、不提交。

获得确认后，先读取 AGENTS.md/相关 SKILL.md，重查 git status、diff 和 untracked 文件，保护所有已有工作区更改。不要重置、覆盖、批量清理或提交。

## 目标

将 DramaClaw 的真实虾料、虾塘、虾镜、虾面前端页面、组件、样式和交互移植并复用到 Infinite Canvas。逐控件以真实源码和飞书页面为准；保留布局层级、选项、表单、详情、状态与响应式行为，不能凭截图重画简化版本。

Infinite Canvas 始终是主应用。虾画继续用 Infinite Canvas 自己的画布、节点、连线、生成和保存。虾面结果允许用户显式选择和确认后，写成 Infinite Canvas 本地目标素材的新版本并保留来源关系。

## 必须移植的范围

1. 虾料：小说/剧本导入、项目类型、基础风格、结构生成和预览。
2. 虾塘：角色、场景、道具、声线的完整真实页面和字段，包括详情、子实体、媒体、筛选、编辑、历史、状态和响应式布局。
3. 虾镜：分集、剧本、Beat/草图、镜头和合成页面。保留 index 与 overview 跳转到脚本、sketches/audio/video 跳转到 beats 对应子标签的旧路径语义。
4. 虾面：自由创作页面和资产面板，包含 Freezone AssetLibraryBrowser、CanvasesTab、CanvasOutlineList、capabilityRegistry、beatContextProjection 与 commit UI，支持多参考、多候选/版本探索；画布主体使用 Infinite Canvas 原生画布。
5. 回主线：目标支持角色、场景、道具、Beat 草图、渲染图/首帧和视频；用户逐项确认后写入本地新版本，不覆盖原素材。

不做虾格、虾导、虾体及其他未列出的虾X模块。Infinite Canvas 现有助手保持原样。

## 集成硬边界

- 不运行、部署或连接 DramaClaw；不访问其 host、API、数据库、项目、任务或生成服务。
- 不配置 DRAMACLAW_BASE_URL、DRAMACLAW_API_TOKEN，不增加上游代理或 connector。
- 不移植 DramaClaw 后端，不新增 Go route、数据库或任务系统。
- 使用 Infinite Canvas 现有 Asset、媒体文件、已配置模型能力和原生 CanvasProject/saveProjectAndWait。
- 先核对当前持久化契约。项目/分集/Beat 优先放在 Asset.metadata.localStudio 中，不为建模方便新增后端。
- 现有 useAssetStore.addAsset/updateAsset 是乐观更新并走延迟同步。特殊写入必须提供可等待的本地持久化 action，处理防抖竞争并检查 /api/local/assets/sync 返回的 canonical Asset 列表。该 API 单次批量是数据库事务全有或全败；不要虚构逐条部分成功。
- 媒体文件上传与 Asset 同步不共用事务。媒体已上传但 Asset 批次失败时保留文件引用供重试并明确报告；不自动清理文件。
- Canvas 的 saveProjectAndWait 当前等待 API 但忽略 canonical 项目列表。虾面写入路径必须比较 canonical CanvasProject 和提交快照；发生 timestamp merge 冲突时保留候选并提示用户。现有 API 无 CAS，不宣称跨标签页版本号有序。
- 不能由 Infinite Canvas 本地能力实现的来源操作，保留页面位置与原因说明，禁用并如实反馈；不得造假数据、进度、错误消失或成功状态。
- “回主线”只在用户确认后追加新版本，保留 source IDs 和版本关系。先在现有本地 Asset store 保存隐藏的内部 operation Asset：metadata 记录 confirmationId/versionAssetId 和状态，`data.content` 保存冻结 payload，再写目标版本 Asset。刷新恢复时读取 pending intent 和 canonical 目标记录：相同 ID/相同 payload 视为已提交；不存在才同 ID/同 payload 重试；同 ID 不同 payload 报冲突。操作记录需从普通素材列表、搜索、计数和选择器过滤。不得只把幂等信息放在 React state。它是版本记录 ID，不是单调递增序号；无 CAS 时不能声称自动选出唯一当前版本。

## 移植与复用工具链：必须实际做并留下产物

1. Serena MCP + rg：对每个来源 route 建立 import、引用、CSS/icon、状态/store、网络调用、路由、模型/任务依赖闭包。输出文件清单和调用边界。
2. Repomix MCP：用 `pack_codebase` 的 includePatterns 精确打包来源页面/依赖闭包，再用 `grep_repomix_output` 查直接网络和服务调用；输出只放系统 Temp，不写回仓库或加入依赖。排除 .env、.serena 私有内容、node_modules、用户媒体/剧本。
3. 复核 `artifacts/dramaclaw-local-creative-suite/source-call-map.md` 与 `route-map.md`：前者列来源行号/参数、请求/响应/缓存副作用、本地行为或禁用点；后者确定项目作用域规范路径、旧路由 alias、`episodes/by-id/[episodeAssetId]` 稳定路径、来源序号转换、人物旧/新深链、`beatAssetId`/`focusBeatAssetId` 与旧数字参数的同项规范化/冲突处理及 project/episode 归属校验、`sub` allowlist、compose search allowlist、Freezone `?canvas` 消费和测试 ID。补全控件→目标文件→真实行为→测试→截图矩阵。逐项审查图片来源、`AssetBeatReferences` 本地稳定引用、Freezone mount prefetch、Canvas sync、素材库查询、upload/push、render plan/execute/部分重试、compose export 等调用闭包；不能拿“布局大致一样”替代控件验收。
4. Context7 MCP：需要框架或测试 API 时，先 resolve 再查 React/Next/TanStack 等官方文档；只将必要差异收敛到 route/container 与数据 adapter。
5. 逐文件检查 SPDX、版权、LICENSE/NOTICE、第三方图标/模型/字体和依赖。来源基线已核实为官方 `v2.0.5 / a09248410343158ba227ec40b5a4dbc1ba4b1444`；本地 `frontend/src` 全量 1,199 项中，1,198 个文本文件有 1,180 个换行归一化后与 tag 文本一致、18 个不同；1 个 GIF 二进制按原始 SHA-256 相同。Repomix 74 文件依赖闭包另有 35 个补充文件，33 个相同、2 个不同。逐条记录差异改动归属；不能将整个副本声称为纯 tag checkout，也不能猜为 `main`。manifest 另记逐项许可证据、source/target path、许可证、复用/适配/排除、修改记录和维护者状态。REUSE.toml 排除的 worker、wrangler、`.github/workflows`、`.env` 类文件不复制；public/fonts 许可未核实前不复制，Quaternius CC0 资产单独标注。保留来源声明，不宣称 Elastic-2.0 与 GNU AGPL-3.0 兼容。
6. 两个只读子代理独立审查：A 审 localStudio 数据契约、保存/版本/回主线恢复；B 审源组件依赖闭包、控件映射、页面保真和许可证风险。请求 gpt-6-luna reasoning=max（Luna 当前最高档）；记录实际可用设置。代理不得改文件、跑程序、测试或访问 DramaClaw。
7. Browser/CUA：真实打开来源和目标页面，保存并查看同类、可比较视口截图；实施后再做完整交互路径。浏览器 Network 面板逐条确认没有 DramaClaw host/API 请求。
8. GitNexus 当前无仓库索引，未建立前不能给出图分析结论；GitHub MCP 若当前工具列表不可用，明确报告并用官方网页证据降级。不能写成调用了不可用工具。

路由开工门禁：当前 `/xiaji/episodes`、`/xiaji/[project]`、`/xiaji/project/[project]` 都是重定向到 `/xiaji` 的占位页。按 `route-map.md` 处理 alias 和唯一规范路径；核对保留静态段、来源序号到稳定 ID、query 清理及 Canvas `[id]` 既有目录参数。该表须经修订后复核，实施前补路由回归用例；不得漏核查 `/xiaji/project/[project]`。

## Skills / Superpowers 门禁

- Superpowers brainstorming 与 before-you-build：固定问题、范围、风险、首期和成功标准。
- architecture-analysis、api-and-interface-design、architecture-patterns：核数据模型、状态与接口边界。
- architecture-critic：独立实现前架构审阅。
- frontend-design、web-component-design：按真实源页面核控件保真和视觉结构，确认哪些组件可以直接迁移、哪些只能适配。
- writing-plans：按依赖顺序实施。
- test-driven-development：逐个行为执行 RED → GREEN → REFACTOR，必须记录真实 RED 与 GREEN 结果。
- webapp-testing、e2e-testing-patterns、verification-before-completion：真实浏览器、截图、Network 与验收报告。

不得声称不存在的 React migration Skill 已调用；不要使用无关 biomedical skills 来判断软件许可。

## 实施顺序

用户确认后：

1. 保护工作区；重验源/目标页面和许可依据；完成控件矩阵与依赖闭包；双代理只读审阅。
2. 定义并测试 localStudio metadata codec、repository adapter 和旧 xiaTang metadata 兼容。
3. 定义并测试目标已配置的文本模型 adapter。
4. 依次移植虾料、虾塘、虾镜。
5. 移植虾面资产面板与交互，连接目标原生无限画布。
6. 实现用户确认的本地回主线版本写入。
7. 真实浏览器验证两条关键路径，截图并核 Network。
8. 分开报告单元、集成、E2E、smoke、TypeScript、浏览器/Network 结果和未实现的本地能力；检查 git diff/status，保护已有工作区，不提交。

每一项先有失败测试并观察 RED，再实现 GREEN，再 REFACTOR。不得因为任务庞大跳过某个模块或把完整页面替换成通用素材 CRUD。

## 最终交付

- 四个模块以及回主线的“来源 → 目标 → 本地行为 → 测试 → 截图”完整矩阵。
- 来源页面与 Infinite Canvas 的可比较截图，实际打开检查并标出差异。
- 本地数据/文件/Canvas 契约、错误和部分成功处理说明。
- Skills/MCP 的实际调用记录、用途、不可用项和证据等级。
- 分层测试与浏览器验收真实结果；不能把静态检索冒充 Network 检查。
- 许可证逐文件处理状态，以及当前本地能力无法覆盖的来源操作和原因。
- 保留现有工作区所有改动；不提交，除非用户另行要求。
