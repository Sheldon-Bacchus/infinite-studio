# 全量功能移植执行计划

用户已授权五项全部移植，视频下载要求保留既有可用行为。来源 E:/all-agent-workspace/infinite-canvas（只读，含未提交代码）；目标仅本仓库。

1. 配置引用排序、组连续编号与复制粘贴关系：移植canvas-reference-plan/copy及referenceNodeOrder，适配现有视频Subject、稳定身份与确认失效。
2. 本地素材MCP授权搜索导入：移植local-assets、相关HTTP/MCP/UI入口，保留sudio身份与协议8，导入原件进入workspace-service files并持久fileId。
3. AutoDL五种既有工作流、预设包、能力设置和最终输入槽位预览：适配现有video API和输入确认；保留其他渠道Token，不允许失败自动收费回退，不宣称1088p支持。
4. 视频下载：片场当前saveAs(content)直接路径，用户报告可用。禁止直接替换成强制fetch Blob。分析fileId本地原件优先及现有成功路径；只在明确失败路径增加准确原因和显式打开原视频交接，不能将打开页视为下载完成。
5. 用户已要求路由品牌改为/sudio及/sudio/:id，更新所有前端链接、启动器、MCP site_navigate白名单/文案；旧路由只做重定向保留现有用户标签。不要改业务存储key或API/canvas协议路径。

验收：原有Works/D盘持久化不丢、sudio不回上游17372；引用顺序和复制关系正确；导入真正原件非占位；AutoDL提交前完整参数校验；正常非AutoDL路径不变；视频原成功路径保留。新增行为边界限制须先报告主模型，不添加任意超时/大小/重试。未授权本轮新测试/build/typecheck，仅静态审阅，潜在测试命令bun test留pending-test。

执行者拥有涉及studio/web、canvas-agent、plugins/model-profiles及scripts/manage-studio-services.ps1的必要文件。多人共享工作区，不回滚或覆盖既有改动；分模块报告改动与来源。主模型负责下载设计、集成及静态审阅。结束更新TODO/pending-test/CHANGELOG/HANDOFF，来源仓库不写。
