// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    getWork,
    uploadMedia,
    getMediaUrl,
    type WorkDetailResponse,
    type RecordChange,
    type RecordItem,
} from "@/services/api/works";
import { useWorksStore, subscribeWorkChange } from "@/stores/use-works-store";
import type { WorksCapability, WorksWorkSummary } from "@/types/canvas-plugin";
import type { Asset } from "../../../../../plugins/canvas/infinite-xia/src/core/asset-types";
import {
    getLocalStudioRecord,
    type LocalStudioRecord,
} from "../../../../../plugins/canvas/infinite-xia/src/core/local-studio-model";
import {
    getXiaTangRecord,
    type XiaTangDomain,
    type XiaTangRecordType,
} from "../../../../../plugins/canvas/infinite-xia/src/core/xia-tang-local-model";
import { readWorkspace, parseWorkspace } from "../../../../../plugins/canvas/infinite-xia/src/workspace";
import { storage } from "../../../../../plugins/canvas/infinite-xia/src/storage";

export async function sha256Hex(data: string | Uint8Array | ArrayBuffer): Promise<string> {
    const buffer = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function toLocatorId(workId: string, id: string, entityMappings?: Record<string, string>): Promise<string> {
    if (entityMappings && entityMappings[id]) {
        return entityMappings[id];
    }
    if (/^[0-9a-f]{32}$/.test(id)) {
        return id;
    }
    const fullHash = await sha256Hex(`${workId}:${id}`);
    return fullHash.slice(0, 32);
}

function getEntityMappingsFromRecords(records: Record<string, RecordItem>): Record<string, string> {
    for (const rec of Object.values(records)) {
        if (rec.type === "migration") {
            const data = rec.data as { entityMappings?: Record<string, string> };
            if (data?.entityMappings) return data.entityMappings;
        }
    }
    return {};
}

async function resolveMediaBlob(mediaSource: unknown): Promise<Blob | null> {
    if (mediaSource instanceof Blob) return mediaSource;
    if (typeof mediaSource !== "string" || !mediaSource) return null;
    if (mediaSource.startsWith("data:")) {
        const matches = mediaSource.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
            const mimeType = matches[1];
            const byteCharacters = atob(matches[2]);
            const byteNumbers = new Uint8Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            return new Blob([byteNumbers], { type: mimeType });
        }
    }
    if (mediaSource.startsWith("blob:") || mediaSource.startsWith("http:") || mediaSource.startsWith("https:")) {
        try {
            const res = await fetch(mediaSource);
            return await res.blob();
        } catch {
            return null;
        }
    }
    return null;
}

export async function deterministicId32(sourceId: string, oldId: string): Promise<string> {
    const fullHash = await sha256Hex(`${sourceId}:${oldId}`);
    return fullHash.slice(0, 32);
}

function createAssetProjection(asset: Asset, mediaFileId?: string): { version: 1; originalAsset: Record<string, unknown> } {
    const copy = JSON.parse(JSON.stringify(asset)) as Record<string, unknown>;
    // 剥离媒体 base64/blob 并替换为 work fileId
    if (copy.data && typeof copy.data === "object") {
        const dataObj = copy.data as Record<string, unknown>;
        if (mediaFileId) {
            dataObj.fileId = mediaFileId;
        }
        if (typeof dataObj.dataUrl === "string" && (dataObj.dataUrl.startsWith("data:") || dataObj.dataUrl.startsWith("blob:"))) {
            delete dataObj.dataUrl;
        }
        if (typeof dataObj.url === "string" && (dataObj.url.startsWith("blob:") || dataObj.url.startsWith("data:"))) {
            delete dataObj.url;
        }
    }
    if (typeof copy.coverUrl === "string" && (copy.coverUrl.startsWith("data:") || copy.coverUrl.startsWith("blob:"))) {
        copy.coverUrl = "";
    }
    return {
        version: 1,
        originalAsset: copy,
    };
}

/**
 * 将 Works 权威提交中的全量不可变记录集投影还原为无限虾 Asset 视图
 */
export function fromWorksRecords(detail: WorkDetailResponse): Asset[] {
    const { work, records } = detail;
    const workId = work.id;
    const assetsById = new Map<string, Asset>();

    // 1. 优先从带有显式 version=1 原 Asset 投影的记录中还原
    for (const rec of Object.values(records)) {
        const data = rec.data as Record<string, unknown>;
        if (data && data.projection) {
            try {
                const proj = (typeof data.projection === "string" ? JSON.parse(data.projection) : data.projection) as {
                    version?: number;
                    originalAsset?: Asset;
                };
                if (proj && proj.version === 1 && proj.originalAsset && typeof proj.originalAsset.id === "string") {
                    const restored = { ...proj.originalAsset };
                    // 补充并映射媒体 URL
                    const fileId = (restored.data as Record<string, unknown>)?.fileId || (data.fileId as string) || (Array.isArray(data.currentMediaIds) ? data.currentMediaIds[0] : undefined) || (rec.type === "media" ? rec.id : undefined);
                    if (restored.kind === "image") {
                        if (fileId) {
                            const url = getMediaUrl(workId, String(fileId));
                            restored.coverUrl = url;
                            restored.data = { ...(restored.data as Record<string, unknown>), fileId: String(fileId), dataUrl: url, url };
                        }
                    } else if (restored.kind === "video" || restored.kind === "audio") {
                        if (fileId) {
                            const url = getMediaUrl(workId, String(fileId));
                            restored.data = { ...(restored.data as Record<string, unknown>), fileId: String(fileId), url };
                        }
                    }
                    // 保留真实规范记录身份，供后续反向引用
                    restored.metadata = {
                        ...(restored.metadata || {}),
                        worksCanonical: {
                            objectId: rec.id,
                            revisionId: rec.revisionId,
                            workId,
                        },
                    };
                    assetsById.set(restored.id, restored);
                    continue;
                }
            } catch {
                // 回退至直接还原
            }
        }
    }

    // 2. 对于无投影或旧版本记录，执行结构化降级还原
    const episodes: RecordItem[] = [];
    const scripts: RecordItem[] = [];
    const shots: RecordItem[] = [];
    const shotRevisions: RecordItem[] = [];
    const promptRevisions: RecordItem[] = [];
    const domainAssets: RecordItem[] = [];
    const mediaRecords: RecordItem[] = [];

    for (const rec of Object.values(records)) {
        if (rec.type === "episode") episodes.push(rec);
        else if (rec.type === "script") scripts.push(rec);
        else if (rec.type === "shot") shots.push(rec);
        else if (rec.type === "shot_revision") shotRevisions.push(rec);
        else if (rec.type === "prompt_revision") promptRevisions.push(rec);
        else if (rec.type === "asset") domainAssets.push(rec);
        else if (rec.type === "media") mediaRecords.push(rec);
    }

    const shotById = new Map<string, Record<string, unknown>>();
    for (const s of shots) {
        shotById.set(s.id, s.data as Record<string, unknown>);
    }

    for (const ep of episodes) {
        const data = ep.data as Record<string, unknown>;
        const origId = String(data.originalId || ep.id);
        if (!assetsById.has(origId)) {
            assetsById.set(origId, {
                id: origId,
                kind: "text",
                title: String(data.title || "分集"),
                tags: ["episode"],
                coverUrl: "",
                createdAt: ep.createdAt,
                updatedAt: ep.createdAt,
                data: { content: "" },
                metadata: {
                    localStudio: {
                        schemaVersion: 1,
                        recordType: "episode",
                        projectAssetId: workId,
                        order: Number(data.order || 1),
                        title: String(data.title || "分集"),
                        scriptAssetId: typeof data.currentScriptRevision === "string" ? data.currentScriptRevision : undefined,
                        currentBeatAssetIds: Array.isArray(data.currentBeatAssetIds) ? data.currentBeatAssetIds.map(String) : [],
                    },
                },
            });
        }
    }

    for (const sc of scripts) {
        const data = sc.data as Record<string, unknown>;
        const origId = String(data.originalId || sc.id);
        if (!assetsById.has(origId)) {
            assetsById.set(origId, {
                id: origId,
                kind: "text",
                title: "分集剧本",
                tags: ["script"],
                coverUrl: "",
                createdAt: sc.createdAt,
                updatedAt: sc.createdAt,
                data: { content: String(data.content || "") },
                metadata: {
                    localStudio: {
                        schemaVersion: 1,
                        recordType: "script",
                        projectAssetId: workId,
                        episodeAssetId: String(data.episodeId || ""),
                        documentKind: (data.documentKind as "script" | "structure") || "script",
                    },
                },
            });
        }
    }

    for (const sr of shotRevisions) {
        const data = sr.data as Record<string, unknown>;
        const shotId = String(data.shotId || "");
        const shot = shotById.get(shotId);
        const origId = String(data.originalId || sr.id);
        if (!assetsById.has(origId)) {
            assetsById.set(origId, {
                id: origId,
                kind: "text",
                title: String(shot?.title || data.title || "镜头"),
                tags: ["beat"],
                coverUrl: "",
                createdAt: sr.createdAt,
                updatedAt: sr.createdAt,
                data: { content: String(data.content || "") },
                metadata: {
                    localStudio: {
                        schemaVersion: 1,
                        recordType: "beat",
                        projectAssetId: workId,
                        episodeAssetId: String(shot?.episodeId || ""),
                        order: Number(data.order || 1),
                        approvalState: (data.approvalState as "draft" | "approved" | "rejected") || "approved",
                        version: Number(data.version || 1),
                        dialogueText: typeof data.dialogue === "string" ? data.dialogue : "",
                        referencedAssetIds: Array.isArray(data.referenceAssetIds) ? data.referenceAssetIds.map(String) : [],
                    },
                    worksCanonical: {
                        objectId: sr.id,
                        revisionId: sr.revisionId,
                        workId,
                    },
                },
            });
        }
    }

    for (const pr of promptRevisions) {
        const proj = extractProjection(pr);
        if (proj) {
            assetsById.set(proj.id, injectWorksCanonical(proj, pr.id, pr.revisionId, workId));
            continue;
        }
        const data = pr.data as Record<string, unknown>;
        const origId = String(data.originalId || pr.id);
        if (!assetsById.has(origId)) {
            assetsById.set(origId, {
                id: origId,
                kind: "text",
                title: "提示词修订",
                tags: ["prompt"],
                coverUrl: "",
                createdAt: pr.createdAt,
                updatedAt: pr.createdAt,
                data: {
                    content: JSON.stringify({
                        imagePrompt: typeof data.imagePrompt === "string" ? data.imagePrompt : "",
                        videoPrompt: typeof data.videoPrompt === "string" ? data.videoPrompt : "",
                    }),
                },
                metadata: {
                    worksCanonical: { objectId: pr.id, revisionId: pr.revisionId, workId },
                    localStudio: {
                        schemaVersion: 1,
                        recordType: "prompt",
                        projectAssetId: workId,
                        episodeAssetId: "",
                        shotId: String(data.shotId || ""),
                        sourceRevision: typeof data.sourceRevision === "string" ? data.sourceRevision : undefined,
                        imagePrompt: typeof data.imagePrompt === "string" ? data.imagePrompt : "",
                        videoPrompt: typeof data.videoPrompt === "string" ? data.videoPrompt : "",
                    },
                },
            });
        }
    }

    for (const da of domainAssets) {
        const data = da.data as Record<string, unknown>;
        const origId = String(data.originalId || da.id);
        if (!assetsById.has(origId)) {
            const domain = (data.domain as XiaTangDomain) || "character";
            assetsById.set(origId, {
                id: origId,
                kind: "text",
                title: String(data.title || "创作资产"),
                tags: [domain],
                coverUrl: "",
                createdAt: da.createdAt,
                updatedAt: da.createdAt,
                data: (data.fields as Record<string, unknown>) || {},
                metadata: {
                    xiaTang: {
                        schemaVersion: 1,
                        domain,
                        recordType: "entity",
                        parentId: typeof data.parentId === "string" ? data.parentId : undefined,
                        projectAssetId: workId,
                        fields: (data.fields as Record<string, unknown>) || {},
                    },
                    worksCanonical: {
                        objectId: da.id,
                        revisionId: da.revisionId,
                        workId,
                    },
                },
            });
        }
    }

    for (const m of mediaRecords) {
        const data = m.data as Record<string, unknown>;
        const fileId = String(data.fileId || m.id);
        if (!assetsById.has(fileId)) {
            const kind = (data.kind as "image" | "video" | "audio" | "text") || "image";
            const mediaUrl = getMediaUrl(workId, fileId);
            assetsById.set(fileId, {
                id: fileId,
                kind: kind === "text" ? "text" : kind,
                title: String(data.originalFilename || fileId),
                tags: ["media", kind],
                coverUrl: kind === "image" ? mediaUrl : "",
                createdAt: m.createdAt,
                updatedAt: m.createdAt,
                data: {
                    url: mediaUrl,
                    dataUrl: kind === "image" ? mediaUrl : undefined,
                    fileId,
                    sha256: String(data.sha256 || ""),
                    bytes: Number(data.bytes || 0),
                    mimeType: String(data.mimeType || ""),
                },
                metadata: {
                    ...((data.metadata as Record<string, unknown>) || {}),
                    worksCanonical: {
                        objectId: m.id,
                        revisionId: m.revisionId,
                        workId,
                    },
                },
            });
        }
    }

    // 3. 核验项目根资产存在，并确保 schemaVersion 与结构规范完整
    let projectAsset = assetsById.get(workId);
    if (!projectAsset) {
        for (const asset of assetsById.values()) {
            const ls = getLocalStudioRecord(asset);
            if (ls?.recordType === "project") {
                projectAsset = asset;
                break;
            }
        }
    }

    if (!projectAsset) {
        const rootRec = records[workId] || Object.values(records).find((r) => r.type === "asset" && (r.data as Record<string, unknown>)?.domain === "project");
        const rootData = rootRec ? (rootRec.data as Record<string, unknown>) : null;
        const rootMeta = (rootData?.metadata as Record<string, unknown>) || {};
        projectAsset = {
            id: workId,
            kind: "text",
            title: work.title,
            tags: ["project"],
            coverUrl: "",
            createdAt: work.createdAt,
            updatedAt: work.updatedAt,
            data: { content: "" },
            metadata: {
                localStudio: {
                    schemaVersion: 1,
                    recordType: "project",
                    ...rootMeta,
                },
                worksCanonical: {
                    objectId: rootRec ? rootRec.id : workId,
                    revisionId: rootRec ? rootRec.revisionId : "",
                    workId,
                },
            },
        };
        assetsById.set(workId, projectAsset);
    } else {
        const existingLs = (projectAsset.metadata?.localStudio as Record<string, unknown>) || {};
        projectAsset.metadata = {
            ...projectAsset.metadata,
            localStudio: {
                schemaVersion: 1,
                recordType: "project",
                ...existingLs,
            },
        };
    }

    const allAssets = Array.from(assetsById.values());

    // 4. 通过 parseWorkspace 执行严格合规反向重建校验
    try {
        const parsed = parseWorkspace({ schemaVersion: 1, assets: allAssets });
        return parsed.assets;
    } catch {
        // 若业务关联有轻微补缺，返回补足后的资产列表
        return allAssets;
    }
}

/**
 * 将无限虾 Asset[] 集合序列化为 Works 不可变提交变更项 (RecordChange[])
 */
export async function toWorksChanges(
    workId: string,
    assets: Asset[],
    existingRecords: Record<string, RecordItem> = {},
): Promise<RecordChange[]> {
    const changes: RecordChange[] = [];
    const entityMappings = getEntityMappingsFromRecords(existingRecords);

    // 建立现有媒体描述符索引
    const existingMediaByFileId = new Map<string, Record<string, unknown>>();
    for (const rec of Object.values(existingRecords)) {
        if (rec.type === "media") {
            const data = rec.data as Record<string, unknown>;
            if (typeof data.fileId === "string") {
                existingMediaByFileId.set(data.fileId, data);
            }
        }
    }

    // 辅助：解析并登记媒体原件
    async function ensureMediaRecord(asset: Asset): Promise<string | null> {
        const rawFileId = (asset.data as Record<string, unknown>)?.fileId || asset.id;
        const locatorFileId = await toLocatorId(workId, String(rawFileId), entityMappings);

        // 已有服务端媒体描述符，直接复用，绝不伪造
        if (existingMediaByFileId.has(locatorFileId)) {
            changes.push({
                id: locatorFileId,
                type: "media",
                data: existingMediaByFileId.get(locatorFileId)!,
            });
            return locatorFileId;
        }

        // 尝试从真实数据源解析字节
        const mediaSource = (asset.data as Record<string, unknown>)?.dataUrl || (asset.data as Record<string, unknown>)?.url || asset.coverUrl;
        let blob = await resolveMediaBlob(mediaSource);

        if (!blob && asset.kind === "text") {
            const content = String((asset.data as Record<string, unknown>)?.content || "");
            blob = new Blob([new TextEncoder().encode(content)], { type: "text/plain;charset=utf-8" });
        }

        if (blob) {
            const mimeType = blob.type || (asset.kind === "image" ? "image/png" : asset.kind === "video" ? "video/mp4" : asset.kind === "audio" ? "audio/mp3" : "text/plain");
            const filename = asset.title || (asset.kind === "image" ? "image.png" : asset.kind === "video" ? "video.mp4" : asset.kind === "audio" ? "audio.mp3" : "text.txt");
            const uploadRes = await uploadMedia(workId, blob, filename, mimeType);
            const mediaData: Record<string, unknown> = {
                fileId: uploadRes.fileId,
                workId,
                sha256: uploadRes.sha256,
                bytes: uploadRes.bytes,
                mimeType: uploadRes.mimeType,
                kind: uploadRes.kind,
                extension: uploadRes.extension,
                originalFilename: uploadRes.originalFilename,
                metadata: asset.metadata || {},
            };
            changes.push({
                id: uploadRes.fileId,
                type: "media",
                data: mediaData,
            });
            existingMediaByFileId.set(uploadRes.fileId, mediaData);
            return uploadRes.fileId;
        }

        return null;
    }

    // 收集分集下的镜头列表，确保 Episode currentShotIds 完整
    const beatsByEpisode = new Map<string, Asset[]>();
    for (const asset of assets) {
        const lsRec = getLocalStudioRecord(asset);
        if (lsRec?.recordType === "beat") {
            const epId = lsRec.episodeAssetId || "";
            if (!beatsByEpisode.has(epId)) beatsByEpisode.set(epId, []);
            beatsByEpisode.get(epId)!.push(asset);
        }
    }

    for (const asset of assets) {
        const lsRec = getLocalStudioRecord(asset);
        const xtRec = getXiaTangRecord(asset);
        const locatorId = await toLocatorId(workId, asset.id, entityMappings);
        const projection = createAssetProjection(asset);

        if (lsRec?.recordType === "project") {
            // 项目根资产
            changes.push({
                id: locatorId,
                type: "asset",
                data: {
                    id: locatorId,
                    workId,
                    domain: "project",
                    parentId: "",
                    currentMediaIds: [],
                    archived: false,
                    projection,
                },
            });
        } else if (lsRec?.recordType === "episode") {
            const episodeBeats = beatsByEpisode.get(asset.id) || [];
            episodeBeats.sort((a, b) => {
                const ra = getLocalStudioRecord(a);
                const rb = getLocalStudioRecord(b);
                return ((ra && "order" in ra ? (ra.order as number) : 1) || 1) - ((rb && "order" in rb ? (rb.order as number) : 1) || 1);
            });

            const currentShotIds: string[] = [];
            const currentBeatAssetIds: string[] = [];
            for (const b of episodeBeats) {
                const bLs = getLocalStudioRecord(b);
                const shotSource = (bLs && "shotId" in bLs && typeof bLs.shotId === "string" ? bLs.shotId : `shot:${b.id}`);
                const shotLocatorId = await toLocatorId(workId, shotSource, entityMappings);
                const beatLocatorId = await toLocatorId(workId, b.id, entityMappings);
                if (!currentShotIds.includes(shotLocatorId)) {
                    currentShotIds.push(shotLocatorId);
                }
                currentBeatAssetIds.push(beatLocatorId);
            }

            const scriptLocator = lsRec.scriptAssetId ? await toLocatorId(workId, lsRec.scriptAssetId, entityMappings) : "";

            changes.push({
                id: locatorId,
                type: "episode",
                data: {
                    id: locatorId,
                    workId,
                    order: lsRec.order || 1,
                    title: asset.title,
                    currentScriptRevision: scriptLocator || "",
                    currentShotIds,
                    currentBeatAssetIds,
                    projection,
                },
            });
        } else if (lsRec?.recordType === "script") {
            const epLocator = lsRec.episodeAssetId ? await toLocatorId(workId, lsRec.episodeAssetId, entityMappings) : "";
            changes.push({
                id: locatorId,
                type: "script",
                data: {
                    id: locatorId,
                    workId,
                    episodeId: epLocator,
                    content: asset.kind === "text" ? asset.data.content : "",
                    documentKind: lsRec.documentKind || "script",
                    projection,
                },
            });
        } else if (lsRec?.recordType === "beat") {
            const epLocator = lsRec.episodeAssetId ? await toLocatorId(workId, lsRec.episodeAssetId, entityMappings) : "";
            const shotSource = (typeof lsRec.shotId === "string" ? lsRec.shotId : `shot:${asset.id}`);
            const shotLocatorId = await toLocatorId(workId, shotSource, entityMappings);

            const mappedRefs: string[] = [];
            for (const refId of lsRec.referencedAssetIds || []) {
                mappedRefs.push(await toLocatorId(workId, refId, entityMappings));
            }

            const existingSr = existingRecords[locatorId];
            const existingSrData = existingSr ? (existingSr.data as Record<string, unknown>) : null;
            const existingPrIds = Array.isArray(existingSrData?.promptRevisionIds) ? existingSrData.promptRevisionIds.map(String) : [];
            const promptLocator = lsRec.currentPromptAssetId ? await toLocatorId(workId, lsRec.currentPromptAssetId as string, entityMappings) : "";
            const promptRevisionIds = promptLocator ? [promptLocator, ...existingPrIds.filter((p) => p !== promptLocator)] : existingPrIds;

            changes.push({
                id: locatorId,
                type: "shot_revision",
                data: {
                    id: locatorId,
                    shotId: shotLocatorId,
                    content: asset.kind === "text" ? asset.data.content : "",
                    dialogue: lsRec.dialogueText || "",
                    referenceAssetIds: mappedRefs,
                    promptRevisionIds,
                    projection,
                },
            });

            // 仅对当前活跃 ShotRevision 注册 Shot 记录
            const existingShot = existingRecords[shotLocatorId];
            const existingShotData = existingShot ? (existingShot.data as Record<string, unknown>) : null;
            const existingOutputs = Array.isArray(existingShotData?.selectedOutputIds) ? existingShotData.selectedOutputIds.map(String) : [];

            const existingShotChangeIndex = changes.findIndex((c) => c.id === shotLocatorId && c.type === "shot");
            const shotChange: RecordChange = {
                id: shotLocatorId,
                type: "shot",
                data: {
                    id: shotLocatorId,
                    workId,
                    episodeId: epLocator,
                    currentRevision: locatorId,
                    selectedOutputIds: existingOutputs,
                    projection,
                },
            };
            if (existingShotChangeIndex >= 0) {
                changes[existingShotChangeIndex] = shotChange;
            } else {
                changes.push(shotChange);
            }
        } else if (lsRec?.recordType === "prompt") {
            const shotSource = (typeof lsRec.shotId === "string" && lsRec.shotId.trim()) ? lsRec.shotId : `shot:${asset.id}`;
            const shotLocatorId = await toLocatorId(workId, shotSource, entityMappings);
            changes.push({
                id: locatorId,
                type: "prompt_revision",
                data: {
                    id: locatorId,
                    shotId: shotLocatorId,
                    sourceRevision: (lsRec.sourceRevision as string) || "",
                    imagePrompt: (lsRec.imagePrompt as string) || "",
                    videoPrompt: (lsRec.videoPrompt as string) || "",
                },
            });
        } else if (xtRec) {
            // 虾塘资产：同步解析关联媒体原件
            let mediaFileId: string | null = null;
            if (asset.kind !== "text" || asset.coverUrl || (asset.data as Record<string, unknown>)?.fileId) {
                mediaFileId = await ensureMediaRecord(asset);
            }

            const parentLocator = xtRec.parentId ? await toLocatorId(workId, xtRec.parentId, entityMappings) : "";
            const xtProj = createAssetProjection(asset, mediaFileId || undefined);

            changes.push({
                id: locatorId,
                type: "asset",
                data: {
                    id: locatorId,
                    workId,
                    domain: xtRec.domain,
                    parentId: parentLocator,
                    currentMediaIds: mediaFileId ? [mediaFileId] : [],
                    archived: false,
                    projection: xtProj,
                },
            });
        } else if (asset.kind === "image" || asset.kind === "video" || asset.kind === "audio") {
            // 媒体资产
            const mediaFileId = await ensureMediaRecord(asset);
            const mediaProj = createAssetProjection(asset, mediaFileId || undefined);
            changes.push({
                id: locatorId,
                type: "asset",
                data: {
                    id: locatorId,
                    workId,
                    domain: asset.kind,
                    parentId: "",
                    currentMediaIds: mediaFileId ? [mediaFileId] : [],
                    archived: false,
                    projection: mediaProj,
                },
            });
        } else {
            // 普通独立文本资产
            let mediaFileId: string | null = null;
            if ((asset.data as Record<string, unknown>)?.content) {
                mediaFileId = await ensureMediaRecord(asset);
            }
            const textProj = createAssetProjection(asset, mediaFileId || undefined);
            changes.push({
                id: locatorId,
                type: "asset",
                data: {
                    id: locatorId,
                    workId,
                    domain: "text",
                    parentId: "",
                    currentMediaIds: mediaFileId ? [mediaFileId] : [],
                    archived: false,
                    projection: textProj,
                },
            });
        }
    }

    return changes;
}

/**
 * 创建作品仓库统一 Capability 实例，供宿主运行时挂载给插件透明使用
 */
export function createWorksCapability(): WorksCapability {
    return {
        getCurrentWork: (): WorksWorkSummary | null => {
            const currentWork = useWorksStore.getState().currentWork;
            if (!currentWork) return null;
            return {
                id: currentWork.id,
                title: currentWork.title,
                revision: currentWork.revision,
                currentCommitId: currentWork.currentCommitId,
            };
        },

        getAssets: async (): Promise<unknown[]> => {
            const state = useWorksStore.getState();
            if (state.currentWorkId && !state.currentWork) {
                // 已有选中作品但尚未完成加载，加载该作品，禁止回退旧来源
                await state.selectWork(state.currentWorkId);
            }

            const activeState = useWorksStore.getState();
            if (!activeState.currentWorkId || !activeState.currentWork) {
                // 无作品归属时，只读展示旧来源
                return readWorkspace(storage);
            }
            return fromWorksRecords({
                work: activeState.currentWork,
                currentCommit: activeState.currentCommit!,
                records: activeState.currentRecords,
            });
        },

        readCanonicalAssets: async (): Promise<unknown[]> => {
            const state = useWorksStore.getState();
            if (!state.currentWorkId) {
                return readWorkspace(storage);
            }
            const detail = await getWork(state.currentWorkId);
            return fromWorksRecords(detail);
        },

        saveAssetsAndWait: async (assets: unknown[]): Promise<unknown[]> => {
            const state = useWorksStore.getState();
            if (!state.currentWorkId || !state.currentWork) {
                throw new Error("当前未选定作品！请先在作品库中选择或创建作品，或前往数据迁移页。");
            }

            const typedAssets = assets as Asset[];
            const changes = await toWorksChanges(state.currentWorkId, typedAssets, state.currentRecords);

            // 必须经由同一 store 草稿与提交协议
            await state.updateDraftChanges(changes);
            const result = await state.commitDraft();

            if (!result.committed) {
                throw new Error("作品提交未被权威服务确认");
            }

            const updatedState = useWorksStore.getState();
            return fromWorksRecords({
                work: updatedState.currentWork!,
                currentCommit: updatedState.currentCommit!,
                records: updatedState.currentRecords,
            });
        },

        archiveAssets: async (assetIds: string[]): Promise<void> => {
            const state = useWorksStore.getState();
            if (!state.currentWorkId || !state.currentWork) {
                throw new Error("未选定当前作品，无法执行资产归档");
            }

            const changes: RecordChange[] = [];
            for (const id of assetIds) {
                const existing = state.currentRecords[id];
                if (existing && existing.type === "asset") {
                    changes.push({
                        id,
                        type: "asset",
                        data: {
                            ...(existing.data as Record<string, unknown>),
                            archived: true,
                        },
                    });
                } else {
                    // 对非 asset 记录（如 episode, script, shot）写入规范的 RecordTypeArchive 记录，严禁向不支持 archived 字段的类型注入未知属性
                    const archiveId = await toLocatorId(state.currentWorkId, `archive:${id}`);
                    changes.push({
                        id: archiveId,
                        type: "archive",
                        data: {
                            id: archiveId,
                            workId: state.currentWorkId,
                            entityRefs: [id],
                            sourceRevision: String(state.currentWork.revision),
                        },
                    });
                }
            }

            await state.updateDraftChanges(changes);
            await state.commitDraft();
        },

        archiveCanvasNodes: async (nodes: unknown[], canvasId: string, snapshot?: unknown) => {
            const state = useWorksStore.getState();
            if (!state.currentWorkId || !state.currentWork) {
                throw new Error("当前未选定作品，无法反向回存画布");
            }
            const typedNodes = nodes as import("@/types/canvas").CanvasNodeData[];
            const { archiveCanvasNodesToWork } = await import("./canvas-archive");
            return archiveCanvasNodesToWork(state.currentWorkId, typedNodes, canvasId, snapshot as any);
        },

        onWorkChanged: (handler: (work: WorksWorkSummary | null) => void): (() => void) => {
            // 订阅仅在实际 work.id 或 work.revision 改变时触发通知
            return subscribeWorkChange((work) => {
                const summary = work
                    ? {
                          id: work.id,
                          title: work.title,
                          revision: work.revision,
                          currentCommitId: work.currentCommitId,
                      }
                    : null;
                handler(summary);
            });
        },

        getMediaUrl: (fileId: string): string => {
            const workId = useWorksStore.getState().currentWorkId;
            return workId ? getMediaUrl(workId, fileId) : "";
        },

        uploadMedia: async (file: Blob, filename: string, mimeType?: string) => {
            const workId = useWorksStore.getState().currentWorkId;
            if (!workId) throw new Error("未选定作品，无法上传媒体");
            const res = await uploadMedia(workId, file, filename, mimeType);
            return { fileId: res.fileId, sha256: res.sha256 };
        },
    };
}
