# H3 生成输入清单与结果快照：设计评审稿

**状态：设计方向已获用户批准；本稿按首次评审意见补全，等待独立子 agent 只读复审。本稿不是实现计划，不授权开始代码修改。**

## 目标

让用户打开画布生成配置时，能直接看见这次生成会使用的图片、视频、音频及顺序；能对照真实提交提示词；生成后能在结果节点下复查本次提交的素材、提示词和参数。

成功标准：配置面板预览、H3 槽位映射、Provider 请求适配和结果快照都从同一份不可变的 `GenerationSubmission` 派生。任何有效连线素材必须映射到真实请求槽位；若当前 workflow 不支持该素材或槽位，提交前明确报错并阻止请求，不能静默丢弃。图片、视频、音频在预览、H3 标签、Provider 请求和快照中的相对顺序必须一致。

## 约束与上下文

- 目标是 Infinite Canvas 画布配置节点的界面和数据流；不改动实际画布内容，不导入素材，不生成视频，不调用浏览器自动化。
- 配置连线表示本次生成输入。用户不需要学习“可用素材 / 已采用素材”两套概念。
- 自动纳入连线素材的规则必须服从当前 workflow 的输入能力和语义槽位；首帧/尾帧、Kling 元素等已有专用槽位不得被通用参考素材规则覆盖或重复提交。
- H3 Ref2VA 的 `subject_definitions`、`summary`、`retention_analysis`、`detailed_description`、`overall_soundscape`、`non_diegetic_music` 六段顺序及 `<Subject N>`、`<Picture N>`、`<Video N>`、`<Audio N>` 标签必须由 H3 提示词规范约束。界面不得静默改写提示词含义或对白。
- 槽位上限从实际选择的 workflow 能力读取，不在通用组件中写死。H3 skill 的能力示例不能取代运行时 workflow 配置。
- 不复制媒体二进制或保存签名 URL。快照记录稳定素材标识、存储键和显示元数据；预览继续经应用现有媒体存储解析。

## 当前代码依据

- `web/src/app/(user)/canvas/components/canvas-config-composer.tsx` 已负责把 `@[node:id]` 序列化为可读引用芯片，并从已有输入节点选择引用。
- `web/src/app/(user)/canvas/components/canvas-node-generation.ts` 已提供 `NodeGenerationInput`、`buildNodeGenerationInputs()` 和 `buildNodeGenerationContext()`，承载提示词及图像、视频、音频输入。
- `web/src/app/(user)/canvas/components/canvas-config-node-panel.tsx` 已显示提示词、参考图、参考视频、参考音频数量，并提供“组装提示词”入口。
- 当前 `buildComposerGenerationContext()` 用提示词里的 `@[node:id]` 决定哪些连接素材进入提交上下文；配置提示词非空但没有引用芯片时，编译结果会包含零个普通媒体引用。这解释了连线计数与实际请求可能不一致。
- 当前生成上下文还处理 `firstFrameNodeId`、`lastFrameNodeId`、`klingImageNodeIds`、`klingElementList` 等具名/模型专用槽位。提交编译必须保留这些角色，并以 workflow 能力判定是否进入通用参考列表，避免遗漏或重复。
- 视频重试会复用已有结果节点并清除该节点当前内容/任务字段；`generationRuns` 必须与这些可更新字段分开，按 `runId` 追加历史。
- `web/src/app/(user)/canvas/types.ts` 中的 `CanvasNodeMetadata` 可承载配置节点与结果节点的可选元数据；计划阶段仍须核对本地保存、账号同步及视频节点创建路径，不能预设后端不需变更。
- `web/package.json` 没有 `test` 脚本；现有测试使用 `bun:test` 或 `node:test`。当前环境可解析 Bun `1.4.2`，可从 `web/` 运行 `bun test <测试文件>`。本稿阶段没有运行测试。

## 方案比较

### 方案 A：只修复提示词引用芯片

改动最小，可继续沿用现有编译逻辑；但每个素材仍要显式插入提示词，用户容易误以为“连线已提交”。这没有满足本次产品目标。

### 方案 B：连线定义输入、排序元数据定义槽位顺序，生成与预览共用同一提交对象（推荐）

沿用现有 `NodeGenerationInput` 和提示词编辑器。编译器按当前 workflow 的能力与槽位策略收集所有有效媒体连线；提示词引用芯片绑定具体节点并表达语义引用；有序输入列表负责稳定顺序。已有上游文本节点仍须通过明确引用进入提示词，不能因为新增媒体自动采用规则而隐式拼入额外文本。面板预览、H3 标签编译、Provider 请求适配和结果快照只读取同一份不可变 `GenerationSubmission`；提交后不得从其他状态再拼接或覆盖提示词、输入或参数。

`GenerationSubmission` 是 UI 与生成调用之间的规范化产品契约；Provider 适配器可将它序列化为现有 API 所需的参数结构，但每个输入都必须能追溯回提交对象中的节点、角色和顺序。优点是保留现有画布连线和提示词能力，改动集中在配置输入编译、面板展示、请求适配和结果快照；不另造生成服务或媒体库。代价是必须用测试保护输入映射、顺序和失败拦截。

### 方案 C：抽成跨项目 npm 组件 / 新媒体服务

可覆盖更多应用，但会引入包边界、媒体解析适配、版本和依赖管理；当前只有一个明确使用方，早期投入大于收益。

**建议先实施方案 B。** 将数据编译保持为纯 TypeScript 函数，UI 使用小型可复用输入清单组件。至少有第二个真实消费者后，再评估抽包；跨应用适配通过 `MediaResolver` 将项目素材标识解析成预览媒体，不把画布节点 ID 当作全局 ID。

## 建议的数据流与契约

```text
配置节点的有效连线 + inputOrder + 提示词/明确引用的文本节点 + workflow 能力
                              ↓
       纯函数编译 GenerationSubmission + 可恢复的校验问题
          ├─ 配置面板预览 / 计数 / 槽位标签
          ├─ H3 槽位映射与校验
          ├─ Provider 适配器 → 现有视频生成请求
          └─ 每次生成的 GenerationSnapshot（按 runId 追加）
```

`GenerationSubmission` 应在设计层定义以下必要字段；实现阶段再与现有类型合并：

~~~ts
type JsonValue = null | boolean | number | string | ReadonlyArray<JsonValue> | { readonly [key: string]: JsonValue };

type GenerationSubmission = Readonly<{
  schemaVersion: 1;
  workflowId: string;
  workflowMode: string;
  workflowRevision?: string;
  model: string;
  channelId?: string;
  protocol?: string;
  // 覆盖所有影响实际 API 输入的配置；仅允许可序列化 JSON，不含凭据。
  parameters: Readonly<Record<string, JsonValue>>;
  sourcePrompt: string;
  submittedPrompt: string;
  inputs: ReadonlyArray<Readonly<{
    nodeId: string;
    assetId?: string;
    kind: "image" | "video" | "audio" | "text";
    orderIndex: number; // 统一清单的 0-based 顺序
    role: "reference" | "kling_reference" | "first_frame" | "last_frame" | "element_reference" | "prompt_text" | "subject_definition";
    // H3 类型内的 1-based 槽位；非 H3 workflow 可省略。
    slot?: { kind: "subject" | "picture" | "video" | "audio"; index: number };
    label: string;
    name: string;
    storageKey?: string;
  }>>;
}>;
~~~

Provider 调用前还需得到有来源绑定的规范化请求：

~~~ts
type ProviderRequestBinding = {
  nodeId: string;
  role: GenerationSubmission["inputs"][number]["role"];
  target:
    | { field: "prompt" }
    | { field: "references" | "videoReferences" | "audioReferences"; index: number }
    | { field: "firstFrame" | "lastFrame" }
    | { field: "videoElementList"; elementIndex: number; referenceIndex: number }
    | { field: "videoMultiPrompt"; index: number };
};

type ProviderRequest = Readonly<{
  prompt: string;
  input: VideoReferenceInput; // references / firstFrame / lastFrame / videoReferences / audioReferences
  advanced: Readonly<{ videoElementList: VideoElementItem[]; videoMultiPrompt: VideoMultiPromptItem[] }>;
  sourceBindings: ReadonlyArray<ProviderRequestBinding>;
}>;

type ProviderSerializationResult = {
  body: unknown; // 协议适配后的 JSON / FormData 等请求体
  consumedBindings: ProviderRequestBinding[];
};
~~~

映射规则以当前视频服务的归一化字段为边界：普通图片进 `references[]`，视频进 `videoReferences[]`，音频进 `audioReferences[]`，首尾帧分别进 `firstFrame` / `lastFrame`；被 `klingImageNodeIds` 选中的图片按该列表顺序进图像引用槽且不再按通用 chip 重复插入；Kling 元素图绑定到 `advanced.videoElementList[elementIndex].references[referenceIndex]`，明确的多段文本按 workflow 绑定到 `advanced.videoMultiPrompt[index]` 或 `prompt`。MiniMax H3、AutoDL 和其他协议再由各自 serializer 将这些字段映射到 endpoint body；例如 H3 `content` role 和 AutoDL 的 `input_reference[]` / `video_reference[]` / `audio_reference[]` / `first_frame_url` / `last_frame_url`。serializer 必须保留各目标数组的相对顺序，禁止用 `slice`、过滤或 fallback 静默丢弃不支持的输入。

每个提交输入默认必须恰好绑定到一个目标槽位。首帧/尾帧与普通参考、Kling 元素引用与普通参考之间，默认不允许同一输入重复映射或角色冲突；只有 workflow 明确声明支持复用，并且面板把每个角色分别显示为独立槽位时才允许。Provider adapter 返回 `consumedBindings`，提交前校验它与 `sourceBindings` 一一对应：未消费、重复消费、来源 ID 不匹配、槽位冲突或超出能力都产生可定位错误并阻止 API 请求。文本引用也必须绑定到其实际进入的提示词字段。

校验必须发生在任何网络请求之前，包含协议 adapter 中已有的素材上限、模型限制和混用限制；禁止因 `slice` 上限、仅处理支持字段或私有 fallback 丢失输入后仍调用 API。`consumedBindings` 按绑定项而不是只按 nodeId 比较，这样明确批准的多角色复用才能被准确核对。

预览阶段持有当前 `GenerationSubmission`；点击生成时冻结同一对象，为该次尝试分配唯一 `runId`，再分别由 Provider 适配器和快照构造器读取它。生成调用只接收 Provider 适配器从该对象产生的请求；提交前不得重新从组件状态拼装第二份输入。H3 标签和 Provider 多类型数组都根据 `inputs` 派生：各类型数组保留该类型元素在统一清单中的相对顺序；槽位序号从 1 开始；首尾帧等具名槽位由 `role` 映射。H3 模式下每个被提交的输入都必须有合法槽位。请求适配发现任一输入无法映射、超过 workflow 容量、素材缺失或引用失效时，返回可定位的校验问题，不发送任务。`workflowRevision` 可用时记录它；当前系统若无版本号，不得伪造。

配置元数据保存稳定顺序：

~~~ts
inputOrder?: string[]; // 当前有效连入输入的 nodeId，按统一顺序排列
~~~

首次读取旧配置且没有 `inputOrder` 时，按画布持久化的现有媒体连线顺序初始化；不按节点坐标或媒体类型静默重排。新媒体连线追加到末尾，断开连线时从顺序表移除，重排后立即保存；编译时去重并忽略已断开的 ID，同时把异常列为可见校验问题。`inputOrder` 只含媒体节点 ID；文本节点仍只有通过明确引用才进入提示词，不参与自动媒体槽位顺序。

每次尝试生成一条不可变快照：

~~~ts
type GenerationSnapshot = Readonly<{
  schemaVersion: 1;
  runId: string;
  createdAt: number;
  submission: GenerationSubmission;
}>;
~~~

`submission.sourcePrompt` 保留编辑器内容；`submission.submittedPrompt` 是实际传给生成任务的最终文本。快照不保存签名 URL、data URL、base64 或媒体二进制。`nodeId` 只在当前画布命名空间内稳定；跨画布/跨应用需由适配器使用稳定 `assetId` 或 `storageKey` 解析，不承诺裸 `nodeId` 可移植。`assetId` 和 `storageKey` 都缺失但当前节点仍能解析媒体时允许提交，快照保留 nodeId 与显示元数据；节点删除后预览显示素材不可恢复，不复制媒体文件来掩盖此限制。

结果节点的 `generationRuns` 是每次尝试的本地权威历史。每项包含不可变 `GenerationSnapshot`、由 `runId` 派生且唯一的 `clientTaskId`、返回后可选的 `taskId`，以及独立更新的任务状态/错误。任务服务若已有字段可记录 `runId`；若没有，靠结果节点中的 run 项与唯一 `clientTaskId` 关联，不为本设计预设后端 API 改动。

持久化时序与并发规则：先以 `runId` 幂等追加 run 项并等待画布现有持久化路径成功，再调用 Provider；写入失败时显示保存错误且不发送生成请求。追加和状态更新都按最新节点状态做串行 read-modify-write（或等价的 compare-and-merge），状态只能按 `runId` 更新，不能用旧闭包中的整个 metadata 覆盖历史。并发重试各自产生独立 run 项；返回乱序时，旧 run 只能更新自身状态，只有仍等于 `activeRunId` 的 run 可以更新结果节点当前内容。

## 界面行为

1. 配置面板“本次输入”区域列出 `GenerationSubmission` 中的媒体节点，图片展示缩略图，视频展示封面/时长，音频展示文件名/时长；不自动播放音频。没有可用波形数据时不临时生成波形。
2. 卡片显示“图 1 / 音频 1”等顺序标签和真实来源名称。用途仅在来源元数据确实存在时显示，不根据文件名虚构人物、场景或道具身份。
3. “上移 / 下移”键盘操作是顺序调整的基线，操作后播报新位置并保持焦点；拖动仅在现有交互基础支持时提供，不作为正确性或可访问性的唯一方式。
4. 移除输入只删除配置节点与来源节点之间的连接，不删除来源素材。提示词仍引用已断开、已删除或无法解析的节点时，编译结果列出具体引用和恢复建议，阻止调用生成 API，并保留提示词原文。
5. 提示词区显示可读内容及引用来源；内部 node ID 不作为用户文案。H3 编译器将已绑定引用映射到准确的 `<Subject N>`、`<Picture N>`、`<Video N>`、`<Audio N>` 槽位并保持六段字段顺序。每次请求前校验引用存在、workflow 槽位支持、槽位上限及参数能力；失败时不提交。
6. 结果节点在“本次生成依据”区域按提交顺序展示参考缩略图、音频来源、完整提示词及参数。每次尝试在结果节点的 `generationRuns` 历史中按唯一 `runId` 追加 run 项；任务记录可引用该 `runId`，并以唯一 `clientTaskId` 与本地 run 项关联。重试可复用结果节点，但必须追加 run 项并使用新的 `runId` / 客户端任务标识，不能覆盖旧记录。
7. 快照在发起任务前写入结果节点并沿用画布现有持久化/同步路径。任务创建失败、中止或生成失败均保留快照和真实任务状态/错误；只能更新 run 项的状态字段，不能改写其输入快照，也不能把“请求已提交”显示成“视频已生成”。旧结果无快照时显示“没有历史输入快照”，不推算历史请求。

## TDD 验收行为

实现时遵循 `superpowers:test-driven-development` 的 RED → GREEN → REFACTOR；每个行为先写一个能正确失败的测试，再写最小实现。不得先写产品代码再补测试。

1. **所有媒体类型及其请求映射：**图片、视频、音频连线在没有 `@[node:id]` 媒体芯片时按当前 workflow 规则进入提交对象；Provider 请求中的各类型数组及槽位与该对象一一对应。未明确引用的文本节点不会进入提示词。
2. **单一提交对象：**面板卡片/计数、H3 标签、Provider 请求映射和快照都接收同一冻结的 `GenerationSubmission`；校验字段、提示词、参数和输入身份一致，不从其他组件状态补拼字段。
3. **顺序一致：**重排后卡片、统一 `orderIndex`、H3 类型内槽位序号、Provider 各类型请求数组及快照一致；无排序元数据的旧配置按持久化连线顺序初始化，保存/重载后保持顺序。具名首尾帧等槽位也要验证角色映射。
4. **不支持输入阻止提交：**超过槽位上限、workflow 不支持该素材类型、资源缺失或角色不能映射时，面板显示具体问题且生成任务/API 提交入口未调用。
5. **无效引用可恢复：**断开或删除来源后的引用不静默丢失；预检给出对应节点和恢复建议，阻止 API 调用，保留原始提示词文本。
6. **快照忠实且不含媒体载荷：**快照的最终提示词、所有 API 影响参数、槽位角色及输入顺序和冻结的 `GenerationSubmission` 一致；快照不包含 `data:`、签名 URL 或媒体二进制。
7. **重试和失败历史：**每次尝试生成唯一 `runId` 和 `clientTaskId`；成功、任务创建失败、中止和任务失败都保留该次不可变快照，状态/错误独立更新。重试不会覆盖旧快照或复用客户端任务标识；结果通过 `runId` 找到对应历史。
8. **结果可复查：**结果视图按快照渲染参考、音频、提示词和参数；旧结果无快照时显示明确的“没有历史输入快照”，不推算历史请求。
9. **可访问操作：**输入顺序有键盘操作和焦点保持；更新后通过 `aria-live` 或等价方式播报；缩略图有能表达用途的替代文本。

测试组织建议：纯编译、排序、Provider 映射和快照函数放在 `canvas-node-generation.test.ts`，使用 Bun 测试；输入清单静态输出遵循项目已有 `renderToStaticMarkup` 写法。静态渲染只验证结构/属性，不声称覆盖键盘交互、焦点保持或实时播报；这些行为至少要有可测试的排序 reducer/键盘动作测试和可执行的交互验收项。针对具体交互的逻辑尽量抽成纯函数，避免为一个面板新增测试依赖。实现前用一条已存在的 `bun:test` 用例确认命令；计划阶段再确定 targeted 和 full-suite 命令。

测试命令候选：

```powershell
# 在 web/ 目录
bun test "src/app/(user)/canvas/components/canvas-node-generation.test.ts"
bun test
```

每个 RED 测试都记录预期失败原因；修复后跑目标测试，再跑完整 `bun test`。不运行视频生成来验证 UI，不用有费用的外部模型 API。

## 预期实现范围

仅作为设计范围，尚未拆成实施计划：

- `web/src/app/(user)/canvas/components/canvas-node-generation.ts`：连接素材排序、`GenerationSubmission` 编译、workflow 预检、Provider 输入映射和快照纯函数。
- `web/src/app/(user)/canvas/components/canvas-config-node-panel.tsx`：展示实际提交输入清单；计数从同一提交对象派生。
- `web/src/app/(user)/canvas/components/canvas-config-composer.tsx`：沿用现有引用编辑体验，补充稳定标签/来源反馈；不暴露内部 ID。
- `web/src/app/(user)/canvas/types.ts`：只添加必要的可选类型；不做通用媒体架构重写。
- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`：冻结预览所用提交对象，在请求实际发出的位置只调用一次 Provider 适配；提交前把本次快照追加到结果节点历史，任务关联唯一 `runId`。
- 为上述纯逻辑和静态面板输出新增最小 Bun 测试；不加新的 UI、状态管理或拖拽依赖，除非实现前证明现有方式无法满足需求并经用户确认。

代码落地前须核对生成节点元数据/`generationRuns` 在本地保存、账号同步、导入/导出和重试路径中的序列化行为，确认失败前写入的快照不会被现有节点更新覆盖。逻辑权威是结果节点下每次生成的不可变 run 快照；任务以 `runId` 或唯一 `clientTaskId` 关联它。不能只保存一个会被重试覆盖的 `generationSnapshot` 字段。若现有画布持久化无法可靠保存追加历史，再单独评估存储扩展，不在本稿中预设 API 改动。

## Skill 调用声明

| Skill | 当前用途 / 后续边界 |
|---|---|
| `superpowers:using-superpowers` | 选择并遵循与当前设计修订和复核相符的技能流程。 |
| `superpowers:brainstorming` | 本轮依据评审补全产品规则、数据契约、失败行为与范围；设计方向已获用户批准。 |
| `superpowers:writing-plans` | 独立复审后用于编写逐任务实施计划；本轮不产出实现计划。 |
| `superpowers:test-driven-development` | **待实施阶段**，每个行为先 RED、再最小 GREEN、再重构；本轮不运行测试。 |
| `superpowers:executing-plans` | **待实施计划获批后**按任务执行，不用于当前设计稿修订。 |
| `frontend-design`、`interaction-design` | 组织素材与提示词信息层级、排序反馈和直白文案。 |
| `accessibility-compliance` | 约束键盘重排、焦点、播报和缩略图替代文本。 |
| `api-and-interface-design` | 定义版本化提交/快照契约，避免 UI、编译器和请求层各自解释输入。 |
| `h3-prompt-writing`、`minimax-h3-video-prompt` | 保持 H3 Ref2VA 字段顺序、参考标签稳定，并按实际 workflow 校验槽位能力；不改写用户剧情提示词。 |
| `infinite-canvas-workflow` | 规定 MCP 和目标画布操作边界；本轮代码规格不操作实时画布。 |
| `short-drama-storyboard` | 本轮不修改剧本、分镜、镜头职责或关键帧，因此不调用。 |

## MCP 与外部操作声明

- **本轮已执行：**没有调用 Infinite Canvas MCP，没有读写实时画布，没有浏览器/CUA 操作，也没有发起生成任务。文档依据本地源文件和技能文件整理；独立子 agent 只读审阅同样不得调用画布 MCP。
- **代码实现及 TDD：**用本地合成节点/连线 fixture 做 Bun 单元测试；不需要 MCP。MCP 的节点操作不能替代代码测试。
- **若后续另行要求核验目标实时画布：**先以只读 `get_canvas_summary` 确认目标，再按需调用 `query_canvas_nodes`、`get_node`、`get_connected_nodes`、`get_generation_config` 或 `get_generation_task`。必须由真实返回判断状态。
- **未获单独指示不调用：**`update_node`、`create_connection`、`delete_node`、`delete_connection`、`arrange_nodes`、`generate_video`、`generate_image`、`generate_audio`。本功能不需要改画布数据或消耗生成额度。
- 不调用本地 HTTP、数据库或隐藏接口，不用浏览器控制补 MCP 能力。

## 审核后流程

1. 设计方向已获用户批准；本轮按初审意见修订，并由子 agent 独立只读复审。
2. 复审意见收敛后，下一阶段使用 `superpowers:writing-plans` 编写逐任务计划，计划本身再供用户审核。
3. 用户批准实施计划后，再遵守仓库 `AGENTS.md` 的文件编辑授权要求，进入 TDD 编码。任何超出本设计的扩展都先说明范围和影响。

## 独立复审提示词

```text
请只读审阅 docs/superpowers/specs/2026-09-24-generation-inputs-snapshot-design.md，并对照相关本地代码核验设计是否闭环。

重点检查：
1. GenerationSubmission 是否足以作为面板预览、H3 槽位、Provider 请求和快照的单一规范来源；适配器是否可能静默遗漏输入。
2. inputOrder、图片/视频/音频类型内顺序、H3 1-based 槽位和首尾帧等具名角色是否定义一致。
3. workflow 不支持的媒体、无效/断开引用、资源缺失是否都在发请求前阻止提交并给出可恢复错误。
4. 每次重试是否有独立 runId、客户端任务标识和追加快照；任务创建失败/中止/失败时历史如何保留。
5. 不复制媒体二进制/签名 URL、持久化范围、TDD 行为、目标文件、Bun 命令、技能和 MCP 声明是否准确；指出过度设计和遗漏的失败场景。

只给审阅意见，不改任何文件、不运行测试、不操作浏览器、不调用任何画布 MCP、不发起生成任务。
按“必须修改 / 建议修改 / 可以保留”列出发现；无必须修改项时明确说明是否建议进入 writing-plans 阶段。
```
