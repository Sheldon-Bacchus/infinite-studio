import assert from "node:assert/strict";
import test from "node:test";

import { buildNodeGenerationContext } from "../components/canvas-node-generation";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { getGenerationResourceNodes } from "./canvas-resource-references";

function node(id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}, groupId?: string): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { ...metadata, groupId } };
}

test("a group edge expands nested reference members and deduplicates direct edges", () => {
    const nodes = [
        node("outer", CanvasNodeType.Group),
        node("inner", CanvasNodeType.Group, {}, "outer"),
        node("image", CanvasNodeType.Image, { content: "data:image/png;base64,AA==" }, "inner"),
        node("text", CanvasNodeType.Text, { content: "Keep the red costume" }, "outer"),
        node("video", CanvasNodeType.Video, { content: "https://cdn.example.com/ref.mp4" }),
    ];
    const connections: CanvasConnection[] = [
        { id: "group-edge", fromNodeId: "outer", toNodeId: "video" },
        { id: "direct-edge", fromNodeId: "image", toNodeId: "video" },
    ];

    assert.deepEqual(getGenerationResourceNodes("video", nodes, connections).map((item) => item.id), ["image", "text"]);
});

test("group members connected to a composer are included without mention tokens", () => {
    const nodes = [
        node("group", CanvasNodeType.Group),
        node("image", CanvasNodeType.Image, { content: "data:image/png;base64,AA==" }, "group"),
        node("note", CanvasNodeType.Text, { content: "A cautious entrance" }, "group"),
        node("config", CanvasNodeType.Config, { composerContent: "Create a cinematic shot" }),
    ];
    const connections: CanvasConnection[] = [{ id: "edge", fromNodeId: "group", toNodeId: "config" }];

    const context = buildNodeGenerationContext("config", nodes, connections, "Create a cinematic shot");
    assert.equal(context.referenceImages.length, 1);
    assert.match(context.prompt, /A cautious entrance/);
    assert.equal(context.imageCount, 1);
});

test("a connected group never feeds its generation target back as an input", () => {
    const nodes = [
        node("group", CanvasNodeType.Group),
        node("target", CanvasNodeType.Image, { content: "data:image/png;base64,AA==" }, "group"),
    ];
    const connections: CanvasConnection[] = [{ id: "edge", fromNodeId: "group", toNodeId: "target" }];

    assert.deepEqual(getGenerationResourceNodes("target", nodes, connections), []);
});
