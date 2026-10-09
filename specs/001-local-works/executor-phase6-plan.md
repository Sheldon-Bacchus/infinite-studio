# Phase 6 执行细则：T021–T025

本细则由主模型规划。延续 continuation-plan.md；实现后主模型仅静态审阅，不运行测试、构建、语法检查、服务、浏览器或真实迁移。不得新增经验超时、重试、并发或大小阈值。沿已实现 store/adapter/commitLocked 内核，不复制提交流程。

## T021 镜头与提示词修订

现有 beat 以 Asset ID 表示内容版本，并已有 supersedesAssetId 链。增加明确稳定 shotId，创建时生成，编辑/包应用/素材关联产生新 beat 版本时沿用同一 shotId；历史版本 content 不回写。迁移与 adapter 映射跟随稳定 shotId，旧来源导入时由已校验版本链根确定身份，不引入已发布数据迁移兜底。

提示词修订保存独立 ID、shotId、sourceRevision、imagePrompt/videoPrompt。通过真实 repository 编辑动作和公共 works adapter 写入，在 UI 提供可达历史查看/修改入口；修改提示词不能修改已有生成 inputSnapshot。选用关系必须用户动作明确修改，不自动把新结果选为当前。

具体采用独立 `LocalStudioPromptRecord`（recordType=prompt，schemaVersion=1，projectAssetId/episodeAssetId/shotId/sourceRevision/imagePrompt/videoPrompt，可记录版本与前一提示词ID）的文本 Asset，扩展既有 union/validator/repository 与作品 projection。repository 提供创建/列出提示词修订，插件当前镜头编辑区提供图片/视频提示词编辑及历史选择。新提示词新增实体，不回写旧 beat 内容或旧提示词；作品 adapter 转成真正 prompt_revision 并保留原 Asset 投影。generation 引用实际选中的提示词 revision 并把内容放进输入快照。现有ShotRevision的promptRevisionIds引用可以版本化更新，但旧生成及旧提交的不可变记录不受影响。

## T022 生成历史

复用 Phase5 的生成启动归属捕获与待归档登记。启动时固定 workId、shot/episode/sourceRevision 和 generation ID；记录实际编译后的输入、真实模型/渠道身份与参数，严禁渠道 Key/token。远程任务 ID 有值后更新同一尝试；失败/取消留状态及真实原因；重试是新尝试，重复登记同尝试复用相同 operationId/请求。切换作品后完成仍写启动作品，未归属保持 pending 草稿。图片/视频实际生成路径及插件调用要接入，不只留下 helper；外部导入缺少输入保持未知。

## T023 业务归档恢复

archive.go 提供 archive/restore HTTP 能力，用 baseRevision/operationId 和 commitLocked。归档记录包含实体引用、源修订、状态；可见性沿归档记录或适用实体 archived 字段统一决定，恢复不覆盖后来编辑。所有历史记录与原件保留，不永久删文件。API/store/作品页提供真实可达归档和恢复入口，幂等未决重试保留原请求。

## T024 固定修订作品 ZIP

导出固定已提交 revision 对应 commit：含 work 清单、其完整可达提交链、每个提交引用的不可变记录、这些记录引用的原件和来源备份/归档关系。读取历史媒体使用该记录的描述符，不以当前 GetMediaFile 替代旧哈希。ZIP 不含 Token/Key、SQLite/index、缓存、staging 或未提交残留。

archive/zip 成熟解析，所有条目在发布前校验：规范相对路径、拒绝反斜杠/绝对/ADS/设备名/..、大小写重名、链接/非普通文件、未知 schema、内容摘要/字节数、提交链和业务关系。预览列摘要/冲突/缺件；同作品 ID 已存在拒绝覆盖。确认在隔离 staging 构造并完整核验，再以 no-replace 发布新作品目录，不在目标目录逐项暴露半包。沿已有仓库维护锁与创建幂等约定。导入未决重试以原 operationId+包摘要识别已发布作品，异内容同 ID 拒绝。

服务 /import/preview、/import/commit、work/export 及前端 API/作品页可达。浏览器 ZIP 用既有 fflate；备份路径只由 locator 生成。禁止隐式导入真实数据。

## T025 恢复与手动 inbox

recovery.go 在维护锁/作品锁下核对权威 work.json 与完整提交链；报告 orphan/staging/未登记原件，不把孤立提交推断为已生效，不替换未知/损坏 head，不直接清理。显式重建沿现有索引能力，重建受生命周期与维护锁约束；损坏索引允许显式恢复入口，不以覆盖未知文件作为恢复。

inbox 由显式创建作品时生成，手动 scan 仅扫描该作品 locator 内普通文件，拒绝链接/越界，不监听。差异以真实 SHA/MIME/bytes 和已登记记录比较；用户采用时复读并核对 scan 摘要，复用流式 registerMediaLocked 和 commitLocked，产生新媒体/待归档业务引用，绝不自动合并或修改剧本文本。API/store/作品页提供手动扫描、差异提示、显式采用和恢复报告；文件变化后要求重新扫描，不静默采用别的字节。

## Ownership 与收尾

拥有 workspace-service/internal/works/{archive,package,recovery}.go 与必要 model/http/path/store/commit/index 局部扩展；plugins/canvas/infinite-xia/src/core/{local-studio-model,local-studio-repository}.ts、必要提示词历史 UI/adapter；studio/web/src/lib/works/generation-history.ts 及既有生成局部接入、services/api/works.ts、use-works-store、pages/works 的功能入口。SDK capability 如需扩展同步公共类型。不得改另一对话 Agent/连接组件、canvas-agent、其他仓库、共享文档/tasks、依赖；不得回滚现有 Subject/H3 或用户修改。

检查每项从入口到实际存储的调用链，禁止 unused helper/TODO/stub 代替完成。逐模块 checkpoint 到 execution-phase6.md，返回真实完成与未完成项。主模型随后处理 T026/T027 与共享文档。
