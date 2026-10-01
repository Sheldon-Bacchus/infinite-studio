// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { assetsForWritebackProject, canBrowseDramaHistory, canSaveCanvasResult, isSupportedWritebackMimeType, runWritebackAction, WritebackActionError } from "./writeback";
import type { DramaImportAsset } from "@/services/api/drama-import";

describe("explicit XiaJi writeback actions", () => {
    test("cancel does not call any write API", async () => {
        const calls: string[] = [];
        const result = await runWritebackAction(null, {
            upload: async () => { calls.push("upload"); return { url: "candidate" }; },
            createIdentity: async () => { calls.push("identity"); return {}; },
            push: async () => { calls.push("push"); return { target_url: "" }; },
        });
        expect(result).toMatchObject({ cancelled: true });
        expect(calls).toEqual([]);
    });

    test("saving a candidate only uploads it", async () => {
        const calls: string[] = [];
        const result = await runWritebackAction({ kind: "candidate", projectId: "p", file: new Blob(["image"]), filename: "frame.png" }, {
            upload: async () => { calls.push("upload"); return { url: "candidate" }; },
            createIdentity: async () => { calls.push("identity"); return {}; },
            push: async () => { calls.push("push"); return { target_url: "" }; },
        });
        expect(calls).toEqual(["upload"]);
        expect(result).toMatchObject({ candidate: { url: "candidate" } });
    });

    test("identity action uploads first then creates exactly one identity", async () => {
        const calls: string[] = [];
        await runWritebackAction({ kind: "identity", projectId: "p", file: new Blob(["image"]), filename: "frame.png", identity: { character: "hero", identity_name: "rain" } }, {
            upload: async () => { calls.push("upload"); return { url: "candidate" }; },
            createIdentity: async (_project, payload) => { calls.push(`identity:${payload.source_url}`); return {}; },
            push: async () => { calls.push("push"); return { target_url: "" }; },
        });
        expect(calls).toEqual(["upload", "identity:candidate"]);
    });

    test("replacement previews the canonical target and calls push once", async () => {
        const calls: string[] = [];
        await runWritebackAction({ kind: "replace", projectId: "p", file: new Blob(["image"]), filename: "frame.png", target: { kind: "portrait", character: "hero" }, markStale: true }, {
            upload: async () => { calls.push("upload"); return { url: "candidate" }; },
            createIdentity: async () => { calls.push("identity"); return {}; },
            push: async (_project, source, target, markStale) => { calls.push(`push:${source}:${target.kind}:${markStale}`); return { target_url: "" }; },
        });
        expect(calls).toEqual(["upload", "push:candidate:portrait:true"]);
    });

    test("reuses a saved candidate without uploading it again", async () => {
        const calls: string[] = [];
        await runWritebackAction({ kind: "replace", projectId: "p", candidate: { url: "saved-candidate" }, target: { kind: "portrait", character: "hero" }, markStale: false }, {
            upload: async () => { calls.push("upload"); return { url: "duplicate" }; },
            createIdentity: async () => { calls.push("identity"); return {}; },
            push: async (_project, source) => { calls.push(`push:${source}`); return { target_url: "" }; },
        });
        expect(calls).toEqual(["push:saved-candidate"]);
    });

    test("preserves the uploaded candidate after an uncertain replacement response", async () => {
        const calls: string[] = [];
        try {
            await runWritebackAction({ kind: "replace", projectId: "p", file: new Blob(["image"]), filename: "frame.png", target: { kind: "portrait", character: "hero" }, markStale: false }, {
                upload: async () => { calls.push("upload"); return { url: "candidate" }; },
                createIdentity: async () => { calls.push("identity"); return {}; },
                push: async () => { calls.push("push"); throw new Error("connection reset"); },
            });
        } catch (error) {
            expect(error).toBeInstanceOf(WritebackActionError);
            expect(error).toMatchObject({ step: "push", candidate: { url: "candidate" } });
        }
        expect(calls).toEqual(["upload", "push"]);
    });

    test("history is shown only when the source catalog advertises it", () => {
        const asset = { id: "a", tab: "characters", kind: "portrait", role: "portrait", label: "hero", exists: true, mediaType: "image", historyAvailable: true, slotTarget: { kind: "portrait", character: "hero" } } satisfies DramaImportAsset;
        expect(canBrowseDramaHistory(asset)).toBe(true);
        expect(canBrowseDramaHistory({ ...asset, historyAvailable: false })).toBe(false);
        expect(canBrowseDramaHistory({ ...asset, historyAvailable: undefined })).toBe(false);
    });

    test("only successful supported canvas media can be saved to XiaJi", () => {
        expect(canSaveCanvasResult("success", "https://media/image.png", true)).toBe(true);
        expect(canSaveCanvasResult("error", "https://media/image.png", true)).toBe(false);
        expect(canSaveCanvasResult("loading", "https://media/image.png", true)).toBe(false);
        expect(canSaveCanvasResult(undefined, "https://media/image.png", true)).toBe(false);
        expect(canSaveCanvasResult("success", "", true)).toBe(false);
        expect(canSaveCanvasResult("success", "https://media/image.png", false)).toBe(false);
    });

    test("only recognized image, video, and audio MIME types are accepted as writeback files", () => {
        expect(isSupportedWritebackMimeType("image/png")).toBe(true);
        expect(isSupportedWritebackMimeType("video/mp4; codecs=avc1")).toBe(true);
        expect(isSupportedWritebackMimeType("audio/mpeg")).toBe(true);
        expect(isSupportedWritebackMimeType("application/octet-stream")).toBe(false);
        expect(isSupportedWritebackMimeType("application/pdf")).toBe(false);
        expect(isSupportedWritebackMimeType("")).toBe(false);
    });

    test("never keeps source targets visible after switching DramaClaw projects", () => {
        const oldAsset = { id: "old", tab: "characters", kind: "portrait", role: "portrait", label: "old", exists: true, mediaType: "image" } satisfies DramaImportAsset;
        const newAsset = { ...oldAsset, id: "new", label: "new" };
        expect(assetsForWritebackProject("project-b", "project-a", "project-a", [oldAsset], [])).toEqual([]);
        expect(assetsForWritebackProject("project-b", "project-a", "project-b", [oldAsset], [newAsset]).map((asset) => asset.id)).toEqual(["new"]);
        expect(assetsForWritebackProject("project-a", "project-a", "", [oldAsset], []).map((asset) => asset.id)).toEqual(["old"]);
    });
});
