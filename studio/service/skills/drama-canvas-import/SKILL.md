---
name: DramaClaw 画布导入
description: 将已配置 DramaClaw 的项目目录、分镜和已有媒体以可追溯、可重复、只读的方式导入当前无限画布
---

# DramaClaw 画布导入 Skill

## 适用范围

用户要求把 DramaClaw / 虾集的项目、集数、分镜、角色或已有媒体放到当前无限画布时使用。这个 Skill 只负责把已有内容投影到 Canvas；导入本身不启动 DramaClaw 生成、不删除源资产、不移动源文件，也不把导入结果误报成已完成的成片。

## 事实边界

- DramaClaw 数据的唯一来源是当前工具返回的目录结果。没有目录结果时，不猜项目 ID、集数、分镜编号、媒体 URL 或角色资产。
- `import_drama_catalog` 只接受已配置的 DramaClaw 项目 ID、正整数 episode，以及可选 beatNumbers；它读取 `/api/v1/drama/.../import-catalog` 的规范化只读接口。
- 返回的真实 nodeId、connectionId、失败媒体数量和 `alreadyImported` 才能写入回复或后续状态。
- 角色、场景和道具 ID 如果目录没有对应实体媒体，只作为文本/来源元数据保留；不得凭 ID 制造图片或声称已导入完整资产库。

## 导入流程

1. 先确认当前请求确实是“导入/投影已有资产”，不是要求重新生成。只问阻塞信息：项目 ID、集数；用户没有指定分镜时导入该集全部分镜。
2. 调用 `import_drama_catalog`。默认 `includeMedia=true`，将现有画面、视频、音频下载到当前 Canvas 的本地/配置存储；用户明确只要目录或媒体过大时传 `includeMedia=false`。
3. 工具会把镜头文字、生成配置、画面、视频和音频放入当前画布，并用稳定的 DramaClaw 来源 ID 去重。第二次导入同一集不重复创建节点。
4. 导入完成后，只能根据结果报告新增、跳过和失败媒体；失败媒体不阻断文字和可用节点导入，也不能写成“全部媒体成功”。
5. 如用户要求继续生成，先读取真实节点和 `get_generation_config`，确认正式来源、当前模型和自动生成开关，再进入视频/图片 Skill。导入动作与生成动作分轮执行。

## 来源与关系

- `sourceSystem=dramaclaw`、项目、集数、revision、实体类型和实体 ID 是追溯信息，不是生成来源的替代品。
- 镜头文字连接到该镜头的生成配置；已有媒体只连接到它对应的配置。不要把整集所有素材串成一条链，也不要因为同属项目而连接总剧本。
- 角色/场景/道具只在真正被某次生成使用时作为直接来源；同类平级参考适合分组，不适合按导入顺序互相连接。
- 导入关系是 evidence-only：它说明来源和归属，不自动提交生成任务。

## 幂等与失败恢复

- 看到 `alreadyImported=true` 时停止重复导入；不要为了“刷新”再次下载或创建同一批节点。
- `episode_not_found`、`beat_not_found`、`node_not_found`、媒体下载失败和后端未配置必须原样按错误类别说明，并保留已经成功落地的节点。
- 不要因为一个媒体失败而删除成功的文字、配置或其他媒体；不要自动无限重试。
- 导入完成后若用户要求排版，单独调用 `arrange_nodes` 或按“DramaClaw 画布排版” Skill 执行；不要把导入动作本身说成已整理完成。

## 禁止事项

- 不调用未经工具定义的 DramaClaw 写接口，不从 Skill 内容推导私有 endpoint。
- 不触发 `generate_image`、`generate_video`、`generate_audio` 作为导入的副作用。
- 不删除节点、覆盖用户已有节点或移动 DramaClaw 源文件。
- 不把本地路径、API Token、媒体响应正文或私有凭据写入节点正文或回复。
