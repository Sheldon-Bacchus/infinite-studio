import localforage from "localforage";
import { nanoid } from "nanoid";

import { withLocalProxy } from "@/stores/use-config-store";
import { downloadLocalWorkspaceFile, fileContentUrl, isLocalWorkspaceMode, uploadLocalWorkspaceFile } from "@/services/api/local-workspace";
import { LocalWorkspaceError } from "@/lib/local-workspace/types";

export type UploadedFile = { url: string; storageKey: string; fileId?: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const response = typeof input === "string" ? await fetch(withLocalProxy(input)) : null;
    if (response && !response.ok) throw new Error("读取待上传媒体失败");
    const blob = response ? await response.blob() : input as Blob;
    const objectUrl = URL.createObjectURL(blob);
    try {
        const meta = blob.type.startsWith("video/") ? await readVideoMeta(objectUrl) : blob.type.startsWith("audio/") ? await readAudioMeta(objectUrl) : {};
        if (isLocalWorkspaceMode) {
            const file = await uploadLocalWorkspaceFile(blob, `${prefix}.${blob.type.split("/")[1] || "bin"}`);
            return { url: file.url || fileContentUrl(file.fileId), storageKey: file.storageKey, fileId: file.fileId, bytes: file.bytes, mimeType: file.mimeType, ...meta };
        }
        const storageKey = `${prefix}:${nanoid()}`;
        await store.setItem(storageKey, blob);
        objectUrls.set(storageKey, objectUrl);
        return { url: objectUrl, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
    } finally {
        if (isLocalWorkspaceMode) URL.revokeObjectURL(objectUrl);
    }
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (isLocalWorkspaceMode && storageKey.startsWith("file:")) return fileContentUrl(storageKey.slice("file:".length));
    if (isLocalWorkspaceMode) return fallback.startsWith("blob:") ? "" : fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    if (isLocalWorkspaceMode) return storageKey.startsWith("file:") ? downloadLocalWorkspaceFile(storageKey.slice("file:".length)) : null;
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    if (isLocalWorkspaceMode) throw new LocalWorkspaceError("本地工作区尚不支持旧 ZIP 或整库同步导入", "invalid");
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    if (isLocalWorkspaceMode) return;
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await Promise.all(unused.map((key) => store.removeItem(key)));
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
