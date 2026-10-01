// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Keeps legacy DramaClaw canvas projection helpers outside the local asset connector.
import type { CanvasConnection, CanvasNodeData } from "@/app/(user)/canvas/types";
import { mergeDramaCanvasProjection, type DramaCanvasProjection } from "@/app/(user)/canvas/utils/drama-import";

export function mergeProjectionIntoCanvas(
    existingNodes: CanvasNodeData[],
    existingConnections: CanvasConnection[],
    projection: Pick<DramaCanvasProjection, "nodes" | "connections">,
) {
    return mergeDramaCanvasProjection(existingNodes, existingConnections, projection);
}

export function nextDramaProjectionOrigin(nodes: CanvasNodeData[]) {
    if (!nodes.length) return { x: 0, y: 0 };
    const rightEdge = Math.max(...nodes.map((node) => node.position.x + node.width));
    return { x: rightEdge + 240, y: 0 };
}
