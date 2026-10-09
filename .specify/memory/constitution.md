# 无限片场 Constitution

## Core Principles

### I. 已有能力优先
沿用无限虾、虾集、虾塘和片场内部画布，先阅读源码，最少改动，不覆盖共享仓库中的他人编辑。

### II. 数据可恢复
作品文件是权威，索引可重建。迁移先完整备份；原件不可变；业务删除归档；未知格式拒绝覆盖；提交失败不得假报成功。

### III. 明确身份与并发
作品/分集/镜头/资产、内容版本、媒体和节点身份独立。写入使用排他锁、基准修订和幂等操作编号。

### IV. 简单与模块边界
使用已有 React/TypeScript、Go、本地服务和业务模型。成熟库负责通用协议/锁/ZIP；不用自制工作流替代官方 Spec Kit，不引入新大型状态框架。

### V. 证据与执行路由
主模型负责规格、计划和审阅；DeepSeek 在用户指定独立路由执行。连接失败准确记录，不静默换模型。代码完成与运行验收分别记录。

## Additional Constraints

遵循根 AGENTS.md。未经要求不运行语法检查、构建或测试。未确认不得增加超时、重试、并发或大小边界。用户数据迁移通过显式预览执行，不自动改 agv-works 现有内容。MCP 和 AGV 组件范围另行确认。

## Development Workflow

使用官方 specify/plan/tasks/implement/converge 流程，规格与验收对应，未完成任务不得勾选；更新 todo、pending-test、CHANGELOG 和 HANDOFF 与实际状态一致。

## Governance

用户指令和上级指令优先，项目原则与根 AGENTS.md 一致。规则调整需写清原因及影响。

**Version**: 1.0.0

## 用户指定执行者更新

用户明确“开始跑，还是 AGY 执行”，本 Feature 由 AGY 实现，主模型继续设计审阅；此前 DeepSeek 专用执行约束对本 Feature 由用户授权替代。AGY job 1791423832094031000-188657e23f074982a73a0c49 已派 T003–T008，仅拥有新 works 包与 execution.md；未启动其他提供方。
