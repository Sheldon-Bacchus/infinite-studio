// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Work {
    schemaVersion: number;
    id: string;
    title: string;
    currentCommitId: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export interface CommitReceipt {
    workId: string;
    revision: number;
    commitId: string;
    operationId: string;
    committed: boolean;
}

export interface Commit {
    schemaVersion: number;
    id: string;
    workId: string;
    revision: number;
    baseRevision: number;
    operationId: string;
    requestDigest: string;
    recordRefs: Record<string, string>;
    previousCommitId: string;
    receipt: CommitReceipt;
    createdAt: string;
}

export interface RecordItem {
    schemaVersion: number;
    id: string;
    type: string;
    revisionId: string;
    workId: string;
    data: unknown;
    createdAt: string;
}

export interface MediaDescriptor {
    fileId: string;
    workId: string;
    sha256: string;
    bytes: number;
    mimeType: string;
    kind: "text" | "image" | "video" | "audio";
    extension: string;
    originalFilename?: string;
    createdAt: string;
}

export interface RecordChange {
    id: string;
    type: string;
    data: unknown;
    delete?: boolean;
}

export interface CommitRequest {
    baseRevision: number;
    operationId: string;
    changes: RecordChange[];
}

export interface CommitResult {
    workId: string;
    revision: number;
    commitId: string;
    operationId: string;
    committed: boolean;
    indexState: "up_to_date" | "pending_rebuild";
}

export interface CreateWorkRequest {
    operationId: string;
    id?: string;
    title: string;
}

export interface CreateWorkResult {
    work: Work;
    committed: boolean;
    indexState: "up_to_date" | "pending_rebuild";
}

export interface WorkDetailResponse {
    work: Work;
    currentCommit: Commit;
    records: Record<string, RecordItem>;
}

export interface MissingFileInfo {
    sourceAssetId?: string;
    path?: string;
    reason: string;
    url?: string;
    sha256?: string;
}

export interface ConflictInfo {
    type: string;
    message: string;
}

export interface OperationInfo {
    action: string;
    targetId: string;
    targetName: string;
    details?: string;
}

export interface MigrationPreviewResult {
    sourceId: string;
    sourceDigest: string;
    sourceType: string;
    title: string;
    entityMappings: Record<string, string>;
    fileMappings: Record<string, string>;
    missingFiles: MissingFileInfo[];
    conflicts: ConflictInfo[];
    operations: OperationInfo[];
    canCommit: boolean;
}

export interface MigrationData {
    sourceId: string;
    sourceDigest: string;
    entityMappings: Record<string, string>;
    fileMappings: Record<string, string>;
    status: string;
    backupReferences: string[];
}

export interface MigrationCommitResult {
    workId: string;
    revision: number;
    commitId: string;
    operationId: string;
    committed: boolean;
    indexState: string;
    sourceId: string;
    sourceDigest: string;
    backupId: string;
    entityCount: number;
    mediaCount: number;
    migrationRecord?: MigrationData;
}

export interface ArchiveRequest {
    baseRevision: number;
    operationId: string;
    entityRefs: string[];
}

export interface RestoreRequest {
    baseRevision: number;
    operationId: string;
    entityRefs: string[];
}

export interface WorkPackagePreviewResult {
    workId: string;
    title: string;
    revision: number;
    commitCount: number;
    recordCount: number;
    mediaCount: number;
    totalBytes: number;
    conflicts: ConflictInfo[];
    missingFiles: MissingFileInfo[];
    canCommit: boolean;
    packageDigest: string;
}

export interface WorkAuditReport {
    workId: string;
    title: string;
    revision: number;
    currentCommitId: string;
    healthy: boolean;
    commitCount: number;
    activeRecordCount: number;
    activeMediaCount: number;
    orphanRecordIds: string[];
    orphanMediaFiles: string[];
    stagingFiles: string[];
    indexState: string;
    issues: string[];
}

export interface InboxFileItem {
    filename: string;
    sha256: string;
    bytes: number;
    mimeType: string;
    kind: string;
    status: "new" | "duplicate";
    existingFileId?: string;
}

export interface InboxScanResult {
    workId: string;
    files: InboxFileItem[];
    scannedAt: string;
}

export interface AdoptInboxRequest {
    baseRevision: number;
    operationId: string;
    files: Array<{
        filename: string;
        expectedSha256: string;
    }>;
}

export type WorksErrorKind = "not-found" | "conflict" | "invalid" | "unavailable" | "server";

export class WorksError extends Error {
    readonly kind: WorksErrorKind;
    readonly status?: number;

    constructor(message: string, kind: WorksErrorKind, status?: number) {
        super(message);
        this.name = "WorksError";
        this.kind = kind;
        this.status = status;
    }
}

type APIResponse = { code: number; data: unknown; msg: string };
type Guard<T> = (value: unknown) => value is T;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIndexState(value: unknown): value is "up_to_date" | "pending_rebuild" {
    return value === "up_to_date" || value === "pending_rebuild";
}

function isSha256(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecordType(value: unknown): value is string {
    return value === "episode" || value === "shot" || value === "shot_revision" || value === "asset" || value === "media" || value === "prompt_revision" || value === "generation" || value === "canvas_binding" || value === "migration" || value === "archive" || value === "script";
}

function isStringMap(value: unknown): value is Record<string, string> {
    return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isAPIResponse(value: unknown): value is APIResponse {
    return isRecord(value) && typeof value.code === "number" && "data" in value && typeof value.msg === "string";
}

function errorForStatus(status: number, message: string): WorksError {
    if (status === 404) return new WorksError(message, "not-found", status);
    if (status === 409) return new WorksError(message, "conflict", status);
    if (status === 422) return new WorksError(message, "invalid", status);
    if (status === 503 || status === 502 || status === 504) return new WorksError(message, "unavailable", status);
    return new WorksError(message, "server", status);
}

async function request<T>(path: string, init: RequestInit, guard: Guard<T>, successStatus = 200): Promise<T> {
    let response: Response;
    try {
        response = await fetch(path, init);
    } catch {
        throw new WorksError("本地作品服务不可用，请检查服务状态", "unavailable");
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new WorksError("本地作品服务返回了无法识别的响应", "invalid", response.status);
    }

    if (!isAPIResponse(payload)) {
        throw new WorksError("本地作品服务返回了无法识别的响应协议", "invalid", response.status);
    }
    if (!response.ok || payload.code !== 0) {
        throw errorForStatus(response.status, payload.msg || "本地作品服务请求失败");
    }
    if (response.status !== successStatus || !guard(payload.data)) {
        throw new WorksError("本地作品服务响应数据格式无效", "invalid", response.status);
    }
    return payload.data;
}

// Runtime Guards
function isWork(value: unknown): value is Work {
    return (
        isRecord(value) &&
        Number.isSafeInteger(value.schemaVersion) &&
        (value.schemaVersion as number) > 0 &&
        typeof value.id === "string" &&
        value.id.length > 0 &&
        typeof value.title === "string" &&
        typeof value.currentCommitId === "string" &&
        Number.isSafeInteger(value.revision) &&
        (value.revision as number) >= 1 &&
        typeof value.createdAt === "string" &&
        typeof value.updatedAt === "string"
    );
}

function isArrayOf<T>(guard: Guard<T>): Guard<T[]> {
    return (value): value is T[] => Array.isArray(value) && value.every(guard);
}

function isCreateWorkResult(value: unknown): value is CreateWorkResult {
    return isRecord(value) && isWork(value.work) && value.committed === true && isIndexState(value.indexState);
}

function isCommitResult(value: unknown): value is CommitResult {
    return (
        isRecord(value) &&
        typeof value.workId === "string" && value.workId.length > 0 &&
        Number.isSafeInteger(value.revision) && (value.revision as number) >= 1 &&
        typeof value.commitId === "string" && value.commitId.length > 0 &&
        typeof value.operationId === "string" && value.operationId.length > 0 &&
        value.committed === true &&
        isIndexState(value.indexState)
    );
}

function isCommitReceipt(value: unknown): value is CommitReceipt {
    return isRecord(value) && typeof value.workId === "string" && typeof value.commitId === "string" && typeof value.operationId === "string" && Number.isSafeInteger(value.revision) && (value.revision as number) >= 1 && value.committed === true;
}

function isCommit(value: unknown): value is Commit {
    return (
        isRecord(value) &&
        Number.isSafeInteger(value.schemaVersion) && (value.schemaVersion as number) > 0 &&
        typeof value.id === "string" &&
        typeof value.workId === "string" &&
        Number.isSafeInteger(value.revision) && (value.revision as number) >= 1 &&
        Number.isSafeInteger(value.baseRevision) && (value.baseRevision as number) >= 0 &&
        value.revision === (value.baseRevision as number) + 1 &&
        typeof value.operationId === "string" &&
        isSha256(value.requestDigest) &&
        isRecord(value.recordRefs) && Object.values(value.recordRefs).every((id) => typeof id === "string" && id.length > 0) &&
        isCommitReceipt(value.receipt) && value.receipt.workId === value.workId && value.receipt.commitId === value.id && value.receipt.operationId === value.operationId && value.receipt.revision === value.revision &&
        (value.previousCommitId === "" || typeof value.previousCommitId === "string")
    );
}

function isWorkDetailResponse(value: unknown): value is WorkDetailResponse {
    return isRecord(value) && isWork(value.work) && isCommit(value.currentCommit) && value.currentCommit.workId === value.work.id && value.currentCommit.id === value.work.currentCommitId && isRecord(value.records) && Object.entries(value.records).every(([id, record]) => isRecord(record) && record.id === id && isRecordType(record.type) && typeof record.workId === "string" && record.workId === value.work.id && typeof record.revisionId === "string" && Number.isSafeInteger(record.schemaVersion) && isRecord(record.data));
}

function isMediaDescriptor(value: unknown): value is MediaDescriptor {
    return (
        isRecord(value) &&
        typeof value.fileId === "string" && value.fileId.length > 0 &&
        typeof value.workId === "string" && value.workId.length > 0 &&
        isSha256(value.sha256) &&
        Number.isSafeInteger(value.bytes) && (value.bytes as number) > 0 &&
        typeof value.mimeType === "string" && value.mimeType.includes("/") &&
        (value.kind === "text" || value.kind === "image" || value.kind === "video" || value.kind === "audio") &&
        typeof value.extension === "string" && /^\.[a-z0-9]+$/i.test(value.extension) &&
        typeof value.createdAt === "string"
    );
}

function isMissingFileInfo(value: unknown): value is MissingFileInfo {
    return (
        isRecord(value) &&
        typeof value.reason === "string" && value.reason.length > 0 &&
        (value.sourceAssetId === undefined || typeof value.sourceAssetId === "string") &&
        (value.path === undefined || typeof value.path === "string") &&
        (value.url === undefined || typeof value.url === "string") &&
        (value.sha256 === undefined || isSha256(value.sha256))
    );
}

function isConflictInfo(value: unknown): value is ConflictInfo {
    return (
        isRecord(value) &&
        typeof value.type === "string" &&
        typeof value.message === "string"
    );
}

function isOperationInfo(value: unknown): value is OperationInfo {
    return (
        isRecord(value) &&
        typeof value.action === "string" && value.action.length > 0 &&
        typeof value.targetId === "string" &&
        typeof value.targetName === "string" &&
        (value.details === undefined || typeof value.details === "string")
    );
}

function isMigrationPreviewResult(value: unknown): value is MigrationPreviewResult {
    return (
        isRecord(value) &&
        typeof value.sourceId === "string" &&
        isSha256(value.sourceDigest) &&
        (value.sourceType === "infinite-canvas" || value.sourceType === "infinite-xia") &&
        typeof value.title === "string" &&
        isStringMap(value.entityMappings) &&
        isStringMap(value.fileMappings) &&
        typeof value.canCommit === "boolean" &&
        Array.isArray(value.missingFiles) &&
        value.missingFiles.every(isMissingFileInfo) &&
        Array.isArray(value.conflicts) &&
        value.conflicts.every(isConflictInfo) &&
        Array.isArray(value.operations) &&
        value.operations.every(isOperationInfo)
    );
}

function isMigrationCommitResult(value: unknown): value is MigrationCommitResult {
    return (
        isRecord(value) &&
        typeof value.workId === "string" && value.workId.length > 0 &&
        Number.isSafeInteger(value.revision) && (value.revision as number) >= 1 &&
        typeof value.commitId === "string" && value.commitId.length > 0 &&
        typeof value.operationId === "string" && value.operationId.length > 0 &&
        value.committed === true &&
        isIndexState(value.indexState) &&
        typeof value.sourceId === "string" &&
        isSha256(value.sourceDigest) &&
        typeof value.backupId === "string" &&
        Number.isSafeInteger(value.entityCount) && (value.entityCount as number) >= 0 &&
        Number.isSafeInteger(value.mediaCount) && (value.mediaCount as number) >= 0 &&
        (value.migrationRecord === undefined || (isRecord(value.migrationRecord) && typeof value.migrationRecord.sourceId === "string" && isSha256(value.migrationRecord.sourceDigest) && value.migrationRecord.status === "completed" && isStringMap(value.migrationRecord.entityMappings) && isStringMap(value.migrationRecord.fileMappings) && Array.isArray(value.migrationRecord.backupReferences) && value.migrationRecord.backupReferences.every((id) => typeof id === "string" && id.length > 0)))
    );
}

function isRebuildResult(value: unknown): value is { rebuilt: boolean } {
    return isRecord(value) && typeof value.rebuilt === "boolean";
}

function isWorkPackagePreviewResult(value: unknown): value is WorkPackagePreviewResult {
    return (
        isRecord(value) &&
        typeof value.workId === "string" &&
        typeof value.title === "string" &&
        Number.isSafeInteger(value.revision) && (value.revision as number) >= 1 &&
        isNonNegativeInteger(value.commitCount) &&
        isNonNegativeInteger(value.recordCount) &&
        isNonNegativeInteger(value.mediaCount) &&
        isNonNegativeInteger(value.totalBytes) &&
        isSha256(value.packageDigest) &&
        typeof value.canCommit === "boolean" &&
        Array.isArray(value.conflicts) &&
        value.conflicts.every(isConflictInfo) &&
        Array.isArray(value.missingFiles) &&
        value.missingFiles.every(isMissingFileInfo)
    );
}

function isWorkAuditReport(value: unknown): value is WorkAuditReport {
    return (
        isRecord(value) &&
        typeof value.workId === "string" &&
        typeof value.title === "string" &&
        Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 &&
        typeof value.currentCommitId === "string" &&
        typeof value.healthy === "boolean" &&
        isNonNegativeInteger(value.commitCount) &&
        isNonNegativeInteger(value.activeRecordCount) &&
        isNonNegativeInteger(value.activeMediaCount) &&
        isIndexState(value.indexState) &&
        Array.isArray(value.orphanRecordIds) &&
        value.orphanRecordIds.every((s) => typeof s === "string") &&
        Array.isArray(value.orphanMediaFiles) &&
        value.orphanMediaFiles.every((s) => typeof s === "string") &&
        Array.isArray(value.stagingFiles) &&
        value.stagingFiles.every((s) => typeof s === "string") &&
        Array.isArray(value.issues) &&
        value.issues.every((s) => typeof s === "string")
    );
}

function isInboxFileItem(value: unknown): value is InboxFileItem {
    return (
        isRecord(value) &&
        typeof value.filename === "string" && value.filename.length > 0 &&
        isSha256(value.sha256) &&
        Number.isSafeInteger(value.bytes) && (value.bytes as number) > 0 &&
        typeof value.mimeType === "string" && (value.mimeType === "application/octet-stream" || value.mimeType.startsWith(`${value.kind}/`)) &&
        (value.kind === "image" || value.kind === "video" || value.kind === "audio") &&
        (value.status === "new" || value.status === "duplicate") &&
        (value.existingFileId === undefined || (typeof value.existingFileId === "string" && value.existingFileId.length > 0)) &&
        (value.status !== "duplicate" || typeof value.existingFileId === "string")
    );
}

function isInboxScanResult(value: unknown): value is InboxScanResult {
    return (
        isRecord(value) &&
        typeof value.workId === "string" &&
        typeof value.scannedAt === "string" &&
        Array.isArray(value.files) &&
        value.files.every(isInboxFileItem)
    );
}

// Works Service Public API
export async function listWorks(): Promise<Work[]> {
    return request("/api/local/works", { method: "GET" }, isArrayOf(isWork));
}

export async function createWork(req: CreateWorkRequest): Promise<CreateWorkResult> {
    return request(
        "/api/local/works",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req),
        },
        isCreateWorkResult,
    );
}

export async function getWork(workId: string): Promise<WorkDetailResponse> {
    return request(`/api/local/works/${encodeURIComponent(workId)}`, { method: "GET" }, isWorkDetailResponse);
}

export async function commitWork(workId: string, req: CommitRequest): Promise<CommitResult> {
    return request(
        `/api/local/works/${encodeURIComponent(workId)}`,
        {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req),
        },
        isCommitResult,
    );
}

export async function uploadMedia(workId: string, file: Blob, filename: string, mimeType?: string): Promise<MediaDescriptor> {
    const formData = new FormData();
    formData.append("file", file, filename);
    if (mimeType) {
        formData.append("mimeType", mimeType);
    }
    return request(
        `/api/local/works/${encodeURIComponent(workId)}/media`,
        {
            method: "POST",
            body: formData,
        },
        isMediaDescriptor,
    );
}

export function getMediaUrl(workId: string, fileId: string): string {
    return `/api/local/works/${encodeURIComponent(workId)}/media/${encodeURIComponent(fileId)}`;
}

export async function previewMigration(workId: string, zipBlob: Blob): Promise<MigrationPreviewResult> {
    const formData = new FormData();
    formData.append("package", zipBlob, "migration.zip");

    return request(
        `/api/local/works/${encodeURIComponent(workId)}/migrations/preview`,
        {
            method: "POST",
            body: formData,
        },
        isMigrationPreviewResult,
    );
}

export async function commitMigration(
    workId: string,
    baseRevision: number,
    operationId: string,
    zipBlob: Blob,
): Promise<MigrationCommitResult> {
    const formData = new FormData();
    formData.append("package", zipBlob, "migration.zip");
    formData.append("baseRevision", String(baseRevision));
    formData.append("operationId", operationId);

    return request(
        `/api/local/works/${encodeURIComponent(workId)}/migrations/commit`,
        {
            method: "POST",
            body: formData,
        },
        isMigrationCommitResult,
    );
}

export async function rebuildWorkIndex(workId: string): Promise<{ rebuilt: boolean }> {
    return request(
        `/api/local/works/${encodeURIComponent(workId)}/rebuild-index`,
        {
            method: "POST",
        },
        isRebuildResult,
    );
}

export async function rebuildAllIndex(): Promise<{ rebuilt: boolean }> {
    return request(
        "/api/local/works/rebuild-index",
        {
            method: "POST",
        },
        isRebuildResult,
    );
}

export async function archiveEntities(
    workId: string,
    req: ArchiveRequest,
): Promise<CommitResult> {
    return request(
        `/api/local/works/${encodeURIComponent(workId)}/archive`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req),
        },
        isCommitResult,
    );
}

export async function restoreEntities(
    workId: string,
    req: RestoreRequest,
): Promise<CommitResult> {
    return request(
        `/api/local/works/${encodeURIComponent(workId)}/restore`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req),
        },
        isCommitResult,
    );
}

export function getExportWorkUrl(workId: string, revision?: number): string {
    const q = revision ? `?revision=${encodeURIComponent(String(revision))}` : "";
    return `/api/local/works/${encodeURIComponent(workId)}/export${q}`;
}

export async function previewWorkPackage(zipBlob: Blob): Promise<WorkPackagePreviewResult> {
    return request(
        "/api/local/works/packages/preview",
        {
            method: "POST",
            body: zipBlob,
        },
        isWorkPackagePreviewResult,
    );
}

export async function commitWorkPackage(operationId: string, zipBlob: Blob): Promise<Work> {
    return request(
        `/api/local/works/packages/commit?operationId=${encodeURIComponent(operationId)}`,
        {
            method: "POST",
            body: zipBlob,
        },
        isWork,
    );
}

export async function auditWork(workId: string): Promise<WorkAuditReport> {
    return request(
        `/api/local/works/${encodeURIComponent(workId)}/audit`,
        {
            method: "POST",
        },
        isWorkAuditReport,
    );
}

export async function scanInbox(workId: string): Promise<InboxScanResult> {
    return request(
        `/api/local/works/${encodeURIComponent(workId)}/inbox/scan`,
        {
            method: "POST",
        },
        isInboxScanResult,
    );
}

export async function adoptInbox(
    workId: string,
    req: AdoptInboxRequest,
): Promise<CommitResult> {
    return request(
        `/api/local/works/${encodeURIComponent(workId)}/inbox/adopt`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req),
        },
        isCommitResult,
    );
}
