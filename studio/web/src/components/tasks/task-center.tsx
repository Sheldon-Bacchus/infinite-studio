import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Descriptions, Drawer, Empty, List, Segmented, Select, Space, Tag, Tabs, Typography, theme } from "antd";
import { ChevronRight, CircleAlert, ExternalLink, FileWarning, ListTodo, Pause, Play, RefreshCw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { sanitizeGenerationParameters, sanitizeGenerationText } from "@/lib/works/generation-history";
import { cancelQueuedGeneration, hasQueuedGeneration, useGenerationQueue } from "@/lib/canvas/generation-task-queue";
import { useLocalWorkspaceStore } from "@/stores/use-local-workspace-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useGenerationTaskStore, type GenerationHistoryEntry, type GenerationTaskState } from "@/stores/use-generation-task-store";

type Filter = "all" | "running" | "attention" | "completed";
function diagnosticContent(value: unknown): unknown {
    if (typeof value === "string") return value.replace(/data:[^\s"']+/gi, "[媒体原件已省略]");
    if (Array.isArray(value)) return value.map(diagnosticContent);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, diagnosticContent(item)]));
    return value;
}
const statusText: Record<GenerationTaskState["status"], string> = { checking: "检查中", blocked: "检查未通过·未提交", queued: "本地排队", running: "生成中", needs_attention: "需处理", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
const phaseText: Record<GenerationTaskState["phase"], string> = { validation: "输入检查", upload: "上传素材", submission: "提交请求", remote_queue: "服务端排队", generation: "远程生成", download: "获取结果", save: "保存结果" };
const statusColor: Record<GenerationTaskState["status"], string> = { checking: "processing", blocked: "error", queued: "warning", running: "processing", needs_attention: "warning", succeeded: "success", failed: "error", cancelled: "default" };
const connectionText = { available: "可用", interrupted: "已中断", unknown: "未知" } as const;
const outputText = { none: "无结果", remote_available: "远程结果可用", downloaded: "已下载", archived: "已归档", save_failed: "本地保存失败" } as const;

function taskOf(entry: GenerationHistoryEntry): GenerationTaskState {
    if (entry.task) return entry.task;
    const status = entry.status === "pending" || entry.status === "running" ? "needs_attention" : entry.status === "canceled" ? "cancelled" : entry.status;
    return {
        status,
        phase: status === "succeeded" ? "save" : "validation",
        submission: "unknown",
        connection: "unknown",
        outputState: entry.outputFileIds.length ? "downloaded" : "none",
        model: entry.modelChannel,
        reasonCode: "历史记录没有新的任务状态详情；阶段未知，请打开任务日志核对",
        events: [],
    };
}

function displayName(entry: GenerationHistoryEntry) {
    return String(entry.inputSnapshot?.title || entry.parameters?.title || entry.taskId || entry.modelChannel || "媒体生成任务");
}
function phaseLabel(task: GenerationTaskState) {
    return task.reasonCode?.startsWith("历史记录") ? "历史阶段未知" : phaseText[task.phase];
}

export function TaskCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { token } = theme.useToken();
    const { entries, loading, error, refresh, start } = useGenerationTaskStore();
    const queuePaused = useGenerationQueue((state) => state.paused);
    const setQueuePaused = useGenerationQueue((state) => state.setPaused);
    const workspaceConnection = useLocalWorkspaceStore((state) => state.connection);
    const workspace = useLocalWorkspaceStore((state) => state.workspace);
    const workspaceMessage = useLocalWorkspaceStore((state) => state.message);
    const agentConnected = useAgentStore((state) => state.connected);
    const agentServiceAvailable = useAgentStore((state) => state.serviceAvailable);
    const agentConnectError = useAgentStore((state) => state.connectError);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const [filter, setFilter] = useState<Filter>("all");
    const [canvas, setCanvas] = useState<string>();
    const [channel, setChannel] = useState<string>();
    const [selectedId, setSelectedId] = useState<string>();
    const [tab, setTab] = useState("overview");
    const [includeCreativeText, setIncludeCreativeText] = useState(false);
    useEffect(() => start(), [start]);
    useEffect(() => {
        const onTaskOpen = (event: Event) => {
            const detail = (event as CustomEvent<{ attemptId?: string; nodeId?: string }>).detail;
            const match = detail.attemptId ? entries.find((entry) => entry.id === detail.attemptId) : entries.find((entry) => detail.nodeId && entry.nodeId === detail.nodeId);
            if (match) {
                setFilter("all");
                setSelectedId(match.id);
            }
        };
        window.addEventListener("infinite-studio:task-open", onTaskOpen);
        return () => window.removeEventListener("infinite-studio:task-open", onTaskOpen);
    }, [entries]);
    useEffect(() => {
        if (open) void refresh();
    }, [open, refresh]);

    const filtered = useMemo(
        () =>
            entries.filter((entry) => {
                const task = taskOf(entry);
                const filterOk =
                    filter === "all" ||
                    (filter === "running" && ["checking", "queued", "running"].includes(task.status)) ||
                    (filter === "attention" && ["blocked", "needs_attention", "failed"].includes(task.status)) ||
                    (filter === "completed" && ["succeeded", "cancelled"].includes(task.status));
                return filterOk && (!canvas || entry.canvasId === canvas) && (!channel || entry.modelChannel === channel);
            }),
        [entries, filter, canvas, channel],
    );
    const selected = filtered.find((entry) => entry.id === selectedId) || filtered[0];
    const selectedTask = selected ? taskOf(selected) : undefined;
    const targetCanvas = selected?.canvasId ? location.pathname.endsWith(selected.canvasId) : true;
    const runningCount = entries.filter((entry) => ["checking", "queued", "running"].includes(taskOf(entry).status)).length;
    const attentionCount = entries.filter((entry) => ["blocked", "needs_attention", "failed"].includes(taskOf(entry).status)).length;
    const canvases = Array.from(new Set(entries.map((entry) => entry.canvasId).filter(Boolean))).map((value) => ({ label: value, value }));
    const channels = Array.from(new Set(entries.map((entry) => entry.modelChannel).filter(Boolean))).map((value) => ({ label: value, value }));

    const locate = () => {
        if (!selected) return;
        const nodeId = selectedTask?.resultNodeId || selected.nodeId;
        if (!nodeId) return;
        if (selected.canvasId && !targetCanvas) navigate(`/sudio/${selected.canvasId}?taskNode=${encodeURIComponent(nodeId)}`);
        else window.dispatchEvent(new CustomEvent("infinite-studio:task-focus", { detail: { nodeId } }));
        onClose();
    };
    const emit = (name: "infinite-studio:task-resume" | "infinite-studio:task-stop") => {
        if (!selected || !selected.taskId || selectedTask?.provider === "plugin") return;
        const nodeId = selectedTask?.resultNodeId || selected.nodeId;
        if (selected.canvasId && !targetCanvas) {
            if (name === "infinite-studio:task-resume") navigate(`/sudio/${selected.canvasId}?taskNode=${encodeURIComponent(nodeId || "")}&taskResume=${encodeURIComponent(selected.id)}`);
            return;
        }
        window.dispatchEvent(new CustomEvent(name, { detail: { attemptId: selected.id, nodeId } }));
    };
    const exportDiagnosis = () => {
        if (!selected || !selectedTask) return;
        const diagnosis: Record<string, unknown> = {
            id: selected.id,
            taskId: selected.taskId || undefined,
            canvasId: selected.canvasId,
            nodeId: selected.nodeId,
            modelChannel: selected.modelChannel,
            status: selectedTask.status,
            phase: selectedTask.phase,
            submission: selectedTask.submission,
            connection: selectedTask.connection,
            outputState: selectedTask.outputState,
            events: selectedTask.events.map(({ id, sequence, at, phase, reasonCode }) => ({ id, sequence, at, phase, reasonCode })),
        };
        if (includeCreativeText) {
            diagnosis.events = sanitizeGenerationParameters(selectedTask.events);
            diagnosis.errorReason = selected.errorReason ? sanitizeGenerationText(selected.errorReason) : undefined;
            diagnosis.inputSnapshot = diagnosticContent(sanitizeGenerationParameters(selected.inputSnapshot));
            diagnosis.parameters = diagnosticContent(sanitizeGenerationParameters(selected.parameters || {}));
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify(diagnosis, null, 2)], { type: "application/json" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `task-diagnosis-${selected.id}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    return (
        <Drawer
            title={
                <Space>
                    <ListTodo className="size-4" />
                    任务中心
                </Space>
            }
            placement="right"
            size="large"
            open={open}
            onClose={onClose}
            extra={<Button type="text" icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()} aria-label="刷新任务" />}
        >
            <div className="flex h-full min-h-0 flex-col gap-3">
                <div className="rounded-lg border p-3" style={{ borderColor: token.colorBorder }}>
                    <Typography.Text strong>服务诊断</Typography.Text>
                    <div className="mt-2 grid gap-1 text-xs">
                        <Typography.Text type="secondary">当前页面：已载入任务中心</Typography.Text>
                        <Typography.Text type="secondary">
                            Workspace：
                            {workspaceConnection === "ready"
                                ? `已连接 · ${workspace?.workspaceId || ""}`
                                : workspaceConnection === "error" || workspaceConnection === "unavailable"
                                  ? `连接失败 · ${workspaceMessage || "请查看工作区错误"}`
                                  : "尚无本次页面连接证据"}
                        </Typography.Text>
                        <Typography.Text type="secondary">Agent：{agentConnected ? "已连接" : agentServiceAvailable ? "服务可用，尚未连接" : `未连接${agentConnectError ? ` · ${agentConnectError}` : ""}`}</Typography.Text>
                    </div>
                    <Button type="link" size="small" className="px-0" onClick={openAgentPanel}>
                        打开连接诊断
                    </Button>
                </div>
                <Space wrap>
                    <Tag icon={<Play className="size-3" />} color="processing">
                        进行中 {runningCount}
                    </Tag>
                    <Tag icon={<CircleAlert className="size-3" />} color={attentionCount ? "warning" : "default"}>
                        需处理 {attentionCount}
                    </Tag>
                    <Button size="small" icon={queuePaused ? <Play className="size-3" /> : <Pause className="size-3" />} onClick={() => setQueuePaused(!queuePaused)}>
                        {queuePaused ? "继续本地队列" : "暂停本地队列"}
                    </Button>
                    {queuePaused && (
                        <Typography.Text type="secondary" className="text-xs">
                            仅暂停尚未提交的本地任务，不影响远程任务
                        </Typography.Text>
                    )}
                </Space>
                <Space wrap>
                    <Segmented
                        value={filter}
                        onChange={(value) => setFilter(value as Filter)}
                        options={[
                            { label: "全部", value: "all" },
                            { label: "进行中", value: "running" },
                            { label: "需处理", value: "attention" },
                            { label: "已完成", value: "completed" },
                        ]}
                    />
                    <Select allowClear placeholder="画布" value={canvas} options={canvases} onChange={setCanvas} />
                    <Select allowClear placeholder="渠道" value={channel} options={channels} onChange={setChannel} />
                </Space>
                {error && <Typography.Text type="danger">{error}</Typography.Text>}
                <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[minmax(220px,0.8fr)_minmax(300px,1.2fr)]">
                    <List
                        className="min-h-0 overflow-auto"
                        dataSource={filtered}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" /> }}
                        renderItem={(entry) => {
                            const task = taskOf(entry);
                            return (
                                <List.Item
                                    className={`cursor-pointer rounded-lg px-3 ${selected?.id === entry.id ? "bg-[var(--ant-color-fill-tertiary)]" : ""}`}
                                    onClick={() => {
                                        setSelectedId(entry.id);
                                        setTab("overview");
                                    }}
                                >
                                    <List.Item.Meta
                                        title={<Typography.Text ellipsis>{displayName(entry)}</Typography.Text>}
                                        description={
                                            <Space direction="vertical" size={0}>
                                                <Tag color={statusColor[task.status]}>{statusText[task.status]}</Tag>
                                                <Typography.Text type="secondary" className="text-xs">
                                                    {phaseLabel(task)} · {new Date(entry.updatedAt).toLocaleString()}
                                                </Typography.Text>
                                            </Space>
                                        }
                                    />
                                    <ChevronRight className="size-4 shrink-0 text-stone-400" />
                                </List.Item>
                            );
                        }}
                    />
                    {selected && selectedTask ? (
                        <div className="min-h-0 overflow-auto">
                            <Space direction="vertical" className="w-full" size="middle">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <Typography.Title level={5} className="!mb-1">
                                            {displayName(selected)}
                                        </Typography.Title>
                                        <Tag color={statusColor[selectedTask.status]}>{statusText[selectedTask.status]}</Tag>
                                        <Typography.Text type="secondary" className="ml-2">
                                            {phaseLabel(selectedTask)}
                                        </Typography.Text>
                                    </div>
                                    <Space>
                                        <Button size="small" icon={<ExternalLink className="size-3" />} onClick={locate} disabled={!selectedTask.resultNodeId && !selected.nodeId}>
                                            定位节点
                                        </Button>
                                        <Button
                                            size="small"
                                            icon={<Play className="size-3" />}
                                            onClick={() => emit("infinite-studio:task-resume")}
                                            disabled={!selected.taskId || !selectedTask.provider || selectedTask.provider === "plugin" || ["succeeded", "failed", "blocked", "cancelled"].includes(selectedTask.status)}
                                        >
                                            恢复
                                        </Button>
                                        <Button size="small" icon={<Pause className="size-3" />} onClick={() => emit("infinite-studio:task-stop")} disabled={!targetCanvas || !selected.taskId || selectedTask.provider === "plugin"}>
                                            停止查询
                                        </Button>
                                        {selectedTask.status === "queued" && (
                                            <Button size="small" danger onClick={() => (hasQueuedGeneration(selected.id) ? cancelQueuedGeneration(selected.id) : undefined)} disabled={!hasQueuedGeneration(selected.id)}>
                                                移出队列
                                            </Button>
                                        )}
                                    </Space>
                                </div>
                                {selectedTask.status === "queued" && !hasQueuedGeneration(selected.id) && (
                                    <Typography.Text type="secondary" className="text-xs">
                                        当前标签页没有移出权限；请到执行页面处理，刷新后需重新检查。
                                    </Typography.Text>
                                )}
                                <Tabs
                                    activeKey={tab}
                                    onChange={setTab}
                                    items={[
                                        {
                                            key: "overview",
                                            label: "概览",
                                            children: (
                                                <Descriptions
                                                    column={1}
                                                    size="small"
                                                    items={[
                                                        { key: "channel", label: "渠道/模型", children: `${selected.modelChannel}${selectedTask.model ? ` · ${selectedTask.model}` : ""}` },
                                                        {
                                                            key: "submission",
                                                            label: "提交状态",
                                                            children:
                                                                selectedTask.submission === "unknown" ? "提交结果待确认" : selectedTask.submission === "not_sent" ? "未发送" : selectedTask.submission === "accepted" ? "已受理" : selectedTask.submission,
                                                        },
                                                        { key: "connection", label: "连接", children: connectionText[selectedTask.connection] },
                                                        { key: "output", label: "结果", children: outputText[selectedTask.outputState] },
                                                    ]}
                                                />
                                            ),
                                        },
                                        {
                                            key: "send",
                                            label: "发送内容",
                                            children: (
                                                <div className="space-y-2">
                                                    <Typography.Text type="secondary">本次快照（只读）</Typography.Text>
                                                    <pre style={{ background: token.colorFillTertiary }} className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs">
                                                        {JSON.stringify({ modelChannel: selected.modelChannel, parameters: selected.parameters, inputSnapshot: selected.inputSnapshot }, null, 2)}
                                                    </pre>
                                                </div>
                                            ),
                                        },
                                        {
                                            key: "log",
                                            label: "日志",
                                            children: selectedTask.events?.length ? (
                                                <List
                                                    size="small"
                                                    dataSource={selectedTask.events}
                                                    renderItem={(event) => (
                                                        <List.Item>
                                                            <Space direction="vertical" size={0}>
                                                                <Typography.Text>{event.message}</Typography.Text>
                                                                <Typography.Text type="secondary" className="text-xs">
                                                                    {event.at} · {phaseText[event.phase]}
                                                                </Typography.Text>
                                                            </Space>
                                                        </List.Item>
                                                    )}
                                                />
                                            ) : (
                                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无阶段日志" />
                                            ),
                                        },
                                        {
                                            key: "result",
                                            label: "结果",
                                            children: (
                                                <Space direction="vertical">
                                                    <Typography.Text>
                                                        {selectedTask.outputState === "remote_available"
                                                            ? "远程结果已生成，尚未保存到本地"
                                                            : selectedTask.outputState === "save_failed"
                                                              ? "本地保存失败，可恢复保存"
                                                              : selectedTask.outputState === "downloaded" || selectedTask.outputState === "archived"
                                                                ? "结果已保存"
                                                                : "暂无结果"}
                                                    </Typography.Text>
                                                    <Space wrap>
                                                        {selectedTask.outputState === "save_failed" && (
                                                            <Button disabled={!selected.taskId || !selectedTask.provider || selectedTask.provider === "plugin"} onClick={() => emit("infinite-studio:task-resume")}>
                                                                恢复保存
                                                            </Button>
                                                        )}
                                                        <Checkbox checked={includeCreativeText} onChange={(event) => setIncludeCreativeText(event.target.checked)}>
                                                            导出创作正文
                                                        </Checkbox>
                                                        <Button onClick={exportDiagnosis}>导出诊断</Button>
                                                    </Space>
                                                </Space>
                                            ),
                                        },
                                    ]}
                                />
                                <div className="rounded-lg border border-dashed border-[var(--ant-color-border)] p-3 text-xs text-[var(--ant-color-text-secondary)]">
                                    {selectedTask.reasonCode ? (
                                        <>
                                            <FileWarning className="mr-1 inline size-3" />
                                            {selectedTask.reasonCode}
                                        </>
                                    ) : (
                                        "日志与服务日志分开；未知状态不会自动重新提交。"
                                    )}
                                </div>
                            </Space>
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个任务查看详情" />
                    )}
                </div>
            </div>
        </Drawer>
    );
}
