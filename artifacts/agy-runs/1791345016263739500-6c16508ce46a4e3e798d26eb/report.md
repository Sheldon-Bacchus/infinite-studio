# AGY Run｜画布视频 Subject 与多模态绑定计划审查

> 状态：completed · 模式：review  
> 模型：unknown（状态结果未返回 resolved model）· Run：1791345016263739500-6c16508ce46a4e3e798d26eb

## 结论

方案暂不宜直接实施。先明确默认模型能力声明，并修正异步任务与快照保存时机；不要根据 `apiFormat` 自动推断媒体支持。AGY 的结论为 **revise first**。

## 快速摘要

- 范围：`docs/superpowers/plans/canvas-video-subject-media-bindings.zh-CN.md`，以及审查资料包中列出的项目规则、交接记录和相关源码副本。
- 发现：P1 1 · P2 2 · P3 3；另有一项可缩小检查范围的建议。
- 审阅：AGY 完成只读计划审查；当前 GPT 随后核对了主要引用与结论，没有启动第二个 AGY reviewer。
- 变更：只新增本报告并更新 `docs/HANDOFF.md`；没有修改计划或业务代码。

## 优先处理

默认配置把 `grok-imagine-video` 设为视频模型，但没有输入能力声明；计划又规定缺失声明时媒体输入报 unsupported。实现前需要为已核实的内置模型明确配置能力，或明确接受默认媒体输入不可用。不能仅因渠道使用 OpenAI 兼容协议就推断模型支持引用媒体。

## 审阅

- 触发依据：用户要求“只审查”，并要求通过 AGY MCP 执行。
- 审阅执行者：AGY MCP 默认代理（模型标识未返回）；当前 GPT 负责结果核验。
- 方法与工具：AGY 在隔离临时目录中审阅计划和所选源码副本，未访问仓库目录；GPT 对照当前工作区对应文件作只读核对。
- 结论：`revise first`。已确认五项 AGY 发现需要修订，另确认一项快照模型标识歧义；纯文本确认问题未确认为缺陷。存储清理发现用于缩小计划范围，不要求改造存储实现。
- 未解事项：没有核实真实模型服务端对媒体输入的具体支持；未执行请求或生成验收。

## 发现事项

### [P1] 默认视频模型缺少显式输入能力

- 来源：AGY 报告；Codex 已核对
- 位置：`studio/web/src/stores/use-config-store.ts:80-103`、`studio/web/src/components/layout/channel-editor-drawer.tsx:37-40`、计划 `docs/superpowers/plans/canvas-video-subject-media-bindings.zh-CN.md:67,154-157`
- 证据：默认渠道把 `grok-imagine-video` 设为视频模型，但没有 `videoInputCapabilities`。新选模型也只写入名称和一般 capability。计划规定能力缺失时媒体输入 unsupported。
- 影响：默认模型若未获得明确能力声明，画布多模态输入无法使用；如果实现者按协议自动回退，又会把 API 传输格式误当作模型能力。
- 建议：为已核实的内置模型添加明确声明；其他模型通过模型配置显式选择注册 adapter 和能力。未核实的模型继续显示 unsupported，不按 `apiFormat` 推断。
- 核对：源码和计划已核对；模型真实端点能力未验证。

### [P2] 生成开始后的草稿变化不应取消已确认快照

- 来源：AGY 报告；Codex 已核对
- 位置：计划 `docs/superpowers/plans/canvas-video-subject-media-bindings.zh-CN.md:61,196,200,219`
- 证据：计划先校验已保存的确认指纹，再规定从不可变快照准备素材；之后又要求重读实时草稿并重算指纹。
- 影响：用户点击生成后继续编辑下一轮提示词或调整画布，可能取消正在准备的任务，尽管该任务已经绑定到确认快照。
- 建议：生成启动时固定本次快照；异步阶段只验证快照 locator 可读、绑定内容版本可用，或响应用户主动取消。不要用当前草稿或重新展开的 Group 状态覆盖已确认快照。
- 核对：计划文本已核对；这是计划内部流程冲突，未运行代码验证。

### [P2] 应在发送生成请求前保存结果节点快照

- 来源：AGY 报告；Codex 已核对
- 位置：计划 `docs/superpowers/plans/canvas-video-subject-media-bindings.zh-CN.md:62,198`；现有节点创建与错误路径见 `studio/web/src/pages/canvas/project.tsx:2562-2588,2755-2770`
- 证据：计划写成“请求成功后”保存快照，但生成节点在异步请求前就创建；请求失败也会留下错误节点。
- 影响：如果请求失败或响应丢失时快照尚未落到结果节点，失败节点无法按计划从相同输入重试。这里的“请求成功”也可能被理解为远端生成完成。
- 建议：在结果节点创建并开始准备请求时先保存本次不可变快照；后续无论请求成功或失败都保留它。重试复用同一快照，不因此宣称远端请求具备幂等性。
- 核对：计划与现有节点生命周期代码已核对。

### [P3] 快照应保存渠道限定的模型标识

- 来源：Codex 核对补充
- 位置：计划 `docs/superpowers/plans/canvas-video-subject-media-bindings.zh-CN.md:90`；模型值编码见 `studio/web/src/stores/use-config-store.ts:379-405`
- 证据：配置选择值通过 `encodeChannelModel(channelId, model)` 编码，同名模型可按渠道区分；计划只定义 `model: string`，未说明存显示名称还是该完整选择值。
- 影响：重试恢复时若只存模型名称，可能无法解析原渠道及其 adapter/凭证配置。
- 建议：明确快照保存渠道限定的模型选择 key（包含 `channelId`），不要保存 UI 显示标签或未限定模型名。
- 核对：模型选择编码已核对；尚未实现。

### [P3] 节点复制/粘贴文件指引不准确

- 来源：AGY 报告；Codex 已核对
- 位置：计划 `docs/superpowers/plans/canvas-video-subject-media-bindings.zh-CN.md:107-110`；实际逻辑见 `studio/web/src/pages/canvas/project.tsx:1023-1085`
- 证据：`duplicateNode`、`copySelectedNodes`、`pasteCopiedNodes` 在 `project.tsx`；`canvas-node.tsx` 不负责画布级复制/粘贴。
- 影响：实施者可能在错误模块寻找修改点。
- 建议：移除 `canvas-node.tsx` 的复制/粘贴路径指引，把 `nodeId` 映射和复制后的 `bindingId` 规则归到 `project.tsx`。
- 核对：源码位置已核对。

### [P3] 待测文档路径与项目规范不一致

- 来源：AGY 报告；Codex 已核对
- 位置：计划 `docs/superpowers/plans/canvas-video-subject-media-bindings.zh-CN.md:207`；规范见 `AGENTS.md` 文档规范章节
- 证据：计划写 `pending-test.zh-CN.mdx`，而项目规则要求 `docs/content/docs/progress/pending-test.mdx`。
- 影响：可能新建错误文件或违反文档维护约定。
- 建议：改为规范路径 `docs/content/docs/progress/pending-test.mdx`。
- 核对：项目规范已核对。

## 审阅校正与范围精简

- AGY 关于“纯文本确认”的 P2 未确认为缺陷。计划要求提示词变化使确认失效，但用户可以完成编辑后一次性确认本次输入；这不等于每次按键都要确认。是否让纯文本跳过显式确认属于产品选择，不能以“保持可用”直接推导为免确认。
- AGY 建议根据 `apiFormat` 回退 adapter 的修复不采纳。这与计划明确禁止仅凭传输格式认定模型支持媒体相冲突，也无法处理 OpenAI 兼容接口之间的能力差异。
- 存储收集器 `collectImageStorageKeys` 与 `collectMediaStorageKeys` 已递归遍历嵌套对象的 `storageKey`；清理入口在 `isLocalWorkspaceMode` 下直接返回。当前没有证据要求改造存储层。计划可把对底层存储文件的审查缩减为验证快照 metadata 被现有收集器遍历到，不把存储 API 列为默认修改目标。

## 执行与检查

- AGY：状态 `done`，耗时 `9m33s`，job `1791345016263739500-6c16508ce46a4e3e798d26eb`。
- AGY 状态未返回 resolved model；模型记为 `unknown`。返回的 usage：`cache_read_tokens=4612048`、`input_tokens=363066`、`output_tokens=49104`、`thinking_tokens=37483`、`total_tokens=412170`。未返回费用信息。
- GPT 检查了上述工作区源码位置、计划内容和 `AGENTS.md` 文档规则；没有运行测试、typecheck、构建、真实媒体生成或网络请求。
- AGY 在临时资料包内执行；没有仓库代码或计划文件改动。临时资料包路径：`C:\Users\ldc\AppData\Local\Temp\agy-canvas-video-plan-review-dfb1dbec81a5408f944bd6a72a92c4f3`。

## 范围与限制

本报告是计划审查，不是实现验收。H3/AutoDL 的真实 HTTP 提交、认证、轮询、结果下载及收费能力没有测试；当前方案继续将未核实能力标记为 unsupported。
