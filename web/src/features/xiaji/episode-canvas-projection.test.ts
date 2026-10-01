// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { Asset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/app/(user)/canvas/types";
import { createXiajiProjectionIdentity, previewXiajiEpisodeContextTool, previewXiajiEpisodeProjection, validateXiajiProjectionSelection } from "./episode-canvas-projection";
import { planXiajiProjectionImport, verifyXiajiProjectionMediaReadability, XiajiProjectionImportError, type XiajiProjectionImportRequest } from "./episode-canvas-projection-import";
import { planXiajiProjectionArrangement, XiajiProjectionArrangeError } from "./episode-canvas-projection-arrange";

function createFixture(): Asset[] {
    const projectId = "project-1";
    const episodeId = "episode-1";
    const project: Asset = {
        id: projectId,
        kind: "text",
        title: "夜航",
        coverUrl: "",
        tags: [],
        category: "xiaji:project",
        source: "test",
        data: { content: "" },
        createdAt: "2026-09-25",
        updatedAt: "2026-09-25",
        metadata: { localStudio: { schemaVersion: 1, recordType: "project", projectType: "短剧", baseStyle: "写实", sourceAssetId: "source-1" } },
    };
    const episode: Asset = {
        id: episodeId,
        kind: "text",
        title: "第一集",
        coverUrl: "",
        tags: [],
        category: "xiaji:episode",
        source: "test",
        data: { content: "林雨抵达港口" },
        createdAt: "2026-09-25",
        updatedAt: "2026-09-25",
        metadata: { localStudio: { schemaVersion: 1, recordType: "episode", projectAssetId: projectId, order: 1, title: "第一集", synopsis: "夜里抵达", scriptAssetId: "script-1", currentBeatAssetIds: ["beat-1", "beat-2"] } },
    };
    const script: Asset = {
        id: "script-1",
        kind: "text",
        title: "第一集剧本",
        coverUrl: "",
        tags: [],
        category: "xiaji:script",
        source: "test",
        data: { content: "外景，港口，夜。林雨下车。" },
        createdAt: "2026-09-25",
        updatedAt: "2026-09-25",
        metadata: { localStudio: { schemaVersion: 1, recordType: "script", projectAssetId: projectId, episodeAssetId: episodeId, documentKind: "script" } },
    };
    const beat1: Asset = {
        id: "beat-1",
        kind: "text",
        title: "港口抵达",
        coverUrl: "",
        tags: [],
        category: "xiaji:beat",
        source: "test",
        data: { content: "远景：雾中港口，林雨下车。" },
        createdAt: "2026-09-25",
        updatedAt: "2026-09-25",
        metadata: { localStudio: { schemaVersion: 1, recordType: "beat", projectAssetId: projectId, episodeAssetId: episodeId, order: 1, dialogueText: "我回来了。", referencedAssetIds: ["character-1"] } },
    };
    const beat2: Asset = {
        id: "beat-2",
        kind: "text",
        title: "旧仓库",
        coverUrl: "",
        tags: [],
        category: "xiaji:beat",
        source: "test",
        data: { content: "近景：林雨望向旧仓库。" },
        createdAt: "2026-09-25",
        updatedAt: "2026-09-25",
        metadata: { localStudio: { schemaVersion: 1, recordType: "beat", projectAssetId: projectId, episodeAssetId: episodeId, order: 2, referencedAssetIds: ["character-1"] } },
    };
    const character: Asset = {
        id: "character-1",
        kind: "text",
        title: "林雨",
        coverUrl: "",
        tags: ["主角"],
        category: "xia-tang:character",
        source: "test",
        data: { content: "林雨" },
        createdAt: "2026-09-25",
        updatedAt: "2026-09-25",
        metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", projectAssetId: projectId, fields: { name: "林雨", mediaCurrentBySlot: { portrait: "media-1" } } } },
    };
    const media: Asset = {
        id: "media-1",
        kind: "image",
        title: "林雨肖像",
        coverUrl: "/portrait.png",
        tags: [],
        category: "xia-tang:character",
        source: "test",
        data: { dataUrl: "/portrait.png", storageKey: "image:portrait", width: 512, height: 512, bytes: 1200, mimeType: "image/png" },
        createdAt: "2026-09-25",
        updatedAt: "2026-09-25",
        metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "media", parentId: "character-1", projectAssetId: projectId, slot: "portrait", fields: { fileOnly: false } } },
    };
    const oldScript: Asset = { ...script, id: "script-v1", title: "旧版剧本", data: { content: "旧版文本" }, metadata: { localStudio: { schemaVersion: 1, recordType: "script", projectAssetId: projectId, episodeAssetId: episodeId, documentKind: "script", version: 1, approvalState: "superseded", supersededByAssetId: "script-1" } } };
    const oldBeat: Asset = { ...beat1, id: "beat-1-v1", title: "旧版镜头", data: { content: "旧版画面" }, metadata: { localStudio: { schemaVersion: 1, recordType: "beat", projectAssetId: projectId, episodeAssetId: episodeId, order: 1, referencedAssetIds: [], version: 1, approvalState: "superseded", supersededByAssetId: "beat-1" } } };
    return [beat2, media, project, character, script, episode, beat1, oldScript, oldBeat];
}

describe("Xiaji episode canvas projection", () => {
    test("previews the saved script and every Beat in order with their exact text and references", async () => {
        const preview = await previewXiajiEpisodeProjection(createFixture(), "project-1", "episode-1");

        expect(preview.issues).toEqual([]);
        expect(preview.script).toMatchObject({ assetId: "script-1", content: "外景，港口，夜。林雨下车。", documentKind: "script" });
        expect(preview.beats).toEqual([
            { assetId: "beat-1", order: 1, title: "港口抵达", content: "远景：雾中港口，林雨下车。", dialogueText: "我回来了。", referencedAssetIds: ["character-1"] },
            { assetId: "beat-2", order: 2, title: "旧仓库", content: "近景：林雨望向旧仓库。", referencedAssetIds: ["character-1"] },
        ]);
        expect(preview.requiredSourceAssetIds).not.toContain("script-v1");
        expect(preview.requiredSourceAssetIds).not.toContain("beat-1-v1");
        expect(preview.references).toEqual([
            expect.objectContaining({
                assetId: "character-1",
                domain: "character",
                recordType: "entity",
                selectedMedia: [{ assetId: "media-1", kind: "image", slot: "portrait", readability: "unverified" }],
            }),
        ]);
        expect(preview.requiredSourceAssetIds).toEqual(["script-1", "beat-1", "beat-2"]);
        expect(preview.referencedSourceAssetIds).toEqual(["character-1"]);
        expect(preview.selectedMediaAssetIds).toEqual(["media-1"]);
        expect(preview.importableSourceAssetIds).toEqual(["script-1", "beat-1", "beat-2", "character-1", "media-1"]);
        expect(preview.plannedEdges).toEqual([
            { fromRole: "script", fromAssetId: "script-1", toRole: "beat", toAssetId: "beat-1" },
            { fromRole: "beat", fromAssetId: "beat-1", toRole: "beat", toAssetId: "beat-2" },
            { fromRole: "beat", fromAssetId: "beat-1", toRole: "asset", toAssetId: "character-1" },
            { fromRole: "beat", fromAssetId: "beat-2", toRole: "asset", toAssetId: "character-1" },
            { fromRole: "asset", fromAssetId: "character-1", toRole: "asset", toAssetId: "media-1" },
        ]);
        expect(preview.completeEligible).toBe(true);
        expect(preview.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    test("serializes a useful MCP preview without exposing local media URLs or storage keys", async () => {
        const assets = createFixture();
        const before = structuredClone(assets);
        const preview = await previewXiajiEpisodeProjection(assets, "project-1", "episode-1");
        const response = await previewXiajiEpisodeContextTool(assets, "project-1", "episode-1");
        const encoded = JSON.stringify(response);

        expect(response).toMatchObject({ ok: true, status: "ready", sourceDigest: preview.sourceDigest, completeEligible: true });
        expect(assets).toEqual(before);
        expect(response).toHaveProperty("beats");
        expect(response).toHaveProperty("plannedEdges");
        expect(encoded).not.toContain("/portrait.png");
        expect(encoded).not.toContain("image:portrait");
    });

    test("blocks when the episode is foreign or its linked script is missing or ambiguous", async () => {
        const assets = createFixture();
        const foreign = await previewXiajiEpisodeProjection(assets, "other-project", "episode-1");
        expect(foreign.issues.map((issue) => issue.code)).toContain("episode-project-mismatch");

        const missingScript = await previewXiajiEpisodeProjection(
            assets.filter((asset) => asset.id !== "script-1"),
            "project-1",
            "episode-1",
        );
        expect(missingScript.issues.map((issue) => issue.code)).toContain("missing-script");

        const duplicate: Asset = {
            ...assets.find((asset) => asset.id === "script-1")!,
            id: "script-duplicate",
            title: "重复剧本",
            metadata: { localStudio: { schemaVersion: 1, recordType: "script", projectAssetId: "project-1", episodeAssetId: "episode-1", documentKind: "script" } },
        };
        const ambiguous = await previewXiajiEpisodeProjection([...assets, duplicate], "project-1", "episode-1");
        expect(ambiguous.issues.map((issue) => issue.code)).toContain("ambiguous-script");
    });

    test("blocks duplicate Beat order and missing or cross-project references", async () => {
        const assets = createFixture();
        const duplicateOrder = assets.map((asset) => (asset.id === "beat-2" ? ({ ...asset, metadata: { localStudio: { ...(asset.metadata?.localStudio as Record<string, unknown>), order: 1 } } } as Asset) : asset));
        const duplicate = await previewXiajiEpisodeProjection(duplicateOrder, "project-1", "episode-1");
        expect(duplicate.issues.map((issue) => issue.code)).toContain("duplicate-beat-order");

        const missingReference = assets.map((asset) => (asset.id === "beat-1" ? ({ ...asset, metadata: { localStudio: { ...(asset.metadata?.localStudio as Record<string, unknown>), referencedAssetIds: ["absent"] } } } as Asset) : asset));
        const missing = await previewXiajiEpisodeProjection(missingReference, "project-1", "episode-1");
        expect(missing.issues.map((issue) => issue.code)).toContain("missing-referenced-asset");

        const foreignReference = assets.map((asset) => (asset.id === "character-1" ? ({ ...asset, metadata: { xiaTang: { ...(asset.metadata?.xiaTang as Record<string, unknown>), projectAssetId: "other-project" } } } as Asset) : asset));
        const foreign = await previewXiajiEpisodeProjection(foreignReference, "project-1", "episode-1");
        expect(foreign.issues.map((issue) => issue.code)).toContain("foreign-referenced-asset");
    });

    test("ignores malformed Beats from unrelated projects and episodes", async () => {
        const assets = createFixture();
        const foreignBeat: Asset = {
            ...assets.find((asset) => asset.id === "beat-1")!,
            id: "foreign-malformed-beat",
            metadata: {
                localStudio: {
                    schemaVersion: 1,
                    recordType: "beat",
                    projectAssetId: "other-project",
                    episodeAssetId: "other-episode",
                    order: 0,
                    referencedAssetIds: [],
                },
            },
        };

        const preview = await previewXiajiEpisodeProjection([...assets, foreignBeat], "project-1", "episode-1");

        expect(preview.issues).toEqual([]);
    });

    test("reports file-only selected media and does not claim a complete projection", async () => {
        const assets = createFixture().map((asset) => (asset.id === "media-1" ? ({ ...asset, metadata: { xiaTang: { ...(asset.metadata?.xiaTang as Record<string, unknown>), fields: { fileOnly: true } } } } as Asset) : asset));
        const preview = await previewXiajiEpisodeProjection(assets, "project-1", "episode-1");

        expect(preview.selectedMediaAssetIds).toEqual(["media-1"]);
        expect(preview.importableSourceAssetIds).not.toContain("media-1");
        expect(preview.skippedItems).toContainEqual(expect.objectContaining({ assetId: "media-1", code: "file-only" }));
        expect(preview.completeEligible).toBe(false);
    });

    test("requires an exact complete closure while allowing an explicit selected subset as partial", async () => {
        const preview = await previewXiajiEpisodeProjection(createFixture(), "project-1", "episode-1");

        expect(validateXiajiProjectionSelection(preview, "complete", preview.importableSourceAssetIds)).toEqual([]);
        expect(validateXiajiProjectionSelection(preview, "complete", ["script-1", "beat-1"])).toContainEqual(expect.objectContaining({ code: "incomplete-closure" }));
        expect(validateXiajiProjectionSelection(preview, "selected", ["script-1", "beat-1"])).toEqual([]);
        expect(validateXiajiProjectionSelection(preview, "selected", ["script-1"])).toContainEqual(expect.objectContaining({ code: "missing-selected-beat" }));
    });

    test("uses stable SHA-256 source and projection identities independent of input order and timestamps", async () => {
        const assets = createFixture();
        const preview = await previewXiajiEpisodeProjection(assets, "project-1", "episode-1");
        const reordered = await previewXiajiEpisodeProjection(
            [...assets].reverse().map((asset) => ({ ...asset, updatedAt: "later" })),
            "project-1",
            "episode-1",
        );
        const changed = await previewXiajiEpisodeProjection(
            assets.map((asset) => (asset.id === "beat-1" ? ({ ...asset, data: { content: "内容已修订" } } as Asset) : asset)),
            "project-1",
            "episode-1",
        );
        const changedMedia = await previewXiajiEpisodeProjection(
            assets.map((asset) => (asset.id === "media-1" ? ({ ...asset, data: { ...asset.data, dataUrl: "/portrait-v2.png" } } as Asset) : asset)),
            "project-1",
            "episode-1",
        );

        expect(reordered.sourceDigest).toBe(preview.sourceDigest);
        expect(changed.sourceDigest).not.toBe(preview.sourceDigest);
        expect(changedMedia.sourceDigest).not.toBe(preview.sourceDigest);
        const identity = await createXiajiProjectionIdentity("canvas-1", preview, "complete", preview.importableSourceAssetIds);
        const repeated = await createXiajiProjectionIdentity("canvas-1", preview, "complete", [...preview.importableSourceAssetIds].reverse());
        expect(identity.projectionId).toMatch(/^xiaji:[a-f0-9]{64}$/);
        expect(repeated).toEqual(identity);
        expect(identity.nodeIds["script-1"]).toMatch(/^xiaji-node-[a-f0-9]{32}$/);
    });
});

describe("Xiaji projection import planning", () => {
    async function request(overrides: Partial<XiajiProjectionImportRequest> = {}): Promise<XiajiProjectionImportRequest> {
        const assets = overrides.assets || createFixture();
        const preview = overrides.preview || (await previewXiajiEpisodeProjection(assets, "project-1", "episode-1"));
        return {
            assets,
            canvasId: "canvas-1",
            existingNodes: [],
            preview,
            sourceDigest: preview.sourceDigest,
            mode: "complete",
            sourceAssetIds: preview.importableSourceAssetIds,
            changedSourcePolicy: "create-new",
            idempotencyKey: "approval-1",
            verifiedMediaAssetIds: ["media-1"],
            origin: { x: 100, y: 200 },
            ...overrides,
        };
    }

    test("creates only approved script, Beat, and referenced asset nodes with durable projection metadata and no edges", async () => {
        const input = await request();
        const plan = await planXiajiProjectionImport(input);

        expect(plan.projectionId).toMatch(/^xiaji:[a-f0-9]{64}$/);
        expect(plan.mode).toBe("complete");
        expect(plan.nodes).toHaveLength(input.sourceAssetIds.length);
        expect(plan.createdSourceAssetIds).toEqual(input.sourceAssetIds);
        expect(plan.reusedSourceAssetIds).toEqual([]);
        expect(plan.nodes.map((node) => node.metadata?.projectionRole)).toEqual(["script", "beat", "beat", "asset", "asset"]);
        expect(plan.nodes[0]).toMatchObject({ type: CanvasNodeType.Text, title: "第一集剧本", metadata: { content: "外景，港口，夜。林雨下车。", sourceEntityId: "script-1", projectionId: plan.projectionId } });
        expect(plan.nodes[1].metadata).toMatchObject({ sourceEntityId: "beat-1", localStudio: { order: 1, dialogueText: "我回来了。" } });
        expect(plan.nodes[3].metadata).toMatchObject({ sourceEntityId: "character-1", xiaTang: { domain: "character", recordType: "entity" } });
        expect(plan.nodes[4].metadata).toMatchObject({ sourceEntityId: "media-1", content: "/portrait.png", storageKey: "image:portrait", projectionRole: "asset" });
        expect(plan.nodes.every((node) => node.metadata?.sourceItemDigest && node.metadata?.projectionKey && node.metadata?.projectionManifestDigest === plan.manifestDigest)).toBe(true);
        expect(plan.nodes.map((node) => node.position)).toEqual([
            { x: 100, y: 200 },
            { x: 680, y: 200 },
            { x: 100, y: 620 },
            { x: 680, y: 620 },
            { x: 100, y: 1040 },
        ]);
    });

    test("rejects stale previews and unverified media before returning any Canvas mutation", async () => {
        const input = await request();
        const before = structuredClone(input.existingNodes);
        await expect(planXiajiProjectionImport({ ...input, sourceDigest: "stale" })).rejects.toBeInstanceOf(XiajiProjectionImportError);
        await expect(planXiajiProjectionImport({ ...input, verifiedMediaAssetIds: [] })).rejects.toThrow("媒体可读性尚未验证");
        expect(input.existingNodes).toEqual(before);
    });

    test("verifies each approved media reference and reports unreadable or missing Asset IDs", async () => {
        const assets = createFixture();
        const result = await verifyXiajiProjectionMediaReadability(assets, ["character-1", "media-1", "missing-media"], async (asset) => asset.id === "media-1");

        expect(result.verifiedMediaAssetIds).toEqual(["media-1"]);
        expect(result.failedItems).toEqual([{ assetId: "missing-media", reason: "本地素材已不存在" }]);
        const unreadable = await verifyXiajiProjectionMediaReadability(assets, ["media-1"], async () => false);
        expect(unreadable.failedItems).toEqual([{ assetId: "media-1", reason: "媒体引用无法读取" }]);
    });

    test("reuses only an identical projection and preserves generic imports with the same source Asset ID", async () => {
        const input = await request();
        const first = await planXiajiProjectionImport(input);
        const replay = await planXiajiProjectionImport({ ...input, existingNodes: first.nodes });

        expect(replay.nodes).toEqual(first.nodes);
        expect(replay.createdSourceAssetIds).toEqual([]);
        expect(replay.reusedSourceAssetIds).toEqual(input.sourceAssetIds);

        const generic: CanvasNodeData = {
            id: "ordinary-character-import",
            type: CanvasNodeType.Text,
            title: "普通导入的林雨",
            position: { x: -400, y: 10 },
            width: 300,
            height: 160,
            metadata: { content: "手动编辑的节点", sourceSystem: "infinite-canvas", sourceEntityType: "asset", sourceEntityId: "character-1", projectionKey: "infinite-canvas:asset:character-1" },
        };
        const withGeneric = await planXiajiProjectionImport({ ...input, existingNodes: [generic] });
        expect(withGeneric.nodes[0]).toEqual(generic);
        expect(withGeneric.createdSourceAssetIds).toEqual(input.sourceAssetIds);
    });

    test("keeps older projection nodes intact when source changes and applies the explicit source-change policy", async () => {
        const input = await request();
        const first = await planXiajiProjectionImport(input);
        const changedAssets = input.assets.map((asset) => (asset.id === "beat-1" ? ({ ...asset, data: { content: "镜头正文的新版本" } } as Asset) : asset));
        const changedPreview = await previewXiajiEpisodeProjection(changedAssets, "project-1", "episode-1");
        const changedRequest = await request({ ...input, assets: changedAssets, preview: changedPreview, sourceDigest: changedPreview.sourceDigest, existingNodes: first.nodes, idempotencyKey: "approval-2" });

        await expect(planXiajiProjectionImport({ ...changedRequest, changedSourcePolicy: "reject" })).rejects.toThrow("检测到已有不同来源摘要的投影");
        const next = await planXiajiProjectionImport({ ...changedRequest, changedSourcePolicy: "create-new" });
        expect(next.projectionId).not.toBe(first.projectionId);
        expect(next.nodes.slice(0, first.nodes.length)).toEqual(first.nodes);
        expect(next.createdSourceAssetIds).toEqual(changedRequest.sourceAssetIds);
    });

    test("rejects edited projection members, reused idempotency keys with changed arguments, and node ID collisions", async () => {
        const input = await request();
        const first = await planXiajiProjectionImport(input);
        const edited = first.nodes.map((node) => (node.metadata?.sourceEntityId === "beat-1" ? { ...node, metadata: { ...node.metadata, content: "用户已经编辑" } } : node));
        await expect(planXiajiProjectionImport({ ...input, existingNodes: edited })).rejects.toThrow("投影节点内容已被修改");
        await expect(planXiajiProjectionImport({ ...input, mode: "selected", idempotencyKey: input.idempotencyKey, existingNodes: first.nodes })).rejects.toThrow("幂等键已用于不同导入参数");
        const collision: CanvasNodeData = {
            id: first.nodes[0].id,
            type: CanvasNodeType.Text,
            title: "占用 ID",
            position: { x: 0, y: 0 },
            width: 10,
            height: 10,
            metadata: { content: "不属于虾镜投影" },
        };
        await expect(planXiajiProjectionImport({ ...input, existingNodes: [collision] })).rejects.toThrow("节点 ID 冲突");
    });

    test("rejects an idempotency key reused by another episode on the same canvas", async () => {
        const firstInput = await request();
        const first = await planXiajiProjectionImport(firstInput);
        const episode = firstInput.assets.find((asset) => asset.id === "episode-1")!;
        const script = firstInput.assets.find((asset) => asset.id === "script-1")!;
        const beat = firstInput.assets.find((asset) => asset.id === "beat-1")!;
        const episodeMetadata = episode.metadata?.localStudio as Record<string, unknown>;
        const scriptMetadata = script.metadata?.localStudio as Record<string, unknown>;
        const beatMetadata = beat.metadata?.localStudio as Record<string, unknown>;
        const secondEpisode: Asset = {
            ...episode,
            id: "episode-2",
            title: "第二集",
            metadata: { localStudio: { ...episodeMetadata, order: 2, title: "第二集", scriptAssetId: "script-2", currentBeatAssetIds: ["beat-3"] } },
        };
        const secondScript: Asset = {
            ...script,
            id: "script-2",
            title: "第二集剧本",
            metadata: { localStudio: { ...scriptMetadata, episodeAssetId: "episode-2" } },
        };
        const secondBeat: Asset = {
            ...beat,
            id: "beat-3",
            title: "第二集镜头",
            metadata: { localStudio: { ...beatMetadata, episodeAssetId: "episode-2", order: 1 } },
        };
        const assets = [...firstInput.assets, secondEpisode, secondScript, secondBeat];
        const preview = await previewXiajiEpisodeProjection(assets, "project-1", "episode-2");
        const secondInput = await request({
            assets,
            preview,
            sourceAssetIds: preview.importableSourceAssetIds,
            existingNodes: first.nodes,
            idempotencyKey: firstInput.idempotencyKey,
        });

        await expect(planXiajiProjectionImport(secondInput)).rejects.toThrow("幂等键已用于不同导入参数");
    });
});

describe("Xiaji projection arrangement planning", () => {
    async function imported(mode: "complete" | "selected" = "complete", sourceAssetIds?: string[]) {
        const assets = createFixture();
        const preview = await previewXiajiEpisodeProjection(assets, "project-1", "episode-1");
        const approved = sourceAssetIds || preview.importableSourceAssetIds;
        const importedPlan = await planXiajiProjectionImport({
            assets,
            canvasId: "canvas-1",
            existingNodes: [],
            preview,
            sourceDigest: preview.sourceDigest,
            mode,
            sourceAssetIds: approved,
            changedSourcePolicy: "create-new",
            idempotencyKey: `import-${mode}`,
            verifiedMediaAssetIds: ["media-1"],
            origin: { x: 50, y: 80 },
        });
        return { assets, preview, importedPlan };
    }

    test("rebuilds the unique saved projection, places one stable group, and connects script, ordered Beats, explicit references, and selected media", async () => {
        const { importedPlan } = await imported();
        const outside: CanvasNodeData = {
            id: "outside",
            type: CanvasNodeType.Text,
            title: "用户节点",
            position: { x: 20, y: 40 },
            width: 300,
            height: 160,
            metadata: { content: "保留" },
        };
        const outsideEdge: CanvasConnection = { id: "outside-edge", fromNodeId: "outside", toNodeId: "other" };
        const request = { canvasId: "canvas-1", projectionId: importedPlan.projectionId, idempotencyKey: "arrange-1", nodes: [outside, ...importedPlan.nodes], connections: [outsideEdge] };
        const plan = await planXiajiProjectionArrangement(request);
        const group = plan.nodes.find((node) => node.id === plan.groupNodeId)!;

        expect(group).toMatchObject({ type: CanvasNodeType.Group, metadata: { projectionId: plan.projectionId, projectionRole: "group", projectionManifestDigest: plan.manifestDigest } });
        expect(plan.nodes.find((node) => node.id === "outside")).toEqual(outside);
        expect(plan.connections.find((edge) => edge.id === "outside-edge")).toEqual(outsideEdge);
        expect(plan.createdConnectionIds).toHaveLength(5);
        expect(plan.connections.filter((edge) => edge.id !== outsideEdge.id).map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId])).toContainEqual([
            plan.nodes.find((node) => node.metadata?.sourceEntityId === "character-1")!.id,
            plan.nodes.find((node) => node.metadata?.sourceEntityId === "media-1")!.id,
        ]);
        expect(plan.nodes.filter((node) => node.metadata?.projectionId === plan.projectionId && node.type !== CanvasNodeType.Group).every((node) => node.metadata?.groupId === plan.groupNodeId)).toBe(true);
        expect(plan.missingEdges).toEqual([]);
    });

    test("is idempotent after refresh and rejects an edited projected node or duplicate/missing member", async () => {
        const { importedPlan } = await imported();
        const request = { canvasId: "canvas-1", projectionId: importedPlan.projectionId, idempotencyKey: "arrange-1", nodes: importedPlan.nodes, connections: [] };
        const first = await planXiajiProjectionArrangement(request);
        const replay = await planXiajiProjectionArrangement({ ...request, nodes: first.nodes, connections: first.connections });

        expect(replay.nodes).toEqual(first.nodes);
        expect(replay.connections).toEqual(first.connections);
        expect(replay.createdConnectionIds).toEqual([]);
        expect(replay.movedNodeIds).toEqual([]);

        const moved = first.nodes.map((node) => (node.metadata?.sourceEntityId === "beat-1" ? { ...node, position: { ...node.position, x: node.position.x + 1 } } : node));
        await expect(planXiajiProjectionArrangement({ ...request, nodes: moved, connections: first.connections })).rejects.toBeInstanceOf(XiajiProjectionArrangeError);
        await expect(planXiajiProjectionArrangement({ ...request, nodes: first.nodes.filter((node) => node.metadata?.sourceEntityId !== "beat-2"), connections: first.connections })).rejects.toThrow("投影节点缺失");
    });

    test("rejects a saved anchor whose Beat order repeats even when source IDs remain unique", async () => {
        const { importedPlan } = await imported();
        const corrupted = importedPlan.nodes.map((node) =>
            node.metadata?.projectionRole === "script"
                ? {
                      ...node,
                      metadata: {
                          ...node.metadata,
                          projectionBeatOrder: [
                              { assetId: "beat-1", order: 1 },
                              { assetId: "beat-2", order: 1 },
                          ],
                      },
                  }
                : node,
        );
        await expect(planXiajiProjectionArrangement({ canvasId: "canvas-1", projectionId: importedPlan.projectionId, idempotencyKey: "duplicate-order", nodes: corrupted, connections: [] })).rejects.toThrow("分镜顺序无效或重复");
    });

    test("detects tampering with an omitted Beat order stored only in the projection anchor", async () => {
        const assets = createFixture();
        const episode = assets.find((asset) => asset.id === "episode-1")!;
        episode.metadata = { ...episode.metadata, localStudio: { ...(episode.metadata?.localStudio as Record<string, unknown>), currentBeatAssetIds: ["beat-1", "beat-2", "beat-3"] } };
        assets.push({
            ...assets.find((asset) => asset.id === "beat-2")!,
            id: "beat-3",
            title: "旧船离港",
            kind: "text",
            data: { content: "林雨登船。" },
            metadata: { localStudio: { schemaVersion: 1, recordType: "beat", projectAssetId: "project-1", episodeAssetId: "episode-1", order: 3, referencedAssetIds: ["character-1"] } },
        } as unknown as Asset);
        const preview = await previewXiajiEpisodeProjection(assets, "project-1", "episode-1");
        const sourceAssetIds = ["script-1", "beat-1", "beat-3", "character-1"];
        const importedPlan = await planXiajiProjectionImport({
            assets,
            canvasId: "canvas-1",
            existingNodes: [],
            preview,
            sourceDigest: preview.sourceDigest,
            mode: "selected",
            sourceAssetIds,
            changedSourcePolicy: "create-new",
            idempotencyKey: "anchor-order",
            verifiedMediaAssetIds: [],
        });
        const corrupted = importedPlan.nodes.map((node) =>
            node.metadata?.projectionRole === "script" ? { ...node, metadata: { ...node.metadata, projectionBeatOrder: node.metadata.projectionBeatOrder?.map((item) => (item.assetId === "beat-2" ? { ...item, order: 99 } : item)) } } : node,
        );
        await expect(planXiajiProjectionArrangement({ canvasId: "canvas-1", projectionId: importedPlan.projectionId, idempotencyKey: "anchor-order-2", nodes: corrupted, connections: [] })).rejects.toThrow("锚点摘要与保存的顺序清单不一致");
    });

    test("does not connect across an excluded Beat in selected mode and reports the omitted sequence relationships", async () => {
        const assets = [...createFixture()];
        const episode = assets.find((asset) => asset.id === "episode-1")!;
        episode.metadata = { ...episode.metadata, localStudio: { ...(episode.metadata?.localStudio as Record<string, unknown>), currentBeatAssetIds: ["beat-1", "beat-2", "beat-3"] } };
        const beat3: Asset = {
            ...assets.find((asset) => asset.id === "beat-2")!,
            id: "beat-3",
            title: "旧船离港",
            kind: "text",
            data: { content: "林雨登船。" },
            metadata: { localStudio: { schemaVersion: 1, recordType: "beat", projectAssetId: "project-1", episodeAssetId: "episode-1", order: 3, referencedAssetIds: ["character-1"] } },
        } as unknown as Asset;
        assets.push(beat3);
        const preview = await previewXiajiEpisodeProjection(assets, "project-1", "episode-1");
        const sourceAssetIds = ["script-1", "beat-1", "beat-3", "character-1"];
        const projection = await planXiajiProjectionImport({
            assets,
            canvasId: "canvas-1",
            existingNodes: [],
            preview,
            sourceDigest: preview.sourceDigest,
            mode: "selected",
            sourceAssetIds,
            changedSourcePolicy: "create-new",
            idempotencyKey: "partial-import",
            verifiedMediaAssetIds: [],
        });
        const plan = await planXiajiProjectionArrangement({ canvasId: "canvas-1", projectionId: projection.projectionId, idempotencyKey: "partial-arrange", nodes: projection.nodes, connections: [] });
        const beat1Id = plan.nodes.find((node) => node.metadata?.sourceEntityId === "beat-1")!.id;
        const beat3Id = plan.nodes.find((node) => node.metadata?.sourceEntityId === "beat-3")!.id;

        expect(plan.connections.some((edge) => edge.fromNodeId === beat1Id && edge.toNodeId === beat3Id)).toBe(false);
        expect(plan.missingEdges).toContainEqual(expect.objectContaining({ kind: "beat-sequence", fromSourceAssetId: "beat-1", toSourceAssetId: "beat-2" }));
        expect(plan.missingEdges).toContainEqual(expect.objectContaining({ kind: "beat-sequence", fromSourceAssetId: "beat-2", toSourceAssetId: "beat-3" }));
    });

    test("reports omitted current media and refuses to move a node before the first approved arrangement", async () => {
        const { importedPlan } = await imported("selected", ["script-1", "beat-1", "beat-2", "character-1"]);
        const plan = await planXiajiProjectionArrangement({ canvasId: "canvas-1", projectionId: importedPlan.projectionId, idempotencyKey: "partial-arrange", nodes: importedPlan.nodes, connections: [] });
        expect(plan.missingEdges).toContainEqual({ kind: "asset-media", fromSourceAssetId: "character-1", toSourceAssetId: "media-1", reason: "source-not-selected" });

        const movedBeforeArrange = importedPlan.nodes.map((node) => (node.metadata?.sourceEntityId === "beat-1" ? { ...node, position: { x: node.position.x + 2, y: node.position.y } } : node));
        await expect(planXiajiProjectionArrangement({ canvasId: "canvas-1", projectionId: importedPlan.projectionId, idempotencyKey: "partial-arrange-2", nodes: movedBeforeArrange, connections: [] })).rejects.toThrow("导入后节点已被手动移动");
        const alreadyGrouped = importedPlan.nodes.map((node) => (node.metadata?.sourceEntityId === "beat-1" ? { ...node, metadata: { ...node.metadata, groupId: "user-group" } } : node));
        await expect(planXiajiProjectionArrangement({ canvasId: "canvas-1", projectionId: importedPlan.projectionId, idempotencyKey: "partial-arrange-3", nodes: alreadyGrouped, connections: [] })).rejects.toThrow("已加入其他分组");
    });

    test("reconstructs stable source digests for text, image, audio, and video projection nodes", async () => {
        const assets = createFixture();
        const character = assets.find((asset) => asset.id === "character-1")!;
        character.metadata = { ...character.metadata, xiaTang: { ...(character.metadata?.xiaTang as object), fields: { name: "林雨", mediaCurrentBySlot: { portrait: "media-1", voice: "audio-1", referenceVideo: "video-1" } } } };
        assets.push(
            {
                id: "audio-1",
                kind: "audio",
                title: "林雨声线",
                coverUrl: "",
                tags: [],
                category: "xia-tang:character",
                source: "test",
                data: { url: "/voice.mp3", storageKey: "audio:voice", bytes: 400, mimeType: "audio/mpeg", durationMs: 0 },
                createdAt: "2026-09-25",
                updatedAt: "2026-09-25",
                metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "media", parentId: "character-1", projectAssetId: "project-1", slot: "voice", fields: { fileOnly: false } } },
            },
            {
                id: "video-1",
                kind: "video",
                title: "林雨参考视频",
                coverUrl: "",
                tags: [],
                category: "xia-tang:character",
                source: "test",
                data: { url: "/reference.mp4", storageKey: "video:reference", width: 1920, height: 1080, bytes: 9000, mimeType: "video/mp4" },
                createdAt: "2026-09-25",
                updatedAt: "2026-09-25",
                metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "media", parentId: "character-1", projectAssetId: "project-1", slot: "referenceVideo", fields: { fileOnly: false } } },
            },
        );
        const preview = await previewXiajiEpisodeProjection(assets, "project-1", "episode-1");
        const sourceAssetIds = preview.importableSourceAssetIds;
        const importedPlan = await planXiajiProjectionImport({
            assets,
            canvasId: "canvas-1",
            existingNodes: [],
            preview,
            sourceDigest: preview.sourceDigest,
            mode: "complete",
            sourceAssetIds,
            changedSourcePolicy: "create-new",
            idempotencyKey: "all-media",
            verifiedMediaAssetIds: ["media-1", "audio-1", "video-1"],
        });
        const arranged = await planXiajiProjectionArrangement({ canvasId: "canvas-1", projectionId: importedPlan.projectionId, idempotencyKey: "all-media-layout", nodes: importedPlan.nodes, connections: [] });

        expect(arranged.missingEdges).toEqual([]);
        expect(arranged.createdConnectionIds).toHaveLength(7);
        expect(arranged.nodes.find((node) => node.metadata?.sourceEntityId === "audio-1")?.metadata).toMatchObject({ durationMs: 0, storageKey: "audio:voice" });
        expect(arranged.nodes.find((node) => node.metadata?.sourceEntityId === "video-1")?.metadata).toMatchObject({ naturalWidth: 1920, naturalHeight: 1080, storageKey: "video:reference" });
    });

    test("reuses user-created endpoint edges and rejects deterministic connection ID collisions", async () => {
        const { importedPlan } = await imported();
        const script = importedPlan.nodes.find((node) => node.metadata?.sourceEntityId === "script-1")!;
        const beat = importedPlan.nodes.find((node) => node.metadata?.sourceEntityId === "beat-1")!;
        const userEdge: CanvasConnection = { id: "user-made-edge", fromNodeId: script.id, toNodeId: beat.id };
        const request = { canvasId: "canvas-1", projectionId: importedPlan.projectionId, idempotencyKey: "arrange-1", nodes: importedPlan.nodes, connections: [userEdge] };
        const plan = await planXiajiProjectionArrangement(request);

        expect(plan.reusedConnectionIds).toContain(userEdge.id);
        expect(plan.connections.filter((edge) => edge.fromNodeId === script.id && edge.toNodeId === beat.id)).toEqual([userEdge]);
        const created = plan.connections.find((edge) => plan.createdConnectionIds.includes(edge.id))!;
        const collision: CanvasConnection = { id: created.id, fromNodeId: "outside-A", toNodeId: "outside-B" };
        await expect(planXiajiProjectionArrangement({ ...request, connections: [...request.connections, collision] })).rejects.toThrow("连线 ID 冲突");
    });
});
