"use client";

// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapts DramaClaw's categorized asset workbench to the Infinite Canvas stores and routes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Input, Modal, Select } from "antd";

import { buildDramaCanvasProjection, type DramaCanvasProjection } from "@/app/(user)/canvas/utils/drama-import";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { AssetFormModal } from "@/components/assets/asset-form-modal";
import { downloadDramaMedia, fetchDramaImportCatalog, fetchDramaProjects, type DramaImportAsset, type DramaImportCatalog, type DramaImportBeat, type DramaImportEpisode } from "@/services/api/drama-import";
import { useAssetStore } from "@/stores/use-asset-store";
import { visibleLocalStudioAssets } from "./local-studio-asset-visibility";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { WorkbenchView } from "./components/workbench-view";
import { WritebackDialog } from "./components/writeback-dialog";
import type { XiaJiAssetViewState } from "./components/asset-tabs";
import { mapLocalAssetsToDramaAssets } from "./local-assets";
import { prepareDramaAsset, prepareDramaEpisodeMedia } from "./media-bridge";
import { mergeProjectionIntoCanvas, nextDramaProjectionOrigin } from "./drama-canvas-helpers";

type PendingSelection =
    | { kind: "asset"; asset: DramaImportAsset }
    | { kind: "episode"; episode: DramaImportEpisode }
    | { kind: "beat"; episode: DramaImportEpisode; beat: DramaImportBeat };

const INITIAL_VIEW: XiaJiAssetViewState = { view: "library", category: "all", mediaType: "all", tag: "all", query: "" };
const LOCAL_ASSET_CATALOG: DramaImportCatalog = {
    sourceSnapshot: { projectId: "user-assets", revision: "local" },
    project: { id: "user-assets", title: "我的素材" },
    episodes: [],
    assets: [],
    beatContextAssets: [],
    warnings: [],
};

function uniqueAssets(assets: DramaImportAsset[]) {
    const unique = new Map<string, DramaImportAsset>();
    for (const asset of assets) unique.set(`${asset.tab}:${asset.id}:${asset.role}:${asset.url || ""}`, asset);
    return [...unique.values()];
}

function tagsFromAssets(assets: DramaImportAsset[]) {
    const tags = new Set<string>();
    for (const asset of assets) {
        const value = asset.meta?.tags;
        if (Array.isArray(value)) value.forEach((tag) => typeof tag === "string" && tags.add(tag));
        else if (typeof value === "string") value.split(/[，,、]/).map((tag) => tag.trim()).filter(Boolean).forEach((tag) => tags.add(tag));
    }
    return [...tags].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function localCategories(assets: DramaImportAsset[]) {
    return [...new Set(assets.map((asset) => typeof asset.meta?.category === "string" ? asset.meta.category : "未分类"))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function XiaJiClientPage({
    projectId,
    projectName,
    showProjectSelector = true,
}: {
    projectId?: string;
    projectName?: string;
    showProjectSelector?: boolean;
} = {}) {
    const { message } = App.useApp();
    const router = useRouter();
    const storedAssets = useAssetStore((state) => state.assets);
    const localAssets = useMemo(() => visibleLocalStudioAssets(storedAssets), [storedAssets]);
    const canvasProjects = useCanvasStore((state) => state.projects);
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const [assetModalOpen, setAssetModalOpen] = useState(false);
    const [catalog, setCatalog] = useState<DramaImportCatalog | null>(null);
    const [projectInput, setProjectInput] = useState(projectId || "");
    const [sourceProjectId, setSourceProjectId] = useState(projectId || "");
    const [resolvedProjectName, setResolvedProjectName] = useState(projectName || "");
    const [loadRevision, setLoadRevision] = useState(0);
    const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
    const [selectedBeat, setSelectedBeat] = useState<number | null>(null);
    const [view, setView] = useState<XiaJiAssetViewState>(INITIAL_VIEW);
    const [loading, setLoading] = useState(false);
    const [catalogError, setCatalogError] = useState("");
    const [previewAsset, setPreviewAsset] = useState<DramaImportAsset | null>(null);
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewError, setPreviewError] = useState("");
    const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
    const [sending, setSending] = useState(false);
    const [canvasTarget, setCanvasTarget] = useState("new");
    const [sendError, setSendError] = useState("");
    const [writebackAsset, setWritebackAsset] = useState<DramaImportAsset | null>(null);
    const requestSequence = useRef(0);

    useEffect(() => {
        if (!projectId) return;
        setProjectInput(projectId);
        setSourceProjectId(projectId);
        setResolvedProjectName(projectName || "");
        setCatalog(null);
        setSelectedEpisode(null);
        setSelectedBeat(null);
    }, [projectId, projectName]);

    useEffect(() => {
        if (!projectId || projectName) return;
        let active = true;
        fetchDramaProjects()
            .then((projects) => {
                if (active) setResolvedProjectName(projects.find((project) => project.id === projectId)?.name || projectId);
            })
            .catch(() => {
                if (active) setResolvedProjectName(projectId);
            });
        return () => { active = false; };
    }, [projectId, projectName]);

    const mappedLocalAssets = useMemo(() => mapLocalAssetsToDramaAssets(localAssets), [localAssets]);
    const libraryAssets = useMemo(() => uniqueAssets([
        ...(catalog?.assets || []),
        ...(selectedEpisode === null ? [] : catalog?.beatContextAssets || []),
    ]), [catalog, selectedEpisode]);
    const assets = view.view === "mine" ? mappedLocalAssets : libraryAssets;
    const tags = useMemo(() => tagsFromAssets(assets), [assets]);
    const categories = view.view === "mine" ? localCategories(mappedLocalAssets) : ["characters", "scenes", "props", "voices", "beats"];

    useEffect(() => {
        if (!sourceProjectId) return;
        const requestId = ++requestSequence.current;
        setLoading(true);
        setCatalogError("");
        fetchDramaImportCatalog(sourceProjectId, selectedEpisode ?? undefined, selectedBeat ?? undefined)
            .then((result) => {
                if (requestSequence.current === requestId) setCatalog(result);
            })
            .catch((error: unknown) => {
                if (requestSequence.current === requestId) setCatalogError(error instanceof Error ? error.message : "读取虾集目录失败");
            })
            .finally(() => {
                if (requestSequence.current === requestId) setLoading(false);
            });
        return () => {
            if (requestSequence.current === requestId) requestSequence.current += 1;
        };
    }, [sourceProjectId, selectedEpisode, selectedBeat, loadRevision]);

    useEffect(() => {
        setPreviewUrl("");
        setPreviewError("");
        if (!previewAsset || previewAsset.mediaType === "text" || !previewAsset.url) return;
        let disposed = false;
        let objectUrl = "";
        downloadDramaMedia(previewAsset.url)
            .then((blob) => {
                objectUrl = URL.createObjectURL(blob);
                if (disposed) URL.revokeObjectURL(objectUrl);
                else setPreviewUrl(objectUrl);
            })
            .catch((error: unknown) => {
                if (!disposed) setPreviewError(error instanceof Error ? error.message : "素材预览失败");
            });
        return () => {
            disposed = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [previewAsset]);

    const loadProject = useCallback(() => {
        const projectId = projectInput.trim();
        if (!projectId) {
            setCatalogError("请输入 DramaClaw 项目 ID");
            return;
        }
        setCatalog(null);
        setSelectedEpisode(null);
        setSelectedBeat(null);
        setSourceProjectId(projectId);
        setLoadRevision((current) => current + 1);
    }, [projectInput]);

    const requestSend = (selection: PendingSelection) => {
        setCanvasTarget("new");
        setSendError("");
        setPendingSelection(selection);
    };

    const confirmSend = async () => {
        if (!pendingSelection) return;
        const state = useCanvasStore.getState();
        if (!state.hydrated) {
            setSendError("画布资料仍在读取，请稍后再试");
            return;
        }
        const targetProject = canvasTarget === "new" ? null : state.projects.find((project) => project.id === canvasTarget) || null;
        if (canvasTarget !== "new" && !targetProject) {
            setSendError("目标画布已不存在，请重新选择");
            return;
        }

        setSending(true);
        try {
            const sourceCatalog = catalog || LOCAL_ASSET_CATALOG;
            const origin = targetProject ? nextDramaProjectionOrigin(targetProject.nodes) : { x: 0, y: 0 };
            const mediaStorage = {
                download: downloadDramaMedia,
                uploadImage,
                uploadMedia: uploadMediaFile,
            };
            let projection: DramaCanvasProjection;
            let failedMediaCount = 0;
            if (pendingSelection.kind === "asset") {
                const asset = await prepareDramaAsset(pendingSelection.asset, mediaStorage);
                projection = buildDramaCanvasProjection({ catalog: sourceCatalog, assets: [asset], origin });
                if (asset.meta?.sourceSystem === "infinite-canvas") {
                    projection = { ...projection, title: `我的素材 · ${asset.label}` };
                }
            } else {
                const episode = pendingSelection.kind === "episode"
                    ? pendingSelection.episode
                    : { ...pendingSelection.episode, beats: [pendingSelection.beat], beatCount: 1 };
                const prepared = await prepareDramaEpisodeMedia(episode, mediaStorage);
                failedMediaCount = prepared.failedMediaCount;
                projection = buildDramaCanvasProjection({ catalog: sourceCatalog, episode: prepared.episode, mediaByBeat: prepared.mediaByBeat, origin });
            }

            if (targetProject) {
                const merged = mergeProjectionIntoCanvas(targetProject.nodes, targetProject.connections, projection);
                state.updateProject(targetProject.id, merged);
                router.push(`/canvas/${targetProject.id}`);
            } else {
                const id = state.createProject(projection.title);
                state.updateProject(id, {
                    nodes: projection.nodes,
                    connections: projection.connections,
                    backgroundMode: projection.backgroundMode,
                    showImageInfo: projection.showImageInfo,
                    autoTitlePending: false,
                });
                router.push(`/canvas/${id}`);
            }
            if (failedMediaCount) message.warning(`内容已导入；${failedMediaCount} 个源媒体未能拉取，已从画布投影中略过。`);
            setPendingSelection(null);
        } catch (error) {
            setSendError(error instanceof Error ? error.message : "发送到虾画失败");
        } finally {
            setSending(false);
        }
    };

    const actions = {
        onViewChange: (patch: Partial<XiaJiAssetViewState>) => setView((current) => ({
            ...current,
            ...patch,
            ...(patch.view && patch.view !== current.view ? { category: "all", mediaType: "all", tag: "all", query: "" } : {}),
        })),
        onAdd: () => setAssetModalOpen(true),
        onPreviewAsset: (asset: DramaImportAsset) => setPreviewAsset(asset),
        onSendAsset: (asset: DramaImportAsset) => requestSend({ kind: "asset", asset }),
        onWritebackAsset: (asset: DramaImportAsset) => setWritebackAsset(asset),
        onSelectEpisode: (episode: number | null) => {
            setSelectedEpisode(episode);
            setSelectedBeat(null);
            setCatalog((current) => current ? { ...current, beatContextAssets: [] } : current);
        },
        onSelectBeat: (beat: number | null) => {
            setSelectedBeat(beat);
            setCatalog((current) => current ? { ...current, beatContextAssets: [] } : current);
        },
        onSendEpisode: (episode: DramaImportEpisode) => requestSend({ kind: "episode", episode }),
        onSendBeat: (beat: DramaImportBeat) => {
            const episode = catalog?.episodes.find((item) => item.number === beat.episode);
            if (episode) requestSend({ kind: "beat", episode, beat });
        },
    };
    const previewText = typeof previewAsset?.meta?.content === "string"
        ? previewAsset.meta.content
        : typeof previewAsset?.meta?.text === "string" ? previewAsset.meta.text : previewAsset?.label || "";

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
            {showProjectSelector ? (
                <section className="shrink-0 border-b border-border/60 bg-card/40 px-5 py-3">
                    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); loadProject(); }}>
                        <label className="grid min-w-64 flex-1 gap-1 text-xs text-muted-foreground">
                            DramaClaw 项目 ID
                            <Input value={projectInput} onChange={(event) => setProjectInput(event.target.value)} placeholder="输入虾集项目 ID" onPressEnter={loadProject} />
                        </label>
                        <Button type="primary" loading={loading} onClick={loadProject}>读取虾集项目</Button>
                        {catalog ? <span className="pb-2 text-xs text-muted-foreground">当前项目：{catalog.project.title} · {catalog.episodes.length} 集</span> : null}
                    </form>
                </section>
            ) : (
                <section className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-card/40 px-5 py-3">
                    <Button type="text" onClick={() => router.push("/xiaji")}>返回虾集项目</Button>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{resolvedProjectName || catalog?.project.title || projectId || "虾集项目"}</p>
                        <p className="text-xs text-muted-foreground">{catalog ? `${catalog.episodes.length} 集 · ${libraryAssets.length} 项素材` : loading ? "正在读取项目素材…" : "DramaClaw 项目"}</p>
                    </div>
                </section>
            )}

            {view.view === "library" ? (
                <div className="min-h-0 flex-1 overflow-hidden">
                    <WorkbenchView
                        catalog={catalog}
                        assets={libraryAssets}
                        state={view}
                        tags={tags}
                        categories={categories}
                        selectedEpisode={selectedEpisode}
                        selectedBeat={selectedBeat}
                        loading={loading}
                        error={catalogError}
                        actions={actions}
                    />
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-hidden">
                    <WorkbenchView
                        catalog={catalog}
                        assets={mappedLocalAssets}
                        state={view}
                        tags={tags}
                        categories={categories}
                        showAdd
                        showSourceBrowser={false}
                        loading={false}
                        error=""
                        actions={actions}
                    />
                </div>
            )}

            <AssetFormModal open={assetModalOpen} onClose={() => setAssetModalOpen(false)} />
            <WritebackDialog
                open={Boolean(writebackAsset)}
                onClose={() => setWritebackAsset(null)}
                initialProjectId={sourceProjectId}
                initialAsset={writebackAsset}
                availableAssets={libraryAssets}
            />
            <Modal title={previewAsset?.label || "素材预览"} open={Boolean(previewAsset)} footer={null} onCancel={() => setPreviewAsset(null)} destroyOnHidden>
                {previewError ? <p role="alert" className="text-sm text-destructive">{previewError}</p> : null}
                {previewAsset?.mediaType === "text" ? <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-sm">{previewText}</pre> : null}
                {previewAsset?.mediaType === "image" && previewUrl ? <img src={previewUrl} alt={previewAsset.label} className="mx-auto max-h-[70vh] max-w-full object-contain" /> : null}
                {previewAsset?.mediaType === "video" && previewUrl ? <video src={previewUrl} controls className="max-h-[70vh] w-full" /> : null}
                {previewAsset?.mediaType === "audio" && previewUrl ? <audio src={previewUrl} controls className="w-full" /> : null}
                {previewAsset && previewAsset.mediaType !== "text" && !previewUrl && !previewError ? <p className="py-8 text-center text-sm text-muted-foreground">正在加载素材预览…</p> : null}
            </Modal>
            <Modal
                title="发送到虾画"
                open={Boolean(pendingSelection)}
                okText="发送并打开画布"
                cancelText="取消"
                onOk={confirmSend}
                onCancel={() => setPendingSelection(null)}
                confirmLoading={sending}
                okButtonProps={{ disabled: !canvasHydrated }}
                destroyOnHidden
            >
                <div className="space-y-3">
                    <p className="text-sm">选择新建画布，或把内容加入已有画布。已有节点和连线会保留。</p>
                    <Select
                        className="w-full"
                        value={canvasTarget}
                        onChange={setCanvasTarget}
                        options={[
                            { value: "new", label: "新建虾画" },
                            ...canvasProjects.map((project) => ({ value: project.id, label: project.title })),
                        ]}
                    />
                    {sendError ? <p role="alert" className="text-sm text-destructive">{sendError}</p> : null}
                </div>
            </Modal>
        </div>
    );
}
