// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { createSerializedAssetSnapshotWriter } from "./local-asset-snapshot-writer";

describe("local asset snapshot writer", () => {
    test("serializes full snapshot saves so older requests cannot finish after newer ones", async () => {
        const started: number[][] = [];
        let releaseFirst: ((result: number[]) => void) | undefined;
        const write = createSerializedAssetSnapshotWriter((snapshot: number[]) => new Promise<number[]>((resolve) => {
            started.push(snapshot);
            if (started.length === 1) releaseFirst = resolve;
            else resolve(snapshot);
        }));
        const first = write([1]);
        const second = write([2]);

        await Promise.resolve();
        await Promise.resolve();
        expect(started).toEqual([[1]]);
        releaseFirst?.([1]);
        await expect(first).resolves.toEqual([1]);
        await expect(second).resolves.toEqual([2]);
        expect(started).toEqual([[1], [2]]);
    });

    test("continues serializing after a failed save", async () => {
        let calls = 0;
        const write = createSerializedAssetSnapshotWriter(async (snapshot: number[]) => {
            calls += 1;
            if (calls === 1) throw new Error("temporary failure");
            return snapshot;
        });

        await expect(write([1])).rejects.toThrow("temporary failure");
        await expect(write([2])).resolves.toEqual([2]);
        expect(calls).toBe(2);
    });
});
