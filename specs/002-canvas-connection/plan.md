# Implementation Plan：画布连接组件

**Status**：用户已采纳；当前为片场仓库实施与验收阶段。主模型负责设计、静态审阅和证据复核，AGY MCP 按用户授权执行。

## Summary

分四个可验收阶段：连接状态与诊断 → 身份与授权 → 接管并发边界 → 历史与启动回归。当前工作仅限 infinite-studio；向独立 infinite-canvas 仓库移植需另行确定授权和文件范围。

## Technical Context

已有 TypeScript、React、Ant Design、Zustand、Express、MCP SDK、SSE；绑定授权只在 Agent 内存中，重启后显式重绑。保留用户本地连接配置及历史格式。

## Constitution Check

沿用已有结构；不引入状态框架；不覆盖他人编辑；身份与修订独立；无数据迁移；不新增行为边界；主模型交方案供审阅。作品资产 Feature 的执行者授权不外推到本 Feature。

## 组件设计

1. AgentConnectView：服务地址/版本、当前网页、同步画布、目标聊天、绑定状态、重连及接管按钮。错误原地显示，恢复动作与失败阶段对应。
2. use-agent-store：保存分阶段状态与 binding；连接按钮不清空聊天消息。
3. services/api/canvas-agent：连接预检、授权状态、绑定/接管、请求验证统一入口。
4. LocalAgentPanel：SSE 生命周期、失效事件、快照上报成功确认和执行前校验。
5. session.ts / mcp-connections.ts：目标授权、请求归属、执行租约和接管事务。
6. mcp.ts / http.ts：调用身份传递与鉴权；无身份的写请求拒绝。
7. codex-client.ts / codex-protocol.ts：完整历史分页和异常传播。
8. 启动器与插件：同一源码入口，健康接口展示实际来源。

## 关键设计修正

- 原型 sessionId 不等于 threadId。先核实桌面 MCP 生命周期及可用元数据；可信 threadId 可用时绑定其身份，否则建立显式独占会话能力。无法建立独占时只显示连接级绑定，聊天级接管保持禁用。
- 接管事务只影响被接管绑定及其请求；不能取消其他画布请求。原型全局取消 pending 必须收敛。
- executing 标记必须在请求完成/失败/取消时释放；超时后也不得把仍可能执行的副作用伪装成已安全结束。沿用已有超时，核实实际完成边界。
- UI 选择连接编号仅供诊断；产品主流程应展示聊天可辨识名称与目标画布，身份无法验证时明确提示。
- 同步状态以服务端确认及本页 clientId 为准；异步结果校验连接代次，避免旧请求刷新新状态。

## 实施顺序与范围

阶段 A 完善状态、诊断、重连，独立交付。阶段 B 核实身份并完善授权契约，身份门槛通过后启用绑定。阶段 C 收敛接管事务及执行边界。阶段 D 历史/启动验收、定向移植与交接。

只拥有 canvas-agent 连接/历史文件、web Agent 连接组件及 API/store、启动器、插件和本 Feature 文档。禁止顺手改视频、作品、资产或 Spec Kit 进度组件。

## 验证与交付

主模型已静态审阅当前代码；用户已授权由 AGY MCP 启动隔离服务、截图、运行 E2E 与编译检查。AGY 已报告 Canvas Agent 构建通过、session 定向测试 29 项通过；Web typecheck 多次因运行前可用内存不足而未启动。Agent 17371 仍运行协议 7，需 AGY 环境内存稳定超过 2.5 GB 后重启隔离服务再验收协议 8。主模型复核后将没有弹窗的 FAULT-008 截图和仍处加载骨架的 FAULT-010 截图标为 BLOCKED；AGY 已修正两处测试断言，待运行。完整状态按 `tasks.md` 勾选和 `pending-test.mdx` 登记；AGY 执行不得修改其他任务拥有的作品模块。真实 Codex 桌面聊天、真实历史分页及独立仓库移植不由模拟测试替代。
