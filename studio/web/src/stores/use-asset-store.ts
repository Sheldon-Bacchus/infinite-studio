import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { CommitQueue } from "@/lib/local-workspace/commit-queue";
import { LocalWorkspaceError, type WriteResult } from "@/lib/local-workspace/types";
import { cleanupUnusedImages, ensureImagePreview, previewUrlFor, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { commitLocalWorkspaceAsset, deleteLocalWorkspaceAsset, getLocalWorkspaceOperation, isLocalWorkspaceMode, listLocalWorkspaceAssets } from "@/services/api/local-workspace";
import { useLocalWorkspaceStore } from "@/stores/use-local-workspace-store";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; fileId?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; fileId?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    coverFileId?: string;
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">, operationId?: string) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

// 卡片用缩略图渲染，自定义封面（远程地址或单独上传的封面）保持原样。
export function assetCoverUrl(asset: Asset) {
    const own = asset.kind === "image" ? asset.data.dataUrl : "";
    const cover = asset.coverUrl || own;
    return asset.kind === "image" && cover === own ? previewUrlFor(asset.data.storageKey) || cover : cover;
}

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
const assetRevisions = new Map<string, number>();
const observedAssets = new Map<string, Asset>();
const assetCommitQueues = new Map<string, CommitQueue<Asset>>();
const requestedAssetOperations = new Map<string, string>();
let queuedAssets: Asset[] | null = null;

function queueAssetCommit(asset: Asset, workspaceId: string, operationId?: string) {
    let queue = assetCommitQueues.get(asset.id);
    if (!queue) {
        queue = new CommitQueue(workspaceId, asset.id, assetRevisions.get(asset.id) ?? null, (data, baseRevision, operationId) =>
            commitLocalWorkspaceAsset(asset.id, { workspaceId, operationId, baseRevision, data }),
        );
        assetCommitQueues.set(asset.id, queue);
        queue.subscribe((snapshot) => {
            useLocalWorkspaceStore.getState().setSaveState(`asset:${asset.id}`, { phase: snapshot.phase, revision: snapshot.revision, message: snapshot.error?.message });
            if (snapshot.revision !== null) assetRevisions.set(asset.id, snapshot.revision);
        });
    }
    queue.enqueue(asset, operationId);
    void queue.flush().catch(() => undefined);
}

function persistLocalAssets(assets: Asset[]) {
    const workspaceId = useLocalWorkspaceStore.getState().workspace?.workspaceId;
    if (!workspaceId) return;
    const next = new Map(assets.map((asset) => [asset.id, asset]));
    assets.forEach((asset) => {
        const operationId = requestedAssetOperations.get(asset.id);
        if (observedAssets.get(asset.id) !== asset) queueAssetCommit(asset, workspaceId, operationId);
        requestedAssetOperations.delete(asset.id);
    });
    observedAssets.clear();
    next.forEach((asset, id) => observedAssets.set(id, asset));
}

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        if (isLocalWorkspaceMode) {
            try {
                await useLocalWorkspaceStore.getState().connect();
                const envelopes = await listLocalWorkspaceAssets();
                const assets = await Promise.all(envelopes.map(async (envelope) => {
                    assetRevisions.set(envelope.id, envelope.revision);
                    useLocalWorkspaceStore.getState().setSaveState(`asset:${envelope.id}`, { phase: "clean", revision: envelope.revision });
                    let asset = envelope.data;
                    if (asset.kind === "video" && (asset.data.storageKey || asset.data.fileId)) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey || `file:${asset.data.fileId}`, asset.data.url) } };
                    if (asset.kind !== "image") return asset;
                    if (asset.coverFileId) asset = { ...asset, coverUrl: await resolveImageUrl(`file:${asset.coverFileId}`, asset.coverUrl, asset.coverFileId) };
                    if (asset.data.storageKey || asset.data.fileId) {
                        const key = asset.data.storageKey || `file:${asset.data.fileId}`;
                        void ensureImagePreview(key);
                        return {
                            ...asset,
                            coverUrl: asset.coverUrl === asset.data.dataUrl || asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(key, asset.coverUrl, asset.data.fileId) : asset.coverUrl,
                            data: { ...asset.data, dataUrl: await resolveImageUrl(key, asset.data.dataUrl, asset.data.fileId) },
                        };
                    }
                    return asset;
                }));
                observedAssets.clear();
                assets.forEach((asset) => observedAssets.set(asset.id, asset));
                queuedAssets = assets;
                return { state: { assets }, version: 0 };
            } catch (error) {
                const failure = error instanceof LocalWorkspaceError ? error : new LocalWorkspaceError("读取本地素材失败", "server");
                useLocalWorkspaceStore.setState({ connection: failure.phase === "unavailable" ? "unavailable" : "error", message: failure.message });
                throw failure;
            }
        }
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey) {
                    void ensureImagePreview(asset.data.storageKey);
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                }
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const image = await uploadImage(asset.data.dataUrl);
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, fileId: image.fileId, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        return parsed;
    },
    setItem: (name, value) => {
        if (isLocalWorkspaceMode) {
            if (queuedAssets === value.state.assets) return;
            queuedAssets = value.state.assets;
            persistLocalAssets(value.state.assets);
        }
        return localForageStorage.setItem(name, JSON.stringify(value));
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset, operationId) => {
                if (isLocalWorkspaceMode && !get().hydrated) throw new LocalWorkspaceError("本地素材库尚未读取完成，拒绝写入空列表", "unavailable");
                const id = operationId ? `agent-${operationId}` : nanoid();
                const existing = get().assets.find((item) => item.id === id);
                if (existing) return id;
                const now = new Date().toISOString();
                if (operationId) requestedAssetOperations.set(id, operationId);
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) => {
                if (isLocalWorkspaceMode && !get().hydrated) return;
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                }));
            },
            removeAsset: (id) => {
                if (isLocalWorkspaceMode) {
                    if (!get().hydrated) return;
                    const workspace = useLocalWorkspaceStore.getState().workspace;
                    const queue = assetCommitQueues.get(id);
                    void (async () => {
                        if (!workspace) throw new LocalWorkspaceError("本地工作区尚未连接", "unavailable");
                        if (queue && ["dirty", "saving", "error", "conflict"].includes(queue.snapshot().phase)) await queue.flush();
                        const revision = queue?.snapshot().revision ?? assetRevisions.get(id);
                        if (!revision) throw new LocalWorkspaceError("素材缺少服务端版本，拒绝删除", "invalid");
                        const result = await deleteLocalWorkspaceAsset(id, { workspaceId: workspace.workspaceId, operationId: nanoid(), baseRevision: revision });
                        assetRevisions.set(id, result.revision);
                        observedAssets.delete(id);
                        assetCommitQueues.delete(id);
                        useLocalWorkspaceStore.getState().setSaveState(`asset:${id}`, { phase: "saved", revision: result.revision });
                        set((state) => ({ assets: state.assets.filter((asset) => asset.id !== id) }));
                    })().catch((error) => {
                        const failure = error instanceof LocalWorkspaceError ? error : new LocalWorkspaceError("素材删除失败；素材仍保留", "server");
                        useLocalWorkspaceStore.getState().setSaveState(`asset:${id}`, { phase: failure.phase === "conflict" ? "conflict" : "error", revision: assetRevisions.get(id) ?? null, message: failure.message });
                    });
                    return;
                }
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                });
            },
            replaceAssets: (assets) => {
                if (isLocalWorkspaceMode) return;
                set({ assets });
            },
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                if (!error || !isLocalWorkspaceMode) useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);

export async function flushLocalWorkspaceAsset(id: string, operationId?: string): Promise<WriteResult<Asset>> {
    const workspace = useLocalWorkspaceStore.getState().workspace;
    if (!workspace) throw new LocalWorkspaceError("本地工作区尚未连接", "unavailable");
    const queue = assetCommitQueues.get(id);
    if (!queue) {
        if (operationId) {
            const receipt = await getLocalWorkspaceOperation(operationId, isAsset);
            if (receipt.workspaceId !== workspace.workspaceId || receipt.id !== id || receipt.operationId !== operationId) throw new LocalWorkspaceError("工作区操作回执与素材不一致", "invalid");
            return receipt;
        }
        const envelope = (await listLocalWorkspaceAssets()).find((item) => item.id === id);
        if (!envelope) throw new LocalWorkspaceError("素材未在本地工作区找到", "not-found");
        return { ...envelope, operationId: operationId || "already-persisted" };
    }
    const operationResult = await queue.flush(operationId);
    let result = operationResult;
    while (["dirty", "saving"].includes(queue.snapshot().phase)) result = await queue.flush();
    if (operationId && operationResult.operationId !== operationId) throw new LocalWorkspaceError("工作区未确认 Agent 素材操作的指定 operationId", "invalid");
    return operationId ? operationResult : result;
}

export function getLocalWorkspaceAssetSaveInfo(id: string) {
    const queue = assetCommitQueues.get(id);
    return { revision: queue?.snapshot().revision ?? assetRevisions.get(id) ?? null, operationId: queue?.snapshot().operationId ?? null };
}
