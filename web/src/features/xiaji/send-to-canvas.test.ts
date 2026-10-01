// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { CanvasNodeType } from "@/app/(user)/canvas/types";
import { mergeProjectionIntoCanvas, nextDramaProjectionOrigin } from "./drama-canvas-helpers";

const node = (id: string, x: number) => ({
    id,
    type: CanvasNodeType.Text,
    title: id,
    position: { x, y: 0 },
    width: 300,
    height: 160,
    metadata: { content: id, status: "success" as const },
});

describe("legacy Drama canvas projection helpers", () => {
    test("keeps existing canvas nodes and connections and appends a projection once", () => {
        const original = node("existing", 100);
        const projection = {
            nodes: [node("imported", 0)],
            connections: [{ id: "edge-imported", fromNodeId: "existing", toNodeId: "imported" }],
        };

        const first = mergeProjectionIntoCanvas([original], [], projection);
        const replay = mergeProjectionIntoCanvas(first.nodes, first.connections, projection);

        expect(first.nodes.map((item) => item.id)).toEqual(["existing", "imported"]);
        expect(first.connections).toEqual(projection.connections);
        expect(replay).toEqual(first);
        expect(original.metadata?.content).toBe("existing");
    });

    test("places another import to the right of existing canvas content", () => {
        expect(nextDramaProjectionOrigin([])).toEqual({ x: 0, y: 0 });
        expect(nextDramaProjectionOrigin([node("existing", 120)])).toEqual({ x: 660, y: 0 });
    });
});
