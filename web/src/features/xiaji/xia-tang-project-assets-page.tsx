"use client";

// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapts DramaClaw's project asset workbench to Infinite Canvas and its canvas store.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Modal, Select } from "antd";

import { buildDramaCanvasProjection, type DramaCanvasProjection } from "@/app/(user)/canvas/utils/drama-import";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { AssetFormModal } from "@/components/assets/asset-form-modal";
import { downloadDramaMedia, fetchDramaAssetCatalog, fetchDramaAssetDomain, fetchDramaProjects, type DramaAssetCatalog, type DramaAssetDomainItem, type DramaImportAsset, type DramaImportBeat, type DramaImportEpisode } from "@/services/api/drama-import";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { visibleLocalStudioAssets } from "./local-studio-asset-visibility";
import { WorkbenchView } from "./components/workbench-view";
import { WritebackDialog } from "./components/writeback-dialog";
import { DomainAssetManager } from "./components/domain-asset-manager";
import { VoiceAssetManager } from "./components/voice-asset-manager";
import { CharacterIdentitiesManager } from "./components/character-identities-manager";
import { SceneAssetManager } from "./components/scene-asset-manager";
import { PropReferenceWriteback } from "./components/prop-reference-writeback";
import { PropReferenceGenerationManager } from "./components/prop-reference-generation-manager";
import { ProjectTaskCenter } from "./components/project-task-center";
import type { XiaJiAssetViewState } from "./components/asset-tabs";
import { mapLocalAssetsToDramaAssets } from "./local-assets";
import { prepareDramaAssetSelection } from "./media-bridge";
import { dramaAssetSelectionKey } from "./components/asset-card";
import { mergeProjectionIntoCanvas, nextDramaProjectionOrigin } from "./drama-canvas-helpers";
import { canProjectDramaAsset, filterXiaTangAssets } from "./asset-query";

const INITIAL_VIEW: XiaJiAssetViewState = { view: "library", category: "all", mediaType: "all", tag: "all", query: "" };
const LOCAL_ASSET_CATALOG: DramaAssetCatalog = {
    sourceSnapshot: { projectId: "user-assets", revision: "local" },
    project: { id: "user-assets", title: "我的素材" },
    assets: [],
    warnings: [],
};

function uniqueAssets(assets: DramaImportAsset[]) {
    const unique = new Map<string, DramaImportAsset>();
    for (const asset of filterXiaTangAssets(assets)) unique.set(`${asset.tab}:${asset.id}:${asset.role}:${asset.url || ""}`, asset);
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
    return [...new Set(assets.map((asset) => typeof asset.meta?.category === "string" ? asset.meta.category : "未分类"))]
        .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function XiaTangProjectAssetsPage({ projectId }: { projectId: string }) {
    const { message } = App.useApp();
    const router = useRouter();
    const storedAssets = useAssetStore((state) => state.assets);
    const localAssets = useMemo(() => visibleLocalStudioAssets(storedAssets), [storedAssets]);
    const canvasProjects = useCanvasStore((state) => state.projects);
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const [catalog, setCatalog] = useState<DramaAssetCatalog | null>(null);
    const [projectName, setProjectName] = useState(projectId);
    const [loading, setLoading] = useState(true);
    const [catalogError, setCatalogError] = useState("");
    const [writebackProps, setWritebackProps] = useState<DramaAssetDomainItem[]>([]);
    const [writebackPropsError, setWritebackPropsError] = useState("");
    const [view, setView] = useState<XiaJiAssetViewState>(INITIAL_VIEW);
    const [assetModalOpen, setAssetModalOpen] = useState(false);
    const [taskCenterOpen, setTaskCenterOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<DramaImportAsset | null>(null);
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewError, setPreviewError] = useState("");
    const [writebackAsset, setWritebackAsset] = useState<DramaImportAsset | null>(null);
    const [pendingAssets, setPendingAssets] = useState<DramaImportAsset[]>([]);
    const [selectedAssetKeys, setSelectedAssetKeys] = useState<Set<string>>(() => new Set());
    const [canvasTarget, setCanvasTarget] = useState("new");
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState("");

    const refreshCatalog = async () => {
        setLoading(true);
        setCatalogError("");
        try {
            setCatalog(await fetchDramaAssetCatalog(projectId));
        } catch (cause) {
            setCatalogError(cause instanceof Error ? cause.message : "刷新虾塘素材目录失败");
        } finally {
            setLoading(false);
        }
    };

    const refreshCurrentData = async () => {
        await refreshCatalog();
        if (view.view !== "library" || view.category !== "props") return;
        setWritebackPropsError("");
        try {
            setWritebackProps(await fetchDramaAssetDomain(projectId, "props"));
        } catch (cause) {
            setWritebackPropsError(cause instanceof Error ? cause.message : "刷新虾塘道具失败");
        }
    };

    useEffect(() => {
        let active = true;
        setLoading(true);
        setCatalogError("");
        fetchDramaAssetCatalog(projectId)
            .then((result) => { if (active) setCatalog(result); })
            .catch((cause: unknown) => { if (active) setCatalogError(cause instanceof Error ? cause.message : "读取虾集素材失败"); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [projectId]);

    useEffect(() => {
        if (view.view !== "library" || view.category !== "props") return;
        let active = true;
        setWritebackPropsError("");
        fetchDramaAssetDomain(projectId, "props")
            .then((items) => { if (active) setWritebackProps(items); })
            .catch((cause: unknown) => { if (active) setWritebackPropsError(cause instanceof Error ? cause.message : "读取虾塘道具失败"); });
        return () => { active = false; };
    }, [projectId, view.view, view.category]);

    useEffect(() => {
        let active = true;
        fetchDramaProjects()
            .then((projects) => {
                if (active) setProjectName(projects.find((project) => project.id === projectId)?.name || projectId);
            })
            .catch(() => { if (active) setProjectName(projectId); });
        return () => { active = false; };
    }, [projectId]);

    const mappedLocalAssets = useMemo(() => mapLocalAssetsToDramaAssets(localAssets), [localAssets]);
    const libraryAssets = useMemo(() => uniqueAssets(catalog?.assets || []), [catalog]);
    const assets = view.view === "mine" ? mappedLocalAssets : libraryAssets;
    const selectedAssets = useMemo(() => libraryAssets.filter((asset) => canProjectDramaAsset(asset) && selectedAssetKeys.has(dramaAssetSelectionKey(asset))), [libraryAssets, selectedAssetKeys]);
    const tags = useMemo(() => tagsFromAssets(assets), [assets]);
    const categories = view.view === "mine"
        ? localCategories(mappedLocalAssets)
        : ["characters", "scenes", "props", "voices"];
    const domainManager = view.view !== "library" ? null
        : view.category === "characters" ? <><DomainAssetManager projectId={projectId} domain="characters" /><CharacterIdentitiesManager projectId={projectId} /></>
            : view.category === "scenes" ? <SceneAssetManager projectId={projectId} />
                : view.category === "props" ? <>
                    <DomainAssetManager projectId={projectId} domain="props" />
                    <PropReferenceGenerationManager
                        projectId={projectId}
                        props={writebackProps.flatMap((item) => typeof item.name === "string" ? [{ name: item.name }] : [])}
                    />
                    {writebackPropsError ? <Alert type="error" showIcon message="读取道具写回目标失败" description={writebackPropsError} /> : null}
                    <PropReferenceWriteback
                        projectId={projectId}
                        props={writebackProps.flatMap((item) => typeof item.name === "string" ? [{ name: item.name }] : [])}
                        onComplete={() => {
                            void refreshCurrentData();
                        }}
                    />
                </>
                    : view.category === "voices" ? <VoiceAssetManager projectId={projectId} />
                        : null;

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
            .catch((cause: unknown) => { if (!disposed) setPreviewError(cause instanceof Error ? cause.message : "素材预览失败"); });
        return () => {
            disposed = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [previewAsset]);

    const sendAsset = async () => {
        if (!pendingAssets.length) return;
        const state = useCanvasStore.getState();
        if (!state.hydrated) return setSendError("画布资料仍在读取，请稍后再试");
        const targetProject = canvasTarget === "new" ? null : state.projects.find((project) => project.id === canvasTarget) || null;
        if (canvasTarget !== "new" && !targetProject) return setSendError("目标画布已不存在，请重新选择");
        const sourceCatalog = pendingAssets.every((asset) => asset.meta?.sourceSystem === "infinite-canvas") ? LOCAL_ASSET_CATALOG : catalog;
        if (!sourceCatalog) return setSendError("虾集素材目录尚未读取完成");

        setSending(true);
        setSendError("");
        try {
            const prepared = await prepareDramaAssetSelection(pendingAssets, {
                download: downloadDramaMedia,
                uploadImage,
                uploadMedia: uploadMediaFile,
            });
            if (!prepared.ready.length) {
                setSendError(prepared.failed[0]?.message || "所选素材没有可导入项");
                return;
            }
            const origin = targetProject ? nextDramaProjectionOrigin(targetProject.nodes) : { x: 0, y: 0 };
            const projection: DramaCanvasProjection = buildDramaCanvasProjection({ catalog: sourceCatalog, assets: prepared.ready, origin });
            if (targetProject) {
                state.updateProject(targetProject.id, mergeProjectionIntoCanvas(targetProject.nodes, targetProject.connections, projection));
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
            if (prepared.failed.length) message.warning(`${prepared.ready.length} 项已发送，${prepared.failed.length} 项转存失败并留在选择列表`);
            else message.success(`已发送 ${prepared.ready.length} 项素材到虾画`);
            setSelectedAssetKeys(new Set(prepared.failed.map(({ asset }) => dramaAssetSelectionKey(asset))));
            setPendingAssets([]);
        } catch (cause) {
            setSendError(cause instanceof Error ? cause.message : "发送到虾画失败");
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
        onSendAsset: (asset: DramaImportAsset) => { setCanvasTarget("new"); setSendError(""); setPendingAssets([asset]); },
        onWritebackAsset: (asset: DramaImportAsset) => setWritebackAsset(asset),
        onSelectEpisode: (_episode: number | null) => undefined,
        onSelectBeat: (_beat: number | null) => undefined,
        onSendEpisode: (_episode: DramaImportEpisode) => undefined,
        onSendBeat: (_beat: DramaImportBeat) => undefined,
    };
    const toggleAssetSelection = (asset: DramaImportAsset) => {
        const key = dramaAssetSelectionKey(asset);
        setSelectedAssetKeys((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };
    const requestSendSelectedAssets = () => {
        if (!selectedAssets.length) return;
        setCanvasTarget("new");
        setSendError("");
        setPendingAssets(selectedAssets);
    };
    const previewText = typeof previewAsset?.meta?.content === "string"
        ? previewAsset.meta.content
        : typeof previewAsset?.meta?.text === "string" ? previewAsset.meta.text : previewAsset?.label || "";

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
            <section className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-card/40 px-5 py-3">
                <Button type="text" onClick={() => router.push("/xiaji")}>返回虾集项目</Button>
                <Button onClick={() => void refreshCurrentData()} loading={loading}>刷新素材</Button>
                <Button onClick={() => setTaskCenterOpen(true)}>虾集任务中心</Button>
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{projectName}</p>
                    <p className="text-xs text-muted-foreground">{catalog ? `${libraryAssets.length} 项素材` : loading ? "正在读取项目素材…" : "DramaClaw 项目"}</p>
                </div>
            </section>

            {view.view === "library" ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <WorkbenchView catalog={catalog} assets={libraryAssets} state={view} tags={tags} categories={categories} domainManager={domainManager} showAdd={false} showSourceBrowser={false} selectionMode selectedAssetKeys={selectedAssetKeys} onToggleAssetSelection={toggleAssetSelection} loading={loading} error={catalogError} actions={actions} />
                    {selectedAssets.length ? <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card px-5 py-3">
                        <p className="text-sm text-muted-foreground">已选 {selectedAssets.length} 项素材</p>
                        <div className="flex gap-2">
                            <Button onClick={() => setSelectedAssetKeys(new Set())} disabled={sending}>清空选择</Button>
                            <Button type="primary" onClick={requestSendSelectedAssets} disabled={sending}>发送所选到虾画</Button>
                        </div>
                    </div> : null}
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-hidden">
                    <WorkbenchView catalog={catalog} assets={mappedLocalAssets} state={view} tags={tags} categories={categories} showSourceBrowser={false} loading={false} error="" actions={actions} />
                </div>
            )}

            <AssetFormModal open={assetModalOpen} onClose={() => setAssetModalOpen(false)} />
            <WritebackDialog open={Boolean(writebackAsset)} onClose={() => setWritebackAsset(null)} initialProjectId={projectId} initialAsset={writebackAsset} availableAssets={libraryAssets} />
            <Modal title={previewAsset?.label || "素材预览"} open={Boolean(previewAsset)} footer={null} onCancel={() => setPreviewAsset(null)} destroyOnHidden>
                {previewError ? <p role="alert" className="text-sm text-destructive">{previewError}</p> : null}
                {previewAsset?.mediaType === "text" ? <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-sm">{previewText}</pre> : null}
                {previewAsset?.mediaType === "image" && previewUrl ? <img src={previewUrl} alt={previewAsset.label} className="mx-auto max-h-[70vh] max-w-full object-contain" /> : null}
                {previewAsset?.mediaType === "video" && previewUrl ? <video src={previewUrl} controls className="max-h-[70vh] w-full" /> : null}
                {previewAsset?.mediaType === "audio" && previewUrl ? <audio src={previewUrl} controls className="w-full" /> : null}
                {previewAsset && previewAsset.mediaType !== "text" && !previewUrl && !previewError ? <p className="py-8 text-center text-sm text-muted-foreground">正在加载素材预览…</p> : null}
            </Modal>
            <Modal title="虾集任务中心" open={taskCenterOpen} footer={null} width={1040} onCancel={() => setTaskCenterOpen(false)} destroyOnHidden>
                <div className="max-h-[72vh] overflow-y-auto p-1">
                    <ProjectTaskCenter projectId={projectId} />
                </div>
            </Modal>
            <Modal
                open={pendingAssets.length > 0}
                title={pendingAssets.length > 1 ? `发送 ${pendingAssets.length} 项到虾画` : "发送到虾画"}
                okText="发送并打开画布"
                cancelText="取消"
                onOk={sendAsset}
                onCancel={() => { if (!sending) setPendingAssets([]); }}
                confirmLoading={sending}
                okButtonProps={{ disabled: !canvasHydrated }}
                destroyOnHidden
            >
                <div className="space-y-3">
                    <p className="text-sm">选择新建画布，或把素材加入已有画布。已有节点和连线会保留。</p>
                    <Select
                        className="w-full"
                        aria-label="目标虾画"
                        value={canvasTarget}
                        onChange={setCanvasTarget}
                        options={[{ value: "new", label: "新建虾画" }, ...canvasProjects.map((project) => ({ value: project.id, label: project.title }))]}
                    />
                    {sendError ? <p role="alert" className="text-sm text-destructive">{sendError}</p> : null}
                </div>
            </Modal>
        </div>
    );
}
