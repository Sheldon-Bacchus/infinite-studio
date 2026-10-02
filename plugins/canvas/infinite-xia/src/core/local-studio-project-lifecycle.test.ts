import { describe, expect, test } from "bun:test";

import type { Asset } from "./asset-types";
import { collectLocalStudioProjectAssetIds, deleteLocalStudioProject, findCanvasReferencesToAssets, findOtherStudioReferencesToAssets } from "./local-studio-project-lifecycle";

function textAsset(id: string, metadata: Record<string, unknown>, category = "xiaji:episode"): Asset {
    return {
        id, kind: "text", title: id, coverUrl: "", tags: [], category, data: { content: "" },
        createdAt: "now", updatedAt: "now", metadata,
    };
}

describe("local studio project lifecycle", () => {
    test("collects only the selected project's source, episodes, scripts, beats, and XiaTang descendants", () => {
        const assets: Asset[] = [
            textAsset("project-a", { localStudio: { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic", sourceAssetId: "source-a" } }, "xiaji:project"),
            textAsset("source-a", { localStudioSource: { projectAssetId: "project-a", sourceType: "manuscript" } }, "xiaji:source"),
            textAsset("episode-a", { localStudio: { schemaVersion: 1, recordType: "episode", projectAssetId: "project-a", order: 1, title: "第一集" } }),
            textAsset("script-a", { localStudio: { schemaVersion: 1, recordType: "script", projectAssetId: "project-a", episodeAssetId: "episode-a", documentKind: "script" } }, "xiaji:script"),
            textAsset("beat-a", { localStudio: { schemaVersion: 1, recordType: "beat", projectAssetId: "project-a", episodeAssetId: "episode-a", order: 1, referencedAssetIds: [] } }, "xiaji:beat"),
            textAsset("character-a", { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", projectAssetId: "project-a", fields: {} } }, "xia-tang:character"),
            textAsset("portrait-a", { xiaTang: { schemaVersion: 1, domain: "character", recordType: "media", parentId: "character-a", fields: {} } }, "xia-tang:media"),
            textAsset("project-b", { localStudio: { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic" } }, "xiaji:project"),
            textAsset("episode-b", { localStudio: { schemaVersion: 1, recordType: "episode", projectAssetId: "project-b", order: 1, title: "另一集" } }),
            textAsset("foreign-source", { localStudioSource: { projectAssetId: "project-b", sourceType: "manuscript" } }, "xiaji:source"),
            textAsset("project-b-reference", { localStudio: { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic", sourceAssetId: "foreign-source" } }, "xiaji:project"),
        ];

        expect(collectLocalStudioProjectAssetIds(assets, "project-a")).toEqual([
            "project-a", "source-a", "episode-a", "script-a", "beat-a", "character-a", "portrait-a",
        ]);
        expect(collectLocalStudioProjectAssetIds(assets, "missing-project")).toEqual([]);
    });

    test("finds canvas nodes that reference assets before deleting their project", () => {
        const references = findCanvasReferencesToAssets([
            { id: "canvas-a", title: "引用项目素材", nodes: [{ metadata: { sourceEntityId: "character-a" } }] },
            { id: "canvas-b", title: "引用导入清单", nodes: [{ metadata: { projectionSourceAssetIds: ["script-a", "unrelated"] } }] },
            { id: "canvas-c", title: "无引用", nodes: [{ metadata: { prompt: "character-a" } }] },
        ], new Set(["character-a", "script-a"]));

        expect(references).toEqual([
            { canvasId: "canvas-a", canvasTitle: "引用项目素材", assetIds: ["character-a"] },
            { canvasId: "canvas-b", canvasTitle: "引用导入清单", assetIds: ["script-a"] },
        ]);
    });

    test("treats a canonical project binding as a canvas reference even before nodes are imported", () => {
        expect(findCanvasReferencesToAssets([
            { id: "empty-bound-canvas", title: "项目画布", xiajiProjectAssetId: "project-a", nodes: [] },
        ], new Set(["project-a"]))).toEqual([
            { canvasId: "empty-bound-canvas", canvasTitle: "项目画布", assetIds: ["project-a"] },
        ]);
    });

    test("finds asset references from another project's Beat", () => {
        const assets = [
            textAsset("project-a", { localStudio: { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic" } }, "xiaji:project"),
            textAsset("character-a", { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", projectAssetId: "project-a", fields: {} } }, "xia-tang:character"),
            textAsset("project-b", { localStudio: { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic" } }, "xiaji:project"),
            textAsset("episode-b", { localStudio: { schemaVersion: 1, recordType: "episode", projectAssetId: "project-b", order: 1, title: "另一集" } }),
            textAsset("beat-b", { localStudio: { schemaVersion: 1, recordType: "beat", projectAssetId: "project-b", episodeAssetId: "episode-b", order: 1, referencedAssetIds: ["character-a"] } }, "xiaji:beat"),
        ];
        expect(findOtherStudioReferencesToAssets(assets, "project-a", new Set(["project-a", "character-a"]))).toEqual(["beat-b"]);
    });

    test("blocks deletion before writing when another project references its assets", async () => {
        const project = textAsset("project-a", { localStudio: { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic" } }, "xiaji:project");
        const foreignBeat = textAsset("foreign-beat", { localStudio: { schemaVersion: 1, recordType: "beat", projectAssetId: "project-b", episodeAssetId: "episode-b", order: 1, referencedAssetIds: ["project-a"] } }, "xiaji:beat");
        let deleteCalls = 0;
        await expect(deleteLocalStudioProject("project-a", {
            getAssets: () => [project, foreignBeat],
            listCanvasProjects: async () => [],
            deleteAssets: async () => { deleteCalls += 1; },
            listAssets: async () => [],
        })).rejects.toThrow("其他虾镜内容引用：foreign-beat");
        expect(deleteCalls).toBe(0);
    });

    test("blocks deletion before writing when a canvas still references project material", async () => {
        let deleteCalls = 0;
        await expect(deleteLocalStudioProject("project-a", {
            getAssets: () => [textAsset("project-a", { localStudio: { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic" } }, "xiaji:project")],
            listCanvasProjects: async () => [{ id: "canvas-a", title: "关联画布", nodes: [{ metadata: { sourceEntityId: "project-a" } }] }],
            deleteAssets: async () => { deleteCalls += 1; },
            listAssets: async () => [],
        })).rejects.toThrow("项目素材仍被画布引用：关联画布");
        expect(deleteCalls).toBe(0);
    });

    test("deletes only the selected project's exact local records and verifies the result", async () => {
        const project = textAsset("project-a", { localStudio: { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic" } }, "xiaji:project");
        let deletedIds: string[] = [];
        const deleted = await deleteLocalStudioProject("project-a", {
            getAssets: () => [project],
            listCanvasProjects: async () => [],
            deleteAssets: async (ids) => { deletedIds = ids; },
            listAssets: async () => [],
        });

        expect(deleted).toEqual(["project-a"]);
        expect(deletedIds).toEqual(["project-a"]);
        await expect(deleteLocalStudioProject("project-a", {
            getAssets: () => [project],
            listCanvasProjects: async () => [],
            deleteAssets: async () => undefined,
            listAssets: async () => [project],
        })).rejects.toThrow("本地存储仍返回 1 条项目记录，删除未完成");
    });
});
