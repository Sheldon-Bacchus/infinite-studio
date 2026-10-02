import type { DramaImportAsset } from "@/services/api/drama-import";

export type DramaAssetMediaFilter = "all" | "text" | "image" | "video" | "audio";
export type DramaAssetCategory = "all" | "characters" | "scenes" | "props" | "voices" | "beats" | (string & {});

export type DramaAssetFilter = {
    mediaType?: DramaAssetMediaFilter;
    category?: DramaAssetCategory;
    tag?: string;
};

function assetTags(asset: DramaImportAsset) {
    const tags = asset.meta?.tags;
    if (Array.isArray(tags)) return tags.filter((tag): tag is string => typeof tag === "string");
    return typeof tags === "string" ? tags.split(/[，,、]/).map((tag) => tag.trim()).filter(Boolean) : [];
}

function assetCategory(asset: DramaImportAsset): string {
    if (asset.tab === "my-assets") {
        const category = asset.meta?.category;
        return typeof category === "string" && category ? category : "未分类";
    }
    if (asset.tab === "voices" || (asset.tab === "characters" && asset.role.toLowerCase().includes("voice"))) return "voices";
    if (asset.tab === "characters") return "characters";
    if (asset.tab === "scenes") return "scenes";
    if (asset.tab === "props") return "props";
    if (asset.tab === "beats") return "beats";
    return "all";
}

export function filterDramaAssets(assets: DramaImportAsset[], filter: DramaAssetFilter = {}) {
    const mediaType = filter.mediaType || "all";
    const category = filter.category || "all";
    const tagValue = filter.tag?.trim().toLocaleLowerCase();
    const tag = tagValue && tagValue !== "all" ? tagValue : undefined;
    return assets.filter((asset) => {
        if (mediaType !== "all" && asset.mediaType.toLowerCase() !== mediaType) return false;
        if (category !== "all" && assetCategory(asset) !== category) return false;
        return !tag || assetTags(asset).some((assetTag) => assetTag.toLocaleLowerCase() === tag);
    });
}

const XIA_TANG_ASSET_TABS = new Set(["characters", "scenes", "props", "voices"]);

export function filterXiaTangAssets(assets: DramaImportAsset[]) {
    return assets.filter((asset) => XIA_TANG_ASSET_TABS.has(asset.tab));
}

export function searchDramaAssets(assets: DramaImportAsset[], query: string) {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return assets;
    return assets.filter((asset) => [asset.label, asset.sublabel, asset.tab, asset.kind, asset.role, ...assetTags(asset)].some((value) => value?.toLocaleLowerCase().includes(needle)));
}

export function canPreviewDramaAsset(asset: DramaImportAsset) {
    return asset.exists && (asset.mediaType === "text" || (["image", "video", "audio"].includes(asset.mediaType) && Boolean(asset.url)));
}

export function canProjectDramaAsset(asset: DramaImportAsset) {
    if (asset.mediaType === "text") return true;
    return asset.exists && Boolean(asset.url) && ["image", "video", "audio"].includes(asset.mediaType);
}
