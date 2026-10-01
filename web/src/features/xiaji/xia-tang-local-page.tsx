"use client";

// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw's虾塘 asset workspace; data and operations use the local Asset store.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Input, Modal, Select, Switch, Tooltip } from "antd";
import { Clapperboard, Image as ImageIcon, Mic, Plus, Search, Star, Trash2, Upload, Users, Volume2 } from "lucide-react";

import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { createXiaTangAssetInput, findXiaTangChildren, getXiaTangCurrentMediaId, getXiaTangRecord, isXiaTangAsset, listXiaTangMediaVersions, listXiaTangProjectAssets, patchXiaTangFields, setXiaTangCurrentMediaId, type XiaTangDomain, type XiaTangRecord, type XiaTangRecordType } from "./xia-tang-local-model";
import { uploadImage } from "@/services/image-storage";
import { uploadLocalWorkspaceFile } from "@/services/api/local-workspace";
import { getMediaBlob } from "@/services/file-storage";
import type { UploadedFile } from "@/services/file-storage";
import { trimDecodedAudioToWav } from "./audio-trim";
import { parseSceneEnvironmentPrompt, SCENE_ENVIRONMENT_SECTIONS, serializeSceneEnvironmentPrompt, type SceneEnvironmentFields } from "./scene-environment";
import { getXiaTangVoiceSlotRows } from "./voice-slot-layout";
import { LocalAssetBeatReferences } from "./local-asset-beat-references";

const DOMAIN_LABELS: Record<XiaTangDomain, string> = { character: "角色", scene: "场景", prop: "道具", voice: "声线" };
const DOMAIN_TABS: XiaTangDomain[] = ["character", "scene", "prop", "voice"];
const VALUE_LABELS: Record<string, string> = {
    主角: "主角", 配角: "配角", 反派: "反派", interior: "室内", exterior: "室外", mixed: "内外景", other: "其他",
    weapon: "武器", accessory: "配饰", artifact: "特殊物品", document: "文书", furniture: "家具", object: "其他物件",
    default: "默认", child: "儿童", youth: "青年", middle: "中年", elder: "老年", narrator: "项目旁白",
};
const VOICE_SLOTS = [
    { key: "default", label: "默认" },
    { key: "child", label: "儿童" },
    { key: "youth", label: "青年" },
    { key: "middle", label: "中年" },
    { key: "elder", label: "老年" },
] as const;

type FieldDefinition = {
    key: string;
    label: string;
    multiline?: boolean;
    list?: boolean;
    boolean?: boolean;
    options?: Array<{ value: string; label: string }>;
    optionSource?: "characters";
};

const EDITOR_FIELDS: Record<string, FieldDefinition[]> = {
    character: [
        { key: "name", label: "姓名" }, { key: "aliases", label: "别名", list: true },
        { key: "role", label: "角色定位", options: [{ value: "主角", label: "主角" }, { value: "配角", label: "配角" }, { value: "反派", label: "反派" }] }, { key: "gender", label: "性别", options: [{ value: "女", label: "女" }, { value: "男", label: "男" }] },
        { key: "age_group", label: "年龄段", options: [{ value: "child", label: "儿童" }, { value: "youth", label: "青年" }, { value: "middle", label: "中年" }, { value: "elder", label: "老年" }] },
        { key: "body_type", label: "身形" }, { key: "appearance_details", label: "外貌与服装", multiline: true },
        { key: "face_prompt", label: "面部提示词", multiline: true }, { key: "description", label: "描述", multiline: true },
        { key: "is_main", label: "主角", boolean: true },
    ],
    identity: [
        { key: "identity_name", label: "身份/造型名称" }, { key: "age_group", label: "年龄段", options: [{ value: "child", label: "儿童" }, { value: "youth", label: "青年" }, { value: "middle", label: "中年" }, { value: "elder", label: "老年" }] },
        { key: "appearance_details", label: "外貌与服装", multiline: true }, { key: "body_type", label: "体型" },
        { key: "face_prompt", label: "面部提示词", multiline: true }, { key: "notes", label: "备注", multiline: true },
    ],
    scene: [
        { key: "name", label: "场景名称" },
        { key: "scene_type", label: "场景类型", options: [{ value: "interior", label: "室内" }, { value: "exterior", label: "室外" }, { value: "mixed", label: "内外景" }, { value: "other", label: "其他" }] },
        { key: "time_of_day", label: "时间" }, { key: "environment_prompt", label: "环境描述提示词", multiline: true },
        { key: "description", label: "叙述性描述", multiline: true }, { key: "notes", label: "备注", multiline: true },
    ],
    variant: [
        { key: "name", label: "变体名称" }, { key: "time_of_day", label: "时间" },
        { key: "variant_prompt", label: "状态变化提示词", multiline: true }, { key: "description", label: "描述", multiline: true },
        { key: "notes", label: "备注", multiline: true },
    ],
    prop: [
        { key: "name", label: "道具名称" }, { key: "aliases", label: "别名", list: true },
        { key: "prop_type", label: "道具类型", options: [{ value: "weapon", label: "武器" }, { value: "accessory", label: "配饰" }, { value: "artifact", label: "特殊物品" }, { value: "document", label: "文书" }, { value: "furniture", label: "家具" }, { value: "object", label: "其他物件" }] },
        { key: "owner", label: "所属角色/持有者" }, { key: "characterId", label: "关联虾塘角色", optionSource: "characters" }, { key: "visual_prompt", label: "视觉提示词", multiline: true },
        { key: "description", label: "描述", multiline: true }, { key: "notes", label: "备注", multiline: true },
    ],
};

export function getXiaTangEditorFields(recordType: XiaTangRecordType, domain: XiaTangDomain): FieldDefinition[] {
    const key = recordType === "identity" ? "identity" : recordType === "variant" ? "variant" : domain;
    return EDITOR_FIELDS[key] || [];
}

function asFields(asset: Asset | null | undefined) {
    return asset ? getXiaTangRecord(asset)?.fields || {} : {};
}

function displayTitle(asset: Asset) {
    const fields = asFields(asset);
    const value = fields.name ?? fields.identity_name;
    return typeof value === "string" && value.trim() ? value : asset.title;
}

function mediaUrl(asset: Asset) {
    if (asset.kind === "image") return asset.data.dataUrl;
    if (asset.kind === "video" || asset.kind === "audio") return asset.data.url;
    const record = getXiaTangRecord(asset);
    const url = record?.fields.url;
    return typeof url === "string" ? url : "";
}

function splitList(value: unknown) {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join(", ");
    return typeof value === "string" ? value : "";
}

function normalizedFormFields(fields: Record<string, unknown>, definitions: FieldDefinition[]) {
    return Object.fromEntries(definitions.map(({ key, list, boolean }) => [
        key,
        boolean ? fields[key] === true
            : list ? String(fields[key] ?? "").split(/[，,、]/).map((part) => part.trim()).filter(Boolean)
                : typeof fields[key] === "string" ? fields[key] : fields[key] ?? "",
    ]));
}

export function XiaTangAssetTabs({ active, onChange }: { active: XiaTangDomain; onChange: (domain: XiaTangDomain) => void }) {
    return (
        <div role="tablist" aria-label="虾塘资产类型" className="flex min-h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-white/10 px-5 sm:px-8">
            {DOMAIN_TABS.map((domain) => (
                <button
                    key={domain}
                    type="button"
                    role="tab"
                    aria-selected={active === domain}
                    className={`relative min-w-20 px-5 py-3 text-sm font-medium transition-colors ${active === domain ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => onChange(domain)}
                >
                    {DOMAIN_LABELS[domain]}
                    {active === domain ? <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
                </button>
            ))}
        </div>
    );
}

export function XiaTangWorkspaceActions({
    projectAssetId,
    activeDomain,
    busy,
    onNavigate,
    onRefresh,
    onAdd,
}: {
    projectAssetId?: string;
    activeDomain: XiaTangDomain;
    busy: boolean;
    onNavigate: (target: "project" | "ingest" | "projects") => void;
    onRefresh: () => void;
    onAdd: () => void;
}) {
    const activeLabel = DOMAIN_LABELS[activeDomain];
    return <div className="flex flex-wrap items-center gap-2">
        {projectAssetId
            ? <Button onClick={() => onNavigate("project")}>返回项目</Button>
            : <><Button onClick={() => onNavigate("ingest")}>虾料</Button><Button onClick={() => onNavigate("projects")}>虾镜项目</Button></>}
        <Button onClick={onRefresh} disabled={busy}>刷新</Button>
        {activeDomain !== "voice" ? <Button type="primary" icon={<Plus className="size-4" />} onClick={onAdd}>新增{activeLabel}</Button> : null}
    </div>;
}

function XiaTangFieldEditor({
    open,
    domain,
    recordType,
    initialFields,
    characters,
    busy,
    onCancel,
    onSubmit,
}: {
    open: boolean;
    domain: XiaTangDomain;
    recordType: XiaTangRecordType;
    initialFields: Record<string, unknown>;
    characters: Asset[];
    busy: boolean;
    onCancel: () => void;
    onSubmit: (values: Record<string, unknown>) => void;
}) {
    const definitions = getXiaTangEditorFields(recordType, domain);
    const [draft, setDraft] = useState<Record<string, unknown>>(() => normalizedFormFields(initialFields, definitions));
    const [environmentSections, setEnvironmentSections] = useState<SceneEnvironmentFields>(() => parseSceneEnvironmentPrompt(typeof initialFields.environment_prompt === "string" ? initialFields.environment_prompt : ""));
    useEffect(() => {
        setDraft(normalizedFormFields(initialFields, definitions));
        setEnvironmentSections(parseSceneEnvironmentPrompt(typeof initialFields.environment_prompt === "string" ? initialFields.environment_prompt : ""));
    }, [open, initialFields, recordType, domain]);
    const title = recordType === "identity" ? "身份/造型" : recordType === "variant" ? "场景变体" : DOMAIN_LABELS[domain];

    return (
        <Modal
            title={recordType === "entity" ? `编辑${title}资料` : `编辑${title}`}
            open={open}
            onCancel={onCancel}
            onOk={() => onSubmit(domain === "scene" && recordType === "entity" ? { ...draft, environment_prompt: serializeSceneEnvironmentPrompt(environmentSections) } : draft)}
            okText="保存"
            cancelText="取消"
            confirmLoading={busy}
            destroyOnHidden
            width={760}
        >
            <div className="grid gap-x-4 sm:grid-cols-2">
                {definitions.map((field) => (
                    <label key={field.key} className={`mb-3 grid gap-1.5 text-sm ${field.multiline ? "sm:col-span-2" : ""}`}>
                        <span>{field.label}</span>
                        {field.boolean ? (
                            <Switch checked={draft[field.key] === true} onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))} />
                        ) : field.optionSource === "characters" ? (
                            <Select
                                allowClear
                                placeholder="未指定"
                                value={typeof draft[field.key] === "string" ? String(draft[field.key]) : undefined}
                                options={characters.map((character) => ({ value: character.id, label: displayTitle(character) }))}
                                onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value || "" }))}
                            />
                        ) : field.options ? (
                            <Select
                                allowClear
                                value={typeof draft[field.key] === "string" ? String(draft[field.key]) : undefined}
                                options={field.options}
                                onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value || "" }))}
                            />
                        ) : domain === "scene" && recordType === "entity" && field.key === "environment_prompt" ? (
                            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                                {SCENE_ENVIRONMENT_SECTIONS.map(({ key, label }) => <label key={key} className="grid gap-1.5"><span className="text-xs text-muted-foreground">{label}</span><Input.TextArea rows={2} value={environmentSections[key]} onChange={(event) => setEnvironmentSections((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
                            </div>
                        ) : field.multiline ? (
                            <Input.TextArea rows={3} value={String(draft[field.key] ?? "")} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
                        ) : (
                            <Input value={field.list ? splitList(draft[field.key]) : String(draft[field.key] ?? "")} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
                        )}
                    </label>
                ))}
            </div>
        </Modal>
    );
}

async function uploadXiaTangMedia(file: File, domain: XiaTangDomain, parentId: string, slot: string, versionOf?: string, projectAssetId?: string): Promise<Omit<Asset, "id" | "createdAt" | "updatedAt">> {
    const base = {
        title: file.name || `${DOMAIN_LABELS[domain]}素材`,
        coverUrl: "",
        tags: [] as string[],
        category: `xia-tang:${domain}`,
        source: "虾塘本地上传",
    };
    const metadataFor = (fields: Record<string, unknown> = {}) => ({
        xiaTang: {
            schemaVersion: 1,
            domain,
            recordType: "media" as const,
            parentId,
            slot,
            ...(projectAssetId ? { projectAssetId } : {}),
            ...(versionOf ? { versionOf } : {}),
            fields: { fileName: file.name, ...fields },
        },
    });

    if (file.type.startsWith("image/")) {
        const uploaded = await uploadImage(file, { localOnly: true });
        return { ...base, kind: "image", data: { dataUrl: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType }, metadata: metadataFor() } as Omit<Asset, "id" | "createdAt" | "updatedAt">;
    }

    const uploaded: UploadedFile = await uploadLocalWorkspaceFile(file, file.name || "xia-tang-media");
    if (file.type.startsWith("video/")) {
        return { ...base, kind: "video", data: { url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width || 0, height: uploaded.height || 0, bytes: uploaded.bytes, mimeType: uploaded.mimeType }, metadata: metadataFor() } as Omit<Asset, "id" | "createdAt" | "updatedAt">;
    }
    if (file.type.startsWith("audio/")) {
        return { ...base, kind: "audio", data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType }, metadata: metadataFor() } as Omit<Asset, "id" | "createdAt" | "updatedAt">;
    }
    return {
        ...base,
        kind: "text",
        data: { content: file.name },
        metadata: metadataFor({ url: uploaded.url, storageKey: uploaded.storageKey, mimeType: uploaded.mimeType, bytes: uploaded.bytes, fileName: file.name, fileOnly: true }),
    } as Omit<Asset, "id" | "createdAt" | "updatedAt">;
}

function XiaTangMediaSlot({
    parentId,
    domain,
    slot,
    title,
    assets,
    multiple = false,
    versioned = !multiple,
    currentAssetId,
    accept,
    onUpload,
    onUnlink,
    onPreview,
    onTrim,
    onSetCurrent,
}: {
    parentId: string;
    domain: XiaTangDomain;
    slot: string;
    title: string;
    assets: Asset[];
    multiple?: boolean;
    versioned?: boolean;
    currentAssetId?: string;
    accept?: string;
    onUpload: (parentId: string, domain: XiaTangDomain, slot: string, files: File[], versionOf?: string, versioned?: boolean) => void;
    onUnlink: (asset: Asset) => void;
    onPreview: (asset: Asset) => void;
    onTrim?: (asset: Asset) => void;
    onSetCurrent?: (asset: Asset) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const files = assets.filter((asset) => {
        const record = getXiaTangRecord(asset);
        return record?.recordType === "media" && record.parentId === parentId && record.slot === slot;
    });
    const displayedFiles = versioned ? listXiaTangMediaVersions(assets, parentId, slot) : files;

    return (
        <section aria-label={title} className="min-w-0 rounded-lg border border-border/70 bg-card/40 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                    <h4 className="text-sm font-medium">{title}</h4>
                    <p className="text-xs text-muted-foreground">{files.length ? `${files.length} 个本地${versioned ? "版本" : "文件"}` : "暂无文件"}</p>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        ref={inputRef}
                        aria-label={`上传${title}`}
                        className="hidden"
                        type="file"
                        accept={accept || "image/*,video/*,audio/*,.glb,.gltf,.obj,.fbx,.ply,.zip,.json"}
                        multiple={multiple}
                        onChange={(event) => {
                            const chosen = Array.from(event.currentTarget.files || []);
                            if (chosen.length) onUpload(parentId, domain, slot, chosen, versioned ? currentAssetId : undefined, versioned);
                            event.currentTarget.value = "";
                        }}
                    />
                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => inputRef.current?.click()}>上传</Button>
                </div>
            </div>
            {files.length ? (
                <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                    {displayedFiles.map((asset, index) => {
                        const src = mediaUrl(asset);
                        return (
                            <article key={asset.id} className="min-w-0 overflow-hidden rounded-md border border-border/60 bg-background/50">
                                <button type="button" className="block w-full text-left" onClick={() => onPreview(asset)} aria-label={`预览${asset.title}`}>
                                    {asset.kind === "image" && src ? <img src={src} alt={asset.title} className="h-36 w-full bg-black/20 object-contain" />
                                        : asset.kind === "video" && src ? <div className="grid h-36 place-items-center bg-black/20"><Clapperboard className="size-8 text-muted-foreground" /><span className="sr-only">视频，打开以预览</span></div>
                                            : asset.kind === "audio" && src ? <div className="flex h-36 flex-col items-center justify-center gap-3 p-3"><Volume2 className="size-8 text-muted-foreground" /><span className="text-xs text-muted-foreground">音频，打开以试听</span></div>
                                                : <div className="flex h-36 flex-col items-center justify-center gap-2 text-muted-foreground"><ImageIcon className="size-7" /><span className="max-w-full truncate px-2 text-xs">{asset.title}</span></div>}
                                </button>
                                <div className="flex min-w-0 items-center justify-between gap-2 border-t border-border/50 p-2">
                                    <Tooltip title={asset.title}><span className="min-w-0 truncate text-xs">{asset.title}</span></Tooltip>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {versioned ? currentAssetId === asset.id ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">当前版本</span> : <Button size="small" type="link" onClick={() => onSetCurrent?.(asset)}>设为当前</Button> : null}
                                        {versioned ? <span className="text-[10px] text-muted-foreground">v{index + 1}</span> : null}
                                        {onTrim && asset.kind === "audio" ? <Button size="small" type="link" onClick={() => onTrim(asset)}>裁剪</Button> : null}
                                        <Button size="small" type="text" danger aria-label={`解除${asset.title}关联`} onClick={() => onUnlink(asset)}><Trash2 className="size-3.5" /></Button>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            ) : <div className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">暂无{title}，可上传本地文件。</div>}
        </section>
    );
}

function XiaTangMediaPreview({ asset }: { asset: Asset }) {
    const src = mediaUrl(asset);
    if (asset.kind === "text") return <pre className="max-h-[72vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-4 text-sm">{asset.data.content || asset.title}</pre>;
    if (!src) return <p className="py-12 text-center text-sm text-muted-foreground">本地文件引用不可用</p>;
    if (asset.kind === "image") return <img src={src} alt={asset.title} className="mx-auto max-h-[72vh] max-w-full object-contain" />;
    if (asset.kind === "video") return <video src={src} controls className="mx-auto max-h-[72vh] max-w-full" />;
    return <audio src={src} controls className="w-full" />;
}

function detailRows(asset: Asset, domain: XiaTangDomain, allAssets: Asset[]) {
    const fields = asFields(asset);
    const recordType = getXiaTangRecord(asset)?.recordType;
    const key = recordType === "identity" ? "identity" : recordType === "variant" ? "variant" : domain;
    return (EDITOR_FIELDS[key] || []).filter(({ key: fieldKey }) => fields[fieldKey] !== undefined && fields[fieldKey] !== "").map(({ key: fieldKey, label }) => {
        let value = fields[fieldKey];
        if (fieldKey === "aliases") value = Array.isArray(value) ? value.join("、") : value;
        if (fieldKey === "characterId") {
            const character = allAssets.find((candidate) => candidate.id === value);
            value = character ? displayTitle(character) : "未关联角色";
        }
        if (typeof value === "boolean") value = value ? "是" : "否";
        return { key: fieldKey, label, value: typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value) };
    });
}

function XiaTangSourceUnavailable({ title, reason }: { title: string; reason: string }) {
    return <Tooltip title={reason}><Button disabled aria-label={`${title}（当前不可用）`} title={reason}>{title}</Button></Tooltip>;
}

function mediaDescendants(assets: Asset[], rootId: string) {
    const found: Asset[] = [];
    const seen = new Set<string>([rootId]);
    const queue = [rootId];
    while (queue.length) {
        const parentId = queue.shift()!;
        for (const child of findXiaTangChildren(assets, parentId)) {
            if (seen.has(child.id)) continue;
            seen.add(child.id);
            found.push(child);
            if (getXiaTangRecord(child)?.recordType !== "media") queue.push(child.id);
        }
    }
    return found;
}

function cloneAudioReference(source: Asset, parentId: string, slot: string, projectAssetId?: string): Omit<Asset, "id" | "createdAt" | "updatedAt"> | null {
    if (source.kind !== "audio") return null;
    return {
        ...source,
        title: `${source.title} · 虾塘`,
        category: "xia-tang:voice",
        source: "虾塘本地音频引用",
        tags: [...source.tags],
        metadata: {
            ...(source.metadata || {}),
            xiaTang: { schemaVersion: 1, domain: "voice", recordType: "media", parentId, slot, ...(projectAssetId ? { projectAssetId } : {}), fields: { linkedAssetId: source.id } },
        },
    } as Omit<Asset, "id" | "createdAt" | "updatedAt">;
}

export function XiaTangLocalPage({ projectAssetId }: { projectAssetId?: string } = {}) {
    const router = useRouter();
    const { message } = App.useApp();
    const storedAssets = useAssetStore((state) => state.assets);
    const assets = useMemo(() => projectAssetId ? listXiaTangProjectAssets(storedAssets, projectAssetId) : storedAssets, [projectAssetId, storedAssets]);
    const workspaceError = useAssetStore((state) => state.workspaceError);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [assetsHydrated, setAssetsHydrated] = useState(() => useAssetStore.persist.hasHydrated());
    const [activeDomain, setActiveDomain] = useState<XiaTangDomain>("character");
    const [query, setQuery] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [tagFilter, setTagFilter] = useState("all");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedAudioId, setSelectedAudioId] = useState("");
    const [editor, setEditor] = useState<{ assetId?: string; domain: XiaTangDomain; recordType: XiaTangRecordType; parentId?: string; fields: Record<string, unknown> } | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
    const [preview, setPreview] = useState<Asset | null>(null);
    const [busy, setBusy] = useState(false);
    const [operationError, setOperationError] = useState("");
    const [recordingTarget, setRecordingTarget] = useState<{ parentId: string; slot: string; label: string } | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
    const [recordedPreviewUrl, setRecordedPreviewUrl] = useState("");
    const [trimTarget, setTrimTarget] = useState<Asset | null>(null);
    const [trimStart, setTrimStart] = useState("0");
    const [trimDuration, setTrimDuration] = useState("4");
    const [trimError, setTrimError] = useState("");
    const voiceUploadTarget = useRef<{ ownerId: string | null; slot: string; label: string } | null>(null);
    const voiceFileInput = useRef<HTMLInputElement>(null);
    const recorder = useRef<MediaRecorder | null>(null);
    const recordingStream = useRef<MediaStream | null>(null);
    const recordingChunks = useRef<Blob[]>([]);

    useEffect(() => {
        if (useAssetStore.persist.hasHydrated()) {
            setAssetsHydrated(true);
            return;
        }
        return useAssetStore.persist.onFinishHydration(() => setAssetsHydrated(true));
    }, []);

    useEffect(() => () => {
        try { recorder.current?.stop(); } catch { /* already stopped */ }
        recordingStream.current?.getTracks().forEach((track) => track.stop());
    }, []);

    useEffect(() => {
        return () => { if (recordedPreviewUrl) URL.revokeObjectURL(recordedPreviewUrl); };
    }, [recordedPreviewUrl]);

    const recordsByDomain = useMemo(() => Object.fromEntries(DOMAIN_TABS.map((domain) => [
        domain,
        assets.filter((asset) => isXiaTangAsset(asset, domain, "entity")),
    ])) as Record<XiaTangDomain, Asset[]>, [assets]);
    const characters = recordsByDomain.character;
    const scenes = recordsByDomain.scene;
    const sceneVariants = assets.filter((asset) => isXiaTangAsset(asset, "scene", "variant"));
    const voices = assets.filter((asset) => isXiaTangAsset(asset, "voice", "voice-slot"));
    const mediaAssets = assets.filter((asset) => getXiaTangRecord(asset)?.recordType === "media");
    const textRecords = assets.filter((asset) => {
        const record = getXiaTangRecord(asset);
        return asset.kind === "text" && record && record.recordType !== "media";
    });
    const topRecords = activeDomain === "scene"
        ? [...scenes, ...sceneVariants]
        : activeDomain === "voice" ? voices : recordsByDomain[activeDomain];
    const categoryField = activeDomain === "character" ? "role" : activeDomain === "scene" ? "scene_type" : activeDomain === "prop" ? "prop_type" : "slot";
    const categoryOptions = Array.from(new Set(topRecords.map((asset) => {
        const record = getXiaTangRecord(asset);
        return String(asFields(asset)[categoryField] ?? (activeDomain === "voice" ? record?.slot : "") ?? "").trim();
    }).filter(Boolean)));
    const tagOptions = Array.from(new Set(topRecords.flatMap((asset) => asset.tags))).filter(Boolean);
    const visibleRecords = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return topRecords.filter((asset) => {
            const fields = asFields(asset);
            const record = getXiaTangRecord(asset);
            const category = String(fields[categoryField] ?? (activeDomain === "voice" ? record?.slot : "") ?? "").trim();
            if (categoryFilter !== "all" && category !== categoryFilter) return false;
            if (tagFilter !== "all" && !asset.tags.includes(tagFilter)) return false;
            if (!needle) return true;
            const flattened = [asset.title, ...asset.tags, ...Object.values(fields).flatMap((value) => Array.isArray(value) ? value : [value]), record?.slot]
                .filter((value) => value != null)
                .map(String)
                .join(" ")
                .toLocaleLowerCase();
            return flattened.includes(needle);
        });
    }, [activeDomain, categoryField, categoryFilter, query, tagFilter, topRecords]);
    const selectedRecord = topRecords.find((asset) => asset.id === selectedId) || visibleRecords[0] || topRecords[0] || null;
    const selectedRecordType = selectedRecord ? getXiaTangRecord(selectedRecord)?.recordType || "entity" : "entity";
    const selectedSceneRoot = selectedRecord && activeDomain === "scene" && selectedRecordType === "variant"
        ? assets.find((asset) => asset.id === getXiaTangRecord(selectedRecord)?.parentId) || null
        : selectedRecord;
    const selectedDetailFields = asFields(selectedRecord);
    const audioAssets = assets.filter((asset) => asset.kind === "audio" && getXiaTangRecord(asset)?.recordType !== "media");
    const rolesWithVoice = useMemo(() => characters.map((character) => {
        const characterVoices = findXiaTangChildren(assets, character.id).filter((asset) => getXiaTangRecord(asset)?.recordType === "voice-slot");
        const ready = characterVoices.filter((slot) => findXiaTangChildren(assets, slot.id).some((child) => getXiaTangRecord(child)?.recordType === "media" && child.kind === "audio")).length;
        return { character, characterVoices, ready };
    }), [assets, characters]);

    useEffect(() => {
        if (activeDomain === "voice") return;
        if (selectedId && topRecords.some((asset) => asset.id === selectedId)) return;
        setSelectedId(visibleRecords[0]?.id || topRecords[0]?.id || null);
    }, [activeDomain, selectedId, topRecords, visibleRecords]);

    const openCreate = (domain = activeDomain, recordType: XiaTangRecordType = "entity", parentId?: string) => {
        setOperationError("");
        setEditor({
            domain,
            recordType,
            parentId,
            fields: recordType === "entity" ? domain === "character" ? { name: "", aliases: [], is_main: false } : { name: "" } : {},
        });
    };

    const openEdit = (asset: Asset) => {
        const record = getXiaTangRecord(asset);
        if (!record) return;
        setOperationError("");
        setEditor({ assetId: asset.id, domain: record.domain, recordType: record.recordType, parentId: record.parentId, fields: record.fields });
    };

    const saveEditor = (values: Record<string, unknown>) => {
        const current = editor;
        if (!current) return;
        const definitions = EDITOR_FIELDS[current.recordType === "identity" ? "identity" : current.recordType === "variant" ? "variant" : current.domain];
        const normalized = normalizedFormFields(values, definitions);
        const nameField = current.recordType === "identity" ? "identity_name" : "name";
        if (typeof normalized[nameField] === "string" && !(normalized[nameField] as string).trim()) {
            setOperationError("名称不能为空");
            return;
        }
        setBusy(true);
        try {
            if (current.assetId) {
                const asset = useAssetStore.getState().assets.find((item) => item.id === current.assetId);
                if (!asset) throw new Error("要编辑的虾塘条目已不存在");
                updateAsset(asset.id, patchXiaTangFields(asset, normalized));
                message.success("已保存虾塘资料");
            } else {
                const input = createXiaTangAssetInput(current.domain, normalized, { recordType: current.recordType, parentId: current.parentId, projectAssetId });
                const id = addAsset(input);
                if (current.recordType === "entity" && current.domain !== "voice") setSelectedId(id);
                if (current.recordType === "variant") setSelectedId(id);
                message.success(`已添加${DOMAIN_LABELS[current.domain]}${current.recordType === "identity" ? "身份" : current.recordType === "variant" ? "变体" : ""}`);
            }
            setEditor(null);
        } catch (cause) {
            setOperationError(cause instanceof Error ? cause.message : "保存虾塘资料失败");
        } finally {
            setBusy(false);
        }
    };

    const uploadFiles = async (parentId: string, domain: XiaTangDomain, slot: string, files: File[], versionOf?: string, versioned = false) => {
        setBusy(true);
        setOperationError("");
        const succeeded: string[] = [];
        const failed: string[] = [];
        let previousVersionId = versionOf;
        for (const file of files) {
            try {
                const input = await uploadXiaTangMedia(file, domain, parentId, slot, versioned ? previousVersionId : undefined, projectAssetId);
                const id = addAsset(input);
                succeeded.push(id);
                if (versioned) previousVersionId = id;
            } catch (cause) {
                failed.push(`${file.name}: ${cause instanceof Error ? cause.message : "上传失败"}`);
            }
        }
        if (versioned && succeeded.length) {
            const latestAssets = useAssetStore.getState().assets;
            const parent = latestAssets.find((asset) => asset.id === parentId);
            if (parent) updateAsset(parent.id, setXiaTangCurrentMediaId(parent, latestAssets, slot, succeeded[succeeded.length - 1]));
        }
        setBusy(false);
        if (failed.length) {
            setOperationError(failed.join("；"));
            if (succeeded.length) message.warning(`成功保存 ${succeeded.length} 个文件，${failed.length} 个文件失败`);
        } else if (succeeded.length) message.success(`已将 ${succeeded.length} 个文件保存到虾塘`);
    };

    const unlinkMedia = (asset: Asset) => {
        const metadata = { ...(asset.metadata || {}) };
        delete metadata.xiaTang;
        updateAsset(asset.id, { metadata });
        message.info("已解除虾塘关联；本地文件仍保留在素材库和已引用的画布中");
    };

    const confirmDelete = () => {
        if (!deleteTarget) return;
        const descendants = mediaDescendants(useAssetStore.getState().assets, deleteTarget.id);
        const recordIds = new Set([deleteTarget.id, ...descendants.filter((item) => item.kind === "text" && getXiaTangRecord(item)?.recordType !== "media").map((item) => item.id)]);
        descendants.filter((item) => getXiaTangRecord(item)?.recordType === "media").forEach((item) => {
            const metadata = { ...(item.metadata || {}) };
            delete metadata.xiaTang;
            updateAsset(item.id, { metadata });
        });
        if (getXiaTangRecord(deleteTarget)?.domain === "character") {
            useAssetStore.getState().assets.filter((item) => isXiaTangAsset(item, "prop", "entity") && asFields(item).characterId === deleteTarget.id).forEach((prop) => updateAsset(prop.id, patchXiaTangFields(prop, { characterId: "" })));
        }
        for (const id of recordIds) removeAsset(id);
        setSelectedId(null);
        setDeleteTarget(null);
        message.success("已删除虾塘记录；关联媒体文件已保留");
    };

    const findVoiceSlot = (ownerId: string | null, slot: string) => useAssetStore.getState().assets.find((asset) => {
        const record = getXiaTangRecord(asset);
        if (record?.domain !== "voice" || record.recordType !== "voice-slot" || record.slot !== slot) return false;
        if (projectAssetId && record.projectAssetId !== projectAssetId) return false;
        return ownerId ? record.parentId === ownerId : record.fields.ownerType === "project" && record.fields.ownerId === "local";
    }) || null;

    const ensureVoiceSlot = (ownerId: string | null, slot: string, label: string) => {
        const current = findVoiceSlot(ownerId, slot);
        if (current) return current.id;
        const input = createXiaTangAssetInput("voice", { name: ownerId ? `${label}声线` : "项目旁白声线", ownerType: ownerId ? "character" : "project", ownerId: ownerId || "local", slot }, { recordType: "voice-slot", parentId: ownerId || undefined, projectAssetId, slot, title: ownerId ? `${label} · ${slot}声线` : "项目旁白声线" });
        return addAsset(input);
    };

    const addExistingAudio = (ownerId: string | null, slot: string, label: string) => {
        const source = useAssetStore.getState().assets.find((asset) => asset.id === selectedAudioId);
        if (!source || source.kind !== "audio") return;
        const slotId = ensureVoiceSlot(ownerId, slot, label);
        const input = cloneAudioReference(source, slotId, "sample", projectAssetId);
        if (!input) return;
        addAsset(input);
        setSelectedAudioId("");
        message.success("已将本地音频关联到声线槽位");
    };

    const startRecording = async (ownerId: string | null, slot: string, label: string) => {
        setOperationError("");
        try {
            const parentId = ensureVoiceSlot(ownerId, slot, label);
            if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("此浏览器不支持本地录音");
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            recordingStream.current = stream;
            recordingChunks.current = [];
            const nextRecorder = new MediaRecorder(stream);
            recorder.current = nextRecorder;
            nextRecorder.ondataavailable = (event) => { if (event.data.size) recordingChunks.current.push(event.data); };
            nextRecorder.onstop = () => {
                const type = nextRecorder.mimeType || "audio/webm";
                const blob = new Blob(recordingChunks.current, { type });
                setRecordedBlob(blob);
                setRecordedPreviewUrl(blob.size ? URL.createObjectURL(blob) : "");
                setIsRecording(false);
                recordingStream.current?.getTracks().forEach((track) => track.stop());
                recordingStream.current = null;
            };
            setRecordingTarget({ parentId, slot: "sample", label });
            nextRecorder.start();
            setIsRecording(true);
        } catch (cause) {
            setOperationError(cause instanceof Error ? cause.message : "无法开始录音");
        }
    };

    const stopRecording = () => {
        if (recorder.current?.state === "recording") recorder.current.stop();
    };

    const cancelRecording = () => {
        if (recorder.current?.state === "recording") recorder.current.stop();
        recordingStream.current?.getTracks().forEach((track) => track.stop());
        recordingStream.current = null;
        setRecordingTarget(null);
        setRecordedBlob(null);
        setIsRecording(false);
        if (recordedPreviewUrl) URL.revokeObjectURL(recordedPreviewUrl);
        setRecordedPreviewUrl("");
    };

    const saveRecording = async () => {
        if (!recordingTarget || !recordedBlob) return;
        setBusy(true);
        try {
            const extension = recordedBlob.type.includes("ogg") ? "ogg" : recordedBlob.type.includes("wav") ? "wav" : "webm";
            const file = new File([recordedBlob], `${recordingTarget.label}-${Date.now()}.${extension}`, { type: recordedBlob.type || "audio/webm" });
            addAsset(await uploadXiaTangMedia(file, "voice", recordingTarget.parentId, recordingTarget.slot, undefined, projectAssetId));
            message.success("录音已保存到本地虾塘");
            cancelRecording();
        } catch (cause) {
            setOperationError(cause instanceof Error ? cause.message : "录音保存失败");
        } finally {
            setBusy(false);
        }
    };

    const trimVoice = async () => {
        if (!trimTarget || trimTarget.kind !== "audio") return;
        const record = getXiaTangRecord(trimTarget);
        if (!record?.parentId || !record.slot) {
            setTrimError("声线关联信息缺失，无法保存裁剪版本");
            return;
        }
        setBusy(true);
        setTrimError("");
        let context: AudioContext | null = null;
        try {
            const localBlob = trimTarget.data.storageKey ? await getMediaBlob(trimTarget.data.storageKey).catch(() => null) : null;
            const blob: Blob = localBlob instanceof Blob ? localBlob : await fetch(trimTarget.data.url).then(async (response) => {
                if (!response.ok) throw new Error(`读取音频失败（${response.status}）`);
                return response.blob();
            });
            const AudioContextConstructor = window.AudioContext;
            context = new AudioContextConstructor();
            const decoded = await context.decodeAudioData(await blob.arrayBuffer());
            const wav = trimDecodedAudioToWav(decoded, Number(trimStart), Number(trimDuration));
            const file = new File([wav], `${trimTarget.title.replace(/\.[^.]+$/, "")}-trim.wav`, { type: "audio/wav" });
            addAsset(await uploadXiaTangMedia(file, "voice", record.parentId, record.slot, trimTarget.id, projectAssetId));
            setTrimTarget(null);
            message.success("已保存裁剪后的声线版本；原文件仍保留");
        } catch (cause) {
            setTrimError(cause instanceof Error ? cause.message : "裁剪音频失败");
        } finally {
            await context?.close().catch(() => undefined);
            setBusy(false);
        }
    };

    const uploadVoiceSelection = () => {
        const target = voiceUploadTarget.current;
        const input = voiceFileInput.current;
        if (!target || !input) return;
        const ownerName = target.ownerId ? displayTitle(useAssetStore.getState().assets.find((asset) => asset.id === target.ownerId) || ({ title: "角色" } as Asset)) : "项目旁白";
        const parentId = ensureVoiceSlot(target.ownerId, target.slot, ownerName);
        input.dataset.parentId = parentId;
        input.dataset.slot = "sample";
        input.dataset.label = target.label;
        input.click();
    };

    const refreshAssets = async () => {
        try {
            await useAssetStore.getState().refreshWorkspaceAssets();
            message.success("已刷新本地虾塘素材");
        } catch (cause) {
            setOperationError(cause instanceof Error ? cause.message : "刷新本地素材失败");
        }
    };

    const fieldEditorInitial = editor ? (editor.assetId ? asFields(assets.find((asset) => asset.id === editor.assetId)) : editor.fields) : {};
    const activeLabel = DOMAIN_LABELS[activeDomain];
    const charactersTotal = characters.length;
    const identityReady = characters.filter((character) => findXiaTangChildren(assets, character.id).some((child) => getXiaTangRecord(child)?.recordType === "identity")).length;
    const portraitReady = characters.filter((character) => findXiaTangChildren(assets, character.id).some((child) => getXiaTangRecord(child)?.recordType === "media" && getXiaTangRecord(child)?.slot === "portrait")).length;
    const voiceReady = rolesWithVoice.filter((entry) => entry.ready > 0).length;

    const renderMediaSlot = (parentId: string, domain: XiaTangDomain, slot: string, title: string, options: { multiple?: boolean; versioned?: boolean; accept?: string; trim?: (asset: Asset) => void } = {}) => {
        const versioned = options.versioned ?? !options.multiple;
        const currentAssetId = versioned ? getXiaTangCurrentMediaId(assets, parentId, slot) : undefined;
        const onSetCurrent = versioned ? (asset: Asset) => {
            const currentAssets = useAssetStore.getState().assets;
            const parent = currentAssets.find((candidate) => candidate.id === parentId);
            if (!parent) return setOperationError("媒体所属的虾塘条目已不存在");
            try {
                updateAsset(parentId, setXiaTangCurrentMediaId(parent, currentAssets, slot, asset.id));
                message.success("已切换当前媒体版本");
            } catch (cause) {
                setOperationError(cause instanceof Error ? cause.message : "切换媒体版本失败");
            }
        } : undefined;
        return <XiaTangMediaSlot
            key={`${parentId}:${slot}`}
            parentId={parentId}
            domain={domain}
            slot={slot}
            title={title}
            assets={assets}
            multiple={options.multiple}
            versioned={versioned}
            currentAssetId={currentAssetId}
            accept={options.accept}
            onUpload={uploadFiles}
            onUnlink={unlinkMedia}
            onPreview={setPreview}
            onSetCurrent={onSetCurrent}
            onTrim={options.trim}
        />;
    };

    const renderRecordList = () => {
        if (!assetsHydrated) return <p role="status" className="p-5 text-center text-sm text-muted-foreground">正在读取虾塘本地资料…</p>;
        if (workspaceError) return <div role="alert" className="p-5 text-sm text-destructive">本地素材读取失败：{workspaceError}</div>;
        if (!visibleRecords.length) return (
            <div className="grid min-h-64 place-items-center p-6 text-center">
                <div><Clapperboard className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">{query ? `没有匹配的${activeLabel}` : `暂无${activeLabel}`}</p>{activeDomain !== "voice" ? <Button className="mt-3" onClick={() => openCreate(activeDomain)}>新增{activeLabel}</Button> : null}</div>
            </div>
        );

        if (activeDomain === "scene") {
            const entities = visibleRecords.filter((asset) => getXiaTangRecord(asset)?.recordType === "entity");
            const variants = visibleRecords.filter((asset) => getXiaTangRecord(asset)?.recordType === "variant");
            return <ul aria-label="场景列表" className="space-y-1 p-3">{entities.map((scene) => {
                const children = variants.filter((variant) => getXiaTangRecord(variant)?.parentId === scene.id);
                return <li key={scene.id}>
                    <div className={`flex items-center gap-2 rounded-md pr-2 transition-colors ${selectedRecord?.id === scene.id ? "bg-primary/10 text-foreground" : "hover:bg-muted/50"}`}>
                        <button type="button" aria-current={selectedRecord?.id === scene.id ? "true" : undefined} onClick={() => setSelectedId(scene.id)} className="min-w-0 flex-1 rounded-md px-3 py-3 text-left">
                            <span className="block truncate text-sm font-medium">{displayTitle(scene)}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{String(asFields(scene).scene_type || "未分类场景")}</span>
                        </button>
                    </div>
                    {children.length ? <ul className="ml-5 border-l border-border/70 pl-2">{children.map((variant) => <li key={variant.id}><button type="button" aria-current={selectedRecord?.id === variant.id ? "true" : undefined} onClick={() => setSelectedId(variant.id)} className={`my-0.5 w-full rounded-md px-3 py-2 text-left text-xs ${selectedRecord?.id === variant.id ? "bg-primary/10" : "text-muted-foreground hover:bg-muted/50"}`}>↳ {displayTitle(variant)}</button></li>)}</ul> : null}
                </li>;
            })}{variants.filter((variant) => !scenes.some((scene) => scene.id === getXiaTangRecord(variant)?.parentId)).map((variant) => <li key={variant.id}><button type="button" onClick={() => setSelectedId(variant.id)} className="w-full rounded-md px-3 py-2 text-left text-sm">{displayTitle(variant)}</button></li>)}</ul>;
        }

        if (activeDomain === "voice") return <ul aria-label="声线槽位列表" className="space-y-1 p-3">{voices.map((slot) => {
            const record = getXiaTangRecord(slot)!;
            return <li key={slot.id}><button type="button" onClick={() => setSelectedId(slot.id)} className={`w-full rounded-md px-3 py-3 text-left ${selectedRecord?.id === slot.id ? "bg-primary/10" : "hover:bg-muted/50"}`}><span className="block text-sm font-medium">{displayTitle(slot)}</span><span className="text-xs text-muted-foreground">{record.parentId ? displayTitle(assets.find((asset) => asset.id === record.parentId) || ({ title: "角色" } as Asset)) : "项目旁白"} · {VOICE_SLOTS.find((item) => item.key === record.slot)?.label || record.slot}</span></button></li>;
        })}</ul>;

        return <ul aria-label={`${activeLabel}列表`} className={activeDomain === "prop" ? "grid gap-2 p-3 sm:grid-cols-2" : "space-y-1 p-3"}>{visibleRecords.map((record) => {
            const fields = asFields(record);
            const selected = selectedRecord?.id === record.id;
            const portrait = findXiaTangChildren(assets, record.id).find((item) => getXiaTangRecord(item)?.slot === (activeDomain === "prop" ? "reference" : "portrait") && item.kind === "image");
            return <li key={record.id}>
                <div className={`flex items-center gap-2 rounded-md border border-transparent p-2 ${selected ? "bg-primary/10" : "hover:bg-muted/50"}`}>
                    <button type="button" onClick={() => setSelectedId(record.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        {portrait && portrait.kind === "image" ? <img src={portrait.data.dataUrl} alt="" className="size-11 shrink-0 rounded-md object-cover" /> : <span className="grid size-11 shrink-0 place-items-center rounded-md bg-muted/70 text-muted-foreground"><ImageIcon className="size-5" /></span>}
                        <span className="min-w-0"><span className="block truncate text-sm font-medium">{displayTitle(record)}</span><span className="block truncate text-xs text-muted-foreground">{activeDomain === "character" ? String(fields.role || (fields.is_main ? "主角" : "角色资料未填写")) : activeDomain === "prop" ? String(fields.prop_type || "道具") : String(fields.time_of_day || fields.scene_type || "场景")}</span></span>
                    </button>
                    {activeDomain === "character" && fields.is_main === true ? <span title="主角" className="text-amber-400">★</span> : null}
                </div>
            </li>;
        })}</ul>;
    };

    const renderVoiceSlot = (ownerId: string | null, key: string, label: string, required = false) => {
        const ownerName = ownerId ? displayTitle(characters.find((item) => item.id === ownerId) || ({ title: "角色" } as Asset)) : "项目旁白";
        const slotAsset = voices.find((asset) => {
            const record = getXiaTangRecord(asset);
            return record?.slot === key && (ownerId ? record.parentId === ownerId : record.fields.ownerType === "project" && record.fields.ownerId === "local");
        });
        const slotId = slotAsset?.id;
        const sampleAssets = slotId ? findXiaTangChildren(assets, slotId).filter((asset) => getXiaTangRecord(asset)?.recordType === "media" && asset.kind === "audio") : [];
        const defaultSlot = ownerId && key !== "default" ? voices.find((asset) => getXiaTangRecord(asset)?.slot === "default" && getXiaTangRecord(asset)?.parentId === ownerId) : undefined;
        const hasDefaultSample = Boolean(defaultSlot && findXiaTangChildren(assets, defaultSlot.id).some((asset) => getXiaTangRecord(asset)?.recordType === "media" && asset.kind === "audio"));
        const inheritedFromDefault = Boolean(ownerId && key !== "default" && sampleAssets.length === 0 && hasDefaultSample);

        return <section key={`${ownerId || "project"}:${key}`} className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-medium">{label}</h4><p className="text-xs text-muted-foreground">{ownerId ? `${ownerName} · ${required ? "默认声线" : "年龄声线覆盖"}` : "项目旁白参考音频"}{required && sampleAssets.length === 0 ? " · 未配置，角色将无法出声" : inheritedFromDefault ? " · 继承默认声线" : ""}</p></div>
                <div className="flex items-center gap-2"><Button size="small" icon={<Upload className="size-3.5" />} onClick={() => { voiceUploadTarget.current = { ownerId, slot: key, label: `${ownerName}-${label}` }; uploadVoiceSelection(); }}>上传音频</Button><Button size="small" icon={<Mic className="size-3.5" />} onClick={() => void startRecording(ownerId, key, `${ownerName}-${label}`)}>录音</Button></div>
            </div>
            {slotAsset ? <>
                {renderMediaSlot(slotAsset.id, "voice", "sample", `${label}声线样本`, { accept: "audio/*,.wav,.mp3,.m4a,.aac,.ogg,.webm", versioned: false, trim: (asset) => { setTrimTarget(asset); setTrimStart("0"); setTrimDuration("4"); setTrimError(""); } })}
            </> : <div className="rounded-md border border-dashed border-border/70 p-4 text-center"><p className="text-xs text-muted-foreground">{inheritedFromDefault ? "→ 继承默认" : required ? "未配置 → 角色将无法出声" : "未配置"}</p><Button size="small" className="mt-2" onClick={() => { ensureVoiceSlot(ownerId, key, ownerName); message.success("已创建本地声线槽位"); }}>{required ? "创建默认槽位" : "创建年龄覆盖"}</Button></div>}
            <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-56 flex-1 space-y-1 text-xs"><span>从本地素材选择音频</span><Select aria-label={`${label}声线本地素材`} className="w-full" allowClear placeholder="选择本地音频素材" value={selectedAudioId || undefined} options={audioAssets.map((audio) => ({ value: audio.id, label: audio.title }))} onChange={(value) => setSelectedAudioId(value || "")} /></label>
                <Button size="small" disabled={!selectedAudioId} onClick={() => addExistingAudio(ownerId, key, ownerName)}>关联音频</Button>
            </div>
            {sampleAssets.length ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Volume2 className="size-3.5" /><span>试听、裁剪、解除关联均按每个样本分别操作。</span></div> : null}
        </section>;
    };

    const renderVoicePage = () => {
        const narrator = voices.find((asset) => {
            const record = getXiaTangRecord(asset);
            return record?.fields.ownerType === "project" && record.fields.ownerId === "local" && record.slot === "narrator";
        });
        const narratorSamples = narrator ? findXiaTangChildren(assets, narrator.id).filter((asset) => asset.kind === "audio") : [];
        return <div className="mx-auto w-full max-w-[1440px] space-y-5 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">项目旁白声线</h2><p className="mt-1 text-sm text-muted-foreground">管理项目默认解说声线；上传、录制或从本地音频选择。</p></div><XiaTangSourceUnavailable title="自动配置声线" reason="依赖 DramaClaw 的项目分析/任务服务；当前只管理本地录音与音频文件。" /></div>
            <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
                <div><h3 className="text-lg font-medium">项目旁白声线</h3><p className="text-xs text-muted-foreground">管理项目默认解说声线；可上传、录制、从本地音频选择、试听和裁剪。</p></div>
                {narrator ? <div className="rounded-md border border-border/60 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">{narratorSamples[0]?.title || "未设置旁白声线"}</span><div className="flex items-center gap-2"><Button size="small" icon={<Upload className="size-3.5" />} onClick={() => { voiceUploadTarget.current = { ownerId: null, slot: "narrator", label: "项目旁白" }; uploadVoiceSelection(); }}>上传音频</Button></div></div>{renderMediaSlot(narrator.id, "voice", "sample", "项目旁白样本", { accept: "audio/*,.wav,.mp3,.m4a,.aac,.ogg,.webm", trim: (asset) => { setTrimTarget(asset); setTrimStart("0"); setTrimDuration("4"); setTrimError(""); } })}<div className="mt-3 flex flex-wrap items-center gap-2"><Button size="small" icon={<Mic className="size-3.5" />} onClick={() => void startRecording(null, "narrator", "项目旁白")}>录制旁白声线</Button><label className="min-w-56 flex-1 space-y-1 text-xs"><span>项目音频来源</span><Select aria-label="项目旁白音频来源" className="w-full" allowClear placeholder="选择本地项目音频" value={selectedAudioId || undefined} options={audioAssets.map((audio) => ({ value: audio.id, label: audio.title }))} onChange={(value) => setSelectedAudioId(value || "")} /></label><Button size="small" disabled={!selectedAudioId} onClick={() => addExistingAudio(null, "narrator", "项目旁白")}>从项目音频复制</Button></div></div>
                    : <div className="rounded-md border border-dashed border-border/70 p-4 text-center"><p className="text-sm text-muted-foreground">未设置项目旁白声线。</p><div className="mt-3 flex justify-center gap-2"><Button onClick={() => { ensureVoiceSlot(null, "narrator", "项目旁白"); message.success("已创建项目旁白槽位"); }}>创建旁白槽位</Button><Button icon={<Mic className="size-3.5" />} onClick={() => void startRecording(null, "narrator", "项目旁白")}>录制旁白声线</Button></div></div>}
                <p className="text-xs text-muted-foreground">音频文件保存在 Infinite Canvas 本地素材库；删除声线时只解除槽位关联，文件本身仍保留。</p>
            </section>
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">自动提取、音色生成和源端配音任务未接入；本地上传、浏览器录音、试听与裁剪可用。</div>
        </div>;
    };

    const renderDetails = () => {
        if (activeDomain === "voice") return null;
        if (!selectedRecord) return <div className="grid h-full min-h-64 place-items-center p-8 text-center"><div><p className="text-lg font-medium">虾塘还没有{activeLabel}</p><p className="mt-1 text-sm text-muted-foreground">添加资料后，可以在详情中管理关联媒体和版本。</p><Button className="mt-4" type="primary" icon={<Plus className="size-4" />} onClick={() => openCreate(activeDomain)}>新增{activeLabel}</Button></div></div>;
        const record = selectedRecord;
        const fields = asFields(record);
        const children = findXiaTangChildren(assets, record.id);
        const rows = detailRows(record, activeDomain, assets);
        const isVariant = getXiaTangRecord(record)?.recordType === "variant";
        const baseScene = isVariant ? selectedSceneRoot : record;

        if (activeDomain === "character") {
            const identities = children.filter((child) => getXiaTangRecord(child)?.recordType === "identity");
            const portraits = children.filter((child) => getXiaTangRecord(child)?.recordType === "media" && getXiaTangRecord(child)?.slot === "portrait");
            const mediaCurrentBySlot = fields.mediaCurrentBySlot && typeof fields.mediaCurrentBySlot === "object" ? fields.mediaCurrentBySlot as Record<string, string> : {};
            const activePortraitId = mediaCurrentBySlot.portrait || (typeof fields.portraitAssetId === "string" ? fields.portraitAssetId : portraits[0]?.id);
            const activePortrait = portraits.find((item) => item.id === activePortraitId && item.kind === "image");
            return <div className="space-y-5 p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-4">
                        {activePortrait && activePortrait.kind === "image" ? <img src={activePortrait.data.dataUrl} alt={`${displayTitle(record)}肖像`} className="size-20 rounded-lg border border-border/70 object-cover" /> : <div className="grid size-20 place-items-center rounded-lg border border-dashed border-border/70 bg-muted/30"><ImageIcon className="size-7 text-muted-foreground" /></div>}
                        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-semibold">{displayTitle(record)}</h2>{fields.is_main === true ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-500">主角</span> : null}</div><p className="mt-1 text-sm text-muted-foreground">{String(fields.role || "角色资料")}{fields.gender ? ` · ${String(fields.gender)}` : ""}{fields.age_group ? ` · ${String(fields.age_group)}` : ""}</p></div>
                    </div>
                    <div className="flex flex-wrap gap-2"><XiaTangSourceUnavailable title="图片来源" reason="源页面的图片来源选项由 DramaClaw 项目配置接口动态提供；纯本地模式没有对应配置，不能伪造选项。" /><Button onClick={() => openEdit(record)}>编辑资料</Button><Button danger onClick={() => setDeleteTarget(record)}>删除角色</Button></div>
                </div>
                <section className="rounded-lg border border-border/70 bg-card/30 p-4">
                    <div className="mb-3 flex items-center justify-between"><div><h3 className="font-medium">角色资料</h3><p className="text-xs text-muted-foreground">姓名、别名、定位、性别年龄、身形、外貌与面部提示词</p></div><Button size="small" onClick={() => openEdit(record)}>编辑</Button></div>
                    {rows.length ? <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">{rows.map((row) => <div key={row.key} className="min-w-0"><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-sm">{row.value}</dd></div>)}</dl> : <p className="text-sm text-muted-foreground">尚未填写角色资料。</p>}
                </section>
                <LocalAssetBeatReferences assets={storedAssets} assetId={record.id} />
                <div className="grid gap-3 xl:grid-cols-2">
                    {renderMediaSlot(record.id, "character", "portrait", "肖像与历史版本", { accept: "image/*", versioned: true })}
                    {renderMediaSlot(record.id, "character", "reference", "角色参考图", { accept: "image/*", multiple: true })}
                </div>
                <section className="rounded-lg border border-border/70 bg-card/30 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">身份 / 造型</h3><p className="text-xs text-muted-foreground">为同一角色保存不同剧情阶段、年龄或服装状态</p></div><Button size="small" type="primary" onClick={() => openCreate("character", "identity", record.id)}>新增身份</Button></div>
                    {identities.length ? <div className="space-y-4">{identities.map((identity) => <article key={identity.id} className="rounded-md border border-border/60 p-3">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-medium">{displayTitle(identity)}</h4><p className="text-xs text-muted-foreground">{String(asFields(identity).age_group || "年龄未填写")} · {String(asFields(identity).appearance_details || "造型资料未填写")}</p></div><div className="flex gap-2"><Button size="small" onClick={() => openEdit(identity)}>编辑身份</Button><Button size="small" danger onClick={() => setDeleteTarget(identity)}>删除</Button></div></div>
                        <dl className="mb-3 grid gap-2 sm:grid-cols-2">{detailRows(identity, "character", assets).map((row) => <div key={row.key}><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="whitespace-pre-wrap text-sm">{row.value}</dd></div>)}</dl>
                        <div className="grid gap-3 xl:grid-cols-3">{renderMediaSlot(identity.id, "character", "identity-image", "身份图", { accept: "image/*", versioned: true })}{renderMediaSlot(identity.id, "character", "costume", "服装图", { accept: "image/*", versioned: true })}{renderMediaSlot(identity.id, "character", "identity-portrait", "身份肖像", { accept: "image/*", versioned: true })}</div>
                        <LocalAssetBeatReferences assets={storedAssets} assetId={identity.id} />
                    </article>)}</div> : <p className="rounded-md border border-dashed border-border/70 px-4 py-7 text-center text-sm text-muted-foreground">暂无身份/造型，点击“新增身份”添加。</p>}
                </section>
                <section className="rounded-lg border border-border/70 bg-card/30 p-4"><div className="mb-3"><h3 className="font-medium">角色声线</h3><p className="text-xs text-muted-foreground">通常只需上传默认声线；只有年龄变体需要不同声音时再覆盖。</p></div>
                    <div className="space-y-3">{getXiaTangVoiceSlotRows(fields.age_group).map((voiceRow) => renderVoiceSlot(record.id, voiceRow.storageSlot, voiceRow.label, voiceRow.required))}</div>
                </section>
            </div>;
        }

        if (activeDomain === "scene") {
            const root = selectedSceneRoot || record;
            const variants = findXiaTangChildren(assets, root.id).filter((child) => getXiaTangRecord(child)?.recordType === "variant");
            const sourceControl = <XiaTangSourceUnavailable title="从图谱构建" reason="此操作依赖 DramaClaw 图谱与任务服务；当前虾塘只保存本地资料和媒体。" />;
            return <div className="space-y-5 p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">场景资产</p><h2 className="mt-1 text-xl font-semibold">{displayTitle(record)}</h2><p className="mt-1 text-sm text-muted-foreground">地点、环境提示词、场景状态与参考媒体</p></div><div className="flex flex-wrap gap-2"><XiaTangSourceUnavailable title="图片来源" reason="源页面的图片来源选项由 DramaClaw 项目配置接口动态提供；纯本地模式没有对应配置，不能伪造选项。" /><Button onClick={() => openEdit(record)}>编辑场景</Button><Button danger onClick={() => setDeleteTarget(record)}>删除场景</Button>{sourceControl}</div></div>
                {isVariant ? <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">场景变体属于基础场景“{displayTitle(root)}”；基础场景的空间参考仍保存在基础场景记录中。</div> : null}
                <section className="rounded-lg border border-border/70 bg-card/30 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">{isVariant ? "变体资料" : "场景资料"}</h3><p className="text-xs text-muted-foreground">场景类型、时间、环境描述、提示词与备注</p></div>{!isVariant ? <Button size="small" type="primary" onClick={() => openCreate("scene", "variant", root.id)}>添加场景变体</Button> : null}</div>
                    {rows.length ? <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">{rows.map((row) => <div key={row.key} className="min-w-0"><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-sm">{row.value}</dd></div>)}</dl> : <p className="text-sm text-muted-foreground">尚未填写场景资料。</p>}
                </section>
                <LocalAssetBeatReferences assets={storedAssets} assetId={record.id} />
                {!isVariant ? <section className="rounded-lg border border-border/70 bg-card/30 p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-medium">场景变体</h3><p className="text-xs text-muted-foreground">在同一地点下管理白天/夜晚、晴雨、剧情状态等版本</p></div><Button size="small" onClick={() => openCreate("scene", "variant", root.id)}>新增变体</Button></div>
                    {variants.length ? <div className="flex flex-wrap gap-2">{variants.map((variant) => <button key={variant.id} type="button" onClick={() => setSelectedId(variant.id)} className={`rounded-full border px-3 py-1.5 text-sm ${variant.id === record.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}>{displayTitle(variant)}</button>)}</div> : <p className="text-sm text-muted-foreground">暂无场景变体。</p>}
                </section> : null}
                <div className="grid gap-3 xl:grid-cols-2">
                    {renderMediaSlot(isVariant ? record.id : root.id, "scene", "master", "源图 / Master", { accept: "image/*", versioned: true })}
                    {renderMediaSlot(isVariant ? record.id : root.id, "scene", "reverse", "背面图 / Reverse", { accept: "image/*", versioned: true })}
                    {renderMediaSlot(isVariant ? record.id : root.id, "scene", "pano", "360 全景", { accept: "image/*,video/*", versioned: true })}
                    {renderMediaSlot(isVariant ? record.id : root.id, "scene", "spatial-layout", "空间布局图", { accept: "image/*,.json", versioned: true })}
                    {renderMediaSlot(isVariant ? record.id : root.id, "scene", "custom-3d", "自定义 3D 文件", { accept: ".glb,.gltf,.obj,.fbx,.ply,.zip,model/gltf-binary,model/gltf+json", versioned: true })}
                    {renderMediaSlot(isVariant ? record.id : root.id, "scene", "director-world", "导演世界文件", { accept: ".3gs,.glb,.gltf,.json,.zip,.ply", versioned: true })}
                </div>
                <section className="rounded-lg border border-border/70 bg-card/30 p-4"><div className="mb-2"><h3 className="font-medium">空间与导演世界</h3><p className="text-xs text-muted-foreground">相关参考文件可在上方本地上传和预览。</p></div><div className="flex flex-wrap gap-2"><XiaTangSourceUnavailable title="生成 360 全景" reason="DramaClaw 的场景生成任务未移植；当前不会启动远端任务。" /><XiaTangSourceUnavailable title="生成导演世界" reason="DramaClaw 的 Director World/3GS 任务依赖源端服务；Infinite Canvas 当前没有等价的本地导入契约。" /><XiaTangSourceUnavailable title="打开导演世界" reason="导演世界文件格式与目标画布节点没有已验证的本地映射。" /></div></section>
                <div className="flex flex-wrap gap-2">{sourceControl}<XiaTangSourceUnavailable title="生成场景图" reason="依赖 DramaClaw 的生成任务服务；此页不伪造进度或结果。" /></div>
            </div>;
        }

        if (activeDomain === "prop") {
            const references = children.filter((child) => getXiaTangRecord(child)?.recordType === "media" && getXiaTangRecord(child)?.slot === "reference");
            const characterName = typeof fields.characterId === "string" ? displayTitle(characters.find((character) => character.id === fields.characterId) || ({ title: "未关联角色" } as Asset)) : "未关联角色";
            return <div className="space-y-5 p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">道具资产</p><h2 className="mt-1 text-xl font-semibold">{displayTitle(record)}</h2><p className="mt-1 text-sm text-muted-foreground">{String(fields.prop_type || "道具")} · 所属角色：{characterName}</p></div><div className="flex flex-wrap gap-2"><XiaTangSourceUnavailable title="图片来源" reason="源页面的图片来源选项由 DramaClaw 项目配置接口动态提供；纯本地模式没有对应配置，不能伪造选项。" /><Button onClick={() => openEdit(record)}>编辑道具</Button><Button danger onClick={() => setDeleteTarget(record)}>删除道具</Button><XiaTangSourceUnavailable title="生成参考图" reason="生成参考图需要 DramaClaw 任务服务；当前页面只使用本地上传的参考图。" /></div></div>
                <section className="rounded-lg border border-border/70 bg-card/30 p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-medium">道具资料</h3><p className="text-xs text-muted-foreground">名称、别名、类型、所属角色、视觉提示词、描述和备注</p></div><Button size="small" onClick={() => openEdit(record)}>编辑</Button></div>
                    {rows.length ? <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">{rows.map((row) => <div key={row.key} className="min-w-0"><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-sm">{row.key === "characterId" ? characterName : row.value}</dd></div>)}</dl> : <p className="text-sm text-muted-foreground">尚未填写道具资料。</p>}
                </section>
                <LocalAssetBeatReferences assets={storedAssets} assetId={record.id} />
                {renderMediaSlot(record.id, "prop", "reference", "参考图", { accept: "image/*", multiple: true })}
                <div className="flex flex-wrap items-center gap-2"><XiaTangSourceUnavailable title="批量生成参考图" reason="该操作依赖 DramaClaw 批量任务与生成服务；页面不会伪造任务状态。" /><span className="text-xs text-muted-foreground">可在“参考图”中批量上传本地文件。</span></div>
            </div>;
        }

        return null;
    };

    return (
        <main data-testid="xia-tang-page" className="h-full overflow-y-auto bg-background">
            <div className="mx-auto flex min-h-full w-full max-w-[1680px] flex-col">
                <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 px-5 py-5 sm:px-8">
                    <div className="min-w-0"><div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground"><Clapperboard className="size-3.5" /> DramaClaw · 虾塘</div><h1 className="text-2xl font-semibold tracking-tight">{projectAssetId ? `${storedAssets.find((asset) => asset.id === projectAssetId)?.title || "项目"} · 虾塘` : "虾塘"}</h1><p className="mt-1 text-sm text-muted-foreground">管理角色、场景、道具和声线资产；项目内资产可直接在虾镜镜头中关联。</p></div>
                    <XiaTangWorkspaceActions
                        projectAssetId={projectAssetId}
                        activeDomain={activeDomain}
                        busy={busy}
                        onNavigate={(target) => router.push(target === "project" && projectAssetId ? `/xiaji/project/${encodeURIComponent(projectAssetId)}/episodes` : target === "ingest" ? "/xiaji/ingest" : "/xiaji/projects")}
                        onRefresh={() => void refreshAssets()}
                        onAdd={() => openCreate(activeDomain)}
                    />
                </header>
                <XiaTangAssetTabs active={activeDomain} onChange={(domain) => { setActiveDomain(domain); setQuery(""); setCategoryFilter("all"); setTagFilter("all"); }} />
                {workspaceError ? <div role="alert" className="mx-5 mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive sm:mx-8">本地素材读取失败：{workspaceError}</div> : null}
                {operationError ? <div role="alert" className="mx-5 mt-4 flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive sm:mx-8"><span>{operationError}</span><Button size="small" type="text" onClick={() => setOperationError("")}>关闭</Button></div> : null}
                {activeDomain === "character" ? <section className="border-b border-border/50 px-5 py-4 sm:px-8" aria-label="角色统计"><ul className="flex flex-wrap gap-x-8 gap-y-3">
                    <li className="flex items-center gap-2 text-sm"><Users className="size-4 text-muted-foreground" /><span className="text-muted-foreground">角色</span><strong>{charactersTotal}</strong></li>
                    <li className="flex items-center gap-2 text-sm"><Star className="size-4 text-amber-400" /><span className="text-muted-foreground">主角</span><strong>{characters.filter((item) => asFields(item).is_main === true).length}</strong></li>
                    <li className="flex items-center gap-2 text-sm"><ImageIcon className="size-4 text-muted-foreground" /><span className="text-muted-foreground">有肖像</span><strong>{portraitReady}/{charactersTotal}</strong></li>
                    <li className="flex items-center gap-2 text-sm"><FingerprintIcon /><span className="text-muted-foreground">有身份</span><strong>{identityReady}/{charactersTotal}</strong></li>
                    <li className="flex items-center gap-2 text-sm"><Volume2 className="size-4 text-muted-foreground" /><span className="text-muted-foreground">有声线</span><strong>{voiceReady}/{charactersTotal}</strong></li>
                </ul></section> : null}
                {activeDomain === "voice" ? renderVoicePage() : <div className="grid min-h-[640px] flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
                    <aside aria-label={`${activeLabel}列表区域`} className="flex min-h-[420px] min-w-0 flex-col border-b border-border/60 lg:border-b-0 lg:border-r">
                        <div className="space-y-3 border-b border-border/50 p-4"><div className="flex items-center justify-between gap-2"><div><h2 className="font-medium">{activeLabel}列表</h2><p className="text-xs text-muted-foreground">{visibleRecords.length} 项</p></div><Button size="small" type="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate(activeDomain)}>新增</Button></div>
                            <Input aria-label={`搜索${activeLabel}`} placeholder={`搜索${activeLabel}名称、标签和资料`} prefix={<Search className="size-4 text-muted-foreground" />} value={query} allowClear onChange={(event) => setQuery(event.target.value)} />
                            <div className="grid gap-2 sm:grid-cols-2">
                                <label className="grid min-w-0 gap-1 text-xs text-muted-foreground"><span>分类</span><Select aria-label={`${activeLabel}分类筛选`} size="small" value={categoryFilter} onChange={setCategoryFilter} options={[{ value: "all", label: "全部" }, ...categoryOptions.map((value) => ({ value, label: VALUE_LABELS[value] || value }))]} /></label>
                                <label className="grid min-w-0 gap-1 text-xs text-muted-foreground"><span>标签</span><Select aria-label={`${activeLabel}标签筛选`} size="small" value={tagFilter} onChange={setTagFilter} options={[{ value: "all", label: "全部" }, ...tagOptions.map((value) => ({ value, label: value }))]} /></label>
                            </div>
                        </div><div className="min-h-0 flex-1 overflow-y-auto">{renderRecordList()}</div>
                    </aside>
                    <section aria-label={`${activeLabel}详情`} className="min-w-0">{renderDetails()}</section>
                </div>}
            </div>

            <XiaTangFieldEditor open={Boolean(editor)} domain={editor?.domain || activeDomain} recordType={editor?.recordType || "entity"} initialFields={fieldEditorInitial} characters={characters} busy={busy} onCancel={() => setEditor(null)} onSubmit={saveEditor} />
            <Modal title="确认删除虾塘条目" open={Boolean(deleteTarget)} okText="确认删除" cancelText="取消" okButtonProps={{ danger: true }} onCancel={() => setDeleteTarget(null)} onOk={confirmDelete} destroyOnHidden><p>删除“{deleteTarget ? displayTitle(deleteTarget) : ""}”及其身份、变体和关联记录？媒体文件会保留在本地素材库中。</p></Modal>
            <Modal title={preview?.title || "虾塘素材预览"} open={Boolean(preview)} footer={null} onCancel={() => setPreview(null)} width={920} destroyOnHidden>{preview ? <XiaTangMediaPreview asset={preview} /> : null}</Modal>
            <Modal title={isRecording ? `正在录制：${recordingTarget?.label || "声线"}` : `试听录音：${recordingTarget?.label || "声线"}`} open={Boolean(recordingTarget)} onCancel={cancelRecording} footer={isRecording ? <Button danger onClick={stopRecording}>停止录音</Button> : <div className="flex justify-end gap-2"><Button onClick={cancelRecording}>取消</Button><Button type="primary" disabled={!recordedBlob} loading={busy} onClick={() => void saveRecording()}>保存到虾塘</Button></div>} destroyOnHidden>
                {isRecording ? <p role="status" className="py-4 text-sm text-muted-foreground">正在使用浏览器录音。点击停止后可以试听并保存。</p> : recordedPreviewUrl ? <audio src={recordedPreviewUrl} controls className="w-full" /> : <p role="status" className="py-4 text-sm text-muted-foreground">录音数据为空，请重录。</p>}
            </Modal>
            <Modal title="裁剪声线样本" open={Boolean(trimTarget)} onCancel={() => { setTrimTarget(null); setTrimError(""); }} onOk={() => void trimVoice()} okText="保存裁剪版本" cancelText="取消" confirmLoading={busy} destroyOnHidden>
                <div className="space-y-4">{trimTarget ? <div className="rounded-md border border-border/60 p-3"><p className="mb-2 text-sm">{trimTarget.title}</p><audio src={mediaUrl(trimTarget)} controls className="w-full" /></div> : null}<div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm"><span>起始秒数</span><Input type="number" min={0} step={0.1} value={trimStart} onChange={(event) => setTrimStart(event.target.value)} /></label><label className="grid gap-1.5 text-sm"><span>时长（秒）</span><Input type="number" min={0.1} step={0.1} value={trimDuration} onChange={(event) => setTrimDuration(event.target.value)} /></label></div>{trimError ? <p role="alert" className="text-sm text-destructive">{trimError}</p> : <p className="text-xs text-muted-foreground">裁剪结果会保存为新 WAV 版本，原音频保留。</p>}</div>
            </Modal>
            <input ref={voiceFileInput} aria-label="上传角色或旁白声线" className="hidden" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm" onChange={(event) => {
                const input = event.currentTarget; const file = input.files?.[0]; const parentId = input.dataset.parentId; const slot = input.dataset.slot || "sample";
                if (!file || !parentId) return; setBusy(true); setOperationError("");
                void uploadXiaTangMedia(file, "voice", parentId, slot, undefined, projectAssetId).then((asset) => { addAsset(asset); message.success("声线音频已保存到虾塘"); }).catch((cause) => setOperationError(cause instanceof Error ? cause.message : "声线上传失败")).finally(() => { input.value = ""; setBusy(false); });
            }} />
        </main>
    );
}

function FingerprintIcon() { return <span aria-hidden="true" className="grid size-4 place-items-center text-xs text-muted-foreground">◎</span>; }
