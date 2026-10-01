// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { Asset } from "@/stores/use-asset-store";
import { CanvasNodeType } from "@/app/(user)/canvas/types";
import { planXiajiProjectProjectionArrangement, planXiajiProjectProjectionImport, previewXiajiProjectProjection } from "./project-canvas-projection";

function fixture(): Asset[] {
    const project: Asset = {
        id: "project-1", kind: "text", title: "海边来信", coverUrl: "", tags: [], category: "xiaji:project", source: "test",
        data: { content: "" }, createdAt: "2026-09-28", updatedAt: "2026-09-28",
        metadata: { localStudio: { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic", sourceAssetId: "source-1" } },
    };
    const source: Asset = {
        id: "source-1", kind: "text", title: "原稿", coverUrl: "", tags: [], category: "xiaji:source", source: "test",
        data: { content: "原稿全文" }, createdAt: "2026-09-28", updatedAt: "2026-09-28",
    };
    const episode: Asset = {
        id: "episode-1", kind: "text", title: "第一集", coverUrl: "", tags: [], category: "xiaji:episode", source: "test",
        data: { content: "第一集梗概" }, createdAt: "2026-09-28", updatedAt: "2026-09-28",
        metadata: { localStudio: { schemaVersion: 1, recordType: "episode", projectAssetId: project.id, order: 1, title: "第一集", synopsis: "第一集梗概" } },
    };
    return [episode, source, project];
}

describe("Xiaji project structure canvas projection", () => {
    test("previews project, manuscript, and episodes without requiring a script or Beat", async () => {
        const preview = await previewXiajiProjectProjection(fixture(), "project-1");

        expect(preview.issues).toEqual([]);
        expect(preview.items.map((item) => [item.role, item.assetId])).toEqual([
            ["project", "project-1"],
            ["manuscript", "source-1"],
            ["episode", "episode-1"],
        ]);
        expect(preview.relationships).toEqual([
            { fromAssetId: "project-1", toAssetId: "source-1", kind: "manuscript" },
            { fromAssetId: "project-1", toAssetId: "episode-1", kind: "episode" },
        ]);
    });

    test("blocks a missing or cross-project manuscript rather than previewing partial context", async () => {
        const assets = fixture();
        assets.splice(1, 1);
        const preview = await previewXiajiProjectProjection(assets, "project-1");

        expect(preview.issues.map((issue) => issue.code)).toContain("missing-manuscript");
        expect(preview.items.map((item) => item.role)).not.toContain("manuscript");
    });

    test("imports only the reviewed source IDs, keeps existing canvas content, and reuses an identical projection", async () => {
        const assets = fixture();
        const preview = await previewXiajiProjectProjection(assets, "project-1");
        const selected = preview.items.filter((item) => item.role !== "episode").map((item) => item.assetId);
        const existing = [{ id: "user-node", type: CanvasNodeType.Text, title: "手工节点", position: { x: -600, y: 20 }, width: 300, height: 200, metadata: { content: "保留" } }];
        const input = { canvasId: "canvas-1", existingNodes: existing, assets, preview, sourceDigest: preview.sourceDigest, sourceAssetIds: selected, origin: { x: 0, y: 0 } };

        const first = await planXiajiProjectProjectionImport(input);
        const replay = await planXiajiProjectProjectionImport({ ...input, existingNodes: first.nodes });

        expect(first.createdSourceAssetIds).toHaveLength(2);
        expect(first.nodes[0]).toEqual(existing[0]);
        expect(replay.createdSourceAssetIds).toEqual([]);
        expect(replay.reusedSourceAssetIds).toHaveLength(2);
        expect(replay.nodes).toHaveLength(existing.length + 2);
        expect(first.relationships).toHaveLength(1);
    });

    test("reuses project and manuscript nodes when episodes are imported in a later phase", async () => {
        const assets = fixture();
        const preview = await previewXiajiProjectProjection(assets, "project-1");
        const base = { canvasId: "canvas-1", assets, preview, sourceDigest: preview.sourceDigest, origin: { x: 0, y: 0 } };
        const first = await planXiajiProjectProjectionImport({ ...base, existingNodes: [], sourceAssetIds: preview.items.filter((item) => item.role !== "episode").map((item) => item.assetId) });
        const second = await planXiajiProjectProjectionImport({ ...base, existingNodes: first.nodes, sourceAssetIds: preview.items.map((item) => item.assetId) });

        expect(second.createdSourceAssetIds).toEqual(["episode-1"]);
        expect(second.reusedSourceAssetIds).toHaveLength(2);
        expect(second.nodes).toHaveLength(3);
    });

    test("requires project and manuscript and rejects a stale or foreign source selection", async () => {
        const assets = fixture();
        const preview = await previewXiajiProjectProjection(assets, "project-1");
        const base = { canvasId: "canvas-1", existingNodes: [], assets, preview, sourceDigest: preview.sourceDigest, origin: { x: 0, y: 0 } };

        await expect(planXiajiProjectProjectionImport({ ...base, sourceAssetIds: ["project-1"] })).rejects.toThrow("必须包含项目和原稿");
        await expect(planXiajiProjectProjectionImport({ ...base, sourceDigest: "stale", sourceAssetIds: preview.items.map((item) => item.assetId) })).rejects.toThrow("已变化");
        await expect(planXiajiProjectProjectionImport({ ...base, sourceAssetIds: [...preview.items.map((item) => item.assetId), "foreign"] })).rejects.toThrow("预览之外");
    });

    test("arranges only imported project nodes and adds explicit relation edges after review", async () => {
        const assets = fixture();
        const preview = await previewXiajiProjectProjection(assets, "project-1");
        const imported = await planXiajiProjectProjectionImport({ canvasId: "canvas-1", existingNodes: [], assets, preview, sourceDigest: preview.sourceDigest, sourceAssetIds: preview.items.map((item) => item.assetId), origin: { x: 0, y: 0 } });
        const userNode = { id: "user-node", type: CanvasNodeType.Text, title: "保留我的节点", position: { x: 20, y: 30 }, width: 300, height: 200 };
        const arranged = await planXiajiProjectProjectionArrangement({ canvasId: "canvas-1", projectionId: imported.projectionId, nodes: [...imported.nodes, userNode], connections: [] });

        expect(arranged.approvedNodeIds).toHaveLength(3);
        expect(arranged.addedConnectionIds).toHaveLength(2);
        expect(arranged.nodes.find((node) => node.id === userNode.id)).toEqual(userNode);
        expect(arranged.connections).toHaveLength(2);
        const replay = await planXiajiProjectProjectionArrangement({ canvasId: "canvas-1", projectionId: imported.projectionId, nodes: arranged.nodes, connections: arranged.connections });
        expect(replay.manifestDigest).toBe(arranged.manifestDigest);
        expect(replay.addedConnectionIds).toEqual([]);
        expect(replay.nodes).toEqual(arranged.nodes);
        await expect(planXiajiProjectProjectionArrangement({ canvasId: "canvas-1", projectionId: imported.projectionId, nodes: imported.nodes.map((node, index) => index === 0 ? { ...node, position: { x: 99, y: 99 } } : node), connections: [] })).rejects.toThrow("已移动");
    });
});
