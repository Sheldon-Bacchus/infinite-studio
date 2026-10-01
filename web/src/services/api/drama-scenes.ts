import { apiGet, apiPost } from "./request";
import { useUserStore } from "@/stores/use-user-store";

export type DramaSceneFileKind = "master" | "pano" | "custom";
export type DramaSceneGenerationOperation = "master" | "reverse" | "pano" | "3gs-master" | "3gs-reverse" | "3gs-pano";

export type DramaSceneAsset = {
    name: string;
    aliases?: string[];
    scene_type?: string;
    base_scene_id?: string;
    variant_id?: string;
    time_of_day?: string;
    environment_prompt?: string;
    variant_prompt?: string;
    effective_environment_prompt?: string;
    description?: string;
    derived_from_scene?: string;
    spatial_layout_image?: string;
    notes?: string;
    updated_at?: string;
    master_path?: string | null;
    master_url?: string | null;
    reverse_master_path?: string | null;
    reverse_master_url?: string | null;
    pano_path?: string | null;
    pano_url?: string | null;
    custom_scene_path?: string | null;
    custom_scene_url?: string | null;
    stage_3gs?: Record<string, unknown>;
    [key: string]: unknown;
};

export type DramaScenePlatePreview = {
    scene_id: string;
    variant_id: string;
    time_of_day: string;
    resolved_scene_name: string;
    planned_scene_name: string;
    time_baked: boolean;
    render: {
        resolved_scene_name: string;
        planned_scene_name: string;
        relight: boolean;
        status: "no_time" | "time_baked" | "relight" | "planned_missing";
        label: string;
    };
    seedance2: {
        resolved_scene_name: string;
        prompt_time_of_day: string;
        label: string;
    };
};

export type DramaSceneBuildTask = {
    task_type?: string;
    task_id?: string;
    scope?: string;
    task_key?: string;
    status?: string;
    progress?: number;
    current_task?: string;
    error?: string;
    logs?: string[];
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
};

export type DramaSceneTask = DramaSceneBuildTask;

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function normalizeScenes(value: unknown): DramaSceneAsset[] {
    if (!Array.isArray(value)) throw new Error("虾集场景列表格式无效");
    return value.map((candidate) => {
        const scene = record(candidate);
        if (!scene || typeof scene.name !== "string" || !scene.name.trim()) {
            throw new Error("虾集场景缺少名称");
        }
        // Keep source fields and their names intact; unknown source metadata can
        // be displayed without inventing a second scene schema.
        return scene as DramaSceneAsset;
    });
}

export async function fetchDramaScenes(projectId: string, options: { summary?: boolean; names?: string[] } = {}) {
    const token = useUserStore.getState().token;
    const summary = options.summary ?? true;
    const names = options.names?.map((name) => name.trim()).filter(Boolean);
    return normalizeScenes(await apiGet<unknown>(`/api/v1/drama/projects/${encodeURIComponent(projectId)}/scenes`, { ...(names?.length ? { names } : {}), summary: String(summary) }, token));
}

export function fetchDramaScenePlatePreview(projectId: string, query: { scene_id: string; variant_id: string; time_of_day: string }) {
    return apiGet<DramaScenePlatePreview>(`/api/v1/drama/projects/${encodeURIComponent(projectId)}/scenes/plate-preview`, { scene_id: query.scene_id, time_of_day: query.time_of_day, variant_id: query.variant_id }, useUserStore.getState().token);
}

export function startDramaSceneBuild(projectId: string) {
    return apiPost<DramaSceneBuildTask>(`/api/v1/drama/projects/${encodeURIComponent(projectId)}/scenes/build`, {}, useUserStore.getState().token);
}

export function fetchDramaSceneBuildTask(projectId: string) {
    return apiGet<DramaSceneBuildTask | null>(`/api/v1/drama/projects/${encodeURIComponent(projectId)}/scenes/build-task`, undefined, useUserStore.getState().token);
}

export function startDramaSceneGeneration(projectId: string, sceneName: string, operation: DramaSceneGenerationOperation, payload: { model?: string; source?: "master" | "text" } = {}) {
    return apiPost<DramaSceneTask>(`/api/v1/drama/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneName)}/generate/${operation}`, payload, useUserStore.getState().token);
}

export function fetchDramaSceneTask(projectId: string, sceneName: string, operation: DramaSceneGenerationOperation, source?: "master" | "text") {
    return apiGet<DramaSceneTask | null>(`/api/v1/drama/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneName)}/tasks/${operation}`, source ? { source } : undefined, useUserStore.getState().token);
}

export async function uploadDramaSceneFile(projectId: string, sceneName: string, kind: DramaSceneFileKind, file: File) {
    const form = new FormData();
    form.append("file", file, file.name);
    const token = useUserStore.getState().token;
    const response = await fetch(`/api/v1/drama/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneName)}/${kind}/upload`, {
        method: "POST",
        redirect: "error",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
    });
    const payload = (await response.json().catch(() => null)) as { code?: number; data?: unknown; msg?: string } | null;
    if (!response.ok || !payload || payload.code !== 0) {
        throw new Error(payload?.msg || `上传虾集场景文件失败：${response.status}`);
    }
    return normalizeScenes([payload.data])[0];
}

export function deleteDramaSceneFile(projectId: string, sceneName: string, kind: DramaSceneFileKind) {
    return apiPost<{ deleted: boolean }>(`/api/v1/drama/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneName)}/${kind}/delete`, {}, useUserStore.getState().token);
}
