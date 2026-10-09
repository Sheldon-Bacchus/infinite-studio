import { Button, Drawer, Input, InputNumber, Segmented, Select, Space } from "antd";
import { ListPlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { defaultBaseUrlForApiFormat, guessCapability, normalizeChannelModels, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";
import type { CanvasMediaType, CanvasMediaUsage, CanvasVideoInputCapabilities } from "@/types/canvas";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: "AutoDL", value: "autodl" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));
    const setVideoAdapter = (name: string, adapterId?: CanvasVideoInputCapabilities["adapterId"]) => setModels(draft.models.map((model) => {
        if (model.name !== name) return model;
        const videoInputCapabilities = adapterId ? { adapterId, media: model.videoInputCapabilities?.media || {} } : undefined;
        return { ...model, videoInputCapabilities };
    }));
    const setVideoMedia = (name: string, mediaType: CanvasMediaType, patch: { usages?: CanvasMediaUsage[]; maxCount?: number | null }) => setModels(draft.models.map((model) => {
        if (model.name !== name || !model.videoInputCapabilities) return model;
        const media = { ...model.videoInputCapabilities.media };
        const current = media[mediaType] || { usages: [], maxCount: 0 };
        const next = { ...current, ...(patch.usages ? { usages: patch.usages } : {}), ...(patch.maxCount !== undefined ? { maxCount: patch.maxCount || 0 } : {}) };
        if (!next.usages.length) delete media[mediaType];
        else media[mediaType] = next;
        return { ...model, videoInputCapabilities: { ...model.videoInputCapabilities, media } };
    }));

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />
                </label>
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>{model.name}</span>
                                <div className="flex shrink-0 items-center gap-2">
                                    <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                    <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                        {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                    </Button>
                                    <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                                </div>
                            </div>
                            {model.capability === "video" ? (
                                <details className="mt-2 rounded-md px-1 py-1 text-xs">
                                    <summary className="cursor-pointer text-stone-500">{t("config.channelEditor.videoInputContract")}</summary>
                                    <div className="mt-2 grid gap-2">
                                        <Select
                                            allowClear
                                            placeholder={t("config.channelEditor.videoAdapter")}
                                            value={model.videoInputCapabilities?.adapterId}
                                            options={[
                                                { value: "openai-video-v1", label: "OpenAI video v1", disabled: draft.apiFormat !== "openai" || Boolean(model.script?.trim()) },
                                                { value: "gemini-video-v1", label: "Gemini video v1", disabled: draft.apiFormat !== "gemini" || Boolean(model.script?.trim()) },
                                                { value: "script-video-v1", label: t("config.channelEditor.scriptAdapter"), disabled: !model.script?.trim() },
                                            ]}
                                            onChange={(value) => setVideoAdapter(model.name, value)}
                                        />
                                        {model.videoInputCapabilities ? (["image", "video", "audio"] as CanvasMediaType[]).map((mediaType) => {
                                            const configured = model.videoInputCapabilities?.media[mediaType];
                                            const usageOptions = VIDEO_USAGE_OPTIONS[mediaType].map((usage) => ({ value: usage, label: t(`canvas.videoInput.usages.${usage}`) }));
                                            return (
                                                <div key={mediaType} className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-2">
                                                    <Select mode="multiple" allowClear placeholder={t(`config.channelEditor.mediaTypes.${mediaType}`)} value={configured?.usages || []} options={usageOptions} onChange={(usages) => setVideoMedia(model.name, mediaType, { usages })} />
                                                    <InputNumber className="w-full" min={1} precision={0} value={configured?.maxCount || null} placeholder={t("config.channelEditor.maxCount")} onChange={(value) => { const count = value === null ? null : Number(value); setVideoMedia(model.name, mediaType, { maxCount: count !== null && Number.isInteger(count) && count > 0 ? count : null }); }} />
                                                </div>
                                            );
                                        }) : null}
                                        <div className="text-stone-500">{t("config.channelEditor.videoInputContractHint")}</div>
                                    </div>
                                </details>
                            ) : null}
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}

const VIDEO_USAGE_OPTIONS: Record<CanvasMediaType, CanvasMediaUsage[]> = {
    image: ["appearance", "detail", "scene", "prop", "storyboard", "first_frame", "last_frame"],
    audio: ["voice_style", "dialogue", "music", "ambience", "sound_effect", "original_audio"],
    video: ["action", "camera", "pacing", "edit_source", "continuation_source", "keyframe_source"],
};
