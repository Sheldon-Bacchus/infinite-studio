import type { CSSProperties } from "react";
import { Check, Eye, Image as ImageIcon, LoaderCircle, MessageSquare, Music2, Play, Settings2, Square, UsersRound, Video } from "lucide-react";
import { Button, Modal, Segmented, Select } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, resolveModelForCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasConnection, CanvasSubject, CanvasVideoBinding } from "@/types/canvas";
import { buildVideoInputCandidate, getVideoInputAdapter } from "@/lib/canvas/canvas-video-inputs";
import { CanvasNodeVideoBindings } from "./canvas-node-video-bindings";
import { CanvasNodeInputProvenance } from "./canvas-node-input-provenance";
import { CanvasNodeType } from "@/types/canvas";

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    subjects: CanvasSubject[];
    onSubjectsChange: (subjects: CanvasSubject[]) => void;
    onBindingsChange: (nodeId: string, bindings: CanvasVideoBinding[]) => void;
    onMediaIdentity: (nodeId: string, identity: { assetId: string; contentVersion: string }) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onStop: (nodeId: string) => void;
    onComposerToggle: () => void;
};

export function CanvasConfigNodePanel({ node, nodes, connections, subjects, onSubjectsChange, onBindingsChange, onMediaIdentity, isRunning, inputSummary, onConfigChange, onGenerate, onStop, onComposerToggle }: CanvasConfigNodePanelProps) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = node.metadata?.generationMode || "image";
    const config = buildNodeConfig(globalConfig, node, mode);
    const prompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
    const [bindingsOpen, setBindingsOpen] = useState(false);
    const [inputPreviewOpen, setInputPreviewOpen] = useState(false);
    const videoInputCandidate = mode === "video" ? buildVideoInputCandidate({ sourceNode: node, nodes, connections, subjects, config, prompt }) : null;
    if (videoInputCandidate) {
        inputSummary = {
            textCount: videoInputCandidate.mapping.filter((row) => row.kind === "text").length,
            imageCount: videoInputCandidate.bindings.filter((row) => row.mediaType === "image").length,
            videoCount: videoInputCandidate.bindings.filter((row) => row.mediaType === "video").length,
            audioCount: videoInputCandidate.bindings.filter((row) => row.mediaType === "audio").length,
        };
    }
    const videoInputConfirmed = Boolean(videoInputCandidate && !videoInputCandidate.issues.length && node.metadata?.confirmedVideoInput?.fingerprint === videoInputCandidate.fingerprint);
    const videoReferenceOptions = [
        ...subjects.map((subject) => ({ value: `@[subject:${subject.subjectId}]`, label: `${t("canvas.videoInput.subject")}: ${subject.name}` })),
        ...(videoInputCandidate?.bindings || []).map((binding) => ({ value: `@[binding:${binding.bindingId}]`, label: `${nodes.find((item) => item.id === binding.nodeId)?.title || binding.nodeId} · ${t(`canvas.videoInput.usages.${binding.usage}`)}` })),
    ];
    const chipStyle = { background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text };
    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount);
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const canGenerate = hasComposerContent || (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput);
    const submit = () => {
        if (isRunning) onStop(node.id);
        else if (mode === "video" && !videoInputConfirmed) setInputPreviewOpen(true);
        else onGenerate(node.id);
    };
    const confirmVideoInput = () => {
        if (!videoInputCandidate || videoInputCandidate.issues.length) return;
        const adapter = getVideoInputAdapter(videoInputCandidate.adapterId);
        if (!adapter) return;
        const snapshot = adapter.compile(videoInputCandidate).snapshot;
        onConfigChange(node.id, { confirmedVideoInput: { fingerprint: videoInputCandidate.fingerprint, confirmedAt: new Date().toISOString(), snapshot } });
        setInputPreviewOpen(false);
    };
    const resolveLegacyReference = (reference: string, action: "text" | "remove") => {
        if (action === "remove") onConfigChange(node.id, { composerContent: prompt.split(reference).join("") });
        else onConfigChange(node.id, { videoPromptPlainTextReferences: Array.from(new Set([...(node.metadata?.videoPromptPlainTextReferences || []), reference])) });
    };
    const bindReference = (reference: string, token: string) => onConfigChange(node.id, { composerContent: prompt.split(reference).join(token) });

    return (
        <div className="flex h-full w-full cursor-move flex-col px-3 pb-3 pt-7 text-sm" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="shrink-0 text-sm font-semibold">{t("canvas.configNode.title")}</div>
                <div className="cursor-default" onMouseDown={(event) => event.stopPropagation()}>
                    <Segmented
                        size="small"
                        className="canvas-config-mode !rounded-md !p-0.5"
                        value={mode}
                        onChange={(value) => onConfigChange(node.id, { generationMode: value as CanvasGenerationMode })}
                        options={[
                            {
                                value: "image",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <ImageIcon className="size-3.5" />
                                        {t("canvas.configNode.image")}
                                    </span>
                                ),
                            },
                            {
                                value: "text",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <MessageSquare className="size-3.5" />
                                        {t("canvas.configNode.text")}
                                    </span>
                                ),
                            },
                            {
                                value: "video",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Video className="size-3.5" />
                                        {t("canvas.configNode.video")}
                                    </span>
                                ),
                            },
                            {
                                value: "audio",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Music2 className="size-3.5" />
                                        {t("canvas.configNode.audio")}
                                    </span>
                                ),
                            },
                        ]}
                    />
                    {mode === "video" ? <div className="flex items-center gap-1">
                        <Button size="small" type="text" className="!bg-transparent" icon={<UsersRound className="size-3.5" />} onMouseDown={(event) => event.stopPropagation()} onClick={() => setBindingsOpen(true)} aria-label={t("canvas.videoInput.manage")} />
                        <Button size="small" type="text" className="!bg-transparent" icon={videoInputConfirmed ? <Check className="size-3.5" /> : <Eye className="size-3.5" />} onMouseDown={(event) => event.stopPropagation()} onClick={() => setInputPreviewOpen(true)} aria-label={t("canvas.videoInput.previewTitle")} />
                    </div> : null}
                </div>
            </div>

            <div className="mb-2 flex flex-wrap gap-1.5">
                <InputChip label={t("canvas.configNode.prompt")} value={t("canvas.configNode.items", { count: inputSummary.textCount })} style={chipStyle} />
                <InputChip label={t("canvas.configNode.references")} value={t("canvas.configNode.images", { count: inputSummary.imageCount })} style={chipStyle} />
                <InputChip label={t("canvas.configNode.videoReferences")} value={t("canvas.configNode.items", { count: inputSummary.videoCount })} style={chipStyle} />
                <InputChip label={t("canvas.configNode.audioReferences")} value={t("canvas.configNode.items", { count: inputSummary.audioCount })} style={chipStyle} />
                <button type="button" className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px]" style={chipStyle} onMouseDown={(event) => event.stopPropagation()} onClick={onComposerToggle}>
                    <Settings2 className="size-3.5" />
                    {t("canvas.configNode.compose")}
                </button>
            </div>

            <div className="mb-2 grid min-w-0 cursor-default grid-cols-[minmax(0,1fr)_148px] items-center gap-2" onMouseDown={(event) => event.stopPropagation()}>
                <ModelPicker className="canvas-compact-control h-10" config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability={mode} onMissingConfig={() => openConfigDialog(true)} fullWidth />
                {mode === "video" ? (
                    <CanvasVideoSettingsPopover config={config} placement="topRight" buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                ) : mode === "image" ? (
                    <CanvasImageSettingsPopover config={config} placement="topRight" autoAdjustOverflow={false} buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2" onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })} />
                ) : mode === "audio" ? (
                    <CanvasAudioSettingsPopover config={config} placement="topRight" buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                ) : (
                    <CanvasTextSettingsPopover config={config} count={node.metadata?.textCount || 1} placement="topRight" buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2" onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })} onCountChange={(textCount) => onConfigChange(node.id, { textCount })} />
                )}
            </div>

            <Button
                type="primary"
                className="mt-auto !h-9 !w-full !cursor-pointer !rounded-lg"
                danger={isRunning}
                disabled={!isRunning && !canGenerate}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={submit}
            >
                <span className="inline-flex items-center gap-1.5">
                    {isRunning ? (
                        <>
                            <LoaderCircle className="size-4 animate-spin" />
                            <Square className="size-3.5 fill-current" />
                            <span>{t("canvas.configNode.stop")}</span>
                        </>
                    ) : (
                        <>
                            <Play className="size-4" />
                            <span>{t("canvas.configNode.generate")}</span>
                        </>
                    )}
                </span>
            </Button>
            <Modal title={t("canvas.videoInput.manage")} open={bindingsOpen} centered width={760} footer={null} onCancel={() => setBindingsOpen(false)} destroyOnHidden>
                <CanvasNodeVideoBindings node={node} nodes={nodes} connections={connections} subjects={subjects} onSubjectsChange={onSubjectsChange} onBindingsChange={(bindings) => onBindingsChange(node.id, bindings)} onMediaIdentity={onMediaIdentity} />
            </Modal>
            <Modal title={t("canvas.videoInput.previewTitle")} open={inputPreviewOpen} centered width={760} onCancel={() => setInputPreviewOpen(false)} destroyOnHidden footer={<div className="flex justify-end gap-2"><Button onClick={() => setInputPreviewOpen(false)}>{t("common.cancel")}</Button><Button type="primary" disabled={!videoInputCandidate || videoInputCandidate.issues.length > 0} onClick={confirmVideoInput}>{t("canvas.videoInput.confirm")}</Button></div>}>
                {videoInputCandidate ? <div className="space-y-3" data-canvas-no-zoom>
                    {node.metadata?.confirmedVideoInput?.snapshot ? (
                        <CanvasNodeInputProvenance snapshot={node.metadata.confirmedVideoInput.snapshot} nodes={nodes} subjects={subjects} />
                    ) : null}
                    <div className="text-xs opacity-70">{videoInputCandidate.model} · {videoInputCandidate.adapterId || t("canvas.videoInput.issues.adapterUnsupported")} · {videoInputCandidate.params.mode} · {videoInputCandidate.params.seconds}s · {videoInputCandidate.params.resolution} · {videoInputCandidate.params.aspectRatio}</div>
                    <div><div className="mb-1 text-sm font-medium">{t("canvas.videoInput.compiledPrompt")}</div><div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border p-3 text-sm" style={{ borderColor: theme.toolbar.border }}>{videoInputCandidate.compiledPrompt}</div></div>
                    {videoInputCandidate.issues.length ? <div className="text-sm">草稿预览，不可提交</div> : null}
                    <section>
                        <div className="mb-1 text-sm font-medium">引用映射：标记 → 素材 → 工作流字段</div>
                        {videoInputCandidate.mapping.map((row, index) => <div key={index} className="mb-1 grid grid-cols-3 gap-2 text-xs">
                            <span>{row.tag}</span><span>{row.name}</span><span>{row.workflowField} · {row.statusText}</span>
                        </div>)}
                    </section>
                    {videoInputCandidate.bindings.map((binding) => { const media = nodes.find((item) => item.id === binding.nodeId); const subject = subjects.find((item) => item.subjectId === binding.subjectId); return <div key={binding.bindingId} className="flex items-center gap-3 rounded-lg px-2 py-1" style={{ background: theme.toolbar.panel }}>
                        {media?.type === CanvasNodeType.Image && media.metadata?.content ? <img src={media.metadata.content} alt="" className="size-10 rounded object-cover" /> : null}<span className="min-w-0 flex-1 truncate text-sm">{media?.title || binding.nodeId}</span><span className="text-xs opacity-70">{subject?.name || ""} · {t(`canvas.videoInput.usages.${binding.usage}`)} · {binding.mediaType} #{binding.order + 1}</span>
                    </div>; })}
                    {videoInputCandidate.unresolvedReferences.map((reference, index) => <div key={`${reference}-${index}`} className="flex items-center justify-between gap-2 text-sm"><code>{reference}</code><div className="flex gap-1"><Select size="small" className="w-52" placeholder={t("canvas.videoInput.bindReference")} options={videoReferenceOptions} disabled={!videoReferenceOptions.length} onChange={(token) => bindReference(reference, token)} /><Button size="small" onClick={() => resolveLegacyReference(reference, "text")}>{t("canvas.videoInput.setPlainText")}</Button><Button size="small" onClick={() => resolveLegacyReference(reference, "remove")}>{t("canvas.videoInput.removeReference")}</Button></div></div>)}
                    {videoInputCandidate.issues.map((issue, index) => <div key={`${issue.code}-${index}`} className="text-sm text-red-500">{issue.message}</div>)}
                </div> : null}
            </Modal>
        </div>
    );
}

function InputChip({ label, value, style }: { label: string; value: string; style: CSSProperties }) {
    return (
        <div className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]" style={style}>
            <span>{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}

export function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasGenerationMode): AiConfig {
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
