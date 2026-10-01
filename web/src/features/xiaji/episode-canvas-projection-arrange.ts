import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/app/(user)/canvas/types";
import { GROUP_PADDING } from "@/app/(user)/canvas/utils/canvas-group";
import type { Asset, AssetKind } from "@/stores/use-asset-store";
import { createXiajiProjectionIdentityFromSource, createXiajiProjectionItemDigest, type XiajiProjectionMode, type XiajiProjectionRole } from "./episode-canvas-projection";

type SourceRelationship = {
    kind: "script-beat" | "beat-sequence" | "beat-reference" | "asset-media";
    fromSourceAssetId: string;
    toSourceAssetId: string;
};

export type XiajiProjectionMissingEdge = SourceRelationship & { reason: "source-not-selected" };

export type XiajiProjectionArrangementRequest = {
    canvasId: string;
    projectionId: string;
    idempotencyKey: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

export type XiajiProjectionArrangementPlan = {
    projectionId: string;
    manifestDigest: string;
    groupNodeId: string;
    layoutDigest: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    createdConnectionIds: string[];
    reusedConnectionIds: string[];
    missingEdges: XiajiProjectionMissingEdge[];
    movedNodeIds: string[];
};

export class XiajiProjectionArrangeError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = "XiajiProjectionArrangeError";
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (isRecord(value)) {
        const entries = Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

async function sha256(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(stableJson(value));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function projectionMembers(nodes: CanvasNodeData[], projectionId: string) {
    return nodes.filter((node) => node.metadata?.projectionId === projectionId && ["script", "beat", "asset"].includes(node.metadata?.projectionRole || ""));
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function assetFromProjectionNode(node: CanvasNodeData): Asset {
    const metadata = node.metadata || {};
    const kind = metadata.sourceMediaRole as AssetKind | undefined;
    const id = metadata.sourceEntityId;
    if (!id || !kind || !["text", "image", "video", "audio"].includes(kind)) {
        throw new XiajiProjectionArrangeError("invalid-projection-member", `节点 ${node.id} 缺少有效的来源素材类型或 ID`);
    }
    const common = {
        id,
        kind,
        title: node.title,
        coverUrl: "",
        tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === "string") : [],
        category: stringValue(metadata.category),
        source: "虾镜本地投影",
        createdAt: "",
        updatedAt: "",
        metadata: {
            ...(metadata.localStudio === undefined ? {} : { localStudio: metadata.localStudio }),
            ...(metadata.xiaTang === undefined ? {} : { xiaTang: metadata.xiaTang }),
        },
    };
    const content = stringValue(metadata.content) || "";
    const url = stringValue(metadata.sourceUrl) || content;
    const storageKey = stringValue(metadata.storageKey);
    const mimeType = stringValue(metadata.mimeType);
    const bytes = numberValue(metadata.bytes);
    switch (kind) {
        case "text":
            return { ...common, kind, data: { content } } as Asset;
        case "image":
            return {
                ...common,
                kind,
                data: {
                    dataUrl: url,
                    ...(storageKey ? { storageKey } : {}),
                    width: numberValue(metadata.naturalWidth) || 0,
                    height: numberValue(metadata.naturalHeight) || 0,
                    bytes: bytes || 0,
                    mimeType: mimeType || "",
                },
            } as Asset;
        case "video":
            return {
                ...common,
                kind,
                data: {
                    url,
                    ...(storageKey ? { storageKey } : {}),
                    width: numberValue(metadata.naturalWidth) || 0,
                    height: numberValue(metadata.naturalHeight) || 0,
                    bytes: bytes || 0,
                    mimeType: mimeType || "",
                },
            } as Asset;
        case "audio":
            return {
                ...common,
                kind,
                data: {
                    url,
                    ...(storageKey ? { storageKey } : {}),
                    ...(bytes === undefined ? {} : { bytes }),
                    ...(mimeType ? { mimeType } : {}),
                    ...(numberValue(metadata.durationMs) === undefined ? {} : { durationMs: numberValue(metadata.durationMs) }),
                },
            } as Asset;
    }
}

function sourceRole(node: CanvasNodeData): XiajiProjectionRole {
    const role = node.metadata?.projectionRole;
    if (role === "script" || role === "beat" || role === "asset") return role;
    throw new XiajiProjectionArrangeError("invalid-projection-member", `节点 ${node.id} 的虾镜投影角色无效`);
}

function currentMediaBySlot(value: unknown): Record<string, string> {
    if (!isRecord(value) || !isRecord(value.mediaCurrentBySlot)) return {};
    return Object.fromEntries(Object.entries(value.mediaCurrentBySlot).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function xiaTangRecord(node: CanvasNodeData): Record<string, unknown> | null {
    return isRecord(node.metadata?.xiaTang) ? (node.metadata!.xiaTang as Record<string, unknown>) : null;
}

function relationshipsFor(members: CanvasNodeData[], beatOrder: Array<{ assetId: string; order: number }>): { relationships: SourceRelationship[]; missingEdges: XiajiProjectionMissingEdge[] } {
    const bySourceId = new Map(members.map((node) => [node.metadata?.sourceEntityId || "", node]));
    const script = members.find((node) => sourceRole(node) === "script");
    const beats = members.filter((node) => sourceRole(node) === "beat");
    const assets = members.filter((node) => sourceRole(node) === "asset");
    const selectedIds = new Set(bySourceId.keys());
    const relationships: SourceRelationship[] = [];
    const missingEdges: XiajiProjectionMissingEdge[] = [];
    const add = (relationship: SourceRelationship) => {
        if (selectedIds.has(relationship.fromSourceAssetId) && selectedIds.has(relationship.toSourceAssetId)) relationships.push(relationship);
        else missingEdges.push({ ...relationship, reason: "source-not-selected" });
    };

    const orderedAllBeats = [...beatOrder].sort((left, right) => left.order - right.order || left.assetId.localeCompare(right.assetId));
    if (script && orderedAllBeats.length) {
        add({ kind: "script-beat", fromSourceAssetId: script.metadata?.sourceEntityId || "", toSourceAssetId: orderedAllBeats[0].assetId });
    }
    for (let index = 1; index < orderedAllBeats.length; index += 1) {
        add({ kind: "beat-sequence", fromSourceAssetId: orderedAllBeats[index - 1].assetId, toSourceAssetId: orderedAllBeats[index].assetId });
    }

    for (const beat of beats) {
        const record = beat.metadata?.localStudio;
        if (!isRecord(record) || record.recordType !== "beat" || !Array.isArray(record.referencedAssetIds)) continue;
        for (const assetId of record.referencedAssetIds.filter((value): value is string => typeof value === "string")) {
            add({ kind: "beat-reference", fromSourceAssetId: beat.metadata?.sourceEntityId || "", toSourceAssetId: assetId });
        }
    }

    for (const media of assets) {
        const mediaRecord = xiaTangRecord(media);
        if (!mediaRecord || mediaRecord.recordType !== "media") continue;
        const parentId = stringValue(mediaRecord.parentId);
        const slot = stringValue(mediaRecord.slot);
        if (!parentId || !slot) throw new XiajiProjectionArrangeError("invalid-media-parent", `媒体素材 ${media.metadata?.sourceEntityId} 缺少父素材或槽位`);
        const parent = bySourceId.get(parentId);
        if (!parent) {
            missingEdges.push({ kind: "asset-media", fromSourceAssetId: parentId, toSourceAssetId: media.metadata?.sourceEntityId || "", reason: "source-not-selected" });
            continue;
        }
        const parentRecord = parent ? xiaTangRecord(parent) : null;
        if (!parentRecord || currentMediaBySlot(parentRecord.fields)[slot] !== media.metadata?.sourceEntityId) {
            throw new XiajiProjectionArrangeError("invalid-current-media", `媒体素材 ${media.metadata?.sourceEntityId} 与父素材当前版本关系不一致`);
        }
        add({ kind: "asset-media", fromSourceAssetId: parentId, toSourceAssetId: media.metadata?.sourceEntityId || "" });
    }
    for (const asset of assets) {
        const record = xiaTangRecord(asset);
        if (!record || record.recordType === "media") continue;
        const currentMedia = currentMediaBySlot(record.fields);
        for (const mediaId of Object.values(currentMedia)) {
            if (selectedIds.has(mediaId)) continue;
            missingEdges.push({ kind: "asset-media", fromSourceAssetId: asset.metadata?.sourceEntityId || "", toSourceAssetId: mediaId, reason: "source-not-selected" });
        }
    }
    return { relationships, missingEdges };
}

function layoutNodes(members: CanvasNodeData[], origin: Position) {
    const script = members.find((node) => sourceRole(node) === "script");
    const beats = members
        .filter((node) => sourceRole(node) === "beat")
        .sort((left, right) => {
            const orderDelta = (left.metadata?.sourceBeatOrder || 0) - (right.metadata?.sourceBeatOrder || 0);
            return orderDelta || (left.metadata?.sourceEntityId || "").localeCompare(right.metadata?.sourceEntityId || "");
        });
    const assets = members.filter((node) => sourceRole(node) === "asset");
    const mediaNodes = assets.filter((node) => xiaTangRecord(node)?.recordType === "media");
    const entityNodes = assets.filter((node) => !mediaNodes.includes(node)).sort((left, right) => (left.metadata?.sourceEntityId || "").localeCompare(right.metadata?.sourceEntityId || ""));
    const beatX = origin.x + (script?.width || 550) + 180;
    const assetX = beatX + Math.max(420, ...beats.map((node) => node.width)) + 180;
    const mediaX = assetX + Math.max(340, ...entityNodes.map((node) => node.width)) + 180;
    const positions = new Map<string, Position>();
    if (script) positions.set(script.id, origin);
    let beatY = origin.y;
    for (const beat of beats) {
        positions.set(beat.id, { x: beatX, y: beatY });
        beatY += beat.height + 48;
    }
    let assetY = origin.y;
    const parentY = new Map<string, number>();
    for (const asset of entityNodes) {
        positions.set(asset.id, { x: assetX, y: assetY });
        parentY.set(asset.metadata?.sourceEntityId || "", assetY);
        assetY += asset.height + 48;
    }
    const mediaOffsets = new Map<string, number>();
    let looseMediaY = origin.y;
    for (const media of mediaNodes.sort((left, right) => (left.metadata?.sourceEntityId || "").localeCompare(right.metadata?.sourceEntityId || ""))) {
        const record = xiaTangRecord(media)!;
        const parentId = stringValue(record.parentId) || "";
        const parentYPosition = parentY.get(parentId);
        if (parentYPosition !== undefined) {
            const offset = mediaOffsets.get(parentId) || 0;
            positions.set(media.id, { x: mediaX, y: parentYPosition + offset });
            mediaOffsets.set(parentId, offset + media.height + 24);
        } else {
            positions.set(media.id, { x: mediaX, y: looseMediaY });
            looseMediaY += media.height + 48;
        }
    }
    const arranged = members.map((node) => ({ ...node, position: positions.get(node.id) || origin }));
    const bounds = arranged.reduce(
        (result, node) => ({
            left: Math.min(result.left, node.position.x),
            top: Math.min(result.top, node.position.y),
            right: Math.max(result.right, node.position.x + node.width),
            bottom: Math.max(result.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    const groupPosition = { x: bounds.left - GROUP_PADDING, y: bounds.top - GROUP_PADDING };
    const groupSize = { width: bounds.right - bounds.left + GROUP_PADDING * 2, height: bounds.bottom - bounds.top + GROUP_PADDING * 2 };
    return { arranged, groupPosition, groupSize };
}

export async function planXiajiProjectionArrangement(input: XiajiProjectionArrangementRequest): Promise<XiajiProjectionArrangementPlan> {
    if (!input.canvasId.trim() || !input.projectionId.trim()) throw new XiajiProjectionArrangeError("missing-projection-target", "缺少画布或虾镜投影 ID");
    if (!input.idempotencyKey.trim()) throw new XiajiProjectionArrangeError("missing-idempotency-key", "缺少本次排版的幂等键");

    const anchors = input.nodes.filter((node) => node.metadata?.projectionId === input.projectionId && node.metadata?.projectionRole === "script");
    if (anchors.length !== 1) throw new XiajiProjectionArrangeError("projection-anchor-count", "目标投影必须且只能有一个剧本锚点");
    const anchor = anchors[0];
    const anchorMetadata = anchor.metadata || {};
    const sourceIds = anchorMetadata.projectionSourceAssetIds;
    const mode = anchorMetadata.projectionMode;
    const projectAssetId = anchorMetadata.sourceProjectId;
    const episodeAssetId = anchorMetadata.sourceEpisodeAssetId;
    const sourceDigest = anchorMetadata.sourceRevision;
    const manifestDigest = anchorMetadata.projectionManifestDigest;
    const beatOrder = anchorMetadata.projectionBeatOrder;
    if (
        anchorMetadata.projectionCanvasId !== input.canvasId ||
        typeof projectAssetId !== "string" ||
        typeof episodeAssetId !== "string" ||
        typeof sourceDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(sourceDigest) ||
        typeof manifestDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(manifestDigest) ||
        (mode !== "complete" && mode !== "selected") ||
        !Array.isArray(sourceIds) ||
        !Array.isArray(beatOrder) ||
        typeof anchorMetadata.projectionRequestDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(anchorMetadata.projectionRequestDigest)
    ) {
        throw new XiajiProjectionArrangeError("invalid-projection-anchor", "剧本锚点中的项目、分集、版本或批准清单不完整");
    }
    if (new Set(sourceIds).size !== sourceIds.length || sourceIds.some((id) => typeof id !== "string") || stableJson(sourceIds) !== stableJson([...sourceIds].sort((a, b) => a.localeCompare(b)))) {
        throw new XiajiProjectionArrangeError("invalid-projection-source-list", "投影来源 ID 必须唯一且按稳定顺序保存");
    }
    if (
        new Set(beatOrder.map((item) => item?.assetId)).size !== beatOrder.length ||
        new Set(beatOrder.map((item) => item?.order)).size !== beatOrder.length ||
        beatOrder.some((item) => !item || typeof item.assetId !== "string" || !Number.isSafeInteger(item.order) || item.order < 1)
    ) {
        throw new XiajiProjectionArrangeError("invalid-beat-order", "剧本锚点中的分镜顺序无效或重复");
    }
    const expectedRequestDigest = await sha256([input.canvasId, projectAssetId, episodeAssetId, sourceDigest, mode, sourceIds, beatOrder as Array<{ assetId: string; order: number }>]);
    if (expectedRequestDigest !== anchorMetadata.projectionRequestDigest) {
        throw new XiajiProjectionArrangeError("projection-anchor-digest-mismatch", "剧本锚点摘要与保存的顺序清单不一致");
    }

    const members = projectionMembers(input.nodes, input.projectionId);
    const memberBySourceId = new Map<string, CanvasNodeData>();
    for (const member of members) {
        const sourceId = member.metadata?.sourceEntityId;
        if (!sourceId || !sourceIds.includes(sourceId) || memberBySourceId.has(sourceId)) throw new XiajiProjectionArrangeError("projection-member-mismatch", "画布中存在重复或未批准的虾镜投影成员");
        memberBySourceId.set(sourceId, member);
        if (
            member.metadata?.projectionCanvasId !== input.canvasId ||
            member.metadata?.sourceProjectId !== projectAssetId ||
            member.metadata?.sourceEpisodeAssetId !== episodeAssetId ||
            member.metadata?.sourceRevision !== sourceDigest ||
            member.metadata?.projectionMode !== mode ||
            member.metadata?.projectionManifestDigest !== manifestDigest ||
            !member.metadata?.projectionKey ||
            !member.metadata?.sourceItemDigest
        ) {
            throw new XiajiProjectionArrangeError("projection-member-metadata-mismatch", `投影成员 ${sourceId} 的来源元数据不一致`);
        }
    }
    for (const id of sourceIds) if (!memberBySourceId.has(id)) throw new XiajiProjectionArrangeError("projection-member-missing", `投影节点缺失：${id}`);

    const roleBySourceId: Record<string, XiajiProjectionRole> = {};
    const itemDigestBySourceId: Record<string, string> = {};
    for (const [sourceId, member] of memberBySourceId) {
        roleBySourceId[sourceId] = sourceRole(member);
        const asset = assetFromProjectionNode(member);
        const itemDigest = await createXiajiProjectionItemDigest(asset, roleBySourceId[sourceId]);
        if (itemDigest !== member.metadata?.sourceItemDigest) throw new XiajiProjectionArrangeError("projection-source-content-changed", `投影节点内容或来源素材已被修改：${sourceId}`);
        itemDigestBySourceId[sourceId] = itemDigest;
    }
    if (roleBySourceId[anchorMetadata.projectionScriptAssetId as string] !== "script" || anchorMetadata.projectionScriptAssetId !== anchor.metadata?.sourceEntityId) {
        throw new XiajiProjectionArrangeError("projection-script-anchor-mismatch", "剧本锚点与来源剧本 ID 不一致");
    }
    for (const item of beatOrder) {
        const selected = memberBySourceId.get(item.assetId);
        if (selected && (sourceRole(selected) !== "beat" || selected.metadata?.sourceBeatOrder !== item.order)) {
            throw new XiajiProjectionArrangeError("projection-beat-order-mismatch", `镜头顺序与来源清单不一致：${item.assetId}`);
        }
    }
    const identity = await createXiajiProjectionIdentityFromSource({
        canvasId: input.canvasId,
        projectAssetId,
        episodeAssetId,
        sourceDigest,
        mode: mode as XiajiProjectionMode,
        sourceAssetIds: sourceIds,
        rolesBySourceAssetId: roleBySourceId,
    });
    if (identity.projectionId !== input.projectionId) throw new XiajiProjectionArrangeError("projection-identity-mismatch", "投影 ID 与来源身份重算结果不一致");
    for (const [sourceId, member] of memberBySourceId) {
        if (member.id !== identity.nodeIds[sourceId] || member.metadata?.projectionKey !== identity.projectionKeys[sourceId]) {
            throw new XiajiProjectionArrangeError("projection-identity-mismatch", `投影节点身份键不一致：${sourceId}`);
        }
    }
    const computedManifestDigest = await sha256(
        sourceIds
            .map((sourceId) => ({
                assetId: sourceId,
                role: roleBySourceId[sourceId],
                projectionKey: identity.projectionKeys[sourceId],
                nodeId: identity.nodeIds[sourceId],
                sourceItemDigest: itemDigestBySourceId[sourceId],
            }))
            .sort((left, right) => left.assetId.localeCompare(right.assetId)),
    );
    if (computedManifestDigest !== manifestDigest) throw new XiajiProjectionArrangeError("projection-manifest-mismatch", "投影清单摘要与当前节点不一致");

    const groupNodeId = `xiaji-group-${(await sha256([input.projectionId, "group"])).slice(0, 32)}`;
    const existingGroups = input.nodes.filter((node) => node.metadata?.projectionId === input.projectionId && node.metadata?.projectionRole === "group");
    if (existingGroups.length > 1 || (existingGroups.length === 1 && existingGroups[0].id !== groupNodeId)) {
        throw new XiajiProjectionArrangeError("projection-group-conflict", "目标投影存在重复或身份冲突的分组");
    }
    const preexistingGroupIdCollision = input.nodes.find((node) => node.id === groupNodeId && node.metadata?.projectionId !== input.projectionId);
    if (preexistingGroupIdCollision) throw new XiajiProjectionArrangeError("projection-group-id-conflict", "确定性分组 ID 已被其他画布节点占用");

    const alreadyArranged = existingGroups.length === 1;
    const initialScriptPosition = anchorMetadata.projectionImportedPosition;
    if (!alreadyArranged && members.some((node) => Boolean(node.metadata?.groupId))) {
        throw new XiajiProjectionArrangeError("projection-node-grouped", "虾镜投影节点已加入其他分组；排版不会覆盖现有分组");
    }
    if (!alreadyArranged && (!isRecord(initialScriptPosition) || numberValue(initialScriptPosition.x) === undefined || numberValue(initialScriptPosition.y) === undefined)) {
        throw new XiajiProjectionArrangeError("missing-import-position", "导入节点缺少原始位置记录，无法安全排版");
    }
    const origin = alreadyArranged ? { x: existingGroups[0].position.x + GROUP_PADDING, y: existingGroups[0].position.y + GROUP_PADDING } : { x: numberValue(initialScriptPosition!.x)!, y: numberValue(initialScriptPosition!.y)! };
    if (!alreadyArranged) {
        const moved = members.filter((node) => !isRecord(node.metadata?.projectionImportedPosition) || node.position.x !== node.metadata?.projectionImportedPosition?.x || node.position.y !== node.metadata?.projectionImportedPosition?.y);
        if (moved.length) throw new XiajiProjectionArrangeError("projection-node-moved-before-arrange", `导入后节点已被手动移动，排版前需复核：${moved.map((node) => node.id).join("、")}`);
    }
    const { arranged, groupPosition, groupSize } = layoutNodes(members, origin);
    const layoutDigest = await sha256(arranged.map((node) => [node.id, node.position, node.width, node.height, groupNodeId]));
    const arrangeRequestDigest = await sha256([input.projectionId, manifestDigest, layoutDigest]);
    if (anchorMetadata.projectionArrangeRequestKey === input.idempotencyKey && anchorMetadata.projectionArrangeRequestDigest !== arrangeRequestDigest) {
        throw new XiajiProjectionArrangeError("idempotency-conflict", "排版幂等键已用于不同的布局内容");
    }
    if (alreadyArranged) {
        const actualGroup = existingGroups[0];
        if (actualGroup.metadata?.projectionLayoutDigest !== layoutDigest || actualGroup.position.x !== groupPosition.x || actualGroup.position.y !== groupPosition.y || actualGroup.width !== groupSize.width || actualGroup.height !== groupSize.height) {
            throw new XiajiProjectionArrangeError("projection-layout-edited", "分组或排版结果已被手动修改，拒绝覆盖");
        }
        for (const expected of arranged) {
            const actual = input.nodes.find((node) => node.id === expected.id)!;
            if (
                actual.position.x !== expected.position.x ||
                actual.position.y !== expected.position.y ||
                actual.metadata?.groupId !== groupNodeId ||
                actual.metadata?.projectionGroupNodeId !== groupNodeId ||
                actual.metadata?.projectionLayoutDigest !== layoutDigest
            ) {
                throw new XiajiProjectionArrangeError("projection-layout-edited", `投影节点已被手动移动或脱离分组：${expected.id}`);
            }
        }
    }

    const groupNode: CanvasNodeData = {
        id: groupNodeId,
        type: CanvasNodeType.Group,
        title: `${anchor.title} · ${members.filter((node) => sourceRole(node) === "beat").length} 镜`,
        position: groupPosition,
        width: groupSize.width,
        height: groupSize.height,
        metadata: {
            status: "success",
            projectionId: input.projectionId,
            projectionRole: "group",
            projectionCanvasId: input.canvasId,
            projectionMode: mode as XiajiProjectionMode,
            projectionSourceAssetIds: sourceIds,
            projectionManifestDigest: manifestDigest,
            projectionLayoutDigest: layoutDigest,
        },
    };
    const arrangedById = new Map(arranged.map((node) => [node.id, node]));
    const finalNodes = input.nodes.map((node) => {
        const updated = arrangedById.get(node.id);
        if (!updated) return node;
        return {
            ...updated,
            metadata: {
                ...updated.metadata,
                groupId: groupNodeId,
                projectionGroupNodeId: groupNodeId,
                projectionLayoutDigest: layoutDigest,
            },
        };
    });
    if (!alreadyArranged) finalNodes.push(groupNode);
    const finalAnchor = finalNodes.find((node) => node.id === anchor.id)!;
    finalAnchor.metadata = {
        ...finalAnchor.metadata,
        projectionArrangeRequestKey: input.idempotencyKey,
        projectionArrangeRequestDigest: arrangeRequestDigest,
    };
    const finalGroup = finalNodes.find((node) => node.id === groupNodeId)!;
    finalGroup.metadata = { ...finalGroup.metadata, projectionArrangeRequestKey: input.idempotencyKey, projectionArrangeRequestDigest: arrangeRequestDigest };

    const { relationships, missingEdges } = relationshipsFor(members, beatOrder as Array<{ assetId: string; order: number }>);
    const finalConnections = [...input.connections];
    const createdConnectionIds: string[] = [];
    const reusedConnectionIds: string[] = [];
    const existingByEndpoints = new Map(finalConnections.map((edge) => [`${edge.fromNodeId}\u0000${edge.toNodeId}`, edge]));
    const existingById = new Map(finalConnections.map((edge) => [edge.id, edge]));
    for (const relationship of relationships) {
        const from = memberBySourceId.get(relationship.fromSourceAssetId)!;
        const to = memberBySourceId.get(relationship.toSourceAssetId)!;
        const byEndpoints = existingByEndpoints.get(`${from.id}\u0000${to.id}`);
        if (byEndpoints) {
            reusedConnectionIds.push(byEndpoints.id);
            continue;
        }
        const connectionId = `xiaji-edge-${(await sha256([input.projectionId, relationship.kind, from.id, to.id])).slice(0, 32)}`;
        const idCollision = existingById.get(connectionId);
        if (idCollision && (idCollision.fromNodeId !== from.id || idCollision.toNodeId !== to.id)) {
            throw new XiajiProjectionArrangeError("connection-id-conflict", `连线 ID 冲突，拒绝覆盖：${connectionId}`);
        }
        if (idCollision) {
            reusedConnectionIds.push(connectionId);
            continue;
        }
        const edge = { id: connectionId, fromNodeId: from.id, toNodeId: to.id };
        finalConnections.push(edge);
        existingByEndpoints.set(`${from.id}\u0000${to.id}`, edge);
        existingById.set(connectionId, edge);
        createdConnectionIds.push(connectionId);
    }
    const movedNodeIds = arranged
        .filter((node) => {
            const current = members.find((member) => member.id === node.id)!;
            return current.position.x !== node.position.x || current.position.y !== node.position.y;
        })
        .map((node) => node.id);

    return { projectionId: input.projectionId, manifestDigest, groupNodeId, layoutDigest, nodes: finalNodes, connections: finalConnections, createdConnectionIds, reusedConnectionIds, missingEdges, movedNodeIds };
}
