import { CanvasNodeType, type CanvasNodeData } from "../types";

export function canGroupConnect(source: CanvasNodeData, target: CanvasNodeData, handleType: "source" | "target") {
    return source.type === CanvasNodeType.Group &&
        handleType === "source" &&
        target.id !== source.id &&
        target.type !== CanvasNodeType.Group &&
        target.type !== CanvasNodeType.Director &&
        target.metadata?.groupId !== source.id;
}
