"use client";

import { Button, Input, Popconfirm } from "antd";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

import {
    deleteDramaCharacterVoiceSample,
    deleteDramaNarratorVoice,
    fetchDramaAssetDomain,
    fetchDramaCharacterVoiceSamples,
    fetchDramaNarratorVoice,
    fetchDramaNarratorVoiceSources,
    recordDramaCharacterVoiceSample,
    recordDramaNarratorVoice,
    copyDramaNarratorVoice,
    trimDramaCharacterVoiceSample,
    trimDramaNarratorVoice,
    uploadDramaCharacterVoiceSample,
    uploadDramaNarratorVoice,
    type DramaAssetDomainItem,
    type DramaCharacterVoiceSlot,
    type DramaNarratorVoiceSource,
    type DramaNarratorVoiceStatus,
} from "@/services/api/drama-import";

const CHARACTER_VOICE_SLOTS = [
    { slot: "default", label: "默认" },
    { slot: "child", label: "儿童" },
    { slot: "youth", label: "青年" },
    { slot: "middle", label: "中年" },
    { slot: "elder", label: "老年" },
] as const;

const SUPPORTED_AUDIO_ACCEPT = ".mp3,.wav,.m4a,.aac,.ogg,audio/*";

export type VoiceTrimTarget =
    | { kind: "character"; slot: string; sourcePath: string }
    | { kind: "narrator"; sourcePath: string };

export type VoiceAssetManagerViewProps = {
    characters: DramaAssetDomainItem[];
    selectedCharacter: string;
    characterSlots: DramaCharacterVoiceSlot[];
    narratorStatus: DramaNarratorVoiceStatus | null;
    narratorSources: DramaNarratorVoiceSource[];
    selectedNarratorSource: string;
    loadingCharacters: boolean;
    loadingCharacterVoice: boolean;
    loadingNarrator: boolean;
    loadingNarratorSources: boolean;
    characterError: string;
    characterVoiceError: string;
    narratorError: string;
    narratorSourcesError: string;
    actionError: string;
    busy: boolean;
    recordingTarget: string;
    isRecording: boolean;
    recordedPreviewUrl: string;
    trimTarget: VoiceTrimTarget | null;
    trimStart: string;
    trimDuration: string;
    onRetryCharacters: () => void;
    onRetryCharacterVoice: () => void;
    onRetryNarrator: () => void;
    onRetryNarratorSources: () => void;
    onSelectCharacter: (name: string) => void;
    onSelectNarratorSource: (path: string) => void;
    onUploadCharacter: (slot: string) => void;
    onRecordCharacter: (slot: string) => void;
    onStopRecording: () => void;
    onSaveRecording: () => void;
    onCancelRecording: () => void;
    onTrimCharacter: (slot: DramaCharacterVoiceSlot) => void;
    onDeleteCharacter: (slot: string) => void;
    onUploadNarrator: () => void;
    onRecordNarrator: () => void;
    onCopyNarrator: (path: string) => void;
    onTrimNarrator: () => void;
    onDeleteNarrator: () => void;
    onTrimStartChange: (value: string) => void;
    onTrimDurationChange: (value: string) => void;
    onSubmitTrim: () => void;
    onCancelTrim: () => void;
};

function characterName(character: DramaAssetDomainItem) {
    return typeof character.name === "string" ? character.name : "";
}

function slotLabel(slot: string) {
    return CHARACTER_VOICE_SLOTS.find((entry) => entry.slot === slot)?.label ?? slot;
}

function orderedVoiceSlots(slots: DramaCharacterVoiceSlot[]) {
    const existing = new Map(slots.map((slot) => [slot.slot, slot]));
    return CHARACTER_VOICE_SLOTS.map(({ slot, label }) => {
        const current = existing.get(slot);
        return current
            ? { ...current, label: current.label || label, required: slot === "default" || current.required }
            : {
                slot,
                label,
                path: "",
                url: "",
                required: slot === "default",
                inherited_from_default: false,
            } satisfies DramaCharacterVoiceSlot;
    });
}

function VoiceAction({
    label,
    onClick,
    disabled,
    danger = false,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
}) {
    return (
        <Button
            autoInsertSpace={false}
            htmlType="button"
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            danger={danger}
            size="small"
        >
            {label.replace(/声线$/, "")}
        </Button>
    );
}

export function VoiceAssetManagerView({
    characters,
    selectedCharacter,
    characterSlots,
    narratorStatus,
    narratorSources,
    selectedNarratorSource,
    loadingCharacters,
    loadingCharacterVoice,
    loadingNarrator,
    loadingNarratorSources,
    characterError,
    characterVoiceError,
    narratorError,
    narratorSourcesError,
    actionError,
    busy,
    recordingTarget,
    isRecording,
    recordedPreviewUrl,
    trimTarget,
    trimStart,
    trimDuration,
    onRetryCharacters,
    onRetryCharacterVoice,
    onRetryNarrator,
    onRetryNarratorSources,
    onSelectCharacter,
    onSelectNarratorSource,
    onUploadCharacter,
    onRecordCharacter,
    onStopRecording,
    onSaveRecording,
    onCancelRecording,
    onTrimCharacter,
    onDeleteCharacter,
    onUploadNarrator,
    onRecordNarrator,
    onCopyNarrator,
    onTrimNarrator,
    onDeleteNarrator,
    onTrimStartChange,
    onTrimDurationChange,
    onSubmitTrim,
    onCancelTrim,
}: VoiceAssetManagerViewProps) {
    const slots = orderedVoiceSlots(characterSlots);
    const controlsDisabled = busy || isRecording;

    return (
        <main aria-label="虾集声线管理" className="space-y-6">
            <header>
                <h1 className="text-xl font-semibold">声线管理</h1>
                <p className="mt-1 text-sm text-muted-foreground">管理角色年龄声线与项目旁白参考音频。</p>
            </header>

            {actionError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}

            <section aria-labelledby="character-voice-heading" className="space-y-4 rounded-lg border border-border bg-card p-4">
                <div>
                    <h2 id="character-voice-heading" className="text-lg font-semibold">角色声线</h2>
                    <p className="mt-1 text-sm text-muted-foreground">为所选角色管理默认与不同年龄段的声音样本。</p>
                </div>

                <div className="max-w-md space-y-1.5">
                    <label htmlFor="xiaji-voice-character" className="text-sm font-medium">选择角色</label>
                    <select
                        id="xiaji-voice-character"
                        value={selectedCharacter}
                        onChange={(event) => onSelectCharacter(event.currentTarget.value)}
                        disabled={loadingCharacters || Boolean(characterError) || characters.length === 0 || controlsDisabled}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {characters.length === 0 ? <option value="">暂无角色</option> : null}
                        {characters.map((character, index) => {
                            const name = characterName(character);
                            return <option key={`${name}-${index}`} value={name}>{name}</option>;
                        })}
                    </select>
                </div>

                {loadingCharacters ? <p role="status" className="text-sm text-muted-foreground">正在加载角色…</p> : null}
                {characterError ? (
                    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-destructive">
                        <span>角色列表加载失败：{characterError}</span>
                        <Button autoInsertSpace={false} htmlType="button" onClick={onRetryCharacters}>重试角色列表</Button>
                    </div>
                ) : null}
                {!loadingCharacters && !characterError && characters.length === 0 ? <p className="text-sm text-muted-foreground">此项目暂无角色。</p> : null}

                {selectedCharacter && loadingCharacterVoice ? <p role="status" className="text-sm text-muted-foreground">正在加载角色声线…</p> : null}
                {selectedCharacter && characterVoiceError ? (
                    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-destructive">
                        <span>角色声线加载失败：{characterVoiceError}</span>
                        <Button autoInsertSpace={false} htmlType="button" onClick={onRetryCharacterVoice}>重试角色声线</Button>
                    </div>
                ) : null}

                {selectedCharacter && !loadingCharacters && !characterError && !loadingCharacterVoice && !characterVoiceError ? (
                    <ul className="divide-y divide-border">
                        {slots.map((slot) => {
                            const label = slotLabel(slot.slot);
                            const hasAudio = Boolean(slot.path);
                            return (
                                <li key={slot.slot} className="flex flex-col gap-3 py-4 first:pt-1 last:pb-1 lg:flex-row lg:items-center">
                                    <div className="min-w-32 lg:w-36">
                                        <h3 className="text-sm font-medium">{label}</h3>
                                        <p className="text-xs text-muted-foreground">
                                            {slot.slot === "default" ? "角色基础声线" : `角色${label}年龄声线`}
                                        </p>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        {slot.url ? <audio aria-label={`${label}声线播放器`} src={slot.url} controls preload="none" className="h-8 max-w-full" /> : null}
                                        {hasAudio ? <p className="mt-1 truncate text-xs text-muted-foreground" title={slot.path}>{slot.path.split("/").pop()}</p>
                                            : slot.slot === "default" ? <p className="text-sm text-amber-700 dark:text-amber-300">缺少必需的默认声线</p>
                                                : slot.inherited_from_default ? <p className="text-sm text-muted-foreground">继承默认声线</p>
                                                    : <p className="text-sm text-muted-foreground">尚未添加此年龄声线</p>}
                                    </div>
                                    <div className="flex flex-wrap gap-2 lg:justify-end">
                                        <VoiceAction label={`上传${label}声线`} onClick={() => onUploadCharacter(slot.slot)} disabled={controlsDisabled} />
                                        <VoiceAction label={`录制${label}声线`} onClick={() => onRecordCharacter(slot.slot)} disabled={controlsDisabled || Boolean(recordingTarget || recordedPreviewUrl)} />
                                        {hasAudio ? (
                                            <>
                                                <VoiceAction label={`裁剪${label}声线`} onClick={() => onTrimCharacter(slot)} disabled={controlsDisabled} />
                                                <Popconfirm
                                                    title={`删除${label}声线？`}
                                                    description="删除后需要重新上传或录制。"
                                                    okText="确认删除"
                                                    cancelText="取消"
                                                    onConfirm={() => onDeleteCharacter(slot.slot)}
                                                >
                                                    <Button autoInsertSpace={false} htmlType="button" aria-label={`删除${label}声线`} danger size="small" disabled={controlsDisabled}>删除</Button>
                                                </Popconfirm>
                                            </>
                                        ) : null}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : null}
            </section>

            <section aria-labelledby="narrator-voice-heading" className="space-y-4 rounded-lg border border-border bg-card p-4">
                <div>
                    <h2 id="narrator-voice-heading" className="text-lg font-semibold">项目旁白声线</h2>
                    <p className="mt-1 text-sm text-muted-foreground">为整个项目设置旁白参考音频，也可以从项目已有音频复制。</p>
                </div>

                {loadingNarrator ? <p role="status" className="text-sm text-muted-foreground">正在加载旁白声线…</p> : null}
                {narratorError ? (
                    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-destructive">
                        <span>旁白声线加载失败：{narratorError}</span>
                        <Button autoInsertSpace={false} htmlType="button" onClick={onRetryNarrator}>重试旁白声线</Button>
                    </div>
                ) : null}

                {!loadingNarrator && !narratorError ? (
                    <div className="space-y-3">
                        {narratorStatus ? (
                            <div className="rounded-md bg-muted/40 p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="font-medium">{narratorStatus.heading || (narratorStatus.reference_path ? "旁白声线已设置" : "未设置旁白声线")}</p>
                                        <p className="mt-1 text-sm text-muted-foreground">{narratorStatus.detail || narratorStatus.explanation || "项目旁白参考音频状态"}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">{narratorStatus.is_first_person ? "第一人称旁白" : "第三人称旁白"}</p>
                                    </div>
                                    {narratorStatus.source ? <span className="rounded bg-background px-2 py-1 text-xs text-muted-foreground">{narratorStatus.source}</span> : null}
                                </div>
                                {narratorStatus.reference_url ? <audio aria-label="旁白声线播放器" src={narratorStatus.reference_url} controls preload="none" className="mt-3 h-8 max-w-full" /> : null}
                                {narratorStatus.reference_path ? <p className="mt-1 truncate text-xs text-muted-foreground" title={narratorStatus.reference_path}>{narratorStatus.reference_path.split("/").pop()}</p> : null}
                            </div>
                        ) : <p className="text-sm text-muted-foreground">未设置旁白参考声线。</p>}

                        <div className="flex flex-wrap items-end gap-2">
                            <Button autoInsertSpace={false} htmlType="button" onClick={onUploadNarrator} disabled={controlsDisabled}>上传旁白声线</Button>
                            <Button autoInsertSpace={false} htmlType="button" onClick={onRecordNarrator} disabled={controlsDisabled || Boolean(recordingTarget || recordedPreviewUrl)}>录制旁白声线</Button>
                            <div className="min-w-56 flex-1 space-y-1">
                                <label htmlFor="xiaji-narrator-source" className="text-xs font-medium">项目音频来源</label>
                                <select
                                    id="xiaji-narrator-source"
                                    value={selectedNarratorSource}
                                    onChange={(event) => onSelectNarratorSource(event.currentTarget.value)}
                                    disabled={loadingNarratorSources || narratorSources.length === 0 || controlsDisabled}
                                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                                >
                                    <option value="">选择项目音频</option>
                                    {narratorSources.map((source, index) => <option key={`${source.path}-${index}`} value={source.path}>{source.label}</option>)}
                                </select>
                            </div>
                            <Button
                                autoInsertSpace={false}
                                htmlType="button"
                                onClick={() => onCopyNarrator(selectedNarratorSource)}
                                disabled={controlsDisabled || !selectedNarratorSource}
                            >
                                从项目音频复制
                            </Button>
                            {narratorStatus?.reference_path ? (
                                <>
                                    <Button autoInsertSpace={false} htmlType="button" onClick={onTrimNarrator} disabled={controlsDisabled}>裁剪旁白声线</Button>
                                    <Popconfirm
                                        title="删除项目旁白声线？"
                                        description="删除后需要重新上传、录制或从项目音频复制。"
                                        okText="确认删除"
                                        cancelText="取消"
                                        onConfirm={onDeleteNarrator}
                                    >
                                        <Button autoInsertSpace={false} htmlType="button" aria-label="删除旁白声线" danger disabled={controlsDisabled}>删除旁白声线</Button>
                                    </Popconfirm>
                                </>
                            ) : null}
                        </div>

                        {loadingNarratorSources ? <p role="status" className="text-xs text-muted-foreground">正在加载项目音频…</p> : null}
                        {narratorSourcesError ? (
                            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                                <span>项目音频加载失败：{narratorSourcesError}</span>
                                <Button autoInsertSpace={false} htmlType="button" onClick={onRetryNarratorSources}>重试项目音频</Button>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </section>

            {recordingTarget ? (
                <section role="dialog" aria-label="声线录音" className="space-y-3 rounded-lg border border-border bg-card p-4">
                    <div>
                        <h2 className="font-semibold">录制声线</h2>
                        <p role="status" className="text-sm text-muted-foreground">
                            {isRecording ? "正在录音" : recordedPreviewUrl ? "录音完成" : "正在请求麦克风权限…"}
                        </p>
                    </div>
                    {recordedPreviewUrl ? <audio aria-label="录音试听" src={recordedPreviewUrl} controls className="h-8 max-w-full" /> : null}
                    <div className="flex flex-wrap gap-2">
                        {isRecording ? <Button autoInsertSpace={false} htmlType="button" onClick={onStopRecording}>停止录音</Button> : null}
                        {recordedPreviewUrl ? <Button autoInsertSpace={false} htmlType="button" type="primary" onClick={onSaveRecording} loading={busy}>保存录音</Button> : null}
                        <Button autoInsertSpace={false} htmlType="button" onClick={onCancelRecording} disabled={busy}>取消录音</Button>
                    </div>
                </section>
            ) : null}

            {trimTarget ? (
                <section role="dialog" aria-label="裁剪声线音频" className="space-y-4 rounded-lg border border-border bg-card p-4">
                    <div>
                        <h2 className="font-semibold">裁剪声线音频</h2>
                        <p className="mt-1 truncate text-xs text-muted-foreground" title={trimTarget.sourcePath}>{trimTarget.sourcePath}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-sm">开始秒数<Input aria-label="开始秒数" type="number" min={0} step={0.1} value={trimStart} onChange={(event) => onTrimStartChange(event.currentTarget.value)} /></label>
                        <label className="space-y-1 text-sm">保留时长（秒）<Input aria-label="保留时长" type="number" min={0.1} step={0.1} value={trimDuration} onChange={(event) => onTrimDurationChange(event.currentTarget.value)} /></label>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button autoInsertSpace={false} htmlType="button" onClick={onCancelTrim} disabled={busy}>取消</Button>
                        <Button autoInsertSpace={false} htmlType="button" type="primary" onClick={onSubmitTrim} loading={busy}>应用裁剪</Button>
                    </div>
                </section>
            ) : null}
        </main>
    );
}

type VoiceUploadTarget =
    | { kind: "character"; projectId: string; character: string; slot: string }
    | { kind: "narrator"; projectId: string };

type RecordingSession = { attempt: number; target: VoiceUploadTarget; cancelled: boolean };

function messageFrom(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function microphoneFailureMessage(error: unknown) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return "麦克风权限被拒绝。请允许浏览器访问麦克风后重试。";
    if (name === "NotFoundError" || name === "DevicesNotFoundError") return "没有找到可用的麦克风设备。";
    if (name === "NotReadableError" || name === "TrackStartError") return "麦克风正被其他应用占用，请关闭占用它的应用后重试。";
    return `无法开始录音：${messageFrom(error, "请检查麦克风权限和设备。")}`;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(reader.error ?? new Error("读取录音失败"));
        reader.readAsDataURL(blob);
    });
}

function stopStream(stream: MediaStream | null) {
    stream?.getTracks().forEach((track) => track.stop());
}

export function VoiceAssetManager({ projectId }: { projectId: string }) {
    const [characters, setCharacters] = useState<DramaAssetDomainItem[]>([]);
    const [selectedCharacter, setSelectedCharacter] = useState("");
    const [characterSlots, setCharacterSlots] = useState<DramaCharacterVoiceSlot[]>([]);
    const [narratorStatus, setNarratorStatus] = useState<DramaNarratorVoiceStatus | null>(null);
    const [narratorSources, setNarratorSources] = useState<DramaNarratorVoiceSource[]>([]);
    const [selectedNarratorSource, setSelectedNarratorSource] = useState("");
    const [loadingCharacters, setLoadingCharacters] = useState(true);
    const [loadingCharacterVoice, setLoadingCharacterVoice] = useState(false);
    const [loadingNarrator, setLoadingNarrator] = useState(true);
    const [loadingNarratorSources, setLoadingNarratorSources] = useState(true);
    const [characterError, setCharacterError] = useState("");
    const [characterVoiceError, setCharacterVoiceError] = useState("");
    const [narratorError, setNarratorError] = useState("");
    const [narratorSourcesError, setNarratorSourcesError] = useState("");
    const [actionError, setActionError] = useState("");
    const [busy, setBusy] = useState(false);
    const [recordingTarget, setRecordingTarget] = useState("");
    const [isRecording, setIsRecording] = useState(false);
    const [recordedPreviewUrl, setRecordedPreviewUrl] = useState("");
    const [recordedDataUrl, setRecordedDataUrl] = useState("");
    const [trimTarget, setTrimTarget] = useState<VoiceTrimTarget | null>(null);
    const [trimStart, setTrimStart] = useState("0");
    const [trimDuration, setTrimDuration] = useState("4");

    const mountedRef = useRef(false);
    const requestRef = useRef({ characters: 0, characterVoice: 0, narrator: 0, narratorSources: 0 });
    const uploadTargetRef = useRef<VoiceUploadTarget | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const recordingAttemptRef = useRef(0);
    const recordingSessionRef = useRef<RecordingSession | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    const loadCharacters = useCallback(async () => {
        const requestId = ++requestRef.current.characters;
        setLoadingCharacters(true);
        setCharacterError("");
        try {
            const next = await fetchDramaAssetDomain(projectId, "characters");
            if (!mountedRef.current || requestId !== requestRef.current.characters) return;
            setCharacters(next);
            setSelectedCharacter((current) => current && next.some((character) => characterName(character) === current)
                ? current
                : characterName(next[0] ?? { name: "" }));
        } catch (error) {
            if (mountedRef.current && requestId === requestRef.current.characters) setCharacterError(messageFrom(error, "未知错误"));
        } finally {
            if (mountedRef.current && requestId === requestRef.current.characters) setLoadingCharacters(false);
        }
    }, [projectId]);

    const loadCharacterVoice = useCallback(async (character: string) => {
        const requestId = ++requestRef.current.characterVoice;
        setLoadingCharacterVoice(true);
        setCharacterVoiceError("");
        try {
            const next = await fetchDramaCharacterVoiceSamples(projectId, character);
            if (mountedRef.current && requestId === requestRef.current.characterVoice) setCharacterSlots(next.slots);
        } catch (error) {
            if (mountedRef.current && requestId === requestRef.current.characterVoice) setCharacterVoiceError(messageFrom(error, "未知错误"));
        } finally {
            if (mountedRef.current && requestId === requestRef.current.characterVoice) setLoadingCharacterVoice(false);
        }
    }, [projectId]);

    const loadNarrator = useCallback(async () => {
        const requestId = ++requestRef.current.narrator;
        setLoadingNarrator(true);
        setNarratorError("");
        try {
            const next = await fetchDramaNarratorVoice(projectId);
            if (mountedRef.current && requestId === requestRef.current.narrator) setNarratorStatus(next);
        } catch (error) {
            if (mountedRef.current && requestId === requestRef.current.narrator) setNarratorError(messageFrom(error, "未知错误"));
        } finally {
            if (mountedRef.current && requestId === requestRef.current.narrator) setLoadingNarrator(false);
        }
    }, [projectId]);

    const loadNarratorSources = useCallback(async () => {
        const requestId = ++requestRef.current.narratorSources;
        setLoadingNarratorSources(true);
        setNarratorSourcesError("");
        try {
            const next = await fetchDramaNarratorVoiceSources(projectId);
            if (!mountedRef.current || requestId !== requestRef.current.narratorSources) return;
            setNarratorSources(next);
            setSelectedNarratorSource((current) => current && next.some((source) => source.path === current) ? current : next[0]?.path ?? "");
        } catch (error) {
            if (mountedRef.current && requestId === requestRef.current.narratorSources) setNarratorSourcesError(messageFrom(error, "未知错误"));
        } finally {
            if (mountedRef.current && requestId === requestRef.current.narratorSources) setLoadingNarratorSources(false);
        }
    }, [projectId]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            const session = recordingSessionRef.current;
            if (session) session.cancelled = true;
            recordingAttemptRef.current += 1;
            try {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
            } catch {
                // The recorder may have stopped between the state check and stop().
            }
            stopStream(streamRef.current);
            streamRef.current = null;
        };
    }, []);

    useEffect(() => { void loadCharacters(); }, [loadCharacters]);
    useEffect(() => { void loadNarrator(); }, [loadNarrator]);
    useEffect(() => { void loadNarratorSources(); }, [loadNarratorSources]);
    useEffect(() => {
        if (!selectedCharacter) {
            setCharacterSlots([]);
            setLoadingCharacterVoice(false);
            setCharacterVoiceError("");
            return;
        }
        void loadCharacterVoice(selectedCharacter);
        return () => { requestRef.current.characterVoice += 1; };
    }, [loadCharacterVoice, selectedCharacter]);

    const runMutation = useCallback(async (operation: () => Promise<unknown>, refresh: () => Promise<void>) => {
        setBusy(true);
        setActionError("");
        try {
            await operation();
            await refresh();
            return true;
        } catch (error) {
            if (mountedRef.current) setActionError(messageFrom(error, "操作失败，请重试。"));
            return false;
        } finally {
            if (mountedRef.current) setBusy(false);
        }
    }, []);

    const refreshCharacterVoice = useCallback(() => selectedCharacter ? loadCharacterVoice(selectedCharacter) : Promise.resolve(), [loadCharacterVoice, selectedCharacter]);
    const refreshNarrator = useCallback(async () => { await loadNarrator(); }, [loadNarrator]);

    const chooseUpload = (target: VoiceUploadTarget) => {
        uploadTargetRef.current = target;
        fileInputRef.current?.click();
    };

    const handleFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        const target = uploadTargetRef.current;
        event.currentTarget.value = "";
        uploadTargetRef.current = null;
        if (!file || !target) return;
        const refresh = target.kind === "character" ? () => loadCharacterVoice(target.character) : refreshNarrator;
        void runMutation(
            () => target.kind === "character"
                ? uploadDramaCharacterVoiceSample(target.projectId, target.character, target.slot, file, file.name)
                : uploadDramaNarratorVoice(target.projectId, file, file.name),
            refresh,
        );
    };

    const releaseRecordingStream = (stream = streamRef.current) => {
        stopStream(stream);
        if (streamRef.current === stream) streamRef.current = null;
    };

    const clearRecording = () => {
        const session = recordingSessionRef.current;
        if (session) session.cancelled = true;
        recordingAttemptRef.current += 1;
        try {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
        } catch {
            // Ignore a recorder that became inactive while stopping.
        }
        releaseRecordingStream();
        mediaRecorderRef.current = null;
        recordingSessionRef.current = null;
        audioChunksRef.current = [];
        setRecordingTarget("");
        setIsRecording(false);
        setRecordedPreviewUrl("");
        setRecordedDataUrl("");
    };

    const beginRecording = async (target: VoiceUploadTarget) => {
        if (typeof window !== "undefined" && !window.isSecureContext) {
            setActionError("录音需要 HTTPS 或 localhost 安全环境，请在安全连接中打开后重试。");
            return;
        }
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
            setActionError("当前浏览器不支持麦克风录音，请改用音频文件上传。");
            return;
        }

        const attempt = ++recordingAttemptRef.current;
        const session: RecordingSession = { attempt, target, cancelled: false };
        recordingSessionRef.current = session;
        setRecordingTarget(target.kind === "character" ? `character:${target.character}:${target.slot}` : "narrator");
        setRecordedPreviewUrl("");
        setRecordedDataUrl("");
        setActionError("");

        let stream: MediaStream | null = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!mountedRef.current || session.cancelled || attempt !== recordingAttemptRef.current) {
                stopStream(stream);
                return;
            }
            streamRef.current = stream;
            audioChunksRef.current = [];
            const recorder = new MediaRecorder(stream);
            mediaRecorderRef.current = recorder;
            recorder.ondataavailable = (event) => {
                if (!session.cancelled && event.data.size > 0) audioChunksRef.current.push(event.data);
            };
            recorder.onerror = () => {
                if (mountedRef.current && !session.cancelled) setActionError("录音设备发生错误，请检查麦克风后重试。");
                releaseRecordingStream(stream);
                if (mountedRef.current) setIsRecording(false);
            };
            recorder.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
                audioChunksRef.current = [];
                releaseRecordingStream(stream);
                if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
                if (mountedRef.current) setIsRecording(false);
                if (session.cancelled || !mountedRef.current) return;
                if (blob.size === 0) {
                    setActionError("没有录到音频，请检查麦克风后重试。");
                    return;
                }
                void blobToDataUrl(blob).then((dataUrl) => {
                    if (!session.cancelled && mountedRef.current) {
                        setRecordedDataUrl(dataUrl);
                        setRecordedPreviewUrl(dataUrl);
                    }
                }).catch((error) => {
                    if (!session.cancelled && mountedRef.current) setActionError(messageFrom(error, "读取录音失败。"));
                });
            };
            recorder.start();
            setIsRecording(true);
        } catch (error) {
            if (stream) stopStream(stream);
            if (mountedRef.current && !session.cancelled && attempt === recordingAttemptRef.current) {
                setIsRecording(false);
                setActionError(microphoneFailureMessage(error));
            }
        }
    };

    const stopRecording = () => {
        const recorder = mediaRecorderRef.current;
        try {
            if (recorder && recorder.state !== "inactive") recorder.stop();
            else {
                releaseRecordingStream();
                setIsRecording(false);
            }
        } catch (error) {
            releaseRecordingStream();
            setIsRecording(false);
            setActionError(microphoneFailureMessage(error));
        }
    };

    const saveRecording = async () => {
        const session = recordingSessionRef.current;
        if (!session || session.cancelled || !recordedDataUrl) return;
        const target = session.target;
        const success = await runMutation(
            () => target.kind === "character"
                ? recordDramaCharacterVoiceSample(target.projectId, target.character, target.slot, recordedDataUrl)
                : recordDramaNarratorVoice(target.projectId, recordedDataUrl),
            target.kind === "character" ? () => loadCharacterVoice(target.character) : refreshNarrator,
        );
        if (success) clearRecording();
    };

    const submitTrim = () => {
        if (!trimTarget) return;
        const start = Number(trimStart);
        const duration = Number(trimDuration);
        if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0) {
            setActionError("裁剪开始时间必须不小于 0，保留时长必须大于 0。");
            return;
        }
        const target = trimTarget;
        const operation = target.kind === "character"
            ? () => trimDramaCharacterVoiceSample(projectId, selectedCharacter, target.slot, {
                source_path: target.sourcePath,
                start_seconds: start,
                duration_seconds: duration,
            })
            : () => trimDramaNarratorVoice(projectId, { start_seconds: start, duration_seconds: duration });
        void runMutation(operation, target.kind === "character" ? refreshCharacterVoice : refreshNarrator).then((success) => {
            if (success) setTrimTarget(null);
        });
    };

    const handleCopyNarrator = (path: string) => {
        if (!path) return;
        void runMutation(() => copyDramaNarratorVoice(projectId, path), refreshNarrator);
    };

    const voiceInput = (
        <input
            ref={fileInputRef}
            type="file"
            accept={SUPPORTED_AUDIO_ACCEPT}
            aria-label="选择声线音频文件"
            className="sr-only"
            onChange={handleFileSelected}
        />
    );

    return (
        <>
            {voiceInput}
            <VoiceAssetManagerView
                characters={characters}
                selectedCharacter={selectedCharacter}
                characterSlots={characterSlots}
                narratorStatus={narratorStatus}
                narratorSources={narratorSources}
                selectedNarratorSource={selectedNarratorSource}
                loadingCharacters={loadingCharacters}
                loadingCharacterVoice={loadingCharacterVoice}
                loadingNarrator={loadingNarrator}
                loadingNarratorSources={loadingNarratorSources}
                characterError={characterError}
                characterVoiceError={characterVoiceError}
                narratorError={narratorError}
                narratorSourcesError={narratorSourcesError}
                actionError={actionError}
                busy={busy}
                recordingTarget={recordingTarget}
                isRecording={isRecording}
                recordedPreviewUrl={recordedPreviewUrl}
                trimTarget={trimTarget}
                trimStart={trimStart}
                trimDuration={trimDuration}
                onRetryCharacters={() => void loadCharacters()}
                onRetryCharacterVoice={() => void refreshCharacterVoice()}
                onRetryNarrator={() => void loadNarrator()}
                onRetryNarratorSources={() => void loadNarratorSources()}
                onSelectCharacter={setSelectedCharacter}
                onSelectNarratorSource={setSelectedNarratorSource}
                onUploadCharacter={(slot) => chooseUpload({ kind: "character", projectId, character: selectedCharacter, slot })}
                onRecordCharacter={(slot) => void beginRecording({ kind: "character", projectId, character: selectedCharacter, slot })}
                onStopRecording={stopRecording}
                onSaveRecording={() => void saveRecording()}
                onCancelRecording={clearRecording}
                onTrimCharacter={(slot) => {
                    if (!slot.path) return;
                    setTrimStart("0");
                    setTrimDuration("4");
                    setTrimTarget({ kind: "character", slot: slot.slot, sourcePath: slot.path });
                }}
                onDeleteCharacter={(slot) => void runMutation(() => deleteDramaCharacterVoiceSample(projectId, selectedCharacter, slot), refreshCharacterVoice)}
                onUploadNarrator={() => chooseUpload({ kind: "narrator", projectId })}
                onRecordNarrator={() => void beginRecording({ kind: "narrator", projectId })}
                onCopyNarrator={handleCopyNarrator}
                onTrimNarrator={() => {
                    if (!narratorStatus?.reference_path) return;
                    setTrimStart("0");
                    setTrimDuration("4");
                    setTrimTarget({ kind: "narrator", sourcePath: narratorStatus.reference_path });
                }}
                onDeleteNarrator={() => void runMutation(() => deleteDramaNarratorVoice(projectId), refreshNarrator)}
                onTrimStartChange={setTrimStart}
                onTrimDurationChange={setTrimDuration}
                onSubmitTrim={submitTrim}
                onCancelTrim={() => setTrimTarget(null)}
            />
        </>
    );
}
