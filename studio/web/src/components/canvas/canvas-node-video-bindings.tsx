import { Button, Input, InputNumber, Select } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { getGenerationResourceNodes, getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasConnection, type CanvasMediaType, type CanvasMediaUsage, type CanvasNodeData, type CanvasSubject, type CanvasVideoBinding } from "@/types/canvas";

const usageByMedia: Record<CanvasMediaType, CanvasMediaUsage[]> = {
    image: ["appearance", "detail", "scene", "prop", "storyboard", "first_frame", "last_frame"],
    audio: ["voice_style", "dialogue", "music", "ambience", "sound_effect", "original_audio"],
    video: ["action", "camera", "pacing", "edit_source", "continuation_source", "keyframe_source"],
};

export function CanvasNodeVideoBindings({
    node, nodes, connections, subjects, onSubjectsChange, onBindingsChange, onMediaIdentity,
}: {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    subjects: CanvasSubject[];
    onSubjectsChange: (subjects: CanvasSubject[]) => void;
    onBindingsChange: (bindings: CanvasVideoBinding[]) => void;
    onMediaIdentity: (nodeId: string, identity: { assetId: string; contentVersion: string }) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [selectedMediaId, setSelectedMediaId] = useState("");
    const reachable = getGenerationResourceNodes(node.id, nodes, connections);
    const mediaNodes = reachable.flatMap((input) => input.type === CanvasNodeType.Group ? getGroupResourceNodes(input.id, nodes) : [input]).filter((item) => item.type === CanvasNodeType.Image || item.type === CanvasNodeType.Video || item.type === CanvasNodeType.Audio);
    const mediaById = new Map(mediaNodes.map((item) => [item.id, item]));
    const bindings = node.metadata?.videoBindings || [];
    const patchBinding = (bindingId: string, patch: Partial<CanvasVideoBinding>) => onBindingsChange(bindings.map((binding) => binding.bindingId === bindingId ? { ...binding, ...patch } : binding));
    const addBinding = (nodeId: string) => {
        const media = mediaById.get(nodeId);
        if (!media) return;
        const mediaType = media.type as CanvasMediaType;
        const identity = { assetId: media.metadata?.assetId || nanoid(), contentVersion: media.metadata?.contentVersion || nanoid() };
        if (!media.metadata?.assetId || !media.metadata?.contentVersion) onMediaIdentity(nodeId, identity);
        const order = bindings.filter((binding) => binding.mediaType === mediaType).reduce((max, binding) => Math.max(max, binding.order + 1), 0);
        onBindingsChange([...bindings, { bindingId: nanoid(), assetId: identity.assetId, nodeId, mediaType, usage: usageByMedia[mediaType][0], order }]);
    };

    return (
        <section className="mt-2 rounded-lg border px-2 py-2" style={{ borderColor: theme.toolbar.border }} data-canvas-no-zoom>
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium">{t("canvas.videoInput.manage")}</div>
                <Button size="small" type="text" className="!bg-transparent" icon={<Plus className="size-3.5" />} onClick={() => onSubjectsChange([...subjects, { subjectId: nanoid(), name: `${t("canvas.videoInput.subject")} ${subjects.length + 1}`, description: "" }])}>{t("canvas.videoInput.addSubject")}</Button>
            </div>
            {subjects.map((subject) => (
                <div key={subject.subjectId} className="mb-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_28px] gap-1">
                    <Input size="small" aria-label={t("canvas.videoInput.subjectName")} value={subject.name} placeholder={t("canvas.videoInput.subjectName")} onChange={(event) => onSubjectsChange(subjects.map((item) => item.subjectId === subject.subjectId ? { ...item, name: event.target.value } : item))} />
                    <Input size="small" aria-label={t("canvas.videoInput.subjectDescription")} value={subject.description} placeholder={t("canvas.videoInput.subjectDescription")} onChange={(event) => onSubjectsChange(subjects.map((item) => item.subjectId === subject.subjectId ? { ...item, description: event.target.value } : item))} />
                    <Button size="small" type="text" aria-label={t("canvas.videoInput.remove")} icon={<Trash2 className="size-3" />} onClick={() => onSubjectsChange(subjects.filter((item) => item.subjectId !== subject.subjectId))} />
                </div>
            ))}
            <div className="mt-2 mb-1 flex items-center justify-between gap-2">
                <span className="text-xs opacity-70">{t("canvas.videoInput.media")}</span>
                <Select size="small" className="w-40" value={selectedMediaId} placeholder={t("canvas.videoInput.addBinding")} options={mediaNodes.map((media) => ({ value: media.id, label: media.title || media.id }))} onChange={(nodeId) => { addBinding(nodeId); setSelectedMediaId(""); }} />
            </div>
            {bindings.map((binding) => {
                const media = nodes.find((item) => item.id === binding.nodeId);
                return (
                    <div key={binding.bindingId} className="mb-1 grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_52px_28px] items-center gap-1">
                        <span className="truncate text-xs" title={media?.title || binding.nodeId}>{media?.title || binding.nodeId}</span>
                        <Select size="small" value={binding.subjectId || ""} options={[{ value: "", label: t("canvas.videoInput.subject") }, ...subjects.map((subject) => ({ value: subject.subjectId, label: subject.name }))]} onChange={(subjectId) => patchBinding(binding.bindingId, { subjectId: subjectId || undefined })} />
                        <Select size="small" value={binding.usage} options={usageByMedia[binding.mediaType].map((usage) => ({ value: usage, label: t(`canvas.videoInput.usages.${usage}`) }))} onChange={(usage) => patchBinding(binding.bindingId, { usage })} />
                        <InputNumber size="small" className="w-full" min={0} precision={0} value={binding.order} onChange={(order) => typeof order === "number" && patchBinding(binding.bindingId, { order })} aria-label={t("canvas.videoInput.order")} />
                        <Button size="small" type="text" aria-label={t("canvas.videoInput.remove")} icon={<Trash2 className="size-3" />} onClick={() => onBindingsChange(bindings.filter((item) => item.bindingId !== binding.bindingId))} />
                    </div>
                );
            })}
            {!bindings.length ? <div className="text-xs opacity-60">{t("canvas.videoInput.noBindings")}</div> : null}
        </section>
    );
}
