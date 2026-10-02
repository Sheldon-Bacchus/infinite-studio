// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { filterDramaProjectSummaries, getDramaImportableProjects, normalizeDramaProjectSummaries } from "./drama-import";

describe("normalizeDramaProjectSummaries", () => {
    test("normalizes source project identifiers, lifecycle state, and episode counts", () => {
        expect(normalizeDramaProjectSummaries([
            { project_id: "rainy-night", name: "雨夜", status: "active", episode_count: 2, beat_count: 9 },
            { id: "archived-project", name: "旧稿", status: "archived", episode_count: 1 },
        ])).toEqual([
            { id: "rainy-night", name: "雨夜", status: "active", episodeCount: 2, beatCount: 9 },
            { id: "archived-project", name: "旧稿", status: "archived", episodeCount: 1, beatCount: 0 },
        ]);
    });

    test("rejects rows without a source project identifier", () => {
        expect(() => normalizeDramaProjectSummaries([{ name: "无 ID 项目", status: "active" }])).toThrow("项目 ID");
    });

    test("rejects lifecycle values that the source page cannot safely act on", () => {
        expect(() => normalizeDramaProjectSummaries([{ id: "unknown", name: "未知", status: "purged" }])).toThrow("项目状态");
    });
});

describe("filterDramaProjectSummaries", () => {
    const projects = normalizeDramaProjectSummaries([
        { id: "rainy-night", name: "雨夜车站", status: "active", episode_count: 2 },
        { id: "old-cut", name: "旧版剪辑", status: "archived", episode_count: 1 },
        { id: "trash", name: "已删除项目", status: "deleted" },
    ]);

    test("filters by lifecycle tab and project name", () => {
        expect(filterDramaProjectSummaries(projects, "active", "车站").map((item) => item.id)).toEqual(["rainy-night"]);
        expect(filterDramaProjectSummaries(projects, "archived", "").map((item) => item.id)).toEqual(["old-cut"]);
        expect(filterDramaProjectSummaries(projects, "all", "").map((item) => item.id)).toEqual(["rainy-night", "old-cut", "trash"]);
    });
});

describe("getDramaImportableProjects", () => {
    test("keeps active and archived projects available in the in-canvas picker but excludes deleted ones", () => {
        const projects = normalizeDramaProjectSummaries([
            { id: "active", name: "进行中", status: "active" },
            { id: "archived", name: "已归档", status: "archived" },
            { id: "deleted", name: "已删除", status: "deleted" },
        ]);
        expect(getDramaImportableProjects(projects).map((project) => project.id)).toEqual(["active", "archived"]);
    });
});
