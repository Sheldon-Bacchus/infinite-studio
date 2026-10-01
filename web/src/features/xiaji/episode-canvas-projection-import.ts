import { CanvasNodeType, type CanvasNodeData, type Position } from "@/app/(user)/canvas/types";
import { NODE_DEFAULT_SIZE } from "@/app/(user)/canvas/constants";
import type { Asset } from "@/stores/use-asset-store";
import { buildLocalAssetNodes } from "./send-to-canvas";
import { createXiajiProjectionIdentity, createXiajiProjectionItemDigest, validateXiajiProjectionSelection, type XiajiProjectionMode, type XiajiProjectionPreview, type XiajiProjectionRole } from "./episode-canvas-projection";

export type XiajiProjectionImportRequest = {
    assets: Asset[];
    canvasId: string;
    existingNodes: CanvasNodeData[];
    preview: XiajiProjectionPreview;
    sourceDigest: string;
    mode: XiajiProjectionMode;
    sourceAssetIds: string[];
    changedSourcePolicy: "create-new" | "reject";
    idempotencyKey: string;
    verifiedMediaAssetIds: string[];
    origin?: Position;
};

export type XiajiProjectionImportPlan = {
    projectionId: string;
    manifestDigest: string;
    mode: XiajiProjectionMode;
    nodes: CanvasNodeData[];
    createdSourceAssetIds: string[];
    reusedSourceAssetIds: string[];
    nodeIdsBySourceAssetId: Record<string, string>;
};

export class XiajiProjectionImportError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = "XiajiProjectionImportError";
    }
}

export type XiajiProjectionMediaReadability = {
    verifiedMediaAssetIds: string[];
    failedItems: Array<{ assetId: string; reason: string }>;
};

export async function verifyXiajiProjectionMediaReadability(assets: Asset[], sourceAssetIds: string[], readMedia?: (asset: Asset) => Promise<boolean>): Promise<XiajiProjectionMediaReadability> {
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const verifiedMediaAssetIds: string[] = [];
    const failedItems: XiajiProjectionMediaReadability["failedItems"] = [];
    const read = readMedia || defaultReadLocalMedia;
    for (const sourceAssetId of [...new Set(sourceAssetIds)]) {
        const asset = assetsById.get(sourceAssetId);
        if (!asset) {
            failedItems.push({ assetId: sourceAssetId, reason: "本地素材已不存在" });
            continue;
        }
        if (asset.kind === "text") continue;
        try {
            if (await read(asset)) verifiedMediaAssetIds.push(asset.id);
            else failedItems.push({ assetId: asset.id, reason: "媒体引用无法读取" });
        } catch {
            failedItems.push({ assetId: asset.id, reason: "媒体引用无法读取" });
        }
    }
    return { verifiedMediaAssetIds, failedItems };
}

async function defaultReadLocalMedia(asset: Exclude<Asset, { kind: "text" }>): Promise<boolean> {
    const [{ getImageBlob, getProxyUrl }, { getMediaBlob }] = await Promise.all([import("@/services/image-storage"), import("@/services/file-storage")]);
    const storageKey = asset.data.storageKey;
    if (storageKey) {
        const blob = asset.kind === "image" ? await getImageBlob(storageKey).catch(() => null) : await getMediaBlob(storageKey).catch(() => null);
        if (blob?.size) return true;
    }
    const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
    if (!url) return false;
    const response = await fetch(getProxyUrl(url));
    if (!response.ok) return false;
    return (await response.blob()).size > 0;
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

async function digest(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(stableJson(value));
    const result = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sourceRole(preview: XiajiProjectionPreview, sourceAssetId: string): XiajiProjectionRole {
    if (preview.script?.assetId === sourceAssetId) return "script";
    if (preview.beats.some((beat) => beat.assetId === sourceAssetId)) return "beat";
    return "asset";
}

function nodePayload(node: CanvasNodeData) {
    const metadata = node.metadata || {};
    return {
        type: node.type,
        title: node.title,
        width: node.width,
        height: node.height,
        content: metadata.content,
        sourceUrl: metadata.sourceUrl,
        storageKey: metadata.storageKey,
        mimeType: metadata.mimeType,
        bytes: metadata.bytes,
        durationMs: metadata.durationMs,
        naturalWidth: metadata.naturalWidth,
        naturalHeight: metadata.naturalHeight,
        category: metadata.category,
        tags: metadata.tags,
        xiaTang: metadata.xiaTang,
        localStudio: metadata.localStudio,
        sourceEntityType: metadata.sourceEntityType,
        sourceEntityId: metadata.sourceEntityId,
        sourceProjectId: metadata.sourceProjectId,
        sourceEpisodeAssetId: metadata.sourceEpisodeAssetId,
        sourceEpisode: metadata.sourceEpisode,
        sourceRevision: metadata.sourceRevision,
        projectionId: metadata.projectionId,
        projectionRole: metadata.projectionRole,
        projectionKey: metadata.projectionKey,
        sourceItemDigest: metadata.sourceItemDigest,
        projectionMode: metadata.projectionMode,
        projectionCanvasId: metadata.projectionCanvasId,
        projectionSourceAssetIds: metadata.projectionSourceAssetIds,
        projectionManifestDigest: metadata.projectionManifestDigest,
        projectionRequestKey: metadata.projectionRequestKey,
        projectionRequestDigest: metadata.projectionRequestDigest,
        projectionBeatOrder: metadata.projectionBeatOrder,
    };
}

function makeProjectionNode(
    asset: Asset,
    role: XiajiProjectionRole,
    input: XiajiProjectionImportRequest,
    identity: Awaited<ReturnType<typeof createXiajiProjectionIdentity>>,
    itemDigest: string,
    manifestDigest: string,
    orderedApprovedIds: string[],
    index: number,
): CanvasNodeData {
    const baseNode = buildLocalAssetNodes([asset]).nodes[0];
    if (!baseNode) throw new XiajiProjectionImportError("unimportable-source-asset", `素材 ${asset.id} 没有可导入的原生画布节点`);
    const size = role === "script" ? { width: 550, height: 600 } : role === "beat" ? { width: 420, height: 260 } : { width: baseNode.width, height: baseNode.height };
    const origin = input.origin || { x: 0, y: 0 };
    const position = { x: origin.x + (index % 2) * 580, y: origin.y + Math.floor(index / 2) * 420 };
    const record = input.preview.beats.find((beat) => beat.assetId === asset.id);
    const sourceEpisodeOrder = input.preview.episode?.order;
    return {
        ...baseNode,
        id: identity.nodeIds[asset.id],
        type: role === "script" || role === "beat" ? CanvasNodeType.Text : baseNode.type,
        title: asset.title || "未命名素材",
        position,
        width: size.width,
        height: size.height,
        metadata: {
            ...baseNode.metadata,
            content: asset.kind === "text" ? asset.data.content : baseNode.metadata?.content,
            prompt: asset.kind === "text" ? asset.data.content : baseNode.metadata?.prompt,
            ...(asset.kind === "video" ? { naturalWidth: asset.data.width, naturalHeight: asset.data.height } : {}),
            ...(asset.kind === "audio" && asset.data.durationMs !== undefined ? { durationMs: asset.data.durationMs } : {}),
            status: "success",
            sourceSystem: "infinite-canvas",
            sourceProjectId: input.preview.projectAssetId,
            xiajiProjectAssetId: input.preview.projectAssetId,
            sourceEpisodeAssetId: input.preview.episodeAssetId,
            sourceEpisode: sourceEpisodeOrder,
            sourceRevision: input.preview.sourceDigest,
            sourceEntityType: role === "asset" ? "asset" : role,
            sourceEntityId: asset.id,
            sourceMediaRole: asset.kind,
            projectionId: identity.projectionId,
            projectionRole: role,
            projectionKey: identity.projectionKeys[asset.id],
            sourceItemDigest: itemDigest,
            projectionMode: input.mode,
            projectionCanvasId: input.canvasId,
            projectionImportedPosition: position,
            projectionSourceAssetIds: [...orderedApprovedIds].sort((left, right) => left.localeCompare(right)),
            projectionManifestDigest: manifestDigest,
            ...(role === "script"
                ? {
                      projectionRequestKey: input.idempotencyKey,
                      projectionRequestDigest: "",
                      projectionScriptAssetId: asset.id,
                      projectionDocumentKind: input.preview.script?.documentKind,
                      projectionBeatOrder: input.preview.beats.map(({ assetId, order }) => ({ assetId, order })),
                  }
                : {}),
            ...(role === "beat" ? { sourceBeatOrder: record?.order } : {}),
            ...(role === "script" || role === "beat" ? { localStudio: asset.metadata?.localStudio } : {}),
            category: asset.category,
            tags: [...asset.tags],
        },
    };
}

export async function planXiajiProjectionImport(input: XiajiProjectionImportRequest): Promise<XiajiProjectionImportPlan> {
    if (input.sourceDigest !== input.preview.sourceDigest) throw new XiajiProjectionImportError("stale-preview", "剧本、镜头或虾塘素材在预览后已变化，请重新预览并确认");
    if (!input.canvasId.trim()) throw new XiajiProjectionImportError("canvas-not-selected", "没有明确的目标画布");
    if (!input.idempotencyKey.trim()) throw new XiajiProjectionImportError("missing-idempotency-key", "缺少本次导入的幂等键");
    const selectionIssues = validateXiajiProjectionSelection(input.preview, input.mode, input.sourceAssetIds);
    if (selectionIssues.length) throw new XiajiProjectionImportError(selectionIssues[0].code, selectionIssues.map((issue) => issue.message).join("；"));

    const orderedApprovedIds = input.preview.importableSourceAssetIds.filter((id) => new Set(input.sourceAssetIds).has(id));
    const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
    const sources = orderedApprovedIds.map((assetId) => {
        const asset = assetsById.get(assetId);
        if (!asset) throw new XiajiProjectionImportError("missing-source-asset", `本地素材 ${assetId} 已不存在`);
        if (asset.kind !== "text" && !input.verifiedMediaAssetIds.includes(asset.id)) {
            throw new XiajiProjectionImportError("media-not-readable", `媒体可读性尚未验证：${asset.id}`);
        }
        return { asset, role: sourceRole(input.preview, asset.id) };
    });

    const canvasAnchors = input.existingNodes.filter(
        (node) =>
            node.metadata?.projectionRole === "script" && node.metadata?.projectionCanvasId === input.canvasId,
    );
    if (canvasAnchors.some((node) => node.metadata?.projectionRequestKey === input.idempotencyKey)) {
        const sameRequest = canvasAnchors.find(
            (node) =>
                node.metadata?.projectionRequestKey === input.idempotencyKey &&
                node.metadata?.sourceProjectId === input.preview.projectAssetId &&
                node.metadata?.sourceEpisodeAssetId === input.preview.episodeAssetId &&
                node.metadata?.sourceRevision === input.sourceDigest &&
                node.metadata?.projectionMode === input.mode &&
                stableJson(node.metadata?.projectionSourceAssetIds) === stableJson([...input.sourceAssetIds].sort((a, b) => a.localeCompare(b))),
        );
        if (!sameRequest) throw new XiajiProjectionImportError("idempotency-conflict", "幂等键已用于不同导入参数");
    }
    const previousAnchors = canvasAnchors.filter(
        (node) => node.metadata?.sourceProjectId === input.preview.projectAssetId && node.metadata?.sourceEpisodeAssetId === input.preview.episodeAssetId,
    );
    const olderAnchor = previousAnchors.find((node) => node.metadata?.sourceRevision !== input.sourceDigest);
    if (olderAnchor && input.changedSourcePolicy === "reject") {
        throw new XiajiProjectionImportError("source-version-exists", "检测到已有不同来源摘要的投影；需明确选择创建新投影");
    }

    const identity = await createXiajiProjectionIdentity(input.canvasId, input.preview, input.mode, orderedApprovedIds);
    const itemDigests = await Promise.all(sources.map(({ asset, role }) => createXiajiProjectionItemDigest(asset, role)));
    const manifestDigest = await digest(
        orderedApprovedIds
            .map((assetId, index) => ({
                assetId,
                role: sources[index].role,
                projectionKey: identity.projectionKeys[assetId],
                nodeId: identity.nodeIds[assetId],
                sourceItemDigest: itemDigests[index],
            }))
            .sort((left, right) => left.assetId.localeCompare(right.assetId)),
    );
    const projectionBeatOrder = input.preview.beats.map(({ assetId, order }) => ({ assetId, order }));
    const requestDigest = await digest([input.canvasId, input.preview.projectAssetId, input.preview.episodeAssetId, input.sourceDigest, input.mode, [...orderedApprovedIds].sort((a, b) => a.localeCompare(b)), projectionBeatOrder]);
    const expectedNodes = sources.map(({ asset, role }, index) => makeProjectionNode(asset, role, input, identity, itemDigests[index], manifestDigest, orderedApprovedIds, index));
    const scriptAnchor = expectedNodes.find((node) => node.metadata?.projectionRole === "script");
    if (!scriptAnchor) throw new XiajiProjectionImportError("missing-script-anchor", "导入闭包中缺少剧本锚点");
    scriptAnchor.metadata = { ...scriptAnchor.metadata, projectionRequestDigest: requestDigest };

    const existingById = new Map(input.existingNodes.map((node) => [node.id, node]));
    const existingByProjectionKey = new Map<string, CanvasNodeData[]>();
    for (const node of input.existingNodes) {
        const key = node.metadata?.projectionKey;
        if (key?.startsWith("xiaji:v1:")) existingByProjectionKey.set(key, [...(existingByProjectionKey.get(key) || []), node]);
    }
    const createdSourceAssetIds: string[] = [];
    const reusedSourceAssetIds: string[] = [];
    const finalNodes = [...input.existingNodes];
    const nodeIdsBySourceAssetId: Record<string, string> = {};

    for (const expected of expectedNodes) {
        const sourceId = expected.metadata?.sourceEntityId || "";
        const projectionKey = expected.metadata?.projectionKey || "";
        const keyed = existingByProjectionKey.get(projectionKey) || [];
        if (keyed.length > 1) throw new XiajiProjectionImportError("duplicate-projection-member", `投影成员键重复：${sourceId}`);
        const current = keyed[0];
        if (current) {
            if (
                current.id !== expected.id ||
                current.metadata?.projectionId !== identity.projectionId ||
                current.metadata?.sourceEntityId !== sourceId ||
                current.metadata?.sourceItemDigest !== expected.metadata?.sourceItemDigest ||
                stableJson(nodePayload(current)) !== stableJson(nodePayload(expected))
            ) {
                throw new XiajiProjectionImportError("projection-node-conflict", `投影节点内容已被修改或与来源不一致：${sourceId}`);
            }
            reusedSourceAssetIds.push(sourceId);
            nodeIdsBySourceAssetId[sourceId] = current.id;
            continue;
        }
        const idCollision = existingById.get(expected.id);
        if (idCollision) throw new XiajiProjectionImportError("node-id-conflict", `节点 ID 冲突，拒绝覆盖：${expected.id}`);
        finalNodes.push(expected);
        existingById.set(expected.id, expected);
        createdSourceAssetIds.push(sourceId);
        nodeIdsBySourceAssetId[sourceId] = expected.id;
    }

    return {
        projectionId: identity.projectionId,
        manifestDigest,
        mode: input.mode,
        nodes: finalNodes,
        createdSourceAssetIds,
        reusedSourceAssetIds,
        nodeIdsBySourceAssetId,
    };
}
