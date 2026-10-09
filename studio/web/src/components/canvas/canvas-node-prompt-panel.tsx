import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Modal, Select, Tag, Tooltip } from "antd";
import { ArrowUp, Check, Copy, Eye, FileText, LoaderCircle, Maximize2, Square, UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { useCopyText } from "@/hooks/use-copy-text";
import { defaultConfig, modelOptionLabel, resolveModelForCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput, type CanvasPromptChipInputRef } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData, type CanvasSubject, type CanvasVideoBinding, type VideoInputItem } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { buildVideoInputList } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";
import { CanvasNodeVideoBindings } from "./canvas-node-video-bindings";
import { CanvasNodeInputProvenance } from "./canvas-node-input-provenance";
import { buildVideoInputCandidate, getVideoInputAdapter } from "@/lib/canvas/canvas-video-inputs";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    subjects: CanvasSubject[];
    onSubjectsChange: (subjects: CanvasSubject[]) => void;
    onBindingsChange: (nodeId: string, bindings: CanvasVideoBinding[]) => void;
    onMediaIdentity: (nodeId: string, identity: { assetId: string; contentVersion: string }) => void;
    connectedNodes?: CanvasNodeData[];
    onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
    onStartReferenceSelection?: (nodeId: string) => void;
    onReferenceOrderChange?: (stableIds: string[]) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
    modeOverride?: CanvasNodeGenerationMode; // Plugin nodes set their generation type through useBuiltinPanel.mode.
    onLocateNode?: (nodeId: string) => void;
};

export function CanvasNodePromptPanel({
    node,
    nodes,
    connections,
    subjects,
    onSubjectsChange,
    onBindingsChange,
    onMediaIdentity,
    isRunning,
    onPromptChange,
    onConfigChange,
    onGenerate,
    onStop,
    mentionReferences = [],
    connectedNodes = [],
    onDisconnectReference,
    onStartReferenceSelection,
    onReferenceOrderChange,
    onImageSettingsOpenChange,
    modeOverride,
    onLocateNode,
}: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const handleCopyText = useCopyText();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const [bindingsOpen, setBindingsOpen] = useState(false);
    const [inputPreviewOpen, setInputPreviewOpen] = useState(false);
    const [provenanceOpen, setProvenanceOpen] = useState(false);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const hasProvenance = Boolean(node.metadata?.generationInputSnapshot || node.metadata?.generationId || (node.metadata?.generationHistoryIds?.length || 0) > 0);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    const [expanded, setExpanded] = useState(false);

    const promptInputRef = useRef<CanvasPromptChipInputRef>(null);
    const expandedInputRef = useRef<CanvasPromptChipInputRef>(null);

    const inputList = useMemo(
        () => (mode === "video" ? buildVideoInputList(node, nodes, connections, subjects, prompt, config.model) : []),
        [config.model, connections, mode, node, nodes, prompt, subjects],
    );

    const videoInputCandidate = useMemo(
        () => (mode === "video" ? buildVideoInputCandidate({ sourceNode: node, nodes, connections, subjects, config, prompt }) : null),
        [config, connections, mode, node, nodes, prompt, subjects],
    );

    const videoInputConfirmed = Boolean(
        videoInputCandidate &&
            !videoInputCandidate.issues.length &&
            node.metadata?.confirmedVideoInput?.fingerprint === videoInputCandidate.fingerprint,
    );

    const videoReferenceOptions = [
        ...subjects.map((subject) => ({ value: `@[subject:${subject.subjectId}]`, label: `${t("canvas.videoInput.subject")}: ${subject.name}` })),
        ...(videoInputCandidate?.bindings || []).map((binding) => ({
            value: `@[binding:${binding.bindingId}]`,
            label: `${nodes.find((item) => item.id === binding.nodeId)?.title || binding.nodeId} · ${t(`canvas.videoInput.usages.${binding.usage}`)}`,
        })),
    ];

    // Restore prompts only when switching nodes; preserve current input after generation on the same node
    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if ((!text && mode !== "video") || isRunning) return;
        if (mode === "video" && !videoInputConfirmed) {
            setInputPreviewOpen(true);
            return;
        }
        onGenerate(node.id, mode, text);
    };

    const confirmVideoInput = () => {
        if (!videoInputCandidate || videoInputCandidate.issues.length) return;
        const adapter = getVideoInputAdapter(videoInputCandidate.adapterId);
        if (!adapter) return;
        const snapshot = adapter.compile(videoInputCandidate).snapshot;
        onConfigChange(node.id, { confirmedVideoInput: { fingerprint: videoInputCandidate.fingerprint, confirmedAt: new Date().toISOString(), snapshot } });
        setInputPreviewOpen(false);
        message.success(t("canvas.videoInput.confirmedSuccess") || "已确认本次输入");
    };

    const resolveLegacyReference = (token: string, action: "text" | "remove") => {
        if (action === "remove") updatePrompt(prompt.split(token).join(""));
        else onConfigChange(node.id, { videoPromptPlainTextReferences: Array.from(new Set([...(node.metadata?.videoPromptPlainTextReferences || []), token])) });
    };

    const bindReference = (reference: string, token: string) => updatePrompt(prompt.split(reference).join(token));

    const openExpandedEditor = () => {
        setExpanded(true);
    };

    const handleInsertFromBar = (item: VideoInputItem) => {
        (expanded ? expandedInputRef : promptInputRef).current?.insertReference(item);
    };

    // Summary counts
    const summaryCounts = useMemo(() => {
        if (!videoInputCandidate) return null;
        const img = videoInputCandidate.bindings.filter((b) => b.mediaType === "image").length;
        const vid = videoInputCandidate.bindings.filter((b) => b.mediaType === "video").length;
        const aud = videoInputCandidate.bindings.filter((b) => b.mediaType === "audio").length;
        const sub = inputList.filter((i) => i.kind === "subject").length;
        const txt = inputList.filter((i) => i.kind === "text").length;
        return { img, vid, aud, sub, txt };
    }, [inputList, videoInputCandidate]);

    return (
        <div
            data-canvas-no-zoom
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasNodeReferenceBar
                nodeId={node.id}
                nodes={nodes}
                connectedNodes={connectedNodes}
                videoBindings={mode === "video" ? node.metadata?.videoBindings : undefined}
                subjects={subjects}
                inputList={inputList}
                onDisconnect={onDisconnectReference}
                onStartSelection={onStartReferenceSelection}
                onOrderChange={onReferenceOrderChange}
                onInsertReference={mode === "video" ? handleInsertFromBar : undefined}
            />

            {mode === "video" && summaryCounts ? (
                <div className="mb-2 flex items-center justify-between px-1 text-[11px] opacity-70">
                    <div className="flex items-center gap-2">
                        <span>图片: {summaryCounts.img}</span>
                        <span>音频: {summaryCounts.aud}</span>
                        {summaryCounts.vid > 0 ? <span className="text-red-500">视频: {summaryCounts.vid} (不支持)</span> : null}
                        <span>实体: {summaryCounts.sub}</span>
                        <span>文本: {summaryCounts.txt}</span>
                    </div>
                    <div>
                        <Tag color={videoInputConfirmed ? "success" : "warning"} className="!mr-0 text-[10px]">
                            {videoInputConfirmed ? "输入已确认" : "待预览确认"}
                        </Tag>
                    </div>
                </div>
            ) : null}

            <CanvasPromptChipInput
                ref={promptInputRef}
                value={prompt}
                references={mode === "video" && inputList.length ? inputList : mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-40 w-full cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: "transparent", color: theme.node.text }}
                placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
            />

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Tooltip title={t("canvas.promptPanel.expandEditor")}>
                        <Button
                            type="text"
                            className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"
                            style={{ color: theme.node.text }}
                            icon={<Maximize2 className="size-3.5" />}
                            onClick={openExpandedEditor}
                            aria-label={t("canvas.promptPanel.expandEditor")}
                        />
                    </Tooltip>
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !max-w-[220px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                            <Tooltip title={t("canvas.videoInput.manage")}>
                                <Button type="text" className="!bg-transparent" icon={<UsersRound className="size-4" />} onClick={() => setBindingsOpen(true)} aria-label={t("canvas.videoInput.manage")} />
                            </Tooltip>
                            <Tooltip title={t(videoInputConfirmed ? "canvas.videoInput.confirmed" : "canvas.videoInput.needsConfirmation")}>
                                <Button
                                    type="text"
                                    className="!bg-transparent"
                                    icon={videoInputConfirmed ? <Check className="size-4 text-green-500" /> : <Eye className="size-4" />}
                                    onClick={() => setInputPreviewOpen(true)}
                                    aria-label={t("canvas.videoInput.previewTitle")}
                                />
                            </Tooltip>
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasTextSettingsPopover config={config} count={node.metadata?.textCount || 1} onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })} onCountChange={(textCount) => onConfigChange(node.id, { textCount })} />
                        </>
                    )}
                    {hasProvenance ? (
                        <Tooltip title={t("canvas.provenance.viewProvenance")}>
                            <Button
                                type="text"
                                className="!bg-transparent"
                                icon={<FileText className="size-4" />}
                                onClick={() => setProvenanceOpen(true)}
                                aria-label={t("canvas.provenance.viewProvenance")}
                            />
                        </Tooltip>
                    ) : null}
                </div>
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    danger={isRunning}
                    disabled={!isRunning && !prompt.trim() && (mode !== "video" || !videoInputCandidate || videoInputCandidate.issues.some((issue) => issue.code === "promptRequired"))}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={t(isRunning ? "canvas.promptPanel.stopGeneration" : "canvas.promptPanel.generate")}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">{t("canvas.promptPanel.stop")}</span>
                            </>
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </span>
                </Button>
            </div>

            <Modal title={t("canvas.promptPanel.editorTitle")} open={expanded} centered width={760} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasNodeReferenceBar
                        nodeId={node.id}
                        nodes={nodes}
                        connectedNodes={connectedNodes}
                        videoBindings={mode === "video" ? node.metadata?.videoBindings : undefined}
                        subjects={subjects}
                        inputList={inputList}
                        onDisconnect={onDisconnectReference}
                        onOrderChange={onReferenceOrderChange}
                        onStartSelection={(nodeId) => {
                            setExpanded(false);
                            onStartReferenceSelection?.(nodeId);
                        }}
                        onInsertReference={mode === "video" ? handleInsertFromBar : undefined}
                    />
                    <CanvasPromptChipInput
                        ref={expandedInputRef}
                        value={prompt}
                        references={mode === "video" && inputList.length ? inputList : mentionReferences}
                        onChange={updatePrompt}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                    />
                </div>
            </Modal>

            <Modal title={t("canvas.videoInput.manage")} open={bindingsOpen} centered width={760} footer={null} onCancel={() => setBindingsOpen(false)} destroyOnHidden>
                <CanvasNodeVideoBindings node={node} nodes={nodes} connections={connections} subjects={subjects} onSubjectsChange={onSubjectsChange} onBindingsChange={(bindings) => onBindingsChange(node.id, bindings)} onMediaIdentity={onMediaIdentity} />
            </Modal>

            <Modal
                title={t("canvas.provenance.title")}
                open={provenanceOpen}
                centered
                width={640}
                footer={null}
                onCancel={() => setProvenanceOpen(false)}
                destroyOnHidden
            >
                <div data-canvas-no-zoom className="pt-2 max-h-[75vh] overflow-y-auto">
                    <CanvasNodeInputProvenance
                        node={node}
                        nodes={nodes}
                        subjects={subjects}
                        onLocateNode={onLocateNode}
                    />
                </div>
            </Modal>

            <Modal
                title={
                    <div className="flex items-center gap-2">
                        <span>{t("canvas.videoInput.previewTitle")}</span>
                        {videoInputCandidate && videoInputCandidate.issues.length > 0 ? (
                            <Tag color="error">草稿预览，不可提交</Tag>
                        ) : (
                            <Tag color="success">可确认提交</Tag>
                        )}
                    </div>
                }
                open={inputPreviewOpen}
                centered
                width={820}
                onCancel={() => setInputPreviewOpen(false)}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button onClick={() => setInputPreviewOpen(false)}>{t("common.cancel")}</Button>
                        <Button type="primary" disabled={!videoInputCandidate || videoInputCandidate.issues.length > 0} onClick={confirmVideoInput}>
                            {t("canvas.videoInput.confirm")}
                        </Button>
                    </div>
                }
                destroyOnHidden
            >
                {videoInputCandidate ? (
                    <div className="space-y-4" data-canvas-no-zoom>
                        {node.metadata?.confirmedVideoInput?.snapshot ? (
                            <CanvasNodeInputProvenance snapshot={node.metadata.confirmedVideoInput.snapshot} nodes={nodes} subjects={subjects} onLocateNode={onLocateNode} />
                        ) : null}
                        <div className="text-xs opacity-70">
                            {modelOptionLabel(config, videoInputCandidate.model)} · {videoInputCandidate.adapterId || t("canvas.videoInput.issues.adapterUnsupported")} · {videoInputCandidate.params.mode} · {videoInputCandidate.params.seconds}s · {videoInputCandidate.params.resolution} · {videoInputCandidate.params.aspectRatio}
                        </div>

                        {/* 区一：H3 提示词正文 */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">H3 提示词正文</span>
                                <Button
                                    size="small"
                                    type="text"
                                    icon={<Copy className="size-3.5" />}
                                    onClick={() => handleCopyText(videoInputCandidate.compiledPrompt)}
                                >
                                    复制正文
                                </Button>
                            </div>
                            <div className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border p-3 font-mono text-xs leading-relaxed" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                                {videoInputCandidate.compiledPrompt || <span className="opacity-50">（正文为空）</span>}
                            </div>
                        </div>

                        {/* 区二：引用映射（标记 → 实际素材/实体 → 工作流字段） */}
                        <div className="space-y-1.5">
                            <div className="text-sm font-medium">素材与字段映射</div>
                            <div className="max-h-52 overflow-y-auto rounded-lg border text-xs" style={{ borderColor: theme.toolbar.border }}>
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b opacity-70" style={{ borderColor: theme.toolbar.border }}>
                                            <th className="p-2">标记</th>
                                            <th className="p-2">素材 / 实体名称</th>
                                            <th className="p-2">工作流字段</th>
                                            <th className="p-2">状态</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {videoInputCandidate.mapping.map((row, idx) => (
                                            <tr key={`${row.tag}-${idx}`} className="border-b last:border-b-0" style={{ borderColor: theme.toolbar.border }}>
                                                <td className="p-2 font-mono font-medium">{row.tag}</td>
                                                <td className="p-2">
                                                    <div className="flex items-center gap-2">
                                                        {row.previewUrl ? <img src={row.previewUrl} alt="" className="size-5 rounded object-cover" /> : null}
                                                        <span className="truncate max-w-[200px]" title={row.name}>{row.name}</span>
                                                    </div>
                                                </td>
                                                <td className="p-2 font-mono opacity-80">{row.workflowField || "-"}</td>
                                                <td className="p-2">
                                                    {row.status === "valid" ? (
                                                        <span className="text-green-500">{row.statusText || "正常"}</span>
                                                    ) : row.status === "unreferenced" ? (
                                                        <span className="text-amber-500">{row.statusText || "正文未引用"}</span>
                                                    ) : (
                                                        <span className="text-red-500">{row.statusText || "不支持"}</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* 未解析引用 / 兼容旧引用绑定 */}
                        {videoInputCandidate.unresolvedReferences.length ? (
                            <div className="space-y-1 rounded-lg border border-red-500/30 p-2.5 bg-red-500/5">
                                <div className="text-sm font-medium text-red-500">{t("canvas.videoInput.unresolved") || "未解析的引用"}</div>
                                {videoInputCandidate.unresolvedReferences.map((reference, index) => (
                                    <div key={`${reference}-${index}`} className="flex items-center justify-between gap-2 text-xs">
                                        <code className="text-red-500">{reference}</code>
                                        <div className="flex gap-1">
                                            <Select
                                                size="small"
                                                className="w-52"
                                                placeholder={t("canvas.videoInput.bindReference")}
                                                options={videoReferenceOptions}
                                                disabled={!videoReferenceOptions.length}
                                                onChange={(token) => bindReference(reference, token)}
                                            />
                                            <Button size="small" onClick={() => resolveLegacyReference(reference, "text")}>
                                                {t("canvas.videoInput.setPlainText")}
                                            </Button>
                                            <Button size="small" onClick={() => resolveLegacyReference(reference, "remove")}>
                                                {t("canvas.videoInput.removeReference")}
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {/* 错误与阻断问题清单 */}
                        {videoInputCandidate.issues.length ? (
                            <div className="space-y-1 rounded-lg border border-red-500/30 p-2.5 bg-red-500/5 text-xs text-red-500">
                                <div className="font-semibold">阻断提交的问题清单：</div>
                                {videoInputCandidate.issues.map((issue, index) => (
                                    <div key={`${issue.code}-${index}`}>• {issue.message}</div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...globalConfig,
        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),
        reasoningEffort: node.metadata?.reasoningEffort || globalConfig.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        videoMode: node.metadata?.videoMode || globalConfig.videoMode || defaultConfig.videoMode,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoMode") return { videoMode: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
