import i18n from "@/i18n";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasCopyResult = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

const NODE_TOKEN_PATTERN = /@\[node:([^\]]+)\]/g;
const BINDING_TOKEN_PATTERN = /@\[binding:([^\]]+)\]/g;

/** 复制前清理临时状态：任务编号、失败详情、最近一次生成结果都不随副本带到新节点。 */
function stripTransientMetadata(metadata: CanvasNodeData["metadata"]) {
    if (!metadata) return metadata;
    const next = { ...metadata };
    delete next.status;
    delete next.errorDetails;
    delete next.videoTaskId;
    delete next.videoTaskProvider;
    delete next.confirmedVideoInput;
    delete next.generationInputSnapshot;
    delete next.content;
    delete next.images;
    return next;
}

/**
 * 从当前选择捕获可复制的节点与连线。
 * 选中组会自动带上组内成员；连线只保留目标节点也在选择内的入边，外部入边留给粘贴阶段按目标画布判断。
 */
export function captureCanvasSelection(
    selectedNodeIds: string[],
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
): CanvasCopyResult {
    const selection = new Set(selectedNodeIds);
    for (const node of nodes) {
        if (node.metadata?.groupId && selection.has(node.metadata.groupId)) selection.add(node.id);
    }

    const copiedNodes = nodes
        .filter((node) => selection.has(node.id))
        .map((node) => ({
            ...node,
            position: { ...node.position },
            metadata: node.metadata ? JSON.parse(JSON.stringify(stripTransientMetadata(node.metadata))) : undefined,
        }));

    const copiedConnections = connections.filter((connection) => selection.has(connection.toNodeId)).map((connection) => ({ ...connection }));

    return { nodes: copiedNodes, connections: copiedConnections };
}

/**
 * 把剪贴板内容粘贴到目标画布：重映射节点 ID、组关系、@[node:] 标记、referenceNodeOrder 与 videoBindings。
 * 源节点仍在目标画布时保留外部入边；否则丢弃，避免指向不存在的来源。
 */
export function applyCanvasPaste(
    clipboard: CanvasCopyResult,
    targetNodes: CanvasNodeData[],
    generateId: (oldType: string) => string,
): CanvasCopyResult {
    const idMap = new Map<string, string>();
    const copiedNodes: CanvasNodeData[] = clipboard.nodes.map((node) => {
        const id = generateId(node.type);
        idMap.set(node.id, id);
        return {
            ...node,
            id,
            position: { ...node.position },
            metadata: node.metadata ? JSON.parse(JSON.stringify(node.metadata)) : undefined,
            title: node.title ? i18n.t("canvas.configNode.copyTitle", { title: node.title }) : "",
        };
    });

    for (const node of copiedNodes) {
        const metadata = node.metadata;
        if (!metadata) continue;
        if (metadata.groupId && idMap.has(metadata.groupId)) metadata.groupId = idMap.get(metadata.groupId);
        const remapNodeTokens = (value?: string) => value?.replace(NODE_TOKEN_PATTERN, (match, refId: string) => (idMap.has(refId) ? `@[node:${idMap.get(refId)}]` : match));
        if (typeof metadata.composerContent === "string") metadata.composerContent = remapNodeTokens(metadata.composerContent);
        if (typeof metadata.prompt === "string") metadata.prompt = remapNodeTokens(metadata.prompt);
        if (Array.isArray(metadata.referenceNodeOrder)) metadata.referenceNodeOrder = metadata.referenceNodeOrder.map((refId) => idMap.get(refId) || refId);
        if (metadata.videoBindings) {
            const bindingIdMap = new Map(metadata.videoBindings.map((binding) => [binding.bindingId, generateId("binding")]));
            const remapBindingTokens = (value?: string) => value?.replace(BINDING_TOKEN_PATTERN, (match, refId: string) => (bindingIdMap.has(refId) ? `@[binding:${bindingIdMap.get(refId)}]` : match));
            if (typeof metadata.composerContent === "string") metadata.composerContent = remapBindingTokens(metadata.composerContent);
            if (typeof metadata.prompt === "string") metadata.prompt = remapBindingTokens(metadata.prompt);
            metadata.videoBindings = metadata.videoBindings.map((binding) => ({
                ...binding,
                bindingId: bindingIdMap.get(binding.bindingId) || binding.bindingId,
                nodeId: idMap.get(binding.nodeId) || binding.nodeId,
            }));
        }
    }

    const copiedConnections: CanvasConnection[] = [];
    for (const connection of clipboard.connections) {
        const fromCopied = idMap.get(connection.fromNodeId);
        const toCopied = idMap.get(connection.toNodeId);
        if (toCopied && fromCopied) {
            copiedConnections.push({ ...connection, id: generateId("connection"), fromNodeId: fromCopied, toNodeId: toCopied });
        } else if (toCopied && targetNodes.some((node) => node.id === connection.fromNodeId)) {
            copiedConnections.push({ ...connection, id: generateId("connection"), toNodeId: toCopied });
        }
    }

    return { nodes: copiedNodes, connections: copiedConnections };
}

export function hasCanvasClipboardContent(clipboard: CanvasCopyResult | null): boolean {
    return Boolean(clipboard?.nodes.length);
}

export const CANVAS_COPY_NODE_TYPES = [CanvasNodeType.Config, CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text, CanvasNodeType.Group];

