import type {
    DramaAssetHistoryKind,
    DramaCandidateUploadResult,
    DramaImportAsset,
    DramaIdentityPayload,
    DramaPushResult,
    DramaPushTarget,
} from "@/services/api/drama-import";

export type WritebackAction =
    | { kind: "candidate"; projectId: string; file?: Blob; filename?: string; candidate?: Pick<DramaCandidateUploadResult, "url"> }
    | { kind: "identity"; projectId: string; file?: Blob; filename?: string; candidate?: Pick<DramaCandidateUploadResult, "url">; identity: Omit<DramaIdentityPayload, "source_url"> }
    | { kind: "replace"; projectId: string; file?: Blob; filename?: string; candidate?: Pick<DramaCandidateUploadResult, "url">; target: DramaPushTarget; markStale: boolean };

export type WritebackApi = {
    upload: (projectId: string, file: Blob, filename: string) => Promise<Pick<DramaCandidateUploadResult, "url">>;
    createIdentity: (projectId: string, payload: DramaIdentityPayload) => Promise<unknown>;
    push: (projectId: string, sourceUrl: string, target: DramaPushTarget, markStale: boolean) => Promise<DramaPushResult>;
};

export class WritebackActionError extends Error {
    constructor(
        readonly step: "upload" | "identity" | "push",
        message: string,
        readonly candidate?: Pick<DramaCandidateUploadResult, "url">,
    ) {
        super(message);
        this.name = "WritebackActionError";
    }
}

export function canSaveCanvasResult(status: unknown, content: string | undefined, mediaSupported: boolean) {
    return status === "success" && Boolean(content?.trim()) && mediaSupported;
}

export function isSupportedWritebackMimeType(mimeType: string | undefined) {
    const normalized = mimeType?.split(";")[0].trim().toLowerCase() ?? "";
    return /^(image|video|audio)\/[a-z0-9][a-z0-9.+-]*$/.test(normalized);
}

export function assetsForWritebackProject(
    projectId: string,
    initialProjectId: string,
    loadedProjectId: string,
    initialAssets: DramaImportAsset[],
    loadedAssets: DramaImportAsset[],
) {
    const current = projectId.trim();
    if (!current) return [];
    const matches = [
        ...(current === initialProjectId.trim() ? initialAssets : []),
        ...(current === loadedProjectId.trim() ? loadedAssets : []),
    ];
    const unique = new Map<string, DramaImportAsset>();
    for (const asset of matches) unique.set(`${asset.tab}:${asset.id}`, asset);
    return [...unique.values()];
}

export async function runWritebackAction(action: WritebackAction | null, api: WritebackApi) {
    if (!action) return { cancelled: true as const };
    let candidate = action.candidate;
    if (!candidate && action.file && action.filename) {
        try {
            candidate = await api.upload(action.projectId, action.file, action.filename);
        } catch (error) {
            throw new WritebackActionError("upload", error instanceof Error ? error.message : "虾集候选上传失败");
        }
    }
    if (!candidate) throw new Error("请选择文件或先保存候选素材");
    if (action.kind === "identity") {
        let result: unknown;
        try {
            result = await api.createIdentity(action.projectId, { ...action.identity, source_url: candidate.url });
        } catch (error) {
            throw new WritebackActionError("identity", error instanceof Error ? error.message : "新建角色身份失败", candidate);
        }
        return { cancelled: false as const, candidate, result };
    }
    if (action.kind === "replace") {
        let result: DramaPushResult;
        try {
            result = await api.push(action.projectId, candidate.url, action.target, action.markStale);
        } catch (error) {
            throw new WritebackActionError("push", error instanceof Error ? error.message : "虾集素材替换失败", candidate);
        }
        return { cancelled: false as const, candidate, result };
    }
    return { cancelled: false as const, candidate };
}

export function dramaHistoryDescriptor(asset: DramaImportAsset): { kind: DramaAssetHistoryKind; character: string; identityId?: string } | null {
    if (asset.historyAvailable !== true) return null;
    const target = asset.slotTarget;
    const kind = typeof target?.kind === "string" ? target.kind : "";
    const character = typeof target?.character === "string" ? target.character : "";
    if (!character || !["portrait", "identity", "identity_costume", "identity_portrait"].includes(kind)) return null;
    const identityId = typeof target?.identity_id === "string" ? target.identity_id : undefined;
    if (kind !== "portrait" && !identityId) return null;
    return { kind: kind as DramaAssetHistoryKind, character, ...(identityId ? { identityId } : {}) };
}

export function canBrowseDramaHistory(asset: DramaImportAsset) {
    return dramaHistoryDescriptor(asset) !== null;
}
