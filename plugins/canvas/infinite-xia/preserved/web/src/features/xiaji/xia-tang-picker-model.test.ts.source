// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { createXiaTangAssetInput } from "./xia-tang-local-model";
import { listXiaTangPickerAssets, listXiaTangPickerAssetsForProject } from "./xia-tang-picker-model";
import { resolveXiaTangSelectionProjectId } from "./xia-tang-picker-model";
import type { Asset } from "@/stores/use-asset-store";

function textRecord(id: string, domain: "character" | "scene", fields: Record<string, unknown>): Asset {
    const input = createXiaTangAssetInput(domain, fields);
    if (input.kind !== "text") throw new Error("domain records are stored as local text assets");
    return { ...input, id, createdAt: "", updatedAt: "" } as Asset;
}

describe("XiaTang picker model", () => {
    test("shows only local XiaTang records in the selected domain, including linked media", () => {
        const character = textRecord("character-1", "character", { name: "林照" });
        const scene = textRecord("scene-1", "scene", { name: "旧街" });
        const portrait: Asset = {
            id: "portrait-1", kind: "image" as const, title: "portrait.png", coverUrl: "", tags: [], createdAt: "", updatedAt: "",
            data: { dataUrl: "data:image/png;base64,AA==", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
            metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "media", parentId: "character-1", slot: "portrait", fields: {} } },
        };
        const generic: Asset = { ...character, id: "generic-1", category: "other", metadata: undefined };

        expect(listXiaTangPickerAssets([character, scene, portrait, generic], "character").map((asset) => asset.id))
            .toEqual(["character-1", "portrait-1"]);
    });

    test("searches names, tags, slots, and domain metadata without leaking other domains", () => {
        const character = textRecord("character-1", "character", { name: "林照", role: "主角" });
        const scene = textRecord("scene-1", "scene", { name: "旧街" });

        expect(listXiaTangPickerAssets([character, scene], "character", "主角").map((asset) => asset.id)).toEqual(["character-1"]);
        expect(listXiaTangPickerAssets([character, scene], "character", "旧街")).toEqual([]);
    });

    test("limits a bound canvas picker to its project and linked child media", () => {
        const projectA = { ...textRecord("character-a", "character", { name: "项目甲角色" }), metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", projectAssetId: "project-a", fields: { name: "项目甲角色" } } } } as Asset;
        const projectB = { ...textRecord("character-b", "character", { name: "项目乙角色" }), metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", projectAssetId: "project-b", fields: { name: "项目乙角色" } } } } as Asset;
        const mediaA: Asset = { id: "media-a", kind: "image", title: "甲头像", coverUrl: "", tags: [], createdAt: "", updatedAt: "", data: { dataUrl: "data:image/png;base64,AA==", width: 1, height: 1, bytes: 1, mimeType: "image/png" }, metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "media", parentId: "character-a", slot: "portrait", fields: {} } } };

        expect(listXiaTangPickerAssetsForProject([projectA, projectB, mediaA], "project-a", "character").map((asset) => asset.id))
            .toEqual(["character-a", "media-a"]);
        expect(listXiaTangPickerAssetsForProject([projectA, projectB, mediaA], "missing-project", "character")).toEqual([]);
    });

    test("resolves one project for selected XiaTang entries through their parent records", () => {
        const character = { ...textRecord("character-a", "character", { name: "甲" }), metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", projectAssetId: "project-a", fields: { name: "甲" } } } } as Asset;
        const child: Asset = { id: "media-a", kind: "image", title: "头像", coverUrl: "", tags: [], createdAt: "", updatedAt: "", data: { dataUrl: "/a.png", width: 1, height: 1, bytes: 1, mimeType: "image/png" }, metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "media", parentId: "character-a", slot: "portrait", fields: {} } } };
        const foreign = { ...textRecord("character-b", "character", { name: "乙" }), metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", projectAssetId: "project-b", fields: { name: "乙" } } } } as Asset;

        expect(resolveXiaTangSelectionProjectId([character, child, foreign], ["character-a", "media-a"])).toBe("project-a");
        expect(() => resolveXiaTangSelectionProjectId([character, foreign], ["character-a", "character-b"])).toThrow("属于不同项目");
        expect(() => resolveXiaTangSelectionProjectId([foreign], ["character-b"], "project-a")).toThrow("不属于当前项目");
    });
});
