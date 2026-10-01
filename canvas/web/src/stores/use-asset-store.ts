"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, getImageBlob, getProxyUrl, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, getMediaBlob, resolveMediaUrl } from "@/services/file-storage";
import { fetchUserAssetData, syncUserAssetData } from "@/services/api/user-config";
import { deleteLocalWorkspaceAssets, listLocalWorkspaceAssets, syncLocalWorkspaceAssets, uploadLocalWorkspaceFile } from "@/services/api/local-workspace";
import { mergeAssetSnapshots, parseLegacyAssetSnapshot } from "@/services/local-asset-migration";
import { useUserStore } from "@/stores/use-user-store";
import { createSerializedAssetSnapshotWriter } from "@/services/local-asset-snapshot-writer";

export type AssetKind = "text" | "image" | "video" | "audio";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; bytes?: number; mimeType: string; durationMs?: number } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    category?: string;
    source?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    assets: Asset[];
    workspaceError: string | null;
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    saveAssetsAndWait: (assets: Asset[]) => Promise<Asset[]>;
    hydrateAccountAssets: (token: string, syncEnabled?: boolean) => Promise<void>;
    refreshWorkspaceAssets: () => Promise<void>;
    syncAccountAssets: (token: string) => Promise<void>;
    stopAccountAssetSync: () => void;
    cleanupImages: (extra?: unknown, storageKeys?: ReadonlyMap<string, string>, ownerToken?: string) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let activeAssetSyncToken = "";
let accountAssetSyncEnabled = false;
let isHydratingAccountAssets = false;
let syncTimer: number | null = null;
let localAssetSyncTimer: number | null = null;
let localAssetSyncRevision = 0;
let localAssetSyncInFlight = 0;
let lastPersistedAssetSnapshot: Asset[] | null = null;
let assetRefreshBound = false;
const writeLocalAssetSnapshot = createSerializedAssetSnapshotWriter(syncLocalWorkspaceAssets);

const LEGACY_ASSET_MIGRATION_KEY = `${ASSET_STORE_KEY}:local-workspace-migration:v1`;

async function resolveStoredAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
    if (asset.kind === "audio" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
    if (asset.kind !== "image") return asset;
    if (asset.data.storageKey)
        return {
            ...asset,
            coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
            data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
        };
    if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
    const image = await uploadImage(asset.data.dataUrl);
    return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
}

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        let assets = await listLocalWorkspaceAssets();
        const migrationComplete = await localForageStorage.getItem(LEGACY_ASSET_MIGRATION_KEY);
        if (migrationComplete !== "done") {
            const legacyValue = await localForageStorage.getItem(name);
            const legacyAssets = parseLegacyAssetSnapshot(legacyValue);
            const migratedAssets = await Promise.all(legacyAssets.map(migrateAssetToLocalWorkspace));
            if (migratedAssets.length) {
                assets = await syncLocalWorkspaceAssets(mergeAssetSnapshots(assets, migratedAssets));
            }
            await localForageStorage.setItem(LEGACY_ASSET_MIGRATION_KEY, "done");
        }
        assets = await Promise.all(assets.map(resolveStoredAsset));
        lastPersistedAssetSnapshot = assets;
        return { state: { assets }, version: 0 } as StorageValue<AssetStore>;
    },
    setItem: (_name, value) => {
        const assets = (value.state as Partial<AssetStore>).assets || [];
        if (lastPersistedAssetSnapshot === assets) return;
        lastPersistedAssetSnapshot = assets;
        queueLocalAssetSync(assets);
    },
    removeItem: async () => undefined,
};

type AssetSnapshot = { assets: Asset[] };

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            assets: [],
            workspaceError: null,
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                scheduleAssetSync(get);
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => {
                    const assets = state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset));
                    window.setTimeout(() => scheduleAssetSync(get), 0);
                    return { assets };
                }),
            removeAsset: (id) =>
                set((state) => {
                    const deletedAsset = state.assets.find((asset) => asset.id === id);
                    const assets = state.assets.filter((asset) => asset.id !== id);

                    window.setTimeout(async () => {
                        try {
                            await deleteLocalWorkspaceAssets([id]);
                        } catch (error) {
                            useAssetStore.setState({ workspaceError: error instanceof Error ? error.message : "本地素材删除失败" });
                            return;
                        }
                        if (!deletedAsset || deletedAsset.kind === "text" || !deletedAsset.data.storageKey) return;

                        const key = deletedAsset.data.storageKey;
                            const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
                            const usedKeys = new Set<string>();
                            // 收集其余资产的 storageKey
                            assets.forEach((a) => {
                                if (a.kind !== "text" && a.data.storageKey) usedKeys.add(a.data.storageKey);
                            });
                            // 收集画布中引用的 storageKey
                            const projects = useCanvasStore.getState().projects;
                            const { collectImageStorageKeys } = await import("@/services/image-storage");
                            const { collectMediaStorageKeys } = await import("@/services/file-storage");
                            collectImageStorageKeys(assets, usedKeys);
                            collectMediaStorageKeys(assets, usedKeys);
                            collectImageStorageKeys(projects, usedKeys);
                            collectMediaStorageKeys(projects, usedKeys);

                            // 收集本地/云端生图历史与视频历史中的 storageKey，避免生成结果卡片失效
                            try {
                                const localforage = (await import("localforage")).default;
                                const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
                                await imageLogStore.iterate((log: any) => {
                                    if (log) {
                                        if (Array.isArray(log.images)) {
                                            log.images.forEach((img: any) => {
                                                if (img && img.storageKey) usedKeys.add(img.storageKey);
                                            });
                                        }
                                        if (Array.isArray(log.references)) {
                                            log.references.forEach((ref: any) => {
                                                if (ref && ref.storageKey) usedKeys.add(ref.storageKey);
                                            });
                                        }
                                    }
                                });
                            } catch (e) {
                                console.error("Error iterating image_generation_logs", e);
                            }

                            try {
                                const localforage = (await import("localforage")).default;
                                const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
                                await videoLogStore.iterate((log: any) => {
                                    if (log) {
                                        if (log.video && log.video.storageKey) {
                                            usedKeys.add(log.video.storageKey);
                                        }
                                        if (Array.isArray(log.references)) {
                                            log.references.forEach((ref: any) => {
                                                if (ref && ref.storageKey) usedKeys.add(ref.storageKey);
                                            });
                                        }
                                    }
                                });
                            } catch (e) {
                                console.error("Error iterating video_generation_logs", e);
                            }

                            // 若全站没有其他地方再引用此 storageKey，则执行真正的物理删除
                            if (!usedKeys.has(key)) {
                                if (key.startsWith("image:") || key.startsWith("server:")) {
                                    const { deleteStoredImages } = await import("@/services/image-storage");
                                    await deleteStoredImages([key]);
                                }
                                if (key.startsWith("file:") || key.startsWith("video:") || key.startsWith("server:")) {
                                    const { deleteStoredMedia } = await import("@/services/file-storage");
                                    await deleteStoredMedia([key]);
                                }
                            }
                    }, 0);

                    window.setTimeout(() => scheduleAssetSync(get), 0);
                    return { assets };
                }),
            saveAssetsAndWait: async (assets) => {
                if (typeof window === "undefined") throw new Error("本地素材只能在浏览器中保存");
                if (localAssetSyncTimer) window.clearTimeout(localAssetSyncTimer);
                localAssetSyncTimer = null;
                localAssetSyncRevision += 1;
                return persistLocalAssetSnapshot(assets, localAssetSyncRevision);
            },
            hydrateAccountAssets: async (token, syncEnabled = false) => {
                if (!token) return;
                activeAssetSyncToken = token;
                accountAssetSyncEnabled = syncEnabled;
                isHydratingAccountAssets = true;
                try {
                    const remote = await fetchUserAssetData<AssetSnapshot>(token);
                    const remoteAssets = await Promise.all(
                        (Array.isArray(remote?.assets) ? remote.assets : []).map((asset) =>
                            migrateAssetToLocalWorkspace(asset),
                        ),
                    );
                    const currentAssets = get().assets;
                    if (remoteAssets.length && (syncEnabled || !currentAssets.length)) {
                        const mergedAssets = mergeAssetSnapshots(currentAssets, remoteAssets);
                        const canonicalAssets = await syncLocalWorkspaceAssets(mergedAssets);
                        const resolvedAssets = await Promise.all(canonicalAssets.map(resolveStoredAsset));
                        lastPersistedAssetSnapshot = resolvedAssets;
                        set({ assets: resolvedAssets, workspaceError: null });
                    }
                } finally {
                    isHydratingAccountAssets = false;
                }
            },
            refreshWorkspaceAssets: async () => {
                await refreshSharedAssetSnapshot();
            },
            syncAccountAssets: async (token) => {
                if (!token || !accountAssetSyncEnabled) return;
                await syncUserAssetData(token, { assets: get().assets });
            },
            stopAccountAssetSync: () => {
                activeAssetSyncToken = "";
                if (syncTimer) window.clearTimeout(syncTimer);
                syncTimer = null;
            },
            cleanupImages: (extra, storageKeys, ownerToken) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
                    const { loadLocalAgentSkills, useAgentSkillStore } = await import("@/stores/use-agent-skill-store");
                    const logKeys: string[] = [];
                    try {
                        const localforage = (await import("localforage")).default;
                        const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
                        await imageLogStore.iterate((log: any) => {
                            if (log) {
                                if (Array.isArray(log.images)) {
                                    log.images.forEach((img: any) => {
                                        if (img && img.storageKey) logKeys.push(img.storageKey);
                                    });
                                }
                                if (Array.isArray(log.references)) {
                                    log.references.forEach((ref: any) => {
                                        if (ref && ref.storageKey) logKeys.push(ref.storageKey);
                                    });
                                }
                            }
                        });
                        const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
                        await videoLogStore.iterate((log: any) => {
                            if (log) {
                                if (log.video && log.video.storageKey) {
                                    logKeys.push(log.video.storageKey);
                                }
                                if (Array.isArray(log.references)) {
                                    log.references.forEach((ref: any) => {
                                        if (ref && ref.storageKey) logKeys.push(ref.storageKey);
                                    });
                                }
                            }
                        });
                    } catch (e) {
                        console.error("Error gathering log keys in cleanupImages", e);
                    }

                    try {
                        await useAgentSkillStore.getState().loadSkills();
                        const skillStore = useAgentSkillStore.getState();
                        const localSkills = useUserStore.getState().token ? await loadLocalAgentSkills() : [];
                        const projects = useCanvasStore.getState().projects;
                        await cleanupUnusedImages({ assets: get().assets, projects, skills: [...skillStore.systemSkills, ...skillStore.userSkills, ...localSkills], extra, logKeys }, storageKeys, ownerToken);
                    } catch (error) {
                        console.error("Error gathering Skill keys in cleanupImages", error);
                    }
                    const projects = useCanvasStore.getState().projects;
                    await cleanupUnusedMedia({ assets: get().assets, projects, extra, logKeys });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                useAssetStore.setState({ workspaceError: error ? "本地素材后端不可用或旧素材迁移失败" : null });
                if (!error) startSharedAssetRefresh();
            },
        },
    ),
);

function scheduleAssetSync(get: () => AssetStore) {
    if (isHydratingAccountAssets || !activeAssetSyncToken || !accountAssetSyncEnabled || typeof window === "undefined") return;
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
        void get().syncAccountAssets(activeAssetSyncToken).catch(() => {});
    }, 600);
}

async function migrateAssetToLocalWorkspace(asset: Asset): Promise<Asset> {
    const resolved = await resolveStoredAsset(asset);
    if (resolved.kind === "text") return resolved;

    const storageKey = resolved.data.storageKey || "";
    if (storageKey.startsWith("server:") && !storageKey.startsWith("server:webdav:")) {
        const url = `/api/files/${encodeURIComponent(storageKey.slice("server:".length))}/content`;
        if (resolved.kind === "image") return { ...resolved, coverUrl: url, data: { ...resolved.data, dataUrl: url } };
        if (resolved.kind === "video") return { ...resolved, data: { ...resolved.data, url } };
        return { ...resolved, data: { ...resolved.data, url } };
    }

    let blob: Blob | null = null;
    if (storageKey) {
        blob = resolved.kind === "image"
            ? await getImageBlob(storageKey).catch(() => null)
            : await getMediaBlob(storageKey).catch(() => null);
    }
    const sourceUrl = resolved.kind === "image" ? resolved.data.dataUrl : resolved.data.url;
    if (!blob && sourceUrl) {
        const response = await fetch(getProxyUrl(sourceUrl));
        if (!response.ok) throw new Error(`旧素材媒体读取失败：${response.status}（${resolved.title}）`);
        blob = await response.blob();
    }
    if (!blob) return resolved;

    const extension = blob.type.split("/")[1]?.split(";")[0] || "bin";
    const fileName = `asset-${resolved.id.replace(/[^a-zA-Z0-9._-]/g, "_")}.${extension}`;
    const uploaded = await uploadLocalWorkspaceFile(blob, fileName);
    if (resolved.kind === "image") {
        return {
            ...resolved,
            coverUrl: uploaded.url,
            data: { ...resolved.data, dataUrl: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes || blob.size, mimeType: uploaded.mimeType || blob.type || resolved.data.mimeType },
        };
    }
    if (resolved.kind === "video") {
        return {
            ...resolved,
            data: { ...resolved.data, url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes || blob.size, mimeType: uploaded.mimeType || blob.type || resolved.data.mimeType },
        };
    }
    return {
        ...resolved,
        data: { ...resolved.data, url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes || blob.size, mimeType: uploaded.mimeType || blob.type || resolved.data.mimeType },
    };
}

function queueLocalAssetSync(assets: Asset[]) {
    if (typeof window === "undefined") return;
    localAssetSyncRevision += 1;
    const revision = localAssetSyncRevision;
    if (localAssetSyncTimer) window.clearTimeout(localAssetSyncTimer);
    localAssetSyncTimer = window.setTimeout(() => {
        localAssetSyncTimer = null;
        void persistLocalAssetSnapshot(assets, revision)
            .catch((error) => {
                console.error("Failed to persist local workspace assets", error);
            });
    }, 250);
}

async function persistLocalAssetSnapshot(assets: Asset[], revision: number): Promise<Asset[]> {
    localAssetSyncInFlight += 1;
    try {
        const canonical = await writeLocalAssetSnapshot(assets);
        const resolved = await Promise.all(canonical.map(resolveStoredAsset));
        if (revision === localAssetSyncRevision) {
            lastPersistedAssetSnapshot = resolved;
            useAssetStore.setState({ assets: resolved, workspaceError: null });
            scheduleAssetSync(() => useAssetStore.getState());
        }
        return resolved;
    } catch (error) {
        if (revision === localAssetSyncRevision) {
            useAssetStore.setState({ workspaceError: error instanceof Error ? error.message : "本地素材保存失败" });
        }
        throw error;
    } finally {
        localAssetSyncInFlight -= 1;
    }
}

async function refreshSharedAssetSnapshot() {
    if (typeof window === "undefined" || localAssetSyncTimer || localAssetSyncInFlight) return;
    const revision = localAssetSyncRevision;
    try {
        const canonical = await listLocalWorkspaceAssets();
        if (revision !== localAssetSyncRevision || localAssetSyncTimer) return;
        const resolved = await Promise.all(canonical.map(resolveStoredAsset));
        if (revision !== localAssetSyncRevision || localAssetSyncTimer) return;
        const current = useAssetStore.getState().assets;
        if (JSON.stringify(current) !== JSON.stringify(resolved)) {
            lastPersistedAssetSnapshot = resolved;
            useAssetStore.setState({ assets: resolved, workspaceError: null });
        } else {
            useAssetStore.setState({ workspaceError: null });
        }
    } catch (error) {
        useAssetStore.setState({ workspaceError: error instanceof Error ? error.message : "本地素材同步失败" });
    }
}

function startSharedAssetRefresh() {
    if (typeof window === "undefined" || assetRefreshBound) return;
    assetRefreshBound = true;
    const refreshWhenVisible = () => {
        if (document.visibilityState === "visible") void refreshSharedAssetSnapshot();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.setInterval(() => {
        if (document.visibilityState === "visible") void refreshSharedAssetSnapshot();
    }, 3000);
}

export function mergeAssets(remoteAssets: Asset[], localAssets: Asset[]) {
    const records = new Map<string, Asset>();
    [...localAssets, ...remoteAssets].forEach((asset) => {
        const previous = records.get(asset.id);
        if (!previous || Date.parse(asset.updatedAt || "") >= Date.parse(previous.updatedAt || "")) {
            records.set(asset.id, asset);
        }
    });
    return Array.from(records.values()).sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
}
