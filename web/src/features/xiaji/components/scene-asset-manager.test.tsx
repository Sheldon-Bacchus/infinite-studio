// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SceneAssetManagerView, type SceneAssetManagerViewProps } from "./scene-asset-manager";

const scene = {
    name: "旧车站",
    scene_type: "interior",
    base_scene_id: "city_station",
    variant_id: "rain",
    time_of_day: "night",
    environment_prompt: "潮湿的站台",
    variant_prompt: "灯光反射在积水上",
    description: "主角与线人见面的地方",
    notes: "保留旧时钟",
    master_url: "/media/master.png",
    pano_url: "/media/pano.jpg",
    custom_scene_url: "/media/station.ply",
};

function render(overrides: Partial<SceneAssetManagerViewProps> = {}) {
    const props: SceneAssetManagerViewProps = {
        scenes: [scene],
        selectedName: "旧车站",
        detail: scene,
        platePreview: {
            scene_id: "city_station",
            variant_id: "rain",
            time_of_day: "night",
            resolved_scene_name: "旧车站",
            planned_scene_name: "",
            time_baked: true,
            render: { resolved_scene_name: "旧车站", planned_scene_name: "", relight: false, status: "time_baked", label: "使用夜景母版" },
            seedance2: { resolved_scene_name: "旧车站", prompt_time_of_day: "night", label: "时间：night" },
        },
        plateImageUrl: "/media/master.png",
        loading: false,
        detailLoading: false,
        error: "",
        buildTask: null,
        buildTaskRefreshing: false,
        generationTasks: {},
        generationTaskRefreshing: {},
        generationTaskMessages: {},
        busy: false,
        onRetry: () => undefined,
        onSelect: () => undefined,
        onBuild: () => undefined,
        onRefreshBuildTask: () => undefined,
        onGenerate: () => undefined,
        onRefreshTask: () => undefined,
        onUpload: () => undefined,
        onDeleteFile: () => undefined,
        onCreate: () => undefined,
        onEdit: () => undefined,
        onDeleteScene: () => undefined,
        ...overrides,
    };
    return renderToStaticMarkup(createElement(SceneAssetManagerView, props));
}

describe("DramaClaw scene asset manager", () => {
    test("lists source variant fields and exposes full scene details", () => {
        const html = render();
        for (const field of ["旧车站", "interior", "city_station", "rain", "night", "潮湿的站台", "灯光反射在积水上", "主角与线人见面的地方", "保留旧时钟"]) {
            expect(html).toContain(field);
        }
        expect(html).toContain("变体 ID");
        expect(html).toContain("所属基础场景");
        expect(html).toContain("时间段");
    });

    test("previews the resolved master and the selected pano, with available file actions", () => {
        const html = render();
        expect(html).toContain('src="/media/master.png"');
        expect(html).toContain('src="/media/pano.jpg"');
        expect(html).toContain("time_baked");
        expect(html).toContain("上传 master");
        expect(html).toContain("上传 pano");
        expect(html).toContain("上传 custom 3D 文件");
        expect(html).toContain("删除 master");
        expect(html).toContain("删除 pano");
        expect(html).toContain("删除 custom");
    });

    test("shows actual source task fields and a manual refresh action without inventing status", () => {
        const started = render({ buildTask: { task_type: "build_scenes", task_id: "source-17" } });
        expect(started).toContain("source-17");
        expect(started).toContain("build_scenes");
        expect(started).toContain("等待从虾集读取任务状态");
        expect(started).toContain("刷新任务状态");

        const running = render({ buildTask: { task_type: "build_scenes", task_id: "source-17", status: "running", progress: 0.25 } });
        expect(running).toContain("running");
        expect(running).toContain("25%");
    });

    test("offers the source-backed master, reverse, pano and 3GS generation operations", () => {
        const html = render();
        for (const label of ["生成 master 母版", "生成 reverse 母版", "从 master 生成 pano", "从文本生成 pano", "生成 3GS（master）", "生成 3GS（reverse）", "生成 3GS（pano）"]) {
            expect(html).toContain(label);
        }
        expect(html).not.toContain("尚未代理 DramaClaw");
        expect(html).toContain("导演世界暂不可用");
    });

    test("shows raw source operation task identity and a refresh control", () => {
        const html = render({
            generationTasks: {
                master: { task_type: "scene_reference_asset", task_id: "master-source-1", status: "running", progress: 0.35, current_task: "渲染场景参考图" },
                "3gs-pano": { task_type: "stage_asset", task_id: "pano-source-2", status: "completed", progress: 1 },
            },
            generationTaskRefreshing: {},
            generationTaskMessages: {},
            onGenerate: () => undefined,
            onRefreshTask: () => undefined,
        } as unknown as Partial<SceneAssetManagerViewProps>);
        for (const value of ["master-source-1", "scene_reference_asset", "渲染场景参考图", "35%", "pano-source-2", "stage_asset", "completed", "刷新 master 任务状态", "刷新 3GS（pano） 任务状态"]) {
            expect(html).toContain(value);
        }
    });

    test("renders list loading and retryable failure states", () => {
        expect(render({ loading: true })).toContain("正在读取 DramaClaw 场景");
        const failed = render({ error: "上游不可用" });
        expect(failed).toContain("上游不可用");
        expect(failed).toContain("重试");
    });
});
