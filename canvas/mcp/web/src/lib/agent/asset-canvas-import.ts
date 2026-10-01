import type { Asset } from "@/stores/use-asset-store";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeData, CanvasNodeTypeId } from "@/types/canvas";

export type AssetCanvasImportResult = {
    ops: CanvasAgentOp[];
    insertedAssetIds: string[];
    duplicateAssetIds: string[];
    skippedAssets: Array<{ assetId: string; reason: string }>;
};

const NODE_SIZES: Record<Asset["kind"], { width: number; height: number }> = {
    text: { width: 420, height: 260 },
    image: { width: 340, height: 260 },
    video: { width: 420, height: 236 },
};
const COLUMN_GAP = 580;
const ROW_GAP = 420;
const MAX_ASSETS_PER_IMPORT = 50;

/** 将当前本地素材库中的选定素材映射为追加到画布的节点操作。 */
export function buildAssetCanvasImport(
    assets: Asset[],
    assetIds: string[],
    snapshot: CanvasAgentSnapshot,
    origin?: { x?: number; y?: number },
): AssetCanvasImportResult {
    if (!assetIds.length || assetIds.length > MAX_ASSETS_PER_IMPORT) throw new Error("assetIds 必须包含 1 到 50 个素材 ID");
    if (new Set(assetIds).size !== assetIds.length) throw new Error("assetIds 不能重复");

    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const missingIds = assetIds.filter((id) => !assetsById.has(id));
    if (missingIds.length) throw new Error("找不到本地素材：" + missingIds.join("、"));

    const existingSourceIds = new Set(snapshot.nodes
        .filter((node) => node.metadata?.sourceEntityType === "asset" && typeof node.metadata.sourceEntityId === "string")
        .map((node) => String(node.metadata?.sourceEntityId)));
    const existingNodeIds = new Set(snapshot.nodes.map((node) => node.id));
    const nextX = snapshot.nodes.length ? Math.max(...snapshot.nodes.map((node) => node.position.x + node.width)) + 80 : 0;
    const baseX = origin?.x ?? nextX;
    const baseY = origin?.y ?? 0;
    const ops: CanvasAgentOp[] = [];
    const insertedAssetIds: string[] = [];
    const duplicateAssetIds: string[] = [];
    const skippedAssets: AssetCanvasImportResult["skippedAssets"] = [];

    assetIds.forEach((assetId) => {
        const asset = assetsById.get(assetId)!;
        if (existingSourceIds.has(asset.id)) {
            duplicateAssetIds.push(asset.id);
            return;
        }
        const nodeId = `local-asset-${encodeURIComponent(asset.id)}`;
        if (existingNodeIds.has(nodeId)) {
            skippedAssets.push({ assetId, reason: "目标节点 ID 已被画布中的其他节点占用" });
            return;
        }
        const mediaUrl = asset.kind === "image" ? asset.data.dataUrl : asset.kind === "video" ? asset.data.url : "";
        if (asset.kind !== "text" && !mediaUrl.trim()) {
            skippedAssets.push({ assetId, reason: "本地媒体引用缺失，无法加入画布" });
            return;
        }

        const nodeType: CanvasNodeTypeId = asset.kind;
        const size = NODE_SIZES[asset.kind];
        const index = ops.length;
        const metadata: NonNullable<CanvasNodeData["metadata"]> = {
            content: asset.kind === "text" ? asset.data.content : mediaUrl,
            status: "success",
            sourceSystem: "infinite-canvas",
            sourceProjectId: "local-assets",
            sourceEntityType: "asset",
            sourceEntityId: asset.id,
            sourceMediaRole: asset.kind,
            category: typeof asset.metadata?.category === "string" ? asset.metadata.category : "未分类",
            tags: [...asset.tags],
            sourceAssetCreatedAt: asset.createdAt,
            sourceAssetUpdatedAt: asset.updatedAt,
            ...(asset.source ? { sourceAssetSource: asset.source } : {}),
            ...(asset.note ? { sourceAssetNote: asset.note } : {}),
            ...(asset.metadata ? { sourceAssetMetadata: { ...asset.metadata } } : {}),
            ...(asset.kind !== "text" ? {
                sourceUrl: mediaUrl,
                ...(asset.data.storageKey ? { storageKey: asset.data.storageKey } : {}),
                mimeType: asset.data.mimeType,
                bytes: asset.data.bytes,
                naturalWidth: asset.data.width,
                naturalHeight: asset.data.height,
            } : {}),
        };
        ops.push({
            type: "add_node",
            id: nodeId,
            nodeType,
            title: asset.title || "未命名素材",
            position: { x: baseX + (index % 2) * COLUMN_GAP, y: baseY + Math.floor(index / 2) * ROW_GAP },
            ...size,
            metadata,
        });
        insertedAssetIds.push(asset.id);
        existingSourceIds.add(asset.id);
        existingNodeIds.add(nodeId);
    });

    return { ops, insertedAssetIds, duplicateAssetIds, skippedAssets };
}
