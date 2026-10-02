import { expect, test } from "bun:test";

import { isAgentCanvasTargetReady } from "../src/lib/canvas/canvas-agent-target";

test("rejects callbacks from an earlier canvas restore after a new canvas becomes ready", () => {
    expect(isAgentCanvasTargetReady("canvas-a:0:0", "canvas-a:0:0", true)).toBe(true);
    expect(isAgentCanvasTargetReady("canvas-a:0:0", "canvas-a:0:0", false)).toBe(false);
    expect(isAgentCanvasTargetReady("canvas-a:0:0", "canvas-b:0:0", true)).toBe(false);
});
