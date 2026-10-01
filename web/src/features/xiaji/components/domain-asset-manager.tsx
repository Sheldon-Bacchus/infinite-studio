"use client";

import { Button, Form, Input, Switch } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import {
    createDramaAssetDomainItem,
    deleteDramaAssetDomainItem,
    fetchDramaAssetDomain,
    updateDramaAssetDomainItem,
    type DramaAssetDomain,
    type DramaAssetDomainItem,
} from "@/services/api/drama-import";

type DomainField = { key: string; label: string; multiline?: boolean; boolean?: boolean; list?: boolean };

const domainSettings: Record<DramaAssetDomain, { title: string; fields: DomainField[] }> = {
    characters: {
        title: "角色",
        fields: [
            { key: "name", label: "名称" },
            { key: "aliases", label: "别名", list: true },
            { key: "role", label: "角色定位" },
            { key: "gender", label: "性别" },
            { key: "age_group", label: "年龄段" },
            { key: "description", label: "描述", multiline: true },
            { key: "face_prompt", label: "面部提示词", multiline: true },
            { key: "body_type", label: "体型" },
            { key: "is_main", label: "主角", boolean: true },
        ],
    },
    scenes: {
        title: "场景",
        fields: [
            { key: "name", label: "名称" },
            { key: "scene_type", label: "场景类型" },
            { key: "time_of_day", label: "时间" },
            { key: "environment_prompt", label: "环境提示词", multiline: true },
            { key: "variant_prompt", label: "变化提示词", multiline: true },
            { key: "description", label: "描述", multiline: true },
            { key: "notes", label: "备注", multiline: true },
        ],
    },
    props: {
        title: "道具",
        fields: [
            { key: "name", label: "名称" },
            { key: "aliases", label: "别名", list: true },
            { key: "prop_type", label: "道具类型" },
            { key: "visual_prompt", label: "视觉提示词", multiline: true },
            { key: "description", label: "描述", multiline: true },
            { key: "owner", label: "所属角色" },
            { key: "notes", label: "备注", multiline: true },
        ],
    },
};

type DomainEditor = { mode: "create" | "edit"; item: DramaAssetDomainItem | null };

export type DomainAssetManagerViewProps = {
    domain: DramaAssetDomain;
    items: DramaAssetDomainItem[];
    loading: boolean;
    error: string;
    editor: DomainEditor | null;
    deleteConfirmName: string | null;
    busy: boolean;
    onRetry: () => void;
    onCreate: () => void;
    onEdit: (item: DramaAssetDomainItem) => void;
    onRequestDelete: (name: string) => void;
    onCancelDelete: () => void;
    onConfirmDelete: (name: string) => void;
    onCloseEditor: () => void;
    onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
};

function fieldValue(field: DomainField, value: unknown) {
    if (field.boolean) {
        if (value === true) return "是";
        if (value === false) return "否";
        return "未设置";
    }
    if (field.list && Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join("、") || "未填写";
    if (typeof value === "string") return value.trim() ? value : "未填写";
    if (typeof value === "number") return String(value);
    return value == null ? "未填写" : String(value);
}

function DomainAssetEditor({ domain, editor, busy, onClose, onSubmit }: {
    domain: DramaAssetDomain;
    editor: DomainEditor;
    busy: boolean;
    onClose: () => void;
    onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
}) {
    const config = domainSettings[domain];
    const initialValues = Object.fromEntries(config.fields.map(({ key, boolean, list }) => [
        key,
        boolean ? editor.item?.[key] === true
            : list ? Array.isArray(editor.item?.[key]) ? editor.item[key].filter((part): part is string => typeof part === "string").join(", ") : typeof editor.item?.[key] === "string" ? editor.item[key] : ""
                : typeof editor.item?.[key] === "string" ? editor.item[key] : "",
    ]));

    return (
        <section aria-label={`${editor.mode === "create" ? "新增" : "编辑"}${config.title}`} className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-4 text-base font-semibold">
                {editor.mode === "create" ? `新增${config.title}` : `编辑${config.title}：${String(editor.item?.name ?? "")}`}
            </h3>
            <Form
                key={`${domain}-${editor.mode}-${String(editor.item?.name ?? "new")}`}
                layout="vertical"
                initialValues={initialValues}
                onFinish={(values) => {
                    const body = Object.fromEntries(config.fields.map(({ key, boolean, list }) => [
                        key,
                        boolean ? values[key] === true
                            : list ? String(values[key] ?? "").split(/[，,、]/).map((value) => value.trim()).filter(Boolean)
                                : key === "name" ? String(values[key] ?? "").trim() : String(values[key] ?? ""),
                    ]));
                    return onSubmit(body);
                }}
                className="!mb-0"
            >
                <div className="grid gap-x-4 sm:grid-cols-2">
                    {config.fields.map((field) => (
                        <Form.Item
                            key={field.key}
                            name={field.key}
                            label={field.label}
                            valuePropName={field.boolean ? "checked" : "value"}
                            rules={field.key === "name" ? [{ required: true, whitespace: true, message: `请输入${config.title}名称` }] : undefined}
                        >
                            {field.boolean ? <Switch /> : field.multiline ? <Input.TextArea rows={3} /> : <Input />}
                        </Form.Item>
                    ))}
                </div>
                <div className="flex justify-end gap-2">
                    <Button autoInsertSpace={false} htmlType="button" onClick={onClose} disabled={busy}>取消</Button>
                    <Button autoInsertSpace={false} type="primary" htmlType="submit" loading={busy}>{editor.mode === "create" ? `创建${config.title}` : `保存${config.title}`}</Button>
                </div>
            </Form>
        </section>
    );
}

export function DomainAssetManagerView({
    domain,
    items,
    loading,
    error,
    editor,
    deleteConfirmName,
    busy,
    onRetry,
    onCreate,
    onEdit,
    onRequestDelete,
    onCancelDelete,
    onConfirmDelete,
    onCloseEditor,
    onSubmit,
}: DomainAssetManagerViewProps) {
    const config = domainSettings[domain];

    return (
        <section aria-label={`${config.title}资产管理`} className="space-y-4">
            <header className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">{config.title}资产管理</h2>
                    <p className="mt-1 text-sm text-muted-foreground">管理 DramaClaw 项目中的{config.title}资料。</p>
                </div>
                <Button autoInsertSpace={false} type="primary" onClick={onCreate} disabled={busy}>{`新增${config.title}`}</Button>
            </header>

            {loading ? <p role="status" className="py-5 text-center text-sm text-muted-foreground">正在加载{config.title}…</p>
                : error ? (
                    <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        <span>加载失败：{error}</span>
                        <Button autoInsertSpace={false} onClick={onRetry}>重试</Button>
                    </div>
                ) : items.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">暂无{config.title}，可以新增一项。</p>
                ) : (
                    <ul className="grid gap-3">
                        {items.map((item, index) => {
                            const name = String(item.name ?? `未命名${config.title}`);
                            const confirming = deleteConfirmName === name;
                            return (
                                <li key={`${name}-${index}`} className="rounded-lg border border-border bg-card p-4">
                                    <div className="mb-3 flex items-start justify-between gap-3">
                                        <h3 className="text-base font-semibold">{name}</h3>
                                        {confirming ? null : (
                                            <div className="flex shrink-0 gap-2">
                                                <Button autoInsertSpace={false} htmlType="button" aria-label={`编辑 ${name}`} onClick={() => onEdit(item)} disabled={busy}>编辑</Button>
                                                <Button autoInsertSpace={false} htmlType="button" aria-label={`删除 ${name}`} danger onClick={() => onRequestDelete(name)} disabled={busy}>删除</Button>
                                            </div>
                                        )}
                                    </div>
                                    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                                        {config.fields.map((field) => (
                                            <div key={field.key} className="min-w-0">
                                                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                                                <dd className="whitespace-pre-wrap break-words text-sm">{fieldValue(field, item[field.key])}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                    {confirming ? (
                                        <div role="alertdialog" aria-label={`确认删除${config.title}${name}`} className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2">
                                            <p className="text-sm">确认删除{config.title}“{name}”？此操作无法撤销。</p>
                                            <div className="flex gap-2">
                                                <Button autoInsertSpace={false} htmlType="button" onClick={onCancelDelete} disabled={busy}>取消</Button>
                                                <Button autoInsertSpace={false} htmlType="button" danger type="primary" onClick={() => onConfirmDelete(name)} loading={busy}>确认删除</Button>
                                            </div>
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}

            {editor ? <DomainAssetEditor key={`${domain}-${editor.mode}-${String(editor.item?.name ?? "new")}`} domain={domain} editor={editor} busy={busy} onClose={onCloseEditor} onSubmit={onSubmit} /> : null}
        </section>
    );
}

export function DomainAssetManager({ projectId, domain }: { projectId: string; domain: DramaAssetDomain }) {
    const [items, setItems] = useState<DramaAssetDomainItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [editor, setEditor] = useState<DomainEditor | null>(null);
    const [deleteConfirmName, setDeleteConfirmName] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const requestSequence = useRef(0);

    const reload = useCallback(async () => {
        const requestId = ++requestSequence.current;
        setLoading(true);
        setError("");
        try {
            const nextItems = await fetchDramaAssetDomain(projectId, domain);
            if (requestId === requestSequence.current) setItems(nextItems);
        } catch (cause) {
            if (requestId === requestSequence.current) setError(cause instanceof Error ? cause.message : "未知错误");
        } finally {
            if (requestId === requestSequence.current) setLoading(false);
        }
    }, [projectId, domain]);

    useEffect(() => {
        void reload();
        return () => { requestSequence.current += 1; };
    }, [reload]);

    const submit = async (values: Record<string, unknown>) => {
        if (!editor) return;
        setBusy(true);
        setError("");
        try {
            if (editor.mode === "edit" && editor.item && typeof editor.item.name === "string") {
                await updateDramaAssetDomainItem(projectId, domain, editor.item.name, values);
            } else {
                await createDramaAssetDomainItem(projectId, domain, values);
            }
            setEditor(null);
            await reload();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "未知错误");
        } finally {
            setBusy(false);
        }
    };

    const confirmDelete = async (name: string) => {
        setBusy(true);
        setError("");
        try {
            await deleteDramaAssetDomainItem(projectId, domain, name);
            setDeleteConfirmName(null);
            await reload();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "未知错误");
        } finally {
            setBusy(false);
        }
    };

    return (
        <DomainAssetManagerView
            domain={domain}
            items={items}
            loading={loading}
            error={error}
            editor={editor}
            deleteConfirmName={deleteConfirmName}
            busy={busy}
            onRetry={() => void reload()}
            onCreate={() => { setError(""); setEditor({ mode: "create", item: null }); }}
            onEdit={(item) => { setError(""); setEditor({ mode: "edit", item }); }}
            onRequestDelete={(name) => setDeleteConfirmName(name)}
            onCancelDelete={() => setDeleteConfirmName(null)}
            onConfirmDelete={(name) => void confirmDelete(name)}
            onCloseEditor={() => setEditor(null)}
            onSubmit={submit}
        />
    );
}
