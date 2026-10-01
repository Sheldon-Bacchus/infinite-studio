// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapts DramaClaw's XiaTang asset workbench to Infinite Canvas's local Asset store.
"use client";

import { useMemo } from "react";

import type { Asset } from "@/stores/use-asset-store";
import { filterLocalAssets, searchLocalAssets } from "./local-asset-query";
import { AssetCard } from "./components/local-asset-card";
import { AssetTabs, type XiaJiAssetViewState } from "./components/asset-tabs";

export function LocalAssetWorkbench({
    assets,
    state,
    selectedAssetIds,
    selectionMode = false,
    loading,
    error,
    onStateChange,
    onAdd,
    onPreview,
    onSend,
    onToggleSelection,
}: {
    assets: Asset[];
    state: XiaJiAssetViewState;
    selectedAssetIds: ReadonlySet<string>;
    selectionMode?: boolean;
    loading: boolean;
    error: string;
    onStateChange: (value: Partial<XiaJiAssetViewState>) => void;
    onAdd?: () => void;
    onPreview: (asset: Asset) => void;
    onSend: (asset: Asset) => void;
    onToggleSelection: (asset: Asset) => void;
}) {
    const categories = useMemo(() => [...new Set(assets.map((asset) => asset.category?.trim() || "未分类"))].sort((a, b) => a.localeCompare(b, "zh-CN")), [assets]);
    const tags = useMemo(() => [...new Set(assets.flatMap((asset) => asset.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")), [assets]);
    const visibleAssets = useMemo(() => searchLocalAssets(
        filterLocalAssets(assets, state),
        state.query,
    ), [assets, state]);
    const groupedAssets = useMemo(() => {
        const groups = new Map<string, Asset[]>();
        for (const asset of visibleAssets) {
            const category = asset.category?.trim() || "未分类";
            groups.set(category, [...(groups.get(category) || []), asset]);
        }
        return [...groups.entries()];
    }, [visibleAssets]);

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background text-foreground">
            <AssetTabs state={state} tags={tags} categories={categories} onChange={onStateChange} onAdd={onAdd} />
            <div className="min-h-0 flex-1 space-y-6 p-5">
                {error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
                {loading ? <p aria-live="polite" className="py-10 text-center text-sm text-muted-foreground">正在读取本地素材…</p> : null}
                {!loading && !error && groupedAssets.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">暂无素材</p> : null}
                {!loading && !error ? groupedAssets.map(([category, group]) => (
                    <section key={category} aria-label={category} className="space-y-3">
                        <h2 className="text-sm font-semibold text-foreground">{category}</h2>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                            {group.map((asset) => <AssetCard
                                key={asset.id}
                                asset={asset}
                                selectionMode={selectionMode}
                                selected={selectedAssetIds.has(asset.id)}
                                onPreview={onPreview}
                                onSend={onSend}
                                onToggleSelection={onToggleSelection}
                            />)}
                        </div>
                    </section>
                )) : null}
            </div>
        </div>
    );
}
