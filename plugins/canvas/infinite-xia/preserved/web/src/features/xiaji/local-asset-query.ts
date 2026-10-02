import type { Asset } from "@/stores/use-asset-store";
import { isInternalLocalStudioAsset, visibleLocalStudioAssets } from "./local-studio-asset-visibility";

export type LocalAssetFilter = {
    view?: "mine" | "library";
    mediaType?: "all" | Asset["kind"];
    category?: string;
    tag?: string;
};

function isLibraryAsset(asset: Asset) {
    return asset.source === "素材库" || asset.metadata?.source === "asset-library";
}

export function filterLocalAssets(assets: Asset[], filter: LocalAssetFilter = {}) {
    const mediaType = filter.mediaType || "all";
    const category = filter.category || "all";
    const tagValue = filter.tag?.trim().toLocaleLowerCase();
    const tag = tagValue && tagValue !== "all" ? tagValue : undefined;

    return assets.filter((asset) => {
        if (isInternalLocalStudioAsset(asset)) return false;
        if (filter.view === "library" && !isLibraryAsset(asset)) return false;
        if (filter.view === "mine" && isLibraryAsset(asset)) return false;
        if (mediaType !== "all" && asset.kind !== mediaType) return false;
        if (category !== "all" && (asset.category || "未分类") !== category) return false;
        if (tag && !asset.tags.some((assetTag) => assetTag.toLocaleLowerCase() === tag)) return false;
        return true;
    });
}

export function searchLocalAssets(assets: Asset[], query: string) {
    const needle = query.trim().toLocaleLowerCase();
    const userAssets = visibleLocalStudioAssets(assets);
    if (!needle) return userAssets;

    return userAssets.filter((asset) => {
        const content = asset.kind === "text" ? asset.data.content : "";
        return [asset.title, asset.category, asset.source, asset.kind, ...asset.tags, content]
            .some((value) => value?.toLocaleLowerCase().includes(needle));
    });
}
