import type { Asset } from "./asset-types";

export const XIA_TANG_SCHEMA_VERSION = 1 as const;

export const XIA_TANG_DOMAINS = ["character", "scene", "prop", "voice"] as const;
export type XiaTangDomain = (typeof XIA_TANG_DOMAINS)[number];

export const XIA_TANG_RECORD_TYPES = ["entity", "identity", "variant", "voice-slot", "media"] as const;
export type XiaTangRecordType = (typeof XIA_TANG_RECORD_TYPES)[number];

export type XiaTangRecord = {
    schemaVersion: number;
    domain: XiaTangDomain;
    recordType: XiaTangRecordType;
    parentId?: string;
    projectAssetId?: string;
    slot?: string;
    versionOf?: string;
    fields: Record<string, unknown>;
    [extension: string]: unknown;
};

export type XiaTangAssetInput = Omit<Asset, "id" | "createdAt" | "updatedAt">;

export type CreateXiaTangAssetOptions = {
    recordType?: XiaTangRecordType;
    parentId?: string;
    projectAssetId?: string;
    slot?: string;
    versionOf?: string;
    title?: string;
    category?: string;
    tags?: string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isXiaTangDomain(value: unknown): value is XiaTangDomain {
    return typeof value === "string" && (XIA_TANG_DOMAINS as readonly string[]).includes(value);
}

function isXiaTangRecordType(value: unknown): value is XiaTangRecordType {
    return typeof value === "string" && (XIA_TANG_RECORD_TYPES as readonly string[]).includes(value);
}

function normalizeFields(fields: Record<string, unknown>) {
    return { ...fields };
}

function recordTitle(fields: Record<string, unknown>, fallback: string) {
    const name = fields.name;
    return typeof name === "string" && name.trim() ? name.trim() : fallback;
}

export function createXiaTangAssetInput(
    domain: XiaTangDomain,
    fields: Record<string, unknown>,
    options: CreateXiaTangAssetOptions = {},
): XiaTangAssetInput {
    const normalizedFields = normalizeFields(fields);
    const record: XiaTangRecord = {
        schemaVersion: XIA_TANG_SCHEMA_VERSION,
        domain,
        recordType: options.recordType || "entity",
        ...(options.parentId ? { parentId: options.parentId } : {}),
        ...(options.projectAssetId ? { projectAssetId: options.projectAssetId } : {}),
        ...(options.slot ? { slot: options.slot } : {}),
        ...(options.versionOf ? { versionOf: options.versionOf } : {}),
        fields: normalizedFields,
    };
    const title = options.title || recordTitle(normalizedFields, `未命名${domain}`);

    return {
        kind: "text",
        title,
        coverUrl: "",
        tags: options.tags ? [...options.tags] : [],
        category: options.category || `xia-tang:${domain}`,
        source: "xia-tang",
        data: { content: title },
        metadata: { xiaTang: record },
    } as XiaTangAssetInput;
}

export function isXiaTangAsset(
    asset: Asset,
    domain?: XiaTangDomain,
    recordType?: XiaTangRecordType,
): boolean {
    const value = asset.metadata?.xiaTang;
    if (!isObject(value) || !isXiaTangDomain(value.domain) || !isXiaTangRecordType(value.recordType)) return false;
    if (typeof value.schemaVersion !== "number" || value.schemaVersion < 1) return false;
    if (domain && value.domain !== domain) return false;
    if (recordType && value.recordType !== recordType) return false;
    return true;
}

export function getXiaTangRecord(asset: Asset): XiaTangRecord | null {
    if (!isXiaTangAsset(asset)) return null;
    const record = asset.metadata?.xiaTang;
    if (!isObject(record)) return null;
    return {
        ...record,
        schemaVersion: record.schemaVersion as number,
        domain: record.domain as XiaTangDomain,
        recordType: record.recordType as XiaTangRecordType,
        fields: isObject(record.fields) ? record.fields : {},
    } as XiaTangRecord;
}

export function listXiaTangProjectAssets(assets: Asset[], projectAssetId: string): Asset[] {
    const included = new Set(assets.flatMap((asset) => getXiaTangRecord(asset)?.projectAssetId === projectAssetId ? [asset.id] : []));
    let changed = true;
    while (changed) {
        changed = false;
        for (const asset of assets) {
            const record = getXiaTangRecord(asset);
            if (record?.parentId && included.has(record.parentId) && !included.has(asset.id)) {
                included.add(asset.id);
                changed = true;
            }
        }
    }
    return assets.filter((asset) => included.has(asset.id));
}

export function patchXiaTangFields<T extends Asset>(
    asset: T,
    patch: Record<string, unknown>,
    updatedAt = new Date().toISOString(),
): T {
    const current = getXiaTangRecord(asset);
    if (!current) throw new Error("素材不是虾塘领域记录");

    const fields = { ...current.fields, ...patch };
    const nextRecord = { ...current, fields };
    const title = recordTitle(fields, asset.title);
    const metadata = { ...(asset.metadata || {}), xiaTang: nextRecord };

    return {
        ...asset,
        title,
        updatedAt,
        metadata,
        ...(asset.kind === "text" ? { data: { ...asset.data, content: title } } : {}),
    } as T;
}

export function findXiaTangChildren(assets: readonly Asset[], parentId: string): Asset[] {
    return assets.filter((asset) => {
        const record = getXiaTangRecord(asset);
        return record?.parentId === parentId;
    });
}

export function findXiaTangMedia(
    assets: readonly Asset[],
    parentId: string,
    slot?: string,
): Asset[] {
    return findXiaTangChildren(assets, parentId).filter((asset) => {
        const record = getXiaTangRecord(asset);
        return record?.recordType === "media" && (!slot || record.slot === slot);
    });
}

/** Lists a media slot's local history from oldest to newest. */
export function listXiaTangMediaVersions(assets: readonly Asset[], parentId: string, slot: string): Asset[] {
    return findXiaTangMedia(assets, parentId, slot).sort((left, right) => {
        const leftTime = Date.parse(left.createdAt || "") || 0;
        const rightTime = Date.parse(right.createdAt || "") || 0;
        return leftTime - rightTime;
    });
}

/** Resolves the explicitly selected version, falling back to the newest for older records. */
export function getXiaTangCurrentMediaId(assets: readonly Asset[], parentId: string, slot: string): string | undefined {
    const versions = listXiaTangMediaVersions(assets, parentId, slot);
    if (!versions.length) return undefined;
    const parent = assets.find((asset) => asset.id === parentId);
    const current = getXiaTangRecord(parent || versions[0])?.fields.mediaCurrentBySlot;
    const selected = current && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)[slot]
        : undefined;
    return typeof selected === "string" && versions.some((asset) => asset.id === selected)
        ? selected
        : versions[versions.length - 1].id;
}

/** Selects a version without modifying or deleting any uploaded file. */
export function setXiaTangCurrentMediaId(parent: Asset, assets: readonly Asset[], slot: string, mediaId: string): Asset {
    const media = assets.find((asset) => asset.id === mediaId);
    const record = media && getXiaTangRecord(media);
    if (!record || record.recordType !== "media" || record.parentId !== parent.id || record.slot !== slot) {
        throw new Error("所选文件不属于当前虾塘媒体槽位");
    }
    const parentRecord = getXiaTangRecord(parent);
    if (!parentRecord) throw new Error("媒体所属的虾塘条目已不存在");
    const current = parentRecord.fields.mediaCurrentBySlot;
    const mediaCurrentBySlot = current && typeof current === "object" && !Array.isArray(current)
        ? { ...(current as Record<string, string>), [slot]: mediaId }
        : { [slot]: mediaId };
    return patchXiaTangFields(parent, { mediaCurrentBySlot });
}
