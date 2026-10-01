---
name: H3 画布提示词与 AutoDL 工作流
description: 在无限画布中为 MiniMax H3 或 AutoDL H3 工作流编写完整视频提示词，并把 DramaClaw 的 beat 字段、参考编号和画布节点关系保持一致
---

# H3 画布提示词与 AutoDL 工作流 Skill

## 适用范围

用户要求 H3 提示词、H3 图生视频/首尾帧/参考视频、DramaClaw beat 视频提示词，或使用 AutoDL 上的 H3 workflow 时使用。Skill 只编写和投影提示词，模型和工作流仍由当前画布全局配置决定。

## 先确认能力

1. 先调用 `get_generation_config` 读取当前视频模型、渠道、合法时长、画幅/清晰度和自动生成开关。
2. 如果模型是 AutoDL，工作流 ID 和 input rules 是唯一参数来源；不得凭工作流名称猜字段、引用上限、分辨率或时长。当前适配器会动态读取 AutoDL `/api/v1/comfyui` 工作流详情。
3. 如果当前模型不是 H3，说明“当前配置不是 H3”，让用户选择继续当前模型或先在配置中切换；Agent 不自行替换模型。
4. H3 的完整提示词可以写入文本/配置节点，即使自动生成关闭；不要把节点已创建误报成任务已提交。

## H3 模式与输出结构

- T2VA：使用 `integrated_multimodal_description`、`overall_soundscape`、`non_diegetic_music`，正文按时间线描述构图、主体、环境、动作、摄影机、对白/旁白和声音。
- I2VA：明确第一帧是 `<Picture 1>`，描述从首帧向后连续发生的动作和运镜。
- FL2VA：同时锁定第一帧和最后一帧，描述二者之间的连续路径，不把两张图写成两个互不相干的镜头。
- L2VA：明确最后帧是收束落点，并写清从开场到该落点的合理运动。
- Ref2VA：按 `subject_definitions`、`summary`、`retention_analysis`、`detailed_description`、`overall_soundscape`、`non_diegetic_music` 输出，引用标签在所有段落保持一致。

`detailed_description` 必须写具体的主体位置、外观、光线、动作状态变化、镜头运动、声音和参考内容生效的时点；不能用“电影感、漂亮、保持一致”替代可执行描述。对白和画面可见文字保留原语言，其他结构遵循当前 H3 提示词模板的字段顺序。

## DramaClaw → Canvas 映射

- `visual_description` 是画面事实和连续性背景；`keyframe_prompt` 是首帧/关键帧构图提示；`video_prompt` 是送入视频生成节点的完整 H3 提示词。三者不要互相覆盖或只保留摘要。
- 每个 beat 单独建立视频节点；先确认该 beat 的直接图片、首帧、尾帧、参考视频和参考音频，再把真实 nodeId 放入 `sourceNodeIds`。
- 提示词中的 `<Picture 1>`、`<Video 1>`、`<Audio 1>` 必须和 `sourceNodeIds` 中按类型的顺序一一对应；没有真实来源时不能写占位引用。
- 导入的 DramaClaw 媒体是 evidence/reference，不因存在 `videoUrl` 就自动重新生成或覆盖原视频。
- 多镜头时保留完整时间区间、镜头顺序、对白/旁白全文和声音层；总时长必须等于当前任务的 `seconds`，不能把每个镜头都改成默认时长。

## AutoDL H3 约束

- AutoDL workflow ID 放在当前视频渠道/模型配置里；`generate_video` 的 `model` 只用于标注，不覆盖全局配置。
- 参考图片、视频、音频的数量和字段以工作流详情返回值为准；若工作流不支持某种引用，返回能力错误并改用支持的模式，不伪造请求字段。
- 只提交一个 beat 的一个任务；先等待上游图片/音频成功，再提交依赖它们的视频。失败、超时、限流和未配置都停止当前依赖链。
- `generateAudio` 只有在当前工作流真实支持时才开启；否则使用独立音频节点。

## 输出纪律

- 已确认提示词没有修改要求时，完整传入 `generate_video`，不摘要、不重写、不删除对白。
- H3 提示词、模型配置、工作流能力、节点创建、任务提交和任务完成是不同事实，分别报告。
- 不在提示词或画布节点中写 API Token、私有 URL、访问凭据或未经验证的工作流参数。
