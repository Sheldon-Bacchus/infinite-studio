// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectSettingsDialogView, type ProjectSettingsDialogViewProps } from "./project-settings-dialog";

function render(overrides: Partial<ProjectSettingsDialogViewProps> = {}) {
	const props: ProjectSettingsDialogViewProps = {
		projectId: "demo",
		open: true,
		config: { spine_template: "legacy-template", aspect_ratio: "1:1", visual_style: "custom-style", narration_style: "omniscient", ethnicity: "Martian" },
		draft: { spine_template: "legacy-template", aspect_ratio: "1:1", visual_style: "custom-style", narration_style: "omniscient", ethnicity: "Martian" },
		loading: false,
		loadError: "",
		saveError: "",
		saving: false,
		saved: false,
		dirty: false,
		onClose: () => undefined,
		onRetry: () => undefined,
		onFieldChange: () => undefined,
		onSave: () => undefined,
		...overrides,
	};
	return renderToStaticMarkup(createElement(ProjectSettingsDialogView, props));
}

describe("project settings dialog view", () => {
	test("does not render while closed", () => {
		expect(render({ open: false })).toBe("");
	});

	test("renders loading, retryable read failure, save failure, and success states", () => {
		expect(render({ loading: true })).toContain("正在读取项目配置");
		const readFailure = render({ loadError: "虾集连接失败" });
		expect(readFailure).toContain("虾集连接失败");
		expect(readFailure).toContain("重试");
		expect(render({ saveError: "项目类型已锁定" })).toContain("项目类型已锁定");
		expect(render({ saved: true })).toContain("保存成功，已刷新项目配置");
		expect(render({ saving: true })).toContain("正在保存");
	});

	test("renders source project fields and keeps out-of-enum source values visible", () => {
		const html = render();
		for (const label of ["项目类型", "画面比例", "视觉风格", "解说视角", "人物人种", "legacy-template", "1:1", "omniscient", "Martian"]) {
			expect(html).toContain(label);
		}
		expect(html).toContain("当前源配置");
	});

	test("does not offer a save action when unchanged or loading", () => {
		expect(render()).toContain("disabled=\"\"");
		expect(render({ dirty: true, loading: true })).not.toContain("保存配置");
		expect(render({ dirty: true })).toContain("保存配置");
	});
});
