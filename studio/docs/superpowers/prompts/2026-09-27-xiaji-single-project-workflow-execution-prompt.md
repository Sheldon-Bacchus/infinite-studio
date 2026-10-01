# 执行提示词：统一虾料、虾塘、虾镜与原生虾画项目

```text
请在当前 Infinite Canvas 工作区，按配套规格、架构和实施计划完成虾料、虾塘、虾镜与 Infinite Canvas 原生虾画的一体化。

开始前提
- 用户已于 2026-09-28 回复“通过执行”，本提示词已获批准并进入实施。下列实施前判断需以当前工作树复核；现有实现先验证再补缺，不重复覆盖或重做。
- 读取仓库 AGENTS.md、git status、目标文件 diff；保护所有既有改动，不 reset、不覆盖、不批量清理、不格式化无关文件、不提交。
- 先核实飞书手册相关章节/截图、integrations/dramaclaw/frontend 实际来源页面和组件、来源版本及逐文件许可证；无法读取/无法核实的部分列为 BLOCKED，不以猜测或 README 图片代替。
- 先按配套 architecture/spec/plan 执行一轮范围审阅。实际使用的 Skills、MCP、Serena/Repomix 和子代理须报告真实名称、调用方式及结果；未调用不得写成已审。
- 本版已完成一次 `gpt-6-sol / ultra` 只读审阅并吸收最后一轮意见；不要再次循环开审。若后续实现暴露了新架构问题，只报告具体证据与阻塞点。

产品边界
- Infinite Canvas 是主应用；一个影视项目只有一个 projectAssetId 根身份。虾料、虾塘、虾镜与关联虾画处在同一项目中。
- 虾画是 Infinite Canvas 原生画布。`CanvasProject.xiajiProjectAssetId` 记录关联；canonical 写入层必须原子约束一个 `projectAssetId` 至多关联一个有效 CanvasProject，冲突返回既有 Canvas ID。客户端预扫描/CAS 单画布 ID 不能替代唯一性。若现有保存机制做不到，暂停该部分，先给用户审阅最小服务端原子契约，不自行降级或扩边界。不得按标题匹配，不得另建脱节的虾镜项目。
- 按 DramaClaw 虾料、虾塘、虾镜真实页面复用/移植全部布局、控件、字段和交互。不得用通用简化素材页替代。飞书、来源组件和目标截图逐项对照。
- 本次只含虾料、虾塘、虾镜、原生虾画。排除虾面、虾导、虾格、虾体、回主线和写回功能。
- Codex/Agent 创作剧本、分集、制作拆解/Beat、资产分析、提示词和媒体。页面只收集输入、展示 Agent 产物、逐项审阅/保存并引导下一步。
- 页面不得把原文发送给用户配置的文本模型；不得自行发起剧本、镜头、图片、音频或视频生成；不伪造任务、进度或成功。视频生成完全不做。
- 不运行、部署或连接 DramaClaw，不访问其 host/API/DB/项目/任务服务，不要求 DRAMACLAW_BASE_URL 或 DRAMACLAW_API_TOKEN。
- 默认复用 Infinite Canvas 现有本地 Asset、媒体与 Canvas 保存能力，不新增 Go 路由/数据库/依赖。项目—画布绑定、提交级幂等若现有契约无法满足规格，先停下并提交有测试证据的最小差异，等待用户审阅后再扩边界。
- 可在已批准范围内调整现有 Go service/repository/current handler 并运行所改包的定向测试；只有新增路由、数据库表或新运行时依赖才需暂停并二次审阅。

目标流程
1. 原稿可以独立保存成项目；无分集、无模型配置时也能保存。标题识别若保留，必须是本地解析；没有标题返回空分集，不得把原文伪造成一集。虾料和虾镜脚本页都不能调用用户配置模型、不能把原文/脚本发给模型。保留源页面布局和完整创作区，把“生成脚本 / 逐行生成 / AI 改写 / 模型设置”适配为 Agent 产物接收/导入、版本对照、逐项审核和确认保存；不得删空来源步骤或保留隐蔽的模型请求。
2. Codex/Agent 产出带 `schemaVersion/packageId/projectAssetId/episodeAssetId?/stage/baseRevision/artifacts/relations/mediaAssetIds/contentDigest` 的结构化包。`packageId` 是包身份、`contentDigest` 是包正文摘要、`baseRevision` 是读取上下文的 canonical 快照摘要；不能混用。当前工作树已有 package、待审 handoff 和确认保存实现，先按契约验证，再用 TDD 补实际缺口。
3. MCP 暂存只把 Agent 包写入同一浏览器标签的待审交接记录，不创建 Asset ID、不写项目或画布。只有交接完整才报告暂存成功；包按 `projectAssetId/canvasId/packageId/contentDigest` 键控，可导航到虾料/虾镜审阅页并在刷新后恢复。会话容量不足时不截断，提供相同 schema 校验/审阅的本地 JSON 导入。用户确认保存后、发本地 Asset 请求前，才生成 Asset IDs、`commitId`、固定 payload/关系/时间戳并写入同标签恢复记录；确认前重读 canonical 关系与 `baseRevision`。目标 Canvas、项目绑定或内容版本变化则使待审包失效。
4. 项目页可创建/打开唯一关联的原生虾画。首先预览并导入项目、原稿和已确认分集，即使还没有剧本或 Beat。
5. 单集的已保存剧本、制作拆解/Beat、明确关联的虾塘素材和已有媒体随后按阶段预览、由用户确认导入。每步报告 ID 映射、重复、缺失、部分失败和保存回读。
6. 所有节点落盘并经用户检查后，再单独预览确定性排版与关系连线；依据确切 project/episode/script/beat/asset ID 建边，再等用户确认。不得覆盖已有节点/连线，不按标题猜关系。
7. 刷新后可以恢复本地项目、版本、导入映射和待审 handoff。保存超时后独立 canonical probe；如果原请求可能仍在执行或读取不确定，显示“保存结果待确认”，不报失败、不分配新 IDs、不盲目创建。明确重试只能复用原 `commitId`、IDs、payload 和时间戳；现有 API 若不能安全处理同尝试重放则暂停并报告需要的最小幂等契约。

项目卡片/详情、虾塘发送到虾画、画布内虾塘素材和直达 Canvas URL 必须调用同一个 canonical binding resolver；任何捷径都不得先开新画布再补项目关系。

MCP 边界
- 明确区分 `infinite-canvas-core` 静态 MCP、`infinite-studio-canvas` 画布页面动态 Agent 工具、虾料/虾镜页面内的本地导入控件。
- 当前已有的 preview_xiaji_episode_context / import_xiaji_episode_context / arrange_xiaji_episode_canvas 只能按实测 schema 与能力描述；不得声称它们能导入尚无 script/Beat 的原稿分集包。
- 检查 MCP 实际动态工具发现、所选 canvasId 与 xiajiProjectAssetId 是否吻合、页面断连/切换时是否失败关闭。新增 MCP 功能先写 RED contract tests。MCP schema 不证明人工审批；执行流程须在每次写入前展示摘要并停下来等用户明确同意。
- 受限的 `import_local_assets` 已撤下。页面源码仍有通用 `import_assets_to_canvas` action，但在核实其动态 MCP schema 和保存回读前，不宣称它已可端到端使用。

Skills 与工具流程
- 使用 Superpowers brainstorming / before-you-build 复核目标与首期；architecture-analysis、api-and-interface-design、architecture-patterns 建立边界/契约；已完成的 architecture-critic（gpt-6-sol/ultra）结论纳入本方案，不再循环重审；frontend-design 对照真实来源页面；test-driven-development 严守 RED → GREEN → REFACTOR。
- 需要代码上下文时使用 Serena 查符号/调用点；仅在跨目录上下文确实有助于移植时才使用 Repomix 的受限 includePatterns，不打包无关 integrations/、密钥或用户数据。逐项列明 Skill 名称/路径、MCP 工具实际调用及未调用项，不能把可用目录写成已调用。
- 对每个行为先写具体失败断言，单独观察 RED（不是语法、导入、环境错误）；实现最小代码观察 GREEN；重构后重跑相同范围。没观察到 RED 就标明偏差。
- 原子绑定必须有双标签并发 RED：只有一个 canvas 绑定成功，失败方返回现有 Canvas ID；客户端查重不算测试通过。提交恢复 RED 覆盖“原请求仍在跑/探测未找到/请求明确结束”；初始 Asset 事务按原子批次验证，不能伪造 partial。
- 根目录裸 `bun test` 会混扫 integrations 上游，不要再次用它判断本项目。只运行 `web/`、`canvas-agent/` 和必要 Go 包的目标测试；Go 命令列出精确包（如 `go test ./repository ./service`），禁止 `go test ./...`。

测试与验收
- 新建项目：不配置模型，粘贴原稿，无分集保存；重载仍能读取原稿与项目 ID；检查 Network/spy 没有原文模型请求。
- 保存故障：用户确认后、请求前固定 Asset IDs、commitId、payload、父子关系和时间戳；`commitId` 可从新建记录 metadata 查询，并把相同提交 envelope 留在同标签恢复记录。timeout 后独立 canonical 回读。原请求仍可能执行、读取失败或结果冲突时只能显示未知并保留原尝试；不得因暂时未找到而报失败或用新 IDs 重建。重试复用原尝试；若当前 API 不能安全处理并发重放则暂停并提出最小契约。初始 Asset 数据库批次具事务原子性，只有分阶段 Canvas projection 才按项报告 partial。
- 项目绑定：双标签/双请求并发 RED 验证同一项目至多一个 CanvasProject 成功，冲突方返回现有 Canvas ID；测试/实现需在 canonical 写入层原子保证，客户端查重不算通过。项目卡片、详情、虾塘发送、画布选择器均通过同一 binding resolver；跨项目导入拒绝，旧未绑定项目有明确关联路径。
- MCP：项目包预览不写数据；错误 project/episode、旧 baseRevision、重复 sourceKey、未知媒体和同 packageId 不同 digest 都有稳定错误；用户确认后才写并回读。源码/schema 和单测已有覆盖；MCP live 发现、浏览器待审/确认写入仍需实测，未取得证据前标 `BLOCKED`，不能按工具名推定通过。
- MCP handoff：Canvas 页完成暂存后，同一标签导航到虾料/虾镜页并刷新仍可恢复待审包；暂存成功后的连接断开不丢已交接包，尚未确认交接或响应丢失则保持未知并阻断确认；目标画布、项目绑定或分集/版本变化会失效；超出会话容量则不截断且可以本地 JSON 方式走相同审阅。确认前再次 canonical 读取。验证 `packageId/contentDigest/baseRevision/commitId/projectionId/manifestDigest` 各负其责，不再重复传含义相同的幂等键。
- 版本：待审新版本不改当前指针；确认一次后指向新版本；重复确认幂等；旧稿/Beat 保留。无标题原稿可保存，分集列表为空。
- 页面模型路径：虾料和虾镜脚本页面都通过网络 spy 证明无模型请求，无“生成脚本/逐行生成/AI 改写/模型配置”页面执行入口；用户从 Agent 导入可审核产物。
- 画布：无 script/Beat 时导入原稿/分集成功；之后导入单集制作内容；节点保存刷新后仍在；最终按清单连接节点；已有节点和边没有变化。
- UI：按控件矩阵和相同视口来源截图逐页检查虾料、虾塘四类资产、虾镜、待审包与虾画；明显缺项先修正。
- 在真实浏览器走完两条核心路径并分别报告单测、集成、MCP、E2E、smoke、TypeScript、浏览器、Network、截图的 PASS/FAIL/BLOCKED/NOT RUN。没有 Network 面板证据就明确写 BLOCKED。
- 使用经确认的 E2E-临时项目进行测试；完成后只清理这些临时数据并核验没有触及用户项目。
- 不生成视频，不对外发布，不提交代码。完成后列出剩余的来源能力缺口和未验证项目，等待用户审阅。
```

执行状态：用户已通过本提示词。继续按已批准范围实施并报告证据；若必须新增未批准的路由、数据库表、运行时依赖或产品范围，再暂停提交最小差异供审阅。
