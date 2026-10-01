// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { Asset } from "@/stores/use-asset-store";

type PackageApi = {
    createXiajiArtifactContentDigest: (value: Record<string, unknown>) => Promise<string>;
    createXiajiArtifactBaseRevision: (assets: Asset[], projectAssetId: string, episodeAssetId?: string) => Promise<string>;
    validateXiajiArtifactPackage: (assets: Asset[], canvas: { id: string; xiajiProjectAssetId?: string }, pkg: Record<string, unknown>) => Promise<{ ok: boolean; code?: string; baseRevision?: string }>;
    buildXiajiAgentProjectContext: (assets: Asset[], projectAssetId: string, episodeAssetId?: string) => Promise<Record<string, unknown>>;
    buildXiajiArtifactReview: (value: unknown) => { stageLabel: string; artifacts: Array<{ sourceKey: string; kind: string; title: string; content: string; metadata: Record<string, unknown> }>; relations: Array<{ from: string; type: string; to: string }>; mediaAssetIds: string[] };
    writeXiajiArtifactHandoff: (storage: StorageLike, handoff: Record<string, unknown>) => { ok: boolean; code?: string; replayed?: boolean };
    readXiajiArtifactHandoffs: (storage: StorageLike, projectAssetId: string) => { items: Array<Record<string, unknown>>; issues: string[] };
    removeXiajiArtifactHandoff: (storage: StorageLike, key: string) => void;
};

type StorageLike = { length: number; key: (index: number) => string | null; getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void };

function memoryStorage(limit = Number.POSITIVE_INFINITY): StorageLike {
    const values = new Map<string, string>();
    return {
        get length() { return values.size; },
        key: (index) => [...values.keys()][index] || null,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { if (value.length > limit) throw new Error("quota exceeded"); values.set(key, value); },
        removeItem: (key) => { values.delete(key); },
    };
}

function projectAssets(): Asset[] {
    const stamp = "2026-09-27T00:00:00.000Z";
    const record = (id: string, title: string, category: string, localStudio: Record<string, unknown>, content = "") => ({
        id, kind: "text" as const, title, coverUrl: "", tags: [], category, source: "test", data: { content }, createdAt: stamp, updatedAt: stamp,
        metadata: { localStudio },
    });
    return [
        record("project-1", "夜航", "xiaji:project", { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic", sourceAssetId: "source-1" }),
        { ...record("source-1", "原稿", "xiaji:source", {}), metadata: { localStudioSource: { projectAssetId: "project-1", sourceType: "manuscript" } }, data: { content: "原稿正文" } },
        record("episode-1", "第一集", "xiaji:episode", { schemaVersion: 1, recordType: "episode", projectAssetId: "project-1", order: 1, title: "第一集" }),
    ] as Asset[];
}

async function loadPackageApi(): Promise<PackageApi> {
    const api = await import("./xiaji-artifact-package").catch(() => ({}));
    return api as PackageApi;
}

describe("Xiaji Agent artifact handoff", () => {
    test("exports the package validation, canonical revision, and session handoff contract", async () => {
        const api = await loadPackageApi();
        expect(api.validateXiajiArtifactPackage).toBeFunction();
        expect(api.createXiajiArtifactBaseRevision).toBeFunction();
        expect(api.writeXiajiArtifactHandoff).toBeFunction();
    });

    test("validates an outline package against the canonical project without requiring a script or Beat", async () => {
        const api = await loadPackageApi();
        const assets = projectAssets();
        const baseRevision = await api.createXiajiArtifactBaseRevision(assets, "project-1");
        const packageBody = {
            schemaVersion: 1, packageId: "pkg-outline-1", projectAssetId: "project-1", stage: "project-outline", baseRevision,
            artifacts: [{ sourceKey: "ep-2", kind: "episode", title: "第二集", content: "雨夜重逢", metadata: { order: 2 } }],
            relations: [{ from: "project-1", type: "contains", to: "ep-2" }], mediaAssetIds: [],
        };
        const pkg = { ...packageBody, contentDigest: await api.createXiajiArtifactContentDigest(packageBody) };

        await expect(api.validateXiajiArtifactPackage(assets, { id: "canvas-1", xiajiProjectAssetId: "project-1" }, pkg)).resolves.toMatchObject({ ok: true, baseRevision });
        const staleBody = { ...packageBody, baseRevision: "0".repeat(64) };
        const stale = { ...staleBody, contentDigest: await api.createXiajiArtifactContentDigest(staleBody) };
        await expect(api.validateXiajiArtifactPackage(assets, { id: "canvas-1", xiajiProjectAssetId: "project-1" }, stale)).resolves.toMatchObject({ ok: false, code: "stale-base" });
    });

    test("rejects altered content, foreign ownership, and relations outside the package closure", async () => {
        const api = await loadPackageApi();
        const assets = projectAssets();
        const baseRevision = await api.createXiajiArtifactBaseRevision(assets, "project-1");
        const body = {
            schemaVersion: 1, packageId: "pkg-outline-2", projectAssetId: "project-1", stage: "project-outline", baseRevision,
            artifacts: [{ sourceKey: "ep-2", kind: "episode", title: "第二集", metadata: { order: 2 } }],
            relations: [{ from: "ep-2", type: "references", to: "missing-source-key" }], mediaAssetIds: [],
        };
        const pkg = { ...body, contentDigest: await api.createXiajiArtifactContentDigest(body) };
        await expect(api.validateXiajiArtifactPackage(assets, { id: "canvas-1", xiajiProjectAssetId: "project-1" }, { ...pkg, artifacts: [{ ...body.artifacts[0], title: "被改过" }] })).resolves.toMatchObject({ ok: false, code: "content-digest-mismatch" });
        await expect(api.validateXiajiArtifactPackage(assets, { id: "canvas-1", xiajiProjectAssetId: "other-project" }, pkg)).resolves.toMatchObject({ ok: false, code: "project-binding-mismatch" });
        await expect(api.validateXiajiArtifactPackage(assets, { id: "canvas-1", xiajiProjectAssetId: "project-1" }, pkg)).resolves.toMatchObject({ ok: false, code: "relationship-closure" });
    });

    test("builds a project-scoped Codex context with original text and current production records but no media URLs", async () => {
        const api = await loadPackageApi();
        const assets = projectAssets();
        assets.push({
            id: "script-1", kind: "text", title: "第一集剧本", coverUrl: "", tags: [], category: "xiaji:script", source: "test",
            data: { content: "内景，夜。" }, createdAt: "now", updatedAt: "now",
            metadata: { localStudio: { schemaVersion: 1, recordType: "script", projectAssetId: "project-1", episodeAssetId: "episode-1", documentKind: "script", version: 1, approvalState: "approved" } },
        } as Asset);
        const episode = assets.find((asset) => asset.id === "episode-1")!;
        episode.metadata = { ...episode.metadata, localStudio: { ...(episode.metadata?.localStudio as Record<string, unknown>), scriptAssetId: "script-1" } };
        assets.push({
            id: "beat-1", kind: "text", title: "镜头一", coverUrl: "", tags: [], category: "xiaji:beat", source: "test",
            data: { content: "林雨推门进入。" }, createdAt: "now", updatedAt: "now",
            metadata: { localStudio: { schemaVersion: 1, recordType: "beat", projectAssetId: "project-1", episodeAssetId: "episode-1", order: 1, referencedAssetIds: [] } },
        } as Asset);
        const context = await api.buildXiajiAgentProjectContext(assets, "project-1", "episode-1");

        expect(context).toMatchObject({ projectAssetId: "project-1", originalText: "原稿正文", episodes: [{ assetId: "episode-1", script: { content: "内景，夜。" }, beats: [{ assetId: "beat-1", content: "林雨推门进入。" }] }] });
        expect(JSON.stringify(context)).not.toContain("dataUrl");
        expect(JSON.stringify(context)).not.toContain("storageKey");
    });

    test("persists, replays, scopes, and removes a complete same-tab handoff without truncation", async () => {
        const api = await loadPackageApi();
        const storage = memoryStorage();
        const envelope = { projectAssetId: "project-1", canvasId: "canvas-1", packageId: "pkg-1", contentDigest: "a".repeat(64), package: { body: "complete" }, stagedAt: "now" };

        expect(api.writeXiajiArtifactHandoff(storage, envelope)).toMatchObject({ ok: true });
        expect(api.writeXiajiArtifactHandoff(storage, envelope)).toMatchObject({ ok: true, replayed: true });
        expect(api.writeXiajiArtifactHandoff(storage, { ...envelope, contentDigest: "b".repeat(64) })).toMatchObject({ ok: false, code: "package-id-conflict" });
        expect(api.readXiajiArtifactHandoffs(storage, "project-1").items).toHaveLength(1);
        expect(api.readXiajiArtifactHandoffs(storage, "other-project").items).toHaveLength(0);

        const tooSmall = memoryStorage(1);
        expect(api.writeXiajiArtifactHandoff(tooSmall, envelope)).toMatchObject({ ok: false, code: "session-storage-quota" });
        expect(api.readXiajiArtifactHandoffs(tooSmall, "project-1").items).toHaveLength(0);
        const key = String(api.readXiajiArtifactHandoffs(storage, "project-1").items[0].key);
        api.removeXiajiArtifactHandoff(storage, key);
        expect(api.readXiajiArtifactHandoffs(storage, "project-1").items).toHaveLength(0);
    });

    test("returns a recoverable fallback when the browser session store cannot even be read", async () => {
        const api = await loadPackageApi();
        const deniedStorage = {
            get length(): number { throw new Error("storage access denied"); },
            key: () => null,
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
        };

        expect(api.writeXiajiArtifactHandoff(deniedStorage, { projectAssetId: "project-1", canvasId: "canvas-1", packageId: "pkg-1", contentDigest: "a".repeat(64), package: {}, stagedAt: "now" }))
            .toMatchObject({ ok: false, code: "session-storage-unavailable" });
    });

    test("builds a safe review summary for artifact details, explicit relations, and local media references", async () => {
        const api = await loadPackageApi();
        const review = api.buildXiajiArtifactReview({
            stage: "production-breakdown",
            artifacts: [
                { sourceKey: "beat-1", kind: "beat", title: "门外脚步", content: "林雨停在门前。", metadata: { order: 1, dialogueText: "谁？", durationSeconds: 4 } },
                { sourceKey: "malformed", kind: 42, title: null, content: { hidden: true }, metadata: "bad" },
            ],
            relations: [{ from: "episode-1", type: "contains", to: "beat-1" }, { from: 42, type: null, to: {} }],
            mediaAssetIds: ["image-1", 7],
        });

        expect(review).toEqual({
            stageLabel: "镜头拆解",
            artifacts: [{ sourceKey: "beat-1", kind: "beat", title: "门外脚步", content: "林雨停在门前。", metadata: { order: 1, dialogueText: "谁？", durationSeconds: 4 } }],
            relations: [{ from: "episode-1", type: "contains", to: "beat-1" }],
            mediaAssetIds: ["image-1"],
        });
        expect(api.buildXiajiArtifactReview({ stage: "unknown", artifacts: null, relations: {}, mediaAssetIds: "bad" })).toMatchObject({ stageLabel: "未知阶段", artifacts: [], relations: [], mediaAssetIds: [] });
    });
});
