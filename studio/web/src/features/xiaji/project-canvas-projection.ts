// SPDX-License-Identifier: AGPL-3.0-or-later

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/app/(user)/canvas/types";
import type { Asset } from "@/stores/use-asset-store";
import { getLocalStudioRecord } from "./local-studio-model";

export type XiajiProjectProjectionRole = "project" | "manuscript" | "episode";
export type XiajiProjectProjectionIssue = { code: string; message: string; assetId?: string };
export type XiajiProjectProjectionRelationship = { fromAssetId: string; toAssetId: string; kind: "manuscript" | "episode" };
export type XiajiProjectProjectionPreview = {
    projectAssetId: string;
    sourceDigest: string;
    items: Array<{ assetId: string; role: XiajiProjectProjectionRole; title: string; content: string; order?: number }>;
    relationships: XiajiProjectProjectionRelationship[];
    issues: XiajiProjectProjectionIssue[];
};

export type XiajiProjectProjectionImportPlan = {
    projectionId: string;
    manifestDigest: string;
    nodes: CanvasNodeData[];
    nodeIdsBySourceAssetId: Record<string, string>;
    createdSourceAssetIds: string[];
    reusedSourceAssetIds: string[];
    relationships: Array<{ fromNodeId: string; toNodeId: string; kind: "manuscript" | "episode" }>;
};

export type XiajiProjectProjectionArrangementPlan = {
    projectionId: string;
    manifestDigest: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    approvedNodeIds: string[];
    addedConnectionIds: string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (isObject(value)) {
        return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

async function sha256(value: unknown): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sourceItemContent(asset: Asset, role: XiajiProjectProjectionRole): string {
    if (role === "project") {
        const record = getLocalStudioRecord(asset);
        return `项目：${asset.title}\n类型：${record?.recordType === "project" ? record.projectType : "未知"}\n基础风格：${record?.recordType === "project" ? record.baseStyle : "未知"}`;
    }
    return asset.kind === "text" ? asset.data.content : "";
}

export async function previewXiajiProjectProjection(assets: Asset[], projectAssetId: string): Promise<XiajiProjectProjectionPreview> {
    const issues: XiajiProjectProjectionIssue[] = [];
    const byId = new Map<string, Asset>();
    for (const asset of assets) {
        if (byId.has(asset.id)) issues.push({ code: "duplicate-asset-id", message: "本地素材 ID 重复，无法建立无歧义的项目投影", assetId: asset.id });
        else byId.set(asset.id, asset);
    }

    const project = byId.get(projectAssetId);
    const projectRecord = project ? getLocalStudioRecord(project) : null;
    if (!project || projectRecord?.recordType !== "project") {
        issues.push({ code: "missing-project", message: "项目不存在或不是虾镜本地项目", assetId: projectAssetId });
    }

    const items: XiajiProjectProjectionPreview["items"] = [];
    const relationships: XiajiProjectProjectionRelationship[] = [];
    if (project && projectRecord?.recordType === "project") {
        items.push({ assetId: project.id, role: "project", title: project.title, content: sourceItemContent(project, "project") });
        const manuscript = projectRecord.sourceAssetId ? byId.get(projectRecord.sourceAssetId) : undefined;
        if (!manuscript || manuscript.kind !== "text" || manuscript.category !== "xiaji:source") {
            issues.push({ code: "missing-manuscript", message: "项目关联的原稿不存在或不是文本原稿", assetId: projectRecord.sourceAssetId || project.id });
        } else {
            items.push({ assetId: manuscript.id, role: "manuscript", title: manuscript.title, content: manuscript.data.content });
            relationships.push({ fromAssetId: project.id, toAssetId: manuscript.id, kind: "manuscript" });
        }

        const episodes = assets.flatMap((asset) => {
            const record = getLocalStudioRecord(asset);
            return record?.recordType === "episode" && record.projectAssetId === projectAssetId ? [{ asset, record }] : [];
        }).sort((left, right) => left.record.order - right.record.order || left.asset.id.localeCompare(right.asset.id));
        const seenOrders = new Set<number>();
        for (const { asset, record } of episodes) {
            if (!Number.isSafeInteger(record.order) || record.order < 1 || !record.title.trim()) {
                issues.push({ code: "invalid-episode", message: "分集缺少有效序号或标题", assetId: asset.id });
                continue;
            }
            if (seenOrders.has(record.order)) issues.push({ code: "duplicate-episode-order", message: `分集序号 ${record.order} 重复`, assetId: asset.id });
            seenOrders.add(record.order);
            items.push({ assetId: asset.id, role: "episode", title: `第 ${record.order} 集 · ${record.title}`, content: asset.kind === "text" ? asset.data.content : record.synopsis || "", order: record.order });
            relationships.push({ fromAssetId: project.id, toAssetId: asset.id, kind: "episode" });
        }
    }

    const sourceDigest = await sha256(items.map((item) => {
        const asset = byId.get(item.assetId)!;
        return { ...item, kind: asset.kind, category: asset.category, tags: asset.tags, metadata: asset.metadata, data: asset.data };
    }));
    return { projectAssetId, sourceDigest, items, relationships, issues };
}

function nodeRole(node: CanvasNodeData): XiajiProjectProjectionRole | null {
    const role = node.metadata?.projectionRole;
    return role === "project" || role === "manuscript" || role === "episode" ? role : null;
}

export async function planXiajiProjectProjectionImport(input: {
    canvasId: string;
    existingNodes: CanvasNodeData[];
    assets: Asset[];
    preview: XiajiProjectProjectionPreview;
    sourceDigest: string;
    sourceAssetIds: string[];
    origin: Position;
}): Promise<XiajiProjectProjectionImportPlan> {
    if (input.preview.issues.length) throw new Error(input.preview.issues.map((issue) => issue.message).join("；"));
    if (input.sourceDigest !== input.preview.sourceDigest) throw new Error("项目原稿或分集在预览后已变化，请重新预览");
    if (new Set(input.sourceAssetIds).size !== input.sourceAssetIds.length) throw new Error("批准的来源 ID 不能重复");
    const approved = new Set(input.sourceAssetIds);
    for (const required of [input.preview.projectAssetId, input.preview.items.find((item) => item.role === "manuscript")?.assetId || ""]) {
        if (!required || !approved.has(required)) throw new Error("项目结构导入必须包含项目和原稿");
    }
    const selectedItems = input.preview.items.filter((item) => approved.has(item.assetId));
    if (selectedItems.length !== approved.size) throw new Error("批准列表包含当前预览之外的素材");
    const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
    const projectionId = `xiaji-project:${await sha256([input.canvasId, input.preview.projectAssetId, input.preview.sourceDigest])}`;
    const nodeIdsBySourceAssetId: Record<string, string> = {};
    const createdSourceAssetIds: string[] = [];
    const reusedSourceAssetIds: string[] = [];
    const importedNodes: CanvasNodeData[] = [];
    const existingByKey = new Map(input.existingNodes.flatMap((node) => node.metadata?.projectionKey ? [[node.metadata.projectionKey, node] as const] : []));

    for (const [index, item] of selectedItems.entries()) {
        const asset = assetsById.get(item.assetId);
        if (!asset) throw new Error(`来源素材已不存在：${item.assetId}`);
        const itemDigest = await sha256({ item, data: asset.data, metadata: asset.metadata, category: asset.category, tags: asset.tags });
        const projectionKey = `xiaji-project:v1:${await sha256([projectionId, item.role, item.assetId])}`;
        const nodeId = `xiaji-project-node-${(await sha256(projectionKey)).slice(0, 32)}`;
        const prior = existingByKey.get(projectionKey);
        if (prior) {
            if (prior.metadata?.sourceItemDigest !== itemDigest || prior.metadata?.sourceEntityId !== item.assetId) {
                throw new Error(`画布中的来源节点与本次预览不一致：${item.title}；请重新审阅当前画布`);
            }
            nodeIdsBySourceAssetId[item.assetId] = prior.id;
            reusedSourceAssetIds.push(item.assetId);
            continue;
        }
        const position = item.role === "project"
            ? input.origin
            : item.role === "manuscript"
                ? { x: input.origin.x + 520, y: input.origin.y }
                : { x: input.origin.x + 1040, y: input.origin.y + (index - 2) * 330 };
        const node: CanvasNodeData = {
            id: nodeId,
            type: CanvasNodeType.Text,
            title: item.title,
            position,
            width: item.role === "manuscript" ? 500 : 420,
            height: item.role === "manuscript" ? 600 : 280,
            metadata: {
                content: item.content,
                prompt: item.content,
                status: "success",
                sourceSystem: "infinite-canvas",
                sourceProjectId: input.preview.projectAssetId,
                sourceEntityType: item.role,
                sourceEntityId: item.assetId,
                projectionId,
                projectionRole: item.role,
                projectionKey,
                sourceItemDigest: itemDigest,
                projectionCanvasId: input.canvasId,
                projectionImportedPosition: position,
                xiajiProjectAssetId: input.preview.projectAssetId,
                ...(item.order ? { sourceEpisode: item.order } : {}),
                ...(asset.metadata?.localStudio ? { localStudio: asset.metadata.localStudio } : {}),
            },
        };
        nodeIdsBySourceAssetId[item.assetId] = node.id;
        createdSourceAssetIds.push(item.assetId);
        importedNodes.push(node);
    }

    const relationships = input.preview.relationships.filter((relationship) => approved.has(relationship.fromAssetId) && approved.has(relationship.toAssetId)).map((relationship) => ({
        fromNodeId: nodeIdsBySourceAssetId[relationship.fromAssetId],
        toNodeId: nodeIdsBySourceAssetId[relationship.toAssetId],
        kind: relationship.kind,
    }));
    const manifestDigest = await sha256({ projectionId, nodeIdsBySourceAssetId, selectedItems, relationships, nodes: importedNodes });
    return { projectionId, manifestDigest, nodes: [...input.existingNodes, ...importedNodes], nodeIdsBySourceAssetId, createdSourceAssetIds, reusedSourceAssetIds, relationships };
}

export async function planXiajiProjectProjectionArrangement(input: {
    canvasId: string;
    projectionId: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
}): Promise<XiajiProjectProjectionArrangementPlan> {
    const members = input.nodes.filter((node) => node.metadata?.projectionId === input.projectionId && nodeRole(node));
    if (!members.length || members.some((node) => node.metadata?.projectionCanvasId !== input.canvasId)) throw new Error("项目投影不存在或不属于当前画布");
    const project = members.find((node) => nodeRole(node) === "project");
    const manuscript = members.find((node) => nodeRole(node) === "manuscript");
    const episodes = members.filter((node) => nodeRole(node) === "episode").sort((a, b) => (a.metadata?.sourceEpisode || 0) - (b.metadata?.sourceEpisode || 0) || a.id.localeCompare(b.id));
    if (!project || !manuscript) throw new Error("项目投影缺少项目或原稿节点");
    for (const node of members) {
        const imported = node.metadata?.projectionImportedPosition;
        const arranged = node.metadata?.projectionArrangedPosition;
        const matchesImportPosition = isObject(imported) && imported.x === node.position.x && imported.y === node.position.y;
        const matchesPriorArrangement = node.metadata?.projectionLayoutProjectionId === input.projectionId
            && isObject(arranged) && arranged.x === node.position.x && arranged.y === node.position.y;
        if (!matchesImportPosition && !matchesPriorArrangement) {
            throw new Error(`节点“${node.title}”在导入后已移动；请先审阅位置，避免自动覆盖你的画布编辑`);
        }
    }
    const otherNodes = input.nodes.filter((node) => !members.some((member) => member.id === node.id));
    const right = Math.max(0, otherNodes.reduce((edge, node) => Math.max(edge, node.position.x + node.width), 0)) + 320;
    const origin = { x: right, y: 0 };
    const targetPositions = new Map<string, Position>([
        [project.id, origin],
        [manuscript.id, { x: origin.x + 560, y: origin.y }],
        ...episodes.map((node, index) => [node.id, { x: origin.x + 1120, y: origin.y + index * 340 }] as const),
    ]);
    const nextNodes = input.nodes.map((node) => {
        const position = targetPositions.get(node.id);
        return position ? {
            ...node,
            position,
            metadata: { ...node.metadata, projectionArrangedPosition: position, projectionLayoutProjectionId: input.projectionId },
        } : node;
    });
    const expectedRelations = [
        { fromNodeId: project.id, toNodeId: manuscript.id },
        ...episodes.map((episode) => ({ fromNodeId: project.id, toNodeId: episode.id })),
    ];
    const added: CanvasConnection[] = [];
    for (const relation of expectedRelations) {
        const exists = input.connections.some((edge) => edge.fromNodeId === relation.fromNodeId && edge.toNodeId === relation.toNodeId);
        if (exists) continue;
        const id = `xiaji-project-edge-${(await sha256([input.projectionId, relation.fromNodeId, relation.toNodeId])).slice(0, 32)}`;
        if (!input.connections.some((edge) => edge.id === id)) added.push({ id, ...relation });
    }
    const nextConnections = [...input.connections, ...added];
    const manifestDigest = await sha256({
        projectionId: input.projectionId,
        nodes: members.map(({ id }) => ({ id, position: targetPositions.get(id) })).sort((a, b) => a.id.localeCompare(b.id)),
        connections: [...input.connections, ...added].filter((edge) => members.some((node) => node.id === edge.fromNodeId) && members.some((node) => node.id === edge.toNodeId)),
        canvasObstacles: otherNodes.map(({ id, position, width, height }) => ({ id, position, width, height })).sort((a, b) => a.id.localeCompare(b.id)),
    });
    return { projectionId: input.projectionId, manifestDigest, nodes: nextNodes, connections: nextConnections, approvedNodeIds: members.map((node) => node.id).sort(), addedConnectionIds: added.map((edge) => edge.id) };
}
