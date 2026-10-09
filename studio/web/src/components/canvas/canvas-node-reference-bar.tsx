import { FileText, Image as ImageIcon, Music2, Plus, Puzzle, Users, Video, X } from "lucide-react";
import { Popover, theme as antdTheme } from "antd";
import type { GlobalToken } from "antd/es/theme/interface";
import { useSyncExternalStore, useState } from "react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasSubject, type CanvasVideoBinding, type VideoInputItem } from "@/types/canvas";

export function CanvasNodeReferenceBar({
    nodeId,
    nodes,
    connectedNodes,
    videoBindings = [],
    subjects = [],
    inputList = [],
    onDisconnect,
    onStartSelection,
    onInsertReference,
    onOrderChange,
}: {
    nodeId: string;
    nodes: CanvasNodeData[];
    connectedNodes: CanvasNodeData[];
    videoBindings?: CanvasVideoBinding[];
    subjects?: CanvasSubject[];
    inputList?: VideoInputItem[];
    onDisconnect?: (fromNodeId: string, toNodeId: string) => void;
    onStartSelection?: (nodeId: string) => void;
    onInsertReference?: (item: VideoInputItem) => void;
    onOrderChange?: (stableIds: string[]) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { token } = antdTheme.useToken();
    const [insertMenuOpen, setInsertMenuOpen] = useState(false);
    const [draggedStableId, setDraggedStableId] = useState<string | null>(null);

    /** 拖动或左右移动都需要覆盖整份引用顺序，避免只改可见片段导致漏项。 */
    const moveReference = (stableIds: string[], from: number, to: number) => {
        if (to < 0 || to >= stableIds.length || from === to) return;
        const next = [...stableIds];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        onOrderChange?.(next);
    };

    const references = connectedNodes.flatMap((sourceNode) =>
        (sourceNode.type === CanvasNodeType.Group ? getGroupResourceNodes(sourceNode.id, nodes) : [sourceNode]).map((node) => ({
            node,
            sourceNodeId: sourceNode.id,
            bindingLabels: videoBindings
                .filter((binding) => binding.nodeId === node.id)
                .map((binding) => {
                    const subject = subjects.find((item) => item.subjectId === binding.subjectId);
                    return `${subject ? `${subject.name} · ` : ""}${t(`canvas.videoInput.usages.${binding.usage}`)}`;
                }),
        })),
    );

    const handleSelectInputItem = (item: VideoInputItem) => {
        if (item.disabled) return;
        setInsertMenuOpen(false);
        onInsertReference?.(item);
    };

    const handleConnectOnCanvas = () => {
        setInsertMenuOpen(false);
        onStartSelection?.(nodeId);
    };

    const insertMenuContent = (
        <div className="w-64 space-y-2 p-1" style={{ color: theme.node.text }}>
            <div className="flex items-center justify-between border-b pb-1 text-xs font-medium" style={{ borderColor: theme.toolbar.border }}>
                <span>{t("canvas.videoInput.insertReference")}</span>
                {onStartSelection ? (
                    <button
                        type="button"
                        className="text-[11px] underline opacity-70 hover:opacity-100"
                        onClick={handleConnectOnCanvas}
                    >
                        {t("canvas.references.select")}
                    </button>
                ) : null}
            </div>
            {inputList.length ? (
                <div className="thin-scrollbar max-h-56 space-y-1 overflow-y-auto">
                    {inputList.map((item) => (
                        <button
                            key={item.stableId}
                            type="button"
                            disabled={item.disabled}
                            className={`flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-xs transition ${
                                item.disabled ? "cursor-not-allowed opacity-50" : "hover:bg-black/5 dark:hover:bg-white/10"
                            }`}
                            onClick={() => handleSelectInputItem(item)}
                            title={item.disabled ? item.disabledReason : undefined}
                        >
                            {item.kind === "image" && item.previewUrl ? (
                                <img src={item.previewUrl} alt="" className="size-7 rounded object-cover" />
                            ) : item.kind === "video" && item.previewUrl ? (
                                <video src={item.previewUrl} className="size-7 rounded bg-black object-cover" muted />
                            ) : item.kind === "subject" && item.previewUrl ? (
                                <div className="relative size-7 overflow-hidden rounded">
                                    <img src={item.previewUrl} alt="" className="size-full object-cover" />
                                    <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 p-0.5 text-white">
                                        <Users className="size-2" />
                                    </span>
                                </div>
                            ) : (
                                <span className="grid size-7 place-items-center rounded bg-transparent">
                                    {item.kind === "audio" ? (
                                        <Music2 className="size-3.5 opacity-65" />
                                    ) : item.kind === "video" ? (
                                        <Video className="size-3.5 opacity-65" />
                                    ) : item.kind === "text" ? (
                                        <FileText className="size-3.5 opacity-65" />
                                    ) : item.kind === "subject" ? (
                                        <Users className="size-3.5 opacity-65" />
                                    ) : (
                                        <ImageIcon className="size-3.5 opacity-65" />
                                    )}
                                </span>
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{item.h3Tag ? `${item.h3Tag} ${item.name}` : item.name}</div>
                                <div className="truncate text-[10px] opacity-60">{item.text || item.kind}</div>
                            </div>
                            {item.disabled ? (
                                <span
                                    className="shrink-0 rounded px-1 py-0.5 text-[9px] font-medium"
                                    style={{ color: token.colorError, background: token.colorErrorBg }}
                                >
                                    {t("canvas.videoInput.issues.unsupportedVideoMedia") || "不支持"}
                                </span>
                            ) : null}
                        </button>
                    ))}
                </div>
            ) : (
                <div className="py-4 text-center text-xs opacity-60">
                    <div>{t("canvas.references.emptyConnected") || "请先在画布上连接素材"}</div>
                    {onStartSelection ? (
                        <button
                            type="button"
                            className="mt-2 rounded border px-2.5 py-1 text-xs"
                            style={{ borderColor: theme.toolbar.border }}
                            onClick={handleConnectOnCanvas}
                        >
                            {t("canvas.references.select")}
                        </button>
                    ) : null}
                </div>
            )}
        </div>
    );

    const hasInputListCards = inputList.length > 0;

    return (
        <div className="mb-2">
            <div className="mb-1.5 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                {t("canvas.references.title")}
            </div>
            <div className="thin-scrollbar flex min-h-12 gap-2 overflow-x-auto pb-1">
                {hasInputListCards
                    ? inputList.map((item, index) => (
                          <ReferenceInputCard
                              key={item.stableId}
                              item={item}
                              token={token}
                              theme={theme}
                              draggable={Boolean(onOrderChange)}
                              isDragging={draggedStableId === item.stableId}
                              onDragStart={() => setDraggedStableId(item.stableId)}
                              onDragEnd={() => setDraggedStableId(null)}
                              onDropOn={() => {
                                  if (!draggedStableId || draggedStableId === item.stableId) return;
                                  const order = inputList.map((entry) => entry.stableId);
                                  moveReference(order, order.indexOf(draggedStableId), index);
                                  setDraggedStableId(null);
                              }}
                              onMove={onOrderChange ? (offset) => moveReference(inputList.map((entry) => entry.stableId), index, index + offset) : undefined}
                              onRemove={item.nodeId ? () => onDisconnect?.(item.nodeId!, nodeId) : undefined}
                          />
                      ))
                    : references.map(({ node, sourceNodeId, bindingLabels }, index) => (
                          <ReferenceItem
                              key={`${sourceNodeId}:${node.id}`}
                              node={node}
                              bindingLabels={bindingLabels}
                              draggable={Boolean(onOrderChange)}
                              isDragging={draggedStableId === node.id}
                              onDragStart={() => setDraggedStableId(node.id)}
                              onDragEnd={() => setDraggedStableId(null)}
                              onDropOn={() => {
                                  if (!draggedStableId || draggedStableId === node.id) return;
                                  const order = references.map((entry) => entry.node.id);
                                  moveReference(order, order.indexOf(draggedStableId), index);
                                  setDraggedStableId(null);
                              }}
                              onMove={onOrderChange ? (offset) => moveReference(references.map((entry) => entry.node.id), index, index + offset) : undefined}
                              onRemove={() => onDisconnect?.(sourceNodeId, nodeId)}
                          />
                      ))}

                {onInsertReference ? (
                    <Popover
                        open={insertMenuOpen}
                        onOpenChange={setInsertMenuOpen}
                        content={insertMenuContent}
                        trigger="click"
                        placement="bottomLeft"
                    >
                        <button
                            type="button"
                            className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70"
                            style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}
                            title={t("canvas.videoInput.insertReference")}
                        >
                            <Plus className="size-4" />
                        </button>
                    </Popover>
                ) : (
                    <button
                        type="button"
                        className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70"
                        style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}
                        title={t("canvas.references.select")}
                        onClick={() => onStartSelection?.(nodeId)}
                    >
                        <Plus className="size-4" />
                    </button>
                )}
            </div>
        </div>
    );
}

function ReferenceInputCard({
    item,
    token,
    theme,
    draggable,
    isDragging,
    onDragStart,
    onDragEnd,
    onDropOn,
    onMove,
    onRemove,
}: {
    item: VideoInputItem;
    token: GlobalToken;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    draggable?: boolean;
    isDragging?: boolean;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    onDropOn?: () => void;
    onMove?: (offset: number) => void;
    onRemove?: () => void;
}) {
    const { t } = useTranslation();
    const Icon =
        item.kind === "image"
            ? ImageIcon
            : item.kind === "video"
            ? Video
            : item.kind === "audio"
            ? Music2
            : item.kind === "text"
            ? FileText
            : Users;

    return (
        <Popover placement="topLeft" mouseEnterDelay={0.15} content={<ReferenceInputCardPreview item={item} token={token} theme={theme} />}>
            <div
                draggable={draggable}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                    event.preventDefault();
                    onDropOn?.();
                }}
                className={`group relative grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent${draggable ? " cursor-grab active:cursor-grabbing" : ""}`}
                style={{
                    borderColor: item.disabled ? token.colorErrorBorder : theme.toolbar.border,
                    opacity: item.disabled ? 0.65 : 1,
                    ...(isDragging ? { opacity: 0.4 } : {}),
                }}
            >
                {onMove ? (
                    <div className="absolute inset-x-0 bottom-0 top-0 z-10 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
                        <button type="button" className="flex h-full w-3 items-center justify-center bg-black/40 text-white hover:bg-black/60" title={t("canvas.references.moveLeft")} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onMove(-1); }}>‹</button>
                        <button type="button" className="flex h-full w-3 items-center justify-center bg-black/40 text-white hover:bg-black/60" title={t("canvas.references.moveRight")} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onMove(1); }}>›</button>
                    </div>
                ) : null}
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {(item.kind === "image" || item.kind === "subject") && item.previewUrl ? (
                        <div className="relative size-full">
                            <img src={item.previewUrl} alt="" className="size-full object-cover" />
                            {item.kind === "subject" ? (
                                <span className="absolute bottom-3.5 right-0 rounded-tl bg-black/60 p-0.5 text-white">
                                    <Users className="size-2" />
                                </span>
                            ) : null}
                        </div>
                    ) : item.kind === "video" && item.previewUrl ? (
                        <video src={item.previewUrl} className="size-full object-cover" muted />
                    ) : (
                        <Icon className="size-4 opacity-65" />
                    )}
                </span>
                {item.disabled ? (
                    <span
                        className="absolute right-0.5 top-0.5 rounded px-0.5 text-[8px] font-semibold leading-3"
                        style={{ color: token.colorError, background: token.colorErrorBg }}
                    >
                        {t("canvas.videoInput.issues.unsupportedVideoMedia") || "不支持"}
                    </span>
                ) : null}
                <span
                    className="absolute bottom-0.5 left-0.5 right-0.5 truncate rounded px-0.5 text-center text-[8px] leading-3"
                    style={{ background: theme.toolbar.panel, color: theme.node.text }}
                    title={item.h3Tag ? `${item.h3Tag} ${item.name}` : item.name}
                >
                    {item.h3Tag || (item.kind === "text" ? `文本 ${item.number}` : item.name)}
                </span>
                {onRemove ? (
                    <button
                        type="button"
                        className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
                        aria-label={t("canvas.references.disconnect")}
                        title={t("canvas.references.disconnect")}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onRemove();
                        }}
                    >
                        <X className="size-3" />
                    </button>
                ) : null}
            </div>
        </Popover>
    );
}

function ReferenceInputCardPreview({
    item,
    token,
    theme,
}: {
    item: VideoInputItem;
    token: GlobalToken;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
}) {
    const { t } = useTranslation();
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 border-b pb-1.5 text-xs font-medium" style={{ borderColor: theme.toolbar.border }}>
                <span className="truncate">{item.h3Tag ? `${item.h3Tag} ${item.name}` : item.name}</span>
                <span className="text-[10px] opacity-60">{item.kind}</span>
            </div>
            {item.disabled ? (
                <div
                    className="rounded p-1 text-xs"
                    style={{ color: token.colorError, background: token.colorErrorBg }}
                >
                    {item.disabledReason || t("canvas.videoInput.issues.unsupportedVideoMedia") || "不支持"}
                </div>
            ) : null}
            {(item.kind === "image" || item.kind === "subject") && item.previewUrl ? (
                <img src={item.previewUrl} alt={item.name} className="max-h-52 w-72 rounded-lg object-contain" />
            ) : item.kind === "video" && item.previewUrl ? (
                <video src={item.previewUrl} className="max-h-52 w-72 rounded-lg" muted controls />
            ) : (
                <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">
                    {item.text || item.name || t("canvas.references.empty")}
                </div>
            )}
        </div>
    );
}

function ReferenceItem({ node, bindingLabels, onRemove, draggable, isDragging, onDragStart, onDragEnd, onDropOn, onMove }: { node: CanvasNodeData; bindingLabels: string[]; onRemove: () => void; draggable?: boolean; isDragging?: boolean; onDragStart?: () => void; onDragEnd?: () => void; onDropOn?: () => void; onMove?: (offset: number) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const content = node.metadata?.content || resource?.url;
    const thumbnail = previewUrlFor(node.metadata?.storageKey) || content;
    const Icon =
        resource?.kind === "image" || node.type === CanvasNodeType.Image
            ? ImageIcon
            : resource?.kind === "video" || node.type === CanvasNodeType.Video
            ? Video
            : resource?.kind === "audio" || node.type === CanvasNodeType.Audio
            ? Music2
            : resource?.kind === "text" || node.type === CanvasNodeType.Text
            ? FileText
            : Puzzle;
    return (
        <Popover placement="topLeft" mouseEnterDelay={0.15} content={<ReferencePreview node={node} content={content} bindingLabels={bindingLabels} />}>
            <div
                draggable={draggable}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                    event.preventDefault();
                    onDropOn?.();
                }}
                className={`group relative grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent${draggable ? " cursor-grab active:cursor-grabbing" : ""}`}
                style={{ borderColor: theme.toolbar.border, opacity: isDragging ? 0.4 : 1 }}
            >
                {onMove ? (
                    <div className="absolute inset-x-0 bottom-0 top-0 z-10 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                            type="button"
                            className="flex h-full w-3 items-center justify-center bg-black/40 text-white hover:bg-black/60"
                            title={t("canvas.references.moveLeft")}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                onMove(-1);
                            }}
                        >
                            ‹
                        </button>
                        <button
                            type="button"
                            className="flex h-full w-3 items-center justify-center bg-black/40 text-white hover:bg-black/60"
                            title={t("canvas.references.moveRight")}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                onMove(1);
                            }}
                        >
                            ›
                        </button>
                    </div>
                ) : null}
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {(resource?.kind === "image" || node.type === CanvasNodeType.Image) && thumbnail ? (
                        <img src={thumbnail} alt="" className="size-full object-cover" />
                    ) : (resource?.kind === "video" || node.type === CanvasNodeType.Video) && content ? (
                        <video src={content} className="size-full object-cover" muted />
                    ) : (
                        <Icon className="size-4 opacity-65" />
                    )}
                </span>
                {bindingLabels.length ? (
                    <span className="absolute bottom-0.5 left-0.5 right-0.5 truncate rounded px-0.5 text-center text-[8px] leading-3" style={{ background: theme.toolbar.panel, color: theme.node.text }} title={bindingLabels.join(" · ")}>
                        {t("canvas.videoInput.bindingCount", { count: bindingLabels.length })}
                    </span>
                ) : null}
                <button
                    type="button"
                    className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
                    aria-label={t("canvas.references.disconnect")}
                    title={t("canvas.references.disconnect")}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRemove();
                    }}
                >
                    <X className="size-3" />
                </button>
            </div>
        </Popover>
    );
}

function ReferencePreview({ node, content, bindingLabels }: { node: CanvasNodeData; content?: string; bindingLabels: string[] }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const preview =
        (resource?.kind === "image" || node.type === CanvasNodeType.Image) && content ? (
            <img src={content} alt={node.title} className="max-h-52 w-72 rounded-lg object-contain" />
        ) : (resource?.kind === "video" || node.type === CanvasNodeType.Video) && content ? (
            <video src={content} className="max-h-52 w-72 rounded-lg" muted controls />
        ) : (resource?.kind === "audio" || node.type === CanvasNodeType.Audio) && content ? (
            <audio src={content} className="w-72" controls />
        ) : (
            <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">
                {resource?.text || node.metadata?.content || node.metadata?.prompt || node.title || t("canvas.references.empty")}
            </div>
        );
    return (
        <div className="space-y-2">
            {preview}
            {bindingLabels.length ? (
                <div className="border-t pt-2 text-xs" style={{ borderColor: theme.toolbar.border }}>
                    <div className="mb-1 font-medium">{t("canvas.videoInput.boundAs")}</div>
                    {bindingLabels.map((label, index) => (
                        <div key={`${label}-${index}`}>{label}</div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
