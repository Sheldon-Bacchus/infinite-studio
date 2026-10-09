import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import i18n from "@/i18n";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import { readReferenceOrder, sortByReferenceOrder } from "@/lib/canvas/canvas-reference-plan";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasSubject, type VideoInputItem } from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
    token?: string;
    subjectId?: string;
    bindingId?: string;
    active: boolean;
};

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], subjects: CanvasSubject[] = []) {
    const resources = labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections), true);
    if (node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Config) return resources;
    const nodeById = new Map(nodes.map((item) => [item.id, item]));
    const subjectReferences: CanvasResourceReference[] = subjects.map((subject) => ({ id: `subject:${subject.subjectId}`, nodeId: node.id, kind: "text", label: `Subject: ${subject.name}`, title: subject.name, text: subject.description, token: `@[subject:${subject.subjectId}]`, subjectId: subject.subjectId, active: true }));
    const bindingReferences: CanvasResourceReference[] = (node.metadata?.videoBindings || []).flatMap((binding) => {
        const mediaNode = nodeById.get(binding.nodeId);
        if (!mediaNode) return [];
        return [{ id: `binding:${binding.bindingId}`, nodeId: binding.nodeId, kind: binding.mediaType, label: `${mediaNode.title} · ${i18n.t(`canvas.videoInput.usages.${binding.usage}`)}`, title: mediaNode.title, previewUrl: mediaNode.metadata?.content, text: binding.subjectId ? subjects.find((subject) => subject.subjectId === binding.subjectId)?.name : undefined, token: `@[binding:${binding.bindingId}]`, bindingId: binding.bindingId, active: true }];
    });
    return [...resources, ...subjectReferences, ...bindingReferences];
}

export function buildCanvasResourceReferences(nodes: CanvasNodeData[]) {
    return labelResourceNodes(nodes, true);
}

export async function resolveCanvasReferenceImages(references: CanvasResourceReference[], nodes: CanvasNodeData[]) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return Promise.all(references.filter((reference) => reference.kind === "image").map(async (reference) => {
        const node = nodesById.get(reference.nodeId);
        if (!node) throw new Error(i18n.t("agent.composer.mentions.resourceMissing", { title: reference.title }));
        const metadata = node.metadata;
        const dataUrl = await imageToDataUrl({ storageKey: metadata?.storageKey, fileId: metadata?.fileId, url: reference.previewUrl });
        if (!dataUrl.startsWith("data:image/")) throw new Error(i18n.t("agent.composer.mentions.imageReadFailed", { title: reference.title }));
        const meta = metadata?.naturalWidth && metadata.naturalHeight
            ? { width: metadata.naturalWidth, height: metadata.naturalHeight, mimeType: metadata.mimeType || dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png" }
            : await readImageMeta(dataUrl);
        return {
            id: `canvas:${node.id}`,
            name: reference.title,
            type: metadata?.mimeType || meta.mimeType,
            size: metadata?.bytes || getDataUrlByteSize(dataUrl),
            width: meta.width,
            height: meta.height,
            url: reference.previewUrl || dataUrl,
            dataUrl,
        };
    }));
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = expandGroupResourceNodes(getConnectedConfigInputNodes(nodeId, nodes, connections), nodes);
    if (configInputs.length) return configInputs;
    const ownInputs = expandGroupResourceNodes(getContextInputNodes(nodeId, nodes, connections), nodes);
    if (ownInputs.length) return ownInputs;
    const node = nodes.find((item) => item.id === nodeId);
    return node && isResourceNode(node) ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigInputNodes(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextInputNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    return [];
}

function getContextInputNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodes.find((node) => node.id === connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isCanvasReferenceNode(node, nodes)));
}

function getConnectedConfigInputNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configConnection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    if (!configConnection) return [];
    return getContextInputNodes(configConnection.toNodeId, nodes, connections).filter((node) => node.id !== nodeId);
}

function hasGroupResources(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    return node.type === CanvasNodeType.Group && getGroupResourceNodes(node.id, nodes).length > 0;
}

export function isCanvasReferenceNode(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    return isResourceNode(node) || hasGroupResources(node, nodes);
}

function expandGroupResourceNodes(inputNodes: CanvasNodeData[], nodes: CanvasNodeData[]) {
    const resources = inputNodes.flatMap((node) => (node.type === CanvasNodeType.Group ? getGroupResourceNodes(node.id, nodes) : [node]));
    return [...new Map(resources.map((node) => [node.id, node])).values()];
}

export function getGroupResourceNodes(groupId: string, nodes: CanvasNodeData[]) {
    return nodes.filter((node) => node.metadata?.groupId === groupId && isResourceNode(node));
}

function labelResourceNodes(nodes: CanvasNodeData[], active: boolean) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = resourceKind(node);
        if (!kind) return [];
        const resource = getNodeDefinition(node.type)?.resource?.(node);
        const index = counts[kind]++;
        const label = labelForKind(kind, index);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: node.title || label,
                previewUrl: node.metadata?.content || resource?.url,
                text: resourceText(node),
                active,
            },
        ];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return i18n.t("canvas.configNode.videoReferences") + ` ${index + 1}`;
    if (kind === "audio") return i18n.t("canvas.configNode.audioReferences") + ` ${index + 1}`;
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(resourceKind(node));
}

function resourceText(node: CanvasNodeData): string | undefined {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt;
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

function resourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return "video";
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    // Plugin nodes declare their input eligibility through definition.resource.
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || null;
}

export function getEffectiveVideoInputNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData[] {
    const rawInputs = getGenerationResourceNodes(nodeId, nodes, connections);
    const result: CanvasNodeData[] = [];
    const seen = new Set<string>();
    for (const input of rawInputs) {
        if (input.type === CanvasNodeType.Group) {
            for (const member of getGroupResourceNodes(input.id, nodes)) {
                if (isResourceNode(member) && !seen.has(member.id)) {
                    seen.add(member.id);
                    result.push(member);
                }
            }
        } else if (isResourceNode(input) && !seen.has(input.id)) {
            seen.add(input.id);
            result.push(input);
        }
    }
    return result;
}

/** AutoDL 首个动作迁移工作流声明了 ref_video 输入；其余已知 H3 工作流没有视频字段。 */
function workflowDeclaresVideoInput(model: string) {
    return model.trim().toLowerCase() === "wan2.2animate-v4-motion_retargeting";
}

export function buildVideoInputList(
    sourceNode: CanvasNodeData,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    subjects: CanvasSubject[] = [],
    prompt = "",
    modelOverride?: string,
): VideoInputItem[] {
    const effectiveNodes = getEffectiveVideoInputNodes(sourceNode.id, nodes, connections);
    const items: VideoInputItem[] = [];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    const effectiveModel = (modelOverride || sourceNode.metadata?.model || "").trim();
    const isH3 = /h3/i.test(effectiveModel);

    for (const node of effectiveNodes) {
        const kind = resourceKind(node);
        if (!kind) continue;
        const number = ++counts[kind];
        let h3Tag: string | undefined;
        let previewUrl: string | undefined;
        let text: string | undefined;
        let disabled: boolean | undefined;
        let disabledReason: string | undefined;

        if (kind === "image") {
            h3Tag = `<Picture ${number}>`;
            const resource = getNodeDefinition(node.type)?.resource?.(node);
            previewUrl = node.metadata?.content || resource?.url;
        } else if (kind === "video") {
            h3Tag = `<Video ${number}>`;
            const resource = getNodeDefinition(node.type)?.resource?.(node);
            previewUrl = node.metadata?.content || resource?.url;
            // H3 工作流默认没有视频输入字段；只有确实声明了视频输入的 AutoDL 工作流例外。
            if (isH3 && !workflowDeclaresVideoInput(effectiveModel)) {
                disabled = true;
                disabledReason = i18n.t("canvas.videoInput.issues.unsupportedVideoMedia") || "当前工作流不支持视频输入，无可用字段";
            }
        } else if (kind === "audio") {
            h3Tag = `<Audio ${number}>`;
        } else if (kind === "text") {
            text = resourceText(node);
        }

        items.push({
            kind,
            stableId: `node:${node.id}`,
            nodeId: node.id,
            name: node.title || (kind === "text" ? `文本 ${number}` : `${kind} ${number}`),
            number,
            h3Tag,
            referenced: false,
            previewUrl,
            text,
            disabled,
            disabledReason,
        });
    }

    const effectiveNodeIds = new Set(effectiveNodes.map((n) => n.id));
    const activeBindings = (sourceNode.metadata?.videoBindings || []).filter(
        (binding) => binding.subjectId && effectiveNodeIds.has(binding.nodeId)
    );
    const seenSubjectIds = new Set<string>();
    let subjectCount = 0;

    for (const binding of activeBindings) {
        if (!binding.subjectId || seenSubjectIds.has(binding.subjectId)) continue;
        const subject = subjects.find((s) => s.subjectId === binding.subjectId);
        if (!subject) continue;
        seenSubjectIds.add(binding.subjectId);
        subjectCount++;
        const h3Tag = `<Subject ${subjectCount}>`;
        const boundNodes = effectiveNodes.filter((n) => activeBindings.some((b) => b.subjectId === subject.subjectId && b.nodeId === n.id));
        const boundNode = boundNodes[0];
        const boundPreview = boundNode?.metadata?.content || getNodeDefinition(boundNode?.type || "")?.resource?.(boundNode!)?.url;

        items.push({
            kind: "subject",
            stableId: `subject:${subject.subjectId}`,
            nodeId: binding.nodeId,
            name: subject.name,
            number: subjectCount,
            h3Tag,
            referenced: false,
            previewUrl: boundPreview,
            text: subject.description,
        });
    }

    // 提交前按 referenceNodeOrder 固定顺序，再按实际顺序重新编号并生成标签；
    // 正文标记的解析与提交都基于这同一份编号，避免排序后标签与请求不一致。
    const ordered = sortByReferenceOrder(items, readReferenceOrder(sourceNode.metadata), (item) => item.stableId);
    const nextNumbers = { image: 0, video: 0, audio: 0, text: 0, subject: 0 };
    for (const item of ordered) {
        const number = ++nextNumbers[item.kind];
        item.number = number;
        item.h3Tag =
            item.kind === "image"
                ? `<Picture ${number}>`
                : item.kind === "video"
                  ? `<Video ${number}>`
                  : item.kind === "audio"
                    ? `<Audio ${number}>`
                    : item.kind === "subject"
                      ? `<Subject ${number}>`
                      : undefined;
        item.name = item.kind === "text" ? `文本 ${number}` : item.name;
        item.referenced = prompt.includes(`@[${item.stableId}]`) || Boolean(item.h3Tag && prompt.includes(item.h3Tag));
    }

    return ordered;
}
