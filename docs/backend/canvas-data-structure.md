---
title: 画布数据结构
description: 画布本地存储、节点结构、媒体文件与清理机制
---

# 画布数据结构

本文档说明当前画布的数据结构、统一本地后端的存储方式、图片文件的存储和清理方式。

## 当前存储位置

当前画布项目的权威数据保存在本地后端，不再以某个浏览器的 IndexedDB/localForage 为权威来源：

- 画布项目 JSON：SQLite `data/infinite-canvas.db`，固定本地工作区 ID 为 `local-workspace`。
- “我的素材”索引：同一 SQLite 的 `local_workspace_assets` 表；每个浏览器首次打开时，把旧 LocalForage 素材快照增量迁入，旧缓存保留作恢复副本。
- 画布引用的图片、视频、音频：磁盘目录 `data/files`，索引在 SQLite 的 `storage_objects` 表。
- 本地媒体按 SHA-256 去重；同一文件被两个页面上传时复用同一个对象 ID。
- 旧 `infinite-canvas:canvas_store` 不再作为画布列表来源；图片/媒体 LocalForage 仅作为旧文件缓存，画布项目及“我的素材”索引均以本地后端为准。

启动 `launch-infinite-canvas.cmd` 时会强制使用：

- 前端：`http://127.0.0.1:3000`。
- 后端：`http://127.0.0.1:8081`，仅监听本机。
- 数据库：`data/infinite-canvas.db`。
- 媒体目录：`data/files`。

因此 Edge、内嵌浏览器和其他访问该本地服务的页面读取的是同一份后端画布与素材索引。页面通过后端轮询（约 3 秒一次）及重新获得焦点时刷新；相同端口/URL 本身不负责同步，实际共享来自固定后端地址、数据库路径和文件目录。

首次迁移对每个浏览器配置文件单独执行：浏览器旧素材与本机 SQLite 按素材 ID、更新时间增量合并，SHA-256 复用相同媒体文件。迁移成功后旧 LocalForage 索引不再写入，也不会自动删除，便于回滚取证。账号资产同步若开启，只作为输入/镜像合并到本地工作区，不能整份覆盖本地素材。

删除画布和素材会在 SQLite 留墓碑，旧标签页的自动保存/素材快照不能把墓碑复活；ZIP 导入走独立显式导入接口，才允许恢复同 ID 的已删除画布。删除媒体文件前，后端会检查有效画布、素材与历史记录中的引用；仍有引用时保留文件。

画布 JSON 不直接长期保存大体积 base64 图片或视频。图片节点、视频节点、助手图片和素材媒体只保存展示 URL、`storageKey` 和元信息，真实 Blob 通过 `storageKey` 读取。

## 画布项目结构

每个画布项目是一个 `CanvasProject`：

```ts
type CanvasProject = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  chatSessions: CanvasAssistantSession[];
  activeChatId: string | null;
  backgroundMode: "lines" | "dots" | "blank";
  viewport: { x: number; y: number; k: number };
};
```

字段说明：

- `id`：画布项目 ID，由本地后端保存；导入项目使用稳定 ID，重复导入会更新原项目而不是新增项目。
- `title`：画布名称。
- `createdAt` / `updatedAt`：ISO 字符串。
- `nodes`：画布节点列表。
- `connections`：节点连线列表。
- `chatSessions`：右侧 Agent 会话。
- `activeChatId`：当前选中的助手会话 ID。
- `backgroundMode`：画布背景模式。
- `viewport`：视口变换，`x/y` 是屏幕平移，`k` 是缩放比例。

## 节点结构

每个节点是一个 `CanvasNodeData`：

```ts
type CanvasNodeData = {
  id: string;
  type: "image" | "text" | "config" | "video";
  title: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  metadata?: CanvasNodeMetadata;
};
```

通用字段：

- `id`：节点 ID。
- `type`：节点类型，当前有图片、文本、生成配置、视频四类。
- `title`：节点标题。
- `position`：画布世界坐标，不是屏幕坐标。
- `width` / `height`：画布世界坐标下的节点尺寸。
- `metadata`：节点内容和业务状态。

`metadata` 当前常用字段：

```ts
type CanvasNodeMetadata = {
  content?: string;
  prompt?: string;
  status?: "idle" | "success" | "loading" | "error";
  errorDetails?: string;
  fontSize?: number;
  generationMode?: "text" | "image" | "video";
  model?: string;
  size?: string;
  count?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  freeResize?: boolean;
  isBatchRoot?: boolean;
  batchRootId?: string;
  batchChildIds?: string[];
  primaryImageId?: string;
  imageBatchExpanded?: boolean;
  inputOrder?: string[];
  storageKey?: string;
  mimeType?: string;
  bytes?: number;
};
```

不同节点的使用方式：

- 图片节点：`content` 是当前可展示的图片 URL，通常是同源 `/api/files/.../content`；`storageKey` 通常为 `server:<object-id>`；`naturalWidth/naturalHeight/bytes/mimeType` 保存原图信息。
- 视频节点：`content` 是当前可播放的视频 URL，通常是同源 `/api/files/.../content`；`storageKey` 通常为 `server:<object-id>`；`bytes/mimeType` 保存文件信息。
- 文本节点：`content` 保存文本内容；`fontSize` 保存字体大小；`prompt/status/errorDetails` 保存生成状态。
- 生成配置节点：`generationMode/model/size/count/inputOrder` 保存生成配置；`generationMode` 可选择文本、图片或视频；上游输入通过 `connections` 计算。
- 图片组节点：根节点用 `isBatchRoot/batchChildIds/primaryImageId/imageBatchExpanded` 记录批量生成结果；子图节点用 `batchRootId` 指回根节点。

## 连线结构

每条连线是一个 `CanvasConnection`：

```ts
type CanvasConnection = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};
```

连线只保存节点 ID，不保存端口坐标。渲染时根据节点位置和尺寸计算路径。

删除节点时会同步删除以该节点为起点或终点的连线。删除图片组根节点时，会把对应子节点一起删除。

## 助手会话结构

助手会话保存在画布项目内：

```ts
type CanvasAssistantSession = {
  id: string;
  title: string;
  messages: CanvasAssistantMessage[];
  createdAt: string;
  updatedAt: string;
};
```

消息结构：

```ts
type CanvasAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  mode: "ask" | "image";
  text: string;
  isLoading?: boolean;
  references?: CanvasAssistantReference[];
  images?: CanvasAssistantImage[];
};
```

图片引用和助手生成图片也遵循同一套图片存储规则：

- `dataUrl` 字段当前可能是 `blob:` URL，也可能是旧数据中的 `data:image/...`。
- `storageKey` 存在时，以 `storageKey` 为准读取图片 Blob。
- 发送到 AI 接口前，如果接口需要 base64，会通过 `imageToDataUrl` 临时把 Blob URL 转成 data URL。

## 图片写入流程

所有新增图片应通过 `uploadImage(input)` 写入；本地模式下最终落到统一后端：

1. 传入 `Blob` 或 data URL。
2. 内部转成 `Blob`。
3. 上传到 `POST /api/local/files`，后端按 SHA-256 去重并写入 `data/files`。
4. 生成 `storageKey`，格式为 `server:<object-id>`。
5. 使用同源内容 URL，并仅在当前页面把 Blob URL 缓存在内存中。
6. 读取图片宽高，返回：

```ts
type UploadedImage = {
  url: string;
  storageKey: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
};
```

图片节点会通过 `imageMetadata(image)` 写入：

```ts
{
  content: image.url,
  storageKey: image.storageKey,
  status: "success",
  naturalWidth: image.width,
  naturalHeight: image.height,
  bytes: image.bytes,
  mimeType: image.mimeType
}
```

因此，`content` 只适合展示，不能作为长期文件标识；长期标识是后端返回的 `storageKey`。

## 图片读取和旧数据迁移

打开画布时会执行图片补水：

- 如果图片节点有 `server:<object-id>`，通过 `resolveImageUrl(storageKey, fallback)` 读取统一后端内容。
- 如果图片节点没有 `storageKey`，但 `content` 是旧的 `data:image/...`，会调用 `uploadImage(content)` 迁移到统一后端，并补上 `storageKey`。
- 助手消息里的引用图和生成图也会执行同类逻辑。

旧“我的素材”读取时也会做迁移：

- 有 `storageKey`：恢复 `coverUrl` 和 `data.dataUrl` 的可展示 URL。
- 无 `storageKey` 且保存了 base64：上传到统一后端，然后更新素材里的 `storageKey`。
- 旧 `image:`、`file:`、`video:` 和 WebDAV 直连媒体会在首次工作区迁移时转存到统一本地文件目录；相同内容复用 SHA-256 对象。

## 图片移除和清理

图片不是在删除节点时立即按节点逐张删除，而是做引用清理：

1. 删除节点、清空画布、删除画布、删除素材、删除助手会话时，会触发 `cleanupImages`。
2. `cleanupImages` 会收集当前仍被画布项目、素材和额外传入数据引用的所有 `storageKey`。
3. 本地后端对象由 `/api/local/files/:id` 删除；后端先检查各活跃画布、素材和记录中的引用，仍被使用则保留文件；浏览器只清理自己的临时 Blob 缓存。
4. 不在引用集合里的图片会被删除。
5. 删除时会同时 `URL.revokeObjectURL`，并从内存缓存 `objectUrls` 移除。

这套方式可以避免同一张图片被画布、素材或助手同时引用时误删。
