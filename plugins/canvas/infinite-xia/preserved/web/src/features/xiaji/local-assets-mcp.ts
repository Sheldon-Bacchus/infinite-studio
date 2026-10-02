import { getNodeSpec } from "@/app/(user)/canvas/constants";
import { CanvasNodeType, type CanvasNodeData, type Position } from "@/app/(user)/canvas/types";
import { isCanvasImageNodeType } from "@/app/(user)/canvas/utils/canvas-panorama";
import type { Asset } from "@/stores/use-asset-store";

export const LOCAL_ASSET_SHOT_KEYS = ["SHOT-05", "SHOT-06", "SHOT-07", "SHOT-08"] as const;
export type LocalAssetShotKey = (typeof LOCAL_ASSET_SHOT_KEYS)[number];
export type CanvasLocalAssetSummary = {
    assetId: string;
    title: string;
    type: Asset["kind"];
    category: string;
    tags: string[];
    mediaAvailable: boolean;
    mimeType?: string;
    bytes?: number;
};

export type CanvasLocalAssetPage = {
    items: CanvasLocalAssetSummary[];
    total: number;
    page: number;
    pageSize: number;
};

export function listCanvasLocalAssets(assets: Asset[], filters: { page?: number; pageSize?: number; keyword?: string; type?: Asset["kind"]; category?: string; tag?: string } = {}): CanvasLocalAssetPage {
    const page = Math.max(1, Math.floor(filters.page || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(filters.pageSize || 50)));
    const keyword = filters.keyword?.trim().toLocaleLowerCase() || "";
    const category = filters.category?.trim().toLocaleLowerCase() || "";
    const tag = filters.tag?.trim().toLocaleLowerCase() || "";
    const filtered = assets
        .filter((asset) => !filters.type || asset.kind === filters.type)
        .filter((asset) => !category || (asset.category || "").toLocaleLowerCase() === category)
        .filter((asset) => !tag || asset.tags.some((item) => item.toLocaleLowerCase() === tag))
        .filter((asset) => {
            if (!keyword) return true;
            return [asset.id, asset.title, asset.kind, asset.category || "", ...asset.tags].some((value) => value.toLocaleLowerCase().includes(keyword));
        })
        .sort((left, right) => left.id.localeCompare(right.id));

    const items = filtered.slice((page - 1) * pageSize, page * pageSize).map((asset): CanvasLocalAssetSummary => {
        const media = asset.kind === "text" ? undefined : asset.data;
        const reference = asset.kind === "image" ? asset.data.dataUrl : asset.kind === "audio" || asset.kind === "video" ? asset.data.url : "";
        return {
            assetId: asset.id,
            title: asset.title || "未命名素材",
            type: asset.kind,
            category: asset.category || "未分类",
            tags: [...asset.tags],
            mediaAvailable: Boolean(reference?.trim() && media?.storageKey && media.mimeType),
            ...(media?.mimeType ? { mimeType: media.mimeType } : {}),
            ...(media && "bytes" in media && typeof media.bytes === "number" ? { bytes: media.bytes } : {}),
        };
    });

    return { items, total: filtered.length, page, pageSize };
}

export function bindComposerMediaReferences(composerContent: string, orderedMediaNodeIds: string[], replaceableMediaNodeIds: string[] = orderedMediaNodeIds) {
    const mediaIds = new Set([...replaceableMediaNodeIds, ...orderedMediaNodeIds]);
    const promptBody = composerContent
        .split(/\r?\n/)
        .filter((line) => !/^Reference assets:\s*/i.test(line.trim()))
        .map((line) => line.replace(/@\[node:([^\]]+)\]/g, (token, nodeId: string) => (mediaIds.has(nodeId) ? "" : token)))
        .join("\n")
        .replace(/^\s*\n+|\n+\s*$/g, "");
    const referenceLine = `Reference assets: ${orderedMediaNodeIds.map((nodeId) => `@[node:${nodeId}]`).join(" ")}`;
    return promptBody ? `${referenceLine}\n${promptBody}` : referenceLine;
}

export function buildConfigMediaBinding(configNode: CanvasNodeData, mediaNodeIds: string[], nodes: CanvasNodeData[]) {
    if (configNode.type !== CanvasNodeType.Config || !configNode.metadata?.groupId) throw new Error("配置节点缺少有效镜头组");
    if (!mediaNodeIds.length || mediaNodeIds.length > 50 || new Set(mediaNodeIds).size !== mediaNodeIds.length) throw new Error("媒体节点 ID 必须是 1 到 50 个不重复 ID");
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const promptNodeIds = [...(configNode.metadata.composerContent || "").matchAll(/@\[node:([^\]]+)\]/g)].map((match) => match[1]);
    const hasPrompt = promptNodeIds.some((nodeId) => {
        const node = nodeById.get(nodeId);
        return node?.type === CanvasNodeType.Text && node.metadata?.groupId === configNode.metadata?.groupId && Boolean((node.metadata?.content || node.metadata?.prompt)?.trim());
    });
    if (!hasPrompt) throw new Error("配置中没有同组有效提示词芯片");

    const mediaNodes = mediaNodeIds.map((nodeId) => {
        const node = nodeById.get(nodeId);
        if (!node) throw new Error("找不到节点 " + nodeId);
        if (node.metadata?.groupId !== configNode.metadata?.groupId) throw new Error("素材必须属于同一镜头组：" + nodeId);
        const isImage = isCanvasImageNodeType(node.type) && node.metadata?.mimeType?.startsWith("image/");
        const isAudio = node.type === CanvasNodeType.Audio && node.metadata?.mimeType?.startsWith("audio/");
        if ((!isImage && !isAudio) || !node.metadata?.content?.trim() || !node.metadata?.storageKey?.trim() || node.metadata?.sourceSystem !== "infinite-canvas" || node.metadata?.sourceEntityType !== "asset") {
            throw new Error("只可绑定同组本地素材库中的真实图片或音频节点：" + nodeId);
        }
        return node;
    });

    const replaceableIds = nodes.filter((node) => node.metadata?.groupId === configNode.metadata?.groupId && (isCanvasImageNodeType(node.type) || node.type === CanvasNodeType.Audio || node.type === CanvasNodeType.Video)).map((node) => node.id);
    return {
        mediaNodes,
        composerContent: bindComposerMediaReferences(configNode.metadata.composerContent || "", mediaNodeIds, replaceableIds),
    };
}

export function buildVideoConfigDraftNode(input: {
    id: string;
    shotKey: LocalAssetShotKey;
    groupNodeId: string;
    promptNodeId: string;
    position: Position;
    durationSeconds: number;
    aspectRatio: string;
    quality: string;
    model?: string;
    channelId?: string;
    existingNode?: CanvasNodeData;
}): CanvasNodeData {
    const qualityMatch = input.quality.trim().match(/^(480|720|768|1080)p?$/i);
    if (!qualityMatch) throw new Error("不支持的视频清晰度");
    if (input.existingNode && (input.existingNode.id !== input.id || input.existingNode.type !== CanvasNodeType.Config)) {
        throw new Error("配置草稿 ID 已被其他节点占用");
    }
    const spec = getNodeSpec(CanvasNodeType.Config);
    const previous = input.existingNode;
    const previousPrompt = previous?.metadata?.composerContent?.trim();
    return {
        id: input.id,
        type: CanvasNodeType.Config,
        title: `EP001 · ${input.shotKey} 配置草稿`,
        position: input.position,
        width: previous?.width || spec.width,
        height: previous?.height || spec.height,
        metadata: {
            ...spec.metadata,
            ...previous?.metadata,
            content: "",
            composerContent: previousPrompt || `@[node:${input.promptNodeId}]`,
            status: "idle",
            generationMode: "video",
            groupId: input.groupNodeId,
            sourceSystem: "infinite-canvas",
            sourceEntityType: "h3_config_draft",
            sourceEntityId: input.shotKey,
            projectionRole: "config",
            projectionKey: `infinite-canvas:config:${input.groupNodeId}:${input.shotKey}`,
            ...(input.model ? { model: input.model } : {}),
            ...(input.channelId ? { channelId: input.channelId } : {}),
            seconds: String(input.durationSeconds),
            size: input.aspectRatio,
            vquality: qualityMatch[1],
        },
    };
}

