// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { mapLocalAssetsToDramaAssets } from "./local-assets";

describe("mapLocalAssetsToDramaAssets", () => {
    test("preserves local source, media kind, category, tags, and text content", () => {
        const assets = mapLocalAssetsToDramaAssets([
            {
                id: "text-1",
                kind: "text",
                title: "角色简介",
                coverUrl: "",
                tags: ["主角", "人物"],
                category: "人物设定",
                source: "手动添加",
                createdAt: "2026-09-22T00:00:00.000Z",
                updatedAt: "2026-09-22T00:00:00.000Z",
                data: { content: "一名摄影师" },
            },
            {
                id: "image-1",
                kind: "image",
                title: "定妆照",
                coverUrl: "https://media.example/cover.png",
                tags: ["主角"],
                createdAt: "2026-09-22T00:00:00.000Z",
                updatedAt: "2026-09-22T00:00:00.000Z",
                data: { dataUrl: "https://media.example/portrait.png", storageKey: "image:portrait", width: 640, height: 800, bytes: 1234, mimeType: "image/png" },
            },
        ]);

        expect(assets).toHaveLength(2);
        expect(assets[0]).toMatchObject({ id: "text-1", tab: "my-assets", mediaType: "text", exists: true });
        expect(assets[0].meta).toMatchObject({ sourceSystem: "infinite-canvas", sourceProjectId: "user-assets", category: "人物设定", tags: ["主角", "人物"], content: "一名摄影师" });
        expect(assets[1]).toMatchObject({ id: "image-1", mediaType: "image", exists: true, url: "https://media.example/portrait.png" });
        expect(assets[1].meta).toMatchObject({ sourceSystem: "infinite-canvas", storageKey: "image:portrait", width: 640, mimeType: "image/png" });
    });

    test("marks missing local media as unavailable and keeps uncategorized assets", () => {
        const [asset] = mapLocalAssetsToDramaAssets([{
            id: "missing",
            kind: "audio",
            title: "旁白",
            coverUrl: "",
            tags: [],
            createdAt: "2026-09-22T00:00:00.000Z",
            updatedAt: "2026-09-22T00:00:00.000Z",
            data: { url: "", mimeType: "audio/mpeg" },
        }]);

        expect(asset).toMatchObject({ tab: "my-assets", mediaType: "audio", exists: false, url: undefined });
        expect(asset.meta).toMatchObject({ category: "未分类", sourceSystem: "infinite-canvas" });
    });
});
