import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { unzipSync } from "fflate";

function decode(bytes) {
    return new TextDecoder().decode(bytes);
}

async function request(apiBase, pathname, options = {}) {
    const response = await fetch(`${apiBase}${pathname}`, options);
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.code !== 0) {
        throw new Error(payload?.msg || `${pathname} 请求失败：${response.status}`);
    }
    return payload.data;
}

async function uploadFile(apiBase, bytes, filename, mimeType, signal) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mimeType || "application/octet-stream" }), filename);
    return request(apiBase, "/api/local/files", { method: "POST", body: form, signal });
}

function rewriteImportedProject(value, replacements) {
    if (typeof value === "string") return replacements.get(value)?.storageKey || value;
    if (Array.isArray(value)) return value.map((item) => rewriteImportedProject(item, replacements));
    if (!value || typeof value !== "object") return value;

    const result = Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, rewriteImportedProject(item, replacements)]),
    );
    const sourceStorageKey = typeof value.storageKey === "string" ? value.storageKey : "";
    const replacement = replacements.get(sourceStorageKey);
    if (replacement) {
        result.storageKey = replacement.storageKey;
        for (const field of ["url", "dataUrl", "content"]) {
            if (typeof value[field] === "string" && value[field]) result[field] = replacement.url;
        }
    }
    return result;
}

export async function importLocalCanvasZip({ zipPath } = {}, signal) {
    if (typeof zipPath !== "string" || !zipPath.trim() || !path.isAbsolute(zipPath)) {
        throw new Error("zipPath 必须是本机上的绝对路径");
    }

    const absoluteZipPath = path.resolve(zipPath);
    const file = await stat(absoluteZipPath);
    if (!file.isFile()) throw new Error("zipPath 必须指向 ZIP 文件");

    const apiBase = (process.env.INFINITE_CANVAS_API_BASE || "http://127.0.0.1:8081").replace(/\/$/, "");
    const zip = unzipSync(new Uint8Array(await readFile(absoluteZipPath, { signal })));
    const manifestBytes = zip["projects.json"];
    if (!manifestBytes) throw new Error("压缩包缺少 projects.json");

    let manifest;
    try {
        manifest = JSON.parse(decode(manifestBytes));
    } catch {
        throw new Error("压缩包 projects.json 格式无效");
    }
    if (!Array.isArray(manifest.projects) || manifest.projects.length === 0) {
        throw new Error("压缩包没有可导入的画布项目");
    }

    const replacements = new Map();
    const uploadedByStorageKey = new Map();
    for (const item of manifest.projects.flatMap((project) => project.files || [])) {
        if (uploadedByStorageKey.has(item.storageKey)) continue;
        const bytes = zip[item.path];
        if (!bytes) throw new Error(`压缩包缺少文件：${item.path}`);
        const upload = await uploadFile(apiBase, bytes, path.basename(item.path), item.mimeType, signal);
        uploadedByStorageKey.set(item.storageKey, upload);
        replacements.set(item.storageKey, { storageKey: upload.storageKey, url: upload.url });
    }

    const projects = manifest.projects.map((item) => {
        const project = rewriteImportedProject(item.project, replacements);
        const { createdAt: _createdAt, updatedAt: _updatedAt, ...identitySource } = item.project;
        const fingerprint = createHash("sha256").update(JSON.stringify(identitySource)).digest("hex").slice(0, 24);
        const now = new Date().toISOString();
        return {
            ...project,
            id: project.id || `imported-${fingerprint}`,
            importKey: project.importKey || `zip-project:${fingerprint}`,
            createdAt: project.createdAt || now,
            updatedAt: now,
        };
    });
    const saved = await request(apiBase, "/api/local/canvas/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects }),
        signal,
    });
    if (!Array.isArray(saved)) throw new Error("本地画布 API 返回了无效的项目清单");

    return {
        apiBase,
        zipPath: absoluteZipPath,
        uploadedFiles: uploadedByStorageKey.size,
        importedProjects: projects.length,
        backendProjects: saved.length,
        projectTitles: saved.map((project) => project.title),
    };
}
