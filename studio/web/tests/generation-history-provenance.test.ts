import { afterEach, expect, mock, test } from "bun:test";

Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => undefined } });

const stores = new Map<string, Map<string, unknown>>();
const copy = <T>(value: T): T => structuredClone(value);

mock.module("localforage", () => ({
    default: {
        createInstance: ({ storeName }: { storeName: string }) => {
            const records = stores.get(storeName) || new Map<string, unknown>();
            stores.set(storeName, records);
            return {
                async setItem(key: string, value: unknown) {
                    records.set(key, copy(value));
                    return value;
                },
                async getItem(key: string) {
                    const value = records.get(key);
                    return value === undefined ? null : copy(value);
                },
                async removeItem(key: string) {
                    records.delete(key);
                },
                async iterate(iterator: (value: unknown, key: string, index: number) => unknown) {
                    let index = 0;
                    for (const [key, value] of records) iterator(copy(value), key, index++);
                },
            };
        },
    },
}));

const {
    getGenerationHistory,
    sanitizeGenerationParameters,
    startGenerationHistory,
    subscribeGenerationHistory,
    updateGenerationHistory,
} = await import("../src/lib/works/generation-history");

afterEach(() => {
    stores.forEach((store) => store.clear());
});

test("history stores separate retry IDs and parent links and notifies started, failed, and canceled states", async () => {
    const events: Array<{ type: string; id: string; status: string }> = [];
    const unsubscribe = subscribeGenerationHistory(({ type, entry }) => events.push({ type, id: entry.id, status: entry.status }));

    const first = await startGenerationHistory({
        id: "attempt-first",
        nodeId: "node-1",
        workId: "",
        inputSnapshot: { prompt: "first", apiKey: "must-not-persist" },
        modelChannel: "model-a",
        parameters: { storageKey: "local-key", nested: { access_token: "must-not-persist" } },
    });
    const retry = await startGenerationHistory({
        id: "attempt-retry",
        parentGenerationId: first.id,
        nodeId: "node-1",
        workId: "",
        inputSnapshot: { prompt: "retry", parentGenerationId: first.id },
        modelChannel: "model-a",
    });

    await updateGenerationHistory(first.id, { status: "failed", errorReason: "synthetic failure" });
    await updateGenerationHistory(retry.id, { status: "canceled" });

    expect(retry.id).not.toBe(first.id);
    expect(retry.parentGenerationId).toBe(first.id);
    expect(await getGenerationHistory(first.id)).toMatchObject({ status: "failed", errorReason: "synthetic failure" });
    expect(await getGenerationHistory(retry.id)).toMatchObject({ id: "attempt-retry", parentGenerationId: "attempt-first", status: "canceled" });
    expect(JSON.stringify(await getGenerationHistory(first.id))).not.toContain("must-not-persist");
    expect(events).toEqual([
        { type: "started", id: "attempt-first", status: "running" },
        { type: "started", id: "attempt-retry", status: "running" },
        { type: "updated", id: "attempt-first", status: "failed" },
        { type: "updated", id: "attempt-retry", status: "canceled" },
    ]);

    unsubscribe();
    await updateGenerationHistory(retry.id, { status: "succeeded" });
    expect(events).toHaveLength(4);
});

test("generation parameters recursively remove credentials but retain stable storage keys", () => {
    const parameters = {
        apiKey: "secret-key",
        storageKey: "local-storage-key",
        sourceKey: "stable-source-key",
        nested: { client_secret: "nested-secret", model: "safe-model" },
        items: [{ authorization: "Bearer secret-token", value: "safe-value" }],
    };
    const sanitized = sanitizeGenerationParameters(parameters);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("secret-key");
    expect(serialized).not.toContain("nested-secret");
    expect(serialized).not.toContain("secret-token");
    expect(sanitized.storageKey).toBe("local-storage-key");
    expect(sanitized.sourceKey).toBe("stable-source-key");
});
