import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import { CommitQueue } from "@/lib/local-workspace/commit-queue";
import { LocalWorkspaceError, type RecordEnvelope } from "@/lib/local-workspace/types";
import { commitLocalCanvasProject, deleteLocalCanvasProject, getLocalWorkspaceOperation, isCanvasProject, isLocalWorkspaceMode, listLocalCanvasProjects } from "@/services/api/local-workspace";
import { useLocalWorkspaceStore } from "@/stores/use-local-workspace-store";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    adoptLocalCanvasProjects: (projects: RecordEnvelope<CanvasProject>[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>, operationId?: string) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
const canvasRevisions = new Map<string, number>();
const observedCanvasProjects = new Map<string, CanvasProject>();
const canvasCommitQueues = new Map<string, CommitQueue<CanvasProject>>();
const requestedCanvasOperations = new Map<string, string>();

function reportCanvasQueue(id: string, queue: CommitQueue<CanvasProject>) {
    queue.subscribe((snapshot) => {
        useLocalWorkspaceStore.getState().setSaveState(`canvas:${id}`, { phase: snapshot.phase, revision: snapshot.revision, message: snapshot.error?.message });
        if (snapshot.revision !== null) canvasRevisions.set(id, snapshot.revision);
    });
}

function queueCanvasCommit(project: CanvasProject, workspaceId: string, operationId?: string) {
    let queue = canvasCommitQueues.get(project.id);
    if (!queue) {
        queue = new CommitQueue(workspaceId, project.id, canvasRevisions.get(project.id) ?? null, (data, baseRevision, operationId) =>
            commitLocalCanvasProject(project.id, { workspaceId, operationId, baseRevision, data }),
        );
        canvasCommitQueues.set(project.id, queue);
        reportCanvasQueue(project.id, queue);
    }
    queue.enqueue(project, operationId);
    void queue.flush().catch(() => undefined);
}

async function removeLocalCanvasProjects(ids: string[], setState: (update: (state: CanvasStore) => Partial<CanvasStore>) => void) {
    const workspace = useLocalWorkspaceStore.getState().workspace;
    if (!workspace) throw new LocalWorkspaceError("本地工作区尚未连接", "unavailable");
    await Promise.all(ids.map(async (id) => {
        const queue = canvasCommitQueues.get(id);
        if (queue && ["dirty", "saving", "error", "conflict"].includes(queue.snapshot().phase)) await queue.flush();
        const revision = queue?.snapshot().revision ?? canvasRevisions.get(id);
        if (!revision) throw new LocalWorkspaceError("画布缺少服务端版本，拒绝删除", "invalid");
        try {
            const result = await deleteLocalCanvasProject(id, { workspaceId: workspace.workspaceId, operationId: nanoid(), baseRevision: revision });
            canvasRevisions.set(id, result.revision);
            observedCanvasProjects.delete(id);
            canvasCommitQueues.delete(id);
            useLocalWorkspaceStore.getState().setSaveState(`canvas:${id}`, { phase: "saved", revision: result.revision });
            setState((state) => ({ projects: state.projects.filter((project) => project.id !== id), deletedProjects: [] }));
        } catch (error) {
            const failure = error instanceof LocalWorkspaceError ? error : new LocalWorkspaceError("画布删除失败；画布仍保留", "server");
            useLocalWorkspaceStore.getState().setSaveState(`canvas:${id}`, { phase: failure.phase === "conflict" ? "conflict" : "error", revision: canvasRevisions.get(id) ?? revision, message: failure.message });
            throw failure;
        }
    }));
}

function persistLocalCanvasProjects(projects: CanvasProject[]) {
    const workspaceId = useLocalWorkspaceStore.getState().workspace?.workspaceId;
    if (!workspaceId) return;
    const nextProjects = new Map(projects.map((project) => [project.id, project]));
    projects.forEach((project) => {
        const operationId = requestedCanvasOperations.get(project.id);
        if (observedCanvasProjects.get(project.id) !== project) queueCanvasCommit(project, workspaceId, operationId);
        requestedCanvasOperations.delete(project.id);
    });
    observedCanvasProjects.clear();
    nextProjects.forEach((project, id) => observedCanvasProjects.set(id, project));
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        if (isLocalWorkspaceMode) {
            try {
                await useLocalWorkspaceStore.getState().connect();
                const envelopes = await listLocalCanvasProjects();
                const projects = envelopes.map((envelope) => {
                    canvasRevisions.set(envelope.id, envelope.revision);
                    useLocalWorkspaceStore.getState().setSaveState(`canvas:${envelope.id}`, { phase: "clean", revision: envelope.revision });
                    return envelope.data;
                });
                observedCanvasProjects.clear();
                projects.forEach((project) => observedCanvasProjects.set(project.id, project));
                const state = { projects, deletedProjects: [] };
                queuedPersistState = state;
                return { state, version: 0 };
            } catch (error) {
                const failure = error instanceof LocalWorkspaceError ? error : new LocalWorkspaceError("读取本地工作区失败", "server");
                useLocalWorkspaceStore.setState({ connection: failure.phase === "unavailable" ? "unavailable" : "error", message: failure.message });
                throw failure;
            }
        }
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjects === nextState.deletedProjects) return;
        queuedPersistState = nextState;
        if (isLocalWorkspaceMode) persistLocalCanvasProjects(nextState.projects);
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            deletedProjects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                if (isLocalWorkspaceMode && !get().hydrated) throw new LocalWorkspaceError("本地工作区尚未读取完成，拒绝新建空画布", "unavailable");
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                if (isLocalWorkspaceMode) throw new LocalWorkspaceError("固定本地工作区模式下暂不支持旧画布 ZIP 导入", "invalid");
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || i18n.t("canvas.project.imported"),
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) => {
                if (isLocalWorkspaceMode && !get().hydrated) return;
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                }));
            },
            deleteProjects: (ids) => {
                if (isLocalWorkspaceMode) {
                    if (!get().hydrated) return;
                    void removeLocalCanvasProjects(ids, set).catch(() => undefined);
                    return;
                }
                set((state) => {
                    const now = new Date().toISOString();
                    const removing = new Set(ids);
                    const projects = state.projects.filter((project) => !removing.has(project.id));
                    const deletedProjects = [...state.deletedProjects.filter((item) => !removing.has(item.id)), ...ids.map((id) => ({ id, deletedAt: now }))];
                    return { projects, deletedProjects };
                });
            },
            replaceProjects: (projects, deletedProjects = []) => {
                if (isLocalWorkspaceMode) return;
                set({ projects, deletedProjects });
            },
            adoptLocalCanvasProjects: (envelopes) => {
                if (!isLocalWorkspaceMode) return;
                envelopes.forEach((envelope) => {
                    canvasRevisions.set(envelope.id, envelope.revision);
                    observedCanvasProjects.set(envelope.id, envelope.data);
                    useLocalWorkspaceStore.getState().setSaveState(`canvas:${envelope.id}`, { phase: "clean", revision: envelope.revision });
                });
                queuedPersistState = null;
                set((state) => {
                    const imported = new Set(envelopes.map((envelope) => envelope.id));
                    return { projects: [...envelopes.map((envelope) => envelope.data), ...state.projects.filter((project) => !imported.has(project.id))] };
                });
            },
            updateProject: (id, patch, operationId) => {
                if (isLocalWorkspaceMode && !get().hydrated) return;
                if (operationId) requestedCanvasOperations.set(id, operationId);
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                }));
                if (operationId && !get().projects.some((project) => project.id === id)) requestedCanvasOperations.delete(id);
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                if (!error || !isLocalWorkspaceMode) useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);

export async function flushLocalCanvasProject(id: string, operationId?: string) {
    const workspace = useLocalWorkspaceStore.getState().workspace;
    if (!workspace) throw new LocalWorkspaceError("本地工作区尚未连接", "unavailable");
    const queue = canvasCommitQueues.get(id);
    if (!queue) {
        if (!operationId) throw new LocalWorkspaceError("画布没有待提交的本地工作区草稿", "invalid");
        const receipt = await getLocalWorkspaceOperation(operationId, isCanvasProject);
        if (receipt.workspaceId !== workspace.workspaceId || receipt.id !== id || receipt.operationId !== operationId) throw new LocalWorkspaceError("工作区操作回执与画布不一致", "invalid");
        return receipt;
    }
    const operationResult = await queue.flush(operationId);
    let result = operationResult;
    while (["dirty", "saving"].includes(queue.snapshot().phase)) result = await queue.flush();
    if (operationId && operationResult.operationId !== operationId) throw new LocalWorkspaceError("工作区未确认 Agent 操作的指定 operationId", "invalid");
    return operationId ? operationResult : result;
}

export function getLocalCanvasProjectSaveInfo(id: string) {
    const queue = canvasCommitQueues.get(id);
    return {
        revision: queue?.snapshot().revision ?? canvasRevisions.get(id) ?? null,
        operationId: queue?.snapshot().operationId ?? null,
    };
}
