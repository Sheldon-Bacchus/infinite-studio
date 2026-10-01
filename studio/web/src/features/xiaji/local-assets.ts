import type { Asset } from "@/stores/use-asset-store";
import type { DramaImportAsset } from "@/services/api/drama-import";
import { visibleLocalStudioAssets } from "./local-studio-asset-visibility";

function mediaForAsset(asset: Asset) {
    if (asset.kind === "text") return { url: undefined, exists: true, details: { content: asset.data.content } };
    const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
    return {
        url: url || undefined,
        exists: Boolean(url),
        details: {
            storageKey: asset.data.storageKey,
            width: "width" in asset.data ? asset.data.width : undefined,
            height: "height" in asset.data ? asset.data.height : undefined,
            bytes: asset.data.bytes,
            mimeType: asset.data.mimeType,
            durationMs: "durationMs" in asset.data ? asset.data.durationMs : undefined,
        },
    };
}

export function mapLocalAssetsToDramaAssets(assets: Asset[]): DramaImportAsset[] {
    return visibleLocalStudioAssets(assets).map((asset) => {
        const media = mediaForAsset(asset);
        return {
            id: asset.id,
            tab: "my-assets",
            kind: asset.kind,
            role: asset.kind,
            label: asset.title,
            sublabel: asset.source,
            url: media.url,
            exists: media.exists,
            mediaType: asset.kind,
            meta: {
                ...media.details,
                sourceSystem: "infinite-canvas",
                sourceProjectId: "user-assets",
                category: asset.category || "未分类",
                tags: asset.tags,
            },
        };
    });
}
