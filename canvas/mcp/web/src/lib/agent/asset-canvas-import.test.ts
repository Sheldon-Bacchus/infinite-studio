// @ts-expect-error Bun supplies bun:test at runtime; the web tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { Asset } from "@/stores/use-asset-store";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildAssetCanvasImport } from "./asset-canvas-import";

const snapshot: CanvasAgentSnapshot = {
    projectId: "canvas-1",
    title: "测试画布",
    nodes: [],
    connections: [],
    selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
};

const assets: Asset[] = [
    { id: "text-1", kind: "text", title: "剧本文字", coverUrl: "", tags: ["script"], createdAt: "", updatedAt: "", data: { content: "第一场" } },
    { id: "image-1", kind: "image", title: "人物参考", coverUrl: "", tags: ["角色"], createdAt: "", updatedAt: "", data: { dataUrl: "https://local.test/person.webp", storageKey: "images/person.webp", width: 800, height: 1200, bytes: 1234, mimeType: "image/webp" } },
    { id: "video-1", kind: "video", title: "动作参考", coverUrl: "", tags: ["动作"], createdAt: "", updatedAt: "", data: { url: "https://local.test/clip.mp4", storageKey: "media/clip.mp4", width: 1920, height: 1080, bytes: 5678, mimeType: "video/mp4" } },
];

describe("MCP 本地素材导入映射", () => {
    test("将文本、图片、视频素材映射为画布节点，不创建连线", () => {
        const result = buildAssetCanvasImport(assets, ["text-1", "image-1", "video-1"], snapshot, { x: 120, y: 240 });

        expect(result.ops.map((op) => op.type)).toEqual(["add_node", "add_node", "add_node"]);
        expect(result.ops.filter((op) => op.type === "connect_nodes")).toEqual([]);
        expect(result.insertedAssetIds).toEqual(["text-1", "image-1", "video-1"]);
        expect(result.ops[0]).toMatchObject({ type: "add_node", nodeType: "text", position: { x: 120, y: 240 }, metadata: { content: "第一场", sourceEntityId: "text-1" } });
        expect(result.ops[1]).toMatchObject({ type: "add_node", nodeType: "image", position: { x: 700, y: 240 }, metadata: { content: "https://local.test/person.webp", storageKey: "images/person.webp", mimeType: "image/webp", sourceEntityId: "image-1" } });
        expect(result.ops[2]).toMatchObject({ type: "add_node", nodeType: "video", position: { x: 120, y: 660 }, metadata: { content: "https://local.test/clip.mp4", storageKey: "media/clip.mp4", mimeType: "video/mp4", sourceEntityId: "video-1" } });
    });

    test("重导入按来源素材 ID 去重，并保留其他画布节点和连线", () => {
        const existing = {
            ...snapshot,
            nodes: [{ id: "existing-image", type: "image" as const, title: "已导入人物", position: { x: 0, y: 0 }, width: 340, height: 260, metadata: { sourceEntityId: "image-1", sourceEntityType: "asset" } }],
            connections: [{ id: "edge-1", fromNodeId: "existing-image", toNodeId: "another-node" }],
        };
        const result = buildAssetCanvasImport(assets, ["image-1", "text-1"], existing);

        expect(result.duplicateAssetIds).toEqual(["image-1"]);
        expect(result.insertedAssetIds).toEqual(["text-1"]);
        expect(result.ops).toHaveLength(1);
        expect(existing.nodes).toHaveLength(1);
        expect(existing.connections).toHaveLength(1);
    });

    test("缺少素材 ID 或重复 ID 时拒绝整批操作", () => {
        expect(() => buildAssetCanvasImport(assets, ["image-1", "missing"], snapshot)).toThrow("找不到本地素材");
        expect(() => buildAssetCanvasImport(assets, ["image-1", "image-1"], snapshot)).toThrow("不能重复");
    });

    test("媒体引用缺失时报告跳过，不创建无效媒体节点", () => {
        const image = assets.find((asset) => asset.kind === "image");
        if (!image || image.kind !== "image") throw new Error("image fixture missing");
        const brokenImage: Asset = { ...image, id: "broken-image", data: { ...image.data, dataUrl: "", storageKey: undefined } };
        const result = buildAssetCanvasImport([brokenImage], ["broken-image"], snapshot);

        expect(result.ops).toEqual([]);
        expect(result.skippedAssets).toEqual([{ assetId: "broken-image", reason: "本地媒体引用缺失，无法加入画布" }]);
    });
});
