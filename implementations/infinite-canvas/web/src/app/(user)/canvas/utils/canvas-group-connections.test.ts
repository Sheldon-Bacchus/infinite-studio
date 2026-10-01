import assert from "node:assert/strict";
import test from "node:test";

import { canGroupConnect } from "./canvas-group-connections";
import { CanvasNodeType, type CanvasNodeData } from "../types";

function node(id: string, type: CanvasNodeType, groupId?: string): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { groupId } };
}

test("a group can connect from its output to an external generation/config node only", () => {
    const group = node("group", CanvasNodeType.Group);
    assert.equal(canGroupConnect(group, node("config", CanvasNodeType.Config), "source"), true);
    assert.equal(canGroupConnect(group, node("image", CanvasNodeType.Image, "group"), "source"), false);
    assert.equal(canGroupConnect(group, node("other", CanvasNodeType.Group), "source"), false);
    assert.equal(canGroupConnect(group, node("director", CanvasNodeType.Director), "source"), false);
    assert.equal(canGroupConnect(group, node("video", CanvasNodeType.Video), "target"), false);
});
