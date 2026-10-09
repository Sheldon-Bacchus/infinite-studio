// SPDX-License-Identifier: AGPL-3.0-or-later

import localforage from "localforage";
import { nanoid } from "nanoid";
import { initialGenerationTask, reduceGenerationTask, type GenerationTaskState } from "./generation-task-state";
export type { GenerationTaskState } from "./generation-task-state";
import { toLocatorId } from "./works-adapter";
import { useWorksStore } from "@/stores/use-works-store";
import { listPendingArchiveItems, removePendingArchiveItem } from "@/lib/works/canvas-archive";
import {
    getWork,
    commitWork,
    type RecordChange,
} from "@/services/api/works";

/**
 * 敏感字段精确剔除清单（覆盖常见变体，绝不匹配 storageKey、sourceKey 等合法存储字段）
 */
const SENSITIVE_KEY_PATTERNS = [
    /^(api[-_]?key|secret[-_]?key|client[-_]?secret|secret|access[-_]?token|auth[-_]?token|token|password|passwd|authorization|bearer|credentials?|private[-_]?key)$/i,
];

/**
 * 清洗生成参数与输入快照，严格剔除密钥凭据，绝不误删 storageKey 与 sourceKey
 */
export function sanitizeGenerationParameters(obj: unknown): Record<string, unknown> {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return {};

    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (key === "storageKey" || key === "sourceKey") {
            clean[key] = value;
            continue;
        }

        const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
        if (isSensitive) continue;

        if (value && typeof value === "object" && !Array.isArray(value)) {
            clean[key] = sanitizeGenerationParameters(value);
        } else if (Array.isArray(value)) {
            clean[key] = value.map((item) =>
                item && typeof item === "object" ? sanitizeGenerationParameters(item) : typeof item === "string" ? sanitizeGenerationText(item) : item,
            );
        } else {
            clean[key] = typeof value === "string" ? sanitizeGenerationText(value) : value;
        }
    }
    return clean;
}


/** 脱敏文本保留可诊断地址，不保留 URL 凭据/签名。 */
export function sanitizeGenerationText(value: string): string {
    return value.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
        try {
            const url = new URL(raw);
            url.username = ""; url.password = "";
            for (const key of Array.from(url.searchParams.keys())) {
                if (/key|token|secret|password|signature|credential|authorization|^sig$|^x-amz-|^x-goog-/i.test(key)) url.searchParams.delete(key);
            }
            return url.toString();
        } catch { return "[地址已脱敏]"; }
    }).replace(/(Bearer\s+)[^\s"',;]+/gi, "$1[已脱敏]")
      .replace(/((?:api[-_]?key|access[-_]?token|password|authorization|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[已脱敏]");
}

/**
 * 本地生成历史条目模型（符合 GenerationData 服务端模型规范）
 */
export interface GenerationHistoryEntry {
    id: string; // generationId
    parentGenerationId?: string; // 父尝试 ID，重试时关联
    nodeId?: string; // 关联的画布节点 ID
    canvasId?: string; // 关联的画布 ID
    workId: string;
    episodeId?: string;
    shotId?: string;
    sourceRevision?: string;
    inputSnapshot: Record<string, unknown>;
    modelChannel: string;
    parameters?: Record<string, unknown>;
    taskId: string;
    status: "pending" | "running" | "succeeded" | "failed" | "canceled";
    outputFileIds: string[];
    errorReason?: string;
    task?: GenerationTaskState;
    createdAt: string;
    updatedAt: string;
}

const historyStore = localforage.createInstance({
    name: "infinite-studio-works",
    storeName: "generation-history",
});
const generationCommitStore = localforage.createInstance({ name: "infinite-studio-works", storeName: "generation-commit-retries" });

export type GenerationHistoryChangeEvent = {
    type: "started" | "updated";
    entry: GenerationHistoryEntry;
};

type GenerationHistoryChangeListener = (event: GenerationHistoryChangeEvent) => void;

const historyListeners = new Set<GenerationHistoryChangeListener>();

/**
 * 订阅生成历史变更（新建或状态更新），沿用事件监听机制，不引入轮询
 */
export function subscribeGenerationHistory(listener: GenerationHistoryChangeListener): () => void {
    historyListeners.add(listener);
    return () => {
        historyListeners.delete(listener);
    };
}

let historyBroadcast: BroadcastChannel | undefined;
function notifyHistoryChange(event: GenerationHistoryChangeEvent) {
    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
        historyBroadcast ||= new BroadcastChannel("infinite-studio:generation-history");
        historyBroadcast.postMessage({ type: "changed" });
    }
    historyListeners.forEach((fn) => {
        try {
            fn(event);
        } catch {
            // ignore subscriber errors
        }
    });
}

/**
 * 记录新的生成尝试启动（固定 workId、shot/episode 归属与输入快照）
 */
export async function startGenerationHistory(params: {
    id: string;
    workId: string;
    parentGenerationId?: string;
    nodeId?: string;
    canvasId?: string;
    episodeId?: string;
    shotId?: string;
    sourceRevision?: string;
    inputSnapshot: Record<string, unknown>;
    modelChannel: string;
    parameters?: Record<string, unknown>;
    taskId?: string;
    task?: Partial<GenerationTaskState>;
}): Promise<GenerationHistoryEntry> {
    const now = new Date().toISOString();
    const cleanSnapshot = sanitizeGenerationParameters(params.inputSnapshot);
    const cleanParams = params.parameters ? sanitizeGenerationParameters(params.parameters) : {};

    const entry: GenerationHistoryEntry = {
        id: params.id,
        parentGenerationId: params.parentGenerationId,
        nodeId: params.nodeId,
        canvasId: params.canvasId,
        workId: params.workId,
        episodeId: params.episodeId,
        shotId: params.shotId,
        sourceRevision: params.sourceRevision,
        inputSnapshot: cleanSnapshot,
        modelChannel: params.modelChannel,
        parameters: cleanParams,
        taskId: params.taskId || "",
        status: "running",
        task: (params.task || params.inputSnapshot.mode === "video") ? initialGenerationTask(params.task, now) : undefined,
        outputFileIds: [],
        createdAt: now,
        updatedAt: now,
    };

    await historyStore.setItem(params.id, entry);
    notifyHistoryChange({ type: "started", entry });
    return entry;
}

let updateHistoryQueue: Promise<unknown> = Promise.resolve();

function serializeHistoryWrite<T>(id: string, run: () => Promise<T>): Promise<T> {
    const exclusive = () => typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request(`infinite-studio:history:${id}`, run)
        : run();
    const next = updateHistoryQueue.then(exclusive, exclusive);
    updateHistoryQueue = next.then(() => undefined, () => undefined);
    return next;
}

/**
 * 更新现有生成历史状态、远程任务 ID 或产物
 * 严格保护并发生成输出，合并追加而非单元素覆盖；使用任务队列防范 localforage 读写竞态
 */
export async function updateGenerationHistory(
    id: string,
    patch: {
        workId?: string;
        task?: Partial<Omit<GenerationTaskState, "events">>;
        taskMessage?: string;
        taskId?: string;
        status?: "running" | "succeeded" | "failed" | "canceled";
        outputFileIds?: string[];
        errorReason?: string;
    },
): Promise<GenerationHistoryEntry | null> {
    const run = async (): Promise<GenerationHistoryEntry | null> => {
        const existing = await historyStore.getItem<GenerationHistoryEntry>(id);
        if (!existing) return null;

        let mergedOutputIds = existing.outputFileIds ? [...existing.outputFileIds] : [];
        if (patch.outputFileIds) {
            for (const fid of patch.outputFileIds) {
                if (fid && !mergedOutputIds.includes(fid)) {
                    mergedOutputIds.push(fid);
                }
            }
        }

        let task = existing.task;
        if (patch.task) task = reduceGenerationTask(task || initialGenerationTask(), patch.task, sanitizeGenerationText(patch.taskMessage || "更新任务状态"), patch.task.reasonCode);
        // 既有调用的 failed/canceled 不可把网络未知或停止查询伪报为远程终止。
        if (task && patch.status && !["blocked", "needs_attention", "succeeded", "failed", "cancelled"].includes(task.status)) {
            if (patch.status === "succeeded" && ["downloaded", "archived"].includes(task.outputState)) {
                task = reduceGenerationTask(task, { status: "succeeded", connection: "available" }, "结果已保存", undefined);
            } else if (patch.status === "failed" || patch.status === "canceled") {
                const acceptedOrUnknown = task.submission === "accepted" || task.submission === "in_flight" || task.submission === "unknown";
                task = reduceGenerationTask(task, {
                    status: acceptedOrUnknown ? "needs_attention" : (patch.status === "canceled" ? "cancelled" : "failed"),
                    submission: task.submission === "in_flight" ? "unknown" : task.submission,
                    connection: acceptedOrUnknown ? "interrupted" : task.connection,
                }, patch.status === "canceled" ? "本地执行已停止；远程任务是否取消未确认" : sanitizeGenerationText(patch.errorReason || "执行失败"), undefined);
            }
        }
        const updated: GenerationHistoryEntry = {
            ...existing,
            task,
            workId: patch.workId && !existing.workId ? patch.workId : existing.workId,
            taskId: patch.taskId !== undefined ? patch.taskId : existing.taskId,
            status: existing.task?.status === "succeeded" ? "succeeded" : existing.task?.status === "failed" ? "failed" : patch.status !== undefined ? patch.status : existing.status,
            outputFileIds: mergedOutputIds,
            errorReason: patch.errorReason !== undefined ? sanitizeGenerationText(patch.errorReason) : existing.errorReason,
            updatedAt: new Date().toISOString(),
        };

        await historyStore.setItem(id, updated);
        notifyHistoryChange({ type: "updated", entry: updated });
        return updated;
    };

    return serializeHistoryWrite(id, run);
}

/** 与普通历史写入共用串行链，快照不变、事件与状态一起保存。 */
export async function updateGenerationTask(
    id: string,
    patch: Partial<Omit<GenerationTaskState, "events">>,
    message: string,
    reasonCode?: string,
): Promise<GenerationHistoryEntry | null> {
    const run = async () => {
        const existing = await historyStore.getItem<GenerationHistoryEntry>(id);
        if (!existing) return null;
        const task = reduceGenerationTask(existing.task || initialGenerationTask(), patch, sanitizeGenerationText(message), reasonCode, nanoid());
        const entry = { ...existing, task, updatedAt: new Date().toISOString() };
        await historyStore.setItem(id, entry);
        notifyHistoryChange({ type: "updated", entry });
        return entry;
    };
    return serializeHistoryWrite(id, run);
}

export async function attachGenerationOutputToWork(id: string, workId: string, fileId: string): Promise<boolean> {
    const existing = await historyStore.getItem<GenerationHistoryEntry>(id);
    if (!existing || (existing.workId && existing.workId !== workId)) return true;
    await updateGenerationHistory(id, { workId, outputFileIds: [fileId] });
    return Boolean(await commitGenerationToWork(id));
}

/**
 * 获取指定生成记录
 */
export async function getGenerationHistory(id: string): Promise<GenerationHistoryEntry | null> {
    return historyStore.getItem<GenerationHistoryEntry>(id);
}

/**
 * 获取生成历史列表（可选按作品过滤）
 */
export async function listGenerationHistories(workId?: string): Promise<GenerationHistoryEntry[]> {
    const items: GenerationHistoryEntry[] = [];
    await historyStore.iterate<GenerationHistoryEntry, void>((value) => {
        if (!workId || value.workId === workId) {
            items.push(value);
        }
    });
    return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * 获取指定画布节点的所有生成历史条目（包括初始尝试与历次重试），按创建时间倒序排列
 */
export async function listGenerationHistoriesForNode(nodeId: string): Promise<GenerationHistoryEntry[]> {
    if (!nodeId) return [];
    const items: GenerationHistoryEntry[] = [];
    await historyStore.iterate<GenerationHistoryEntry, void>((value) => {
        const snap = value.inputSnapshot as Record<string, unknown> | undefined;
        const prov = snap?.provenance as { sourceNode?: { nodeId?: string } } | undefined;
        const src = snap?.source as { nodeId?: string } | undefined;
        if (
            value.nodeId === nodeId ||
            src?.nodeId === nodeId ||
            prov?.sourceNode?.nodeId === nodeId
        ) {
            items.push(value);
        }
    });
    return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * 批量获取生成历史条目（按 ID 列表），按创建时间倒序排列
 */
export async function getGenerationHistoriesByIds(ids: string[]): Promise<GenerationHistoryEntry[]> {
    if (!ids.length) return [];
    const entries = await Promise.all(ids.map((id) => historyStore.getItem<GenerationHistoryEntry>(id)));
    return entries.filter((e): e is GenerationHistoryEntry => Boolean(e)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * 将生成历史持久化提交为指定作品版本化记录 (RecordTypeGeneration = "generation")
 * 规则：
 * 1. 若未选择作品，保留为本地待处理历史条目，绝对不随意挂载到后来切换的当前作品；
 * 2. 跨作品切换后完成仍精准挂载到启动时捕获的起始作品，直连 API 提交；
 * 3. 服务端 commit 校验 outputFileIds 必须解析到 committed media 记录，过滤仅保留已确认的 media 记录。
 */
export async function commitGenerationToWork(id: string, statusOverride?: GenerationHistoryEntry["status"]): Promise<RecordChange | null> {
    const entry = await historyStore.getItem<GenerationHistoryEntry>(id);
    if (!entry || !entry.workId) {
        // 未选择作品时保持独立本地记录，不挂载到全局作品
        return null;
    }

    const locatorId = await toLocatorId(entry.workId, `generation:${entry.id}`);
    const store = useWorksStore.getState();
    const pendingItems = await listPendingArchiveItems(entry.workId);
    const generatedMedia = pendingItems
        .filter((item) => item.generationId === entry.id && item.mediaDescriptor?.workId === entry.workId)
        .map((item) => item.mediaDescriptor!);

    const makeChanges = (records: Record<string, { type: string; data: unknown }>) => {
        const mediaById = new Map(generatedMedia.map((media) => [media.fileId, media]));
        const committedOutputIds = Array.from(new Set([...(entry.outputFileIds || []), ...generatedMedia.map((media) => media.fileId)])).filter((fileId) => {
            const record = records[fileId];
            return mediaById.has(fileId) || (record?.type === "media" && ((record.data as Record<string, unknown>)?.workId === entry.workId));
        });
        const changes: RecordChange[] = generatedMedia
            .filter((media) => !records[media.fileId])
            .map((media) => ({ id: media.fileId, type: "media", data: media }));
        changes.push({
            id: locatorId,
            type: "generation",
            data: {
                id: locatorId,
                workId: entry.workId,
                episodeId: entry.episodeId || "",
                shotId: entry.shotId || "",
                sourceRevision: entry.sourceRevision || "",
                inputSnapshot: entry.inputSnapshot,
                modelChannel: entry.modelChannel,
                parameters: entry.parameters || {},
                taskId: entry.taskId,
                status: statusOverride || entry.status,
                outputFileIds: committedOutputIds,
            },
        });
        return changes;
    };

    // 若当前 store 处于同一作品，经由 store 提交
    if (store.currentWorkId === entry.workId) {
        const changes = makeChanges(store.currentRecords);
        try {
            await store.saveDraftChanges(changes);
            const result = await store.commitDraft();
            if (!result.committed) return null;
            await Promise.all(pendingItems.filter((item) => item.generationId === entry.id).map((item) => removePendingArchiveItem(item.nodeId)));
            return changes[changes.length - 1];
        } catch {
            // 草稿保留完整请求与 operationId，以便下一次执行原样重试。
            return null;
        }
    }

    // 用户在生成过程中切换了作品：直连本地作品服务精准提交至起始作品
    try {
        const detail = await getWork(entry.workId);
        const key = `generation:${entry.workId}:${entry.id}`;
        const saved = await generationCommitStore.getItem<{ baseRevision: number; operationId: string; changes: RecordChange[] }>(key);
        const request = saved || {
            baseRevision: detail.work.revision,
            operationId: await toLocatorId(entry.workId, `op:gen:${entry.id}`),
            changes: makeChanges(detail.records),
        };
        if (!saved) await generationCommitStore.setItem(key, request);
        await commitWork(entry.workId, request);
        await generationCommitStore.removeItem(key);
        await Promise.all(pendingItems.filter((item) => item.generationId === entry.id).map((item) => removePendingArchiveItem(item.nodeId)));
        const change = request.changes[request.changes.length - 1];
        return change;
    } catch {
        return null;
    }
}
