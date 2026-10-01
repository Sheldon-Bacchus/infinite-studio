// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { DramaImportAsset } from "@/services/api/drama-import";
import { canPreviewDramaAsset, canProjectDramaAsset, filterDramaAssets, filterXiaTangAssets, searchDramaAssets } from "./asset-query";

const assets: DramaImportAsset[] = [
    { id: "hero", tab: "characters", kind: "portrait", role: "character_portrait", label: "林雨人物图", mediaType: "image", exists: true, url: "/hero.png", meta: { tags: ["主角", "雨夜"] } },
    { id: "voice", tab: "characters", kind: "audio", role: "character_voice", label: "林雨默认声线", mediaType: "audio", exists: true, url: "/voice.wav", meta: { tags: ["主角"] } },
    { id: "scene", tab: "scenes", kind: "scene", role: "scene_master", label: "车站", mediaType: "image", exists: false, meta: { tags: ["雨夜"] } },
    { id: "prop", tab: "props", kind: "prop", role: "prop_reference", label: "红伞", mediaType: "text", exists: true, meta: { tags: ["道具"] } },
    { id: "clip", tab: "beats", kind: "video", role: "current_video", label: "追逐镜头", mediaType: "video", exists: true, url: "/clip.mp4", meta: { tags: ["动作"] } },
];

describe("filterDramaAssets", () => {
    test("filters all, text, image, video, and audio media types", () => {
        expect(filterDramaAssets(assets)).toHaveLength(5);
        expect(filterDramaAssets(assets, { mediaType: "text" }).map((asset) => asset.id)).toEqual(["prop"]);
        expect(filterDramaAssets(assets, { mediaType: "image" }).map((asset) => asset.id)).toEqual(["hero", "scene"]);
        expect(filterDramaAssets(assets, { mediaType: "video" }).map((asset) => asset.id)).toEqual(["clip"]);
        expect(filterDramaAssets(assets, { mediaType: "audio" }).map((asset) => asset.id)).toEqual(["voice"]);
        expect(filterDramaAssets(assets, { tag: "all" })).toHaveLength(5);
    });

    test("filters character, scene, prop, and voice categories", () => {
        expect(filterDramaAssets(assets, { category: "characters" }).map((asset) => asset.id)).toEqual(["hero"]);
        expect(filterDramaAssets(assets, { category: "scenes" }).map((asset) => asset.id)).toEqual(["scene"]);
        expect(filterDramaAssets(assets, { category: "props" }).map((asset) => asset.id)).toEqual(["prop"]);
        expect(filterDramaAssets(assets, { category: "voices" }).map((asset) => asset.id)).toEqual(["voice"]);
        const sourceVoiceTab = { ...assets[1], id: "narrator", tab: "voices" };
        expect(filterDramaAssets([sourceVoiceTab], { category: "voices" })).toEqual([sourceVoiceTab]);
    });

    test("matches tags without case sensitivity and keeps missing files in the catalog", () => {
        expect(filterDramaAssets(assets, { tag: "雨夜" }).map((asset) => asset.id)).toEqual(["hero", "scene"]);
        expect(filterDramaAssets(assets, { tag: "雨夜" })[1].exists).toBe(false);
        expect(canPreviewDramaAsset(assets[2])).toBe(false);
        expect(canPreviewDramaAsset(assets[0])).toBe(true);
        expect(canPreviewDramaAsset(assets[3])).toBe(true);
    });

    test("uses each local asset's own category in the my-assets view", () => {
        const localAsset = { ...assets[0], id: "local", tab: "my-assets", meta: { category: "分镜参考" } };
        expect(filterDramaAssets([localAsset], { category: "分镜参考" })).toEqual([localAsset]);
    });
});

describe("filterXiaTangAssets", () => {
    test("keeps only XiaTang character, scene, prop, and voice assets", () => {
        const unknown = { ...assets[0], id: "unknown", tab: "episodes" };
        expect(filterXiaTangAssets([...assets, unknown]).map((asset) => asset.id)).toEqual(["hero", "voice", "scene", "prop"]);
    });
});

describe("canProjectDramaAsset", () => {
    test("only allows readable canvas text, image, video, and audio", () => {
        const model = { ...assets[1], id: "world", mediaType: "3d", url: "/world.ply" };
        expect(canProjectDramaAsset(assets[0])).toBe(true);
        expect(canProjectDramaAsset(assets[1])).toBe(true);
        expect(canProjectDramaAsset(model)).toBe(false);
        expect(canProjectDramaAsset({ ...assets[0], exists: false })).toBe(false);
    });
});

describe("searchDramaAssets", () => {
    test("searches labels, roles, and tags without case sensitivity", () => {
        expect(searchDramaAssets(assets, "LIN YU")).toEqual([]);
        expect(searchDramaAssets(assets, "林雨").map((asset) => asset.id)).toEqual(["hero", "voice"]);
        expect(searchDramaAssets(assets, "CHARACTER_VOICE").map((asset) => asset.id)).toEqual(["voice"]);
        expect(searchDramaAssets(assets, "动作").map((asset) => asset.id)).toEqual(["clip"]);
        expect(searchDramaAssets(assets, "")).toEqual(assets);
    });
});
