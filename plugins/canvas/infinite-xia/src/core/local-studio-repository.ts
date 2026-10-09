// SPDX-License-Identifier: AGPL-3.0-or-later

import { nanoid } from "nanoid";

import type { Asset } from "./asset-types";
import { createLocalStudioAssetInput, getLocalStudioRecord, listCurrentLocalStudioBeats, listLocalStudioPrompts, patchLocalStudioRecord, validateLocalStudioAssetCollection, type LocalStudioRecord } from "./local-studio-model";
import { createXiajiArtifactAssetId, createXiajiArtifactCommitId, createXiajiArtifactContentDigest, validateXiajiArtifactPackage, type XiajiArtifactPackage } from "./xiaji-artifact-package";

export type CreateLocalStudioProjectInput = {
    title: string;
    projectType: string;
    baseStyle: string;
    sourceText: string;
    sourceName?: string;
    episodes?: Array<{ title: string; order: number; synopsis?: string; sourceEpisodeNumber?: number }>;
};

export type CreateLocalStudioEpisodeInput = {
    projectAssetId: string;
    title: string;
    order: number;
    sourceEpisodeNumber?: number;
    synopsis?: string;
};

export type UpdateLocalStudioEpisodeInput = {
    projectAssetId: string;
    episodeAssetId: string;
    title: string;
    synopsis: string;
};

export type SaveLocalStudioScriptInput = {
    projectAssetId: string;
    episodeAssetId: string;
    content: string;
    documentKind?: "script" | "structure";
};

export type CreateLocalStudioBeatInput = {
    projectAssetId: string;
    episodeAssetId: string;
    shotId?: string;
    order: number;
    content: string;
    title?: string;
    sourceBeatNumber?: number;
    dialogueText?: string;
    referencedAssetIds: string[];
};

export type UpdateLocalStudioBeatInput = {
    projectAssetId: string;
    episodeAssetId: string;
    shotId?: string;
    beatAssetId: string;
    title: string;
    content: string;
    dialogueText?: string;
    referencedAssetIds: string[];
};

export type SaveLocalStudioPromptInput = {
    projectAssetId: string;
    episodeAssetId: string;
    shotId: string;
    beatAssetId?: string;
    imagePrompt?: string;
    videoPrompt?: string;
    sourceRevision?: string;
};

export type LocalStudioRepositoryDependencies = {
    getAssets: () => Asset[];
    saveAssetsAndWait: (assets: Asset[]) => Promise<Asset[]>;
    readCanonicalAssets?: () => Promise<Asset[]>;
    idFactory?: () => string;
    now?: () => string;
};

export type LocalStudioProjectCreateAttempt = {
    schemaVersion: 1;
    commitId: string;
    payloadDigest: string;
    projectAssetId: string;
    sourceAssetId: string;
    episodeAssetIds: string[];
    timestamp: string;
    input: CreateLocalStudioProjectInput;
    assets: Asset[];
};

export class LocalStudioProjectCreateOutcomeUnknownError extends Error {
    readonly code = "project-create-outcome-unknown";

    constructor(readonly attempt: LocalStudioProjectCreateAttempt, message: string) {
        super(message);
        this.name = "LocalStudioProjectCreateOutcomeUnknownError";
    }
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? "null" : stableJson(item)).join(",")}]`;
    if (value && typeof value === "object") {
        const entries = Object.entries(value).filter(([, item]) => item !== undefined);
        return `{${entries.sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "undefined";
}

function sameSavedPayload(expected: Asset, actual: Asset): boolean {
    const comparable = (asset: Asset) => ({
        id: asset.id,
        kind: asset.kind,
        title: asset.title,
        coverUrl: asset.coverUrl,
        tags: asset.tags,
        category: asset.category,
        source: asset.source,
        data: asset.data,
        metadata: asset.metadata,
    });
    return stableJson(comparable(expected)) === stableJson(comparable(actual));
}

function makeAsset(input: Omit<Asset, "id" | "createdAt" | "updatedAt">, id: string, timestamp: string): Asset {
    return { ...input, id, createdAt: timestamp, updatedAt: timestamp } as Asset;
}

function issueMessage(code: string): string {
    switch (code) {
        case "duplicate-episode-order": return "分集序号重复";
        case "duplicate-beat-order": return "镜头序号重复";
        case "missing-project": return "分集所属项目不存在";
        case "missing-episode": return "镜头所属分集不存在";
        case "missing-source-material": return "项目原始剧本素材不存在";
        case "missing-referenced-asset": return "关联素材不存在";
        default: return "本地项目关系无效";
    }
}

function recordOrder(asset: Asset, recordType: "episode" | "beat"): number {
    const record = getLocalStudioRecord(asset);
    return record?.recordType === recordType ? record.order : 0;
}

function commitMarker(asset: Asset): Record<string, unknown> | null {
    const marker = asset.metadata?.localStudioCommit;
    return marker && typeof marker === "object" && !Array.isArray(marker) ? marker as Record<string, unknown> : null;
}

export function createLocalStudioRepository(dependencies: LocalStudioRepositoryDependencies) {
    const idFactory = dependencies.idFactory || nanoid;
    const now = dependencies.now || (() => new Date().toISOString());

    async function persistNewRecord(title: string, content: string, record: LocalStudioRecord): Promise<Asset> {
        const timestamp = now();
        const asset = makeAsset(createLocalStudioAssetInput(title, content, record), idFactory(), timestamp);
        const snapshot = [asset, ...dependencies.getAssets()];
        const issues = validateLocalStudioAssetCollection(snapshot).issues;
        if (issues.length) throw new Error(issueMessage(issues[0].code));

        const canonical = await dependencies.saveAssetsAndWait(snapshot);
        const saved = canonical.find((item) => item.id === asset.id);
        if (!saved || !sameSavedPayload(asset, saved)) throw new Error("本地保存响应与提交内容不一致");
        return saved;
    }

    return {
        listProjects() {
            return dependencies.getAssets()
                .filter((asset) => getLocalStudioRecord(asset)?.recordType === "project")
                .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
        },
        listEpisodes(projectAssetId: string) {
            return dependencies.getAssets()
                .filter((asset) => {
                    const record = getLocalStudioRecord(asset);
                    return record?.recordType === "episode" && record.projectAssetId === projectAssetId;
                })
                .sort((left, right) => recordOrder(left, "episode") - recordOrder(right, "episode"));
        },
        listBeats(episodeAssetId: string) {
            return listCurrentLocalStudioBeats(dependencies.getAssets(), episodeAssetId);
        },
        listPrompts(shotId: string) {
            return listLocalStudioPrompts(dependencies.getAssets(), shotId);
        },
        async selectPromptRevision(input: { beatAssetId: string; promptAssetId: string }): Promise<Asset> {
            const assets = dependencies.getAssets();
            const beat = assets.find((asset) => asset.id === input.beatAssetId);
            const prompt = assets.find((asset) => asset.id === input.promptAssetId);
            const beatRecord = beat ? getLocalStudioRecord(beat) : null;
            const promptRecord = prompt ? getLocalStudioRecord(prompt) : null;
            if (beatRecord?.recordType !== "beat" || promptRecord?.recordType !== "prompt"
                || beatRecord.shotId !== promptRecord.shotId
                || beatRecord.episodeAssetId !== promptRecord.episodeAssetId
                || beatRecord.projectAssetId !== promptRecord.projectAssetId) {
                throw new Error("提示词修订不属于当前镜头");
            }
            const updated = { ...patchLocalStudioRecord(beat, { currentPromptAssetId: prompt.id }), updatedAt: now() } as Asset;
            const snapshot = assets.map((asset) => asset.id === beat.id ? updated : asset);
            const issues = validateLocalStudioAssetCollection(snapshot).issues;
            if (issues.length) throw new Error(issueMessage(issues[0].code));
            const canonical = await dependencies.saveAssetsAndWait(snapshot);
            const saved = canonical.find((asset) => asset.id === beat.id);
            const savedRecord = saved ? getLocalStudioRecord(saved) : null;
            if (savedRecord?.recordType !== "beat" || savedRecord.currentPromptAssetId !== prompt.id) {
                throw new Error("本地保存响应未确认当前提示词修订关系");
            }
            return saved;
        },
        getSourceText(projectAssetId: string): string | null {
            const project = dependencies.getAssets().find((asset) => asset.id === projectAssetId);
            const record = project ? getLocalStudioRecord(project) : null;
            if (record?.recordType !== "project" || !record.sourceAssetId) return null;
            const source = dependencies.getAssets().find((asset) => asset.id === record.sourceAssetId);
            return source?.kind === "text" ? source.data.content : null;
        },
        async prepareProjectCreation(input: CreateLocalStudioProjectInput): Promise<LocalStudioProjectCreateAttempt> {
            const normalizedInput: CreateLocalStudioProjectInput = {
                title: input.title.trim(),
                projectType: input.projectType.trim(),
                baseStyle: input.baseStyle.trim(),
                sourceText: input.sourceText,
                sourceName: input.sourceName?.trim() || undefined,
                episodes: (input.episodes || []).map((episode) => ({ ...episode, title: episode.title.trim() })),
            };
            if (!normalizedInput.title || !normalizedInput.sourceText.trim()) throw new Error("项目名称和原始剧本不能为空");
            if (!normalizedInput.projectType || !normalizedInput.baseStyle) throw new Error("项目类型与基础风格不能为空");

            const existingIds = new Set(dependencies.getAssets().map((asset) => asset.id));
            const newIds = new Set<string>();
            const nextId = () => {
                const id = idFactory();
                if (!id || existingIds.has(id) || newIds.has(id)) throw new Error("本地素材 ID 冲突，请重试");
                newIds.add(id);
                return id;
            };
            const projectAssetId = nextId();
            const sourceAssetId = nextId();
            const episodeAssetIds = normalizedInput.episodes!.map(() => nextId());
            const timestamp = now();
            const projectRecord: LocalStudioRecord = {
                schemaVersion: 1,
                recordType: "project",
                projectType: normalizedInput.projectType,
                baseStyle: normalizedInput.baseStyle,
                sourceAssetId,
            };
            const project = makeAsset(createLocalStudioAssetInput(normalizedInput.title, "", projectRecord), projectAssetId, timestamp);
            const source = makeAsset({
                kind: "text",
                title: normalizedInput.sourceName || `${normalizedInput.title} · 原始剧本`,
                coverUrl: "",
                tags: [],
                category: "xiaji:source",
                source: "虾料导入",
                data: { content: normalizedInput.sourceText },
                metadata: { localStudioSource: { projectAssetId, sourceType: "manuscript" } },
            } as Omit<Asset, "id" | "createdAt" | "updatedAt">, sourceAssetId, timestamp);
            const episodes = normalizedInput.episodes!.map((episodeInput, index) => {
                if (!episodeInput.title) throw new Error("分集标题不能为空");
                return makeAsset(createLocalStudioAssetInput(episodeInput.title, episodeInput.synopsis || "", {
                    schemaVersion: 1,
                    recordType: "episode",
                    projectAssetId,
                    order: episodeInput.order,
                    sourceEpisodeNumber: episodeInput.sourceEpisodeNumber,
                    title: episodeInput.title,
                    synopsis: episodeInput.synopsis,
                }), episodeAssetIds[index], timestamp);
            });
            const initialAssets = [project, source, ...episodes];
            const payloadDigest = await createXiajiArtifactContentDigest({
                projectAssetId, sourceAssetId, episodeAssetIds, timestamp, input: normalizedInput,
                assets: initialAssets.map((asset) => ({ id: asset.id, title: asset.title, kind: asset.kind, category: asset.category, source: asset.source, data: asset.data, metadata: asset.metadata })),
            });
            const commitId = `xiaji-project-create-${projectAssetId}`;
            const marker = { commitId, payloadDigest, assetIds: [projectAssetId, sourceAssetId, ...episodeAssetIds] };
            const attemptAssets = initialAssets.map((asset) => ({
                ...asset,
                metadata: { ...asset.metadata, localStudioCommit: marker },
            } as Asset));
            const attempt: LocalStudioProjectCreateAttempt = {
                schemaVersion: 1, commitId, payloadDigest, projectAssetId, sourceAssetId, episodeAssetIds,
                timestamp, input: normalizedInput, assets: attemptAssets,
            };
            const issues = validateLocalStudioAssetCollection([...attemptAssets, ...dependencies.getAssets()]).issues;
            if (issues.length) throw new Error(issueMessage(issues[0].code));
            return attempt;
        },
        async commitProjectCreation(attempt: LocalStudioProjectCreateAttempt): Promise<{ project: Asset; source: Asset; episodes: Asset[] }> {
            if (!attempt || attempt.schemaVersion !== 1 || !Array.isArray(attempt.assets) || !Array.isArray(attempt.episodeAssetIds)
                || attempt.commitId !== `xiaji-project-create-${attempt.projectAssetId}`
                || typeof attempt.payloadDigest !== "string" || attempt.assets.length !== 2 + attempt.episodeAssetIds.length) {
                throw new Error("本地项目保存尝试记录无效");
            }
            const expectedIds = [attempt.projectAssetId, attempt.sourceAssetId, ...attempt.episodeAssetIds];
            const marker = { commitId: attempt.commitId, payloadDigest: attempt.payloadDigest, assetIds: expectedIds };
            if (attempt.assets.some((asset, index) => asset.id !== expectedIds[index]
                || stableJson(asset.metadata?.localStudioCommit) !== stableJson(marker))) {
                throw new Error("本地项目保存尝试的 ID 或提交标记不一致");
            }
            const initialAssets = attempt.assets.map((asset) => {
                const metadata = { ...asset.metadata };
                delete metadata.localStudioCommit;
                return { ...asset, metadata } as Asset;
            });
            const calculatedDigest = await createXiajiArtifactContentDigest({
                projectAssetId: attempt.projectAssetId, sourceAssetId: attempt.sourceAssetId, episodeAssetIds: attempt.episodeAssetIds,
                timestamp: attempt.timestamp, input: attempt.input,
                assets: initialAssets.map((asset) => ({ id: asset.id, title: asset.title, kind: asset.kind, category: asset.category, source: asset.source, data: asset.data, metadata: asset.metadata })),
            });
            if (calculatedDigest !== attempt.payloadDigest) throw new Error("本地项目保存尝试内容摘要无效");
            const issues = validateLocalStudioAssetCollection([...attempt.assets, ...dependencies.getAssets()]).issues;
            if (issues.length) throw new Error(issueMessage(issues[0].code));

            const readCanonical = async () => dependencies.readCanonicalAssets ? dependencies.readCanonicalAssets() : dependencies.getAssets();
            const reconcile = (canonical: Asset[]) => {
                const found = attempt.assets.map((expected) => canonical.find((asset) => asset.id === expected.id));
                const commitMatches = found.map((asset) => asset && stableJson(asset.metadata?.localStudioCommit) === stableJson(marker));
                const payloadMatches = found.map((asset, index) => Boolean(asset && sameSavedPayload(attempt.assets[index], asset)));
                if (found.every(Boolean) && commitMatches.every(Boolean) && payloadMatches.every(Boolean)) {
                    return { status: "committed" as const, result: {
                        project: found[0]!, source: found[1]!, episodes: found.slice(2) as Asset[],
                    } };
                }
                if (found.some(Boolean) || canonical.some((asset) => stableJson(asset.metadata?.localStudioCommit) === stableJson(marker))) {
                    return { status: "conflict" as const };
                }
                return { status: "absent" as const };
            };

            let beforeSave: Asset[];
            try {
                beforeSave = await readCanonical();
            } catch (cause) {
                throw new Error(`尚未开始保存：无法读取本地素材库以核验旧提交。${cause instanceof Error ? ` ${cause.message}` : ""}`);
            }
            const existing = reconcile(beforeSave);
            if (existing.status === "committed") return existing.result;
            if (existing.status === "conflict") throw new LocalStudioProjectCreateOutcomeUnknownError(attempt, "发现相同固定 ID 的不完整或不同内容；保存状态待核验，不能另建项目副本");

            const snapshot = [...attempt.assets, ...dependencies.getAssets()];
            let returnedCanonical: Asset[] | null = null;
            let saveError: unknown;
            try {
                returnedCanonical = await dependencies.saveAssetsAndWait(snapshot);
            } catch (cause) {
                saveError = cause;
            }
            if (returnedCanonical) {
                const returned = reconcile(returnedCanonical);
                if (returned.status === "committed") return returned.result;
            }
            try {
                const probedCanonical = await readCanonical();
                const probed = reconcile(probedCanonical);
                if (probed.status === "committed") return probed.result;
                throw new LocalStudioProjectCreateOutcomeUnknownError(attempt,
                    probed.status === "conflict"
                        ? "本地项目保存后读回了部分或不一致记录；已保留原提交 ID，刷新或重试时会继续核验，不会新建副本"
                        : "本地项目保存结果暂时无法确认；已保留固定提交 ID 与原稿，可使用同一提交重试核验，不会新建副本");
            } catch (cause) {
                if (cause instanceof LocalStudioProjectCreateOutcomeUnknownError) throw cause;
                throw new LocalStudioProjectCreateOutcomeUnknownError(attempt,
                    `本地项目保存结果暂时无法确认；原稿与固定提交仍保留待核验。${saveError instanceof Error ? ` 保存响应：${saveError.message}。` : ""}${cause instanceof Error ? ` 回读：${cause.message}` : ""}`);
            }
        },
        async createProject(input: CreateLocalStudioProjectInput): Promise<{ project: Asset; source: Asset; episodes: Asset[] }> {
            const attempt = await this.prepareProjectCreation(input);
            return this.commitProjectCreation(attempt);
        },
        async createEpisode(input: CreateLocalStudioEpisodeInput): Promise<Asset> {
            const title = input.title.trim();
            if (!title) throw new Error("分集标题不能为空");
            return persistNewRecord(title, input.synopsis || "", {
                schemaVersion: 1,
                recordType: "episode",
                projectAssetId: input.projectAssetId,
                order: input.order,
                sourceEpisodeNumber: input.sourceEpisodeNumber,
                title,
                synopsis: input.synopsis,
            });
        },
        async updateEpisode(input: UpdateLocalStudioEpisodeInput): Promise<Asset> {
            const title = input.title.trim();
            if (!title) throw new Error("分集标题不能为空");
            const existing = dependencies.getAssets().find((asset) => asset.id === input.episodeAssetId);
            const record = existing ? getLocalStudioRecord(existing) : null;
            if (!existing || record?.recordType !== "episode" || record.projectAssetId !== input.projectAssetId) {
                throw new Error("分集不存在或不属于当前项目");
            }
            const nextRecord = patchLocalStudioRecord(existing, { title, synopsis: input.synopsis });
            const updated = { ...nextRecord, title, data: { content: input.synopsis }, updatedAt: now() } as Asset;
            const snapshot = dependencies.getAssets().map((asset) => asset.id === existing.id ? updated : asset);
            const issues = validateLocalStudioAssetCollection(snapshot).issues;
            if (issues.length) throw new Error(issueMessage(issues[0].code));
            const canonical = await dependencies.saveAssetsAndWait(snapshot);
            const saved = canonical.find((asset) => asset.id === updated.id);
            if (!saved || !sameSavedPayload(updated, saved)) throw new Error("本地保存响应未确认分集内容");
            return saved;
        },
        async reorderEpisodes(projectAssetId: string, orderedEpisodeAssetIds: string[]): Promise<Asset[]> {
            const allEpisodes = dependencies.getAssets().filter((asset) => {
                const record = getLocalStudioRecord(asset);
                return record?.recordType === "episode" && record.projectAssetId === projectAssetId;
            });
            const selected = new Set(orderedEpisodeAssetIds);
            if (orderedEpisodeAssetIds.length !== allEpisodes.length || selected.size !== allEpisodes.length
                || allEpisodes.some((episode) => !selected.has(episode.id))) {
                throw new Error("必须包含项目中的全部分集且不能重复");
            }
            const byId = new Map(allEpisodes.map((episode) => [episode.id, episode]));
            const timestamp = now();
            const reordered = new Map(orderedEpisodeAssetIds.map((id, index) => {
                const episode = byId.get(id)!;
                return [id, { ...patchLocalStudioRecord(episode, { order: index + 1 }), updatedAt: timestamp } as Asset];
            }));
            const snapshot = dependencies.getAssets().map((asset) => reordered.get(asset.id) || asset);
            const issues = validateLocalStudioAssetCollection(snapshot).issues;
            if (issues.length) throw new Error(issueMessage(issues[0].code));
            const canonical = await dependencies.saveAssetsAndWait(snapshot);
            const saved = orderedEpisodeAssetIds.map((id) => canonical.find((asset) => asset.id === id));
            if (saved.some((asset, index) => !asset || !sameSavedPayload(reordered.get(orderedEpisodeAssetIds[index])!, asset))) {
                throw new Error("本地保存响应未确认分集顺序");
            }
            return saved as Asset[];
        },
        async saveScript(input: SaveLocalStudioScriptInput): Promise<Asset> {
            if (!input.content.trim()) throw new Error("剧本内容不能为空；请先导入或粘贴 Agent 剧本");
            const episode = dependencies.getAssets().find((asset) => asset.id === input.episodeAssetId);
            const episodeRecord = episode ? getLocalStudioRecord(episode) : null;
            if (!episode || episodeRecord?.recordType !== "episode" || episodeRecord.projectAssetId !== input.projectAssetId) {
                throw new Error("分集不存在或不属于当前项目");
            }
            const existing = episodeRecord.scriptAssetId
                ? dependencies.getAssets().find((asset) => asset.id === episodeRecord.scriptAssetId)
                : undefined;
            const existingRecord = existing ? getLocalStudioRecord(existing) : null;
            if (existing && (existingRecord?.recordType !== "script" || existingRecord.episodeAssetId !== input.episodeAssetId)) {
                throw new Error("分集关联的剧本素材无效");
            }

            const timestamp = now();
            const documentKind = input.documentKind || "script";
            if (existing?.kind === "text" && existing.data.content === input.content && existingRecord?.documentKind === documentKind) return existing;

            const previousVersion = existingRecord?.recordType === "script" ? existingRecord.version || 1 : 0;
            const script = makeAsset(createLocalStudioAssetInput(`${episode.title} · ${documentKind === "script" ? "剧本" : "结构"}`, input.content, {
                    schemaVersion: 1,
                    recordType: "script",
                    projectAssetId: input.projectAssetId,
                    episodeAssetId: input.episodeAssetId,
                    documentKind,
                    version: previousVersion + 1,
                    supersedesAssetId: existing?.id,
                    approvalState: "approved",
                }), idFactory(), timestamp);
            const nextScript = { ...script, data: { content: input.content }, updatedAt: timestamp } as Asset;
            const superseded = existing && existingRecord?.recordType === "script"
                ? { ...patchLocalStudioRecord(existing, { approvalState: "superseded", supersededByAssetId: nextScript.id }), updatedAt: timestamp } as Asset
                : undefined;
            const nextEpisode = { ...patchLocalStudioRecord(episode, { scriptAssetId: nextScript.id }), updatedAt: timestamp } as Asset;
            const snapshot = dependencies.getAssets().map((asset) => asset.id === episode.id ? nextEpisode : asset.id === existing?.id ? superseded! : asset);
            snapshot.unshift(nextScript);
            const issues = validateLocalStudioAssetCollection(snapshot).issues;
            if (issues.length) throw new Error(issueMessage(issues[0].code));
            const canonical = await dependencies.saveAssetsAndWait(snapshot);
            const saved = canonical.find((asset) => asset.id === nextScript.id);
            if (!saved || !sameSavedPayload(nextScript, saved)) throw new Error("本地保存响应未确认剧本内容");
            const savedEpisode = canonical.find((asset) => asset.id === episode.id);
            const savedEpisodeRecord = savedEpisode ? getLocalStudioRecord(savedEpisode) : null;
            if (savedEpisodeRecord?.recordType !== "episode" || savedEpisodeRecord.scriptAssetId !== nextScript.id) {
                throw new Error("本地保存响应未确认分集关联的剧本素材");
            }
            return saved;
        },
        async createBeat(input: CreateLocalStudioBeatInput): Promise<Asset> {
            const assets = dependencies.getAssets();
            const episode = assets.find((asset) => asset.id === input.episodeAssetId);
            const episodeRecord = episode ? getLocalStudioRecord(episode) : null;
            if (!episode || episodeRecord?.recordType !== "episode" || episodeRecord.projectAssetId !== input.projectAssetId) {
                throw new Error("分集不存在或不属于当前项目");
            }
            const currentBeats = listCurrentLocalStudioBeats(assets, input.episodeAssetId);
            if (currentBeats.some((asset) => recordOrder(asset, "beat") === input.order)) throw new Error("同一分集的镜头序号重复");
            const title = input.title?.trim() || `镜头 ${input.order}`;
            const timestamp = now();
            const beatId = idFactory();
            if (!beatId || assets.some((asset) => asset.id === beatId)) throw new Error("本地素材 ID 冲突，请重试");
            const shotId = input.shotId || `shot-${beatId}`;
            const beat = makeAsset(createLocalStudioAssetInput(title, input.content, {
                schemaVersion: 1,
                recordType: "beat",
                projectAssetId: input.projectAssetId,
                episodeAssetId: input.episodeAssetId,
                shotId,
                order: input.order,
                sourceBeatNumber: input.sourceBeatNumber,
                dialogueText: input.dialogueText,
                referencedAssetIds: [...input.referencedAssetIds],
                version: 1,
                approvalState: "approved",
            }), beatId, timestamp);
            const nextEpisode = { ...patchLocalStudioRecord(episode, { currentBeatAssetIds: [...currentBeats.map((asset) => asset.id), beat.id] }), updatedAt: timestamp } as Asset;
            const snapshot = [beat, ...assets.map((asset) => asset.id === episode.id ? nextEpisode : asset)];
            const issues = validateLocalStudioAssetCollection(snapshot).issues;
            if (issues.length) throw new Error(issueMessage(issues[0].code));
            const canonical = await dependencies.saveAssetsAndWait(snapshot);
            const saved = canonical.find((asset) => asset.id === beat.id);
            if (!saved || !sameSavedPayload(beat, saved)) throw new Error("本地保存响应未确认镜头内容");
            const savedEpisode = canonical.find((asset) => asset.id === episode.id);
            const savedEpisodeRecord = savedEpisode ? getLocalStudioRecord(savedEpisode) : null;
            if (savedEpisodeRecord?.recordType !== "episode" || !savedEpisodeRecord.currentBeatAssetIds?.includes(beat.id)) {
                throw new Error("本地保存响应未确认分集关联的镜头素材");
            }
            return saved;
        },
        async updateBeat(input: UpdateLocalStudioBeatInput): Promise<Asset> {
            const assets = dependencies.getAssets();
            const existing = assets.find((asset) => asset.id === input.beatAssetId);
            const record = existing ? getLocalStudioRecord(existing) : null;
            if (!existing || record?.recordType !== "beat" || record.projectAssetId !== input.projectAssetId || record.episodeAssetId !== input.episodeAssetId) {
                throw new Error("镜头不存在或不属于当前项目与分集");
            }
            const episode = assets.find((asset) => asset.id === input.episodeAssetId);
            const episodeRecord = episode ? getLocalStudioRecord(episode) : null;
            if (!episode || episodeRecord?.recordType !== "episode" || episodeRecord.projectAssetId !== input.projectAssetId) {
                throw new Error("分集不存在或不属于当前项目");
            }
            const currentBeats = listCurrentLocalStudioBeats(assets, input.episodeAssetId);
            if (!currentBeats.some((beat) => beat.id === existing.id)) throw new Error("此镜头已被新版本替代，请刷新后编辑当前版本");
            const title = input.title.trim();
            if (!title || !input.content.trim()) throw new Error("镜头标题和描述不能为空");
            const referencedAssetIds = [...new Set(input.referencedAssetIds)];
            if (existing.kind === "text" && existing.title === title && existing.data.content === input.content && record.dialogueText === input.dialogueText
                && stableJson(record.referencedAssetIds) === stableJson(referencedAssetIds)) return existing;
            const timestamp = now();
            const updatedId = idFactory();
            if (!updatedId || assets.some((asset) => asset.id === updatedId)) throw new Error("本地素材 ID 冲突，请重试");
            const shotId = record.shotId || input.shotId || `shot-${existing.id}`;
            const nextRecord = {
                ...record,
                shotId,
                version: (record.version || 1) + 1,
                supersedesAssetId: existing.id,
                supersededByAssetId: undefined,
                approvalState: "approved" as const,
                dialogueText: input.dialogueText,
                referencedAssetIds,
            };
            const updated = makeAsset(createLocalStudioAssetInput(title, input.content, nextRecord), updatedId, timestamp);
            const superseded = { ...patchLocalStudioRecord(existing, { approvalState: "superseded", supersededByAssetId: updated.id }), updatedAt: timestamp } as Asset;
            const nextEpisodeIds = currentBeats.map((beat) => beat.id === existing.id ? updated.id : beat.id);
            const nextEpisode = { ...patchLocalStudioRecord(episode, { currentBeatAssetIds: nextEpisodeIds }), updatedAt: timestamp } as Asset;
            const snapshot = assets.map((asset) => asset.id === existing.id ? superseded : asset.id === episode.id ? nextEpisode : asset);
            snapshot.unshift(updated);
            const issues = validateLocalStudioAssetCollection(snapshot).issues;
            if (issues.length) throw new Error(issueMessage(issues[0].code));
            const canonical = await dependencies.saveAssetsAndWait(snapshot);
            const saved = canonical.find((asset) => asset.id === updated.id);
            if (!saved || !sameSavedPayload(updated, saved)) throw new Error("本地保存响应未确认镜头内容");
            const savedPrevious = canonical.find((asset) => asset.id === existing.id);
            const savedPreviousRecord = savedPrevious ? getLocalStudioRecord(savedPrevious) : null;
            if (savedPreviousRecord?.recordType !== "beat" || savedPreviousRecord.approvalState !== "superseded" || savedPreviousRecord.supersededByAssetId !== updated.id) {
                throw new Error("本地保存响应未确认旧镜头版本关系");
            }
            const savedEpisode = canonical.find((asset) => asset.id === episode.id);
            const savedEpisodeRecord = savedEpisode ? getLocalStudioRecord(savedEpisode) : null;
            if (savedEpisodeRecord?.recordType !== "episode" || !savedEpisodeRecord.currentBeatAssetIds?.includes(updated.id)
                || savedEpisodeRecord.currentBeatAssetIds.includes(existing.id)) {
                throw new Error("本地保存响应未确认分集关联的镜头素材");
            }
            return saved;
        },
        async savePromptRevision(input: SaveLocalStudioPromptInput): Promise<Asset> {
            const assets = dependencies.getAssets();
            const existingPrompts = listLocalStudioPrompts(assets, input.shotId);
            const version = existingPrompts.length + 1;
            const promptId = idFactory();
            const timestamp = now();
            const promptRecord: LocalStudioRecord = {
                schemaVersion: 1,
                recordType: "prompt",
                projectAssetId: input.projectAssetId,
                episodeAssetId: input.episodeAssetId,
                shotId: input.shotId,
                sourceRevision: input.sourceRevision,
                imagePrompt: input.imagePrompt || "",
                videoPrompt: input.videoPrompt || "",
                version,
                previousPromptAssetId: existingPrompts[0]?.id,
            };
            const promptAsset = makeAsset(
                createLocalStudioAssetInput(
                    `提示词修订 v${version}`,
                    JSON.stringify({ imagePrompt: input.imagePrompt || "", videoPrompt: input.videoPrompt || "" }),
                    promptRecord,
                ),
                promptId,
                timestamp,
            );
            let snapshot = [promptAsset, ...assets];
            if (input.beatAssetId) {
                const beat = assets.find((a) => a.id === input.beatAssetId);
                if (beat) {
                    const nextBeat = {
                        ...patchLocalStudioRecord(beat, { currentPromptAssetId: promptAsset.id, shotId: input.shotId }),
                        updatedAt: timestamp,
                    } as Asset;
                    snapshot = snapshot.map((a) => (a.id === beat.id ? nextBeat : a));
                }
            }
            const issues = validateLocalStudioAssetCollection(snapshot).issues;
            if (issues.length) throw new Error(issueMessage(issues[0].code));
            const canonical = await dependencies.saveAssetsAndWait(snapshot);
            const saved = canonical.find((a) => a.id === promptAsset.id);
            if (!saved || !sameSavedPayload(promptAsset, saved)) {
                throw new Error("本地保存响应未确认提示词修订内容");
            }
            return saved;
        },
        async commitXiajiArtifactPackage(pkg: XiajiArtifactPackage, canvas: { id: string; xiajiProjectAssetId?: string }, stagedAt: string): Promise<{ ok: true; committed: true; replayed: boolean; packageId: string; commitId: string; assetIds: string[]; assetIdsBySourceKey: Record<string, string> }> {
            const assets = dependencies.getAssets();
            if (!pkg || pkg.schemaVersion !== 1 || typeof pkg.packageId !== "string" || !pkg.packageId.trim()
                || typeof pkg.projectAssetId !== "string" || !pkg.projectAssetId.trim() || typeof pkg.contentDigest !== "string"
                || !Array.isArray(pkg.artifacts) || pkg.artifacts.length === 0
                || pkg.artifacts.some((artifact) => !artifact || typeof artifact.sourceKey !== "string" || !artifact.sourceKey.trim())
                || !Array.isArray(pkg.relations) || !Array.isArray(pkg.mediaAssetIds)) {
                throw new Error("Agent 产物包无效");
            }
            if (await createXiajiArtifactContentDigest(pkg as unknown as Record<string, unknown>) !== pkg.contentDigest) {
                throw new Error("Agent 产物包正文与 contentDigest 不一致");
            }
            const sourceKeys = pkg.artifacts.map((artifact) => artifact.sourceKey).sort((left, right) => left.localeCompare(right));
            if (new Set(sourceKeys).size !== sourceKeys.length) throw new Error("Agent 产物包 sourceKey 重复");
            const priorCommit = assets.filter((asset) => commitMarker(asset)?.packageId === pkg.packageId);
            if (priorCommit.length) {
                if (priorCommit.some((asset) => commitMarker(asset)?.contentDigest !== pkg.contentDigest)) throw new Error("packageId 已用于不同内容；旧记录未修改");
                const savedSourceKeys = [...new Set(priorCommit.flatMap((asset) => {
                    const values = commitMarker(asset)?.sourceKeys;
                    return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
                }))].sort((left, right) => left.localeCompare(right));
                if (stableJson(savedSourceKeys) !== stableJson(sourceKeys)) throw new Error("既有产物包写入状态与当前清单不一致；请先回读确认，未重新写入");
                const assetIdsBySourceKey: Record<string, string> = {};
                for (const asset of priorCommit) {
                    const values = commitMarker(asset)?.sourceKeys;
                    if (Array.isArray(values)) for (const sourceKey of values) if (typeof sourceKey === "string") assetIdsBySourceKey[sourceKey] = asset.id;
                }
                return { ok: true, committed: true, replayed: true, packageId: pkg.packageId, commitId: String(commitMarker(priorCommit[0])?.commitId || ""), assetIds: priorCommit.map((asset) => asset.id), assetIdsBySourceKey };
            }
            const validation = await validateXiajiArtifactPackage(assets, canvas, pkg as unknown as Record<string, unknown>);
            if (!validation.ok) throw new Error(validation.message || validation.code || "Agent 产物包验证失败");
            const projectAssetId = pkg.projectAssetId;
            const episodeAssetId = pkg.episodeAssetId || "";
            const episode = episodeAssetId ? assets.find((asset) => asset.id === episodeAssetId) : undefined;
            const episodeRecord = episode ? getLocalStudioRecord(episode) : null;
            if (episode && episodeRecord?.recordType !== "episode") throw new Error("Agent 产物对应分集无效");
            const commitId = await createXiajiArtifactCommitId(pkg);
            const timestamp = Number.isFinite(Date.parse(stagedAt)) ? new Date(stagedAt).toISOString() : now();
            const newAssets: Asset[] = [];
            const updates = new Map<string, Asset>();
            const assetIdsBySourceKey: Record<string, string> = {};
            const newAsset = async (sourceKey: string, title: string, content: string, record: LocalStudioRecord, sourceKeysForCommit = [sourceKey]) => {
                const id = await createXiajiArtifactAssetId(commitId, sourceKey);
                if (assets.some((asset) => asset.id === id) || newAssets.some((asset) => asset.id === id)) throw new Error(`Agent 产物素材 ID 已被其他记录占用：${id}`);
                const base = createLocalStudioAssetInput(title, content, record);
                const asset = makeAsset({ ...base, metadata: { ...base.metadata, localStudioCommit: { commitId, packageId: pkg.packageId, contentDigest: pkg.contentDigest, sourceKeys: sourceKeysForCommit } } }, id, timestamp);
                newAssets.push(asset);
                for (const key of sourceKeysForCommit) assetIdsBySourceKey[key] = id;
                return asset;
            };
            const updateEpisode = (patch: Record<string, unknown>) => {
                if (!episode) throw new Error("产物包没有目标分集");
                updates.set(episode.id, { ...patchLocalStudioRecord(episode, patch), updatedAt: timestamp } as Asset);
            };
            const getLatestEpisode = () => episode ? updates.get(episode.id) || episode : undefined;

            if (pkg.stage === "project-outline") {
                for (const artifact of pkg.artifacts) {
                    const metadata = artifact.metadata || {};
                    await newAsset(artifact.sourceKey, artifact.title, artifact.content || "", {
                        schemaVersion: 1,
                        recordType: "episode",
                        projectAssetId,
                        order: Number(metadata.order),
                        sourceEpisodeNumber: typeof metadata.sourceEpisodeNumber === "number" ? metadata.sourceEpisodeNumber : undefined,
                        title: artifact.title,
                        synopsis: artifact.content || "",
                        sourcePackageId: pkg.packageId,
                        sourceKey: artifact.sourceKey,
                    });
                }
            } else if (pkg.stage === "script") {
                if (!episode || episodeRecord?.recordType !== "episode") throw new Error("剧本产物缺少有效分集");
                const priorScript = episodeRecord.scriptAssetId ? assets.find((asset) => asset.id === episodeRecord.scriptAssetId) : undefined;
                const priorRecord = priorScript ? getLocalStudioRecord(priorScript) : null;
                if (priorScript && priorRecord?.recordType !== "script") throw new Error("当前分集剧本版本无效");
                const artifact = pkg.artifacts[0];
                const script = await newAsset(artifact.sourceKey, artifact.title, artifact.content || "", {
                    schemaVersion: 1,
                    recordType: "script",
                    projectAssetId,
                    episodeAssetId,
                    documentKind: "script",
                    version: (priorRecord?.recordType === "script" ? priorRecord.version || 1 : 0) + 1,
                    supersedesAssetId: priorScript?.id,
                    approvalState: "approved",
                    packageId: pkg.packageId,
                    contentDigest: pkg.contentDigest,
                    sourceKey: artifact.sourceKey,
                });
                if (priorScript && priorRecord?.recordType === "script") updates.set(priorScript.id, { ...patchLocalStudioRecord(priorScript, { approvalState: "superseded", supersededByAssetId: script.id }), updatedAt: timestamp } as Asset);
                updateEpisode({ scriptAssetId: script.id });
            } else if (pkg.stage === "production-breakdown") {
                if (!episode || episodeRecord?.recordType !== "episode") throw new Error("镜头产物缺少有效分集");
                const previousBeats = listCurrentLocalStudioBeats(assets, episodeAssetId);
                const previousBySourceKey = new Map(previousBeats.flatMap((beat) => {
                    const record = getLocalStudioRecord(beat);
                    return record?.recordType === "beat" && typeof record.sourceKey === "string" ? [[record.sourceKey, { asset: beat, record }] as const] : [];
                }));
                const nextSourceKeys = new Set(pkg.artifacts.map((artifact) => artifact.sourceKey));
                const nextBeatIds: string[] = [];
                for (const artifact of pkg.artifacts) {
                    const metadata = artifact.metadata || {};
                    const order = Number(metadata.order);
                    const previous = previousBySourceKey.get(artifact.sourceKey);
                    const version = previous ? (previous.record.version || 1) + 1 : 1;
                    const beat = await newAsset(artifact.sourceKey, artifact.title, artifact.content || "", {
                        ...metadata,
                        schemaVersion: 1,
                        recordType: "beat",
                        projectAssetId,
                        episodeAssetId,
                        order,
                        sourceBeatNumber: typeof metadata.sourceBeatNumber === "number" ? metadata.sourceBeatNumber : undefined,
                        dialogueText: typeof metadata.dialogueText === "string" ? metadata.dialogueText : undefined,
                        referencedAssetIds: Array.isArray(metadata.referencedAssetIds) ? metadata.referencedAssetIds as string[] : [],
                        version,
                        supersedesAssetId: previous?.asset.id,
                        approvalState: "approved",
                        packageId: pkg.packageId,
                        contentDigest: pkg.contentDigest,
                        sourceKey: artifact.sourceKey,
                    });
                    nextBeatIds.push(beat.id);
                    if (previous) updates.set(previous.asset.id, { ...patchLocalStudioRecord(previous.asset, { approvalState: "superseded", supersededByAssetId: beat.id }), updatedAt: timestamp } as Asset);
                }
                for (const previous of previousBeats) {
                    const previousRecord = getLocalStudioRecord(previous);
                    if (previousRecord?.recordType === "beat" && previousRecord.sourceKey && nextSourceKeys.has(previousRecord.sourceKey)) continue;
                    if (!updates.has(previous.id)) updates.set(previous.id, { ...patchLocalStudioRecord(previous, { approvalState: "superseded" }), updatedAt: timestamp } as Asset);
                }
                updateEpisode({ currentBeatAssetIds: nextBeatIds });
            } else {
                if (!episode || episodeRecord?.recordType !== "episode") throw new Error("素材关联产物缺少有效分集");
                const currentBeats = listCurrentLocalStudioBeats(assets, episodeAssetId);
                const grouped = new Map<string, { beat: Asset; record: Extract<LocalStudioRecord, { recordType: "beat" }>; assetIds: string[]; sourceKeys: string[] }>();
                for (const artifact of pkg.artifacts) {
                    const metadata = artifact.metadata || {};
                    const assetId = String(metadata.assetId || "");
                    const beat = currentBeats.find((candidate) => candidate.id === metadata.beatAssetId
                        || (typeof metadata.beatSourceKey === "string" && getLocalStudioRecord(candidate)?.recordType === "beat" && getLocalStudioRecord(candidate)?.sourceKey === metadata.beatSourceKey));
                    const beatRecord = beat ? getLocalStudioRecord(beat) : null;
                    if (!beat || beatRecord?.recordType !== "beat") throw new Error(`找不到素材关联目标镜头：${String(metadata.beatAssetId || metadata.beatSourceKey || "")}`);
                    const current = grouped.get(beat.id) || { beat, record: beatRecord, assetIds: [...beatRecord.referencedAssetIds], sourceKeys: [] };
                    if (!current.assetIds.includes(assetId)) current.assetIds.push(assetId);
                    current.sourceKeys.push(artifact.sourceKey);
                    grouped.set(beat.id, current);
                }
                const nextBeatIds = currentBeats.map((beat) => beat.id);
                for (const { beat, record, assetIds, sourceKeys } of grouped.values()) {
                    const primarySourceKey = sourceKeys[0];
                    const revised = await newAsset(primarySourceKey, beat.title, beat.kind === "text" ? beat.data.content : "", {
                        ...record,
                        version: (record.version || 1) + 1,
                        supersedesAssetId: beat.id,
                        approvalState: "approved",
                        referencedAssetIds: assetIds,
                        packageId: pkg.packageId,
                        contentDigest: pkg.contentDigest,
                        sourceKey: record.sourceKey || primarySourceKey,
                    }, sourceKeys);
                    const index = nextBeatIds.indexOf(beat.id);
                    if (index >= 0) nextBeatIds[index] = revised.id;
                    updates.set(beat.id, { ...patchLocalStudioRecord(beat, { approvalState: "superseded", supersededByAssetId: revised.id }), updatedAt: timestamp } as Asset);
                }
                updateEpisode({ currentBeatAssetIds: nextBeatIds });
            }

            const snapshot = [...newAssets, ...assets.map((asset) => updates.get(asset.id) || asset)];
            const issues = validateLocalStudioAssetCollection(snapshot).issues;
            if (issues.length) throw new Error(issueMessage(issues[0].code));
            const canonical = await dependencies.saveAssetsAndWait(snapshot);
            const created = newAssets.map((asset) => canonical.find((saved) => saved.id === asset.id));
            if (created.some((saved, index) => !saved || !sameSavedPayload(newAssets[index], saved))) throw new Error("本地保存响应未确认全部 Agent 产物素材");
            for (const expected of updates.values()) {
                const saved = canonical.find((asset) => asset.id === expected.id);
                if (!saved || !sameSavedPayload(expected, saved)) throw new Error("本地保存响应未确认当前版本关系");
            }
            return { ok: true, committed: true, replayed: false, packageId: pkg.packageId, commitId, assetIds: newAssets.map((asset) => asset.id), assetIdsBySourceKey };
        },
        async saveRecord(assetId: string, patch: Record<string, unknown>, content?: string): Promise<Asset> {
            const existing = dependencies.getAssets().find((asset) => asset.id === assetId);
            if (!existing || !getLocalStudioRecord(existing)) throw new Error("本地项目素材不存在");
            const updated = patchLocalStudioRecord(existing, patch);
            if (updated === existing) throw new Error("项目素材字段无效");
            const next = { ...updated, ...(content === undefined || updated.kind !== "text" ? {} : { data: { content } }), updatedAt: now() } as Asset;
            const snapshot = dependencies.getAssets().map((asset) => asset.id === assetId ? next : asset);
            const issues = validateLocalStudioAssetCollection(snapshot).issues;
            if (issues.length) throw new Error(issueMessage(issues[0].code));
            const canonical = await dependencies.saveAssetsAndWait(snapshot);
            const saved = canonical.find((asset) => asset.id === assetId);
            if (!saved || !sameSavedPayload(next, saved)) throw new Error("本地保存响应与提交内容不一致");
            return saved;
        },
    };
}
