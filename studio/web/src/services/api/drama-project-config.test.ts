// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import axios from "axios";

import { useUserStore } from "@/stores/use-user-store";
import { fetchDramaProjectConfig, updateDramaProjectConfig } from "./drama-project-config";

describe("DramaClaw project config API", () => {
	test("reads the source project config through the authenticated local BFF route", async () => {
		useUserStore.setState({ token: "canvas-token" });
		let request: { url?: string; method?: string; headers?: Record<string, string> } = {};
		const previousRequest = axios.request;
		axios.request = (async (config) => {
			request = { url: config.url, method: config.method, headers: config.headers as Record<string, string> };
			return { data: { code: 0, data: { project_id: "demo", visual_style: "anime" }, msg: "ok" }, status: 200 } as never;
		}) as typeof axios.request;
		try {
			const result = await fetchDramaProjectConfig("雨夜 project");
			expect(result.project_id).toBe("demo");
		} finally {
			axios.request = previousRequest;
		}
		expect(request.url).toBe("/api/v1/drama/projects/%E9%9B%A8%E5%A4%9C%20project");
		expect(request.method).toBe("GET");
		expect(request.headers).toMatchObject({ Authorization: "Bearer canvas-token" });
	});

	test("patches only the project-config endpoint with the allowed partial body", async () => {
		const requests: Array<{ url?: string; method?: string; data?: unknown }> = [];
		const previousRequest = axios.request;
		axios.request = (async (config) => {
			requests.push({ url: config.url, method: config.method, data: config.data });
			return { data: { code: 0, data: { spine_template: "narrated", ethnicity: "Korean" }, msg: "ok" }, status: 200 } as never;
		}) as typeof axios.request;
		try {
			const saved = await updateDramaProjectConfig("demo", { spine_template: "narrated", ethnicity: "Korean" });
			expect(saved.spine_template).toBe("narrated");
		} finally {
			axios.request = previousRequest;
		}
		expect(requests).toEqual([{ url: "/api/v1/drama/projects/demo", method: "PATCH", data: { spine_template: "narrated", ethnicity: "Korean" } }]);
	});

	test("refuses source-readonly metadata and unknown update fields", async () => {
		let calls = 0;
		const previousRequest = axios.request;
		axios.request = (async () => {
			calls += 1;
			return { data: { code: 0, data: {}, msg: "ok" }, status: 200 } as never;
		}) as typeof axios.request;
		try {
			await expect(updateDramaProjectConfig("demo", { scene_build_supported: false } as never)).rejects.toThrow("不支持的虾集项目配置字段");
			await expect(updateDramaProjectConfig("demo", { owner_username: "admin" } as never)).rejects.toThrow("不支持的虾集项目配置字段");
		} finally {
			axios.request = previousRequest;
		}
		expect(calls).toBe(0);
	});
});
