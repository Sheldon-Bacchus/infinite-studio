// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { DramaPropReferenceStartResponse, DramaPropReferenceTaskResponse } from "@/services/api/drama-props";
import { dramaPropReferenceSelectOptions, PropReferenceGenerationManagerView, type PropReferenceGenerationManagerViewProps } from "./prop-reference-generation-manager";

const taskStart: DramaPropReferenceStartResponse = {
	ok: true,
	task_type: "prop_reference_asset",
	task_id: "source-task-9",
	task_key: "source-key-9",
	scope: "prop_ref__a87302d6d2cc",
	backend: "celery",
	queue: "default",
	message: "queued",
};

function render(overrides: Partial<PropReferenceGenerationManagerViewProps> = {}) {
	const props: PropReferenceGenerationManagerViewProps = {
		props: [{ name: "宝剑" }, { name: "红伞" }],
		selectedProp: "宝剑",
		startResponse: null,
		taskResponse: null,
		busy: false,
		error: "",
		onSelectProp: () => undefined,
		onStart: () => undefined,
		onRefresh: () => undefined,
		...overrides,
	};
	return renderToStaticMarkup(createElement(PropReferenceGenerationManagerView, props));
}

describe("DramaClaw prop reference generation manager", () => {
	test("selects an existing prop and starts the source generate-async operation", () => {
		const html = render();
		expect(dramaPropReferenceSelectOptions([{ name: "宝剑" }, { name: "红伞" }])).toEqual([
			{ value: "宝剑", label: "宝剑" },
			{ value: "红伞", label: "红伞" },
		]);
		for (const text of ["宝剑", "选择道具", "生成道具参考图", "启动虾集生成任务", "刷新源任务状态", "generate-async"]) {
			expect(html).toContain(text);
		}
	});

	test("shows source task identity without inventing a status before refresh", () => {
		const html = render({ startResponse: taskStart });
		for (const text of ["source-task-9", "prop_reference_asset", "prop_ref__a87302d6d2cc", "source-key-9", "启动响应没有状态字段；请刷新源任务状态核对。"]) {
			expect(html).toContain(text);
		}
		expect(html).not.toContain(">running<");
	});

	test("renders the exact source failure state and error for verification", () => {
		const taskResponse: DramaPropReferenceTaskResponse = {
			ok: true,
			data: {
				task_type: "prop_reference_asset",
				task_id: "source-task-9",
				status: "failed",
				error: "provider unavailable",
				progress: 0.4,
			},
		};
		const html = render({ startResponse: taskStart, taskResponse });
		for (const text of ["failed", "provider unavailable", "0.4", "查看原始 DramaClaw 响应"]) expect(html).toContain(text);
	});

	test("shows source data:null and its message without substituting a task status", () => {
		const taskResponse: DramaPropReferenceTaskResponse = { ok: true, data: null, message: "Task not found" };
		const html = render({ taskResponse });
		expect(html).toContain("源端返回 data: null");
		expect(html).toContain("Task not found");
		expect(html).not.toContain("failed");
	});

	test("disables task actions when no existing prop is available", () => {
		const html = render({ props: [], selectedProp: "" });
		expect(html).toContain("暂无可生成参考图的道具");
		expect(html).not.toContain("启动虾集生成任务");
		expect(html).not.toContain("刷新源任务状态");
	});
});
