import { apiGet, apiPatch, apiPost, type ApiParams } from "./request";
import { useUserStore } from "@/stores/use-user-store";

export type DramaSourceSnapshot = {
    projectId: string;
    revision: string;
    generatedAt?: string;
};

export type DramaImportProject = {
    id: string;
    title: string;
};

export type DramaProjectStatus = "active" | "archived" | "deleted";
export type DramaProjectRole = "viewer" | "editor" | "admin" | "owner";
export type DramaProjectAction = "archive" | "unarchive" | "delete" | "restore" | "purge";

export type DramaProjectSummary = {
    id: string;
    name: string;
    status: DramaProjectStatus;
    updatedAt?: string;
    archivedAt?: string;
    deletedAt?: string;
    episodeCount: number;
    beatCount: number;
    effectiveRole?: DramaProjectRole;
    ownerUsername?: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function optionalString(value: unknown) {
    return typeof value === "string" && value ? value : undefined;
}

function countOrZero(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function normalizeDramaProjectSummaries(value: unknown): DramaProjectSummary[] {
    if (!Array.isArray(value)) throw new Error("虾集项目列表格式无效");
    return value.map((candidate) => {
        const row = record(candidate);
        const id = optionalString(row?.id) || optionalString(row?.project_id);
        const name = optionalString(row?.name);
        if (!row || !id || !name) throw new Error("虾集项目列表缺少项目 ID 或名称");
        const status = row.status;
        if (status !== "active" && status !== "archived" && status !== "deleted") {
            throw new Error(`虾集项目状态无效：${String(status)}`);
        }
        const role = row.effective_role;
        if (role !== undefined && role !== null && role !== "viewer" && role !== "editor" && role !== "admin" && role !== "owner") {
            throw new Error(`虾集项目角色无效：${String(role)}`);
        }
        return {
            id,
            name,
            status,
            updatedAt: optionalString(row.updated_at),
            archivedAt: optionalString(row.archived_at),
            deletedAt: optionalString(row.deleted_at),
            episodeCount: countOrZero(row.episode_count),
            beatCount: countOrZero(row.beat_count),
            effectiveRole: role === null ? undefined : role as DramaProjectRole | undefined,
            ownerUsername: optionalString(row.owner_username),
        };
    });
}

export function filterDramaProjectSummaries(projects: DramaProjectSummary[], status: "all" | DramaProjectStatus, query: string) {
    const needle = query.trim().toLocaleLowerCase();
    return projects.filter((project) =>
        (status === "all" || project.status === status) &&
        (!needle || project.name.toLocaleLowerCase().includes(needle) || project.id.toLocaleLowerCase().includes(needle)),
    );
}

export function getDramaImportableProjects(projects: DramaProjectSummary[]) {
    return projects.filter((project) => project.status !== "deleted");
}

export async function fetchDramaProjects() {
    const payload = await apiGet<unknown>("/api/v1/drama/projects", undefined, useUserStore.getState().token);
    return normalizeDramaProjectSummaries(payload);
}

export async function createDramaProject(name: string) {
    return apiPost<{ id?: string; project_id?: string; name: string }>(
        "/api/v1/drama/projects",
        { name },
        useUserStore.getState().token,
    );
}

export async function updateDramaProjectLifecycle(projectId: string, action: DramaProjectAction) {
    return apiPost<unknown>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/${action}`,
        undefined,
        useUserStore.getState().token,
    );
}

export type DramaImportBeat = {
    episode: number;
    beatNumber: number;
    title: string;
    content: string;
    prompt: string;
    visualDescription?: string;
    keyframePrompt?: string;
    videoPrompt?: string;
    audioPrompt?: string;
    videoMode?: string;
    durationSeconds?: number;
    sceneId?: string;
    identityIds: string[];
    propIds: string[];
    sketchUrl: string;
    frameUrl: string;
    videoUrl: string;
    audioUrl: string;
    audioDurationSeconds?: number;
};

export type DramaImportEpisode = {
    number: number;
    title: string;
    summary: string;
    beatCount: number;
    identityIds: string[];
    sceneIds: string[];
    propIds: string[];
    beats: DramaImportBeat[];
};

export type DramaImportAsset = {
    id: string;
    tab: string;
    kind: string;
    role: string;
    label: string;
    sublabel?: string;
    relPath?: string;
    url?: string;
    exists: boolean;
    mediaType: string;
    aspectRatio?: string;
    meta?: Record<string, unknown>;
    slotTarget?: Record<string, unknown>;
    pushable?: boolean;
    historyAvailable?: boolean;
    restoreAvailable?: boolean;
};

export type DramaBeatContextAsset = DramaImportAsset;

export type DramaImportCatalog = {
    sourceSnapshot: DramaSourceSnapshot;
    project: DramaImportProject;
    episodes: DramaImportEpisode[];
    assets: DramaImportAsset[];
    beatContextAssets: DramaBeatContextAsset[];
    warnings: string[];
};

export type DramaAssetCatalog = {
    sourceSnapshot: DramaSourceSnapshot;
    project: DramaImportProject;
    assets: DramaImportAsset[];
    warnings: string[];
};

export type DramaAssetDomain = "characters" | "scenes" | "props";
export type DramaAssetDomainItem = Record<string, unknown>;

export type DramaCandidateUploadResult = {
    url: string;
    filename: string;
    size: number;
};

export type DramaCharacterVoiceSlot = {
    slot: string;
    label: string;
    path: string;
    url: string;
    sha256?: string;
    updated_at?: string;
    inherited_from_default?: boolean;
    required?: boolean;
};

export type DramaCharacterVoiceSamples = {
    character: string;
    slots: DramaCharacterVoiceSlot[];
};

export type DramaNarratorVoiceStatus = {
    narration_style?: string;
    source?: string;
    reference_path: string;
    reference_url?: string;
    heading?: string;
    detail?: string;
    explanation?: string;
    character_name?: string;
    identity_name?: string;
    is_first_person: boolean;
};

export type DramaNarratorVoiceSource = { label: string; path: string; rel_path: string };

export type DramaIdentityPayload = {
    source_url: string;
    character: string;
    identity_name: string;
    appearance_details?: string;
    face_prompt?: string;
    age_group?: string;
};

export type DramaPushTarget = Record<string, string | number> & { kind: string };

export type DramaPushResult = {
    target_url: string;
    backup?: string | null;
    stale_marked?: number;
    affected_count?: number;
};

export type DramaPushImpact = {
    affected_beats: Array<{ episode: number; beat: number; [key: string]: unknown }>;
    affected_count: number;
};

export type DramaAssetHistoryKind = "portrait" | "identity" | "identity_costume" | "identity_portrait";

export type DramaAssetHistoryEntry = {
    history_id: string;
    filename: string;
    url: string;
    created_at: string;
    bytes: number;
};

export type DramaAssetHistory = {
    kind: DramaAssetHistoryKind;
    identity_id?: string;
    current_url?: string;
    entries: DramaAssetHistoryEntry[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
}

function stringOrEmpty(value: unknown) {
    return typeof value === "string" ? value : "";
}

function normalizeAsset(value: unknown): DramaImportAsset {
    const asset = asRecord(value) || {};
    return {
        id: stringOrEmpty(asset.id),
        tab: stringOrEmpty(asset.tab),
        kind: stringOrEmpty(asset.kind),
        role: stringOrEmpty(asset.role),
        label: stringOrEmpty(asset.label),
        sublabel: typeof asset.sublabel === "string" ? asset.sublabel : undefined,
        relPath: typeof asset.relPath === "string" ? asset.relPath : undefined,
        url: typeof asset.url === "string" ? asset.url : undefined,
        exists: asset.exists === true,
        mediaType: stringOrEmpty(asset.mediaType),
        aspectRatio: typeof asset.aspectRatio === "string" ? asset.aspectRatio : undefined,
        meta: asRecord(asset.meta),
        slotTarget: asRecord(asset.slotTarget),
        pushable: typeof asset.pushable === "boolean" ? asset.pushable : undefined,
        historyAvailable: typeof asset.historyAvailable === "boolean" ? asset.historyAvailable : undefined,
        restoreAvailable: typeof asset.restoreAvailable === "boolean" ? asset.restoreAvailable : undefined,
    };
}

export function normalizeDramaImportCatalog(value: unknown): DramaImportCatalog {
    const catalog = asRecord(value);
    const sourceSnapshot = asRecord(catalog?.sourceSnapshot);
    const project = asRecord(catalog?.project);
    if (!catalog || !sourceSnapshot || !project) {
        throw new Error("虾集目录响应格式无效");
    }

    const projectId = stringOrEmpty(project.id) || stringOrEmpty(sourceSnapshot.projectId);
    return {
        sourceSnapshot: {
            projectId: stringOrEmpty(sourceSnapshot.projectId) || projectId,
            revision: stringOrEmpty(sourceSnapshot.revision),
            generatedAt: typeof sourceSnapshot.generatedAt === "string" ? sourceSnapshot.generatedAt : undefined,
        },
        project: {
            id: projectId,
            title: stringOrEmpty(project.title) || projectId,
        },
        episodes: Array.isArray(catalog.episodes) ? (catalog.episodes as DramaImportEpisode[]) : [],
        assets: Array.isArray(catalog.assets) ? catalog.assets.map(normalizeAsset) : [],
        beatContextAssets: Array.isArray(catalog.beatContextAssets) ? catalog.beatContextAssets.map(normalizeAsset) : [],
        warnings: Array.isArray(catalog.warnings) ? catalog.warnings.filter((warning): warning is string => typeof warning === "string") : [],
    };
}

export function normalizeDramaAssetCatalog(value: unknown): DramaAssetCatalog {
    const catalog = asRecord(value);
    const sourceSnapshot = asRecord(catalog?.sourceSnapshot);
    const project = asRecord(catalog?.project);
    if (!catalog || !sourceSnapshot || !project) throw new Error("虾集素材目录响应格式无效");
    const projectId = stringOrEmpty(project.id) || stringOrEmpty(sourceSnapshot.projectId);
    return {
        sourceSnapshot: {
            projectId: stringOrEmpty(sourceSnapshot.projectId) || projectId,
            revision: stringOrEmpty(sourceSnapshot.revision),
            generatedAt: typeof sourceSnapshot.generatedAt === "string" ? sourceSnapshot.generatedAt : undefined,
        },
        project: { id: projectId, title: stringOrEmpty(project.title) || projectId },
        assets: Array.isArray(catalog.assets) ? catalog.assets.map(normalizeAsset) : [],
        warnings: Array.isArray(catalog.warnings) ? catalog.warnings.filter((warning): warning is string => typeof warning === "string") : [],
    };
}

export function normalizeDramaAssetDomain(value: unknown): DramaAssetDomainItem[] {
    if (!Array.isArray(value)) throw new Error("虾塘素材分类响应格式无效");
    return value.map((candidate) => {
        const item = asRecord(candidate);
        if (!item || typeof item.name !== "string" || !item.name.trim()) {
            throw new Error("虾塘素材分类包含无效项目");
        }
        return item;
    });
}

export function buildDramaImportCatalogParams(episode?: number, beat?: number): ApiParams | undefined {
    if (episode === undefined && beat === undefined) return undefined;
    return { episode, beat };
}

export async function fetchDramaImportCatalog(projectId: string, episode?: number, beat?: number) {
    const payload = await apiGet<unknown>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/import-catalog`,
        buildDramaImportCatalogParams(episode, beat),
        useUserStore.getState().token,
    );
    return normalizeDramaImportCatalog(payload);
}

export async function fetchDramaAssetCatalog(projectId: string) {
    const payload = await apiGet<unknown>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/asset-catalog`,
        undefined,
        useUserStore.getState().token,
    );
    return normalizeDramaAssetCatalog(payload);
}

export async function fetchDramaAssetDomain(projectId: string, domain: DramaAssetDomain) {
    const payload = await apiGet<unknown>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/domain/${domain}`,
        undefined,
        useUserStore.getState().token,
    );
    return normalizeDramaAssetDomain(payload);
}

export function normalizeDramaCharacterVoiceSamples(value: unknown): DramaCharacterVoiceSamples {
    const samples = asRecord(value);
    if (!samples || typeof samples.character !== "string" || !Array.isArray(samples.slots)) {
        throw new Error("虾塘角色声线响应格式无效");
    }
    const slots = samples.slots.map((candidate) => {
        const slot = asRecord(candidate);
        if (!slot || typeof slot.slot !== "string" || typeof slot.label !== "string") {
            throw new Error("虾塘角色声线槽位无效");
        }
        return {
            slot: slot.slot,
            label: slot.label,
            path: stringOrEmpty(slot.path),
            url: stringOrEmpty(slot.url),
            sha256: optionalString(slot.sha256),
            updated_at: optionalString(slot.updated_at),
            inherited_from_default: slot.inherited_from_default === true,
            required: slot.required === true,
        };
    });
    return { character: samples.character, slots };
}

export function normalizeDramaNarratorVoice(value: unknown): DramaNarratorVoiceStatus {
    const status = asRecord(value);
    if (!status || typeof status.is_first_person !== "boolean") throw new Error("虾塘旁白声线响应格式无效");
    return {
        narration_style: optionalString(status.narration_style),
        source: optionalString(status.source),
        reference_path: stringOrEmpty(status.reference_path),
        reference_url: optionalString(status.reference_url),
        heading: optionalString(status.heading),
        detail: optionalString(status.detail),
        explanation: optionalString(status.explanation),
        character_name: optionalString(status.character_name),
        identity_name: optionalString(status.identity_name),
        is_first_person: status.is_first_person,
    };
}

function dramaCharacterVoicePath(projectId: string, character: string) {
    return `/api/v1/drama/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(character)}/voice-samples`;
}

function dramaNarratorVoicePath(projectId: string) {
    return `/api/v1/drama/projects/${encodeURIComponent(projectId)}/narrator-voice`;
}

export async function fetchDramaCharacterVoiceSamples(projectId: string, character: string) {
    const result = await requestDramaWriteback<unknown>(dramaCharacterVoicePath(projectId, character), "GET");
    return normalizeDramaCharacterVoiceSamples(result);
}

export async function fetchDramaNarratorVoice(projectId: string) {
    const result = await requestDramaWriteback<unknown>(dramaNarratorVoicePath(projectId), "GET");
    return normalizeDramaNarratorVoice(result);
}

export async function fetchDramaNarratorVoiceSources(projectId: string) {
    const result = asRecord(await requestDramaWriteback<unknown>(`${dramaNarratorVoicePath(projectId)}/sources`, "GET"));
    if (!result || !Array.isArray(result.options)) throw new Error("虾塘旁白声线来源响应格式无效");
    return result.options.flatMap((candidate) => {
        const source = asRecord(candidate);
        return source && typeof source.label === "string" && typeof source.path === "string" && typeof source.rel_path === "string"
            ? [{ label: source.label, path: source.path, rel_path: source.rel_path }]
            : [];
    }) as DramaNarratorVoiceSource[];
}

function postDramaVoiceOperation<T>(path: string, body: Record<string, unknown> = {}) {
    return requestDramaWriteback<T>(path, "POST", JSON.stringify(body), true);
}

function uploadDramaVoiceFile<T>(path: string, file: Blob, filename: string) {
    const form = new FormData();
    form.append("file", file, filename);
    return requestDramaWriteback<T>(path, "POST", form);
}

export function recordDramaCharacterVoiceSample(projectId: string, character: string, slot: string, dataUrl: string) {
    return postDramaVoiceOperation<DramaCharacterVoiceSlot>(`${dramaCharacterVoicePath(projectId, character)}/${encodeURIComponent(slot)}/record`, { data_url: dataUrl });
}

export function uploadDramaCharacterVoiceSample(projectId: string, character: string, slot: string, file: Blob, filename: string) {
    return uploadDramaVoiceFile<DramaCharacterVoiceSlot>(`${dramaCharacterVoicePath(projectId, character)}/${encodeURIComponent(slot)}/upload`, file, filename);
}

export function trimDramaCharacterVoiceSample(projectId: string, character: string, slot: string, body: { source_path: string; start_seconds: number; duration_seconds: number }) {
    return postDramaVoiceOperation<DramaCharacterVoiceSlot>(`${dramaCharacterVoicePath(projectId, character)}/${encodeURIComponent(slot)}/trim`, body);
}

export function deleteDramaCharacterVoiceSample(projectId: string, character: string, slot: string) {
    return postDramaVoiceOperation<DramaCharacterVoiceSlot>(`${dramaCharacterVoicePath(projectId, character)}/${encodeURIComponent(slot)}/delete`);
}

export function recordDramaNarratorVoice(projectId: string, dataUrl: string) {
    return postDramaVoiceOperation<DramaNarratorVoiceStatus>(`${dramaNarratorVoicePath(projectId)}/record`, { data_url: dataUrl });
}

export function uploadDramaNarratorVoice(projectId: string, file: Blob, filename: string) {
    return uploadDramaVoiceFile<DramaNarratorVoiceStatus>(`${dramaNarratorVoicePath(projectId)}/upload`, file, filename);
}

export function copyDramaNarratorVoice(projectId: string, sourcePath: string) {
    return postDramaVoiceOperation<DramaNarratorVoiceStatus>(`${dramaNarratorVoicePath(projectId)}/copy`, { source_path: sourcePath });
}

export function trimDramaNarratorVoice(projectId: string, body: { start_seconds: number; duration_seconds: number }) {
    return postDramaVoiceOperation<DramaNarratorVoiceStatus>(`${dramaNarratorVoicePath(projectId)}/trim`, body);
}

export function deleteDramaNarratorVoice(projectId: string) {
    return postDramaVoiceOperation<DramaNarratorVoiceStatus>(`${dramaNarratorVoicePath(projectId)}/delete`);
}

export async function createDramaAssetDomainItem(projectId: string, domain: DramaAssetDomain, body: Record<string, unknown>) {
    return apiPost<DramaAssetDomainItem>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/domain/${domain}`,
        body,
        useUserStore.getState().token,
    );
}

export async function updateDramaAssetDomainItem(projectId: string, domain: DramaAssetDomain, name: string, body: Record<string, unknown>) {
    return apiPatch<DramaAssetDomainItem>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/domain/${domain}/${encodeURIComponent(name)}`,
        body,
        useUserStore.getState().token,
    );
}

export async function deleteDramaAssetDomainItem(projectId: string, domain: DramaAssetDomain, name: string) {
    return apiPost<{ deleted: boolean }>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/domain/${domain}/${encodeURIComponent(name)}/delete`,
        {},
        useUserStore.getState().token,
    );
}

export async function downloadDramaMedia(url: string) {
    const token = useUserStore.getState().token;
    const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
        throw new Error(`虾集媒体下载失败：${response.status}`);
    }
    const blob = await response.blob();
    if (blob.type.includes("json") || blob.type.startsWith("text/")) {
        throw new Error("虾集媒体响应不是可导入文件");
    }
    return blob;
}

async function requestDramaWriteback<T>(path: string, method: "GET" | "POST", body?: BodyInit, jsonBody = false): Promise<T> {
    const token = useUserStore.getState().token;
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (jsonBody) headers["Content-Type"] = "application/json";
    const response = await fetch(path, {
        method,
        redirect: "error",
        headers,
        ...(body === undefined ? {} : { body }),
    });
    const payload = await response.json().catch(() => null) as { code?: number; data?: T; msg?: string } | null;
    if (!response.ok || !payload || payload.code !== 0) {
        throw new Error(payload?.msg || `虾集写回请求失败：${response.status}`);
    }
    return payload.data as T;
}

export async function uploadDramaCandidate(projectId: string, file: Blob, filename: string) {
    const form = new FormData();
    form.append("file", file, filename);
    return requestDramaWriteback<DramaCandidateUploadResult>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/freezone/upload`,
        "POST",
        form,
    );
}

export async function createDramaIdentity(projectId: string, payload: DramaIdentityPayload) {
    return requestDramaWriteback<{ character: string; identity_id: string; identity_name: string; target_url: string }>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/freezone/assets/identities`,
        "POST",
        JSON.stringify(payload),
        true,
    );
}

export async function pushDramaCandidate(projectId: string, sourceUrl: string, target: DramaPushTarget, markStale = false) {
    return requestDramaWriteback<DramaPushResult>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/freezone/push`,
        "POST",
        JSON.stringify({ source_url: sourceUrl, target, mark_stale: markStale }),
        true,
    );
}

export async function fetchDramaPushImpact(projectId: string, target: DramaPushTarget) {
    return requestDramaWriteback<DramaPushImpact>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/freezone/impact`,
        "POST",
        JSON.stringify({ target }),
        true,
    );
}

export async function fetchDramaAssetHistory(projectId: string, character: string, kind: DramaAssetHistoryKind, identityId?: string) {
    const params = new URLSearchParams({ kind });
    if (identityId) params.set("identity_id", identityId);
    return requestDramaWriteback<DramaAssetHistory>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(character)}/asset-history?${params.toString()}`,
        "GET",
    );
}

export async function restoreDramaAssetHistory(projectId: string, character: string, payload: { kind: DramaAssetHistoryKind; history_id: string; identity_id?: string }) {
    const result = await requestDramaWriteback<{ kind: string; identity_id?: string; restored: boolean; url: string; backup_history_id?: string }>(
        `/api/v1/drama/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(character)}/asset-history/restore`,
        "POST",
        JSON.stringify(payload),
        true,
    );
    if (result.restored !== true) throw new Error("虾集未确认恢复成功");
    return result;
}
