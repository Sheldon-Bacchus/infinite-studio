# Data Model

全部规范清单带 schemaVersion=1；未知值拒绝覆盖。实体 ID 用小写安全 ASCII；用户展示名/原文件名保留字段，不能作为路径。

- Work：id/title/currentCommitId/revision/schemaVersion。
- Commit：id/workId/revision/baseRevision/operationId/requestDigest/recordRefs/previousCommitId/receipt。

初始提交同样保存实际创建 operationId、SHA-256 requestDigest 与回执；baseRevision=0、revision=1、无父提交、recordRefs 为空对象。创建请求摘要保留原请求可空 id，不包含服务新生成的 ID；不沿用草稿的 init/空摘要哨兵。尚未上线，不实现旧格式迁移。
- Record：id/type/revisionId/workId/data；不可变记录 locator 由服务生成。
- Episode：id/workId/order/title/currentScriptRevision/currentShotIds。
- Shot：id/workId/episodeId/currentRevision/selectedOutputIds。
- ShotRevision：id/shotId/content/dialogue/referenceAssetIds/promptRevisionIds。
- Asset：id/workId/domain/parentId/currentMediaIds/archived。
- Media：fileId/workId/sha256/bytes/mimeType/kind/extension/metadata；kind=text|image|video|audio；fileId 与物理 hash locator 独立，业务角色可多引用同一原件。
- PromptRevision：id/shotId/sourceRevision/imagePrompt/videoPrompt。
- Generation：id/workId/episodeId/shotId/sourceRevision/inputSnapshot/modelChannel/parameters/taskId/status/outputFileIds；失败也保留，外部导入未提供参数不得造值。
- CanvasBinding：workId/canvasId；首期唯一绑定，NodeRef 保存 objectId/revisionId/来源身份。
- Migration：sourceId/sourceDigest/entityMappings/fileMappings/status/backupReferences；来源合并冲突需预览。
- Archive：id/workId/entityRefs/sourceRevision；不使历史原件失效。

文本有 content/encoding；图片 width/height；视频 width/height/duration；音频 duration，采样率/声道可选。未知字段明确为空/未知，不填假值。


## Generation 扩展：任务尝试、队列与诊断契约（待实现）

配套需求及组件计划见 ../002-canvas-connection/spec.md 和 plan.md。本扩展复用 Generation，不建立另一套作品生成历史。

- Generation/Attempt：沿用生成记录身份；新增 parentAttemptId、workspaceId、canvasId、nodeId、sourceRevision、status、phase、submission、connection、outputState、remoteTaskId、createdAt/updatedAt、failureStage、reasonCode。无作品归属的自由画布任务允许 workId/shotId 为空，不虚构归档关系。
- InputSnapshot：最终提示词、完整 channelId/modelId、协议、适配器身份/版本（未知留空）、配置版本或摘要、实际发送参数及界面参数差异、固定 bindings（身份/版本/用途/顺序）、候选指纹。保存后不可变；不包含密钥，不以当前节点反查覆盖历史。
- TaskEvent：eventId、attemptId、sequence、时间、阶段、类型、脱敏原因/详情、可用的远程关联 ID。按事件身份去重，状态归并拒绝晚到回退。
- Output：远程结果可用状态、本地 fileId、下载/保存状态及错误；有远程结果不等于已有本地文件。归档复用既有幂等操作身份，重试保存不重复挂回节点或作品。
- Queue：引用 attemptId 与当前执行权；排队顺序和暂停状态不改变发送快照。任务记录不包含媒体 base64，媒体使用既有身份引用。

持久化实现先审计当前契约；不擅自迁移或覆盖用户历史。若必须升级 schema，先提交具体变更与备份恢复方案，未知版本拒绝写入。本轮仅设计字段，未落库。
