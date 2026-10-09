import { expect, mock, test } from "bun:test";

const historyCalls: Array<{ kind: string; id: string; patch?: Record<string, unknown> }> = [];
let historyAvailable = true;
let createCalls = 0;
let waitCalls = 0;
let saveCalls = 0;
let saveShouldFail = false;

mock.module("@/lib/works/generation-history", () => ({
    updateGenerationHistory: async (id: string, patch: Record<string, unknown>) => {
        historyCalls.push({ kind: "history", id, patch });
        return historyAvailable ? { id, taskId: patch.taskId || "" } : null;
    },
    updateGenerationTask: async (id: string, patch: Record<string, unknown>) => {
        historyCalls.push({ kind: "task", id, patch });
        return historyAvailable ? { id, task: { submission: patch.submission, phase: patch.phase } } : null;
    },
}));

mock.module("@/services/api/video", () => ({
    isVideoTaskFailed: () => false,
    storeGeneratedVideo: async () => {
        saveCalls += 1;
        if (saveShouldFail) throw new Error("save failed");
        return { blob: new Blob(["video"], { type: "video/mp4" }) };
    },
    waitForVideoGenerationTask: async () => {
        waitCalls += 1;
        return { blob: new Blob(["remote"], { type: "video/mp4" }) };
    },
}));

const { runTrackedVideoTask } = await import("../src/lib/canvas/tracked-video-task");
const { cancelQueuedGeneration, hasQueuedGeneration, useGenerationQueue } = await import("../src/lib/canvas/generation-task-queue");

Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}) } },
});

const config = { apiKey: "test", baseUrl: "https://example.test", model: "video", videoModel: "video" } as never;

function reset() {
    historyCalls.length = 0;
    historyAvailable = true;
    createCalls = 0;
    waitCalls = 0;
    saveCalls = 0;
    saveShouldFail = false;
    useGenerationQueue.getState().setPaused(false);
}

function createTask(task: { id?: string; provider?: "autodl" | "plugin" } = {}) {
    return async (onSubmitting: () => Promise<void>) => {
        await onSubmitting();
        createCalls += 1;
        return { id: task.id || "remote-1", provider: task.provider || "autodl", model: "video" };
    };
}

test("does not call remote create when the generation history update is missing", async () => {
    reset();
    historyAvailable = false;

    await expect(runTrackedVideoTask(config, {
        generationId: "missing-history",
        createTask: createTask(),
    })).rejects.toThrow("任务记录无法保存");
    expect(createCalls).toBe(0);
    expect(historyCalls[0]?.patch).toMatchObject({ status: "running", phase: "upload" });
});

test("persists the accepted remote task id before polling it", async () => {
    reset();
    const order: string[] = [];
    const result = await runTrackedVideoTask(config, {
        generationId: "accepted-history",
        createTask: async (onSubmitting) => {
            await onSubmitting();
            order.push("created");
            return { id: "remote-accepted", provider: "autodl", model: "video" };
        },
        onSaved: async () => order.push("saved"),
    });

    expect(result.task.id).toBe("remote-accepted");
    expect(waitCalls).toBe(1);
    const taskIdIndex = historyCalls.findIndex((call) => call.kind === "history" && call.patch?.taskId === "remote-accepted");
    expect(taskIdIndex).toBeGreaterThanOrEqual(0);
    expect(order).toEqual(["created", "saved"]);
    expect(saveCalls).toBe(1);
});

test("keeps an onSaved failure in the save phase instead of submission unknown", async () => {
    reset();

    await expect(runTrackedVideoTask(config, {
        generationId: "save-failed",
        createTask: createTask(),
        onSaved: async () => { throw new Error("archive failed"); },
    })).rejects.toThrow("archive failed");

    expect(historyCalls.filter((call) => call.kind === "task").at(-1)?.patch).toMatchObject({
        status: "needs_attention",
        phase: "save",
        outputState: "downloaded",
    });
    expect(historyCalls.some((call) => call.patch?.status === "succeeded")).toBe(false);
});

test("resumes an existing remote task without calling createTask", async () => {
    reset();
    const existingTask = { id: "already-remote", provider: "autodl" as const, model: "video" };
    const result = await runTrackedVideoTask(config, {
        generationId: "resume-existing",
        existingTask,
        createTask: async () => {
            createCalls += 1;
            throw new Error("must not create");
        },
    });

    expect(result.task).toEqual(existingTask);
    expect(createCalls).toBe(0);
    expect(waitCalls).toBe(1);
});

test("keeps an unknown submission unaccepted and never retries create after submission failure", async () => {
    reset();
    const failingCreate = async (onSubmitting: () => Promise<void>) => {
        await onSubmitting();
        createCalls += 1;
        throw new Error("response lost");
    };

    await expect(runTrackedVideoTask(config, {
        generationId: "unknown-submit",
        createTask: failingCreate,
    })).rejects.toThrow("response lost");

    expect(createCalls).toBe(1);
    const last = historyCalls.filter((call) => call.kind === "task").at(-1)?.patch;
    expect(last).toMatchObject({ status: "needs_attention", submission: "unknown" });
    expect(last?.submission).not.toBe("accepted");
});

test("same node rejects a second in-flight submission and calls create once", async () => {
    reset();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const create = async (onSubmitting: () => Promise<void>) => {
        createCalls += 1;
        await onSubmitting();
        await hold;
        return { id: "remote-one", provider: "autodl", model: "video" } as const;
    };
    const first = runTrackedVideoTask(config, { generationId: "dedupe-a", nodeId: "same-node", createTask: create });
    await Promise.resolve();
    const second = runTrackedVideoTask(config, { generationId: "dedupe-b", nodeId: "same-node", createTask: create });
    await expect(second).rejects.toThrow("已有任务执行中");
    release();
    await expect(first).resolves.toBeTruthy();
    expect(createCalls).toBe(1);
});

test("paused queue holds submission before create and resumes exactly once", async () => {
    reset();
    useGenerationQueue.getState().setPaused(true);
    const run = runTrackedVideoTask(config, {
        generationId: "queued-generation",
        createTask: createTask(),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(createCalls).toBe(0);
    expect(hasQueuedGeneration("queued-generation")).toBe(true);
    expect(historyCalls.some((call) => call.patch?.status === "queued")).toBe(true);

    useGenerationQueue.getState().setPaused(false);
    await expect(run).resolves.toBeTruthy();
    expect(createCalls).toBe(1);
});

test("canceling a paused queue entry never calls create and records not_sent cancellation", async () => {
    reset();
    useGenerationQueue.getState().setPaused(true);
    const run = runTrackedVideoTask(config, {
        generationId: "cancel-queued",
        createTask: createTask(),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(hasQueuedGeneration("cancel-queued")).toBe(true);

    cancelQueuedGeneration("cancel-queued");
    await expect(run).rejects.toThrow();
    expect(createCalls).toBe(0);
    const last = historyCalls.filter((call) => call.kind === "task").at(-1)?.patch;
    expect(last).toMatchObject({ status: "cancelled", submission: "not_sent" });
});

test("navigator lock denial prevents create", async () => {
    reset();
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { locks: { request: async (_name: string, _options: unknown, callback: (lock: null) => Promise<unknown>) => callback(null) } },
    });

    await expect(runTrackedVideoTask(config, {
        generationId: "lock-denied",
        nodeId: "lock-node",
        createTask: createTask(),
    })).rejects.toThrow("其他页面");
    expect(createCalls).toBe(0);

    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}) } },
    });
});
