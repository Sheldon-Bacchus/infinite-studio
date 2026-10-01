import type { CanvasConnection, CanvasNodeData } from "@/app/(user)/canvas/types";
import { CanvasNodeType } from "@/app/(user)/canvas/types";
import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import type { Asset } from "@/stores/use-asset-store";
import { GROUP_PADDING, getNodeBounds } from "@/app/(user)/canvas/utils/canvas-group";
import { getXiaTangRecord, listXiaTangProjectAssets } from "./xia-tang-local-model";

export type LocalAssetNodeInstance = {
    shotKey: string;
    groupId: string;
    role: string;
    nodeId?: string;
    projectionKey?: string;
};

export type LocalAssetCanvasProjection = {
    nodes: CanvasNodeData[];
    skippedAssets: Array<{ assetId: string; reason: string }>;
};

export type LocalAssetMergeResult = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    insertedAssetIds: string[];
    duplicateAssetIds: string[];
    insertedNodeIds: string[];
    duplicateNodeIds: string[];
};

export type LocalAssetSendResult = LocalAssetMergeResult & {
    skippedAssets: Array<{ assetId: string; reason: string }>;
};

const LOCAL_ASSET_COLUMNS = 2;
const LOCAL_ASSET_COLUMN_GAP = 580;
const LOCAL_ASSET_ROW_GAP = 420;

function localAssetNodeSize(asset: Asset) {
    if (asset.kind === "text") return { width: 420, height: 260 };
    if (asset.kind === "video") return { width: 420, height: 236 };
    if (asset.kind === "audio") return { width: 420, height: 160 };
    return { width: 340, height: 260 };
}

function localAssetNodeType(asset: Asset) {
    switch (asset.kind) {
        case "text": return CanvasNodeType.Text;
        case "image": return CanvasNodeType.Image;
        case "video": return CanvasNodeType.Video;
        case "audio": return CanvasNodeType.Audio;
    }
}

function localAssetMediaUrl(asset: Asset) {
    if (asset.kind === "image") return asset.data.dataUrl;
    if (asset.kind === "video" || asset.kind === "audio") return asset.data.url;
    return undefined;
}

export function buildLocalAssetNodes(assets: Asset[], origin = { x: 0, y: 0 }, instance?: LocalAssetNodeInstance, projectAssetId?: string): LocalAssetCanvasProjection {
    const nodes: CanvasNodeData[] = [];
    const skippedAssets: LocalAssetCanvasProjection["skippedAssets"] = [];

    assets.forEach((asset, index) => {
        const xiaTangRecord = getXiaTangRecord(asset);
        if (xiaTangRecord?.recordType === "media" && xiaTangRecord.fields.fileOnly === true) {
            skippedAssets.push({ assetId: asset.id, reason: "此文件格式没有对应的画布节点类型；文件仍保留在虾塘本地记录中" });
            return;
        }
        const content = asset.kind === "text" ? asset.data.content : localAssetMediaUrl(asset);
        if (asset.kind !== "text" && !content) {
            skippedAssets.push({ assetId: asset.id, reason: "本地媒体引用缺失，无法加入画布" });
            return;
        }

        const { width, height } = localAssetNodeSize(asset);
        const sourceKey = instance ? instance.projectionKey || `infinite-canvas:asset:${asset.id}:shot:${instance.shotKey}` : `infinite-canvas:asset:${asset.id}`;
        const media = asset.kind === "text" ? undefined : asset.data;
        nodes.push({
            id: instance?.nodeId || (instance ? `local-asset-${encodeURIComponent(asset.id)}-shot-${instance.shotKey}` : `local-asset-${encodeURIComponent(asset.id)}`),
            type: localAssetNodeType(asset),
            title: asset.title || "未命名素材",
            position: {
                x: origin.x + (index % LOCAL_ASSET_COLUMNS) * LOCAL_ASSET_COLUMN_GAP,
                y: origin.y + Math.floor(index / LOCAL_ASSET_COLUMNS) * LOCAL_ASSET_ROW_GAP,
            },
            width,
            height,
            metadata: {
                content: content || "",
                ...(media ? {
                    sourceUrl: content,
                    storageKey: media.storageKey,
                    mimeType: media.mimeType,
                    bytes: media.bytes,
                    ...(asset.kind === "image" ? { naturalWidth: asset.data.width, naturalHeight: asset.data.height } : {}),
                    ...(asset.kind === "audio" && asset.data.durationMs ? { durationMs: asset.data.durationMs } : {}),
                } : {}),
                status: "success",
                sourceSystem: "infinite-canvas",
                sourceProjectId: projectAssetId || "local-assets",
                sourceEntityType: "asset",
                sourceEntityId: asset.id,
                sourceMediaRole: asset.kind,
                ...(instance ? { groupId: instance.groupId, shotKey: instance.shotKey } : {}),
                projectionRole: instance?.role || "asset",
                projectionKey: sourceKey,
                category: asset.category,
                tags: [...asset.tags],
                ...(asset.metadata?.xiaTang ? { xiaTang: asset.metadata.xiaTang } : {}),
                ...(projectAssetId ? { xiajiProjectAssetId: projectAssetId } : {}),
            },
        });
    });

    return { nodes, skippedAssets };
}

export function mergeLocalAssetNodes(
    existingNodes: CanvasNodeData[],
    existingConnections: CanvasConnection[],
    incomingNodes: CanvasNodeData[],
): LocalAssetMergeResult {
    const existingSourceIds = new Set(existingNodes
        .filter((node) => node.metadata?.sourceSystem === "infinite-canvas" && node.metadata.sourceEntityType === "asset")
        .map(localAssetIdentity)
        .filter(Boolean));
    const existingNodeIds = new Set(existingNodes.map((node) => node.id));
    const incomingSourceIds = new Set<string>();
    const inserted: CanvasNodeData[] = [];
    const insertedAssetIds: string[] = [];
    const duplicateAssetIds: string[] = [];
    const insertedNodeIds: string[] = [];
    const duplicateNodeIds: string[] = [];

    for (const node of incomingNodes) {
        const assetId = node.metadata?.sourceEntityId || "";
        if (!assetId) continue;
        const identity = localAssetIdentity(node);
        if (existingSourceIds.has(identity) || existingNodeIds.has(node.id) || incomingSourceIds.has(identity)) {
            duplicateAssetIds.push(assetId);
            duplicateNodeIds.push(node.id);
            continue;
        }
        inserted.push(node);
        insertedAssetIds.push(assetId);
        insertedNodeIds.push(node.id);
        existingSourceIds.add(identity);
        existingNodeIds.add(node.id);
        incomingSourceIds.add(identity);
    }

    return {
        nodes: [...existingNodes, ...inserted],
        connections: existingConnections,
        insertedAssetIds,
        duplicateAssetIds,
        insertedNodeIds,
        duplicateNodeIds,
    };
}

export function nextAssetImportOrigin(nodes: CanvasNodeData[]) {
    if (!nodes.length) return { x: 0, y: 0 };
    const rightmost = nodes.reduce((current, node) =>
        node.position.x + node.width > current.position.x + current.width ? node : current,
    );
    return { x: rightmost.position.x + rightmost.width + 240, y: rightmost.position.y };
}

export function resolveLocalAssetImportOrigin(nodes: CanvasNodeData[], preferredOrigin?: { x: number; y: number }) {
    return nodes.length ? nextAssetImportOrigin(nodes) : preferredOrigin || { x: 0, y: 0 };
}

export async function sendLocalAssetsToCanvas({
    project,
    getCurrentProject,
    assets,
    origin,
    assetInstances,
    saveProject,
}: {
    project: CanvasProject;
    getCurrentProject?: () => CanvasProject | null;
    assets: Asset[];
    origin?: { x: number; y: number };
    assetInstances?: Array<{ asset: Asset; origin: { x: number; y: number }; instance: LocalAssetNodeInstance }>;
    saveProject: (patch: Pick<CanvasProject, "nodes" | "connections" | "autoTitlePending">) => Promise<void>;
}): Promise<LocalAssetSendResult> {
    const currentProject = getCurrentProject?.() || project;
    if (!currentProject) throw new Error("目标画布已不存在，请重新选择");
    if (project.xiajiProjectAssetId !== currentProject.xiajiProjectAssetId) throw new Error("当前画布项目绑定已变化，请刷新后重试");
    const projectAssetId = currentProject.xiajiProjectAssetId;
    if (projectAssetId) {
        const scopedAssetIds = new Set(listXiaTangProjectAssets(assets, projectAssetId).map((asset) => asset.id));
        const requestedIds = assetInstances ? assetInstances.map((item) => item.asset.id) : assets.map((asset) => asset.id);
        const foreignId = requestedIds.find((id) => !scopedAssetIds.has(id));
        if (foreignId) throw new Error(`所选虾塘素材不属于当前虾料项目：${foreignId}`);
    }
    const projection = assetInstances
        ? assetInstances.reduce<LocalAssetCanvasProjection>((combined, item) => {
            const next = buildLocalAssetNodes([item.asset], item.origin, item.instance, projectAssetId);
            return { nodes: [...combined.nodes, ...next.nodes], skippedAssets: [...combined.skippedAssets, ...next.skippedAssets] };
        }, { nodes: [], skippedAssets: [] })
        : buildLocalAssetNodes(assets, origin, undefined, projectAssetId);
    const merged = mergeLocalAssetNodes(currentProject.nodes, currentProject.connections, projection.nodes);
    const groupIds = new Set(assetInstances?.map((item) => item.instance.groupId) || []);
    const nextNodes = expandCanvasGroupsToFitChildren(merged.nodes, groupIds);
    await saveProject({
        nodes: nextNodes,
        connections: merged.connections,
        autoTitlePending: false,
    });
    return { ...merged, nodes: nextNodes, skippedAssets: projection.skippedAssets };
}

function localAssetIdentity(node: CanvasNodeData) {
    const sourceId = node.metadata?.sourceEntityId || "";
    const projectionKey = node.metadata?.projectionKey || "";
    return /:(?:shot|instance):/.test(projectionKey) ? `projection:${projectionKey}` : `asset:${sourceId}`;
}

export function expandCanvasGroupsToFitChildren(nodes: CanvasNodeData[], groupIds: Set<string>) {
    if (!groupIds.size) return nodes;
    return nodes.map((group) => {
        if (!groupIds.has(group.id) || group.type !== CanvasNodeType.Group) return group;
        const children = nodes.filter((node) => node.metadata?.groupId === group.id);
        if (!children.length) return group;
        const bounds = getNodeBounds(children);
        const left = Math.min(group.position.x, bounds.left - GROUP_PADDING);
        const top = Math.min(group.position.y, bounds.top - GROUP_PADDING);
        const right = Math.max(group.position.x + group.width, bounds.right + GROUP_PADDING);
        const bottom = Math.max(group.position.y + group.height, bounds.bottom + GROUP_PADDING);
        return { ...group, position: { x: left, y: top }, width: right - left, height: bottom - top };
    });
}
