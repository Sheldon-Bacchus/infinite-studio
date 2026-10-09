# AGY Run｜Canvas Agent 实机与 E2E

> 状态：partial · 模式：execute
> 模型：工具未返回 resolved model · Run：1791438437190663300-27a8e23dd9c05cbf4c70412d

## 结论

主要浏览器 6 项与协议 17 项已有通过证据；故障注入套件仍失败，整体为部分验收。不能宣称全量 E2E、桌面跨聊天、真实历史分页或工作区持久化完整通过。

## 快速摘要

- 范围：仅 infinite-studio；Web 43863、Agent 17371；浏览器本地存储模式。
- 结果：主要浏览器 6 项 PASS，真实 stdio 7 项 PASS，真实服务/合成 SSE 客户端 10 项 PASS。测试命令退出码由 AGY 记录为 0。
- 审阅：当前 GPT 直接审阅脚本、结构化结果、脱敏日志与真实截图，退回过弱断言后再次回读。
- 变更：测试脚本、截图、结果与文档；本轮没有连接业务源码修复，没有构建或 T011 移植。

## 已核对证据

- 浏览器：新建项目、连接与同步、真实 Select 选择/绑定 A、HTTP 工具写节点并检查 DOM 与状态、真实确认弹窗接管 B、A 读写返回 403 且节点保留、刷新后 B 旧凭据拒绝。
- 同一自建 stdio MCP 进程：36 工具注册，A/B 独立 token 与绑定码，凭据状态隔离，缺少/错误 token 和未绑定写入明确拒绝；失败不是以任意异常判为 PASS。
- 真实服务与合成 SSE 客户端：executing 拒接管；断 SSE 后 unknown；普通接管拒绝、force 成功；晚到结果明确 409；两条请求均 executing 时完成第一条仍保护，第二条完成后可接管；重绑旧 pending 校验和结果拒绝；切画布再切回仍拒绝旧授权。
- HTTP 鉴权/连通性诊断通过不代表已经验证所有 UI 错误文案。

证据：`artifacts/canvas-connection-e2e/results.json`、`logs/protocol-test-assertions.log`、`browser/browser-results.json`、`browser/01-connected.png` 至 `05-taken-over.png`。主模型确认截图包含同步、绑定、节点、接管弹窗和旧租约失效状态，token 为掩码。

## 未解事项

- T004：自建 stdio 双调用者隔离不证明真实 Codex 桌面跨聊天是否复用进程，也不证明可信平台 threadId。
- 隔离运行时没有真实历史分页证据；原线程的历史运行证据属于早期环境，不作为本轮复验。
- workspace-service 8086 启动编译失败：`internal/workspace/files.go:154` 与 `backup.go:331` 重复定义 hashFile。主模型只读确认两处定义，没有改其他对话拥有的模块。未初始化用户数据。
- 三字段错误/旧回执、unknown 强制接管 UI、甲乙画布隔离的 fault-e2e.mjs 没有取得通过证据：先后遇到收起面板按钮在视口外、等待 networkidle 超时、填写配置已自动连接后仍等待“连接”按钮。最后截图确认服务已连接，失败发生在测试控制器的连接步骤，尚未执行后续业务断言。fault-results.json 保存 FAIL，不当作产品回执防护失败，也不记通过。
- 故障补测两轮分别 15m1s / 10m1s timeout，partial，未返回 usage。最后一轮没有可确认的完整命令退出码。所有 AGY jobs 已收取终态，未留后台委派。下一步应修正故障控制器，再验证错误/旧回执、unknown UI 与甲乙隔离；不用再重跑已充分通过的主要流程。
- 首轮选择器与流程失败已由测试脚本修正，不算产品缺陷。未确认新的连接业务缺陷。

## 运行与限制

原 43871 / 17372 服务保留。测试浏览器使用独立 Playwright Edge context，未关闭用户标签页。主要流程使用 UI+HTTP，协议租约使用合成客户端；这些均不冒充 Codex 桌面全链路。

AGY 状态如实保留：初始主任务 30m1s timeout，初始浏览器任务 interrupted；恢复协议任务 6m37s、浏览器任务 10m53s、协议补测 7m46s 均返回 stream interrupted / failed / partial，但文件证据已保存。协议会话最后 total_tokens=2083251、cache_read_tokens=22250258；浏览器主要会话 total_tokens=1234184、cache_read_tokens=24194162。口径可能会话累计，不能相加为本轮消耗；费用未提供。没有更换提供方。

AGY 的执行报告与退出码属于执行者提供的证据；Codex 做了静态审阅和截图检查，没有独立重跑同一测试。完整功能仍待人工验收，正式功能说明未更新。
