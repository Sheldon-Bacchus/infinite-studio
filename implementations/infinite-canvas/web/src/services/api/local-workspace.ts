import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import type { Asset } from "@/stores/use-asset-store";
import { apiGet, apiPost } from "@/services/api/request";

export type LocalWorkspaceFile = {
    id: string;
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
};

export function listLocalCanvasProjects() {
    return apiGet<CanvasProject[]>("/api/local/canvas/projects");
}

export function saveLocalCanvasProject(project: CanvasProject, expected: CanvasProject | null) {
    return apiPost<CanvasProject>("/api/local/canvas/projects", { data: project, expected });
}

export function syncLocalCanvasProjects(projects: CanvasProject[], expectedProjects: Record<string, CanvasProject | null>) {
    return apiPost<CanvasProject[]>("/api/local/canvas/projects/sync", { projects, expectedProjects });
}

export function importLocalCanvasProjects(projects: CanvasProject[]) {
    return apiPost<CanvasProject[]>("/api/local/canvas/projects/import", { projects });
}

export function deleteLocalCanvasProjects(ids: string[], expectedProjects: Record<string, CanvasProject | null>) {
    const projectIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (!projectIds.length) return Promise.resolve(true);
    return apiPost<boolean>("/api/local/canvas/projects/delete", { ids: projectIds, expectedProjects });
}

export function listLocalWorkspaceAssets() {
    return apiGet<Asset[]>("/api/local/assets");
}

export function syncLocalWorkspaceAssets(assets: Asset[]) {
    return apiPost<Asset[]>("/api/local/assets/sync", { assets });
}

export function deleteLocalWorkspaceAssets(ids: string[]) {
    const assetIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (!assetIds.length) return Promise.resolve(true);
    return apiPost<boolean>("/api/local/assets/delete", { ids: assetIds });
}

export async function uploadLocalWorkspaceFile(blob: Blob, filename: string) {
    const formData = new FormData();
    formData.append("file", blob, filename);
    const response = await fetch("/api/local/files", { method: "POST", body: formData });
    const payload = (await response.json().catch(() => null)) as { code?: number; msg?: string; data?: LocalWorkspaceFile } | null;
    if (!response.ok || payload?.code !== 0 || !payload.data) {
        throw new Error(payload?.msg || "本地文件保存失败");
    }
    return payload.data;
}

export async function deleteLocalWorkspaceFile(id: string) {
    if (!id) return;
    const response = await fetch(`/api/local/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { code?: number; msg?: string } | null;
    if (!response.ok || payload?.code !== 0) {
        throw new Error(payload?.msg || "本地文件删除失败");
    }
}

export async function downloadLocalWorkspaceFile(id: string, fetcher: typeof fetch = fetch) {
    const response = await fetcher(`/api/files/${encodeURIComponent(id)}/content`);
    if (!response.ok) throw new Error(`本地媒体读取失败：${response.status}`);
    return response.blob();
}
