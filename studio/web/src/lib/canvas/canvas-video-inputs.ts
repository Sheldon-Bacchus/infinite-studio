import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { buildVideoInputList, getEffectiveVideoInputNodes, getGenerationResourceNodes, getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { inferVideoRatio } from "@/lib/media-size";
import { isAutoDLWorkflow } from "@/lib/autodl-video-settings";
import { findChannelModel, modelOptionName, boolConfig, type AiConfig } from "@/stores/use-config-store";
import {
    CanvasNodeType,
    type CanvasMediaUsage,
    type CanvasNodeData,
    type CanvasSubject,
    type CanvasVideoGenerationParams,
    type CanvasVideoGroupSnapshot,
    type CanvasVideoInputBinding,
    type CanvasVideoInputCandidate,
    type CanvasVideoInputCapabilities,
    type CanvasVideoInputSnapshot,
    type VideoInputIssue,
    type VideoInputItem,
    type VideoInputMappingRow,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type ParsedVideoPromptReference = {
    kind: "subject" | "binding" | "legacy" | "node" | "h3";
    token: string;
    stableId?: string;
    h3Kind?: "Subject" | "Picture" | "Video" | "Audio";
    h3Number?: number;
    start: number;
    end: number;
};

export type CompiledVideoInput = {
    snapshot: CanvasVideoInputSnapshot;
    prompt: string;
    images: ReferenceImage[];
    videos: ReferenceVideo[];
    audios: ReferenceAudio[];
    params: CanvasVideoGenerationParams;
    bindings: CanvasVideoInputBinding[];
    mapping: VideoInputMappingRow[];
    issues: VideoInputIssue[];
};

export type CanvasVideoInputAdapter = {
    adapterId: CanvasVideoInputCapabilities["adapterId"] | "text-only-video-v1";
    validate: (candidate: CanvasVideoInputCandidate, capabilities: CanvasVideoInputCapabilities) => VideoInputIssue[];
    compile: (candidate: CanvasVideoInputCandidate) => CompiledVideoInput;
};

const mediaTypes = ["image", "video", "audio"] as const;
const defaultUsage: Record<(typeof mediaTypes)[number], CanvasMediaUsage> = {
    image: "appearance",
    video: "action",
    audio: "original_audio",
};

function sortBindings(bindings: CanvasVideoInputBinding[]) {
    return [...bindings].sort((a, b) => a.order - b.order);
}

const adapters: Record<CanvasVideoInputCapabilities["adapterId"], CanvasVideoInputAdapter> = {
    "openai-video-v1": createAdapter("openai-video-v1", "openai"),
    "gemini-video-v1": createAdapter("gemini-video-v1", "gemini"),
    "script-video-v1": createAdapter("script-video-v1", "script"),
};

const textOnlyAdapter: CanvasVideoInputAdapter = {
    adapterId: "text-only-video-v1",
    validate: (candidate) => (candidate.bindings.length ? [issue("adapterUnsupported")] : []),
    compile: (candidate) => compileVideoInput(candidate, textOnlyAdapter),
};

export function parseVideoPromptReferences(prompt: string): ParsedVideoPromptReference[] {
    const references: ParsedVideoPromptReference[] = [];
    const pattern = /@\[(subject|binding|node):([^\]]+)\]|<(Subject|Picture|Video|Audio)\s+(\d+)>|\b(subject|picture|image|audio|video)[ _](\d+)\b/gi;
    for (const match of prompt.matchAll(pattern)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        if (match[1]) {
            references.push({
                kind: match[1].toLowerCase() as "subject" | "binding" | "node",
                token: match[0],
                stableId: match[2],
                start,
                end,
            });
        } else if (match[3]) {
            const h3Kind = (match[3].charAt(0).toUpperCase() + match[3].slice(1).toLowerCase()) as "Subject" | "Picture" | "Video" | "Audio";
            const h3Number = Number.parseInt(match[4], 10);
            references.push({
                kind: "h3",
                token: match[0],
                h3Kind,
                h3Number,
                start,
                end,
            });
        } else if (match[5]) {
            references.push({
                kind: "legacy",
                token: match[0],
                start,
                end,
            });
        }
    }
    return references;
}

export function resolveVideoInputAdapter(config: AiConfig, model: string) {
    const configured = findChannelModel(config, model);
    const declared = configured?.model.videoInputCapabilities;
    if (!declared) return null;
    if (
        declared.adapterId === "script-video-v1"
            ? !configured?.model.script?.trim()
            : Boolean(configured?.model.script?.trim()) || configured?.channel.apiFormat !== (declared.adapterId === "gemini-video-v1" ? "gemini" : "openai")
    )
        return null;
    return adapters[declared.adapterId] ? { adapter: adapters[declared.adapterId], capabilities: declared } : null;
}

export function getVideoAdapterConfigFingerprint(config: AiConfig, model: string) {
    const configured = findChannelModel(config, model);
    const value = JSON.stringify({
        apiFormat: configured?.channel.apiFormat || "",
        capabilities: configured?.model.videoInputCapabilities || null,
        script: configured?.model.script || "",
    });
    let hash = 2166136261;
    for (const character of value) {
        hash ^= character.codePointAt(0) || 0;
        hash = Math.imul(hash, 16777619);
    }
    return `${(hash >>> 0).toString(16)}:${value.length}`;
}

export function getVideoInputAdapter(adapterId?: string) {
    return adapterId === "text-only-video-v1" ? textOnlyAdapter : adapters[adapterId as CanvasVideoInputCapabilities["adapterId"]] || null;
}

export function buildVideoInputCandidate(args: {
    sourceNode: CanvasNodeData;
    nodes: CanvasNodeData[];
    connections: { fromNodeId: string; toNodeId: string }[];
    subjects: CanvasSubject[];
    config: AiConfig;
    prompt: string;
}): CanvasVideoInputCandidate {
    const { sourceNode, nodes, connections, subjects, config, prompt } = args;
    const normalizedPrompt = prompt.trim();
    const model = (config.model || config.videoModel).trim();
    const resolved = resolveVideoInputAdapter(config, model);
    const params: CanvasVideoGenerationParams = {
        mode: config.videoMode === "reference" ? "reference" : "frames",
        seconds: config.videoSeconds,
        size: config.size,
        resolution: config.vquality,
        aspectRatio: inferVideoRatio(config.size),
        generateAudio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };

    const boundNodes = new Map(nodes.map((node) => [node.id, node]));
    const issues: VideoInputIssue[] = [];
    const inputList = buildVideoInputList(sourceNode, nodes, connections, subjects, normalizedPrompt, model);

    // 有效输入中的图片、视频、音频默认全部作为请求附件，先固定顺序再分类编号
    const mediaItems = inputList.filter((item) => item.kind === "image" || item.kind === "video" || item.kind === "audio");
    const configuredBindings = sourceNode.metadata?.videoBindings || [];
    const bindings: CanvasVideoInputBinding[] = [];
    for (const row of configuredBindings) {
        if (row.subjectId && !subjects.some((subject) => subject.subjectId === row.subjectId)) {
            issues.push(issue("subjectMissing", { subjectId: row.subjectId, bindingId: row.bindingId, nodeId: row.nodeId }));
        }
    }

    const mediaCounts: Record<"image" | "video" | "audio", number> = { image: 0, video: 0, audio: 0 };
    for (const item of mediaItems) {
        if (!item.nodeId) continue;
        const node = boundNodes.get(item.nodeId);
        if (!node) {
            issues.push(issue("mediaMissing", { nodeId: item.nodeId }));
            continue;
        }
        const mediaType = item.kind as "image" | "video" | "audio";
        const order = mediaCounts[mediaType]++;
        const configured = configuredBindings.find((b) => b.nodeId === item.nodeId);
        const usage = configured?.usage || defaultUsage[mediaType];
        const subjectId = configured?.subjectId && subjects.some((s) => s.subjectId === configured.subjectId) ? configured.subjectId : undefined;

        if (!node.metadata?.assetId || !node.metadata?.contentVersion) {
            issues.push(issue("mediaIdentityMissing", { nodeId: node.id }));
        }
        if (!node.metadata?.storageKey) {
            issues.push(issue("mediaLocatorMissing", { nodeId: node.id }));
        }

        bindings.push({
            bindingId: configured?.bindingId || `binding:${node.id}`,
            subjectId,
            assetId: node.metadata?.assetId || node.id,
            nodeId: node.id,
            mediaType,
            usage,
            order,
            contentVersion: node.metadata?.contentVersion || "1",
            mimeType: node.metadata?.mimeType,
            mediaRef: {
                storageKey: node.metadata?.storageKey || "",
                fileId: node.metadata?.fileId,
            },
        });
    }

    const legacyAsText = new Set(sourceNode.metadata?.videoPromptPlainTextReferences || []);
    const unresolvedReferences: string[] = [];
    const includedTextNodeIds = new Set<string>();

    function expandSegment(text: string, expanding = new Set<string>()): string {
        const parsedRefs = parseVideoPromptReferences(text);
        let result = "";
        let segCursor = 0;
        for (const ref of parsedRefs) {
            result += text.slice(segCursor, ref.start);
            if (ref.kind === "node") {
                const item = inputList.find((i) => i.nodeId === ref.stableId);
                if (item) {
                    if (item.kind === "text") {
                        includedTextNodeIds.add(item.nodeId!);
                        const nodeText = item.text?.trim();
                        if (!nodeText) {
                            issues.push(issue("textEmpty", { nodeId: item.nodeId, message: `${item.name} 内容为空` }));
                            unresolvedReferences.push(ref.token);
                            result += ref.token;
                        } else if (expanding.has(item.nodeId!)) {
                            unresolvedReferences.push(ref.token);
                            issues.push(issue("textReferenceCycle", { nodeId: item.nodeId, message: "文本 " + item.name + " 存在循环引用" }));
                            result += ref.token;
                        } else {
                            result += expandSegment(nodeText, new Set([...expanding, item.nodeId!]));
                        }
                    } else if (item.h3Tag) {
                        result += item.h3Tag;
                    } else {
                        unresolvedReferences.push(ref.token);
                        result += ref.token;
                    }
                } else {
                    unresolvedReferences.push(ref.token);
                    result += ref.token;
                }
            } else if (ref.kind === "subject") {
                const item = inputList.find((i) => i.kind === "subject" && i.stableId === `subject:${ref.stableId}`);
                if (item?.h3Tag) {
                    result += item.h3Tag;
                } else {
                    unresolvedReferences.push(ref.token);
                    result += ref.token;
                }
            } else if (ref.kind === "binding") {
                const binding = configuredBindings.find((b) => b.bindingId === ref.stableId) || bindings.find((b) => b.bindingId === ref.stableId);
                const item = binding ? inputList.find((i) => i.nodeId === binding.nodeId) : undefined;
                if (item?.h3Tag) {
                    result += item.h3Tag;
                } else {
                    unresolvedReferences.push(ref.token);
                    result += ref.token;
                }
            } else {
                // Bare numbered tokens (like <Picture N> or picture_N) must be reviewed
                if (!legacyAsText.has(ref.token)) {
                    unresolvedReferences.push(ref.token);
                }
                result += ref.token;
            }
            segCursor = ref.end;
        }
        result += text.slice(segCursor);
        return result;
    }

    let compiledPrompt = expandSegment(normalizedPrompt);

    // 未显式引用的连入文本按清单顺序追加一次，并校验其内部引用
    const unreferencedTexts: string[] = [];
    for (const item of inputList) {
        if (item.kind === "text" && item.nodeId && !includedTextNodeIds.has(item.nodeId)) {
            const raw = item.text?.trim();
            if (raw) {
                includedTextNodeIds.add(item.nodeId);
                const expanded = expandSegment(raw, new Set([item.nodeId]));
                unreferencedTexts.push(`【${item.name}】\n${expanded}`);
            } else {
                issues.push(issue("textEmpty", { nodeId: item.nodeId, message: `${item.name} 内容为空` }));
            }
        }
    }
    if (unreferencedTexts.length) {
        compiledPrompt = `${compiledPrompt.trim()}\n\n${unreferencedTexts.join("\n\n")}`.trim();
    }

    // 官方 Guide 第 1 节：subject_definitions 位于提示词开头，聚合所有来源
    const subjectItems = inputList.filter((i) => i.kind === "subject");
    const subjectDefinitions: string[] = [];
    for (const s of subjectItems) {
        const subId = s.stableId.replace("subject:", "");
        const boundMediaItems = inputList.filter((m) =>
            (m.kind === "image" || m.kind === "video") &&
            configuredBindings.some((b) => b.subjectId === subId && b.nodeId === m.nodeId) &&
            m.h3Tag
        );
        if (boundMediaItems.length === 0) {
            issues.push(issue("subjectMissingSource", { subjectId: subId, message: `实体 ${s.name} 缺少有效输入来源素材` }));
            subjectDefinitions.push(`${s.h3Tag} is ${s.name}: ${s.text || ""}`.trim());
        } else {
            const sourceTags = boundMediaItems.map((m) => m.h3Tag).join(", ");
            const descPart = s.text ? `: ${s.text}` : "";
            subjectDefinitions.push(`${s.h3Tag} is ${s.name} from ${sourceTags}${descPart}`.trim());
        }
    }
    if (subjectDefinitions.length && !compiledPrompt.includes("subject_definitions:")) {
        compiledPrompt = `subject_definitions:\n${subjectDefinitions.join("\n")}\n\n${compiledPrompt}`.trim();
    }

    if (/@\[(node|subject|binding):[^\]]+\]/.test(compiledPrompt)) {
        issues.push(issue("unresolvedInternalToken", { message: "提示词中仍有未解析的内部引用标记" }));
    }

    if (unresolvedReferences.length) {
        issues.push(issue("referenceUnresolved", { message: `存在待核对的素材引用或裸编号: ${unresolvedReferences.join(", ")}` }));
    }

    const isH3Model = /h3/i.test(model);
    const isV2_15s = modelOptionName(model) === "minimax_h3_image_audio_to_video_v2_15s";

    if (isH3Model) {
        // AutoDL ComfyUI 工作流已接入官方提交与轮询协议；其余 H3 契约未核实，保持仅草稿预览。
        if (!isAutoDLWorkflow(model)) {
            issues.push(issue("contractUnverified", { message: "H3 接口契约未核实（prompt 结构、附件映射及调用方式待官方验证），当前仅支持草稿预览，禁止提交" }));
        }
        if (isV2_15s) {
            if (mediaItems.some((m) => m.kind === "video")) {
                issues.push(issue("unsupportedVideoMedia", { message: "当前工作流不支持视频输入，无可用字段" }));
            }
            const imageCount = mediaItems.filter((m) => m.kind === "image").length;
            if (imageCount > 9) {
                issues.push(issue("mediaCountExceeded", { message: `参考图片数量 ${imageCount} 超过上限 9` }));
            }
            const audioCount = mediaItems.filter((m) => m.kind === "audio").length;
            if (audioCount > 3) {
                issues.push(issue("mediaCountExceeded", { message: `参考音频数量 ${audioCount} 超过上限 3` }));
            }
        }
    }

    // 构造双区映射行
    const baseMapping: VideoInputMappingRow[] = inputList.map((item) => {
        if (!isH3Model) {
            if (item.kind === "image") {
                const field = params.mode === "frames" ? (item.number === 1 ? "first_frame" : item.number === 2 ? "last_frame" : "超出首尾帧") : "image[]";
                return {
                    tag: `图片 ${item.number}`,
                    name: item.name,
                    kind: "image",
                    nodeId: item.nodeId,
                    previewUrl: item.previewUrl,
                    workflowField: field,
                    status: field === "超出首尾帧" ? "error" : "valid",
                    statusText: field === "超出首尾帧" ? "超出首尾帧模式限制" : "正常映射",
                    source: item.name,
                };
            }
            if (item.kind === "video") {
                return {
                    tag: `视频 ${item.number}`,
                    name: item.name,
                    kind: "video",
                    nodeId: item.nodeId,
                    previewUrl: item.previewUrl,
                    workflowField: "videos",
                    status: "valid",
                    statusText: "正常映射",
                    source: item.name,
                };
            }
            if (item.kind === "audio") {
                return {
                    tag: `音频 ${item.number}`,
                    name: item.name,
                    kind: "audio",
                    nodeId: item.nodeId,
                    previewUrl: item.previewUrl,
                    workflowField: "audios",
                    status: "valid",
                    statusText: "正常映射",
                    source: item.name,
                };
            }
            if (item.kind === "subject") {
                return {
                    tag: `实体 ${item.number}`,
                    name: item.name,
                    kind: "subject",
                    nodeId: item.nodeId,
                    previewUrl: item.previewUrl,
                    workflowField: "提示词",
                    status: "valid",
                    statusText: "实体引用",
                    source: item.name,
                };
            }
            return {
                tag: `文本 ${item.number}`,
                name: item.name,
                kind: "text",
                nodeId: item.nodeId,
                workflowField: "提示词正文展开",
                status: "valid",
                statusText: "正文展开",
                source: item.name,
            };
        }

        if (isV2_15s) {
            if (item.kind === "image") {
                const hasError = item.number > 9;
                return {
                    tag: item.h3Tag || `<Picture ${item.number}>`,
                    name: item.name,
                    kind: "image",
                    nodeId: item.nodeId,
                    previewUrl: item.previewUrl,
                    workflowField: item.number <= 9 ? `ref_image_${item.number - 1} (拟定)` : "超出槽位 (上限 9)",
                    status: hasError ? "error" : "unverified",
                    statusText: hasError ? "超出槽位上限" : "拟定映射 / 未核实契约",
                    source: item.name,
                };
            }
            if (item.kind === "audio") {
                const hasError = item.number > 3;
                return {
                    tag: item.h3Tag || `<Audio ${item.number}>`,
                    name: item.name,
                    kind: "audio",
                    nodeId: item.nodeId,
                    previewUrl: item.previewUrl,
                    workflowField: item.number <= 3 ? `ref_audio_${item.number - 1} (拟定)` : "超出槽位 (上限 3)",
                    status: hasError ? "error" : "unverified",
                    statusText: hasError ? "超出槽位上限" : "拟定映射 / 未核实契约",
                    source: item.name,
                };
            }
            if (item.kind === "video") {
                return {
                    tag: item.h3Tag || `<Video ${item.number}>`,
                    name: item.name,
                    kind: "video",
                    nodeId: item.nodeId,
                    previewUrl: item.previewUrl,
                    workflowField: "无可用字段",
                    status: "unsupported",
                    statusText: "当前工作流无视频字段证据",
                    source: item.name,
                };
            }
            if (item.kind === "subject") {
                return {
                    tag: item.h3Tag || `<Subject ${item.number}>`,
                    name: item.name,
                    kind: "subject",
                    nodeId: item.nodeId,
                    previewUrl: item.previewUrl,
                    workflowField: "提示词实体定义区 (拟定)",
                    status: "unverified",
                    statusText: "拟定映射 / 未核实契约",
                    source: item.name,
                };
            }
            return {
                tag: `文本 ${item.number}`,
                name: item.name,
                kind: "text",
                nodeId: item.nodeId,
                workflowField: "提示词正文展开",
                status: "unverified",
                statusText: "拟定映射 / 未核实契约",
                source: item.name,
            };
        }

        return {
            tag: item.h3Tag || (item.kind === "text" ? `文本 ${item.number}` : `${item.kind} ${item.number}`),
            name: item.name,
            kind: item.kind,
            nodeId: item.nodeId,
            previewUrl: item.previewUrl,
            workflowField: "未核实字段 (工作流未单独核定)",
            status: "unverified",
            statusText: "未核实工作流契约",
            source: item.name,
        };
    });
    const bindingQueues = new Map<string, CanvasVideoInputBinding[]>();
    bindings.forEach((binding) => {
        const key = `${binding.mediaType}:${binding.nodeId}`;
        bindingQueues.set(key, [...(bindingQueues.get(key) || []), binding]);
    });
    const mapping = baseMapping.map((row) => {
        const node = row.nodeId ? boundNodes.get(row.nodeId) : undefined;
        const groupNode = node?.metadata?.groupId ? boundNodes.get(node.metadata.groupId) : undefined;
        const isMedia = row.kind === "image" || row.kind === "video" || row.kind === "audio";
        const binding = isMedia && row.nodeId ? bindingQueues.get(`${row.kind}:${row.nodeId}`)?.shift() : undefined;
        const matchingImage = binding?.mediaType === "image"
            ? node?.metadata?.images?.find((image) =>
                (binding.mediaRef.fileId && image.fileId === binding.mediaRef.fileId) ||
                (binding.mediaRef.storageKey && image.storageKey === binding.mediaRef.storageKey),
            )
            : undefined;
        const isBatchImage = binding?.mediaType === "image" && Boolean(node?.metadata?.images?.length);
        const originalFilename = (node?.metadata as Record<string, unknown> | undefined)?.originalFilename;
        const subjectName = binding?.subjectId ? subjects.find((subject) => subject.subjectId === binding.subjectId)?.name : undefined;
        return {
            ...row,
            ...(binding ? { bindingId: binding.bindingId } : {}),
            selectedImageId: matchingImage?.id,
            selectedImageIdUnknown: Boolean(isBatchImage && !matchingImage),
            originalFilename: binding && typeof originalFilename === "string" ? originalFilename : undefined,
            groupNodeId: groupNode?.id,
            groupTitle: groupNode?.title,
            subjectName: subjectName || (row.kind === "subject" ? row.name : undefined),
        };
    });

    const reachable = getGenerationResourceNodes(sourceNode.id, nodes, connections);
    const groupIds = new Set(reachable.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id));
    const selectedGroupMemberIds = new Set(bindings.map((b) => b.nodeId));
    const groupMembers: CanvasVideoGroupSnapshot[] = [...groupIds].sort().map((groupId) => ({
        groupId,
        memberNodeIds: nodes.filter((node) => node.metadata?.groupId === groupId && selectedGroupMemberIds.has(node.id)).map((node) => node.id),
    }));

    if (!resolved && bindings.length) issues.push(issue("adapterUnsupported"));
    const adapterId = resolved?.adapter.adapterId || (bindings.length ? undefined : textOnlyAdapter.adapterId);

    const candidate: CanvasVideoInputCandidate = {
        sourceNodeId: sourceNode.id,
        prompt: normalizedPrompt,
        compiledPrompt,
        model,
        adapterId,
        adapterConfigFingerprint: getVideoAdapterConfigFingerprint(config, model),
        params,
        groupMembers,
        bindings: sortBindings(bindings),
        unresolvedReferences,
        issues,
        mapping,
        fingerprint: "",
    };

    if (!candidate.compiledPrompt.trim()) candidate.issues.push(issue("promptRequired"));
    if (resolved) candidate.issues.push(...resolved.adapter.validate(candidate, resolved.capabilities));
    else if (!bindings.length) candidate.issues.push(...textOnlyAdapter.validate(candidate, { adapterId: "script-video-v1", media: {} }));

    candidate.fingerprint = serializeVideoInputFingerprint(candidate);
    return candidate;
}

export function serializeVideoInputFingerprint(candidate: CanvasVideoInputCandidate) {
    return JSON.stringify({
        sourceNodeId: candidate.sourceNodeId,
        prompt: candidate.prompt,
        compiledPrompt: candidate.compiledPrompt,
        model: candidate.model,
        adapterId: candidate.adapterId || "",
        adapterConfigFingerprint: candidate.adapterConfigFingerprint,
        params: candidate.params,
        groupMembers: candidate.groupMembers,
        bindings: candidate.bindings.map(({ bindingId, subjectId, assetId, nodeId, mediaType, usage, order, contentVersion, mimeType, mediaRef }) => ({
            bindingId,
            subjectId: subjectId || "",
            assetId,
            nodeId,
            mediaType,
            usage,
            order,
            contentVersion,
            mimeType: mimeType || "",
            mediaRef,
        })),
        unresolvedReferences: candidate.unresolvedReferences,
    });
}

export function compileVideoInput(candidate: CanvasVideoInputCandidate, adapter: CanvasVideoInputAdapter): CompiledVideoInput {
    const bindings = sortBindings(candidate.bindings);
    const snapshot: CanvasVideoInputSnapshot = {
        schemaVersion: 1,
        snapshotId: nanoid(),
        sourceNodeId: candidate.sourceNodeId,
        adapterId: adapter.adapterId,
        adapterConfigFingerprint: candidate.adapterConfigFingerprint,
        model: candidate.model,
        prompt: candidate.compiledPrompt,
        params: { ...candidate.params },
        groupMembers: candidate.groupMembers.map((group) => ({ ...group, memberNodeIds: [...group.memberNodeIds] })),
        bindings: bindings.map((binding) => ({ ...binding, mediaRef: { ...binding.mediaRef } })),
        mapping: candidate.mapping,
        issues: candidate.issues,
        fingerprint: candidate.fingerprint,
    };
    const images: ReferenceImage[] = bindings
        .filter((binding) => binding.mediaType === "image")
        .map((binding, index) => ({
            id: binding.nodeId,
            name: `Picture ${index + 1}`,
            type: "image/png",
            dataUrl: "",
            storageKey: binding.mediaRef.storageKey,
            fileId: binding.mediaRef.fileId,
        }));
    const videos: ReferenceVideo[] = bindings
        .filter((binding) => binding.mediaType === "video")
        .map((binding, index) => ({
            id: binding.nodeId,
            name: `Video ${index + 1}`,
            type: binding.mimeType || "video/mp4",
            url: "",
            storageKey: binding.mediaRef.storageKey,
        }));
    const audios: ReferenceAudio[] = bindings
        .filter((binding) => binding.mediaType === "audio")
        .map((binding, index) => ({
            id: binding.nodeId,
            name: `Audio ${index + 1}`,
            type: binding.mimeType || "audio/mpeg",
            url: "",
            storageKey: binding.mediaRef.storageKey,
        }));
    return {
        snapshot,
        prompt: candidate.compiledPrompt,
        images,
        videos,
        audios,
        params: { ...candidate.params },
        bindings,
        mapping: candidate.mapping || [],
        issues: candidate.issues || [],
    };
}

export function compiledVideoInputFromSnapshot(snapshot: CanvasVideoInputSnapshot): CompiledVideoInput {
    const bindings = sortBindings(snapshot.bindings);
    const images: ReferenceImage[] = bindings
        .filter((binding) => binding.mediaType === "image")
        .map((binding, index) => ({
            id: binding.nodeId,
            name: `Picture ${index + 1}`,
            type: "image/png",
            dataUrl: "",
            storageKey: binding.mediaRef.storageKey,
            fileId: binding.mediaRef.fileId,
        }));
    const videos: ReferenceVideo[] = bindings
        .filter((binding) => binding.mediaType === "video")
        .map((binding, index) => ({
            id: binding.nodeId,
            name: `Video ${index + 1}`,
            type: "video/mp4",
            url: "",
            storageKey: binding.mediaRef.storageKey,
        }));
    const audios: ReferenceAudio[] = bindings
        .filter((binding) => binding.mediaType === "audio")
        .map((binding, index) => ({
            id: binding.nodeId,
            name: `Audio ${index + 1}`,
            type: "audio/mpeg",
            url: "",
            storageKey: binding.mediaRef.storageKey,
        }));

    return {
        snapshot,
        prompt: snapshot.prompt,
        params: { ...snapshot.params },
        bindings,
        images,
        videos,
        audios,
        mapping: snapshot.mapping || [],
        issues: snapshot.issues || [],
    };
}

export function createBindingId() {
    return nanoid();
}

function createAdapter(adapterId: CanvasVideoInputAdapter["adapterId"], provider: "openai" | "gemini" | "script"): CanvasVideoInputAdapter {
    return {
        adapterId,
        validate(candidate, capabilities) {
            const issues: VideoInputIssue[] = [];
            candidate.bindings.forEach((binding) => {
                const media = capabilities.media[binding.mediaType];
                if (!media || !media.usages.includes(binding.usage)) {
                    issues.push(issue("usageUnsupported", { bindingId: binding.bindingId, subjectId: binding.subjectId, nodeId: binding.nodeId }));
                }
                if ((provider === "openai" || provider === "gemini") && candidate.params.mode === "reference" && (binding.usage === "first_frame" || binding.usage === "last_frame")) {
                    issues.push(issue("usageUnsupported", { bindingId: binding.bindingId, subjectId: binding.subjectId, nodeId: binding.nodeId }));
                }
            });
            mediaTypes.forEach((type) => {
                const sameTypeBindings = candidate.bindings.filter((binding) => binding.mediaType === type);
                const count = sameTypeBindings.length;
                const capability = capabilities.media[type];
                if (count && capability && !capability.maxCount) issues.push(issue("capabilityIncomplete"));
                else if (count && capability && count > capability.maxCount) {
                    issues.push(
                        issue("mediaCountExceeded", {
                            message: i18n.t("canvas.videoInput.issues.mediaCountExceeded", {
                                mediaType: i18n.t(`config.channelEditor.mediaTypes.${type}`),
                                count,
                                max: capability.maxCount,
                            }),
                        }),
                    );
                }
            });
            return issues;
        },
        compile: (candidate) => compileVideoInput(candidate, adapters[adapterId]),
    };
}

function issue(code: string, details: Partial<VideoInputIssue> = {}): VideoInputIssue {
    return { code, message: details.message || i18n.t(`canvas.videoInput.issues.${code}`), ...details };
}
