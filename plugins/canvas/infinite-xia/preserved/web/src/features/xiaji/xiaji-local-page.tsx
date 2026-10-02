// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapts DramaClaw's standalone XiaTang workbench to Infinite Canvas local assets.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Input, Modal, Select } from "antd";
import { Clapperboard, Plus, Send, X } from "lucide-react";

import { AssetFormModal } from "@/components/assets/asset-form-modal";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { visibleLocalStudioAssets } from "./local-studio-asset-visibility";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { LocalAssetWorkbench } from "./local-asset-workbench";
import type { XiaJiAssetViewState } from "./components/asset-tabs";
import { buildLocalAssetNodes, nextAssetImportOrigin, sendLocalAssetsToCanvas } from "./send-to-canvas";

const INITIAL_VIEW: XiaJiAssetViewState = { view: "mine", category: "all", mediaType: "all", tag: "all", query: "" };

function previewSource(asset: Asset) {
    if (asset.kind === "image") return asset.data.dataUrl;
    if (asset.kind === "video" || asset.kind === "audio") return asset.data.url;
    return "";
}

function AssetPreview({ asset }: { asset: Asset }) {
    if (asset.kind === "text") return <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-4 text-sm">{asset.data.content || "（空文本）"}</pre>;
    const src = previewSource(asset);
    if (!src) return <p className="py-12 text-center text-sm text-muted-foreground">本地媒体引用不可用</p>;
    if (asset.kind === "image") return <img src={src} alt={asset.title} className="mx-auto max-h-[70vh] max-w-full object-contain" />;
    if (asset.kind === "video") return <video src={src} controls className="mx-auto max-h-[70vh] max-w-full" />;
    return <audio src={src} controls className="w-full" />;
}

export function XiaJiLocalPage() {
    const router = useRouter();
    const { message } = App.useApp();
    const storedAssets = useAssetStore((store) => store.assets);
    const assets = useMemo(() => visibleLocalStudioAssets(storedAssets), [storedAssets]);
    const assetWorkspaceError = useAssetStore((store) => store.workspaceError);
    const canvases = useCanvasStore((store) => store.projects);
    const canvasHydrated = useCanvasStore((store) => store.hydrated);
    const [assetsHydrated, setAssetsHydrated] = useState(() => useAssetStore.persist.hasHydrated());
    const [view, setView] = useState(INITIAL_VIEW);
    const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set());
    const [assetModalOpen, setAssetModalOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [sendAssetIds, setSendAssetIds] = useState<string[]>([]);
    const [sendDialogOpen, setSendDialogOpen] = useState(false);
    const [targetCanvasId, setTargetCanvasId] = useState("new");
    const [newCanvasTitle, setNewCanvasTitle] = useState("");
    const [pendingNewCanvasId, setPendingNewCanvasId] = useState("");
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState("");

    useEffect(() => {
        if (useAssetStore.persist.hasHydrated()) {
            setAssetsHydrated(true);
            return;
        }
        return useAssetStore.persist.onFinishHydration(() => setAssetsHydrated(true));
    }, []);

    const sendAssets = useMemo(() => assets.filter((asset) => sendAssetIds.includes(asset.id)), [assets, sendAssetIds]);

    const beginSend = (ids: string[]) => {
        const chosen = assets.filter((asset) => ids.includes(asset.id));
        if (!chosen.length) {
            message.info("请先选择素材");
            return;
        }
        setSendAssetIds(chosen.map((asset) => asset.id));
        setTargetCanvasId("new");
        setPendingNewCanvasId("");
        setNewCanvasTitle(chosen.length === 1 ? `虾塘素材 · ${chosen[0].title}` : `虾塘素材 · ${chosen.length} 项`);
        setSendError("");
        setSendDialogOpen(true);
    };

    const toggleAssetSelection = (asset: Asset) => {
        setSelectedAssetIds((current) => {
            const next = new Set(current);
            if (next.has(asset.id)) next.delete(asset.id);
            else next.add(asset.id);
            return next;
        });
    };

    const sendToCanvas = async () => {
        if (sending) return;
        if (!canvasHydrated) {
            setSendError("虾画正在读取本地画布，请稍后再试");
            return;
        }
        if (!assetsHydrated) {
            setSendError("虾塘正在读取本地素材，请稍后再试");
            return;
        }
        const currentAssets = useAssetStore.getState().assets.filter((asset) => sendAssetIds.includes(asset.id));
        const projection = buildLocalAssetNodes(currentAssets);
        if (!projection.nodes.length) {
            setSendError(projection.skippedAssets[0]?.reason || "没有可加入画布的素材");
            return;
        }

        setSending(true);
        setSendError("");
        let projectId = targetCanvasId;
        try {
            const canvasStore = useCanvasStore.getState();
            if (targetCanvasId === "new") {
                projectId = pendingNewCanvasId || canvasStore.createProject(newCanvasTitle.trim() || "虾塘素材");
                setPendingNewCanvasId(projectId);
            }
            const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
            if (!project) throw new Error("目标画布已不存在，请重新选择");

            const result = await sendLocalAssetsToCanvas({
                project,
                assets: currentAssets,
                origin: nextAssetImportOrigin(project.nodes),
                saveProject: (patch) => useCanvasStore.getState().saveProjectAndWait(project.id, patch),
            });
            const details = [
                result.insertedAssetIds.length ? `新增 ${result.insertedAssetIds.length} 项` : "没有新增节点",
                result.duplicateAssetIds.length ? `已存在 ${result.duplicateAssetIds.length} 项` : "",
                result.skippedAssets.length ? `跳过 ${result.skippedAssets.length} 项` : "",
            ].filter(Boolean).join("，");
            if (result.skippedAssets.length) message.warning(details);
            else if (result.insertedAssetIds.length) message.success(`已发送到虾画：${details}`);
            else message.info(`素材已在目标画布：${details}`);

            setSelectedAssetIds(new Set());
            setSendDialogOpen(false);
            setSendAssetIds([]);
            setPendingNewCanvasId("");
            router.push(`/canvas/${project.id}`);
        } catch (cause) {
            setSendError(cause instanceof Error ? cause.message : "保存画布失败；素材仍保留在选择中");
        } finally {
            setSending(false);
        }
    };

    const canvasesLoading = !canvasHydrated;

    return (
        <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
            <header className="shrink-0 border-b border-border/60 bg-card/30 px-6 py-6 lg:px-9">
                <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-5">
                    <div>
                        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"><Clapperboard aria-hidden="true" className="size-4" />影视素材工作台</p>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight">虾塘</h1>
                        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">浏览和整理本地素材；选中后直接发送到虾画。</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {selectedAssetIds.size ? <Button icon={<Send className="size-4" />} onClick={() => beginSend([...selectedAssetIds])}>发送所选到虾画（{selectedAssetIds.size}）</Button> : null}
                        <Button icon={<Plus className="size-4" />} onClick={() => setAssetModalOpen(true)}>添加素材</Button>
                    </div>
                </div>
            </header>

            {assetWorkspaceError ? <div role="alert" className="m-5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{assetWorkspaceError}</div> : null}
            <LocalAssetWorkbench
                assets={assets}
                state={view}
                selectedAssetIds={selectedAssetIds}
                selectionMode={false}
                loading={!assetsHydrated}
                error=""
                onStateChange={(patch) => setView((current) => ({ ...current, ...patch }))}
                onAdd={() => setAssetModalOpen(true)}
                onPreview={setPreviewAsset}
                onSend={(asset) => beginSend([asset.id])}
                onToggleSelection={toggleAssetSelection}
            />

            <AssetFormModal open={assetModalOpen} onClose={() => setAssetModalOpen(false)} />
            <Modal
                title={`预览素材 · ${previewAsset?.title || ""}`}
                open={Boolean(previewAsset)}
                footer={null}
                onCancel={() => setPreviewAsset(null)}
                destroyOnHidden
            >
                {previewAsset ? <AssetPreview asset={previewAsset} /> : null}
            </Modal>
            <Modal
                title="发送到虾画"
                open={sendDialogOpen}
                confirmLoading={sending}
                okText="发送并打开"
                cancelText="取消"
                onOk={() => void sendToCanvas()}
                onCancel={() => { if (!sending) setSendDialogOpen(false); }}
                destroyOnHidden={false}
            >
                <div className="space-y-4 py-2">
                    <p className="text-sm text-muted-foreground">已选择 {sendAssets.length} 项本地素材；媒体引用会沿用 Infinite Canvas 已保存的文件。</p>
                    <label className="grid gap-1.5 text-sm">
                        目标画布
                        <Select
                            aria-label="目标画布"
                            value={targetCanvasId}
                            loading={canvasesLoading}
                            disabled={sending || canvasesLoading}
                            onChange={(value) => {
                                setTargetCanvasId(value);
                                setPendingNewCanvasId("");
                            }}
                            options={[
                                { value: "new", label: "新建画布" },
                                ...canvases.map((canvas) => ({ value: canvas.id, label: canvas.title })),
                            ]}
                        />
                    </label>
                    {targetCanvasId === "new" ? <label className="grid gap-1.5 text-sm">
                        新画布名称
                        <Input aria-label="新画布名称" value={newCanvasTitle} maxLength={100} onChange={(event) => setNewCanvasTitle(event.target.value)} />
                    </label> : null}
                    {sendError ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{sendError}</div> : null}
                    {sendAssets.length ? <ul className="max-h-36 space-y-1 overflow-auto rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
                        {sendAssets.map((asset) => <li key={asset.id} className="flex items-center justify-between gap-2"><span className="truncate">{asset.title}</span><button type="button" disabled={sending} aria-label={`移除 ${asset.title}`} onClick={() => setSendAssetIds((ids) => ids.filter((id) => id !== asset.id))}><X className="size-3.5" /></button></li>)}
                    </ul> : <p role="alert" className="text-sm text-destructive">所选素材已不存在，请关闭窗口后重新选择。</p>}
                </div>
            </Modal>
        </main>
    );
}
