import { useUserStore } from "@/stores/use-user-store";

export type DramaTaskStatus = string;

export type DramaTask = {
	task_key: string;
	task_id: string;
	task_type: string;
	username: string;
	project: string;
	project_id?: string;
	episode: number;
	beat_num: number | null;
	scope: string | null;
	status: DramaTaskStatus;
	progress: number;
	current_task: string;
	current_task_code?: string | null;
	current_task_params?: Record<string, unknown> | null;
	task_type_label?: string;
	display_name?: string;
	result: unknown;
	error: string | null;
	error_code?: string | null;
	logs: string[];
	created_at: string;
	updated_at: string;
	completed_at?: string;
	metadata?: Record<string, unknown> | null;
	[key: string]: unknown;
};

export type DramaTaskLimit = {
	limit: number | null;
	active: number;
	remaining: number | null;
	user_limit: number | null;
	user_active: number;
	user_remaining: number | null;
};

export type DramaTaskLimits = Record<string, DramaTaskLimit>;

export type DramaTaskCancelResult = {
	ok: boolean;
	status: string;
	message?: string;
	requires_confirmation?: boolean;
	refund_eligible?: boolean;
	refund_status?: string;
	continued?: boolean;
	[key: string]: unknown;
};

export type DramaTaskCancelConflict = {
	ok?: boolean;
	status?: string;
	message?: string;
	requires_confirmation?: boolean;
	refund_eligible?: boolean;
	refund_status?: string;
	[key: string]: unknown;
};

export class DramaTaskApiError extends Error {
	constructor(message: string, public readonly status: number, public readonly data: unknown) {
		super(message);
		this.name = "DramaTaskApiError";
	}
}

export class DramaTaskConfirmationRequiredError extends Error {
	readonly status = 409;
	constructor(public readonly source: DramaTaskCancelConflict) {
		super(source.message || "源端要求确认后才能停止任务");
		this.name = "DramaTaskConfirmationRequiredError";
	}
}

export class DramaTaskIdentityChangedError extends Error {
	constructor(public readonly currentTask: DramaTask | null) {
		super("源端任务身份已变化；已停止本次取消并刷新任务列表");
		this.name = "DramaTaskIdentityChangedError";
	}
}

type TaskQuery = { beat_num?: number | null; scope?: string | null };
type TaskStreamHealth = "connecting" | "connected";

function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function normalizeTask(value: unknown): DramaTask {
	const task = object(value);
	if (!task || typeof task.task_type !== "string" || typeof task.task_id !== "string" || typeof task.task_key !== "string") {
		throw new Error("虾集 task_type、task_id 或 task_key 缺失");
	}
	if (typeof task.status !== "string" || typeof task.progress !== "number" || !Number.isFinite(task.progress)) {
		throw new Error("虾集任务 status 或 progress 格式无效");
	}
	if (typeof task.episode !== "number" || !Number.isInteger(task.episode)) {
		throw new Error("虾集任务 episode 格式无效");
	}
	return task as DramaTask;
}

function normalizeTasks(value: unknown): DramaTask[] {
	if (!Array.isArray(value)) throw new Error("虾集任务列表格式无效");
	return value.map(normalizeTask);
}

function normalizeTaskLimits(value: unknown): DramaTaskLimits {
	const limits = object(value);
	if (!limits) throw new Error("虾集任务限额格式无效");
	const result: DramaTaskLimits = {};
	for (const [queue, raw] of Object.entries(limits)) {
		const limit = object(raw);
		if (!limit) throw new Error(`虾集任务限额 ${queue} 格式无效`);
		for (const field of ["limit", "active", "remaining", "user_limit", "user_active", "user_remaining"] as const) {
			const number = limit[field];
			if (!(number === null || (typeof number === "number" && Number.isFinite(number) && number >= 0))) {
				throw new Error(`虾集任务限额 ${queue}.${field} 格式无效`);
			}
		}
		result[queue] = limit as DramaTaskLimit;
	}
	return result;
}

function route(projectId: string, suffix = "") {
	return `/api/v1/drama/projects/${encodeURIComponent(projectId)}/tasks${suffix}`;
}

function scopedQuery(query: TaskQuery = {}) {
	const params = new URLSearchParams();
	if (query.beat_num !== undefined && query.beat_num !== null) params.set("beat_num", String(query.beat_num));
	if (query.scope) params.set("scope", query.scope);
	return params;
}

function taskIdentity(task: DramaTask): TaskQuery {
	return { beat_num: task.beat_num, scope: task.scope };
}

async function responseData<T>(response: Response): Promise<T> {
	let payload: Record<string, unknown> | undefined;
	try { payload = object(await response.json()); } catch { /* Report malformed BFF response below. */ }
	if (!payload || (typeof payload.code !== "number")) {
		throw new DramaTaskApiError("虾集任务接口响应格式无效", response.status, null);
	}
	if (!response.ok || payload.code !== 0) {
		throw new DramaTaskApiError(typeof payload.msg === "string" ? payload.msg : "虾集任务请求失败", response.status, payload.data);
	}
	return payload.data as T;
}

async function requestData<T>(path: string, method = "GET", signal?: AbortSignal): Promise<T> {
	const token = useUserStore.getState().token;
	const response = await fetch(path, {
		method,
		cache: "no-store",
		credentials: "same-origin",
		signal,
		headers: token ? { Authorization: `Bearer ${token}` } : undefined,
	});
	return responseData<T>(response);
}

export async function fetchDramaProjectTasks(projectId: string, signal?: AbortSignal): Promise<DramaTask[]> {
	return normalizeTasks(await requestData<unknown>(route(projectId), "GET", signal));
}

export async function fetchDramaTaskLimits(projectId: string, signal?: AbortSignal): Promise<DramaTaskLimits> {
	return normalizeTaskLimits(await requestData<unknown>(route(projectId, "/limits"), "GET", signal));
}

export async function fetchDramaProjectTask(projectId: string, taskType: string, episode: number, query: TaskQuery = {}): Promise<DramaTask | null> {
	const params = scopedQuery(query);
	const suffix = `/${encodeURIComponent(taskType)}/${episode}${params.size ? `?${params}` : ""}`;
	const value = await requestData<unknown>(route(projectId, suffix));
	return value === null ? null : normalizeTask(value);
}

export async function cancelDramaTask(projectId: string, task: DramaTask, confirmedNoRefund = false): Promise<DramaTaskCancelResult> {
	const current = await fetchDramaProjectTask(projectId, task.task_type, task.episode, taskIdentity(task));
	if (!current || current.task_id !== task.task_id) throw new DramaTaskIdentityChangedError(current);
	const params = scopedQuery(taskIdentity(task));
	if (confirmedNoRefund) {
		params.set("force", "true");
		params.set("acknowledge_no_refund", "true");
	}
	const suffix = `/${encodeURIComponent(task.task_type)}/${task.episode}${params.size ? `?${params}` : ""}`;
	try {
		return await requestData<DramaTaskCancelResult>(route(projectId, suffix), "DELETE");
	} catch (error) {
		if (error instanceof DramaTaskApiError && error.status === 409) {
			const conflict = object(error.data) as DramaTaskCancelConflict | undefined;
			if (conflict?.requires_confirmation === true) throw new DramaTaskConfirmationRequiredError(conflict);
		}
		throw error;
	}
}

export type DramaTaskStreamHandlers = {
	signal: AbortSignal;
	onTask: (task: DramaTask) => void;
	onDeleted: (taskKey: string) => void;
	onHealth: (health: TaskStreamHealth) => void;
};

export async function consumeDramaTaskStream(projectId: string, handlers: DramaTaskStreamHandlers): Promise<void> {
	const token = useUserStore.getState().token;
	const response = await fetch(`${route(projectId, "/stream")}?snapshot=false`, {
		method: "GET",
		cache: "no-store",
		credentials: "same-origin",
		signal: handlers.signal,
		headers: { Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
	});
	if (!response.ok) {
		await responseData<never>(response);
		throw new DramaTaskApiError("虾集任务流连接失败", response.status, null);
	}
	if (!response.headers.get("Content-Type")?.toLowerCase().includes("text/event-stream") || !response.body) {
		throw new Error("虾集任务流响应不是 event-stream");
	}
	handlers.onHealth("connecting");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const dispatch = (block: string) => {
		let event = "message";
		const data: string[] = [];
		for (const line of block.split(/\r?\n/)) {
			if (!line || line.startsWith(":")) continue;
			const colon = line.indexOf(":");
			const field = colon < 0 ? line : line.slice(0, colon);
			const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
			if (field === "event") event = value;
			if (field === "data") data.push(value);
		}
		if (data.length === 0) return;
		const payload = data.join("\n");
		if (event === "task_updated") {
			handlers.onTask(normalizeTask(JSON.parse(payload)));
			handlers.onHealth("connected");
		} else if (event === "deleted") {
			const taskKey = object(JSON.parse(payload))?.task_key;
			if (typeof taskKey !== "string") throw new Error("虾集 deleted 事件缺少 task_key");
			handlers.onDeleted(taskKey);
			handlers.onHealth("connected");
		} else if (event === "heartbeat") {
			handlers.onHealth("connected");
		} else if (event === "auth_revoked") {
			throw new Error("虾集任务流认证已失效");
		}
	};
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let boundary = buffer.search(/\r?\n\r?\n/);
			while (boundary >= 0) {
				const block = buffer.slice(0, boundary);
				const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0].length || 2;
				buffer = buffer.slice(boundary + separator);
				dispatch(block);
				boundary = buffer.search(/\r?\n\r?\n/);
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) dispatch(buffer);
	} finally {
		try { await reader.cancel(); } catch { /* The request may already be aborted or closed. */ }
		reader.releaseLock();
	}
	if (!handlers.signal.aborted) {
		throw new Error("虾集任务流已断开");
	}
}
