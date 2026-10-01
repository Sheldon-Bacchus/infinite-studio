"use client";

// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapts DramaClaw's project dashboard to Infinite Canvas routes and components.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Input, Modal, Spin } from "antd";
import { Archive, ArchiveRestore, Clapperboard, FolderOpen, Plus, RefreshCw, RotateCcw, Search, Settings2, Trash2 } from "lucide-react";

import {
    fetchDramaProjects,
    filterDramaProjectSummaries,
    createDramaProject,
    updateDramaProjectLifecycle,
    type DramaProjectAction,
    type DramaProjectStatus,
    type DramaProjectSummary,
} from "@/services/api/drama-import";
import { ProjectSettingsDialog } from "./components/project-settings-dialog";

const STATUS_TABS: Array<{ value: DramaProjectStatus; label: string }> = [
    { value: "active", label: "进行中" },
    { value: "archived", label: "已归档" },
    { value: "deleted", label: "回收站" },
];

export function xiaTangProjectPath(projectId: string) {
    return `/xiaji/project/${encodeURIComponent(projectId)}`;
}

function projectTimestamp(project: DramaProjectSummary) {
    const timestamp = project.updatedAt || project.archivedAt || project.deletedAt;
    if (!timestamp) return "暂无更新时间";
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? "暂无更新时间" : `更新于 ${date.toLocaleDateString("zh-CN")}`;
}

export function XiaTangProjectsView({
    projects,
    status,
    query,
    loading,
    error,
    onStatusChange,
    onQueryChange,
    onRefresh,
    onOpen,
    onSettings,
    onOpenEpisodes,
    onAction,
    onCreate,
}: {
    projects: DramaProjectSummary[];
    status: DramaProjectStatus;
    query: string;
    loading: boolean;
    error: string;
    onStatusChange: (status: DramaProjectStatus) => void;
    onQueryChange: (query: string) => void;
    onRefresh: () => void;
    onOpen: (project: DramaProjectSummary) => void;
    onSettings: (project: DramaProjectSummary) => void;
    onOpenEpisodes: () => void;
    onAction: (project: DramaProjectSummary, action: DramaProjectAction) => void;
    onCreate: () => void;
}) {
    const visibleProjects = useMemo(() => filterDramaProjectSummaries(projects, status, query), [projects, status, query]);
    const counts = useMemo(() => ({
        active: projects.filter((project) => project.status === "active").length,
        archived: projects.filter((project) => project.status === "archived").length,
        deleted: projects.filter((project) => project.status === "deleted").length,
    }), [projects]);

    return (
        <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
            <header className="border-b border-border/60 bg-card/30 px-6 py-6 lg:px-9">
                <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-5">
                    <div>
                        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"><Clapperboard className="size-4" />DramaClaw · 虾集</p>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight">虾塘项目</h1>
                        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">打开虾集项目，管理角色、场景、道具和声线；素材可直接发送到虾画。</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" aria-label="打开旧版集数与分镜导入" onClick={onOpenEpisodes} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground">
                            <Clapperboard className="size-4" />集数与分镜导入
                        </button>
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={onRefresh}>刷新</Button>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={onCreate}>新建项目</Button>
                    </div>
                </div>
            </header>

            <section className="mx-auto flex w-full max-w-[1440px] min-h-0 flex-1 flex-col px-6 py-6 lg:px-9">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="项目状态">
                        {STATUS_TABS.map((tab) => (
                            <button
                                key={tab.value}
                                type="button"
                                role="tab"
                                aria-selected={status === tab.value}
                                onClick={() => onStatusChange(tab.value)}
                                className={`rounded-full border px-4 py-2 text-sm transition-colors ${status === tab.value ? "border-foreground/20 bg-foreground text-background" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                            >
                                {tab.label}<span className="ml-2 tabular-nums opacity-65">{counts[tab.value]}</span>
                            </button>
                        ))}
                    </div>
                    <label className="flex h-10 min-w-[240px] items-center gap-2 rounded-md border border-border bg-card/40 px-3 sm:w-80">
                        <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        <Input variant="borderless" aria-label="搜索虾集项目" placeholder="搜索项目名称" value={query} onChange={(event) => onQueryChange(event.target.value)} />
                    </label>
                </div>

                {error ? <div role="alert" className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div> : null}
                {loading && projects.length === 0 ? <div className="flex flex-1 items-center justify-center"><Spin tip="正在读取虾集项目…" /></div> : null}
                {!loading && !error && visibleProjects.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
                        <div className="rounded-full border border-border bg-card p-4 text-muted-foreground">{status === "deleted" ? <Trash2 className="size-6" /> : <FolderOpen className="size-6" />}</div>
                        <p className="text-sm font-medium">{query ? "没有匹配的项目" : status === "active" ? "暂无进行中的项目" : status === "archived" ? "暂无归档项目" : "回收站为空"}</p>
                        <p className="max-w-md text-xs text-muted-foreground">项目列表来自 DramaClaw；检查后端 DramaClaw 地址和项目访问权限。</p>
                    </div>
                ) : null}

                {visibleProjects.length ? (
                    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {visibleProjects.map((project) => {
                            const canOpen = project.status !== "deleted";
                            const canManage = project.effectiveRole === "owner";
                            const actions: Array<{ action: DramaProjectAction; label: string; icon: ReactNode; danger?: boolean }> = project.status === "active"
                                ? [{ action: "archive", label: "归档", icon: <Archive className="size-3.5" /> }, { action: "delete", label: "删除", icon: <Trash2 className="size-3.5" />, danger: true }]
                                : project.status === "archived"
                                    ? [{ action: "unarchive", label: "取消归档", icon: <ArchiveRestore className="size-3.5" /> }, { action: "delete", label: "删除", icon: <Trash2 className="size-3.5" />, danger: true }]
                                    : [{ action: "restore", label: "恢复", icon: <RotateCcw className="size-3.5" /> }, { action: "purge", label: "永久删除", icon: <Trash2 className="size-3.5" />, danger: true }];
                            return (
                                <article
                                    key={project.id}
                                    className="group min-h-44 rounded-xl border border-border bg-card/50 p-5 transition hover:border-primary/40 hover:bg-card hover:shadow-lg hover:shadow-black/10"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex size-11 items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground group-hover:text-foreground"><FolderOpen className="size-5" /></div>
                                        <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">{STATUS_TABS.find((item) => item.value === project.status)?.label}</span>
                                    </div>
                                    <button type="button" disabled={!canOpen} onClick={() => onOpen(project)} aria-label={canOpen ? `打开项目 ${project.name}` : `项目 ${project.name} 已删除`} className="mt-5 block max-w-full truncate text-left text-base font-semibold hover:underline disabled:cursor-not-allowed disabled:no-underline" title={project.name}>{project.name}</button>
                                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                        <span>{project.episodeCount} 集 · {project.beatCount} 个分镜</span>
                                        <span className="truncate">{projectTimestamp(project)}</span>
                                    </div>
                                    <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-3">
                                        {canOpen ? <button type="button" aria-label={`编辑项目配置 ${project.name}`} disabled={!canManage} title={canManage ? undefined : "只有项目所有者可以编辑项目配置"} onClick={() => onSettings(project)} className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45">
                                            <Settings2 className="size-3.5" />项目配置
                                        </button> : null}
                                        {actions.map((item) => <button key={item.action} type="button" disabled={!canManage} title={!canManage ? item.action === "purge" ? "只有项目所有者可以永久删除项目" : "只有项目所有者可以管理此项目" : undefined} onClick={() => onAction(project, item.action)} className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45 ${item.danger ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}>
                                            {item.icon}{item.label}
                                        </button>)}
                                        {!canManage ? <p className="basis-full text-xs text-muted-foreground">当前权限不能管理此项目；项目设置与生命周期操作需要所有者权限。</p> : null}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                ) : null}
            </section>
        </main>
    );
}

export function XiaTangProjectsPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const [projects, setProjects] = useState<DramaProjectSummary[]>([]);
    const [status, setStatus] = useState<DramaProjectStatus>("active");
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);
    const [settingsProject, setSettingsProject] = useState<DramaProjectSummary | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            setProjects(await fetchDramaProjects());
        } catch (cause) {
            const readable = cause instanceof Error ? cause.message : "读取虾集项目列表失败";
            setError(readable);
            message.error(readable);
        } finally {
            setLoading(false);
        }
    }, [message]);

    const handleCreate = async () => {
        const name = newName.trim();
        if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) return;
        setCreating(true);
        try {
            const created = await createDramaProject(name);
            const projectId = created.id || created.project_id || created.name || name;
            message.success("虾集项目已创建");
            setCreateOpen(false);
            setNewName("");
            await refresh();
            router.push(xiaTangProjectPath(projectId));
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "新建虾集项目失败");
        } finally {
            setCreating(false);
        }
    };

    const handleAction = (project: DramaProjectSummary, action: DramaProjectAction) => {
        const labels: Record<DramaProjectAction, string> = {
            archive: "归档项目",
            unarchive: "取消归档",
            delete: "移入回收站",
            restore: "恢复项目",
            purge: "永久删除项目",
        };
        const descriptions: Record<DramaProjectAction, string> = {
            archive: "归档后仍可在虾集打开并查看。",
            unarchive: "项目将返回进行中列表。",
            delete: "项目会移入回收站，可之后恢复。",
            restore: "项目将恢复到进行中列表。",
            purge: "此操作会永久删除项目，无法恢复。",
        };
        const run = async () => {
            try {
                await updateDramaProjectLifecycle(project.id, action);
                message.success(`${labels[action]}成功`);
                await refresh();
            } catch (cause) {
                message.error(cause instanceof Error ? cause.message : `${labels[action]}失败`);
            }
        };
        if (action === "delete" || action === "purge") {
            Modal.confirm({
                title: `${labels[action]}：${project.name}`,
                content: descriptions[action],
                okText: labels[action],
                cancelText: "取消",
                okType: "danger",
                onOk: run,
            });
        } else {
            void run();
        }
    };

    useEffect(() => { void refresh(); }, [refresh]);

    return (
        <>
            <XiaTangProjectsView
                projects={projects}
                status={status}
                query={query}
                loading={loading}
                error={error}
                onStatusChange={setStatus}
                onQueryChange={setQuery}
                onRefresh={() => void refresh()}
                onOpen={(project) => router.push(xiaTangProjectPath(project.id))}
                onSettings={(project) => setSettingsProject(project)}
                onOpenEpisodes={() => router.push("/xiaji/episodes")}
                onAction={handleAction}
                onCreate={() => setCreateOpen(true)}
            />
            {settingsProject ? <ProjectSettingsDialog
                key={settingsProject.id}
                projectId={settingsProject.id}
                open
                onClose={() => setSettingsProject(null)}
                onSaved={() => message.success("虾集项目配置已保存")}
            /> : null}
            <Modal
                title="新建虾集项目"
                open={createOpen}
                okText="创建并打开"
                cancelText="取消"
                confirmLoading={creating}
                okButtonProps={{ disabled: !/^[A-Za-z0-9_]{1,64}$/.test(newName.trim()) }}
                onOk={() => void handleCreate()}
                onCancel={() => { if (!creating) setCreateOpen(false); }}
                destroyOnHidden
            >
                <label className="grid gap-2 py-3 text-sm">
                    项目名称
                    <Input autoFocus maxLength={64} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="英文、数字或下划线，最多 64 位" />
                </label>
            </Modal>
        </>
    );
}
