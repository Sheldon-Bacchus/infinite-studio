import { create } from "zustand";
import { updateGenerationTask } from "@/lib/works/generation-history";

const preference = "infinite-studio:queue-paused";
const waiting = new Map<string, { resume: () => void; cancel: () => void }>();
export const useGenerationQueue = create<{ paused: boolean; setPaused: (paused: boolean) => void }>((set) => ({
    paused: typeof localStorage !== "undefined" && localStorage.getItem(preference) === "true",
    setPaused: (paused) => {
        if (typeof localStorage !== "undefined") localStorage.setItem(preference, String(paused));
        set({ paused });
        if (!paused) for (const item of waiting.values()) item.resume();
    },
}));
if (typeof window !== "undefined") window.addEventListener("storage", (event) => {
    if (event.key !== preference) return;
    const paused = event.newValue === "true";
    useGenerationQueue.setState({ paused });
    if (!paused) for (const item of waiting.values()) item.resume();
});

/** 保留既有并行规则，只在用户主动暂停时拦住尚未开始的提交。 */
export async function waitForGenerationQueue(id: string, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!useGenerationQueue.getState().paused) return;
    const entry = await updateGenerationTask(id, { status: "queued", phase: "validation", submission: "not_sent" }, "本地队列已暂停，尚未提交");
    if (!entry) throw new Error("排队记录保存失败");
    if (!useGenerationQueue.getState().paused) return;
    await new Promise<void>((resolve, reject) => {
        const cleanup = () => { waiting.delete(id); signal?.removeEventListener("abort", cancel); };
        const cancel = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
        const resume = () => { cleanup(); resolve(); };
        waiting.set(id, { resume, cancel });
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
    });
}
export function hasQueuedGeneration(id: string) { return waiting.has(id); }
export function cancelQueuedGeneration(id: string) { waiting.get(id)?.cancel(); }
