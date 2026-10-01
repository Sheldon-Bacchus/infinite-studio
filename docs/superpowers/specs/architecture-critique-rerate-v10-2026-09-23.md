# 架构规格独立复评报告：v18

评审模型：gpt-6-luna / max

**PROCEED。** v18 已关闭上一轮四项 finding；我没有发现新的阻断性矛盾。

- **固定 projectionKeys 与重试/complete：已闭合。** 批次 key 集合不可追加；批次仍 open 时，失败项只能用原 key 和 requestId 重试。仍需重试的失败项不能先 complete；已 complete 后要重试失败项则创建新批次。[规格 §6.4](E:/all-agent-workspace/codex-projects/infinite-canvas/docs/superpowers/specs/2026-09-22-xiaji-xiahua-integration-design.md:219) [重试规则](E:/all-agent-workspace/codex-projects/infinite-canvas/docs/superpowers/specs/2026-09-22-xiaji-xiahua-integration-design.md:271)
- **Fetch half-duplex 与早 202/传输错误：已闭合。** 规格明确不依赖浏览器在请求体发送期间读取 202；连接关闭、响应不完整或 transport error 后先查询原 batch，只有服务端确认批次仍 open 且 receipt 可重试或不存在，才用原 ID 重传。[规格 §6.4](E:/all-agent-workspace/codex-projects/infinite-canvas/docs/superpowers/specs/2026-09-22-xiaji-xiahua-integration-design.md:252) [恢复规则](E:/all-agent-workspace/codex-projects/infinite-canvas/docs/superpowers/specs/2026-09-22-xiaji-xiahua-integration-design.md:259)
- **旧 `/xiaji/episodes` 路由、URL 与刷新：已闭合。** 规格要求该路径可直接访问和刷新，明确旧页面没有 URL query 状态，刷新后需重新输入项目 ID。我核对的旧页面路由当前指向 `XiaJiClientPage`；项目 ID 确由组件本地状态和手工输入承载。[路由](E:/all-agent-workspace/codex-projects/infinite-canvas/web/src/app/(user)/xiaji/page.tsx:1) [页面状态](E:/all-agent-workspace/codex-projects/infinite-canvas/web/src/features/xiaji/xiaji-client-page.tsx:67) [规格 §4.1](E:/all-agent-workspace/codex-projects/infinite-canvas/docs/superpowers/specs/2026-09-22-xiaji-xiahua-integration-design.md:118)
- **逐 route API manifest：已成为实施前门禁。** 规格要求逐条核对源端 route、hook、schema、错误/成功 envelope、重试属性和 query invalidation；未核实的 route 不注册，对应按钮禁用。[规格 §6.2](E:/all-agent-workspace/codex-projects/infinite-canvas/docs/superpowers/specs/2026-09-22-xiaji-xiahua-integration-design.md:191) [实施门禁](E:/all-agent-workspace/codex-projects/infinite-canvas/docs/superpowers/specs/2026-09-22-xiaji-xiahua-integration-design.md:354)

**残余实施前门禁：** 完成并审阅逐 route manifest；用真实样本固化媒体 MIME/格式 registry；在编写 Director 导入前完成 manifest 到 `directorProject` 的字段映射和 schema 核验，未通过时禁用 3D 导入。另需核实运行承载、权限主体及逐文件许可/分发条件。旧路径直达与刷新属于实施验收项，本次未运行验证。

**信心：高。** 四项 finding 的规格闭环清楚，旧页面输入与路由行为也由目标端源码印证。对源端每条 API 的实际 schema 和错误语义不作本轮背书；它们仍须通过上述 manifest 门禁核验。
