# 主模型审阅与执行记录

## 当前审阅结论

以下为当前权威状态；本文后续「未完成」段落是此前执行时的历史记录，不代表当前状态。主模型已静态核对 T011–T025 的主要入口与存储调用链，并修正本轮发现的问题；T001–T010 与 T017 的审阅证据见下方既有记录。

| 任务 | 静态审阅结论 |
| --- | --- |
| T011–T012 | 旧来源按用户选择只读打包，清单、实体映射、原件和摘要进入迁移包；服务端预览检查来源摘要、媒体、身份映射、实体 schema 与业务引用，提交在隔离区登记并保留原始包备份，重复来源/操作按持久回执处理。 |
| T013–T014 | API 运行时 guard 核对迁移响应关键字段及枚举；迁移页提供缺件、冲突、映射预览和显式目标选择，提交后先经 Works store 切换门控，再恢复绑定画布或显式创建画布。guard 同时接受 infinite-canvas 与 infinite-xia 两种实际来源。 |
| T015–T017 | Store 的当前作品、草稿、提交冲突、切换 fence 和创建/归档/恢复未决请求均沿 localforage 持久化；插件读写经 Works adapter 和同一草稿提交协议，作品库入口及导航可达。 |
| T018–T020 | Node/object/revision/source 身份分离；反向归档读取真实 Blob、按摘要去重并写入唯一 canvas binding；跨作品或未知来源进入 pending；图、视频、音频、文本生成产物保留原始字节和稳定来源，未确认时不将旧 canvas fileId 伪作 Works fileId。 |
| T021 | 镜头编辑继承稳定 shotId；提示词修订独立保存，用户可显式将历史修订设为当前版本；投放画布时携带实际提示词修订身份和内容。 |
| T022 | 生成开始前等待初始记录落盘，捕获启动作品、分集/镜头/来源修订、选用提示词修订、编译输入和参数；成功输出先持久化并上传真实 Blob，再将 Works media 与 generation 记录一并提交。失败/取消、远程任务续查、并发多输出和切换作品均保留原尝试归属；无来源历史保持未归属。 |
| T023 | archive/restore 仅面向服务端支持的实体类型；状态与不可变归档记录一起提交，按 baseRevision 原始记录重建请求并核对完整摘要，原件不物理删除。 |
| T024 | ZIP 导出包含可达提交链、不可变记录、真实媒体原件及迁移记录引用的根备份；预览校验路径、schema、回执、业务引用和媒体/备份哈希。导入回执在发布前持久化，同 operationId+digest 可重试；发布使用隔离暂存与 no-replace。补充校验嵌入/外部迁移清单一致、拒绝已有备份目录额外条目、检查目标修订回溯循环及关键 ZIP reader/文件关闭错误。 |
| T025 | 审计检查记录规范摘要、媒体实际 SHA/大小、索引状态和作品/根暂存残留；只报告不清理。inbox 采用前复读哈希，operationId 回执比对完整载荷，提交成功后才删除原文件。 |
| T026–T027 | 本审阅和文档状态已更新；待用户进行的测试、构建、服务和浏览器验收仅登记 pending-test，不阻断实现状态。 |

验证边界：本轮仅做源码静态审阅，没有运行测试、构建、类型/语法检查、格式化、服务启动、浏览器或真实迁移。实现完成不等于用户验收通过；待验收项见 `docs/content/docs/progress/pending-test.mdx`。

## 当前 SDD 推进规则

用户要求按 SDD 继续完成后续 plan/tasks，测试和用户验收不作为实施门槛。AGY 提供方额度耗尽后，用户明确改用 Luna max subagent；执行结果已返回并经主模型静态审阅。T001–T027 已实现并勾选，下面早期「未完成」记录属于历史状态；仅剩的运行验收单列 pending-test。

已运行官方 prerequisite 脚本，Feature 确认为 001-local-works；没有 extensions.yml 注册 hooks。requirements 清单 6 项中 5 项已勾选、1 项运行验收未勾选，保留原标记；用户当前明确授权继续，不重复请求确认。Phase 4 已派 AGY job 1791434599920722800-c7eb786982977766496ea826，实现 T011–T014，最终结果待回读。

## 完整 works 静态审阅续接

已完整读取 Kiro 交接记录并核对本仓库路径。当前 works 包九个源文件与 main.go 已产生，T003–T010 仍未勾选；交接中的执行器自报不能替代主模型证据。

主模型确认的修复项：提交索引中的新记录缺 revisionId；不可变记录复用按原始 JSON 空白比较会误报冲突；HTTP 详情及索引重建重复读取 head 会混合修订；单作品索引重建未覆盖 Store 生命周期；全量重建不清过期作品投影且缺历史提交；空记录静默跳过；Close 覆盖索引关闭错误；替换目标丢失时隐式创建 head；方法子串匹配；受保护媒体公共缓存；未经确认的索引等待/连接数与文件名长度边界。AGY 四轮定向修复均 done，主模型已回读对应源码；完整记录见 artifacts/agy-runs/1791433006855158500-ffd99c943795cc5644f6bee5/report.md。

main.go 已局部收紧到精确 works 根路径或 works 子路径，保留旧 handler、旧 data-root、LOCAL_WORKSPACE_ACCESS_TOKEN 和回环监听地址。HTTP 门禁与旧服务相同的 Host/Origin；works 缺 token 拒绝。

后续回读确认：创建请求摘要保留原请求可空 id；初始提交保存实际创建 operationId/摘要/回执，仓库级 createMu 串行化查找与发布。创建发布后强校验 head，索引失败返回 committed=true/pending_rebuild。maintenanceMu 排他覆盖全量采集与索引事务，常规创建/提交/媒体写入/单作品重建持读锁；公共重建入口委托 Store，统一维护锁→作品锁→索引锁。单作品/全量重建恢复全部提交历史，事务拒绝坏记录/媒体描述符并清理过期索引标记。SQLite journal/wal/shm 预检拒绝既存重解析点；根必须非空绝对路径。空记录在叠加变更前拒绝；最终集合至多一条画布绑定。失效 import 已移除。

边界：仅完成源码静态阅读，没有运行语法检查、编译、测试、构建、服务、浏览器或迁移。Windows 文件属性预检不证明外部进程并发替换路径的句柄级防护；数据库损坏恢复、提交中断与关闭/重建竞争需隔离运行证据。NodeRefs 的对象/修订/来源映射留待 T018，迁移与归档/ZIP/恢复不在本轮实现范围。T003–T010 保持未勾选，不凭执行器自报认定运行验收通过。Phase 4 可准备只读来源导出设计，但本轮未派发；真实迁移前须基础隔离验收及来源备份/预览。

## SDD 一致性

FR-001/002/003/005/012 → T003–T010；FR-004 → T011–T014；FR-006/007 → T015–T020；FR-008/009/010/011 → T021–T025。没有遗漏核心需求。

需实施细化：最终 ID 格式与 Windows 完整路径预算；变化记录 locator 与提交清单引用结构；稳定镜头 ID 对现有版本链的迁移映射。由主模型设计后补充契约，执行者不得自行添加经验大小/并发/超时阈值。

Spec Kit 1.0.6 通过官方 init 安装；官方 create-new-feature/setup-plan/setup-tasks 已实际调用；不存在 extensions.yml，因此无注册 hooks。主模型已完成 specify/plan/tasks 内容与静态一致性审阅，未调用 implement 或 converge，不假称完整工作流完成。

## DeepSeek 阻塞

指定 endpoint http://127.0.0.1:10100/v1 的 GET /models 连接被拒绝。只读探测工具墙钟约 2.43 秒；没有发起模型执行会话，无可用 provider usage；费用未知，不估算。用户指令指定 deepseek/deepseek-flash，路由文档最新部分提及不同 AutoDL 名称，未擅自替换模型。正常桌面 provider 未改。

业务代码未修改，T003–T027 全未完成。未运行语法检查、测试、构建、服务、浏览器或真实迁移。恢复指定路由后按 executor-prompt.md 派首批，然后主模型审阅。

## 首批运行

用户指定 AGY 替代 DeepSeek。实际 job：1791423832094031000-188657e23f074982a73a0c49，当前运行中。补充设计：records/<recordRevisionId>.json 不可变记录，提交 manifest 引用完整当前集合并保留父提交；work.json 唯一权威；持锁关闭等待写入结束；媒体 stream/verify/reuse。初始检查清单 5 checked / 1 unchecked（运行验收）；用户已明确开始执行，剩余项保持未勾。官方 prerequisite 脚本已运行。没有 extensions.yml hooks。

首批 job 已终止 failed，error=authentication failed or timed out，elapsed=1m12s，token usage 全 0，无模型/会话/result 字段。只读核对 works 包和 execution.md 尚不存在；无部分改动可恢复。报告 artifacts/agy-runs/1791423832094031000-188657e23f074982a73a0c49/report.md。不自动重试或切换提供方。

## AGY 重试与静态收尾

用户授权重试，首轮 job 1791424018877666300-e87b6f66b2e4c5573674e822 done（3m48s），同会话补修两轮 done（2m8s、1m47s）。新 works 包七文件与 execution.md 已产生。主模型实际阅读后确认仍有非媒体缺身份字段、引用所属对象以及部分最终路径校验缺口；任务不能勾选。完整报告 artifacts/agy-runs/1791424018877666300-e87b6f66b2e4c5573674e822/report.md。后续继续定向补修，未运行任何验证命令或触碰真实数据。

### SDD 连续执行检查点

T003–T010 已实现并静态审阅完成，已勾选；不再以运行验收阻断后续实施。Phase4 代码已落地：持锁 commit/media 内核、完整来源摘要、原件备份、单来源选择、预览失效与固定重试操作；仍需修正迁移原始回执定位与实际索引状态，T011–T014 暂不勾选。AGY 首轮迁移收尾 TLS bad record MAC，聚焦补修进程 interrupted，续跑 1791437843881388000-1abea03ef6f9c8e40e362057 在 11m26s 收尾 EOF，输出 partial；保留所有已写代码，不换 provider。该会话工具 total_tokens 1490547，可能累计口径，费用未知。

已派新 AGY job 1791438576411046300-964863b1594fda08249d2376，先补上述回执缺口，再执行 T015–T020。范围与验收见 continuation-plan.md Phase5；未运行测试、构建、语法检查、服务或迁移。T021–T027 尚未实施完成，须继续后续批次与文档收尾，不得用本检查点宣称整个 plan 已完成。

## 当前终态与下一步

T017 已回读 pages/works/index.tsx、router.tsx、navigation-tools 与中文导航并勾选；T003–T010保持完成。最新store补修已读：draft持久operationId/baseRevision，提交捕获目标workId并检查fence；创建未决operationId尚未持久、adapter未接此草稿协议，故T015整体尚未完成。Go projection字段已写入，但adapter旧投影及假媒体仍需定向修正，不能把字段存在当作完成。作品恢复与反向回存/生成入口仍未完全接通。

Phase5初轮30m3s timeout；续跑13m29s quota_exhausted；用户要求重新试一次后，job1791441319144963200-5a842170bdb08d8e3eed8ab5 在33s再次 quota_exhausted，提示3h7m37s恢复。无运行任务，无provider切换；会话922eec2d-1246-4af7-997b-f52528512c42可续接。usage最后total1836332与前轮同值，按会话累计保留不加总。恢复后执行phase5-corrections.md的实际修正，再执行executor-phase6-plan.md；不得重做已落地入口或转向测试门槛。T026/T027最终收尾仍未勾选。
