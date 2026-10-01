// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { Asset } from "@/stores/use-asset-store";
import { mergeAssetSnapshots, parseLegacyAssetSnapshot } from "./local-asset-migration";

const imageAsset = (overrides: Record<string, unknown> = {}) => ({
    id: "asset-1",
    kind: "image" as const,
    title: "asset",
    coverUrl: "",
    tags: [],
    createdAt: "2026-09-23T10:00:00.000Z",
    updatedAt: "2026-09-23T10:00:00.000Z",
    data: { dataUrl: "server:canonical", storageKey: "server:canonical", width: 10, height: 10, bytes: 10, mimeType: "image/png" },
    ...overrides,
}) as Asset;

describe("local asset migration", () => {
    test("parses only valid legacy asset snapshots without changing stored data", () => {
        const asset = imageAsset();
        const parsed = parseLegacyAssetSnapshot(JSON.stringify({ state: { assets: [asset, null, { id: "" }] } }));

        expect(parsed).toEqual([asset]);
        expect(parseLegacyAssetSnapshot("not-json")).toEqual([]);
        expect(parseLegacyAssetSnapshot(null)).toEqual([]);
    });

    test("merges old browser assets additively and keeps canonical rows on equal timestamps", () => {
        const canonical = imageAsset();
        const older = imageAsset({ id: "older", updatedAt: "2026-09-22T10:00:00.000Z" });
        const staleDuplicate = imageAsset({ data: { dataUrl: "blob:stale", width: 10, height: 10, bytes: 10, mimeType: "image/png" } });
        const newerDuplicate = imageAsset({ updatedAt: "2026-09-24T10:00:00.000Z", title: "newer legacy" });

        expect(mergeAssetSnapshots([canonical], [older, staleDuplicate, newerDuplicate])).toEqual([
            newerDuplicate,
            older,
        ]);
    });
});
