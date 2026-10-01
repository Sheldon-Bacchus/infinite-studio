// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { Asset } from "@/stores/use-asset-store";
import {
    createLocalStudioAssetInput,
    getLocalStudioRecord,
    listLocalStudioAssetBeatReferences,
    listCurrentLocalStudioBeats,
    patchLocalStudioRecord,
    summarizeLocalStudioEpisode,
    validateLocalStudioAssetCollection,
    type LocalStudioRecord,
} from "./local-studio-model";

function storedAsset(id: string, record: LocalStudioRecord, content = ""): Asset {
    return {
        id,
        kind: "text",
        title: id,
        coverUrl: "",
        tags: [],
        source: "虾塘本地项目",
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
        data: { content },
        metadata: { localStudio: record },
    };
}

describe("LocalStudio metadata model", () => {
    test("summarizes local script, beat, identity, scene, and prop coverage for an episode", () => {
        const episode = storedAsset("episode-1", { schemaVersion: 1, recordType: "episode", projectAssetId: "project-1", order: 1, title: "第一集", scriptAssetId: "script-1" }, "第一场\n第二场");
        const script = storedAsset("script-1", { schemaVersion: 1, recordType: "script", projectAssetId: "project-1", episodeAssetId: episode.id, documentKind: "script" }, "场景标题\n动作描述\n人物对白");
        const identity = { ...storedAsset("identity-1", { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic" }), metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "identity", projectAssetId: "project-1", fields: {} } } } as Asset;
        const scene = { ...identity, id: "scene-1", metadata: { xiaTang: { schemaVersion: 1, domain: "scene", recordType: "entity", projectAssetId: "project-1", fields: {} } } } as Asset;
        const prop = { ...identity, id: "prop-1", metadata: { xiaTang: { schemaVersion: 1, domain: "prop", recordType: "entity", projectAssetId: "project-1", fields: {} } } } as Asset;
        const beat = (id: string, order: number): Asset => storedAsset(id, { schemaVersion: 1, recordType: "beat", projectAssetId: "project-1", episodeAssetId: episode.id, order, referencedAssetIds: [identity.id, scene.id, prop.id] });

        expect(summarizeLocalStudioEpisode([episode, script, identity, scene, prop, beat("beat-1", 1), beat("beat-2", 2)], episode.id)).toEqual({
            sourceTextLineCount: 2,
            scriptLineCount: 3,
            beatCount: 2,
            identityCount: 1,
            sceneCount: 1,
            propCount: 1,
            scriptReady: true,
        });
    });

    test("lists only the episode's explicitly current Beat versions", () => {
        const episode = storedAsset("episode-1", { schemaVersion: 1, recordType: "episode", projectAssetId: "project-1", order: 1, title: "第一集", currentBeatAssetIds: ["beat-v2"] });
        const oldBeat = storedAsset("beat-v1", { schemaVersion: 1, recordType: "beat", projectAssetId: "project-1", episodeAssetId: episode.id, order: 1, referencedAssetIds: [], approvalState: "superseded" });
        const currentBeat = storedAsset("beat-v2", { schemaVersion: 1, recordType: "beat", projectAssetId: "project-1", episodeAssetId: episode.id, order: 1, referencedAssetIds: [], version: 2, supersedesAssetId: oldBeat.id, approvalState: "approved" });

        expect(listCurrentLocalStudioBeats([episode, oldBeat, currentBeat], episode.id).map((asset) => asset.id)).toEqual([currentBeat.id]);
    });

    test("creates a project text asset with versioned project settings", () => {
        const input = createLocalStudioAssetInput("海边来信", "小说原文", {
            schemaVersion: 1,
            recordType: "project",
            projectType: "短剧",
            baseStyle: "电影写实",
        });

        expect(input.kind).toBe("text");
        expect(input.title).toBe("海边来信");
        expect(input.data).toEqual({ content: "小说原文" });
        expect(input.metadata?.localStudio).toEqual({
            schemaVersion: 1,
            recordType: "project",
            projectType: "短剧",
            baseStyle: "电影写实",
        });
    });

    test("parses supported records and rejects malformed or unsupported schema versions", () => {
        const valid = storedAsset("project-1", {
            schemaVersion: 1,
            recordType: "project",
            projectType: "短剧",
            baseStyle: "写实",
        });
        const unsupported = storedAsset("project-2", {
            schemaVersion: 2,
            recordType: "project",
            projectType: "短剧",
            baseStyle: "写实",
        } as unknown as LocalStudioRecord);
        const malformed = storedAsset("episode-1", {
            schemaVersion: 1,
            recordType: "episode",
            projectAssetId: "",
            order: 0,
            title: "第 1 集",
        } as unknown as LocalStudioRecord);

        expect(getLocalStudioRecord(valid)).toEqual(valid.metadata?.localStudio);
        expect(getLocalStudioRecord(unsupported)).toBeNull();
        expect(getLocalStudioRecord(malformed)).toBeNull();
    });

    test("patches a record without dropping unrelated or future metadata", () => {
        const original = {
            ...storedAsset("project-1", {
                schemaVersion: 1,
                recordType: "project",
                projectType: "短剧",
                baseStyle: "写实",
                futureSetting: { enabled: true },
            } as LocalStudioRecord),
            metadata: {
                keep: { source: "user" },
                xiaTang: { projectColor: "amber" },
                localStudio: {
                    schemaVersion: 1,
                    recordType: "project",
                    projectType: "短剧",
                    baseStyle: "写实",
                    futureSetting: { enabled: true },
                },
            },
        } as Asset;

        const patched = patchLocalStudioRecord(original, { baseStyle: "水墨" });

        expect(getLocalStudioRecord(patched)).toMatchObject({ baseStyle: "水墨", futureSetting: { enabled: true } });
        expect(patched.metadata?.keep).toEqual({ source: "user" });
        expect(patched.metadata?.xiaTang).toEqual({ projectColor: "amber" });
    });

    test("rejects missing parents, duplicate ordering, and dangling referenced assets", () => {
        const project = storedAsset("project-1", {
            schemaVersion: 1,
            recordType: "project",
            projectType: "短剧",
            baseStyle: "写实",
        });
        const episode = storedAsset("episode-1", {
            schemaVersion: 1,
            recordType: "episode",
            projectAssetId: "project-1",
            order: 1,
            title: "第一集",
        });
        const duplicateEpisode = storedAsset("episode-2", {
            schemaVersion: 1,
            recordType: "episode",
            projectAssetId: "project-1",
            order: 1,
            title: "重复序号",
        });
        const orphanBeat = storedAsset("beat-1", {
            schemaVersion: 1,
            recordType: "beat",
            projectAssetId: "project-1",
            episodeAssetId: "missing-episode",
            order: 1,
            referencedAssetIds: ["missing-character"],
        });

        expect(validateLocalStudioAssetCollection([project, episode, duplicateEpisode, orphanBeat]).issues.map(({ code }) => code)).toEqual([
            "duplicate-episode-order",
            "missing-episode",
            "missing-referenced-asset",
        ]);
    });

    test("requires a referenced original source asset to remain in the local collection", () => {
        const project = storedAsset("project-1", {
            schemaVersion: 1,
            recordType: "project",
            projectType: "短剧",
            baseStyle: "写实",
            sourceAssetId: "missing-source",
        });

        expect(validateLocalStudioAssetCollection([project]).issues.map(({ code }) => code)).toEqual(["missing-source-material"]);
    });

    test("lists stable local Beat references sorted by episode and shot order", () => {
        const project = storedAsset("project-1", { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic" });
        const firstEpisode = storedAsset("episode-1", { schemaVersion: 1, recordType: "episode", projectAssetId: project.id, order: 1, title: "第一集" });
        const secondEpisode = storedAsset("episode-2", { schemaVersion: 1, recordType: "episode", projectAssetId: project.id, order: 2, title: "第二集" });
        const character = { ...storedAsset("character-1", { schemaVersion: 1, recordType: "episode", projectAssetId: project.id, order: 9, title: "林雨" }), metadata: { xiaTang: { schemaVersion: 1, domain: "character", recordType: "entity", projectAssetId: project.id, fields: { name: "林雨" } } } } as Asset;
        const laterShot = storedAsset("beat-2", { schemaVersion: 1, recordType: "beat", projectAssetId: project.id, episodeAssetId: secondEpisode.id, order: 4, referencedAssetIds: [character.id] });
        const earlierShot = storedAsset("beat-1", { schemaVersion: 1, recordType: "beat", projectAssetId: project.id, episodeAssetId: firstEpisode.id, order: 2, referencedAssetIds: [character.id] });

        expect(listLocalStudioAssetBeatReferences([project, secondEpisode, laterShot, character, firstEpisode, earlierShot], character.id)).toEqual([
            { projectAssetId: project.id, episodeAssetId: firstEpisode.id, episodeOrder: 1, episodeTitle: "第一集", beatAssetId: earlierShot.id, beatOrder: 2, beatTitle: earlierShot.title },
            { projectAssetId: project.id, episodeAssetId: secondEpisode.id, episodeOrder: 2, episodeTitle: "第二集", beatAssetId: laterShot.id, beatOrder: 4, beatTitle: laterShot.title },
        ]);
    });

    test("rejects Beat references that point into another local project", () => {
        const firstProject = storedAsset("project-1", { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic" });
        const secondProject = storedAsset("project-2", { schemaVersion: 1, recordType: "project", projectType: "drama", baseStyle: "realistic" });
        const episode = storedAsset("episode-1", { schemaVersion: 1, recordType: "episode", projectAssetId: firstProject.id, order: 1, title: "第一集" });
        const foreignEpisode = storedAsset("episode-2", { schemaVersion: 1, recordType: "episode", projectAssetId: secondProject.id, order: 1, title: "别的项目" });
        const beat = storedAsset("beat-1", { schemaVersion: 1, recordType: "beat", projectAssetId: firstProject.id, episodeAssetId: episode.id, order: 1, referencedAssetIds: [foreignEpisode.id] });

        expect(validateLocalStudioAssetCollection([firstProject, secondProject, episode, foreignEpisode, beat]).issues.map(({ code }) => code)).toEqual(["foreign-referenced-asset"]);
    });
});
