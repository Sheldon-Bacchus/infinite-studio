# 虾塘前端复用与虾画连接器实施提示词

请在本仓库根目录按照以下规格和计划实施。开始前先读取：

- `docs/superpowers/specs/2026-09-24-xiaji-xiahua-frontend-connector.md`
- `docs/superpowers/plans/2026-09-24-xiaji-xiahua-frontend-connector.md`
- 仓库 `AGENTS.md`、当前 `git status --short` 及每个目标文件的现状/diff。

## 目标

复用 DramaClaw 虾塘的真实前端页面和组件到 Infinite Canvas。虾塘是 `/xiaji` 独立全页；虾画仍是 Infinite Canvas。提供虾塘全页“发送到虾画”和画布内“虾塘素材”选择器，两者共用一个单向前端连接器，将 Infinite Canvas 本地素材添加成画布节点。

## 硬约束

1. 不运行、安装、部署或连接 DramaClaw。不得要求或读取 `DRAMACLAW_BASE_URL` / `DRAMACLAW_API_TOKEN`；不得调用 DramaClaw host、`/api/v1/drama/*`、DramaClaw 数据库或其任务 API。
2. 不移植 DramaClaw 后端、数据库、项目 CRUD 服务、任务系统、MCP、生成或写回。不要新建 Go 路由、泛化 jobs/projections 服务、假数据或需要配置的连接设置。
3. 虾塘 UI 从 Infinite Canvas 现有本地素材 store 读取；媒体上传和画布保存复用 Infinite Canvas 现有接口。数据为空时显示真实空状态。
4. 移植的是虾塘前端，不是 DramaClaw Freezone 画布。保留虾塘独立整页；Infinite Canvas 画布继续用自身节点、连线、store 和布局。
5. 不破坏现有用户改动。任何移除/重构先查 `git status`、目标 diff 和引用范围；不做全树重置，不批量回滚，不动 `integrations/dramaclaw` 源码快照。
6. 按文件核验源许可并保留 SPDX/版权/来源信息；不宣称 Elastic-2.0 与目标许可兼容。

## 工作步骤

1. 先按 Superpowers brainstorming 判断为前端复用与轻量集成，复核 before-you-build 首期边界；只读清点 DramaClaw 虾塘页面、实际组件、前端依赖、界面截图与许可证，并检查目标本地素材 store 和画布节点契约。确认全页路由、UI 页面清单和精确修改文件后再编码。
2. 按 architecture-analysis、api-and-interface-design、architecture-patterns 定义唯一数据路径：本地素材 `Asset[]` → 复用媒体存储 → 现有 Canvas 节点/store。不存在 DramaClaw runtime/API 层。
3. 按 frontend-design 移植并适配真实虾塘页面结构、分类和排版；通过 Infinite Canvas 主题和路由呈现，不把虾塘改成侧栏。源端依赖后端的操作不得显示成已经可用的功能。
4. 全程遵循 test-driven-development：每个行为先写失败测试并运行 RED，再做最小实现运行 GREEN，最后 REFACTOR 并重跑相关验证。
5. 连接器只映射 Infinite Canvas 当前支持的文本、图片、视频、音频节点。素材 ID 用于重复识别；不覆盖旧节点/连线、不自动连线、不触发生成。逐项报告成功、已存在、格式不支持、媒体/上传失败和保存失败。
6. 最后用真实浏览器走完 `/xiaji` → 新建/已有画布，以及 `/canvas` → 当前画布选择器两条路径。运行适当单测、集成测试、E2E/smoke；保存关键页面截图，并检查 Network 请求确认无 DramaClaw host/API 访问。报告必须把不同测试层级分开，未运行的不得说通过。
7. 用 architecture-critic 独立检查：是否仍有强制 DramaClaw runtime/API；是否只做前端复用和单向 Canvas 连接；页面与截图是否对应真实 DramaClaw 虾塘；节点和媒体是否持久化；错误/重复行为是否诚实；是否越界加入了后端、生成或写回。

Superpowers 顺序：brainstorming → 规格/计划核对 → TDD 实施 → architecture-critic。使用 skills：`before-you-build`、`architecture-analysis`、`api-and-interface-design`、`architecture-patterns`、`frontend-design`、`test-driven-development`、`architecture-critic`。MCP 默认不调用：源代码已在 `integrations/dramaclaw`；只有确实缺少上游源码证据时，才对 GitHub 做只读核验。不要调用生成类 MCP、AutoDL 或其他外部生成任务。

完成时说明具体改动文件、截图位置、TDD/E2E/smoke 各自实际结果、Network 检查结果和仍未覆盖的页面/操作。不得把 mock 测试写成真实页面验收。
