import { expect, test } from "bun:test";
import type { PluginStorage } from "@infinite-canvas/plugin-sdk";
import { createLocalStudioRepository } from "./core/local-studio-repository";
import type { Asset } from "./core/asset-types";
import { parseWorkspace, readWorkspace, saveWorkspace } from "./workspace";

function memoryStorage(): PluginStorage {
    const items = new Map<string, unknown>();
    return { get: async <T>(key: string) => (structuredClone(items.get(key)) ?? null) as T | null,
        set: async (key, value) => { items.set(key, structuredClone(value)); },
        remove: async (key) => { items.delete(key); } };
}

test("project, manuscript, episode, script and beat survive plugin storage reload", async () => {
    const storage = memoryStorage();
    let assets: Asset[] = [];
    const repository = createLocalStudioRepository({ getAssets: () => assets,
        saveAssetsAndWait: async (next) => { assets = await saveWorkspace(storage, next); return assets; },
        readCanonicalAssets: () => readWorkspace(storage) });
    const created = await repository.createProject({ title: "测试片", projectType: "drama", baseStyle: "realistic", sourceText: "第一集 原稿", episodes: [{ title: "第一集", order: 1 }] });
    const episode = created.episodes[0];
    await repository.saveScript({ projectAssetId: created.project.id, episodeAssetId: episode.id, content: "场景一，人物入场" });
    await repository.createBeat({ projectAssetId: created.project.id, episodeAssetId: episode.id, order: 1, content: "近景", referencedAssetIds: [] });
    assets = await readWorkspace(storage);
    expect(repository.listProjects()).toHaveLength(1);
    expect(repository.listBeats(episode.id)).toHaveLength(1);
    expect(assets.some((asset) => asset.kind === "text" && asset.data.content === "场景一，人物入场")).toBe(true);
});

test("storage failure cannot be reported as a successful save", async () => {
    const storage = memoryStorage();
    storage.set = async () => { throw new Error("quota"); };
    await expect(saveWorkspace(storage, [])).rejects.toThrow("quota");
});

test("workspace import rejects unsupported versions, duplicate ids and broken project relations", () => {
    expect(() => parseWorkspace({ schemaVersion: 2, assets: [] })).toThrow("版本");
    const asset = { id: "a", kind: "text", title: "稿", data: { content: "稿" } };
    expect(() => parseWorkspace({ schemaVersion: 1, assets: [asset, asset] })).toThrow("重复");
    expect(() => parseWorkspace({ schemaVersion: 1, assets: [{ ...asset, metadata: { localStudio: { schemaVersion: 1, recordType: "episode", projectAssetId: "missing", order: 1, title: "集" } } }] })).toThrow("关系");
});
