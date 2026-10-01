import { create } from "zustand";

import { loadLocalWorkspace } from "@/services/api/local-workspace";
import { LocalWorkspaceError, type SavePhase, type WorkspaceInfo } from "@/lib/local-workspace/types";

export type LocalWorkspaceConnection = "idle" | "loading" | "ready" | "unavailable" | "error";

type RecordSaveState = { phase: SavePhase; revision: number | null; message?: string };

type LocalWorkspaceStore = {
    connection: LocalWorkspaceConnection;
    workspace: WorkspaceInfo | null;
    message: string | null;
    saves: Record<string, RecordSaveState>;
    connect: () => Promise<WorkspaceInfo>;
    setSaveState: (key: string, state: RecordSaveState) => void;
    clear: () => void;
};

export const useLocalWorkspaceStore = create<LocalWorkspaceStore>((set) => ({
    connection: "idle",
    workspace: null,
    message: null,
    saves: {},
    connect: async () => {
        set({ connection: "loading", message: null });
        try {
            const workspace = await loadLocalWorkspace();
            set({ connection: "ready", workspace, message: null });
            return workspace;
        } catch (error) {
            const failure = error instanceof LocalWorkspaceError ? error : new LocalWorkspaceError("连接本地工作区失败", "server");
            set({ connection: failure.phase === "unavailable" ? "unavailable" : "error", message: failure.message });
            throw failure;
        }
    },
    setSaveState: (key, state) => set((current) => ({ saves: { ...current.saves, [key]: state } })),
    clear: () => set({ connection: "idle", workspace: null, message: null, saves: {} }),
}));
