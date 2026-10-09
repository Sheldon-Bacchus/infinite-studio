// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import localforage from "localforage";
import {
    listWorks,
    getWork,
    createWork as apiCreateWork,
    commitWork as apiCommitWork,
    archiveEntities as apiArchiveEntities,
    restoreEntities as apiRestoreEntities,
    WorksError,
    type Work,
    type Commit,
    type RecordItem,
    type RecordChange,
    type CommitResult,
} from "@/services/api/works";

const CURRENT_WORK_ID_KEY = "infinite-studio:current-work-id";

// localforage 实例专门持久化各作品的本地未提交业务草稿
const draftsStore = localforage.createInstance({
    name: "infinite-studio-works",
    storeName: "drafts",
});

export interface WorkDraft {
    workId: string;
    baseRevision: number;
    operationId: string;
    changes: RecordChange[];
    updatedAt: string;
}

export interface WorkConflict {
    message: string;
    remoteRevision?: number;
}

export interface WorksStoreState {
    works: Work[];
    currentWorkId: string | null;
    currentWork: Work | null;
    currentCommit: Commit | null;
    currentRecords: Record<string, RecordItem>;
    draft: WorkDraft | null;
    hasDraft: boolean;
    loading: boolean;
    committing: boolean;
    error: string | null;
    conflict: WorkConflict | null;
    pendingSwitchWorkId: string | null;

    // Actions
    loadWorks: () => Promise<Work[]>;
    selectWork: (workId: string, options?: { force?: boolean }) => Promise<void>;
    createWork: (title: string, operationId?: string) => Promise<Work>;
    updateDraftChanges: (changes: RecordChange[], operationId?: string) => Promise<void>;
    saveDraftChanges: (changes: RecordChange[], operationId?: string) => Promise<void>;
    commitDraft: () => Promise<CommitResult>;
    discardDraft: () => Promise<void>;
    resolveConflictKeepDraft: () => Promise<void>;
    refreshCurrentWork: () => Promise<void>;
    archiveEntities: (entityRefs: string[]) => Promise<CommitResult>;
    restoreEntities: (entityRefs: string[]) => Promise<CommitResult>;
    clearError: () => void;
}

type WorkChangeListener = (work: Work | null) => void;
const listeners = new Set<WorkChangeListener>();
let lastNotifiedWorkId: string | null = null;
let lastNotifiedRevision: number = -1;

function notifyWorkChanged(work: Work | null) {
    const nextId = work?.id ?? null;
    const nextRevision = work?.revision ?? -1;
    if (nextId === lastNotifiedWorkId && nextRevision === lastNotifiedRevision) {
        return;
    }
    lastNotifiedWorkId = nextId;
    lastNotifiedRevision = nextRevision;
    listeners.forEach((listener) => {
        try {
            listener(work);
        } catch {
            // ignore subscriber errors
        }
    });
}

export function subscribeWorkChange(listener: WorkChangeListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

let workFence = 0;

type PendingEntityOperation = { baseRevision: number; operationId: string; entityRefs: string[] };

export const useWorksStore = create<WorksStoreState>((set, get) => ({
    works: [],
    currentWorkId: typeof window !== "undefined" ? localStorage.getItem(CURRENT_WORK_ID_KEY) : null,
    currentWork: null,
    currentCommit: null,
    currentRecords: {},
    draft: null,
    hasDraft: false,
    loading: false,
    committing: false,
    error: null,
    conflict: null,
    pendingSwitchWorkId: null,

    loadWorks: async () => {
        const fence = ++workFence;
        set({ loading: true, error: null });
        try {
            const list = await listWorks();
            if (fence !== workFence) return list;
            set({ works: list });

            let targetId = get().currentWorkId;
            if (targetId && !list.some((w) => w.id === targetId)) {
                targetId = null;
                if (typeof window !== "undefined") {
                    localStorage.removeItem(CURRENT_WORK_ID_KEY);
                }
                set({ currentWorkId: null, currentWork: null, currentCommit: null, currentRecords: {}, draft: null, hasDraft: false });
                notifyWorkChanged(null);
            }

            if (targetId) {
                try {
                    const detail = await getWork(targetId);
                    const draft = await draftsStore.getItem<WorkDraft>(`draft:${targetId}`);
                    if (fence !== workFence) return list;
                    set({
                        currentWorkId: targetId,
                        currentWork: detail.work,
                        currentCommit: detail.currentCommit,
                        currentRecords: detail.records,
                        draft: draft || null,
                        hasDraft: Boolean(draft && draft.changes.length > 0),
                    });
                    notifyWorkChanged(detail.work);
                } catch {
                    if (fence === workFence) {
                        set({ currentWork: null, currentCommit: null, currentRecords: {}, draft: null, hasDraft: false });
                    }
                }
            }
            return list;
        } catch (err) {
            if (fence === workFence) {
                const msg = err instanceof Error ? err.message : String(err);
                set({ error: msg });
            }
            throw err;
        } finally {
            if (fence === workFence) {
                set({ loading: false });
            }
        }
    },

    selectWork: async (workId: string, options = {}) => {
        const state = get();
        // 若同 ID 且已有已加载的 currentWork，无需重复拉取
        if (state.currentWorkId === workId && state.currentWork && !options.force) {
            return;
        }

        // 切换检查：若当前作品有未提交草稿且未显式 force，阻断切换，严禁静默丢弃
        if (state.hasDraft && state.currentWorkId !== workId && !options.force) {
            set({ pendingSwitchWorkId: workId });
            throw new Error("当前作品存在未提交的草稿，请先提交或放弃修改，或确认切换");
        }

        const fence = ++workFence;
        set({ loading: true, error: null, conflict: null, pendingSwitchWorkId: null });
        try {
            const detail = await getWork(workId);
            const draft = await draftsStore.getItem<WorkDraft>(`draft:${workId}`);

            if (fence !== workFence) return;

            if (typeof window !== "undefined") {
                localStorage.setItem(CURRENT_WORK_ID_KEY, workId);
            }

            set({
                currentWorkId: workId,
                currentWork: detail.work,
                currentCommit: detail.currentCommit,
                currentRecords: detail.records,
                draft: draft || null,
                hasDraft: Boolean(draft && draft.changes.length > 0),
            });
            notifyWorkChanged(detail.work);
        } catch (err) {
            if (fence === workFence) {
                const msg = err instanceof Error ? err.message : String(err);
                set({ error: msg });
            }
            throw err;
        } finally {
            if (fence === workFence) {
                set({ loading: false });
            }
        }
    },

    createWork: async (title: string, operationId?: string) => {
        const state = get();
        if (state.hasDraft) {
            throw new Error("当前作品存在未提交的草稿，请先提交或放弃草稿后再创建新作品");
        }

        const fence = ++workFence;
        set({ loading: true, error: null });
        try {
            const pendingKey = "pending:create-work";
            const previous = await draftsStore.getItem<{ title: string; operationId: string }>(pendingKey);
            const pending = operationId
                ? { title, operationId }
                : previous?.title === title ? previous : { title, operationId: crypto.randomUUID() };
            await draftsStore.setItem(pendingKey, pending);
            const stableOpId = pending.operationId;
            const result = await apiCreateWork({ title, operationId: stableOpId });
            const list = await listWorks();

            if (fence !== workFence) return result.work;

            if (typeof window !== "undefined") {
                localStorage.setItem(CURRENT_WORK_ID_KEY, result.work.id);
            }

            const detail = await getWork(result.work.id);
            if (fence !== workFence) return result.work;

            await draftsStore.removeItem(pendingKey);

            set({
                works: list,
                currentWorkId: result.work.id,
                currentWork: detail.work,
                currentCommit: detail.currentCommit,
                currentRecords: detail.records,
                draft: null,
                hasDraft: false,
            });
            notifyWorkChanged(detail.work);
            return result.work;
        } catch (err) {
            if (fence === workFence) {
                const msg = err instanceof Error ? err.message : String(err);
                set({ error: msg });
            }
            throw err;
        } finally {
            if (fence === workFence) {
                set({ loading: false });
            }
        }
    },

    updateDraftChanges: async (changes: RecordChange[], operationId?: string) => {
        const { currentWorkId, currentWork } = get();
        if (!currentWorkId || !currentWork) {
            throw new Error("未选定当前作品，无法保存草稿");
        }

        const storedDraft = await draftsStore.getItem<WorkDraft>(`draft:${currentWorkId}`);
        const previousDraft = storedDraft?.workId === currentWorkId ? storedDraft : null;
        const samePayload = previousDraft && JSON.stringify(previousDraft.changes) === JSON.stringify(changes);
        const nextOperationId = operationId && (!previousDraft || operationId !== previousDraft.operationId || samePayload)
            ? operationId
            : samePayload ? previousDraft.operationId : crypto.randomUUID();
        const draft: WorkDraft = {
            workId: currentWorkId,
            baseRevision: previousDraft?.baseRevision ?? currentWork.revision,
            operationId: nextOperationId,
            changes,
            updatedAt: new Date().toISOString(),
        };

        await draftsStore.setItem(`draft:${currentWorkId}`, draft);
        if (get().currentWorkId === currentWorkId) {
            set({ draft, hasDraft: changes.length > 0 });
        }
    },

    saveDraftChanges: async (changes: RecordChange[], operationId?: string) => {
        const existing = get().draft?.changes || [];
        const changeMap = new Map<string, RecordChange>();
        for (const c of existing) {
            changeMap.set(c.id, c);
        }
        for (const c of changes) {
            changeMap.set(c.id, c);
        }
        const merged = Array.from(changeMap.values());
        return get().updateDraftChanges(merged, operationId);
    },

    commitDraft: async () => {
        const { currentWorkId, currentWork, draft } = get();
        if (!currentWorkId || !currentWork) {
            throw new Error("未选定当前作品，无法提交");
        }
        if (!draft || draft.changes.length === 0) {
            throw new Error("当前作品没有需要提交的草稿");
        }

        const targetWorkId = currentWorkId;
        const targetOpId = draft.operationId;
        const targetBaseRevision = draft.baseRevision;
        const targetChanges = draft.changes;
        const commitFence = ++workFence;

        set({ committing: true, error: null, conflict: null });
        try {
            const result = await apiCommitWork(targetWorkId, {
                baseRevision: targetBaseRevision,
                operationId: targetOpId,
                changes: targetChanges,
            });

            if (!result.committed) {
                throw new Error("提交未被权威服务确认");
            }

            // 提交成功后拉取最新权威详情
            const detail = await getWork(targetWorkId);

            // 原子核验草稿：若本地草稿仍为本次提交的 operationId，说明提交期间未产生新编辑，予以清理；若有新草稿则保留
            const storedDraft = await draftsStore.getItem<WorkDraft>(`draft:${targetWorkId}`);
            let remainingDraft: WorkDraft | null = storedDraft;
            if (storedDraft && storedDraft.operationId === targetOpId) {
                await draftsStore.removeItem(`draft:${targetWorkId}`);
                remainingDraft = null;
            }

            // 校验 fence 与目标作品一致性：旧作品提交完成绝不覆盖新切换的作品状态
            if (commitFence === workFence && get().currentWorkId === targetWorkId) {
                set({
                    currentWork: detail.work,
                    currentCommit: detail.currentCommit,
                    currentRecords: detail.records,
                    draft: remainingDraft,
                    hasDraft: Boolean(remainingDraft && remainingDraft.changes.length > 0),
                    conflict: null,
                });
                notifyWorkChanged(detail.work);
            }
            return result;
        } catch (err) {
            if (err instanceof WorksError && err.kind === "conflict") {
                // 409 版本冲突：严格保留草稿，不静默 rebase
                const latest = await getWork(targetWorkId).catch(() => null);
                if (get().currentWorkId === targetWorkId) {
                    set({
                        conflict: {
                            message: "远端作品版本已更新，存在提交冲突",
                            remoteRevision: latest?.work.revision,
                        },
                    });
                }
            }
            if (get().currentWorkId === targetWorkId) {
                const msg = err instanceof Error ? err.message : String(err);
                set({ error: msg });
            }
            throw err;
        } finally {
            if (get().currentWorkId === targetWorkId) {
                set({ committing: false });
            }
        }
    },

    discardDraft: async () => {
        const { currentWorkId } = get();
        if (currentWorkId) {
            await draftsStore.removeItem(`draft:${currentWorkId}`);
        }
        set({ draft: null, hasDraft: false, conflict: null });
    },

    resolveConflictKeepDraft: async () => {
        // 用户显式动作：重新以当前权威版本为基准更新草稿 baseRevision，保留改动等待重新提交
        const { currentWorkId, draft } = get();
        if (!currentWorkId) return;
        const detail = await getWork(currentWorkId);
        if (draft) {
            const rebasedDraft: WorkDraft = {
                ...draft,
                baseRevision: detail.work.revision,
                operationId: crypto.randomUUID(), // 显式更新为新提交请求
                updatedAt: new Date().toISOString(),
            };
            await draftsStore.setItem(`draft:${currentWorkId}`, rebasedDraft);
            set({
                currentWork: detail.work,
                currentCommit: detail.currentCommit,
                currentRecords: detail.records,
                draft: rebasedDraft,
                hasDraft: rebasedDraft.changes.length > 0,
                conflict: null,
            });
        } else {
            set({
                currentWork: detail.work,
                currentCommit: detail.currentCommit,
                currentRecords: detail.records,
                conflict: null,
            });
        }
    },

    refreshCurrentWork: async () => {
        const { currentWorkId } = get();
        if (!currentWorkId) return;
        const fence = ++workFence;
        try {
            const detail = await getWork(currentWorkId);
            if (fence !== workFence || get().currentWorkId !== currentWorkId) return;
            set({
                currentWork: detail.work,
                currentCommit: detail.currentCommit,
                currentRecords: detail.records,
            });
            notifyWorkChanged(detail.work);
        } catch (err) {
            if (fence === workFence && get().currentWorkId === currentWorkId) {
                const msg = err instanceof Error ? err.message : String(err);
                set({ error: msg });
            }
        }
    },

    archiveEntities: async (entityRefs: string[]) => {
        const { currentWorkId, currentWork } = get();
        if (!currentWorkId || !currentWork) {
            throw new Error("未选定当前作品，无法执行归档");
        }
        const operation = await getOrCreateEntityOperation("archive", currentWorkId, currentWork.revision, entityRefs);
        const res = await apiArchiveEntities(currentWorkId, {
            baseRevision: operation.baseRevision,
            operationId: operation.operationId,
            entityRefs: operation.entityRefs,
        });
        const detail = await getWork(currentWorkId);
        if (get().currentWorkId === currentWorkId) {
            set({ currentWork: detail.work, currentCommit: detail.currentCommit, currentRecords: detail.records });
            notifyWorkChanged(detail.work);
        }
        await draftsStore.removeItem(`pending:archive:${currentWorkId}`);
        return res;
    },

    restoreEntities: async (entityRefs: string[]) => {
        const { currentWorkId, currentWork } = get();
        if (!currentWorkId || !currentWork) {
            throw new Error("未选定当前作品，无法执行恢复");
        }
        const operation = await getOrCreateEntityOperation("restore", currentWorkId, currentWork.revision, entityRefs);
        const res = await apiRestoreEntities(currentWorkId, {
            baseRevision: operation.baseRevision,
            operationId: operation.operationId,
            entityRefs: operation.entityRefs,
        });
        const detail = await getWork(currentWorkId);
        if (get().currentWorkId === currentWorkId) {
            set({ currentWork: detail.work, currentCommit: detail.currentCommit, currentRecords: detail.records });
            notifyWorkChanged(detail.work);
        }
        await draftsStore.removeItem(`pending:restore:${currentWorkId}`);
        return res;
    },

    clearError: () => set({ error: null }),
}));

async function getOrCreateEntityOperation(action: "archive" | "restore", workId: string, revision: number, entityRefs: string[]): Promise<PendingEntityOperation> {
    const key = `pending:${action}:${workId}`;
    const previous = await draftsStore.getItem<PendingEntityOperation>(key);
    if (previous && JSON.stringify(previous.entityRefs) === JSON.stringify(entityRefs)) return previous;
    const pending = { baseRevision: revision, operationId: crypto.randomUUID(), entityRefs: [...entityRefs] };
    await draftsStore.setItem(key, pending);
    return pending;
}
