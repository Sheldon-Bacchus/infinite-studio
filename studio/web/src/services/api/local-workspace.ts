import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasAssistantMessage, CanvasAssistantReference, CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasNodeImage, CanvasNodeText } from "@/types/canvas";
import { LocalWorkspaceError, type DeleteRequest, type DeleteResult, type FileReference, type RecordEnvelope, type WorkspaceInfo, type WriteRequest, type WriteResult } from "@/lib/local-workspace/types";

type APIResponse = { code: number; data: unknown; msg: string };
type Guard<T> = (value: unknown) => value is T;

export const isLocalWorkspaceMode = import.meta.env.VITE_STORAGE_MODE === "local-workspace";

export async function loadLocalWorkspace() {
    return request("/api/local/workspace", { method: "GET" }, isWorkspaceInfo);
}

export async function listLocalCanvasProjects() {
    return request("/api/local/canvas/projects", { method: "GET" }, isArrayOf(isCanvasEnvelope));
}

export async function getLocalCanvasProject(id: string) {
    return request(`/api/local/canvas/projects/${encodeURIComponent(id)}`, { method: "GET" }, isCanvasEnvelope);
}

export async function getLocalWorkspaceOperation<T>(operationId: string, dataGuard: Guard<T>) {
    return request(`/api/local/operations/${encodeURIComponent(operationId)}`, { method: "GET" }, (value): value is WriteResult<T> => isWriteResult(value, dataGuard));
}

export async function commitLocalCanvasProject(
    id: string,
    requestData: WriteRequest<CanvasProject>,
): Promise<WriteResult<CanvasProject>> {
    return request(`/api/local/canvas/projects/${encodeURIComponent(id)}`, jsonRequest("PUT", requestData), isCanvasWriteResult);
}

export async function deleteLocalCanvasProject(id: string, requestData: DeleteRequest) {
    return request(`/api/local/canvas/projects/${encodeURIComponent(id)}`, jsonRequest("DELETE", requestData), isDeleteResult);
}

export async function listLocalWorkspaceAssets() {
    return request("/api/local/assets", { method: "GET" }, isArrayOf(isAssetEnvelope));
}

export async function commitLocalWorkspaceAsset(id: string, requestData: WriteRequest<Asset>) {
    return request(`/api/local/assets/${encodeURIComponent(id)}`, jsonRequest("PUT", requestData), isAssetWriteResult);
}

export async function deleteLocalWorkspaceAsset(id: string, requestData: DeleteRequest) {
    return request(`/api/local/assets/${encodeURIComponent(id)}`, jsonRequest("DELETE", requestData), isDeleteResult);
}

export async function uploadLocalWorkspaceFile(blob: Blob, filename: string, fileId?: string) {
    const body = new FormData();
    body.append("file", blob, filename);
    if (fileId) body.append("fileId", fileId);
    return request("/api/local/files", { method: "POST", body }, isFileReference, 201);
}

export async function downloadLocalWorkspaceFile(fileId: string, fetcher: typeof fetch = fetch) {
    let response: Response;
    try {
        response = await fetcher(fileContentUrl(fileId));
    } catch {
        throw new LocalWorkspaceError("本地工作区服务不可用", "unavailable");
    }
    if (!response.ok) throw errorForStatus(response.status, "读取工作区原件失败");
    return response.blob();
}

export function fileContentUrl(fileId: string) {
    return `/api/files/${encodeURIComponent(fileId)}/content`;
}

function jsonRequest(method: "PUT" | "DELETE", body: unknown): RequestInit {
    return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function request<T>(path: string, init: RequestInit, guard: Guard<T>, successStatus = 200): Promise<T> {
    let response: Response;
    try {
        response = await fetch(path, init);
    } catch {
        throw new LocalWorkspaceError("本地工作区服务不可用；草稿仍保留在浏览器", "unavailable");
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new LocalWorkspaceError("本地工作区返回了无法识别的响应", "invalid", response.status);
    }
    if (!isAPIResponse(payload)) throw new LocalWorkspaceError("本地工作区返回了无法识别的响应", "invalid", response.status);
    if (!response.ok || payload.code !== 0) throw errorForStatus(response.status, payload.msg || "本地工作区请求失败");
    if (response.status !== successStatus || !guard(payload.data)) {
        throw new LocalWorkspaceError("本地工作区响应数据格式无效", "invalid", response.status);
    }
    return payload.data;
}

function errorForStatus(status: number, message: string) {
    if (status === 404) return new LocalWorkspaceError(message, "not-found", status);
    if (status === 409) return new LocalWorkspaceError(message, "conflict", status);
    if (status === 422) return new LocalWorkspaceError(message, "invalid", status);
    if (status === 503 || status === 502 || status === 504) return new LocalWorkspaceError(message, "unavailable", status);
    return new LocalWorkspaceError(message, "server", status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAPIResponse(value: unknown): value is APIResponse {
    return isRecord(value) && typeof value.code === "number" && "data" in value && typeof value.msg === "string";
}

function isWorkspaceInfo(value: unknown): value is WorkspaceInfo {
    return (
        isRecord(value) &&
        value.schemaVersion === 1 &&
        typeof value.workspaceId === "string" &&
        value.workspaceId.length > 0 &&
        typeof value.dataRoot === "string" &&
        value.storage === "sqlite" &&
        typeof value.serviceInstanceId === "string" &&
        value.serviceInstanceId.length > 0
    );
}

function isRecordEnvelope<T>(value: unknown, dataGuard: Guard<T>): value is RecordEnvelope<T> {
    return (
        isRecord(value) &&
        typeof value.workspaceId === "string" &&
        typeof value.id === "string" &&
        Number.isSafeInteger(value.revision) &&
        Number(value.revision) > 0 &&
        dataGuard(value.data) &&
        isRecord(value.data) &&
        value.data.id === value.id
    );
}

export function isCanvasProject(value: unknown): value is CanvasProject {
    return (
        isRecord(value) &&
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        typeof value.createdAt === "string" &&
        typeof value.updatedAt === "string" &&
        isArrayOf(isCanvasNode)(value.nodes) &&
        isArrayOf(isCanvasConnection)(value.connections) &&
        isArrayOf(isAssistantSession)(value.chatSessions) &&
        (typeof value.activeChatId === "string" || value.activeChatId === null) &&
        (value.backgroundMode === "dots" || value.backgroundMode === "lines" || value.backgroundMode === "blank") &&
        typeof value.showImageInfo === "boolean" &&
        isRecord(value.viewport) &&
        isFiniteNumber(value.viewport.x) &&
        isFiniteNumber(value.viewport.y) &&
        isFiniteNumber(value.viewport.k)
    );
}

export function isAsset(value: unknown): value is Asset {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string" || typeof value.coverUrl !== "string" || !isArrayOf(isString)(value.tags) || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" || !isRecord(value.data)) return false;
    if (!isOptionalString(value.source) || !isOptionalString(value.note) || !isOptionalString(value.coverFileId) || (value.metadata !== undefined && !isRecord(value.metadata))) return false;
    if (value.kind === "text") return typeof value.data.content === "string";
    if (value.kind === "image") return typeof value.data.dataUrl === "string" && isOptionalString(value.data.storageKey) && isOptionalString(value.data.fileId) && isFiniteNumber(value.data.width) && isFiniteNumber(value.data.height) && isFiniteNumber(value.data.bytes) && typeof value.data.mimeType === "string";
    if (value.kind === "video") return typeof value.data.url === "string" && isOptionalString(value.data.storageKey) && isOptionalString(value.data.fileId) && isFiniteNumber(value.data.width) && isFiniteNumber(value.data.height) && isFiniteNumber(value.data.bytes) && typeof value.data.mimeType === "string";
    if (value.kind === "audio") return typeof value.data.url === "string" && isOptionalString(value.data.storageKey) && isOptionalString(value.data.fileId) && (value.data.duration === undefined || isFiniteNumber(value.data.duration)) && isFiniteNumber(value.data.bytes) && typeof value.data.mimeType === "string";
    return false;
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isCanvasNodeImage(value: unknown): value is CanvasNodeImage {
    return isRecord(value) && typeof value.id === "string" && isNodeStatus(value.status) && typeof value.content === "string" && isOptionalString(value.storageKey) && isOptionalString(value.fileId) && isFiniteNumber(value.naturalWidth) && isFiniteNumber(value.naturalHeight) && isFiniteNumber(value.bytes) && typeof value.mimeType === "string" && isOptionalString(value.errorDetails);
}

function isCanvasNodeText(value: unknown): value is CanvasNodeText {
    return isRecord(value) && typeof value.id === "string" && isNodeStatus(value.status) && typeof value.content === "string" && isOptionalString(value.errorDetails);
}

function isNodeStatus(value: unknown) {
    return value === "idle" || value === "success" || value === "loading" || value === "error";
}

function isCanvasNode(value: unknown): value is CanvasNodeData {
    return isRecord(value) && typeof value.id === "string" && typeof value.type === "string" && typeof value.title === "string" && isRecord(value.position) && isFiniteNumber(value.position.x) && isFiniteNumber(value.position.y) && isFiniteNumber(value.width) && isFiniteNumber(value.height) && (value.metadata === undefined || isCanvasNodeMetadata(value.metadata));
}

function isCanvasNodeMetadata(value: unknown) {
    if (!isRecord(value)) return false;
    for (const key of ["content", "composerContent", "prompt", "errorDetails", "model", "size", "quality", "background", "primaryTextId", "seconds", "vquality", "generateAudio", "watermark", "videoMode", "audioVoice", "audioFormat", "audioInstructions", "primaryImageId", "storageKey", "fileId", "mimeType", "videoTaskId", "groupId", "agentOperationId"]) if (!isOptionalString(value[key])) return false;
    for (const key of ["fontSize", "count", "textCount", "audioSpeed", "naturalWidth", "naturalHeight", "bytes", "durationMs"]) if (value[key] !== undefined && !isFiniteNumber(value[key])) return false;
    if (value.status !== undefined && !isNodeStatus(value.status)) return false;
    if (value.generationMode !== undefined && !["text", "image", "video", "audio"].includes(String(value.generationMode))) return false;
    if (value.generationType !== undefined && value.generationType !== "generation" && value.generationType !== "edit") return false;
    if (value.reasoningEffort !== undefined && !["auto", "low", "medium", "high", "xhigh"].includes(String(value.reasoningEffort))) return false;
    if (value.videoTaskProvider !== undefined && value.videoTaskProvider !== "openai" && value.videoTaskProvider !== "gemini" && value.videoTaskProvider !== "autodl") return false;
    if (value.freeResize !== undefined && typeof value.freeResize !== "boolean") return false;
    if (value.interactive !== undefined && typeof value.interactive !== "boolean") return false;
    if (value.references !== undefined && !isArrayOf(isString)(value.references)) return false;
    if (value.images !== undefined && !isArrayOf(isCanvasNodeImage)(value.images)) return false;
    if (value.texts !== undefined && !isArrayOf(isCanvasNodeText)(value.texts)) return false;
    return true;
}

function isCanvasConnection(value: unknown): value is CanvasConnection {
    return isRecord(value) && typeof value.id === "string" && typeof value.fromNodeId === "string" && typeof value.toNodeId === "string";
}

function isAssistantReference(value: unknown): value is CanvasAssistantReference {
    return isRecord(value) && typeof value.id === "string" && typeof value.type === "string" && typeof value.title === "string" && isOptionalString(value.dataUrl) && isOptionalString(value.storageKey) && isOptionalString(value.fileId) && isOptionalString(value.legacyStorageKey) && (value.mediaMissing === undefined || typeof value.mediaMissing === "boolean") && isOptionalString(value.text);
}

function isAssistantMessage(value: unknown): value is CanvasAssistantMessage {
    return isRecord(value) && typeof value.id === "string" && ["user", "assistant", "system", "tool", "error"].includes(String(value.role)) && typeof value.text === "string" && isOptionalString(value.title) && isOptionalString(value.meta) && (value.references === undefined || isArrayOf(isAssistantReference)(value.references));
}

function isAssistantSession(value: unknown): value is CanvasAssistantSession {
    return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && typeof value.createdAt === "string" && typeof value.updatedAt === "string" && isArrayOf(isAssistantMessage)(value.messages);
}

function isCanvasEnvelope(value: unknown): value is RecordEnvelope<CanvasProject> {
    return isRecordEnvelope(value, isCanvasProject);
}

function isAssetEnvelope(value: unknown): value is RecordEnvelope<Asset> {
    return isRecordEnvelope(value, isAsset);
}

function isArrayOf<T>(guard: Guard<T>): Guard<T[]> {
    return (value): value is T[] => Array.isArray(value) && value.every(guard);
}

function isWriteResult<T>(value: unknown, dataGuard: Guard<T>): value is WriteResult<T> {
    return isRecord(value) && typeof value.operationId === "string" && isRecordEnvelope(value, dataGuard);
}

function isCanvasWriteResult(value: unknown): value is WriteResult<CanvasProject> {
    return isWriteResult(value, isCanvasProject);
}

function isAssetWriteResult(value: unknown): value is WriteResult<Asset> {
    return isWriteResult(value, isAsset);
}

function isFileReference(value: unknown): value is FileReference {
    return (
        isRecord(value) &&
        typeof value.fileId === "string" &&
        typeof value.storageKey === "string" &&
        typeof value.sha256 === "string" &&
        Number.isSafeInteger(value.bytes) &&
        Number(value.bytes) >= 0 &&
        typeof value.mimeType === "string" &&
        typeof value.url === "string"
    );
}

function isDeleteResult(value: unknown): value is DeleteResult {
    return (
        isRecord(value) &&
        typeof value.workspaceId === "string" &&
        typeof value.id === "string" &&
        Number.isSafeInteger(value.revision) &&
        Number(value.revision) > 0 &&
        typeof value.operationId === "string" &&
        value.deleted === true
    );
}
