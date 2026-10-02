// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PluginStorage } from "@infinite-canvas/plugin-sdk";
import type { Asset } from "./core/asset-types";
import { validateLocalStudioAssetCollection } from "./core/local-studio-model";

export const WORKSPACE_KEY = "workspace-v1";
export type XiaWorkspace = { schemaVersion: 1; assets: Asset[] };

export function parseWorkspace(value: unknown): XiaWorkspace {
    if (!value || typeof value !== "object") throw new Error("无限虾项目文件格式不正确");
    const data = value as XiaWorkspace;
    if (data.schemaVersion !== 1 || !Array.isArray(data.assets)) throw new Error("不支持的无限虾项目文件版本");
    for (const asset of data.assets) {
        if (!asset || typeof asset.id !== "string" || !asset.id || typeof asset.title !== "string"
            || !["text", "image", "video", "audio"].includes(asset.kind) || !asset.data || typeof asset.data !== "object") {
            throw new Error("项目文件包含无效素材");
        }
        if (asset.kind === "text" && typeof asset.data.content !== "string") throw new Error("文本素材内容不正确");
    }
    if (new Set(data.assets.map((asset) => asset.id)).size !== data.assets.length) throw new Error("项目文件包含重复素材 ID");
    const validation = validateLocalStudioAssetCollection(data.assets);
    if (validation.issues.length) throw new Error(`项目关系不完整：${validation.issues[0].code}`);
    return data;
}

export async function readWorkspace(storage: PluginStorage): Promise<Asset[]> {
    const value = await storage.get(WORKSPACE_KEY);
    return value === null ? [] : parseWorkspace(value).assets;
}

export async function saveWorkspace(storage: PluginStorage, assets: Asset[]): Promise<Asset[]> {
    const snapshot = parseWorkspace({ schemaVersion: 1, assets });
    await storage.set(WORKSPACE_KEY, snapshot);
    const saved = await readWorkspace(storage);
    if (JSON.stringify(saved) !== JSON.stringify(assets)) throw new Error("保存后回读内容不一致，请刷新检查");
    return saved;
}
