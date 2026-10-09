import { Tag } from "antd";
import { useGenerationTaskStore } from "@/stores/use-generation-task-store";
import { useEffect, useMemo } from "react";
import { type GenerationHistoryEntry } from "@/lib/works/generation-history";

const labels: Record<string, string> = { checking: "检查中", blocked: "检查未通过·未提交", queued: "本地排队", running: "生成中", needs_attention: "需处理", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
const colors: Record<string, string> = { checking: "processing", blocked: "error", queued: "warning", running: "processing", needs_attention: "warning", succeeded: "success", failed: "error", cancelled: "default" };
const phases: Record<string, string> = { validation: "检查输入", upload: "上传素材", submission: "提交请求", remote_queue: "等待远程队列", generation: "等待远程结果", download: "获取结果", save: "保存结果" };

/** 画布节点上的任务状态投影；只读，不触发生成或重试。 */
export function TaskStatus({ nodeId, canvasId, onOpen }: { nodeId: string; canvasId?: string; onOpen?: (entry: GenerationHistoryEntry) => void }) {
    const entries = useGenerationTaskStore((state) => state.entries);
    const start = useGenerationTaskStore((state) => state.start);
    useEffect(() => start(), [start]);
    const entry = useMemo(
        () => entries.filter((item) => (item.nodeId === nodeId || item.task?.resultNodeId === nodeId) && (!canvasId || item.canvasId === canvasId)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0],
        [entries, nodeId, canvasId],
    );
    if (!entry) return null;
    const status = entry.task?.status || (entry.status === "succeeded" ? "succeeded" : entry.status === "failed" ? "failed" : "needs_attention");
    const task = entry.task;
    const onClick = () => (onOpen ? onOpen(entry) : window.dispatchEvent(new CustomEvent("infinite-studio:task-open", { detail: { attemptId: entry.id, nodeId, canvasId } })));
    const seconds = Math.max(0, Math.floor((Date.parse(entry.updatedAt) - Date.parse(entry.createdAt)) / 1000));
    const elapsedText = seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
    const summary = task?.reasonCode || entry.errorReason;
    return (
        <button type="button" className="inline-flex items-center gap-1 text-left" onClick={onClick} aria-label="打开任务详情">
            <Tag color={colors[status]}>{labels[status]}</Tag>
            {task && (
                <span className="text-xs text-[var(--ant-color-text-secondary)]">
                    {phases[task.phase]} · {elapsedText}
                    {summary ? ` · ${summary}` : ""}
                </span>
            )}
        </button>
    );
}
