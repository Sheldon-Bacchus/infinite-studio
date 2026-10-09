# Canvas Agent 连接修复

## 本轮补修状态

以下旧运行证据保留为历史上下文。本轮新改动仅位于无限片场，尚未移植至另一项目；当前代码采用显式独占通道凭据，但凭据持有者不等同于已验证的 Codex threadId，桌面跨聊天隔离仍需 T004 实机核验。

- 每个独立通道调用 `canvas_connection_status` 获取 `channelToken` 和绑定码；网页选择绑定码确认目标。后续工具显式携带自身 token，没有“最近通道”回退。token 只在创建响应返回，网页通道列表不包含 token；这证明显式凭据隔离，不证明平台真实 threadId 或每个桌面聊天各有进程。
- 外部工具逐次校验凭据及绑定状态；内部网页 Agent 通过主进程随机密钥认证，请求体 `internal=true` 不再提供授权。
- 画布已同步要求回执 clientId/projectId/revision 与本次快照三项一致，连接与快照代次拒绝旧回执。
- SSE 断开或切换画布永久撤销授权；执行中的请求转 unknown，保留其目标租约。普通接管保护 executing，unknown 须明确确认后强制接管。清理只针对相关绑定 revision，旧结果不解除未知租约。
- 前端执行前及异步校验后核对目标画布；同通道并发操作按待处理请求汇总保护，切回旧画布不能复活旧授权。
- 历史缺少就绪标志不得显示成功，线程切换清除旧状态，当前读取失败明确显示错误。分页代码静态审阅确认中间页失败与重复游标会传播错误，实机完整性尚待验收。

用户已授权 AGY 启动隔离服务、截图、E2E 与编译。Web 43863 / Agent 17371 为测试服务；用户原服务 43871 / 17372 保留。当前 43863 返回 HTTP 200，但 Agent 17371 健康接口仍是 protocol 7、clients=0、hasCanvas=false；源码与已生成 dist 是 protocol 8。AGY 报告 `canvas-agent npm run build` 通过、`session.test.ts` 29 项通过；`studio/web npm run typecheck` 两次因运行前可用内存不足而未启动。`workspace-service go test ./...` 被其他会话 `internal/works` 编译错误阻断，旧的重复 `hashFile` 已移除。stdio MCP 与租约检查 17 项通过记录仍有效；故障注入 FAULT-001–007、009 有旧协议截图，但主模型检查后将没有弹窗画面的 FAULT-008、仍处加载骨架的 FAULT-010 改为 BLOCKED。截图与逐项结果见 `artifacts/canvas-connection-e2e/browser/`。内存恢复后应重启隔离 Agent 至协议 8，重跑 Web 类型检查，并只补验两个缺陷截图所对应的故障项。T001 原断连原因、T004 真实桌面跨聊天身份、T008 完整真实聊天 E2E、T009 真实 app-server 历史分页及 T010 第二启动路径仍未完成。T011 的另一仓库移植超出当前仓库授权范围。主模型报告见 `artifacts/agy-runs/1791445184949417700-ef419d97d8927c7026fd2cb2/report.md`，验收方案见 `docs/plans/canvas-connection-e2e.md`。

## 原型历史：范围与已确认原因

先在 infinite-studio 的 canvas-agent 与 studio/web 实施，再定向移植到 infinite-canvas；保留两仓库既有资产和视频节点改动。

原运行环境：网页 43871，Agent 17372；健康接口 clients=0、hasCanvas=false，但 infinite-canvas MCP ready。网页未建立连接的具体浏览器原因尚未采集。网页侧栏对话失败原文为 `paginated threads do not support thread/read(includeTurns=true)`。运行入口来自 npm 缓存 0.6.0，未加载仓库源码。

## 原型历史：实现与验收标准

- MCP 进程生成独立 sessionId；调用 canvas_connection_status 后网页按返回编号选择连接，或通过 canvas_bind_connection 指定 clientId。
- 绑定固定 clientId、projectId 与 revision；普通绑定拒绝占用，接管使旧绑定失效；未绑定/已接管连接不能自动改投最近激活网页。
- 绑定变更取消尚未执行的请求；已经开始执行的请求先完成，期间拒绝接管。网页执行前核对请求仍在服务端待处理；附件异步准备后再次核对请求及当前画布。
- 网页 Agent 的内部 MCP 沿用当前正在执行的 turn 绑定，不混入桌面连接选择列表。
- 分页线程的精确错误触发 metadata-only read 与 thread/turns/list(itemsView=full)，遍历所有分页；分页出错不当作空历史，重复游标显式失败。
- 连接失败后诊断健康接口与鉴权响应，区分服务不可访问、401、403、长连接未建立。
- 协议版本提升到 7，旧网页须刷新；不修改消息存储版本或用户历史。
- 本地入口使用现有 tsx 运行 src/index.ts；两个快捷启动脚本及插件入口指向同一仓库源码，不构建、不再运行 npm latest。

## 原型历史：证据与边界

已完成源码静态审阅和定向移植。已重新安装本地插件；在旧 Agent 无网页连接、无正在执行任务时切换服务。健康接口确认 17372 返回 protocolVersion=7，entry 为 infinite-canvas/canvas-agent/src/index.ts；43871 网页服务保持运行。

运行证据补充：原失败线程 GET /agent/codex/threads/:threadId 返回 ok=true、historyReady=true、9 条消息、1 个 settled turn；原分页错误不再阻断恢复，会话为 warning 且 error=null。warning 来自其他 MCP 的启动/认证失败，未修改这些无关服务。

按仓库规则未运行测试、语法检查、typecheck 或构建。浏览器访问授权尚待答复；真实 UI、同对话绑定、接管、晚到请求拒绝均未完成验收。当前聊天缓存旧 MCP 工具，需重载插件工具或新对话才能调用新增工具。sessionId 标识 MCP 进程连接，并非由桌面提供的可信 threadId；桌面跨聊天是否复用 MCP 进程仍需实际验证，不能宣称已完成任意桌面聊天之间的隔离。

人工验收：目标对话获取连接编号 → 网页连接 17372 并同步具体画布 → 绑定编号 → 同对话读取状态 → 另一对话接管 → 原对话读取/写入被拒绝；确认接管未删除聊天或关闭标签。恢复原失败线程，确认完整历史及错误展示。
