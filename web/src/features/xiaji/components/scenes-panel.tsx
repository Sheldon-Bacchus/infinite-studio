// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw components/assets/scenes-panel.tsx scene grouping.
import type { DramaImportAsset } from "@/services/api/drama-import";
import { AssetGroups } from "./asset-card";

function sceneName(asset: DramaImportAsset) {
    const name = asset.meta?.scene_id || asset.meta?.scene;
    return typeof name === "string" && name ? name : asset.sublabel || "未命名场景";
}

export function ScenesPanel({
    assets,
    onPreview,
    onSend,
}: {
    assets: DramaImportAsset[];
    onPreview: (asset: DramaImportAsset) => void;
    onSend: (asset: DramaImportAsset) => void;
}) {
    return <AssetGroups assets={assets} groupLabel={sceneName} onPreview={onPreview} onSend={onSend} />;
}
