"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Modal, Progress, Spin, Tag } from "antd";

import {
	cancelDramaTask,
	consumeDramaTaskStream,
	DramaTaskApiError,
	DramaTaskConfirmationRequiredError,
	DramaTaskIdentityChangedError,
	fetchDramaProjectTasks,
	fetchDramaTaskLimits,
	type DramaTask,
	type DramaTaskLimits,
} from "@/services/api/drama-tasks";

export type ProjectTaskStreamState = "connecting" | "connected" | "reconnecting" | "polling" | "failed";

export type ProjectTaskCenterViewProps = {
	projectId: string;
	tasks: DramaTask[];
	limits: DramaTaskLimits | null;
	loading: boolean;
	refreshing: boolean;
	loadError: string;
	limitsError: string;
	cancelError: string;
	streamError: string;
	streamState: ProjectTaskStreamState;
	cancelingTaskId: string;
	onRefresh: () => void;
	onCancel: (task: DramaTask) => void;
};

const ACTIVE_SOURCE_STATUSES = new Set(["submitting", "queued", "pending", "starting", "running"]);
const TASK_STATUS_LABELS: Record<string, string> = {
	submitting: "提交中",
	queued: "排队中",
	pending: "等待中",
	starting: "启动中",
	running: "执行中",
	completed: "已完成",
	failed: "失败",
	cancelled: "已取消",
};

export function ProjectTaskCenterView({
	projectId,
	tasks,
	limits,
	loading,
	refreshing,
	loadError,
	limitsError,
	cancelError,
	streamError,
	streamState,
	cancelingTaskId,
	onRefresh,
	onCancel,
}: ProjectTaskCenterViewProps) {
	return (
		<section className="space-y-4" aria-label="虾集任务中心">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="m-0 text-lg font-semibold">虾集任务</h2>
					<p className="m-0 text-sm opacity-70">源项目：{projectId}</p>
				</div>
				<div className="flex items-center gap-3">
					<StreamHealth state={streamState} />
					<Button onClick={onRefresh} loading={refreshing}>刷新</Button>
				</div>
			</header>

			{streamState === "polling" && <Alert type="warning" showIcon title="实时任务流暂不可用，正在通过任务列表轮询更新" />}
			{streamState === "failed" && <Alert type="error" showIcon title={streamError || "虾集任务流不可用"} />}
			{streamError && streamState !== "failed" && <Alert type="warning" showIcon title={streamError} />}
			{loadError && <Alert type="error" showIcon title={loadError} action={<Button size="small" onClick={onRefresh}>重试</Button>} />}
			{cancelError && <Alert type="error" showIcon title={cancelError} />}

			<section aria-label="虾集任务限额" className="space-y-2">
				<h3 className="m-0 text-base font-medium">任务限额</h3>
				{limitsError && <Alert type="warning" showIcon title={limitsError} />}
				{!limits && !limitsError && <p className="text-sm opacity-70">限额暂不可用</p>}
				{limits && Object.keys(limits).length === 0 && <p className="text-sm opacity-70">源端未返回队列限额</p>}
				{limits && Object.entries(limits).map(([queue, value]) => (
					<Card key={queue} size="small" title={queue}>
						<div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
							<LimitValue label="项目限额" value={value.limit} />
							<LimitValue label="项目活动任务" value={value.active} />
							<LimitValue label="项目剩余" value={value.remaining} />
							<LimitValue label="用户限额" value={value.user_limit} />
							<LimitValue label="用户活动任务" value={value.user_active} />
							<LimitValue label="用户剩余" value={value.user_remaining} />
						</div>
					</Card>
				))}
			</section>

			<section aria-label="源项目任务" className="space-y-3">
				<h3 className="m-0 text-base font-medium">任务列表</h3>
				{loading && <div className="flex items-center gap-2 py-4"><Spin size="small" />正在加载虾集任务</div>}
				{!loading && !loadError && tasks.length === 0 && <Empty description="当前项目没有虾集任务" />}
				{tasks.map((task) => (
					<Card key={task.task_key} size="small" className="w-full">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="min-w-0 flex-1 space-y-2">
								<div className="flex flex-wrap items-center gap-2">
									<strong>{task.display_name || task.task_type_label || task.task_type}</strong>
									<Tag>{TASK_STATUS_LABELS[task.status] || task.status}（{task.status}）</Tag>
								</div>
								<div className="break-all text-xs opacity-70">task_type: {task.task_type} · task_id: {task.task_id}</div>
								<div className="text-sm">{task.current_task}</div>
								<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
									<span>episode: {task.episode}</span>
									{task.beat_num !== null && task.beat_num !== undefined && <span>beat_num: {task.beat_num}</span>}
									{task.scope && <span>scope: {task.scope}</span>}
								</div>
								<div className="flex items-center gap-3">
									<Progress percent={Math.round(Math.max(0, Math.min(1, task.progress)) * 100)} size="small" />
									<span className="shrink-0 text-xs">{Math.round(Math.max(0, Math.min(1, task.progress)) * 100)}%</span>
								</div>
								{task.error && <Alert type="error" showIcon title={task.error} />}
							</div>
							{ACTIVE_SOURCE_STATUSES.has(task.status) && (
								<Button danger disabled={cancelingTaskId === task.task_id} loading={cancelingTaskId === task.task_id} onClick={() => onCancel(task)}>
									{cancelingTaskId === task.task_id ? "正在取消" : "取消任务"}
								</Button>
							)}
						</div>
					</Card>
				))}
			</section>
		</section>
	);
}

function StreamHealth({ state }: { state: ProjectTaskStreamState }) {
	const labels: Record<ProjectTaskStreamState, string> = {
		connecting: "任务流连接中",
		connected: "实时连接",
		reconnecting: "任务流重连中",
		polling: "列表轮询",
		failed: "实时任务流失败",
	};
	return <span className="text-xs opacity-70" role="status">{labels[state]}</span>;
}

function LimitValue({ label, value }: { label: string; value: number | null }) {
	return <div>{label}：{value === null ? "无限制" : value}</div>;
}

export type ProjectTaskCenterProps = { projectId: string };

export function ProjectTaskCenter({ projectId }: ProjectTaskCenterProps) {
	const [tasks, setTasks] = useState<DramaTask[]>([]);
	const [limits, setLimits] = useState<DramaTaskLimits | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [loadError, setLoadError] = useState("");
	const [limitsError, setLimitsError] = useState("");
	const [cancelError, setCancelError] = useState("");
	const [streamError, setStreamError] = useState("");
	const [streamState, setStreamState] = useState<ProjectTaskStreamState>("connecting");
	const [cancelingTaskId, setCancelingTaskId] = useState("");

	const refresh = useCallback(async (signal?: AbortSignal) => {
		setRefreshing(true);
		const [taskResult, limitResult] = await Promise.allSettled([
			fetchDramaProjectTasks(projectId, signal),
			fetchDramaTaskLimits(projectId, signal),
		]);
		if (!signal?.aborted) {
			if (taskResult.status === "fulfilled") {
				setTasks(taskResult.value);
				setLoadError("");
			} else {
				setLoadError(errorMessage(taskResult.reason, "读取虾集任务失败"));
			}
			if (limitResult.status === "fulfilled") {
				setLimits(limitResult.value);
				setLimitsError("");
			} else {
				setLimitsError(errorMessage(limitResult.reason, "读取虾集任务限额失败"));
			}
			setLoading(false);
			setRefreshing(false);
		}
	}, [projectId]);

	useEffect(() => {
		const controller = new AbortController();
		let pollingTimer: ReturnType<typeof setInterval> | undefined;
		let attempts = 0;
		let refreshInFlight = false;
		setTasks([]);
		setLimits(null);
		setLoading(true);
		setLoadError("");
		setLimitsError("");
		setStreamError("");
		setStreamState("connecting");
		const startFallbackPolling = () => {
			if (pollingTimer) return;
			setStreamState("polling");
			pollingTimer = setInterval(() => {
				if (refreshInFlight || controller.signal.aborted) return;
				refreshInFlight = true;
				void refresh(controller.signal).finally(() => { refreshInFlight = false; });
			}, 5000);
		};
		const wait = (ms: number) => new Promise<void>((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				controller.signal.removeEventListener("abort", finish);
				resolve();
			};
			const timer = setTimeout(finish, ms);
			controller.signal.addEventListener("abort", finish, { once: true });
		});
		void (async () => {
			await refresh(controller.signal);
			while (!controller.signal.aborted) {
				setStreamState(attempts === 0 ? "connecting" : "reconnecting");
				try {
					await consumeDramaTaskStream(projectId, {
						signal: controller.signal,
						onTask: (task) => setTasks((previous) => {
							const found = previous.some((item) => item.task_key === task.task_key);
							return found ? previous.map((item) => item.task_key === task.task_key ? task : item) : [task, ...previous];
						}),
						onDeleted: (key) => setTasks((previous) => previous.filter((task) => task.task_key !== key)),
						onHealth: (health) => {
							setStreamState(health);
							setStreamError("");
							if (health === "connected") attempts = 0;
							if (pollingTimer) clearInterval(pollingTimer);
							pollingTimer = undefined;
						},
					});
				} catch (error) {
					if (controller.signal.aborted) return;
					attempts += 1;
					setStreamError(errorMessage(error, "虾集任务流已断开"));
					if (error instanceof DramaTaskApiError && (error.status === 401 || error.status === 403)) {
						setStreamState("failed");
						startFallbackPolling();
						return;
					}
					if (attempts >= 3) startFallbackPolling();
					setStreamState(attempts >= 3 ? "polling" : "reconnecting");
					await wait(Math.min(30_000, 1000 * 2 ** Math.min(attempts - 1, 5)));
				}
			}
		})();
		return () => {
			controller.abort();
			if (pollingTimer) clearInterval(pollingTimer);
		};
	}, [projectId, refresh]);

	const cancel = useCallback(async (task: DramaTask, confirmedNoRefund = false) => {
		setCancelingTaskId(task.task_id);
		setCancelError("");
		try {
			await cancelDramaTask(projectId, task, confirmedNoRefund);
			await refresh();
		} catch (error) {
			if (error instanceof DramaTaskConfirmationRequiredError && !confirmedNoRefund) {
				setCancelingTaskId("");
				Modal.confirm({
					title: "确认停止虾集任务",
					content: error.source.message || (error.source.refund_eligible === false ? "任务已经开始。确认后源端会强制终止，且不会退款。" : "源端要求确认后才能终止此任务。"),
					okText: error.source.refund_eligible === false ? "确认停止（不退款）" : "确认停止",
					cancelText: "继续运行",
					okButtonProps: { danger: true },
					onOk: () => cancel(task, true),
				});
				return;
			}
			setCancelError(error instanceof DramaTaskIdentityChangedError ? error.message : errorMessage(error, "取消虾集任务失败"));
			await refresh();
		} finally {
			setCancelingTaskId("");
		}
	}, [projectId, refresh]);

	return <ProjectTaskCenterView
		projectId={projectId}
		tasks={tasks}
		limits={limits}
		loading={loading}
		refreshing={refreshing}
		loadError={loadError}
		limitsError={limitsError}
		cancelError={cancelError}
		streamError={streamError}
		streamState={streamState}
		cancelingTaskId={cancelingTaskId}
		onRefresh={() => void refresh()}
		onCancel={(task) => void cancel(task)}
	/>;
}

function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}
