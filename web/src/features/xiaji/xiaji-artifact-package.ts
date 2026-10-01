// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Asset } from "@/stores/use-asset-store";
import { getLocalStudioRecord, listCurrentLocalStudioBeats } from "./local-studio-model";
import { getXiaTangRecord, listXiaTangProjectAssets } from "./xia-tang-local-model";

export type XiajiArtifactStage = "project-outline" | "script" | "production-breakdown" | "asset-references";
export type XiajiArtifactKind = "episode" | "script" | "beat" | "asset-reference" | "media-reference";
export type XiajiArtifactPackage = {
    schemaVersion: 1;
    packageId: string;
    projectAssetId: string;
    episodeAssetId?: string;
    stage: XiajiArtifactStage;
    baseRevision: string;
    artifacts: Array<{ sourceKey: string; kind: XiajiArtifactKind; title: string; content?: string; metadata?: Record<string, unknown> }>;
    relations: Array<{ from: string; type: string; to: string }>;
    mediaAssetIds: string[];
    contentDigest: string;
};

export type XiajiArtifactHandoff = {
    key?: string;
    projectAssetId: string;
    canvasId: string;
    packageId: string;
    contentDigest: string;
    package: XiajiArtifactPackage;
    stagedAt: string;
};

export type XiajiArtifactStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type XiajiArtifactValidation = { ok: boolean; code?: string; message?: string; baseRevision?: string; package?: XiajiArtifactPackage };

const HANDOFF_PREFIX = "infinite-canvas:xiaji:artifact:v1:";
const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_METADATA_KEYS = new Set(["url", "uri", "path", "filepath", "dataurl", "base64", "storagekey"]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
    return JSON.stringify(value) ?? "undefined";
}

async function sha256(value: unknown): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function containsForbiddenMetadata(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(containsForbiddenMetadata);
    if (!isRecord(value)) return false;
    return Object.entries(value).some(([key, item]) => FORBIDDEN_METADATA_KEYS.has(key.toLowerCase()) || containsForbiddenMetadata(item));
}

function publicFields(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(publicFields);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !FORBIDDEN_METADATA_KEYS.has(key.toLowerCase()) && !/(url|uri|path|base64|storagekey)/i.test(key))
        .map(([key, item]) => [key, publicFields(item)]));
}

function isProjectAsset(asset: Asset | undefined): asset is Asset {
    return Boolean(asset && getLocalStudioRecord(asset)?.recordType === "project");
}

function projectAssetIds(assets: Asset[], projectAssetId: string): Set<string> {
    const ids = new Set(listXiaTangProjectAssets(assets, projectAssetId).map((asset) => asset.id));
    for (const asset of assets) {
        const record = getLocalStudioRecord(asset);
        if ((record?.recordType === "project" && asset.id === projectAssetId) || (record && "projectAssetId" in record && record.projectAssetId === projectAssetId)) ids.add(asset.id);
        if (asset.metadata?.localStudioSource && isRecord(asset.metadata.localStudioSource) && asset.metadata.localStudioSource.projectAssetId === projectAssetId) ids.add(asset.id);
    }
    return ids;
}

export async function createXiajiArtifactContentDigest(value: Record<string, unknown>): Promise<string> {
    const { contentDigest: _contentDigest, ...body } = value;
    return sha256(body);
}

export async function createXiajiArtifactCommitId(pkg: Pick<XiajiArtifactPackage, "packageId" | "projectAssetId" | "contentDigest">): Promise<string> {
    return `xiaji-commit-${(await sha256([pkg.projectAssetId, pkg.packageId, pkg.contentDigest])).slice(0, 32)}`;
}

export async function createXiajiArtifactAssetId(commitId: string, sourceKey: string): Promise<string> {
    return `xiaji-agent-${(await sha256([commitId, sourceKey])).slice(0, 32)}`;
}

export async function createXiajiArtifactBaseRevision(assets: Asset[], projectAssetId: string, episodeAssetId?: string): Promise<string> {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const project = byId.get(projectAssetId);
    if (!isProjectAsset(project)) return sha256({ missingProject: projectAssetId });
    const projectRecord = getLocalStudioRecord(project);
    const source = projectRecord?.recordType === "project" && projectRecord.sourceAssetId ? byId.get(projectRecord.sourceAssetId) : undefined;
    const episodes = assets.filter((asset) => {
        const record = getLocalStudioRecord(asset);
        return record?.recordType === "episode" && record.projectAssetId === projectAssetId && (!episodeAssetId || asset.id === episodeAssetId);
    }).sort((left, right) => {
        const a = getLocalStudioRecord(left);
        const b = getLocalStudioRecord(right);
        return (a?.recordType === "episode" ? a.order : 0) - (b?.recordType === "episode" ? b.order : 0) || left.id.localeCompare(right.id);
    });
    const currentRecords = episodes.flatMap((episode) => {
        const record = getLocalStudioRecord(episode);
        if (record?.recordType !== "episode") return [];
        const script = record.scriptAssetId ? byId.get(record.scriptAssetId) : undefined;
        return [
            ...(script ? [script] : []),
            ...listCurrentLocalStudioBeats(assets, episode.id),
        ];
    });
    const xiaTangAssets = listXiaTangProjectAssets(assets, projectAssetId);
    const selected = [project, ...(source ? [source] : []), ...episodes, ...currentRecords, ...xiaTangAssets];
    const unique = new Map(selected.map((asset) => [asset.id, asset]));
    return sha256([...unique.values()].sort((left, right) => left.id.localeCompare(right.id)).map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        title: asset.title,
        tags: asset.tags,
        category: asset.category,
        data: asset.data,
        metadata: asset.metadata,
    })));
}

export async function buildXiajiAgentProjectContext(assets: Asset[], projectAssetId: string, episodeAssetId?: string): Promise<Record<string, unknown>> {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const project = byId.get(projectAssetId);
    const projectRecord = project ? getLocalStudioRecord(project) : null;
    if (!project || projectRecord?.recordType !== "project") throw new Error("找不到指定的虾料本地项目");
    const source = projectRecord.sourceAssetId ? byId.get(projectRecord.sourceAssetId) : undefined;
    if (!source || source.kind !== "text" || source.metadata?.localStudioSource === undefined) throw new Error("本地项目原稿缺失或关联无效");
    const episodes = assets.filter((asset) => {
        const record = getLocalStudioRecord(asset);
        return record?.recordType === "episode" && record.projectAssetId === projectAssetId && (!episodeAssetId || asset.id === episodeAssetId);
    }).sort((left, right) => {
        const a = getLocalStudioRecord(left);
        const b = getLocalStudioRecord(right);
        return (a?.recordType === "episode" ? a.order : 0) - (b?.recordType === "episode" ? b.order : 0) || left.id.localeCompare(right.id);
    });
    if (episodeAssetId && !episodes.some((episode) => episode.id === episodeAssetId)) throw new Error("指定分集不存在或不属于当前项目");
    const episodeContexts = episodes.map((episode) => {
        const record = getLocalStudioRecord(episode);
        if (record?.recordType !== "episode") return null;
        const linkedScript = record.scriptAssetId ? byId.get(record.scriptAssetId) : undefined;
        const linkedScriptRecord = linkedScript ? getLocalStudioRecord(linkedScript) : null;
        const script = linkedScriptRecord?.recordType === "script" && linkedScriptRecord.projectAssetId === projectAssetId
            && linkedScriptRecord.episodeAssetId === episode.id && linkedScriptRecord.approvalState !== "superseded" && linkedScript?.kind === "text"
            ? { assetId: linkedScript.id, title: linkedScript.title, version: linkedScriptRecord.version || 1, content: linkedScript.data.content }
            : null;
        const beats = listCurrentLocalStudioBeats(assets, episode.id).flatMap((beat) => {
            const beatRecord = getLocalStudioRecord(beat);
            if (beatRecord?.recordType !== "beat" || beat.kind !== "text") return [];
            return [{ assetId: beat.id, sourceKey: beatRecord.sourceKey, order: beatRecord.order, version: beatRecord.version || 1, title: beat.title, content: beat.data.content, dialogueText: beatRecord.dialogueText, referencedAssetIds: beatRecord.referencedAssetIds }];
        });
        return {
            assetId: episode.id,
            order: record.order,
            title: record.title,
            synopsis: record.synopsis || "",
            script,
            beats,
        };
    }).filter(Boolean);
    const xiaTangAssets = listXiaTangProjectAssets(assets, projectAssetId).flatMap((asset) => {
        const record = getXiaTangRecord(asset);
        if (!record) return [];
        return [{
            assetId: asset.id,
            kind: asset.kind,
            title: asset.title,
            domain: record.domain,
            recordType: record.recordType,
            parentId: record.parentId,
            slot: record.slot,
            versionOf: record.versionOf,
            fields: publicFields(record.fields),
            media: asset.kind === "text" ? undefined : {
                mimeType: asset.data.mimeType,
                width: asset.kind === "image" ? asset.data.width : undefined,
                height: asset.kind === "image" ? asset.data.height : undefined,
                bytes: asset.kind === "image" ? asset.data.bytes : undefined,
            },
        }];
    });
    return {
        projectAssetId,
        project: { title: project.title, projectType: projectRecord.projectType, baseStyle: projectRecord.baseStyle },
        originalAssetId: source.id,
        originalTitle: source.title,
        originalText: source.data.content,
        episodes: episodeContexts,
        xiaTangAssets,
        baseRevision: await createXiajiArtifactBaseRevision(assets, projectAssetId, episodeAssetId),
    };
}

export function buildXiajiArtifactReview(value: unknown): {
    stageLabel: string;
    artifacts: Array<{ sourceKey: string; kind: string; title: string; content: string; metadata: Record<string, unknown> }>;
    relations: Array<{ from: string; type: string; to: string }>;
    mediaAssetIds: string[];
} {
    const pkg = isRecord(value) ? value : {};
    const stageLabels: Record<string, string> = {
        "project-outline": "项目分集结构",
        script: "单集剧本",
        "production-breakdown": "镜头拆解",
        "asset-references": "镜头素材关联",
    };
    const artifacts = Array.isArray(pkg.artifacts) ? pkg.artifacts.flatMap((item) => {
        if (!isRecord(item) || typeof item.sourceKey !== "string" || typeof item.kind !== "string" || typeof item.title !== "string") return [];
        return [{
            sourceKey: item.sourceKey,
            kind: item.kind,
            title: item.title,
            content: typeof item.content === "string" ? item.content : "",
            metadata: isRecord(item.metadata) ? item.metadata : {},
        }];
    }) : [];
    const relations = Array.isArray(pkg.relations) ? pkg.relations.flatMap((item) => {
        if (!isRecord(item) || typeof item.from !== "string" || typeof item.type !== "string" || typeof item.to !== "string") return [];
        return [{ from: item.from, type: item.type, to: item.to }];
    }) : [];
    const mediaAssetIds = Array.isArray(pkg.mediaAssetIds)
        ? [...new Set(pkg.mediaAssetIds.filter((item): item is string => typeof item === "string" && item.length > 0))]
        : [];
    return { stageLabel: stageLabels[String(pkg.stage)] || "未知阶段", artifacts, relations, mediaAssetIds };
}

export async function validateXiajiArtifactPackage(
    assets: Asset[],
    canvas: { id: string; xiajiProjectAssetId?: string },
    value: Record<string, unknown>,
): Promise<XiajiArtifactValidation> {
    if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.packageId !== "string" || !value.packageId.trim()) {
        return { ok: false, code: "invalid-package", message: "Agent 产物包版本或 packageId 无效" };
    }
    if (typeof value.projectAssetId !== "string" || !value.projectAssetId.trim() || canvas.xiajiProjectAssetId !== value.projectAssetId) {
        return { ok: false, code: "project-binding-mismatch", message: "产物包项目与当前虾画绑定项目不一致" };
    }
    const project = assets.find((asset) => asset.id === value.projectAssetId);
    if (!isProjectAsset(project)) return { ok: false, code: "project-not-found", message: "找不到产物包所属的本地虾料项目" };
    if (!Array.isArray(value.artifacts) || !Array.isArray(value.relations) || !Array.isArray(value.mediaAssetIds)) {
        return { ok: false, code: "invalid-package", message: "产物、关系或媒体引用必须为数组" };
    }
    if (!Array.isArray(value.mediaAssetIds) || value.mediaAssetIds.some((id) => typeof id !== "string")) {
        return { ok: false, code: "invalid-package", message: "媒体引用只能包含本地素材 ID" };
    }
    if (typeof value.baseRevision !== "string" || !SHA256.test(value.baseRevision) || typeof value.contentDigest !== "string" || !SHA256.test(value.contentDigest)) {
        return { ok: false, code: "invalid-digest", message: "产物包缺少有效的 SHA-256 版本摘要" };
    }
    const calculatedDigest = await createXiajiArtifactContentDigest(value);
    if (calculatedDigest !== value.contentDigest) return { ok: false, code: "content-digest-mismatch", message: "产物包正文与 contentDigest 不一致" };
    if (containsForbiddenMetadata(value.artifacts)) return { ok: false, code: "external-media-reference", message: "产物包不能包含 URL、路径、Base64 或存储键；媒体仅能通过本地素材 ID 引用" };

    const stage = value.stage;
    if (!["project-outline", "script", "production-breakdown", "asset-references"].includes(String(stage))) {
        return { ok: false, code: "invalid-stage", message: "产物阶段无效" };
    }
    const episodeAssetId = typeof value.episodeAssetId === "string" ? value.episodeAssetId : "";
    if (stage !== "project-outline") {
        const episode = assets.find((asset) => asset.id === episodeAssetId);
        const record = episode ? getLocalStudioRecord(episode) : null;
        if (record?.recordType !== "episode" || record.projectAssetId !== project.id) {
            return { ok: false, code: "episode-project-mismatch", message: "产物包分集不存在或不属于当前项目" };
        }
    } else if (episodeAssetId) {
        return { ok: false, code: "invalid-stage", message: "项目结构产物不能绑定到单一分集" };
    }

    const allowedKinds: Record<XiajiArtifactStage, XiajiArtifactKind[]> = {
        "project-outline": ["episode"],
        script: ["script"],
        "production-breakdown": ["beat"],
        "asset-references": ["asset-reference", "media-reference"],
    };
    const artifacts = value.artifacts as Array<Record<string, unknown>>;
    if (artifacts.some((artifact) => !isRecord(artifact) || !allowedKinds[stage as XiajiArtifactStage].includes(artifact.kind as XiajiArtifactKind)
        || typeof artifact.sourceKey !== "string" || !artifact.sourceKey.trim() || typeof artifact.title !== "string" || !artifact.title.trim()
        || (artifact.content !== undefined && typeof artifact.content !== "string") || (artifact.metadata !== undefined && !isRecord(artifact.metadata)))) {
        return { ok: false, code: "invalid-artifact", message: "产物类型、sourceKey、标题或 metadata 与阶段不匹配" };
    }
    if (artifacts.length === 0 || new Set(artifacts.map((artifact) => artifact.sourceKey)).size !== artifacts.length) {
        return { ok: false, code: "duplicate-source-key", message: "产物不能为空，且 sourceKey 必须唯一" };
    }
    if (stage === "script" && (artifacts.length !== 1 || typeof artifacts[0].content !== "string" || !artifacts[0].content.trim())) {
        return { ok: false, code: "invalid-script", message: "剧本阶段必须且只能包含一份非空剧本文本" };
    }
    if (stage === "production-breakdown") {
        const orders = artifacts.map((artifact) => isRecord(artifact.metadata) ? artifact.metadata.order : undefined);
        if (orders.some((order) => !Number.isSafeInteger(order) || Number(order) <= 0) || new Set(orders).size !== orders.length) {
            return { ok: false, code: "invalid-beat-order", message: "镜头必须有不重复的正整数 order" };
        }
        if (artifacts.some((artifact) => typeof artifact.content !== "string" || !artifact.content.trim())) {
            return { ok: false, code: "invalid-beat", message: "每个镜头都必须包含非空画面描述" };
        }
    }
    if (stage === "project-outline") {
        const orders = artifacts.map((artifact) => isRecord(artifact.metadata) ? artifact.metadata.order : undefined);
        const existingOrders = new Set(assets.flatMap((asset) => {
            const record = getLocalStudioRecord(asset);
            return record?.recordType === "episode" && record.projectAssetId === project.id ? [record.order] : [];
        }));
        if (orders.some((order) => !Number.isSafeInteger(order) || Number(order) <= 0 || existingOrders.has(Number(order)))
            || new Set(orders).size !== orders.length) {
            return { ok: false, code: "invalid-episode-order", message: "新分集必须提供未占用的正整数 order" };
        }
    }

    const projectIds = projectAssetIds(assets, project.id);
    const mediaIds = new Set<string>();
    for (const assetId of value.mediaAssetIds as string[]) {
        const media = assets.find((asset) => asset.id === assetId);
        if (!media || !["image", "audio", "video"].includes(media.kind) || !projectIds.has(assetId)) {
            return { ok: false, code: "invalid-media-reference", message: `媒体引用不存在、不属于当前项目或不是本地媒体：${assetId}` };
        }
        mediaIds.add(assetId);
    }
    if (stage === "production-breakdown") {
        for (const artifact of artifacts) {
            const references = isRecord(artifact.metadata) ? artifact.metadata.referencedAssetIds : undefined;
            if (references !== undefined && (!Array.isArray(references) || references.some((id) => typeof id !== "string" || !projectIds.has(id)))) {
                return { ok: false, code: "foreign-asset-reference", message: `镜头 ${artifact.sourceKey} 引用了缺失或非本项目素材` };
            }
        }
    }
    if (stage === "asset-references" && artifacts.some((artifact) => {
        const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
        const assetId = typeof metadata.assetId === "string" ? metadata.assetId : "";
        const beat = typeof metadata.beatAssetId === "string"
            ? assets.find((asset) => asset.id === metadata.beatAssetId)
            : assets.find((asset) => {
                  const record = getLocalStudioRecord(asset);
                  return record?.recordType === "beat" && record.sourceKey === metadata.beatSourceKey;
              });
        const beatRecord = beat ? getLocalStudioRecord(beat) : null;
        const linkedAsset = assets.find((asset) => asset.id === assetId);
        return !assetId || !projectIds.has(assetId) || !beat || beatRecord?.recordType !== "beat" || beatRecord.projectAssetId !== project.id
            || beatRecord.episodeAssetId !== episodeAssetId || beatRecord.approvalState === "superseded"
            || (artifact.kind === "media-reference" && (!linkedAsset || !["image", "audio", "video"].includes(linkedAsset.kind)));
    })) {
        return { ok: false, code: "foreign-asset-reference", message: "关联必须同时指向当前分集的有效镜头和项目内已有素材" };
    }

    const sourceKeys = new Set(artifacts.map((artifact) => String(artifact.sourceKey)));
    const knownEndpoints = new Set([...sourceKeys, ...projectIds, ...mediaIds]);
    if (value.relations.some((relation) => !isRecord(relation) || typeof relation.from !== "string" || !knownEndpoints.has(relation.from)
        || typeof relation.to !== "string" || !knownEndpoints.has(relation.to) || typeof relation.type !== "string" || !relation.type.trim())) {
        return { ok: false, code: "relationship-closure", message: "产物关系包含包外节点或未知本地素材" };
    }

    const baseRevision = await createXiajiArtifactBaseRevision(assets, project.id, episodeAssetId || undefined);
    if (baseRevision !== value.baseRevision) return { ok: false, code: "stale-base", message: "项目、分集、当前版本或素材在 Agent 读取后已变化；请重新读取并生成产物包", baseRevision };
    return { ok: true, baseRevision, package: value as unknown as XiajiArtifactPackage };
}

function handoffKey(handoff: XiajiArtifactHandoff): string {
    return `${HANDOFF_PREFIX}${encodeURIComponent([handoff.projectAssetId, handoff.canvasId, handoff.packageId, handoff.contentDigest].join("|"))}`;
}

function readStoredHandoff(storage: XiajiArtifactStorage, key: string): XiajiArtifactHandoff | null {
    try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed) || parsed.key !== key || typeof parsed.projectAssetId !== "string" || typeof parsed.packageId !== "string") return null;
        return parsed as unknown as XiajiArtifactHandoff;
    } catch {
        return null;
    }
}

export function writeXiajiArtifactHandoff(storage: XiajiArtifactStorage, value: Record<string, unknown>): { ok: boolean; code?: string; message?: string; replayed?: boolean; key?: string } {
    if (typeof value.projectAssetId !== "string" || typeof value.canvasId !== "string" || typeof value.packageId !== "string" || typeof value.contentDigest !== "string") {
        return { ok: false, code: "invalid-handoff", message: "交接记录缺少项目、画布或包身份" };
    }
    const handoff = value as unknown as XiajiArtifactHandoff;
    const key = handoffKey(handoff);
    try {
        for (let index = 0; index < storage.length; index += 1) {
            const storedKey = storage.key(index);
            if (!storedKey?.startsWith(HANDOFF_PREFIX)) continue;
            const existing = readStoredHandoff(storage, storedKey);
            if (!existing || existing.packageId !== handoff.packageId) continue;
            if (existing.contentDigest !== handoff.contentDigest || existing.projectAssetId !== handoff.projectAssetId || existing.canvasId !== handoff.canvasId) {
                return { ok: false, code: "package-id-conflict", message: "packageId 已用于其他内容或目标项目；交接未覆盖" };
            }
            return { ok: true, replayed: true, key: storedKey };
        }
    } catch {
        return { ok: false, code: "session-storage-unavailable", message: "浏览器会话存储不可读取；交接包没有写入。请导出完整 JSON 并在虾镜页面导入" };
    }
    const stored = { ...handoff, key };
    try {
        storage.setItem(key, JSON.stringify(stored));
        if (storage.getItem(key) !== JSON.stringify(stored)) return { ok: false, code: "handoff-unconfirmed", message: "浏览器未能回读完整 Agent 交接包" };
        return { ok: true, key };
    } catch {
        return { ok: false, code: "session-storage-quota", message: "浏览器会话空间不足或不可用；没有截断交接包。请导出完整 JSON 并在虾镜页面导入" };
    }
}

export function readXiajiArtifactHandoffs(storage: XiajiArtifactStorage, projectAssetId: string): { items: Array<Record<string, unknown>>; issues: string[] } {
    const items: Array<Record<string, unknown>> = [];
    const issues: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(HANDOFF_PREFIX)) continue;
        const handoff = readStoredHandoff(storage, key);
        if (!handoff) {
            issues.push(`无法读取交接记录：${key}`);
            continue;
        }
        if (handoff.projectAssetId === projectAssetId) items.push(handoff as unknown as Record<string, unknown>);
    }
    return { items, issues };
}

export function removeXiajiArtifactHandoff(storage: XiajiArtifactStorage, key: string): void {
    if (key.startsWith(HANDOFF_PREFIX)) storage.removeItem(key);
}
