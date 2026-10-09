import { isVideoTaskFailed, storeGeneratedVideo, waitForVideoGenerationTask, type VideoGenerationTask } from "@/services/api/video";
import { waitForGenerationQueue } from "./generation-task-queue";
import type { AiConfig } from "@/stores/use-config-store";
import { updateGenerationHistory, updateGenerationTask } from "@/lib/works/generation-history";

export type TrackedVideoTaskOptions = {
    generationId: string;
    nodeId?: string;
    lockKey?: string;
    signal?: AbortSignal;
    existingTask?: VideoGenerationTask;
    createTask?: (onSubmitting: () => Promise<void>) => Promise<VideoGenerationTask>;
    onEvent?: (event: { phase: string; message: string; reasonCode?: string }) => void | Promise<void>;
    resultNodeId?: string;
    onSaved?: (video: Awaited<ReturnType<typeof storeGeneratedVideo>>, task: VideoGenerationTask) => Promise<boolean | void>;
    onAccepted?: (task: VideoGenerationTask) => Promise<void>;
};
export type TrackedVideoTaskResult = { task: VideoGenerationTask; video: Awaited<ReturnType<typeof storeGeneratedVideo>> };
const activeTasks = new Set<string>();
export function hasTrackedVideoTask(key: string) { return activeTasks.has(key); }

export async function runTrackedVideoTask(config: AiConfig, options: TrackedVideoTaskOptions): Promise<TrackedVideoTaskResult> {
    const key = options.lockKey || options.nodeId || options.generationId;
    const update = async (patch: Parameters<typeof updateGenerationTask>[1], message: string, reasonCode?: string) => {
        const entry = await updateGenerationTask(options.generationId, patch, message, reasonCode);
        if (!entry) throw new Error("任务记录无法保存，已阻止继续执行");
        await options.onEvent?.({ phase: patch.phase || entry.task?.phase || "validation", message, reasonCode });
        return entry;
    };
    if (activeTasks.has(key)) throw new Error("该节点已有任务执行中，请查看任务中心");
    activeTasks.add(key);
    let submitted = false;
    let accepted = Boolean(options.existingTask);
    let saving = false;
    let downloaded = false;
    try {
        const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
        if (!locks) throw new Error("浏览器不支持任务执行锁，无法安全提交或恢复任务");
        return await locks.request(`infinite-studio:video:${key}`, { ifAvailable: true }, async (lock) => {
            if (!lock) throw new Error("该任务正在其他页面执行，请查看任务中心");
            if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            if (!options.existingTask) await waitForGenerationQueue(options.generationId, options.signal);
            if (!options.existingTask) await update({ status: "running", phase: "upload", resultNodeId: options.resultNodeId }, "检查通过，正在准备素材");
            const onSubmitting = async () => {
                const entry = await update({ status: "running", phase: "submission", submission: "in_flight" }, "准备提交生成请求");
                if (entry.task?.submission !== "in_flight") throw new Error("任务状态不允许重新提交");
                submitted = true;
            };
            const task = options.existingTask || await options.createTask?.(onSubmitting);
            if (!task) throw new Error("没有可执行的视频任务");
            if (task.provider !== "plugin") {
                accepted = true;
                // 先持久化 ID，再保存网页节点；节点保存失败也能从历史恢复。
                await options.onAccepted?.(task);
                const entry = await updateGenerationHistory(options.generationId, {
                    taskId: task.id,
                    task: { status: "running", phase: "generation", submission: "accepted", connection: "available", provider: task.provider, model: task.model, resultNodeId: options.resultNodeId },
                    taskMessage: "任务已受理，远程身份已保存",
                });
                if (!entry) throw new Error("远程已受理，但本地任务 ID 保存失败");
                await update({ status: "running", phase: "generation", submission: "accepted", connection: "available", provider: task.provider, model: task.model, resultNodeId: options.resultNodeId }, "任务已受理，等待远程结果");
            } else {
                await update({ status: "running", phase: "generation", provider: "plugin", model: task.model }, "脚本已返回结果；未提供可恢复的远程任务 ID");
            }
            const result = await waitForVideoGenerationTask(config, task, { signal: options.signal });
            saving = true;
            await update({ status: "running", phase: "download", submission: "accepted", outputState: "remote_available" }, "生成结果可用，正在下载保存");
            const video = await storeGeneratedVideo(result, { strict: true });
            downloaded = true;
            await update({ status: "running", phase: "save", outputState: "downloaded" }, "视频文件已保存，正在关联画布与作品");
            const archived = await options.onSaved?.(video, task);
            await update({ status: "succeeded", phase: "save", outputState: archived === true ? "archived" : "downloaded", connection: "available" }, "本次结果已保存");
            await updateGenerationHistory(options.generationId, { status: "succeeded" });
            return { task, video };
        });
    } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        const remoteFailed = isVideoTaskFailed(error);
        const detail = error instanceof Error ? error.message : "未知错误";
        const submission = accepted ? "accepted" : submitted ? "unknown" : "not_sent";
        const code = saving ? "result_save_failed" : remoteFailed ? "remote_generation_failed" : accepted ? "query_interrupted" : submitted ? "submission_unknown" : aborted ? "local_cancelled" : "not_sent";
        // 若保存记录本身已失败，保留原错误；绝不能尝试重新发生成请求。
        await update({
            status: saving ? "needs_attention" : remoteFailed ? "failed" : accepted || submitted ? "needs_attention" : aborted ? "cancelled" : "blocked",
            phase: saving ? "save" : accepted ? "generation" : submitted ? "submission" : "validation",
            submission, connection: remoteFailed || saving ? "available" : accepted ? "interrupted" : "unknown",
            ...(saving ? { outputState: downloaded ? "downloaded" : "save_failed" } : {}),
        }, `${saving ? "结果保存未完成" : remoteFailed ? "远程生成失败" : accepted ? "查询已停止或中断，远程任务保留" : submitted ? "提交结果待确认；不会自动重新提交" : "本次未提交"}：${detail}`, code).catch(() => undefined);
        throw error;
    } finally { activeTasks.delete(key); }
}
