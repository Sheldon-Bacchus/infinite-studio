"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchDramaAssetDomain, type DramaAssetDomainItem } from "@/services/api/drama-import";
import {
    createDramaCharacterIdentity,
    deleteDramaIdentityAsset,
    deleteDramaCharacterIdentity,
    DramaIdentityWriteOutcomeUnknownError,
    fetchDramaIdentityAttempts,
    fetchDramaCharacterIdentities,
    startDramaCharacterBuild,
    startDramaCharacterPortrait,
    startDramaIdentityImage,
    startDramaIdentityPortrait,
    uploadDramaCharacterPortrait,
    uploadDramaIdentityAsset,
    updateDramaCharacterIdentity,
    type DramaIdentityAssetKind,
    type DramaIdentityAttempts,
    type DramaCharacterIdentity,
    type DramaCharacterIdentityCreate,
    type DramaCharacterIdentityUpdate,
    type DramaIdentityTask,
} from "@/services/api/drama-identities";

type IdentityEditor = {
    mode: "create" | "edit";
    identity: DramaCharacterIdentity | null;
    values: DramaCharacterIdentityCreate & Pick<DramaCharacterIdentityUpdate, "face_prompt" | "body_type">;
};

type IdentityEditorField = keyof IdentityEditor["values"];

export type CharacterIdentitiesManagerViewProps = {
    characters: DramaAssetDomainItem[];
    selectedCharacter: string;
    selectedCharacterDetails?: DramaAssetDomainItem;
    identities: DramaCharacterIdentity[];
    attemptsByIdentityId: Record<string, DramaIdentityAttempts>;
    attemptsLoading: boolean;
    attemptsError: string;
    taskReceipt: DramaIdentityTask | null;
    unknownWriteMessage: string;
    unknownWriteRefreshed: boolean;
    loadingCharacters: boolean;
    loadingIdentities: boolean;
    charactersError: string;
    identitiesError: string;
    operationError: string;
    editor: IdentityEditor | null;
    deleteConfirmId: string | null;
    assetDeleteConfirm: { identityId: string; kind: "image" | "costume" } | null;
    busy: boolean;
    onSelectCharacter: (name: string) => void;
    onRetryCharacters: () => void;
    onRetryIdentities: () => void;
    onBuildCharacters: () => void;
    onGenerateCharacterPortrait: () => void;
    onUploadCharacterPortrait: (file: File) => void;
    onGenerateIdentityImage: (identityId: string) => void;
    onGenerateIdentityPortrait: (identityId: string) => void;
    onUploadIdentityAsset: (identity: DramaCharacterIdentity, kind: DramaIdentityAssetKind, file: File) => void;
    onRequestDeleteIdentityAsset: (identityId: string, kind: "image" | "costume") => void;
    onCancelDeleteAsset: () => void;
    onConfirmDeleteAsset: () => void | Promise<void>;
    onRetryAttempts: () => void;
    onRecheckUnknownWrite: () => void;
    onConfirmUnknownWriteChecked: () => void;
    onCreate: () => void;
    onEdit: (identity: DramaCharacterIdentity) => void;
    onChangeEditor: (field: IdentityEditorField, value: string) => void;
    onCancelEditor: () => void;
    onSubmit: (values: IdentityEditor["values"]) => void | Promise<void>;
    onRequestDelete: (identityId: string) => void;
    onCancelDelete: () => void;
    onConfirmDelete: (identityId: string) => void | Promise<void>;
};

function display(value: string | undefined) {
    return value?.trim() || "未填写";
}

function domainString(value: unknown, key: string) {
    const field = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    return typeof field === "string" ? field : "";
}

function identityEditorFields(mode: IdentityEditor["mode"]) {
    const fields: Array<{ key: IdentityEditorField; label: string }> = [
        { key: "identity_name", label: "身份名称" },
        { key: "age_group", label: "年龄段" },
        { key: "appearance_details", label: "外貌与服装" },
    ];
    if (mode === "edit") fields.push({ key: "face_prompt", label: "面部提示词" }, { key: "body_type", label: "体型" });
    return fields;
}

export function CharacterIdentitiesManagerView({
    characters,
    selectedCharacter,
    selectedCharacterDetails,
    identities,
    attemptsByIdentityId,
    attemptsLoading,
    attemptsError,
    taskReceipt,
    unknownWriteMessage,
    unknownWriteRefreshed,
    loadingCharacters,
    loadingIdentities,
    charactersError,
    identitiesError,
    operationError,
    editor,
    deleteConfirmId,
    assetDeleteConfirm,
    busy,
    onSelectCharacter,
    onRetryCharacters,
    onRetryIdentities,
    onBuildCharacters,
    onGenerateCharacterPortrait,
    onUploadCharacterPortrait,
    onGenerateIdentityImage,
    onGenerateIdentityPortrait,
    onUploadIdentityAsset,
    onRequestDeleteIdentityAsset,
    onCancelDeleteAsset,
    onConfirmDeleteAsset,
    onRetryAttempts,
    onRecheckUnknownWrite,
    onConfirmUnknownWriteChecked,
    onCreate,
    onEdit,
    onChangeEditor,
    onCancelEditor,
    onSubmit,
    onRequestDelete,
    onCancelDelete,
    onConfirmDelete,
}: CharacterIdentitiesManagerViewProps) {
    const writeDisabled = busy || !!unknownWriteMessage;
    const characterPortraitURL = domainString(selectedCharacterDetails, "portrait_url");
    const characterAge = domainString(selectedCharacterDetails, "age_group");
    return (
        <section aria-label="角色身份管理" className="space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">角色身份</h2>
                    <label className="mt-2 block text-sm text-muted-foreground" htmlFor="xiaji-identity-character">选择角色</label>
                    <select
                        id="xiaji-identity-character"
                        aria-label="选择角色"
                        value={selectedCharacter}
                        disabled={loadingCharacters || characters.length === 0 || !!unknownWriteMessage}
                        onChange={(event) => onSelectCharacter(event.currentTarget.value)}
                        className="mt-1 min-w-56 rounded-md border border-border bg-background px-3 py-2 text-foreground"
                    >
                        <option value="">请选择角色</option>
                        {characters.map((character, index) => {
                            const name = String(character.name ?? "");
                            return <option key={`${name}-${index}`} value={name}>{name}</option>;
                        })}
                    </select>
                </div>
                <button type="button" className="rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50" onClick={onCreate} disabled={!selectedCharacter || writeDisabled}>
                    新增身份
                </button>
            </header>

            {loadingCharacters ? <p role="status">正在加载角色…</p> : null}
            {charactersError ? <div role="alert" className="flex items-center gap-3 text-destructive"><span>角色加载失败：{charactersError}</span><button type="button" onClick={onRetryCharacters}>重试角色</button></div> : null}
            {!loadingCharacters && !charactersError && characters.length === 0 ? <p className="text-sm text-muted-foreground">当前项目没有可管理的角色。</p> : null}
            {operationError ? <p role="alert" className="text-destructive">身份操作失败：{operationError}</p> : null}
            {taskReceipt ? <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">虾塘任务已提交：<code>{taskReceipt.task_type}</code> · <code>{taskReceipt.task_id}</code>{taskReceipt.scope ? ` · ${taskReceipt.scope}` : ""}</p> : null}
            {unknownWriteMessage ? (
                <div role="alert" className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                    <p>{unknownWriteMessage}。先重新读取角色与身份状态，并在 DramaClaw 任务记录核对；不要重复提交。</p>
                    <button type="button" onClick={onRecheckUnknownWrite} disabled={busy}>重新读取当前状态</button>
                    {unknownWriteRefreshed ? <button type="button" className="ml-3" onClick={onConfirmUnknownWriteChecked} disabled={busy}>我已在虾塘核对状态，允许继续</button> : null}
                </div>
            ) : null}

            {selectedCharacter ? (
                <section aria-label={`${selectedCharacter}角色与身份`} className="space-y-4">
                    <article aria-label="角色详情" className="space-y-3 rounded-lg border border-border bg-card p-4">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <h3 className="font-medium">角色详情：{selectedCharacter}</h3>
                                <dl className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
                                    <div><dt className="text-xs text-muted-foreground">角色定位</dt><dd className="text-sm">{display(domainString(selectedCharacterDetails, "role"))}</dd></div>
                                    <div><dt className="text-xs text-muted-foreground">性别</dt><dd className="text-sm">{display(domainString(selectedCharacterDetails, "gender"))}</dd></div>
                                    <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">角色描述</dt><dd className="whitespace-pre-wrap text-sm">{display(domainString(selectedCharacterDetails, "description"))}</dd></div>
                                    <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">面部提示词</dt><dd className="whitespace-pre-wrap text-sm">{display(domainString(selectedCharacterDetails, "face_prompt"))}</dd></div>
                                </dl>
                            </div>
                            {characterPortraitURL ? <img src={characterPortraitURL} alt={`${selectedCharacter}角色头像`} className="h-24 w-24 rounded-md object-cover" /> : <p className="text-sm text-muted-foreground">尚无角色头像</p>}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <button type="button" onClick={onBuildCharacters} disabled={writeDisabled}>从小说补充缺失角色</button>
                            <button type="button" onClick={onGenerateCharacterPortrait} disabled={writeDisabled}>生成角色头像</button>
                            <label className="text-sm">上传角色头像<input aria-label="上传角色头像" type="file" accept="image/*" disabled={writeDisabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onUploadCharacterPortrait(file); event.currentTarget.value = ""; }} /></label>
                        </div>
                    </article>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="font-medium">{selectedCharacter}的身份</h3>
                        {attemptsError ? <div role="alert" className="flex items-center gap-2 text-destructive"><span>{attemptsError}</span><button type="button" onClick={onRetryAttempts}>重试尝试次数</button></div> : null}
                    </div>
                    {loadingIdentities ? <p role="status">正在加载身份…</p> : null}
                    {identitiesError ? <div role="alert" className="flex items-center gap-3 text-destructive"><span>身份加载失败：{identitiesError}</span><button type="button" onClick={onRetryIdentities}>重试身份</button></div> : null}
                    {!loadingIdentities && !identitiesError && identities.length === 0 ? <p className="text-sm text-muted-foreground">暂无身份。</p> : null}
                    {!loadingIdentities && !identitiesError ? identities.map((identity) => (
                        <article key={identity.identity_id} className="rounded-lg border border-border bg-card p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex min-w-0 gap-4">
                                    {identity.image_url ? <img src={identity.image_url} alt={`${identity.identity_name}身份参考图`} className="h-20 w-20 rounded-md object-cover" /> : null}
                                    <div className="min-w-0">
                                        <h4 className="font-semibold">身份：{identity.identity_name}</h4>
                                        <dl className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
                                            <div><dt className="text-xs text-muted-foreground">年龄段</dt><dd className="whitespace-pre-wrap text-sm">{display(identity.age_group)}</dd></div>
                                            <div><dt className="text-xs text-muted-foreground">体型</dt><dd className="whitespace-pre-wrap text-sm">{display(identity.body_type)}</dd></div>
                                            <div><dt className="text-xs text-muted-foreground">外貌与服装</dt><dd className="whitespace-pre-wrap text-sm">{display(identity.appearance_details)}</dd></div>
                                            <div><dt className="text-xs text-muted-foreground">面部提示词</dt><dd className="whitespace-pre-wrap text-sm">{display(identity.face_prompt)}</dd></div>
                                        </dl>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                            <button type="button" onClick={() => onEdit(identity)} disabled={writeDisabled}>编辑</button>
                                            <button type="button" onClick={() => onRequestDelete(identity.identity_id)} disabled={writeDisabled}>删除</button>
                                </div>
                            </div>
                            <div className="mt-3 grid gap-4 md:grid-cols-3">
                                <section aria-label={`${identity.identity_name}主图`} className="space-y-2 rounded-md bg-muted/30 p-3">
                                    <h5 className="text-sm font-medium">身份主图</h5>
                                    {identity.image_url ? <img src={identity.image_url} alt={`${identity.identity_name}身份主图`} className="h-24 w-24 rounded-md object-cover" /> : <p className="text-xs text-muted-foreground">尚无身份主图</p>}
                                    <button type="button" onClick={() => onGenerateIdentityImage(identity.identity_id)} disabled={writeDisabled}>生成身份主图</button>
                                    <label className="block text-sm">上传身份主图<input aria-label={`上传${identity.identity_name}身份主图`} type="file" accept="image/*" disabled={writeDisabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onUploadIdentityAsset(identity, "image", file); event.currentTarget.value = ""; }} /></label>
                                    {identity.image_url ? <button type="button" onClick={() => onRequestDeleteIdentityAsset(identity.identity_id, "image")} disabled={writeDisabled}>删除身份主图</button> : null}
                                </section>
                                <section aria-label={`${identity.identity_name}服装参考图`} className="space-y-2 rounded-md bg-muted/30 p-3">
                                    <h5 className="text-sm font-medium">服装参考图</h5>
                                    {identity.costume_image_url ? <img src={identity.costume_image_url} alt={`${identity.identity_name}服装参考图`} className="h-24 w-24 rounded-md object-cover" /> : <p className="text-xs text-muted-foreground">尚无服装参考图</p>}
                                    <label className="block text-sm">上传服装参考图<input aria-label={`上传${identity.identity_name}服装参考图`} type="file" accept="image/*" disabled={writeDisabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onUploadIdentityAsset(identity, "costume", file); event.currentTarget.value = ""; }} /></label>
                                    {identity.costume_image_url ? <button type="button" onClick={() => onRequestDeleteIdentityAsset(identity.identity_id, "costume")} disabled={writeDisabled}>删除服装参考图</button> : null}
                                </section>
                                <section aria-label={`${identity.identity_name}肖像`} className="space-y-2 rounded-md bg-muted/30 p-3">
                                    <h5 className="text-sm font-medium">身份肖像</h5>
                                    {identity.portrait_image_url ? <img src={identity.portrait_image_url} alt={`${identity.identity_name}肖像图`} className="h-24 w-24 rounded-md object-cover" /> : <p className="text-xs text-muted-foreground">尚无身份肖像</p>}
                                    <button type="button" onClick={() => onGenerateIdentityPortrait(identity.identity_id)} disabled={writeDisabled || !identity.age_group || identity.age_group === characterAge || !identity.face_prompt?.trim()}>生成身份肖像</button>
                                    {identity.age_group && identity.age_group !== characterAge && !identity.face_prompt?.trim() ? <p className="text-xs text-muted-foreground">先填写面部提示词，再生成异龄身份肖像。</p> : null}
                                    <label className="block text-sm">上传身份肖像<input aria-label={`上传${identity.identity_name}身份肖像`} type="file" accept="image/*" disabled={writeDisabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onUploadIdentityAsset(identity, "portrait", file); event.currentTarget.value = ""; }} /></label>
                                </section>
                            </div>
                            <div className="mt-3 text-xs text-muted-foreground" aria-label={`${identity.identity_name}生成尝试次数`}>
                                {attemptsLoading ? <span role="status">正在读取尝试次数…</span> : attemptsError ? null : attemptsByIdentityId[identity.identity_id] ? <span>图片尝试：{attemptsByIdentityId[identity.identity_id].image_attempts} · 肖像尝试：{attemptsByIdentityId[identity.identity_id].portrait_attempts}</span> : <span>暂无尝试记录</span>}
                            </div>
                            {assetDeleteConfirm?.identityId === identity.identity_id ? (
                                <div role="alertdialog" aria-label={`确认删除${assetDeleteConfirm.kind === "image" ? "身份主图" : "服装参考图"}`} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2">
                                    <p>确认删除“{identity.identity_name}”的{assetDeleteConfirm.kind === "image" ? "身份主图" : "服装参考图"}？</p>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={onCancelDeleteAsset} disabled={busy}>取消</button>
                                        <button type="button" onClick={() => void onConfirmDeleteAsset()} disabled={writeDisabled}>{busy ? "正在删除…" : "确认删除"}</button>
                                    </div>
                                </div>
                            ) : null}
                            {deleteConfirmId === identity.identity_id ? (
                                <div role="alertdialog" aria-label={`确认删除身份${identity.identity_name}`} className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2">
                                    <p>确认删除身份“{identity.identity_name}”？此操作无法撤销。</p>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={onCancelDelete} disabled={writeDisabled}>取消</button>
                                        <button type="button" onClick={() => void onConfirmDelete(identity.identity_id)} disabled={writeDisabled}>{busy ? "正在删除…" : "确认删除"}</button>
                                    </div>
                                </div>
                            ) : null}
                        </article>
                    )) : null}
                </section>
            ) : null}

            {editor ? (
                <form
                    aria-label={editor.mode === "create" ? "新增角色身份" : `编辑角色身份${editor.identity?.identity_name ?? ""}`}
                    className="space-y-3 rounded-lg border border-border bg-card p-4"
                    onSubmit={(event) => { event.preventDefault(); void onSubmit(editor.values); }}
                >
                    <h3 className="font-semibold">{editor.mode === "create" ? "新增身份" : `编辑身份：${editor.identity?.identity_name ?? ""}`}</h3>
                    {identityEditorFields(editor.mode).map(({ key, label }) => (
                        <label key={key} className="block text-sm">
                            <span className="mb-1 block">{label}</span>
                            {key === "appearance_details" ? (
                                <textarea required={false} rows={3} value={editor.values[key] ?? ""} onChange={(event) => onChangeEditor(key, event.currentTarget.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" />
                            ) : (
                                <input required={key === "identity_name"} value={editor.values[key] ?? ""} onChange={(event) => onChangeEditor(key, event.currentTarget.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" />
                            )}
                        </label>
                    ))}
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={onCancelEditor} disabled={writeDisabled}>取消</button>
                        <button type="submit" disabled={writeDisabled}>{busy ? "正在保存…" : editor.mode === "create" ? "创建身份" : "保存身份"}</button>
                    </div>
                </form>
            ) : null}
        </section>
    );
}

function emptyIdentityValues(): IdentityEditor["values"] {
    return { identity_name: "", age_group: "", appearance_details: "", face_prompt: "", body_type: "" };
}

export function CharacterIdentitiesManager({ projectId }: { projectId: string }) {
    const [characters, setCharacters] = useState<DramaAssetDomainItem[]>([]);
    const [selectedCharacter, setSelectedCharacter] = useState("");
    const [identities, setIdentities] = useState<DramaCharacterIdentity[]>([]);
    const [attemptsByIdentityId, setAttemptsByIdentityId] = useState<Record<string, DramaIdentityAttempts>>({});
    const [attemptsLoading, setAttemptsLoading] = useState(false);
    const [attemptsError, setAttemptsError] = useState("");
    const [loadingCharacters, setLoadingCharacters] = useState(true);
    const [loadingIdentities, setLoadingIdentities] = useState(false);
    const [charactersError, setCharactersError] = useState("");
    const [identitiesError, setIdentitiesError] = useState("");
    const [operationError, setOperationError] = useState("");
    const [taskReceipt, setTaskReceipt] = useState<DramaIdentityTask | null>(null);
    const [unknownWriteMessage, setUnknownWriteMessage] = useState("");
    const [unknownWriteRefreshed, setUnknownWriteRefreshed] = useState(false);
    const [editor, setEditor] = useState<IdentityEditor | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [assetDeleteConfirm, setAssetDeleteConfirm] = useState<{ identityId: string; kind: "image" | "costume" } | null>(null);
    const [busy, setBusy] = useState(false);
    const characterRequest = useRef(0);
    const identityRequest = useRef(0);
    const attemptsRequest = useRef(0);

    const loadCharacters = useCallback(async () => {
        const requestId = ++characterRequest.current;
        setLoadingCharacters(true);
        setCharactersError("");
        try {
            const next = await fetchDramaAssetDomain(projectId, "characters");
            if (requestId !== characterRequest.current) return false;
            setCharacters(next);
            setSelectedCharacter((current) => next.some((item) => item.name === current) ? current : String(next[0]?.name ?? ""));
            return true;
        } catch (error) {
            if (requestId === characterRequest.current) setCharactersError(error instanceof Error ? error.message : "未知错误");
            return false;
        } finally {
            if (requestId === characterRequest.current) setLoadingCharacters(false);
        }
    }, [projectId]);

    const loadAttemptsFor = useCallback(async (character: string, items: DramaCharacterIdentity[]) => {
        const requestId = ++attemptsRequest.current;
        setAttemptsError("");
        setAttemptsByIdentityId({});
        if (!character || items.length === 0) {
            setAttemptsLoading(false);
            return true;
        }
        setAttemptsLoading(true);
        try {
            const results = await Promise.allSettled(items.map((identity) => fetchDramaIdentityAttempts(projectId, character, identity.identity_id)));
            if (requestId !== attemptsRequest.current) return false;
            const next: Record<string, DramaIdentityAttempts> = {};
            let failed = 0;
            results.forEach((result, index) => {
                if (result.status === "fulfilled") next[items[index].identity_id] = result.value;
                else failed += 1;
            });
            setAttemptsByIdentityId(next);
            if (failed > 0) setAttemptsError(`有 ${failed} 个身份的尝试次数读取失败`);
            return failed === 0;
        } finally {
            if (requestId === attemptsRequest.current) setAttemptsLoading(false);
        }
    }, [projectId]);

    const loadIdentities = useCallback(async () => {
        const requestId = ++identityRequest.current;
        if (!selectedCharacter) {
            setIdentities([]);
            setLoadingIdentities(false);
            setIdentitiesError("");
            await loadAttemptsFor("", []);
            return true;
        }
        setLoadingIdentities(true);
        setIdentitiesError("");
        try {
            const next = await fetchDramaCharacterIdentities(projectId, selectedCharacter);
            if (requestId !== identityRequest.current) return false;
            setIdentities(next);
            return await loadAttemptsFor(selectedCharacter, next);
        } catch (error) {
            if (requestId === identityRequest.current) setIdentitiesError(error instanceof Error ? error.message : "未知错误");
            return false;
        } finally {
            if (requestId === identityRequest.current) setLoadingIdentities(false);
        }
    }, [loadAttemptsFor, projectId, selectedCharacter]);

    useEffect(() => {
        void loadCharacters();
        return () => { characterRequest.current += 1; };
    }, [loadCharacters]);

    useEffect(() => {
        void loadIdentities();
        return () => { identityRequest.current += 1; };
    }, [loadIdentities]);

    const openCreate = () => setEditor({ mode: "create", identity: null, values: emptyIdentityValues() });
    const openEdit = (identity: DramaCharacterIdentity) => setEditor({
        mode: "edit",
        identity,
        values: {
            identity_name: identity.identity_name,
            age_group: identity.age_group ?? "",
            appearance_details: identity.appearance_details ?? "",
            face_prompt: identity.face_prompt ?? "",
            body_type: identity.body_type ?? "",
        },
    });

    const submit = async (values: IdentityEditor["values"]) => {
        if (!editor || !selectedCharacter) return;
        const result = await runWrite(async () => {
            if (editor.mode === "create") {
                const payload: DramaCharacterIdentityCreate = {
                    identity_name: values.identity_name.trim(),
                    age_group: values.age_group,
                    appearance_details: values.appearance_details,
                };
                return createDramaCharacterIdentity(projectId, selectedCharacter, payload);
            } else if (editor.identity) {
                const payload: DramaCharacterIdentityUpdate = {
                    identity_name: values.identity_name.trim(),
                    age_group: values.age_group,
                    appearance_details: values.appearance_details,
                    face_prompt: values.face_prompt,
                    body_type: values.body_type,
                };
                return updateDramaCharacterIdentity(projectId, selectedCharacter, editor.identity.identity_id, payload);
            }
            return undefined;
        });
        if (result.success) {
            setEditor(null);
            await loadIdentities();
        }
    };

    const confirmDelete = async (identityId: string) => {
        if (!selectedCharacter) return;
        const result = await runWrite(() => deleteDramaCharacterIdentity(projectId, selectedCharacter, identityId));
        if (result.success) {
            setDeleteConfirmId(null);
            await loadIdentities();
        }
    };

    const runWrite = useCallback(async <T,>(operation: () => Promise<T>): Promise<{ success: boolean; value?: T }> => {
        if (busy || unknownWriteMessage) return { success: false };
        setBusy(true);
        setOperationError("");
        try {
            return { success: true, value: await operation() };
        } catch (error) {
            if (error instanceof DramaIdentityWriteOutcomeUnknownError) {
                setUnknownWriteMessage(error.message);
                setUnknownWriteRefreshed(false);
                setOperationError("");
            } else {
                setOperationError(error instanceof Error ? error.message : "虾塘操作失败");
            }
            return { success: false };
        } finally {
            setBusy(false);
        }
    }, [busy, unknownWriteMessage]);

    const buildCharacters = async () => {
        const result = await runWrite(() => startDramaCharacterBuild(projectId));
        if (result.success && result.value) setTaskReceipt(result.value);
    };

    const generateCharacterPortrait = async () => {
        if (!selectedCharacter) return;
        const result = await runWrite(() => startDramaCharacterPortrait(projectId, selectedCharacter));
        if (result.success && result.value) setTaskReceipt(result.value);
    };

    const uploadCharacterPortrait = async (file: File) => {
        if (!selectedCharacter) return;
        const result = await runWrite(() => uploadDramaCharacterPortrait(projectId, selectedCharacter, file));
        if (result.success) await loadCharacters();
    };

    const generateIdentityImage = async (identityId: string) => {
        const result = await runWrite(() => startDramaIdentityImage(projectId, selectedCharacter, identityId));
        if (result.success && result.value) setTaskReceipt(result.value);
    };

    const generateIdentityPortrait = async (identityId: string) => {
        const result = await runWrite(() => startDramaIdentityPortrait(projectId, selectedCharacter, identityId));
        if (result.success && result.value) setTaskReceipt(result.value);
    };

    const uploadIdentityAsset = async (identity: DramaCharacterIdentity, kind: DramaIdentityAssetKind, file: File) => {
        const result = await runWrite(() => uploadDramaIdentityAsset(projectId, selectedCharacter, identity.identity_id, identity.identity_name, kind, file));
        if (result.success) await loadIdentities();
    };

    const confirmDeleteAsset = async () => {
        if (!assetDeleteConfirm) return;
        const result = await runWrite(() => deleteDramaIdentityAsset(projectId, selectedCharacter, assetDeleteConfirm.identityId, assetDeleteConfirm.kind));
        if (result.success) {
            setAssetDeleteConfirm(null);
            await loadIdentities();
        }
    };

    const recheckUnknownWrite = async () => {
        const characterRead = await loadCharacters();
        const identityRead = await loadIdentities();
        if (characterRead && identityRead) setUnknownWriteRefreshed(true);
    };

    const confirmUnknownWriteChecked = () => {
        setUnknownWriteMessage("");
        setUnknownWriteRefreshed(false);
    };

    const selectedCharacterDetails = characters.find((character) => character.name === selectedCharacter);

    return (
        <CharacterIdentitiesManagerView
            characters={characters}
            selectedCharacter={selectedCharacter}
            selectedCharacterDetails={selectedCharacterDetails}
            identities={identities}
            attemptsByIdentityId={attemptsByIdentityId}
            attemptsLoading={attemptsLoading}
            attemptsError={attemptsError}
            taskReceipt={taskReceipt}
            unknownWriteMessage={unknownWriteMessage}
            unknownWriteRefreshed={unknownWriteRefreshed}
            loadingCharacters={loadingCharacters}
            loadingIdentities={loadingIdentities}
            charactersError={charactersError}
            identitiesError={identitiesError}
            operationError={operationError}
            editor={editor}
            deleteConfirmId={deleteConfirmId}
            assetDeleteConfirm={assetDeleteConfirm}
            busy={busy}
            onSelectCharacter={setSelectedCharacter}
            onRetryCharacters={() => void loadCharacters()}
            onRetryIdentities={() => void loadIdentities()}
            onBuildCharacters={() => void buildCharacters()}
            onGenerateCharacterPortrait={() => void generateCharacterPortrait()}
            onUploadCharacterPortrait={(file) => void uploadCharacterPortrait(file)}
            onGenerateIdentityImage={(identityId) => void generateIdentityImage(identityId)}
            onGenerateIdentityPortrait={(identityId) => void generateIdentityPortrait(identityId)}
            onUploadIdentityAsset={(identity, kind, file) => void uploadIdentityAsset(identity, kind, file)}
            onRequestDeleteIdentityAsset={(identityId, kind) => setAssetDeleteConfirm({ identityId, kind })}
            onCancelDeleteAsset={() => setAssetDeleteConfirm(null)}
            onConfirmDeleteAsset={confirmDeleteAsset}
            onRetryAttempts={() => void loadAttemptsFor(selectedCharacter, identities)}
            onRecheckUnknownWrite={() => void recheckUnknownWrite()}
            onConfirmUnknownWriteChecked={confirmUnknownWriteChecked}
            onCreate={openCreate}
            onEdit={openEdit}
            onChangeEditor={(field, value) => setEditor((current) => current ? { ...current, values: { ...current.values, [field]: value } } : current)}
            onCancelEditor={() => setEditor(null)}
            onSubmit={submit}
            onRequestDelete={setDeleteConfirmId}
            onCancelDelete={() => setDeleteConfirmId(null)}
            onConfirmDelete={confirmDelete}
        />
    );
}
