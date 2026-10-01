# 虾镜 Beat 上下文导入原生虾画实施计划

> **历史计划，已被新方案取代。**当前实施顺序见[统一项目 TDD 实施计划](2026-09-27-xiaji-single-project-workflow.md)。不要照本计划继续扩展单集导入。

> **For agentic workers:** 实施前先确认本计划与规格已获用户确认。按 Superpowers `subagent-driven-development` 或 `executing-plans` 逐项执行；每个行为均先 RED → GREEN → REFACTOR。此计划不授权视频生成。

**Goal:** 把虾镜已保存的单集剧本、Beat 和其实际引用的虾塘素材，经用户逐阶段确认后导入 Infinite Canvas 原生虾画，并在再次确认后排版连线。

**Architecture:** `community_canvas` 继续作为 `canvas-agent` 到选中浏览器页面工具的代理。虾镜读取从同一 Infinite Canvas 页面可访问的 canonical 本地 Asset store 完成；页面注册三个动态语义工具：只读预览、按用户批准 ID 导入、整理本次投影。导入返回可持久追踪的 `projectionId`，用 source digest 和稳定 projection key 区分内容版本。画布编辑和投影保存经现有本地保存路由提交变更集及 `expectedProjects`；服务端在事务内比对旧快照并条件更新，过期时拒绝，成功后返回 canonical 项目列表。客户端串行提交并在冲突后显示错误、停止自动重试。不新增路由、数据库或 DramaClaw 服务调用。

**Tech Stack:** TypeScript、Next.js 客户端页面工具、现有 Canvas/Asset store、Bun/Vitest（沿用仓库现有测试）。不增加依赖。

**Spec:** [虾镜 Beat 上下文导入规格](../specs/2026-09-25-xiaji-beat-context-canvas-import.md)

## 全局约束

- 仅虾料、虾塘、虾镜与 Infinite Canvas 原生虾画；不加入虾面、虾导、虾格、虾体或回主线。
- 不运行、部署或连接 DramaClaw；不读取其 host、API、数据库、项目或任务服务。
- 不新增 Go/API 路由、后端数据库、外部运行时依赖或媒体生成任务。
- 视频生成完全不属于计划；不得触发 `generate_video`，也不得触发图像或音频生成。
- 导入只读本地 canonical Asset；只写入当前明确选择的 Infinite Canvas 原生画布。
- 不覆盖或清理已有工作区改动；每个写入只追加/复用本次投影项，保留用户节点和连线。
- 预览、导入、布局/连线为三个独立阶段；前阶段没有用户审阅确认不得执行后阶段。
- 不安装依赖，不提交，除非用户之后另行要求。

## Review Focus

- 项目/分集/Beat 伪造或跨项目引用：在进入任何 Canvas 写入前拒绝。
- 重复或无效 Beat 顺序：预览明确阻断，不能以排序猜测修正。
- episode 未回读到 script 关联：先修复 `scriptAssetId` 持久化并通过独立刷新回读；修复前完整整集导入验收阻断，不以跳过剧本继续算完成。
- 本地引用媒体不存在、不可读或 file-only：逐项跳过并保留原因，不能报整集全成功。
- MCP 目标画布不明确、页面断开或工具 schema 过期：拒绝调用/写入，不回退到其他画布。
- 预览后源内容改变：旧摘要不可写，需重新预览确认；按模式明确必需闭包和可排除项。
- Canvas 并发编辑、保存失败：最新状态读取本身不足以防覆盖；所有写入者须共用串行入口或经验证的 CAS。不能保证时标记 `BLOCKED`；回读确认部分结果，不能声称原子回滚。
- 内容变化不得按来源 Asset ID 单独去重；用 projectionId/projectionKey 和摘要选择复用或创建新投影，保护旧投影与手工内容。

## 文件职责

- Modify `web/src/features/xiaji/local-studio-repository.ts` 与相应测试：修复 episode → script Asset ID 的保存关联，并验证重建 repository/刷新后能回读相同关系和剧本文本；这是完整导入的前置任务。
- Create `web/src/features/xiaji/episode-canvas-projection.ts`：先提供可导入的最小公开类型/函数接口，再实现本地项目/分集包解析、资格校验、闭包、sourceDigest、projectionId/projectionKey 与节点/边投影计划。
- Create `web/src/features/xiaji/episode-canvas-projection.test.ts`：投影模型、排序、引用闭合、幂等与错误结果的单元测试。
- Modify `web/src/app/(user)/canvas/agent/canvas-agent-tools.ts`：登记三个动态虾镜语义工具与严格 JSON schema，并接入工具 dispatch。
- Modify `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`：用已加载的 canonical Asset 与当前 Canvas project 执行预览、导入、排版/连线；调用现有保存/回读路径。
- Reuse `web/src/features/xiaji/send-to-canvas.ts`：复用 Asset 节点类型、来源 metadata 和媒体字段映射；保留 file-only 跳过规则，但绕过按 source Asset ID 的通用去重来处理版本化投影。分别记录引用存在、已验证可读和读取失败。
- Inspect `canvas-agent/mcp-session.mjs`、`canvas-agent/index.mjs` 与相关 `canvas-agent/*.test.mjs`：确认动态 schema 转发、选中连接锁定和错误向 MCP 返回；只在测试证明代理契约不足时修改。
- Do not modify `canvas-agent/static-tools.json` for page-state-dependent operations unless the MCP integration test proves dynamic schema cannot expose them. Do not add backend files/routes.

## 验证命令

- 从 `web/` 运行新增/相关前端单测：`bun test src/features/xiaji/episode-canvas-projection.test.ts`；涉及页面工具时追加其实际测试文件路径。
- 从 `canvas-agent/` 运行代理单测与集成测试：`node --test mcp-session.test.mjs mcp-runtime.integration.test.mjs`。
- 如变更触及 Canvas 页面或 workspace 持久化，按规格另做真实浏览器 E2E；不能用上述命令代替。
- 初始计划编写时未运行这些命令。当前实际验证结果与未完成项记录在 `.superpowers/sdd/2026-09-25-xiaji-beat-context-canvas-import/progress.md`；本节不将单测等同于浏览器验收。

## 实施任务

### Task 0: 修复剧本关联保存与刷新回读（完整导入前置）

**Files:** `web/src/features/xiaji/local-studio-repository.ts`、其现有测试文件；必要时对应虾镜编辑页面保存调用点。

- [x] 为保存脚本后 episode 是否持久引用 `scriptAssetId` 写失败行为测试；重建 repository/从 canonical Asset store 重新读取后必须找回同一剧本 ID 和正文。
- [x] 单独运行并确认 RED 来自“episode 关联回读缺失”的断言，而非模块导入或测试环境错误。
- [x] 最小修复保存流程，并检查返回记录与刷新回读记录都含同一 `scriptAssetId`。
- [x] 单独运行确认 GREEN，再 REFACTOR 并复跑；真实浏览器刷新回读留 Task 6。
- [x] Task 0 的 repository 单测通过；Task 6 的真实浏览器刷新回读仍是整集 `complete` 导入验收前置，完成前不能报告端到端通过。

### Task 1: 固定本地整集投影计划 — COMPLETE (unit)

**Files:** 上述 projection model 与测试文件。

- [x] 先创建可导入的最小公开接口和稳定测试夹具；此时不实现业务结果。
- [x] 写 `preview` 返回完整剧本与所有 Beat 的行为测试，断言按 `order` 排列并保留原始标题、正文、对白和引用 ID。
- [x] 单独运行并确认 RED 是缺少预期行为的断言失败；模块无法导入、语法错误或环境错误不算 RED。记录命令与失败断言。
- [x] 写归属/异常测试：错项目分集、脚本缺失/歧义、重复 Beat order、跨项目引用、缺失引用、file-only 媒体均返回稳定错误或跳过原因。
- [x] 写完整/局部闭包测试：完整模式要求剧本、全部 Beat、显式引用和选中媒体的可导入闭包；局部模式要求剧本和至少一个 Beat，排除项导致 `partial` 和明确缺边。
- [x] 单独运行上述行为测试，确认失败断言对应具体缺失规则，而非编译、导入或环境问题。
- [x] 实现纯解析与验证：通过当前 `LocalStudioRecord` / XiaTang 本地模型识别 canonical Asset，不从标题猜引用。
- [x] 实现稳定摘要：只对实际投影字段规范化序列化并计算摘要；不把摘要称为素材版本历史。
- [x] 重跑本任务测试确认 GREEN；清理重复逻辑后再跑同一组确认 REFACTOR 未改变行为。

### Task 2: 实现零写入预览 MCP 工具 — COMPLETE (unit/code path)

**Files:** `canvas-agent-tools.ts` 及对应测试位置；客户端 dispatch 位于 `canvas-client-page.tsx`。

- [x] 先为 `preview_xiaji_episode_context` 写 schema/dispatch 测试：必填 project/episode IDs、拒绝额外属性、只读调用返回逐项清单。
- [x] 独立运行并观察 schema/dispatch 行为断言 RED；不得用缺模块导入或测试环境故障充当 RED。
- [x] 定义工具成功响应：`sourceDigest`、剧本、完整有序 Beats、引用映射、unsupported/missing/duplicate/blocking items 和预期节点/边清单；响应不包含媒体 URL、存储路径或密钥。
- [x] 在页面 handler 中从本地 Asset store 获取快照，调用 Task 1 纯解析函数，不改 React state、不调用 Canvas save。
- [x] 重跑预览测试确认 GREEN，并添加断言证明 Asset 集合和 Canvas nodes/connections 在调用前后相同。
- [x] REFACTOR schema/结果编码，复跑本任务测试。

### Task 3: 实现经批准的节点导入 — IMPLEMENTED (unit/code); browser pending

**Files:** projection model、`send-to-canvas.ts`（必要时）、`canvas-agent-tools.ts`、`canvas-client-page.tsx` 及其测试。

- [x] 写导入 planner 行为测试：complete/selected 闭包、批准来源 ID、来源摘要、文本/媒体映射和投影 metadata。
- [x] 覆盖 stale digest、来源变化、file-only/不可读媒体、幂等、通用节点冲突与部分失败原因。
- [x] 独立运行并记录 RED 为 planner 缺失预期行为，模块和测试正常加载。
- [x] 实现剧本/Beat 全文和本地 text/image/video/audio 映射；file-only 逐项跳过。
- [x] 写入稳定 projectionId/projectionKey/摘要/闭包 metadata；页面 handler 在导入确认后保存，并逐项 canonical 回读。
- [x] 现有 `/api/local/canvas/projects/sync` 与单项目保存路由要求调用方提交完整旧快照；后端以事务和 `project_data`、`created_at`、`updated_at` 条件更新拒绝过期写入。缺基线、重复 ID、删除 tombstone 和保存竞态均不会按普通保存覆盖。
- [x] Canvas 软删除 API 要求按 ID 提供完整 `expectedProjects`；服务端事务核对 canonical 快照并条件写 `deleted_at`，拒绝旧标签页删除；前端成功后回读列表，冲突时展示并保留页面状态。
- [x] 客户端只提交相对 canonical 快照有变化的项目，并串行执行保存；收到并发冲突时保留当前页候选、显示画布错误并停止自动重试。
- [x] HTTP 回归测试先观察到旧实现允许第二个旧快照写入，再验证冲突拒绝，并确认同一批次前序新画布随事务回滚。
- [x] 并发边界和部分失败恢复已明确记录；未证明安全的并发场景不得报告通过，不自动删除或声称回滚。

### Task 4: 实现显式排版和关系连线 — IMPLEMENTED (unit/code path); browser pending

**Files:** projection model 与测试、`canvas-agent-tools.ts`、`canvas-client-page.tsx`。

- [x] 排版行为测试覆盖刷新重建、确定布局、Beat 顺序与显式引用边、重复运行幂等、非投影内容保持、锚点/成员冲突。
- [x] 有效 RED/GREEN 记录覆盖被省略 Beat 顺序摘要篡改及已加入其他组的节点。
- [x] 注册 `arrange_xiaji_episode_canvas`，要求 manifestDigest 和完整批准 node ID 清单与保存内容一致。
- [x] planner/handler 仅整理本投影节点并建立其关系边；canonical 回读节点和边，异常不自动删除或回滚。
- [x] projection 单测覆盖用户其他节点/连接保持和重复调用稳定；全量浏览器保存验证留 Task 6。
- [x] 正常 Canvas 编辑和投影保存共享现有条件写路径；服务端冲突测试通过。
- [ ] 真实浏览器保存、软删除、刷新和并发提示验收留 Task 6。软删除现在使用独立的 expected snapshot 条件写；压缩包导入仍不属于本 CAS 保证。

### Task 5: 验证 community_canvas 代理边界 — COMPLETE (15 tests)

**Files:** 首先检查 `canvas-agent/mcp-session.test.mjs`、`canvas-agent/mcp-runtime.integration.test.mjs` 与当前 app dynamic tool tests；仅按失败用例修改必要文件。

- [x] 写或扩展代理测试，确认页面动态工具 schema 被发现、调用转发到锁定 `clientId`、返回逐项 JSON 结果。
- [x] 覆盖重复画布标签需要明确 clientId、目标断开、schema 过期和 handler 错误；断言不会改投其他画布。
- [x] 先运行现有 MCP 代理契约测试作为基线：若动态工具发现/转发已经满足要求，记录基线 PASS 并不改代理代码；只有明确缺失行为时才新增该行为断言并观察有效 RED，再做最小适配和 GREEN。
- [x] 静态检索新增调用路径，确认没有 DramaClaw host/API/环境变量、没有 `generate_video`/其他生成工具调用、没有新 Go route。
- [x] 若现有代理无需改动，在计划执行记录中写明“代理契约测试证明无需改动”，不要为形式改造 `mcp-session.mjs`。

### Task 6: 类型检查、环境恢复与真实浏览器 E2E

当前状态：**代码 Task 0–5 已通过既有自动化审查；正式构建和服务健康通过。标准 TypeScript 检查与真实浏览器交互仍 BLOCKED；不重复规格/架构审阅。**

#### 6.1 修复标准 TypeScript 检查输入

**已知事实：** 标准 `tsc` 失败于 `.next/dev/types/validator.ts` 对已删除 `freezone/page.js` 的旧引用；`tsconfig.json` 同时包含 `.next/types` 与 `.next/dev/types`；Next `typescript.ignoreBuildErrors` 为 `true`，因此既往生产 build 不验证类型。源码单独检查的 327 个文件为 0 diagnostics，但这不代表标准路由类型检查通过。

- [x] 在清理任何生成文件前确认 Next 开发服务已停止；检查 3000 端口所属进程，不按端口号盲目终止进程。
- [ ] 只清理 `web/.next/dev/types` 旧生成目录，不删除整个 `.next` 或源码。
- [ ] 从 `web/` 使用已安装的本地 CLI，避免 `bunx` 解析到非仓库版本：
  - `node node_modules/next/dist/bin/next typegen`
  - `node node_modules/typescript/bin/tsc --noEmit --pretty false`
- [ ] 若重生成后仍失败，按实际诊断区分陈旧生成文件与真实源码类型错误；记录首个稳定错误并修复后重跑标准命令。只有 0 diagnostics 才标记 TypeScript `PASS`。

#### 6.2 恢复服务与浏览器控制

**已知事实：** 正式启动脚本已成功构建并启动 API/Web/Agent；3000、8081、3210 的监听进程均属于本项目。API 健康、Canvas 项目读取和 `/xiaji/projects` HTTP 均返回 200。CUA 最近仍返回 `apps: []`、`browsers: []` 和 `nodeRepl.fetch request failed`；Agent 当前连接列表为空，因此页面动态工具尚未注册到活动浏览器。生产脚本会检查构建产物，可能触发构建、启动 API/Web/Agent，并可能替换本项目陈旧前端；不可假定脚本只做单一启动动作。

- [x] 启动前检查 3000、8081、3210 的监听进程身份及健康状态；启动前没有监听进程，未停止其他进程。
- [x] 从仓库根目录运行正式生产启动脚本；Go 与生产前端构建成功，Next 编译约 20.5 秒并生成 24 个页面，然后启动本项目 API/Web/Agent。构建跳过 TS 校验；静态生成阶段曾在 API 启动前打印一次本地保存连接错误。
- [x] 服务健康后检查 `/api/health`、`/api/local/canvas/projects` 与 `/xiaji/projects`，均 HTTP 200；项目读取为只读，没有创建或更改用户数据。
- [ ] CUA 浏览器发现仍返回空列表和 `nodeRepl.fetch request failed`；`community_canvas.list_connected_canvases` 返回零连接、零动态工具。浏览器 UI 验收因此仍 `BLOCKED`，Network 和截图未验证。

#### 6.3 真实浏览器验收

- [ ] 使用用户已授权的唯一 `E2E-临时-<runId>` 本地项目夹具；记录本轮创建的精准 Asset IDs，清理只按这些 ID 和引用闭包执行。
- [ ] 在真实 MCP 工具列表确认目标画布页面连接并只出现预期动态工具；记录当前 `clientId` 和 Canvas ID。
- [ ] 只调用预览工具，向用户展示剧本、逐 Beat、素材关系、complete/selected 闭包、媒体可读性、缺失/重复项和 sourceDigest；写工具前等待用户明确确认。
- [ ] 用户确认后导入，核对 projectionId、node mapping 与 canonical 保存回读；刷新后重建并验证投影，不自动调用排版工具。
- [ ] 再次展示导入画布并等用户确认，再调用排版/连线；检查节点位置、顺序边、Beat→素材边、重复调用幂等和既有画布内容保留。
- [ ] 刷新后核对 nodes/connections；两个标签页验证保存/软删除旧快照冲突提示及 canonical 内容；检查浏览器 Network 无 DramaClaw host/API 请求并保存可比较截图。若 Network 面板不可读，准确标记 `BLOCKED`，不以静态检索替代。
- [ ] 分别报告 unit、integration、MCP proxy、E2E、smoke、TypeScript、build、Network；本任务不生成视频或媒体。
- [ ] 只清理本轮获批创建的临时 Asset；不得删除无关用户内容。

#### 6.4 现有工作区 diff 保护

- [ ] 审阅 `canvas-client-page.tsx` 时并列检查普通 diff 与 `git diff --ignore-all-space`；后者只帮助查看格式噪声，不能被当成功能行数或格式化前快照。
- [ ] 当前普通 diff 为 `+1193/-591`，忽略空白为 `+863/-261`。原格式化前工作区没有快照，`HEAD` 也不是该快照；不整文件 checkout/reset、不反向格式化、不对整文件再次运行 formatter。
- [ ] 先完成功能和真实浏览器验收。若仍需减小页面改动范围，另行按已确认的语义改动逐块拆分，并在每块后运行对应测试；无法证明等价时保留现状。

## 结束标准

规格 §8 每项都有可复核证据；标准 TypeScript 命令在当前生成路由类型上通过；生产服务健康且浏览器控制可用；Task 0 剧本刷新回读通过；source preview、用户确认导入、用户确认排版三个阶段真实跑通；projectionId 可刷新重建；保存/软删除并发边界经真实浏览器验证；Network 与截图证据留存。Task 0 未通过时完整导入验收为 `BLOCKED`；服务启动或 CUA 任一不可用时 E2E/Network/smoke/截图分别标为 `BLOCKED`；真实浏览器验收未通过时不得标记整体完成。规格与计划已获用户批准，不再重复设计审阅；剩余执行结束后不提交，等待用户检查。

## 执行记录（2026-09-26）

- RED：新增 handler HTTP 测试后，在旧服务端实现上复现两个客户端基于同一快照时后写覆盖前写；随后实现 expected snapshot 条件写并观察 GREEN。
- RED：新增过期删除 HTTP 回归后，在旧 ID-only 删除实现上复现旧标签页成功删除新版本；随后新增删除 expected snapshot 条件写，并由全量 Go 测试确认旧快照删除被拒绝。
- Go：`go test ./... -count=1` 全部包通过。
- Web：`bun test` 57 files / 266 pass / 0 fail / 998 assertions。
- MCP 代理：`node --test mcp-session.test.mjs mcp-runtime.integration.test.mjs` 15 pass / 0 fail。
- TypeScript：排除遗留 `.next` 生成目录后，327 个源码文件 0 diagnostics。标准 `bunx tsc --noEmit --pretty false` 仍被 `.next/dev/types/validator.ts` 指向已不存在 `freezone/page.js` 的旧声明阻断。
- Build：`bun run build` 成功，Turbopack compile 52s 并生成 24 个静态页面；Next 配置跳过构建期类型验证。静态页面生成时因未运行本地 API 打印连接失败日志，构建退出码仍为 0。
- Browser/E2E/Network/screenshot：未执行，见 Task 6 环境阻塞。
- 独立审阅：子代理 `gpt-6-sol ultra`（Carver）只读检查类型缓存修复顺序、启动/E2E 双重环境门禁和画布页 diff 风险；建议停止 Next 后只清理 `.next/dev/types`，使用仓库本地 Next/TypeScript CLI；不得整文件回退。审阅未运行构建/测试，未修改文件。该审阅使用本轮 `multi_agent_v1` 子代理工具；没有调用 `community_canvas`，没有加载或声称调用 Skills。Next 类型生成行为另对照了[官方 TypeScript 文档](https://nextjs.org/docs/app/api-reference/config/typescript)和[CLI 文档](https://nextjs.org/docs/app/api-reference/cli/next)。

## 后续执行结果（2026-09-26）

- 全量 `bun test` 重跑：57 files / 266 pass / 0 fail / 998 assertions；输出有一条异步本地画布保存连接错误日志，单独运行项目设置视图测试未复现该日志。
- `go test ./... -count=1` 全包通过；`community_canvas` MCP 代理 15/15；投影/仓库焦点测试 33/33，Canvas 动态工具测试 9/9。
- 正式启动脚本完成 Go 和生产前端构建；Next 编译约 20.5 秒、生成 24 页，并跳过 TS 校验。启动后 API 健康、Canvas 列表只读查询和 `/xiaji/projects` 均 HTTP 200；未写入本地用户数据。服务仍运行于 3000、8081、3210。
- 标准本地 TypeScript CLI 仍只报 `.next/dev/types/validator.ts` 引用已删除 `freezone/page.js`。按计划清理该生成目录时被执行审核拦截，未改用其他删除方式；`next typegen` 尚未运行。
- CUA 重试仍无浏览器；`community_canvas.list_connected_canvases` 返回零连接、零动态工具。浏览器 E2E、刷新、双标签交互、Network、截图及真实 UI smoke 仍未运行。

## 代码审阅与修复（2026-09-26）

- 独立审阅：`gpt-6-sol ultra`（Galileo）只读审阅后标出登录回跳、跨项目坏 Beat 污染预览、跨分集复用幂等键三项 P1；同时指出认证查询遇到任意请求错误都会清除 token。审阅者没有逐行完成 Task 3–5，不能把其结论表述成全部代码已审完。
- 修复：登录回跳保留普通用户的 `/xiaji` 等用户区目标，仍限制 `/admin/*`；本地认证 store 仅在明确 401/403 或服务返回 guest 时清除 token，网络/服务器错误保留现有会话；坏 Beat 校验限制在当前项目和分集；幂等键冲突检查覆盖同画布的所有虾镜投影，同时把来源版本比较限制在同一项目/分集。
- TDD：新增测试先观察到 RED：无关分集的坏 Beat 错误阻断当前预览；同画布另一分集复用幂等键未冲突；登录回跳辅助模块和认证错误分类器尚不存在。修复后焦点测试 `bun test ...` 为 26 pass / 0 fail / 105 assertions。
- Task 3–5 补充代码阅读：助手面板在导入、排版前各显示清单并等待明确确认；Canvas store 使用 canonical 快照和 `expectedProjects` 保存，Go repository 在事务中比较时间戳及完整数据；MCP 代理锁定所选 `clientId`、读取页面实时工具表，并在失联或工具缺失时拒绝调用。此项是本轮主代理代码阅读，不是 6sol 独立审阅，也不替代双标签浏览器并发验收。MCP 页面写工具仍可由其他直接客户端绕过助手面板确认，这是规格已记录的边界，当前没有服务端审批票据。
- 自动化回归：`bun test web/src` 为 271 pass / 0 fail / 1008 assertions；`bun test canvas-agent` 为 25 pass / 0 fail / 26 assertions；`go test ./... -count=1` 全包通过。
- 测试范围记录：曾从仓库根目录运行裸 `bun test`，它发现 487 个文件、1320 项，其中 763 pass、557 fail、334 errors；工作区含 426 个 `integrations/` 上游测试文件，该宽泛结果未定位每个失败来源，不能替代上列当前应用范围测试，也不能标成通过。
- TypeScript：重跑标准 `bunx tsc --noEmit --pretty false`，唯一诊断仍是 `.next/dev/types/validator.ts` 引用已删除的 `xiaji/project/[project]/freezone/page.js`。构建本身跳过 TS 验证。
- Build/服务：包含全部修复的最终生产前端重新构建成功（Next 13.5 秒、24 个路由）；启动器的进程识别保护拒绝替换旧前端，随后核实 3000 端口所属进程来自本仓库并仅替换该 Node 进程。新前端监听 `127.0.0.1:3000`，API `127.0.0.1:8081`、Canvas Agent `127.0.0.1:3210` 保持运行；API `/api/health` 返回 200 `ok`。未执行浏览器页面 smoke 请求。
- 浏览器/MCP：CUA 拒绝读取 `http://localhost:3000/login?redirect=%2Fxiaji`，不得用其他方式绕过；`community_canvas.list_connected_canvases` 返回零连接和零动态工具。真实导入、刷新、双标签并发、Network、截图和 UI smoke 仍待浏览器工具恢复。
- 格式检查：`git diff --check` 通过（仅有工作区 LF/CRLF 提示）。Prettier 检查仍提示登录页与投影导入文件；未对整文件执行格式化，以免扩大既有工作区 diff。
