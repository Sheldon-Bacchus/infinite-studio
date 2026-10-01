// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw AssetLibraryPanel and asset cards.
import { AudioLines, FileText, Image as ImageIcon, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { downloadDramaMedia, type DramaImportAsset } from "@/services/api/drama-import";
import { canPreviewDramaAsset, canProjectDramaAsset } from "../asset-query";
import { canBrowseDramaHistory } from "../writeback";

export function dramaAssetSelectionKey(asset: DramaImportAsset) {
    return `${asset.tab}:${asset.id}:${asset.role}:${asset.url || ""}`;
}

export function AssetCard({
    asset,
    onPreview,
    onSend,
    onWriteback,
    selected = false,
    onToggleSelection,
}: {
    asset: DramaImportAsset;
    onPreview: (asset: DramaImportAsset) => void;
    onSend: (asset: DramaImportAsset) => void;
    onWriteback?: (asset: DramaImportAsset, mode: "replace" | "history") => void;
    selected?: boolean;
    onToggleSelection?: (asset: DramaImportAsset) => void;
}) {
    const previewRef = useRef<HTMLButtonElement>(null);
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewFailed, setPreviewFailed] = useState(false);
    const canPreview = canPreviewDramaAsset(asset);
    const canSend = canProjectDramaAsset(asset);
    const unsupportedMedia = asset.exists && Boolean(asset.url) && !canSend;

    useEffect(() => {
        if (!canPreview || asset.mediaType !== "image" || !asset.url) return;
        const element = previewRef.current;
        if (!element) return;
        let disposed = false;
        let objectUrl = "";
        const loadPreview = async () => {
            try {
                const blob = await downloadDramaMedia(asset.url!);
                objectUrl = URL.createObjectURL(blob);
                if (disposed) URL.revokeObjectURL(objectUrl);
                else setPreviewUrl(objectUrl);
            } catch {
                if (!disposed) setPreviewFailed(true);
            }
        };

        if (typeof IntersectionObserver === "undefined") {
            void loadPreview();
            return () => {
                disposed = true;
                if (objectUrl) URL.revokeObjectURL(objectUrl);
            };
        }
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            void loadPreview();
        }, { rootMargin: "160px" });
        observer.observe(element);
        return () => {
            disposed = true;
            observer.disconnect();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [asset.mediaType, asset.url, canPreview]);

    const MediaIcon = asset.mediaType === "video" ? Video : asset.mediaType === "audio" ? AudioLines : asset.mediaType === "text" ? FileText : ImageIcon;

    return (
        <article className="overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/40">
            <button
                ref={previewRef}
                type="button"
                onClick={() => canPreview && onPreview(asset)}
                disabled={!canPreview}
                aria-label={canPreview ? `预览：${asset.label}` : unsupportedMedia ? `虾画不支持该素材类型：${asset.label}` : `源文件缺失：${asset.label}`}
                className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-muted/50 text-muted-foreground disabled:cursor-default"
            >
                {previewUrl ? (
                    <img src={previewUrl} alt={asset.label} className="size-full object-contain" />
                ) : (
                    <span className="flex flex-col items-center gap-2 text-xs">
                        <MediaIcon aria-hidden="true" className="size-7 opacity-70" />
                        {!asset.exists ? "源文件缺失" : unsupportedMedia ? `虾画暂不支持 ${asset.mediaType}` : previewFailed ? "预览加载失败" : asset.mediaType === "image" ? "加载预览" : "打开预览"}
                    </span>
                )}
            </button>
            <div className="space-y-2 p-3">
                <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-foreground" title={asset.label}>{asset.label || "未命名素材"}</h3>
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={asset.role}>{asset.sublabel || asset.role || asset.mediaType}</p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{asset.mediaType}</span>
                    <div className="flex items-center gap-1">
                        {onToggleSelection ? <button
                            type="button"
                            disabled={!canSend}
                            aria-label={`选择素材加入批次：${asset.label}`}
                            aria-pressed={selected}
                            onClick={() => onToggleSelection(asset)}
                            className="rounded px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                        >{selected ? "已选" : "加入批次"}</button> : null}
                        {onWriteback && asset.exists && asset.pushable === true && asset.slotTarget ? <button type="button" onClick={() => onWriteback(asset, "replace")} className="rounded px-2 py-1 text-xs text-foreground hover:bg-accent">替换素材</button> : null}
                        {onWriteback && canBrowseDramaHistory(asset) ? <button type="button" onClick={() => onWriteback(asset, "history")} className="rounded px-2 py-1 text-xs text-foreground hover:bg-accent">素材历史</button> : null}
                        <button
                            type="button"
                            disabled={!canSend}
                            onClick={() => onSend(asset)}
                            className="rounded px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            发送到虾画
                        </button>
                    </div>
                </div>
            </div>
        </article>
    );
}

export function AssetGroups({
    assets,
    groupLabel,
    onPreview,
    onSend,
    onWriteback,
    selectedAssetKeys,
    onToggleAssetSelection,
}: {
    assets: DramaImportAsset[];
    groupLabel: (asset: DramaImportAsset) => string;
    onPreview: (asset: DramaImportAsset) => void;
    onSend: (asset: DramaImportAsset) => void;
    onWriteback?: (asset: DramaImportAsset, mode: "replace" | "history") => void;
    selectedAssetKeys?: ReadonlySet<string>;
    onToggleAssetSelection?: (asset: DramaImportAsset) => void;
}) {
    const groups = new Map<string, DramaImportAsset[]>();
    for (const asset of assets) {
        const label = groupLabel(asset) || "其他";
        groups.set(label, [...(groups.get(label) || []), asset]);
    }
    if (!groups.size) return <p className="py-10 text-center text-sm text-muted-foreground">暂无素材</p>;

    return (
        <div className="space-y-6">
            {[...groups.entries()].map(([label, items]) => (
                <section key={label} aria-label={label} className="space-y-3">
                    <h2 className="text-sm font-semibold text-foreground">{label}</h2>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {items.map((asset) => <AssetCard key={dramaAssetSelectionKey(asset)} asset={asset} onPreview={onPreview} onSend={onSend} onWriteback={onWriteback} selected={selectedAssetKeys?.has(dramaAssetSelectionKey(asset))} onToggleSelection={onToggleAssetSelection} />)}
                    </div>
                </section>
            ))}
        </div>
    );
}
