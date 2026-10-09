# 画布视频节点 H3 提示词引用组装与可视化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本项目无测试、不编译；每个 Task 以「人工验收点」收尾，提交由用户决定。

**Goal:** 视频节点已连入的素材可在提示词中按光标插入可视化引用（图片/视频/音频/文本/Subject），统一编号后编译为 H3 提示词，并在提交前展示「正文 + 引用映射」双区预览，用户确认后按同一份编译结果提交。

**Architecture:** 以 `canvas-resource-references.ts` 产出「当前有效输入清单」，`canvas-video-inputs.ts` 基于清单固定附件顺序并统一编号、编译，产出唯一编译结果；菜单、chip、计数、预览、提交共同消费该结果。契约未核实的字段只允许草稿预览，禁止提交。不新建通用 adapter 平台。

**Tech Stack:** React + TypeScript（`studio/web/src/`），zustand store（`stores/canvas/use-canvas-store.ts`），外部请求在 `services/api/`。

## Global Constraints

- 页面文案使用中文；颜色、按钮沿用画布主题与现有扁平风格，不引入新 UI 框架。
- 外部请求只放 `studio/web/src/services/api/`；不假设新后端。
- 不新增经验性超时、重试、大小、并发限制；确需时先说明并确认。
- 不新增测试文件、不运行语法检查/构建/真实生成；每个 Task 以人工验收点收尾。
- 不提交 git；提交由用户决定。
- 不新增通用多模型 adapter 注册框架、渠道能力编辑器、用途枚举。已有相关代码作为可复用基础，不回滚。
- 不发明 H3 字段或标记：未核实的一律阻断提交，只允许草稿预览。
- 不做：素材管理平台、自动理解素材、自动翻译/重写 H3 剧本、Subject 管理后台、云同步。

---

# 第一部分 设计说明（Spec）

## 1. 官方证据与工作流边界

### H3 提示词规则

依据 MiniMaxAI 官方 [Full-Reference guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md) 第 2 节，标记为 `<Subject N>`、`<Picture N>`、`<Video N>`、`<Audio N>`。Subject 是逻辑内容实体，不是媒体文件。UI 称「图片」，编译用 Picture。Video、Audio 独立编号，视频含声音不自动产生 Audio 引用。该指南描述提示词格式，不是 AutoDL HTTP 字段，不能证明具体工作流支持视频。基础模式见 [Base guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)，两种模式结构不混用。

### AutoDL 具体契约

既有记录仅核实 [minimax_h3_image_audio_to_video_v2_15s](https://www.autodl.art/large-model/comfyui/minimax_h3_image_audio_to_video_v2_15s) 的 `prompt`、`duration`、`resolution`、`ref_image_0..8`、`ref_audio_0..2`。页面正文本轮未能读取，沿用既有记录，实施前须复核。

| 对象 | 可用依据 | 禁止推断 |
| --- | --- | --- |
| H3 官方 guide | 四类标记拼写、语义 | 所有 H3 工作流支持全部媒体 |
| v2_15s | 图片 9 槽、音频 3 槽、prompt 记录 | 视频字段、视频编辑、自动音轨拆分 |
| zm_u24 等工作流 | 需单独核实 | 沿用 v2_15s 字段与上限 |
| 通用视频 API/脚本 | 可传媒体数组 | 数组存在即证明支持 H3 |

最终提示词只映射到具体工作流规定的 `prompt`。`integrated_multimodal_description` 等正文结构名不得当作 HTTP 字段。

## 2. 当前源码与目标差异

文件均位于 `studio/web/src/`，含工作区未提交改动；其他仓库交接记录不是本仓库运行证据。

| 文件 | 现有基础 | 本方案改动（见对应 Task） |
| --- | --- | --- |
| `lib/canvas/canvas-resource-references.ts` | `CanvasResourceKind`、`CanvasResourceReference`、`buildNodeMentionReferences`、`getMentionResourceNodes` | Task 1：清单限定当前有效输入，统一编号 |
| `lib/canvas/canvas-video-inputs.ts` | `parseVideoPromptReferences`、`CompiledVideoInput`、`CanvasVideoInputAdapter`；现编译为 picture_1，Subject 展开为文字 | Task 1/4：规范标记、Subject 定义、附件先固定后编号 |
| `components/canvas/canvas-node-reference-bar.tsx` | 卡片与绑定说明；「+」触发画布选择 | Task 2：组装面板「+」改为引用清单 |
| `components/canvas/canvas-config-composer.tsx` | node chip、独立 Subject/binding Select | Task 2：统一插入、光标恢复 |
| `components/canvas/canvas-prompt-chip-input.tsx` | token/标签解析、chip | Task 2：H3 标记显示，缺失引用保留错误 chip |
| `components/canvas/canvas-node-generation.ts` | 普通路径收集连入媒体 | Task 1：H3 视频走全量连入输入策略，其他模式不改 |
| `components/canvas/canvas-node-prompt-panel.tsx`、`pages/canvas/project.tsx` | 候选预览、确认入口 | Task 3：计数、双区预览 |
| `types/canvas.ts`、`stores/canvas/use-canvas-store.ts`、`services/api/video.ts` | Subject/绑定/身份版本/快照、FromInput | Task 1/4：最小增补映射类型；字段映射 |

## 3. 交互规则

### 清单与卡片

输入来源沿用现有生成资源解析：有连接的生成配置时以其有效入边为准，否则用视频节点自身入边；不能从整个画布任意选入。Group 按成员顺序展开；同一 nodeId 多路径出现只占一个位置；不同节点不因同名合并。

| 类别 | 卡片与 inline chip | 引用 |
| --- | --- | --- |
| 文本 | 文本图标、名称、编号 | 本地稳定 node token，不发明 `<Text N>` |
| 图片 | 原比例缩略图、名称、编号 | `<Picture N>` |
| 视频 | 缩略图（无则类型图标）、名称、编号 | `<Video N>`；未核实字段阻断 |
| 音频 | 音频图标、名称、编号 | `<Audio N>` |
| Subject | 实体名称、编号，可显示绑定缩略图 | `<Subject N>` |

Subject 必须有明确定义与来源关系：项目共享定义可复用，本节点只启用明确关联当前输入的实体。一个实体可来自多份素材，一份素材可提供多个实体，不重复提交附件；不按标题自动建实体，不从音频单独推断可见 Subject。

### 「+」行为

「+」打开同一份清单，选中后在最后有效光标/选区插入 chip（替换选区，光标移到 chip 后；菜单获取焦点不得丢光标；无有效位置则插入正文末尾）。插入只修改提示词，不新建连线、节点、素材副本、绑定或上传。新素材仍通过画布连线添加；空状态提示「请先在画布上连接素材」。不支持项显示原因并禁用。草稿里已有的失效引用保留错误 chip，提交前阻断。chip 显示 H3 标记、名称、缩略图/图标，内部 ID 仅持久化。

### 附件：已连入媒体默认全部提交

有效输入中的图片、视频、音频默认全部作为请求附件；「+」只决定正文引用位置，不决定发送集合。未引用附件显示「随请求提交，正文未引用」。要排除素材，在画布上断开连线，不新增第二套勾选状态。

不支持的媒体、字段未核实或超出契约槽位时，阻止整次提交并定位具体素材，不自动忽略、截断、转文本或替换工作流。

计数：文本资源、图片、视频、音频数量均来自同一候选输入；重复 chip 不增加数量；Subject 数独立，不占附件槽；阻断时区分「连入数量」与「可提交状态」。

### 文本引用

本地 chip 为「文本 N · 名称」，可读复制用 `【文本 N】`（仅应用标识）。编译时文本 chip 在原位置展开原文；未显式引用的连入文本按清单顺序追加一次；已显式引用的不再自动追加。不自动翻译，不把素材正文升级为指令。注入文本中的 H3 标记同样校验，不得绕过未知引用阻断；空文本或读取失败阻止确认。

## 4. 编号与编译

- 复用已有 node/subject/binding token，名称/编号不作主键，内部 token 不进入最终提示词。现有 picture_1、Image 1 等写法仅作待核对引用，需用户绑定或声明为普通文本。
- 先固定附件集合与顺序（入边顺序，Group 在原位置展开，重复 nodeId 保留首次出现），再分类编号、编译正文和 Subject 定义，最后映射工作流字段。正文出现位置不改变附件顺序。
- Picture/Video/Audio 各类从 1 连续编号，对应最终附件顺序；Subject 对应本节点启用实体保存顺序。编号到 0-based 字段（`ref_image_0` 等）的关系须在 Task 4 核实后确定。
- 唯一编译结果包含：最终 prompt、有序附件、引用/文本展开映射、Subject 定义、计数、工作流标识、参数、问题清单。
- Subject 编译保留 `<Subject N>`，定义区含说明及来源标记。用户已有完整正文按原文编辑，不做六段重写或镜头补全。

## 5. 预览与确认

预览分两区：

1. **H3 提示词正文**：将写入 prompt 的完整原文（含文本展开和实体定义），可复制，无内部 ID。契约未核实时标「草稿预览，不可提交」。
2. **引用映射**：「标记 → 实际素材/实体 → 工作流字段」，含名称、缩略图/图标、顺序、来源、状态。未引用附件也有行；不支持项标「无可用字段」。

提交前预检（在媒体准备、上传、POST 之前）：未知 token、未绑定实体、来源缺失/断开、编号歧义、字段未核实、超出槽位、文本注入错误，均阻止确认并定位到具体行，不得删掉失败片段后以纯文本继续。

确认规则：用户点击「确认本次输入」后，以确认时的编译结果提交；确认后输入发生变化则需重新确认。提交使用该份结果，不重读连线或绑定，不重新排序。

---

# 第二部分 实施计划（Plan）

依赖顺序：Task 1 → 2 → 3 → 4 → 5。Task 1–3 不依赖 AutoDL 契约；Task 4 依赖契约核实，无证据则保持「草稿不可提交」。

## Task 1：统一输入清单与编号

**Files:**
- Modify: `studio/web/src/lib/canvas/canvas-resource-references.ts`
- Modify: `studio/web/src/lib/canvas/canvas-video-inputs.ts`
- Modify: `studio/web/src/types/canvas.ts`
- Modify: `studio/web/src/components/canvas/canvas-node-generation.ts`

**Interfaces:**
- Consumes: 现有 `CanvasResourceReference`、`buildNodeMentionReferences`、`getMentionResourceNodes`、`CompiledVideoInput`、`parseVideoPromptReferences`。
- Produces（新增，名称实施时可按现有命名风格微调，但各 Task 须一致）：
  - `VideoInputItem`：`{ kind: "text"|"image"|"video"|"audio"|"subject"; stableId: string; nodeId?: string; name: string; number: number; h3Tag?: string; referenced: boolean }`
  - `buildVideoInputList(node, nodes, connections, subjects): VideoInputItem[]`：仅当前有效输入，Group 展开、nodeId 去重、按入边顺序编号。
  - `CompiledVideoInput` 增补 `mapping: VideoInputMappingRow[]` 与 `issues`。

- [x] 在清单构建中限定当前有效输入；Subject 只纳入明确关联当前输入的实体。
- [x] 实现先固定附件、再分类编号的规则；文本、附件计数同源。
- [x] 编译器改为输出规范 `<Picture N>/<Video N>/<Audio N>/<Subject N>`，文本原位展开，未引用文本追加一次。
- [x] `canvas-node-generation.ts`：H3 视频走全量连入输入策略，其他模式不改。
- [x] 移除对 picture_1 的硬编码，旧写法按待核对引用处理。

**人工验收点：** 连入文本、两图、一音频时，清单顺序、编号、计数一致；交换入边后编号随之更新；重复 nodeId 只占一位。

## Task 2：「+」插入与 chip 可视化

**Files:**
- Modify: `studio/web/src/components/canvas/canvas-node-reference-bar.tsx`
- Modify: `studio/web/src/components/canvas/canvas-config-composer.tsx`
- Modify: `studio/web/src/components/canvas/canvas-prompt-chip-input.tsx`

**Interfaces:**
- Consumes: Task 1 的 `VideoInputItem`、`buildVideoInputList`。
- Produces: 编辑器 `insertReference(item: VideoInputItem)`：在最后有效光标处插入 chip，不产生连线/节点/绑定副作用。

- [x] reference-bar 的「+」改为打开 Task 1 清单；画布连线保留独立操作，空状态提示「请先在画布上连接素材」。
- [x] composer 统一插入入口，记录并恢复光标；若保留 `@`，复用同一清单和插入规则。
- [x] chip 显示 H3 标记、名称、缩略图/图标；缺失引用保留错误 chip，不指向新素材。
- [x] 独立 Subject/binding Select 收敛为最小实体操作。

**人工验收点：** 光标在句中点「+」选图片，chip 出现在光标处；无新连线/节点；中文输入、删除 chip 正常；缺失素材显示错误 chip。

## Task 3：计数与双区预览

**Files:**
- Modify: `studio/web/src/components/canvas/canvas-node-prompt-panel.tsx`
- Modify: `studio/web/src/pages/canvas/project.tsx`

**Interfaces:**
- Consumes: Task 1 的编译结果（prompt、mapping、issues、计数）。
- Produces: 面板摘要（提示词/参考图/视频/音频计数）与双区预览组件，仅展示，不自行编号。

- [x] 摘要计数来自编译结果；阻断时区分「连入数量」与「可提交状态」。
- [x] 预览分为「H3 提示词正文」与「引用映射」两区；未引用附件标「随请求提交，正文未引用」。
- [x] 契约未核实时显示「草稿预览，不可提交」，隐藏或禁用确认。
- [x] 「确认本次输入」保存当前编译结果；输入变化后清除确认状态。

**人工验收点：** 预览正文与映射行、计数、chip 编号完全一致；有未知引用时按钮被阻断并定位到行。

## Task 4：契约核实、字段映射与提交（部分完成 / 契约阻断）

**Files:**
- Modify: `studio/web/src/services/api/video.ts`
- Modify: `studio/web/src/lib/canvas/canvas-video-inputs.ts`
- Modify: 本文件「第三部分」记录核实结果

**Interfaces:**
- Consumes: Task 1 的编译结果与 mapping；Task 3 的确认结果。
- Produces: 按具体工作流的「标记 → 字段」拟定映射函数；契约未核实项阻断确认与提交。

- [ ] 核实并记录官方与工作流契约（未完成，契约阻断）：官方 Guide 提示词标记与首部结构规则已核对，但 AutoDL 实际字段契约、从 1 编号与 slot 映射、prompt 包装、HTTP/CORS 以及未引用附件服务端行为均缺少完整权威运行证据，不可声称本轮已核实；契约项保持 unchecked。
- [x] 代码防守阻断与拟定映射：针对所有 H3 模型输出 `contractUnverified` 阻断 issue，映射行统一标为「拟定映射 / 未核实契约」，禁用确认按钮；在 API 提交层（`createVideoGenerationTask` 与 `createVideoGenerationTaskFromInput`）对所有 H3 模型（含纯文本及带附件）强制阻断抛错，禁止真实发送。
- [x] v2_15s 模型作用域收敛：仅针对精确匹配的 `minimax_h3_image_audio_to_video_v2_15s` 施加 9 图 3 音和无视频字段限制，其他 H3 工作流不继承；非 H3 模型完整保留原有适配器、字段与参数语义。
- [x] 快照持久化与防绕过：快照保存 `mapping` 与 `issues`，`compiledVideoInputFromSnapshot` 完整恢复，API 提交前严格校验 issues 列表，杜绝绕过。

**人工验收点：** H3 候选输入显示「contractUnverified / 拟定映射 / 未核实契约」，确认按钮禁用；API 提交前拦截 H3 真实请求；非 H3 模型不受影响；真实契约待后续补证，不可引导用户直接真实生成。

## Task 5：文档登记

**Files:**
- Modify: `CHANGELOG`、`TODO`、`pending-test`、`HANDOFF`（按 `AGENTS.md` 既有位置与格式）

- [x] 实施完成后登记变更、待测项与交接；待测项包括 Task 2–4 的静态人工验收点。
- [x] 不把计划登记为已实现，不声称契约已通过测试或编译，如实记录静态审查结果与未核实项。

---

# 第三部分 待核实项与停止条件（已记录核实证据）

### 1. 官方依据核实记录与纠偏
- **官方 H3 Full-Reference Guide**：依据 MiniMax 官方文档第 1 节（Prompt Structure），`subject_definitions:` 区块必须位于提示词**开头（首部）**，聚合实体及全部来源素材（如 `<Subject 1> is Name from <Picture 1>, <Picture 2>: desc`），其后才是提示词正文叙述，绝非放置于末尾。
- **提示词标记规则**：标记为 `<Subject N>`、`<Picture N>`、`<Video N>`、`<Audio N>`（大小写及空格固定），各类型从 1 开始独立连续编号。Subject 为实体抽象定义，非媒体文件。
- **未核实契约说明**：各类从 1 编号与 AutoDL 槽位（如 `ref_image_0..8`）的对应关系仅为拟定规则；AutoDL 服务端真实字段契约、提示词包装、HTTP/CORS 以及未引用附件的服务端行为（忽略还是报错）本轮均**未**获得官方或运行证据完整核实，严禁声称已核实。
- **工作流边界收敛**：v2_15s 历史记录仅支持图片与音频，无视频字段；zm_u24 等其他工作流缺乏独立权威记录，严禁从 v2_15s 外推。

### 2. 真实契约待补证与停止条件
- **契约阻断状态**：由于 H3 真实字段契约与服务端行为未获完整核实，系统在候选输入与 API 提交层实施了双重强制阻断（`contractUnverified`）。当前仅支持在画布草稿中进行引用编辑、展开排版与双区草稿预览，禁止真实提交。
- **禁止直接点击真实生成**：下一步绝不能让用户直接点击真实生成发起外部请求，必须在获得官方或真实运行契约证据并完成用户要求的验收后，方可解除提交阻断。
- **非 H3 模型不受影响**：OpenAI Sora、Google Gemini、脚本插件等非 H3 视频模型保留原有适配器逻辑与参数，不受 H3 契约阻断影响。
