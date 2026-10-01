# 虾镜 Beat 上下文导入原生虾画规格

> **历史规格，已被新方案取代。**当前产品要求见[统一项目规格](2026-09-27-xiaji-single-project-workflow.md)；本文件不能单独作为实施范围或验收标准。

状态：**用户已批准；2026-09-26 代码审阅发现的四项缺陷已修复并增加回归测试。Web 271 项、Canvas Agent 25 项、Go 全包测试通过；生产前端已重建并恢复服务，API health 200。标准 `tsc` 仍被旧 `.next/dev/types` 对已删除 `freezone/page.js` 的引用阻断，构建配置跳过类型检查。浏览器工具拒绝读取本地页面，MCP 当前无画布连接；真实导入、刷新、Network 和截图验收未完成。**整体暂不能标记完成。配套架构：[架构决策](../../architecture/2026-09-25-xiaji-beat-context-canvas-import.md)。配套计划：[实施计划](../plans/2026-09-25-xiaji-beat-context-canvas-import.md)。

## 1. 目标

让用户把 Infinite Canvas 本地虾镜中已保存的单集剧本、全部确认的 Beat 和它们实际引用的虾塘资产，按阶段审阅后导入 Infinite Canvas 原生虾画；全部导入节点通过用户审阅后，再统一排版和连线，最后整体检查。

Agent/Codex 协助产生和整理创作内容；虾料、虾塘、虾镜呈现规范化阶段、输入、产物、检查点和后续动作。页面与连接器不替用户自动推进已确认的生产步骤。

## 2. 范围与排除

### 本规格包含

- 从 Infinite Canvas 本地 Asset store 读取虾镜项目、分集、剧本、Beat 与 Beat 引用的虾塘素材。
- 通过 `community_canvas MCP` 暴露只读预览、用户确认后的节点导入、第二次确认后的排版/连线三个语义操作。
- 复用原生节点、原生边、分组、布局和 Canvas 保存能力，保留来源 ID、Beat 顺序和内容摘要。
- 显示重复、缺失、跨项目、媒体不可用、预览过期、部分失败及 Canvas 保存失败。
- 支持本地 Asset 类型 text/image/audio/video 中已有且可读、可映射到原生节点的内容；不支持的 file-only 记录必须逐项列明。

### 明确不包含

- 视频、图像、音频生成；视频生成由用户在本功能之外手动处理。本连接器不调用任何生成任务。
- DramaClaw 运行时连接、host/API/数据库、项目查询、任务或源端写回；不新增服务端路由、数据库或依赖。
- 虾面、虾导、虾格、虾体、“回主线”、自由画布写回。
- 对没有明确关系数据的说话人、声线、场景变体、镜头时长、连续性与生成版本进行猜测。

## 3. 用户确认的交互流程

```text
虾镜单集剧本与 Beat 已保存
  → Codex 请求只读预览
  → 用户按脚本 / Beat / 参考素材逐项审阅映射、缺项和重复项
  → 用户确认要导入的来源项
  → MCP 将已确认项追加/复用为原生画布节点并保存
  → 用户逐阶段检查已导入节点
  → 用户确认统一排版与关系连线
  → MCP 仅整理本次投影，创建确定性连线并保存
  → 用户整体审阅画布
```

每个箭头都是显式操作。预览不会改变画布；导入不会同时自动排版连线；未确认的阶段不自动执行。视频生成不是上述任一阶段。

## 4. 数据契约

### 输入及资格校验

- 必须输入稳定 `projectAssetId` 与 `episodeAssetId`。
- 分集必须归属给指定项目；脚本和 Beat 必须同时匹配该项目与分集。
- Beat 按正整数 `order` 升序；重复或无效序号阻止整集预览进入导入确认。
- 每个 `referencedAssetId` 必须解析为当前本地素材，且验证项目归属。缺失、越权/跨项目和歧义引用不得按名称猜测。
- 本地剧本记录缺失、刷新回读未关联或存在多个候选时，预览返回明确 `script-missing` / `script-ambiguous` 项，不创建假剧本节点。

### 源字段与投影

| 来源记录 | 必须保留到 Canvas metadata | 节点内容 |
|---|---|---|
| 项目/分集 | projectAssetId、episodeAssetId、分集顺序/标题、sourceDigest | 标题/说明节点或投影分组元数据 |
| 剧本 Asset | script Asset ID、documentKind、project/episode IDs、sourceDigest | 保存的完整剧本文字 |
| Beat Asset | beat Asset ID、project/episode IDs、order、sourceBeatNumber、已有对白与所有有效的领域 metadata、sourceDigest | 保存的 Beat 标题和完整正文；不得仅复制摘要 |
| XiaTang 引用 Asset | source Asset ID、domain/recordType、parent/slot 关系、分类、标签及可用 XiaTang metadata | 复用现有本地素材到节点映射；同一素材仅导入一个来源节点并可连到多个 Beat |

`sourceDigest` 用稳定字段序列化计算，仅用于预览失效检测和幂等识别；不得伪装成已有的版本历史。没有显式保存的语义字段不能由连接器生成。

### 导入闭包与投影身份

- 预览分别返回必需剧本 ID、该集全部有效 Beat ID、Beat 显式引用的虾塘 ID，以及这些引用当前选中的可映射媒体 ID。`complete` 模式必须导入完整闭包；缺剧本、Beat 顺序无效、引用缺失/跨项目、当前媒体缺失或映射失败时阻断整集完成，不能静默漏项。
- `selected` 模式允许用户明确排除非必需 Beat、引用或媒体，但必须包含已保存剧本和至少一个 Beat。响应列出排除 ID 和因此缺失的关系，标记为 `partial`；不能把局部结果称为整集完成。被选 Beat 的跨项目或歧义引用仍然是阻断错误。
- 预览区分媒体“存在引用”“已验证可读”“不可读/未验证”。`fileOnly` 无原生节点映射，始终不可导入；引用非空不能证明文件可读取。读取或保存失败按 Asset ID 和阶段逐项返回。
- 每次获批导入生成 `projectionId`：由 Canvas ID、项目 ID、分集 ID、sourceDigest、模式和排序后的批准来源 ID 规范化计算。返回值写入剧本锚点及每个投影节点的 `metadata`，并在导入响应中返回。
- 单项 `projectionKey` 由 projectionId、节点角色和来源 Asset ID 组成；同一投影同一键且摘要相同才可复用。摘要变化必须生成新 projectionId/节点或按用户选择拒绝；绝不按来源 Asset ID 单独去重、覆盖旧投影或认领普通画布节点。具体规范化字段及刷新索引校验见[架构决策](../../architecture/2026-09-25-xiaji-beat-context-canvas-import.md)。
- 刷新后只从已保存 Canvas 节点重建投影索引，并逐项验证 projectionId、projectionKey、来源 ID、摘要和批准闭包。锚点或成员缺失、重复、被用户改动时，排版返回不完整/冲突，不按工具调用参数臆造成功。

### 写入/重试语义

- 导入前以预览摘要和当前 canonical 记录比对；有变化时返回 `stale-preview`，要求重新预览并重新确认来源集合。
- `sourceAssetIds` 必须符合所选模式的闭包规则；导入响应返回 `projectionId`、逐项 source ID → node ID 映射、`created/reused/skipped/failed`、排除项及 canonical 回读结果。
- 同一幂等键只绑定同一 Canvas 和相同参数；同键异参返回 `idempotency-conflict`。失败重试先回读，再按投影键补齐安全缺项。
- 虾镜投影使用 Canvas store 的普通保存路径。客户端串行保存，并仅提交相对其最后一次 canonical 回读有变化的画布及 `expectedProjects`（ID 到完整旧项目或 `null` 的映射）。现有 `/api/local/canvas/projects/sync` 和单项目保存路由要求基线；服务端在事务内核对 SQL 行的 `created_at`/`updated_at` 和规范化完整 `project_data`，随后用旧列值作为条件执行更新。基线缺失、已删除或已变化均拒绝；批次中任一项冲突时整个事务回滚。成功后返回 canonical 项目列表并作为下一次基线。
- 客户端收到并发冲突后保留当前页面中的候选更改、展示错误并暂停本页后续自动保存，避免反复覆盖；候选未落盘，刷新或关闭页面会丢失，用户应先复制/另存候选再刷新解决冲突。服务端 HTTP 回归测试覆盖同基线的两个写入者及批次回滚。真实浏览器两标签验收仍待完成。
- 此 CAS 覆盖 Canvas 编辑/投影的普通保存，以及显式软删除：删除请求必须携带每个项目的完整预期快照（不存在时为 `null`），服务端事务内核对基线并条件写入删除时间；旧快照、已删除项目或缺失基线均拒绝，批次冲突整体回滚。删除成功后客户端重新读取 canonical 列表。显式压缩包导入仍是独立操作，不属于本 CAS 保证，也不属于虾镜投影保存路径。
- 保存未能回读确认时只能报告 `failed` 或 `unconfirmed` 及已确认/未确认 ID；不得声称自动回滚。不能证明安全的内容不自动删除或重试，需人工处理。
- 排版只改动已验证且未被用户改动的本投影节点；只补两端都属于本投影的确定性关系边。其他节点/边坐标和内容不得改变。

## 5. MCP 接口草案

工具名称、参数和错误码以实现前 contract test 定型；本节是用户审阅的外部行为。

### `preview_xiaji_episode_context`

输入：`projectAssetId`、`episodeAssetId`。只读返回 `sourceDigest`、剧本、全部有序 Beat、解析后的素材关系、节点/边预览、重复项、缺失项、不支持项和阻断原因。不得返回本地媒体文件路径或秘密信息。

### `import_xiaji_episode_context`

输入：`projectAssetId`、`episodeAssetId`、`sourceDigest`、`mode=complete|selected`、`sourceAssetIds`、`changedSourcePolicy=create-new|reject`、`idempotencyKey`。只导入用户在上一步看到并批准且满足所选模式闭包规则的精确来源 ID。响应返回 `projectionId`、`complete|partial|unconfirmed`、逐项 source ID → node ID 映射、排除/跳过/失败原因及保存回读证据。此阶段不创建最终连线、不触发生成。来源摘要变化时不得沿用旧批准；默认拒绝，用户重新预览确认后可明确选择创建新投影。

### `arrange_xiaji_episode_canvas`

输入：`projectionId`、导入锚点保存的 64 位十六进制 `manifestDigest`、用户复核后批准的完整 `approvedNodeIds`、`idempotencyKey`。工具从已保存 Canvas 重建并验证投影索引后，仅对该投影创建稳定分组、确定性布局及脚本/Beat 顺序和 Beat→引用素材关系边；返回每个变更节点/边 ID、冲突/缺项及保存回读状态。`selected` 投影只整理已导入项，不能标记为完整整集布局。

工具必须是已选中 Canvas 页面提供的动态工具，执行时校验当前 `clientId`/`canvasId`。工具未注册、页面未连接、调用超时或 Canvas 未保存时返回真实错误。

## 6. 当前代码限制

- 当前 `community_canvas` 是页面工具代理；没有虾镜项目/分集/Beat 导入语义。
- 当前 `import_local_assets` 限定四个固定 `SHOT-*` 键、预先存在的镜头组和图片/音频；它不能作为整集导入实现。
- Canvas 现有本地映射已覆盖 text/image/video/audio Asset，但 file-only 记录会被跳过；重用其来源标记、重复判断和媒体引用处理。
- Beat 有 `referencedAssetIds`，但没有足够数据推断说话人/声线、时长或镜头连续性。若用户后续要求这些字段结构化，先更新本地领域 schema 与生成/编辑契约，再扩大投影字段。
- 2026-09-25 浏览器记录有剧本保存后刷新为空的失败。必须先修复剧本保存时 episode → `scriptAssetId` 关联并通过独立刷新回读验证；这是 `complete` 模式的硬前置。未通过时禁止完整剧本导入验收，只能明确返回缺剧本阻断项，不能静默跳过。

## 7. 质量属性与风险控制

1. **数据正确性优先：** 校验完整项目/分集/素材归属与顺序；不对未解析引用静默降级。
2. **可恢复：** sourceDigest 检测过期预览；写入幂等；结果按源 ID 列明部分成功；保存非原子，失败时只报告可回读确认的状态，不声称回滚。
3. **隔离：** 只访问本地 Asset store 与所选原生 Canvas；无 DramaClaw 地址、凭据或请求；不新增后端服务。
4. **可审阅：** 预览、导入、排版连线分成三次明确调用；Codex 在每个写阶段之前展示结果并等待用户明确确认。
5. **不冒报：** 必须验证 canonical Canvas 保存结果；静态 schema 存在、MCP 返回成功工具调用或单测通过均不能独自证明持久化成功。
6. **人工确认边界：** `sourceAssetIds` 和 `sourceDigest` 不能证明用户本人已审阅。Canvas Assistant 当前在导入前展示来源清单并要求显式点击确认；在排版前再次展示已保存节点、清单摘要和预期关系并要求确认。该门禁位于 Assistant 调用流程，不能阻止其他直接调用页面动态工具的客户端；真实浏览器验收仍未完成。

## 8. 验收标准

- [x] MCP 工具发现只在目标画布页面已连接时提供动态导入工具，并正确锁定目标画布；代理契约单测/集成测试通过，浏览器连接验收仍待完成。
- [x] 预览覆盖保存剧本、全部 Beat、所有可解析虾塘引用，并报告缺项、重复与 unsupported 文件；纯预览 handler 不写 Canvas。
- [x] 修复 episode → `scriptAssetId` 保存关联；repository 单测验证 canonical 保存与重建读取。真实浏览器刷新仍待验收，因此端到端 `complete` 状态尚未通过。
- [ ] `complete` 与 `selected` 使用各自明确的来源闭包；完整模式缺必需项时阻断，局部模式列清排除项与缺失关系并保持 `partial`。
- [ ] 对项目/分集错配、重复 Beat 序号、跨项目引用、缺脚本、缺媒体、file-only 和过期 sourceDigest 的行为有明确可观察错误。
- [ ] Canvas 写入 handler 已实现来源摘要/基线校验、节点追加/复用和 canonical 回读，但真实浏览器导入、刷新持久化未执行。
- [x] 投影节点包含持久化 `projectionId`、清单摘要与逐项 metadata；纯逻辑单测覆盖刷新重建、来源变化和冲突策略。
- [ ] 排版/关系边纯逻辑与 handler 已实现并通过单测；用户确认、真实保存和刷新后回读尚未在浏览器验收。
- [x] Canvas 普通单项目/批量保存要求 expected snapshot；服务端事务拒绝过期快照，客户端冲突时保留当前页候选并显示错误，不自动重试。
- [x] Canvas 软删除要求每个目标项目的 expected snapshot；服务端事务拒绝过期删除，批次冲突回滚；删除成功后客户端回读 canonical 列表。
- [ ] 使用仓库安装的 Next CLI 重新生成路由类型后，通过标准 `tsc`；如果旧开发态 validator 仍引用已删除路由，确认无 Next 开发服务后仅清理 `.next/dev/types` 再重生成。构建成功不替代此项。
- [ ] 在真实浏览器两个标签页验证同一画布保存/删除基线冲突、拒绝、用户可见错误与刷新后 canonical 内容。压缩包导入不属于本 CAS 保证范围。
- [ ] 媒体预览区分引用存在与可读取；`fileOnly`、缺引用及实际读取失败逐项报告。
- [ ] 用户确认作为 Codex 调用顺序验收记录；不声称 MCP schema 或参数在工具层强制人工审批。
- [ ] 来源数据改动时创建新版本投影或给用户冲突选择，不覆盖已有节点。
- [ ] 分开报告单元、集成、MCP 会话、E2E、smoke、类型检查与真实浏览器 Network；本轮实测结果见配套实施计划的执行记录，未运行项不得报通过。
- [ ] 浏览器验收前分别确认本地服务可安全启动、API/页面健康，以及 CUA 能发现并控制浏览器；任一门禁失败时把 E2E、Network、smoke 和截图标为 `BLOCKED`，不得以静态检索代替。
- [ ] 不触发任何视频/图像/音频生成任务，不声明视频生成已接通。

## 9. 开发门禁

- Superpowers `brainstorming`：用户已确认三模块边界、逐步审阅、导入后单独排版/连线、视频生成排除。本规格只固化这些决定；若实现需要扩展 Beat schema，先单独提出影响并取得确认。
- `before-you-build`：开工前检查现存脏改动、目标 Canvas 保存路径、MCP 动态工具目标、数据可达性、重复/部分失败风险。
- `architecture-analysis`、`api-and-interface-design`、`architecture-patterns`：按本文确定本地边界、三阶段接口和恢复语义。
- `architecture-critic`：实现前只读审查规格、契约和计划；发现 P0/P1 缺陷先修文档。
- Superpowers `writing-plans`：按依赖关系拆分实现任务和逐任务验收。
- Superpowers `test-driven-development`：新模块先建可导入的最小公开接口/测试夹具，再写具体行为断言；RED 必须来自预期行为失败，不能是语法、模块导入或环境错误。记录命令和断言后做最小实现 GREEN，再 REFACTOR。
- Superpowers `verification-before-completion`：报告前执行对应验证命令，分层报告事实；不以先前结果代替本次结果。
- MCP 使用限制：实现阶段只调用本地 Infinite Canvas 的只读预览工具做预览；写入工具只有在用户审阅并确认对应阶段后才调用。实现/测试阶段不得连接 DramaClaw 或触发生成。

Skills 的实际加载/使用记录、MCP 的工具名及参数、子代理模型档位必须在未来执行记录中填写；此规格文件不声称这些工具已在本轮被调用。
