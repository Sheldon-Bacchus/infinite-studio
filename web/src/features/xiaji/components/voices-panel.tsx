// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw character-voice-panel.tsx and narrator-voice-panel.tsx.
import type { DramaImportAsset } from "@/services/api/drama-import";
import { AssetGroups } from "./asset-card";

function voiceOwner(asset: DramaImportAsset) {
    const character = asset.meta?.character;
    return typeof character === "string" && character ? character : "项目声音";
}

export function VoicesPanel({
    assets,
    onPreview,
    onSend,
}: {
    assets: DramaImportAsset[];
    onPreview: (asset: DramaImportAsset) => void;
    onSend: (asset: DramaImportAsset) => void;
}) {
    return <AssetGroups assets={assets} groupLabel={voiceOwner} onPreview={onPreview} onSend={onSend} />;
}
