# AGY Run｜H3 提示词引用组装

> 状态：首轮完成；补修 failed / partial；主模型局部收尾 · 模式：execute
> 模型：工具未返回 resolved model，未记录
> Run：1791369370145818800-3a0274c648ea694edf43f0cb
> 补修：1791370593745713600-eadd5d3afb29e65c17016c04

## 结论
引用清单、chip 插入、计数与双区草稿预览代码已写入；H3 请求因具体工作流契约缺证据保持阻断。尚未运行验收，Task 4 不完整。

## AGY 报告与主模型审阅
首轮 AGY 声称 Task 1–5 完成，主模型静态阅读确认存在裸编号持久化、组装菜单未接输入清单、无条件工作流限制、缺失契约阻断等问题，未采纳其完成结论，并在同会话派发补修。
补修写入后提供方 streamGenerateContent 连接被远端强制关闭，agy_error，partial=true。部分报告不能作为完整成功证据，未切换提供方。
主模型实际阅读了引用列表、编译器、两种编辑器、面板、API、快照恢复和文档；局部修正导入路径、引用正则、资源类型属性、展开编辑器 ref、具体工作流名匹配、binding 引用解析、缺失实体校验、复制 hook 复用与循环文本检测。静态阅读不是 typecheck 或交互验收。

## 当前代码范围
- studio/web/src/lib/canvas/canvas-resource-references.ts：有效输入展开、去重、编号和最小实体清单。
- studio/web/src/lib/canvas/canvas-video-inputs.ts、types/canvas.ts：稳定引用编译、文本注入、实体来源、映射与问题清单、确认快照。
- canvas-config-composer.tsx、canvas-prompt-chip-input.tsx、canvas-node-reference-bar.tsx、canvas-node-prompt-panel.tsx：菜单插入、chip、计数与双区预览。
- pages/canvas/project.tsx、services/api/video.ts：配置组装入口接线、快照消费、H3 契约阻断。
- 原计划、CHANGELOG、pending-test、HANDOFF 已登记；TODO 阅读核对，无事项迁移。

## 验证边界与待补证
没有新增测试、运行测试/语法检查/typecheck/构建/服务/浏览器验收，没有真实生成或提交。
仍缺 AutoDL 的 prompt 包装、标记序号与槽位对应、调用/认证/CORS、未引用附件服务端行为。v2_15s 无视频字段证据，其他工作流不继承其字段。
人工重点：句中插入、改顺序/删除素材后 chip 的指向、文本注入、Group、Subject 多来源、保存恢复、非 H3 模型请求语义。当前不宣称这些已验收通过。

## 执行统计
工具报告首轮 19m38s：input 531091、output 98792、total 629883，cache_read 11454213。
补修 25m21s：input 1325196、output 214265、total 1539461，cache_read 27140384。
以上是 AGY 返回的计量，未验证提供方账单，未记录价格或成本。

主模型追加：配置节点计数改为候选输入同源，补齐配置节点的「标记 → 素材 → 工作流字段」预览；视频/实体 chip 增补可用缩略图。以上仅源码改动和阅读核对，仍需人工交互验收。
