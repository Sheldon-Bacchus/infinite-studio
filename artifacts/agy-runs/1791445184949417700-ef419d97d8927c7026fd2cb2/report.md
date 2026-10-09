# AGY Run｜Canvas Agent 连接补修与验收续跑

> 状态：partial · 模式：execute · 模型：unknown（AGY 状态未返回 resolved model）· Runs：`1791443709030568300-59f5c563c6b3f77c956bd977`、`1791444635568378500-987110a8c2e0de4c0e1cf378`、`1791445184949417700-ef419d97d8927c7026fd2cb2`、`1791445777664311800-b90313e30d72f3f72f7bb5d3`、`1791446294721818800-404f1448eb22c3af0734eb0c`、`1791446314920336800-b40070973d76bb5caf4141e1`

## 结论

P1 源码已落地并通过 Agent 构建及定向单测；E2E 控制器的弹窗与画布就绪断言已修正。整站类型检查和协议 8 浏览器复验因 AGY 执行环境内存不足未执行。旧协议 7 的两张故障截图不满足验收条件，已将对应结果改为 BLOCKED。

## 快速摘要

- 范围：`E:/all-agent-workspace/infinite-studio` 的 Canvas Agent 连接补修、专项 E2E 证据与交接文档。
- 发现：P0 0 · P1 0 · P2 3 · P3 0。
- 审阅：由当前 GPT 对 P1 改动、HTTP 状态和三张故障截图作了静态/视觉核对；没有另派 AGY 审查 job。
- 变更：P1 已更新互斥、占用者、协议版本和 i18n 默认值；修正两项故障结果并加固两项 E2E 断言；更新 tasks/spec/plan、待验收、CHANGELOG 与交接文档。

## 优先处理

AGY 执行环境可用内存稳定回到 2.5 GB 以上后，先重启隔离 Agent `17371` 使其加载协议 8，再执行 Web typecheck，并运行已修正的 fault suite 补齐弹窗与甲乙画布隔离证据。当前用户服务 `17372` 与其浏览器标签保持原样。

## 审阅

- 触发依据：用户要求 AGY MCP 执行并继续完成计划、构建与验收。
- 审阅执行者：当前 GPT 会话。
- 方法与工具：静态阅读核心源码、核对实时 HTTP 健康响应、查看故障截图 `07-force-takeover-modal.png`、`08-force-recovered.png`、`09-project-isolation.png`。
- 结论：协议 8 源码与旧协议 7 运行进程不一致；确认弹窗截图没有弹窗，隔离截图仍是加载骨架。已把 `FAULT-008` 与 `FAULT-010` 从 PASS 改为 BLOCKED。AGY 随后只改了 `fault-e2e.mjs`，在截图前检查弹窗标题/确认按钮可见，并要求 Project 乙 的 `CanvasRefreshShell` 骨架卸载、画布容器、顶部 Agent 按钮和空画布提示均可见后才执行隔离断言；这次修改尚未运行。
- 未解事项：真实桌面 Codex 跨聊天身份、完整 A/B 聊天场景、真实历史分页、第二启动路径与独立仓库移植。

## 发现事项

### [P2] 隔离服务未加载当前协议

- 来源：Codex verified
- 位置：`canvas-agent/src/canvas/session.ts`、隔离服务 `http://127.0.0.1:17371/health`
- 证据：源码协议为 8，实时 `/health` 返回 7、`clients=0`、`hasCanvas=false`；Web `http://127.0.0.1:43863/canvas` 返回 HTTP 200。
- 影响：之前的 UI 与故障截图不能验证协议 8 当前源码。
- 建议：内存恢复后只重启隔离 Agent，再运行指定验收；保留用户现有的 43871/17372。
- 核对：verified。

### [P2] 两项故障 E2E 截图与 PASS 断言矛盾

- 来源：Codex verified
- 位置：`artifacts/canvas-connection-e2e/browser/fault-results.json`
- 证据：`07-force-takeover-modal.png` 没有显示确认弹窗；`09-project-isolation.png` 仍显示加载骨架，空 DOM 计数无法证明隔离。
- 影响：原 `FAULT-008` 和 `FAULT-010` PASS 不可信。
- 建议：已将两项降为 BLOCKED；等待协议 8 服务可用后，仅补跑对应缺口并保存有效截图。
- 核对：截图已由主模型查看，JSON 已修正。

### [P2] 前端类型检查尚无结果

- 来源：AGY report
- 位置：`studio/web`
- 证据：`npm run typecheck` 在 `--max-old-space-size=512` 下曾以退出码 134 因 V8 OOM 失败；之后多次重试均在执行前被内存门槛拦截，AGY shell 报告可用物理内存约 0.82 GB、0.54 GB、0.28 GB，命令未启动。一次错误传入默认模型不支持的 `medium` effort，在 12s 内失败且未运行命令；随后已去掉该参数再试。
- 影响：当前不能宣称整站类型检查通过或失败于代码诊断。
- 建议：内存恢复后由 AGY 以受限堆值重跑一次，并记录完整诊断。
- 核对：AGY 状态及 partial 结果已读取；本模型未重复执行。

## 执行与检查

- AGY 的 P1 代码执行修改：`session.ts` 复用外部租约检查、仅在网页 Agent 忙时显示其为占用者；Codex/Claude turn 启动前检查外部 executing/unknown 租约；协议升至 8；store 空闲状态使用 i18n；清理 `backup.go` 重复 `hashFile`。
- AGY 报告 `canvas-agent npm run build` 退出码 0；`session.test.ts` 29 passed、0 failed。
- AGY 报告 `workspace-service go test ./...` 退出码 1，失败来自未由本任务拥有的 `internal/works`：`package.go` unused `time` / missing `RebuildWorkIndex`，`recovery.go` missing `errors`，`migration.go` unused `time`。本轮未修改这些文件；旧重复 `hashFile` 阻塞已解除。
- 浏览器故障结果：`FAULT-001`–`FAULT-007`、`FAULT-009` 文件记录为 PASS，但其 Agent 运行态是旧协议 7；`FAULT-008`、`FAULT-010` 已人工降为 BLOCKED。AGY 故障 job 曾 timeout，没有可确认的成功退出码。
- AGY jobs：P1 执行约 7m37s；构建/测试 job 约 2m27s 后发生 provider EOF，返回 partial 结果；Web 检查有三次内存门槛阻断（55s / 43s / 29s），另一次 12s 因 effort 参数与默认模型不兼容而在启动前失败。最后一次 AGY shell 报告 0.28 GB；本机先前读数 2.53 GB 与 AGY 读数不一致，以执行环境自检为准。状态报告 total token usage 字段为 158855、87467、125930；同一续聊 usage 不累加。费用未返回。
- E2E 控制器修补 job `1791445777664311800-b90313e30d72f3f72f7bb5d3` 用时约 6m21s 后遇到 provider EOF，状态 failed/partial；脚本改动已落盘并由主模型静态查看，没有运行浏览器、语法检查或构建。其状态报告 total token usage 为 2,825,079（续聊累计口径，不与其他数字相加）；模型与费用未返回。
- 未执行：协议 8 浏览器重验、Web typecheck、真实桌面 T004、真实历史分页和跨仓库移植。

## 范围与限制

当前仓库 `AGENTS.md` 限定 Infinite Studio 任务在本仓库内实施；T011 中移植到独立 Infinite Canvas 仓库没有纳入本轮范围。`docs/HANDOFF.md`、`specs/002-canvas-connection/tasks.md`、`pending-test.mdx` 已按实际状态更新。实现任务按静态审阅勾选，运行验收缺口单独登记；正式功能说明留待用户验收后更新。
