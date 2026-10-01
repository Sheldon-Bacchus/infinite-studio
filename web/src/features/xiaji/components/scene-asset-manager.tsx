"use client";

import { Button, Form, Input, Modal } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createDramaAssetDomainItem, deleteDramaAssetDomainItem, updateDramaAssetDomainItem } from "@/services/api/drama-import";
import {
    deleteDramaSceneFile,
    fetchDramaSceneBuildTask,
    fetchDramaSceneTask,
    fetchDramaScenePlatePreview,
    fetchDramaScenes,
    startDramaSceneGeneration,
    startDramaSceneBuild,
    uploadDramaSceneFile,
    type DramaSceneAsset,
    type DramaSceneBuildTask,
    type DramaSceneFileKind,
    type DramaSceneGenerationOperation,
    type DramaScenePlatePreview,
    type DramaSceneTask,
} from "@/services/api/drama-scenes";

const sceneFields = [
    { key: "name", label: "名称" },
    { key: "aliases", label: "别名（逗号分隔）" },
    { key: "scene_type", label: "场景类型" },
    { key: "base_scene_id", label: "所属基础场景" },
    { key: "variant_id", label: "变体 ID" },
    { key: "time_of_day", label: "时间段" },
    { key: "environment_prompt", label: "环境提示词", multiline: true },
    { key: "variant_prompt", label: "变化提示词", multiline: true },
    { key: "description", label: "描述", multiline: true },
    { key: "spatial_layout_image", label: "空间布局图地址", multiline: true },
    { key: "notes", label: "备注", multiline: true },
] as const;

type SceneEditor = { mode: "create" | "edit"; item: DramaSceneAsset | null };
type SceneGenerationTaskKey = "master" | "reverse" | "pano-master" | "pano-text" | "3gs-single-face" | "3gs-pano";

const sceneGenerationTaskKeys: SceneGenerationTaskKey[] = ["master", "reverse", "pano-master", "pano-text", "3gs-single-face", "3gs-pano"];

const activeDramaTaskStatuses = new Set(["submitting", "queued", "pending", "starting", "running"]);

function sceneGenerationTaskRequest(key: SceneGenerationTaskKey): {
    operation: DramaSceneGenerationOperation;
    source?: "master" | "text";
} {
    if (key === "pano-master") return { operation: "pano", source: "master" };
    if (key === "pano-text") return { operation: "pano", source: "text" };
    if (key === "3gs-single-face") return { operation: "3gs-master" };
    if (key === "3gs-pano") return { operation: "3gs-pano" };
    return { operation: key };
}

function sourceField(item: DramaSceneAsset, key: string) {
    const value = item[key];
    if (Array.isArray(value)) return value.filter((part): part is string => typeof part === "string").join("、") || "未填写";
    if (typeof value === "string") return value.trim() || "未填写";
    return value == null ? "未填写" : String(value);
}

function displayProgress(progress: number) {
    const percent = progress >= 0 && progress <= 1 ? Math.round(progress * 100) : Math.round(progress);
    return `${percent}%`;
}

function DisabledSourceOperation({ label, reason }: { label: string; reason: string }) {
    return (
        <div className="min-w-0 rounded-md border border-border p-3">
            <Button autoInsertSpace={false} disabled title={reason}>
                {label}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">{reason}</p>
        </div>
    );
}

function SourceTaskStatus({ label, task, refreshing, message, onRefresh }: { label: string; task: DramaSceneTask | null | undefined; refreshing: boolean; message?: string; onRefresh: () => void }) {
    return (
        <div className="mt-3 rounded-md bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-sm font-medium">虾集任务状态</h5>
                <Button autoInsertSpace={false} size="small" aria-label={`刷新 ${label} 任务状态`} onClick={onRefresh} loading={refreshing}>
                    刷新 {label} 任务状态
                </Button>
            </div>
            {task === undefined ? (
                <p className="mt-2 text-xs text-muted-foreground">尚未从虾集读取该 task identity。</p>
            ) : task === null ? (
                <p className="mt-2 text-xs text-muted-foreground">虾集当前没有该 task identity 的记录。</p>
            ) : (
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    {typeof task.task_type === "string" ? (
                        <div>
                            <dt className="text-muted-foreground">task_type</dt>
                            <dd>{task.task_type}</dd>
                        </div>
                    ) : null}
                    {typeof task.task_id === "string" ? (
                        <div>
                            <dt className="text-muted-foreground">task_id</dt>
                            <dd className="break-all">{task.task_id}</dd>
                        </div>
                    ) : null}
                    {typeof task.scope === "string" ? (
                        <div>
                            <dt className="text-muted-foreground">scope</dt>
                            <dd className="break-all">{task.scope}</dd>
                        </div>
                    ) : null}
                    {typeof task.status === "string" ? (
                        <div>
                            <dt className="text-muted-foreground">status</dt>
                            <dd role="status">{task.status}</dd>
                        </div>
                    ) : null}
                    {typeof task.progress === "number" ? (
                        <div>
                            <dt className="text-muted-foreground">progress</dt>
                            <dd>{displayProgress(task.progress)}</dd>
                        </div>
                    ) : null}
                    {typeof task.current_task === "string" ? (
                        <div className="sm:col-span-2">
                            <dt className="text-muted-foreground">current_task</dt>
                            <dd>{task.current_task}</dd>
                        </div>
                    ) : null}
                    {typeof task.error === "string" ? (
                        <div className="sm:col-span-2 text-destructive">
                            <dt>error</dt>
                            <dd>{task.error}</dd>
                        </div>
                    ) : null}
                </dl>
            )}
            {message ? (
                <p role="alert" className="mt-2 text-xs text-destructive">
                    {message}
                </p>
            ) : null}
        </div>
    );
}

export type SceneAssetManagerViewProps = {
    scenes: DramaSceneAsset[];
    selectedName?: string;
    detail?: DramaSceneAsset | null;
    platePreview?: DramaScenePlatePreview | null;
    plateImageUrl?: string;
    loading: boolean;
    detailLoading: boolean;
    error: string;
    buildTask: DramaSceneBuildTask | null;
    buildTaskRefreshing: boolean;
    buildTaskMessage?: string;
    generationTasks: Partial<Record<SceneGenerationTaskKey, DramaSceneTask | null>>;
    generationTaskRefreshing: Partial<Record<SceneGenerationTaskKey, boolean>>;
    generationTaskMessages: Partial<Record<SceneGenerationTaskKey, string>>;
    busy: boolean;
    onRetry: () => void;
    onSelect: (name: string) => void;
    onBuild: () => void;
    onRefreshBuildTask: () => void;
    onGenerate: (operation: DramaSceneGenerationOperation, source?: "master" | "text") => void;
    onRefreshTask: (key: SceneGenerationTaskKey) => void;
    onUpload: (kind: DramaSceneFileKind, file: File) => void;
    onDeleteFile: (kind: DramaSceneFileKind) => void;
    onCreate: () => void;
    onEdit: (scene: DramaSceneAsset) => void;
    onDeleteScene: (scene: DramaSceneAsset) => void;
};

export function SceneAssetManagerView({
    scenes,
    selectedName,
    detail,
    platePreview,
    plateImageUrl,
    loading,
    detailLoading,
    error,
    buildTask,
    buildTaskRefreshing,
    buildTaskMessage,
    generationTasks,
    generationTaskRefreshing,
    generationTaskMessages,
    busy,
    onRetry,
    onSelect,
    onBuild,
    onRefreshBuildTask,
    onGenerate,
    onRefreshTask,
    onUpload,
    onDeleteFile,
    onCreate,
    onEdit,
    onDeleteScene,
}: SceneAssetManagerViewProps) {
    const masterURL = plateImageUrl || detail?.master_url || "";
    const hasMaster = Boolean(detail?.master_url || detail?.master_path);
    const hasReverseMaster = Boolean(detail?.reverse_master_url || detail?.reverse_master_path);
    const hasPano = Boolean(detail?.pano_url || detail?.pano_path);
    const hasCustom = Boolean(detail?.custom_scene_url || detail?.custom_scene_path);

    const filePicker = (kind: DramaSceneFileKind, label: string, accept: string) => (
        <label className="inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
            {label}
            <input
                aria-label={label}
                className="sr-only"
                type="file"
                accept={accept}
                disabled={busy || !detail}
                onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) onUpload(kind, file);
                    event.currentTarget.value = "";
                }}
            />
        </label>
    );

    const generationButton = (label: string, key: SceneGenerationTaskKey, operation: DramaSceneGenerationOperation, source?: "master" | "text", disabledReason?: string) => {
        const taskStatus = generationTasks[key]?.status;
        const taskActive = typeof taskStatus === "string" && activeDramaTaskStatuses.has(taskStatus);
        return (
            <div className="space-y-1">
                <Button autoInsertSpace={false} onClick={() => onGenerate(operation, source)} disabled={busy || !detail || taskActive || Boolean(disabledReason)}>
                    {label}
                </Button>
                {disabledReason ? <p className="max-w-xs text-xs text-muted-foreground">{disabledReason}</p> : null}
                {taskActive ? <p className="max-w-xs text-xs text-muted-foreground">虾集当前 status：{taskStatus}</p> : null}
            </div>
        );
    };

    return (
        <section aria-label="DramaClaw 场景资产管理" className="space-y-5">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold">场景</h2>
                    <p className="mt-1 text-sm text-muted-foreground">场景、变体、母版图、全景图和自定义 3D 文件来自 DramaClaw。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button autoInsertSpace={false} onClick={onCreate} disabled={busy}>
                        新增场景
                    </Button>
                    <Button autoInsertSpace={false} type="primary" onClick={onBuild} loading={busy}>
                        根据剧本补全场景
                    </Button>
                </div>
            </header>

            {error ? (
                <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    <span>{error}</span>
                    <Button autoInsertSpace={false} onClick={onRetry}>
                        重试
                    </Button>
                </div>
            ) : null}

            <section aria-label="场景列表" className="space-y-3">
                <h3 className="text-base font-semibold">场景与变体</h3>
                {loading ? (
                    <p role="status" className="py-5 text-center text-sm text-muted-foreground">
                        正在读取 DramaClaw 场景…
                    </p>
                ) : scenes.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">暂无场景</p>
                ) : (
                    <ul className="grid gap-2">
                        {scenes.map((scene, index) => {
                            const selected = scene.name === selectedName;
                            return (
                                <li key={`${scene.name}-${index}`}>
                                    <button type="button" aria-pressed={selected} onClick={() => onSelect(scene.name)} className={`w-full rounded-md border p-3 text-left ${selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
                                        <span className="block font-medium">{scene.name}</span>
                                        <span className="mt-1 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                                            <span>类型：{sourceField(scene, "scene_type")}</span>
                                            <span>所属基础场景：{sourceField(scene, "base_scene_id")}</span>
                                            <span>变体 ID：{sourceField(scene, "variant_id")}</span>
                                            <span>时间段：{sourceField(scene, "time_of_day")}</span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            {detail ? (
                <section aria-label={`场景详情：${detail.name}`} className="space-y-4 rounded-xl border border-border bg-card p-4">
                    <header className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h3 className="text-lg font-semibold">{detail.name}</h3>
                            <p className="text-sm text-muted-foreground">
                                {detail.scene_type || "未分类"} · {detail.base_scene_id || "基础场景"} · {detail.variant_id || "默认变体"} · {detail.time_of_day || "未设定时间"}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <Button autoInsertSpace={false} onClick={() => onEdit(detail)} disabled={busy}>
                                编辑
                            </Button>
                            <Button autoInsertSpace={false} danger onClick={() => onDeleteScene(detail)} disabled={busy}>
                                删除场景
                            </Button>
                        </div>
                    </header>

                    {detailLoading ? (
                        <p role="status" className="text-sm text-muted-foreground">
                            正在读取场景详情…
                        </p>
                    ) : null}
                    <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                        {sceneFields
                            .filter(({ key }) => key !== "name" && key !== "aliases")
                            .map(({ key, label }) => (
                                <div key={key} className="min-w-0">
                                    <dt className="text-xs text-muted-foreground">{label}</dt>
                                    <dd className="whitespace-pre-wrap break-words text-sm">{sourceField(detail, key)}</dd>
                                </div>
                            ))}
                        <div>
                            <dt className="text-xs text-muted-foreground">别名</dt>
                            <dd className="text-sm">{sourceField(detail, "aliases")}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">有效环境提示词</dt>
                            <dd className="whitespace-pre-wrap text-sm">{sourceField(detail, "effective_environment_prompt")}</dd>
                        </div>
                    </dl>

                    <section aria-label="场景文件" className="space-y-3 border-t border-border pt-4">
                        <h4 className="font-semibold">场景文件</h4>
                        <div className="flex flex-wrap gap-2">
                            {filePicker("master", "上传 master", "image/*")}
                            {filePicker("pano", "上传 pano", "image/*")}
                            {filePicker("custom", "上传 custom 3D 文件", ".ply,.sog,.splat,.ksplat")}
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2 rounded-lg border border-border p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <h5 className="font-medium">master 母版</h5>
                                    {hasMaster ? (
                                        <Button autoInsertSpace={false} danger size="small" onClick={() => onDeleteFile("master")} disabled={busy}>
                                            删除 master
                                        </Button>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">暂无文件</span>
                                    )}
                                </div>
                                {masterURL ? <img src={masterURL} alt={`${detail.name} master 预览`} className="max-h-80 w-full rounded-md object-contain" /> : null}
                                {platePreview ? (
                                    <div className="text-xs text-muted-foreground">
                                        <p>解析场景：{platePreview.resolved_scene_name}</p>
                                        <p>
                                            {platePreview.render.status} · {platePreview.render.label}
                                        </p>
                                        <p>{platePreview.seedance2.label}</p>
                                    </div>
                                ) : null}
                            </div>
                            <div className="space-y-2 rounded-lg border border-border p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <h5 className="font-medium">pano 全景</h5>
                                    {hasPano ? (
                                        <Button autoInsertSpace={false} danger size="small" onClick={() => onDeleteFile("pano")} disabled={busy}>
                                            删除 pano
                                        </Button>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">暂无文件</span>
                                    )}
                                </div>
                                {detail.pano_url ? <img src={detail.pano_url} alt={`${detail.name} pano 预览`} className="max-h-80 w-full rounded-md object-contain" /> : null}
                                {detail.custom_scene_url ? (
                                    <p>
                                        <a className="text-sm text-primary underline" href={detail.custom_scene_url} target="_blank" rel="noreferrer">
                                            打开 custom 3D 文件
                                        </a>
                                    </p>
                                ) : null}
                                {hasCustom ? (
                                    <Button autoInsertSpace={false} danger size="small" onClick={() => onDeleteFile("custom")} disabled={busy}>
                                        删除 custom
                                    </Button>
                                ) : (
                                    <span className="text-xs text-muted-foreground">暂无 custom 文件</span>
                                )}
                            </div>
                        </div>
                    </section>
                </section>
            ) : !loading && scenes.length > 0 ? (
                <p className="py-4 text-sm text-muted-foreground">选择一个场景查看详情。</p>
            ) : null}

            <section aria-label="场景补全任务" className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="font-semibold">DramaClaw 场景补全任务</h3>
                        <p className="mt-1 text-sm text-muted-foreground">该操作直接调用源端 scenes/build；任务类型和 ID 由虾集返回。</p>
                    </div>
                    {buildTask?.task_id ? (
                        <Button autoInsertSpace={false} onClick={onRefreshBuildTask} loading={buildTaskRefreshing}>
                            刷新任务状态
                        </Button>
                    ) : null}
                </div>
                {buildTask ? (
                    <dl className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-3">
                        <div>
                            <dt className="text-xs text-muted-foreground">任务类型</dt>
                            <dd>{typeof buildTask.task_type === "string" ? buildTask.task_type : "源端未返回"}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">任务 ID</dt>
                            <dd className="break-all">{typeof buildTask.task_id === "string" ? buildTask.task_id : "源端未返回"}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">虾集状态</dt>
                            <dd>{typeof buildTask.status === "string" ? buildTask.status : "等待从虾集读取任务状态"}</dd>
                        </div>
                        {typeof buildTask.progress === "number" ? (
                            <div>
                                <dt className="text-xs text-muted-foreground">源端进度</dt>
                                <dd>{displayProgress(buildTask.progress)}</dd>
                            </div>
                        ) : null}
                        {buildTaskMessage ? (
                            <div className="sm:col-span-3" role="status">
                                {buildTaskMessage}
                            </div>
                        ) : null}
                    </dl>
                ) : (
                    <p className="text-sm text-muted-foreground">尚未启动场景补全任务。</p>
                )}
            </section>

            <section aria-label="场景生成操作" className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div>
                    <h3 className="font-semibold">DramaClaw 场景生成</h3>
                    <p className="mt-1 text-sm text-muted-foreground">生成由虾集执行；task type、ID、scope、状态和进度均读取源端记录。</p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                    <section className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="font-medium">master 母版</h4>
                            {generationButton("生成 master 母版", "master", "master")}
                        </div>
                        <SourceTaskStatus label="master" task={generationTasks.master} refreshing={Boolean(generationTaskRefreshing.master)} message={generationTaskMessages.master} onRefresh={() => onRefreshTask("master")} />
                    </section>
                    <section className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="font-medium">reverse 母版</h4>
                            {generationButton("生成 reverse 母版", "reverse", "reverse")}
                        </div>
                        <SourceTaskStatus label="reverse" task={generationTasks.reverse} refreshing={Boolean(generationTaskRefreshing.reverse)} message={generationTaskMessages.reverse} onRefresh={() => onRefreshTask("reverse")} />
                    </section>
                    <section className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="font-medium">pano 全景</h4>
                            <div className="flex flex-wrap gap-2">
                                {generationButton("从 master 生成 pano", "pano-master", "pano", "master", hasMaster ? undefined : "缺少 master 母版；可从场景文本生成 pano。")}
                                {generationButton("从文本生成 pano", "pano-text", "pano", "text")}
                            </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                            <SourceTaskStatus
                                label="pano（master）"
                                task={generationTasks["pano-master"]}
                                refreshing={Boolean(generationTaskRefreshing["pano-master"])}
                                message={generationTaskMessages["pano-master"]}
                                onRefresh={() => onRefreshTask("pano-master")}
                            />
                            <SourceTaskStatus
                                label="pano（文本）"
                                task={generationTasks["pano-text"]}
                                refreshing={Boolean(generationTaskRefreshing["pano-text"])}
                                message={generationTaskMessages["pano-text"]}
                                onRefresh={() => onRefreshTask("pano-text")}
                            />
                        </div>
                    </section>
                    <section className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="font-medium">3GS 单面</h4>
                            <div className="flex flex-wrap gap-2">
                                {generationButton("生成 3GS（master）", "3gs-single-face", "3gs-master", undefined, hasMaster ? undefined : "缺少 master.png；请先上传或生成 master。")}
                                {generationButton("生成 3GS（reverse）", "3gs-single-face", "3gs-reverse", undefined, hasReverseMaster ? undefined : "缺少 reverse_master.png；请先生成 reverse 母版。")}
                            </div>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">master 与 reverse 在 DramaClaw 共用 stage_asset / single_face_sharp task identity。</p>
                        <SourceTaskStatus
                            label="3GS 单面"
                            task={generationTasks["3gs-single-face"]}
                            refreshing={Boolean(generationTaskRefreshing["3gs-single-face"])}
                            message={generationTaskMessages["3gs-single-face"]}
                            onRefresh={() => onRefreshTask("3gs-single-face")}
                        />
                    </section>
                    <section className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="font-medium">3GS 全景</h4>
                            {generationButton("生成 3GS（pano）", "3gs-pano", "3gs-pano", undefined, hasPano ? undefined : "缺少 pano_360.png；请先上传或生成 pano。")}
                        </div>
                        <SourceTaskStatus label="3GS（pano）" task={generationTasks["3gs-pano"]} refreshing={Boolean(generationTaskRefreshing["3gs-pano"])} message={generationTaskMessages["3gs-pano"]} onRefresh={() => onRefreshTask("3gs-pano")} />
                    </section>
                </div>
                <DisabledSourceOperation
                    label="导演世界暂不可用"
                    reason="DramaClaw 的 director-stage/world 接受 snapshot 与 active_source_id；当前画布 Director 节点持久化的是导演台自己的 directorProject 对象，尚无经验证的字段映射。为避免把源端 ThreeDSceneSnapshot 写坏画布项目，暂不接通。"
                />
            </section>
        </section>
    );
}

export function SceneAssetManager({ projectId }: { projectId: string }) {
    const [scenes, setScenes] = useState<DramaSceneAsset[]>([]);
    const [selectedName, setSelectedName] = useState("");
    const [detail, setDetail] = useState<DramaSceneAsset | null>(null);
    const [platePreview, setPlatePreview] = useState<DramaScenePlatePreview | null>(null);
    const [plateImageUrl, setPlateImageUrl] = useState("");
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [buildTask, setBuildTask] = useState<DramaSceneBuildTask | null>(null);
    const [buildTaskRefreshing, setBuildTaskRefreshing] = useState(false);
    const [buildTaskMessage, setBuildTaskMessage] = useState("");
    const [generationTasks, setGenerationTasks] = useState<Partial<Record<SceneGenerationTaskKey, DramaSceneTask | null>>>({});
    const [generationTaskRefreshing, setGenerationTaskRefreshing] = useState<Partial<Record<SceneGenerationTaskKey, boolean>>>({});
    const [generationTaskMessages, setGenerationTaskMessages] = useState<Partial<Record<SceneGenerationTaskKey, string>>>({});
    const expectedTaskIdsRef = useRef<Record<string, string>>({});
    const refreshedTerminalTasksRef = useRef(new Set<string>());
    const [editor, setEditor] = useState<SceneEditor | null>(null);
    const [form] = Form.useForm<Record<string, unknown>>();

    const reloadScenes = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const result = await fetchDramaScenes(projectId, { summary: true });
            setScenes(result);
            setSelectedName((current) => (current && result.some((scene) => scene.name === current) ? current : result[0]?.name || ""));
            return result;
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "读取虾集场景失败");
            return [];
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    const reloadDetailAndPlate = useCallback(
        async (name: string, summaryRows = scenes) => {
            if (!name) {
                setDetail(null);
                setPlatePreview(null);
                setPlateImageUrl("");
                return;
            }
            setDetailLoading(true);
            setError("");
            try {
                const [detailRows, selectedSummary] = await Promise.all([fetchDramaScenes(projectId, { summary: false, names: [name] }), Promise.resolve(summaryRows.find((scene) => scene.name === name))]);
                const selectedDetail = detailRows.find((scene) => scene.name === name) || detailRows[0] || null;
                setDetail(selectedDetail);
                const preview = await fetchDramaScenePlatePreview(projectId, {
                    scene_id: selectedSummary?.base_scene_id || selectedSummary?.name || name,
                    variant_id: selectedSummary?.variant_id || "",
                    time_of_day: selectedSummary?.time_of_day || "",
                });
                setPlatePreview(preview);
                if (preview.resolved_scene_name === name) {
                    setPlateImageUrl(selectedDetail?.master_url || "");
                } else {
                    const plateDetails = await fetchDramaScenes(projectId, { summary: false, names: [preview.resolved_scene_name] });
                    setPlateImageUrl(plateDetails.find((scene) => scene.name === preview.resolved_scene_name)?.master_url || "");
                }
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : "读取场景详情或母版预览失败");
                setDetail(null);
                setPlatePreview(null);
                setPlateImageUrl("");
            } finally {
                setDetailLoading(false);
            }
        },
        [projectId, scenes],
    );

    const refreshGenerationTask = useCallback(
        async (sceneName: string, key: SceneGenerationTaskKey) => {
            if (!sceneName) return;
            setGenerationTaskRefreshing((current) => ({ ...current, [key]: true }));
            setGenerationTaskMessages((current) => ({ ...current, [key]: "" }));
            const { operation, source } = sceneGenerationTaskRequest(key);
            try {
                const task = await fetchDramaSceneTask(projectId, sceneName, operation, source);
                const identity = `${projectId}:${sceneName}:${key}`;
                const expectedTaskId = expectedTaskIdsRef.current[identity];
                setGenerationTasks((current) => ({
                    ...current,
                    [key]: task === null && expectedTaskId ? (current[key] ?? task) : task,
                }));
                if (expectedTaskId && task === null) {
                    setGenerationTaskMessages((current) => ({
                        ...current,
                        [key]: `虾集启动响应返回 task_id=${expectedTaskId}，但当前 task scope 查询返回 null；任务状态尚未确认。`,
                    }));
                } else if (expectedTaskId && task?.task_id && task.task_id !== expectedTaskId) {
                    setGenerationTaskMessages((current) => ({
                        ...current,
                        [key]: `启动响应 task_id=${expectedTaskId}；当前源端 task scope 返回 task_id=${task.task_id}，页面显示的是该 scope 当前记录。`,
                    }));
                }
                if (task?.status === "completed" && typeof task.task_id === "string") {
                    const completedIdentity = `${identity}:${task.task_id}`;
                    if (!refreshedTerminalTasksRef.current.has(completedIdentity)) {
                        refreshedTerminalTasksRef.current.add(completedIdentity);
                        const rows = await reloadScenes();
                        await reloadDetailAndPlate(sceneName, rows);
                    }
                }
            } catch (cause) {
                setGenerationTaskMessages((current) => ({
                    ...current,
                    [key]: cause instanceof Error ? cause.message : "读取虾集场景任务状态失败",
                }));
            } finally {
                setGenerationTaskRefreshing((current) => ({ ...current, [key]: false }));
            }
        },
        [projectId, reloadScenes, reloadDetailAndPlate],
    );

    const refreshGenerationTaskRef = useRef(refreshGenerationTask);
    useEffect(() => {
        refreshGenerationTaskRef.current = refreshGenerationTask;
    }, [refreshGenerationTask]);

    useEffect(() => {
        void reloadScenes();
    }, [reloadScenes]);
    useEffect(() => {
        void reloadDetailAndPlate(selectedName);
    }, [reloadDetailAndPlate, selectedName]);
    useEffect(() => {
        setGenerationTasks({});
        setGenerationTaskMessages({});
        if (!selectedName) return;
        for (const key of sceneGenerationTaskKeys) void refreshGenerationTaskRef.current(selectedName, key);
    }, [projectId, selectedName]);

    const activeGenerationKeys = sceneGenerationTaskKeys.filter((key) => {
        const status = generationTasks[key]?.status;
        return typeof status === "string" && activeDramaTaskStatuses.has(status);
    });
    const activeGenerationSignature = activeGenerationKeys.join("|");
    useEffect(() => {
        if (!selectedName || !activeGenerationSignature) return;
        const timer = window.setInterval(() => {
            for (const key of activeGenerationKeys) void refreshGenerationTaskRef.current(selectedName, key);
        }, 3000);
        return () => window.clearInterval(timer);
    }, [activeGenerationSignature, selectedName]);

    const refreshBuildTask = async (expectedTask: DramaSceneBuildTask | null = buildTask) => {
        setBuildTaskRefreshing(true);
        setBuildTaskMessage("");
        try {
            const state = await fetchDramaSceneBuildTask(projectId);
            if (!state) {
                if (expectedTask?.task_id) setBuildTask(expectedTask);
                setBuildTaskMessage(expectedTask?.task_id ? `虾集启动响应返回 task_id=${expectedTask.task_id}，但 build_scenes/0 查询当前返回 null；任务状态尚未确认。` : "虾集当前未返回 build_scenes/0 任务记录。");
            } else {
                if (expectedTask?.task_id && state.task_id && state.task_id !== expectedTask.task_id) {
                    setBuildTaskMessage(`启动响应 task_id=${expectedTask.task_id}；当前源端 task key 返回 task_id=${state.task_id}，显示的是源端当前记录。`);
                }
                setBuildTask(state);
                if (state.status === "completed") {
                    const rows = await reloadScenes();
                    if (selectedName) await reloadDetailAndPlate(selectedName, rows);
                }
            }
        } catch (cause) {
            setBuildTaskMessage(cause instanceof Error ? cause.message : "读取虾集任务状态失败");
        } finally {
            setBuildTaskRefreshing(false);
        }
    };

    const refreshBuildTaskRef = useRef(refreshBuildTask);
    useEffect(() => {
        refreshBuildTaskRef.current = refreshBuildTask;
    }, [refreshBuildTask]);
    useEffect(() => {
        if (!buildTask?.status || !activeDramaTaskStatuses.has(buildTask.status)) return;
        const timer = window.setInterval(() => void refreshBuildTaskRef.current(buildTask), 3000);
        return () => window.clearInterval(timer);
    }, [buildTask?.task_id, buildTask?.status]);

    const refreshSceneStateAndTasks = async (sceneName: string) => {
        const rows = await reloadScenes();
        await reloadDetailAndPlate(sceneName, rows);
        await Promise.all(sceneGenerationTaskKeys.map((key) => refreshGenerationTask(sceneName, key)));
    };

    const retry = async () => {
        const result = await reloadScenes();
        const name = selectedName || result[0]?.name;
        if (name) {
            await reloadDetailAndPlate(name, result);
            await Promise.all(sceneGenerationTaskKeys.map((key) => refreshGenerationTask(name, key)));
        }
    };

    const generateSceneAsset = async (operation: DramaSceneGenerationOperation, source?: "master" | "text") => {
        if (!selectedName) return;
        const key: SceneGenerationTaskKey = operation === "pano" ? (source === "master" ? "pano-master" : "pano-text") : operation === "3gs-master" || operation === "3gs-reverse" ? "3gs-single-face" : operation === "3gs-pano" ? "3gs-pano" : operation;
        setBusy(true);
        setGenerationTaskMessages((current) => ({ ...current, [key]: "" }));
        try {
            const result = await startDramaSceneGeneration(projectId, selectedName, operation, {
                ...(source ? { source } : {}),
            });
            if (typeof result.task_id === "string" && result.task_id) {
                expectedTaskIdsRef.current[`${projectId}:${selectedName}:${key}`] = result.task_id;
            }
            setGenerationTasks((current) => ({ ...current, [key]: result }));
            const rows = await reloadScenes();
            await reloadDetailAndPlate(selectedName, rows);
            await refreshGenerationTask(selectedName, key);
        } catch (cause) {
            setGenerationTaskMessages((current) => ({
                ...current,
                [key]: cause instanceof Error ? cause.message : "启动虾集场景生成失败",
            }));
        } finally {
            setBusy(false);
        }
    };

    const build = async () => {
        setBusy(true);
        setError("");
        setBuildTaskMessage("");
        try {
            const result = await startDramaSceneBuild(projectId);
            setBuildTask(result);
            if (!result.task_id || !result.task_type) setBuildTaskMessage("虾集响应没有返回 task_id 或 task_type，无法跟踪这次任务。");
            else await refreshBuildTask(result);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "启动虾集场景补全失败");
        } finally {
            setBusy(false);
        }
    };

    const upload = async (kind: DramaSceneFileKind, file: File) => {
        if (!selectedName) return;
        setBusy(true);
        setError("");
        try {
            await uploadDramaSceneFile(projectId, selectedName, kind, file);
            await refreshSceneStateAndTasks(selectedName);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "上传场景文件失败");
        } finally {
            setBusy(false);
        }
    };

    const deleteFile = async (kind: DramaSceneFileKind) => {
        if (!selectedName || !window.confirm(`确认删除场景「${selectedName}」的 ${kind} 文件？`)) return;
        setBusy(true);
        setError("");
        try {
            await deleteDramaSceneFile(projectId, selectedName, kind);
            await refreshSceneStateAndTasks(selectedName);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "删除场景文件失败");
        } finally {
            setBusy(false);
        }
    };

    const openCreate = () => {
        form.resetFields();
        setEditor({ mode: "create", item: null });
    };

    const openEdit = (item: DramaSceneAsset) => {
        form.setFieldsValue({
            ...item,
            aliases: Array.isArray(item.aliases) ? item.aliases.join(", ") : "",
        });
        setEditor({ mode: "edit", item });
    };

    const submitScene = async (values: Record<string, unknown>) => {
        if (!editor) return;
        const payload = {
            ...values,
            name: String(values.name || "").trim(),
            aliases: String(values.aliases || "")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
        };
        setBusy(true);
        setError("");
        try {
            if (editor.mode === "edit" && editor.item) {
                await updateDramaAssetDomainItem(projectId, "scenes", editor.item.name, payload);
            } else {
                await createDramaAssetDomainItem(projectId, "scenes", payload);
            }
            setEditor(null);
            await reloadScenes();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "保存场景失败");
        } finally {
            setBusy(false);
        }
    };

    const deleteScene = async (scene: DramaSceneAsset) => {
        if (!window.confirm(`确认删除场景「${scene.name}」？DramaClaw 会检查派生场景限制。`)) return;
        setBusy(true);
        setError("");
        try {
            await deleteDramaAssetDomainItem(projectId, "scenes", scene.name);
            setDetail(null);
            await reloadScenes();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "删除场景失败");
        } finally {
            setBusy(false);
        }
    };

    const initialValues = useMemo(() => {
        const item = editor?.item;
        return Object.fromEntries(sceneFields.map(({ key }) => [key, key === "aliases" ? (Array.isArray(item?.aliases) ? item.aliases.join(", ") : "") : typeof item?.[key] === "string" ? item[key] : ""]));
    }, [editor]);

    return (
        <>
            <SceneAssetManagerView
                scenes={scenes}
                selectedName={selectedName}
                detail={detail}
                platePreview={platePreview}
                plateImageUrl={plateImageUrl}
                loading={loading}
                detailLoading={detailLoading}
                error={error}
                buildTask={buildTask}
                buildTaskRefreshing={buildTaskRefreshing}
                buildTaskMessage={buildTaskMessage}
                generationTasks={generationTasks}
                generationTaskRefreshing={generationTaskRefreshing}
                generationTaskMessages={generationTaskMessages}
                busy={busy}
                onRetry={() => void retry()}
                onSelect={setSelectedName}
                onBuild={() => void build()}
                onRefreshBuildTask={() => void refreshBuildTask()}
                onGenerate={(operation, source) => void generateSceneAsset(operation, source)}
                onRefreshTask={(key) => void refreshGenerationTask(selectedName, key)}
                onUpload={(kind, file) => void upload(kind, file)}
                onDeleteFile={(kind) => void deleteFile(kind)}
                onCreate={openCreate}
                onEdit={openEdit}
                onDeleteScene={(scene) => void deleteScene(scene)}
            />
            <Modal title={editor?.mode === "edit" ? `编辑场景：${editor.item?.name || ""}` : "新增场景"} open={editor !== null} onCancel={() => setEditor(null)} onOk={() => form.submit()} confirmLoading={busy} destroyOnHidden>
                <Form key={editor?.mode + (editor?.item?.name || "new")} form={form} layout="vertical" initialValues={initialValues} onFinish={(values) => void submitScene(values)}>
                    <div className="grid gap-x-4 sm:grid-cols-2">
                        {sceneFields.map((field) => (
                            <Form.Item key={field.key} name={field.key} label={field.label} rules={field.key === "name" ? [{ required: true, whitespace: true, message: "请输入场景名称" }] : undefined}>
                                {"multiline" in field && field.multiline ? <Input.TextArea rows={3} /> : <Input />}
                            </Form.Item>
                        ))}
                    </div>
                </Form>
            </Modal>
        </>
    );
}
