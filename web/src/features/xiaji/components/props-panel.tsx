// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw components/assets/props-panel.tsx prop catalog.
import type { DramaImportAsset } from "@/services/api/drama-import";
import { AssetGroups } from "./asset-card";

function propName(asset: DramaImportAsset) {
    const name = asset.meta?.prop_id || asset.meta?.prop_name;
    return typeof name === "string" && name ? name : asset.label || "未命名道具";
}

export function PropsPanel({
    assets,
    onPreview,
    onSend,
}: {
    assets: DramaImportAsset[];
    onPreview: (asset: DramaImportAsset) => void;
    onSend: (asset: DramaImportAsset) => void;
}) {
    return <AssetGroups assets={assets} groupLabel={propName} onPreview={onPreview} onSend={onSend} />;
}
