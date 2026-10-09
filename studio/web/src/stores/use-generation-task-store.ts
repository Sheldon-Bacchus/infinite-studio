import { create } from "zustand";
import { listGenerationHistories, subscribeGenerationHistory, type GenerationHistoryEntry, type GenerationTaskState } from "@/lib/works/generation-history";

type TaskStore = {
    entries: GenerationHistoryEntry[];
    loading: boolean;
    error: string;
    refreshedAt?: string;
    refresh: () => Promise<void>;
    start: () => () => void;
};

let unsubscribe: (() => void) | undefined;
let broadcast: BroadcastChannel | undefined;
let startUsers = 0;

export const useGenerationTaskStore = create<TaskStore>((set, get) => ({
    entries: [],
    loading: false,
    error: "",
    refreshedAt: undefined,
    refresh: async () => {
        set({ loading: true, error: "" });
        try {
            const entries = await listGenerationHistories();
            const current = get().entries;
            const byId = new Map(entries.map((entry) => [entry.id, entry]));
            current.forEach((entry) => {
                const disk = byId.get(entry.id);
                if (!disk || Date.parse(entry.updatedAt) > Date.parse(disk.updatedAt)) byId.set(entry.id, entry);
            });
            set({ entries: Array.from(byId.values()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), loading: false, refreshedAt: new Date().toISOString() });
        } catch (error) {
            set({ loading: false, error: error instanceof Error ? error.message : "任务历史读取失败" });
        }
    },
    start: () => {
        startUsers += 1;
        if (unsubscribe)
            return () => {
                startUsers -= 1;
                if (!startUsers) {
                    unsubscribe?.();
                    unsubscribe = undefined;
                    broadcast?.close();
                    broadcast = undefined;
                }
            };
        const merge = (entry: GenerationHistoryEntry) => {
            const current = get().entries;
            const index = current.findIndex((item) => item.id === entry.id);
            if (index >= 0 && Date.parse(current[index].updatedAt) > Date.parse(entry.updatedAt)) return;
            const entries = index < 0 ? [entry, ...current] : current.map((item, itemIndex) => (itemIndex === index ? entry : item));
            set({ entries: entries.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) });
        };
        unsubscribe = subscribeGenerationHistory(({ entry }) => merge(entry));
        if (typeof BroadcastChannel !== "undefined") {
            broadcast = new BroadcastChannel("infinite-studio:generation-history");
            broadcast.onmessage = (event) => {
                if (event.data?.type === "changed") void get().refresh();
            };
        }
        void get().refresh();
        return () => {
            startUsers -= 1;
            if (!startUsers) {
                unsubscribe?.();
                unsubscribe = undefined;
                broadcast?.close();
                broadcast = undefined;
            }
        };
    },
}));

export type { GenerationHistoryEntry, GenerationTaskState };
