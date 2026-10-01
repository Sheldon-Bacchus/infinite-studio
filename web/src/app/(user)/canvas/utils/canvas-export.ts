import { saveAs } from "file-saver";

import { createZip } from "@/lib/zip";
import { getMediaBlob, resolveMediaUrl } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { downloadLocalWorkspaceFile } from "@/services/api/local-workspace";
import type { CanvasExportAsset, CanvasExportFile } from "../export-types";
import type { CanvasProject } from "../stores/use-canvas-store";

export async function exportCanvasProjects(projects: CanvasProject[], fileName = "无限画布") {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exportedProjects = await Promise.all(
        projects.map(async (project) => {
            const files: CanvasExportAsset[] = [];
            await Promise.all(
                collectStorageKeys(project).map(async (storageKey) => {
                    const blob = await getExportBlob(storageKey);
                    if (!blob) return;
                    const path = `projects/${project.id}/files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`;
                    files.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                    zipFiles.push({ name: path, data: blob });
                }),
            );
            return { project, files };
        }),
    );

    const data: CanvasExportFile = { app: "infinite-canvas", version: 3, exportedAt: new Date().toISOString(), projects: exportedProjects };
    const zip = await createZip([{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

async function getExportBlob(storageKey: string) {
    const cached = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
    if (cached) return cached;
    if (!storageKey.startsWith("server:")) return null;

    const url = storageKey.startsWith("server:webdav:")
        ? await resolveMediaUrl(storageKey)
        : "";
    if (!storageKey.startsWith("server:webdav:")) {
        return downloadLocalWorkspaceFile(storageKey.slice("server:".length));
    }
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`导出素材读取失败：${storageKey}（${response.status}）`);
    return response.blob();
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return [...keys];
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return storageKey.startsWith("image:") ? "png" : "bin";
}
