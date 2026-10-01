# v10 架构规格独立复评

## 总评

**结论：PROCEED_WITH_NOTES**

v10 已把主要架构闭环补齐：虾塘边界、源端记录方、投影隔离、CanvasProject revision CAS、媒体上传 receipt、未知结果恢复、3D 类型准入、iframe 私有副本和验收范围均有明确设计。当前代码尚未实现这些能力，属于已声明的实施差距，不构成规格缺陷。

规格仍有若干接口级细节需要在实施前冻结，主要集中在 receipt 管理 API、MIME 规范化、批量上传与画布保存的跨阶段关联、以及 Director 原生 schema 映射。

## 七维评级

| 维度 | 评级 | 评价 |
|---|---|---|
| 范围与边界 | 🟢 | 明确移植 `/xiaji` 四类领域页，排除 DramaClaw Freezone 画布；源端仍是项目、领域数据和任务的唯一记录方。见 §1、§3、§4。 |
| 数据模型与来源隔离 | 🟢 | `XiaTangProjectionSelection`、`buildXiaTangSourceKey`、`buildXiaTangProjectionKey` 与现有 `DramaCanvasProjection` 明确分 namespace，禁止跨类去重。见 §5.3、§6.4；代码路径 `web/src/app/(user)/canvas/utils/drama-import.ts`。 |
| API 与状态契约 | 🟡 | 已覆盖源端 allowlist、四类页面操作、`CanvasProjectRecord={project, revision}`、CAS 路由和错误恢复；但多数请求/响应 JSON、错误码、receipt 管理 endpoint 仍以文字描述为主，缺少可直接实现的规范样例。见 §6.1、§6.2、§5.11。 |
| 并发、一致性与恢复 | 🟢 | revision CAS、串行写队列、409 停止、未知结果读回、批量 all-or-none、journal 恢复路径均已定义。见 §5.9–§5.12、§6.4。当前相关实现仍缺失：`router/router.go`、`service/local_workspace.go`。 |
| 媒体存储、安全与容量 | 🟡 | 512 MiB framing 上限、510 MiB payload 上限、流式 multipart、digest、MIME/扩展名/来源绑定、GC 和 tombstone 语义完整。缺少 MIME canonicalization、扩展名白名单、真实类型检测和 receipt abandoned/GC 调用接口的精确定义。见 §5.6、§6.4、§7。当前代码依据：`service/local_storage.go`。 |
| 3D 与 iframe 会话隔离 | 🟡 | 已定义 Director 节点分组、current 追加、新 snapshot、新消息协议、requestId/schemaVersion/source/origin 校验、私有副本和 CAS 发布时机。3D 格式表也明确拒绝未验证格式。仍需冻结目标 `directorProject` 字段映射和 `.fbx/.obj` 实际 manifest。见 §6.4；代码路径 `web/src/app/(user)/canvas/components/canvas-director.tsx`、`canvas-client-page.tsx`。 |
| 验收、可实施性与风险边界 | 🟢 | §1.1 按页面列出真实操作、状态和成功刷新；§8 覆盖崩溃点、重复 receipt、CAS 冲突、部分失败、写回未知结果和视觉验收。许可证、单实例凭据和多用户限制也已明确。 |

## 发现

### Blocker

无。

v10 没有发现会阻止进入实施阶段的架构性缺口。当前缺失的 revision CAS、durable receipt、Director import 消息属于规格已明确要求补齐的实施差距。

### Should-fix

1. **补齐 receipt 管理接口契约。**

   §5.9、§6.4 定义了 `abandoned`、GC、同 key 重放和状态转移，但没有明确：

   - 标记 abandoned 的 HTTP method/path；
   - 请求体中的 `request_id`、`batchId`、storageKey 关系；
   - receipt 状态查询接口；
   - GC 是启动恢复、定时任务还是显式维护任务；
   - abandoned 前“全局引用核对”由哪个 repository 方法完成。

   建议在 §6.4 增加最小 endpoint、状态码和并发条件，尤其明确 abandoned 操作本身也必须幂等。

2. **冻结 MIME 和扩展名规范化规则。**

   规格要求 digest 与 MIME、扩展名和来源元数据绑定，但未定义：

   - MIME 取请求头、文件探测结果还是二者交集；
   - `image/jpg`、大小写、参数等如何规范化；
   - 扩展名是否由文件名、MIME 或格式探测推导；
   - MIME 与扩展名冲突时的拒绝规则；
   - 3D 格式的 MIME 白名单。

   这会直接影响 receipt 重放是否返回同一对象，也影响“同 bytes 不同语义不得复用”的可执行性。对应实现路径为 `service/local_storage.go` 和本地上传 handler。

3. **明确批量 payload 限制的服务端计数边界。**

   §5.6 规定单批累计 payload 不超过 510 MiB，但 §6.4 又规定每个 `/api/local/files` 请求只携带一个媒体文件。规格需要明确累计限制由前端 journal、Go batch coordinator，还是服务端按 `batchId` 维护；还需定义并发请求时如何防止绕过累计上限。当前文档只明确了媒体串行传输，服务端累计计数接口尚未具体化。

4. **补齐 Director 原生 schema 映射产物。**

   §6.4 正确要求显式映射 `ThreeDSceneSnapshot/DirectorWorldSource`，并拒绝未验证格式；但“目标端原生数据结构”仍未给出字段级映射。至少需要在实施前提供：

   - 输入 manifest 示例；
   - `directorProject` 输出示例；
   - 每个资源的 `sourceKey`、`snapshotId`、storageKey、格式和展示字段；
   - `.fbx/.obj` 的 loader 与字段约束；
   - 拒绝结果的逐项错误码。

   相关路径：`web/src/app/(user)/canvas/components/canvas-director.tsx`、`web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`、`integrations/dramaclaw/frontend/src/features/viewer-kit/three-d/`。

5. **将 `CanvasProjectRecord` 的 JSON envelope 写成正式 schema。**

   §5.11 已定义语义，但仍建议补充单项保存、批量 sync、import、delete、409 的完整 JSON 示例，特别是：

   - 新建时 `expectedRevision=0` 与返回 `revision=1`；
   - replace 与 duplicate ID 的区分；
   - 批量冲突返回单个当前 record 还是按项目返回；
   - delete 返回的 revision 语义；
   - 旧浏览器缺 revision 时的响应格式。

   这属于实现可读性和跨前后端一致性问题，不是架构方向错误。

### Nit

1. §5.8 将 `sourceRevision/ETag` 同时用于来源快照证明和上传恢复校验，建议明确其是 opaque string，禁止比较大小或推断版本先后。

2. `projectionKey` 的数组序列化规则已明确，但 `sourceProjectId/entityId/mediaRole` 的空值、Unicode 和大小写规范化未说明。建议由共享 helper 做输入校验并拒绝空字段。

3. journal 使用 `localStorage` 的 256 KiB 限制已写明，但未定义 schemaVersion 不兼容时的 UI 状态。建议明确为“不可恢复，保留原始选择摘要并要求重新读取”。

4. §6.4 的 3D iframe 响应包含完整目标端 `directorProject`。应补充大小上限或资源数量上限，避免跨窗口消息和 CanvasProject 单条记录无限增长。

5. §1.1 的“权限允许时永久清理”依赖源端权限，建议在验收表中增加“无权限按钮禁用及原因”这一明确检查项；文中已有原则，但表格可更直接。

## 关键代码核对

- 现有虾集页仍是 episode/beat 导入界面：
  `web/src/features/xiaji/xiaji-client-page.tsx`
- 现有 Drama 投影使用独立 helper 和 metadata：
  `web/src/app/(user)/canvas/utils/drama-import.ts`
- CanvasProject 本地保存入口：
  `service/local_workspace.go`、`router/router.go`
- 当前本地上传仍需替换为规格要求的 receipt 流程：
  `service/local_storage.go`
- 当前 Director iframe 仅有 `storyai:director-session` 与 `storyai:director-project-changed`：
  `web/src/app/(user)/canvas/components/canvas-director.tsx`
- Director 节点发布和保存集成位置：
  `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`
- DramaClaw 3D 来源与 loader：
  `integrations/dramaclaw/frontend/src/features/viewer-kit/three-d/`

## 最终判定

**PROCEED_WITH_NOTES**

可以进入实施前的接口冻结阶段。实施前应优先补齐 receipt endpoint、MIME 规范化、批量容量计数、`CanvasProjectRecord` JSON schema，以及 Director `directorProject` 字段级映射。
