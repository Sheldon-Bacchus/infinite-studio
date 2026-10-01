// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { CanvasNodeType } from "../types";
import { buildDramaCanvasProjection, mergeDramaCanvasProjection } from "./drama-import";

describe("buildDramaCanvasProjection", () => {
    test("maps an episode into grouped nodes and executable connections", () => {
        const projection = buildDramaCanvasProjection({
            catalog: {
                sourceSnapshot: { projectId: "demo", revision: "rev-1" },
                project: { id: "demo", title: "雨夜项目" },
                episodes: [],
                assets: [],
                beatContextAssets: [],
                warnings: [],
            },
            episode: {
                number: 2,
                title: "追车",
                summary: "雨夜追逐",
                beatCount: 1,
                identityIds: [],
                sceneIds: [],
                propIds: [],
                beats: [
                    {
                        episode: 2,
                        beatNumber: 1,
                        title: "车站奔跑",
                        content: "镜头跟随人物穿过站台",
                        prompt: "cinematic rain",
                        frameUrl: "/api/v1/drama/media?url=frame",
                        videoUrl: "",
                        audioUrl: "",
                        sketchUrl: "",
                        identityIds: ["hero"],
                        propIds: ["umbrella"],
                    },
                ],
            },
            mediaByBeat: {},
        });

        const groups = projection.nodes.filter((node) => node.type === CanvasNodeType.Group);
        const texts = projection.nodes.filter((node) => node.type === CanvasNodeType.Text);
        const configs = projection.nodes.filter((node) => node.type === CanvasNodeType.Config);

        expect(groups).toHaveLength(1);
        expect(texts).toHaveLength(1);
        expect(configs).toHaveLength(1);
        expect(texts[0].metadata?.sourceEntityType).toBe("beat");
        expect(projection.nodes.filter((node) => node.type === CanvasNodeType.Image)).toHaveLength(1);
        expect(projection.connections).toHaveLength(2);
        expect(projection.connections[0].fromNodeId).toBe(texts[0].id);
        expect(projection.connections[0].toNodeId).toBe(configs[0].id);
    });

    test("keeps source based ids stable across repeated projections", () => {
        const input = {
            catalog: {
                sourceSnapshot: { projectId: "demo", revision: "rev-1" },
                project: { id: "demo", title: "雨夜项目" },
                episodes: [],
                assets: [],
                beatContextAssets: [],
                warnings: [],
            },
            episode: {
                number: 2,
                title: "追车",
                summary: "雨夜追逐",
                beatCount: 1,
                identityIds: [],
                sceneIds: [],
                propIds: [],
                beats: [
                    {
                        episode: 2,
                        beatNumber: 1,
                        title: "车站奔跑",
                        content: "镜头跟随人物穿过站台",
                        prompt: "cinematic rain",
                        frameUrl: "",
                        videoUrl: "",
                        audioUrl: "",
                        sketchUrl: "",
                        identityIds: [],
                        propIds: [],
                    },
                ],
            },
            mediaByBeat: {},
        };

        const first = buildDramaCanvasProjection(input);
        const second = buildDramaCanvasProjection(input);

        expect(first.nodes.map((node) => node.id)).toEqual(second.nodes.map((node) => node.id));
        expect(first.connections.map((connection) => connection.id)).toEqual(second.connections.map((connection) => connection.id));
    });
});

const makeCatalog = (revision = "rev-1") => ({
    sourceSnapshot: { projectId: "demo", revision },
    project: { id: "demo", title: "雨夜项目" },
    episodes: [],
    assets: [],
    beatContextAssets: [],
    warnings: [],
});

const makeAsset = (overrides: Record<string, unknown> = {}) => ({
    id: "scenes:scene_master:station.png",
    tab: "scenes",
    kind: "scene",
    role: "scene_master",
    label: "车站主场景",
    mediaType: "image",
    url: "/api/v1/drama/media?url=station",
    exists: true,
    meta: { scene: "station", scene_id: "station" },
    ...overrides,
});

describe("buildDramaCanvasProjection for selected assets", () => {
    test("maps text, image, video, and audio assets to matching canvas nodes", () => {
        const projection = buildDramaCanvasProjection({
            catalog: makeCatalog(),
            mediaByBeat: {},
            assets: [
                makeAsset({ id: "text-1", tab: "characters", kind: "identity", role: "character_bio", mediaType: "text", meta: { content: "人物小传" } }),
                makeAsset({ id: "image-1", role: "character_portrait", tab: "characters" }),
                makeAsset({ id: "video-1", role: "current_video", tab: "beats", mediaType: "video" }),
                makeAsset({ id: "audio-1", role: "character_voice", tab: "characters", mediaType: "audio" }),
                makeAsset({ id: "voice-tab-1", role: "narrator_voice", tab: "voices", mediaType: "audio" }),
                makeAsset({ id: "missing-1", mediaType: "image", exists: false, url: "" }),
            ],
        });

        expect(projection.nodes.map((node) => node.type)).toEqual([CanvasNodeType.Text, CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Audio]);
        expect(projection.nodes[0].metadata?.content).toBe("人物小传");
        expect(projection.nodes[1].metadata?.sourceMediaRole).toBe("character_portrait");
        expect(projection.nodes[4].metadata?.sourceEntityType).toBe("voice");
        expect(projection.nodes.every((node) => node.metadata?.projectionKey)).toBe(true);
    });

    test("groups scene assets and episode beats and only creates edges with valid endpoints", () => {
        const projection = buildDramaCanvasProjection({
            catalog: makeCatalog(),
            mediaByBeat: {},
            assets: [makeAsset()],
            episode: {
                number: 2,
                title: "追车",
                summary: "雨夜追逐",
                beatCount: 1,
                identityIds: [],
                sceneIds: [],
                propIds: [],
                beats: [{ episode: 2, beatNumber: 1, title: "车站", content: "追逐", prompt: "", frameUrl: "", sketchUrl: "", videoUrl: "", audioUrl: "", identityIds: [], propIds: [] }],
            },
        });
        const groups = projection.nodes.filter((node) => node.type === CanvasNodeType.Group);
        const nodeIds = new Set(projection.nodes.map((node) => node.id));

        expect(groups.map((node) => node.metadata?.sourceEntityType)).toEqual(["scene", "episode"]);
        expect(projection.connections.length).toBeGreaterThan(0);
        expect(projection.connections.every((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId))).toBe(true);
    });

    test("keeps identity stable across revisions and separates media roles and presets", () => {
        const image = makeAsset({ id: "same-source", role: "scene_master" });
        const reverse = makeAsset({ id: "same-source", role: "scene_reverse_master" });
        const project = (revision: string, asset: Record<string, unknown>, presetId?: string) => buildDramaCanvasProjection({
            catalog: makeCatalog(revision),
            mediaByBeat: {},
            assets: [asset as ReturnType<typeof makeAsset>],
            presetId,
        });
        const first = project("rev-1", image);
        const changedRevision = project("rev-2", image);
        const changedRole = project("rev-1", reverse);
        const changedPreset = project("rev-1", image, "cinematic");

        expect(first.nodes[1].metadata?.projectionKey).toBe(changedRevision.nodes[1].metadata?.projectionKey);
        expect(first.nodes[1].metadata?.projectionKey).not.toBe(changedRole.nodes[1].metadata?.projectionKey);
        expect(first.nodes[1].metadata?.projectionKey).not.toBe(changedPreset.nodes[1].metadata?.projectionKey);
    });

    test("keeps local user assets out of DramaClaw provenance", () => {
        const projection = buildDramaCanvasProjection({
            catalog: makeCatalog(),
            mediaByBeat: {},
            assets: [makeAsset({ id: "local-asset", tab: "my-assets", mediaType: "text", meta: { content: "本地文本", sourceSystem: "infinite-canvas", sourceProjectId: "user-assets" } })],
        });

        expect(projection.nodes[0].metadata?.sourceSystem).toBe("infinite-canvas");
        expect(projection.nodes[0].metadata?.sourceProjectId).toBe("user-assets");
    });

    test("preserves local media storage metadata in projected canvas nodes", () => {
        const projection = buildDramaCanvasProjection({
            catalog: makeCatalog(),
            mediaByBeat: {},
            assets: [makeAsset({ id: "local-image", tab: "my-assets", mediaType: "image", url: "https://media.example/image.png", meta: { sourceSystem: "infinite-canvas", sourceProjectId: "user-assets", storageKey: "image:local-1", width: 640, height: 800, mimeType: "image/png" } })],
        });

        expect(projection.nodes[0].metadata).toMatchObject({ storageKey: "image:local-1", mimeType: "image/png", bytes: undefined });
    });
});

describe("mergeDramaCanvasProjection", () => {
    test("preserves existing user edits and does not duplicate a repeated projection", () => {
        const projection = buildDramaCanvasProjection({
            catalog: makeCatalog(),
            mediaByBeat: {},
            assets: [
                makeAsset({ id: "text-merge", tab: "characters", mediaType: "text", meta: { content: "源文本" } }),
                makeAsset({ id: "image-merge", tab: "props", mediaType: "image" }),
            ],
        });
        const projectedText = projection.nodes.find((node) => node.type === CanvasNodeType.Text)!;
        const userEditedText = { ...projectedText, title: "我改过的标题", metadata: { ...projectedText.metadata, content: "我写的内容" } };
        const userConnection = { id: "user-edge", fromNodeId: "manual", toNodeId: userEditedText.id };
        const existingNodes = [userEditedText, { ...projectedText, id: "manual", title: "手动节点", metadata: { content: "保留" } }];
        const existingConnections = [userConnection];

        const first = mergeDramaCanvasProjection(existingNodes, existingConnections, projection);
        const replayed = mergeDramaCanvasProjection(first.nodes, first.connections, projection);

        expect(first.nodes[0]).toEqual(userEditedText);
        expect(first.nodes.find((node) => node.id === "manual")?.metadata?.content).toBe("保留");
        expect(first.nodes).toHaveLength(3);
        expect(first.connections).toEqual(existingConnections);
        expect(replayed.nodes).toHaveLength(first.nodes.length);
        expect(replayed.connections).toHaveLength(first.connections.length);
    });
});
