import { expect, test } from "bun:test";

import {
    initialGenerationTask,
    reduceGenerationTask,
    type GenerationTaskState,
} from "../src/lib/works/generation-task-state";

const task = (patch: Partial<GenerationTaskState> = {}) => initialGenerationTask({
    provider: "autodl",
    model: "minimax_h3_zm_u24",
    ...patch,
}, "2026-10-09T21:00:00.000Z");

test("deduplicates a replayed event without changing state or appending a log", () => {
    const first = reduceGenerationTask(
        task(),
        { status: "queued", phase: "remote_queue", submission: "accepted" },
        "远程任务已受理",
        undefined,
        "event-accepted",
        "2026-10-09T21:00:01.000Z",
    );

    const replay = reduceGenerationTask(
        first,
        { status: "failed", phase: "submission", submission: "rejected" },
        "晚到的失败事件",
        "late_failure",
        "event-accepted",
        "2026-10-09T21:00:02.000Z",
    );

    expect(replay).toBe(first);
    expect(replay.events).toHaveLength(2);
});

test("does not let a late progress event move a terminal task backwards", () => {
    const succeeded = reduceGenerationTask(
        task({ status: "succeeded", phase: "save", submission: "accepted", outputState: "downloaded" }),
        { status: "succeeded", phase: "save", outputState: "downloaded" },
        "已保存结果",
        undefined,
        "event-saved",
    );

    const lateProgress = reduceGenerationTask(
        succeeded,
        { status: "running", phase: "generation", outputState: "remote_available" },
        "晚到的生成中事件",
        undefined,
        "event-late-running",
    );

    expect(lateProgress).toBe(succeeded);
    expect(lateProgress.status).toBe("succeeded");
    expect(lateProgress.phase).toBe("save");
});

test("does not append a phase-only late event after a terminal task", () => {
    const succeeded = task({
        status: "succeeded",
        phase: "save",
        submission: "accepted",
        outputState: "downloaded",
    });

    const latePhaseOnly = reduceGenerationTask(
        succeeded,
        { phase: "generation" },
        "晚到的阶段更新",
        undefined,
        "event-late-phase-only",
    );

    expect(latePhaseOnly).toBe(succeeded);
    expect(latePhaseOnly.events).toHaveLength(1);
});

test("never resets an accepted submission when a later patch omits acceptance", () => {
    const accepted = reduceGenerationTask(
        task({ status: "queued", phase: "remote_queue", submission: "accepted" }),
        { status: "running", phase: "generation" },
        "远程任务开始生成",
        undefined,
        "event-running",
    );

    const lateUnknown = reduceGenerationTask(
        accepted,
        { submission: "unknown", connection: "interrupted" },
        "连接短暂中断，保留已受理事实",
        "connection_lost",
        "event-interrupted",
    );

    expect(lateUnknown.submission).toBe("accepted");
    expect(lateUnknown.connection).toBe("interrupted");
});

test("allows needs_attention to recover into download without changing submission", () => {
    const attention = task({
        status: "needs_attention",
        phase: "download",
        submission: "accepted",
        outputState: "remote_available",
        reasonCode: "download_failed",
    });

    const retryDownload = reduceGenerationTask(
        attention,
        { status: "running", phase: "download", outputState: "remote_available" },
        "重新下载结果",
        undefined,
        "event-redownload",
    );

    expect(retryDownload.status).toBe("running");
    expect(retryDownload.phase).toBe("download");
    expect(retryDownload.submission).toBe("accepted");
    expect(retryDownload.outputState).toBe("remote_available");
});

test("does not infer acceptance from a running status when submission is unknown", () => {
    const unknown = task({
        status: "needs_attention",
        phase: "submission",
        submission: "unknown",
        connection: "interrupted",
    });

    const resumed = reduceGenerationTask(
        unknown,
        { status: "running", phase: "submission", connection: "available" },
        "重新检查提交结果",
        undefined,
        "event-recheck",
    );

    expect(resumed.status).toBe("running");
    expect(resumed.submission).toBe("unknown");
});
