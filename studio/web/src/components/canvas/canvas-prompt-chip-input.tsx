import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Image } from "antd";
import { AlertCircle, FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { VideoInputItem } from "@/types/canvas";

export type CanvasPromptChipInputRef = {
    insertReference: (reference: CanvasResourceReference | VideoInputItem) => void;
    focus: () => void;
};

type Props = {
    value: string;
    references: (CanvasResourceReference | VideoInputItem)[];
    onChange: (value: string) => void;
    onSubmit?: () => void;
    className?: string;
    style?: CSSProperties;
    placeholder?: string;
};

type MentionState = {
    query: string;
    rect: DOMRect | null;
};

type Token =
    | { type: "text"; value: string }
    | { type: "reference"; label: string; serializedValue: string; isError?: boolean };

// Prompt-panel contentEditable input: @ references embed thumbnail chips instead of plain label text.
// Serialization converts chips back to reference tokens/labels.
export const CanvasPromptChipInput = forwardRef<CanvasPromptChipInputRef, Props>(function CanvasPromptChipInput(
    { value, references, onChange, onSubmit, className, style, placeholder },
    ref,
) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const editorRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    const lastEmittedRef = useRef(value);
    const lastRangeRef = useRef<Range | null>(null);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [imagePreview, setImagePreview] = useState<string | null>(null);

    // Normalize references to a unified list with stable tokens
    const activeReferences = useMemo(() => {
        return references.filter((item) => "number" in item || item.active).map((item) => {
            if ("kind" in item && "number" in item) {
                // VideoInputItem
                const vItem = item as VideoInputItem;
                const token = `@[${vItem.stableId}]`;
                const label = vItem.h3Tag ? `${vItem.h3Tag} · ${vItem.name}` : `文本 ${vItem.number} · ${vItem.name}`;
                return {
                    id: vItem.stableId,
                    nodeId: vItem.nodeId || "",
                    kind: vItem.kind as CanvasResourceReference["kind"],
                    label,
                    title: vItem.name,
                    previewUrl: vItem.previewUrl,
                    text: vItem.text,
                    token,
                    h3Tag: vItem.h3Tag,
                    active: true,
                };
            }
            const cRef = item as CanvasResourceReference;
            return {
                id: cRef.id,
                nodeId: cRef.nodeId,
                kind: cRef.kind,
                label: cRef.label,
                title: cRef.title,
                previewUrl: cRef.previewUrl,
                text: cRef.text,
                token: cRef.token || cRef.label,
                h3Tag: undefined as string | undefined,
                active: cRef.active,
            };
        });
    }, [references]);

    const referenceByToken = useMemo(() => {
        const map = new Map<string, (typeof activeReferences)[number]>();
        activeReferences.forEach((r) => {
            if (r.token) map.set(r.token, r);
            map.set(r.label, r);
        });
        return map;
    }, [activeReferences]);

    const tokens = useMemo(() => parseTokens(value, activeReferences), [value, activeReferences]);

    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        if (!query) return activeReferences;
        return activeReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query));
    }, [mention, activeReferences]);

    const saveSelection = () => {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && editorRef.current) {
            const range = selection.getRangeAt(0);
            if (editorRef.current.contains(range.startContainer)) {
                lastRangeRef.current = range.cloneRange();
            }
        }
    };

    // Rebuild or in-place update the DOM from value
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        // When editor is focused, update chips in-place without resetting user's typing caret
        if (document.activeElement === editor) {
            const chips = editor.querySelectorAll<HTMLElement>("[data-ref-token]");
            chips.forEach((chip) => {
                const token = chip.dataset.refToken;
                if (!token) return;
                const ref = referenceByToken.get(token);
                if (ref) {
                    const textSpan = chip.querySelector<HTMLElement>(".block");
                    if (textSpan) {
                        textSpan.textContent = ref.h3Tag ? `${ref.h3Tag} ${ref.title}` : ref.label;
                    }
                    chip.title = ref.text || ref.title;
                    if (chip.dataset.refError === "true") {
                        delete chip.dataset.refError;
                        chip.className = "mx-px inline-flex h-6 max-w-48 items-center gap-1 justify-center overflow-hidden rounded-md border px-1.5 text-xs leading-none align-middle";
                        Object.assign(chip.style, { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text });
                    }
                } else {
                    chip.dataset.refError = "true";
                    chip.className = "mx-px inline-flex h-6 max-w-48 items-center gap-1 justify-center overflow-hidden rounded-md border border-red-500/60 bg-red-500/10 px-1.5 text-xs leading-none align-middle text-red-500";
                    chip.title = `待核对或已断开的引用标记: ${token}`;
                }
            });
            if (value === lastEmittedRef.current) return;
        }

        editor.textContent = "";
        tokens.forEach((token) => {
            if (token.type === "text") {
                editor.append(document.createTextNode(token.value));
                return;
            }
            if (token.isError) {
                editor.append(createErrorChip(token.serializedValue, theme));
                return;
            }
            const reference = referenceByToken.get(token.serializedValue) || referenceByToken.get(token.label);
            if (reference) {
                editor.append(createReferenceChip(reference, theme, setImagePreview));
            } else {
                editor.append(createErrorChip(token.serializedValue, theme));
            }
        });
        lastEmittedRef.current = value;
    }, [tokens, referenceByToken, theme, value]);

    const emit = (next: string) => {
        lastEmittedRef.current = next;
        onChange(next);
    };

    const syncFromEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        emit(serializeEditor(editor));
        syncMention();
        saveSelection();
    };

    const syncMention = () => {
        const text = textBeforeCaret();
        const match = /@([^\s@]*)$/.exec(text);
        if (!match || !activeReferences.length) {
            closeMention();
            return;
        }
        setMention({ query: match[1] || "", rect: caretRect() });
        setActiveIndex(0);
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const insertReference = (item: CanvasResourceReference | VideoInputItem) => {
        if ("number" in item && item.disabled) return;
        const editor = editorRef.current;
        if (!editor) return;
        removeActiveMention();

        // Convert item to reference representation
        let refObj: (typeof activeReferences)[number];
        if ("kind" in item && "number" in item) {
            const vItem = item as VideoInputItem;
            const token = `@[${vItem.stableId}]`;
            const label = vItem.h3Tag ? `${vItem.h3Tag} · ${vItem.name}` : `文本 ${vItem.number} · ${vItem.name}`;
            refObj = {
                id: vItem.stableId,
                nodeId: vItem.nodeId || "",
                kind: vItem.kind as CanvasResourceReference["kind"],
                label,
                title: vItem.name,
                previewUrl: vItem.previewUrl,
                text: vItem.text,
                token,
                h3Tag: vItem.h3Tag,
                active: true,
            };
        } else {
            const cRef = item as CanvasResourceReference;
            refObj = {
                id: cRef.id,
                nodeId: cRef.nodeId,
                kind: cRef.kind,
                label: cRef.label,
                title: cRef.title,
                previewUrl: cRef.previewUrl,
                text: cRef.text,
                token: cRef.token || cRef.label,
                h3Tag: undefined,
                active: cRef.active,
            };
        }

        editor.focus();
        const chip = createReferenceChip(refObj, theme, setImagePreview);
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
        closeMention();
        emit(serializeEditor(editor));
    };

    useImperativeHandle(ref, () => ({
        insertReference,
        focus: () => {
            editorRef.current?.focus();
        },
    }));

    const showPlaceholder = !value.trim();

    return (
        <div className="relative w-full">
            {showPlaceholder && placeholder ? (
                <div className="pointer-events-none absolute left-3 top-2 text-sm leading-5" style={{ color: theme.node.placeholder }}>
                    {placeholder}
                </div>
            ) : null}
            <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                className={`${className || ""} overflow-y-auto whitespace-pre-wrap break-words outline-none`}
                style={{ ...style, cursor: "text" }}
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
                onClick={saveSelection}
                onKeyUp={saveSelection}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    event.stopPropagation();
                    if (isImeComposing(event)) return;
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
                    if (isPlainEnterKey(event) && onSubmit) {
                        event.preventDefault();
                        onSubmit();
                        return;
                    }
                    requestAnimationFrame(syncMention);
                }}
                onBlur={() => {
                    saveSelection();
                    window.setTimeout(closeMention, 120);
                }}
            />
            {mention && candidates.length ? (
                <MentionMenu rect={mention.rect} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} />
            ) : null}
            {imagePreview ? <Image src={imagePreview} alt={i18n.t("canvas.composer.imagePreview")} style={{ display: "none" }} preview={{ visible: true, src: imagePreview, onVisibleChange: (visible) => !visible && setImagePreview(null) }} /> : null}
        </div>
    );
});

function MentionMenu({
    rect,
    references,
    activeIndex,
    theme,
    onSelect,
}: {
    rect: DOMRect | null;
    references: Array<{ id: string; label: string; title: string; kind: string; previewUrl?: string; text?: string }>;
    activeIndex: number;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onSelect: (reference: any) => void;
}) {
    const selectedRef = useRef(false);
    const activeItemRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, references]);

    const selectReference = (reference: any) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => event.stopPropagation();

    const menuWidth = 256;
    const maxMenuHeight = 224;
    const gap = 6;
    const anchor = rect || new DOMRect(16, 16, 0, 0);
    const left = clamp(anchor.left, 8, window.innerWidth - menuWidth - 8);
    const showAbove = anchor.bottom + gap + maxMenuHeight > window.innerHeight && anchor.top - gap - maxMenuHeight >= 0;
    const top = showAbove ? anchor.top - gap - maxMenuHeight : anchor.bottom + gap;

    return createPortal(
        <div
            data-canvas-resource-mention-menu="true"
            className="fixed z-[1100] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-md"
            style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={stopCanvasInteraction}
            onMouseDown={stopCanvasInteraction}
            onClick={(event) => event.stopPropagation()}
        >
            {references.map((reference, index) => (
                <button
                    key={reference.id}
                    ref={index === activeIndex ? activeItemRef : undefined}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                    style={{ background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                >
                    <ReferencePreview reference={reference} />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{reference.label}</span>
                        <span className="block truncate opacity-65">{reference.text || reference.title}</span>
                    </span>
                </button>
            ))}
        </div>,
        document.body,
    );
}

function ReferencePreview({ reference }: { reference: { kind: string; previewUrl?: string } }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-9 rounded-md object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="size-9 rounded-md bg-black object-cover" muted preload="metadata" />;
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function createReferenceChip(
    reference: { kind: string; title: string; label: string; token: string; previewUrl?: string; text?: string; h3Tag?: string },
    theme: (typeof canvasThemes)[keyof typeof canvasThemes],
    onImagePreview: (url: string) => void,
) {
    const wrapper = document.createElement("span");
    wrapper.contentEditable = "false";
    wrapper.dataset.refLabel = reference.label;
    wrapper.dataset.refToken = reference.token;
    wrapper.className = "mx-px inline-flex h-6 max-w-48 items-center gap-1 justify-center overflow-hidden rounded-md border px-1.5 text-xs leading-none align-middle";
    Object.assign(wrapper.style, { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text } as CSSProperties);

    if ((reference.kind === "image" || reference.kind === "subject") && reference.previewUrl) {
        const image = document.createElement("img");
        image.src = reference.previewUrl;
        image.alt = reference.title;
        image.className = "size-4 rounded object-cover shrink-0";
        wrapper.appendChild(image);
        wrapper.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onImagePreview(reference.previewUrl || "");
        });
    } else if (reference.kind === "video" && reference.previewUrl) {
        const video = document.createElement("video");
        video.src = reference.previewUrl;
        video.muted = true;
        video.className = "size-4 rounded object-cover shrink-0";
        wrapper.appendChild(video);
    } else {
        const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
        // Icon container
        const iconSpan = document.createElement("span");
        iconSpan.className = "shrink-0 opacity-70 text-[10px]";
        iconSpan.textContent = reference.kind === "audio" ? "🎵" : reference.kind === "video" ? "🎬" : reference.kind === "subject" ? "👤" : "📄";
        wrapper.appendChild(iconSpan);
    }

    const text = document.createElement("span");
    text.className = "block truncate font-medium";
    text.textContent = reference.h3Tag ? `${reference.h3Tag} ${reference.title}` : reference.label;
    wrapper.appendChild(text);
    wrapper.title = reference.text || reference.title;

    return wrapper;
}

function createErrorChip(token: string, theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    const wrapper = document.createElement("span");
    wrapper.contentEditable = "false";
    wrapper.dataset.refToken = token;
    wrapper.dataset.refError = "true";
    wrapper.className = "mx-px inline-flex h-6 max-w-48 items-center gap-1 justify-center overflow-hidden rounded-md border border-red-500/60 bg-red-500/10 px-1.5 text-xs leading-none align-middle text-red-500";
    wrapper.title = `引用的素材已断开或不存在: ${token}`;

    const warnIcon = document.createElement("span");
    warnIcon.className = "shrink-0 text-[11px]";
    warnIcon.textContent = "⚠";
    wrapper.appendChild(warnIcon);

    const text = document.createElement("span");
    text.className = "block truncate font-mono text-[11px]";
    text.textContent = token;
    wrapper.appendChild(text);

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
        const token = node.dataset.refToken;
        if (token) result += token;
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
    return current instanceof HTMLElement && current.dataset.refToken ? current : null;
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

function caretRect(): DOMRect | null {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.width || rect.height || rect.left || rect.top) return rect;
    const editor = closestEditor(range.startContainer);
    return editor ? editor.getBoundingClientRect() : null;
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

// Split value into text fragments, active references and potential H3 / node tokens
function parseTokens(
    value: string,
    references: Array<{ id: string; label: string; token: string; h3Tag?: string }>,
): Token[] {
    const tokens: Token[] = [];
    const pattern = /@\[(node|subject|binding):([^\]]+)\]|<(Subject|Picture|Video|Audio)\s+(\d+)>|\b(subject|picture|image|audio|video)[ _](\d+)\b/gi;
    let lastIndex = 0;

    for (const match of value.matchAll(pattern)) {
        const start = match.index ?? 0;
        if (start > lastIndex) {
            tokens.push({ type: "text", value: value.slice(lastIndex, start) });
        }
        const fullToken = match[0];
        const isStableToken = match[1] !== undefined;
        const existingLabel = references.find((reference) => !reference.h3Tag && reference.label === fullToken);
        if (!isStableToken && existingLabel) {
            tokens.push({ type: "reference", label: existingLabel.label, serializedValue: existingLabel.token });
            lastIndex = start + fullToken.length;
            continue;
        }
        if (isStableToken) {
            const ref = references.find((r) => r.token === fullToken);
            if (ref) {
                tokens.push({ type: "reference", label: ref.label, serializedValue: fullToken, isError: false });
            } else {
                tokens.push({ type: "reference", label: fullToken, serializedValue: fullToken, isError: true });
            }
        } else {
            // Bare numbered mention (<Picture N>, picture_N, etc.) -> 待核对 (error chip)
            tokens.push({ type: "reference", label: fullToken, serializedValue: fullToken, isError: true });
        }
        lastIndex = start + fullToken.length;
    }

    if (lastIndex < value.length) {
        tokens.push({ type: "text", value: value.slice(lastIndex) });
    }
    return tokens;
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}
