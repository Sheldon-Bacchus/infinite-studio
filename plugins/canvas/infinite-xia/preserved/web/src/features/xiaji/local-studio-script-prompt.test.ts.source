// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { buildLocalStudioScriptPrompt } from "./local-studio-script-prompt";

describe("local script generation prompt", () => {
    test("keeps feature-drama generation tied to the source text and episode synopsis", () => {
        const prompt = buildLocalStudioScriptPrompt({
            projectType: "drama",
            episodeOrder: 2,
            episodeTitle: "雨夜重逢",
            synopsis: "两人在车站再次相遇。",
            sourceText: "原文第二集内容。",
            mode: "script",
        });

        expect(prompt).toContain("第 2 集：雨夜重逢");
        expect(prompt).toContain("两人在车站再次相遇。");
        expect(prompt).toContain("原文第二集内容。");
        expect(prompt).toContain("场景标题、动作、人物和对白");
    });

    test("sets narrated rewrite line and character limits for line-by-line output", () => {
        const prompt = buildLocalStudioScriptPrompt({
            projectType: "narrated",
            episodeOrder: 1,
            episodeTitle: "开场",
            synopsis: "主角发现线索。",
            sourceText: "原文。",
            mode: "line-by-line",
            targetLines: 12,
            minCharsPerLine: 18,
            maxCharsPerLine: 28,
        });

        expect(prompt).toContain("12 行");
        expect(prompt).toContain("18 到 28 个字");
        expect(prompt).toContain("每行单独成句");
    });
});
