// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { previewLocalEpisodeStructure } from "./local-manuscript-structure";

describe("local manuscript structure preview", () => {
    test("splits headed manuscript into ordered episode drafts while retaining section text", () => {
        expect(previewLocalEpisodeStructure("第一集 相遇\n海边相见。\n\n第二集 重逢\n车站再见。", "故事")).toEqual([
            { title: "第一集 相遇", order: 1, sourceEpisodeNumber: 1, synopsis: "海边相见。" },
            { title: "第二集 重逢", order: 2, sourceEpisodeNumber: 2, synopsis: "车站再见。" },
        ]);
    });

    test("does not invent an episode when the manuscript has no recognized headings", () => {
        expect(previewLocalEpisodeStructure("一段没有分集标题的原文。", "海边来信")).toEqual([]);
    });

    test("recognizes Markdown-formatted Chinese episode headings", () => {
        expect(previewLocalEpisodeStructure("# 第一集：海边\n两人在海边相遇。\n\n## 第二集：车站\n两人在车站重逢。", "海边来信")).toEqual([
            { title: "第一集：海边", order: 1, sourceEpisodeNumber: 1, synopsis: "两人在海边相遇。" },
            { title: "第二集：车站", order: 2, sourceEpisodeNumber: 2, synopsis: "两人在车站重逢。" },
        ]);
    });
});
