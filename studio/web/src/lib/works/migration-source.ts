// SPDX-License-Identifier: AGPL-3.0-or-later

import localforage from "localforage";
import { strToU8, zipSync, unzipSync } from "fflate";
import {
    buildXiaMigrationBundle,
    computeSubstantiveDigest,
    sha256Hex,
    deterministicId32,
    type ExtractedMediaFile,
    type MigrationEntityItem,
    type MigrationFileInfo,
    type MigrationManifest,
    type MigrationMissingFileInfo,
} from "../../../../../plugins/canvas/infinite-xia/src/migration";
import type { Asset as XiaAsset } from "../../../../../plugins/canvas/infinite-xia/src/core/asset-types";
import { parseWorkspace } from "../../../../../plugins/canvas/infinite-xia/src/workspace";
import { getLocalStudioRecord } from "../../../../../plugins/canvas/infinite-xia/src/core/local-studio-model";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";

// 宿主与插件各存储实例初始化（只读接入，绝不修改旧来源数据）
const xiaStore = localforage.createInstance({ name: "infinite-canvas-plugins", storeName: "infinite-xia" });
const imageFilesStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const mediaFilesStore = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const appStateStore = localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" });

export interface ExportedMigrationPackage {
    blob: Blob;
    manifest: MigrationManifest;
    filename: string;
}

export interface ProjectOption {
    id: string;
    title: string;
}

const MIME_TO_EXT: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "text/plain": ".txt",
    "application/json": ".json",
    "text/markdown": ".md",
};

/**
 * 列出本地无限虾所有项目（Point 9: 供用户选择单一项目导出）
 */
export async function listXiaProjects(): Promise<ProjectOption[]> {
    const rawVal = await xiaStore.getItem<unknown>("workspace-v1");
    if (!rawVal) return [];
    try {
        const ws = parseWorkspace(rawVal);
        return ws.assets
            .filter((a) => {
                const rec = getLocalStudioRecord(a);
                return rec?.recordType === "project";
            })
            .map((a) => ({
                id: a.id,
                title: a.title || "未命名无限虾项目",
            }));
    } catch (err) {
        throw new Error(`无限虾工作区数据损坏或格式错误: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * 列出本地无限画布所有项目（Point 9: 供用户选择单一画布导出）
 */
export async function listCanvasProjects(): Promise<ProjectOption[]> {
    const rawCanvas = await appStateStore.getItem<string>("infinite-canvas:canvas_store");
    if (!rawCanvas) return [];
    try {
        const state = JSON.parse(rawCanvas) as { state?: { projects?: Array<{ id: string; title: string }> } };
        return (state?.state?.projects || []).map((p) => ({
            id: p.id,
            title: p.title || "未命名画布",
        }));
    } catch (err) {
        throw new Error(`本地画布存储数据损坏或无法解析: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * 尝试从宿主各本地存储池与工作区解析媒体原件二进制数据 (Point 8)
 */
async function resolveLocalMediaBlob(asset: XiaAsset): Promise<Blob | null> {
    if (asset.kind === "image") {
        if (asset.data.storageKey) {
            const blob = await getImageBlob(String(asset.data.storageKey));
            if (blob) return blob;
            const stored = await imageFilesStore.getItem<Blob>(String(asset.data.storageKey));
            if (stored) return stored;
        }
        if (asset.data.fileId) {
            const blob = await getImageBlob(`file:${asset.data.fileId}`);
            if (blob) return blob;
        }
        if (asset.data.dataUrl && typeof asset.data.dataUrl === "string") {
            try {
                const res = await fetch(asset.data.dataUrl);
                if (res.ok) return await res.blob();
            } catch {
                // 网络或协议不可达
            }
        }
    } else if (asset.kind === "video" || asset.kind === "audio") {
        if (asset.data.storageKey) {
            const blob = await getMediaBlob(String(asset.data.storageKey));
            if (blob) return blob;
            const stored = await mediaFilesStore.getItem<Blob>(String(asset.data.storageKey));
            if (stored) return stored;
        }
        if (asset.data.fileId) {
            const blob = await getMediaBlob(`file:${asset.data.fileId}`);
            if (blob) return blob;
        }
        if (asset.data.url && typeof asset.data.url === "string") {
            try {
                const res = await fetch(asset.data.url);
                if (res.ok) return await res.blob();
            } catch {
                // 网络或协议不可达
            }
        }
    }
    return null;
}

/**
 * 将提取完成的文件集合与规范清单打包为标准 ZIP 包 (Point 3)
 */
export async function packZipBundle(
    manifest: MigrationManifest,
    rawSnapshot: unknown,
    files: ExtractedMediaFile[],
): Promise<Blob> {
    const zipEntries: Record<string, Uint8Array> = {};

    // 1. 原始业务快照 source.json 与其真实字节摘要 (Point 3)
    const sourceJson = JSON.stringify(rawSnapshot, null, 2);
    const sourceBytes = strToU8(sourceJson);
    zipEntries["source.json"] = sourceBytes;

    const sourceSnapshotDigest = await sha256Hex(sourceBytes);
    manifest.sourceSnapshotDigest = sourceSnapshotDigest;

    // 重新按标准数组规则计算实质摘要
    manifest.sourceDigest = await computeSubstantiveDigest(
        manifest.sourceId,
        manifest.sourceType,
        sourceSnapshotDigest,
        manifest.entities,
        manifest.files,
    );

    // 2. 规范 manifest.json
    const manifestJson = JSON.stringify(manifest, null, 2);
    zipEntries["manifest.json"] = strToU8(manifestJson);

    // 3. 收集的原件文件
    for (const f of files) {
        zipEntries[f.path] = f.data;
    }

    const zipped = zipSync(zipEntries, { level: 0 });
    return new Blob([zipped as Uint8Array], { type: "application/zip" });
}

/**
 * exportXiaMigrationPackage 从「无限虾」本地存储只读导出完整迁移 ZIP 包 (Point 7, 9)
 */
export async function exportXiaMigrationPackage(selectedProjectId?: string): Promise<ExportedMigrationPackage> {
    const rawVal = await xiaStore.getItem<unknown>("workspace-v1");
    if (!rawVal) {
        throw new Error("未在当前浏览器中找到无限虾项目数据 (workspace-v1)");
    }

    // 严格使用 parseWorkspace 校验，损坏时明确抛错 (Point 7)
    const workspace = parseWorkspace(rawVal);

    const bundle = await buildXiaMigrationBundle(workspace.assets, resolveLocalMediaBlob, selectedProjectId);
    const blob = await packZipBundle(bundle.manifest, bundle.rawSnapshot, bundle.collectedFiles);

    const safeTitle = bundle.manifest.title.replace(/[\\/:*?"<>|]/g, "_").trim() || "infinite-xia";
    const filename = `${safeTitle}-backup.zip`;

    return {
        blob,
        manifest: bundle.manifest,
        filename,
    };
}

/**
 * exportCanvasMigrationPackage 从宿主画布及素材库只读导出完整迁移 ZIP 包 (Point 8, 9)
 */
export async function exportCanvasMigrationPackage(selectedProjectId?: string): Promise<ExportedMigrationPackage> {
    const rawCanvas = await appStateStore.getItem<string>("infinite-canvas:canvas_store");
    const rawAssets = await appStateStore.getItem<string>("infinite-canvas:asset_store");

    let canvasState: { state?: { projects?: Array<{ id: string; title: string; nodes: unknown[] }> } } | null = null;
    let assetState: { state?: { assets?: Array<{ id: string; kind: string; title: string; data?: Record<string, unknown> }> } } | null = null;

    // 严格解析 JSON，损坏时明确抛错，严禁静默当空来源 (Point 8)
    if (rawCanvas) {
        try {
            canvasState = JSON.parse(rawCanvas);
        } catch (err) {
            throw new Error(`本地画布数据损坏，JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (rawAssets) {
        try {
            assetState = JSON.parse(rawAssets);
        } catch (err) {
            throw new Error(`本地素材库数据损坏，JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const projects = canvasState?.state?.projects || [];
    const assets = assetState?.state?.assets || [];

    if (projects.length === 0 && assets.length === 0) {
        throw new Error("未在当前浏览器中找到本地画布或素材库数据");
    }

    // 明确选择单个画布 (Point 9)
    let selectedProject: { id: string; title: string; nodes: unknown[] } | undefined;
    if (selectedProjectId) {
        selectedProject = projects.find((p) => p.id === selectedProjectId);
        if (!selectedProject) {
            throw new Error(`未找到指定的画布 (ID: ${selectedProjectId})`);
        }
    } else {
        if (projects.length > 1) {
            throw new Error(`检测到多个画布 (${projects.length} 个)，请明确选择一个画布导出`);
        }
        selectedProject = projects[0];
    }

    const sourceId = selectedProject ? `infinite-canvas:${selectedProject.id}` : "infinite-canvas:local";
    const title = selectedProject?.title?.trim() || "本地画布工作区";

    const entities: MigrationEntityItem[] = [];
    const collectedFiles: ExtractedMediaFile[] = [];
    const missingFiles: MigrationMissingFileInfo[] = [];
    const entityMappings: Record<string, string> = {};
    const fileMappings: Record<string, string> = {};

    // 转换选中的单个画布项目 (Point 9)
    if (selectedProject) {
        const targetId = await deterministicId32(sourceId, selectedProject.id);
        entityMappings[selectedProject.id] = targetId;
        entities.push({
            type: "canvas_binding",
            sourceId: selectedProject.id,
            targetId,
            title: selectedProject.title,
            data: {
                workId: "",
                canvasId: targetId,
                nodeRefs: {},
            },
        });
    }

    // 转换素材 (Point 8: 真实原件解析，未知 MIME 不造 .bin，取不到列缺件)
    for (const a of assets) {
        const targetId = await deterministicId32(sourceId, a.id);
        entityMappings[a.id] = targetId;

        let blob: Blob | null = null;
        if (a.kind === "image") {
            if (a.data?.storageKey) {
                blob = await getImageBlob(String(a.data.storageKey));
                if (!blob) blob = await imageFilesStore.getItem<Blob>(String(a.data.storageKey));
            }
            if (!blob && a.data?.fileId) {
                blob = await getImageBlob(`file:${a.data.fileId}`);
            }
            if (!blob && a.data?.dataUrl && typeof a.data.dataUrl === "string") {
                try {
                    const res = await fetch(a.data.dataUrl);
                    if (res.ok) blob = await res.blob();
                } catch {
                    // ignore
                }
            }
        } else if (a.kind === "video" || a.kind === "audio") {
            if (a.data?.storageKey) {
                blob = await getMediaBlob(String(a.data.storageKey));
                if (!blob) blob = await mediaFilesStore.getItem<Blob>(String(a.data.storageKey));
            }
            if (!blob && a.data?.fileId) {
                blob = await getMediaBlob(`file:${a.data.fileId}`);
            }
            if (!blob && a.data?.url && typeof a.data.url === "string") {
                try {
                    const res = await fetch(a.data.url);
                    if (res.ok) blob = await res.blob();
                } catch {
                    // ignore
                }
            }
        }

        if (blob) {
            const mimeType = blob.type || (a.kind === "image" ? "image/png" : a.kind === "video" ? "video/mp4" : a.kind === "audio" ? "audio/mp3" : "");
            const ext = MIME_TO_EXT[mimeType];
            if (!ext) {
                // 未知或不受支持的 MIME 不造 .bin，明确列为缺件 (Point 8)
                missingFiles.push({
                    sourceAssetId: a.id,
                    path: "",
                    reason: `未知或不受支持的媒体类型 (${mimeType})`,
                });
            } else {
                const buf = new Uint8Array(await blob.arrayBuffer());
                const hash = await sha256Hex(buf);
                const path = `files/${hash}${ext}`;
                if (!collectedFiles.some((f) => f.sha256 === hash)) {
                    collectedFiles.push({
                        path,
                        data: buf,
                        sha256: hash,
                        bytes: buf.length,
                        mimeType,
                        originalFilename: a.title,
                    });
                }
                fileMappings[a.id] = hash;
            }
        } else if (a.kind !== "text") {
            // 宿主素材原件取不到必须列缺件，不能生成空 currentMediaIds 假装完整 (Point 8)
            missingFiles.push({
                sourceAssetId: a.id,
                path: "",
                reason: `无法获取媒体原件 (类型: ${a.kind})`,
                url: typeof a.data?.dataUrl === "string" ? a.data.dataUrl : typeof a.data?.url === "string" ? a.data.url : undefined,
            });
        }

        // 独立无归属素材明确列为待归档 (Point 9)
        entities.push({
            type: "asset",
            sourceId: a.id,
            targetId,
            title: a.title,
            data: {
                id: targetId,
                workId: "",
                domain: "prop",
                currentMediaIds: fileMappings[a.id] ? [fileMappings[a.id]] : [],
                archived: true, // 独立素材标记为待归档
            },
        });
    }

    const manifestFiles: MigrationFileInfo[] = collectedFiles.map((f) => ({
        path: f.path,
        sha256: f.sha256,
        bytes: f.bytes,
        mimeType: f.mimeType,
        originalFilename: f.originalFilename,
    }));

    const rawSnapshot = {
        canvas: canvasState,
        assets: assetState,
    };
    const rawBytes = new TextEncoder().encode(JSON.stringify(rawSnapshot, null, 2));
    const sourceSnapshotDigest = await sha256Hex(rawBytes);

    const sourceDigest = await computeSubstantiveDigest(
        sourceId,
        "infinite-canvas",
        sourceSnapshotDigest,
        entities,
        manifestFiles,
    );

    const manifest: MigrationManifest = {
        schemaVersion: 1,
        sourceId,
        sourceDigest,
        sourceSnapshotDigest,
        sourceType: "infinite-canvas",
        title,
        entities,
        files: manifestFiles,
        missingFiles,
        entityMappings,
        fileMappings,
    };

    const blob = await packZipBundle(manifest, rawSnapshot, collectedFiles);
    return {
        blob,
        manifest,
        filename: `${title.replace(/[\\/:*?"<>|]/g, "_").trim() || "infinite-canvas"}-backup.zip`,
    };
}

/**
 * inspectMigrationZip 在前端解析检验上传的备份 ZIP 包结构 (Point 10: 失败返回 null，不伪造合法清单)
 */
export async function inspectMigrationZip(file: Blob): Promise<{ manifest: MigrationManifest | null; isValid: boolean; error?: string }> {
    try {
        const buffer = new Uint8Array(await file.arrayBuffer());
        const entries = unzipSync(buffer);

        const manifestEntry = entries["manifest.json"];
        if (!manifestEntry) {
            return {
                manifest: null,
                isValid: false,
                error: "ZIP 包中未找到根清单 manifest.json",
            };
        }

        const text = new TextDecoder().decode(manifestEntry);
        const parsed = JSON.parse(text) as MigrationManifest;

        if (parsed.schemaVersion !== 1) {
            return {
                manifest: parsed,
                isValid: false,
                error: `不支持的清单版本: ${parsed.schemaVersion} (预期为 1)`,
            };
        }
        if (!parsed.sourceId || !parsed.sourceDigest) {
            return {
                manifest: parsed,
                isValid: false,
                error: "清单缺少 sourceId 或 sourceDigest",
            };
        }

        return {
            manifest: parsed,
            isValid: true,
        };
    } catch (err) {
        return {
            manifest: null,
            isValid: false,
            error: err instanceof Error ? err.message : "解压校验 ZIP 失败",
        };
    }
}

/**
 * downloadBlob 触发浏览器保存文件
 */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1000);
}
