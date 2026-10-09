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
