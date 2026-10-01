// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Asset } from "@/stores/use-asset-store";

// Hide records created by the removed return-to-mainline feature in existing local workspaces.
const LEGACY_INTERNAL_KIND = "return-to-mainline-operation";

function localStudioMetadata(asset: Asset): Record<string, unknown> | null {
    const value = asset.metadata?.localStudio;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function isInternalLocalStudioAsset(asset: Asset) {
    return localStudioMetadata(asset)?.internalKind === LEGACY_INTERNAL_KIND;
}

export function visibleLocalStudioAssets(assets: Asset[]) {
    return assets.filter((asset) => !isInternalLocalStudioAsset(asset));
}
