// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { normalizeDramaProjectSummaries } from "@/services/api/drama-import";
import { XiaTangProjectsView, xiaTangProjectPath } from "./xiaji-projects-page";

const projects = normalizeDramaProjectSummaries([
    { id: "rainy-night", name: "雨夜车站", status: "active", effective_role: "owner", episode_count: 2, beat_count: 9 },
    { id: "old-cut", name: "旧版剪辑", status: "archived", effective_role: "owner", episode_count: 1, beat_count: 3 },
    { id: "trash", name: "已删除项目", status: "deleted", effective_role: "owner" },
]);

function render(status: "active" | "archived" | "deleted") {
    return renderToStaticMarkup(createElement(XiaTangProjectsView, {
        projects,
        status,
        query: "",
        loading: false,
        error: "",
        onStatusChange: () => undefined,
        onQueryChange: () => undefined,
        onRefresh: () => undefined,
        onOpen: () => undefined,
        onSettings: () => undefined,
        onOpenEpisodes: () => undefined,
        onAction: () => undefined,
        onCreate: () => undefined,
    }));
}

describe("XiaTangProjectsView", () => {
    test("routes source project ids without colliding with the reserved legacy episodes route", () => {
        expect(xiaTangProjectPath("episodes")).toBe("/xiaji/project/episodes");
        expect(xiaTangProjectPath("雨夜 01")).toBe("/xiaji/project/%E9%9B%A8%E5%A4%9C%2001");
    });

    test("shows the selected active project with source episode and beat counts", () => {
        const html = render("active");
        expect(html).toContain("虾塘项目");
        expect(html).toContain('aria-label="打开旧版集数与分镜导入"');
        expect(html).toContain("雨夜车站");
        expect(html).toContain("2 集 · 9 个分镜");
        expect(html).toContain('aria-label="打开项目 雨夜车站"');
        expect(html).toContain('aria-label="编辑项目配置 雨夜车站"');
        expect(html).not.toContain("旧版剪辑");
    });

    test("shows archived projects as readable and deleted projects as non-openable", () => {
        const archived = render("archived");
        expect(archived).toContain("旧版剪辑");
        expect(archived).toContain('aria-label="打开项目 旧版剪辑"');

        const deleted = render("deleted");
        expect(deleted).toContain("已删除项目");
        expect(deleted).toContain('aria-label="项目 已删除项目 已删除"');
        expect(deleted).toContain("disabled=");
    });

    test("shows lifecycle actions disabled with a reason when the user is not project owner", () => {
        const viewerProjects = normalizeDramaProjectSummaries([
            { id: "shared", name: "只读项目", status: "deleted", effective_role: "viewer" },
        ]);
        const html = renderToStaticMarkup(createElement(XiaTangProjectsView, {
            projects: viewerProjects,
            status: "deleted",
            query: "",
            loading: false,
            error: "",
            onStatusChange: () => undefined,
            onQueryChange: () => undefined,
            onRefresh: () => undefined,
            onOpen: () => undefined,
            onSettings: () => undefined,
            onOpenEpisodes: () => undefined,
            onAction: () => undefined,
            onCreate: () => undefined,
        }));
        expect(html).toContain("永久删除");
        expect(html).toContain('title="只有项目所有者可以永久删除项目"');
        expect(html).toContain("当前权限不能管理此项目");
    });
});
