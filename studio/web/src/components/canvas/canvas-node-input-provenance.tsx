import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Copy, ExternalLink, FileText, Image as ImageIcon, Music2, RefreshCw, Users, Video, XCircle } from "lucide-react";
import { Button, Segmented, Tag, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCopyText } from "@/hooks/use-copy-text";
import { sanitizeUrl } from "@/lib/canvas/canvas-reference-plan";
import {
    listGenerationHistoriesForNode,
    getGenerationHistoriesByIds,
    subscribeGenerationHistory,
    type GenerationHistoryEntry,
} from "@/lib/works/generation-history";
import type {
    CanvasNodeData,
    CanvasSubject,
    CanvasVideoInputSnapshot,
    CanvasGenerationInputSnapshot,
    ReferencePlanProvenance,
} from "@/types/canvas";

export type CanvasNodeInputProvenanceProps = {
    /** 兼容直接传入的快照（视频快照或统一生成快照） */
    snapshot?: CanvasVideoInputSnapshot | CanvasGenerationInputSnapshot;
    /** 明确传入的来源快照 */
    provenance?: CanvasGenerationInputSnapshot | null;
    /** 当前节点：用于自动关联历史记录、重试链与状态 */
    node?: CanvasNodeData;
    /** 画布中的节点集合：用于识别原节点是否仍存在或已分离/删除 */
    nodes?: CanvasNodeData[];
    /** 主体列表 */
    subjects?: CanvasSubject[];
    /** 预加载的历史记录列表（若未传则根据 node 自动异步加载） */
    historyEntries?: GenerationHistoryEntry[];
    /** 点击定位节点回调 */
    onLocateNode?: (nodeId: string) => void;
};

/**
 * 展示本次提交的不可变输入快照面板。
 * 遵循原则：
 * 1. 读历史 provenance 而非随时变化的当前节点；
 * 2. 无法定位到当前画布节点时，明确提示“来源未知/原节点已移除”，不凭当前节点补造；
 * 3. 历史记录若缺失 provenance，明确显示“无来源记录”；
 * 4. 清晰标示“本次提交 (已固化)”与“当前草稿”，脱敏展示无签名地址凭据；
 * 5. 多次重试时支持切换历次独立尝试（关联父尝试）。
 */
export function CanvasNodeInputProvenance({
    snapshot,
    provenance,
    node,
    nodes = [],
    historyEntries: propHistoryEntries,
    onLocateNode,
}: CanvasNodeInputProvenanceProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const copyText = useCopyText();

    const [loadedEntries, setLoadedEntries] = useState<GenerationHistoryEntry[]>([]);
    const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

    // 自动加载该节点相关的历史记录（涵盖初次尝试与所有重试）
    useEffect(() => {
        if (propHistoryEntries) {
            setLoadedEntries(propHistoryEntries);
            if (propHistoryEntries.length > 0 && !selectedEntryId) {
                setSelectedEntryId(propHistoryEntries[0].id);
            }
            return;
        }

        if (!node?.id) return;
        let isCancelled = false;

        const loadHistories = async () => {
            const historyIds = Array.from(new Set([
                ...(node.metadata?.generationHistoryIds || []),
                ...(node.metadata?.generationId ? [node.metadata.generationId] : []),
            ]));
            let list: GenerationHistoryEntry[] = [];
            if (historyIds.length > 0) {
                list = await getGenerationHistoriesByIds(historyIds);
            }
            const nodeHistories = await listGenerationHistoriesForNode(node.id);
            const historyMap = new Map<string, GenerationHistoryEntry>();
            list.forEach((e) => historyMap.set(e.id, e));
            nodeHistories.forEach((e) => historyMap.set(e.id, e));
            const merged = Array.from(historyMap.values()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

            if (!isCancelled) {
                setLoadedEntries(merged);
                if (merged.length > 0) {
                    const currentGenId = node.metadata?.generationId;
                    const matched = merged.find((e) => e.id === currentGenId);
                    setSelectedEntryId(matched ? matched.id : merged[0].id);
                }
            }
        };

        void loadHistories();
        return () => {
            isCancelled = true;
        };
    }, [node?.id, node?.metadata?.generationHistoryIds, node?.metadata?.generationId, propHistoryEntries]);

    // 监听生成历史实时变更事件，无需轮询即可同步最新历史状态与产物
    useEffect(() => {
        if (!node?.id || propHistoryEntries) return;

        const unsubscribe = subscribeGenerationHistory((event) => {
            const entry = event.entry;
            const historyIds = Array.from(new Set([
                ...(node.metadata?.generationHistoryIds || []),
                ...(node.metadata?.generationId ? [node.metadata.generationId] : []),
            ]));

            const isRelated =
                entry.nodeId === node.id ||
                historyIds.includes(entry.id) ||
                loadedEntries.some((e) => e.id === entry.id);

            if (!isRelated) return;

            setLoadedEntries((prev) => {
                const map = new Map<string, GenerationHistoryEntry>();
                prev.forEach((item) => map.set(item.id, item));
                map.set(entry.id, entry);
                return Array.from(map.values()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
            });
        });

        return unsubscribe;
    }, [node?.id, node?.metadata?.generationHistoryIds, node?.metadata?.generationId, propHistoryEntries, loadedEntries]);

    // 当前选中的历史记录
    const activeEntry = useMemo(
        () => loadedEntries.find((e) => e.id === selectedEntryId) || null,
        [loadedEntries, selectedEntryId],
    );

    // 解析有效快照：优先级为 选中历史记录内的快照 > 显式传入的 provenance > 显式传入的 snapshot > 节点自身的快照
    const effectiveSnapshot = useMemo((): {
        isOldMissingRecord: boolean;
        provenance: CanvasGenerationInputSnapshot | null;
        videoSnapshot: CanvasVideoInputSnapshot | null;
        attemptInfo?: { id: string; parentId?: string; status?: string; createdAt?: string };
    } => {
        if (activeEntry) {
            const rawSnap = activeEntry.inputSnapshot as Record<string, unknown> | undefined;
            const prov = rawSnap?.provenance as CanvasGenerationInputSnapshot | undefined;
            const vidSnap = (rawSnap?.videoInputSnapshot || prov?.videoInputSnapshot) as CanvasVideoInputSnapshot | undefined;

            if (!prov && !vidSnap) {
                return {
                    isOldMissingRecord: true,
                    provenance: null,
                    videoSnapshot: null,
                    attemptInfo: {
                        id: activeEntry.id,
                        parentId: activeEntry.parentGenerationId,
                        status: activeEntry.status,
                        createdAt: activeEntry.createdAt,
                    },
                };
            }

            return {
                isOldMissingRecord: false,
                provenance: prov || null,
                videoSnapshot: vidSnap || null,
                attemptInfo: {
                    id: activeEntry.id,
                    parentId: activeEntry.parentGenerationId,
                    status: activeEntry.status,
                    createdAt: activeEntry.createdAt,
                },
            };
        }

        if (provenance) {
            return {
                isOldMissingRecord: false,
                provenance,
                videoSnapshot: provenance.videoInputSnapshot || null,
            };
        }

        if (snapshot) {
            if ("references" in snapshot && Array.isArray((snapshot as CanvasGenerationInputSnapshot).references)) {
                const genSnap = snapshot as CanvasGenerationInputSnapshot;
                return {
                    isOldMissingRecord: false,
                    provenance: genSnap,
                    videoSnapshot: genSnap.videoInputSnapshot || null,
                };
            }
            return {
                isOldMissingRecord: false,
                provenance: null,
                videoSnapshot: snapshot as CanvasVideoInputSnapshot,
            };
        }

        const nodeSnap = node?.metadata?.generationInputSnapshot;
        if (nodeSnap) {
            if ("references" in nodeSnap && Array.isArray((nodeSnap as CanvasGenerationInputSnapshot).references)) {
                const genSnap = nodeSnap as CanvasGenerationInputSnapshot;
                return {
                    isOldMissingRecord: false,
                    provenance: genSnap,
                    videoSnapshot: genSnap.videoInputSnapshot || null,
                };
            }
            return {
                isOldMissingRecord: false,
                provenance: null,
                videoSnapshot: nodeSnap as CanvasVideoInputSnapshot,
            };
        }

        return {
            isOldMissingRecord: false,
            provenance: null,
            videoSnapshot: null,
        };
    }, [activeEntry, node?.metadata?.generationInputSnapshot, provenance, snapshot]);

    const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
    const renderAttemptSelector = () => {
        if (loadedEntries.length <= 1) return null;
        return (
            <div className="flex flex-wrap items-center gap-1.5 pb-1 border-b" style={{ borderColor: theme.toolbar.border }}>
                <span className="opacity-60 text-[11px] font-medium mr-1">{t("canvas.provenance.historyAttempts")}</span>
                <Segmented
                    size="small"
                    value={selectedEntryId || loadedEntries[0].id}
                    onChange={(val) => setSelectedEntryId(val as string)}
                    options={loadedEntries.map((e, idx) => {
                        const isRetry = Boolean(e.parentGenerationId);
                        const num = loadedEntries.length - idx;
                        const statusColor = e.status === "succeeded" ? "text-emerald-500" : e.status === "failed" ? "text-red-500" : e.status === "canceled" ? "text-amber-500" : "text-blue-500";
                        return {
                            value: e.id,
                            label: (
                                <span className="flex items-center gap-1 text-[11px]">
                                    <span className={statusColor}>●</span>
                                    <span>#{num} {isRetry ? t("canvas.provenance.retryAttempt") : t("canvas.provenance.initialAttempt")}</span>
                                </span>
                            ),
                        };
                    })}
                />
            </div>
        );
    };

    // 若属于早期历史记录缺失 provenance，显示无来源记录提示，绝不凭当前节点补造
    if (effectiveSnapshot.isOldMissingRecord) {
        return (
            <div className="space-y-3 rounded-lg border p-3.5 text-xs" style={{ borderColor: theme.toolbar.border }} data-canvas-no-zoom>
                {loadedEntries.length > 1 && renderAttemptSelector()}
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-6 px-4 text-center opacity-80" style={{ borderColor: theme.toolbar.border }}>
                    <AlertCircle className="mb-2 size-6 text-amber-500 opacity-90" />
                    <div className="text-sm font-medium">{t("canvas.provenance.noRecord")}</div>
                    <div className="mt-1 max-w-sm text-xs opacity-65">
                        {t("canvas.provenance.noRecordDesc")}
                    </div>
                </div>
            </div>
        );
    }

    const { provenance: prov, videoSnapshot: vidSnap, attemptInfo } = effectiveSnapshot;

    if (!prov && !vidSnap) {
        return (
            <div className="rounded-lg border p-3 text-xs opacity-70" style={{ borderColor: theme.toolbar.border }} data-canvas-no-zoom>
                {t("canvas.provenance.notConfirmed")}
            </div>
        );
    }

    const compiledPrompt = prov?.prompt || vidSnap?.prompt || (activeEntry?.inputSnapshot?.prompt as string) || "";
    const model = prov?.model || vidSnap?.model || activeEntry?.modelChannel || "default";
    const mode = prov?.mode || (node?.type === "video" ? "video" : node?.type === "audio" ? "audio" : node?.type === "text" ? "text" : "image");
    const createdAt = prov?.createdAt || attemptInfo?.createdAt;
    const snapshotReferenceCount = vidSnap ? (vidSnap.bindings?.length || 0) + (vidSnap.mapping || []).filter((row) => row.status === "valid" && (row.kind === "text" || row.kind === "subject")).length : 0;

    return (
        <div className="space-y-3 rounded-lg border p-3.5 text-xs select-text" style={{ borderColor: theme.toolbar.border }} data-canvas-no-zoom>
            {renderAttemptSelector()}

            {/* 顶栏：明确区隔“本次提交 (已固化)”与“当前草稿”，显示父尝试关联 */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2" style={{ borderColor: theme.toolbar.border }}>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm" style={{ color: theme.node.text }}>
                        {t("canvas.provenance.title")}
                    </span>
                    <Tag color="processing">
                        {t("canvas.provenance.submitted")}
                    </Tag>
                    {attemptInfo?.parentId ? (
                        <Tooltip title={`${t("canvas.provenance.parentAttempt")}: ${attemptInfo.parentId}`}>
                            <Tag color="default" className="text-[11px]">
                                <RefreshCw className="mr-1 inline-block size-3 opacity-60" />
                                {t("canvas.provenance.retryAttempt")}
                            </Tag>
                        </Tooltip>
                    ) : null}
                    {attemptInfo?.status ? (
                        <Tag color={attemptInfo.status === "succeeded" ? "success" : attemptInfo.status === "failed" ? "error" : attemptInfo.status === "canceled" ? "warning" : "processing"}>
                            {t(`canvas.provenance.status.${attemptInfo.status}`)}
                        </Tag>
                    ) : null}
                </div>
                <div className="text-[11px] opacity-60 flex items-center gap-1">
                    <Clock className="size-3" />
                    <span>{createdAt ? new Date(createdAt).toLocaleString() : ""}</span>
                </div>
            </div>

            {/* 说明标签：与草稿独立 */}
            <div className="text-[11px] opacity-65 leading-relaxed bg-black/5 dark:bg-white/5 rounded px-2.5 py-1.5">
                {t("canvas.provenance.immutableNote")}
            </div>

            {/* 模型与参数信息 */}
            <div className="flex flex-wrap items-center gap-2 opacity-80 text-[11px]">
                <span className="font-medium">{model}</span>
                <span>·</span>
                <span>{mode}</span>
                {vidSnap ? (
                    <>
                        <span>·</span>
                        <span>{vidSnap.params.seconds}s</span>
                        <span>·</span>
                        <span>{vidSnap.params.resolution}</span>
                        <span>·</span>
                        <span>{vidSnap.params.aspectRatio}</span>
                        {vidSnap.adapterId ? (
                            <>
                                <span>·</span>
                                <span>{vidSnap.adapterId}</span>
                            </>
                        ) : null}
                    </>
                ) : null}
            </div>

            {/* 区块一：最终提示词正文 */}
            <section className="space-y-1">
                <div className="flex items-center justify-between">
                    <span className="font-medium text-xs">{t("canvas.provenance.compiledPrompt")}</span>
                    <Button
                        size="small"
                        type="text"
                        icon={<Copy className="size-3" />}
                        className="h-6 px-1.5 text-[11px]"
                        onClick={() => copyText(compiledPrompt, t("common.promptCopied"))}
                    >
                        {t("common.copy")}
                    </Button>
                </div>
                <div
                    className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded border p-2.5 font-mono text-[11px] leading-relaxed"
                    style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}
                >
                    {compiledPrompt || <span className="opacity-40">{t("canvas.provenance.emptyPrompt")}</span>}
                </div>
            </section>

            {/* 区块二：引用素材清单 */}
            <section className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <span className="font-medium text-xs">
                        {t("canvas.provenance.referencesHeading")}
                    </span>
                    <span className="text-[11px] opacity-60">
                        {prov?.references ? t("canvas.provenance.referenceCount", { count: prov.references.length }) : vidSnap ? t("canvas.provenance.referenceCount", { count: snapshotReferenceCount }) : ""}
                    </span>
                </div>

                {/* 1. 若有 unified provenance.references */}
                {prov?.references && prov.references.length > 0 ? (
                    <div className="space-y-1.5">
                        {prov.references.map((item: ReferencePlanProvenance, idx: number) => {
                            const isPresent = Boolean(item.nodeId && nodeById.has(item.nodeId));
                            const preview = sanitizeUrl(item.immutableThumbnail || item.previewUrl);
                            const Icon = item.kind === "video" ? Video : item.kind === "audio" ? Music2 : item.kind === "text" ? FileText : ImageIcon;

                            return (
                                <div
                                    key={item.key || `${item.nodeId}_${idx}`}
                                    className="flex items-center gap-2.5 rounded-lg border p-2 transition"
                                    style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}
                                >
                                    {/* 缩略图：若缺失给出明确提示 */}
                                    <span
                                        className="grid size-9 shrink-0 place-items-center overflow-hidden rounded border text-center"
                                        style={{ borderColor: theme.toolbar.border, background: theme.toolbar.activeBg }}
                                        title={!preview ? t("canvas.provenance.missingThumbnail") : undefined}
                                    >
                                        {item.kind === "image" && preview ? (
                                            <img src={preview} alt="" className="size-full object-cover" />
                                        ) : item.kind === "video" && preview ? (
                                            <video src={preview} className="size-full object-cover" muted />
                                        ) : (
                                            <div className="flex flex-col items-center justify-center p-0.5">
                                                <Icon className="size-3.5 opacity-40" />
                                                {(item.kind === "image" || item.kind === "video") && !preview ? (
                                                    <span className="text-[8px] leading-tight text-amber-500 opacity-80 scale-90">
                                                        {t("canvas.provenance.missingThumbnail")}
                                                    </span>
                                                ) : null}
                                            </div>
                                        )}
                                    </span>

                                    {/* 素材详细身份 */}
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                        <div className="flex items-center gap-1.5">
                                            <span className="font-medium text-xs font-mono">{item.label}</span>
                                            <span className="truncate font-medium text-xs" style={{ color: theme.node.text }}>
                                                {item.title}
                                            </span>
                                            {item.groupTitle ? (
                                                <Tag color="cyan" className="text-[10px] leading-4 px-1 py-0 mr-0">
                                                    {item.groupTitle}
                                                </Tag>
                                            ) : null}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] opacity-70">
                                            {/* 用途 */}
                                            {item.usage ? <span>{item.usage}</span> : null}

                                            {/* 原节点状态与定位：真实动作与避免伪可点 */}
                                            {item.nodeId ? (
                                                isPresent ? (
                                                    onLocateNode ? (
                                                        <span
                                                            className="inline-flex items-center gap-0.5 text-blue-500 hover:underline cursor-pointer"
                                                            onClick={() => onLocateNode(item.nodeId)}
                                                        >
                                                            <span>{t("canvas.provenance.canvasNode")}</span>
                                                            <ExternalLink className="size-2.5" />
                                                        </span>
                                                    ) : (
                                                        <span className="opacity-80">
                                                            {t("canvas.provenance.canvasNode")}
                                                        </span>
                                                    )
                                                ) : (
                                                    <span className="text-amber-500 font-medium">
                                                        [{t("canvas.provenance.detached")}]
                                                    </span>
                                                )
                                            ) : null}

                                            {/* fileId 稳定标识或未知身份明确提示 */}
                                            {item.fileId ? (
                                                <span className="font-mono opacity-80">file:{item.fileId.slice(0, 8)}</span>
                                            ) : item.storageKey ? (
                                                <span className="font-mono opacity-80">{item.storageKey.slice(0, 12)}</span>
                                            ) : item.kind !== "text" ? (
                                                <span className="text-amber-500 font-mono text-[10px]">
                                                    [{t("canvas.provenance.unknownIdentity")}]
                                                </span>
                                            ) : null}
                                            {item.kind === "image" || item.kind === "video" || item.kind === "audio" ? <span>{t("canvas.provenance.originalFilename")}: {item.originalFilename || t("canvas.provenance.sourceInfoUnknown")}</span> : null}
                                            {item.selectedImageId ? <span>{t("canvas.provenance.selectedImage")}: {item.selectedImageId}</span> : item.selectedImageIdUnknown ? <span>{t("canvas.provenance.selectedImage")}: {t("canvas.provenance.sourceInfoUnknown")}</span> : null}
                                            {item.contentVersion ? <span title={item.contentVersion}>{t("canvas.provenance.contentVersion")}: {item.contentVersion.slice(0, 12)}</span> : null}
                                        </div>

                                        {/* 状态异常明确提示 */}
                                        {item.status !== "valid" ? (
                                            <div className="text-[10px] text-red-400">
                                                {item.disabledReason || (item.status === "missing" ? t("canvas.provenance.mediaMissing") : item.status)}
                                            </div>
                                        ) : null}
                                    </div>

                                    {/* 状态指示符 */}
                                    <div className="shrink-0 text-right">
                                        {item.status === "valid" ? (
                                            <CheckCircle2 className="size-4 text-emerald-500" />
                                        ) : (
                                            <XCircle className="size-4 text-red-400" />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : vidSnap?.bindings?.length || vidSnap?.mapping?.some((row) => row.kind === "text" || row.kind === "subject") ? (
                    /* 2. 旧版视频快照按固定 bindings 呈现媒体；缺少 bindingId 的 mapping 不参与媒体匹配 */
                    <div className="space-y-1.5">
                        {vidSnap.bindings?.map((binding, index) => {
                            const row = vidSnap.mapping?.find((item) => item.bindingId === binding.bindingId && item.kind === binding.mediaType);
                            const isPresent = Boolean(binding.nodeId && nodeById.has(binding.nodeId));
                            const preview = sanitizeUrl(row?.previewUrl);
                            const Icon = binding.mediaType === "video" ? Video : binding.mediaType === "audio" ? Music2 : ImageIcon;

                            return (
                                <div
                                    key={`binding:${binding.bindingId}:${index}`}
                                    className="flex items-center gap-2.5 rounded-lg border p-2"
                                    style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}
                                >
                                    <span
                                        className="grid size-9 shrink-0 place-items-center overflow-hidden rounded border text-center"
                                        style={{ borderColor: theme.toolbar.border, background: theme.toolbar.activeBg }}
                                        title={!preview ? t("canvas.provenance.missingThumbnail") : undefined}
                                    >
                                        {binding.mediaType === "image" && preview ? (
                                            <img src={preview} alt="" className="size-full object-cover" />
                                        ) : binding.mediaType === "video" && preview ? (
                                            <video src={preview} className="size-full object-cover" muted />
                                        ) : (
                                            <div className="flex flex-col items-center justify-center p-0.5">
                                                <Icon className="size-3.5 opacity-40" />
                                                {(binding.mediaType === "image" || binding.mediaType === "video") && !preview ? (
                                                    <span className="text-[8px] leading-tight text-amber-500 opacity-80 scale-90">
                                                        {t("canvas.provenance.missingThumbnail")}
                                                    </span>
                                                ) : null}
                                            </div>
                                        )}
                                    </span>
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                        <div className="flex items-center gap-1.5">
                                            <span className="font-medium text-xs font-mono">{row?.tag || t("canvas.provenance.sourceInfoUnknown")}</span>
                                            <span className="truncate font-medium text-xs">{row?.name || t("canvas.provenance.sourceInfoUnknown")}</span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-2 text-[11px] opacity-70">
                                            {isPresent ? (
                                                onLocateNode ? (
                                                    <span
                                                        className="inline-flex items-center gap-0.5 text-blue-500 hover:underline cursor-pointer"
                                                        onClick={() => onLocateNode(binding.nodeId)}
                                                    >
                                                        <span>{t("canvas.provenance.canvasNode")}</span>
                                                        <ExternalLink className="size-2.5" />
                                                    </span>
                                                ) : (
                                                    <span className="opacity-80">{t("canvas.provenance.canvasNode")}</span>
                                                )
                                            ) : (
                                                <span className="text-amber-500 font-medium">
                                                    [{t("canvas.provenance.detached")}]
                                                </span>
                                            )}
                                            {row?.subjectName ? <span>{t("canvas.videoInput.subject")}: {row.subjectName}</span> : null}
                                            <span>{t(`canvas.videoInput.usages.${binding.usage}`)}</span>
                                            {binding.mediaRef?.fileId ? (
                                                <span className="font-mono">file:{binding.mediaRef.fileId.slice(0, 8)}</span>
                                            ) : binding.mediaRef?.storageKey ? (
                                                <span className="font-mono">{binding.mediaRef.storageKey.slice(0, 12)}</span>
                                            ) : (
                                                <span className="text-amber-500 font-mono text-[10px]">
                                                    [{t("canvas.provenance.unknownIdentity")}]
                                                </span>
                                            )}
                                            <span>{t("canvas.provenance.originalFilename")}: {row?.originalFilename || t("canvas.provenance.sourceInfoUnknown")}</span>
                                            {row?.selectedImageId ? <span>{t("canvas.provenance.selectedImage")}: {row.selectedImageId}</span> : row?.selectedImageIdUnknown ? <span>{t("canvas.provenance.selectedImage")}: {t("canvas.provenance.sourceInfoUnknown")}</span> : null}
                                            {binding.contentVersion ? <span title={binding.contentVersion}>{t("canvas.provenance.contentVersion")}: {binding.contentVersion.slice(0, 12)}</span> : null}
                                        </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <Tag color={row?.status === "valid" ? "success" : "warning"} className="mr-0 text-[10px]">
                                            {row?.statusText || row?.status || t("canvas.provenance.sourceInfoUnknown")}
                                        </Tag>
                                    </div>
                                </div>
                            );
                        })}
                        {vidSnap.mapping?.filter((row) => row.status === "valid" && (row.kind === "text" || row.kind === "subject")).map((row, index) => (
                            <div key={`prompt:${row.kind}:${index}`} className="flex items-center gap-2.5 rounded-lg border p-2" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                                {row.kind === "subject" ? <Users className="size-4 opacity-50" /> : <FileText className="size-4 opacity-50" />}
                                <span className="font-medium text-xs font-mono">{row.tag || t("canvas.provenance.sourceInfoUnknown")}</span>
                                <span className="truncate font-medium text-xs">{row.name || t("canvas.provenance.sourceInfoUnknown")}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed py-4 px-3 text-center opacity-65 text-xs" style={{ borderColor: theme.toolbar.border }}>
                        {t("canvas.provenance.pureText")}
                    </div>
                )}
            </section>
        </div>
    );
}
