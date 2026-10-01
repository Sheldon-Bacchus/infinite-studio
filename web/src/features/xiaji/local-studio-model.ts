// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Asset } from "@/stores/use-asset-store";
import { getXiaTangRecord, listXiaTangProjectAssets } from "./xia-tang-local-model";

export type LocalStudioProjectRecord = {
    schemaVersion: 1;
    recordType: "project";
    projectType: string;
    baseStyle: string;
    sourceAssetId?: string;
    [key: string]: unknown;
};

export type LocalStudioEpisodeRecord = {
    schemaVersion: 1;
    recordType: "episode";
    projectAssetId: string;
    order: number;
    sourceEpisodeNumber?: number;
    title: string;
    synopsis?: string;
    scriptAssetId?: string;
    currentBeatAssetIds?: string[];
    sourcePackageId?: string;
    sourceKey?: string;
    [key: string]: unknown;
};

export type LocalStudioScriptRecord = {
    schemaVersion: 1;
    recordType: "script";
    projectAssetId: string;
    episodeAssetId: string;
    documentKind: "script" | "structure";
    version?: number;
    supersedesAssetId?: string;
    supersededByAssetId?: string;
    approvalState?: "approved" | "superseded";
    packageId?: string;
    contentDigest?: string;
    sourceKey?: string;
    [key: string]: unknown;
};

export type LocalStudioBeatRecord = {
    schemaVersion: 1;
    recordType: "beat";
    projectAssetId: string;
    episodeAssetId: string;
    order: number;
    sourceBeatNumber?: number;
    dialogueText?: string;
    referencedAssetIds: string[];
    version?: number;
    supersedesAssetId?: string;
    supersededByAssetId?: string;
    approvalState?: "approved" | "superseded";
    packageId?: string;
    contentDigest?: string;
    sourceKey?: string;
    [key: string]: unknown;
};

export type LocalStudioRecord = LocalStudioProjectRecord | LocalStudioEpisodeRecord | LocalStudioScriptRecord | LocalStudioBeatRecord;

export type LocalStudioValidationIssue = { assetId: string; code: string; message: string };

export type LocalStudioAssetBeatReference = {
    projectAssetId: string;
    episodeAssetId: string;
    episodeOrder: number;
    episodeTitle: string;
    beatAssetId: string;
    beatOrder: number;
    beatTitle: string;
};

export type LocalStudioEpisodeStats = {
    sourceTextLineCount: number;
    scriptLineCount: number;
    beatCount: number;
    identityCount: number;
    sceneCount: number;
    propCount: number;
    scriptReady: boolean;
};

function countNonEmptyLines(value: string) {
    return value.split(/\r\n|\r|\n/).filter((line) => line.trim()).length;
}

export function summarizeLocalStudioEpisode(assets: Asset[], episodeAssetId: string): LocalStudioEpisodeStats {
    const episode = assets.find((asset) => asset.id === episodeAssetId);
    const episodeRecord = episode ? getLocalStudioRecord(episode) : null;
    if (!episode || episodeRecord?.recordType !== "episode") {
        return { sourceTextLineCount: 0, scriptLineCount: 0, beatCount: 0, identityCount: 0, sceneCount: 0, propCount: 0, scriptReady: false };
    }

    const beats = listCurrentLocalStudioBeats(assets, episodeAssetId);
    const linkedScript = episodeRecord.scriptAssetId ? assets.find((asset) => asset.id === episodeRecord.scriptAssetId) : undefined;
    const linkedScriptRecord = linkedScript ? getLocalStudioRecord(linkedScript) : null;
    const currentScript = linkedScriptRecord?.recordType === "script" && linkedScriptRecord.documentKind === "script"
        && linkedScriptRecord.episodeAssetId === episodeAssetId && linkedScriptRecord.projectAssetId === episodeRecord.projectAssetId
        ? linkedScript
        : undefined;
    const scriptText = currentScript?.kind === "text" ? currentScript.data.content : "";
    const projectXiaTangIds = new Set(listXiaTangProjectAssets(assets, episodeRecord.projectAssetId).map((asset) => asset.id));
    const referenced = new Set(beats.flatMap((beat) => {
        const record = getLocalStudioRecord(beat);
        return record?.recordType === "beat" ? record.referencedAssetIds.filter((assetId) => projectXiaTangIds.has(assetId)) : [];
    }));
    const xiaTangRecords = [...referenced].flatMap((assetId) => {
        const asset = assets.find((item) => item.id === assetId);
        const record = asset ? getXiaTangRecord(asset) : null;
        return record ? [record] : [];
    });

    return {
        sourceTextLineCount: episode.kind === "text" ? countNonEmptyLines(episode.data.content) : 0,
        scriptLineCount: countNonEmptyLines(scriptText),
        beatCount: beats.length,
        identityCount: xiaTangRecords.filter((record) => record.recordType === "identity").length,
        sceneCount: xiaTangRecords.filter((record) => record.domain === "scene" && record.recordType === "entity").length,
        propCount: xiaTangRecords.filter((record) => record.domain === "prop" && record.recordType === "entity").length,
        scriptReady: Boolean(scriptText.trim()),
    };
}

export function createLocalStudioAssetInput(title: string, content: string, record: LocalStudioRecord): Omit<Asset, "id" | "createdAt" | "updatedAt"> {
    return {
        kind: "text",
        title,
        coverUrl: "",
        tags: [],
        category: `xiaji:${record.recordType}`,
        source: "虾塘本地项目",
        data: { content },
        metadata: { localStudio: { ...record } },
    } as Omit<Asset, "id" | "createdAt" | "updatedAt">;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isLocalStudioRecord(value: unknown): value is LocalStudioRecord {
    if (!isObject(value) || value.schemaVersion !== 1) return false;

    switch (value.recordType) {
        case "project":
            return typeof value.projectType === "string" && typeof value.baseStyle === "string";
        case "episode":
            return isNonEmptyString(value.projectAssetId) && isPositiveInteger(value.order) && isNonEmptyString(value.title)
                && (value.sourceEpisodeNumber === undefined || isPositiveInteger(value.sourceEpisodeNumber))
                && (value.currentBeatAssetIds === undefined || (Array.isArray(value.currentBeatAssetIds) && value.currentBeatAssetIds.every(isNonEmptyString)));
        case "script":
            return isNonEmptyString(value.projectAssetId) && isNonEmptyString(value.episodeAssetId)
                && (value.documentKind === "script" || value.documentKind === "structure")
                && (value.version === undefined || isPositiveInteger(value.version))
                && (value.supersedesAssetId === undefined || isNonEmptyString(value.supersedesAssetId))
                && (value.supersededByAssetId === undefined || isNonEmptyString(value.supersededByAssetId))
                && (value.approvalState === undefined || value.approvalState === "approved" || value.approvalState === "superseded")
                && (value.packageId === undefined || isNonEmptyString(value.packageId))
                && (value.sourceKey === undefined || isNonEmptyString(value.sourceKey))
                && (value.contentDigest === undefined || (typeof value.contentDigest === "string" && /^[a-f0-9]{64}$/.test(value.contentDigest)));
        case "beat":
            return isNonEmptyString(value.projectAssetId) && isNonEmptyString(value.episodeAssetId) && isPositiveInteger(value.order)
                && Array.isArray(value.referencedAssetIds) && value.referencedAssetIds.every(isNonEmptyString)
                && (value.dialogueText === undefined || typeof value.dialogueText === "string")
                && (value.sourceBeatNumber === undefined || isPositiveInteger(value.sourceBeatNumber))
                && (value.version === undefined || isPositiveInteger(value.version))
                && (value.supersedesAssetId === undefined || isNonEmptyString(value.supersedesAssetId))
                && (value.supersededByAssetId === undefined || isNonEmptyString(value.supersededByAssetId))
                && (value.approvalState === undefined || value.approvalState === "approved" || value.approvalState === "superseded")
                && (value.packageId === undefined || isNonEmptyString(value.packageId))
                && (value.sourceKey === undefined || isNonEmptyString(value.sourceKey))
                && (value.contentDigest === undefined || (typeof value.contentDigest === "string" && /^[a-f0-9]{64}$/.test(value.contentDigest)));
        default:
            return false;
    }
}

export function getLocalStudioRecord(asset: Asset): LocalStudioRecord | null {
    const metadata = asset.metadata?.localStudio;
    return asset.kind === "text" && isLocalStudioRecord(metadata) ? metadata : null;
}

export function listCurrentLocalStudioBeats(assets: Asset[], episodeAssetId: string): Asset[] {
    const episode = assets.find((asset) => asset.id === episodeAssetId);
    const episodeRecord = episode ? getLocalStudioRecord(episode) : null;
    if (episodeRecord?.recordType !== "episode") return [];
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const isCurrentBeat = (asset: Asset) => {
        const record = getLocalStudioRecord(asset);
        return record?.recordType === "beat" && record.projectAssetId === episodeRecord.projectAssetId
            && record.episodeAssetId === episodeAssetId && record.approvalState !== "superseded";
    };
    const current = Array.isArray(episodeRecord.currentBeatAssetIds)
        ? episodeRecord.currentBeatAssetIds.flatMap((id) => {
              const asset = byId.get(id);
              return asset && isCurrentBeat(asset) ? [asset] : [];
          })
        : assets.filter(isCurrentBeat);
    return current.sort((left, right) => {
        const leftRecord = getLocalStudioRecord(left);
        const rightRecord = getLocalStudioRecord(right);
        if (leftRecord?.recordType !== "beat" || rightRecord?.recordType !== "beat") return left.id.localeCompare(right.id);
        return leftRecord.order - rightRecord.order || left.id.localeCompare(right.id);
    });
}

export function patchLocalStudioRecord(asset: Asset, patch: Record<string, unknown>): Asset {
    const current = getLocalStudioRecord(asset);
    if (!current) return asset;
    const next = { ...current, ...patch, schemaVersion: current.schemaVersion, recordType: current.recordType };
    if (!isLocalStudioRecord(next)) return asset;
    return { ...asset, metadata: { ...asset.metadata, localStudio: next } } as Asset;
}

function owningProjectId(asset: Asset, assetsById: Map<string, Asset>, visited = new Set<string>()): string | null {
    if (visited.has(asset.id)) return null;
    visited.add(asset.id);
    const studio = getLocalStudioRecord(asset);
    if (studio?.recordType === "project") return asset.id;
    if (studio && "projectAssetId" in studio) return studio.projectAssetId;
    const xiaTang = getXiaTangRecord(asset);
    if (!xiaTang) return null;
    if (xiaTang.projectAssetId) return xiaTang.projectAssetId;
    const parent = xiaTang.parentId ? assetsById.get(xiaTang.parentId) : undefined;
    return parent ? owningProjectId(parent, assetsById, visited) : null;
}

export function listLocalStudioAssetBeatReferences(assets: Asset[], assetId: string): LocalStudioAssetBeatReference[] {
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    return assets.flatMap((beat) => {
        const beatRecord = getLocalStudioRecord(beat);
        if (beatRecord?.recordType !== "beat" || !beatRecord.referencedAssetIds.includes(assetId)) return [];
        const episode = assetsById.get(beatRecord.episodeAssetId);
        const episodeRecord = episode ? getLocalStudioRecord(episode) : null;
        if (!episode || episodeRecord?.recordType !== "episode" || episodeRecord.projectAssetId !== beatRecord.projectAssetId) return [];
        return [{
            projectAssetId: beatRecord.projectAssetId,
            episodeAssetId: episode.id,
            episodeOrder: episodeRecord.order,
            episodeTitle: episodeRecord.title,
            beatAssetId: beat.id,
            beatOrder: beatRecord.order,
            beatTitle: beat.title,
        }];
    }).sort((left, right) => left.episodeOrder - right.episodeOrder || left.beatOrder - right.beatOrder || left.beatAssetId.localeCompare(right.beatAssetId));
}

export function validateLocalStudioAssetCollection(assets: Asset[]): { issues: LocalStudioValidationIssue[] } {
    const issues: LocalStudioValidationIssue[] = [];
    const records = new Map(assets.map((asset) => [asset.id, getLocalStudioRecord(asset)]));
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const allIds = new Set(assets.map((asset) => asset.id));
    const episodeOrders = new Set<string>();
    const beatOrders = new Set<string>();

    for (const asset of assets) {
        const record = records.get(asset.id);
        if (!record) continue;

        if (record.recordType === "project" && record.sourceAssetId && !allIds.has(record.sourceAssetId)) {
            issues.push({ assetId: asset.id, code: "missing-source-material", message: "项目原始剧本素材不存在" });
        }

        if (record.recordType === "episode") {
            if (records.get(record.projectAssetId)?.recordType !== "project") {
                issues.push({ assetId: asset.id, code: "missing-project", message: "分集所属项目不存在" });
            }
            const orderKey = `${record.projectAssetId}:${record.order}`;
            if (episodeOrders.has(orderKey)) issues.push({ assetId: asset.id, code: "duplicate-episode-order", message: "同一项目的分集序号重复" });
            episodeOrders.add(orderKey);
            if (record.currentBeatAssetIds) {
                if (new Set(record.currentBeatAssetIds).size !== record.currentBeatAssetIds.length) {
                    issues.push({ assetId: asset.id, code: "duplicate-current-beat", message: "分集当前镜头清单中存在重复素材" });
                }
                for (const beatAssetId of record.currentBeatAssetIds) {
                    const currentBeat = records.get(beatAssetId);
                    if (currentBeat?.recordType !== "beat" || currentBeat.projectAssetId !== record.projectAssetId
                        || currentBeat.episodeAssetId !== asset.id || currentBeat.approvalState === "superseded") {
                        issues.push({ assetId: asset.id, code: "invalid-current-beat", message: `当前镜头清单包含无效素材：${beatAssetId}` });
                    }
                }
            }
        }

        if (record.recordType === "script" || record.recordType === "beat") {
            if (records.get(record.projectAssetId)?.recordType !== "project") {
                issues.push({ assetId: asset.id, code: "missing-project", message: "内容所属项目不存在" });
            }
            const episode = records.get(record.episodeAssetId);
            if (episode?.recordType !== "episode") {
                issues.push({ assetId: asset.id, code: "missing-episode", message: "内容所属分集不存在" });
            } else if (episode.projectAssetId !== record.projectAssetId) {
                issues.push({ assetId: asset.id, code: "episode-project-mismatch", message: "内容与分集不属于同一项目" });
            }
        }

        if (record.recordType === "beat") {
            const episodeRecord = records.get(record.episodeAssetId);
            const currentIds = episodeRecord?.recordType === "episode" ? episodeRecord.currentBeatAssetIds : undefined;
            const isCurrent = record.approvalState !== "superseded" && (!currentIds || currentIds.includes(asset.id));
            if (isCurrent) {
                const orderKey = `${record.episodeAssetId}:${record.order}`;
                if (beatOrders.has(orderKey)) issues.push({ assetId: asset.id, code: "duplicate-beat-order", message: "同一分集的镜头序号重复" });
                beatOrders.add(orderKey);
            }
            for (const referencedAssetId of record.referencedAssetIds) {
                if (!allIds.has(referencedAssetId)) issues.push({ assetId: asset.id, code: "missing-referenced-asset", message: `关联素材不存在：${referencedAssetId}` });
                else if (owningProjectId(assetsById.get(referencedAssetId)!, assetsById) !== record.projectAssetId) {
                    issues.push({ assetId: asset.id, code: "foreign-referenced-asset", message: `关联素材不属于当前项目：${referencedAssetId}` });
                }
            }
        }
    }

    return { issues };
}
