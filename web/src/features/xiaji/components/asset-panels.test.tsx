// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { DramaImportAsset } from "@/services/api/drama-import";
import { AssetTabs } from "./asset-tabs";
import { AssetCard } from "./asset-card";
import { CharacterAssetsPanel } from "./character-assets-panel";
import { PropsPanel } from "./props-panel";
import { ScenesPanel } from "./scenes-panel";
import { VoicesPanel } from "./voices-panel";

const assets: DramaImportAsset[] = [
    { id: "character", tab: "characters", kind: "portrait", role: "character_portrait", label: "林雨 / 肖像", mediaType: "image", exists: true, url: "/portrait.png", meta: { character: "林雨" } },
    { id: "scene", tab: "scenes", kind: "scene", role: "scene_master", label: "车站 / 主场景", mediaType: "image", exists: true, url: "/scene.png", meta: { scene_id: "车站" } },
    { id: "prop", tab: "props", kind: "prop", role: "prop_reference", label: "红伞", mediaType: "image", exists: true, url: "/prop.png", meta: { prop_id: "红伞" } },
    { id: "voice", tab: "characters", kind: "audio", role: "character_voice", label: "林雨 / 默认声线", mediaType: "audio", exists: true, url: "/voice.wav", meta: { character: "林雨" } },
];

describe("DramaClaw asset panel adapters", () => {
    test("shows full-page asset views, media filters, categories, tags, search, and add action", () => {
        const html = renderToStaticMarkup(createElement(AssetTabs, {
            state: { view: "library", category: "all", mediaType: "all", tag: "all", query: "" },
            tags: ["雨夜"],
            onChange: () => undefined,
            onAdd: () => undefined,
        }));

        expect(html).toContain("我的素材");
        expect(html).toContain("素材库");
        expect(html).toContain("全部");
        expect(html).toContain("视频");
        expect(html).toContain("分类");
        expect(html).toContain("标签");
        expect(html).toContain("搜索素材");
        expect(html).toContain("添加");
    });

    test("renders character, scene, prop, and voice groups with send-to-canvas actions", () => {
        const render = (Component: ComponentType<{ assets: DramaImportAsset[]; onPreview: (asset: DramaImportAsset) => void; onSend: (asset: DramaImportAsset) => void }>, selected: DramaImportAsset[]) =>
            renderToStaticMarkup(createElement(Component, { assets: selected, onPreview: () => undefined, onSend: () => undefined }));
        const html = [
            render(CharacterAssetsPanel, [assets[0]]),
            render(ScenesPanel, [assets[1]]),
            render(PropsPanel, [assets[2]]),
            render(VoicesPanel, [assets[3]]),
        ].join("");

        expect(html).toContain("林雨");
        expect(html).toContain("车站");
        expect(html).toContain("红伞");
        expect(html).toContain("默认声线");
        expect(html.match(/发送到虾画/g)?.length).toBe(4);
    });

    test("does not offer to send unsupported 3D scene media into a canvas node", () => {
        const asset = { ...assets[1], id: "world", role: "scene_3gs_master_ply", label: "旅馆3D世界", mediaType: "3d", url: "/world.ply" };
        const html = renderToStaticMarkup(createElement(AssetCard, { asset, onPreview: () => undefined, onSend: () => undefined, onToggleSelection: () => undefined }));
        expect(html).toContain('aria-label="选择素材加入批次：旅馆3D世界"');
        expect(html).toContain('aria-label="虾画不支持该素材类型：旅馆3D世界"');
        expect(html).toContain("disabled=\"\"");
    });
});
