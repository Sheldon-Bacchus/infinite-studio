import { readZip } from "@/lib/zip";
import { commitLocalCanvasProject, isCanvasProject, listLocalCanvasProjects, loadLocalWorkspace, uploadLocalWorkspaceFile } from "@/services/api/local-workspace";
import type { CanvasExportAsset } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { FileReference, RecordEnvelope } from "@/lib/local-workspace/types";

type PreparedFile = CanvasExportAsset & { blob: Blob; sha256: string; filename: string };
type PreparedProject = { project: CanvasProject; canonicalProject: CanvasProject; files: PreparedFile[]; inlineMedia: Map<string, Blob>; state: "new" | "same" | "conflict" };

export type LocalWorkspaceImportPlan = {
    workspaceId: string;
    projects: PreparedProject[];
    errors: string[];
};

export async function prepareLocalWorkspaceImport(file: File): Promise<LocalWorkspaceImportPlan> {
    const [workspace, envelopes, zip] = await Promise.all([loadLocalWorkspace(), listLocalCanvasProjects(), readZip(file)]);
    const manifestFile = zip.get("projects.json");
    if (!manifestFile) throw new Error("ZIP 中缺少 projects.json");
    let raw: unknown;
    try {
        raw = JSON.parse(await manifestFile.text());
    } catch {
        throw new Error("projects.json 不是有效 JSON");
    }
    if (!isRecord(raw) || raw.app !== "infinite-canvas" || raw.version !== 3 || !Array.isArray(raw.projects) || !raw.projects.length) throw new Error("ZIP 版本或项目清单不受支持");

    const existing = new Map(envelopes.map((item) => [item.id, item]));
    const seen = new Map<string, string>();
    const seenFiles = new Map<string, string>();
    const errors: string[] = [];
    const prepared: PreparedProject[] = [];
    for (const [index, entry] of raw.projects.entries()) {
        if (!isRecord(entry) || !isCanvasProject(entry.project) || !Array.isArray(entry.files)) {
            errors.push(`第 ${index + 1} 个项目数据无效`);
            continue;
        }
        const project = entry.project;
        const projectContent = stableJSON(project);
        const previous = seen.get(project.id);
        if (previous && previous !== projectContent) errors.push(`ZIP 内画布 ID ${project.id} 出现不同内容`);
        seen.set(project.id, projectContent);
        const files: PreparedFile[] = [];
        const storageKeys = new Set<string>();
        for (const value of entry.files) {
            if (!isCanvasExportAsset(value) || storageKeys.has(value.storageKey) || !safeArchivePath(value.path, project.id)) {
                errors.push(`画布「${project.title}」的媒体清单无效`);
                continue;
            }
            storageKeys.add(value.storageKey);
            const blob = zip.get(value.path);
            if (!blob || blob.size !== value.bytes) {
                errors.push(`画布「${project.title}」缺少原件 ${value.path}`);
                continue;
            }
            const typedBlob = blob.type ? blob : blob.slice(0, blob.size, value.mimeType);
            const fileHash = await digest(typedBlob);
            const previousHash = seenFiles.get(value.storageKey);
            if (previousHash && previousHash !== fileHash) errors.push(`ZIP 中媒体 ${value.storageKey} 对应了不同原件`);
            seenFiles.set(value.storageKey, fileHash);
            files.push({ ...value, blob: typedBlob, sha256: fileHash, filename: archiveFilename(value.path) });
        }
        const missingReferences = collectMissingFileReferences(project, storageKeys);
        if (missingReferences.length) errors.push(`画布「${project.title}」引用了清单外的媒体：${missingReferences.join("、")}`);
        const inlineMedia = await collectInlineMedia(project, storageKeys, errors, project.title);
        const previewRefs = await buildPreviewRefs(workspace.workspaceId, files, inlineMedia);
        const canonicalProject = rewriteProject(project, previewRefs);
        const current = existing.get(project.id);
        const state = current ? stableJSON(current.data) === stableJSON(canonicalProject) ? "same" : "conflict" : "new";
        prepared.push({ project, canonicalProject, files, inlineMedia, state });
    }

    const firstContent = new Map<string, string>();
    for (const item of prepared) {
        const content = stableJSON(item.canonicalProject);
        if (firstContent.has(item.project.id)) {
            if (firstContent.get(item.project.id) !== content) errors.push(`ZIP 内画布 ID ${item.project.id} 出现冲突`);
            item.state = "same";
        } else firstContent.set(item.project.id, content);
    }
    return { workspaceId: workspace.workspaceId, projects: prepared, errors };
}

export function localWorkspaceImportConflicts(plan: LocalWorkspaceImportPlan) {
    return plan.projects.filter((item) => item.state === "conflict");
}

export async function commitLocalWorkspaceImport(plan: LocalWorkspaceImportPlan, onCommitted?: (project: RecordEnvelope<CanvasProject>) => void) {
    if (plan.errors.length || localWorkspaceImportConflicts(plan).length) throw new Error("ZIP 中存在错误或画布 ID 冲突，已拒绝导入");
    const imported: RecordEnvelope<CanvasProject>[] = [];
    const uploaded = new Map<string, FileReference>();
    for (const item of plan.projects) {
        if (item.state !== "new") continue;
        const refs = new Map<string, FileReference>();
        for (const source of [...item.files.map((entry) => ({ key: entry.storageKey, blob: entry.blob, filename: entry.filename })), ...[...item.inlineMedia].map(([key, blob]) => ({ key, blob, filename: mediaFilename(blob.type) }))]) {
            let ref = uploaded.get(source.key);
            if (!ref) {
                const fileId = await importFileId(plan.workspaceId, await digest(source.blob));
                ref = await uploadLocalWorkspaceFile(source.blob, source.filename, fileId);
                uploaded.set(source.key, ref);
            }
            refs.set(source.key, ref);
            if (source.key.startsWith("file:")) refs.set(source.key.slice("file:".length), ref);
        }
        const data = rewriteProject(item.project, refs);
        const operationId = `zip_import_${(await digest(new Blob([`${plan.workspaceId}\0${item.project.id}\0${stableJSON(data)}`]))).slice(0, 48)}`;
        const result = await commitLocalCanvasProject(data.id, { workspaceId: plan.workspaceId, operationId, baseRevision: null, data });
        imported.push(result);
        onCommitted?.(result);
    }
    return imported;
}

function rewriteProject(project: CanvasProject, refs: Map<string, FileReference>): CanvasProject {
    const rewrite = (value: unknown, key = "", ownerRef?: FileReference): unknown => {
        if (typeof value === "string") {
            if (value.startsWith("blob:")) throw new Error("ZIP 画布包含无法恢复的 blob URL");
            if (value.startsWith("data:") && isInlineMedia(value) && ownerRef) return ownerRef.url;
            if (value.startsWith("data:") && isInlineMedia(value)) {
                const ref = refs.get(value);
                if (!ref) throw new Error("ZIP 内嵌媒体未进入原件映射");
                return ref.url;
            }
            if (key === "storageKey" && ownerRef) return ownerRef.storageKey;
            if ((key === "fileId" || key === "coverFileId") && ownerRef) return ownerRef.fileId;
            if (key === "references" && value.startsWith("file:")) return refs.get(value)?.storageKey || value;
            if (["content", "dataUrl", "url", "coverUrl"].includes(key) && ownerRef && (value.startsWith("/api/files/") || value.startsWith("data:"))) return ownerRef.url;
            return value;
        }
        if (Array.isArray(value)) return value.map((item) => rewrite(item, key, ownerRef));
        if (!isRecord(value)) return value;
        const ownRef = (typeof value.storageKey === "string" ? refs.get(value.storageKey) : undefined)
            || (typeof value.fileId === "string" ? refs.get(`file:${value.fileId}`) : undefined)
            || (typeof value.coverFileId === "string" ? refs.get(`file:${value.coverFileId}`) : undefined)
            || ownerRef;
        return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, rewrite(child, childKey, ownRef)]));
    };
    return rewrite(project) as CanvasProject;
}

async function buildPreviewRefs(workspaceId: string, files: PreparedFile[], inlineMedia: Map<string, Blob>) {
    const refs = new Map<string, FileReference>();
    const entries = [
        ...files.map((file) => ({ key: file.storageKey, bytes: file.bytes, mimeType: file.mimeType, sha256: file.sha256 })),
        ...[...inlineMedia].map(async ([key, blob]) => ({ key, bytes: blob.size, mimeType: blob.type || "application/octet-stream", sha256: await digest(blob) })),
    ];
    for (const entry of entries) {
        const file = await entry;
        const fileId = await importFileId(workspaceId, file.sha256);
        const ref = { fileId, storageKey: `file:${fileId}`, sha256: file.sha256, bytes: file.bytes, mimeType: file.mimeType, url: `/api/files/${fileId}/content` };
        refs.set(file.key, ref);
        if (file.key.startsWith("file:")) refs.set(file.key.slice("file:".length), ref);
    }
    return refs;
}

async function importFileId(workspaceId: string, fileHash: string) {
    return `import_${(await digest(new Blob([`${workspaceId}\0${fileHash}`]))).slice(0, 48)}`;
}

function collectMissingFileReferences(project: CanvasProject, storageKeys: Set<string>) {
    const missing = new Set<string>();
    const walk = (value: unknown, key = "") => {
        if (typeof value === "string") {
            if (key === "storageKey" && /^(file|image|video|audio|video-reference|audio-reference):/.test(value) && !storageKeys.has(value)) missing.add(value);
            if ((key === "fileId" || key === "coverFileId") && value && !storageKeys.has(`file:${value}`)) missing.add(`file:${value}`);
            if (key === "references" && value.startsWith("file:") && !storageKeys.has(value)) missing.add(value);
        } else if (Array.isArray(value)) value.forEach((item) => walk(item, key));
        else if (isRecord(value)) Object.entries(value).forEach(([childKey, child]) => walk(child, childKey));
    };
    walk(project);
    return [...missing];
}

async function collectInlineMedia(value: unknown, storageKeys: Set<string>, errors: string[], title: string) {
    const result = new Map<string, Blob>();
    const strings: string[] = [];
    const visit = (item: unknown, fileBacked = false) => {
        if (typeof item === "string") {
            if (item.startsWith("blob:")) errors.push(`画布「${title}」含无法导入的 blob URL`);
            else if (!fileBacked && item.startsWith("data:") && isInlineMedia(item)) strings.push(item);
        } else if (Array.isArray(item)) item.forEach((child) => visit(child, fileBacked));
        else if (isRecord(item)) {
            const key = typeof item.storageKey === "string" ? item.storageKey : typeof item.fileId === "string" ? `file:${item.fileId}` : typeof item.coverFileId === "string" ? `file:${item.coverFileId}` : "";
            const hasFile = fileBacked || Boolean(key && storageKeys.has(key));
            Object.values(item).forEach((child) => visit(child, hasFile));
        }
    };
    visit(value);
    await Promise.all(strings.map(async (source) => {
        try {
            const response = await fetch(source);
            if (!response.ok) throw new Error("media read failed");
            result.set(source, await response.blob());
        } catch {
            errors.push(`画布「${title}」的内嵌媒体无法读取`);
        }
    }));
    return result;
}

function isInlineMedia(value: string) {
    return /^data:(?:image|audio|video|application)\//i.test(value);
}

function isCanvasExportAsset(value: unknown): value is CanvasExportAsset {
    return isRecord(value) && typeof value.storageKey === "string" && Boolean(value.storageKey) && typeof value.path === "string" && typeof value.mimeType === "string" && Number.isSafeInteger(value.bytes) && Number(value.bytes) >= 0;
}

function safeArchivePath(value: string, projectId: string) {
    const parts = value.replaceAll("\\", "/").split("/");
    return !value.startsWith("/") && !/^[a-z]:/i.test(value) && parts.every((part) => part && part !== "." && part !== "..") && parts[0] === "projects" && parts[1] === projectId && parts[2] === "files";
}

function archiveFilename(value: string) {
    return value.split(/[\\/]/).at(-1) || "imported-file";
}

function mediaFilename(mimeType: string) {
    const subtype = mimeType.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "bin";
    return `imported-media.${subtype}`;
}

function stableJSON(value: unknown): string {
    const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : isRecord(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])])) : item;
    return JSON.stringify(sort(value));
}

async function digest(blob: Blob) {
    const bytes = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
