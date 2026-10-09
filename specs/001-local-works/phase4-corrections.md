# Phase 4 必要实现修正

主模型已读取实际来源导出、migration.go、HTTP、API 与迁移页。以下是代码层面会阻断迁移或覆盖数据的问题，不是测试/验收门槛。只修正这些实际问题，然后继续后续 task，不扩展审查或添加测试。

1. 迁移当前复制了整个 Commit 发布流程，并在获取作品锁前读取 head/CAS/当前记录。将原 Commit 内核抽为 private commitLocked（公共入口保留 beginOp/maintenance/workLock）；迁移在同一锁内读 head/幂等/CAS，复用该内核。媒体原件发布也复用 RegisterMedia 的 private locked 内核，不另写未 Sync/未校验原件的发布流程。不得递归持锁调用公共 Commit/RegisterMedia。
2. 仅为模型具有 workId 的实体注入 workId；shot_revision/prompt_revision 按其 shotId 归属，不注入未知字段。已有 migration 数据解码失败必须返回错误，不能静默忽略。
3. computeMigrationSubstantiveDigest 目前未调用，预览/提交仅检查 digest 字符格式。服务必须重新计算并比较实质摘要；摘要包含完整 source.json 的字节 SHA-256，保证未转换的原始业务字段变更也可检测。浏览器 pack 阶段确定 source.json 字节后填 sourceSnapshotDigest，前后端共同以固定字段顺序的标准 JSON 数组 [sourceId,sourceType,sourceSnapshotDigest,sortedEntityHashes,sortedFileHashes] 计算 sourceDigest，服务用 SetEscapeHTML(false) 编码去末尾换行。实体摘要复用既有实体序列化逻辑，保留一致顺序；不含本次导出时间或随机 ID。
4. ZIP 拒绝大小写重复条目、链接、反斜杠路径、绝对路径/ADS/设备名、任何 .. 路径段。清单文件路径必须匹配 files/<hash><规范 MIME 扩展名>，哈希、字节数与 MIME 同时校验；先验证完整包再发布。缺件/错误关系和已有实体覆盖冲突要反映到 preview.canCommit，不能只在提交后发现。
5. 备份 package.zip/manifest.json 用 O_EXCL、Sync、Close、前后重解析点核验；所有存在性错误准确返回，不隐式覆盖。备份未完整确认之前不得切换作品指针。
6. 重复来源判断在 CAS 之前完成，丢失回执重试不被旧 baseRevision 阻断。返回原持久提交回执与实际 indexState，不拼造新 operationId 的虚拟回执；同 operationId 不同来源/摘要必须冲突。同源不同版本继续明确冲突，不隐式覆盖。
7. 镜头修订 content 使用 beat.data.content，不能用 title 替代；supersedes 环/缺父/多活动版本拒绝导出，不静默选任意项。原来源 workspace 必须 parseWorkspace 校验。
8. 来源导出覆盖文本 UTF-8、图片/视频/音频及原件定位：复用宿主 resolveImageUrl/resolveMediaUrl 与本地 files API，data/blob/本地 fileId 均按真实字节取原件。宿主素材原件取不到必须列缺件，不能生成空 currentMediaIds 假装完整。未知 MIME 不制造 .bin。JSON 损坏不能 catch 后当空来源。
9. 一作品一画布/一作品来源项目：导出 UI 让用户明确选择一个无限虾项目或一个画布，不能把多项目/多画布自动塞进一个作品。按原关系选择关联分集/镜头/虾塘与媒体，独立无归属素材明确列为待归档。
10. 前端预览绑定本次包摘要、目标作品和预览修订；更改任一项使旧预览失效，晚到响应不得覆盖新状态。提交捕获预览的 baseRevision 与固定 operationId；未决重试复用同一请求。响应 guards 校验实际使用的字段与数组项，inspect 不用 null as unknown 伪造合法清单。

范围：已有 Phase4 文件 + 为复用内核必要的 commit.go/media.go。不改连接组件、Agent stores、共享文档、依赖或真实数据。不运行测试/构建/语法检查，不添加测试，不新增超时/重试/并发/大小经验阈值。保持已实现的路由和页面，不另做 UI 大重构。
