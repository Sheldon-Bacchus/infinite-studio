import type { Asset, AssetKind } from "@/stores/use-asset-store";

const assetKinds = new Set<AssetKind>(["text", "image", "video", "audio"]);

export function parseLegacyAssetSnapshot(serialized: string | null): Asset[] {
    if (!serialized) return [];
    try {
        const snapshot = JSON.parse(serialized) as { state?: { assets?: unknown } };
        if (!Array.isArray(snapshot.state?.assets)) return [];
        return snapshot.state.assets.filter(isAsset);
    } catch {
        return [];
    }
}

/** Merge browser/account snapshots into the canonical local workspace index. */
export function mergeAssetSnapshots(canonicalAssets: Asset[], incomingAssets: Asset[]): Asset[] {
    const records = new Map<string, Asset>();
    for (const asset of canonicalAssets) {
        if (isAsset(asset)) records.set(asset.id, asset);
    }
    for (const asset of incomingAssets) {
        if (!isAsset(asset)) continue;
        const previous = records.get(asset.id);
        if (!previous || timestamp(asset.updatedAt) > timestamp(previous.updatedAt)) {
            records.set(asset.id, asset);
        }
    }
    return Array.from(records.values()).sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt));
}

function isAsset(value: unknown): value is Asset {
    if (!value || typeof value !== "object") return false;
    const asset = value as Partial<Asset>;
    return typeof asset.id === "string" && asset.id.length > 0 && assetKinds.has(asset.kind as AssetKind);
}

function timestamp(value?: string) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
}
