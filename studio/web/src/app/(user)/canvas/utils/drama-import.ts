import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import type { DramaAssetCatalog, DramaImportAsset, DramaImportBeat, DramaImportCatalog, DramaImportEpisode } from "@/services/api/drama-import";

type DramaProjectionCatalog = DramaImportCatalog | DramaAssetCatalog;

export type DramaImportedMedia = {
    url: string;
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    durationMs?: number;
};

export type DramaBeatMedia = {
    image?: DramaImportedMedia;
    video?: DramaImportedMedia;
    audio?: DramaImportedMedia;
};

export type DramaMediaByBeat = Record<number, DramaBeatMedia>;

export type DramaCanvasProjection = {
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    backgroundMode: "lines";
    showImageInfo: boolean;
};

export type DramaCanvasProjectionInput = {
    catalog: DramaProjectionCatalog;
    episode?: DramaImportEpisode;
    mediaByBeat?: DramaMediaByBeat;
    assets?: DramaImportAsset[];
    presetId?: string;
    origin?: { x: number; y: number };
};

const BEAT_COLUMNS = 2;
const BEAT_COLUMN_WIDTH = 1_400;
const BEAT_ROW_HEIGHT = 480;

type ProjectionMetadataInput = {
    catalog: DramaProjectionCatalog;
    sourceSystem?: string;
    sourceProjectId?: string;
    sourceEntityType: string;
    sourceEntityId: string;
    sourceMediaRole: string;
    projectionRole: string;
    presetId?: string;
    episode?: number;
    groupId?: string;
};

function projectionKey(input: ProjectionMetadataInput) {
    return JSON.stringify([
        input.sourceSystem || "dramaclaw",
        input.sourceProjectId || input.catalog.project.id,
        input.sourceEntityType,
        input.episode ?? null,
        input.sourceEntityId,
        input.sourceMediaRole,
        input.projectionRole,
        input.presetId || "",
    ]);
}

function projectionNodeId(key: string) {
    return `drama-${encodeURIComponent(key)}`;
}

function sourceMetadata(input: ProjectionMetadataInput) {
    return {
        ...(input.groupId ? { groupId: input.groupId } : {}),
        sourceSystem: input.sourceSystem || "dramaclaw",
        sourceProjectId: input.sourceProjectId || input.catalog.project.id,
        ...(input.episode === undefined ? {} : { sourceEpisode: input.episode }),
        sourceRevision: input.catalog.sourceSnapshot.revision,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        sourceMediaRole: input.sourceMediaRole,
        projectionRole: input.projectionRole,
        projectionKey: projectionKey(input),
        ...(input.presetId ? { sourcePresetId: input.presetId } : {}),
    };
}

function mediaNode(
    type: CanvasNodeType.Image | CanvasNodeType.Video | CanvasNodeType.Audio,
    id: string,
    title: string,
    position: { x: number; y: number },
    sourceUrl: string,
    media: DramaImportedMedia | undefined,
    metadata: ReturnType<typeof sourceMetadata>,
): CanvasNodeData {
    const fallback = sourceUrl ? { url: sourceUrl } : undefined;
    const stored: DramaImportedMedia | undefined = media || fallback;
    return {
        id,
        type,
        title,
        position,
        width: type === CanvasNodeType.Video ? 420 : 340,
        height: type === CanvasNodeType.Video ? 236 : type === CanvasNodeType.Audio ? 160 : 240,
        metadata: {
            ...metadata,
            content: stored?.url || "",
            sourceUrl: sourceUrl || stored?.url,
            storageKey: stored?.storageKey,
            mimeType: stored?.mimeType,
            bytes: stored?.bytes,
            durationMs: stored?.durationMs,
            status: "success",
        },
    };
}

function connection(from: CanvasNodeData, to: CanvasNodeData): CanvasConnection {
    const key = JSON.stringify([from.metadata?.projectionKey || from.id, to.metadata?.projectionKey || to.id]);
    return { id: `drama-edge-${encodeURIComponent(key)}`, fromNodeId: from.id, toNodeId: to.id };
}

function beatPrompt(beat: DramaImportBeat) {
    return [
        beat.content,
        beat.visualDescription ? `视觉描述：${beat.visualDescription}` : "",
        beat.keyframePrompt ? `首帧提示词：${beat.keyframePrompt}` : "",
        beat.videoPrompt ? `视频提示词：${beat.videoPrompt}` : beat.prompt ? `提示词：${beat.prompt}` : "",
        beat.audioPrompt ? `音频提示词：${beat.audioPrompt}` : "",
        beat.videoMode ? `视频模式：${beat.videoMode}` : "",
        beat.durationSeconds ? `目标时长：${beat.durationSeconds} 秒` : "",
        beat.sceneId ? `场景：${beat.sceneId}` : "",
        beat.identityIds.length ? `角色：${beat.identityIds.join("、")}` : "",
        beat.propIds.length ? `道具：${beat.propIds.join("、")}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

function assetSourceEntityType(asset: DramaImportAsset) {
    if (asset.tab === "scenes") return "scene";
    if (asset.tab === "voices") return "voice";
    if (asset.tab === "characters") return asset.role.includes("voice") ? "voice" : "character";
    if (asset.tab === "props") return "prop";
    if (asset.tab === "beats") return "beat";
    return "asset";
}

function assetSourceEntityId(asset: DramaImportAsset) {
    const value = asset.meta?.scene_id || asset.meta?.identity_id || asset.meta?.prop_id || asset.meta?.character;
    return typeof value === "string" ? value : asset.id;
}

function assetNodeType(asset: DramaImportAsset) {
    if (asset.mediaType === "text") return CanvasNodeType.Text;
    if (asset.mediaType === "image") return CanvasNodeType.Image;
    if (asset.mediaType === "video") return CanvasNodeType.Video;
    if (asset.mediaType === "audio") return CanvasNodeType.Audio;
    return undefined;
}

function assetProjectionBlocks(assets: DramaImportAsset[]) {
    const blocks: Array<{ assets: DramaImportAsset[]; sceneId?: string }> = [];
    const sceneBlocks = new Map<string, { assets: DramaImportAsset[]; sceneId: string }>();
    for (const asset of assets) {
        if (asset.tab === "scenes") {
            const sceneId = assetSourceEntityId(asset);
            let block = sceneBlocks.get(sceneId);
            if (!block) {
                block = { assets: [], sceneId };
                sceneBlocks.set(sceneId, block);
                blocks.push(block);
            }
            block.assets.push(asset);
        } else {
            blocks.push({ assets: [asset] });
        }
    }
    return blocks;
}

function assetMetadata(catalog: DramaProjectionCatalog, asset: DramaImportAsset, presetId?: string, groupId?: string) {
    const sourceEpisode = asset.meta?.episode;
    return sourceMetadata({
        catalog,
        sourceSystem: typeof asset.meta?.sourceSystem === "string" ? asset.meta.sourceSystem : undefined,
        sourceProjectId: typeof asset.meta?.sourceProjectId === "string" ? asset.meta.sourceProjectId : undefined,
        sourceEntityType: assetSourceEntityType(asset),
        sourceEntityId: asset.id || assetSourceEntityId(asset),
        sourceMediaRole: asset.role || asset.mediaType,
        projectionRole: `asset-${asset.mediaType}`,
        presetId,
        episode: typeof sourceEpisode === "number" ? sourceEpisode : undefined,
        groupId,
    });
}

function assetText(asset: DramaImportAsset) {
    const content = asset.meta?.content || asset.meta?.text;
    return typeof content === "string" && content ? content : asset.label;
}

function assetMedia(asset: DramaImportAsset): DramaImportedMedia | undefined {
    if (!asset.url) return undefined;
    return {
        url: asset.url,
        storageKey: typeof asset.meta?.storageKey === "string" ? asset.meta.storageKey : undefined,
        width: typeof asset.meta?.width === "number" ? asset.meta.width : undefined,
        height: typeof asset.meta?.height === "number" ? asset.meta.height : undefined,
        bytes: typeof asset.meta?.bytes === "number" ? asset.meta.bytes : undefined,
        mimeType: typeof asset.meta?.mimeType === "string" ? asset.meta.mimeType : undefined,
        durationMs: typeof asset.meta?.durationMs === "number" ? asset.meta.durationMs : undefined,
    };
}

export function buildDramaCanvasProjection({ catalog, episode, mediaByBeat = {}, assets = [], presetId, origin = { x: 0, y: 0 } }: DramaCanvasProjectionInput): DramaCanvasProjection {
    const nodes: CanvasNodeData[] = [];
    const connections: CanvasConnection[] = [];
    const usableAssets = assets.filter((asset) => asset.mediaType === "text" || (asset.exists && Boolean(asset.url) && Boolean(assetNodeType(asset))));
    const blocks = assetProjectionBlocks(usableAssets);
    const blockWidth = 520;
    const blockGap = 80;
    const rows: Array<typeof blocks> = [];
    for (let index = 0; index < blocks.length; index += 2) rows.push(blocks.slice(index, index + 2));
    let assetY = origin.y + 80;

    for (const row of rows) {
        const rowHeight = Math.max(...row.map((block) => (block.sceneId ? block.assets.length * 300 + 100 : 360)));
        row.forEach((block, column) => {
            const x = origin.x + 40 + column * (blockWidth + blockGap);
            const y = assetY;
            let groupId: string | undefined;
            if (block.sceneId) {
                const groupMetadata = sourceMetadata({
                    catalog,
                    sourceEntityType: "scene",
                    sourceEntityId: block.sceneId,
                    sourceMediaRole: "scene",
                    projectionRole: "scene-group",
                    presetId,
                });
                groupId = projectionNodeId(groupMetadata.projectionKey);
                nodes.push({
                    id: groupId,
                    type: CanvasNodeType.Group,
                    title: `场景 · ${block.assets[0].label || block.sceneId}`,
                    position: { x, y },
                    width: blockWidth,
                    height: block.assets.length * 300 + 100,
                    metadata: groupMetadata,
                });
            }
            block.assets.forEach((asset, assetIndex) => {
                const type = assetNodeType(asset);
                if (!type) return;
                const metadata = assetMetadata(catalog, asset, presetId, groupId);
                const id = projectionNodeId(metadata.projectionKey);
                const position = { x: x + 24, y: y + (block.sceneId ? 60 + assetIndex * 300 : 40) };
                if (type === CanvasNodeType.Text) {
                    nodes.push({
                        id,
                        type,
                        title: asset.label || "虾集文本",
                        position,
                        width: 420,
                        height: 240,
                        metadata: {
                            ...metadata,
                            content: assetText(asset),
                            ...(asset.url ? { sourceUrl: asset.url } : {}),
                            status: "success",
                        },
                    });
                } else {
                    nodes.push(mediaNode(type, id, asset.label || "虾集素材", position, asset.url || "", assetMedia(asset), metadata));
                }
            });
        });
        assetY += rowHeight + blockGap;
    }

    if (episode) {
        const groupMetadata = sourceMetadata({
            catalog,
            sourceEntityType: "episode",
            sourceEntityId: `episode:${episode.number}`,
            sourceMediaRole: "episode",
            projectionRole: "episode-group",
            presetId,
            episode: episode.number,
        });
        const groupId = projectionNodeId(groupMetadata.projectionKey);
        const episodeOrigin = { x: origin.x, y: blocks.length ? assetY + 80 : origin.y };
        const episodeNodes: CanvasNodeData[] = [];
        const episodeConnections: CanvasConnection[] = [];

        episode.beats.forEach((beat, index) => {
            const column = index % BEAT_COLUMNS;
            const row = Math.floor(index / BEAT_COLUMNS);
            const x = episodeOrigin.x + 40 + column * BEAT_COLUMN_WIDTH;
            const y = episodeOrigin.y + 80 + row * BEAT_ROW_HEIGHT;
            const beatEntityId = `episode:${episode.number}:beat:${beat.beatNumber}`;
            const beatMetadata = (sourceMediaRole: string, projectionRole: string) => sourceMetadata({
                catalog,
                sourceEntityType: "beat",
                sourceEntityId: beatEntityId,
                sourceMediaRole,
                projectionRole,
                presetId,
                episode: episode.number,
                groupId,
            });
            const textMetadata = beatMetadata("beat-content", "beat-text");
            const textNode: CanvasNodeData = {
                id: projectionNodeId(textMetadata.projectionKey),
                type: CanvasNodeType.Text,
                title: `镜头 ${beat.beatNumber}${beat.title ? ` · ${beat.title}` : ""}`,
                position: { x, y },
                width: 340,
                height: 240,
                metadata: { ...textMetadata, content: beat.content || beat.title, status: "success" },
            };
            const configMetadata = beatMetadata("beat-prompts", "beat-config");
            const configNode: CanvasNodeData = {
                id: projectionNodeId(configMetadata.projectionKey),
                type: CanvasNodeType.Config,
                title: `生成配置 · 镜头 ${beat.beatNumber}`,
                position: { x: x + 380, y },
                width: 440,
                height: 240,
                metadata: {
                    ...configMetadata,
                    content: "",
                    composerContent: beatPrompt(beat),
                    prompt: beat.videoPrompt || beat.prompt,
                    visualDescription: beat.visualDescription,
                    keyframePrompt: beat.keyframePrompt,
                    videoPrompt: beat.videoPrompt,
                    audioPrompt: beat.audioPrompt,
                    videoMode: beat.videoMode,
                    durationSeconds: beat.durationSeconds,
                    generationMode: beat.videoPrompt || beat.videoUrl || mediaByBeat[beat.beatNumber]?.video ? "video" : beat.audioPrompt || beat.audioUrl || mediaByBeat[beat.beatNumber]?.audio ? "audio" : "image",
                    status: "idle",
                },
            };
            episodeNodes.push(textNode, configNode);
            episodeConnections.push(connection(textNode, configNode));

            const media = mediaByBeat[beat.beatNumber] || {};
            const mediaInputs = [
                { type: CanvasNodeType.Image, role: beat.frameUrl ? "current_frame" : "current_sketch", url: beat.frameUrl || beat.sketchUrl, media: media.image, offsetX: 0 },
                { type: CanvasNodeType.Video, role: "current_video", url: beat.videoUrl, media: media.video, offsetX: 380 },
                { type: CanvasNodeType.Audio, role: "current_audio", url: beat.audioUrl, media: media.audio, offsetX: 820 },
            ] as const;
            for (const input of mediaInputs) {
                if (!input.url && !input.media) continue;
                const metadata = beatMetadata(input.role, `beat-${input.type}`);
                const node = mediaNode(
                    input.type,
                    projectionNodeId(metadata.projectionKey),
                    `参考${input.type === CanvasNodeType.Image ? "画面" : input.type === CanvasNodeType.Video ? "视频" : "音频"} · 镜头 ${beat.beatNumber}`,
                    { x: x + input.offsetX, y: y + 260 },
                    input.url,
                    input.media,
                    metadata,
                );
                episodeNodes.push(node);
                episodeConnections.push(connection(node, configNode));
            }
        });

        const beatRows = Math.max(1, Math.ceil(episode.beats.length / BEAT_COLUMNS));
        nodes.push({
            id: groupId,
            type: CanvasNodeType.Group,
            title: `虾集 · 第 ${episode.number} 集 · ${episode.title || "未命名"}`,
            position: episodeOrigin,
            width: BEAT_COLUMNS * BEAT_COLUMN_WIDTH + 80,
            height: beatRows * BEAT_ROW_HEIGHT + 160,
            metadata: groupMetadata,
        }, ...episodeNodes);
        connections.push(...episodeConnections);
    }

    return {
        title: episode
            ? `虾集 ${catalog.project.title || catalog.project.id} · 第 ${episode.number} 集`
            : `虾集 ${catalog.project.title || catalog.project.id} · 素材导入`,
        nodes,
        connections,
        backgroundMode: "lines",
        showImageInfo: false,
    };
}

export function mergeDramaCanvasProjection(
    existingNodes: CanvasNodeData[],
    existingConnections: CanvasConnection[],
    projection: Pick<DramaCanvasProjection, "nodes" | "connections">,
) {
    const nodes = [...existingNodes];
    const nodeIds = new Set(nodes.map((node) => node.id));
    const projectionKeys = new Set(nodes.map((node) => node.metadata?.projectionKey).filter((key): key is string => Boolean(key)));
    for (const node of projection.nodes) {
        const key = node.metadata?.projectionKey;
        if (nodeIds.has(node.id) || (key && projectionKeys.has(key))) continue;
        nodes.push(node);
        nodeIds.add(node.id);
        if (key) projectionKeys.add(key);
    }

    const connections = [...existingConnections];
    const connectionIds = new Set(connections.map((edge) => edge.id));
    for (const edge of projection.connections) {
        if (connectionIds.has(edge.id) || !nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) continue;
        connections.push(edge);
        connectionIds.add(edge.id);
    }
    return { nodes, connections };
}
