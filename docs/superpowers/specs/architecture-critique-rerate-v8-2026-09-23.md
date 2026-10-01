# v9 只读架构审阅报告

**结论：🔴 REVISE**

规格边界和数据所有权方向基本正确，但 v9 仍把若干关键一致性能力写成目标状态，现有代码尚未提供；其中 durable receipt、CanvasProject 全路由 CAS、`/import``/delete` 幂等恢复、3D Director 私有副本提交仍存在实现断层。当前不宜进入实施。

## 七维评级

| 维度 | 评级 | 判断 |
|---|---|---|
| 需求 / 质量 | 🟡 | `/xiaji`、四类虾塘领域页、排除 Freezone 画布、双入口投影和失败状态边界清楚。§1、§3、§4、§6.2 覆盖面完整。但“完整移植真实操作”仍依赖逐项核对源端 schema、hook 和任务状态，规格自身也承认需要实施前核验（§8.2）。 |
| 边界 / 内聚 / 耦合 | 🟢 | DramaClaw 作为项目、领域实体和任务的唯一记录源，CanvasProject 只保存静态投影；Go 作为 allowlist BFF；明确不搬 Freezone 画布。见 §3、§3.1、§4.1。潜在耦合集中在 Director iframe 协议和源端 3D 类型适配，已被识别。 |
| 力度 / 克制 | 🟢 | 没有新增泛化 `/jobs`、通用 assets 后端或第二记录源；普通节点追加、显式新快照才新建节点；生成写回要求用户确认。见 §1、§5.7、§6.3、§11。 |
| 数据状态所有权 / 不变量 / 信任 | 🔴 | 规格定义了清晰不变量，但现有保存链路不满足。`CanvasProject` 模型没有 `revision` 字段（`model/canvas_project.go:3-10`）；handler 不接收 `expectedRevision`（`handler/local_workspace.go:22-82`）；repository 仍按时间戳比较，冲突时返回当前数据而非 409（`repository/local_canvas_project.go:232-255`）。这直接违反 §5.11、§5.12、§6.4。 |
| YAGNI / 变化 | 🟢 | 方案 A、显式替代方案和重审条件明确；没有为本期引入工作流编排或新的持久化领域模型。需要把“必须支持完整源端能力”拆成可验证契约，降低迁移过程中的变化风险。 |
| 故障 / 并发 / 重试 / 幂等 / 规模 | 🔴 | v9 的恢复设计较完整，但 durable receipt 和 CAS 尚未实现。当前上传只限制整个 HTTP body 512 MiB，未落实单文件/批次 510 MiB、request ID、receipt、digest replay 和 staged/committed 恢复。并发保存、批量 all-or-none、删除 CAS、未知结果核对也未落实。 |
| 决策依据 / 替代方案 | 🟡 | 方案 A/B/C 的比较充分，源码依据列得较全；但 3D 实际格式映射、目标 iframe 协议、许可证可分发性仍是实施前门禁，当前不能视为已验证。见 §2.2、§6.4、§8.2、§9。 |

## Blocker

### B1. Durable receipt 仍只是设计，没有对应实现

规格 §5.12、§6.4 要求：

- `local_storage_upload_receipts`
- `receiving/staged/committed/retryable`
- 固定 `objectKey`
- `request_id` 唯一键及串行锁
- rename、`StorageObject`、committed receipt 的恢复
- 同 request ID 同 digest 返回原对象，异 digest 返回 409

现有实现仍是：

- handler 对请求体设置 `512 MiB` 上限后调用 `FormFile`：`handler/local_workspace.go:125-150`
- service 创建临时文件、计算 digest、rename 到最终路径，之后才保存 `StorageObject`：`service/local_storage.go:48-117`

因此在 `os.Rename` 成功、`SaveStorageObject` 尚未提交时崩溃，仍会产生无记录文件；在保存前崩溃也没有持久化 request 状态可恢复。规格 §2.3 已准确指出当前问题，但 v9 没有把修复落实到现有接口和数据模型。

**评级：🔴 Blocker**

### B2. CanvasProject 的统一 revision CAS 尚未存在

规格 §5.11、§5.12、§6.4 要求保存、sync、import、delete 共用整数 revision CAS，并在冲突时返回 409、批量事务全回滚。

当前代码证据：

- `CanvasProject` 只有时间字段，没有 revision：`model/canvas_project.go:3-10`
- 单项保存 handler 只接受 `{data}`：`handler/local_workspace.go:22-35`
- sync 只接受 `projects`：`handler/local_workspace.go:38-52`
- import 逐项目调用 repository：`service/local_workspace.go:54-73`
- delete 只接受 ID 列表，不接受每项目 expected revision：`handler/local_workspace.go:70-83`
- `SaveLocalCanvasProjects` 逐条保存，不在单一事务中执行：`repository/local_canvas_project.go:259-267`
- `SoftDeleteUserCanvasProjects` 使用 upsert，且没有条件 revision：`repository/canvas_project.go:110-147`

现有冲突行为是：

```go
if currentIsNewer {
    return current, nil
}
```

见 `repository/local_canvas_project.go:232-237`。这会把冲突伪装成成功响应，和规格要求的 409 停止队列相反。

**评级：🔴 Blocker**

### B3. `/import` 与 `/delete` 的未知结果、CAS 和批量原子性没有闭环

规格 §5.11、§5.12、§6.4 要求：

- `/import` 新 ID 使用 `expectedRevision=0`
- 已存在目标 ID 时必须显式替换并携带当前 revision
- `/delete` 每个项目携带 expected revision
- 批量操作单事务 all-or-none
- 未知结果通过 canonical 项目和 batch 内容核对
- 不得自动覆盖或静默重试

现有：

- `/import` 没有 expected revision，也没有替换意图字段：`handler/local_workspace.go:54-68`
- import 根据 `importKey` 和 ID 做身份重映射：`repository/local_canvas_project.go:33-112`
- `/delete` 只有 ID：`handler/local_workspace.go:70-83`
- 前端删除先从 Zustand 移除，再异步发请求；失败只设置错误：`use-canvas-store.ts:233-244`
- `importProjects` 直接调用 import，再重新 list：`use-canvas-store.ts:208-213`

这套旧的时间戳/导入身份逻辑不能直接作为 v9 的 CAS 和未知结果协议。

**评级：🔴 Blocker**

### B4. Director 当前快照的私有副本和条件提交尚未接入

规格 §6.4 明确要求：

- 追加已有 Director 节点时加载私有副本
- iframe 内修改不立即发布到 CanvasProject
- 返回结果必须带 `schemaVersion`、`requestId`
- 父组件校验后统一 CAS 保存
- 保存失败丢弃私有副本并保留选择项

现有 `CanvasDirector`：

- 直接把 `projectRef.current` 发送给 iframe：`canvas-director.tsx:111-119`
- 收到 `storyai:director-project-changed` 后立即调用 `onProjectChange`：`canvas-director.tsx:64-68`
- 只校验 origin 和 source，没有 `schemaVersion`、requestId、批次关联或逐项导入结果：`canvas-director.tsx:49-68`

当前 iframe 协议也只有既有 session/project-changed 等消息，规格承认需要新增协议，但没有现成实现证据。

**评级：🔴 Blocker**

## Should-fix

### S1. 510 MiB / 512 MiB 约束需要明确分层实现

规格 §5.6、§6.4 定义了：

- 单文件和单批 payload：510 MiB
- multipart 请求体：512 MiB
- framing 预留 2 MiB
- 流式读取，不二次缓存

现有代码仅有：

```go
r.Body = http.MaxBytesReader(w, r.Body, 512*1024*1024)
file, header, err := r.FormFile("file")
```

见 `handler/local_workspace.go:125-127`。

缺少：

- 单文件上限
- 单批累计上限
- request ID
- 有界 reader 对 part 的精确控制
- 超限后的 receipt 状态
- 对 `FormFile` multipart 解析行为的内存和临时文件上界说明

规格应在实现契约中明确“512 MiB 是 HTTP body 上限，510 MiB 是 payload 上限”，并指定超限错误及清理状态。

### S2. replay digest 需要绑定请求语义

§5.12 和 §6.4 要求同 request ID 通过 payload digest 重放。建议明确 digest 覆盖范围：

- 文件 bytes
- 是否包括 mime、filename、sourceRevision/ETag
- 同 digest 但不同 mime/扩展名是否允许复用已有对象
- batchId、projectionKey、snapshotId 是否参与 request identity

否则“相同 payload”在媒体内容相同但语义不同的情况下定义不完整。

### S3. CanvasProject 返回结构需要包含 revision

§5.11 要求读取和保存响应返回 revision，但当前 service 只返回 `ProjectData`：

```go
return json.RawMessage(saved.ProjectData), nil
```

见 `service/local_workspace.go:26-36`。

前端 `CanvasProject` 类型也没有 revision：`use-canvas-store.ts:17-36`。应统一定义服务端 canonical envelope，避免把 revision 塞进画布 JSON 的业务字段。

### S4. 前端写入队列还不是规格要求的“统一串行队列”

当前只有 debounce 和一个全局变更计数：

- `queueLocalProjectSync`：`use-canvas-store.ts:63-97`
- autosave 使用 `sync`
- import、delete 分别独立发请求：`use-canvas-store.ts:208-213、233-244`

规格 §5.10、§5.12 要求保存、sync、import、delete 和虾塘投影共享同一串行队列，并在 409 时暂停对应画布队列。当前 delete 甚至没有等待已有 sync 完成，存在删除与旧 autosave 交错的风险。

### S5. 现有 Drama 投影键与 v9 新虾塘投影键需要隔离

当前 `drama-import.ts:56-67` 的 `projectionKey` 包含：

- source system
- project
- entity type
- episode
- entity ID
- media role
- projection role
- preset ID

v9 §6.4 定义新的：

```text
["xiaji-projection-v1", sourceKey, snapshotId]
```

应明确新虾塘投影是否复用现有 `DramaCanvasProjection`，还是新增独立 `XiaTangProjectionSelection` 和 builder。否则旧 episode/beat 导入可能与新 `/xiaji` 资源发生 key、node ID 或去重语义混用。

### S6. 3D 格式适配必须先形成实际映射表

DramaClaw manifest 支持：

- `sog`
- `pano360`
- `mesh`
- `.ply/.sog/.splat/.ksplat/.spz`

见 `directorManifest.ts:6-9、296-315`。

目标 `CanvasDirector` 当前只是把任意 `project` 传入 `/director/index.html`，没有虾塘资源导入消息、格式白名单或目标端原生结构转换：`canvas-director.tsx:45-48、111-128`。

规格已经要求拒绝未核验格式，这是正确的；实施前仍需要一个明确的源类型 → 目标 Director 类型 → 存储引用 → loader 的映射表，否则验收标准无法落地。

### S7. 3D 复用代码存在许可证门禁

`directorManifest.ts` 标注 Elastic License 2.0：`directorManifest.ts:1-2`。规格 §9 已提出逐文件核验和无法复用时独立实现/禁用格式的回退。该门禁应在实施切片中变成实际产物，而不是只保留文字说明。

## Nit

- §2.3 说“当前没有持久化请求收据”，与当前代码一致；建议把“目标方案仍明确要求”改成具体迁移项，避免读者误以为已有部分实现。
- §5.8 同时说“来源 revision 只作追溯字段”和 §5.12 要求源端 ETag/revision 用于恢复判断，建议区分“Canvas CAS revision”和“DramaClaw source revision/ETag”。
- §6.4 的 `sourceKey` 文字格式在 §5.8、§6.4、§11 有多种表述：一处是字段组合，一处是 JSON 数组。建议固定一个规范编码函数和 canonical serialization。
- `DeleteLocalStorageObject` 先删除文件、再删除数据库记录：`service/local_storage.go:143-150`。如果数据库删除失败，会留下无文件记录；应纳入同一套对象删除状态或 GC 语义。
- `UploadLocalStorageReader` 使用进程级全局 mutex：`service/local_storage.go:22-35`。这满足单进程串行，但会把所有媒体上传串行化；若保留，应说明这是首期规模取舍，或改成按 request/digest 锁。
- §5.9 依赖浏览器 `localStorage` journal，规格已正确声明清站数据不可恢复；建议同时规定 journal 版本、最大条目大小和写入失败时的用户状态。
- `CanvasProject` 使用 `updatedAt` 作为现有并发依据，且前端 merge 也按时间戳判断：`use-canvas-store.ts:287-306`。迁移 revision 后，应避免继续把时间戳作为冲突判据。
- `sourceUrl` 仍可写入普通媒体节点：`drama-import.ts:107-114`。v9 要求目标节点引用本地 `storageKey`，应明确成功投影后的 `sourceUrl` 是否保留为审计字段，还是完全不落盘。
- Director 消息当前用 `window.location.origin` 作为 targetOrigin：`canvas-director.tsx:45-47`。如果未来 iframe 来源或部署域发生变化，应把允许 origin 和消息 schema 固定在协议层。

## 必须补齐后才能 PROCEED

1. 给 `CanvasProject`、API envelope、repository 和迁移增加 revision。
2. 将 save/sync/import/delete 改为 expected-revision CAS；批量操作单事务、冲突 409、返回 canonical 当前版本。
3. 建立 durable upload receipt，并把 staging、rename、StorageObject、恢复和 replay digest 写成可执行状态机。
4. 把文件上传改成明确的 510 MiB payload / 512 MiB request 双层限制。
5. 将 import、delete、autosave、投影提交接入同一串行队列和未知结果核对流程。
6. 实现 Director 私有副本、schemaVersion/requestId 导入协议、逐项结果和条件保存。
7. 在实际样本基础上完成 DramaClaw 3D 类型、格式、loader 和许可证映射。

完成以上事项并更新规格中的“当前代码尚未提供”部分后，可重新评审。
