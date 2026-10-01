// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { getLocalStudioIntakeActions } from "./local-studio-intake-model";

describe("local studio intake actions", () => {
    test("offers local heading recognition without requiring a configured text model", () => {
        expect(getLocalStudioIntakeActions({ title: "项目", sourceText: "原文", draftCount: 0, saving: false, analyzing: false })).toMatchObject({
            primaryAction: "recognize-headings",
            primaryLabel: "按标题识别",
            primaryDisabled: false,
            saveDisabled: false,
            saveLabel: "保存项目并进入虾镜",
            nextStepHint: "保存成功后自动进入该项目的虾镜分集页。",
            saveHint: "项目和原稿可以先保存；分集可稍后导入 Agent 产物。",
        });
    });

    test("allows a recognized episode preview and source to be saved without invoking a model", () => {
        expect(getLocalStudioIntakeActions({ title: "项目", sourceText: "原文", draftCount: 2, saving: false, analyzing: false })).toMatchObject({
            primaryAction: "recognize-headings",
            primaryLabel: "按标题识别",
            primaryDisabled: false,
            saveDisabled: false,
            saveLabel: "保存项目并进入虾镜",
            nextStepHint: "保存成功后自动进入该项目的虾镜分集页。",
            saveHint: "识别到 2 集；检查后可与原稿一起保存。",
        });
    });

    test("explains the first missing save requirement", () => {
        expect(getLocalStudioIntakeActions({ title: " ", sourceText: "", draftCount: 0, saving: false, analyzing: false })).toMatchObject({
            saveDisabled: true,
            primaryDisabled: true,
            saveHint: "请先填写项目名称。",
        });
    });

    test("reports saving state and keeps the action disabled", () => {
        expect(getLocalStudioIntakeActions({ title: "项目", sourceText: "原文", draftCount: 1, saving: true, analyzing: false })).toMatchObject({
            saveDisabled: true,
            primaryDisabled: true,
            saveHint: "正在保存项目，请稍候。",
        });
    });

    test("rejects a second project submission until navigation finishes", async () => {
        const module = await import("./local-studio-intake-model") as unknown as Record<string, unknown>;
        const tryAcquire = module.tryAcquireLocalStudioSubmission as ((lock: { current: boolean }) => boolean) | undefined;
        expect(typeof tryAcquire).toBe("function");
        if (!tryAcquire) return;

        const lock = { current: false };
        expect(tryAcquire(lock)).toBe(true);
        expect(tryAcquire(lock)).toBe(false);
        lock.current = false;
        expect(tryAcquire(lock)).toBe(true);
    });
});
