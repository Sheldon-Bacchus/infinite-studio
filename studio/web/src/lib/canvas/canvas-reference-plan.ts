import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getGenerationResourceNodes, getGroupResourceNodes, isCanvasReferenceNode, type CanvasResourceKind, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import {
    CanvasNodeType,
    type CanvasConnection,
    type CanvasGenerationMode,
    type CanvasNodeData,
    type CanvasSubject,
    type CanvasVideoBinding,
    type CanvasVideoInputSnapshot,
    type ReferencePlanProvenance,
    type CanvasGenerationInputSnapshot,
} from "@/types/canvas";

export type ReferencePlanItem = ReferencePlanProvenance;

export type DetailedReferencePlan = {
    activeItems: ReferencePlanProvenance[];
    unreferencedItems: ReferencePlanProvenance[];
    unsupportedItems: ReferencePlanProvenance[];
    compiledPrompt: string;
    participatingNodeIds: string[];
    stableIds: string[];
};

export type CanvasReferencePlan = {
    participatingNodeIds: string[];
    stableIds: string[];
    compiledPrompt: string;
    references: CanvasResourceReference[];
    detailedPlan?: DetailedReferencePlan;
};

const NODE_TOKEN_PATTERN = /@\[node:([^\]]+)\]/g;
const STABLE_TOKEN_PATTERN = /@\[(node|subject|binding):([^\]]+)\]/g;

/** 清洗 URL，移除 presigned 签名、凭据与鉴权参数 */
export function sanitizeUrl(url?: string): string | undefined {
    if (!url) return undefined;
    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("/")) return url;
    try {
        const parsed = new URL(url);
        const sensitivePatterns = [
            "token", "sig", "signature", "auth", "key", "access_token",
            "x-amz-signature", "x-amz-credential", "x-amz-security-token",
            "ossaccesskeyid", "osssignature", "sign",
        ];
        let modified = false;
        for (const key of Array.from(parsed.searchParams.keys())) {
            const lower = key.toLowerCase();
            if (sensitivePatterns.some((pattern) => lower.includes(pattern))) {
                parsed.searchParams.delete(key);
                modified = true;
            }
        }
        return modified ? parsed.toString() : url;
    } catch {
        return url;
    }
}

export function readReferenceOrder(metadata?: { referenceNodeOrder?: string[] }): string[] {
    const order = metadata?.referenceNodeOrder;
    if (!Array.isArray(order)) return [];
    return order.filter((item): item is string => typeof item === "string");
}

export function sortByReferenceOrder<T>(items: T[], order: string[], stableIdOf: (item: T) => string | undefined): T[] {
    if (!order.length || items.length < 2) return items;
    return items
        .map((item, index) => ({ item, index, rank: order.indexOf(stableIdOf(item) || "") }))
        .sort((a, b) => {
            if (a.rank !== -1 && b.rank !== -1) return a.rank - b.rank;
            if (a.rank !== -1) return -1;
            if (b.rank !== -1) return 1;
            return a.index - b.index;
        })
        .map((entry) => entry.item);
}

export function extractPromptReferenceIds(prompt: string): string[] {
    const ids: string[] = [];
    for (const match of prompt.matchAll(STABLE_TOKEN_PATTERN)) {
        const id = match[1] === "node" ? match[2] : `${match[1]}:${match[2]}`;
        if (!ids.includes(id)) ids.push(id);
    }
    return ids;
}

type ExpandedInput = {
    node: CanvasNodeData;
    sourceNodeId?: string;
    groupTitle?: string;
    groupNodeId?: string;
};

function expandInputs(connected: CanvasNodeData[], nodes: CanvasNodeData[]): ExpandedInput[] {
    const expanded: ExpandedInput[] = [];
    const seen = new Set<string>();
    const push = (node: CanvasNodeData, sourceNodeId?: string, groupTitle?: string, groupNodeId?: string) => {
        if (!isCanvasReferenceNode(node, nodes) || seen.has(node.id)) return;
        seen.add(node.id);
        expanded.push({ node, sourceNodeId, groupTitle, groupNodeId });
    };
    for (const node of connected) {
        if (node.type === CanvasNodeType.Group) {
            getGroupResourceNodes(node.id, nodes).forEach((member) => push(member, node.id, node.title || i18n.t("canvas.node.group"), node.id));
        } else {
            push(node);
        }
    }
    return expanded;
}

export function collectActiveReferenceInputs(
    configNodeId: string,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    prompt?: string,
): CanvasNodeData[] {
    return selectActiveInputs(configNodeId, nodes, connections, prompt).map((entry) => entry.node);
}

function selectActiveInputs(configNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt?: string): ExpandedInput[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const expanded = expandInputs(getGenerationResourceNodes(configNodeId, nodes, connections), nodes);
    if (prompt === undefined || !prompt.includes("@[node:")) return expanded;
    const referenced = new Set<string>();
    for (const match of prompt.matchAll(NODE_TOKEN_PATTERN)) {
        const node = nodeById.get(match[1]);
        if (!node) continue;
        if (node.type === CanvasNodeType.Group) getGroupResourceNodes(node.id, nodes).forEach((member) => referenced.add(member.id));
        else referenced.add(node.id);
    }
    return expanded.filter((entry) => referenced.has(entry.node.id));
}

export function referenceKindOf(node: CanvasNodeData): CanvasResourceKind | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return "video";
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || null;
}

function resourceText(node: CanvasNodeData): string | undefined {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt;
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

export function assignReferenceLabels(nodes: CanvasNodeData[]): Map<string, { label: string; kind: CanvasResourceKind }> {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    const labels = new Map<string, { label: string; kind: CanvasResourceKind }>();
    for (const node of nodes) {
        const kind = referenceKindOf(node);
        if (!kind) continue;
        const index = counts[kind]++;
        labels.set(node.id, { label: generationLabel(kind, index), kind });
    }
    return labels;
}

function generationLabel(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return i18n.t("canvas.configNode.videoReferences") + ` ${index + 1}`;
    if (kind === "audio") return i18n.t("canvas.configNode.audioReferences") + ` ${index + 1}`;
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}

/**
 * 构造详细的引用计划：区分活跃提交项、未引用候选、不支持/缺失项。
 * 引用项以引用位置（key）为唯一键，同一图片多用途保持独立关系。
 */
export function buildDetailedReferencePlan(
    configNode: CanvasNodeData,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    promptOverride?: string,
    subjects: CanvasSubject[] = [],
    videoBindings: CanvasVideoBinding[] = [],
): DetailedReferencePlan {
    const composerContent = configNode.metadata?.composerContent;
    const isComposerMode = typeof composerContent === "string" && composerContent.trim().length > 0;
    const prompt = promptOverride !== undefined ? promptOverride : isComposerMode ? composerContent! : configNode.metadata?.prompt ?? "";
    const effectiveBindings = configNode.metadata?.videoBindings || videoBindings;

    const allConnected = expandInputs(getGenerationResourceNodes(configNode.id, nodes, connections), nodes);
    const activeEntries = selectActiveInputs(configNode.id, nodes, connections, isComposerMode ? prompt : undefined);
    const activeNodeIdSet = new Set(activeEntries.map((e) => e.node.id));

    const orderedActive = sortByReferenceOrder(activeEntries, readReferenceOrder(configNode.metadata), (entry) => entry.node.id);
    const labels = assignReferenceLabels(orderedActive.map((entry) => entry.node));

    const createProvenanceItem = (
        entry: ExpandedInput,
        orderIndex: number,
        forcedStatus?: "valid" | "unreferenced" | "unsupported" | "missing",
        binding?: CanvasVideoBinding,
    ): ReferencePlanProvenance => {
        const { node, sourceNodeId, groupTitle, groupNodeId } = entry;
        const meta = node.metadata || {};
        const kind = referenceKindOf(node) || "image";
        const labelled = labels.get(node.id);
        const label = labelled?.label || generationLabel(kind, orderIndex);
        const usage = binding ? i18n.t(`canvas.videoInput.usages.${binding.usage}`) : (kind === "image" ? "image_reference" : kind === "video" ? "video_reference" : kind === "audio" ? "audio_reference" : "text_prompt");
        const isBatchNode = Boolean(meta.images && meta.images.length > 0);
        const matchingImage = isBatchNode
            ? meta.images?.find((im) => binding?.mediaRef?.fileId && im.fileId === binding.mediaRef.fileId)
            : undefined;
        const effectiveFileId = binding?.mediaRef?.fileId || matchingImage?.fileId || (!isBatchNode ? meta.fileId : undefined);
        const effectiveStorageKey = binding?.mediaRef?.storageKey || matchingImage?.storageKey || (!isBatchNode ? meta.storageKey : undefined);
        const effectiveContent = matchingImage?.content || (!isBatchNode ? meta.content : undefined);
        const hasContent = Boolean(effectiveContent || effectiveStorageKey || effectiveFileId || (node.type === CanvasNodeType.Text && meta.prompt));
        const status = forcedStatus || (!hasContent ? "missing" : "valid");

        const previewUrl = sanitizeUrl(effectiveContent || (!isBatchNode ? getNodeDefinition(node.type)?.resource?.(node)?.url : undefined));
        const immutableThumbnail = sanitizeUrl(effectiveStorageKey ? previewUrl : previewUrl);

        return {
            key: binding ? `binding:${binding.bindingId}` : `node:${node.id}`,
            stableId: binding ? `binding:${binding.bindingId}` : node.id,
            nodeId: node.id,
            label,
            title: node.title || label,
            kind,
            usage,
            sourceType: groupNodeId ? "group_member" : binding ? "binding" : "node",
            groupTitle,
            groupNodeId,
            selectedImageId: matchingImage?.id,
            fileId: effectiveFileId,
            storageKey: effectiveStorageKey,
            assetId: matchingImage?.assetId || (!isBatchNode ? meta.assetId : undefined),
            contentVersion: matchingImage?.contentVersion || (!isBatchNode ? meta.contentVersion : undefined),
            originalFilename: typeof (meta as Record<string, unknown>).originalFilename === "string" ? ((meta as Record<string, unknown>).originalFilename as string) : undefined,
            model: meta.model,
            generationId: meta.generationId,
            previewUrl,
            immutableThumbnail,
            text: resourceText(node),
            status,
            disabledReason: status === "missing" ? i18n.t("canvas.references.mediaMissing") : undefined,
        };
    };

    const activeItems: ReferencePlanProvenance[] = [];
    orderedActive.forEach((entry, idx) => {
        const matchingBindings = effectiveBindings.filter((b) => b.nodeId === entry.node.id);
        if (matchingBindings.length > 0) {
            matchingBindings.forEach((binding, bIdx) => {
                activeItems.push(createProvenanceItem(entry, idx + bIdx, undefined, binding));
            });
        } else {
            activeItems.push(createProvenanceItem(entry, idx));
        }
    });

    const unreferencedItems: ReferencePlanProvenance[] = [];
    const unsupportedItems: ReferencePlanProvenance[] = [];

    allConnected.forEach((entry, idx) => {
        if (activeNodeIdSet.has(entry.node.id)) return;
        const kind = referenceKindOf(entry.node);
        if (!kind) {
            unsupportedItems.push({
                ...createProvenanceItem(entry, idx, "unsupported"),
                disabledReason: i18n.t("canvas.videoInput.issues.unsupportedVideoMedia"),
            });
        } else {
            unreferencedItems.push(createProvenanceItem(entry, idx, "unreferenced"));
        }
    });

    return {
        activeItems,
        unreferencedItems,
        unsupportedItems,
        compiledPrompt: prompt,
        participatingNodeIds: activeItems.map((item) => item.nodeId),
        stableIds: activeItems.map((item) => item.stableId),
    };
}

export function buildReferencePlanItems(
    configNode: CanvasNodeData,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    promptOverride?: string,
): ReferencePlanProvenance[] {
    return buildDetailedReferencePlan(configNode, nodes, connections, promptOverride).activeItems;
}

export function resolveReferencePlan(
    configNode: CanvasNodeData,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    promptOverride?: string,
): CanvasReferencePlan {
    const detailedPlan = buildDetailedReferencePlan(configNode, nodes, connections, promptOverride);
    return {
        participatingNodeIds: detailedPlan.participatingNodeIds,
        stableIds: detailedPlan.stableIds,
        compiledPrompt: detailedPlan.compiledPrompt,
        detailedPlan,
        references: detailedPlan.activeItems.map((item) => ({
            id: item.stableId,
            nodeId: item.nodeId,
            kind: item.kind === "subject" ? "text" : item.kind,
            label: item.label,
            title: item.title,
            previewUrl: item.previewUrl,
            text: item.text,
            active: item.status === "valid",
        })),
    };
}

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return resolveReferencePlan(node, nodes, connections).references;
}

/**
 * 请求前创建严格的深拷贝提交快照：
 * 冻结最终提示词、不可变引用清单、媒体标识/版本、来源描述、脱敏后的模型与参数。
 */
export function createGenerationInputSnapshot(args: {
    mode: CanvasGenerationMode;
    prompt: string;
    sourceNode?: CanvasNodeData;
    model: string;
    parameters?: Record<string, unknown>;
    references: ReferencePlanProvenance[];
    videoInputSnapshot?: CanvasVideoInputSnapshot;
    parentGenerationId?: string;
}): CanvasGenerationInputSnapshot {
    const copiedReferences: ReferencePlanProvenance[] = JSON.parse(JSON.stringify(args.references));
    const cleanReferences: ReferencePlanProvenance[] = copiedReferences.map((item) => ({
        ...item,
        previewUrl: sanitizeUrl(item.previewUrl),
        immutableThumbnail: sanitizeUrl(item.immutableThumbnail || item.previewUrl),
    }));

    return {
        schemaVersion: 1,
        snapshotId: nanoid(),
        mode: args.mode,
        prompt: args.prompt.trim(),
        sourceNode: args.sourceNode
            ? {
                  nodeId: args.sourceNode.id,
                  type: args.sourceNode.type,
                  title: args.sourceNode.title || "",
                  workId: (args.sourceNode.metadata?.worksCanonical as { workId?: string } | undefined)?.workId || args.sourceNode.metadata?.workId,
                  objectId: (args.sourceNode.metadata?.worksCanonical as { objectId?: string } | undefined)?.objectId || args.sourceNode.metadata?.objectId,
                  revisionId: (args.sourceNode.metadata?.worksCanonical as { revisionId?: string } | undefined)?.revisionId || args.sourceNode.metadata?.sourceRevision,
              }
            : undefined,
        model: args.model,
        parameters: JSON.parse(JSON.stringify(args.parameters || {})),
        references: cleanReferences,
        createdAt: new Date().toISOString(),
        videoInputSnapshot: args.videoInputSnapshot
            ? {
                  ...JSON.parse(JSON.stringify(args.videoInputSnapshot)),
                  mapping: args.videoInputSnapshot.mapping?.map((row) => ({ ...row, previewUrl: sanitizeUrl(row.previewUrl) })),
              }
            : undefined,
        parentGenerationId: args.parentGenerationId,
    };
}

/**
 * 依据实际提交的 generationContext / fixedVideoInput 集合构建精准的来源清单。
 * 静态保证：清单仅包含实际提交的素材，视频以 fixedVideoInput 为准，绝对不把连线候选伪装为实际输入。
 */
export function buildSubmissionProvenanceReferences(args: {
    mode: CanvasGenerationMode;
    sourceNode?: CanvasNodeData;
    nodes: CanvasNodeData[];
    generationContext: {
        prompt: string;
        referenceImages: Array<{ id: string; name?: string; dataUrl?: string; storageKey?: string; fileId?: string; type?: string }>;
        referenceVideos?: Array<{ id: string; name?: string; url?: string; storageKey?: string; fileId?: string; type?: string }>;
        referenceAudios?: Array<{ id: string; name?: string; url?: string; storageKey?: string; fileId?: string; type?: string }>;
    };
    fixedVideoInput?: {
        prompt: string;
        snapshot: CanvasVideoInputSnapshot;
    } | null;
    subjects?: CanvasSubject[];
}): ReferencePlanProvenance[] {
    const { mode, sourceNode, nodes, generationContext, fixedVideoInput } = args;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    // 1. 视频模式：以 fixedVideoInput (由 confirmed.snapshot 编译) 为绝对准绳
    if (mode === "video" && fixedVideoInput?.snapshot) {
        const snapshot = fixedVideoInput.snapshot;
        const bindingsById = new Map((snapshot.bindings || []).map((binding) => [binding.bindingId, binding]));
        const mappingByBindingId = new Map<string, NonNullable<CanvasVideoInputSnapshot["mapping"]>[number]>();
        (snapshot.mapping || []).forEach((row) => {
            const binding = row.bindingId ? bindingsById.get(row.bindingId) : undefined;
            if (binding && row.kind === binding.mediaType && !mappingByBindingId.has(binding.bindingId)) mappingByBindingId.set(binding.bindingId, row);
        });
        const fromBinding = (binding: CanvasVideoInputSnapshot["bindings"][number], index: number, row?: NonNullable<CanvasVideoInputSnapshot["mapping"]>[number]): ReferencePlanProvenance => {
            const previewUrl = sanitizeUrl(row?.previewUrl);
            return {
                key: `video_bind_${binding.bindingId}_${index}`,
                stableId: `binding:${binding.bindingId}`,
                nodeId: binding.nodeId || "",
                label: row?.tag || i18n.t("canvas.provenance.sourceInfoUnknown"),
                title: row?.name || i18n.t("canvas.provenance.sourceInfoUnknown"),
                kind: binding.mediaType,
                usage: row?.subjectName ? `${row.subjectName} · ${i18n.t(`canvas.videoInput.usages.${binding.usage}`)}` : i18n.t(`canvas.videoInput.usages.${binding.usage}`),
                sourceType: row?.groupNodeId ? "group_member" : "binding",
                groupTitle: row?.groupTitle,
                groupNodeId: row?.groupNodeId,
                selectedImageId: row?.selectedImageId,
                selectedImageIdUnknown: row?.selectedImageIdUnknown,
                fileId: binding.mediaRef?.fileId,
                storageKey: binding.mediaRef?.storageKey,
                assetId: binding.assetId,
                contentVersion: binding.contentVersion,
                originalFilename: row?.originalFilename,
                previewUrl,
                immutableThumbnail: previewUrl,
                status: "valid",
            };
        };
        const promptReferences = (snapshot.mapping || [])
            .filter((row) => row.status === "valid" && (row.kind === "text" || row.kind === "subject"))
            .map((row, index): ReferencePlanProvenance => ({
                key: `video_prompt_${row.kind}_${row.tag}_${index}`,
                stableId: `prompt:${row.kind}:${row.tag}`,
                nodeId: row.nodeId || "",
                label: row.tag || i18n.t("canvas.provenance.sourceInfoUnknown"),
                title: row.name || i18n.t("canvas.provenance.sourceInfoUnknown"),
                kind: row.kind,
                usage: row.workflowField || i18n.t("canvas.provenance.promptSource"),
                sourceType: row.groupNodeId ? "group_member" : row.kind === "subject" ? "subject" : "node",
                groupTitle: row.groupTitle,
                groupNodeId: row.groupNodeId,
                status: "valid",
            }));
        const mediaReferences = [...(snapshot.bindings || [])]
            .sort((a, b) => a.order - b.order)
            .map((binding, index) => fromBinding(binding, index, mappingByBindingId.get(binding.bindingId)));
        return [...promptReferences, ...mediaReferences];
    }

    // 当前音频 API 只接收提示词，不提交任何参考素材。
    if (mode === "audio") return [];

    // 3. 图片与文本模式：来源清单严格对应实际 API payload
    const result: ReferencePlanProvenance[] = [];
    let imageIdx = 0;
    for (const img of generationContext.referenceImages) {
        const node = nodeById.get(img.id);
        const groupNode = node?.metadata?.groupId ? nodeById.get(node.metadata.groupId) : undefined;
        const isSelfSource = sourceNode && sourceNode.id === img.id;
        const label = imageReferenceLabel(imageIdx++);

        const isBatchNode = Boolean(node?.metadata?.images && node.metadata.images.length > 0);
        // 精确匹配多图节点中的图片对象：只能基于固有属性匹配，绝不使用 primaryImageId 提前命中
        const matchingImage = isBatchNode
            ? node?.metadata?.images?.find(
                (item) => item.id === img.id || (img.fileId && item.fileId === img.fileId) || (img.storageKey && item.storageKey === img.storageKey),
            )
            : undefined;
        // 未知多图身份明确保持 undefined，绝不以节点最新 fileId 冒充历史文件
        const effectiveFileId = img.fileId || matchingImage?.fileId || (!isBatchNode ? node?.metadata?.fileId : undefined);
        const effectiveStorageKey = img.storageKey || matchingImage?.storageKey || (!isBatchNode ? node?.metadata?.storageKey : undefined);
        const previewUrl = sanitizeUrl(img.dataUrl || matchingImage?.content || (!isBatchNode ? node?.metadata?.content : undefined));

        result.push({
            key: `img_sub_${img.id}_${imageIdx}`,
            stableId: img.id,
            nodeId: img.id,
            label,
            title: isSelfSource ? (sourceNode.title || i18n.t("canvas.provenance.selfSource")) : (node?.title || img.name || label),
            kind: "image",
            usage: isSelfSource ? i18n.t("canvas.provenance.sourceImage") : i18n.t("canvas.provenance.imageReference"),
            sourceType: groupNode ? "group_member" : "node",
            groupTitle: groupNode?.title,
            groupNodeId: groupNode?.id,
            selectedImageId: matchingImage?.id,
            fileId: effectiveFileId,
            storageKey: effectiveStorageKey,
            assetId: matchingImage?.assetId || (!isBatchNode ? node?.metadata?.assetId : undefined),
            contentVersion: matchingImage?.contentVersion || (!isBatchNode ? node?.metadata?.contentVersion : undefined),
            previewUrl,
            immutableThumbnail: previewUrl,
            status: "valid",
        });
    }

    // 只有在非图片且非音频（如支持视频引用的复合模式）下才处理非图片参考
    if (mode !== "image") {
        let videoIdx = 0;
        for (const v of generationContext.referenceVideos || []) {
            const node = nodeById.get(v.id);
            const groupNode = node?.metadata?.groupId ? nodeById.get(node.metadata.groupId) : undefined;
            const label = `${i18n.t("canvas.configNode.videoReferences")} ${++videoIdx}`;
            const previewUrl = sanitizeUrl(v.url || node?.metadata?.content);

            result.push({
                key: `vid_sub_${v.id}_${videoIdx}`,
                stableId: v.id,
                nodeId: v.id,
                label,
                title: node?.title || v.name || label,
                kind: "video",
                usage: i18n.t("canvas.provenance.videoReference"),
                sourceType: groupNode ? "group_member" : "node",
                groupTitle: groupNode?.title,
                groupNodeId: groupNode?.id,
                fileId: v.fileId || node?.metadata?.fileId,
                storageKey: v.storageKey || node?.metadata?.storageKey,
                previewUrl,
                immutableThumbnail: previewUrl,
                status: "valid",
            });
        }
    }

    return result;
}
