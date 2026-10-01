# DramaClaw 来源控件到 Infinite Canvas 映射

更新：2026-09-28。此矩阵按当前已确认范围核对：虾料、虾塘、虾镜和 Infinite Canvas 原生虾画，共用一个本地影视项目。它区分源码中存在的行为、自动化覆盖和真实浏览器验收；源码相似或单测通过都不等于视觉移植验收通过。

**证据状态：**已静态检查目标路由、组件、状态/持久化与 Canvas 调用点，并运行本轮记录的定向测试、类型检查和生产构建。飞书正文/截图在当前环境无法读取，浏览器自动化枚举失败且当前浏览器仍停在登录页；因此没有 DramaClaw/飞书与目标页面的可比截图、登录后 E2E 或 Network 面板证据。这里的“来源控件”依据 `integrations/dramaclaw/frontend` 副本源码，不宣称本轮看到了来源运行页面。

| 来源页面与控件 | 当前目标路由与代码 | 目前已核实的本地行为 / 数据 | 覆盖状态与未完成项 |
| --- | --- | --- | --- |
| **虾料**：小说/剧本上传或粘贴、项目类型与风格、结构预览、保存和错误状态。来源：`integrations/dramaclaw/frontend/src/routes/_app/projects.$project/ingest.tsx` | `/xiaji/ingest`；`web/src/features/xiaji/local-studio-pages.tsx` 的 `LocalStudioIntakePage`；`local-manuscript-structure.ts`、`local-studio-intake-model.ts`、`local-studio-repository.ts` | 只做本地文件读取、原文内已有“第 N 集/章/节/回”标题识别和预览；不会将原文发给文本模型，也不会自动创作分集。用户可在没有分集时保存项目和原稿，写入 Infinite Canvas 本地 Asset 存储。Agent 结构须在项目存在后导入虾镜审核。 | 本地保存与识别逻辑有定向测试。来源全控件布局未逐项截图对照；真实项目创建、刷新回读仍待登录后浏览器验收。当前“保存后导入 Agent 产物”在创建前为禁用说明，不代表生成入口。 |
| **虾塘共用框架与角色**：四类标签、角色检索/统计、主角、角色资料、身份/造型、头像/参考图和 CRUD。来源：`characters.lazy.tsx`、`character-search.tsx`、`character-stats-strip.tsx`、角色组件 | `/xiaji`、`/xiaji/project/[project]/characters`；`xia-tang-local-page.tsx`、`components/character-assets-panel.tsx`、`components/character-identities-manager.tsx`、`xia-tang-local-model.ts` | 本地角色/身份父子素材、字段 metadata、头像/参考媒体、编辑/删除和 Beat 关联。已有头像、身份编辑及来源关系处理代码。 | 已有组件与单测；尚未证实与来源每个表单字段、选项、细节布局、历史/版本和移动端同等。来源截图对照和真实媒体操作 E2E 未完成。 |
| **虾塘场景**：场景卡片、基础场景与变体、时间/环境提示、master/reverse/360、空间布局/Director World 文件操作。来源：`scenes-panel.tsx`、`scene-asset-card.tsx`、`scene-environment-prompt.tsx` | `/xiaji` 的场景详情；`components/scenes-panel.tsx`、`components/scene-asset-manager.tsx`、`scene-environment.ts` | 场景/变体和环境字段保存在本地；媒体文件经现有本地媒体能力保存。没有调用远端生成。 | 场景本地字段、变体与媒体流程有组件/模型测试。360/Director World 生成与打开明确不可用；需将来源入口与目标控件逐项做视觉/行为差异核对。 |
| **虾塘道具**：列表、搜索、类型、别名、所属角色、视觉描述/备注、参考图及批量操作。来源：`props-panel.tsx`、`prop-asset-card.tsx` | `/xiaji` 的道具详情；`components/props-panel.tsx`、`components/domain-asset-manager.tsx` | 道具 metadata 本地 CRUD、角色关联、参考媒体上传/选择。 | 基本 CRUD 和本地媒体路径有测试；来源图片来源动态选项、批量上传/生成及全部错误/空态尚未证明逐项匹配。依赖 DramaClaw 任务的控件不可假报成功。 |
| **虾塘声线**：角色声线/项目旁白、默认/儿童/青年/中年/老年槽、上传、录音、试听、本地音频、裁剪、删除和状态。来源：`character-voice-panel.tsx`、`narrator-voice-panel.tsx` | `/xiaji` 声线页签；`components/voices-panel.tsx`、`components/voice-asset-manager.tsx`、`voice-slot-layout.ts`、`audio-trim.ts` | 本地上传/选择音频、浏览器录制、试听、裁剪版本和删除由本地素材机制处理。自动提取、远端音色生成/配音没有接入。 | 年龄槽布局、裁剪和组件有定向测试；登录后麦克风权限、录音、上传与播放真实浏览器验收未完成，视觉截图对照也未完成。 |
| **虾镜项目/分集规划**：项目列表、集数顺序/编辑、状态、剧本/镜头/资产计数。来源：`episodes.tsx` | `/xiaji/projects`、`/xiaji/project/[project]/episodes`；`xiaji-projects-page.tsx`、`local-studio-episode-list.tsx`、`local-studio-pages.tsx` | 项目 Asset ID 是虾料/虾塘/虾镜的共同本地身份；分集属于该项目 Asset。分集可排序、编辑标题/梗概，显示脚本/Beat/身份/场景/道具统计并打开脚本、镜头或合成阶段。 | 路由/列表和数据统计有定向测试。来源项目/分集控件全量对应、长列表/窄屏与真实导航仍需浏览器检查。 |
| **虾镜剧本**：原稿/梗概、资产规划、剧本编辑、生成/改写/逐行生成与 Beat 预览。来源：`episodes.$episode/script.lazy.tsx` | `/xiaji/project/[project]/episodes/by-id/[episode]/script`；`LocalStudioScriptPage`、`local-studio-script-prompt.ts`、`local-studio-repository.ts` | UI 不调用文本模型。页面提供 Codex/Agent 任务文本复制、剧本文件导入、逐行任务参数、剧本编辑/保存和版本追加，并预览已有 Beat 与虾塘关联。Agent 产物可在虾镜页面导入并逐项审核。 | 本地脚本保存/产物包测试存在；需要核对所有来源创作控件在目标中的对应位置，以及真实文件导入、Agent 包审核/保存、版本返回行为。不得把“可由 Agent 执行”记成 UI 生成已接通。 |
| **虾镜镜头/Beat**：镜头卡片、台词、画面描述、角色/身份/场景/道具、草图/渲染/音频/视频阶段。来源：`beats.lazy.tsx`、`sketches.lazy.tsx`、`audio.lazy.tsx`、`video.lazy.tsx` 和 `components/episode/beat-workbench/` | `/xiaji/project/[project]/episodes/by-id/[episode]/beats?sub=...`；`LocalStudioBeatsPage`、`local-asset-beat-references.tsx`、`local-studio-repository.ts` | 镜头草稿以本地 Asset 保存台词、画面描述、顺序和虾塘素材 ID 关联。页面有剧本/镜头、Beat 草图、渲染图、音频、视频阶段导航；实际图/音/视频创作使用原生虾画能力，不由这些虾镜页签启动。 | 本地 Beat 编辑和素材引用逻辑有定向测试。草图/渲染/音频/视频页签目前是阶段说明/镜头浏览，不等于来源生成工作台已完整移植；页面没有完成与来源每个子面板、任务控件的逐项对照。影视制作需求（如说话人、时长、连续性字段）的完整性也需实测核对。 |
| **虾镜合成/导出**：镜头顺序、媒体池、字幕、配音/音乐、合成参数和任务状态。来源：`compose.lazy.tsx` | `/xiaji/project/[project]/episodes/by-id/[episode]/compose`；`LocalStudioComposePage` | 显示本地 Beat 序列并定位镜头。Infinite Canvas 目前没有已核实的本地多镜头成片、字幕和混音合成能力；页面不创建假任务。 | 这是合成入口占位/状态说明，不是完整来源功能移植；合成导出目前不可用，视频生成也不属于当前已确认实施范围。 |
| **项目入口与唯一虾画绑定** | `/xiaji/project/[project]`、`/xiaji/project/[project]/episodes`；`local-studio-canvas-binding.ts`、`local-studio-project-lifecycle.ts`、本地 Canvas Project store | 本地项目记录以 project Asset ID 关联一个原生 Canvas Project。创建/打开页面检查现有绑定；项目结构/原稿可在剧本和 Beat 尚不存在时预览并导入。 | 单进程绑定守卫、项目生命周期和单测已存在；跨多个后端进程的数据库级硬唯一不在当前保证内。项目创建后唯一 Canvas 的真实浏览器打开、刷新和异常恢复待验收。 |
| **虾料项目结构 → 虾画**：项目、原稿、已有分集的选择与关系。非 DramaClaw 画布，而是 Infinite Canvas 原生投影。 | 项目工作台中的“预览项目结构导入”；原生 Canvas 工具 `preview_xiaji_project_context`、`import_xiaji_project_context`、`arrange_xiaji_project_canvas`；工具桥见 `canvas-agent/index.mjs`、`canvas-agent/mcp-session.mjs` | 项目与原稿为必选，可逐项选择现有分集；不要求先建剧本/Beat。来源摘要变化会阻止过期导入。导入先持久化并回读节点，之后另行审阅排版/连线；保留已有节点/边及来源 ID。工具 schema 由已连接的 Canvas 页面提供，并由 `infinite-studio-canvas` 会话代理加入当次 MCP 工具清单；它们不在静态 JSON 工具表中。 | 投影逻辑、幂等身份、保存回读和两阶段计划已有测试/代码。页面真实浏览器操作、失败提示和刷新后对照未完成；MCP 实际连接/发现仍未验收。 |
| **单集剧本/Beat/虾塘关联 → 虾画** | 原生 Canvas 页面注册动态工具 `preview_xiaji_episode_context`、`import_xiaji_episode_context`、`arrange_xiaji_episode_canvas`；`episode-canvas-projection.ts`、`episode-canvas-projection-import.ts`、`episode-canvas-projection-arrange.ts`、Canvas Agent tool handler；已连接页面 schema 经 `canvas-agent/mcp-session.mjs` 代理到 `infinite-studio-canvas` | 可预览脚本、Beat、引用素材及可导入媒体，校验项目/分集关系和来源摘要；用户确认清单后导入已有原生节点模型，再单独确认最终布局/连线。旧静态 `import_local_assets` 已撤下；通用页面 `import_assets_to_canvas` 的 MCP 暴露和持久化仍未验证。 | 投影/导入/排版逻辑有定向单测。MCP 连接、工具发现/调用、Beat 上下文端到端传递、媒体读取/刷新保存、Network 和最终截图尚未在真实浏览器验证。 |
| **虾塘“发送到虾画”与 Canvas 内虾塘素材选择器** | `/xiaji` 的发送对话框；Canvas `components/xiaji-asset-picker.tsx`；`send-to-canvas.ts`、`assets-to-canvas.ts` | 都从 Infinite Canvas 本地素材读取并映射到原生节点；重复导入可识别，不覆盖既有节点/连线，也不自动生成媒体或连线。 | 模型、连接器和组件测试存在。两入口实际登录操作、保存回读、缺失媒体/部分失败提示及浏览器 Network 尚未 E2E 验收。 |
| **已移除范围** | 虾面、虾面/freezone、回主线、虾导、虾格、虾体 | 当前导航只列虾料、虾塘、虾镜；虾画是原生 Canvas 路由，不是第四个虾塘工作流模块。 | `freezone.lazy.tsx` 等仅作为历史来源/旧工作区记录，不是当前目标页面、入口或验收项。不得把旧实现状态写进当前导航或移植验收。 |

## 当前验证快照

- Web 虾X 范围回归：`web/src/features/xiaji`，42 个文件，218 pass、0 fail、907 assertions。新增虾料操作指引测试先 RED（2 fail、2 pass），修复后目标测试 4 pass。
- Canvas Agent：16 pass、0 fail（含 3 个集成测试）。
- Go `repository` / `service` / `handler` 包测试通过；未运行根目录 `bun test`，未运行 `go test ./...`。
- `bunx next typegen` 与标准 `bunx tsc --noEmit` 通过；Next 生产构建成功并生成 24 个页面。独立 standalone 启动在 Windows React symlink 解析遇到 EPERM，已恢复使用 `next start`；其 `output: standalone` 警告仍在。
- HTTP smoke：虾料/虾镜项目路由、本地画布项目 API、后端 health 返回 200。构建预渲染日志出现一条本地 Canvas API 暂不可用的非致命提示。
- `community_canvas.list_connected_canvases` 只读调用：`connections=[]`、`pageToolCount=0`、`dynamicToolCount=0`；没有选画布、导入或其他写操作。故动态虾料/虾镜工具本轮没有 live 目标可验证。
- 浏览器：当前无法通过 CUA 读取 UI 状态（枚举返回 `nodeRepl.fetch request failed`），此前用户浏览器停在登录页。故登录后完整流程、动态 MCP 实际调用、Network 面板、真实截图、麦克风/上传操作均**未验收**；静态检索不能替代这些结论。
- Web 源码静态检索未发现 `/xiaji` 页面直接请求 DramaClaw host/API、`DRAMACLAW_BASE_URL` 或调用 Canvas Agent turn 的证据；测试夹具中出现源 API 字符串不等于页面运行时流量测试。

## 收敛结论与后续验收门槛

- 当前具备同一项目身份、原稿/分集本地保存、虾塘本地素材、虾镜脚本/Beat 草稿、Agent 产物审阅入口和原生画布分阶段投影的代码基础；这些不等于真实浏览器端到端已成功。
- 页面模型生成已从目标虾料/虾镜流程中移除。原稿结构识别是本地标题解析；脚本/镜头由 Codex/Agent 在页面外创作，再导入审核。Canvas Agent 的画布生成能力是另一层，不能和静态 `infinite-canvas-core` MCP 混称。
- 虾塘来源交互还需完整逐控件视觉对照；虾镜草图/渲染/音频/视频阶段仍缺来源控件级移植与浏览器验证；合成导出缺目标端本地实现。
- 来源版本基线和本地文件差异见 [source-provenance.md](source-provenance.md)。来源许可证与目标仓库许可证兼容性未作法律结论，移植文件继续要求逐文件 SPDX/版权/依赖审查。
