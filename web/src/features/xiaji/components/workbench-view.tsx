// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw assets-page tabs and categorized asset workbench.
import type { ReactNode } from "react";

import { filterDramaAssets, searchDramaAssets } from "../asset-query";
import type { XiaJiAssetViewState } from "./asset-tabs";
import { AssetTabs } from "./asset-tabs";
import { AssetGroups } from "./asset-card";
import { BeatBrowser } from "./beat-browser";
import { CharacterAssetsPanel } from "./character-assets-panel";
import { EpisodeBrowser } from "./episode-browser";
import { PropsPanel } from "./props-panel";
import { ScenesPanel } from "./scenes-panel";
import { VoicesPanel } from "./voices-panel";
import type { DramaAssetCatalog, DramaImportAsset, DramaImportBeat, DramaImportCatalog, DramaImportEpisode } from "@/services/api/drama-import";

export type WorkbenchActions = {
    onViewChange: (value: Partial<XiaJiAssetViewState>) => void;
    onAdd: () => void;
    onPreviewAsset: (asset: DramaImportAsset) => void;
    onSendAsset: (asset: DramaImportAsset) => void;
    onWritebackAsset?: (asset: DramaImportAsset, mode: "replace" | "history") => void;
    onSelectEpisode: (episode: number | null) => void;
    onSelectBeat: (beat: number | null) => void;
    onSendEpisode: (episode: DramaImportEpisode) => void;
    onSendBeat: (beat: DramaImportBeat) => void;
};

export function WorkbenchView({
    catalog,
    assets,
    state,
    tags,
    categories,
    selectedEpisode,
    selectedBeat,
    showAdd = true,
    showSourceBrowser = true,
    showAssetViews = true,
    selectionMode = false,
    selectedAssetKeys,
    onToggleAssetSelection,
    domainManager,
    loading,
    error,
    actions,
}: {
    catalog: DramaImportCatalog | DramaAssetCatalog | null;
    assets: DramaImportAsset[];
    state: XiaJiAssetViewState;
    tags: string[];
    categories: string[];
    selectedEpisode?: number | null;
    selectedBeat?: number | null;
    showAdd?: boolean;
    showSourceBrowser?: boolean;
    showAssetViews?: boolean;
    selectionMode?: boolean;
    selectedAssetKeys?: ReadonlySet<string>;
    onToggleAssetSelection?: (asset: DramaImportAsset) => void;
    domainManager?: ReactNode;
    loading: boolean;
    error: string;
    actions: WorkbenchActions;
}) {
    const filteredAssets = searchDramaAssets(
        filterDramaAssets(assets, { mediaType: state.mediaType, category: state.category, tag: state.tag }),
        state.query,
    );
    const episodes = catalog && "episodes" in catalog ? catalog.episodes : [];
    const selected = episodes.find((episode) => episode.number === selectedEpisode);
    const panelProps = {
        assets: filteredAssets,
        onPreview: actions.onPreviewAsset,
        onSend: actions.onSendAsset,
        onWriteback: actions.onWritebackAsset,
    };
    const allCategories = (asset: DramaImportAsset) => ({
        characters: "人物",
        scenes: "场景",
        props: "道具",
        voices: "声线",
        beats: "分镜",
    }[asset.tab] || "素材");

    return (
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background text-foreground">
            <header className="border-b border-border/60 px-5 py-5">
                <p className="text-xs text-muted-foreground">DramaClaw · 影视素材工作台</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">虾集</h1>
                <p className="mt-2 text-sm text-muted-foreground">管理虾塘中的角色、场景、道具与声线；选择素材后可发送到虾画。</p>
            </header>
            <AssetTabs state={state} tags={tags} categories={categories} showViews={showAssetViews} onChange={actions.onViewChange} onAdd={showAdd ? actions.onAdd : undefined} />

            <div className="space-y-6 p-5">
                {error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
                {loading ? <p aria-live="polite" className="text-sm text-muted-foreground">正在读取虾集目录…</p> : null}
                {catalog?.warnings.map((warning, index) => (
                    <div key={`${warning}-${index}`} role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{warning}</div>
                ))}

                {domainManager}

                {selectionMode ? <AssetGroups assets={filteredAssets} groupLabel={allCategories} onPreview={actions.onPreviewAsset} onSend={actions.onSendAsset} onWriteback={actions.onWritebackAsset} selectedAssetKeys={selectedAssetKeys} onToggleAssetSelection={onToggleAssetSelection} />
                    : state.category === "characters" ? <CharacterAssetsPanel {...panelProps} />
                    : state.category === "scenes" ? <ScenesPanel {...panelProps} />
                        : state.category === "props" ? <PropsPanel {...panelProps} />
                            : state.category === "voices" ? <VoicesPanel {...panelProps} />
                                : <AssetGroups assets={filteredAssets} groupLabel={allCategories} onPreview={actions.onPreviewAsset} onSend={actions.onSendAsset} onWriteback={actions.onWritebackAsset} />}

                {showSourceBrowser ? (
                    <div className="space-y-6 border-t border-border/60 pt-5">
                        <EpisodeBrowser episodes={episodes} selectedEpisode={selectedEpisode} onSelect={actions.onSelectEpisode} onSend={actions.onSendEpisode} />
                        <BeatBrowser beats={selected?.beats || []} selectedBeat={selectedBeat} onSelect={actions.onSelectBeat} onSend={actions.onSendBeat} />
                    </div>
                ) : null}
            </div>
        </main>
    );
}
