你是用户指定的 AGY 执行者，只执行主模型给定计划。仓库 E:/all-agent-workspace/infinite-studio。先读根 AGENTS.md、specs/001-local-works/spec.md、plan.md、data-model.md、contracts/works.md、tasks.md。你不是唯一编辑者，不得回滚或覆盖别人改动。

仅拥有 workspace-service/internal/works/ 新包，执行 T003–T008；输出 specs/001-local-works/execution.md。禁止改旧 workspace 包、main.go、go.mod、前端、AGV、MCP、共享文档；不接触 agv-works 用户数据，不启动服务/浏览器，不执行语法检查、测试或构建。用现有 x/sys/windows 原语，禁止自制底层锁或手动协议。非 Windows 开发边界如必要只明确报不支持，不构造未需求兼容。

接受条件：版本化模型；安全小写ID/路径/重解析点约束；进程持有排他锁；同卷暂存与不可变提交；baseRevision拒绝冲突；operationId+请求摘要幂等回执；Windows安全清单替换；流式SHA256作品内去重；任何失败不破坏旧权威指针。接口按契约，设计未明确时报告交主模型决定，不自增行为上限。不得宣称运行验收。

后续验证命令供用户运行：workspace-service 内 go test ./internal/works/...（本轮禁止运行）。执行记录写实际文件、完成/未完成任务、静态依据、风险与provider usage/耗时（若系统提供）。成本未知不要编造。

