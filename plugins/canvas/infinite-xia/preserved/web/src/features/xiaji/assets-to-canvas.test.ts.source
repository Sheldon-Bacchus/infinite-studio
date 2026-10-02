// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/app/(user)/canvas/types";
import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import type { Asset } from "@/stores/use-asset-store";
import { buildLocalAssetNodes, expandCanvasGroupsToFitChildren, mergeLocalAssetNodes, nextAssetImportOrigin, resolveLocalAssetImportOrigin, sendLocalAssetsToCanvas } from "./send-to-canvas";

const common = {
    title: "雨夜素材",
    coverUrl: "",
    tags: ["雨夜", "主角"],
    category: "分镜参考",
    source: "手动添加",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
};

const assets: Asset[] = [
    { ...common, id: "text-1", kind: "text", data: { content: "车站里下起雨" } },
    { ...common, id: "image-1", kind: "image", data: { dataUrl: "/media/rain.png", storageKey: "image:rain", width: 1200, height: 800, bytes: 1024, mimeType: "image/png" } },
    { ...common, id: "video-1", kind: "video", data: { url: "/media/rain.mp4", storageKey: "file:rain-video", width: 1920, height: 1080, bytes: 2048, mimeType: "video/mp4" } },
    { ...common, id: "audio-1", kind: "audio", data: { url: "/media/rain.wav", storageKey: "file:rain-audio", bytes: 512, mimeType: "audio/wav", durationMs: 3200 } },
];

const existingNode: CanvasNodeData = {
    id: "existing",
    type: CanvasNodeType.Text,
    title: "已有节点",
    position: { x: 20, y: 30 },
    width: 300,
    height: 160,
    metadata: { content: "保留" },
};
const existingConnection: CanvasConnection = { id: "existing-edge", fromNodeId: "existing", toNodeId: "another-existing" };
const existingProject = {
    id: "project-1",
    title: "已有画布",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    nodes: [existingNode],
    connections: [existingConnection],
    chatSessions: [],
    activeChatId: null,
    agentConfig: null,
    autoTitlePending: true,
    backgroundMode: "lines" as const,
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    sidePanel: { open: true, width: 280 },
    agentPanel: { open: false, width: 464 },
} as CanvasProject;

describe("local asset canvas connector", () => {
    test("maps text, image, video, and audio assets to native canvas nodes with category and tags", () => {
        const projection = buildLocalAssetNodes(assets, { x: 100, y: 200 });
        const nodes = projection.nodes;
        expect(projection.skippedAssets).toEqual([]);

        expect(nodes.map((node) => node.type)).toEqual([
            CanvasNodeType.Text,
            CanvasNodeType.Image,
            CanvasNodeType.Video,
            CanvasNodeType.Audio,
        ]);
        expect(nodes[0].metadata).toMatchObject({ content: "车站里下起雨", category: "分镜参考", tags: ["雨夜", "主角"] });
        expect(nodes[1].metadata).toMatchObject({ content: "/media/rain.png", storageKey: "image:rain", mimeType: "image/png" });
        expect(nodes[2].metadata).toMatchObject({ content: "/media/rain.mp4", storageKey: "file:rain-video" });
        expect(nodes[3].metadata).toMatchObject({ content: "/media/rain.wav", storageKey: "file:rain-audio", durationMs: 3200 });
        expect(nodes.every((node) => node.metadata?.sourceSystem === "infinite-canvas")).toBe(true);
    });

    test("preserves XiaTang domain fields and parent/media slot references on canvas nodes", () => {
        const character: Asset = {
            ...assets[0],
            id: "character-local-1",
            title: "林夏",
            metadata: {
                xiaTang: {
                    schemaVersion: 1,
                    domain: "character",
                    recordType: "entity",
                    fields: { name: "林夏", aliases: ["夏夏"], appearance_details: "短发" },
                },
            },
        };
        const portrait: Asset = {
            ...assets[1],
            id: "character-portrait-1",
            title: "林夏肖像",
            metadata: {
                xiaTang: {
                    schemaVersion: 1,
                    domain: "character",
                    recordType: "media",
                    parentId: "character-local-1",
                    slot: "portrait",
                    versionOf: "character-portrait-0",
                },
            },
        };

        const nodes = buildLocalAssetNodes([character, portrait]).nodes;

        expect(nodes[0].metadata?.xiaTang).toEqual(character.metadata?.xiaTang);
        expect(nodes[1].metadata?.xiaTang).toEqual(portrait.metadata?.xiaTang);
        expect(nodes[1].metadata?.sourceEntityId).toBe("character-portrait-1");
    });

    test("binds imported XiaTang nodes to the canvas project and rejects foreign project assets", async () => {
        const projectAsset: Asset = { ...assets[0], id: "character-project-a", metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", projectAssetId: "xiaji-a", fields: { name: "项目甲角色" } } } };
        const boundProject = { ...existingProject, xiajiProjectAssetId: "xiaji-a" };
        let savedNodes: CanvasNodeData[] = [];
        const result = await sendLocalAssetsToCanvas({ project: boundProject, assets: [projectAsset], saveProject: async (patch) => { savedNodes = patch.nodes; } });

        expect(result.nodes.at(-1)?.metadata).toMatchObject({ xiajiProjectAssetId: "xiaji-a", sourceProjectId: "xiaji-a" });
        expect(savedNodes.at(-1)?.metadata?.sourceEntityId).toBe("character-project-a");
        await expect(sendLocalAssetsToCanvas({ project: boundProject, assets: [assets[0]], saveProject: async () => undefined })).rejects.toThrow("不属于当前虾料项目");
    });

    test("uses stable asset identity and merges without replacing canvas content or adding edges", () => {
        const imported = buildLocalAssetNodes([assets[0]]).nodes;
        const first = mergeLocalAssetNodes([existingNode], [existingConnection], imported);
        const replay = mergeLocalAssetNodes(first.nodes, first.connections, imported);

        expect(first.nodes).toHaveLength(2);
        expect(first.connections).toEqual([existingConnection]);
        expect(first.insertedAssetIds).toEqual(["text-1"]);
        expect(replay.nodes).toEqual(first.nodes);
        expect(replay.connections).toEqual(first.connections);
        expect(replay.duplicateAssetIds).toEqual(["text-1"]);
        expect(existingNode.metadata?.content).toBe("保留");
    });

    test("places imports to the right of existing nodes", () => {
        expect(nextAssetImportOrigin([])).toEqual({ x: 0, y: 0 });
        expect(nextAssetImportOrigin([{ ...existingNode, position: { x: 100, y: 50 }, width: 300 }])).toEqual({ x: 640, y: 50 });
    });

    test("keeps a preferred visible origin on empty canvases and avoids overlap on populated canvases", () => {
        const preferred = { x: 100, y: 80 };

        expect(resolveLocalAssetImportOrigin([], preferred)).toEqual(preferred);
        expect(resolveLocalAssetImportOrigin([existingNode], preferred)).toEqual({ x: 560, y: 30 });
    });

    test("reports local media without a readable reference instead of creating an empty node", () => {
        const missing: Asset = {
            ...common,
            id: "missing-image",
            kind: "image",
            data: { dataUrl: "", width: 1200, height: 800, bytes: 1024, mimeType: "image/png" },
        };
        const result = buildLocalAssetNodes([missing]);

        expect(result.nodes).toEqual([]);
        expect(result.skippedAssets).toEqual([{ assetId: "missing-image", reason: "本地媒体引用缺失，无法加入画布" }]);
    });

    test("does not project uploaded scene files that have no native canvas node type", () => {
        const sceneFile: Asset = {
            ...common,
            id: "director-world-file",
            kind: "text",
            data: { content: "world.3gs" },
            metadata: {
                xiaTang: {
                    schemaVersion: 1,
                    domain: "scene",
                    recordType: "media",
                    parentId: "scene-1",
                    slot: "director-world",
                    fields: { fileOnly: true, url: "/local/world.3gs", fileName: "world.3gs" },
                },
            },
        };

        expect(buildLocalAssetNodes([sceneFile])).toEqual({
            nodes: [],
            skippedAssets: [{ assetId: "director-world-file", reason: "此文件格式没有对应的画布节点类型；文件仍保留在虾塘本地记录中" }],
        });
    });

    test("does not resolve as a success until the existing canvas save operation resolves", async () => {
        let saved = false;
        const resultPromise = sendLocalAssetsToCanvas({
            project: existingProject,
            assets: [assets[0]],
            saveProject: async (patch) => {
                expect(patch.nodes.map((node) => node.id)).toEqual(["existing", "local-asset-text-1"]);
                expect(patch.connections).toEqual([existingConnection]);
                await Promise.resolve();
                saved = true;
            },
        });

        const result = await resultPromise;
        expect(saved).toBe(true);
        expect(result.insertedAssetIds).toEqual(["text-1"]);
    });

    test("merges into the latest canvas snapshot instead of a stale render snapshot", async () => {
        const stale = existingProject;
        const latestNode = { ...existingNode, id: "edited-after-render", title: "并发新增节点" };
        const latestEdge: CanvasConnection = { id: "latest-edge", fromNodeId: "edited-after-render", toNodeId: "existing" };
        const latest = { ...existingProject, nodes: [existingNode, latestNode], connections: [existingConnection, latestEdge] };
        const savedPatch: { current: Pick<CanvasProject, "nodes" | "connections" | "autoTitlePending"> | null } = { current: null };

        await sendLocalAssetsToCanvas({
            project: stale,
            getCurrentProject: () => latest,
            assets: [assets[0]],
            saveProject: async (patch) => { savedPatch.current = patch; },
        });

        expect(savedPatch.current?.nodes.map((node) => node.id)).toEqual(["existing", "edited-after-render", "local-asset-text-1"]);
        expect(savedPatch.current?.connections).toEqual([existingConnection, latestEdge]);
    });

    test("propagates a local canvas save failure instead of returning success", async () => {
        await expect(sendLocalAssetsToCanvas({
            project: existingProject,
            assets: [assets[0]],
            saveProject: async () => { throw new Error("local workspace unavailable"); },
        })).rejects.toThrow("local workspace unavailable");
    });

    test("keeps per-shot copies of one source asset independent and idempotent", () => {
        const source = buildLocalAssetNodes([assets[1]]).nodes[0];
        const copies = ["SHOT-05", "SHOT-06"].map((shotKey) => ({
            ...source,
            id: `${source.id}-${shotKey}`,
            metadata: {
                ...source.metadata,
                groupId: `group-${shotKey}`,
                projectionKey: `${source.metadata?.projectionKey}:instance:${shotKey}`,
            },
        }));

        const first = mergeLocalAssetNodes([], [], copies);
        const replay = mergeLocalAssetNodes(first.nodes, first.connections, copies);

        expect(first.nodes.map((node) => node.metadata?.groupId)).toEqual(["group-SHOT-05", "group-SHOT-06"]);
        expect(first.nodes.map((node) => node.metadata?.sourceEntityId)).toEqual(["image-1", "image-1"]);
        expect(replay.nodes).toEqual(first.nodes);
        expect(replay.duplicateAssetIds).toEqual(["image-1", "image-1"]);
    });

    test("expands only the requested shot group to include its imported and config children", () => {
        const groupNodes: CanvasNodeData[] = [
            { id: "group-05", type: CanvasNodeType.Group, title: "EP001 SHOT-05", position: { x: 0, y: 0 }, width: 800, height: 500 },
            { id: "group-06", type: CanvasNodeType.Group, title: "EP001 SHOT-06", position: { x: 1000, y: 0 }, width: 800, height: 500 },
            { ...existingNode, id: "new-child", position: { x: 100, y: 650 }, width: 440, height: 240, metadata: { groupId: "group-05" } },
        ];
        const next = expandCanvasGroupsToFitChildren(groupNodes, new Set(["group-05"]));

        expect(next.find((node) => node.id === "group-05")?.position.y).toBeLessThanOrEqual(626);
        expect(next.find((node) => node.id === "group-05")?.position.y! + next.find((node) => node.id === "group-05")!.height).toBeGreaterThanOrEqual(914);
        expect(next.find((node) => node.id === "group-06")).toEqual(groupNodes[1]);
    });
});
