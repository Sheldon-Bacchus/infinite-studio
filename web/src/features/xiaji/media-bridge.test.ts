// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { DramaImportAsset, DramaImportEpisode } from "@/services/api/drama-import";
import { prepareDramaAsset, prepareDramaAssetSelection, prepareDramaEpisodeMedia, type DramaMediaStorage } from "./media-bridge";

const mediaAsset: DramaImportAsset = { id: "hero", tab: "characters", kind: "portrait", role: "character_portrait", label: "林雨", mediaType: "image", exists: true, url: "/api/v1/drama/media/portrait.png", meta: {} };
const episode: DramaImportEpisode = {
    number: 2,
    title: "雨夜",
    summary: "相遇",
    beatCount: 1,
    identityIds: [],
    sceneIds: [],
    propIds: [],
    beats: [{ episode: 2, beatNumber: 3, title: "车站", content: "相遇", prompt: "", identityIds: [], propIds: [], sketchUrl: "/sketch.png", frameUrl: "", videoUrl: "/clip.mp4", audioUrl: "/line.wav", audioDurationSeconds: 3 }],
};

function storage(overrides: Partial<DramaMediaStorage> = {}): DramaMediaStorage {
    return {
        download: async () => new Blob(["source"], { type: "application/octet-stream" }),
        uploadImage: async () => ({ url: "blob:image", storageKey: "image:uploaded", width: 640, height: 480, bytes: 200, mimeType: "image/png" }),
        uploadMedia: async (_blob, prefix) => ({ url: `blob:${prefix}`, storageKey: `${prefix}:uploaded`, bytes: 300, mimeType: "video/mp4" }),
        ...overrides,
    };
}

describe("DramaClaw media bridge", () => {
    test("prepares selected assets independently and keeps failed source assets out of the ready batch", async () => {
        const result = await prepareDramaAssetSelection([
            mediaAsset,
            { ...mediaAsset, id: "missing", label: "缺失图片", url: "/missing.png" },
            { ...mediaAsset, id: "text", label: "剧本文本", mediaType: "text", url: "" },
        ], storage({ download: async (url) => { if (url === "/missing.png") throw new Error("upstream unavailable"); return new Blob(["image"]); } }));

        expect(result.ready.map((asset) => asset.id)).toEqual(["hero", "text"]);
        expect(result.failed.map(({ asset, message }) => [asset.id, message])).toEqual([["missing", "upstream unavailable"]]);
    });

    test("reports unsupported 3D files and missing source files instead of treating them as ready", async () => {
        const result = await prepareDramaAssetSelection([
            { ...mediaAsset, id: "world", label: "3D世界", role: "scene_3gs_master_ply", mediaType: "3d" },
            { ...mediaAsset, id: "missing-file", label: "缺失场景", exists: false },
        ], storage());

        expect(result.ready).toEqual([]);
        expect(result.failed.map(({ asset }) => asset.id)).toEqual(["world", "missing-file"]);
        expect(result.failed[0].message).toContain("不支持");
        expect(result.failed[1].message).toContain("缺失");
    });

    test("downloads protected source media and returns target storage references", async () => {
        let downloaded = "";
        const mapped = await prepareDramaAsset(mediaAsset, storage({ download: async (url) => { downloaded = url; return new Blob(["image"]); } }));

        expect(downloaded).toBe(mediaAsset.url);
        expect(mapped).toMatchObject({ url: "blob:image", meta: { storageKey: "image:uploaded", width: 640, height: 480, mimeType: "image/png" } });
    });

    test("leaves text and Infinite Canvas-owned media in its current storage", async () => {
        let downloads = 0;
        const noNetwork = storage({ download: async () => { downloads += 1; return new Blob(); } });
        const text = await prepareDramaAsset({ ...mediaAsset, mediaType: "text", meta: { content: "正文" } }, noNetwork);
        const local = await prepareDramaAsset({ ...mediaAsset, meta: { sourceSystem: "infinite-canvas", storageKey: "image:local" } }, noNetwork);

        expect(downloads).toBe(0);
        expect(text.url).toBe(mediaAsset.url);
        expect(local.url).toBe(mediaAsset.url);
    });

    test("stores episode media and omits source URLs when an individual transfer fails", async () => {
        const result = await prepareDramaEpisodeMedia(episode, storage({
            download: async (url) => {
                if (url === "/clip.mp4") throw new Error("upstream unavailable");
                return new Blob([url], { type: "image/png" });
            },
        }));

        expect(result.failedMediaCount).toBe(1);
        expect(result.episode.beats[0]).toMatchObject({ frameUrl: "", sketchUrl: "/sketch.png", videoUrl: "", audioUrl: "/line.wav" });
        expect(result.mediaByBeat[3]).toMatchObject({ image: { storageKey: "image:uploaded" }, audio: { storageKey: "drama-audio-ep-2-beat-3:uploaded", durationMs: 3000 } });
        expect(result.mediaByBeat[3].video).toBeUndefined();
    });
});
