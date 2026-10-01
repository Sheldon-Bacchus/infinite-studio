# DramaClaw 创作模块移植路由表

状态：第七轮只读最终复核确认 P0/P1/P2=0，路由表与 spec、architecture、plan 的 Beat 选择/focus 冲突规则和审阅状态一致。实施时按本表新增/调整 Next App Router 页面并补回归用例；当前路由未实现、回归测试未新增或运行。

目标工作区：`web/src/app/(user)/xiaji/`。DramaClaw 源路由以 v2.0.5 / `a09248410343158ba227ec40b5a4dbc1ba4b1444` 为准。

## 最终路由

| Infinite Canvas 路径 | 页面/用途 | 标识与行为 |
| --- | --- | --- |
| `/xiaji` | 虾塘；独立全页，角色/场景/道具/声线在页面内切换 | 不带 DramaClaw 项目 slug；本地虾塘素材工作区 |
| `/xiaji/ingest` | 虾料新建项目入口 | 创建本地 project Asset 并导入小说/剧本；完成后进入项目级 ingest 路由 |
| `/xiaji/projects` | 本地项目选择器，供进入虾镜/虾面 | 只是选择项目的导航页，不增加新的“虾X”模块 |
| `/xiaji/project/[projectAssetId]` | 项目入口兼旧链接规范化 | 重定向至 `/xiaji/project/[projectAssetId]/episodes`；整个动态目录统一使用 `[projectAssetId]`；项目不存在时显示明确 404/返回选择器 |
| `/xiaji/project/[projectAssetId]/ingest` | 虾料项目内导入/结构预览 | projectAssetId 是本地 project Asset 的稳定 ID；不使用显示名作为 key |
| `/xiaji/project/[projectAssetId]/characters` | 项目上下文中的虾塘资产页 | 使用角色/场景/道具/声线四类页签；不增加新模块；新深链用 `?type=identity|scene|prop&assetId=<assetId>`；旧来源 `id` 作为业务 ID 唯一解析后规范化；页签状态按 projectAssetId 持久化 |
| `/xiaji/project/[projectAssetId]/episodes` | 虾镜分集列表 | episode Asset 的 `order` 决定显示序号 |
| `/xiaji/project/[projectAssetId]/episodes/by-id/[episodeAssetId]` | 分集默认入口（新 canonical path） | episodeAssetId 是稳定 Asset ID；重定向至该集 `/script`；`by-id` 将稳定 ID 与旧数字分集别名明确分开 |
| `/xiaji/project/[projectAssetId]/episodes/by-id/[episodeAssetId]/script` | 剧本 | episodeAssetId 是稳定 Asset ID；保存映射到 script/Beat Asset |
| `/xiaji/project/[projectAssetId]/episodes/by-id/[episodeAssetId]/beats` | 镜头/Beat 工作台 | `sub` 允许 `text`（默认）、`sketch`、`render`、`audio`、`video`；新选择使用 `beatAssetId`，旧数字 `beat` 仅兼容；目标暂不可用的子区仍显示并说明状态 |
| `/xiaji/project/[projectAssetId]/episodes/by-id/[episodeAssetId]/compose` | 成片合成页面 | 保留来源布局；目标没有的服务端合成操作明确禁用 |
| `/xiaji/project/[projectAssetId]/freezone` | 虾面入口与本地资产面板 | 复用素材浏览/多参考/候选交互；`?canvas=<canvasId>` 表示 Infinite Canvas 本地画布 ID。进入画布时将它消费为 `/canvas/[id]` 路径并附本地项目上下文；缺少或无效时显示本地画布选择/创建入口和可恢复错误；不读取 DramaClaw Freezone canvas 状态 |
| `/canvas/[id]?xiajiProjectAssetId=[projectAssetId]&xiajiEpisodeAssetId=[episodeAssetId]&xiajiBeatAssetId=[beatAssetId]` | 虾画 | 始终由 Infinite Canvas 原生 CanvasProject、节点、连线及保存实现；后两个 query 可省略，所有 context ID 都必须在本地读取校验后才能用于来源关系和“回主线”目标选择；`[id]` 是现有实际目录参数 |

## 来源子路由兼容

DramaClaw v2.0.5 的 `episodes.$episode/index.lazy.tsx` 将裸数字分集路径跳到 `script`；`overview.lazy.tsx` 也重定向到 `script`。`sketches.lazy.tsx`、`audio.lazy.tsx`、`video.lazy.tsx` 重定向到 `beats`，并分别设置 `sub=sketch`、`sub=audio`、`sub=video`。目标 canonical 页面用静态 `by-id` 段承载稳定 Asset ID；旧数字 URL 留作兼容别名：

| 旧/来源语义 | 目标行为 |
| --- | --- |
| `/xiaji/project/[projectAssetId]/episodes/[episodeNumber]` | 按本地 `sourceEpisodeNumber`（缺省时按唯一 `order`）解析，再 replace 到 `/episodes/by-id/[episodeAssetId]/script` |
| `.../[episodeNumber]/script` 或 `.../[episodeNumber]/overview` | 同上，replace 到 stable ID canonical `/script` |
| `.../[episodeNumber]/sketches` | 同上，replace 到 canonical `/beats?sub=sketch` |
| `.../[episodeNumber]/audio` | 同上，replace 到 canonical `/beats?sub=audio` |
| `.../[episodeNumber]/video` | 同上，replace 到 canonical `/beats?sub=video` |

旧 `sketches/audio/video` 跳转会用对应的 `sub` 替换 search，不保留旧 `beat`、旧 `focusBeat` 或未知 query。新页面的持久选择参数是 `beatAssetId=<stableId>`；该 ID 必须唯一解析到路径项目和当前分集下的 Beat Asset，找不到、重复或归属其他项目/分集时进入可恢复的定位错误。旧 `beat=<number>` 只在兼容时按当前分集内 `sourceBeatNumber` 唯一解析，缺少来源号的本地 Beat 才回退到唯一 `order`。新旧选择参数同时出现时分别解析：两者指向同一 Beat 时接受并规范化为 `beatAssetId`、清除旧 `beat`；指向不同 Beat，或任一值无效、未唯一解析时显示可恢复的参数冲突，不猜优先级。

新 compose 跳转使用 `focusBeatAssetId=<stableId>`；该 ID 必须唯一解析到路径项目和当前分集下的 Beat Asset，找不到、重复或跨项目/分集时进入可恢复的定位错误。一次性定位成功后只清除该参数。旧链接的 `focusBeat=<number>` 以相同的来源序号规则解析并在消费后清除。两种 focus 参数同时出现时显示可恢复的参数冲突，不猜优先级。compose 构造 search 时采用明确 allowlist：仅保留有效 `sub` 并写入 `focusBeatAssetId`；丢弃 `beat`、`beatAssetId`、旧 `focusBeat` 和未知参数。`sub` 缺失或无效时落到 `text`；有效 focus 定位覆盖页面恢复出的普通选择。

## 现有目标路径兼容与冲突

现有三个目标页面都只重定向到 `/xiaji`：

- `web/src/app/(user)/xiaji/episodes/page.tsx`
- `web/src/app/(user)/xiaji/[project]/page.tsx`
- `web/src/app/(user)/xiaji/project/[project]/page.tsx`

调整规则：

1. `/xiaji/episodes` 不带项目参数时，replace 到 `/xiaji/projects`；带 `?projectAssetId=<id>` 时 replace 到该项目 `/episodes`。兼容旧的 `?project=<id>`，但参数值必须作为本地 project Asset ID 处理，不能当名称查询。
2. `/xiaji/[legacyProjectId]` replace 到 `/xiaji/project/[legacyProjectId]/episodes`。Next.js 同级静态段优先于动态段（见 [App Router 路由排序实现](https://github.com/vercel/next.js/blob/canary/packages/next/src/shared/lib/router/utils/sortable-routes.ts)），因此 `ingest`、`projects`、`episodes`、`project` 是保留的一级段。
3. 任何可能等于保留词的真实项目 ID 都能通过无歧义规范路径 `/xiaji/project/[projectAssetId]/...` 访问。旧单段链接无法表示这些保留 ID，不得把它解释成另一个项目。
4. 现有 `xiaji-projects-page.tsx` 的选择操作必须将实际 projectAssetId 带到项目 episodes 路径；不能继续导航到不带项目参数的 `/xiaji/episodes`。
5. 对项目 ID、分集 ID 使用 `encodeURIComponent`；显示名称和可变分集序号不得充当路由主键。分集序号只是 `order` 展示字段。新分集路径必须通过静态 `/episodes/by-id/[episodeAssetId]` 编码稳定 ID，旧纯数字路径只承担兼容解析，不与数字型 Asset ID 共用同一语法。
6. 未找到 project/episode 时显示可恢复的 not-found 状态，不静默跳回 `/xiaji`，以免用户误以为选中了其他项目。

7. `characters` 源路由映射到项目上下文的虾塘页。新链接用 `type=identity|scene|prop&assetId=<localId>`；兼容来源深链时，旧 `id` 在 `type=identity` 下按 `identity_id` 查找，在 `type=scene|prop` 下按资产名称查找，均须在当前项目内唯一命中后 replace 为 `assetId`。若新旧参数同时出现且指向不同资产，显示参数冲突；未命中或多重命中显示可恢复的未定位状态。页签状态键按项目 ID 隔离。
8. `/xiaji/ingest` 是新建项目入口，`/xiaji/project/[projectAssetId]/ingest` 是现有项目导入；两者不能合并成无项目上下文的一页。
9. 来源分集路径参数和旧 `beat`/`focusBeat` 均为正整数序号，不是 Asset ID。导入时保留 `sourceEpisodeNumber` / `sourceBeatNumber`；旧数字链接先在项目/分集内按来源序号唯一解析，手工创建的本地记录可回退按必填、作用域内唯一的正整数 `localStudio.order` 解析。导入时 source number 与初始 order 一一对应；之后重排只改 order，不改 source number。缺失/重复时显示可恢复的冲突，不猜测。稳定分集链接固定走静态 `/episodes/by-id/[episodeAssetId]`；静态 `by-id` 优先于同级旧数字动态段，数字型 Asset ID 也始终由显式稳定路径识别。稳定镜头链接用 `beatAssetId` / `focusBeatAssetId` query，与旧数字 `beat` / `focusBeat` 分属不同参数键；稳定 ID 必须属于 URL 中的项目和分集。旧数字和稳定参数同指一项时规范化到稳定键；冲突、缺失、重复或越界均显示可恢复状态。
10. 新人物/身份/场景/道具深链以 `assetId` 传稳定 ID；旧来源 `id` 只按其领域字段唯一解析。若两者同时出现并指向不同资产，报冲突，不猜优先级。不得把来源业务 ID 和稳定 Asset ID 混在同一个无标记值域。
11. 虾面打开虾画时，query key 固定为 `xiajiProjectAssetId`、可选 `xiajiEpisodeAssetId`、可选 `xiajiBeatAssetId`；它们是本地 context，不是 DramaClaw slug/URL。Freezone 的 `?canvas` 在打开时被消费为现有 Canvas 路由 `/canvas/[id]` 的路径 ID，不留同名 query；`[id]` 是现有真实目录参数。缺少/无效 canvas 时留在 Freezone 并显示本地画布选择或创建入口；项目、集或镜头找不到/不属于上级关系时，丢弃无效 context 并显示可恢复提示，不把未知 ID 传给任何远端服务。

## 现有导航调用点

目标源码当前有以下旧导航，实施时必须一起调整并覆盖路由回归用例：

- `web/src/features/xiaji/xiaji-projects-page.tsx:30` 的 `xiaTangProjectPath(projectId)` 已使用 `/xiaji/project/${encodeURIComponent(projectId)}`，保留此前缀并增加 `/episodes` 的明确导航。
- `web/src/features/xiaji/xiaji-projects-page.tsx:269` 当前只 push `/xiaji/episodes`，丢失已选项目 ID；改为 push `/xiaji/project/${id}/episodes`。
- `web/src/features/xiaji/xiaji-projects-page.test.tsx:35-36` 已覆盖项目 ID 为 `episodes` 及空格名称时的编码；扩展为 canonical path 和 alias 参数行为。
- `web/src/app/(user)/canvas/page.tsx:94` 的“虾塘”入口保持 `/xiaji`；Canvas 项目路由继续使用现有 `/canvas/[id]`。

## 路由回归用例 ID

实施时为以下场景建立测试：`route.xiaji-hub`、`route.project-xiaotang-deep-link`、`route.xiaotang-asset-query`、`route.legacy-character-ids-resolve-uniquely`、`route.character-new-and-legacy-id-conflict`、`route.ingest-create`、`route.ingest-existing-project`、`route.project-picker`、`route.legacy-project-alias`、`route.episodes-alias-with-id`、`route.reserved-project-id`、`route.episode-number-alias-to-by-id`、`route.episode-id-path-no-number-collision`、`route.episode-order-fallback-and-conflict`、`route.episode-default-script`、`route.episode-legacy-tabs`、`route.sub-allowlist-and-default`、`route.legacy-stage-search-replacement`、`route.beat-number-to-asset-id`、`route.beat-stable-and-legacy-same-record-canonicalize`、`route.beat-stable-and-legacy-conflict`、`route.stable-beat-wrong-project-or-episode`、`route.focus-beat-asset-id-and-legacy-number`、`route.focus-params-conflict`、`route.compose-search-allowlist`、`route.freezone-canvas-query-consumed`、`route.freezone-canvas-missing-or-invalid`、`route.missing-project`、`route.native-canvas-unchanged`。当前没有运行或新增这些测试。
