// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { Asset } from "@/stores/use-asset-store";
import { createLocalStudioRepository } from "./local-studio-repository";
import { getLocalStudioRecord } from "./local-studio-model";
import { createXiajiArtifactContentDigest, createXiajiArtifactBaseRevision } from "./xiaji-artifact-package";
import type { XiajiArtifactPackage } from "./xiaji-artifact-package";

function createHarness() {
    let assets: Asset[] = [];
    let saveCalls = 0;
    const ids = ["project-1", "source-1", "initial-episode-1", "initial-episode-2", "episode-1", "episode-2", "script-1", "beat-1", "beat-2"];
    const repository = createLocalStudioRepository({
        getAssets: () => assets,
        saveAssetsAndWait: async (nextAssets) => {
            saveCalls += 1;
            assets = nextAssets;
            return assets;
        },
        idFactory: () => ids.shift() || `id-${saveCalls}`,
        now: () => "2026-09-24T00:00:00.000Z",
    });
    return { repository, getAssets: () => assets, getSaveCalls: () => saveCalls };
}

describe("LocalStudio asset repository", () => {
    test("canonical-readback recovers a project creation whose atomic save response was lost", async () => {
        let assets: Asset[] = [];
        let saveCalls = 0;
        const repository = createLocalStudioRepository({
            getAssets: () => assets,
            saveAssetsAndWait: async (incoming: Asset[]) => {
                saveCalls += 1;
                assets = incoming;
                if (saveCalls === 1) throw new Error("connection reset after server commit");
                return assets;
            },
            readCanonicalAssets: async () => assets,
            idFactory: (() => { let index = 0; return () => `stable-${++index}`; })(),
            now: () => "2026-09-28T10:00:00.000Z",
        } as never);

        const result = await repository.createProject({
            title: "回声", projectType: "drama", baseStyle: "realistic", sourceText: "海边的原稿", episodes: [{ title: "第一集", order: 1 }],
        });

        expect(result.project.id).toBe("stable-1");
        expect(result.source.id).toBe("stable-2");
        expect(result.episodes.map((episode) => episode.id)).toEqual(["stable-3"]);
        const marker = result.project.metadata?.localStudioCommit;
        expect(marker).toMatchObject({ commitId: "xiaji-project-create-stable-1", assetIds: ["stable-1", "stable-2", "stable-3"] });
        expect(result.source.metadata?.localStudioCommit).toEqual(marker);
        expect(result.episodes[0].metadata?.localStudioCommit).toEqual(marker);
        expect(saveCalls).toBe(1);
    });

    test("retries an unresolved project commit with its original IDs and payload", async () => {
        let assets: Asset[] = [];
        let saveCalls = 0;
        let idCalls = 0;
        const repository = createLocalStudioRepository({
            getAssets: () => assets,
            readCanonicalAssets: async () => assets,
            saveAssetsAndWait: async (incoming: Asset[]) => {
                saveCalls += 1;
                if (saveCalls === 1) throw new Error("temporary local storage outage");
                assets = incoming;
                return assets;
            },
            idFactory: () => `retry-${++idCalls}`,
            now: () => "2026-09-28T11:00:00.000Z",
        });
        const attempt = await repository.prepareProjectCreation({ title: "潮声", projectType: "drama", baseStyle: "realistic", sourceText: "海岸线" });

        await expect(repository.commitProjectCreation(attempt)).rejects.toMatchObject({ code: "project-create-outcome-unknown" });
        const result = await repository.commitProjectCreation(attempt);

        expect(result.project.id).toBe("retry-1");
        expect(result.source.id).toBe("retry-2");
        expect(result.project.metadata?.localStudioCommit).toMatchObject({ commitId: attempt.commitId, payloadDigest: attempt.payloadDigest });
        expect(idCalls).toBe(2);
        expect(saveCalls).toBe(2);
    });

    test("persists a project and original manuscript together and returns canonical assets", async () => {
        const harness = createHarness();
        const result = await harness.repository.createProject({
            title: "海边来信",
            projectType: "短剧",
            baseStyle: "电影写实",
            sourceText: "第一场：海边。",
            sourceName: "海边来信.txt",
        });

        expect(harness.getSaveCalls()).toBe(1);
        expect(result.project.id).toBe("project-1");
        expect(result.source.id).toBe("source-1");
        expect(result.project.metadata?.localStudio).toMatchObject({ recordType: "project", sourceAssetId: "source-1" });
        expect(result.source.data).toEqual({ content: "第一场：海边。" });
        expect(harness.repository.getSourceText("project-1")).toBe("第一场：海边。");
    });

    test("saves the project and original manuscript when no episode structure exists yet", async () => {
        const harness = createHarness();
        const result = await harness.repository.createProject({
            title: "海边来信",
            projectType: "短剧",
            baseStyle: "电影写实",
            sourceText: "没有分集标题的完整原稿。",
        });

        expect(harness.getSaveCalls()).toBe(1);
        expect(result.episodes).toEqual([]);
        expect(result.project.metadata?.localStudio).toMatchObject({ recordType: "project", sourceAssetId: result.source.id });
        expect(result.source.data).toEqual({ content: "没有分集标题的完整原稿。" });
    });

    test("creates the initial episode structure in the same local save as the project and manuscript", async () => {
        const harness = createHarness();
        const result = await harness.repository.createProject({
            title: "海边来信",
            projectType: "drama",
            baseStyle: "realistic",
            sourceText: "第一集正文\n第二集正文",
            episodes: [
                { title: "第一集：相遇", order: 1, synopsis: "第一集正文", sourceEpisodeNumber: 1 },
                { title: "第二集：重逢", order: 2, synopsis: "第二集正文", sourceEpisodeNumber: 2 },
            ],
        });

        expect(harness.getSaveCalls()).toBe(1);
        expect(result.episodes).toHaveLength(2);
        expect(harness.repository.listEpisodes(result.project.id).map((episode) => episode.title)).toEqual(["第一集：相遇", "第二集：重逢"]);
    });

    test("updates an episode title and synopsis without changing its source episode number", async () => {
        const harness = createHarness();
        const { project } = await harness.repository.createProject({
            title: "海边来信",
            projectType: "drama",
            baseStyle: "realistic",
            sourceText: "原文",
            episodes: [{ title: "旧标题", order: 1, synopsis: "旧梗概", sourceEpisodeNumber: 7 }],
        });
        const [episode] = harness.repository.listEpisodes(project.id);

        const saved = await harness.repository.updateEpisode({
            projectAssetId: project.id,
            episodeAssetId: episode.id,
            title: "新标题",
            synopsis: "新梗概",
        });

        expect(saved.title).toBe("新标题");
        expect(saved.data).toEqual({ content: "新梗概" });
        expect(saved.metadata?.localStudio).toMatchObject({ order: 1, sourceEpisodeNumber: 7, title: "新标题", synopsis: "新梗概" });
    });

    test("reorders every episode in one canonical save and rejects incomplete or foreign selections", async () => {
        const harness = createHarness();
        const { project } = await harness.repository.createProject({
            title: "海边来信",
            projectType: "drama",
            baseStyle: "realistic",
            sourceText: "原文",
            episodes: [
                { title: "第一集", order: 1, sourceEpisodeNumber: 1 },
                { title: "第二集", order: 2, sourceEpisodeNumber: 2 },
            ],
        });
        const episodes = harness.repository.listEpisodes(project.id);
        const saveCount = harness.getSaveCalls();

        await harness.repository.reorderEpisodes(project.id, [episodes[1].id, episodes[0].id]);

        expect(harness.repository.listEpisodes(project.id).map((episode) => episode.title)).toEqual(["第二集", "第一集"]);
        expect(harness.repository.listEpisodes(project.id).map((episode) => (episode.metadata?.localStudio as { sourceEpisodeNumber: number }).sourceEpisodeNumber)).toEqual([2, 1]);
        expect(harness.getSaveCalls()).toBe(saveCount + 1);
        await expect(harness.repository.reorderEpisodes(project.id, [episodes[0].id])).rejects.toThrow("必须包含项目中的全部分集");
        await expect(harness.repository.reorderEpisodes(project.id, [episodes[0].id, "foreign-episode"])).rejects.toThrow("必须包含项目中的全部分集");
        expect(harness.getSaveCalls()).toBe(saveCount + 1);
    });

    test("does not save an incomplete project or source manuscript", async () => {
        const harness = createHarness();

        await expect(harness.repository.createProject({
            title: " ",
            projectType: "短剧",
            baseStyle: "电影写实",
            sourceText: "",
        })).rejects.toThrow("项目名称和原始剧本不能为空");
        expect(harness.getSaveCalls()).toBe(0);
    });

    test("prevents duplicate episode order within a project before persistence", async () => {
        const harness = createHarness();
        const { project } = await harness.repository.createProject({
            title: "海边来信",
            projectType: "短剧",
            baseStyle: "电影写实",
            sourceText: "原文",
        });
        await harness.repository.createEpisode({ projectAssetId: project.id, title: "第一集", order: 1 });

        await expect(harness.repository.createEpisode({ projectAssetId: project.id, title: "重复序号", order: 1 }))
            .rejects.toThrow("分集序号重复");
        expect(harness.getSaveCalls()).toBe(2);
    });

    test("keeps project creation outcome unknown when canonical save data omits the submitted assets", async () => {
        const repository = createLocalStudioRepository({
            getAssets: () => [],
            saveAssetsAndWait: async () => [],
            idFactory: (() => { let index = 0; return () => `id-${++index}`; })(),
            now: () => "2026-09-24T00:00:00.000Z",
        });

        await expect(repository.createProject({
            title: "海边来信",
            projectType: "短剧",
            baseStyle: "电影写实",
            sourceText: "原文",
        })).rejects.toMatchObject({ code: "project-create-outcome-unknown" });
    });

    test("saves an episode script and links it to the episode in one local snapshot", async () => {
        const harness = createHarness();
        const { project } = await harness.repository.createProject({ title: "项目", projectType: "短剧", baseStyle: "电影", sourceText: "原文" });
        const episode = await harness.repository.createEpisode({ projectAssetId: project.id, title: "第一集", order: 1 });

        const script = await harness.repository.saveScript({
            projectAssetId: project.id,
            episodeAssetId: episode.id,
            content: "内景，清晨。人物入场。",
        });

        expect(script.metadata?.localStudio).toMatchObject({ recordType: "script", projectAssetId: project.id, episodeAssetId: episode.id, documentKind: "script" });
        expect(harness.getAssets().find((asset) => asset.id === episode.id)?.metadata?.localStudio).toMatchObject({ scriptAssetId: script.id });
        expect(harness.getSaveCalls()).toBe(3);
    });

    test("rejects a blank script without creating a local script record", async () => {
        const harness = createHarness();
        const { project, episodes } = await harness.repository.createProject({
            title: "空剧本校验",
            projectType: "drama",
            baseStyle: "realistic",
            sourceText: "原稿",
            episodes: [{ title: "第一集", order: 1 }],
        });
        const saveCallsBeforeScript = harness.getSaveCalls();

        await expect(harness.repository.saveScript({ projectAssetId: project.id, episodeAssetId: episodes[0].id, content: " \n  " }))
            .rejects.toThrow("剧本内容不能为空");

        expect(harness.getSaveCalls()).toBe(saveCallsBeforeScript);
        expect(getLocalStudioRecord(harness.getAssets().find((asset) => asset.id === episodes[0].id)!)).toMatchObject({ recordType: "episode" });
        expect(harness.getAssets().filter((asset) => getLocalStudioRecord(asset)?.recordType === "script")).toEqual([]);
    });

    test("confirms a script after the JSON round trip omits undefined metadata fields", async () => {
        let assets: Asset[] = [];
        let nextId = 0;
        const repository = createLocalStudioRepository({
            getAssets: () => assets,
            saveAssetsAndWait: async (incoming) => {
                assets = JSON.parse(JSON.stringify(incoming)) as Asset[];
                return assets;
            },
            idFactory: () => `json-script-${++nextId}`,
            now: () => "2026-09-28T12:00:00.000Z",
        });
        const { project } = await repository.createProject({ title: "JSON 回读项目", projectType: "drama", baseStyle: "realistic", sourceText: "原稿" });
        const episode = await repository.createEpisode({ projectAssetId: project.id, title: "第一集", order: 1, sourceEpisodeNumber: 1, synopsis: "车站相遇" });

        const script = await repository.saveScript({ projectAssetId: project.id, episodeAssetId: episode.id, content: "夜，车站。" });

        const savedScript = assets.find((asset) => asset.id === script.id);
        expect(savedScript?.kind).toBe("text");
        expect(savedScript?.kind === "text" ? savedScript.data.content : null).toBe("夜，车站。");
        expect(getLocalStudioRecord(assets.find((asset) => asset.id === episode.id)!)).toMatchObject({ recordType: "episode", scriptAssetId: script.id });
    });

    test("confirms a beat after the JSON round trip omits undefined metadata fields", async () => {
        let assets: Asset[] = [];
        let nextId = 0;
        const repository = createLocalStudioRepository({
            getAssets: () => assets,
            saveAssetsAndWait: async (incoming) => {
                assets = JSON.parse(JSON.stringify(incoming)) as Asset[];
                return assets;
            },
            idFactory: () => `json-beat-${++nextId}`,
            now: () => "2026-09-28T12:00:00.000Z",
        });
        const { project } = await repository.createProject({ title: "JSON 回读项目", projectType: "drama", baseStyle: "realistic", sourceText: "原稿" });
        const episode = await repository.createEpisode({ projectAssetId: project.id, title: "第一集", order: 1, sourceEpisodeNumber: 1, synopsis: "车站相遇" });

        const beat = await repository.createBeat({
            projectAssetId: project.id,
            episodeAssetId: episode.id,
            order: 1,
            title: "车站相遇",
            content: "夜，车站。",
            dialogueText: "你来了。",
            referencedAssetIds: [],
        });

        const savedBeat = assets.find((asset) => asset.id === beat.id);
        expect(savedBeat?.kind).toBe("text");
        expect(savedBeat?.kind === "text" ? savedBeat.data.content : null).toBe("夜，车站。");
        expect(getLocalStudioRecord(assets.find((asset) => asset.id === episode.id)!)).toMatchObject({ recordType: "episode", currentBeatAssetIds: [beat.id] });
    });

    test("appends an approved script revision and keeps the prior script for history", async () => {
        const harness = createHarness();
        const { project, episodes } = await harness.repository.createProject({
            title: "海边来信", projectType: "drama", baseStyle: "realistic", sourceText: "原稿",
            episodes: [{ title: "第一集", order: 1 }],
        });
        const first = await harness.repository.saveScript({ projectAssetId: project.id, episodeAssetId: episodes[0].id, content: "版本一" });
        const second = await harness.repository.saveScript({ projectAssetId: project.id, episodeAssetId: episodes[0].id, content: "版本二" });
        const records = harness.getAssets().filter((asset) => getLocalStudioRecord(asset)?.recordType === "script");
        const currentEpisode = harness.getAssets().find((asset) => asset.id === episodes[0].id)!;

        expect(second.id).not.toBe(first.id);
        expect(records).toHaveLength(2);
        expect(getLocalStudioRecord(records.find((asset) => asset.id === first.id)!) as Record<string, unknown>).toMatchObject({ version: 1, approvalState: "superseded" });
        expect(getLocalStudioRecord(second) as Record<string, unknown>).toMatchObject({ version: 2, supersedesAssetId: first.id, approvalState: "approved" });
        expect(getLocalStudioRecord(currentEpisode)).toMatchObject({ recordType: "episode", scriptAssetId: second.id });

        const beforeRetry = harness.getSaveCalls();
        expect((await harness.repository.saveScript({ projectAssetId: project.id, episodeAssetId: episodes[0].id, content: "版本二" })).id).toBe(second.id);
        expect(harness.getSaveCalls()).toBe(beforeRetry);
    });

    test("persists the episode script link through timestamp-based workspace sync and repository reload", async () => {
        let persistedAssets: Asset[] = [];
        let nextId = 0;
        let timestamp = 0;
        const repository = createLocalStudioRepository({
            getAssets: () => persistedAssets,
            saveAssetsAndWait: async (incoming) => {
                const canonical = new Map(persistedAssets.map((asset) => [asset.id, asset]));
                for (const asset of incoming) {
                    const current = canonical.get(asset.id);
                    if (!current || asset.updatedAt > current.updatedAt) canonical.set(asset.id, asset);
                }
                persistedAssets = Array.from(canonical.values());
                return persistedAssets;
            },
            idFactory: () => `asset-${++nextId}`,
            now: () => new Date(Date.UTC(2026, 8, 25, 0, 0, timestamp++)).toISOString(),
        });
        const { project } = await repository.createProject({ title: "项目", projectType: "短剧", baseStyle: "电影", sourceText: "原文" });
        const episode = await repository.createEpisode({ projectAssetId: project.id, title: "第一集", order: 1 });

        const script = await repository.saveScript({
            projectAssetId: project.id,
            episodeAssetId: episode.id,
            content: "内景，清晨。人物入场。",
        });

        const reloadedRepository = createLocalStudioRepository({
            getAssets: () => persistedAssets,
            saveAssetsAndWait: async (assets) => assets,
        });
        const reloadedEpisode = reloadedRepository.listEpisodes(project.id)[0];
        const reloadedEpisodeRecord = getLocalStudioRecord(reloadedEpisode);
        const reloadedScript = persistedAssets.find((asset) => asset.id === script.id);

        expect(reloadedEpisodeRecord).toMatchObject({ recordType: "episode", scriptAssetId: script.id });
        expect(reloadedScript?.data).toEqual({ content: "内景，清晨。人物入场。" });
    });

    test("does not report script save success when canonical response omits the episode link", async () => {
        let persistedAssets: Asset[] = [];
        let nextId = 0;
        let timestamp = 0;
        let saveCalls = 0;
        const repository = createLocalStudioRepository({
            getAssets: () => persistedAssets,
            saveAssetsAndWait: async (incoming) => {
                saveCalls += 1;
                const canonical = new Map(persistedAssets.map((asset) => [asset.id, asset]));
                for (const asset of incoming) {
                    const current = canonical.get(asset.id);
                    const record = getLocalStudioRecord(asset);
                    if (saveCalls === 3 && record?.recordType === "episode" && record.scriptAssetId) continue;
                    if (!current || asset.updatedAt > current.updatedAt) canonical.set(asset.id, asset);
                }
                persistedAssets = Array.from(canonical.values());
                return persistedAssets;
            },
            idFactory: () => `asset-${++nextId}`,
            now: () => new Date(Date.UTC(2026, 8, 25, 0, 0, timestamp++)).toISOString(),
        });
        const { project } = await repository.createProject({ title: "项目", projectType: "短剧", baseStyle: "电影", sourceText: "原文" });
        const episode = await repository.createEpisode({ projectAssetId: project.id, title: "第一集", order: 1 });

        await expect(repository.saveScript({
            projectAssetId: project.id,
            episodeAssetId: episode.id,
            content: "内景，清晨。人物入场。",
        })).rejects.toThrow("本地保存响应未确认分集关联的剧本素材");
    });

    test("creates beats under an episode and rejects references outside the local asset collection", async () => {
        const harness = createHarness();
        const { project } = await harness.repository.createProject({ title: "项目", projectType: "短剧", baseStyle: "电影", sourceText: "原文" });
        const episode = await harness.repository.createEpisode({ projectAssetId: project.id, title: "第一集", order: 1 });
        const beat = await harness.repository.createBeat({
            projectAssetId: project.id,
            episodeAssetId: episode.id,
            order: 1,
            content: "近景：主角回头。",
            dialogueText: "你怎么会在这里？",
            referencedAssetIds: [],
        });

        expect(beat.data).toEqual({ content: "近景：主角回头。" });
        expect(beat.metadata?.localStudio).toMatchObject({ recordType: "beat", episodeAssetId: episode.id, order: 1, dialogueText: "你怎么会在这里？", referencedAssetIds: [] });
        await expect(harness.repository.createBeat({
            projectAssetId: project.id,
            episodeAssetId: episode.id,
            order: 2,
            content: "镜头二",
            referencedAssetIds: ["missing-asset"],
        })).rejects.toThrow("关联素材不存在");
        expect(harness.getSaveCalls()).toBe(3);
    });

    test("updates an existing Beat title, description, and same-project asset references atomically", async () => {
        const harness = createHarness();
        const { project } = await harness.repository.createProject({ title: "项目", projectType: "短剧", baseStyle: "电影", sourceText: "原文" });
        const episode = await harness.repository.createEpisode({ projectAssetId: project.id, title: "第一集", order: 1 });
        const beat = await harness.repository.createBeat({ projectAssetId: project.id, episodeAssetId: episode.id, order: 1, content: "旧镜头", referencedAssetIds: [] });
        const character: Asset = {
            id: "character-reference", kind: "text", title: "林雨", coverUrl: "", tags: [], source: "test",
            category: "xia-tang:character", data: { content: "林雨" }, createdAt: "now", updatedAt: "now",
            metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", projectAssetId: project.id, fields: { name: "林雨" } } },
        };
        const withCharacter = [...harness.getAssets(), character];
        const repository = createLocalStudioRepository({
            getAssets: () => withCharacter,
            saveAssetsAndWait: async (nextAssets) => { withCharacter.splice(0, withCharacter.length, ...nextAssets); return withCharacter; },
            idFactory: () => "unused-id",
            now: () => "2026-09-24T01:00:00.000Z",
        });

        const saved = await repository.updateBeat({ projectAssetId: project.id, episodeAssetId: episode.id, beatAssetId: beat.id, title: "车站初遇", content: "雨夜相遇", dialogueText: "你怎么会在这里？", referencedAssetIds: [character.id] });

        expect(saved.title).toBe("车站初遇");
        expect(saved.data).toEqual({ content: "雨夜相遇" });
        expect(saved.metadata?.localStudio).toMatchObject({ order: 1, dialogueText: "你怎么会在这里？", referencedAssetIds: [character.id] });
    });

    test("appends an edited Beat revision and keeps only the approved revision current", async () => {
        const harness = createHarness();
        const { project } = await harness.repository.createProject({ title: "项目", projectType: "短剧", baseStyle: "电影", sourceText: "原文" });
        const episode = await harness.repository.createEpisode({ projectAssetId: project.id, title: "第一集", order: 1 });
        const first = await harness.repository.createBeat({ projectAssetId: project.id, episodeAssetId: episode.id, order: 1, content: "旧镜头", referencedAssetIds: [] });

        const second = await harness.repository.updateBeat({ projectAssetId: project.id, episodeAssetId: episode.id, beatAssetId: first.id, title: "新镜头", content: "新画面", dialogueText: "新台词", referencedAssetIds: [] });
        const currentEpisode = harness.getAssets().find((asset) => asset.id === episode.id)!;
        const history = harness.getAssets().filter((asset) => getLocalStudioRecord(asset)?.recordType === "beat");

        expect(second.id).not.toBe(first.id);
        expect(history).toHaveLength(2);
        expect(getLocalStudioRecord(history.find((asset) => asset.id === first.id)!) as Record<string, unknown>).toMatchObject({ version: 1, approvalState: "superseded", supersededByAssetId: second.id });
        expect(getLocalStudioRecord(second) as Record<string, unknown>).toMatchObject({ version: 2, supersedesAssetId: first.id, approvalState: "approved" });
        expect(getLocalStudioRecord(currentEpisode)).toMatchObject({ recordType: "episode", currentBeatAssetIds: [second.id] });
        expect(harness.repository.listBeats(episode.id).map((beat) => beat.id)).toEqual([second.id]);
    });

    test("commits a reviewed Agent script package atomically and replays it without a second version", async () => {
        const harness = createHarness();
        const { project, episodes } = await harness.repository.createProject({ title: "夜航", projectType: "drama", baseStyle: "realistic", sourceText: "原稿", episodes: [{ title: "第一集", order: 1 }] });
        const body = {
            schemaVersion: 1, packageId: "pkg-script-1", projectAssetId: project.id, episodeAssetId: episodes[0].id, stage: "script",
            baseRevision: await createXiajiArtifactBaseRevision(harness.getAssets(), project.id, episodes[0].id),
            artifacts: [{ sourceKey: "script-v1", kind: "script", title: "第一集正式剧本", content: "内景，夜。林雨推门。", metadata: {} }],
            relations: [{ from: "script-v1", type: "script-of", to: episodes[0].id }], mediaAssetIds: [],
        };
        const pkg = { ...body, contentDigest: await createXiajiArtifactContentDigest(body) } as XiajiArtifactPackage;
        const canvas = { id: "canvas-1", xiajiProjectAssetId: project.id };

        const first = await harness.repository.commitXiajiArtifactPackage(pkg, canvas, "2026-09-27T12:00:00.000Z");
        const writesAfterCommit = harness.getSaveCalls();
        const second = await harness.repository.commitXiajiArtifactPackage(pkg, canvas, "2026-09-27T12:00:00.000Z");
        const savedEpisode = harness.getAssets().find((asset) => asset.id === episodes[0].id)!;

        expect(first).toMatchObject({ ok: true, packageId: "pkg-script-1", committed: true });
        expect(first.assetIds).toEqual(second.assetIds);
        expect(second).toMatchObject({ ok: true, committed: true, replayed: true });
        expect(harness.getSaveCalls()).toBe(writesAfterCommit);
        expect(getLocalStudioRecord(savedEpisode)).toMatchObject({ recordType: "episode", scriptAssetId: first.assetIds[0] });
        expect(harness.getAssets().find((asset) => asset.id === first.assetIds[0])?.metadata?.localStudioCommit).toMatchObject({ packageId: pkg.packageId, contentDigest: pkg.contentDigest });
    });

    test("commits a reviewed project outline without requiring a script or Beat", async () => {
        const harness = createHarness();
        const { project } = await harness.repository.createProject({ title: "潮汐之间", projectType: "drama", baseStyle: "realistic", sourceText: "原稿正文" });
        const body = {
            schemaVersion: 1, packageId: "pkg-outline-1", projectAssetId: project.id, stage: "project-outline",
            baseRevision: await createXiajiArtifactBaseRevision(harness.getAssets(), project.id),
            artifacts: [{ sourceKey: "episode-1", kind: "episode", title: "第一集", content: "女主回到海边。", metadata: { order: 1 } }],
            relations: [{ from: project.id, type: "contains", to: "episode-1" }], mediaAssetIds: [],
        };
        const pkg = { ...body, contentDigest: await createXiajiArtifactContentDigest(body) } as XiajiArtifactPackage;

        const result = await harness.repository.commitXiajiArtifactPackage(pkg, { id: "canvas-1", xiajiProjectAssetId: project.id }, "2026-09-27T12:00:00.000Z");
        const episodes = harness.repository.listEpisodes(project.id);

        expect(episodes).toHaveLength(1);
        expect(episodes[0]).toMatchObject({ id: result.assetIds[0], title: "第一集", data: { content: "女主回到海边。" } });
        expect(getLocalStudioRecord(episodes[0])).toMatchObject({ recordType: "episode", projectAssetId: project.id, order: 1, sourcePackageId: pkg.packageId, sourceKey: "episode-1" });
        expect(result.assetIdsBySourceKey).toEqual({ "episode-1": result.assetIds[0] });
    });

    test("rejects a malformed Agent package before replay checks or persistence", async () => {
        const harness = createHarness();
        const { project } = await harness.repository.createProject({ title: "潮汐之间", projectType: "drama", baseStyle: "realistic", sourceText: "原稿正文" });
        const malformed = { schemaVersion: 1, packageId: "pkg-malformed", projectAssetId: project.id, stage: "script", baseRevision: "0".repeat(64), contentDigest: "1".repeat(64), artifacts: null };

        await expect(harness.repository.commitXiajiArtifactPackage(malformed as never, { id: "canvas-1", xiajiProjectAssetId: project.id }, "now"))
            .rejects.toThrow("Agent 产物包无效");
        expect(harness.getSaveCalls()).toBe(1);
    });

    test("commits a reviewed production breakdown as the current Beat versions with local asset references", async () => {
        const harness = createHarness();
        const { project, episodes } = await harness.repository.createProject({ title: "潮汐之间", projectType: "drama", baseStyle: "realistic", sourceText: "原稿正文", episodes: [{ title: "第一集", order: 1 }] });
        const previousBeat = await harness.repository.createBeat({ projectAssetId: project.id, episodeAssetId: episodes[0].id, order: 1, content: "旧镜头", referencedAssetIds: [] });
        const character: Asset = {
            id: "character-1", kind: "text", title: "林雨", coverUrl: "", tags: [], source: "test", category: "xia-tang:character",
            data: { content: "林雨" }, createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z",
            metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", projectAssetId: project.id, fields: { name: "林雨" } } },
        };
        harness.getAssets().push(character);
        const body = {
            schemaVersion: 1, packageId: "pkg-breakdown-1", projectAssetId: project.id, episodeAssetId: episodes[0].id, stage: "production-breakdown",
            baseRevision: await createXiajiArtifactBaseRevision(harness.getAssets(), project.id, episodes[0].id),
            artifacts: [{ sourceKey: "beat-arrival", kind: "beat", title: "海边重逢", content: "林雨沿着堤岸走来。", metadata: { order: 1, dialogueText: "你还记得这里吗？", speaker: "林雨", durationSeconds: 5, referencedAssetIds: [character.id] } }],
            relations: [{ from: episodes[0].id, type: "contains", to: "beat-arrival" }, { from: "beat-arrival", type: "references", to: character.id }], mediaAssetIds: [],
        };
        const pkg = { ...body, contentDigest: await createXiajiArtifactContentDigest(body) } as XiajiArtifactPackage;

        const result = await harness.repository.commitXiajiArtifactPackage(pkg, { id: "canvas-1", xiajiProjectAssetId: project.id }, "2026-09-27T12:00:00.000Z");
        const currentBeats = harness.repository.listBeats(episodes[0].id);
        const previousAfterCommit = harness.getAssets().find((asset) => asset.id === previousBeat.id)!;
        const currentRecord = getLocalStudioRecord(currentBeats[0]);

        expect(currentBeats).toHaveLength(1);
        expect(currentBeats[0]).toMatchObject({ id: result.assetIds[0], title: "海边重逢", data: { content: "林雨沿着堤岸走来。" } });
        expect(currentRecord).toMatchObject({ recordType: "beat", version: 1, approvalState: "approved", dialogueText: "你还记得这里吗？", referencedAssetIds: [character.id], sourceKey: "beat-arrival" });
        expect(getLocalStudioRecord(previousAfterCommit)).toMatchObject({ recordType: "beat", approvalState: "superseded" });
        expect(getLocalStudioRecord(harness.getAssets().find((asset) => asset.id === episodes[0].id)!)).toMatchObject({ recordType: "episode", currentBeatAssetIds: [result.assetIds[0]] });
    });
});
