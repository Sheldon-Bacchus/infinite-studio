import axios from "axios";
import { apiDelete, apiGet, apiPatch, apiPost } from "./request";
import { useUserStore } from "@/stores/use-user-store";

export type DramaCharacterIdentity = {
    identity_id: string;
    identity_name: string;
    appearance_details?: string;
    face_prompt?: string;
    age_group?: string;
    body_type?: string;
    image_url?: string | null;
    costume_image_url?: string | null;
    portrait_image_url?: string | null;
    updated_at?: string;
};

export type DramaCharacterIdentityCreate = {
    identity_name: string;
    age_group?: string;
    appearance_details?: string;
};

export type DramaCharacterIdentityUpdate = {
    identity_name?: string;
    appearance_details?: string;
    face_prompt?: string;
    age_group?: string;
    body_type?: string;
};

export type DramaIdentityTask = {
    task_type: string;
    task_id: string;
    scope?: string;
    task_key?: string;
    backend?: string;
    queue?: string;
    message?: string;
};

export type DramaIdentityAttempts = {
    image_attempts: number;
    portrait_attempts: number;
};

export type DramaCharacterPortraitRequest = {
    style?: string;
    ethnicity?: string;
    model?: string;
};

export type DramaIdentityImageRequest = {
    style?: string;
    model?: string;
};

export type DramaIdentityAssetKind = "image" | "costume" | "portrait";

export class DramaIdentityWriteOutcomeUnknownError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DramaIdentityWriteOutcomeUnknownError";
    }
}

const UNKNOWN_WRITE_PREFIX = "虾塘写入结果未知";

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function optionalMediaURL(value: unknown): string | null | undefined {
    return typeof value === "string" || value === null ? value : undefined;
}

export function normalizeDramaCharacterIdentities(value: unknown): DramaCharacterIdentity[] {
    if (!Array.isArray(value)) throw new Error("虾塘角色身份响应格式无效");
    return value.map((candidate) => {
        const row = asRecord(candidate);
        if (!row || typeof row.identity_id !== "string" || !row.identity_id.trim() || typeof row.identity_name !== "string" || !row.identity_name.trim()) {
            throw new Error("虾塘角色身份数据无效");
        }
        return {
            identity_id: row.identity_id,
            identity_name: row.identity_name,
            appearance_details: optionalString(row.appearance_details),
            face_prompt: optionalString(row.face_prompt),
            age_group: optionalString(row.age_group),
            body_type: optionalString(row.body_type),
            image_url: optionalMediaURL(row.image_url),
            costume_image_url: optionalMediaURL(row.costume_image_url),
            portrait_image_url: optionalMediaURL(row.portrait_image_url),
            updated_at: optionalString(row.updated_at),
        };
    });
}

export function normalizeDramaCharacterIdentity(value: unknown): DramaCharacterIdentity {
    const rows = normalizeDramaCharacterIdentities([value]);
    return rows[0];
}

export function normalizeDramaIdentityAttempts(value: unknown): DramaIdentityAttempts {
    const row = asRecord(value);
    if (!row || !Number.isInteger(row.image_attempts) || Number(row.image_attempts) < 0 || !Number.isInteger(row.portrait_attempts) || Number(row.portrait_attempts) < 0) {
        throw new Error("虾塘身份尝试次数响应格式无效");
    }
    return { image_attempts: Number(row.image_attempts), portrait_attempts: Number(row.portrait_attempts) };
}

export function normalizeDramaIdentityTask(value: unknown): DramaIdentityTask {
    const row = asRecord(value);
    if (!row || typeof row.task_type !== "string" || !row.task_type.trim() || typeof row.task_id !== "string" || !row.task_id.trim()) {
        throw new DramaIdentityWriteOutcomeUnknownError(`${UNKNOWN_WRITE_PREFIX}：虾塘未返回可核对的 task_type/task_id`);
    }
    return {
        task_type: row.task_type,
        task_id: row.task_id,
        scope: optionalString(row.scope),
        task_key: optionalString(row.task_key),
        backend: optionalString(row.backend),
        queue: optionalString(row.queue),
        message: optionalString(row.message),
    };
}

function identitiesPath(projectId: string, character: string, identityId?: string) {
    const base = `/api/v1/drama/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(character)}/identities`;
    return identityId === undefined ? base : `${base}/${encodeURIComponent(identityId)}`;
}

export async function fetchDramaCharacterIdentities(projectId: string, character: string) {
    const data = await apiGet<unknown>(identitiesPath(projectId, character), undefined, useUserStore.getState().token);
    return normalizeDramaCharacterIdentities(data);
}

async function identityWrite<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof DramaIdentityWriteOutcomeUnknownError) throw error;
        const message = error instanceof Error ? error.message : "写入状态未知";
        if (message.includes(UNKNOWN_WRITE_PREFIX) || message.includes("接口连接失败")) {
            throw new DramaIdentityWriteOutcomeUnknownError(message);
        }
        throw error;
    }
}

export async function createDramaCharacterIdentity(projectId: string, character: string, payload: DramaCharacterIdentityCreate) {
    return identityWrite(async () => {
        const data = await apiPost<unknown>(identitiesPath(projectId, character), payload, useUserStore.getState().token);
        return normalizeDramaCharacterIdentity(data);
    });
}

export async function updateDramaCharacterIdentity(projectId: string, character: string, identityId: string, payload: DramaCharacterIdentityUpdate) {
    return identityWrite(async () => {
        const data = await apiPatch<unknown>(identitiesPath(projectId, character, identityId), payload, useUserStore.getState().token);
        return normalizeDramaCharacterIdentity(data);
    });
}

export async function deleteDramaCharacterIdentity(projectId: string, character: string, identityId: string) {
    return identityWrite(() => apiDelete<unknown>(identitiesPath(projectId, character, identityId), useUserStore.getState().token));
}

async function postIdentityTask(path: string, payload: Record<string, string | undefined> = {}) {
    return identityWrite(async () => normalizeDramaIdentityTask(await apiPost<unknown>(path, payload, useUserStore.getState().token)));
}

export function startDramaCharacterBuild(projectId: string) {
    return postIdentityTask(`/api/v1/drama/projects/${encodeURIComponent(projectId)}/characters/build`);
}

export function startDramaCharacterPortrait(projectId: string, character: string, payload: DramaCharacterPortraitRequest = {}) {
    return postIdentityTask(`${identitiesPath(projectId, character).replace(/\/identities$/, "")}/portrait-async`, payload);
}

export function startDramaIdentityImage(projectId: string, character: string, identityId: string, payload: DramaIdentityImageRequest = {}) {
    return postIdentityTask(`${identitiesPath(projectId, character, identityId)}/generate-async`, payload);
}

export function startDramaIdentityPortrait(projectId: string, character: string, identityId: string, payload: DramaIdentityImageRequest = {}) {
    return postIdentityTask(`${identitiesPath(projectId, character, identityId)}/portrait/generate-async`, payload);
}

export async function fetchDramaIdentityAttempts(projectId: string, character: string, identityId: string) {
    return normalizeDramaIdentityAttempts(await apiGet<unknown>(`${identitiesPath(projectId, character, identityId)}/attempts`, undefined, useUserStore.getState().token));
}

async function uploadIdentityFile(path: string, file: File) {
    return identityWrite(async () => {
        const form = new FormData();
        form.append("file", file, file.name);
        let response;
        try {
            response = await axios.post<{ code: number; data: unknown; msg: string }>(path, form, {
                headers: useUserStore.getState().token ? { Authorization: `Bearer ${useUserStore.getState().token}` } : undefined,
                validateStatus: () => true,
            });
        } catch {
            throw new DramaIdentityWriteOutcomeUnknownError(`${UNKNOWN_WRITE_PREFIX}：上传请求未收到服务端确认`);
        }
        if (!response.data || response.status < 200 || response.status >= 300 || response.data.code !== 0) {
            const message = response.data?.msg || "角色图片上传失败";
            if (message.includes(UNKNOWN_WRITE_PREFIX)) throw new DramaIdentityWriteOutcomeUnknownError(message);
            throw new Error(message);
        }
        const data = asRecord(response.data.data);
        if (!data) throw new DramaIdentityWriteOutcomeUnknownError(`${UNKNOWN_WRITE_PREFIX}：虾塘图片上传响应无法判定`);
        return data;
    });
}

export function uploadDramaCharacterPortrait(projectId: string, character: string, file: File) {
    const path = `/api/v1/drama/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(character)}/portrait/upload`;
    return uploadIdentityFile(path, file);
}

export function uploadDramaIdentityAsset(projectId: string, character: string, identityId: string, identityName: string, kind: DramaIdentityAssetKind, file: File) {
    const identityPath = identitiesPath(projectId, character, identityId);
    const path = kind === "image"
        ? `${identitiesPath(projectId, character)}/by-name/${encodeURIComponent(identityName)}/upload`
        : `${identityPath}/${kind}/upload`;
    return uploadIdentityFile(path, file);
}

export function deleteDramaIdentityAsset(projectId: string, character: string, identityId: string, kind: "image" | "costume") {
    const path = `${identitiesPath(projectId, character, identityId)}/${kind}/delete`;
    return identityWrite(() => apiPost<{ deleted: boolean }>(path, {}, useUserStore.getState().token));
}
