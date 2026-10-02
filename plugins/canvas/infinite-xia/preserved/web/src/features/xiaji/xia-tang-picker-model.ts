import type { Asset } from "@/stores/use-asset-store";
import { getXiaTangRecord, isXiaTangAsset, listXiaTangProjectAssets, type XiaTangDomain } from "./xia-tang-local-model";

function searchableText(asset: Asset) {
    const record = getXiaTangRecord(asset);
    const values = [asset.title, ...asset.tags, record?.slot, ...Object.values(record?.fields || {})];
    return values.flatMap((value) => Array.isArray(value) ? value : [value])
        .filter((value) => value !== undefined && value !== null)
        .map((value) => typeof value === "object" ? JSON.stringify(value) : String(value))
        .join(" ")
        .toLocaleLowerCase();
}

/** Returns only XiaTang-owned entities and linked child records/media for one tab. */
export function listXiaTangPickerAssets(assets: readonly Asset[], domain: XiaTangDomain, query = ""): Asset[] {
    const needle = query.trim().toLocaleLowerCase();
    return assets.filter((asset) => isXiaTangAsset(asset, domain) && (!needle || searchableText(asset).includes(needle)));
}

/** Returns only this local project's XiaTang records and linked child media. */
export function listXiaTangPickerAssetsForProject(assets: readonly Asset[], projectAssetId: string, domain: XiaTangDomain, query = ""): Asset[] {
    if (!projectAssetId.trim()) return [];
    return listXiaTangPickerAssets(listXiaTangProjectAssets([...assets], projectAssetId), domain, query);
}

export function resolveXiaTangSelectionProjectId(assets: readonly Asset[], selectedAssetIds: readonly string[], contextProjectAssetId?: string): string {
    if (!selectedAssetIds.length) throw new Error("请至少选择一条虾塘素材");
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const resolve = (assetId: string, visited = new Set<string>()): string | null => {
        if (visited.has(assetId)) return null;
        visited.add(assetId);
        const asset = assetsById.get(assetId);
        const record = asset ? getXiaTangRecord(asset) : null;
        if (!record) return null;
        if (record.projectAssetId) return record.projectAssetId;
        return record.parentId ? resolve(record.parentId, visited) : null;
    };
    const projectIds = selectedAssetIds.map((assetId) => resolve(assetId));
    if (projectIds.some((id) => !id)) throw new Error("部分虾塘素材没有关联影视项目，无法发送到项目虾画");
    const unique = new Set(projectIds as string[]);
    if (unique.size !== 1) throw new Error("所选虾塘素材属于不同项目，请分项目发送");
    const projectAssetId = [...unique][0];
    if (contextProjectAssetId && contextProjectAssetId !== projectAssetId) throw new Error("所选虾塘素材不属于当前项目");
    return projectAssetId;
}
