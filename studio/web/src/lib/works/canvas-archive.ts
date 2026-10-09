// SPDX-License-Identifier: AGPL-3.0-or-later

import localforage from "localforage";
import type {
    CanvasNodeData,
    CanvasConnection,
    ViewportTransform,
    CanvasSubject,
    CanvasAssistantSession,
} from "@/types/canvas";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import {
    uploadMedia,
    getMediaUrl,
    type RecordChange,
    type RecordItem,
    type MediaDescriptor,
} from "@/services/api/works";
import { useWorksStore } from "@/stores/use-works-store";
import { getImageBlob, getLegacyImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import { sha256Hex, toLocatorId } from "./works-adapter";

/**
 * 统一 NodeRef 身份引用模型：
 * 节点实例 ID 是宿主/插件画布内部 map 键，与作品实体 objectId、版本 revisionId 和来源 sourceId 完全独立
 */
export interface NodeRef {
    objectId: string;
    revisionId?: string;
    sourceId?: string;
}

/**
 * 画布快照模型（不可变保存于作品版本记录中）
 * 完整保存现有 CanvasProject 业务状态（subjects/chatSessions/activeChatId/backgroundMode/showImageInfo 等）
 */
export interface CanvasProjectSnapshot {
    schemaVersion: 1;
    canvasId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    subjects?: CanvasSubject[];
    chatSessions?: CanvasAssistantSession[];
    activeChatId?: string | null;
    backgroundMode?: CanvasBackgroundMode;
    showImageInfo?: boolean;
    viewport: ViewportTransform;
    savedAt: string;
}

/**
 * 作品画布绑定记录数据模型 (RecordTypeCanvasBinding)
 */
export interface CanvasBindingRecord {
    workId: string;
    canvasId: string;
    canvasSnapshot?: CanvasProjectSnapshot;
    nodeRefs?: Record<string, NodeRef>;
}

/**
 * 待归档资产集合项（用于未知归属或新生成的画布产物）
 */
export interface PendingArchiveItem {
    nodeId: string;
    title: string;
    kind: "image" | "video" | "audio" | "text";
    /** Works 服务确认的 fileId，仅当 mediaDescriptor 同时存在时视为作品媒体。 */
    fileId?: string;
    sourceFileId?: string;
    storageKey?: string;
    sourceWorkId?: string;
    mediaDescriptor?: MediaDescriptor;
    url?: string;
    blob?: Blob;
    content?: string;
    prompt?: string;
    sha256?: string;
    bytes?: number;
    mimeType?: string;
    targetWorkId?: string;
    workId?: string;
    generationId?: string;
    adoptedAt?: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
}

// localforage 实例专门持久化未知归属或新产物的待归档资产集合
const pendingStore = localforage.createInstance({
    name: "infinite-studio-works",
    storeName: "pending-archive",
});

/**
 * 获取待归档资产列表（可选按作品 ID 过滤）
 */
export async function listPendingArchiveItems(workId?: string): Promise<PendingArchiveItem[]> {
    const items: PendingArchiveItem[] = [];
    await pendingStore.iterate<PendingArchiveItem, void>((value) => {
        if (!workId || value.workId === workId) {
            items.push(value);
        }
    });
    return items;
}

/**
 * 保存单个待归档资产项
 * 若媒体仅为远端临时/过期 URL 且缺少服务端持久化原件，尝试立即固化为 Blob 或作品媒体，防止远程 URL 过期
 */
export async function savePendingArchiveItem(item: PendingArchiveItem): Promise<PendingArchiveItem> {
    const targetWorkId = item.targetWorkId || item.workId;
    const blob = await resolvePendingBlob(item).catch(() => null);
    if (blob) {
        item.blob = blob;
        item.bytes = blob.size;
        item.mimeType = blob.type || item.mimeType;
    }
    if (targetWorkId && blob && item.mediaDescriptor?.workId !== targetWorkId) {
        try {
            const ext = item.mimeType?.split("/")[1]?.replace("+xml", "") || (item.kind === "image" ? "png" : item.kind === "video" ? "mp4" : item.kind === "audio" ? "mp3" : "txt");
            const desc = await uploadMedia(targetWorkId, blob, `${item.title || item.kind}.${ext}`, item.mimeType || blob.type || "application/octet-stream");
            item.fileId = desc.fileId;
            item.mediaDescriptor = desc;
            item.workId = targetWorkId;
            item.sha256 = desc.sha256;
            item.bytes = desc.bytes;
            item.mimeType = desc.mimeType;
            item.url = getMediaUrl(targetWorkId, desc.fileId);
        } catch {
            // 上传未决时保留真实 Blob 与来源标识，供稍后重试。
        }
    }
    await pendingStore.setItem(item.nodeId, item);
    return item;
}

async function resolvePendingBlob(item: PendingArchiveItem): Promise<Blob | null> {
    if (item.kind === "text") return new Blob([item.content || item.prompt || ""], { type: "text/plain;charset=utf-8" });
    if (item.blob) return item.blob;
    if (item.storageKey) {
        const blob = item.kind === "image"
            ? await getImageBlob(item.storageKey) || await getLegacyImageBlob(item.storageKey)
            : await getMediaBlob(item.storageKey);
        if (blob) return blob;
    }
    // Older pending entries stored the canvas storage fileId in `fileId`; treat it as a source locator only
    // when no verified Works descriptor exists, and always resolve bytes before adoption.
    const sourceFileId = item.sourceFileId || (!item.mediaDescriptor ? item.fileId : undefined);
    const sourceWorkId = item.sourceWorkId || (!item.mediaDescriptor ? item.workId : undefined);
    if (sourceFileId && sourceWorkId) {
        const response = await fetch(getMediaUrl(sourceWorkId, sourceFileId));
        if (response.ok) return response.blob();
    }
    if (sourceFileId) {
        const key = `file:${sourceFileId}`;
        const blob = item.kind === "image" ? await getImageBlob(key) : await getMediaBlob(key);
        if (blob) return blob;
    }
    const source = item.url || item.content;
    if (typeof source === "string" && source.startsWith("data:")) {
        const response = await fetch(source);
        return response.blob();
    }
    if (typeof source === "string" && /^(blob:|https?:)/.test(source)) {
        const response = await fetch(source);
        if (response.ok) return response.blob();
    }
    return null;
}

/**
 * 移除已采纳或舍弃的待归档资产项
 */
export async function removePendingArchiveItem(nodeId: string): Promise<void> {
    await pendingStore.removeItem(nodeId);
}

/**
 * 将待归档资产项显式采纳进目标作品
 * 1. 自动解析/上传文本与过期临时媒体，确保具备真实服务端原件与哈希
 * 2. 构建规范资产变更记录并执行作品提交
 * 3. 严格在提交成功确认后才从 localforage pendingStore 移除，杜绝提交失败丢失数据
 */
export async function adoptPendingArchiveItem(
    nodeId: string,
    targetWorkId: string,
    parentObjectId?: string,
): Promise<RecordChange[]> {
    const item = await pendingStore.getItem<PendingArchiveItem>(nodeId);
    if (!item) {
        throw new Error(`待归档资产项不存在: ${nodeId}`);
    }
    item.adoptedAt ||= new Date().toISOString();
    await pendingStore.setItem(nodeId, item);

    let mediaDesc: MediaDescriptor | null = item.mediaDescriptor?.workId === targetWorkId ? item.mediaDescriptor : null;
    if (!mediaDesc) {
        const blob = await resolvePendingBlob(item);
        if (!blob) throw new Error("待归档原件无法解析为真实字节，已保留待处理记录");
        const ext = item.mimeType?.split("/")[1]?.replace("+xml", "") || (item.kind === "image" ? "png" : item.kind === "video" ? "mp4" : item.kind === "audio" ? "mp3" : "txt");
        mediaDesc = await uploadMedia(targetWorkId, blob, `${item.title || item.kind}.${ext}`, item.mimeType || blob.type || "application/octet-stream");
        item.blob = blob;
        item.fileId = mediaDesc.fileId;
        item.mediaDescriptor = mediaDesc;
        item.workId = targetWorkId;
        item.sha256 = mediaDesc.sha256;
        item.bytes = mediaDesc.bytes;
        item.mimeType = mediaDesc.mimeType;
        item.url = getMediaUrl(targetWorkId, mediaDesc.fileId);
        await pendingStore.setItem(nodeId, item);
    }

    const locatorId = await toLocatorId(targetWorkId, `pending:${nodeId}`);
    const changes: RecordChange[] = [];

    // Go commit 校验要求 currentMediaIds 必须解析到已提交的 media 记录；在同一提交中包含精准 media 描述符变更
    if (mediaDesc && mediaDesc.fileId) {
        changes.push({
            id: mediaDesc.fileId,
            type: "media",
            data: {
                fileId: mediaDesc.fileId,
                workId: targetWorkId,
                sha256: mediaDesc.sha256,
                bytes: mediaDesc.bytes,
                mimeType: mediaDesc.mimeType,
                kind: mediaDesc.kind,
                extension: mediaDesc.extension.startsWith(".") ? mediaDesc.extension : `.${mediaDesc.extension}`,
                originalFilename: mediaDesc.originalFilename || item.title || `${item.kind}.${mediaDesc.extension}`,
                createdAt: mediaDesc.createdAt || new Date().toISOString(),
            },
        });
    }

    const currentMediaId = mediaDesc?.fileId || item.fileId;
    changes.push({
        id: locatorId,
        type: "asset",
        data: {
            id: locatorId,
            workId: targetWorkId,
            domain: item.kind,
            parentId: parentObjectId || "",
            currentMediaIds: currentMediaId ? [currentMediaId] : [],
            archived: false,
            projection: {
                version: 1,
                originalAsset: {
                    id: locatorId,
                    kind: item.kind,
                    title: item.title || "待归档素材",
                    tags: ["adopted", item.kind],
                    coverUrl: item.url || "",
                    createdAt: item.createdAt,
                    updatedAt: item.adoptedAt,
                    data: {
                        fileId: currentMediaId,
                        url: item.url,
                        content: item.content || item.prompt || "",
                        sha256: mediaDesc?.sha256 || item.sha256,
                        bytes: mediaDesc?.bytes || item.bytes,
                        mimeType: mediaDesc?.mimeType || item.mimeType,
                    },
                    metadata: {
                        adoptedFromNodeId: nodeId,
                        generationId: item.generationId,
                        ...(item.metadata || {}),
                    },
                },
            },
        },
    });

    // 2. 经由同一 store 草稿与提交协议进行原子持久化
    const store = useWorksStore.getState();
    await store.saveDraftChanges(changes);
    const result = await store.commitDraft();
    if (!result?.committed) {
        throw new Error("作品草稿提交未确认，保留待归档记录以防数据丢失");
    }

    if (item.generationId && mediaDesc?.fileId) {
        const linked = await import("./generation-history").then(({ attachGenerationOutputToWork }) => attachGenerationOutputToWork(item.generationId!, targetWorkId, mediaDesc!.fileId));
        if (!linked) throw new Error("媒体已提交，但生成历史尚未关联；待归档记录已保留以便重试");
    }

    // 3. 严格在权威提交成功后，从 localforage pendingStore 中安全移除
    await removePendingArchiveItem(nodeId);
    return changes;
}

// 精确敏感凭据字段匹配模式：绝不使用模糊 /key/i，防止误删 storageKey、sourceKey 等合法业务字段
const SENSITIVE_KEY_EXACT_PATTERNS = [
    /^(api_?key|secret_?key|access_?token|auth_?token|token|password|authorization|credential)$/i,
];

/**
 * 递归清洗对象中的敏感密钥与渠道凭证
 */
function sanitizeObject(obj: unknown): unknown {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeObject);

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        const isSensitive = SENSITIVE_KEY_EXACT_PATTERNS.some((pat) => pat.test(key));
        if (isSensitive && typeof val === "string") {
            // 剔除密钥值
            continue;
        }
        result[key] = sanitizeObject(val);
    }
    return result;
}

/**
 * 清洗画布工程，剥离全局服务令牌与临时状态，确保作品内记录安全
 */
export function sanitizeCanvasProject(project: CanvasProject): CanvasProject {
    const cleanNodes = project.nodes.map((node) => {
        const cleanMetadata = node.metadata ? (sanitizeObject(node.metadata) as typeof node.metadata) : {};
        return {
            ...node,
            metadata: cleanMetadata,
        };
    });

    return {
        ...project,
        nodes: cleanNodes,
    };
}

/**
 * 从画布当前节点列表中提取统一 NodeRef 映射表 (nodeId -> NodeRef)
 */
export function extractNodeRefsFromCanvas(nodes: CanvasNodeData[]): Record<string, NodeRef> {
    const nodeRefs: Record<string, NodeRef> = {};

    for (const node of nodes) {
        const meta = node.metadata || {};
        const canonical = meta.worksCanonical as { objectId?: string; revisionId?: string; workId?: string } | undefined;
        const objectId = canonical?.objectId || (typeof meta.objectId === "string" ? meta.objectId : typeof meta.xiajiAssetId === "string" ? meta.xiajiAssetId : undefined);
        if (objectId) {
            const revisionId = canonical?.revisionId || (typeof meta.revisionId === "string" ? meta.revisionId : undefined);
            const sourceId = typeof meta.sourceId === "string" ? meta.sourceId : typeof meta.source === "string" ? meta.source : "canvas";
            nodeRefs[node.id] = {
                objectId,
                revisionId,
                sourceId,
            };
        }
    }

    return nodeRefs;
}

/**
 * 构建完整的版本化画布绑定记录
 */
export function buildCanvasBindingRecord(
    workId: string,
    canvasId: string,
    project: CanvasProject,
): CanvasBindingRecord {
    const sanitized = sanitizeCanvasProject(project);
    const snapshot: CanvasProjectSnapshot = {
        schemaVersion: 1,
        canvasId,
        title: project.title,
        nodes: sanitized.nodes,
        connections: sanitized.connections,
        subjects: sanitized.subjects || [],
        chatSessions: sanitized.chatSessions || [],
        activeChatId: sanitized.activeChatId ?? null,
        backgroundMode: sanitized.backgroundMode || "lines",
        showImageInfo: sanitized.showImageInfo ?? false,
        viewport: project.viewport || { x: 0, y: 0, k: 1 },
        savedAt: new Date().toISOString(),
    };

    const nodeRefs = extractNodeRefsFromCanvas(sanitized.nodes);

    return {
        workId,
        canvasId,
        canvasSnapshot: snapshot,
        nodeRefs,
    };
}

/**
 * 从作品权威绑定记录中恢复完整的 CanvasProject 对象
 */
export function restoreCanvasSnapshot(binding: CanvasBindingRecord): CanvasProject | null {
    if (!binding.canvasSnapshot) return null;
    const snap = binding.canvasSnapshot;
    const now = new Date().toISOString();

    // 规范节点媒体引用：优先使用作品内媒体权威 URL，不依赖旧浏览器 blob
    const restoredNodes = (snap.nodes || []).map((node) => {
        const meta = node.metadata || {};
        const fileId = typeof meta.fileId === "string" ? meta.fileId : undefined;
        if (fileId) {
            const mediaUrl = getMediaUrl(binding.workId, fileId);
            if (node.type === "image") {
                return {
                    ...node,
                    metadata: {
                        ...meta,
                        url: mediaUrl,
                        dataUrl: mediaUrl,
                        content: mediaUrl,
                    },
                };
            } else if (node.type === "video" || node.type === "audio") {
                return {
                    ...node,
                    metadata: {
                        ...meta,
                        url: mediaUrl,
                        content: mediaUrl,
                    },
                };
            }
        }
        return node;
    });

    return {
        id: snap.canvasId,
        title: snap.title || "作品关联画布",
        createdAt: snap.savedAt || now,
        updatedAt: snap.savedAt || now,
        nodes: restoredNodes,
        connections: snap.connections || [],
        subjects: snap.subjects || [],
        chatSessions: snap.chatSessions || [],
        activeChatId: snap.activeChatId ?? null,
        backgroundMode: snap.backgroundMode || "lines",
        showImageInfo: snap.showImageInfo ?? false,
        viewport: snap.viewport || { x: 0, y: 0, k: 1 },
    };
}

/**
 * 解析节点真实媒体 Blob
 */
async function resolveNodeBlob(node: CanvasNodeData): Promise<Blob | null> {
    const meta = node.metadata || {};
    if (node.type === "text" && typeof meta.content === "string") {
        return new Blob([new TextEncoder().encode(meta.content)], { type: "text/plain;charset=utf-8" });
    }
    if (typeof meta.storageKey === "string") {
        const blob = node.type === "image"
            ? await getImageBlob(meta.storageKey) || await getLegacyImageBlob(meta.storageKey)
            : await getMediaBlob(meta.storageKey);
        if (blob) return blob;
    }
    const canonical = meta.worksCanonical as { workId?: string } | undefined;
    const sourceWorkId = typeof meta.workId === "string" ? meta.workId : canonical?.workId;
    if (typeof meta.fileId === "string" && sourceWorkId) {
        const response = await fetch(getMediaUrl(sourceWorkId, meta.fileId));
        if (response.ok) return response.blob();
    }
    if (typeof meta.fileId === "string") {
        const key = `file:${meta.fileId}`;
        const blob = node.type === "image" ? await getImageBlob(key) : await getMediaBlob(key);
        if (blob) return blob;
    }
    const mediaSource = meta.dataUrl || meta.url || meta.content;
    if (typeof mediaSource !== "string" || !mediaSource) return null;

    if (mediaSource.startsWith("data:")) {
        const matches = mediaSource.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
            const mimeType = matches[1];
            const byteCharacters = atob(matches[2]);
            const byteNumbers = new Uint8Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            return new Blob([byteNumbers], { type: mimeType });
        }
    }

    if (mediaSource.startsWith("blob:") || mediaSource.startsWith("http:") || mediaSource.startsWith("https:")) {
        try {
            const res = await fetch(mediaSource);
            if (res.ok) return await res.blob();
            return null;
        } catch {
            return null;
        }
    }

    return null;
}

/**
 * 画布反向归档分析与保存：
 * 1. 唯一 canvas binding 用安全稳定 ID，检测已有不同 canvas 拒绝破坏性替换；
 * 2. 跨 work 节点归入待归档资产 localforage 持久集合，不把当前 work 强灌；
 * 3. 真实内容摘要与描述符核验，杜绝假哈希与伪造媒体，新版本通过真原件登记生成；
 * 4. 经由作品 store 草稿/提交协议落地落盘。
 */
export async function archiveCanvasNodesToWork(
    workId: string,
    nodes: CanvasNodeData[],
    canvasId: string,
    snapshot?: CanvasProject,
): Promise<{ archivedCount: number; pendingCount: number }> {
    const store = useWorksStore.getState();
    const records = store.currentRecords;

    // 1. 检查作品已有画布绑定，杜绝静默破坏性替换
    const bindingLocatorId = await toLocatorId(workId, "canvas_binding");
    const existingBindingRec = records[bindingLocatorId] || Object.values(records).find((r) => r.type === "canvas_binding");
    if (existingBindingRec) {
        const data = existingBindingRec.data as { canvasId?: string };
        if (data?.canvasId && data.canvasId !== canvasId) {
            throw new Error(`当前作品已绑定画布 [${data.canvasId}]，拒绝静默覆盖为 [${canvasId}]`);
        }
    }

    // 建立现有媒体描述符哈希索引
    const existingMediaBySha256 = new Map<string, { fileId: string; descriptor: Record<string, unknown> }>();
    for (const rec of Object.values(records)) {
        if (rec.type === "media") {
            const data = rec.data as Record<string, unknown>;
            if (typeof data.sha256 === "string" && typeof data.fileId === "string") {
                existingMediaBySha256.set(data.sha256, { fileId: data.fileId, descriptor: data });
            }
        }
    }

    const changes: RecordChange[] = [];
    let archivedCount = 0;
    let pendingCount = 0;

    for (const node of nodes) {
        const meta = node.metadata || {};
        const canonical = meta.worksCanonical as { objectId?: string; revisionId?: string; workId?: string } | undefined;
        const nodeWorkId = canonical?.workId || (meta.workId as string | undefined);

        // 跨作品节点：不得强灌给当前作品，存入待归档集合
        if (nodeWorkId && nodeWorkId !== workId) {
            const kind = node.type === "video" ? "video" : node.type === "audio" ? "audio" : node.type === "text" ? "text" : "image";
            await savePendingArchiveItem({
                nodeId: node.id,
                title: node.title,
                kind,
                sourceFileId: typeof meta.fileId === "string" ? meta.fileId : undefined,
                storageKey: typeof meta.storageKey === "string" ? meta.storageKey : undefined,
                url: typeof meta.url === "string" ? meta.url : typeof meta.dataUrl === "string" ? meta.dataUrl : undefined,
                content: typeof meta.content === "string" ? meta.content : undefined,
                prompt: typeof meta.prompt === "string" ? meta.prompt : undefined,
                sourceWorkId: nodeWorkId,
                generationId: typeof meta.generationId === "string" ? meta.generationId : undefined,
                metadata: meta,
                createdAt: new Date().toISOString(),
            });
            pendingCount++;
            continue;
        }

        const objectId = canonical?.objectId || (typeof meta.objectId === "string" ? meta.objectId : typeof meta.xiajiAssetId === "string" ? meta.xiajiAssetId : undefined);

        // 如果节点属于当前作品已有对象
        if (objectId && records[objectId]) {
            const blob = await resolveNodeBlob(node);
            if (blob) {
                const arrayBuf = await blob.arrayBuffer();
                const realSha256 = await sha256Hex(arrayBuf);

                // 检查是否与该对象当前版本的媒体一致
                const existingRec = records[objectId];
                const recData = existingRec.data as Record<string, unknown>;
                const currentMediaId = Array.isArray(recData?.currentMediaIds) ? recData.currentMediaIds[0] : recData?.fileId;
                const currentMediaRec = currentMediaId ? records[currentMediaId] : null;
                const currentMediaData = currentMediaRec?.data as Record<string, unknown> | undefined;

                if (currentMediaData?.sha256 === realSha256) {
                    // 内容哈希完全一致，幂等复用已有修订，不制造垃圾版本
                    archivedCount++;
                    continue;
                }

                // 产出新内容：真实原件登记，生成新版本
                let targetFileId: string;
                if (existingMediaBySha256.has(realSha256)) {
                    // 已有完全相同哈希的原件，直接复用描述符
                    const existing = existingMediaBySha256.get(realSha256)!;
                    targetFileId = existing.fileId;
                    changes.push({
                        id: targetFileId,
                        type: "media",
                        data: existing.descriptor,
                    });
                } else {
                    // 上传真实原件
                    const kind = node.type === "video" ? "video" : node.type === "audio" ? "audio" : node.type === "text" ? "text" : "image";
                    const mimeType = blob.type || (kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mp3" : kind === "image" ? "image/png" : "text/plain");
                    const ext = kind === "video" ? ".mp4" : kind === "audio" ? ".mp3" : kind === "image" ? ".png" : ".txt";
                    const uploadRes = await uploadMedia(workId, blob, `${node.title || "artifact"}${ext}`, mimeType);
                    targetFileId = uploadRes.fileId;
                    const mediaChange: RecordChange = {
                        id: targetFileId,
                        type: "media",
                        data: {
                            ...uploadRes,
                            originalFilename: node.title || uploadRes.originalFilename,
                        },
                    };
                    changes.push(mediaChange);
                    existingMediaBySha256.set(realSha256, { fileId: targetFileId, descriptor: mediaChange.data as Record<string, unknown> });
                }

                // 为主体实体创建新修订记录，依据其 Go schema 更新对应的媒体引用字段，杜绝非法注入 currentMediaIds
                if (existingRec.type === "asset") {
                    changes.push({
                        id: objectId,
                        type: "asset",
                        data: {
                            ...recData,
                            currentMediaIds: [targetFileId],
                        },
                    });
                } else if (existingRec.type === "shot") {
                    const prevOutputs = Array.isArray(recData.selectedOutputIds) ? (recData.selectedOutputIds as string[]) : [];
                    const { currentMediaIds: _drop, ...cleanData } = recData;
                    changes.push({
                        id: objectId,
                        type: "shot",
                        data: {
                            ...cleanData,
                            selectedOutputIds: prevOutputs.includes(targetFileId) ? prevOutputs : [...prevOutputs, targetFileId],
                        },
                    });
                } else if (existingRec.type === "generation") {
                    const prevOutputs = Array.isArray(recData.outputFileIds) ? (recData.outputFileIds as string[]) : [];
                    const { currentMediaIds: _drop, ...cleanData } = recData;
                    changes.push({
                        id: objectId,
                        type: "generation",
                        data: {
                            ...cleanData,
                            outputFileIds: prevOutputs.includes(targetFileId) ? prevOutputs : [...prevOutputs, targetFileId],
                        },
                    });
                }
                // 若 existingRec.type === "media"，新媒体原件已登记为独立 media 记录，不生成携带非法字段的记录更新
                archivedCount++;
            }
        } else if (meta.content || meta.url || meta.dataUrl || meta.fileId) {
            // 未知归属的新产物：保存到待归档集合中
            const kind = node.type === "video" ? "video" : node.type === "audio" ? "audio" : node.type === "text" ? "text" : "image";
            await savePendingArchiveItem({
                nodeId: node.id,
                title: node.title,
                kind,
                sourceFileId: typeof meta.fileId === "string" ? meta.fileId : undefined,
                storageKey: typeof meta.storageKey === "string" ? meta.storageKey : undefined,
                url: typeof meta.url === "string" ? meta.url : typeof meta.dataUrl === "string" ? meta.dataUrl : undefined,
                content: typeof meta.content === "string" ? meta.content : undefined,
                prompt: typeof meta.prompt === "string" ? meta.prompt : undefined,
                targetWorkId: workId,
                workId,
                generationId: typeof meta.generationId === "string" ? meta.generationId : undefined,
                metadata: meta,
                createdAt: new Date().toISOString(),
            });
            pendingCount++;
        }
    }

    // 若传入完整快照，同步持久化 canvas_binding 记录
    if (snapshot) {
        const bindingRecord = buildCanvasBindingRecord(workId, canvasId, snapshot);
        changes.push({
            id: bindingLocatorId,
            type: "canvas_binding",
            data: bindingRecord as unknown as Record<string, unknown>,
        });
    }

    if (changes.length > 0) {
        await store.updateDraftChanges(changes);
        const commitRes = await store.commitDraft();
        if (!commitRes.committed) {
            throw new Error("反向归档提交未被作品服务确认");
        }
    }

    return { archivedCount, pendingCount };
}
