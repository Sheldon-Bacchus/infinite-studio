// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { CanvasNodeType, type CanvasNodeData } from "@/app/(user)/canvas/types";
import type { Asset } from "@/stores/use-asset-store";
import { bindComposerMediaReferences, buildConfigMediaBinding, buildVideoConfigDraftNode, listCanvasLocalAssets } from "./local-assets-mcp";

const base = {
    title: "夜站素材",
    coverUrl: "secret-local-path-must-not-leak",
    tags: ["SHOT-05", "雨夜"],
    category: "场景",
    source: "local",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
};

const assets: Asset[] = [
    { ...base, id: "frame", kind: "image", data: { dataUrl: "data:image/png;base64,AAAA", storageKey: "image:frame", width: 640, height: 360, bytes: 4, mimeType: "image/png" } },
    { ...base, id: "voice", kind: "audio", data: { url: "/api/audio/voice", storageKey: "audio:voice", bytes: 8, mimeType: "audio/wav" } },
    { ...base, id: "script", kind: "text", data: { content: "dialogue" } },
];

const group: CanvasNodeData = {
    id: "group-05",
    type: CanvasNodeType.Group,
    title: "EP001 SHOT-05",
    position: { x: 0, y: 0 },
    width: 800,
    height: 500,
};

describe("local asset MCP behavior", () => {
    test("lists stable asset metadata without media URLs or local paths", () => {
        const page = listCanvasLocalAssets(assets, { page: 1, pageSize: 2, keyword: "雨夜" });

        expect(page).toMatchObject({ total: 3, page: 1, pageSize: 2 });
        expect(page.items.map((item) => item.assetId)).toEqual(["frame", "script"]);
        expect(page.items[0]).toMatchObject({ title: "夜站素材", type: "image", category: "场景", tags: ["SHOT-05", "雨夜"], mediaAvailable: true, mimeType: "image/png", bytes: 4 });
        expect(JSON.stringify(page)).not.toContain("data:image");
        expect(JSON.stringify(page)).not.toContain("secret-local-path");
        expect(JSON.stringify(page)).not.toContain("/api/audio");
    });

    test("writes ordered real media chips and preserves prompt text and unrelated configuration", () => {
        const original = "Reference assets: @[node:old-image]\n@[node:prompt-05]\nKeep this exact prompt body.";
        const result = bindComposerMediaReferences(original, ["frame-05", "voice-05"], ["old-image", "frame-05", "voice-05"]);

        expect(result).toBe("Reference assets: @[node:frame-05] @[node:voice-05]\n@[node:prompt-05]\nKeep this exact prompt body.");
        expect([...result.matchAll(/@\[node:([^\]]+)\]/g)].map((match) => match[1])).toEqual(["frame-05", "voice-05", "prompt-05"]);
        expect(bindComposerMediaReferences(result, ["frame-05", "voice-05"], ["old-image", "frame-05", "voice-05"])).toBe(result);
    });

    test("validates actual in-group image and audio nodes before returning chip content", () => {
        const config: CanvasNodeData = {
            id: "config-05",
            type: CanvasNodeType.Config,
            title: "SHOT-05 config",
            position: { x: 0, y: 0 },
            width: 440,
            height: 240,
            metadata: { groupId: group.id, composerContent: "@[node:prompt-05]" },
        };
        const prompt: CanvasNodeData = {
            id: "prompt-05",
            type: CanvasNodeType.Text,
            title: "H3 Prompt",
            position: { x: 0, y: 300 },
            width: 340,
            height: 240,
            metadata: { groupId: group.id, content: "six H3 sections" },
        };
        const frame: CanvasNodeData = {
            id: "frame-05",
            type: CanvasNodeType.Image,
            title: "SHOT-05 keyframe",
            position: { x: 0, y: 600 },
            width: 340,
            height: 260,
            metadata: { groupId: group.id, content: "/media/frame.png", storageKey: "image:frame", mimeType: "image/png", sourceSystem: "infinite-canvas", sourceEntityType: "asset" },
        };
        const voice: CanvasNodeData = {
            id: "voice-05",
            type: CanvasNodeType.Audio,
            title: "SHOT-05 voice",
            position: { x: 400, y: 600 },
            width: 420,
            height: 160,
            metadata: { groupId: group.id, content: "/media/voice.wav", storageKey: "audio:voice", mimeType: "audio/wav", sourceSystem: "infinite-canvas", sourceEntityType: "asset" },
        };
        const result = buildConfigMediaBinding(config, [frame.id, voice.id], [group, config, voice, frame, prompt]);

        expect(result.mediaNodes.map((node) => node.id)).toEqual(["frame-05", "voice-05"]);
        expect(result.composerContent).toBe("Reference assets: @[node:frame-05] @[node:voice-05]\n@[node:prompt-05]");
        expect(() => buildConfigMediaBinding(config, ["absent"], [group, config, prompt])).toThrow("找不到节点");
        expect(() => buildConfigMediaBinding(config, ["video-05"], [group, config, prompt, { ...frame, id: "video-05", type: CanvasNodeType.Video, metadata: { ...frame.metadata, mimeType: "video/mp4" } }])).toThrow("只可绑定");
        expect(() => buildConfigMediaBinding(config, ["other-frame"], [group, config, prompt, { ...frame, id: "other-frame", metadata: { ...frame.metadata, groupId: "group-06" } }])).toThrow("同一镜头组");
    });

    test("builds a stable idle video config draft without changing existing prompt or settings", () => {
        const draft = buildVideoConfigDraftNode({
            id: "config-shot-05",
            shotKey: "SHOT-05",
            groupNodeId: group.id,
            promptNodeId: "prompt-05",
            position: { x: 900, y: 700 },
            durationSeconds: 7,
            aspectRatio: "16:9",
            quality: "768p",
            model: "configured-video-model",
            existingNode: {
                id: "config-shot-05",
                type: CanvasNodeType.Config,
                title: "Existing draft",
                position: { x: 20, y: 30 },
                width: 440,
                height: 240,
                metadata: { status: "idle", composerContent: "@[node:prompt-05]", negativePrompt: "keep", generationMode: "image" },
            },
        });

        expect(draft).toMatchObject({ id: "config-shot-05", type: CanvasNodeType.Config, title: "EP001 · SHOT-05 配置草稿", position: { x: 900, y: 700 } });
        expect(draft.metadata).toMatchObject({
            status: "idle",
            generationMode: "video",
            groupId: group.id,
            composerContent: "@[node:prompt-05]",
            seconds: "7",
            size: "16:9",
            vquality: "768",
            model: "configured-video-model",
            negativePrompt: "keep",
        });
        expect(draft.metadata?.videoTaskId).toBeUndefined();
        expect(draft.metadata?.imageTaskId).toBeUndefined();
        expect(draft.metadata?.audioTaskId).toBeUndefined();
    });
});
