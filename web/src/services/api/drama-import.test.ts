// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { buildDramaImportCatalogParams, normalizeDramaAssetCatalog, normalizeDramaAssetDomain, normalizeDramaImportCatalog } from "./drama-import";

describe("normalizeDramaImportCatalog", () => {
    test("preserves categorized media and missing-file concepts", () => {
        const catalog = normalizeDramaImportCatalog({
            sourceSnapshot: { projectId: "demo", revision: "rev-1" },
            project: { id: "demo", title: "雨夜" },
            episodes: [],
            assets: [
                { id: "text", tab: "characters", kind: "identity", role: "character_identity", label: "人物", mediaType: "text", exists: true, meta: { character: "hero" } },
                { id: "image", tab: "scenes", kind: "scene", role: "scene_master", label: "场景", mediaType: "image", exists: true },
                { id: "video", tab: "beats", kind: "video", role: "current_video", label: "视频", mediaType: "video", exists: true },
                { id: "audio", tab: "characters", kind: "audio", role: "character_voice", label: "声音", mediaType: "audio", exists: true },
                { id: "missing", tab: "props", kind: "prop", role: "prop_reference", label: "缺失道具", mediaType: "image", exists: false },
            ],
        });

        expect(catalog.assets.map((asset) => asset.mediaType)).toEqual(["text", "image", "video", "audio", "image"]);
        expect(catalog.assets[4].exists).toBe(false);
        expect(catalog.assets[0].meta?.character).toBe("hero");
        expect(catalog.beatContextAssets).toEqual([]);
        expect(catalog.warnings).toEqual([]);
    });

    test("keeps optional target and history capabilities absent when upstream omits them", () => {
        const catalog = normalizeDramaImportCatalog({
            sourceSnapshot: { projectId: "demo", revision: "rev-1" },
            project: { id: "demo", title: "雨夜" },
            episodes: [],
            assets: [{ id: "asset", tab: "props", kind: "prop", role: "prop_reference", label: "道具", mediaType: "image", exists: true }],
            beatContextAssets: [],
            warnings: ["读取虾集分镜素材上下文失败"],
        });

        expect(catalog.assets[0].slotTarget).toBeUndefined();
        expect(catalog.assets[0].pushable).toBeUndefined();
        expect(catalog.assets[0].historyAvailable).toBeUndefined();
        expect(catalog.warnings).toEqual(["读取虾集分镜素材上下文失败"]);
    });

    test("defaults absent optional catalog lists to empty arrays", () => {
        const catalog = normalizeDramaImportCatalog({
            sourceSnapshot: { projectId: "demo", revision: "rev-1" },
            project: { id: "demo", title: "雨夜" },
        });

        expect(catalog.episodes).toEqual([]);
        expect(catalog.assets).toEqual([]);
        expect(catalog.beatContextAssets).toEqual([]);
        expect(catalog.warnings).toEqual([]);
    });
});

describe("normalizeDramaAssetCatalog", () => {
    test("normalizes project assets without introducing episode or beat data", () => {
        const catalog = normalizeDramaAssetCatalog({
            sourceSnapshot: { projectId: "demo", revision: "assets-rev-1" },
            project: { id: "demo", title: "雨夜" },
            assets: [{ id: "hero", tab: "characters", kind: "portrait", role: "character_portrait", label: "林雨", mediaType: "image", exists: true, url: "/media/hero.png" }],
            warnings: [],
        });

        expect(catalog.sourceSnapshot.revision).toBe("assets-rev-1");
        expect(catalog.project.title).toBe("雨夜");
        expect(catalog.assets.map((asset) => asset.label)).toEqual(["林雨"]);
        expect("episodes" in catalog).toBe(false);
        expect("beatContextAssets" in catalog).toBe(false);
    });
});

describe("normalizeDramaAssetDomain", () => {
    test("preserves DramaClaw-owned domain fields for specialized asset pages", () => {
        const result = normalizeDramaAssetDomain([
            { name: "林雨", role: "主角", identity_ids: ["林雨_雨衣"], portrait_url: "/api/v1/drama/media?url=portrait" },
            { name: "车站", scene_type: "interior", master_url: "/api/v1/drama/media?url=scene" },
        ]);

        expect(result[0].identity_ids).toEqual(["林雨_雨衣"]);
        expect(result[1].scene_type).toBe("interior");
    });

    test("rejects malformed source rows instead of inventing empty entities", () => {
        expect(() => normalizeDramaAssetDomain({})).toThrow("响应格式无效");
        expect(() => normalizeDramaAssetDomain([{ role: "主角" }])).toThrow("包含无效项目");
    });
});

describe("buildDramaImportCatalogParams", () => {
    test("adds the selected episode and beat as query params", () => {
        expect(buildDramaImportCatalogParams(3, 7)).toEqual({ episode: 3, beat: 7 });
        expect(buildDramaImportCatalogParams(3)).toEqual({ episode: 3 });
        expect(buildDramaImportCatalogParams()).toBeUndefined();
    });
});
