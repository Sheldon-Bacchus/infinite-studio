// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw characters.lazy.tsx character asset layout.
import type { DramaImportAsset } from "@/services/api/drama-import";
import { AssetGroups } from "./asset-card";

function characterName(asset: DramaImportAsset) {
    const name = asset.meta?.character;
    return typeof name === "string" && name ? name : "未归属人物";
}

export function CharacterAssetsPanel({
    assets,
    onPreview,
    onSend,
}: {
    assets: DramaImportAsset[];
    onPreview: (asset: DramaImportAsset) => void;
    onSend: (asset: DramaImportAsset) => void;
}) {
    return <AssetGroups assets={assets} groupLabel={characterName} onPreview={onPreview} onSend={onSend} />;
}
