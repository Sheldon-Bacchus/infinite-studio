// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PluginStorage } from "@infinite-canvas/plugin-sdk";
import type { Asset } from "./core/asset-types";
import { readWorkspace } from "./workspace";
import { getLocalStudioRecord } from "./core/local-studio-model";
import { getXiaTangRecord } from "./core/xia-tang-local-model";

export interface MigrationFileInfo {
    path: string;
    sha256: string;
    bytes: number;
    mimeType: string;
    originalFilename?: string;
}

export interface MigrationMissingFileInfo {
    sourceAssetId: string;
    path?: string;
    reason: string;
    url?: string;
    sha256?: string;
}

export interface MigrationEntityItem {
    type: string;
    sourceId: string;
    targetId: string;
    title?: string;
    data: Record<string, unknown>;
}

export interface MigrationManifest {
    schemaVersion: 1;
    sourceId: string;
    sourceDigest: string;
    sourceSnapshotDigest?: string;
    sourceType: string;
    title: string;
    entities: MigrationEntityItem[];
    files: MigrationFileInfo[];
    missingFiles: MigrationMissingFileInfo[];
    entityMappings: Record<string, string>;
    fileMappings: Record<string, string>;
}

export interface ExtractedMediaFile {
    path: string;
    data: Uint8Array;
    sha256: string;
    bytes: number;
    mimeType: string;
    originalFilename?: string;
}

export interface XiaMigrationPackage {
    manifest: MigrationManifest;
    rawSnapshot: { schemaVersion: 1; assets: Asset[] };
    collectedFiles: ExtractedMediaFile[];
}

const MIME_TO_FORMAT: Record<string, { ext: string; kind: "text" | "image" | "video" | "audio" }> = {
    "text/plain": { ext: ".txt", kind: "text" },
    "application/json": { ext: ".json", kind: "text" },
    "text/markdown": { ext: ".md", kind: "text" },
    "image/png": { ext: ".png", kind: "image" },
    "image/jpeg": { ext: ".jpg", kind: "image" },
    "image/webp": { ext: ".webp", kind: "image" },
    "image/gif": { ext: ".gif", kind: "image" },
    "video/mp4": { ext: ".mp4", kind: "video" },
    "video/webm": { ext: ".webm", kind: "video" },
    "video/quicktime": { ext: ".mov", kind: "video" },
    "audio/mpeg": { ext: ".mp3", kind: "audio" },
    "audio/mp3": { ext: ".mp3", kind: "audio" },
    "audio/wav": { ext: ".wav", kind: "audio" },
    "audio/x-wav": { ext: ".wav", kind: "audio" },
    "audio/ogg": { ext: ".ogg", kind: "audio" },
    "audio/mp4": { ext: ".m4a", kind: "audio" },
    "audio/aac": { ext: ".aac", kind: "audio" },
    "audio/flac": { ext: ".flac", kind: "audio" },
};

export async function sha256Hex(data: string | Uint8Array | ArrayBuffer): Promise<string> {
    const buffer = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deterministicId32(sourceId: string, oldId: string): Promise<string> {
    const fullHash = await sha256Hex(`${sourceId}:${oldId}`);
    return fullHash.slice(0, 32);
}

function dataUrlToBytes(dataUrl: string): { data: Uint8Array; mimeType: string } | null {
    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return null;
    const mimeType = matches[1];
    const binaryString = atob(matches[2]);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return { data: bytes, mimeType };
}

export async function computeSubstantiveDigest(
    sourceId: string,
    sourceType: string,
    sourceSnapshotDigest: string,
    entities: MigrationEntityItem[],
    files: MigrationFileInfo[],
): Promise<string> {
    const entityHashes: string[] = [];
    for (const ent of entities) {
        const normJson = JSON.stringify(ent.data);
        const h = await sha256Hex(`${ent.targetId}:${ent.type}:${normJson}`);
        entityHashes.push(h);
    }
    entityHashes.sort();

    const fileHashes = files.map((f) => f.sha256).sort();

    const arr = [
        sourceId,
        sourceType,
        sourceSnapshotDigest,
        entityHashes,
        fileHashes,
    ];
    return sha256Hex(JSON.stringify(arr));
}

/**
 * buildXiaMigrationBundle 提取无限虾本地资产，生成确定性实体映射、原件文件流与规范 manifest
 */
export async function buildXiaMigrationBundle(
    assets: Asset[],
    mediaResolver?: (asset: Asset) => Promise<Blob | Uint8Array | null>,
    selectedProjectId?: string,
): Promise<XiaMigrationPackage> {
    // 1. 查找项目资产与确定 sourceId 和 title (Point 9)
    const projectAssets = assets.filter((a) => {
        const rec = getLocalStudioRecord(a);
        return rec?.recordType === "project";
    });

    let projectAsset: Asset | undefined;
    if (selectedProjectId) {
        projectAsset = projectAssets.find((p) => p.id === selectedProjectId);
        if (!projectAsset) {
            throw new Error(`未找到指定的无限虾项目 (ID: ${selectedProjectId})`);
        }
    } else {
        if (projectAssets.length > 1) {
            throw new Error(`检测到多个无限虾项目 (${projectAssets.length} 个)，请明确选择一个项目导出`);
        }
        projectAsset = projectAssets[0];
    }

    const targetProjectId = projectAsset ? projectAsset.id : "";
    const sourceId = projectAsset ? `infinite-xia:${projectAsset.id}` : "infinite-xia:default";
    const title = projectAsset?.title?.trim() || "无限虾未命名项目";

    // 2. 建立实体 ID 映射表
    const entityMappings: Record<string, string> = {};
    for (const a of assets) {
        entityMappings[a.id] = await deterministicId32(sourceId, a.id);
    }

    // 3. 收集镜头 supersedes 版本链，构建稳定 Shot 与 ShotRevision 实体 (Point 7)
    // 筛选当前项目所属的 beat
    const beatAssets = assets.filter((a) => {
        const rec = getLocalStudioRecord(a);
        return rec?.recordType === "beat" && (!targetProjectId || rec.projectAssetId === targetProjectId);
    });

    const beatById = new Map<string, Asset>(beatAssets.map((b) => [b.id, b]));
    const rootBeatIdMap = new Map<string, string>();

    for (const beat of beatAssets) {
        let curr = beat;
        const visited = new Set<string>([beat.id]);
        while (true) {
            const rec = getLocalStudioRecord(curr);
            if (rec?.recordType === "beat" && rec.supersedesAssetId) {
                if (!beatById.has(rec.supersedesAssetId)) {
                    throw new Error(`镜头版本 ${curr.id} 引用的父级版本 ${rec.supersedesAssetId} 不存在`);
                }
                if (visited.has(rec.supersedesAssetId)) {
                    throw new Error(`镜头版本链存在循环引用 (检测到环: ${rec.supersedesAssetId})`);
                }
                visited.add(rec.supersedesAssetId);
                curr = beatById.get(rec.supersedesAssetId)!;
            } else {
                break;
            }
        }
        rootBeatIdMap.set(beat.id, curr.id);
    }

    // 将 beats 按 stable shot 分组
    const shotGroups = new Map<string, Asset[]>();
    for (const beat of beatAssets) {
        const rootId = rootBeatIdMap.get(beat.id)!;
        const group = shotGroups.get(rootId) || [];
        group.push(beat);
        shotGroups.set(rootId, group);
    }

    // 严格检查：多活动版本或无活动版本拒绝导出 (Point 7)
    for (const [rootId, group] of shotGroups.entries()) {
        const activeBeats = group.filter((b) => {
            const r = getLocalStudioRecord(b);
            return r?.recordType === "beat" && !r.supersededByAssetId;
        });
        if (activeBeats.length > 1) {
            throw new Error(`镜头分组 ${rootId} 存在多个活动版本 (${activeBeats.map((b) => b.id).join(", ")})，拒绝导出`);
        }
        if (activeBeats.length === 0) {
            throw new Error(`镜头分组 ${rootId} 缺少活动版本，拒绝导出`);
        }
    }

    const shotIdMap = new Map<string, string>(); // rootId -> stable shot 32-hex ID
    for (const rootId of shotGroups.keys()) {
        shotIdMap.set(rootId, await deterministicId32(sourceId, `shot:${rootId}`));
    }

    // 4. 解析媒体文件与缺件列表 (Point 8)
    const collectedFiles: ExtractedMediaFile[] = [];
    const missingFiles: MigrationMissingFileInfo[] = [];
    const fileMappings: Record<string, string> = {};
    const seenFileHashes = new Set<string>();

    for (const a of assets) {
        let binaryData: Uint8Array | null = null;
        let mimeType = "";
        let originalFilename = a.title || "";

        // 尝试通过自定义 mediaResolver 解析
        if (mediaResolver) {
            try {
                const resolved = await mediaResolver(a);
                if (resolved instanceof Uint8Array) {
                    binaryData = resolved;
                } else if (resolved instanceof Blob) {
                    binaryData = new Uint8Array(await resolved.arrayBuffer());
                    mimeType = resolved.type;
                }
            } catch {
                // 回退到后续解析
            }
        }

        // 若仍未取得数据，检查自身的 dataUrl 或本地属性
        if (!binaryData) {
            if (a.kind === "image" && a.data.dataUrl) {
                const extracted = dataUrlToBytes(a.data.dataUrl);
                if (extracted) {
                    binaryData = extracted.data;
                    mimeType = a.data.mimeType || extracted.mimeType;
                }
            }
        }

        if (binaryData && binaryData.length > 0) {
            const safeMime = mimeType || (a.kind === "image" ? "image/png" : a.kind === "video" ? "video/mp4" : a.kind === "audio" ? "audio/mp3" : "text/plain");
            const fmt = MIME_TO_FORMAT[safeMime];
            if (!fmt) {
                // 未知或不受支持的 MIME 不伪造 .bin，明确列为缺件 (Point 8)
                missingFiles.push({
                    sourceAssetId: a.id,
                    path: "",
                    reason: `未知或不受支持的媒体类型 (${safeMime})`,
                });
            } else {
                const hash = await sha256Hex(binaryData);
                const path = `files/${hash}${fmt.ext}`;

                if (!seenFileHashes.has(hash)) {
                    seenFileHashes.add(hash);
                    collectedFiles.push({
                        path,
                        data: binaryData,
                        sha256: hash,
                        bytes: binaryData.length,
                        mimeType: safeMime,
                        originalFilename,
                    });
                }

                fileMappings[a.id] = hash;
                if ("storageKey" in a.data && a.data.storageKey) {
                    fileMappings[String(a.data.storageKey)] = hash;
                }
            }
        } else if (a.kind !== "text") {
            // 非文本素材却未获取到原件，记录到缺失文件列表，严禁虚构数据 (Point 8)
            const fallbackUrl = a.kind === "image" ? a.data.dataUrl : (a.kind === "video" || a.kind === "audio") ? a.data.url : "";
            missingFiles.push({
                sourceAssetId: a.id,
                path: "",
                reason: `无法获取媒体原件 (类型: ${a.kind})`,
                url: typeof fallbackUrl === "string" ? fallbackUrl : undefined,
            });
        }
    }

    // 5. 转换规范实体列表
    const entities: MigrationEntityItem[] = [];

    // (1) Episodes
    const episodeAssets = assets.filter((a) => {
        const rec = getLocalStudioRecord(a);
        return rec?.recordType === "episode" && (!targetProjectId || rec.projectAssetId === targetProjectId);
    });

    for (const epAsset of episodeAssets) {
        const epRec = getLocalStudioRecord(epAsset);
        if (epRec?.recordType !== "episode") continue;

        const epTargetId = entityMappings[epAsset.id];
        // 查找属于该分集的镜头
        const epShotIds: string[] = [];
        for (const [rootId, group] of shotGroups.entries()) {
            const firstBeat = group[0];
            const bRec = getLocalStudioRecord(firstBeat);
            if (bRec?.recordType === "beat" && bRec.episodeAssetId === epAsset.id) {
                epShotIds.push(shotIdMap.get(rootId)!);
            }
        }

        const scriptTargetId = epRec.scriptAssetId && entityMappings[epRec.scriptAssetId] ? entityMappings[epRec.scriptAssetId] : "";

        entities.push({
            type: "episode",
            sourceId: epAsset.id,
            targetId: epTargetId,
            title: epRec.title || epAsset.title,
            data: {
                id: epTargetId,
                workId: "",
                order: epRec.order || 1,
                title: epRec.title || epAsset.title,
                currentScriptRevision: scriptTargetId,
                currentShotIds: epShotIds,
            },
        });
    }

    // (2) Scripts
    const scriptAssets = assets.filter((a) => {
        const rec = getLocalStudioRecord(a);
        return rec?.recordType === "script" && (!targetProjectId || rec.projectAssetId === targetProjectId);
    });

    for (const scAsset of scriptAssets) {
        const scRec = getLocalStudioRecord(scAsset);
        if (scRec?.recordType !== "script") continue;

        const scTargetId = entityMappings[scAsset.id];
        const linkedEpId = scRec.episodeAssetId ? entityMappings[scRec.episodeAssetId] || "" : "";
        const content = scAsset.kind === "text" ? scAsset.data.content : "";

        entities.push({
            type: "script",
            sourceId: scAsset.id,
            targetId: scTargetId,
            title: scAsset.title,
            data: {
                id: scTargetId,
                workId: "",
                episodeId: linkedEpId,
                content,
            },
        });
    }

    // (3) Shots & ShotRevisions
    for (const [rootId, group] of shotGroups.entries()) {
        const shotTargetId = shotIdMap.get(rootId)!;
        const activeBeat = group.find((b) => {
            const r = getLocalStudioRecord(b);
            return r?.recordType === "beat" && !r.supersededByAssetId;
        }) || group[group.length - 1];

        const activeBeatRec = getLocalStudioRecord(activeBeat);
        const activeEpId = activeBeatRec?.recordType === "beat" && activeBeatRec.episodeAssetId ? entityMappings[activeBeatRec.episodeAssetId] || "" : "";
        const activeRevTargetId = await deterministicId32(sourceId, `shot_rev:${activeBeat.id}`);

        // 为每个 beat 创建 shot_revision 实体 (Point 7: content 使用 beat.data.content)
        for (const beat of group) {
            const bRec = getLocalStudioRecord(beat);
            const revTargetId = await deterministicId32(sourceId, `shot_rev:${beat.id}`);
            const refAssetIds = bRec?.recordType === "beat" && Array.isArray(bRec.referencedAssetIds)
                ? bRec.referencedAssetIds.map((refId) => entityMappings[refId]).filter(Boolean)
                : [];

            const beatContent = (beat.data && typeof beat.data.content === "string") ? beat.data.content : "";

            entities.push({
                type: "shot_revision",
                sourceId: beat.id,
                targetId: revTargetId,
                title: beat.title,
                data: {
                    id: revTargetId,
                    shotId: shotTargetId,
                    content: beatContent,
                    dialogue: (bRec?.recordType === "beat" ? bRec.dialogueText : "") || "",
                    referenceAssetIds: refAssetIds,
                    promptRevisionIds: [],
                },
            });
        }

        // 创建稳定 Shot 实体
        entities.push({
            type: "shot",
            sourceId: rootId,
            targetId: shotTargetId,
            title: activeBeat.title,
            data: {
                id: shotTargetId,
                workId: "",
                episodeId: activeEpId,
                currentRevision: activeRevTargetId,
                selectedOutputIds: [],
            },
        });
    }

    // (4) XiaTang Assets (character, scene, prop, voice) (Point 9: 独立无归属素材明确标记为待归档)
    const xiaTangAssets = assets.filter((a) => Boolean(getXiaTangRecord(a)));
    for (const xtAsset of xiaTangAssets) {
        const xtRec = getXiaTangRecord(xtAsset);
        if (!xtRec) continue;

        const assetTargetId = entityMappings[xtAsset.id];
        const parentTargetId = xtRec.parentId ? entityMappings[xtRec.parentId] || "" : "";
        const curMediaIds = fileMappings[xtAsset.id] ? [fileMappings[xtAsset.id]] : [];

        const belongsToProject = targetProjectId ? xtRec.projectAssetId === targetProjectId : true;
        const isPending = !belongsToProject;

        entities.push({
            type: "asset",
            sourceId: xtAsset.id,
            targetId: assetTargetId,
            title: xtAsset.title,
            data: {
                id: assetTargetId,
                workId: "",
                domain: xtRec.domain,
                parentId: parentTargetId,
                currentMediaIds: curMediaIds,
                archived: false,
                pending: isPending,
            },
        });
    }

    // 6. 清单文件清单
    const manifestFiles: MigrationFileInfo[] = collectedFiles.map((f) => ({
        path: f.path,
        sha256: f.sha256,
        bytes: f.bytes,
        mimeType: f.mimeType,
        originalFilename: f.originalFilename,
    }));

    // 7. 计算实质内容 sourceDigest 与原始快照摘要 (Point 3)
    const rawSnapshot = { schemaVersion: 1 as const, assets };
    const rawBytes = new TextEncoder().encode(JSON.stringify(rawSnapshot, null, 2));
    const sourceSnapshotDigest = await sha256Hex(rawBytes);

    const sourceDigest = await computeSubstantiveDigest(sourceId, "infinite-xia", sourceSnapshotDigest, entities, manifestFiles);

    const manifest: MigrationManifest = {
        schemaVersion: 1,
        sourceId,
        sourceDigest,
        sourceSnapshotDigest,
        sourceType: "infinite-xia",
        title,
        entities,
        files: manifestFiles,
        missingFiles,
        entityMappings,
        fileMappings,
    };

    return {
        manifest,
        rawSnapshot,
        collectedFiles,
    };
}

/**
 * readXiaWorkspaceAssets 从存储实例中读取无限虾资产集合
 */
export async function readXiaWorkspaceAssets(storage: PluginStorage): Promise<Asset[]> {
    return readWorkspace(storage);
}
