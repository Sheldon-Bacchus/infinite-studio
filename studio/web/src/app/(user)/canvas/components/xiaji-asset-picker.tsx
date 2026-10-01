// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapts DramaClaw's XiaTang picker to Infinite Canvas's local Asset store.
"use client";

import { useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Input, Modal, Tag } from "antd";
import { Image as ImageIcon, Mic, Search, Video } from "lucide-react";

import type { XiaJiAssetViewState } from "@/features/xiaji/components/asset-tabs";
import type { LocalAssetSendResult } from "@/features/xiaji/send-to-canvas";
import { getXiaTangRecord, type XiaTangDomain } from "@/features/xiaji/xia-tang-local-model";
import { listXiaTangPickerAssetsForProject } from "@/features/xiaji/xia-tang-picker-model";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { visibleLocalStudioAssets } from "@/features/xiaji/local-studio-asset-visibility";
import type { Position } from "../types";

type Props = {
    open: boolean;
    projectAssetId?: string;
    onClose: () => void;
    getImportOrigin: () => Position;
    onImport: (assets: Asset[], origin: Position) => Promise<LocalAssetSendResult>;
};

const DOMAINS: Array<{ key: XiaTangDomain; label: string }> = [
    { key: "character", label: "角色" },
    { key: "scene", label: "场景" },
    { key: "prop", label: "道具" },
    { key: "voice", label: "声线" },
];
const INITIAL_VIEW: XiaJiAssetViewState = { view: "mine", category: "all", mediaType: "all", tag: "all", query: "" };

function assetTitle(asset: Asset) {
    const fields = getXiaTangRecord(asset)?.fields || {};
    const value = fields.name ?? fields.identity_name;
    return typeof value === "string" && value.trim() ? value : asset.title;
}

function AssetPreview({ asset }: { asset: Asset }) {
    if (asset.kind === "text") return <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-4 text-sm">{asset.data.content || "（空文本）"}</pre>;
    const src = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
    if (!src) return <p className="py-12 text-center text-sm text-muted-foreground">本地媒体引用不可用</p>;
    if (asset.kind === "image") return <img src={src} alt={asset.title} className="mx-auto max-h-[70vh] max-w-full object-contain" />;
    if (asset.kind === "video") return <video src={src} controls className="mx-auto max-h-[70vh] max-w-full" />;
    return <audio src={src} controls className="w-full" />;
}

function AssetKindIcon({ asset }: { asset: Asset }) {
    if (asset.kind === "image") return <ImageIcon className="size-4" />;
    if (asset.kind === "video") return <Video className="size-4" />;
    if (asset.kind === "audio") return <Mic className="size-4" />;
    return null;
}

export function XiaJiAssetPicker({ open, projectAssetId, onClose, getImportOrigin, onImport }: Props) {
    const { message } = App.useApp();
    const storedAssets = useAssetStore((store) => store.assets);
    const assets = useMemo(() => visibleLocalStudioAssets(storedAssets), [storedAssets]);
    const workspaceError = useAssetStore((store) => store.workspaceError);
    const [hydrated, setHydrated] = useState(() => useAssetStore.persist.hasHydrated());
    const [activeDomain, setActiveDomain] = useState<XiaTangDomain>("character");
    const [view, setView] = useState(INITIAL_VIEW);
    const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set());
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const filteredAssets = useMemo(() => projectAssetId ? listXiaTangPickerAssetsForProject(assets, projectAssetId, activeDomain, view.query) : [], [assets, activeDomain, projectAssetId, view.query]);
    const selectedAssets = useMemo(() => filteredAssets.filter((asset) => selectedAssetIds.has(asset.id)), [filteredAssets, selectedAssetIds]);

    useEffect(() => {
        if (useAssetStore.persist.hasHydrated()) {
            setHydrated(true);
            return;
        }
        return useAssetStore.persist.onFinishHydration(() => setHydrated(true));
    }, []);

    useEffect(() => {
        if (!open) return;
        setError("");
        setSelectedAssetIds(new Set());
    }, [open, projectAssetId]);

    const toggleSelection = (asset: Asset) => setSelectedAssetIds((current) => {
        const next = new Set(current);
        if (next.has(asset.id)) next.delete(asset.id);
        else next.add(asset.id);
        return next;
    });

    const importSelected = async () => {
        if (sending || !selectedAssets.length) return;
        if (!projectAssetId) {
            setError("当前虾画没有关联虾料项目；请从对应项目的虾画入口打开后再导入。");
            return;
        }
        if (!hydrated) {
            setError("虾塘正在读取本地素材，请稍后再试");
            return;
        }
        setSending(true);
        setError("");
        try {
            const result = await onImport(selectedAssets, getImportOrigin());
            const details = [
                result.insertedAssetIds.length ? `新增 ${result.insertedAssetIds.length} 项` : "没有新增节点",
                result.duplicateAssetIds.length ? `已存在 ${result.duplicateAssetIds.length} 项` : "",
                result.skippedAssets.length ? `跳过 ${result.skippedAssets.length} 项` : "",
            ].filter(Boolean).join("，");
            if (result.skippedAssets.length) {
                setSelectedAssetIds(new Set(result.skippedAssets.map((item) => item.assetId)));
                message.warning(`虾画已保存：${details}`);
            } else if (result.insertedAssetIds.length) {
                message.success(`已加入当前虾画：${details}`);
                setSelectedAssetIds(new Set());
                onClose();
            } else {
                message.info(`素材已在当前虾画：${details}`);
                setSelectedAssetIds(new Set());
                onClose();
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "本地画布保存失败；素材仍保留在选择中");
        } finally {
            setSending(false);
        }
    };

    return (
        <>
            <Modal
                title="虾塘素材 · 加入当前虾画"
                open={open}
                width={1080}
                footer={null}
                onCancel={() => { if (!sending) onClose(); }}
                closable={!sending}
                mask={{ closable: !sending }}
                destroyOnHidden
                styles={{ body: { padding: 0, height: "min(78vh, 820px)", display: "flex", flexDirection: "column" } }}
            >
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <nav role="tablist" aria-label="虾塘资产类型" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 px-4">
                        {DOMAINS.map(({ key, label }) => <button key={key} type="button" role="tab" aria-selected={activeDomain === key} onClick={() => setActiveDomain(key)} className={`relative min-w-20 px-4 py-3 text-sm ${activeDomain === key ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}{activeDomain === key ? <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" /> : null}</button>)}
                    </nav>
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
                        <Input aria-label="搜索虾塘素材" className="max-w-md" placeholder={`搜索${DOMAINS.find((item) => item.key === activeDomain)?.label}名称、标签和资料`} prefix={<Search className="size-4 text-muted-foreground" />} value={view.query} allowClear onChange={(event) => setView((current) => ({ ...current, query: event.target.value }))} />
                        <span className="text-xs text-muted-foreground">{filteredAssets.length} 项 · 当前项目的虾塘分类</span>
                    </div>
                    {!projectAssetId ? <div role="alert" className="mx-4 mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">当前画布没有关联虾料项目。请从虾料项目页的“虾画”入口打开同项目画布。</div> : null}
                    {workspaceError || error ? <div role="alert" className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{workspaceError || error}</div> : null}
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                        {!hydrated ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">正在读取虾塘本地素材…</p>
                            : !filteredAssets.length ? <div className="grid min-h-64 place-items-center text-center"><div><ImageIcon className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">{view.query ? "没有匹配的虾塘素材" : "此分类还没有虾塘条目或关联媒体"}</p></div></div>
                                : <ul aria-label={`${DOMAINS.find((item) => item.key === activeDomain)?.label}虾塘素材`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filteredAssets.map((asset) => {
                                    const record = getXiaTangRecord(asset);
                                    const parent = record?.parentId ? assets.find((candidate) => candidate.id === record.parentId) : null;
                                    const summary = record?.fields.description ?? record?.fields.role ?? record?.fields.slot ?? record?.slot;
                                    const source = asset.kind === "image" ? asset.data.dataUrl : asset.kind === "video" || asset.kind === "audio" ? asset.data.url : "";
                                    return <li key={asset.id} className={`overflow-hidden rounded-lg border ${selectedAssetIds.has(asset.id) ? "border-primary/70 bg-primary/5" : "border-border/60 bg-card/40"}`}>
                                        <div className="relative">
                                            <button type="button" aria-label={`预览${assetTitle(asset)}`} onClick={() => setPreviewAsset(asset)} className="grid h-36 w-full place-items-center overflow-hidden bg-muted/30">
                                                {asset.kind === "image" && source ? <img src={source} alt={assetTitle(asset)} className="h-full w-full object-contain" /> : asset.kind === "video" ? <Video className="size-8 text-muted-foreground" /> : asset.kind === "audio" ? <Mic className="size-8 text-muted-foreground" /> : <span className="px-3 text-center text-sm text-muted-foreground">{String(summary || "虾塘资料")}</span>}
                                            </button>
                                            <Checkbox checked={selectedAssetIds.has(asset.id)} aria-label={`选择${assetTitle(asset)}加入虾画`} onChange={() => toggleSelection(asset)} className="absolute right-3 top-3 rounded bg-background/90 p-1" />
                                        </div>
                                        <div className="space-y-2 p-3">
                                            <div className="flex min-w-0 items-center gap-2"><AssetKindIcon asset={asset} /><strong className="truncate text-sm">{assetTitle(asset)}</strong></div>
                                            <p className="truncate text-xs text-muted-foreground">{parent ? `关联：${assetTitle(parent)}` : record?.recordType === "media" ? "关联记录缺失" : DOMAINS.find((item) => item.key === activeDomain)?.label}</p>
                                            {typeof summary === "string" && summary ? <p className="line-clamp-2 text-xs text-muted-foreground">{summary}</p> : null}
                                            <div className="flex flex-wrap gap-1">{asset.tags.map((tag) => <Tag key={tag} className="m-0">{tag}</Tag>)}<Tag className="m-0">{record?.recordType || asset.kind}</Tag></div>
                                        </div>
                                    </li>;
                                })}</ul>}
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card px-5 py-3">
                        <p className="text-sm text-muted-foreground">已选 {selectedAssets.length} 项虾塘素材</p>
                        <div className="flex gap-2"><Button onClick={() => setSelectedAssetIds(new Set())} disabled={sending || !selectedAssetIds.size}>清空选择</Button><Button type="primary" onClick={() => void importSelected()} loading={sending} disabled={!projectAssetId || !selectedAssets.length}>加入当前虾画</Button></div>
                    </div>
                </div>
            </Modal>
            <Modal title={previewAsset?.title || "虾塘素材预览"} open={Boolean(previewAsset)} footer={null} onCancel={() => setPreviewAsset(null)} destroyOnHidden>{previewAsset ? <AssetPreview asset={previewAsset} /> : null}</Modal>
        </>
    );
}
