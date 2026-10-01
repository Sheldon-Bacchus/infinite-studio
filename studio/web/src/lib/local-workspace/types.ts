export type WorkspaceInfo = {
    schemaVersion: number;
    workspaceId: string;
    dataRoot: string;
    storage: "sqlite";
    serviceInstanceId: string;
};

export type RecordEnvelope<T> = {
    workspaceId: string;
    id: string;
    revision: number;
    data: T;
};

export type WriteRequest<T> = {
    workspaceId: string;
    operationId: string;
    baseRevision: number | null;
    data: T;
};

export type WriteResult<T> = RecordEnvelope<T> & { operationId: string };

export type DeleteRequest = {
    workspaceId: string;
    operationId: string;
    baseRevision: number;
};

export type DeleteResult = {
    workspaceId: string;
    id: string;
    revision: number;
    operationId: string;
    deleted: true;
};

export type FileReference = {
    fileId: string;
    storageKey: string;
    sha256: string;
    bytes: number;
    mimeType: string;
    url: string;
};

export type SavePhase = "clean" | "dirty" | "saving" | "saved" | "error" | "conflict";

export class LocalWorkspaceError extends Error {
    constructor(
        message: string,
        readonly phase: "unavailable" | "invalid" | "not-found" | "conflict" | "server",
        readonly status?: number,
    ) {
        super(message);
        this.name = "LocalWorkspaceError";
    }
}
