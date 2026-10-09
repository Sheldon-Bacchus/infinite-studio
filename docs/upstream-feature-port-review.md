# 无限画布新功能移植核对

来源为本机 E:/all-agent-workspace/infinite-canvas 当前工作区（含未提交变更），HEAD 233a859。本次仅静态核对，不修改来源仓库。

## 建议移植

- 配置引用排序：canvas-reference-plan.ts、canvas-reference-copy.ts、referenceNodeOrder；片场当前缺失。适配片场 Subject 与用途绑定及稳定 fileId，不改变有效输入确认规则。
- AutoDL 五种视频工作流：预设配置包、视频API、autodl-video-settings.ts及最终槽位预览；片场当前没有对应实现。保留原版/升级版、凭据和其他渠道。1088p 上游仍明确禁用，不得承诺支持；真实计费生成、CORS与Token权限未完整验收。
- MCP 本地素材目录授权、搜索与导入：来源 canvas-agent/src/canvas/local-assets.ts；片场缺失。必须写入片场 workspace files 与持久fileId，不仅浏览器临时存储。
- 视频下载：来源 web/src/lib/canvas/video-download.ts；片场缺失对应辅助模块。上游真实保存仅在代理启用条件下通过，直接跨域保存不能宣称可用。

## 保留片场实现并对比补修

- Agent连接：片场已有sudio身份隔离与协议8；上游记录仍协议7。不可整体覆盖，重点检查服务状态、历史状态和诊断差异。
- 启动管理：片场已有持久D盘目录及桌面管理器；不复制上游43871/17372启动器。
- v0.19缩略图等基底能力不作为全部新增重做，按具体文件差异检查。

## 片场自身缺口

viewport与内容共享版本造成跨浏览器冲突；没有完整自动回读/冲突合并；历史同步无任务时仍显示同步中；MCP汇总没有列出失败服务。这些不能靠复制上游功能假定解决。

建议顺序：片场保存/状态问题 → 引用排序与复制 → 本地素材MCP → 视频下载 → AutoDL。待用户核对范围后准备实施计划。现有TODO不勾选，新增能力尚未实现，未运行测试或构建。
