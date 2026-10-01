// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig omits Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { DramaTask, DramaTaskLimits } from "@/services/api/drama-tasks";
import { ProjectTaskCenterView, type ProjectTaskCenterViewProps } from "./project-task-center";

const sourceTask: DramaTask = {
	task_key: "source-task-key",
	task_id: "source-task-id",
	task_type: "scene_build",
	task_type_label: "场景构建",
	username: "alice",
	project: "demo",
	project_id: "demo",
	episode: 2,
	beat_num: null,
	scope: "scene:rain",
	status: "running",
	progress: 0.37,
	current_task: "正在生成场景主图",
	result: null,
	error: null,
	logs: [],
	created_at: "2026-09-23T00:00:00Z",
	updated_at: "2026-09-23T00:00:05Z",
};

const taskLimits: DramaTaskLimits = {
	default: { limit: 4, active: 1, remaining: 3, user_limit: 2, user_active: 1, user_remaining: 1 },
};

function render(overrides: Partial<ProjectTaskCenterViewProps> = {}) {
	const props: ProjectTaskCenterViewProps = {
		projectId: "demo",
		tasks: [sourceTask],
		limits: taskLimits,
		loading: false,
		refreshing: false,
		loadError: "",
		limitsError: "",
		cancelError: "",
		streamError: "",
		streamState: "connected",
		cancelingTaskId: "",
		onRefresh: () => undefined,
		onCancel: () => undefined,
		...overrides,
	};
	return renderToStaticMarkup(createElement(ProjectTaskCenterView, props));
}

describe("project task center source-schema view", () => {
	test("shows only project-source task identity, status, progress, scope, and source limits", () => {
		const html = render();
		for (const value of ["虾集任务", "source-task-id", "scene_build", "running", "37%", "scene:rain", "用户限额", "用户剩余", "3"]) {
			expect(html).toContain(value);
		}
	});

	test("shows explicit SSE fallback, source errors, missing limits, and loading/empty states", () => {
		const fallback = render({ streamState: "polling", loadError: "虾集暂时不可达", limits: null });
		expect(fallback).toContain("正在通过任务列表轮询更新");
		expect(fallback).toContain("虾集暂时不可达");
		expect(fallback).toContain("限额暂不可用");
		expect(render({ loading: true, tasks: [] })).toContain("正在加载虾集任务");
		expect(render({ tasks: [] })).toContain("当前项目没有虾集任务");
	});

	test("keeps unknown source status visible and disables duplicate cancel while in flight", () => {
		const unknown = render({ tasks: [{ ...sourceTask, status: "source-paused" }] });
		expect(unknown).toContain("source-paused");
		const cancelling = render({ cancelingTaskId: "source-task-id" });
		expect(cancelling).toContain("正在取消");
	});
});
