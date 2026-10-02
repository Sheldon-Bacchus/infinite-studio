import { describe, expect, it } from "bun:test";

import type { Asset } from "./asset-types";
import {
    createXiaTangAssetInput,
    findXiaTangChildren,
    getXiaTangCurrentMediaId,
    getXiaTangRecord,
    isXiaTangAsset,
    listXiaTangMediaVersions,
    listXiaTangProjectAssets,
    patchXiaTangFields,
    setXiaTangCurrentMediaId,
} from "./xia-tang-local-model";

function storedAsset(overrides: Partial<Asset> & Pick<Asset, "id" | "kind" | "title">): Asset {
    const { id, kind, title, ...rest } = overrides;
    const base = {
        id,
        kind,
        title,
        coverUrl: "",
        tags: [],
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
        ...(kind === "text" ? { data: { content: "" } }
            : kind === "image" ? { data: { dataUrl: "/image", width: 12, height: 12, bytes: 1, mimeType: "image/png" } }
                : kind === "video" ? { data: { url: "/video", width: 12, height: 12, bytes: 1, mimeType: "video/mp4" } }
                    : { data: { url: "/audio", bytes: 1, mimeType: "audio/wav" } }),
        ...rest,
    } as Asset;
    return base;
}

describe("XiaTang local domain records", () => {
    it("creates a text record with the full domain fields in versioned metadata", () => {
        const input = createXiaTangAssetInput("character", {
            name: "林夏",
            aliases: ["夏夏", "小夏"],
            role: "主角",
            age_group: "青年",
            appearance_details: "短发，蓝色外套",
            face_prompt: "圆脸，眉眼清晰",
            is_main: true,
        });

        expect(input.kind).toBe("text");
        expect(input.title).toBe("林夏");
        if (input.kind !== "text") throw new Error("XiaTang field record must use the local text asset kind");
        expect((input.data as { content: string }).content).toContain("林夏");
        expect(input.metadata?.xiaTang).toEqual({
            schemaVersion: 1,
            domain: "character",
            recordType: "entity",
            fields: {
                name: "林夏",
                aliases: ["夏夏", "小夏"],
                role: "主角",
                age_group: "青年",
                appearance_details: "短发，蓝色外套",
                face_prompt: "圆脸，眉眼清晰",
                is_main: true,
            },
        });
    });

    it("distinguishes XiaTang domain records from ordinary local assets", () => {
        const record = storedAsset({
            id: "character-1",
            kind: "text",
            title: "林夏",
            metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", fields: { name: "林夏" } } },
        });
        const generic = storedAsset({ id: "generic-1", kind: "text", title: "普通文本" });

        expect(isXiaTangAsset(record)).toBe(true);
        expect(isXiaTangAsset(record, "character", "entity")).toBe(true);
        expect(isXiaTangAsset(record, "scene")).toBe(false);
        expect(isXiaTangAsset(generic)).toBe(false);
        expect(getXiaTangRecord(generic)).toBeNull();
    });

    it("keeps unknown metadata and fields when editing a domain record", () => {
        const record = storedAsset({
            id: "scene-1",
            kind: "text",
            title: "老街",
            metadata: {
                preserveMe: { revision: 4 },
                xiaTang: {
                    schemaVersion: 1,
                    domain: "scene",
                    recordType: "entity",
                    fields: { name: "老街", notes: "雨后", futureField: { source: "legacy" } },
                    upstreamExtension: "keep",
                },
            },
        });

        const patched = patchXiaTangFields(record, { name: "旧街", time_of_day: "夜晚" }, "2026-09-25T00:00:00.000Z");

        expect(patched.title).toBe("旧街");
        expect(patched.updatedAt).toBe("2026-09-25T00:00:00.000Z");
        expect(patched.metadata?.preserveMe).toEqual({ revision: 4 });
        expect((patched.metadata?.xiaTang as Record<string, unknown>).upstreamExtension).toBe("keep");
        expect(getXiaTangRecord(patched)?.fields).toEqual({
            name: "旧街",
            notes: "雨后",
            futureField: { source: "legacy" },
            time_of_day: "夜晚",
        });
    });

    it("finds only direct child records and associated media in stable input order", () => {
        const parent = storedAsset({ id: "scene-1", kind: "text", title: "码头", metadata: { xiaTang: { schemaVersion: 1, domain: "scene", recordType: "entity", fields: { name: "码头" } } } });
        const variant = storedAsset({ id: "scene-variant-1", kind: "text", title: "夜景", metadata: { xiaTang: { schemaVersion: 1, domain: "scene", recordType: "variant", parentId: "scene-1", fields: { name: "夜景" } } } });
        const master = storedAsset({ id: "scene-master-1", kind: "image", title: "master", metadata: { xiaTang: { schemaVersion: 1, domain: "scene", recordType: "media", parentId: "scene-1", slot: "master" } } });
        const variantImage = storedAsset({ id: "scene-variant-image", kind: "image", title: "夜景全景", metadata: { xiaTang: { schemaVersion: 1, domain: "scene", recordType: "media", parentId: "scene-variant-1", slot: "pano" } } });
        const other = storedAsset({ id: "other-scene", kind: "text", title: "仓库" });

        expect(findXiaTangChildren([parent, variant, master, variantImage, other], parent.id).map((asset) => asset.id)).toEqual(["scene-variant-1", "scene-master-1"]);
        expect(findXiaTangChildren([parent, variant, master, variantImage, other], variant.id).map((asset) => asset.id)).toEqual(["scene-variant-image"]);
    });

    it("orders a media slot's local versions and defaults the current version to the newest", () => {
        const earlier = storedAsset({ id: "portrait-v1", kind: "image", title: "v1", createdAt: "2026-09-23T00:00:00.000Z", metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "media", parentId: "character-1", slot: "portrait" } } });
        const latest = storedAsset({ id: "portrait-v2", kind: "image", title: "v2", createdAt: "2026-09-24T00:00:00.000Z", metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "media", parentId: "character-1", slot: "portrait", versionOf: "portrait-v1" } } });
        const parent = storedAsset({ id: "character-1", kind: "text", title: "林夏", metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", fields: { name: "林夏" } } } });

        expect(listXiaTangMediaVersions([latest, parent, earlier], parent.id, "portrait").map((asset) => asset.id)).toEqual(["portrait-v1", "portrait-v2"]);
        expect(getXiaTangCurrentMediaId([latest, parent, earlier], parent.id, "portrait")).toBe("portrait-v2");
    });

    it("restores a chosen local media version without changing the media records", () => {
        const earlier = storedAsset({ id: "portrait-v1", kind: "image", title: "v1", createdAt: "2026-09-23T00:00:00.000Z", metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "media", parentId: "character-1", slot: "portrait" } } });
        const latest = storedAsset({ id: "portrait-v2", kind: "image", title: "v2", createdAt: "2026-09-24T00:00:00.000Z", metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "media", parentId: "character-1", slot: "portrait", versionOf: "portrait-v1" } } });
        const parent = storedAsset({ id: "character-1", kind: "text", title: "林夏", metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", fields: { name: "林夏" } } } });
        const restored = setXiaTangCurrentMediaId(parent, [parent, earlier, latest], "portrait", earlier.id);

        expect(getXiaTangCurrentMediaId([restored, earlier, latest], parent.id, "portrait")).toBe(earlier.id);
        expect(earlier.title).toBe("v1");
        expect(latest.title).toBe("v2");
    });

    it("scopes project assets and inherited child media without including another project", () => {
        const projectOne = createXiaTangAssetInput("character", { name: "角色甲" }, { projectAssetId: "project-1" });
        const projectTwo = createXiaTangAssetInput("character", { name: "角色乙" }, { projectAssetId: "project-2" });
        const one = { ...projectOne, id: "character-1", createdAt: "now", updatedAt: "now" } as Asset;
        const two = { ...projectTwo, id: "character-2", createdAt: "now", updatedAt: "now" } as Asset;
        const child = { ...createXiaTangAssetInput("character", { name: "头像" }, { recordType: "media", parentId: "character-1" }), id: "media-1", createdAt: "now", updatedAt: "now" } as Asset;

        expect(listXiaTangProjectAssets([one, two, child], "project-1").map((asset) => asset.id)).toEqual(["character-1", "media-1"]);
        expect(getXiaTangRecord(one)?.projectAssetId).toBe("project-1");
    });
});
