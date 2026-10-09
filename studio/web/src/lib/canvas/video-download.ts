import i18n from "@/i18n";
import { getMediaBlob } from "@/services/file-storage";
import { downloadLocalWorkspaceFile } from "@/services/api/local-workspace";
import { isLocalWorkspaceMode } from "@/services/api/local-workspace";

/**
 * 片场下载分析结论（docs/plans/studio-video-download-analysis.md）：
 * - 当前 project.tsx 的 saveAs(node.metadata.content) 一直可用，FileSaver 直接保存 URL，不强制 fetch。
 * - 上游 video-download 强制 fetch Blob，远程签名地址会跨域失败，只有代理开启后才成功；片场不采用该强制路径。
 * - 片场本地模式媒体已有 fileId / storageKey=file:ID 与同源 /api/files 原件，可先用 getMediaBlob 读取。
 * 因此这里保留 URL saveAs 成功路径，只在本地原件存在时优先读 Blob；FileSaver 返回 void，不据此伪造“下载成功”。
 */
export function isLocalVideoFileId(fileId?: string, storageKey?: string) {
    return Boolean(fileId || (storageKey && storageKey.startsWith("file:")));
}

export function videoDownloadFilename(nodeId: string) {
    return `canvas-video-${nodeId}.mp4`;
}

/** 只有真实存在且可读的本地原件才返回 Blob；读取失败返回 null，交由调用方继续原有 URL 路径。 */
export async function readLocalVideoBlob(fileId?: string, storageKey?: string): Promise<Blob | null> {
    if (!isLocalWorkspaceMode) return null;
    const id = fileId || (storageKey?.startsWith("file:") ? storageKey.slice("file:".length) : "");
    if (!id) return null;
    try {
        const blob = await downloadLocalWorkspaceFile(id);
        return blob.size ? blob : null;
    } catch {
        return null;
    }
}

/** 备用通道：本地原件也可经 storageKey 直接从浏览器 IndexedDB / 工作区读取。 */
export async function readStoredVideoBlob(storageKey?: string, fileId?: string): Promise<Blob | null> {
    if (!storageKey) return null;
    try {
        const blob = await getMediaBlob(storageKey);
        if (blob?.size) return blob;
    } catch {
        // 本地原件缺失时静默回退，不改变既有 URL 下载路径。
    }
    return readLocalVideoBlob(fileId, storageKey);
}

export type VideoDownloadContext = {
    content: string;
    storageKey?: string;
    fileId?: string;
    nodeId: string;
    saveAs: (data: Blob | string, filename: string) => void;
    notifyError: (message: string) => void;
    confirmOpenOriginal: (url: string) => void;
};

/**
 * 视频下载主流程：本地原件优先 Blob；否则保留既有 saveAs(content) 直存 URL。
 * 直存失败时提示真实可观察原因，并让用户显式打开原地址，不把打开原页当作下载成功。
 */
export async function downloadVideoNode(context: VideoDownloadContext): Promise<void> {
    const filename = videoDownloadFilename(context.nodeId);
    const local = await readStoredVideoBlob(context.storageKey, context.fileId);
    const payload: Blob | string = local || context.content;
    try {
        context.saveAs(payload, filename);
        return;
    } catch (error) {
        if (!local && context.content) {
            context.notifyError(videoDownloadErrorMessage(error));
            context.confirmOpenOriginal(context.content);
            return;
        }
        context.notifyError(videoDownloadErrorMessage(error));
    }
}

export function videoDownloadErrorMessage(error: unknown) {
    if (error instanceof Error && error.message.trim()) return error.message.trim();
    if (typeof error === "string" && error.trim()) return error.trim();
    return i18n.t("apiErrors.videoDownloadFailed");
}

