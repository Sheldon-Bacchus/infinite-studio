# AGY Run｜Canvas Agent 连接审阅与补修

> 状态：completed（补修执行完成，运行验收未完成） · 模式：execute
> 模型：工具未返回 resolved model，unknown · 最终 Run：1791434315282796700-e6909b14aa1ff7bbe86ae730

## 结论

原 T001–T010 的自报完成不能作为验收。本轮确认并修复聊天身份、内部授权绕过、同步回执、unknown 租约及接管缺陷；主模型已复核源码，服务端类型检查通过。Web 仍有 31 条范围外类型诊断。T004 实机探针、浏览器交叉场景和 T011 移植仍未完成。

## 快速摘要

- 范围：仅无限片场 Canvas Agent 与 studio/web 的连接文件；未修改 main.go、作品模块、视频或资产业务文件，未移植另一仓库。
- 原代码问题：P1 身份/内部授权、同步成功误判、unknown 丢失及接管隔离；P2 诊断、历史状态及 UI 规范。均按主模型方案定向补修。
- 审阅：当前 GPT 对话完整读取交接及 connection-sdd 三份修订稿，阅读源码和 Git diff，逐轮核对并退回遗漏，最后执行允许的类型检查。
- 变更：channelToken、内部私有密钥、三字段回执、快照/连接代次、请求目标校验、撤销/并发/unknown 租约、历史状态和主题 UI。
- 未提交 Git，未启动或停止用户服务/标签页。原有未提交工作保留。

## 审阅依据与关键修正

### 身份与内部授权

来源：Codex 源码核对。原 MCP 进程随机 sessionId/绑定码由所有使用该进程的聊天共享；请求体 internal=true 可选择网页 Agent 路径。

服务端现在创建随机独立 channelToken，私有映射位于 `canvas-agent/src/canvas/mcp-connections.ts:27`。MCP 不缓存最近凭据，所有外部操作在 `canvas-agent/src/server/mcp.ts:78` 声明凭据参数并逐次转发；HTTP 在 `canvas-agent/src/server/http.ts:235` 校验内部专用密钥或外部凭据，缺少/错误/撤销的外部授权拒绝工具读取与写入。网页清单不返回 token。主进程内部密钥每次启动随机产生，仅通过自己的 MCP 启动配置传递。

这证明的是源码中的显式凭据隔离契约，不能证明平台真实 threadId，也不是对有权读取本机配置或执行任意本地代码者的系统隔离。SDK RequestHandlerExtra 类型只有 transport sessionId 与可选请求元数据，不提供已验证聊天身份的证据。T004 实机探针仍缺失。

### 回执与旧异步结果

来源：Codex 源码核对。原实现 revision 只检查非空，旧快照回执可能恢复同步成功。

`studio/web/src/components/agent/local-agent-panel.tsx:328` 按本次提交的 clientId/projectId/revision 比对；快照改变立即清除成功状态，按快照与连接代次拦截旧回执，断开递增代次。版本号优先来自现有 canvasRevision/operationId，否则本次提交显式生成随机 revision。两处数字版本号错误分支经 tsc 定位后由 AGY 删除，未扩大业务类型。

### 执行租约、接管与画布切换

来源：Codex 源码核对。原断开逻辑将 unknown 经 reject 改成 failed；force 在目标校验前修改租约；同通道重绑与画布切回可能恢复旧授权，并发中的单个请求结束可能过早释放保护。

`canvas-agent/src/canvas/session.ts:110` 按当前绑定 revision 汇总执行请求。断开/切画布撤销授权但保留 unknown 目标租约；`mcp-connections.ts:130` 保留目标并设置 revoked，valid 同时检查撤销标志和 revision。执行中阻止接管，unknown 必须显式 force。接管验证通过后只取消被撤销绑定及所选通道旧请求，不跨画布清理。

unknown 拒绝再次执行；晚到结果在 `session.ts:544` 被拒绝且不能解除未知租约。旧回调不能改变新 revision 状态。工具请求携带 projectId，网页在校验往返后和附件异步准备后再次核对目标，避免切画布时写入新目标。

### 诊断、历史、启动及 UI

原服务探测成功文本也会让 serviceAvailable=false，现改为结构化诊断。403 与网络异常只按证据分类；健康通过后的其他请求失败不误称服务未启动。

历史分页代码读取 full items、传播中间页异常并拒绝重复游标；此为静态结论，无本轮分页运行证据。前端线程切换清除就绪状态，只有服务端明确 historyReady=true 才显示成功，当前读取失败显示错误，旧读取失败不得覆盖新线程。

启动器、插件和网页命令静态指向片场本地 src/index.ts，健康接口返回版本及进程 entry。本轮未执行启动器、核验实际端口或重载插件；不能拿旧交接记录的端口证明新代码已加载。

连接 UI 普通操作改为扁平按钮，新增状态色使用 Ant Design theme.useToken；用户主流程显示画布标题和状态。参考 [Ant Design 官方组件文档](https://ant.design/llms-full.txt)，未做视觉验收。

## 实际执行与检查

- AGY 4 轮均 done，主模型在每轮后审阅实际源码；第二轮报告中 unknown 分支“已修复”的表述与源码不一致，第三轮才补齐，不以报告意图代替证据。
- `canvas-agent`：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` 最终 exit 0。
- `studio/web`：`node node_modules/typescript/bin/tsc --noEmit --incremental false` 最终 exit 1；本轮连接文件无诊断，剩余 31 条位于 model-script-editor、canvas-generation-helpers、canvas-video-inputs、commit-queue、video 页面、canvas store 与 asset store。未修范围外文件。
- 未新增/运行测试，未构建，未启动服务或浏览器，未调用真实生成服务。已有 session.test.ts 的协议号改动在本轮开始前已存在，未改写或执行。
- 主模型更新 CHANGELOG、todo、pending-test、固定 HANDOFF 和连接审阅说明；执行者未写流程登记文件。正式功能说明未更新。

## 运行记录与用量

| Run | 工具状态 | 工具耗时 | total_tokens |
| --- | --- | --- | --- |
| 1791432914344890700-7ef5b658d055d6dc00256b69 | done | 5m47s | 459087 |
| 1791433307766684500-7766c1d76a27b9ab5ade8156 | done | 8m3s | 946403 |
| 1791433839758563000-263b7692ea90b6d44c2a19ca | done | 7m36s | 1386545 |
| 1791434315282796700-e6909b14aa1ff7bbe86ae730 | done | 42s | 1414457 |

同一 conversation：cb5b2a8d-bacb-49fb-9eac-3bd180d7ae1c。四轮工具耗时合计 22m8s（不包含主模型审阅时间）。usage 随 num_turns 增加，可能是会话累计，不能累加。最后返回 input_tokens=1202990、output_tokens=211467、thinking_tokens=140195、cache_read_tokens=29564996；费用未提供，不估算。执行期间未切换 provider。

## 未解事项与下一步

1. T001：没有交接列出的 work/*.log；未取得原网页断连的请求/响应，根因仍未知。
2. T004/T008：需要实机共享 MCP 与 A/B 聊天 × 甲/乙画布、并发/待确认/断线/切回/晚到结果验收。显式凭据实现不替代实机证据。
3. T009/T010：真实多页历史完整性、实际启动入口与当前进程对齐需要验收。
4. Web 31 条范围外类型诊断未解决，不宣称整站通过。
5. 仓库 specs/002-canvas-connection 是旧稿，修订稿位于交接目录 connection-sdd；任务不勾选，下一轮应先统一规格来源。
6. T011 尚未移植；须用户明确确认后才在另一项目实施。本轮没有改变另一项目状态。

运行验收前需重启 Agent、重载 MCP 工具并刷新网页，使内部密钥、外部工具 schema 与前端一致。首次创建通道后，聊天保管 token，网页按绑定码选择目标，后续调用显式携带 token。
