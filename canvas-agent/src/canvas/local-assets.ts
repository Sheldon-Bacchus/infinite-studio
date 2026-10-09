import crypto from "node:crypto";
import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type LocalAssetKind = "image" | "video" | "audio";
export type LocalAsset = { assetId: string; fileName: string; relativePath: string; directoryIndex: number; kind: LocalAssetKind; size: number };
type AssetRecord = { asset: LocalAsset; root: string; filePath: string; mtimeMs: number; ino: number; dev: number };

const mediaTypes: Record<string, [LocalAssetKind, string]> = {
    ".png": ["image", "image/png"], ".jpg": ["image", "image/jpeg"], ".jpeg": ["image", "image/jpeg"], ".webp": ["image", "image/webp"], ".gif": ["image", "image/gif"], ".avif": ["image", "image/avif"], ".svg": ["image", "image/svg+xml"], ".bmp": ["image", "image/bmp"],
    ".mp4": ["video", "video/mp4"], ".webm": ["video", "video/webm"], ".mov": ["video", "video/quicktime"], ".m4v": ["video", "video/mp4"], ".ogv": ["video", "video/ogg"],
    ".mp3": ["audio", "audio/mpeg"], ".wav": ["audio", "audio/wav"], ".ogg": ["audio", "audio/ogg"], ".m4a": ["audio", "audio/mp4"], ".aac": ["audio", "audio/aac"], ".flac": ["audio", "audio/flac"], ".opus": ["audio", "audio/ogg"],
};

/** 设置界面只接受用户明确填写的、已存在的绝对目录。 */
export async function normalizeAssetDirectories(value: unknown) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !path.isAbsolute(item.trim()))) throw new Error("素材目录必须是绝对路径列表");
    const directories: string[] = [];
    for (const item of value as string[]) {
        const directory = await realpath(item.trim());
        if (!(await stat(directory)).isDirectory()) throw new Error("素材路径必须是目录");
        if (!directories.includes(directory)) directories.push(directory);
    }
    return directories;
}

function isInside(root: string, filePath: string) {
    const relative = path.relative(root, filePath);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** 临时 ID 只保存在本次 Agent 进程的会话中，不接受外部文件路径。 */
export class LocalAssets {
    private records = new Map<string, AssetRecord>();
    private directories: string[] = [];
    private revision = 0;

    constructor(directories: string[] = []) {
        this.setDirectories(directories);
    }

    setDirectories(directories: string[]) {
        this.directories = [...directories];
        this.revision++;
        this.records.clear();
    }

    listDirectories() {
        return [...this.directories];
    }

    async search(input: { keyword?: string; kind?: "all" | LocalAssetKind }) {
        if (!this.directories.length) throw new Error("请先在片场 Agent 设置中授权本地素材目录");
        const directories = [...this.directories];
        const revision = this.revision;
        const assets: LocalAsset[] = [];
        const warnings: string[] = [];
        const seen = new Set<string>();
        const keyword = (input.keyword || "").toLocaleLowerCase();
        for (const [directoryIndex, root] of directories.entries()) {
            if (await realpath(root) !== root) throw new Error("素材目录已变化，请重新授权");
            const walk = async (directory: string): Promise<void> => {
                for (const entry of await readdir(directory, { withFileTypes: true })) {
                    // 不跟随符号链接或目录联接，避免遍历到授权范围以外。
                    if (entry.isSymbolicLink()) continue;
                    const filePath = path.join(directory, entry.name);
                    try {
                        const resolved = await realpath(filePath);
                        if (!isInside(root, resolved)) continue;
                        if (entry.isDirectory()) { await walk(resolved); continue; }
                        const media = mediaTypes[path.extname(entry.name).toLowerCase()];
                        if (!entry.isFile() || !media || (input.kind && input.kind !== "all" && input.kind !== media[0]) || !entry.name.toLocaleLowerCase().includes(keyword) || seen.has(resolved)) continue;
                        const file = await stat(resolved);
                        if (!file.isFile()) continue;
                        seen.add(resolved);
                        if (revision !== this.revision) throw new Error("素材授权已变化，请重新搜索");
                        const asset: LocalAsset = { assetId: crypto.randomUUID(), fileName: entry.name, relativePath: path.relative(root, resolved), directoryIndex, kind: media[0], size: file.size };
                        this.records.set(asset.assetId, { asset, root, filePath: resolved, mtimeMs: file.mtimeMs, ino: file.ino, dev: file.dev });
                        assets.push(asset);
                    } catch (error) {
                        warnings.push(`目录 ${directoryIndex + 1} / ${path.relative(root, filePath)}：${(error as NodeJS.ErrnoException).code || "读取失败"}`);
                    }
                }
            };
            await walk(root);
        }
        if (revision !== this.revision) throw new Error("素材授权已变化，请重新搜索");
        return { assets, total: assets.length, warnings };
    }

    /** 导入和传输前重新检查真实路径、当前授权及文件是否仍与搜索结果一致。 */
    async resolve(assetId: string) {
        const record = this.records.get(assetId);
        if (!record || !this.directories.includes(record.root)) throw new Error("本地素材 ID 已失效，请重新搜索");
        const resolved = await realpath(record.filePath);
        if (resolved !== record.filePath || !isInside(record.root, resolved) || await realpath(record.root) !== record.root) throw new Error("素材路径已变化，请重新搜索");
        const file = await stat(resolved);
        this.checkFile(record, file);
        if (this.records.get(assetId) !== record) throw new Error("本地素材 ID 已失效，请重新搜索");
        return record;
    }

    /** 用二进制流传输文件，文件内容不会进入 MCP JSON。 */
    async open(assetId: string) {
        const record = await this.resolve(assetId);
        const handle = await open(record.filePath, "r");
        try {
            this.checkFile(record, await handle.stat());
            if (!this.records.has(assetId)) throw new Error("本地素材 ID 已失效，请重新搜索");
            return { handle, contentType: mediaTypes[path.extname(record.filePath).toLowerCase()][1], size: record.asset.size };
        } catch (error) {
            await handle.close();
            throw error;
        }
    }

    private checkFile(record: AssetRecord, file: Awaited<ReturnType<typeof stat>>) {
        if (!file.isFile() || file.size !== record.asset.size || file.mtimeMs !== record.mtimeMs || file.ino !== record.ino || file.dev !== record.dev) throw new Error("素材文件已变化，请重新搜索");
    }
}

