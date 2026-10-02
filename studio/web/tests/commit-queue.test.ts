import { expect, test } from "bun:test";

import { CommitQueue } from "../src/lib/local-workspace/commit-queue";
import { shouldPersistCanvasState } from "../src/lib/local-workspace/persisted-state";
import { LocalWorkspaceError, type WriteResult } from "../src/lib/local-workspace/types";

type RecordData = { id: string; value: string };

test("does not persist the exact state returned by hydration", () => {
    const hydrated = { projects: [{ id: "record", value: "canonical" }], deletedProjects: [] };

    expect(shouldPersistCanvasState(hydrated, hydrated)).toBe(false);
    expect(shouldPersistCanvasState(hydrated, { projects: [...hydrated.projects], deletedProjects: [] })).toBe(true);
});

test("preserves edit B after ack A and returns B's own receipt", async () => {
    let finishFirst!: (result: WriteResult<RecordData>) => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const first = new Promise<WriteResult<RecordData>>((resolve) => { finishFirst = resolve; });
    const calls: Array<{ data: RecordData; revision: number | null; operationId: string }> = [];
    const queue = new CommitQueue("workspace", "record", null, (data, revision, operationId) => {
        calls.push({ data, revision, operationId });
        if (calls.length === 1) {
            firstStarted();
            return first;
        }
        return Promise.resolve(writeResult(data, 2, operationId));
    });

    queue.enqueue({ id: "record", value: "A" }, "op-a");
    const saveA = queue.flush("op-a");
    await started;
    finishFirst(writeResult({ id: "record", value: "A" }, 1, "op-a"));
    await Promise.resolve();
    queue.enqueue({ id: "record", value: "B" }, "op-b");
    const saveB = queue.flush("op-b");

    const [resultA, resultB] = await Promise.all([saveA, saveB]);
    expect(resultA.operationId).toBe("op-a");
    expect(resultB.operationId).toBe("op-b");
    expect(resultB.data.value).toBe("B");
    expect(calls.map((call) => [call.data.value, call.revision, call.operationId])).toEqual([
        ["A", null, "op-a"],
        ["B", 1, "op-b"],
    ]);
    expect(queue.snapshot()).toMatchObject({ phase: "saved", revision: 2, draft: null });
});

test("replaying a completed operation returns its original receipt without another write", async () => {
    let writes = 0;
    const queue = new CommitQueue("workspace", "record", null, async (data, _revision, operationId) => {
        writes += 1;
        return writeResult(data, 1, operationId);
    });
    const data = { id: "record", value: "A" };

    queue.enqueue(data, "same-operation");
    const original = await queue.flush("same-operation");
    queue.enqueue(data, "same-operation");
    const replay = await queue.flush("same-operation");

    expect(replay).toBe(original);
    expect(writes).toBe(1);
});

test("keeps the draft on conflict and retries the same operation after rebase", async () => {
    const calls: Array<{ revision: number | null; operationId: string }> = [];
    const queue = new CommitQueue("workspace", "record", 1, async (data, revision, operationId) => {
        calls.push({ revision, operationId });
        if (calls.length === 1) throw new LocalWorkspaceError("stale revision", "conflict");
        return writeResult(data, 3, operationId);
    });
    queue.enqueue({ id: "record", value: "draft" }, "retry-operation");

    await expect(queue.flush("retry-operation")).rejects.toThrow("stale revision");
    expect(queue.snapshot()).toMatchObject({ phase: "conflict", draft: { id: "record", value: "draft" } });
    queue.rebase(2, "workspace", "record");
    const result = await queue.flush("retry-operation");

    expect(result).toMatchObject({ revision: 3, operationId: "retry-operation", data: { value: "draft" } });
    expect(calls).toEqual([
        { revision: 1, operationId: "retry-operation" },
        { revision: 2, operationId: "retry-operation" },
    ]);
});

test("keeps offline edits in the queue without reporting a save", async () => {
    const queue = new CommitQueue("workspace", "record", null, async () => {
        throw new LocalWorkspaceError("offline", "unavailable");
    });
    queue.enqueue({ id: "record", value: "draft" }, "offline-operation");

    await expect(queue.flush("offline-operation")).rejects.toThrow("offline");
    expect(queue.snapshot()).toMatchObject({ phase: "error", revision: null, operationId: "offline-operation", draft: { value: "draft" } });
});

function writeResult(data: RecordData, revision: number, operationId: string): WriteResult<RecordData> {
    return { workspaceId: "workspace", id: data.id, revision, data, operationId };
}
