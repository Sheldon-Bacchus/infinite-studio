# Phase5 实际源码必要修正

主模型已读取 use-works-store、works-adapter、canvas-archive 当前源码。以下是会直接导致保存被拒绝或业务归属丢失的实现问题，非测试门槛。若本批后续已自行修正，核对即可；否则在进入Phase6前修正。不得以文件存在代表任务完成。

1. works-adapter 的投影缺少 localStudio.schemaVersion、episode.title/currentBeatAssetIds、script.documentKind、beat.order/approvalState/version 链，getLocalStudioRecord 无法识别。projectType/baseStyle 不得写死。文本/虾塘/项目原始业务属性不能丢。按 continuation-plan 使用明确 version=1 的原 Asset 投影（保留原ID/metadata/tags/title/业务data，剥离媒体base64/blob并替换为work fileId）写入服务支持的显式 projection 字段；同步 Go DTO 与 validator。保存后反向重建必须通过 parseWorkspace。项目根同样保存投影，不虚构剧种/风格。
2. 原 Asset id 可能 UUID/nanoid，不可直接用作32位storageID；shot-${id} 也非法。复用 deterministicId32 与迁移 entityMappings，服务实体引用统一转为locator ID；插件视图反向恢复原ID。已迁移作品需读迁移映射，不能制造第二套同名实体。Episode currentShotIds 必须完整，CurrentRevision 只选真实active版本；遍历历史时不得反复覆盖同一Shot或重复change ID，selectedOutputIds/promptRevisionIds 保留。
3. 禁止 sha256 全0、bytes=1、硬编码扩展名/MIME。新媒体先通过真实 byte resolver 上传，再用服务返回完整 descriptor 加入同一 commit；已有 descriptor 原样复用，不改写或伪造。文本同样UTF-8原件。虾塘媒体也是资产角色，不能因 xtRec 分支而跳过媒体。普通独立文本也必须保存，不能遗漏。
4. use-works-store 草稿需保存稳定 operationId、原 baseRevision、完整请求；重试同请求不新ID、不用currentWork.revision静默rebase。编辑新内容显式新请求；冲突保留草稿，重新基准必须用户显式动作。并发或切换时捕获workId并核对当前work before set，旧work提交完成不覆盖新work；保留提交期间的新草稿，不先remove再读失败丢状态。createWork也尊重未提交草稿，创建未决保留同operationId。selectWork同ID但未load不能直接return；异步load/select/refresh需请求归属fence。
5. saveAssetsAndWait 必须经同一store草稿/提交协议，失败草稿存localforage，不直接commit后清空别人的draft。capability初始化读selected work未load时加载该work，不能回退旧来源。订阅仅通知实际work/revision变化，不每次store状态触发回读。archiveAssets 不得向不支持archived字段的记录注入未知字段，Phase6接archive API或写合法archive record。
6. canvas-archive 不得用fileId替代record revisionId，不得保留旧revisionId就宣称未变：比较真实内容摘要+已登记descriptor。重复/复制同对象结果按内容hash复用；新版本通过真原件登记/内容record生成，禁止伪造媒体。object/shot/asset/file ID不可混用；跨work节点归属不确定应pending，不把当前work强灌。未知归属需要localforage持久集合及真正采用入口，不仅函数返回数组。
7. CanvasProjectSnapshot 保存现有完整CanvasProject业务状态（subjects/chatSessions/activeChat/background/showImageInfo等）并通过既有 import/校验恢复。当前sanitize /key/i 会删 storageKey/sourceKey 等合法字段，改为精确凭据字段剥离；媒体url/blob/base64/storageKey规范成作品fileId/hash，恢复用works媒体URL，不依赖旧浏览器blob。不得只存nodes/connections/viewport而丢其它业务。唯一canvas binding用安全稳定ID，检测已有不同canvas拒绝替换。
8. 生成启动固定 workId/generationID，并保存真实字节与pending draft。异步save不读取later currentWorkId；失败留可重试请求。API/store/UI/plugin回调必须实际接通，不只unused helper。

9. 插件 batchArchiveFromCanvas 当前只提取已有assetIds调用archiveAssets将业务资产 archived=true，这不是反向回存，而且会隐藏原资产。反向回存应把实际节点内容/原件按 refs+hash 写新修订或pending，再保存canvas binding；提供独立 capability.archiveCanvasNodes(nodes, canvasId, snapshot) 或等效明确能力，名称与业务删除区分。getNodes真实node shape用SDK类型。toCanvas 的 objectId/revisionId 必须读取投影中的 canonical record身份，不能用原Asset id/fileId伪装；跨work节点不能仅xiajiAssetId存在就强归当前作品。

10. migration.tsx 的「显式切换」当前仅 navigate('/canvas?workId=...')，没有实际调用selectWork；WorksPage「进入画布」也只去列表。显式动作先走作品store草稿切换门控，再从权威canvas_binding恢复该canvas并进入实际project路由。无binding时用户可显式创建唯一画布，不隐式替换其它绑定；恢复优先作品权威，不以旧浏览器已有缓存掩盖。不要用页面上的workId query假装归属已切换。作品页文案简化为作品/素材/保存/历史等用户概念，删去「权威顶层实体/版本树/不可变记录」实现术语。

还需最小收尾Phase4：预览manifestEntityMap重复ID/未知type/schema解码错误及 episode/prompt/asset/media 全关系要阻断canCommit，不能只检查shot两种且decode错误忽略；来源列表JSON损坏应显示错误，不catch空列表。无归属资产标记pending，不用archived:true冒充待归档。

本修正范围同Phase5 Ownership，允许 necessary Go模型字段/校验同步。禁止测试/build/typecheck/语法/gofmt/服务/浏览器/迁移/额外依赖/阈值，不改他人Agent/Subject/连接代码，不写共享文档或勾task。
