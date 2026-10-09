# Feature Specification: 本地作品仓库与双向归档

**Feature Branch**: 不切换共享工作区 Git 分支；Feature 001-local-works
**Status**: 需求已据用户审阅整合，执行待路由恢复
**Input**: docs/plans/studio-local-works-project.md 与本对话用户审阅

## User Scenarios & Testing

### User Story 1 - 安全保存作品 (Priority: P1)

用户在作品库保存作品并重新打开，数据、历史和原件完整。
**Why this priority**: 所有创作依赖可靠本地记录。
**Independent Test**: 隔离作品保存、重启和索引重建后，身份和关系不变。
**Acceptance Scenarios**:
1. Given 两个客户端基准相同，When 依次保存不同修改，Then 后写入收到冲突且草稿保留。
2. Given 一个服务写仓库，When 第二服务申请写入，Then 拒绝。
3. Given 保存任一阶段中断，When 重新打开，Then 旧提交或已确认新提交可识别，不读半成品。

### User Story 2 - 旧资料安全进入作品 (Priority: P1)

用户备份并预览导入现有作品、素材、画布和原件，旧来源保留。
**Why this priority**: 接通新入口前保障现有创作。
**Independent Test**: 同一来源迁移重复执行不增加实体，失败保留旧数据。
**Acceptance Scenarios**:
1. Given IndexedDB 导出含原件，When 导入，Then 作品关系与媒体摘要一致。
2. Given 缺媒体或不同来源冲突，When 预览，Then 明确列出，不能宣称完整迁移。

### User Story 3 - 两种创作入口共用档案 (Priority: P2)

新手走无限虾流程，老手用片场画布，均能回到相同作品档案。
**Independent Test**: 虾集编辑、虾塘素材版本选择、画布回存后重新打开一致。
**Acceptance Scenarios**:
1. Given 已归属镜头，When 回存新结果，Then 记录到该镜头且不覆盖旧结果。
2. Given 自由导入，When 自动保存，Then 进入待归档，可手动批量分类。
3. Given 重复回存或复制节点，When 保存，Then 原件不重复、历史不重复。

### User Story 4 - 追溯并恢复作品 (Priority: P3)

用户追溯提示词和生成输入，归档恢复，导出和导入完整作品。
**Independent Test**: 修改镜头后仍可查旧生成，ZIP 恢复关系与原件。
**Acceptance Scenarios**:
1. Given 某结果已选用，When 修改提示词，Then 旧生成输入保持不变。
2. Given 归档实体仍被历史引用，When 保存，Then 引用原件可读。
3. Given ZIP 清单未知或摘要错误，When 导入，Then 拒绝发布并保留当前作品。

### Edge Cases

Windows 占用、目标已存在、大小写冲突、路径越界、未知格式、媒体替换、网络回执丢失、服务中断、索引失败、迁移后已有新编辑、生成期间切换作品。

## Requirements

### Functional Requirements

- FR-001: 作品、分集、镜头、资产必须用稳定身份与文件档案对应，改名不改变身份。
- FR-002: 必须保留权威作品文件与可重建索引，重新打开不能依赖原浏览器。
- FR-003: 必须拒绝过期基准与第二写入服务，重放操作不能重复提交。
- FR-004: 必须在切换前备份旧来源和原件，迁移可重复，失败可恢复。
- FR-005: 文本、图片、视频、音频使用统一媒体分类，作品内相同原件复用。
- FR-006: 无限虾、虾集、虾塘、素材库与内部画布使用统一作品入口。
- FR-007: 画布内容自动进入待归档或已知归属的尝试列表，由用户分类与选用。
- FR-008: 内容修订、提示词修订、生成尝试、媒体原件与节点实例分别保存。
- FR-009: 业务删除必须归档且可恢复，历史引用原件保留。
- FR-010: 完整作品支持版本化 ZIP 导出/预览导入，不直接覆盖同身份作品。
- FR-011: 外部媒体差异在启动或手动扫描时提示，不实时监听或自动合并文本。
- FR-012: 本地访问必须限可信入口，拒绝任意路径及越界。

### Key Entities

作品、分集、镜头、业务资产、内容修订、提示词修订、生成尝试、媒体文件、画布节点、提交、迁移映射、归档项。

## Success Criteria

### Measurable Outcomes

- SC-001: 同一作品从两种创作入口保存后，重新打开全部已提交归属一致。
- SC-002: 重复迁移和回存不增加重复业务记录或媒体原件。
- SC-003: 并发基准冲突、缺件和中断均明确报告，无静默丢失。
- SC-004: 完整作品导出再导入后，引用和原件摘要全部一致。
- SC-005: 旧来源保持可读；规范作品移位与索引重建后历史仍可恢复。

## Assumptions

现有 agv-works 是拟定根，真实资料写入待用户确认和迁移预览；代码开发只用隔离数据。首期沿用一作品一画布规则。外部参考网站与 AGV 执行可视化组件不并入本 Feature。暂无全量旧数据清点证据。
