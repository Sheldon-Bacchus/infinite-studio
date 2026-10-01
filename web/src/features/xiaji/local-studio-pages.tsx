"use client";

// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Checkbox, Empty, Input, Modal, Popconfirm, Select, Spin, Tag } from "antd";
import { ArrowLeft, ArrowRight, Clapperboard, FileText, FolderOpen, Layers3, Plus, Sparkles, Trash2 } from "lucide-react";

import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { getLocalStudioRecord, listCurrentLocalStudioBeats, summarizeLocalStudioEpisode } from "./local-studio-model";
import { getXiaTangRecord, listXiaTangProjectAssets } from "./xia-tang-local-model";
import { visibleLocalStudioAssets } from "./local-studio-asset-visibility";
import { localStudioRepository } from "./local-studio-runtime";
import { LocalStudioProjectCreateOutcomeUnknownError, type LocalStudioProjectCreateAttempt } from "./local-studio-repository";
import { getStudioWorkflowNavigation, localStudioRoutes } from "./local-studio-routes";
import { previewLocalEpisodeStructure, type LocalEpisodeDraft } from "./local-manuscript-structure";
import { LocalStudioEpisodeList } from "./local-studio-episode-list";
import { buildLocalStudioScriptPrompt } from "./local-studio-script-prompt";
import { deleteLocalWorkspaceAssets, listLocalCanvasProjects, listLocalWorkspaceAssets } from "@/services/api/local-workspace";
import { getLocalStudioIntakeActions, tryAcquireLocalStudioSubmission } from "./local-studio-intake-model";
import { ensureLocalStudioProjectCanvasBinding, resolveLocalStudioCanvasBinding } from "./local-studio-canvas-binding";
import { collectLocalStudioProjectAssetIds, deleteLocalStudioProject } from "./local-studio-project-lifecycle";
import { planXiajiProjectProjectionArrangement, planXiajiProjectProjectionImport, previewXiajiProjectProjection, type XiajiProjectProjectionPreview, type XiajiProjectProjectionArrangementPlan } from "./project-canvas-projection";
import { resolveLocalAssetImportOrigin } from "./send-to-canvas";
import { buildXiajiArtifactReview, readXiajiArtifactHandoffs, removeXiajiArtifactHandoff, validateXiajiArtifactPackage, type XiajiArtifactHandoff, type XiajiArtifactPackage, type XiajiArtifactValidation } from "./xiaji-artifact-package";

const STYLE_OPTIONS = [
    { value: "chinese_period_drama", label: "中国古装剧" },
    { value: "anime", label: "动漫" },
    { value: "guoman_fantasy", label: "国漫奇幻" },
    { value: "post_apocalyptic", label: "末日废土" },
    { value: "realistic", label: "写实" },
    { value: "republican_era_drama", label: "民国剧" },
];

const PROJECT_TYPES = [
    { value: "drama", label: "精品短剧" },
    { value: "narrated", label: "解说漫剧" },
];

const PROJECT_CREATE_ATTEMPT_KEY = "infinite-canvas:xiaji:project-create:v1";

function StudioHeader({ title, projectId, description }: { title: string; projectId?: string; description?: string }) {
    const workflowNavigation = getStudioWorkflowNavigation(projectId);
    return (
        <header className="border-b border-border/60 bg-card/30 px-5 py-5 md:px-8">
            <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground"><Clapperboard className="size-4" />DramaClaw · 创作流程本地版</div>
                    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                    {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
                </div>
                <nav aria-label="虾塘工作流" className="flex flex-wrap items-center gap-2 text-sm">
                    {workflowNavigation.map(({ label, href, disabledReason }) => href ? (
                        <Link key={label} className="rounded-md border border-border px-3 py-2 hover:bg-accent" href={href}>{label}</Link>
                    ) : (
                        <span key={label} aria-disabled="true" title={disabledReason || undefined} className="cursor-not-allowed rounded-md border border-border/60 px-3 py-2 text-muted-foreground/60">
                            {label}<span className="sr-only">：{disabledReason}</span>
                        </span>
                    ))}
                </nav>
            </div>
        </header>
    );
}

function useLocalAssets() {
    const storedAssets = useAssetStore((state) => state.assets);
    const assets = useMemo(() => visibleLocalStudioAssets(storedAssets), [storedAssets]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    useEffect(() => {
        let alive = true;
        void useAssetStore.getState().refreshWorkspaceAssets().catch((error) => {
            if (alive) setLoadError(error instanceof Error ? error.message : "读取本地素材失败");
        }).finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);
    return { assets, loading, loadError };
}

function textAssetContent(asset: Asset) {
    return asset.kind === "text" ? asset.data.content : "";
}

function ensureCanvasForStudioProject(projectAssetId: string, title: string) {
    return ensureLocalStudioProjectCanvasBinding(projectAssetId, title, {
        refresh: () => useCanvasStore.getState().refreshFromLocalWorkspace(),
        create: (canvasTitle, canonicalProjectAssetId) => useCanvasStore.getState().createProject(canvasTitle, { xiajiProjectAssetId: canonicalProjectAssetId }),
        save: (canvasId, canonicalProjectAssetId) => useCanvasStore.getState().saveProjectAndWait(canvasId, { xiajiProjectAssetId: canonicalProjectAssetId }),
    });
}

function episodeOrder(asset: Asset) {
    const record = getLocalStudioRecord(asset);
    return record?.recordType === "episode" ? record.order : 0;
}

type XiajiArtifactInboxItem = { handoff: XiajiArtifactHandoff; source: "session" | "file"; validation?: XiajiArtifactValidation };

function hasCommittedXiajiPackage(assets: Asset[], handoff: XiajiArtifactHandoff): boolean {
    if (!handoff.package || !Array.isArray(handoff.package.artifacts)) return false;
    const committed = assets.flatMap((asset) => {
        const marker = asset.metadata?.localStudioCommit;
        return marker && typeof marker === "object" && !Array.isArray(marker) && (marker as Record<string, unknown>).packageId === handoff.packageId ? [marker as Record<string, unknown>] : [];
    });
    if (!committed.length || committed.some((marker) => marker.contentDigest !== handoff.contentDigest)) return false;
    const sourceKeys = [...new Set(committed.flatMap((marker) => Array.isArray(marker.sourceKeys) ? marker.sourceKeys.filter((key): key is string => typeof key === "string") : []))].sort();
    return JSON.stringify(sourceKeys) === JSON.stringify(handoff.package.artifacts.map((artifact) => artifact.sourceKey).sort());
}

function formatArtifactMetadataValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(formatArtifactMetadataValue).filter(Boolean).join("、");
    return JSON.stringify(value);
}

const ARTIFACT_KIND_LABELS: Record<string, string> = {
    episode: "分集",
    script: "剧本",
    beat: "镜头/Beat",
    "asset-reference": "素材关联",
    "media-reference": "媒体关联",
};

const ARTIFACT_METADATA_LABELS: Record<string, string> = {
    order: "顺序",
    synopsis: "梗概",
    sourceEpisodeNumber: "来源集数",
    dialogueText: "台词/旁白",
    speaker: "说话人",
    voiceAssetId: "声线素材 ID",
    durationSeconds: "时长（秒）",
    referencedAssetIds: "关联素材 ID",
    beatAssetId: "镜头素材 ID",
    beatSourceKey: "镜头来源键",
    assetId: "素材 ID",
};

export function LocalStudioIntakePage() {
    const router = useRouter();
    const { message } = App.useApp();
    const [title, setTitle] = useState("");
    const [projectType, setProjectType] = useState("drama");
    const [baseStyle, setBaseStyle] = useState(STYLE_OPTIONS[0].value);
    const [sourceText, setSourceText] = useState("");
    const [sourceName, setSourceName] = useState("");
    const [drafts, setDrafts] = useState<LocalEpisodeDraft[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [createAttempt, setCreateAttempt] = useState<LocalStudioProjectCreateAttempt | null>(null);
    const [attemptRecoveryBlocked, setAttemptRecoveryBlocked] = useState(false);
    const submissionLock = useRef(false);
    useEffect(() => {
        try {
            const raw = window.sessionStorage.getItem(PROJECT_CREATE_ATTEMPT_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as LocalStudioProjectCreateAttempt;
            if (parsed?.schemaVersion !== 1 || typeof parsed.projectAssetId !== "string" || typeof parsed.commitId !== "string"
                || !parsed.input || !Array.isArray(parsed.input.episodes) || !Array.isArray(parsed.assets)) {
                throw new Error("项目保存恢复记录格式无效");
            }
            setCreateAttempt(parsed);
            setTitle(parsed.input.title);
            setProjectType(parsed.input.projectType);
            setBaseStyle(parsed.input.baseStyle);
            setSourceText(parsed.input.sourceText);
            setSourceName(parsed.input.sourceName || "");
            setDrafts(parsed.input.episodes.map((episode) => ({ ...episode, synopsis: episode.synopsis || "" })));
            setError("上一轮项目保存结果待核验。表单已恢复；再次保存会复用同一组 ID、提交摘要和原稿内容，不会创建新副本。");
        } catch (cause) {
            setAttemptRecoveryBlocked(true);
            setError(`无法读取上一轮项目保存尝试；为避免重复建项目，当前先阻止新提交。${cause instanceof Error ? ` ${cause.message}` : ""}`);
        }
    }, []);
    const intakeActions = getLocalStudioIntakeActions({ title, sourceText, draftCount: drafts.length, saving, analyzing: false });

    const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const content = await file.text();
            if (!content.trim()) throw new Error("文件内容为空");
            setSourceText(content);
            setSourceName(file.name);
            setTitle((current) => current || file.name.replace(/\.[^.]+$/, ""));
            setDrafts(previewLocalEpisodeStructure(content, title || file.name.replace(/\.[^.]+$/, "")));
            setError("");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "读取剧本文件失败");
        }
        event.target.value = "";
    };

    const handleCreate = async (event: FormEvent) => {
        event.preventDefault();
        if (attemptRecoveryBlocked || !tryAcquireLocalStudioSubmission(submissionLock)) return;
        if (!title.trim() || !sourceText.trim()) {
            submissionLock.current = false;
            setError("请填写项目名称并导入原文");
            return;
        }
        setSaving(true);
        if (!createAttempt) setError("");
        let attempt = createAttempt;
        let requestStarted = false;
        let navigationStarted = false;
        try {
            if (!attempt) {
                attempt = await localStudioRepository.prepareProjectCreation({
                    title: title.trim(), projectType, baseStyle, sourceText, sourceName: sourceName || undefined,
                    episodes: drafts.map(({ title: episodeTitle, order, synopsis, sourceEpisodeNumber }) => ({ title: episodeTitle, order, synopsis, sourceEpisodeNumber })),
                });
                const serialized = JSON.stringify(attempt);
                try {
                    window.sessionStorage.setItem(PROJECT_CREATE_ATTEMPT_KEY, serialized);
                    if (window.sessionStorage.getItem(PROJECT_CREATE_ATTEMPT_KEY) !== serialized) throw new Error("恢复记录回读不一致");
                } catch (cause) {
                    throw new Error(`浏览器无法保存本次恢复记录，尚未发送项目保存请求。请释放会话空间后重试。${cause instanceof Error ? ` ${cause.message}` : ""}`);
                }
                setCreateAttempt(attempt);
            }
            requestStarted = true;
            const result = await localStudioRepository.commitProjectCreation(attempt);
            window.sessionStorage.removeItem(PROJECT_CREATE_ATTEMPT_KEY);
            setCreateAttempt(null);
            let canvasBindingError = "";
            try {
                await ensureCanvasForStudioProject(result.project.id, `${result.project.title} · 虾画`);
            } catch (cause) {
                canvasBindingError = cause instanceof Error ? cause.message : "项目画布绑定失败";
            }
            message.success(result.episodes.length ? `项目和原稿已保存，包含 ${result.episodes.length} 集` : "项目和原稿已保存；分集可稍后从 Agent 产物导入");
            if (canvasBindingError) message.warning(`项目已保存，但原生虾画尚未绑定：${canvasBindingError}。进入项目后可重试打开虾画。`);
            router.push(localStudioRoutes.project(result.project.id));
            navigationStarted = true;
        } catch (cause) {
            if (cause instanceof LocalStudioProjectCreateOutcomeUnknownError) {
                setCreateAttempt(cause.attempt);
                setError(cause.message);
            } else if (requestStarted && attempt) {
                setCreateAttempt(attempt);
                setError(`本地项目保存结果待核验；固定提交已保留，可再次使用同一提交读取或重试。${cause instanceof Error ? cause.message : ""}`);
            } else {
                try { window.sessionStorage.removeItem(PROJECT_CREATE_ATTEMPT_KEY); } catch { /* request was not sent */ }
                setCreateAttempt(null);
                setError(cause instanceof Error ? cause.message : "本地项目保存失败；没有把问题归因于输入操作");
            }
        } finally {
            if (!navigationStarted) {
                submissionLock.current = false;
                setSaving(false);
            }
        }
    };

    return (
        <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
            <StudioHeader title="虾料 · 新建项目" description="上传或粘贴小说/剧本，选择项目类型与基础风格；本页不调用文本模型。" />
            <form onSubmit={handleCreate} className="mx-auto w-full max-w-5xl space-y-6 px-5 py-6 md:px-8">
                <section className="rounded-xl border border-border bg-card/50 p-5">
                    <div className="mb-4 flex items-center gap-2 text-base font-semibold"><FileText className="size-4" />项目内容</div>
                    <div className="grid gap-4 md:grid-cols-3">
                        <label className="space-y-1.5 text-sm"><span>项目名称</span><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="输入项目名称" disabled={Boolean(createAttempt) || attemptRecoveryBlocked} /></label>
                        <label className="space-y-1.5 text-sm"><span>项目类型</span><Select className="w-full" value={projectType} options={PROJECT_TYPES} onChange={setProjectType} disabled={Boolean(createAttempt) || attemptRecoveryBlocked} /></label>
                        <label className="space-y-1.5 text-sm"><span>基础风格</span><Select className="w-full" value={baseStyle} options={STYLE_OPTIONS} onChange={setBaseStyle} disabled={Boolean(createAttempt) || attemptRecoveryBlocked} /></label>
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                        <label className={`inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm ${createAttempt || attemptRecoveryBlocked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-accent"}`}><input type="file" className="sr-only" accept=".txt,.md,.markdown,.fountain,.fdx,text/plain" disabled={Boolean(createAttempt) || attemptRecoveryBlocked} onChange={(event) => void chooseFile(event)} />上传小说/剧本</label>
                        {sourceName ? <Tag>{sourceName}</Tag> : null}
                        <span className="text-xs text-muted-foreground">支持纯文本、Markdown 与 Fountain 文件；原文按文本素材保存在 Infinite Canvas 本地素材库。</span>
                    </div>
                    <Input.TextArea className="mt-4" aria-label="小说/剧本内容" value={sourceText} onChange={(event) => { setSourceText(event.target.value); setDrafts([]); setError(""); }} rows={13} placeholder="也可以直接粘贴小说或剧本内容" disabled={Boolean(createAttempt) || attemptRecoveryBlocked} />
                </section>

                <section className="rounded-xl border border-border bg-card/50 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div><h2 className="font-semibold">项目结构预览</h2><p className="mt-1 text-xs text-muted-foreground">仅识别原文中已有的分集标题；Agent 生成的结构请在项目保存后导入虾镜审核。</p></div>
                        <div className="flex flex-wrap gap-2">
                            <Button type="primary" disabled={intakeActions.primaryDisabled || Boolean(createAttempt) || attemptRecoveryBlocked} onClick={() => { setError(""); setDrafts(previewLocalEpisodeStructure(sourceText, title)); }}>{intakeActions.primaryLabel}</Button>
                            <span className="self-center text-xs text-muted-foreground">保存项目后自动进入虾镜，再导入 Agent 产物审核。</span>
                        </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">可识别“第 N 集/章/节/回”标题；没有标题时保持空分集，项目与原稿仍可直接保存。</p>
                    {error ? <div role="alert" className={`mt-4 rounded-md border px-3 py-2 text-sm ${createAttempt ? "border-amber-500/30 bg-amber-500/5 text-amber-700" : "border-destructive/30 bg-destructive/5 text-destructive"}`}><p>{error}</p>{createAttempt ? <p className="mt-1 break-all text-xs">提交 ID：{createAttempt.commitId} · 项目素材 ID：{createAttempt.projectAssetId}</p> : null}</div> : null}
                    {drafts.length ? <ol className="mt-5 space-y-2">{drafts.map((episode) => <li key={episode.order} className="rounded-lg border border-border/70 bg-background/60 p-3"><div className="flex items-center gap-2"><Tag color="blue">第 {episode.order} 集</Tag><strong>{episode.title}</strong></div><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{episode.synopsis || "暂无梗概"}</p></li>)}</ol> : <div className="mt-5 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">未识别到分集标题。可以先保存项目与原稿，之后将 Agent 产物导入虾镜。</div>}
                </section>
                <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/xiaji" className="text-sm text-muted-foreground hover:text-foreground">返回虾塘</Link><div className="flex flex-col items-end gap-1"><Button htmlType="submit" type="primary" size="large" loading={saving} disabled={intakeActions.saveDisabled || attemptRecoveryBlocked}>{createAttempt ? "核验 / 使用同一提交重试" : intakeActions.saveLabel}</Button><span aria-live="polite" className="text-xs text-muted-foreground">{createAttempt ? "固定 IDs、提交摘要和原稿已经保存在本标签；不会新建副本。" : intakeActions.saveHint}</span>{!createAttempt && !intakeActions.saveDisabled ? <span className="text-xs text-muted-foreground">{intakeActions.nextStepHint}</span> : null}</div></div>
            </form>
        </main>
    );
}

export function LocalStudioProjectsPage() {
    const { assets, loading, loadError } = useLocalAssets();
    const { message } = App.useApp();
    const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
    const projects = useMemo(() => assets.filter((asset) => getLocalStudioRecord(asset)?.recordType === "project"), [assets]);
    const deleteProject = async (projectAssetId: string) => {
        setDeletingProjectId(projectAssetId);
        try {
            const assetIds = await deleteLocalStudioProject(projectAssetId, {
                getAssets: () => useAssetStore.getState().assets,
                listCanvasProjects: listLocalCanvasProjects,
                deleteAssets: deleteLocalWorkspaceAssets,
                listAssets: listLocalWorkspaceAssets,
            });

            useAssetStore.setState((state) => ({ assets: state.assets.filter((asset) => !assetIds.includes(asset.id)) }));
            message.success("项目及关联记录已从本机素材库删除");
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "删除本地项目失败");
        } finally {
            setDeletingProjectId(null);
        }
    };
    return (
        <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
            <StudioHeader title="虾镜 · 项目选择" description="已有项目从这里继续创作；新项目先在虾料导入原稿并建立，保存后会进入虾镜。" />
            <section className="mx-auto w-full max-w-[1440px] flex-1 px-5 py-6 md:px-8">
                <div className="mb-5 flex justify-end"><Link href={localStudioRoutes.ingest}><Button type="primary" icon={<Plus className="size-4" />}>虾料新建项目</Button></Link></div>
                {loadError ? <p role="alert" className="mb-4 text-sm text-destructive">{loadError}</p> : null}
                {loading ? <div className="grid min-h-64 place-items-center"><Spin /></div> : projects.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{projects.map((project) => {
                    const record = getLocalStudioRecord(project);
                    const episodes = assets.filter((asset) => { const item = getLocalStudioRecord(asset); return item?.recordType === "episode" && item.projectAssetId === project.id; });
                    const ownedAssetCount = collectLocalStudioProjectAssetIds(assets, project.id).length;
                    return <article key={project.id} className="rounded-xl border border-border bg-card/50 p-5"><div className="flex items-start justify-between"><FolderOpen className="size-5 text-muted-foreground" /><Tag>{PROJECT_TYPES.find((item) => item.value === record?.projectType)?.label || String(record?.projectType || "项目")}</Tag></div><h2 className="mt-5 truncate text-lg font-semibold">{project.title}</h2><p className="mt-2 text-sm text-muted-foreground">{episodes.length} 集 · {STYLE_OPTIONS.find((item) => item.value === record?.baseStyle)?.label || String(record?.baseStyle || "未选风格")}</p><div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-3"><Link href={localStudioRoutes.project(project.id)}><Button size="small">打开虾镜</Button></Link><Popconfirm title={`删除该项目及其 ${Math.max(0, ownedAssetCount - 1)} 条关联记录？`} description="本机素材库中的原稿、分集、剧本、镜头及虾塘资产记录会被移除；已上传媒体文件不会因此物理删除。若画布仍引用这些素材，系统会阻止删除。" okText="确认删除" cancelText="取消" okButtonProps={{ danger: true, loading: deletingProjectId === project.id }} onConfirm={() => deleteProject(project.id)}><Button size="small" danger loading={deletingProjectId === project.id} icon={<Trash2 className="size-3.5" />}>删除项目</Button></Popconfirm></div></article>;
                })}</div> : <Empty description="还没有虾料项目" className="py-16"><Link href={localStudioRoutes.ingest}><Button type="primary">上传小说/剧本</Button></Link></Empty>}
            </section>
        </main>
    );
}

export function LocalStudioProjectPage({ projectAssetId }: { projectAssetId: string }) {
    const router = useRouter();
    const { message } = App.useApp();
    const { assets, loading, loadError } = useLocalAssets();
    const [openingCanvas, setOpeningCanvas] = useState(false);
    const [projectImportPreview, setProjectImportPreview] = useState<XiajiProjectProjectionPreview | null>(null);
    const [projectImportCanvasId, setProjectImportCanvasId] = useState("");
    const [selectedProjectImportIds, setSelectedProjectImportIds] = useState<string[]>([]);
    const [savingProjectImport, setSavingProjectImport] = useState(false);
    const [arrangementPreview, setArrangementPreview] = useState<{ canvasId: string; plan: XiajiProjectProjectionArrangementPlan } | null>(null);
    const [savingArrangement, setSavingArrangement] = useState(false);
    const [artifactInbox, setArtifactInbox] = useState<XiajiArtifactInboxItem[]>([]);
    const [artifactInboxIssues, setArtifactInboxIssues] = useState<string[]>([]);
    const [artifactCanvas, setArtifactCanvas] = useState<{ id: string; xiajiProjectAssetId?: string } | null>(null);
    const [savingArtifactPackageId, setSavingArtifactPackageId] = useState<string | null>(null);
    const [artifactFileError, setArtifactFileError] = useState("");
    const project = assets.find((asset) => asset.id === projectAssetId && getLocalStudioRecord(asset)?.recordType === "project");
    const record = project ? getLocalStudioRecord(project) : null;
    const episodes = assets.filter((asset) => { const item = getLocalStudioRecord(asset); return item?.recordType === "episode" && item.projectAssetId === projectAssetId; });
    const sourceText = localStudioRepository.getSourceText(projectAssetId);
    useEffect(() => {
        let alive = true;
        const load = async () => {
            try {
                const stored = readXiajiArtifactHandoffs(window.sessionStorage, projectAssetId);
                if (alive) {
                    setArtifactInboxIssues(stored.issues);
                    setArtifactInbox(stored.items.map((item) => ({ handoff: item as unknown as XiajiArtifactHandoff, source: "session" as const })));
                }
                const projects = await useCanvasStore.getState().refreshFromLocalWorkspace();
                const binding = resolveLocalStudioCanvasBinding(projects, projectAssetId);
                if (alive && binding.status === "bound") {
                    const canvas = projects.find((item) => item.id === binding.canvasId);
                    if (canvas) {
                        setArtifactCanvas({ id: canvas.id, xiajiProjectAssetId: canvas.xiajiProjectAssetId });
                        setArtifactInbox((current) => current.map((item) => item.source === "file" && !item.handoff.canvasId
                            ? { ...item, handoff: { ...item.handoff, canvasId: canvas.id } }
                            : item));
                    }
                }
            } catch (cause) {
                if (alive) setArtifactInboxIssues([cause instanceof Error ? cause.message : "读取 Agent 产物交接失败"]);
            }
        };
        void load();
        return () => { alive = false; };
    }, [projectAssetId]);
    const artifactInboxFingerprint = artifactInbox.map(({ handoff }) => `${handoff.key || "file"}:${handoff.packageId}:${handoff.contentDigest}:${handoff.canvasId}`).join("|");
    useEffect(() => {
        let alive = true;
        const refreshValidation = async () => {
            const next = await Promise.all(artifactInbox.map(async (item) => {
                if (!item.handoff.package || item.handoff.package.packageId !== item.handoff.packageId
                    || item.handoff.package.contentDigest !== item.handoff.contentDigest
                    || item.handoff.package.projectAssetId !== projectAssetId
                    || !Array.isArray(item.handoff.package.artifacts)) {
                    return { ...item, validation: { ok: false, code: "invalid-handoff", message: "交接包身份或正文不完整；不能确认保存" } };
                }
                if (hasCommittedXiajiPackage(assets, item.handoff)) return { ...item, validation: { ok: true, code: "already-committed", message: "该产物包已通过本地回读确认" } };
                if (!artifactCanvas) return { ...item, validation: { ok: false, code: "canvas-unbound", message: "项目尚未绑定原生虾画；先打开或创建唯一项目画布" } };
                const validation = await validateXiajiArtifactPackage(assets, artifactCanvas, item.handoff.package as unknown as Record<string, unknown>);
                return { ...item, validation };
            }));
            if (alive) setArtifactInbox(next);
        };
        void refreshValidation();
        return () => { alive = false; };
    }, [assets, artifactCanvas, artifactInboxFingerprint]);
    const ensureProjectCanvas = async () => {
        if (!project) throw new Error("项目不存在或已被删除");
        const canvasId = await ensureCanvasForStudioProject(projectAssetId, `${project.title} · 虾画`);
        const canvas = useCanvasStore.getState().projects.find((item) => item.id === canvasId);
        if (!canvas) throw new Error("项目唯一画布已确认，但本地画布列表暂时没有该记录，请刷新后重试");
        setArtifactCanvas({ id: canvas.id, xiajiProjectAssetId: canvas.xiajiProjectAssetId });
        setArtifactInbox((current) => current.map((item) => item.source === "file" && !item.handoff.canvasId
            ? { ...item, handoff: { ...item.handoff, canvasId: canvas.id } }
            : item));
        return canvasId;
    };
    const openProjectCanvas = async () => {
        setOpeningCanvas(true);
        try {
            const canvasId = await ensureProjectCanvas();
            router.push(`/canvas/${encodeURIComponent(canvasId)}`);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "打开项目画布失败");
        } finally {
            setOpeningCanvas(false);
        }
    };
    const prepareProjectCanvasImport = async () => {
        setOpeningCanvas(true);
        try {
            const canvasId = await ensureProjectCanvas();
            const assetStore = useAssetStore.getState();
            await assetStore.refreshWorkspaceAssets();
            if (useAssetStore.getState().workspaceError) throw new Error(useAssetStore.getState().workspaceError || "本地素材库读取失败");
            const preview = await previewXiajiProjectProjection(useAssetStore.getState().assets, projectAssetId);
            if (preview.issues.length) throw new Error(preview.issues.map((item) => item.message).join("；"));
            setProjectImportCanvasId(canvasId);
            setProjectImportPreview(preview);
            setSelectedProjectImportIds(preview.items.map((item) => item.assetId));
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "读取项目结构失败");
        } finally {
            setOpeningCanvas(false);
        }
    };
    const confirmProjectCanvasImport = async () => {
        if (!projectImportPreview || savingProjectImport) return;
        setSavingProjectImport(true);
        try {
            await useAssetStore.getState().refreshWorkspaceAssets();
            const latestAssets = useAssetStore.getState().assets;
            if (useAssetStore.getState().workspaceError) throw new Error(useAssetStore.getState().workspaceError || "本地素材库读取失败");
            const latestPreview = await previewXiajiProjectProjection(latestAssets, projectAssetId);
            if (latestPreview.sourceDigest !== projectImportPreview.sourceDigest || latestPreview.issues.length) throw new Error("项目原稿或分集在预览后已变化，请重新打开导入预览");
            const canvasProjects = await useCanvasStore.getState().refreshFromLocalWorkspace();
            const binding = resolveLocalStudioCanvasBinding(canvasProjects, projectAssetId);
            if (binding.status !== "bound" || binding.canvasId !== projectImportCanvasId) throw new Error("项目画布绑定已变化；请重新读取此项目的唯一画布");
            const canvas = canvasProjects.find((item) => item.id === projectImportCanvasId);
            if (!canvas) throw new Error("项目关联画布不存在");
            const plan = await planXiajiProjectProjectionImport({
                canvasId: canvas.id,
                existingNodes: canvas.nodes,
                assets: latestAssets,
                preview: latestPreview,
                sourceDigest: latestPreview.sourceDigest,
                sourceAssetIds: selectedProjectImportIds,
                origin: resolveLocalAssetImportOrigin(canvas.nodes),
            });
            await useCanvasStore.getState().saveProjectAndWait(canvas.id, { nodes: plan.nodes, connections: canvas.connections, autoTitlePending: false });
            const savedProjects = await useCanvasStore.getState().refreshFromLocalWorkspace();
            const savedCanvas = savedProjects.find((item) => item.id === canvas.id);
            const preserved = canvas.nodes.every((node) => JSON.stringify(savedCanvas?.nodes.find((saved) => saved.id === node.id)) === JSON.stringify(node));
            const imported = plan.createdSourceAssetIds.every((id) => {
                const nodeId = plan.nodeIdsBySourceAssetId[id];
                return JSON.stringify(savedCanvas?.nodes.find((node) => node.id === nodeId)) === JSON.stringify(plan.nodes.find((node) => node.id === nodeId));
            });
            const connectionsUnchanged = JSON.stringify(savedCanvas?.connections || []) === JSON.stringify(canvas.connections || []);
            if (!savedCanvas || !preserved || !imported || !connectionsUnchanged) throw new Error("保存回读未能确认全部导入节点；未删除或回滚画布内容");
            const arrangePlan = await planXiajiProjectProjectionArrangement({ canvasId: canvas.id, projectionId: plan.projectionId, nodes: savedCanvas.nodes, connections: savedCanvas.connections });
            setArrangementPreview({ canvasId: canvas.id, plan: arrangePlan });
            setProjectImportPreview(null);
            message.success(`已保存并回读 ${plan.createdSourceAssetIds.length} 个新节点；请检查下一步排版与连线清单`);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "项目结构导入失败");
        } finally {
            setSavingProjectImport(false);
        }
    };
    const confirmProjectCanvasArrangement = async () => {
        if (!arrangementPreview || savingArrangement) return;
        setSavingArrangement(true);
        try {
            const canvasProjects = await useCanvasStore.getState().refreshFromLocalWorkspace();
            const binding = resolveLocalStudioCanvasBinding(canvasProjects, projectAssetId);
            if (binding.status !== "bound" || binding.canvasId !== arrangementPreview.canvasId) throw new Error("项目画布绑定已变化，未执行排版");
            const canvas = canvasProjects.find((item) => item.id === arrangementPreview.canvasId);
            if (!canvas) throw new Error("项目关联画布不存在");
            const currentPlan = await planXiajiProjectProjectionArrangement({ canvasId: canvas.id, projectionId: arrangementPreview.plan.projectionId, nodes: canvas.nodes, connections: canvas.connections });
            if (currentPlan.manifestDigest !== arrangementPreview.plan.manifestDigest) throw new Error("画布状态在审阅后已变化；请重新检查排版清单");
            await useCanvasStore.getState().saveProjectAndWait(canvas.id, { nodes: currentPlan.nodes, connections: currentPlan.connections, autoTitlePending: false });
            const saved = (await useCanvasStore.getState().refreshFromLocalWorkspace()).find((item) => item.id === canvas.id);
            if (!saved || JSON.stringify(saved.nodes) !== JSON.stringify(currentPlan.nodes) || JSON.stringify(saved.connections) !== JSON.stringify(currentPlan.connections)) throw new Error("排版或连线保存尚未通过画布回读确认");
            setArrangementPreview(null);
            router.push(`/canvas/${encodeURIComponent(canvas.id)}`);
            message.success(`排版与 ${currentPlan.addedConnectionIds.length} 条项目关系连线已保存并回读确认`);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "项目画布排版失败");
        } finally {
            setSavingArrangement(false);
        }
    };
    const importArtifactPackageFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setArtifactFileError("");
        try {
            const parsedValue: unknown = JSON.parse(await file.text());
            let value: unknown = parsedValue;
            if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).completePackageJson === "string") {
                value = JSON.parse(String((value as Record<string, unknown>).completePackageJson));
            }
            const outer = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
            const rawPackage = outer?.package && typeof outer.package === "object" && !Array.isArray(outer.package) ? outer.package as Record<string, unknown> : outer;
            if (!rawPackage || typeof rawPackage.projectAssetId !== "string" || rawPackage.projectAssetId !== projectAssetId
                || typeof rawPackage.packageId !== "string" || typeof rawPackage.contentDigest !== "string") {
                throw new Error("JSON 不属于当前项目，或缺少 Agent packageId/contentDigest");
            }
            if ((typeof outer?.projectAssetId === "string" && outer.projectAssetId !== rawPackage.projectAssetId)
                || (typeof outer?.packageId === "string" && outer.packageId !== rawPackage.packageId)
                || (typeof outer?.contentDigest === "string" && outer.contentDigest !== rawPackage.contentDigest)) {
                throw new Error("JSON 交接封套与 Agent 产物包身份不一致");
            }
            const canvasProjects = await useCanvasStore.getState().refreshFromLocalWorkspace();
            const binding = resolveLocalStudioCanvasBinding(canvasProjects, projectAssetId);
            const canvas = binding.status === "bound" ? canvasProjects.find((item) => item.id === binding.canvasId) : undefined;
            if (canvas) setArtifactCanvas({ id: canvas.id, xiajiProjectAssetId: canvas.xiajiProjectAssetId });
            const handoff = {
                key: typeof outer?.key === "string" ? outer.key : `file:${rawPackage.packageId}:${rawPackage.contentDigest}`,
                projectAssetId,
                canvasId: typeof outer?.canvasId === "string" ? outer.canvasId : canvas?.id || "",
                packageId: rawPackage.packageId,
                contentDigest: rawPackage.contentDigest,
                package: rawPackage as unknown as XiajiArtifactPackage,
                stagedAt: typeof outer?.stagedAt === "string" ? outer.stagedAt : new Date().toISOString(),
            } satisfies XiajiArtifactHandoff;
            setArtifactInbox((current) => current.some((item) => item.handoff.packageId === handoff.packageId && item.handoff.contentDigest === handoff.contentDigest)
                ? current
                : [...current, { handoff, source: "file" }]);
        } catch (cause) {
            setArtifactFileError(cause instanceof Error ? cause.message : "读取 Agent 产物 JSON 失败");
        } finally {
            event.target.value = "";
        }
    };
    const removeArtifactPackage = (item: XiajiArtifactInboxItem) => {
        if (item.source === "session" && item.handoff.key) {
            try { removeXiajiArtifactHandoff(window.sessionStorage, item.handoff.key); }
            catch (cause) { setArtifactInboxIssues((current) => [...current, cause instanceof Error ? cause.message : "無法移除会话交接记录"]); }
        }
        setArtifactInbox((current) => current.filter((candidate) => candidate.handoff.packageId !== item.handoff.packageId || candidate.handoff.contentDigest !== item.handoff.contentDigest));
    };
    const confirmArtifactPackage = async (item: XiajiArtifactInboxItem) => {
        if (savingArtifactPackageId) return;
        setSavingArtifactPackageId(item.handoff.packageId);
        try {
            await useAssetStore.getState().refreshWorkspaceAssets();
            const latestAssets = useAssetStore.getState().assets;
            if (useAssetStore.getState().workspaceError) throw new Error(useAssetStore.getState().workspaceError || "本地素材库读取失败");
            const canvasProjects = await useCanvasStore.getState().refreshFromLocalWorkspace();
            const binding = resolveLocalStudioCanvasBinding(canvasProjects, projectAssetId);
            if (binding.status !== "bound" || binding.canvasId !== item.handoff.canvasId) throw new Error("产物包目标画布与项目当前唯一绑定不一致；未保存");
            const canvas = canvasProjects.find((candidate) => candidate.id === binding.canvasId);
            if (!canvas) throw new Error("本地项目画布不存在");
            const alreadyCommitted = hasCommittedXiajiPackage(latestAssets, item.handoff);
            const validation = alreadyCommitted
                ? { ok: true, package: item.handoff.package }
                : await validateXiajiArtifactPackage(latestAssets, canvas, item.handoff.package as unknown as Record<string, unknown>);
            if (!validation.ok || !validation.package) throw new Error(validation.message || "Agent 产物包已过期；请重新读取项目上下文并生成新包");
            const result = await localStudioRepository.commitXiajiArtifactPackage(validation.package as XiajiArtifactPackage, canvas, item.handoff.stagedAt);
            await useAssetStore.getState().refreshWorkspaceAssets();
            const savedAssets = useAssetStore.getState().assets;
            if (useAssetStore.getState().workspaceError || !hasCommittedXiajiPackage(savedAssets, item.handoff)) throw new Error("本地保存响应尚未通过 canonical 回读确认；交接包保留，可刷新核验后重试");
            if (item.source === "session") {
                try { removeXiajiArtifactHandoff(window.sessionStorage, item.handoff.key || ""); } catch { /* canonical Asset markers make a later replay safe */ }
            }
            setArtifactInbox((current) => current.filter((candidate) => candidate.handoff.packageId !== item.handoff.packageId || candidate.handoff.contentDigest !== item.handoff.contentDigest));
            message.success(result.replayed ? "已回读确认该 Agent 产物包此前保存完成" : `Agent 产物已保存并回读确认（${result.assetIds.length} 条本地素材）`);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "Agent 产物保存失败；交接包仍保留");
        } finally {
            setSavingArtifactPackageId(null);
        }
    };
    if (loading) return <main className="grid h-full place-items-center"><Spin /></main>;
    if (loadError || !project || record?.recordType !== "project") return <main className="p-8"><p role="alert" className="text-destructive">{loadError || "找不到此本地项目"}</p><Link href={localStudioRoutes.projects}>返回项目列表</Link></main>;
    return (
        <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
            <StudioHeader title={project.title} projectId={project.id} description={`${PROJECT_TYPES.find((item) => item.value === record.projectType)?.label || record.projectType} · ${STYLE_OPTIONS.find((item) => item.value === record.baseStyle)?.label || record.baseStyle}`} />
            <section className="mx-auto w-full max-w-[1440px] flex-1 px-5 py-6 md:px-8">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <ProjectModuleCard onClick={() => void openProjectCanvas()} loading={openingCanvas} icon={<Clapperboard />} title="虾画" description="打开此项目唯一关联的 Infinite Canvas 原生画布" count="同一项目 ID" />
                    <ProjectModuleCard href={localStudioRoutes.characters(project.id)} icon={<Layers3 />} title="虾塘" description="角色、场景、道具与声线" count={`${assets.filter((asset) => (asset.metadata?.xiaTang as { projectAssetId?: string } | undefined)?.projectAssetId === project.id).length} 项`} />
                    <ProjectModuleCard href={localStudioRoutes.episodes(project.id)} icon={<Clapperboard />} title="虾镜" description="分集、剧本、镜头与合成" count={`${episodes.length} 集`} />
                    
                    <ProjectModuleCard href={localStudioRoutes.ingestProject(project.id)} icon={<FileText />} title="原稿与结构" description="查看原始小说/剧本与分集结构" count={`${sourceText?.length || 0} 字`} />
                </div>
                <section aria-labelledby="xiaji-agent-inbox-title" className="mt-5 rounded-xl border border-border bg-card/40 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h2 id="xiaji-agent-inbox-title" className="font-semibold">Agent 产物 · 审阅后保存</h2>
                            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Codex/Agent 在虾画读取本项目上下文并暂存产物后，会出现在这里。逐项检查内容、明确关系和素材引用；只有点击确认后才写入当前项目的本地素材。</p>
                        </div>
                        <label className="inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
                            <input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => void importArtifactPackageFile(event)} />
                            导入 Agent 产物 JSON
                        </label>
                    </div>
                    {artifactFileError ? <p role="alert" className="mt-3 text-sm text-destructive">{artifactFileError}</p> : null}
                    {artifactInboxIssues.length ? <div role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><p className="font-medium">部分会话交接无法读取：</p><ul className="mt-1 list-disc pl-5">{artifactInboxIssues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul></div> : null}
                    {artifactInbox.length === 0 ? <Empty className="py-8" image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前项目没有待审 Agent 产物。可从虾画暂存，或导入完整 JSON 包。" /> : (
                        <div className="mt-4 space-y-4">
                            {artifactInbox.map((item) => {
                                const handoff = item.handoff;
                                const review = buildXiajiArtifactReview(handoff.package);
                                const validation = item.validation;
                                const kindLabel = (kind: string) => ARTIFACT_KIND_LABELS[kind] || kind;
                                return (
                                    <article key={`${handoff.packageId}:${handoff.contentDigest}`} className="rounded-lg border border-border bg-background/70 p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{review.stageLabel}</h3><Tag color={validation?.ok ? "green" : "red"}>{validation?.ok ? (validation.code === "already-committed" ? "已保存待回读清理" : "可确认保存") : "不可确认"}</Tag><Tag>{item.source === "session" ? "虾画会话交接" : "本地 JSON"}</Tag></div>
                                                <p className="mt-1 break-all text-xs text-muted-foreground">包 {handoff.packageId} · {review.artifacts.length} 项 · {new Date(handoff.stagedAt).toLocaleString()}</p>
                                                <p className="mt-1 break-all text-xs text-muted-foreground">基础版本：{handoff.package?.baseRevision || "缺失"} · 目标画布：{handoff.canvasId || "尚未绑定"}</p>
                                            </div>
                                            <div className="flex shrink-0 gap-2">
                                                <Button size="small" type="primary" loading={savingArtifactPackageId === handoff.packageId} disabled={!validation?.ok || Boolean(savingArtifactPackageId)} onClick={() => void confirmArtifactPackage(item)}>{validation?.code === "already-committed" ? "回读确认并移除" : "确认并保存到项目"}</Button>
                                                <Button size="small" disabled={savingArtifactPackageId === handoff.packageId} onClick={() => removeArtifactPackage(item)}>移除待审项</Button>
                                            </div>
                                        </div>
                                        {validation?.message ? <p className={`mt-3 text-sm ${validation.ok ? "text-muted-foreground" : "text-destructive"}`} role={validation.ok ? undefined : "alert"}>{validation.message}</p> : <p className="mt-3 text-sm text-muted-foreground">正在校验项目、画布绑定和基础版本…</p>}
                                        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
                                            <div>
                                                <h4 className="mb-2 text-sm font-medium">产物明细</h4>
                                                {review.artifacts.length ? <ol className="max-h-[32rem] space-y-2 overflow-y-auto">{review.artifacts.map((artifact) => <li key={artifact.sourceKey} className="rounded-md border border-border/70 p-3"><div className="flex flex-wrap items-center gap-2"><Tag>{kindLabel(artifact.kind)}</Tag><strong className="min-w-0 break-words text-sm">{artifact.title}</strong><span className="break-all text-xs text-muted-foreground">{artifact.sourceKey}</span></div>{artifact.content ? <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm">{artifact.content}</p> : null}{Object.entries(artifact.metadata).length ? <dl className="mt-2 grid gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-xs sm:grid-cols-2">{Object.entries(artifact.metadata).slice(0, 24).map(([key, value]) => <div key={key} className="min-w-0"><dt className="inline text-muted-foreground">{ARTIFACT_METADATA_LABELS[key] || key}：</dt><dd className="inline break-words">{formatArtifactMetadataValue(value)}</dd></div>)}</dl> : null}</li>)}</ol> : <p className="text-sm text-destructive">没有可显示的产物明细。</p>}
                                            </div>
                                            <div className="space-y-4">
                                                <div><h4 className="mb-2 text-sm font-medium">明确关系</h4>{review.relations.length ? <ul className="max-h-52 space-y-1 overflow-y-auto text-sm">{review.relations.map((relation, index) => <li key={`${relation.from}:${relation.type}:${relation.to}:${index}`} className="break-all">{relation.from} <span className="text-muted-foreground">—{relation.type}→</span> {relation.to}</li>)}</ul> : <p className="text-sm text-muted-foreground">产物包没有声明关系。</p>}</div>
                                                <div><h4 className="mb-2 text-sm font-medium">本地媒体引用</h4>{review.mediaAssetIds.length ? <ul className="max-h-32 space-y-1 overflow-y-auto text-sm">{review.mediaAssetIds.map((id) => <li key={id} className="break-all">{id}</li>)}</ul> : <p className="text-sm text-muted-foreground">没有媒体引用。</p>}</div>
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </section>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/40 p-5">
                    <div><h2 className="font-semibold">将已保存项目导入虾画</h2><p className="mt-1 text-sm text-muted-foreground">先审阅项目、原稿与分集节点；保存回读后，再单独确认排版和关系连线。不会要求先创建剧本或镜头。</p></div>
                    <Button onClick={() => void prepareProjectCanvasImport()} loading={openingCanvas} disabled={loading || !project}>预览项目结构导入</Button>
                </div>
                <div className="mt-6 rounded-xl border border-border bg-card/40 p-5"><h2 className="font-semibold">最近分集</h2>{episodes.length ? <ol className="mt-3 divide-y divide-border/60">{episodes.slice(0, 5).map((episode) => { const item = getLocalStudioRecord(episode); return <li key={episode.id} className="flex items-center justify-between gap-3 py-3"><div><strong>{item?.recordType === "episode" ? `第 ${item.order} 集 · ${item.title}` : episode.title}</strong><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{textAssetContent(episode)}</p></div><Link href={localStudioRoutes.script(project.id, episode.id)}><Button size="small">继续创作</Button></Link></li>; })}</ol> : <p className="mt-3 text-sm text-muted-foreground">尚无分集。进入虾镜创建，或回到虾料分析原稿。</p>}</div>
            </section>
            <Modal title="审阅项目结构并导入虾画" open={Boolean(projectImportPreview)} confirmLoading={savingProjectImport} okText="确认导入所选节点" cancelText="取消" onOk={() => void confirmProjectCanvasImport()} onCancel={() => { if (!savingProjectImport) setProjectImportPreview(null); }} destroyOnHidden>
                <p className="mb-3 text-sm text-muted-foreground">这些内容将以新的文本节点追加到本项目唯一关联画布。已有节点和连线会保留；剧本与镜头不属于此阶段要求。</p>
                <div className="max-h-[55vh] space-y-3 overflow-y-auto">{projectImportPreview?.items.map((item) => <label key={item.assetId} className="flex gap-3 rounded-lg border border-border p-3"><Checkbox checked={selectedProjectImportIds.includes(item.assetId)} disabled={item.role === "project" || item.role === "manuscript"} onChange={(event) => setSelectedProjectImportIds((current) => event.target.checked ? [...current, item.assetId] : current.filter((id) => id !== item.assetId))} /><span className="min-w-0"><strong className="text-sm">{item.title}</strong><span className="ml-2 text-xs text-muted-foreground">{item.role === "project" ? "项目" : item.role === "manuscript" ? "原稿（必选）" : "分集"}</span><span className="mt-1 block whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.content.slice(0, 500)}{item.content.length > 500 ? "…" : ""}</span></span></label>)}</div>
            </Modal>
            <Modal title="第二次审阅：确认排版与关系连线" open={Boolean(arrangementPreview)} confirmLoading={savingArrangement} okText="确认排版并连接" cancelText="稍后处理" onOk={() => void confirmProjectCanvasArrangement()} onCancel={() => { if (!savingArrangement) setArrangementPreview(null); }} destroyOnHidden>
                <p className="mb-3 text-sm text-muted-foreground">以下节点已经逐项保存并回读。确认后仅移动本次导入的项目节点，并新增列出的关系连线；手工节点、已有连线和导入节点内容均保留。</p>
                <p className="mb-2 text-sm font-medium">排版节点：{arrangementPreview?.plan.approvedNodeIds.length || 0}</p>
                <ul className="mb-4 max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm">{arrangementPreview?.plan.approvedNodeIds.map((id) => <li key={id}>{arrangementPreview.plan.nodes.find((node) => node.id === id)?.title || id}</li>)}</ul>
                <p className="mb-2 text-sm font-medium">新增关系连线：{arrangementPreview?.plan.addedConnectionIds.length || 0}</p>
                <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-sm">{arrangementPreview?.plan.addedConnectionIds.map((id) => { const edge = arrangementPreview.plan.connections.find((connection) => connection.id === id); const from = arrangementPreview.plan.nodes.find((node) => node.id === edge?.fromNodeId); const to = arrangementPreview.plan.nodes.find((node) => node.id === edge?.toNodeId); return <li key={id}>{from?.title} → {to?.title}</li>; })}</ul>
            </Modal>
        </main>
    );
}

function ProjectModuleCard({ href, onClick, loading, icon, title, description, count }: { href?: string; onClick?: () => void; loading?: boolean; icon: React.ReactNode; title: string; description: string; count: string }) {
    const content = <><div className="flex items-center justify-between"><span className="text-muted-foreground">{icon}</span>{loading ? <Spin size="small" /> : <ArrowRight className="size-4 text-muted-foreground" />}</div><h2 className="mt-5 text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p><p className="mt-4 text-xs text-muted-foreground">{count}</p></>;
    const className = "rounded-xl border border-border bg-card/50 p-5 text-left transition hover:border-primary/40 hover:bg-card disabled:cursor-wait disabled:opacity-60";
    if (onClick) return <button type="button" className={className} disabled={loading} onClick={onClick}>{content}</button>;
    return <Link href={href || "#"} className={className}>{content}</Link>;
}

export function LocalStudioEpisodesPage({ projectAssetId }: { projectAssetId: string }) {
    const { assets, loading, loadError } = useLocalAssets();
    const { message } = App.useApp();
    const [newTitle, setNewTitle] = useState("");
    const [saving, setSaving] = useState(false);
    const [editingEpisodeId, setEditingEpisodeId] = useState<string | null>(null);
    const project = assets.find((asset) => asset.id === projectAssetId && getLocalStudioRecord(asset)?.recordType === "project");
    const episodes = useMemo(() => assets.filter((asset) => { const item = getLocalStudioRecord(asset); return item?.recordType === "episode" && item.projectAssetId === projectAssetId; }).sort((left, right) => episodeOrder(left) - episodeOrder(right)), [assets, projectAssetId]);
    const beatCounts = useMemo(() => Object.fromEntries(episodes.map((episode) => [episode.id, listCurrentLocalStudioBeats(assets, episode.id).length])), [assets, episodes]);
    const episodeStats = useMemo(() => Object.fromEntries(episodes.map((episode) => [episode.id, summarizeLocalStudioEpisode(assets, episode.id)])), [assets, episodes]);
    const createEpisode = async (event: FormEvent) => {
        event.preventDefault();
        if (!newTitle.trim()) return;
        setSaving(true);
        try {
            const episode = await localStudioRepository.createEpisode({ projectAssetId, title: newTitle.trim(), order: episodes.length + 1 });
            setNewTitle("");
            message.success("分集已保存");
            window.location.assign(localStudioRoutes.script(projectAssetId, episode.id));
        } catch (cause) { message.error(cause instanceof Error ? cause.message : "创建分集失败"); }
        finally { setSaving(false); }
    };
    const updateEpisode = async (episodeAssetId: string, title: string, synopsis: string) => {
        setSaving(true);
        try {
            await localStudioRepository.updateEpisode({ projectAssetId, episodeAssetId, title, synopsis });
            setEditingEpisodeId(null);
            message.success("分集已保存");
        } catch (cause) { message.error(cause instanceof Error ? cause.message : "保存分集失败"); }
        finally { setSaving(false); }
    };
    const moveEpisode = async (episodeAssetId: string, direction: -1 | 1) => {
        const currentIndex = episodes.findIndex((episode) => episode.id === episodeAssetId);
        const targetIndex = currentIndex + direction;
        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= episodes.length) return;
        const orderedIds = episodes.map((episode) => episode.id);
        [orderedIds[currentIndex], orderedIds[targetIndex]] = [orderedIds[targetIndex], orderedIds[currentIndex]];
        setSaving(true);
        try {
            await localStudioRepository.reorderEpisodes(projectAssetId, orderedIds);
            message.success("分集顺序已保存");
        } catch (cause) { message.error(cause instanceof Error ? cause.message : "调整分集顺序失败"); }
        finally { setSaving(false); }
    };
    if (loading) return <main className="grid h-full place-items-center"><Spin /></main>;
    if (loadError || !project) return <main className="p-8"><p role="alert" className="text-destructive">{loadError || "找不到此本地项目"}</p><Link href={localStudioRoutes.projects}>返回项目列表</Link></main>;
    return <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground"><StudioHeader title={`${project.title} · 虾镜`} projectId={project.id} description="按分集推进剧本、镜头与成片准备。" /><section className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 md:px-8"><form onSubmit={createEpisode} className="mb-5 flex flex-wrap gap-2 rounded-xl border border-border bg-card/50 p-4"><Input aria-label="新分集标题" placeholder={`第 ${episodes.length + 1} 集标题`} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} className="min-w-56 flex-1" /><Button htmlType="submit" type="primary" icon={<Plus className="size-4" />} loading={saving}>新建分集</Button></form>{loadError ? <p role="alert" className="text-destructive">{loadError}</p> : null}{episodes.length ? <LocalStudioEpisodeList episodes={episodes} beatCounts={beatCounts} episodeStats={episodeStats} editingEpisodeId={editingEpisodeId} saving={saving} onEdit={setEditingEpisodeId} onCancelEdit={() => setEditingEpisodeId(null)} onSave={(episodeAssetId, title, synopsis) => void updateEpisode(episodeAssetId, title, synopsis)} onMove={(episodeAssetId, direction) => void moveEpisode(episodeAssetId, direction)} /> : <Empty description="还没有分集" className="py-16"><p className="text-sm text-muted-foreground">回到虾料生成结构，或在上方新建一集。</p><Link href={localStudioRoutes.ingestProject(project.id)}><Button>返回虾料</Button></Link></Empty>}</section></main>;
}

export function LocalStudioScriptPage({ projectAssetId, episodeAssetId }: { projectAssetId: string; episodeAssetId: string }) {
    const { assets, loading, loadError } = useLocalAssets();
    const { message } = App.useApp();
    const project = assets.find((asset) => asset.id === projectAssetId);
    const projectRecord = project ? getLocalStudioRecord(project) : null;
    const episode = assets.find((asset) => asset.id === episodeAssetId && getLocalStudioRecord(asset)?.recordType === "episode");
    const episodeRecord = episode ? getLocalStudioRecord(episode) : null;
    const script = episodeRecord?.recordType === "episode" && episodeRecord.scriptAssetId ? assets.find((asset) => asset.id === episodeRecord.scriptAssetId) : undefined;
    const [content, setContent] = useState("");
    const [saving, setSaving] = useState(false);
    const [targetLines, setTargetLines] = useState(20);
    const [minCharsPerLine, setMinCharsPerLine] = useState(15);
    const [maxCharsPerLine, setMaxCharsPerLine] = useState(30);
    const [error, setError] = useState("");
    const scriptFileInput = useRef<HTMLInputElement>(null);
    const originalText = localStudioRepository.getSourceText(projectAssetId) || "";
    const projectAssets = listXiaTangProjectAssets(assets, projectAssetId);
    const identities = projectAssets.filter((asset) => getXiaTangRecord(asset)?.recordType === "identity");
    const scenes = projectAssets.filter((asset) => getXiaTangRecord(asset)?.domain === "scene" && ["entity", "variant"].includes(getXiaTangRecord(asset)?.recordType || ""));
    const props = projectAssets.filter((asset) => getXiaTangRecord(asset)?.domain === "prop" && getXiaTangRecord(asset)?.recordType === "entity");
    const episodeBeats = listCurrentLocalStudioBeats(assets, episodeAssetId).filter((asset) => { const record = getLocalStudioRecord(asset); return record?.recordType === "beat" && record.projectAssetId === projectAssetId; });
    useEffect(() => { setContent(script?.kind === "text" ? script.data.content : ""); }, [script?.id, script?.updatedAt]);
    if (loading) return <main className="grid h-full place-items-center"><Spin /></main>;
    if (loadError || !episode || episodeRecord?.recordType !== "episode" || episodeRecord.projectAssetId !== projectAssetId) return <main className="p-8"><p role="alert" className="text-destructive">{loadError || "找不到此分集或分集不属于当前项目"}</p><Link href={localStudioRoutes.episodes(projectAssetId)}>返回分集</Link></main>;
    const copyAgentTask = async (mode: "script" | "line-by-line") => {
        setError("");
        try {
            const prompt = buildLocalStudioScriptPrompt({
                projectType: projectRecord?.recordType === "project" ? projectRecord.projectType : "drama",
                episodeOrder: episodeRecord.order,
                episodeTitle: episodeRecord.title,
                synopsis: episodeRecord.synopsis,
                sourceText: originalText,
                mode,
                targetLines,
                minCharsPerLine,
                maxCharsPerLine,
            });
            if (!navigator.clipboard?.writeText) throw new Error("浏览器未开放剪贴板；请复制原文、梗概和创作要求后交给 Codex/Agent");
            await navigator.clipboard.writeText(prompt);
            message.success("创作任务已复制；请交给 Codex/Agent 执行，再导入产物审核");
        } catch (cause) { setError(cause instanceof Error ? cause.message : "复制 Agent 创作任务失败"); }
    };
    const importAgentScript = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const imported = await file.text();
            if (!imported.trim()) throw new Error("剧本文件内容为空");
            setContent(imported);
            setError("");
            message.success(`已载入 Agent 产物：${file.name}。检查后点击“保存剧本”写入本地素材。`);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "读取 Agent 剧本失败"); }
        event.target.value = "";
    };
    const save = async () => {
        setSaving(true); setError("");
        try { await localStudioRepository.saveScript({ projectAssetId, episodeAssetId, content }); message.success("剧本已保存到本地素材库"); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "剧本保存失败"); }
        finally { setSaving(false); }
    };
    const narrated = projectRecord?.recordType === "project" && projectRecord.projectType === "narrated";
    const beatReferenceGroups = (beat: Asset) => {
        const record = getLocalStudioRecord(beat);
        const references = record?.recordType === "beat" ? record.referencedAssetIds.flatMap((id) => {
            const asset = assets.find((candidate) => candidate.id === id);
            const xiaTang = asset ? getXiaTangRecord(asset) : null;
            return asset && xiaTang ? [{ asset, xiaTang }] : [];
        }) : [];
        return {
            characters: references.filter(({ xiaTang }) => xiaTang.domain === "character" && xiaTang.recordType === "entity").map(({ asset }) => asset.title),
            identities: references.filter(({ xiaTang }) => xiaTang.recordType === "identity").map(({ asset }) => asset.title),
            scenes: references.filter(({ xiaTang }) => xiaTang.domain === "scene").map(({ asset }) => asset.title),
            props: references.filter(({ xiaTang }) => xiaTang.domain === "prop").map(({ asset }) => asset.title),
        };
    };
    return <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground"><StudioHeader title={`第 ${episodeRecord.order} 集 · ${episodeRecord.title} · 脚本`} projectId={projectAssetId} description="Agent/Codex 负责创作；本页提供上下文、产物审核和本地保存，不调用模型。" /><section className="mx-auto w-full max-w-[1600px] flex-1 px-5 py-5 md:px-8"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><nav aria-label="虾镜工作阶段" className="flex gap-2"><Link href={localStudioRoutes.episodes(projectAssetId)}><Button icon={<ArrowLeft className="size-4" />}>分集</Button></Link><Button type="primary">脚本</Button><Link href={localStudioRoutes.beats(projectAssetId, episodeAssetId)}><Button>镜头</Button></Link><Link href={localStudioRoutes.compose(projectAssetId, episodeAssetId)}><Button>合成</Button></Link></nav><div className="flex flex-wrap gap-2"><Button icon={<Sparkles className="size-4" />} onClick={() => void copyAgentTask("script")}>{content.trim() ? "复制 Agent 改写任务" : narrated ? "复制 Agent 口播任务" : "复制 Agent 剧本任务"}</Button>{narrated ? <Button onClick={() => void copyAgentTask("line-by-line")}>复制逐行任务</Button> : null}<input ref={scriptFileInput} type="file" className="hidden" accept=".txt,.md,.markdown,.fountain,text/plain" onChange={(event) => void importAgentScript(event)} /><Button onClick={() => scriptFileInput.current?.click()}>导入 Agent 剧本</Button><Button type="primary" loading={saving} disabled={!content.trim()} onClick={() => void save()}>保存剧本</Button></div></div>{error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}<div className="mb-4 grid gap-3 lg:grid-cols-3"><aside className="rounded-xl border border-border bg-card/40 p-4"><h2 className="font-semibold">本集原文与梗概</h2><p className="mt-1 text-xs text-muted-foreground">原始项目文稿保存在本地；下方显示本集导入文本。</p><pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap text-sm leading-6">{textAssetContent(episode) || episodeRecord.synopsis || "本集原文暂缺"}</pre><div className="mt-3 border-t border-border/60 pt-3"><h3 className="text-sm font-medium">虾塘资产规划</h3><div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{identities.length} 个身份</span><span>{scenes.length} 个场景/变体</span><span>{props.length} 个道具</span><Link className="text-primary underline" href={localStudioRoutes.characters(projectAssetId)}>管理虾塘资产</Link></div></div></aside><div className="rounded-xl border border-border bg-card/40 p-4"><label className="grid gap-2 text-sm font-medium">分集剧本<Input.TextArea aria-label="分集剧本" value={content} onChange={(event) => setContent(event.target.value)} className="min-h-[50vh] font-mono" placeholder="粘贴或导入 Codex/Agent 的剧本产物，检查后保存……" /></label></div><aside className="rounded-xl border border-border bg-card/40 p-4"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Beat 预览</h2><Link href={localStudioRoutes.beats(projectAssetId, episodeAssetId)}><Button size="small">编辑镜头</Button></Link></div><div className="mt-3 max-h-[60vh] space-y-3 overflow-auto">{episodeBeats.length ? episodeBeats.map((beat) => { const record = getLocalStudioRecord(beat); const groups = beatReferenceGroups(beat); return <article key={beat.id} className="rounded-lg border border-border/70 p-3"><strong className="text-sm">Beat {record?.recordType === "beat" ? record.order : "—"} · {beat.title}</strong><p className="mt-2 whitespace-pre-wrap text-sm">{textAssetContent(beat) || "画面描述待补充"}</p><dl className="mt-3 grid gap-1 text-xs"><div><dt className="inline text-muted-foreground">台词/解说词：</dt><dd className="inline">{record?.recordType === "beat" && typeof record.dialogueText === "string" ? record.dialogueText : "待拆分"}</dd></div><div><dt className="inline text-muted-foreground">说话人：</dt><dd className="inline">{groups.characters.join("、") || "未关联角色"}</dd></div><div><dt className="inline text-muted-foreground">身份：</dt><dd className="inline">{groups.identities.join("、") || "未关联身份"}</dd></div><div><dt className="inline text-muted-foreground">场景：</dt><dd className="inline">{groups.scenes.join("、") || "未关联场景"}</dd></div><div><dt className="inline text-muted-foreground">道具：</dt><dd className="inline">{groups.props.join("、") || "未关联道具"}</dd></div></dl></article>; }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="保存脚本并创建 Beat 后在此预览" />}</div></aside></div>{narrated ? <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card/40 p-4 sm:grid-cols-3"><label className="grid gap-1 text-sm">目标行数<Input type="number" min={1} max={200} value={targetLines} onChange={(event) => setTargetLines(Math.max(1, Number(event.target.value) || 1))} /></label><label className="grid gap-1 text-sm">每行最少字数<Input type="number" min={1} max={300} value={minCharsPerLine} onChange={(event) => setMinCharsPerLine(Math.max(1, Number(event.target.value) || 1))} /></label><label className="grid gap-1 text-sm">每行最多字数<Input type="number" min={1} max={300} value={maxCharsPerLine} onChange={(event) => setMaxCharsPerLine(Math.max(minCharsPerLine, Number(event.target.value) || minCharsPerLine))} /></label></div> : null}</section></main>;
}

export function LocalStudioBeatsPage({ projectAssetId, episodeAssetId, activeStage = "text", selectedBeatAssetId }: { projectAssetId: string; episodeAssetId: string; activeStage?: "text" | "sketch" | "render" | "audio" | "video"; selectedBeatAssetId?: string }) {
    const { assets, loading, loadError } = useLocalAssets();
    const { message } = App.useApp();
    const [beatTitle, setBeatTitle] = useState("");
    const [content, setContent] = useState("");
    const [dialogueText, setDialogueText] = useState("");
    const [referencedAssetIds, setReferencedAssetIds] = useState<string[]>([]);
    const [editingBeatId, setEditingBeatId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const episode = assets.find((asset) => asset.id === episodeAssetId && getLocalStudioRecord(asset)?.recordType === "episode");
    const episodeRecord = episode ? getLocalStudioRecord(episode) : null;
    const beats = listCurrentLocalStudioBeats(assets, episodeAssetId).filter((asset) => { const record = getLocalStudioRecord(asset); return record?.recordType === "beat" && record.projectAssetId === projectAssetId; });
    const referenceAssets = listXiaTangProjectAssets(assets, projectAssetId).filter((asset) => {
        const record = getXiaTangRecord(asset);
        return record && record.domain !== "voice" && (record.recordType === "entity" || record.recordType === "identity" || record.recordType === "variant");
    });
    const selectedBeat = selectedBeatAssetId ? beats.find((beat) => beat.id === selectedBeatAssetId) : undefined;
    const createBeat = async (event: FormEvent) => {
        event.preventDefault(); if (!content.trim() || !beatTitle.trim()) return;
        setSaving(true);
        try {
            if (editingBeatId) {
                await localStudioRepository.updateBeat({ projectAssetId, episodeAssetId, beatAssetId: editingBeatId, title: beatTitle, content: content.trim(), dialogueText: dialogueText.trim(), referencedAssetIds });
                message.success("镜头草稿已更新");
            } else {
                await localStudioRepository.createBeat({ projectAssetId, episodeAssetId, order: beats.length + 1, title: beatTitle.trim(), content: content.trim(), dialogueText: dialogueText.trim(), referencedAssetIds });
                message.success("镜头草稿已保存");
            }
            setEditingBeatId(null); setBeatTitle(""); setContent(""); setDialogueText(""); setReferencedAssetIds([]);
        }
        catch (cause) { message.error(cause instanceof Error ? cause.message : "保存镜头失败"); }
        finally { setSaving(false); }
    };
    if (loading) return <main className="grid h-full place-items-center"><Spin /></main>;
    if (loadError || episodeRecord?.recordType !== "episode" || episodeRecord.projectAssetId !== projectAssetId) return <main className="p-8"><p role="alert" className="text-destructive">{loadError || "找不到此分集或分集不属于当前项目"}</p></main>;
    const stageLinks = ["text", "sketch", "render", "audio", "video"] as const;
    return <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground"><StudioHeader title={`第 ${episodeRecord.order} 集 · ${episodeRecord.title} · 镜头`} projectId={projectAssetId} description="镜头草稿和角色/场景/道具引用保存在本地；图像、音频与视频生成进入虾画原生画布完成。" /><section className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 md:px-8"><div role="tablist" aria-label="镜头创作阶段" className="mb-5 flex flex-wrap gap-2">{stageLinks.map((stage) => <Link key={stage} role="tab" aria-selected={stage === activeStage} href={localStudioRoutes.beats(projectAssetId, episodeAssetId, stage)} className={`rounded-full border px-4 py-2 text-sm ${stage === activeStage ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent"}`}>{({ text: "剧本/镜头", sketch: "Beat 草图", render: "渲染图", audio: "音频", video: "视频" })[stage]}</Link>)}</div>{activeStage === "text" ? <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"><div className="space-y-3">{selectedBeatAssetId && !selectedBeat ? <p role="alert" className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive">链接的镜头不存在或不属于当前分集。</p> : null}{beats.length ? beats.map((beat) => { const record = getLocalStudioRecord(beat); const referencedTitles = record?.recordType === "beat" ? record.referencedAssetIds.map((id) => assets.find((asset) => asset.id === id)?.title).filter(Boolean) : []; return <article key={beat.id} id={`beat-${beat.id}`} className={`rounded-xl border p-4 ${beat.id === selectedBeatAssetId ? "border-primary bg-primary/5" : "border-border bg-card/50"}`}><div className="mb-2 flex items-center justify-between"><strong>镜头 {record?.recordType === "beat" ? record.order : ""} · {beat.title}</strong><Tag>本地草稿</Tag></div><p className="whitespace-pre-wrap text-sm">{textAssetContent(beat) || beat.title}</p>{record?.recordType === "beat" && record.dialogueText ? <p className="mt-2 text-sm"><span className="text-muted-foreground">台词/解说词：</span>{record.dialogueText}</p> : null}{referencedTitles.length ? <p className="mt-2 text-xs text-muted-foreground">关联资产：{referencedTitles.join("、")}</p> : null}<div className="mt-3 flex justify-end gap-2"><Button size="small" onClick={() => { setEditingBeatId(beat.id); setBeatTitle(beat.title); setContent(textAssetContent(beat)); setDialogueText(record?.recordType === "beat" ? record.dialogueText || "" : ""); setReferencedAssetIds(record?.recordType === "beat" ? record.referencedAssetIds : []); }}>编辑</Button><Link href={localStudioRoutes.compose(projectAssetId, episodeAssetId, beat.id)}><Button size="small">在合成页定位</Button></Link></div></article>; }) : <Empty description="尚无镜头草稿" />}</div><form onSubmit={createBeat} className="h-fit space-y-3 rounded-xl border border-border bg-card/50 p-4"><div><h2 className="font-semibold">{editingBeatId ? "编辑镜头草稿" : "新增镜头草稿"}</h2><p className="mt-1 text-xs text-muted-foreground">本地保存台词/解说词、画面描述和资产关联；生成媒体请使用虾画原生画布。</p></div><Input aria-label="镜头标题" value={beatTitle} onChange={(event) => setBeatTitle(event.target.value)} placeholder={`镜头 ${beats.length + 1}`} maxLength={160} /><Input.TextArea aria-label="台词或解说词" rows={3} value={dialogueText} onChange={(event) => setDialogueText(event.target.value)} placeholder="角色对白或旁白；可以留空" /><Input.TextArea aria-label="画面描述" rows={6} value={content} onChange={(event) => setContent(event.target.value)} placeholder="景别、动作、环境和画面要求" /><label className="block space-y-1.5 text-sm"><span>关联角色、身份、场景或道具</span><Select mode="multiple" className="w-full" aria-label="关联资产" value={referencedAssetIds} options={referenceAssets.map((asset) => ({ value: asset.id, label: asset.title }))} onChange={setReferencedAssetIds} placeholder="可多选本项目虾塘资产" /></label><div className="flex gap-2"><Button className="flex-1" htmlType="submit" type="primary" loading={saving} disabled={!beatTitle.trim() || !content.trim()}>{editingBeatId ? "保存镜头" : "保存镜头"}</Button>{editingBeatId ? <Button disabled={saving} onClick={() => { setEditingBeatId(null); setBeatTitle(""); setContent(""); setDialogueText(""); setReferencedAssetIds([]); }}>取消</Button> : null}</div></form></div> : <div className="rounded-xl border border-border bg-card/50 p-6"><h2 className="text-lg font-semibold">{({ sketch: "Beat 草图", render: "镜头渲染图", audio: "镜头音频", video: "镜头视频" })[activeStage]}</h2><p className="mt-2 max-w-2xl text-sm text-muted-foreground">当前 Infinite Canvas 已提供原生节点与已配置模型生成能力。镜头草稿保存在本地；用户可在虾画中选择素材并使用已有生成能力。</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{beats.map((beat) => <article key={beat.id} className="rounded-lg border border-border p-4"><strong>{beat.title}</strong><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{textAssetContent(beat)}</p></article>)}{!beats.length ? <Empty description="先创建镜头草稿" /> : null}</div></div>}<div className="mt-5 flex flex-wrap gap-2"><Link href={localStudioRoutes.script(projectAssetId, episodeAssetId)}><Button>返回剧本</Button></Link><Link href={localStudioRoutes.compose(projectAssetId, episodeAssetId)}><Button>进入合成</Button></Link></div></section></main>;
}

export function LocalStudioComposePage({ projectAssetId, episodeAssetId, focusBeatAssetId }: { projectAssetId: string; episodeAssetId: string; focusBeatAssetId?: string }) {
    const { assets, loading, loadError } = useLocalAssets();
    const episode = assets.find((asset) => asset.id === episodeAssetId && getLocalStudioRecord(asset)?.recordType === "episode");
    const episodeRecord = episode ? getLocalStudioRecord(episode) : null;
    const beats = listCurrentLocalStudioBeats(assets, episodeAssetId).filter((asset) => { const record = getLocalStudioRecord(asset); return record?.recordType === "beat" && record.projectAssetId === projectAssetId; });
    if (loading) return <main className="grid h-full place-items-center"><Spin /></main>;
    if (loadError || episodeRecord?.recordType !== "episode" || episodeRecord.projectAssetId !== projectAssetId) return <main className="p-8"><p role="alert" className="text-destructive">{loadError || "找不到此分集或分集不属于当前项目"}</p></main>;
    const focusBeat = beats.find((beat) => beat.id === focusBeatAssetId);
    return <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground"><StudioHeader title={`第 ${episodeRecord.order} 集 · ${episodeRecord.title} · 成片合成`} projectId={projectAssetId} description="按镜头检查图像、视频与音频候选；使用 Infinite Canvas 原生画布继续生成。" /><section className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 md:px-8"><div className="rounded-xl border border-border bg-card/50 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">镜头序列</h2><p className="mt-1 text-sm text-muted-foreground">{beats.length} 个镜头 · 顺序按本地 Beat 编号</p></div></div>{focusBeatAssetId && !focusBeat ? <p role="alert" className="mt-4 text-sm text-destructive">定位的镜头不存在或不属于当前分集。</p> : null}{beats.length ? <ol className="mt-5 space-y-3">{beats.map((beat, index) => <li key={beat.id} className={`rounded-lg border p-4 ${beat.id === focusBeat?.id ? "border-primary bg-primary/5" : "border-border"}`}><div className="flex items-center justify-between gap-3"><strong>{index + 1}. {beat.title}</strong><Tag>镜头草稿</Tag></div><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{textAssetContent(beat)}</p><Link href={localStudioRoutes.beats(projectAssetId, episodeAssetId, "video")}><Button className="mt-3" size="small">查看视频阶段</Button></Link></li>)}</ol> : <Empty className="py-12" description="还没有镜头，先创建剧本与 Beat 草稿。"><Link href={localStudioRoutes.beats(projectAssetId, episodeAssetId)}><Button>返回镜头工作台</Button></Link></Empty>}</div><div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"><h3 className="font-medium">本地能力状态</h3><p className="mt-1 text-sm text-muted-foreground">Infinite Canvas 提供单镜头图像/视频生成与文件保存；当前工作区没有来源 DramaClaw 的多镜头合成、配音混音或字幕渲染服务。此页不会创建虚假任务，成片合成按钮保持不可用。</p><Button className="mt-3" disabled title="Infinite Canvas 当前没有本地多镜头合成服务">合成并导出成片（暂不可用）</Button></div></section></main>;
}

export function LocalStudioIngestProjectPage({ projectAssetId }: { projectAssetId: string }) {
    const { assets, loading, loadError } = useLocalAssets();
    const project = assets.find((asset) => asset.id === projectAssetId && getLocalStudioRecord(asset)?.recordType === "project");
    const source = localStudioRepository.getSourceText(projectAssetId);
    const episodes = assets.filter((asset) => { const record = getLocalStudioRecord(asset); return record?.recordType === "episode" && record.projectAssetId === projectAssetId; });
    if (loading) return <main className="grid h-full place-items-center"><Spin /></main>;
    if (loadError || !project) return <main className="p-8"><p role="alert" className="text-destructive">{loadError || "找不到此本地项目"}</p></main>;
    return <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground"><StudioHeader title={`${project.title} · 原稿与结构`} projectId={project.id} /><section className="mx-auto w-full max-w-5xl flex-1 space-y-5 px-5 py-6 md:px-8"><div className="rounded-xl border border-border bg-card/50 p-5"><h2 className="font-semibold">原始小说/剧本</h2><pre className="mt-4 max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm leading-7">{source || "原稿素材缺失"}</pre></div><div className="rounded-xl border border-border bg-card/50 p-5"><h2 className="font-semibold">分集结构 · {episodes.length} 集</h2><ol className="mt-3 space-y-2">{episodes.map((episode) => { const record = getLocalStudioRecord(episode); return <li key={episode.id} className="rounded-md border border-border p-3">第 {record?.recordType === "episode" ? record.order : "—"} 集 · {record?.recordType === "episode" ? record.title : episode.title}<p className="mt-1 text-sm text-muted-foreground">{record?.recordType === "episode" ? record.synopsis : ""}</p></li>; })}</ol></div><Link href={localStudioRoutes.episodes(project.id)}><Button type="primary">继续虾镜创作</Button></Link></section></main>;
}
