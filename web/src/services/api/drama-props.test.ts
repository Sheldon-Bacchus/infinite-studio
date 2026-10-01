// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";

import { fetchDramaPropReferenceTask, startDramaPropReferenceGeneration } from "./drama-props";
import { useUserStore } from "@/stores/use-user-store";

const originalRequest = axios.request;
const originalUser = useUserStore.getState();

afterEach(() => {
	axios.request = originalRequest;
	useUserStore.setState(originalUser);
});

describe("DramaClaw prop reference task API", () => {
	test("starts the source generation route and keeps source task identity verbatim", async () => {
		useUserStore.setState({ token: "canvas-token" });
		const requests: Array<{ method?: string; url?: string; data?: unknown; headers?: unknown }> = [];
		axios.request = (async (config) => {
			requests.push({ method: config.method, url: String(config.url), data: config.data, headers: config.headers });
			return {
				data: {
					code: 0,
					data: { ok: true, task_type: "prop_reference_asset", task_id: "source-task-9", scope: "prop_ref__a87302d6d2cc", task_key: "source-key" },
					msg: "ok",
				},
				status: 200,
			} as never;
		}) as typeof axios.request;

		try {
			const response = await startDramaPropReferenceGeneration("project-a", "宝剑", { model: "banana-v2" });
			expect(response.task_id).toBe("source-task-9");
			expect(response.task_type).toBe("prop_reference_asset");
			expect(response.scope).toBe("prop_ref__a87302d6d2cc");
			expect(response.status).toBeUndefined();
		} finally {
			axios.request = originalRequest;
		}

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			method: "POST",
			url: "/api/v1/drama/projects/project-a/props/%E5%AE%9D%E5%89%91/reference/generate-async",
			data: { model: "banana-v2" },
			headers: { Authorization: "Bearer canvas-token" },
		});
	});

	test("refreshes the selected prop task and preserves source data:null plus message", async () => {
		const requests: Array<{ method?: string; url?: string; params?: unknown }> = [];
		axios.request = (async (config) => {
			requests.push({ method: config.method, url: String(config.url), params: config.params });
			return {
				data: { code: 0, data: { ok: true, data: null, message: "Task not found" }, msg: "ok" },
				status: 200,
			} as never;
		}) as typeof axios.request;

		try {
			const response = await fetchDramaPropReferenceTask("project-a", "宝剑");
			expect(response).toEqual({ ok: true, data: null, message: "Task not found" });
		} finally {
			axios.request = originalRequest;
		}
		expect(requests).toEqual([{
			method: "GET",
			url: "/api/v1/drama/projects/project-a/props/%E5%AE%9D%E5%89%91/reference/task",
			params: undefined,
		}]);
	});
});
