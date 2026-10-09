import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { Button, Image, Modal } from "antd";
import { FileText, Group, Image as ImageIcon, Music2, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { NodeGenerationInput } from "./canvas-node-generation";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";
import { buildNodeConfig } from "./canvas-config-node-panel";
import { buildVideoInputCandidate } from "@/lib/canvas/canvas-video-inputs";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasPromptChipInput, type CanvasPromptChipInputRef } from "./canvas-prompt-chip-input";
import { buildVideoInputList } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData, type CanvasSubject, type CanvasVideoBinding, type VideoInputItem } from "@/types/canvas";

type CanvasConfigComposerProps = {
    nodeId: string;
    nodes: CanvasNodeData[];
    subjects?: CanvasSubject[];
    videoBindings?: CanvasVideoBinding[];
    value: string;
    inputs: NodeGenerationInput[];
    connectedNodes?: CanvasNodeData[];
    connections?: CanvasConnection[];
    generationMode?: CanvasGenerationMode;
    onChange: (value: string) => void;
    onClose: () => void;
    onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
    onStartReferenceSelection?: (nodeId: string) => void;
    onReferenceOrderChange?: (stableIds: string[]) => void;
};

type Token =
    | { type: "text"; value: string }
    | { type: "reference"; nodeId: string }
    | { type: "stable"; token: string; label: string; isError?: boolean };

type MentionState = {
    query: string;
};

export const CONFIG_REFERENCE_PATTERN = /@\[node:([^\]]+)\]/g;

export function CanvasConfigComposer({
    nodeId,
    nodes,
    subjects = [],
    videoBindings = [],
    value,
    inputs,
    connectedNodes = [],
    connections = [],
    generationMode,
    onChange,
    onClose,
    onDisconnectReference,
    onStartReferenceSelection,
    onReferenceOrderChange,
}: CanvasConfigComposerProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const editorRef = useRef<HTMLDivElement>(null);
    const chipInputRef = useRef<CanvasPromptChipInputRef>(null);
    const composingRef = useRef(false);
    const lastRangeRef = useRef<Range | null>(null);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [resultCollapsed, setResultCollapsed] = useState(false);
    const [resultExpanded, setResultExpanded] = useState(false);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const sourceNode = useMemo(
        () => nodes.find((n) => n.id === nodeId) || ({ id: nodeId, type: CanvasNodeType.Config, metadata: { generationMode, videoBindings } } as CanvasNodeData),
        [generationMode, nodeId, nodes, videoBindings]
    );
    const effectiveMode = generationMode || sourceNode.metadata?.generationMode || "image";
    const isVideoMode = effectiveMode === "video";
    const globalConfig = useEffectiveConfig();
    const candidate = useMemo(() => isVideoMode ? buildVideoInputCandidate({ sourceNode, nodes, connections, subjects, config: buildNodeConfig(globalConfig, sourceNode, effectiveMode), prompt: value }) : null, [isVideoMode, sourceNode, nodes, connections, subjects, globalConfig, effectiveMode, value]);

    const videoInputList = useMemo(() => {
        if (!isVideoMode) return [];
        return buildVideoInputList(sourceNode, nodes, connections, subjects, value, sourceNode.metadata?.model);
    }, [connections, isVideoMode, nodes, sourceNode, subjects, value]);

    const nonVideoInputList: VideoInputItem[] = useMemo(() => {
        if (isVideoMode) return [];
        return inputs.map((inp, idx) => ({
            kind: inp.type === "group" ? "image" : inp.type,
            stableId: `node:${inp.nodeId}`,
            nodeId: inp.nodeId,
            name: inp.title || `Resource ${idx + 1}`,
            number: idx + 1,
            referenced: value.includes(`@[node:${inp.nodeId}]`),
            previewUrl: inp.type === "image" ? inp.image?.url : inp.type === "video" ? inp.video?.url : undefined,
            text: inp.type === "text" ? inp.text : undefined,
        }));
    }, [inputs, isVideoMode, value]);

    const activeInputList = isVideoMode ? videoInputList : nonVideoInputList;

    const stableReferences = useMemo(() => [
        ...subjects.map((subject) => ({ token: `@[subject:${subject.subjectId}]`, label: `Subject: ${subject.name}` })),
        ...videoBindings.map((binding) => ({ token: `@[binding:${binding.bindingId}]`, label: `Binding: ${nodeById.get(binding.nodeId)?.title || binding.nodeId} · ${i18n.t(`canvas.videoInput.usages.${binding.usage}`)}` })),
    ], [nodeById, subjects, videoBindings]);
    const tokens = useMemo(() => parseComposerTokens(value, stableReferences), [stableReferences, value]);
    const referenceById = useMemo(() => new Map(inputs.map((input) => [input.nodeId, input])), [inputs]);
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = (mention.query || "").trim().toLowerCase();
        if (!query) return inputs;
        return inputs.filter((input) => `${resourceLabel(input, inputs)} ${input.title} ${input.type === "group" ? "" : input.text || ""}`.toLowerCase().includes(query));
    }, [inputs, mention]);

    useEffect(() => {
        if (document.activeElement === editorRef.current) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.textContent = "";
        tokens.forEach((token) => {
            if (token.type === "text") {
                editor.append(document.createTextNode(token.value));
                return;
            }
            if (token.type === "stable") {
                editor.append(createStableTokenChip(token.token, token.label, theme));
                return;
            }
            const input = referenceById.get(token.nodeId);
            if (input) editor.append(createReferenceChip(input, inputs, theme, setImagePreview));
        });
    }, [inputs, referenceById, theme, tokens]);

    
    const saveSelection = () => {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && editorRef.current) {
            const range = selection.getRangeAt(0);
            if (editorRef.current.contains(range.startContainer)) {
                lastRangeRef.current = range.cloneRange();
            }
        }
    };

    const syncFromEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        const next = serializeEditor(editor);
        onChange(next);
        syncMention();
    };

    const syncMention = () => {
        const text = textBeforeCaret();
        const match = /@([^\s@]*)$/.exec(text);
        if (!match || !inputs.length) {
            closeMention();
            return;
        }
        setMention({ query: match[1] || "" });
        setActiveIndex(0);
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const insertReference = (input: NodeGenerationInput) => {
        const editor = editorRef.current;
        if (!editor) return;
        removeActiveMention();
        const chip = createReferenceChip(input, inputs, theme, setImagePreview);
        const space = document.createTextNode(" ");
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (range) {
            range.insertNode(space);
            range.insertNode(chip);
            range.setStartAfter(space);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
        } else {
            editor.append(chip, space);
            placeCaretAtEnd(editor);
        }
        closeMention();
        onChange(serializeEditor(editor));
    };

    const insertStableReference = (token: string, customLabel?: string) => {
        const reference = stableReferences.find((item) => item.token === token) || { token, label: customLabel || token };
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        const chip = createStableTokenChip(reference.token, reference.label, theme);
        const space = document.createTextNode(" ");
        let range = lastRangeRef.current;
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).startContainer)) {
            range = selection.getRangeAt(0);
        }
        if (range && editor.contains(range.startContainer)) {
            range.deleteContents();
            range.insertNode(space);
            range.insertNode(chip);
            range.setStartAfter(space);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
            lastRangeRef.current = range.cloneRange();
        } else {
            editor.append(chip, space);
            placeCaretAtEnd(editor);
            saveSelection();
        }
        onChange(serializeEditor(editor));
    };

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => event.stopPropagation();

    return (
        <div
            data-canvas-no-zoom
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={stopCanvasInteraction}
            onPointerDown={stopCanvasInteraction}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-2">
                    <div className="shrink-0 text-xs font-semibold">{t("canvas.composer.title")}</div>
                    <div className="truncate text-[11px] opacity-55">{t("canvas.composer.description")}</div>
                </div>
                <Button size="small" type="text" className="!h-7 !w-7 !min-w-7 !p-0" icon={<X className="size-3.5" />} onClick={onClose} />
            </div>
            <CanvasNodeReferenceBar
                nodeId={nodeId}
                nodes={nodes}
                connectedNodes={connectedNodes}
                videoBindings={videoBindings}
                subjects={subjects}
                inputList={activeInputList}
                onDisconnect={onDisconnectReference}
                onStartSelection={onStartReferenceSelection}
                onOrderChange={onReferenceOrderChange}
                onInsertReference={(item) => {
                    if (isVideoMode) {
                        chipInputRef.current?.insertReference(item);
                    } else {
                        const input = referenceById.get(item.nodeId || "");
                        if (input) {
                            insertReference(input);
                        } else {
                            insertStableReference(item.stableId, item.name);
                        }
                    }
                }}
            />
            <div className="mb-1 text-xs font-semibold">编辑当前提示词</div>
            {isVideoMode ? (
                <div className="relative rounded-xl border p-2" style={{ borderColor: theme.toolbar.border }}>
                    <CanvasPromptChipInput
                        ref={chipInputRef}
                        value={value}
                        references={videoInputList}
                        onChange={onChange}
                        placeholder={t("canvas.composer.placeholder")}
                        className="thin-scrollbar min-h-28 max-h-72 w-full overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-1 py-1 text-sm leading-7 outline-none"
                        style={{ color: theme.node.text }}
                    />
                </div>
            ) : (
                <div className="relative rounded-xl">
                {!value.trim() ? <div className="pointer-events-none absolute left-3 top-2 text-sm leading-7" style={{ color: theme.node.placeholder }}>{t("canvas.composer.placeholder")}</div> : null}
                <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    className="thin-scrollbar min-h-28 max-h-72 w-full overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-3 py-2 text-sm leading-7 outline-none"
                    style={{ color: theme.node.text }}
                    onClick={saveSelection}
                    onKeyUp={saveSelection}
                    onInput={() => {
                        if (!composingRef.current) syncFromEditor();
                    }}
                    onCompositionStart={() => {
                        composingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                        composingRef.current = false;
                        syncFromEditor();
                    }}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                        event.stopPropagation();
                        if (mention && candidates.length) {
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setActiveIndex((index) => (index + 1) % candidates.length);
                                return;
                            }
                            if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                                return;
                            }
                            if (event.key === "Enter") {
                                event.preventDefault();
                                insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                                return;
                            }
                            if (event.key === "Escape") {
                                event.preventDefault();
                                closeMention();
                                return;
                            }
                        }
                        if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentReference(event.key)) {
                            event.preventDefault();
                            requestAnimationFrame(syncFromEditor);
                            return;
                        }
                        requestAnimationFrame(syncMention);
                    }}
                    onBlur={() => window.setTimeout(closeMention, 120)}
                />
                {mention && candidates.length ? <MentionMenu inputs={candidates} allInputs={inputs} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null}
            </div>
            )}
            {candidate ? (
                <section className="mt-3 rounded-xl border p-3" style={{ borderColor: theme.toolbar.border }} aria-label="最终发送内容">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold">最终发送内容 · 只读</span>
                        <div className="flex gap-2"><Button size="small" onClick={() => setResultCollapsed(!resultCollapsed)}>{resultCollapsed ? "展开" : "折叠"}</Button><Button size="small" onClick={() => setResultExpanded(true)}>放大</Button></div>
                    </div>
                    <div className="mb-2 text-xs opacity-70">已连接：{videoInputList.length} 项 · 本次发送：图片 {candidate.bindings.filter(item => item.mediaType === "image").length} / 视频 {candidate.bindings.filter(item => item.mediaType === "video").length} / 音频 {candidate.bindings.filter(item => item.mediaType === "audio").length} · 文本 {videoInputList.filter(item => item.kind === "text" && item.text?.trim()).length} · 实体 {new Set(candidate.bindings.map(item => item.subjectId).filter(Boolean)).size}</div>
                    <div className="mb-2 text-xs opacity-70">来源：当前提示词{videoInputList.filter(item => item.kind === "text" && item.text?.trim()).map(item => ` + ${item.name}`).join("")}。编辑上方不会覆盖源文本。</div>
                    {!resultCollapsed ? <div className="thin-scrollbar max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">{renderFinalPrompt(candidate.compiledPrompt, candidate.unresolvedReferences)}</div> : null}
                    <div className={`mt-2 text-xs ${candidate.issues.length ? "text-red-500" : "opacity-70"}`}>{candidate.issues.length ? `有 ${candidate.issues.length} 项问题，修正后再确认` : sourceNode.metadata?.confirmedVideoInput?.fingerprint === candidate.fingerprint ? "检查通过 · 输入已确认" : "检查通过 · 待确认"}</div>
                    {candidate.issues.map((issue, index) => <div key={`${issue.code}-${index}`} className="mt-2 text-xs text-red-500">{issue.message}</div>)}
                    {candidate.unresolvedReferences.length ? <Button size="small" className="mt-2" onClick={() => onStartReferenceSelection?.(nodeId)} disabled={!onStartReferenceSelection}>选择资源修正引用</Button> : null}
                </section>
            ) : null}
            <Modal title="最终发送内容 · 只读" open={resultExpanded} onCancel={() => setResultExpanded(false)} footer={null} width={760}>
                <div className="max-h-[65vh] overflow-y-auto whitespace-pre-wrap break-words">{candidate ? renderFinalPrompt(candidate.compiledPrompt, candidate.unresolvedReferences) : null}</div>
                {candidate?.issues.map((issue, index) => <div key={index} className="mt-2 text-red-500">{issue.message}</div>)}
            </Modal>
            {imagePreview ? <Image src={imagePreview} alt={t("canvas.composer.imagePreview")} style={{ display: "none" }} preview={{ visible: true, src: imagePreview, onVisibleChange: (visible) => !visible && setImagePreview(null) }} /> : null}
        </div>
    );

}

function MentionMenu({ inputs, allInputs, activeIndex, theme, onSelect }: { inputs: NodeGenerationInput[]; allInputs: NodeGenerationInput[]; activeIndex: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelect: (input: NodeGenerationInput) => void }) {
    const selectedRef = useRef(false);
    const activeItemRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, inputs]);

    const selectInput = (input: NodeGenerationInput) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(input);
    };

    return (
        <div className="absolute left-2 top-[calc(100%+6px)] z-[90] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
            {inputs.map((input, index) => (
                <button
                    key={input.nodeId}
                    ref={index === activeIndex ? activeItemRef : undefined}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                    style={{ background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectInput(input);
                    }}
                >
                    <ResourcePreview input={input} />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{resourceLabel(input, allInputs)}</span>
                        <span className="block truncate opacity-65">{input.type === "group" ? i18n.t("canvas.node.nodeCount", { count: input.children.length }) : input.text || input.title}</span>
                    </span>
                </button>
            ))}
        </div>
    );
}

function ResourcePreview({ input }: { input: NodeGenerationInput }) {
    if (input.type === "group") return <span className="grid size-9 shrink-0 place-items-center"><Group className="size-4" /></span>;
    if (input.type === "image" && input.image) return <img src={input.image.dataUrl} alt="" className="size-9 rounded-md object-cover" />;
    if (input.type === "video" && input.video) return <video src={input.video.url} className="size-9 rounded-md bg-black object-cover" muted preload="metadata" />;
    const Icon = input.type === "audio" ? Music2 : input.type === "video" ? Video : input.type === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function createReferenceChip(input: NodeGenerationInput, inputs: NodeGenerationInput[], theme: (typeof canvasThemes)[keyof typeof canvasThemes], onImagePreview: (url: string) => void) {
    const wrapper = document.createElement("span");
    wrapper.contentEditable = "false";
    wrapper.dataset.referenceNodeId = input.nodeId;
    wrapper.className = "mx-px inline-flex h-7 max-w-40 items-center justify-center overflow-hidden rounded-md border px-1 text-xs leading-none align-middle";
    Object.assign(wrapper.style, chipStyle(theme));
    if (input.type === "image" && input.image) {
        const image = document.createElement("img");
        image.src = input.image.dataUrl;
        image.alt = input.title;
        image.className = "size-6 rounded object-cover";
        wrapper.className = "mx-px inline-flex size-6 items-center justify-center overflow-hidden rounded align-middle";
        wrapper.appendChild(image);
        wrapper.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onImagePreview(input.image?.dataUrl || "");
        });
    } else {
        wrapper.title = input.type === "group" ? input.title : input.text || input.title;
        const text = document.createElement("span");
        text.className = "block truncate";
        text.textContent = input.type === "text" ? input.text || input.title : input.title;
        wrapper.appendChild(text);
    }
    return wrapper;
}

function serializeEditor(editor: HTMLElement) {
    return serializeNodes(editor.childNodes).replace(/\uFEFF/g, "");
}

function serializeNodes(nodes: NodeListOf<ChildNode>) {
    let result = "";
    nodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) result += node.textContent || "";
        if (!(node instanceof HTMLElement)) return;
        const nodeId = node.dataset.referenceNodeId;
        const token = node.dataset.referenceToken;
        if (token) result += token;
        else if (nodeId) result += `@[node:${nodeId}]`;
        else if (node.tagName === "BR") result += "\n";
        else result += serializeNodes(node.childNodes);
    });
    return result;
}

function removeActiveMention() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const text = textBeforeCaret();
    const match = /@([^\s@]*)$/.exec(text);
    if (!match) return;
    range.setStart(range.startContainer, Math.max(0, range.startOffset - (match[1] || "").length - 1));
    range.deleteContents();
}

function deleteAdjacentReference(key: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const target = adjacentReferenceNode(range, key);
    if (!target) return false;
    const nextCaretNode = document.createTextNode("");
    target.replaceWith(nextCaretNode);
    range.setStart(nextCaretNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function adjacentReferenceNode(range: Range, key: string) {
    const container = range.startContainer;
    const offset = range.startOffset;
    const previous = key === "Backspace";
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        if ((previous && offset > 0) || (!previous && offset < text.length)) return null;
        return findReferenceSibling(container, previous);
    }
    const children = Array.from(container.childNodes);
    return findReferenceSibling(children[previous ? offset - 1 : offset] || container, previous, true);
}

function findReferenceSibling(node: Node, previous: boolean, includeSelf = false): HTMLElement | null {
    let current: Node | null = includeSelf ? node : previous ? node.previousSibling : node.nextSibling;
    while (current && current.nodeType === Node.TEXT_NODE && !(current.textContent || "").trim()) current = previous ? current.previousSibling : current.nextSibling;
    return current instanceof HTMLElement && (current.dataset.referenceNodeId || current.dataset.referenceToken) ? current : null;
}

function textBeforeCaret() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return "";
    const range = selection.getRangeAt(0).cloneRange();
    const editor = closestEditor(range.startContainer);
    if (!editor) return "";
    range.setStart(editor, 0);
    return range.toString();
}

function closestEditor(node: Node) {
    const element = node instanceof Element ? node : node.parentElement;
    return element?.closest("[contenteditable='true']") || null;
}

function placeCaretAtEnd(element: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function parseComposerTokens(value: string, stableReferences: Array<{ token: string; label: string }>): Token[] {
    const tokens: Token[] = [];
    let lastIndex = 0;
    const stableByToken = new Map(stableReferences.map((reference) => [reference.token, reference]));
    const pattern = /@\[(node|subject|binding):([^\]]+)\]/g;
    for (const match of value.matchAll(pattern)) {
        if (match.index === undefined) continue;
        if (match.index > lastIndex) tokens.push({ type: "text", value: value.slice(lastIndex, match.index) });
        if (match[1] === "node") tokens.push({ type: "reference", nodeId: match[2] });
        else {
            const reference = stableByToken.get(match[0]);
            if (reference) tokens.push({ type: "stable", token: reference.token, label: reference.label });
            else tokens.push({ type: "text", value: match[0] });
        }
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < value.length) tokens.push({ type: "text", value: value.slice(lastIndex) });
    return tokens;
}

function createStableTokenChip(token: string, label: string, theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    const wrapper = document.createElement("span");
    wrapper.contentEditable = "false";
    wrapper.dataset.referenceToken = token;
    wrapper.className = "mx-px inline-flex h-7 max-w-48 items-center justify-center overflow-hidden rounded-md border px-1.5 text-xs leading-none align-middle";
    Object.assign(wrapper.style, chipStyle(theme));
    wrapper.title = token;
    const text = document.createElement("span");
    text.className = "block truncate";
    text.textContent = label;
    wrapper.appendChild(text);
    return wrapper;
}

function resourceLabel(input: NodeGenerationInput, inputs: NodeGenerationInput[]) {
    const sameTypeInputs = inputs.filter((item) => item.type === input.type);
    const index = Math.max(0, sameTypeInputs.findIndex((item) => item.nodeId === input.nodeId));
    return i18n.t(`canvas.composer.resources.${input.type}`, { index: index + 1 });
}

function chipStyle(theme: (typeof canvasThemes)[keyof typeof canvasThemes]): CSSProperties {
    return { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text };
}

function renderFinalPrompt(prompt: string, unresolved: string[]) {
    if (!prompt.trim()) return "暂无发送内容";
    const refs = [...new Set(unresolved)].filter(Boolean).sort((a, b) => b.length - a.length);
    if (!refs.length) return prompt;
    const pattern = new RegExp(`(${refs.map(ref => ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
    return prompt.split(pattern).map((part, index) => refs.includes(part) ? <mark key={index} className="rounded bg-red-500/15 px-1 text-red-500" title="引用未解析，请检查绑定">{part}</mark> : part);
}
