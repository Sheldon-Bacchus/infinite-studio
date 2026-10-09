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


## SDD 扩展组件设计：生成任务与日志

范围扩展依据：用户要求将任务队列与日志继续加入现有 spec。以下为待实现设计，原连接组件状态保持不变。

| 组件/模块 | 新增职责 | 边界 |
|---|---|---|
| 顶栏任务入口 | 进行中/需处理数量，打开全局抽屉 | 保持当前主题和扁平风格 |
| 任务中心抽屉 | 筛选、任务列表、四类详情、定位节点 | 不自行调用生成接口 |
| canvas-config-composer | 上方编辑、下方最终发送预览，提供检查问题与任务入口 | 沿用 buildVideoInputCandidate；不改创作正文 |
| canvas-node-generation / 画布生成入口 | 创建尝试、提交执行权、阶段事件、节点状态 | 不另外维护一套队列 |
| canvas-video-inputs | 固化候选、引用绑定及实际发送参数 | 编译结果与提交使用同一快照 |
| 全局任务 store（具体文件在代码审计后确定） | 单一任务集合、事件归并、调度与查询归属 | Zustand 沿用；不引入新状态框架 |
| services/api 下渠道适配器 | 提交、查询、下载及可选远程取消 | 支持能力以当前实际脚本与接口证据为准 |
| lib/works/generation-history | 尝试与作品归档关联、失败记录、输出引用 | 与 Feature 001 共用 Generation 身份，避免双历史 |
| 本地持久化模块 | 发送前落库、远程 ID 和阶段事件保存、恢复 | 先核实现有工作区/历史契约；浏览器业务存储用 localforage |
| AgentConnectView/服务诊断 | 展示独立服务可达证据及日志入口 | 不将媒体任务误归为 Agent 请求 |

### 状态与事件契约

attempt.status：checking / blocked / queued / running / needs_attention / succeeded / failed / cancelled。
phase：validation / upload / submission / remote_queue / generation / download / save。
submission：not_sent / in_flight / accepted / unknown / rejected。
connection：available / interrupted / unknown；output：none / remote_available / downloaded / archived / save_failed。

展示状态由上述字段计算：blocked→检查未通过；queued→本地排队；submission=unknown→提交结果待确认；remote_queue→服务端排队；download/save失败但remote_available→结果获取/保存失败。远程已完成但未本地保存不显示整体已完成。

事件至少包含 attemptId、eventId、sequence、时间、phase、类型、原因码和脱敏详情。重复事件去重，晚到事件不能把 accepted 变回 not_sent 或将确认完成变回生成中；修复/恢复使用显式新事件。每个事件及状态更新持久化一致，失败不得伪报保存成功。

### 调度与恢复

首版沿用已有执行边界，不新增并发数。队列只接收检查通过、快照保存成功且拥有提交执行权的尝试。队列暂停阻止尚未开始的提交；上传/提交中取消必须依据实际完成边界，不承诺撤销已发送副作用。跨标签页执行权采用项目可用的锁/事务机制，需先验证；能力不足时限制为明确单执行页面，其他页面只读，不自行引入服务后台。

恢复顺序：读记录→确定远程 ID/受理状态→核对原远程任务→获取已有结果→保存并关联作品。unknown 不自动提交；无查询支持时展示限制。取消确认晚于远程完成时，以远程实际结果归并，保留取消请求日志。

### 实施门槛及顺序

A 审计：核实生成入口、历史持久化、AutoDL submit/query/cancel 与模型媒体能力声明；对照旧/新渠道，不把推断当根因。
B 记录：定义尝试/快照/事件，接入现有视频路径；先保证状态与保存可信。
C 界面：任务抽屉、节点阶段、最终发送内容及诊断日志联动。
D 恢复：刷新、断线、下载/保存恢复、多标签页执行权。
E 队列：在具体边界获确认后添加并发设置及管理操作。

每阶段只勾选已实现且静态审阅的代码任务，运行证据独立登记。此次文档未执行测试、启动/停止服务、付费生成或配置修改。未核实的 AutoDL 取消、幂等核对、后台调度能力不对产品作可用承诺。
