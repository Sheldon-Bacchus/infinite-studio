---
title: 待测试
description: 当前版本已实现但仍需人工验证的变更项
---

> 本文件中的记录反映各自记录时点的实现与验证。统一项目方案已获用户授权并在实施；按每条记录注明已实现和仍待验证的范围，不能用历史数字代表当前验收。

# 待测试

- 单仓库整合内容：本仓库新增 Infinite Canvas 与社区 MCP 源码快照、来源记录及 Canvas 导演台静态目录；本次未运行安装、编译、测试或浏览器验收。需按 [`IMPLEMENTATIONS.md`](../../IMPLEMENTATIONS.md) 对照源码提交和许可证，并由用户确认所需功能与安装入口。
- 根应用工作流合并：包含 GitHub `main` 的 RunningHub / ComfyUI Bridge 更新与本地 Infinite Studio 改动；本次没有编译或运行服务。需按本项目安装入口手动验证工作流字段映射、提交/恢复、桥接预览和本地数据保存。
- Codex Agent 手动连接：网页新增本地地址和 Token 输入、直接启动命令及本地连接信息记忆；已保留对应测试源文件，但本次未运行测试。需手动确认插件自动连接、手动 Token 连接、刷新后保存、断开及错误提示。

- 画布整组拖入视频配置与 AutoDL 引用槽适配：组标题旁新增拖动柄，将整组拖到视频配置节点后，只复制绑定组内提示词、图片、视频和音频到配置，不移动组或配置节点，也不提交生成；空节点、组外引用、非视频配置会显示错误。AutoDL 使用实时工作流 `input_rules` 限定的输入槽，超出数量或缺少首尾帧槽时在上传素材前报错。配置恢复逻辑已调整为保留用户保存的 AutoDL 渠道和工作流，H3 预设仅作为新配置默认值。未操作浏览器或运行测试/构建；需手动验证整组绑定、刷新后保留、AutoDL 配置重载及各槽映射和超限提示。此仓库没有用户 AutoDL 账户中的完整工作流 JSON，因此本变更不修改远端 JSON。

- 桌面“无限画布”快捷启动器：前端固定端口由 `3000` 改为 `43861`，启动检测、旧进程识别、Next.js 生产/开发启动和自动打开地址都已同步；保留对非本项目进程的拒绝停止保护。本轮未启动服务或运行测试。

- 统一虾料/虾塘/虾镜/原生虾画实现（2026-09-28）：最新 `web/src/features/xiaji` 定向范围测试为 42 个文件 218 pass / 0 fail / 907 assertions；`canvas-agent/` 16 pass / 0 fail；`go test ./repository ./service ./handler` 通过；`bunx next typegen` 与标准 `bunx tsc --noEmit` 通过。为清除 tsc 阻塞，只删除了 Git 忽略且指向已删除 `freezone/page.js` 的陈旧 `.next/dev/types/validator.ts`。最新 Next 16.2.9 production build 通过（编译 23.7 秒，24 个静态页面）；预渲染期间一条本地 Canvas API 访问告警未阻断 build。`next start` 可正常响应，但 Next 对 `output: standalone` 发出启动警告；直接 standalone 启动在 Windows 因打包依赖符号链接 `EPERM` 失败，随后恢复为 `next start`。`/xiaji/ingest`、`/xiaji/projects` 与后端 `/api/health` HTTP smoke 均返回 200。CUA 浏览器控制仍返回 `nodeRepl.fetch request failed`。本轮只读调用 `community_canvas.list_connected_canvases` 得到 0 连接、0 页面动态工具；此前浏览器页面要求登录。登录后 E2E、MCP 动态导入调用、Network 和来源/目标截图对照未验证。根目录裸 `bun test` 与 `go test ./...` 本轮未运行；逐项状态见[计划](../superpowers/plans/2026-09-27-xiaji-single-project-workflow.md)。

- 虾料可用性与项目列表修正（2026-09-26）：已修复 Markdown 形式“# 第一集/## 第二集”标题不能识别的问题；未识别分集标题时会把原文作为可检查的一集草稿，界面说明保存所需步骤；无文本模型时主按钮现在打开模型配置，不再显示配置却实际发起生成；保存按钮按项目名、原文、分集预览和保存状态显示禁用原因。虾镜项目列表的新建入口明确标成“虾料新建项目”，并加入本地项目及其原稿/分集/剧本/镜头/虾塘资产的确认删除；若其他虾镜记录或画布节点仍引用这些记录则阻止删除。定向 TDD 最终 `bun test` 4 个文件 25 pass / 0 fail / 54 assertions；RED→GREEN 的单测不等于浏览器 E2E。`bunx tsc --noEmit` 仍只报告旧 `.next/dev/types/validator.ts` 引用了已删除的 `freezone/page.js`。尚未在当前浏览器实测按钮、保存、删除或刷新；删除素材记录不会物理删除已上传媒体文件。
- 根目录裸 `bun test` 的历史数字来自宽范围混合扫描，不是虾料新测例的结果：计划记录为发现 487 个文件、1320 个测试项、763 pass、557 fail、334 errors；`763 + 557 = 1320`，因此 errors 不能再简单加到 fail 上当作 891 个独立失败。仓库目前没有找到该命令逐文件原始输出或失败清单，不能据这些汇总数字归因到虾料/虾镜，也不能声称该命令里的失败都已修复。详见[历史执行计划记录](../superpowers/plans/2026-09-25-xiaji-beat-context-canvas-import.md)。
- 虾镜 Beat 上下文 → 原生虾画（[规格](../superpowers/specs/2026-09-25-xiaji-beat-context-canvas-import.md)、[计划与执行记录](../superpowers/plans/2026-09-25-xiaji-beat-context-canvas-import.md)、[架构](../architecture/2026-09-25-xiaji-beat-context-canvas-import.md)）：2026-09-26 6sol 审阅发现四项缺陷并修复；`bun test web/src` 59 files / 271 pass / 0 fail / 1008 assertions，`bun test canvas-agent` 25 pass / 0 fail，`go test ./... -count=1` 全包通过。生产前端重新构建后监听 127.0.0.1:3000；API /api/health 200；Canvas Agent 3210 仍运行。标准 `tsc` 仍被 `.next/dev/types/validator.ts` 对已删除 freezone 页面引用阻断。CUA 拒绝本地页面读取，`community_canvas.list_connected_canvases` 返回零连接、零动态工具；浏览器 E2E、真实导入、刷新、并发、Network、截图与页面 smoke 未验证。仓库根目录裸 `bun test` 扫描 426 个集成来源测试文件后报 557 failures / 334 errors，未完成逐项归因；不要把该宽泛扫描与当前应用 scoped 测试混报。
- 桌面“无限画布”快捷启动器（历史记录，早于本轮移除虾面）：2026-09-25 已验证默认生产模式完整构建后再开放页面；当时路由清单包含虾料/虾塘/虾镜/虾面页面。服务健康和 `3000 -> 8081` API 桥接通过，`-NoOpen` 不另开系统浏览器；不变更源码的二次启动复用已构建服务。需要热更新时用 `-Development`，其首次访问仍会按路由编译。
- 统一本地工作区：用 Edge 与内嵌浏览器分别打开 `/canvas` 和“我的素材”，确认首次迁移后项目及素材列表相同；删除一条素材/画布，确认另一页面约 3 秒内消失且重载不复活。
- 画布 ZIP 幂等：同一 ZIP 连续导入两次，确认项目数不增加；删除同 ID 项目后再次显式导入，确认只恢复一个项目；导出包含 `server:<id>` 媒体的画布并重新导入，确认媒体可读。
- 共享媒体保护：一张媒体同时被画布与素材引用时删除素材，确认画布仍能打开；解除最后引用后删除，确认媒体才可清理。
- 旧素材迁移：在一个仍有 LocalForage 旧数据的浏览器首次进入“我的素材”，确认图片/视频/音频媒体已转入本地工作区；旧缓存应保留，重复进入不应新增素材或媒体副本。
- 大文件上传：确认接近本地上传限制的媒体能够流式上传；删除磁盘文件但保留 SQLite 索引后重复上传同内容，确认复用原对象并恢复文件。
- 本地 Agent：`npx -y @tigerowo/canvas-agent@latest` 默认监听 3210；进入 `/canvas/[id]` 后通过插件/Token 建立连接。
- Agent / MCP 目标锁定与工具刷新：安装 `@tigerowo/canvas-agent@0.2.0` 后，在至少两个画布同时连接时用 `list_connected_canvases` 查看 ID，按目标 `canvasId` 调用 `select_canvas`；确认摘要 ID 与选中 ID 一致、未锁定时不执行画布工具、同画布多标签必须指定 `clientId`；重新连接后确认 `tools/list_changed` 会刷新新增/更新的工具，并确认断开目标后旧工具不再调用其他画布。
- [历史状态，早于本轮浏览器 E2E] DramaClaw 虾料/虾塘/虾镜/虾面本地移植（2026-09-25；[规格](../superpowers/specs/2026-09-24-dramaclaw-local-creative-suite.md)、[计划](../superpowers/plans/2026-09-24-dramaclaw-local-creative-suite.md)、[来源控件矩阵](../superpowers/artifacts/dramaclaw-local-creative-suite/source-to-target-matrix.md)）：本轮在 `web/` 执行 `bun test` 为 57 files、249 pass、0 fail、926 expect；本地 TypeScript 检查通过；Turbopack 生产构建成功（编译 15.6 秒，静态页生成期间因后端不可用记录两条读取/持久化告警）。修复了无项目上下文时“虾面”导航回到项目列表的缺陷，并增加导航模型测试。运行中的 3000 前端未能安全重启，浏览器还未确认新禁用态。CUA 曾在生产模式打开 `/xiaji/projects` 并显示空项目状态；这只验证了该路由可加载，登录后创作/发送/回主线/刷新 E2E 未运行。来源/目标逐控件和同尺寸截图比较未完成；逐文件 SPDX/license manifest 和维护者许可审阅未完成。无本地等价能力的 Director World 3D 操作、多镜头成片/混音保持未实现并需在 UI 如实禁用说明。仓库根目录执行的 `bun test` 会把 `integrations/dramaclaw/frontend` 的上游测试也纳入，产生缺依赖/错误工作目录等失败；其中另有一条 MCP 工具清单断言失败，不能将该根目录结果算作虾X验收。
- 新增系统 Skills：DramaClaw 画布导入、DramaClaw 画布排版、H3 画布提示词与 AutoDL 工作流。已有数据库启动一次后需重启后端，确认新增 Skill 出现在画布 Agent 的 Skill 面板。
- 本地素材包导入（历史记录）：记录了素材导入、节点回读与素材分组结果；具体用户素材、媒体包和创作内容未收录到公开仓库。需以当前代码重新执行验收。
- 虾料/虾塘/虾镜浏览器 E2E（2026-09-25；虾面不在本轮）：最新续跑已通过虾料保存/刷新、项目内虾塘角色/身份/场景/变体/道具/声线槽位持久化子集，以及虾镜分集/Beat/合成页交互。发现剧本保存后刷新为空、Beat 保存 toast 误报、枚举和身份名称显示异常。首轮 Next chunk 404 在续跑中未复现（当前响应 200），历史根因未知。14 个临时 Asset 精确清理后回到原基线。媒体操作、重复序号、伪造跨项目引用、DevTools Network、来源截图对照未完成；单测、集成、TS、build 本轮未运行。详见[运行记录](../superpowers/artifacts/dramaclaw-local-creative-suite/e2e-run-2026-09-25.md)、[验收规格](../superpowers/specs/2026-09-25-xiaji-three-module-e2e-validation.md)、[计划](../superpowers/plans/2026-09-25-xiaji-three-module-e2e.md)和[架构切片](../architecture/2026-09-25-xiaji-three-module-validation.md)。
- 当前范围变更（2026-09-25）：导航中的“虾塘”入口更名为“无限虾”；虾面页面、Freezone 路由、专用素材库及回主线实现已删除，旧内部记录仍会从用户素材列表隐藏。聚焦测试 4 项通过；应用源码类型检查通过（排除测试和旧 `.next` 类型），标准检查仍受旧 Freezone 路由生成引用阻塞。本次未构建、重启或做浏览器验收；当前 3000 页面可能继续显示旧构建。旧四模块规格/计划已标注为历史。
- 本地模型预设：已将默认本地渠道强制收敛为 AutoDL `minimax_h3_image_audio_to_video_v2_15s`，默认 15 秒/768p/竖屏；API Key 保留为空，由用户最后填写；旧渠道和其他模型仅清理配置记录，不影响画布资产。
- AutoDL H3 本地参考素材：H3 15 秒工作流的本地图片/音频引用可在浏览器端转为 Base64 直传，不依赖公开云存储 URL；待用户填写自己的 API Key 后，在画布实测图片与长音频均进入 H3 请求且生成成功，并确认其他 AutoDL 工作流仍保持原限制。
- Agent / MCP 名称与连接：源码配置现将主画布 MCP 命名为 `infinite-canvas-core`，无限片场 MCP 命名为 `infinite-studio-canvas`。用户报告 community-canvas 已卸载且 Codex 插件列表只有一个；本轮没有读取或改写 Codex 全局配置。需在重新注册/重载后确认工具区显示正确命名，并单独验证多画布切换。
- MCP 核心画布工具固定清单：受限 `import_local_assets` 已从静态 schema、页面 action 注册与 dispatcher 移除；静态清单现为 15 个稳定工具。现有页面 action `import_assets_to_canvas` 仍在源码中，运行时是否动态暴露、支持的素材类型及保存后刷新回读都未验证。本轮未运行测试或构建。
- 社区 MCP：插件清单和服务端源码已改用 `infinite-studio-canvas` MCP 名称，Codex 内部启动配置和 Claude 工具白名单也已同步；插件仍未安装，且其 manifest 仍通过 npm `@basketikun/canvas-agent@latest` 启动，故本地源码改动不会自动改变已发布包。
