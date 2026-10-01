# Infinite Canvas 开发流程与 Superpowers 文档索引

本文是本仓库的 Superpowers 开发流程入口。它说明规格、计划、审查、TDD 与验收文档各自何时使用；不替代根目录 `AGENTS.md`、用户确认或功能规格。

## 当前创作模块范围

- 当前工作台：虾料、虾塘、虾镜；虾画使用 Infinite Canvas 原生画布。
- 虾面、虾导、虾格、虾体和“回主线”已从当前产品范围排除。旧文档保留作历史证据，不能当作本轮实施要求。
- 当前产品目标：一个本地 `projectAssetId` 对应虾料、虾塘、虾镜和唯一关联的原生虾画；页面不发起模型创作；Codex/Agent 产物须经用户检查后保存；原稿/分集与单集制作内容可分阶段导入画布，最后才排版连线。
- 当前统一项目方案处于实施中（用户已于 2026-09-28 通过执行）。已有代码覆盖无分集保存、提交 envelope/结果恢复、项目—画布绑定、Agent package handoff/确认、初始项目结构投影和单集投影/排版；虾X 42 个测试文件 218 pass，production build、标准 TypeScript 与 HTTP smoke 通过。来源视觉对照和登录后完整浏览器流程未验收；MCP 只读查询当前为零连接、零动态工具；Network 与截图对照尚未验收。不要把源码或单测状态当作完整产品验收。
- 当前实施权威文档：
  - [统一项目架构](../architecture/2026-09-27-xiaji-single-project-workflow.md)
  - [统一项目规格](specs/2026-09-27-xiaji-single-project-workflow.md)
  - [统一项目 TDD 实施计划](plans/2026-09-27-xiaji-single-project-workflow.md)
  - [实施提示词](prompts/2026-09-27-xiaji-single-project-workflow-execution-prompt.md)
- 2026-09-25 的 Beat 导入文档降为历史实现记录，不能作为当前范围或验收结论。
  - [尚未完成事项](../progress/todo.md) 与 [待测试事项](../progress/pending-test.md)

## 每轮工具与审阅记录

本文件列出适用流程，不固定声称某一轮已读取或调用技能/工具。每次任务在交付记录中单列实际读取的 Skills、MCP 清单及参数、实际调用情况、子代理模型/档位与审阅范围；未调用、不可用、未验证的能力明确标出。DramaClaw 服务与媒体生成不属于当前连接器调用范围。

## 开发门禁

### 1. Brainstorming 与范围分类

先按 Superpowers `brainstorming` 判断 spike、bounded change 或 architectural change。范围、目标或成功条件已明确时，复述为短设计摘要，不重复询问已确认事项。发现接口、数据模型或多个子系统变化时升级为 architectural design。

Architectural change 的执行顺序：形成设计 → 用户审阅规格 → 架构 critic 复核 → 用户审阅计划并确认执行方式 → 实施。一个阶段的“通过”只批准已展示的内容，不自动批准尚未写出的计划或代码。此前已确认的产品决策可直接作为规格约束。

### 2. Before-you-build 与架构

开工前读取 `git status`、目标文件 diff、调用路径、canonical 数据持久化与错误恢复边界；记录脏工作区，不 reset、不覆盖、不批量清理。

使用：

- `before-you-build`：范围、首期、主导风险、成功证据。
- `architecture-analysis`：组件边界、状态/数据流、持久化、故障恢复与迁移成本。
- `api-and-interface-design`：工具/API 输入输出、错误语义、稳定 ID、幂等与兼容规则。
- `architecture-patterns`：适用的边界/依赖方向和模式，不因模式名称增加无必要层次。
- `architecture-critic`：实现前独立检查需求追踪、状态所有权、接口、失败恢复、测试可验证性与复杂度。

评审记录要列审阅范围、模型/档位（若有）、发现及处理；未实际调用子代理/MCP 时如实说明。

### 3. Superpowers Writing Plans

规格确定后，按依赖顺序列出确切文件职责、接口、测试文件和可执行验证命令。每个任务形成一个可以单独拒绝/验收的交付；避免 TBD、宽泛的“补错误处理”、或把测试行为写成实现结论。计划写明 Review Focus、全局约束、真实文件路径及依赖。

### 4. Test-Driven Development

功能、缺陷、重构和行为变化逐项执行：

1. 对尚不存在的新模块，先建立能被测试导入的最小公开接口和稳定测试夹具；这一步不实现目标行为，也不把 stub/模块缺失当作 RED。
2. 写一条描述具体用户行为的失败断言。
3. 单独运行并观察预期 RED；失败必须来自该行为尚未实现的断言，而非语法、模块导入、工具注册前的编译失败或环境错误。记录命令和关键失败断言。
4. 写通过该断言的最小实现，单独运行观察 GREEN，再运行相关回归。
5. REFACTOR 后重跑相关测试，保持行为不变；若某项未观察到有效 RED，明确标记为 TDD 偏差并说明原因。

未观察 RED 不得写“按 TDD 完成”。构建配置/生成产物等例外必须明确说明；除非用户授权，不扩大到无关测试套件或安装依赖。

### 5. 验收与完成声明

按实际适用项分别报告单元、集成、MCP 代理、E2E、smoke、类型检查、build、浏览器、Network 和截图。每项使用 `PASS`、`FAIL`、`BLOCKED`、`NOT RUN` 并附证据；测试通过不代表浏览器路径通过，静态检索不代表 Network 通过。仅在本轮重新执行相应验证命令后报告通过。

Next.js 项目需先用仓库安装的 CLI 生成当前路由类型，再运行标准 TypeScript 检查。若报错来自已删除路由的 `.next/dev/types` 旧文件，先确认没有开发服务器使用该目录，再只清理该生成目录；不得把 `next build` 成功当作类型检查通过，尤其当配置启用了 `typescript.ignoreBuildErrors`。浏览器验收需分别确认服务启动和 CUA 浏览器发现；任一不可用都标记 `BLOCKED`，不能以静态代码检查代替真实 UI、Network 或截图证据。

用户逐步审阅的操作必须在每个写入阶段前停下：先展示只读结果；收到明确回复后才按调用流程写入；再次展示结果并确认后才进入下一写入阶段。除非工具本身实现并验证了授权检查，MCP 参数/schema 不能强制或证明人工审批。工具 schema 存在不等于功能已运行，返回节点 ID 不等于 canonical 保存成功。

## 相关 Skills 与工具声明

| Skill | 文件路径 | 用途 |
|---|---|---|
| `before-you-build` | `~/.codex\skills\before-you-build\SKILL.md` | 先定目标、首期范围和主风险 |
| `architecture-analysis` | `~/.codex\skills\architecture-analysis\SKILL.md` | 系统边界、状态/数据流、持久化与恢复 |
| `api-and-interface-design` | `~/.codex\skills\api-and-interface-design\SKILL.md` | 工具契约、参数、错误、幂等和兼容 |
| `architecture-patterns` | `~/.codex\skills\architecture-patterns\SKILL.md` | 选择必要的模块边界和依赖模式 |
| `architecture-critic` | `~/.codex\skills\architecture-critic\SKILL.md` | 实现前独立审查方案和可验证性 |
| `frontend-design` | `~/.codex\skills\frontend-design\SKILL.md` | 对照真实来源页面审查布局、控件和产品视觉适配 |
| `test-driven-development` | `~/.codex\skills\test-driven-development\SKILL.md` | RED → GREEN → REFACTOR 行为开发 |
| Superpowers `brainstorming`、`writing-plans`、`executing-plans`、`subagent-driven-development`、`verification-before-completion` | `~/.codex\plugins\cache\openai-curated-remote\superpowers\6.4.2\skills\<skill-name>\SKILL.md` | 讨论定界、规格/计划、实施和验证门禁；逐任务记录实际使用项 |

MCP 必须按真实工具边界描述。主画布 MCP 使用 `infinite-canvas-core`，无限片场 MCP 使用 `infinite-studio-canvas`；网页中的 Canvas Agent action registry 负责向已连接页面转发动态工具，虾料/虾镜页面负责本地保存。受限 `import_local_assets` 已从源码注册与 dispatcher 撤下；页面源码另有通用 `import_assets_to_canvas`，但它当前是否经 MCP 动态清单暴露、能否保存并刷新回读仍未验证。项目/单集投影与 Agent 包工具同样需要实际连接后的 live 验收，不能把源码注册等同于运行时可用。

本项目可用的代码研究 MCP 包括 Serena（符号、引用和调用点查询）、Repomix（按 include/exclude 规则打包代码上下文）与 Context7（查询库文档）；每轮只调用任务实际需要的工具，并记录结果。方案研究阶段的调用和审阅记录见配套文档；本次实现续跑未调用 Serena、Repomix、Context7 或 `community_canvas`，未执行 live MCP 画布操作。早期只读子代理 `gpt-6-sol / ultra` 的架构意见已吸收到方案；本轮未再次启动子代理。

不连接 DramaClaw MCP/API/数据库，不调用图像、音频或视频生成 MCP。每项任务记录“可用工具”“实际调用”“未调用/不可用”三列；仅在真实工具定义和调用结果都可查时标为可用或已调用。
