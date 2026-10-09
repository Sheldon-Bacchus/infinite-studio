export type GenerationTaskPhase = "validation" | "upload" | "submission" | "remote_queue" | "generation" | "download" | "save";
export interface GenerationTaskState {
    status: "checking" | "blocked" | "queued" | "running" | "needs_attention" | "succeeded" | "failed" | "cancelled";
    phase: GenerationTaskPhase;
    submission: "not_sent" | "in_flight" | "accepted" | "unknown" | "rejected";
    connection: "available" | "interrupted" | "unknown";
    outputState: "none" | "remote_available" | "downloaded" | "archived" | "save_failed";
    provider?: "openai" | "gemini" | "autodl" | "plugin";
    model?: string;
    resultNodeId?: string;
    reasonCode?: string;
    events: { id: string; sequence: number; at: string; phase: GenerationTaskPhase; message: string; reasonCode?: string }[];
}

export function initialGenerationTask(patch: Partial<GenerationTaskState> = {}, at = new Date().toISOString()): GenerationTaskState {
    return { status: "checking", phase: "validation", submission: "not_sent", connection: "available", outputState: "none", ...patch,
        events: [{ id: "created", sequence: 1, at, phase: "validation", message: "创建生成尝试；尚未发送请求" }, ...(patch.events || [])] };
}

export function reduceGenerationTask(task: GenerationTaskState, patch: Partial<Omit<GenerationTaskState, "events">>, message: string, reasonCode?: string, eventId = crypto.randomUUID(), at = new Date().toISOString()): GenerationTaskState {
    if (task.events.some((event) => event.id === eventId)) return task;
    // 已确认终态不接受晚到的进度更新；恢复下载允许 needs_attention -> running。
    if (["succeeded", "failed", "cancelled", "blocked"].includes(task.status) && patch.status !== task.status) return task;
    const safePatch = { ...patch };
    if (task.submission === "accepted" && safePatch.submission && safePatch.submission !== "accepted") delete safePatch.submission;
    const next = { ...task, ...safePatch, reasonCode: reasonCode ?? patch.reasonCode ?? task.reasonCode };
    return { ...next, events: [...task.events, { id: eventId, sequence: (task.events.at(-1)?.sequence || 0) + 1, at, phase: next.phase, message, reasonCode }] };
}
