// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Local-store adaptation of DramaClaw's XiaTang asset card.
"use client";

import { AudioLines, FileText, Image as ImageIcon, Video } from "lucide-react";

import type { Asset } from "@/stores/use-asset-store";

export function AssetCard({
    asset,
    selectionMode = false,
    selected = false,
    onPreview,
    onSend,
    onToggleSelection,
}: {
    asset: Asset;
    selectionMode?: boolean;
    selected?: boolean;
    onPreview: (asset: Asset) => void;
    onSend: (asset: Asset) => void;
    onToggleSelection?: (asset: Asset) => void;
}) {
    const MediaIcon = asset.kind === "video" ? Video : asset.kind === "audio" ? AudioLines : asset.kind === "text" ? FileText : ImageIcon;
    const imageSrc = asset.kind === "image" ? asset.coverUrl || asset.data.dataUrl : asset.coverUrl;
    const previewLabel = asset.kind === "text" ? asset.data.content : asset.source || asset.kind;

    return (
        <article className="overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/40">
            <button
                type="button"
                onClick={() => onPreview(asset)}
                aria-label={`预览：${asset.title}`}
                className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-muted/50 text-muted-foreground"
            >
                {imageSrc ? <img src={imageSrc} alt={asset.title} loading="lazy" className="size-full object-contain" /> : (
                    <span className="flex max-w-full flex-col items-center gap-2 px-4 text-xs">
                        <MediaIcon aria-hidden="true" className="size-7 shrink-0 opacity-70" />
                        {asset.kind === "text" ? <span className="line-clamp-3">{asset.data.content || "文本素材"}</span> : asset.kind === "video" ? "视频素材" : asset.kind === "audio" ? "音频素材" : "图片预览不可用"}
                    </span>
                )}
            </button>
            <div className="space-y-2 p-3">
                <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-foreground" title={asset.title}>{asset.title || "未命名素材"}</h3>
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={previewLabel}>{previewLabel || asset.category || "本地素材"}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{asset.kind}</span>
                    {asset.category ? <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{asset.category}</span> : null}
                    {asset.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">{tag}</span>)}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1 border-t border-border/60 pt-2">
                    {onToggleSelection ? <button
                        type="button"
                        aria-label={`${selected ? "取消选择" : "选择素材"}：${asset.title}`}
                        aria-pressed={selected}
                        onClick={() => onToggleSelection(asset)}
                        className="rounded px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent"
                    >{selected ? "已选" : "选择素材"}</button> : null}
                    {!selectionMode ? <button
                        type="button"
                        onClick={() => onSend(asset)}
                        className="rounded px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                    >发送到虾画</button> : null}
                </div>
            </div>
        </article>
    );
}
