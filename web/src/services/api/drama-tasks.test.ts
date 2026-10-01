// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig omits Bun types.
import { afterEach, describe, expect, test } from "bun:test";
import { useUserStore } from "@/stores/use-user-store";
import {
	cancelDramaTask,
	consumeDramaTaskStream,
	DramaTaskApiError,
	DramaTaskConfirmationRequiredError,
	DramaTaskIdentityChangedError,
	fetchDramaProjectTask,
	fetchDramaProjectTasks,
	fetchDramaTaskLimits,
	type DramaTask,
} from "./drama-tasks";

const originalFetch = globalThis.fetch;

function task(overrides: Partial<DramaTask> = {}): DramaTask {
	return {
		task_key: "source-key-1",
		task_id: "source-id-1",
		task_type: "scene_build",
		username: "alice",
		project: "demo",
		project_id: "demo",
		episode: 2,
		beat_num: 4,
		scope: "scene:rain",
		status: "running",
		progress: 0.45,
		current_task: "正在构建场景",
		result: null,
		error: null,
		logs: [],
		created_at: "2026-09-23T00:00:00Z",
		updated_at: "2026-09-23T00:00:10Z",
		...overrides,
	};
}

function ok(data: unknown) {
	return new Response(JSON.stringify({ code: 0, data, msg: "ok" }), { status: 200 });
}

afterEach(() => {
	useUserStore.setState({ token: "" });
	globalThis.fetch = originalFetch;
});

describe("DramaClaw project task API", () => {
	test("reads only the source project task list and preserves task identity and progress", async () => {
		useUserStore.setState({ token: "canvas-user-token" });
		const sourceTask = task();
		let request: { url: string; headers?: HeadersInit } | undefined;
		globalThis.fetch = (async (input, init) => {
			request = { url: String(input), headers: init?.headers };
			return ok([sourceTask]);
		}) as typeof fetch;

		const result = await fetchDramaProjectTasks("demo one");
		expect(request?.url).toBe("/api/v1/drama/projects/demo%20one/tasks");
		expect(request?.headers).toMatchObject({ Authorization: "Bearer canvas-user-token" });
		expect(result[0]).toMatchObject({ task_type: "scene_build", task_id: "source-id-1", task_key: "source-key-1", status: "running", progress: 0.45, scope: "scene:rain" });
	});

	test("reads source limits and a specifically scoped source task without renaming fields", async () => {
		const requests: string[] = [];
		globalThis.fetch = (async (input) => {
			requests.push(String(input));
			if (String(input).endsWith("/limits")) return ok({ default: { limit: 3, active: 1, remaining: 2, user_limit: 2, user_active: 1, user_remaining: 1 } });
			return ok(task());
		}) as typeof fetch;

		const limits = await fetchDramaTaskLimits("demo");
		const current = await fetchDramaProjectTask("demo", "scene_build", 2, { beat_num: 4, scope: "scene:rain" });
		expect(requests).toEqual([
			"/api/v1/drama/projects/demo/tasks/limits",
			"/api/v1/drama/projects/demo/tasks/scene_build/2?beat_num=4&scope=scene%3Arain",
		]);
		expect(limits.default).toEqual({ limit: 3, active: 1, remaining: 2, user_limit: 2, user_active: 1, user_remaining: 1 });
		expect(current?.task_id).toBe("source-id-1");
	});

	test("surfaces the source 409 and sends force only after explicit confirmation", async () => {
		useUserStore.setState({ token: "canvas-user-token" });
		const requests: Array<{ url: string; method: string; body?: string }> = [];
		globalThis.fetch = (async (input, init) => {
			const url = String(input);
			const method = init?.method || "GET";
			requests.push({ url, method });
			if (method === "GET") return ok(task());
			if (!url.includes("force=true")) {
				return new Response(JSON.stringify({ code: 1, data: { ok: false, status: "running", requires_confirmation: true, refund_eligible: false, message: "任务已开始，终止不会退还积分" }, msg: "任务已开始，终止不会退还积分" }), { status: 409 });
			}
			return ok({ ok: true, status: "cancelled", refund_eligible: false, refund_status: "not_refunded" });
		}) as typeof fetch;

		let conflict: DramaTaskConfirmationRequiredError | undefined;
		try { await cancelDramaTask("demo", task()); } catch (error) {
			if (error instanceof DramaTaskConfirmationRequiredError) conflict = error;
			else throw error;
		}
		expect(conflict?.source.message).toBe("任务已开始，终止不会退还积分");
		expect(requests).toHaveLength(2);
		expect(requests[0]?.method).toBe("GET");
		expect(requests[1]?.url).toContain("/tasks/scene_build/2?beat_num=4&scope=scene%3Arain");
		expect(requests[1]?.url).not.toContain("force=true");

		const result = await cancelDramaTask("demo", task(), true);
		expect(result).toMatchObject({ status: "cancelled", refund_status: "not_refunded" });
		expect(requests[3]?.url).toContain("force=true&acknowledge_no_refund=true");
	});

	test("refuses to cancel when the scoped source task identity changed", async () => {
		const requests: string[] = [];
		globalThis.fetch = (async (input) => {
			requests.push(String(input));
			return ok(task({ task_id: "replacement-task-id" }));
		}) as typeof fetch;
		await expect(cancelDramaTask("demo", task())).rejects.toBeInstanceOf(DramaTaskIdentityChangedError);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toContain("/tasks/scene_build/2?");
	});

	test("rejects malformed /tasks payloads and retains authenticated API failures", async () => {
		globalThis.fetch = (async () => ok([{ task_type: "scene_build" }])) as typeof fetch;
		await expect(fetchDramaProjectTasks("demo")).rejects.toThrow("task_id");
		globalThis.fetch = (async () => new Response(JSON.stringify({ code: 1, data: null, msg: "虾集项目权限不足" }), { status: 403 })) as typeof fetch;
		try {
			await fetchDramaTaskLimits("demo");
			throw new Error("expected API error");
		} catch (error) {
			expect(error).toBeInstanceOf(DramaTaskApiError);
			expect((error as DramaTaskApiError).status).toBe(403);
		}
	});

	test("consumes source project SSE events and preserves each task payload", async () => {
		useUserStore.setState({ token: "canvas-user-token" });
		const taskEvents: DramaTask[] = [];
		const deleted: string[] = [];
		const health: string[] = [];
		let request: { url: string; headers?: HeadersInit } | undefined;
		const lines = [
			"event: task_updated\ndata: " + JSON.stringify(task()) + "\n\n",
			"event: deleted\ndata: {\"task_key\":\"source-key-1\"}\n\n",
			"event: heartbeat\ndata: {\"ts\":1}\n\n",
		].join("");
		const streamController = new AbortController();
		globalThis.fetch = (async (input, init) => {
			request = { url: String(input), headers: init?.headers };
			return new Response(new ReadableStream({ start(controller) {
				controller.enqueue(new TextEncoder().encode(lines));
				init?.signal?.addEventListener("abort", () => controller.close(), { once: true });
			} }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
		}) as typeof fetch;
		const consuming = consumeDramaTaskStream("demo", {
			signal: streamController.signal,
			onTask: (value) => taskEvents.push(value),
			onDeleted: (key) => deleted.push(key),
			onHealth: (value) => health.push(value),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		streamController.abort();
		await consuming;
		expect(request?.url).toBe("/api/v1/drama/projects/demo/tasks/stream?snapshot=false");
		expect(request?.headers).toMatchObject({ Authorization: "Bearer canvas-user-token", Accept: "text/event-stream" });
		expect(taskEvents[0]).toMatchObject({ task_type: "scene_build", task_id: "source-id-1", progress: 0.45 });
		expect(deleted).toEqual(["source-key-1"]);
		expect(health).toContain("connected");
	});

	test("reports source auth_revoked and premature stream closure as explicit errors", async () => {
		globalThis.fetch = (async () => new Response("event: auth_revoked\ndata: {\"reason\":\"unauthorized\"}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
		await expect(consumeDramaTaskStream("demo", { signal: new AbortController().signal, onTask: () => undefined, onDeleted: () => undefined, onHealth: () => undefined })).rejects.toThrow("认证已失效");
		globalThis.fetch = (async () => new Response("", { status: 200, headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
		await expect(consumeDramaTaskStream("demo", { signal: new AbortController().signal, onTask: () => undefined, onDeleted: () => undefined, onHealth: () => undefined })).rejects.toThrow("虾集任务流已断开");
	});
});
