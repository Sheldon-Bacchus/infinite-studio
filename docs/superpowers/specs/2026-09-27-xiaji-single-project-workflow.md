# 虾料、虾塘、虾镜与原生虾画统一项目规格

状态：**实施中；用户已于 2026-09-28 确认“通过执行”。** 已完成一次 `gpt-6-sol / ultra` 只读架构复核，并按意见收紧并发绑定、超时恢复、页面交接、版本指针和导入身份契约；不再循环重复审稿。本规格以下章节定义目标行为，当前完成度以文末执行记录和实施计划为准。

## 1. 目标

在 Infinite Canvas 中把虾料、虾塘、虾镜和原生虾画做成同一个影视项目的阶段化工作台。复用/移植 DramaClaw 虾料、虾塘、虾镜的真实前端页面与交互，按飞书手册、来源源码和页面截图逐项验收；保留 Infinite Canvas 原生画布。Codex/Agent 完成内容创作，应用提供项目上下文、产物审阅、本地持久化、分阶段画布导入和可恢复状态。

## 2. 已确认范围

### 包含

- 虾料：导入原稿、选择项目类型/基础风格、可选本地标题识别、保存项目；原稿项目可在没有分集时保存。
- 虾塘：完整移植角色、身份/造型、场景/变体、道具、声线等来源页面控件、字段、媒体操作、详情、空/错/载入状态和响应式行为。
- 虾镜：在当前项目下规划/查看分集，审阅 Agent 提供的剧本、制作拆解/Beat、参考与已有媒体；每阶段可检查、确认、返工和保存。
- 虾画：保留 Infinite Canvas 原生实现，并与本地影视项目建立唯一、可回读的关系；虾料/虾镜里已保存内容有明确“导入虾画”入口。
- Agent 产物包：Codex/Agent 的项目结构、剧本、制作拆解、资产引用与已有媒体映射可通过 `infinite-studio-canvas` 当前页面连接器快速暂存到审阅界面。
- 画布导入：先导入项目/原稿/分集等可用阶段；单集制作内容随后按已确认的来源关系导入；所有节点落盘审阅后，再统一排版和连线。
- 本地保存、版本关系、失败分类、刷新恢复、幂等重试和真实浏览器验收。

以上是目标范围。实施状态截至 2026-09-28：无分集原稿保存、固定提交 envelope 与 canonical 回读恢复、项目—画布绑定、Agent 产物包跨页待审、无剧本/Beat 的项目结构投影，以及单集制作内容的导入/排版均已有代码和定向测试；production build 与标准 TypeScript 检查通过。来源页面逐控件复核、完整真实浏览器流程、Network 检查和截图对照尚未验收。构建期间出现一条本地 Canvas API 预渲染告警，但未阻断产物。项目绑定由当前单机后端进程内互斥锁及数据库事务串行保证，不含跨多个后端进程的数据库唯一索引；当前本地运行拓扑为单一后端进程。

### 排除

- 不加入虾面、虾导、虾格、虾体、“回主线”或结果写回。
- 不运行、部署或连接 DramaClaw，不访问来源 host/API/数据库/项目/任务服务；不要求 `DRAMACLAW_BASE_URL` 或 `DRAMACLAW_API_TOKEN`。
- 页面不把原文发给用户配置的文本模型；不由页面启动剧本/分集/镜头/图片/音频/视频生成；不伪造任务或进度。
- 本次不实现视频生成。画布只导入 Agent/用户已经准备并保存在本地的媒体引用。
- 不新增 Go 路由、数据库表或依赖，除非 TDD 证明当前本地保存契约无法实现已批准需求；遇到此情况先暂停并提交差异说明。
- 不提交代码；不覆盖、重置、批量清理现有工作区改动。

## 3. 用户流程与确认点

```text
上传/粘贴原稿
  → 本地选择项目类型/基础风格
  → 可选本地识别标题；可先保存“项目 + 原稿”，分集为空
  → 在虾料/虾镜打开同一 projectAssetId
  → Codex/Agent 产物经 MCP 暂存为待审包
  → 用户逐项检查并确认保存到本地项目
  → 可选：检查/确认分集结构、剧本、制作拆解、虾塘引用与已有媒体版本
  → 用户从项目入口打开/创建唯一关联原生虾画
  → 先预览项目结构投影（无需剧本或 Beat），逐项确认节点并保存回读
  → 再按单集预览制作内容投影，逐项确认节点并保存回读
  → 用户检查全部节点/缺项/版本
  → 单独预览确定性布局与语义连线
  → 用户再次确认后保存
  → 整体审阅画布
```

每个“确认”都是用户确认当前展示的确切清单和摘要。MCP schema 本身不证明人工授权；执行提示词要求 Agent 在写入前停下等待用户回复。界面阶段标记只在 canonical 回读成功后更新。

## 4. 页面移植与行为要求

实施前先建立控件矩阵：`来源路由/组件/控件 → Infinite Canvas 目标路由/组件 → 输入输出/交互状态 → 本地保存/Agent 接口 → 对照截图 → 缺口`。

- 以 `integrations/dramaclaw/frontend` 对应真实 React 页面、子组件、样式和真实路由为移植依据；飞书章节/截图用于流程及视觉交叉检查，不凭模块名称重画。
- 保留来源页信息层级、四类资产视图、搜索/筛选、所有可见选项、字段、详情、媒体上传/录制/试听/裁剪/预览、确认框、加载/错误/空状态及响应式布局。不得用 `LocalAssetWorkbench` 或几类通用素材卡片替代完整来源页面。
- 页面创作动作改为“交给 Codex/Agent / 导入产物 / 查看待确认结果”；不能保留会向文本模型发送原文的旧按钮。
- **实施前遗留问题（已修正，不代表当前行为）：**旧虾料“生成分集结构”曾把原文发给配置模型；旧虾镜脚本页也曾有直接生成/改写调用。当前实现改为本地标题识别与 Agent 产物导入/审核；本页不得调用文本模型。仍须用浏览器 Network 验证无运行时模型请求，静态源码检查不能替代该验收。
- 复用页面不能因禁止页面发起生成而删空来源功能区：保留源页面布局、控件层级与阶段位置，把生成/改写按钮改为 Agent 产物接收/导入、版本对照、逐项审阅和确认保存；模型配置位置说明“由 Codex/Agent 执行，本页不调用模型”。每项变更进入来源控件矩阵。
- 本地解析没有找到分集标题时返回空预览，项目和原稿仍可保存；不得把整段原文静默命名成“第一集”。
- 每个来源控件在目标页应标注：已复用、按需适配、因本地能力缺失而禁用并解释，或确有证据不属于当前范围。不得隐藏来源选项来伪造完成。
- 逐文件保留许可证/SPDX 与版权声明，记录复制/修改范围；Elastic-2.0 的分发义务须按实际文件核对，不自行宣称兼容。

## 5. 统一项目与本地数据契约

### 主键和关系

- 唯一项目根：`projectAssetId`，即本地 Asset ID。
- `CanvasProject.id` 保持原生画布 ID；新增 `CanvasProject.xiajiProjectAssetId` 作为项目绑定字段。产品不变量是同一用户的每个 `projectAssetId` 至多关联一个有效 `CanvasProject`；这个字段本身和按 CanvasProject.id 做 CAS 都不提供跨记录唯一性。
- 必须由 canonical 写入层在创建、关联和导入时原子约束同一用户全部有效 CanvasProject 的项目绑定唯一性。并发冲突返回已绑定的 CanvasProject ID。两个标签/请求同时绑定的 RED 若不能证明至多一方成功，不能宣称绑定完成，也不能用客户端预扫描补作保证；先暂停并提交最小服务端原子绑定契约，等待用户审阅后再扩展。
- 保存并回读 `unbound/pending/bound/conflict` 用于 UI 恢复和冲突处理；状态字段不替代 canonical 层唯一约束。禁止以名称匹配。
- 关系链：`project → source manuscript / episodes → script revisions / production-breakdown revisions / beats → explicit XiaTang asset IDs and media IDs`。
- 虾塘资产必须有项目归属；全局素材库选用素材时需由用户显式关联当前项目，不得仅凭标题自动建立关系。

### Agent 产物包

```ts
type XiajiArtifactPackage = {
  schemaVersion: 1;
  packageId: string;
  projectAssetId: string;
  episodeAssetId?: string;
  stage: "project-outline" | "script" | "production-breakdown" | "asset-references";
  baseRevision: string;
  artifacts: Array<{
    sourceKey: string;
    kind: "episode" | "script" | "beat" | "asset-reference" | "media-reference";
    title: string;
    content?: string;
    metadata?: Record<string, unknown>;
  }>;
  relations: Array<{ from: string; type: string; to: string }>;
  mediaAssetIds: string[];
  contentDigest: string;
};
```

校验 `schemaVersion`、项目/分集归属、必需字段、sourceKey 唯一性、关系闭包、资产存在与媒体可读性。关键标识职责固定如下：`projectAssetId/episodeAssetId` 是目标记录 ID；`packageId` 是不可变 Agent 包身份；`contentDigest` 校验包正文；`baseRevision` 是 Agent 读取时项目、分集、当前版本指针及明确引用资产的 canonical 快照摘要，确认前须重算；`commitId` 是一次本地 Asset 写入尝试；`projectionId` 是一次画布导入与 ID 映射；`manifestDigest` 校验经用户批准的节点 ID、来源版本、布局和边清单。不要再叠加语义重复的通用 `idempotencyKey`。

MCP 暂存只生成待审包，不写本地素材或画布；用户确认保存后才写入本地 Asset。当前代码已有 package schema/digest 校验、同标签 sessionStorage 交接、容量/读写失败回退到 JSON 文件导入、虾镜页待审摘要和显式确认、canonical 项目/画布核验及 package/commit 重放保护；相关路径有定向单测。浏览器导航/刷新后的真实恢复尚未 E2E 验证。重复 `packageId + contentDigest` 才是同包重放；同 packageId 不同 digest 报冲突。媒体不能携带二进制、URL 或任意路径，只能引用本地已存在 Asset。

### 版本和审批

- Agent 的新一版脚本/制作拆解/Beat 先追加成新记录，记录 `version`、`supersedesAssetId`、`contentDigest`、`projectAssetId`、`episodeAssetId`、`approvalState` 和来源 packageId；只有用户批准后才更新对应 project/episode 的单一当前版本指针。未批准版本不能替换当前版本；重复确认同一版本幂等，历史版本保留。
- 用户编辑现有角色/场景等资产时，沿用当前编辑器行为；如果要把该编辑结果作为新的制作版本用于画布，必须明确创建新版本，不能静默覆盖已导入节点。
- 画布来源 metadata 至少包含 `projectAssetId`、`episodeAssetId?`、`sourceAssetId`、`sourceType`、`sourceVersion/digest`、`packageId` 和 `projectionId`。

## 6. 保存与错误语义

Asset 写入前由客户端固定分配项目、原稿和分集 Asset IDs，并保留同一次尝试的 `commitId`、payload、父子关系、摘要和时间戳；新建记录 metadata 中带可查询的 `localStudioCommit.commitId`。请求层须识别 timeout/abort。当前数据库批量 Asset 写入在一个事务内完成，因此初始批次按原子成功或失败验收；不能因响应少一个 ID 就断言发生了部分提交。超时后独立回读：全部记录和关系匹配才显示已保存；读失败、原请求仍可能执行或状态矛盾时维持 `unknown-after-timeout`，显示“保存结果待确认”，不能判失败或用新 IDs 重建。重试须原样复用 `commitId`、IDs、payload、关系与时间戳；若现有同步接口不能安全处理相同尝试的并发重放，就暂停自动重试并补最小幂等契约。

错误至少区分 `validation-rejected`、`request-failed`、`missing-after-save`、`payload-mismatch`、`relationship-mismatch`、`stale-base`、`concurrent-update`、`unknown-after-timeout`。`partial` 只用于 canonical 读取确证的多阶段画布投影/多次独立写入，不作为原子 Asset 批次的默认解释。当前实现为项目创建固定 `commitId`、IDs、payload 与 digest；在写入前保存同标签恢复 envelope，写入后回读 canonical Asset，并在请求响应丢失时按原 envelope 探测/重试。尚未解决的尝试以 `project-create-outcome-unknown` 保留原始尝试，不能生成新 ID 重建。相关 repository RED/GREEN 已覆盖；浏览器实际断网/超时恢复仍未验证。错误提示不得把不匹配伪装成“项目或原稿缺少”，也不得让用户承担系统无法区分的状态。

## 7. MCP 契约与调用门禁

现有层次必须保持清楚：

1. `infinite-canvas-core` 静态 MCP 与 `infinite-studio-canvas` 页面桥：分别提供独立 MCP 命名空间；当前源码从静态工具和页面 dispatcher 撤下了旧的受限 `import_local_assets`。
2. 画布页面动态工具：由当前已连接页面在运行时公布；当前代码有虾镜单集上下文预览、导入、排版工具。需要实测 Codex MCP 是否能发现和调用，且页面断开/切换目标时必须失败关闭。
3. 页面内用户导入：本地虾料/虾镜 UI 预览与保存到 Asset store。它不调用模型，也不等于 Agent 生成。

此前的 `import_local_assets` 只支持已有 SHOT-05–08 分组下的图片/音频，现已从工具清单、页面 action、dispatcher 和专用辅助逻辑删除。页面源码现有 `import_assets_to_canvas` 通用 action；它经 MCP 动态清单暴露与保存回读的运行时状态仍待验证。

跨页确认需要同标签、按 `projectAssetId/canvasId/packageId/contentDigest` 键控的会话交接；成功暂存后导航/刷新可恢复待审项，MCP 后续断开不撤销已完整交接的包。暂存响应不确定时不得确认；目标画布变化、项目绑定变化或 canonical `baseRevision` 过期时显示原因并拒绝确认。确认 handler 重新读取 canonical 项目、分集、绑定和版本状态；画布页面里的临时内存不是充分交接机制。

当前源码中已注册并由页面 dispatch 的动态动作包括：`import_assets_to_canvas`、`preview_xiaji_project_context`、`import_xiaji_project_context`、`arrange_xiaji_project_canvas`、`preview_xiaji_episode_context`、`import_xiaji_episode_context`、`arrange_xiaji_episode_canvas` 与 `stage_xiaji_artifact_package`。`infinite-studio-canvas` 是否成功发现并调用这些 live 页面工具仍未在真实浏览器中验证。

以下名称/职责仍是候选或未实现，不应描述成当前可用：

- `get_xiaji_project_context(projectAssetId)`：只读返回项目、原稿、分集、当前版本与明确引用。
- `stage_xiaji_artifact_package(package)`：校验目标项目和包结构，在连接页面显示待审预览，不落盘。
- `preview_xiaji_project_context(projectAssetId, canvasId)` / `import_xiaji_project_context(...)`：支持尚无剧本/Beat 的初始项目结构导入。
- `preview_xiaji_episode_context(projectAssetId, episodeAssetId)` / `import_xiaji_episode_context(...)`：导入已保存单集剧本、Beat、明确引用和已有媒体。
- `arrange_xiaji_project_canvas(projectionId, manifestDigest, approvedNodeIds)`：在全部节点导入并审阅后，基于显式关系排版和连线；相同 `projectionId + manifestDigest` 是同一排版操作身份，不再另加重复的 `idempotencyKey`。

`get_xiaji_project_context` 不是当前工具名；项目上下文通过 `preview_xiaji_project_context` 提供。`stage_xiaji_artifact_package`、项目结构/单集投影与排版已有 schema、dispatch 和代码测试，但在 MCP 真实发现、画布保存回读及页面刷新恢复的浏览器证据取得前，只能称“实现于源码/单测覆盖”，不能称“端到端验收通过”。

所有写工具使用确切 `projectAssetId`、`canvasId`、来源摘要和批准 ID 列表；导入使用 `projectionId`，布局使用 `manifestDigest`。工具调用层须先展示预览并等待用户确认；预览摘要改变、当前 Canvas 与项目关系不匹配、工具列表陈旧或连接断开时拒绝写入。静态 MCP 工具不支持的媒体/Beat 上下文要逐项报告；无生成功能不声称可生成视频。

## 8. 验收标准

- 来源控件矩阵逐项覆盖虾料、虾塘、虾镜真实页面；重要页面保存可比较的来源/目标截图，明显遗漏或布局差异先修正。
- 新建项目不需要文本模型配置；只保存原稿时允许分集为空；Network/调用 spy 证明原文没有发给任何模型。
- 保存前固定 IDs；超时后准确显示已保存或“结果待确认”。只有 canonical 读取证明完整批次成功才报成功；初始 Asset 事务不能误报“部分写入”，画布投影才逐项报告部分成功。
- 项目页和原生画布始终指向同一个 `projectAssetId`；双标签并发绑定 RED 必须证明最多一个画布成功，失败方获得既有 Canvas ID；所有项目卡片、详情和虾塘直达入口走同一个 binding resolver。跨项目导入被阻断。
- MCP 项目结构导入允许只有原稿/分集，不依赖未创建的剧本/Beat；剧本/Beat 与媒体之后分阶段追加。
- 每个写入前用户审阅清单；画布节点保存回读后再批准最终布局与连线；已有节点/边保持不变；显式关系全部按预览建立。
- 本地准备的视频可以作为已有 Asset 节点导入；本轮不触发任何媒体生成。
- 分别报告单测、集成、MCP 桥接、E2E、smoke、TypeScript、真实浏览器、Network 和截图。缺环境标 `BLOCKED/NOT RUN`，不以单测代替浏览器验收。

## 9. 已确认的实施决策

1. 项目 Asset 是唯一根身份；项目—画布唯一性必须由 canonical 写入层原子保证。现有保存能力若做不到，先停下审阅最小契约差异，不降级为客户端检查。
2. MCP 先把 Agent 包暂存于当前 Canvas 页，再通过同标签会话交接到虾料/虾镜审核；保存前重验 canonical 关系与 `baseRevision`。节点导入、排版和连线分别确认。
3. 版本追加保存；新版本先待审，获批后才更新单一当前指针，历史版本不覆盖。
4. 保存请求前固定 IDs 和整个提交 envelope；超时结果在 canonical 状态可确认前保持未知，同一尝试只复用原 IDs 和 payload。
5. 先修无分集保存、提交恢复与原子项目—画布绑定，再实现 Agent 包/跨页审核，最后按控件矩阵移植页面和导入全流程。

用户已通过执行提示词并授权实施。上列决策不再等待重复确认；若实现需要新增 API 路由、数据库表或运行时依赖，则暂停并另行提交最小差异审阅。

## 10. 当前验证快照（2026-09-28）

- 2026-09-28 更新后，`web/src/features/xiaji` 42 个测试文件：218 pass / 0 fail / 907 assertions；虾料按钮指引测试的 RED → GREEN 记录见配套计划。
- `bun test`（`canvas-agent/`）：16 pass / 0 fail。
- `go test ./repository ./service ./handler`：通过。
- `bunx next typegen` 与标准 `bunx tsc --noEmit`：通过。此前阻断标准检查的是 Git 忽略的 `.next/dev/types/validator.ts` 陈旧生成文件；在确认没有 Next 服务占用后只删除了该文件，再生成路由类型并复验。
- Next 16.2.9 production build：较早构建 28.7 秒；最新构建通过，23.7 秒编译并生成 24 个静态页面。预渲染时有本地 Canvas API 访问告警。当前 `next start` 页面服务能响应，但 standalone 直接启动在此 Windows 环境因依赖符号链接 `EPERM` 未通过，已恢复可用启动方式。
- 本地前端项目列表、虾料路由及后端健康端点返回 HTTP 200；该 HTTP 检查不等于登录后的浏览器功能验收。
- 虾料/虾镜生产页面源码检索未发现 `DRAMACLAW_BASE_URL`、DramaClaw API host 或 `requestCanvasAgentTurn` 调用；测试夹具中仍有 `/api/v1/drama/media` 示例 URL。此静态检索不等于浏览器 Network 验证。
- 最新 production build 与 HTTP route/health smoke 已通过；登录后的 E2E、MCP live 动态工具调用、Network 面板、真实导入/刷新、来源截图对照尚未完成；逐项状态见实施计划。
