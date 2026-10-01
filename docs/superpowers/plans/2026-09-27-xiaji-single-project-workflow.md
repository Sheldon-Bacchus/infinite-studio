# 虾料、虾塘、虾镜与原生虾画实施计划

> 状态：**实施中。** 用户已于 2026-09-28 通过执行提示词；本计划正在按原定范围执行。全过程 TDD：行为断言 RED → 最小 GREEN → REFACTOR；不得用环境/导入错误冒充 RED。

**目标：**把虾料、虾塘、虾镜与原生虾画绑定到一个本地影视项目，移植真实页面，以 Agent 产物包和分阶段用户审阅完成保存及画布导入。

**架构：**本地项目根使用 Asset ID；当前单机后端以进程内互斥锁和数据库事务保证单实例项目—画布绑定唯一；页面不请求生成模型；MCP 暂存通过同标签会话交接给虾镜审核；Asset 保存前固定 IDs 与 commit envelope；原稿/分集结构投影与单集制作投影独立预览/导入，最终排版连线再次确认。跨多个后端进程的数据库级唯一性不在当前实现保证范围。

**规格：**[统一项目规格](../specs/2026-09-27-xiaji-single-project-workflow.md)　**架构：**[统一项目架构](../../architecture/2026-09-27-xiaji-single-project-workflow.md)

## 执行约束

- 保护开始时 `git status` 中已存在的 `.serena/`、`canvas-agent/.mcp.json` 和之后出现的用户改动；不 reset、不覆盖、不格式化无关文件、不清理、不提交。
- 仅虾料、虾塘、虾镜和原生虾画。无 DramaClaw host/API/DB/任务依赖，无 `DRAMACLAW_BASE_URL` / `DRAMACLAW_API_TOKEN`。
- 页面不能向配置模型发送原文，也不触发剧本、图片、音频、视频等生成。用户确认的 Agent 产物包可以导入。视频生成不做。
- 先真实对照飞书与 `integrations/dramaclaw/frontend`；读文件许可证/SPDX。无法读取飞书或截图时列出缺项，不能先用猜测重画。
- 不新建 Go 路由、数据库表或运行时依赖，除非 RED 测试证明现有本地 API 无法支撑已确认契约；此时停下提交差异和最小方案给用户，不自行扩 scope。
- 根目录 `bun test` 会扫描上游 `integrations/`，不作为本项目门禁。只跑目标子项目和目标测试文件；不安装依赖。
- Superpowers `brainstorming` / `before-you-build` 用于复核目标、首期与风险；`architecture-analysis`、`api-and-interface-design`、`architecture-patterns` 用于落实身份、状态、契约与恢复；`architecture-critic` 与 `gpt-6-sol / ultra` 本方案只读审阅已完成并已吸收，本计划不要求再次循环审稿；`frontend-design` 依真实控件矩阵核对页面；`test-driven-development` 按每个行为 RED → GREEN → REFACTOR。报告实际读取/调用路径，不把计划写成已调用。
- MCP 分层记录 `infinite-canvas-core` 静态工具、由 `infinite-studio-canvas` 当前 Canvas 页面动态公布的 Agent 工具、页面内本地导入控件。实施前验证运行时发现与参数。Serena 用于符号/调用点定位；Repomix 仅在需要整体上下文时用受限 includePatterns，未调用就明确未调用。

## 当前执行状态（2026-09-28）

| 计划段 | 状态 | 已有证据 / 剩余工作 |
|---|---|---|
| 起始基线与来源控件矩阵 | **静态映射更新；视觉验收阻塞** | 已保护并沿用工作区既有改动；本轮未重置、清理或提交。来源控件→目标代码、当前本地行为、测试覆盖与缺口已更新至矩阵；逐表单控件的截图对照因 Feishu 页面/CUA 不可读而未完成，不能宣称完整复用验收通过。 |
| 1. 原稿与创作页面 | **实现中** | 无分集保存、本地标题识别、脚本/Beat 版本追加和页面模型调用移除已有代码与测试。页面交互和真实 Network 尚未走查。 |
| 2. 提交恢复 | **已实现，浏览器待验** | 固定创建 envelope、canonical 回读、响应不确定时保留原提交并同 ID 重试；观察到保存响应丢失的 RED，后续定向测试通过。 |
| 3. 项目—画布绑定 | **已实现单机并发保证** | Go repository 在进程互斥锁及事务内检查用户范围重复绑定；竞争 RED 验证最多一个写入成功且失败方收到既有画布 ID。此保证不跨多个后端进程。 |
| 4. Agent 产物包与页面 handoff | **代码和单测已实现** | package 校验、同标签 session handoff、待审 UI、显式确认、JSON 回退及本地持久化代码完成；MCP live 发现、刷新/导航和断连行为仍待浏览器验收。 |
| 5. 来源页面复用补齐 | **未完成最终验收** | 当前页面已承载虾料/虾塘/虾镜流程，但来源页面所有选项/控件/样式的完整逐项迁移尚无新矩阵与同尺寸截图证明。 |
| 6. 项目与单集画布投影 | **代码和单测已实现** | 初始原稿/分集不依赖剧本/Beat；单集投影、显式关系布局分步确认、幂等/冲突保护均有单测；实际保存/刷新/整体排版仍待 E2E。 |
| 7. 完整验收 | **进行中** | `web/src/features/xiaji` 42 个测试文件 218 pass / 907 assertions、16 个 Canvas Agent 测试、Go repository/service/handler、Next production build 和标准 TypeScript 已通过。登录后 E2E、MCP 动态导入调用、Network、截图尚未完成。 |

本轮观察到的行为 RED 包括：无分集原稿不能保存、保存响应丢失后直接抛原错误、畸形 Agent package 未受控、sessionStorage 读取异常、配置模型可见 Xiaji 项目读写动作，以及脚本/Beat 修订未保留版本等。仅把测试加入并最终通过但本次未单独观察 RED 的断言，不冒称均逐条按 TDD 执行。

## 0. 起始基线与来源 UI 控件矩阵

**先读：**`git status --short`、相关 diff、路由表、工作区 `AGENTS.md`、当前规格/架构和实际调用链。记录既有改动，不触碰。

**证据：**飞书中虾料/虾塘/虾镜和剧本后续章节、实际页面截图；`integrations/dramaclaw/frontend` 对应页面/组件/样式/许可证；当前 Infinite Canvas 路由、Asset/Canvas store、MCP 动态注册和保存 API。记录来源版本时从实际 git 元数据核验；不能确定就写“未确认”。

**产物：**维护 `docs/superpowers/artifacts/dramaclaw-local-creative-suite/source-to-target-matrix.md`，按来源页面/控件映射目标代码、本地行为、测试覆盖和缺口；可访问来源页面时再补逐控件行号、同尺寸截图和视觉验收。此步骤只读，不实施 UI 改动。当前矩阵已更新为三模块 + 原生虾画范围，并明确未取得来源/目标可比较截图。

**门禁：**对不上来源真实页面或许可证范围不明的控件不得标“完成”。

## 1. 原稿可独立保存，页面生成调用移除

**预期文件：**

- `web/src/features/xiaji/local-studio-intake-model.ts` 与对应测试。
- `web/src/features/xiaji/local-studio-pages.tsx` 与对应页面行为测试。
- `web/src/features/xiaji/local-studio-repository.ts` 与 repository 测试。

**RED 行为：**

- 输入项目名+原稿，无分集、无模型配置也可启用保存；保存后根项目与原稿 canonical 回读成功、episodes 是空数组。
- 选“本地识别标题”只调用纯本地解析；用 spy 断言 `requestCanvasAgentTurn` / 模型 fetch 调用次数为 0，原文不会离开本机。
- 粘贴文本与选择文本文件使用同一解析规则；没有标题时解析结果为零集、展示“暂无分集，可直接保存”，不把原文伪造成一集。
- 页面不显示“配置文本模型/生成分集结构”作为保存前门槛。
- 有分集标题的原稿可本地预览并由用户确认；没有标题时仍可存原稿，后续从 Codex 导入结构。

单独运行并确认 RED 来自以上行为断言。再做最小实现，观察 GREEN，REFACTOR 后复跑。

虾镜脚本页也必须先测后改：点击/键盘操作不得触发 `requestCanvasAgentTurn` 或模型请求；保留源页面的布局层级和创作阶段位置，将“生成脚本 / 逐行生成 / AI 改写 / 模型设置”区域适配为 Agent 产物接收/导入、版本对照、逐项编辑审核及本地保存，并清楚说明模型由 Codex/Agent 执行。不能删空整块创作区。对照全站调用点确认没有同类残留，不只测虾料页。

## 2. 保存错误分类与 canonical 恢复

**预期文件：**`local-studio-repository.ts`、相关类型与 repository/UI 测试；`web/src/services/api/local-workspace.ts`、`web/src/services/api/request.ts`；必要时对应 Go service/handler。这里只扩展现有同步契约，不默认新增路由或表。

**RED 行为：**

- 用户确认保存之后、发出本地 Asset 请求之前，由调用方生成全部项目/原稿/分集 IDs、`commitId`，将 `metadata.localStudioCommit.commitId` 写入新建记录，再固定稳定时间戳、payload 和父子关系，保存同标签可恢复的精确尝试记录。Agent 包暂存/预览阶段不得提前落 Asset 或宣称保存。请求层可识别 timeout/abort。
- 验证现有 Asset 批次数据库事务：初始批次整体成功或失败；测试不得把“响应列表缺项”自动归类成部分提交。超时后独立 canonical probe；全匹配为已保存，读失败/原请求仍可能执行/状态矛盾为未知，不能报全失败或用新 IDs 建副本。
- 请求层错误、canonical payload/关系不一致、已提交后响应丢失分别有明确 phase/code 和预期 IDs；只有被 canonical 读取证实的多阶段画布导入才报告逐项 partial。
- 明确重试沿用同一 `commitId`、IDs、时间戳及完全相同 payload；同一请求仍可能在服务端执行时不得盲目开新尝试。若现有 API 无法安全处理同 ID 并发重放，先停下提出最小幂等契约。
- 成功只在 root、source、episodes、关系和版本字段逐项一致后显示。

先核对 `SaveLocalWorkspaceAssets` 的数据库事务与客户端返回语义：事务保证批次原子性，不代表客户端知道提交结果。实现失败分支时，catch 调用 canonical list 并按固定 IDs/commitId 分类；只有全量 ID、payload 和关系一致才 success。若要修改 Go，先写 repository/service/handler RED；任何新增路由或表先暂停并向用户提交最小契约差异。

## 3. 项目 ID 与原生 Canvas 唯一绑定

**预期文件：**`web/src/app/(user)/canvas/stores/use-canvas-store.ts`、项目路由/页面、canvas sync payload/helper 与测试。

**RED 行为：**

- CanvasProject 可保存并刷新恢复 `xiajiProjectAssetId` 与 `unbound/pending/bound/conflict` 绑定状态。
- 并发 RED：两个标签/请求同时尝试把不同 CanvasProject 绑定到同一 `projectAssetId`；最多一个绑定成功，失败响应返回现有 CanvasProject ID，随后读取都解析到同一画布。
- 项目页能找到其唯一画布；新建/关联重试不生成第二个；重复关联、删除项目/画布、旧未绑定项目都有可恢复明确状态。
- 不按标题匹配；MCP 目标 canvas 的关联项目不符时拒绝读取/写入。
- 每个绕过项目列表的入口（项目卡片、详情页、虾塘发送到虾画、画布内虾塘素材选择器及直达 URL）均先调用同一个 canonical binding resolver；不能先创建空画布或先写节点再补绑定。
- 若现有 CAS 无法原子保证唯一绑定，停止，不得把客户端扫描当硬唯一；提交最小服务端原子契约及路由/存储差异，待用户审阅后再做该部分。CAS 按单个 canvas ID 工作不能通过该 RED。

先检查当前 canonical 保存机制能否对同一用户全部有效 CanvasProject 原子执行“检查项目绑定唯一 + 创建/关联”；JSON 字段可持久化不等于它能保证并发唯一。服务端可在现有事务/锁契约内解决时，不额外加路由/表；若不能，先停止并给出最小原子绑定接口/存储约束草案，等用户确认才实施，不降低产品不变量。

## 4. Agent 产物包与 infinite-studio-canvas 页面桥

**预期文件：**

- 新建 `web/src/features/xiaji/xiaji-artifact-package.ts` 及单测：schema、digest、项目/分集归属、sourceKey/关系闭包、版本比较、Asset ID 映射和稳定错误。
- 扩展 `web/src/app/(user)/canvas/agent/canvas-agent-tools.ts`、工具代理测试和 Canvas 页面 dispatch/审阅区：读取项目上下文、暂存 package、显示字段差异，不在暂存时落盘。
- 如 dynamic 工具不能被实际 `infinite-studio-canvas` 客户端发现，再修改 `canvas-agent/static-tools.json` / `mcp-session.mjs`；须先有对应失败测试，不重复造第二条桥。

旧静态工具 `import_local_assets` 已从 MCP schema、页面 action/dispatcher 和镜头专用辅助逻辑移除。后续通用素材导入须围绕 `import_assets_to_canvas` 的实际 MCP schema、素材类型及保存回读重新验收；新增项目结构/Agent 包能力仍须走独立动态 contract。

**当前状态：核心代码已实现，运行时验收未完成。**`xiaji-artifact-package.ts` 定义 package schema/digest/归属校验、同标签 handoff 与可审阅摘要；Canvas page 注册 stage action；虾镜项目页展示待审包并在确认时重读项目/画布状态，再调用本地 repository 原子提交。sessionStorage 无法使用时提供 JSON 导入，畸形包/错误关系/同 packageId 不同 digest 被拒。相关 package、repository、MCP schema 测试通过。仍需真实验证 Canvas 页暂存后导航/刷新可恢复、MCP 断开后继续审核、目标/版本变更阻止确认及网络保存回读。

版本 RED：新版本进入 pending 状态时旧 `currentScript/currentBreakdown/currentBeat` 指针不变；用户批准后指针一次性指向新版本；重复批准同一包不产生第二版本/指针变化；被拒绝或过期包不得移动指针。若当前 Asset metadata 无法表达唯一当前版本，只提出最小字段关系并按批准范围实现。

**用户确认：**“确认保存到项目”页面操作落本地 Asset；只在 canonical 回读后更新阶段状态。保存的每个阶段再次刷新仍在。MCP 目录不得显示当前不存在的工具。

不要把源码/单测状态写成 live MCP 或端到端验收通过；只有实际浏览器走通后才能关闭本任务。

## 5. 虾塘与虾料/虾镜真实页面复用补齐

**顺序：**按 Task 0 控件矩阵逐页移植和适配，不整体重写 DramaClaw、不把页面塞进侧栏简化面板。虾塘完整核对角色/身份、场景/变体、道具、声线；虾料对照原稿和结构表单；虾镜对照分集/剧本/镜头/合成相关页面。

每个新增/修复动作先写失败行为测试（增删改、筛选、媒体操作、版本/父子关系、空/错误/刷新），再实现。组件只有在原页面结构、控件和本地行为可对应时才标“移植完成”。按同视口保存来源与目标页截图逐项自评；功能映射表注明禁用功能和具体缺少的本地 API。保留逐文件版权/SPDX。

## 6. 两类原生画布投影与用户审阅

**预期文件：**`web/src/features/xiaji/episode-canvas-projection.ts` 及单测、`drama-import.ts`（如经矩阵确认可复用）、Canvas dynamic tool schemas/dispatch、Canvas client page 与 MCP proxy contract tests。

**RED 行为：**

- 项目结构预览可在 `scriptAssetId` 和 Beat 均缺失时导入原稿/项目/已确认分集。
- 单集预览只带入该项目/该分集已保存的 script、Beat、明确引用的虾塘 Asset 和现有媒体；跨项目引用、缺失记录、失效预览均阻止未确认写入。
- 用户确认列表后导入节点；每项返回 source ID → node ID、created/reused/skipped/failed 与 canonical 回读。
- 所有来源节点先保存并回读，布局/连线工具在第二次用户确认前不可执行。
- 按明确关系清单创建 `project → manuscript/episode → script → beat → XiaTang/media` 边；未映射关系列为缺口，不按名称推断。
- 节点 metadata 包含本地 `projectAssetId`、`sourceAssetId`、`sourceType`、来源版本摘要、`projectionId`，适用时含 `episodeAssetId/packageId`；DramaClaw/source IDs 仅为来源值，不能顶替本地 IDs。
- 无剧本/Beat 时可以导入已有 project/manuscript/episodes；仅创建实际存在且经批准的节点与明确关系边，不为“流程完整”虚构占位节点或连线。
- `projectionId` 固定该次 source ID → node ID 映射；`manifestDigest` 覆盖批准的节点、版本、坐标与边。相同二者幂等；manifest 或来源版本改变必须重审，不额外使用语义重复的 `idempotencyKey`。
- 幂等重试不重复建节点；内容新版本不覆盖旧版本；已有节点、边、手工移动内容不变。
- 保存失败/并发冲突逐项显示；任何无法确认的写入先回读，不自动删节点。

最终整体审阅包含节点清单、关系边清单、版本、缺项和画布截图。

## 7. 验收与验证分区

- **单测**：在 `web/` 工作目录只运行涉及文件，例如 `bun test src/features/xiaji/local-studio-repository.test.ts`（路径按实际新建测试文件替换）。
- **MCP 代理测试**：在 `canvas-agent/` 运行 `bun run test`；并针对新增工具/schema补充 `node --test` 的独立 contract/integration 用例。动态工具未在真实连接页面出现时标 `BLOCKED`，静态 schema 不算发现成功。
- **Go**：若已批准范围内确需改现有 Go service/repository/handler，运行被改包的明确 package，例如 `go test ./repository ./service`（如改 handler 再加 `./handler`）；禁止用 `go test ./...` 扫描整个模块。需要新增 API route 或数据库表就暂停并提交差异，不以“接口已授权”为由越界。
- **TypeScript**：在 `web/` 运行 `bunx next typegen`，随后 `bunx tsc --noEmit`。`.next/dev/types` 残留错误需先确认没有服务占用，再按仓库规则只处理该生成目录，并分别报告。
- **E2E/Smoke**：真实浏览器逐条走“无模型保存原稿 → MCP 暂存 Agent 包 → 用户确认保存 → 刷新 → 打开唯一绑定虾画 → 导入项目结构（无 script/Beat）→ 导入单集制作内容 → 刷新 → 最后排版连线 → 整体检查”。使用专用 `E2E-临时` 数据并按既有授权清理；先确认临时数据不会混入用户项目。
- **Network**：检查请求没有 DramaClaw host/API、没有页面生成模型请求。若工具读不到浏览器 Network，明确 `BLOCKED`，不以静态检索替代。
- **截图**：至少虾料、虾塘四资产、虾镜制作、MCP 待审、原生画布项目结构和单集视图做来源/目标对照；截图仅在真实浏览器获得。
- 不运行仓库根目录裸 `bun test`；此前混扫 integrations 的 557 failures/334 errors 与当前改动无直接判定关系。本轮执行只运行分区测试并如实记录。

## 8. 最终交付

更新来源控件矩阵、实施进度、待验证记录和功能说明；提交前不提交代码。逐项报告 `PASS/FAIL/BLOCKED/NOT RUN`：单测、集成、MCP、E2E、smoke、TypeScript、浏览器、Network、截图。未观察到 RED 的任务标为 TDD 偏差，不写“遵循 TDD 完成”。列出未能复用的来源控件、其原因与真实本地能力缺口。

## 9. 本轮执行与验证记录

- 2026-09-28：虾料入口曾用一个永远禁用的“保存后导入 Agent 产物”按钮表达下一步，且保存按钮没有说明会跳到虾镜。先增加动作标签/下一步提示断言，目标测试实际 RED 为 2 fail / 2 pass；实现后 4 pass。按钮现明确为“保存项目并进入虾镜”，预览区改成静态说明，避免不可操作控件造成误导。
- 2026-09-28：`web/src/features/xiaji` 定向全范围回归：**42 files / 218 pass / 0 fail / 907 assertions**；`bunx tsc --noEmit` 通过；`git diff --check` 通过（仅 LF/CRLF 提示）。
- 2026-09-28：最新 Next production build 通过，Turbopack 编译 23.7 秒并生成 24 个静态页面；构建配置跳过内置类型校验，另行运行的标准 TSC 通过。构建预渲染仍有一条因本地 API 不可用的非致命日志。
- 2026-09-28：重启 `127.0.0.1:43861` 前端后，`/xiaji/ingest`、`/xiaji/projects`、后端 `/api/health` 均 HTTP 200。浏览器 CUA 仍不可发现。只读 MCP `list_connected_canvases` 为 0 connections / 0 page tools / 0 dynamic tools；未选择目标画布、未调用任何写工具。
- 2026-09-28：较早的窄范围 `web/` 12 文件检查为 **116 pass / 0 fail / 374 assertions**，已由本轮 `web/src/features/xiaji` 42 文件回归 **218 pass / 0 fail / 907 assertions** 覆盖更新。
- 2026-09-28：`canvas-agent/` 执行 `bun test`：**16 pass / 0 fail**。
- 2026-09-28：`go test ./repository ./service ./handler`：**通过**。
- 2026-09-28：较早 Next 16.2.9 production build 编译 28.7 秒；最新 build **通过**，Turbopack 编译 23.7 秒、生成 24 个静态页面；两次构建预渲染均出现本地 Canvas API 不可用的非致命日志。当前前端使用 `next start` 可正常响应，但 Next 提醒它与 `output: standalone` 不匹配；直接运行 standalone bundle 在此 Windows 环境因打包目录 React 符号链接 `EPERM` 失败，已恢复能响应的方式。
- 2026-09-28：`.next/dev/types/validator.ts` 是 Git 忽略的 2026-09-25 陈旧生成文件，引用已删除的 `freezone/page.js`；确认没有 Next 服务占用后只删除该文件，`bunx next typegen` 与标准 `bunx tsc --noEmit` 均通过。
- 2026-09-28：HTTP 探测 `/xiaji/projects`、`/xiaji/ingest`、`/api/local/canvas/projects`、`/api/health` 均返回 200。CUA 浏览器服务枚举失败（`nodeRepl.fetch request failed`）；此前页面进入登录界面。真实登录后交互、MCP live 工具发现、Network 面板和截图均未验收。
- 本地服务在本记录时仍运行：前端 `127.0.0.1:43861`、API `127.0.0.1:8081`、Canvas Agent `127.0.0.1:3210`。生产 build 在前端停机期间执行，随后已恢复。
- 仓库根目录裸 `bun test` 和 `go test ./...` 本轮均未运行。
