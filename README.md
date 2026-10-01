# 无限片场 · Infinite Studio

## Windows 本地快速启动

无限片场仍按自身运行配置使用本地端口、SQLite 和媒体目录；无限画布与 MCP 的来源快照位于本仓库的 `implementations/`。目录、来源版本和许可证见 [`IMPLEMENTATIONS.md`](IMPLEMENTATIONS.md)。

1. 安装 Go、Node.js 和 Bun。
2. 在本仓库根目录运行：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1
   ```

3. 浏览器会打开虾料工作区：`http://127.0.0.1:43862/xiaji`。API 为 `http://127.0.0.1:8086`。
4. 本地数据库与媒体位于 `data/`，属于机器本地数据，不纳入 GitHub 仓库。
5. 关闭浏览器后服务会在后台待机。需要停止服务时运行：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1 -Action Stop
   ```

完整逐步说明见 [`docs/local-quick-start.md`](docs/local-quick-start.md)。此启动器只启动无限片场；MCP、Agent 与 Bridge 的来源和启动说明见 [`IMPLEMENTATIONS.md`](IMPLEMENTATIONS.md)。

<p align="center"><strong>把剧本、角色场景、分集镜头和画布创作，放进同一个影视项目。</strong></p>

无限片场以 Infinite Canvas 原生画布为基础，把影视项目的前期材料、资产和镜头整理放进同一工作台。创作者可以沿项目查看各阶段的输入、产物和审核状态，再按需把已保存内容导入对应画布。

## 工作台

- **虾料**：创建项目、导入原稿，并检查已有的分集结构。
- **虾塘**：整理角色、身份、场景、道具、声线和关联媒体。
- **虾镜**：按项目和分集查看剧本、镜头（Beat）及制作资料。
- **虾画**：使用 Infinite Canvas 原生画布，导入、审阅和编排项目内容。

剧本、镜头和媒体由创作者与 Agent/Codex 推进。页面用于组织项目、接收和审核产物、保存内容并衔接画布；页面不会把原稿自动发送给文本模型，也不会自行启动剧本、镜头或媒体生成。

## 一个项目贯穿创作阶段

虾料、虾塘、虾镜和对应虾画共享同一个本地项目身份。原稿与分集可先进入画布；之后再按阶段挑选已保存的剧本、镜头和明确关联的素材。导入前可以检查清单，导入后再审阅布局与关系。来源 ID 和版本关系随内容保留；不会按名称猜关系，也不会静默覆盖已有画布内容。

## 当前状态

本仓库以无限片场为主项目，并收录无限画布与社区 MCP 的完整源码快照及文档。各快照保留各自的运行方式和许可证；工作区历史测试记录、已验证项目与仍需手动验收的内容见 [`docs/progress/pending-test.md`](docs/progress/pending-test.md) 和 [`IMPLEMENTATIONS.md`](IMPLEMENTATIONS.md)。本次整合没有运行构建或测试。

本项目不连接 DramaClaw 服务。

## 代码来源

- 本项目基于 [Infinite Canvas](https://github.com/tigerowo/infinite-canvas) 继续开发，保留上游来源与版权信息。
- Infinite Canvas 与社区 MCP 的源码快照、提交来源和许可证分别记录在 [`IMPLEMENTATIONS.md`](IMPLEMENTATIONS.md)；不会把不同许可证合并成一个声明。
- 虾塘部分前端代码复用并适配自 [DramaClaw](https://github.com/dramaclaw/dramaclaw)；来源版本、文件映射和许可证记录见 [`docs/superpowers/artifacts/dramaclaw-local-creative-suite/`](docs/superpowers/artifacts/dramaclaw-local-creative-suite/)。
- 上游版权、SPDX 标识和各来源文件的许可证声明按文件保留。基础仓库的许可证见 [LICENSE](LICENSE)；本说明不代表不同许可证已自动兼容。
