// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { DramaAssetCatalog, DramaImportAsset, DramaImportCatalog } from "@/services/api/drama-import";
import { dramaAssetSelectionKey } from "./asset-card";
import { WorkbenchView, type WorkbenchActions } from "./workbench-view";

const catalog: DramaImportCatalog = {
    sourceSnapshot: { projectId: "demo", revision: "rev-1" },
    project: { id: "demo", title: "雨夜项目" },
    episodes: [{ number: 1, title: "初遇", summary: "雨夜车站", beatCount: 1, identityIds: [], sceneIds: [], propIds: [], beats: [{ episode: 1, beatNumber: 1, title: "车站", content: "相遇", prompt: "", visualDescription: "", identityIds: [], propIds: [], sketchUrl: "", frameUrl: "", videoUrl: "", audioUrl: "", audioDurationSeconds: 0 }] }],
    assets: [],
    beatContextAssets: [],
    warnings: ["读取虾集分镜素材上下文失败"],
};

const assets: DramaImportAsset[] = [
    { id: "character", tab: "characters", kind: "portrait", role: "character_portrait", label: "林雨", mediaType: "image", exists: true, url: "/portrait.png", meta: { character: "林雨" } },
    { id: "scene", tab: "scenes", kind: "scene", role: "scene_master", label: "车站", mediaType: "image", exists: true, url: "/scene.png", meta: { scene_id: "车站" } },
    { id: "prop", tab: "props", kind: "prop", role: "prop_reference", label: "红伞", mediaType: "image", exists: true, url: "/prop.png", meta: { prop_id: "红伞" } },
    { id: "voice", tab: "characters", kind: "audio", role: "character_voice", label: "默认声线", mediaType: "audio", exists: true, url: "/voice.wav", meta: { character: "林雨" } },
];

const actions: WorkbenchActions = {
    onViewChange: () => undefined,
    onAdd: () => undefined,
    onPreviewAsset: () => undefined,
    onSendAsset: () => undefined,
    onSelectEpisode: () => undefined,
    onSelectBeat: () => undefined,
    onSendEpisode: () => undefined,
    onSendBeat: () => undefined,
};

const state = { view: "library" as const, category: "all", mediaType: "all" as const, tag: "all", query: "" };

describe("WorkbenchView", () => {
    test("shows explicit multi-select controls only when the caller enables a batch import", () => {
        const html = renderToStaticMarkup(createElement(WorkbenchView, {
            catalog,
            assets,
            state: { ...state, category: "characters" },
            tags: [],
            categories: ["characters", "scenes", "props", "voices", "beats"],
            selectionMode: true,
            selectedAssetKeys: new Set([dramaAssetSelectionKey(assets[0])]),
            onToggleAssetSelection: () => undefined,
            showAdd: false,
            showSourceBrowser: false,
            loading: false,
            error: "",
            actions,
        }));

        expect(html).toContain('aria-label="选择素材加入批次：林雨"');
        expect(html).toContain('aria-pressed="true"');
        expect(html).toContain("发送到虾画");
    });

    test("renders all DramaClaw asset categories, episode and beat browsers, warnings, and canvas actions", () => {
        const html = renderToStaticMarkup(createElement(WorkbenchView, {
            catalog,
            assets,
            state,
            tags: ["雨夜"],
            categories: ["characters", "scenes", "props", "voices", "beats"],
            selectedEpisode: 1,
            selectedBeat: 1,
            loading: false,
            error: "",
            actions,
        }));

        expect(html).toContain("我的素材");
        expect(html).toContain("素材库");
        expect(html).toContain("林雨");
        expect(html).toContain("车站");
        expect(html).toContain("红伞");
        expect(html).toContain("默认声线");
        expect(html).toContain("初遇");
        expect(html).toContain("相遇");
        expect(html).toContain("读取虾集分镜素材上下文失败");
        expect(html).toContain("发送到虾画");
    });

    test("shows a useful empty state when the active asset view has no items", () => {
        const html = renderToStaticMarkup(createElement(WorkbenchView, {
            catalog: null,
            assets: [],
            state: { ...state, view: "mine" },
            tags: [],
            categories: [],
            loading: false,
            error: "",
            actions,
        }));

        expect(html).toContain("暂无素材");
        expect(html).toContain("添加");
    });

    test("does not offer local asset creation while viewing the DramaClaw library", () => {
        const html = renderToStaticMarkup(createElement(WorkbenchView, {
            catalog,
            assets,
            state,
            tags: [],
            categories: [],
            showAdd: false,
            loading: false,
            error: "",
            actions,
        }));

        expect(html).not.toContain("添加</button>");
    });

    test("can embed the DramaClaw library in the current-canvas picker without switching to local assets", () => {
        const html = renderToStaticMarkup(createElement(WorkbenchView, {
            catalog,
            assets,
            state,
            tags: [],
            categories: ["characters", "scenes", "props", "voices", "beats"],
            showAdd: false,
            showSourceBrowser: false,
            showAssetViews: false,
            loading: false,
            error: "",
            actions,
        }));

        expect(html).not.toContain('role="tab"');
        expect(html).toContain("林雨");
        expect(html).not.toContain("集数");
    });

    test("renders a project asset catalog without episode or beat import controls", () => {
        const assetCatalog: DramaAssetCatalog = {
            sourceSnapshot: { projectId: "demo", revision: "assets-rev-1" },
            project: { id: "demo", title: "雨夜项目" },
            assets,
            warnings: [],
        };
        const html = renderToStaticMarkup(createElement(WorkbenchView, {
            catalog: assetCatalog,
            assets,
            state,
            tags: [],
            categories: ["characters", "scenes", "props", "voices", "beats"],
            showSourceBrowser: false,
            loading: false,
            error: "",
            actions,
        }));

        expect(html).toContain("默认声线");
        expect(html).not.toContain("初遇");
        expect(html).not.toContain("集数");
        expect(html).not.toContain("beat-browser");
    });
});
