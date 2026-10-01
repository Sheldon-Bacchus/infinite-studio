import { CanvasNodeType, type CanvasNodeData } from "../types";
import { isCanvasReferenceNode } from "./canvas-resource-references";

export function buildCanvasGroupConfigBinding(configNode: CanvasNodeData, groupNode: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (configNode.type !== CanvasNodeType.Config) throw new Error("目标节点不是生成配置");
    if (groupNode.type !== CanvasNodeType.Group) throw new Error("来源节点不是画布分组");
    if (configNode.metadata?.generationMode !== "video") throw new Error("请先把目标配置切换为视频模式");
    if (configNode.metadata?.groupId && configNode.metadata.groupId !== groupNode.id) throw new Error("配置已经属于其他分组，不能混合绑定");

    const groupChildren = nodes.filter((node) => node.metadata?.groupId === groupNode.id && node.id !== configNode.id);
    const resources = groupChildren
        .filter(isCanvasReferenceNode)
        .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x || left.id.localeCompare(right.id));
    if (resources.length !== groupChildren.length) {
        const unsupported = groupChildren.filter((node) => !isCanvasReferenceNode(node)).map((node) => node.title || node.id);
        throw new Error("组内有空节点或不支持作为视频引用的节点，请先补全或移出：" + unsupported.join("、"));
    }
    if (!resources.length) throw new Error("这个组里没有可加入配置的文字或媒体素材");
    if (resources.length > 50) throw new Error("一个配置最多绑定 50 个组内节点");

    const mediaTypes = new Set<CanvasNodeType>([CanvasNodeType.Image, CanvasNodeType.Panorama, CanvasNodeType.Video, CanvasNodeType.Audio]);
    const mediaNodes = resources.filter((node) => mediaTypes.has(node.type));
    const textNodes = resources.filter((node) => node.type === CanvasNodeType.Text);
    const groupReferenceNodeIds = new Set(resources.map((node) => node.id));
    const groupMediaIds = new Set(
        nodes
            .filter((node) => node.metadata?.groupId === groupNode.id && mediaTypes.has(node.type))
            .map((node) => node.id),
    );
    const existingContent = configNode.metadata?.composerContent || configNode.metadata?.prompt || "";
    const foreignReferenceId = [...existingContent.matchAll(/@\[node:([^\]]+)\]/g)].map((match) => match[1]).find((nodeId) => !groupReferenceNodeIds.has(nodeId));
    if (foreignReferenceId) throw new Error("配置里已有组外引用，请先移除后再绑定整组：" + foreignReferenceId);
    const body = existingContent
        .split(/\r?\n/)
        .filter((line) => !/^Reference assets:\s*/i.test(line.trim()))
        .map((line) => line.replace(/@\[node:([^\]]+)\]/g, (token, nodeId: string) => (groupMediaIds.has(nodeId) ? "" : token)))
        .join("\n")
        .replace(/^\s*\n+|\n+\s*$/g, "");
    const existingTextIds = new Set([...body.matchAll(/@\[node:([^\]]+)\]/g)].map((match) => match[1]));
    const missingTextIds = textNodes.map((node) => node.id).filter((nodeId) => !existingTextIds.has(nodeId));
    const textBody = [body, missingTextIds.length ? missingTextIds.map((nodeId) => `@[node:${nodeId}]`).join(" ") : ""].filter(Boolean).join("\n");
    const mediaNodeIds = mediaNodes.map((node) => node.id);
    const referenceNodeIds = mediaNodeIds;
    const referenceLine = referenceNodeIds.length ? `Reference assets: ${referenceNodeIds.map((nodeId) => `@[node:${nodeId}]`).join(" ")}` : "";

    return {
        composerContent: [referenceLine, textBody].filter(Boolean).join("\n"),
        referenceNodeIds: resources.map((node) => node.id),
        textNodeIds: textNodes.map((node) => node.id),
        mediaNodeIds,
    };
}
