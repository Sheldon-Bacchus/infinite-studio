// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { Asset } from "@/stores/use-asset-store";
import { filterLocalAssets, searchLocalAssets } from "./local-asset-query";

const assets: Asset[] = [
    { id: "story", kind: "text", title: "雨夜车站", coverUrl: "", tags: ["场景", "雨夜"], category: "场景", source: "手动添加", createdAt: "", updatedAt: "", data: { content: "末班列车即将进站" } },
    { id: "hero", kind: "image", title: "主角定妆", coverUrl: "/hero.png", tags: ["主角"], category: "人物", source: "手动添加", createdAt: "", updatedAt: "", data: { dataUrl: "/hero.png", width: 800, height: 1200, bytes: 50, mimeType: "image/png" } },
    { id: "library", kind: "video", title: "雨景参考", coverUrl: "", tags: ["雨夜"], category: "场景", source: "素材库", createdAt: "", updatedAt: "", metadata: { source: "asset-library" }, data: { url: "/rain.mp4", width: 1920, height: 1080, bytes: 100, mimeType: "video/mp4" } },
];

describe("local XiaTang asset query", () => {
    test("filters local assets by type, category, and tag", () => {
        expect(filterLocalAssets(assets, { mediaType: "image" }).map((asset) => asset.id)).toEqual(["hero"]);
        expect(filterLocalAssets(assets, { category: "场景", tag: "雨夜" }).map((asset) => asset.id)).toEqual(["story", "library"]);
        expect(filterLocalAssets(assets, { tag: "all" })).toEqual(assets);
    });

    test("searches title, source, category, tags, and text content", () => {
        expect(searchLocalAssets(assets, "末班列车").map((asset) => asset.id)).toEqual(["story"]);
        expect(searchLocalAssets(assets, "主角").map((asset) => asset.id)).toEqual(["hero"]);
        expect(searchLocalAssets(assets, "")).toEqual(assets);
    });

    test("keeps the library tab backed only by local assets already added from the library", () => {
        expect(filterLocalAssets(assets, { view: "mine" }).map((asset) => asset.id)).toEqual(["story", "hero"]);
        expect(filterLocalAssets(assets, { view: "library" }).map((asset) => asset.id)).toEqual(["library"]);
    });
});
