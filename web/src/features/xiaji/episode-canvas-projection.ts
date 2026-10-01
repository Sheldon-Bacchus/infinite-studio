import type { Asset } from "@/stores/use-asset-store";
import { getLocalStudioRecord, listCurrentLocalStudioBeats } from "./local-studio-model";
import { findXiaTangChildren, getXiaTangRecord, listXiaTangProjectAssets } from "./xia-tang-local-model";

export type XiajiProjectionMode = "complete" | "selected";
export type XiajiProjectionRole = "script" | "beat" | "asset";

export type XiajiProjectionIssue = {
    code: string;
    message: string;
    assetId?: string;
    relatedAssetId?: string;
};

export type XiajiProjectionPreview = {
    projectAssetId: string;
    episodeAssetId: string;
    project: { title: string; projectType: string; baseStyle: string } | null;
    episode: { title: string; order: number; synopsis?: string } | null;
    script: { assetId: string; title: string; content: string; documentKind: "script" | "structure" } | null;
    beats: Array<{
        assetId: string;
        order: number;
        title: string;
        content: string;
        dialogueText?: string;
        referencedAssetIds: string[];
    }>;
    references: Array<{
        assetId: string;
        title: string;
        kind: Asset["kind"];
        category?: string;
        tags: string[];
        domain: string;
        recordType: string;
        selectedMedia: Array<{ assetId: string; kind: Asset["kind"]; slot: string; readability: "unverified" | "file-only" }>;
    }>;
    requiredSourceAssetIds: string[];
    referencedSourceAssetIds: string[];
    selectedMediaAssetIds: string[];
    importableSourceAssetIds: string[];
    skippedItems: XiajiProjectionIssue[];
    issues: XiajiProjectionIssue[];
    plannedEdges: Array<{ fromRole: XiajiProjectionRole; fromAssetId: string; toRole: XiajiProjectionRole; toAssetId: string }>;
    sourceDigest: string;
    completeEligible: boolean;
};

export type XiajiProjectionIdentity = {
    projectionId: string;
    projectionKeys: Record<string, string>;
    nodeIds: Record<string, string>;
};

export function serializeXiajiProjectionPreview(preview: XiajiProjectionPreview): Record<string, unknown> & { ok: boolean } {
    return {
        ok: true,
        status: preview.issues.length ? "blocked" : "ready",
        projectAssetId: preview.projectAssetId,
        episodeAssetId: preview.episodeAssetId,
        project: preview.project,
        episode: preview.episode,
        script: preview.script,
        beats: preview.beats,
        references: preview.references,
        requiredSourceAssetIds: preview.requiredSourceAssetIds,
        referencedSourceAssetIds: preview.referencedSourceAssetIds,
        selectedMediaAssetIds: preview.selectedMediaAssetIds,
        importableSourceAssetIds: preview.importableSourceAssetIds,
        skippedItems: preview.skippedItems,
        issues: preview.issues,
        plannedEdges: preview.plannedEdges,
        sourceDigest: preview.sourceDigest,
        completeEligible: preview.completeEligible,
    };
}

export async function previewXiajiEpisodeContextTool(assets: Asset[], projectAssetId: string, episodeAssetId: string) {
    const preview = await previewXiajiEpisodeProjection(assets, projectAssetId, episodeAssetId);
    return serializeXiajiProjectionPreview(preview);
}

type ProjectedSourceItem = {
    asset: Asset;
    role: XiajiProjectionRole;
    slot?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (isObject(value)) {
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

function mediaReference(asset: Asset): string | undefined {
    switch (asset.kind) {
        case "image":
            return asset.data.dataUrl || undefined;
        case "video":
        case "audio":
            return asset.data.url || undefined;
        case "text":
            return asset.data.content || undefined;
    }
}

function mediaCurrentBySlot(value: unknown): Record<string, string> {
    if (!isObject(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function stableAsset(asset: Asset) {
    return {
        id: asset.id,
        kind: asset.kind,
        title: asset.title,
        tags: [...asset.tags].sort(),
        category: asset.category,
        data: asset.data,
        localStudio: asset.metadata?.localStudio,
        xiaTang: asset.metadata?.xiaTang,
    };
}

export async function createXiajiProjectionItemDigest(asset: Asset, role: XiajiProjectionRole): Promise<string> {
    return sha256([role, stableAsset(asset)]);
}

function localStudioReference(asset: Asset): Record<string, unknown> | null {
    return isObject(asset.metadata?.localStudio) ? asset.metadata.localStudio : null;
}

function sourceDigestPayload(project: Asset | undefined, episode: Asset | undefined, script: Asset | undefined, beats: Asset[], referenced: Asset[], media: ProjectedSourceItem[]) {
    return {
        project: project ? stableAsset(project) : null,
        episode: episode ? stableAsset(episode) : null,
        script: script ? stableAsset(script) : null,
        beats: [...beats].sort((left, right) => left.id.localeCompare(right.id)).map(stableAsset),
        references: [...referenced].sort((left, right) => left.id.localeCompare(right.id)).map(stableAsset),
        selectedMedia: [...media].sort((left, right) => left.asset.id.localeCompare(right.asset.id)).map(({ asset, slot }) => ({ ...stableAsset(asset), slot })),
    };
}

function isMediaMappable(asset: Asset): boolean {
    return asset.kind === "text" ? Boolean(asset.data.content.trim()) : Boolean(mediaReference(asset));
}

function orderedIds(values: string[]) {
    return [...new Set(values)];
}

export async function previewXiajiEpisodeProjection(assets: Asset[], projectAssetId: string, episodeAssetId: string): Promise<XiajiProjectionPreview> {
    const issues: XiajiProjectionIssue[] = [];
    const skippedItems: XiajiProjectionIssue[] = [];
    const assetsById = new Map<string, Asset>();
    for (const asset of assets) {
        if (assetsById.has(asset.id)) issues.push({ code: "duplicate-asset-id", message: "本地素材 ID 重复，无法建立无歧义的投影", assetId: asset.id });
        else assetsById.set(asset.id, asset);
    }

    const projectAsset = assetsById.get(projectAssetId);
    const projectRecord = projectAsset ? getLocalStudioRecord(projectAsset) : null;
    if (!projectAsset || projectRecord?.recordType !== "project") {
        issues.push({ code: "missing-project", message: "项目不存在或不是虾镜本地项目", assetId: projectAssetId });
    }
    const episodeAsset = assetsById.get(episodeAssetId);
    const episodeRecord = episodeAsset ? getLocalStudioRecord(episodeAsset) : null;
    if (!episodeAsset || episodeRecord?.recordType !== "episode") {
        issues.push({ code: "missing-episode", message: "分集不存在或分集记录无效", assetId: episodeAssetId });
    } else if (episodeRecord.projectAssetId !== projectAssetId) {
        issues.push({ code: "episode-project-mismatch", message: "分集不属于指定项目", assetId: episodeAssetId, relatedAssetId: projectAssetId });
    }

    const validEpisode = episodeRecord?.recordType === "episode" && episodeRecord.projectAssetId === projectAssetId;
    const beats = validEpisode
        ? listCurrentLocalStudioBeats(assets, episodeAssetId).filter((asset) => {
              const record = getLocalStudioRecord(asset);
              return record?.recordType === "beat" && record.projectAssetId === projectAssetId;
          })
        : [];
    const malformedBeatRecords = validEpisode
        ? assets.filter((asset) => {
              const record = localStudioReference(asset);
              return (
                  asset.category === "xiaji:beat" &&
                  record?.recordType === "beat" &&
                  record.projectAssetId === projectAssetId &&
                  record.episodeAssetId === episodeAssetId &&
                  (!Number.isSafeInteger(record.order) || Number(record.order) <= 0 || !Array.isArray(record.referencedAssetIds))
              );
          })
        : [];
    for (const malformed of malformedBeatRecords) {
        issues.push({ code: "invalid-beat-order", message: "镜头记录缺少有效的正整数顺序或引用列表", assetId: malformed.id });
    }
    const sortedBeats = [...beats].sort((left, right) => {
        const leftOrder = getLocalStudioRecord(left);
        const rightOrder = getLocalStudioRecord(right);
        if (leftOrder?.recordType !== "beat" || rightOrder?.recordType !== "beat") return left.id.localeCompare(right.id);
        return leftOrder.order - rightOrder.order || left.id.localeCompare(right.id);
    });
    const seenBeatOrders = new Set<number>();
    for (const beat of sortedBeats) {
        const record = getLocalStudioRecord(beat);
        if (record?.recordType !== "beat") continue;
        if (seenBeatOrders.has(record.order)) issues.push({ code: "duplicate-beat-order", message: `镜头顺序 ${record.order} 重复`, assetId: beat.id });
        seenBeatOrders.add(record.order);
    }
    if (validEpisode && sortedBeats.length === 0) issues.push({ code: "missing-beats", message: "分集尚无已保存镜头", assetId: episodeAssetId });

    const linkedScript = episodeRecord?.recordType === "episode" && episodeRecord.scriptAssetId ? assetsById.get(episodeRecord.scriptAssetId) : undefined;
    const activeScriptCandidates = validEpisode
        ? assets.filter((asset) => {
              const record = getLocalStudioRecord(asset);
              return record?.recordType === "script" && record.documentKind === "script" && record.projectAssetId === projectAssetId && record.episodeAssetId === episodeAssetId && record.approvalState !== "superseded";
          })
        : [];
    let scriptAsset: Asset | undefined;
    if (!episodeRecord || episodeRecord.recordType !== "episode" || !episodeRecord.scriptAssetId || !linkedScript) {
        issues.push({ code: "missing-script", message: "分集没有持久化关联的剧本文本", assetId: episodeAssetId });
    } else {
        const record = getLocalStudioRecord(linkedScript);
        if (record?.recordType !== "script" || record.projectAssetId !== projectAssetId || record.episodeAssetId !== episodeAssetId || record.documentKind !== "script") {
            issues.push({ code: "invalid-linked-script", message: "分集关联的素材不是本项目本分集的正式剧本", assetId: episodeAssetId, relatedAssetId: linkedScript.id });
        } else if (activeScriptCandidates.length !== 1) {
            issues.push({ code: "ambiguous-script", message: "本分集存在多个正式剧本候选，无法确定唯一版本", assetId: episodeAssetId });
        } else if (activeScriptCandidates[0].id !== linkedScript.id) {
            issues.push({ code: "invalid-linked-script", message: "分集关联的剧本与正式剧本候选不一致", assetId: episodeAssetId, relatedAssetId: linkedScript.id });
        } else {
            scriptAsset = linkedScript;
            if (linkedScript.kind !== "text" || !linkedScript.data.content.trim()) {
                issues.push({ code: "empty-script", message: "已关联剧本为空或不是文本素材", assetId: linkedScript.id });
            }
        }
    }
    const referencedIds = orderedIds(
        sortedBeats.flatMap((beat) => {
            const record = getLocalStudioRecord(beat);
            return record?.recordType === "beat" ? record.referencedAssetIds : [];
        }),
    ).sort((left, right) => left.localeCompare(right));
    const projectXiaTang = new Set(listXiaTangProjectAssets(assets, projectAssetId).map((asset) => asset.id));
    const referencedAssets: Asset[] = [];
    const mediaItems: ProjectedSourceItem[] = [];
    const references: XiajiProjectionPreview["references"] = [];

    for (const referencedId of referencedIds) {
        const asset = assetsById.get(referencedId);
        if (!asset) {
            issues.push({ code: "missing-referenced-asset", message: "镜头引用的虾塘素材不存在", assetId: referencedId });
            continue;
        }
        const record = getXiaTangRecord(asset);
        if (!record) {
            issues.push({ code: "invalid-referenced-asset", message: "镜头引用项不是有效的虾塘素材记录", assetId: referencedId });
            continue;
        }
        if (!projectXiaTang.has(asset.id) || (record.projectAssetId && record.projectAssetId !== projectAssetId)) {
            issues.push({ code: "foreign-referenced-asset", message: "镜头引用的虾塘素材不属于当前项目", assetId: referencedId });
            continue;
        }
        referencedAssets.push(asset);
        const selectedMedia: XiajiProjectionPreview["references"][number]["selectedMedia"] = [];
        if (record.recordType !== "media") {
            const selected = mediaCurrentBySlot(record.fields.mediaCurrentBySlot);
            for (const [slot, mediaId] of Object.entries(selected).sort(([left], [right]) => left.localeCompare(right))) {
                const media = assetsById.get(mediaId);
                const mediaRecord = media ? getXiaTangRecord(media) : null;
                const isSelectedChild = mediaRecord?.recordType === "media" && mediaRecord.parentId === asset.id && mediaRecord.slot === slot && projectXiaTang.has(mediaId) && (!mediaRecord.projectAssetId || mediaRecord.projectAssetId === projectAssetId);
                if (!media || !isSelectedChild) {
                    issues.push({ code: "invalid-selected-media", message: "当前选中的媒体版本不存在或与素材槽位不匹配", assetId: referencedId, relatedAssetId: mediaId });
                    continue;
                }
                const fileOnly = mediaRecord.fields.fileOnly === true;
                selectedMedia.push({ assetId: media.id, kind: media.kind, slot, readability: fileOnly ? "file-only" : "unverified" });
                mediaItems.push({ asset: media, role: "asset", slot });
                if (fileOnly) skippedItems.push({ code: "file-only", message: "该文件没有可导入的原生画布节点类型", assetId: media.id });
                else if (!isMediaMappable(media)) skippedItems.push({ code: "missing-media-reference", message: "媒体记录没有可导入的内容或媒体引用", assetId: media.id });
            }
        }
        references.push({
            assetId: asset.id,
            title: asset.title,
            kind: asset.kind,
            category: asset.category,
            tags: [...asset.tags],
            domain: record.domain,
            recordType: record.recordType,
            selectedMedia,
        });
        if (record.recordType === "media") {
            const fileOnly = record.fields.fileOnly === true;
            if (fileOnly) skippedItems.push({ code: "file-only", message: "该文件没有可导入的原生画布节点类型", assetId: asset.id });
            else if (!isMediaMappable(asset)) skippedItems.push({ code: "missing-media-reference", message: "媒体记录没有可导入的内容或媒体引用", assetId: asset.id });
        }
    }

    const validReferenceAssets = referencedAssets.filter((asset) => !skippedItems.some((item) => item.assetId === asset.id));
    const validMediaItems = mediaItems.filter(({ asset }) => !skippedItems.some((item) => item.assetId === asset.id));
    const requiredSourceAssetIds = orderedIds([...(scriptAsset ? [scriptAsset.id] : []), ...sortedBeats.map((beat) => beat.id)]);
    const referencedSourceAssetIds = referencedAssets.map((asset) => asset.id).sort((left, right) => left.localeCompare(right));
    const selectedMediaAssetIds = orderedIds(mediaItems.map(({ asset }) => asset.id)).sort((left, right) => left.localeCompare(right));
    const importableSourceAssetIds = orderedIds([...requiredSourceAssetIds, ...validReferenceAssets.map((asset) => asset.id), ...validMediaItems.map(({ asset }) => asset.id)]);

    const plannedEdges: XiajiProjectionPreview["plannedEdges"] = [];
    if (scriptAsset && sortedBeats.length) {
        plannedEdges.push({ fromRole: "script", fromAssetId: scriptAsset.id, toRole: "beat", toAssetId: sortedBeats[0].id });
    }
    for (let index = 1; index < sortedBeats.length; index += 1) {
        plannedEdges.push({ fromRole: "beat", fromAssetId: sortedBeats[index - 1].id, toRole: "beat", toAssetId: sortedBeats[index].id });
    }
    const importable = new Set(importableSourceAssetIds);
    for (const beat of sortedBeats) {
        const record = getLocalStudioRecord(beat);
        if (record?.recordType !== "beat") continue;
        for (const referencedId of record.referencedAssetIds) {
            if (importable.has(referencedId)) plannedEdges.push({ fromRole: "beat", fromAssetId: beat.id, toRole: "asset", toAssetId: referencedId });
        }
    }
    for (const reference of references) {
        if (!importable.has(reference.assetId)) continue;
        for (const media of reference.selectedMedia) {
            if (importable.has(media.assetId)) plannedEdges.push({ fromRole: "asset", fromAssetId: reference.assetId, toRole: "asset", toAssetId: media.assetId });
        }
    }

    const digest = await sha256(sourceDigestPayload(projectAsset, episodeAsset, scriptAsset, sortedBeats, referencedAssets, mediaItems));
    const completeEligible = issues.length === 0 && skippedItems.length === 0 && Boolean(scriptAsset) && sortedBeats.length > 0;
    return {
        projectAssetId,
        episodeAssetId,
        project: projectRecord?.recordType === "project" ? { title: projectAsset!.title, projectType: projectRecord.projectType, baseStyle: projectRecord.baseStyle } : null,
        episode: episodeRecord?.recordType === "episode" ? { title: episodeRecord.title, order: episodeRecord.order, synopsis: episodeRecord.synopsis } : null,
        script:
            scriptAsset?.kind === "text" && getLocalStudioRecord(scriptAsset)?.recordType === "script"
                ? { assetId: scriptAsset.id, title: scriptAsset.title, content: scriptAsset.data.content, documentKind: getLocalStudioRecord(scriptAsset)!.documentKind as "script" | "structure" }
                : null,
        beats: sortedBeats.flatMap((beat) => {
            const record = getLocalStudioRecord(beat);
            if (beat.kind !== "text" || record?.recordType !== "beat") return [];
            return [{ assetId: beat.id, order: record.order, title: beat.title, content: beat.data.content, ...(record.dialogueText === undefined ? {} : { dialogueText: record.dialogueText }), referencedAssetIds: [...record.referencedAssetIds] }];
        }),
        references,
        requiredSourceAssetIds,
        referencedSourceAssetIds,
        selectedMediaAssetIds,
        importableSourceAssetIds,
        skippedItems,
        issues,
        plannedEdges,
        sourceDigest: digest,
        completeEligible,
    };
}

export async function createXiajiProjectionIdentity(canvasId: string, preview: XiajiProjectionPreview, mode: XiajiProjectionMode, sourceAssetIds: string[]): Promise<XiajiProjectionIdentity> {
    const selectionIssues = validateXiajiProjectionSelection(preview, mode, sourceAssetIds);
    if (!canvasId.trim()) throw new Error("Canvas ID 不能为空");
    if (selectionIssues.length) throw new Error(selectionIssues.map((issue) => issue.code).join(","));
    const roles = new Map<string, XiajiProjectionRole>();
    if (preview.script) roles.set(preview.script.assetId, "script");
    for (const beat of preview.beats) roles.set(beat.assetId, "beat");
    return createXiajiProjectionIdentityFromSource({
        canvasId,
        projectAssetId: preview.projectAssetId,
        episodeAssetId: preview.episodeAssetId,
        sourceDigest: preview.sourceDigest,
        mode,
        sourceAssetIds,
        rolesBySourceAssetId: Object.fromEntries(roles),
    });
}

export async function createXiajiProjectionIdentityFromSource({
    canvasId,
    projectAssetId,
    episodeAssetId,
    sourceDigest,
    mode,
    sourceAssetIds,
    rolesBySourceAssetId,
}: {
    canvasId: string;
    projectAssetId: string;
    episodeAssetId: string;
    sourceDigest: string;
    mode: XiajiProjectionMode;
    sourceAssetIds: string[];
    rolesBySourceAssetId: Record<string, XiajiProjectionRole>;
}): Promise<XiajiProjectionIdentity> {
    const sortedIds = [...sourceAssetIds].sort((left, right) => left.localeCompare(right));
    const projectionId = `xiaji:${await sha256([canvasId, projectAssetId, episodeAssetId, sourceDigest, mode, sortedIds])}`;
    const projectionKeys: Record<string, string> = {};
    const nodeIds: Record<string, string> = {};
    for (const sourceAssetId of sortedIds) {
        const role = rolesBySourceAssetId[sourceAssetId] || "asset";
        const key = `xiaji:v1:${await sha256([projectionId, role, sourceAssetId])}`;
        projectionKeys[sourceAssetId] = key;
        nodeIds[sourceAssetId] = `xiaji-node-${(await sha256(key)).slice(0, 32)}`;
    }
    return { projectionId, projectionKeys, nodeIds };
}

export function validateXiajiProjectionSelection(preview: XiajiProjectionPreview, mode: XiajiProjectionMode, sourceAssetIds: string[]): XiajiProjectionIssue[] {
    const issues: XiajiProjectionIssue[] = [];
    const selected = new Set(sourceAssetIds);
    if (selected.size !== sourceAssetIds.length) issues.push({ code: "duplicate-source-id", message: "批准的来源 ID 不能重复" });
    if (preview.issues.length) issues.push({ code: "preview-blocked", message: "预览包含未解决的项目、分集、剧本、镜头或素材关系问题" });
    const importable = new Set(preview.importableSourceAssetIds);
    for (const id of selected) {
        if (!importable.has(id)) issues.push({ code: "unimportable-source-id", message: "批准列表包含不可导入或不属于当前预览的素材", assetId: id });
    }
    if (mode === "complete") {
        if (!preview.completeEligible) issues.push({ code: "complete-blocked", message: "当前预览不能作为完整整集导入" });
        if (selected.size !== importable.size || [...importable].some((id) => !selected.has(id))) {
            issues.push({ code: "incomplete-closure", message: "完整模式必须精确包含全部可导入的剧本、镜头、显式引用和当前选中媒体" });
        }
    } else {
        if (!preview.script || !selected.has(preview.script.assetId)) issues.push({ code: "missing-selected-script", message: "局部模式仍须包含已保存剧本" });
        if (!preview.beats.some((beat) => selected.has(beat.assetId))) issues.push({ code: "missing-selected-beat", message: "局部模式至少须包含一个已保存镜头" });
    }
    return issues;
}
