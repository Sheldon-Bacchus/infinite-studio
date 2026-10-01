import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { deleteLocalCanvasProjects, importLocalCanvasProjects, listLocalCanvasProjects, syncLocalCanvasProjects } from "@/services/api/local-workspace";
import { listCanvasProjects, syncCanvasProjects } from "@/services/api/canvas-tasks";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAgentConfig, CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasPendingAgentRequest, ViewportTransform } from "../types";
import {
    buildLocalCanvasDeleteExpectations,
    buildLocalCanvasSyncPayload,
    createLocalCanvasRecoveryProject,
    includeLocalCanvasConflictDraftProjects,
    listLocalCanvasConflictDrafts,
    removeLocalCanvasConflictDraft,
    saveLocalCanvasConflictDrafts,
    shouldRefreshSharedCanvasProjects,
    type LocalCanvasConflictDraft,
} from "../utils/local-canvas-sync";

export type CanvasSidePanelState = {
    open: boolean;
    width: number;
};

export const DEFAULT_CANVAS_SIDE_PANEL: CanvasSidePanelState = { open: true, width: 280 };
export const DEFAULT_CANVAS_AGENT_PANEL: CanvasSidePanelState = { open: false, width: 464 };

export type CanvasProject = {
    id: string;
    /** 导入源的稳定键；重复导入同一压缩包时用于幂等替换。 */
    importKey?: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    agentConfig: CanvasAgentConfig | null;
    autoTitlePending: boolean;
    pendingAgentRequest?: CanvasPendingAgentRequest;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    sidePanel: CanvasSidePanelState;
    agentPanel: CanvasSidePanelState;
};

type CanvasStore = {
    hydrated: boolean;
    localWorkspaceError: string | null;
    conflictDrafts: LocalCanvasConflictDraft<CanvasProject>[];
    projects: CanvasProject[];
    createProject: (title?: string, options?: { agentConfig?: CanvasAgentConfig; pendingAgentRequest?: CanvasPendingAgentRequest }) => string;
    importProject: (project: Partial<CanvasProject>) => Promise<string>;
    importProjects: (projects: CanvasProject[]) => Promise<void>;
    refreshFromLocalWorkspace: () => Promise<CanvasProject[]>;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => Promise<void>;
    updateProject: (
        id: string,
        patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "agentConfig" | "autoTitlePending" | "backgroundMode" | "showImageInfo" | "viewport" | "sidePanel" | "agentPanel" | "pendingAgentRequest">>,
    ) => void;
    /** 更新画布并等待当前本地工作区保存请求完成。 */
    saveProjectAndWait: (
        id: string,
        patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "agentConfig" | "autoTitlePending" | "backgroundMode" | "showImageInfo" | "viewport" | "sidePanel" | "agentPanel" | "pendingAgentRequest">>,
    ) => Promise<void>;
    restoreConflictDraftAsNewProject: (draftId: string) => Promise<string>;
    /** 保留旧调用点，但现在只刷新同一个本地后端，不再同步账号远端。 */
    syncWithRemote: (_token: string, _syncEnabled: boolean) => Promise<void>;
    setSyncEnabled: (_enabled: boolean) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let localSyncTimer: ReturnType<typeof setTimeout> | null = null;
let lastPersistedProjects: CanvasProject[] | null = null;
let lastSerializedProjects: CanvasProject[] | null = null;
let projectSyncRevision = 0;
let projectSyncPending = false;
let projectRefreshBound = false;
let projectSyncBlocked = false;
let projectSyncQueue: Promise<unknown> = Promise.resolve();
let activeCanvasProjectId: string | null = null;
let activeAccountCanvasToken = "";
let accountCanvasSyncEnabled = false;
let accountCanvasSyncTimer: ReturnType<typeof setTimeout> | null = null;

function queueAccountCanvasSync(projects: CanvasProject[]) {
    const token = activeAccountCanvasToken;
    if (!token || !accountCanvasSyncEnabled) return;
    if (accountCanvasSyncTimer) clearTimeout(accountCanvasSyncTimer);
    accountCanvasSyncTimer = setTimeout(() => {
        accountCanvasSyncTimer = null;
        if (activeAccountCanvasToken !== token || !accountCanvasSyncEnabled) return;
        void syncCanvasProjects(token, projects).catch((error) => {
            console.error("Failed to mirror local canvas projects to the account", error);
        });
    }, 600);
}

export function setActiveCanvasProjectId(id: string | null) {
    activeCanvasProjectId = id?.trim() || null;
}

export function canvasProjectsForAssetRetention() {
    const state = useCanvasStore.getState();
    return includeLocalCanvasConflictDraftProjects(state.projects, state.conflictDrafts);
}

function currentCanvasProjectId() {
    if (activeCanvasProjectId) return activeCanvasProjectId;
    if (typeof window === "undefined") return null;
    const segments = window.location.pathname.split("/").filter(Boolean);
    if (segments.length !== 2 || segments[0] !== "canvas") return null;
    try {
        return decodeURIComponent(segments[1]);
    } catch {
        return segments[1];
    }
}

function isCanvasProjectConflict(error: unknown) {
    return error instanceof Error && error.message.includes("其他页面修改");
}

async function loadLocalCanvasConflictDrafts() {
    if (typeof window === "undefined") return [] as LocalCanvasConflictDraft<CanvasProject>[];
    return listLocalCanvasConflictDrafts<CanvasProject>();
}

async function captureLocalCanvasConflictDrafts(projects: CanvasProject[]) {
    if (typeof window === "undefined") return [] as LocalCanvasConflictDraft<CanvasProject>[];
    await saveLocalCanvasConflictDrafts(projects, lastPersistedProjects);
    return listLocalCanvasConflictDrafts<CanvasProject>();
}

async function conflictErrorMessage(error: unknown, projects?: CanvasProject[]) {
    const message = error instanceof Error ? error.message : "本地画布保存失败";
    if (!isCanvasProjectConflict(error) || !projects) return message;
    try {
        useCanvasStore.setState({ conflictDrafts: await captureLocalCanvasConflictDrafts(projects) });
        return message;
    } catch (draftError) {
        const reason = draftError instanceof Error ? draftError.message : "浏览器本地存储不可用";
        return `${message}；自动恢复副本保存失败（${reason}），请保持当前页面并立即导出未保存画布`;
    }
}

function persistLocalProjectSnapshot(projects: CanvasProject[]) {
    const operation = projectSyncQueue.then(async () => {
        if (projectSyncBlocked) {
            throw new Error("画布已在其他页面修改，保存已暂停；当前页编辑已保留为恢复副本");
        }

        let canonical = lastPersistedProjects;
        if (canonical === null) {
            canonical = await listLocalCanvasProjects();
            lastPersistedProjects = canonical;
        }
        const payload = buildLocalCanvasSyncPayload(projects, canonical);
        if (payload.projects.length === 0) return canonical;

        const saved = await syncLocalCanvasProjects(payload.projects, payload.expectedProjects);
        lastPersistedProjects = saved;
        return saved;
    });
    projectSyncQueue = operation.then(
        () => undefined,
        () => undefined,
    );
    return operation;
}

function queueLocalProjectSync(projects: CanvasProject[]) {
    projectSyncRevision += 1;
    const revision = projectSyncRevision;
    projectSyncPending = true;
    if (localSyncTimer) clearTimeout(localSyncTimer);
    localSyncTimer = setTimeout(() => {
        localSyncTimer = null;
        void persistLocalProjectSnapshot(projects)
            .then((saved) => {
                if (revision !== projectSyncRevision) return;
                projectSyncPending = false;
                queueAccountCanvasSync(saved);
                if (useCanvasStore.getState().localWorkspaceError) {
                    useCanvasStore.setState({ localWorkspaceError: null });
                }
            })
            .catch(async (error) => {
                if (revision !== projectSyncRevision) return;
                projectSyncPending = false;
                if (isCanvasProjectConflict(error)) projectSyncBlocked = true;
                useCanvasStore.setState({
                    localWorkspaceError: await conflictErrorMessage(error, projects),
                });
                console.error("Failed to persist local canvas projects; unsaved changes remain in the current page", error);
            });
    }, 250);
}

async function refreshSharedCanvasProjects() {
    if (typeof window === "undefined" || !shouldRefreshSharedCanvasProjects(currentCanvasProjectId()) || projectSyncPending || localSyncTimer || projectSyncBlocked) return;
    const revision = projectSyncRevision;
    try {
        const canonical = await listLocalCanvasProjects();
        if (revision !== projectSyncRevision || projectSyncPending || localSyncTimer) return;
        const current = useCanvasStore.getState().projects;
        if (JSON.stringify(current) !== JSON.stringify(canonical)) {
            lastPersistedProjects = canonical;
            lastSerializedProjects = canonical;
            useCanvasStore.setState({ projects: canonical, localWorkspaceError: null });
        }
    } catch (error) {
        useCanvasStore.setState({ localWorkspaceError: error instanceof Error ? error.message : "本地画布同步失败" });
    }
}

function startSharedCanvasRefresh() {
    if (typeof window === "undefined" || projectRefreshBound) return;
    projectRefreshBound = true;
    const refreshWhenVisible = () => {
        if (document.visibilityState === "visible") void refreshSharedCanvasProjects();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.setInterval(refreshWhenVisible, 3000);
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        void name;
        let projects = await listLocalCanvasProjects();
        if (typeof window !== "undefined") {
            const migrationKey = `${CANVAS_STORE_KEY}:local-workspace-migration:v1`;
            if ((await localForageStorage.getItem(migrationKey)) !== "done") {
                if (projects.length) {
                    await localForageStorage.setItem(migrationKey, "done");
                } else {
                const legacyValue = await localForageStorage.getItem(CANVAS_STORE_KEY);
                let legacyProjects: CanvasProject[] = [];
                try {
                    const parsed = legacyValue ? JSON.parse(legacyValue) as { state?: { projects?: unknown } } : null;
                    if (Array.isArray(parsed?.state?.projects)) legacyProjects = parsed.state.projects as CanvasProject[];
                } catch { /* Preserve malformed legacy data and load an empty canonical workspace. */ }
                if (legacyProjects.length) await importLocalCanvasProjects(legacyProjects);
                await localForageStorage.setItem(migrationKey, "done");
                projects = await listLocalCanvasProjects();
                }
            }
        }
        lastPersistedProjects = projects;
        lastSerializedProjects = projects;
        return {
            state: { projects, conflictDrafts: await loadLocalCanvasConflictDrafts() },
            version: 0,
        } as StorageValue<CanvasStore>;
    },
    setItem: (name, value) => {
        void name;
        const nextState = value.state as PersistedCanvasState;
        if (lastSerializedProjects === nextState.projects) return;
        lastSerializedProjects = nextState.projects;
        queueLocalProjectSync(nextState.projects);
    },
    removeItem: async () => undefined,
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            localWorkspaceError: null,
            conflictDrafts: [],
            projects: [],
            createProject: (title = "未命名画布", options) => {
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
                    agentConfig: options?.agentConfig || null,
                    autoTitlePending: true,
                    pendingAgentRequest: options?.pendingAgentRequest,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                    sidePanel: DEFAULT_CANVAS_SIDE_PANEL,
                    agentPanel: options?.pendingAgentRequest ? { ...DEFAULT_CANVAS_AGENT_PANEL, open: true } : DEFAULT_CANVAS_AGENT_PANEL,
                };
                set((state) => ({
                    projects: [project, ...state.projects],
                }));
                return id;
            },
            importProject: async (source) => {
                const now = new Date().toISOString();
                const importKey = source.importKey || source.id;
                const existing = importKey ? get().projects.find((item) => item.importKey === importKey || item.id === source.id) : undefined;
                const project: CanvasProject = {
                    id: existing?.id || source.id || nanoid(),
                    importKey,
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: (source.chatSessions || []).map((session) => ({ ...session, codexThreadId: undefined, codexServiceId: undefined })),
                    activeChatId: source.activeChatId || null,
                    agentConfig: source.agentConfig || null,
                    autoTitlePending: false,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                    sidePanel: source.sidePanel || DEFAULT_CANVAS_SIDE_PANEL,
                    agentPanel: source.agentPanel || DEFAULT_CANVAS_AGENT_PANEL,
                };
                await get().importProjects([project]);
                return project.id;
            },
            importProjects: async (projects) => {
                await importLocalCanvasProjects(projects);
                const canonicalProjects = await listLocalCanvasProjects();
                lastPersistedProjects = canonicalProjects;
                lastSerializedProjects = canonicalProjects;
                set({ projects: canonicalProjects, localWorkspaceError: null });
                queueAccountCanvasSync(canonicalProjects);
            },
            refreshFromLocalWorkspace: async () => {
                if (projectSyncPending || localSyncTimer) throw new Error("当前画布有更改正在保存，请完成保存后再刷新");
                if (!shouldRefreshSharedCanvasProjects(currentCanvasProjectId())) return get().projects;
                const canonicalProjects = await listLocalCanvasProjects();
                if (projectSyncPending || localSyncTimer) throw new Error("画布在刷新期间发生更改，请稍后重试");
                lastPersistedProjects = canonicalProjects;
                lastSerializedProjects = canonicalProjects;
                projectSyncBlocked = false;
                set({ projects: canonicalProjects, localWorkspaceError: null });
                return canonicalProjects;
            },
            openProject: (id) => get().projects.find((item) => item.id === id) || null,
            renameProject: (id, title) => {
                const project = get().projects.find((item) => item.id === id);
                if (!project) return;
                const nextProject = {
                    ...project,
                    title: title.trim() || project.title,
                    autoTitlePending: false,
                    updatedAt: new Date().toISOString(),
                };
                set((state) => ({
                    projects: state.projects.map((item) => (item.id === id ? nextProject : item)),
                }));
            },
            deleteProjects: async (ids) => {
                const projectIds = Array.from(new Set(ids.filter(Boolean)));
                if (projectIds.length === 0) return;
                try {
                    const canonical = lastPersistedProjects ?? (await listLocalCanvasProjects());
                    const expectedProjects = buildLocalCanvasDeleteExpectations(projectIds, canonical);
                    await deleteLocalCanvasProjects(projectIds, expectedProjects);
                    const refreshed = await listLocalCanvasProjects();
                    lastPersistedProjects = refreshed;
                    lastSerializedProjects = refreshed;
                    set({ projects: refreshed, localWorkspaceError: null });
                } catch (error) {
                    if (isCanvasProjectConflict(error)) projectSyncBlocked = true;
                    useCanvasStore.setState({
                        localWorkspaceError: await conflictErrorMessage(error, useCanvasStore.getState().projects),
                    });
                    throw error;
                }
            },
            updateProject: (id, patch) => {
                const project = get().projects.find((item) => item.id === id);
                if (!project) return;
                const nextProject = {
                    ...project,
                    ...patch,
                    updatedAt: new Date().toISOString(),
                };
                set((state) => ({
                    projects: state.projects.map((item) => (item.id === id ? nextProject : item)),
                }));
            },
            saveProjectAndWait: async (id, patch) => {
                if (!get().projects.some((item) => item.id === id)) {
                    throw new Error("目标画布已不存在，请刷新后重试");
                }

                get().updateProject(id, patch);
                const snapshot = get().projects;
                if (localSyncTimer) clearTimeout(localSyncTimer);
                localSyncTimer = null;
                projectSyncRevision += 1;
                const revision = projectSyncRevision;
                projectSyncPending = true;

                try {
                    await persistLocalProjectSnapshot(snapshot);
                    if (revision === projectSyncRevision && get().projects === snapshot) {
                        projectSyncPending = false;
                        queueAccountCanvasSync(lastPersistedProjects || snapshot);
                        set({ localWorkspaceError: null });
                    }
                } catch (error) {
                    if (revision === projectSyncRevision) {
                        projectSyncPending = false;
                        if (isCanvasProjectConflict(error)) projectSyncBlocked = true;
                        set({ localWorkspaceError: await conflictErrorMessage(error, snapshot) });
                    }
                    throw error;
                }
            },
            restoreConflictDraftAsNewProject: async (draftId) => {
                const draft = get().conflictDrafts.find((item) => item.draftId === draftId);
                if (!draft) throw new Error("未找到可恢复的画布副本，请刷新画布列表后重试");

                const now = new Date().toISOString();
                const recovered = createLocalCanvasRecoveryProject(draft.project, nanoid(), now);
                const recoveredProject: CanvasProject = {
                    ...recovered,
                    chatSessions: recovered.chatSessions.map((session) => ({ ...session, codexThreadId: undefined, codexServiceId: undefined })),
                };

                try {
                    const canonicalProjects = await syncLocalCanvasProjects([recoveredProject], { [recoveredProject.id]: null });
                    lastPersistedProjects = canonicalProjects;
                    lastSerializedProjects = canonicalProjects;
                    projectSyncBlocked = false;
                    set({ projects: canonicalProjects, localWorkspaceError: null });
                    await removeLocalCanvasConflictDraft(draft.project.id, draft.draftId).catch(() => undefined);
                    set({ conflictDrafts: await loadLocalCanvasConflictDrafts() });
                    return recoveredProject.id;
                } catch (error) {
                    set({ localWorkspaceError: error instanceof Error ? error.message : "恢复画布副本失败" });
                    throw error;
                }
            },
            syncWithRemote: async (token, syncEnabled) => {
                accountCanvasSyncEnabled = syncEnabled;
                activeAccountCanvasToken = syncEnabled ? token : "";
                if (!shouldRefreshSharedCanvasProjects(currentCanvasProjectId())) return;
                let projects = await listLocalCanvasProjects();
                if (syncEnabled && token) {
                    const remoteProjects = await listCanvasProjects(token);
                    for (const remote of remoteProjects) {
                        const current = projects.find((project) => project.id === remote.id);
                        if (!current) {
                            try {
                                projects = await syncLocalCanvasProjects([remote], { [remote.id]: null });
                            } catch (error) {
                                if (!isCanvasProjectConflict(error)) throw error;
                            }
                            continue;
                        }
                        if (Date.parse(remote.updatedAt || "") > Date.parse(current.updatedAt || "")) {
                            try {
                                projects = await syncLocalCanvasProjects([remote], { [remote.id]: current });
                            } catch (error) {
                                if (!isCanvasProjectConflict(error)) throw error;
                            }
                        }
                    }
                    projects = await listLocalCanvasProjects();
                    queueAccountCanvasSync(projects);
                }
                lastPersistedProjects = projects;
                lastSerializedProjects = projects;
                set({ projects, localWorkspaceError: null });
            },
            setSyncEnabled: (enabled) => {
                accountCanvasSyncEnabled = enabled;
                activeAccountCanvasToken = enabled ? useUserStore.getState().token : "";
                if (!enabled && accountCanvasSyncTimer) {
                    clearTimeout(accountCanvasSyncTimer);
                    accountCanvasSyncTimer = null;
                }
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                useCanvasStore.setState({
                    hydrated: true,
                    localWorkspaceError: error ? "本地画布后端不可用，请先启动统一本地服务" : null,
                });
                if (!error) startSharedCanvasRefresh();
            },
        },
    ),
);

export function mergeCanvasProjects(remoteProjects: CanvasProject[], localProjects: CanvasProject[]): CanvasProject[] {
    const projects = new Map<string, CanvasProject>();
    [...localProjects, ...remoteProjects].forEach((project) => {
        const previous = projects.get(project.id);
        if (!previous || Date.parse(project.updatedAt || "") >= Date.parse(previous.updatedAt || "")) {
            projects.set(project.id, project);
        }
    });
    return Array.from(projects.values()).sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
}
