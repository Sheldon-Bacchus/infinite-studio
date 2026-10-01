// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { getGenerationResourceNodes } from "./canvas-resource-references";

const node = (id: string, type: CanvasNodeType, content: string, extra: Partial<CanvasNodeData["metadata"]> = {}): CanvasNodeData => ({
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 340,
    height: 240,
    metadata: { content, ...extra },
});

describe("composer node references", () => {
    test("resolves real composer chips in their written order without canvas edges", () => {
        const image = node("image-1", CanvasNodeType.Image, "/images/guga.png");
        const audio = node("audio-1", CanvasNodeType.Audio, "/audio/guga.wav");
        const prompt = node("prompt-1", CanvasNodeType.Text, "H3 prompt body");
        const config = node("config-1", CanvasNodeType.Config, "", {
            composerContent: "Reference assets: @[node:image-1] @[node:audio-1]\n@[node:prompt-1]",
        });

        expect(getGenerationResourceNodes(config.id, [prompt, audio, config, image], []).map((item) => item.id)).toEqual([
            "image-1",
            "audio-1",
            "prompt-1",
        ]);
    });

    test("composer chips are authoritative when they exist and do not pull unselected connected assets", () => {
        const selected = node("selected", CanvasNodeType.Image, "/images/selected.png");
        const unselected = node("unselected", CanvasNodeType.Image, "/images/unselected.png");
        const config = node("config", CanvasNodeType.Config, "", { composerContent: "@[node:selected]" });

        expect(getGenerationResourceNodes(config.id, [selected, unselected, config], [
            { id: "edge", fromNodeId: unselected.id, toNodeId: config.id },
        ]).map((item) => item.id)).toEqual(["selected"]);
    });

    test("keeps connection-based references for older configs without composer chips", () => {
        const image = node("image", CanvasNodeType.Image, "/images/legacy.png");
        const config = node("config", CanvasNodeType.Config, "", { composerContent: "Use the connected image" });

        expect(getGenerationResourceNodes(config.id, [image, config], [
            { id: "edge", fromNodeId: image.id, toNodeId: config.id },
        ]).map((item) => item.id)).toEqual(["image"]);
    });
});
