// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Asset } from "@/stores/use-asset-store";
import { LocalAssetWorkbench } from "./local-asset-workbench";
import type { XiaJiAssetViewState } from "./components/asset-tabs";

const state: XiaJiAssetViewState = { view: "mine", category: "all", mediaType: "all", tag: "all", query: "" };
const assets: Asset[] = [
    { id: "text-1", kind: "text", title: "雨夜车站", coverUrl: "", tags: ["雨夜"], category: "场景", source: "手动添加", createdAt: "", updatedAt: "", data: { content: "末班车进站" } },
];

function render(overrides: Partial<React.ComponentProps<typeof LocalAssetWorkbench>> = {}) {
    return renderToStaticMarkup(createElement(LocalAssetWorkbench, {
        assets,
        state,
        selectedAssetIds: new Set<string>(),
        selectionMode: false,
        loading: false,
        error: "",
        onStateChange: () => undefined,
        onAdd: () => undefined,
        onPreview: () => undefined,
        onSend: () => undefined,
        onToggleSelection: () => undefined,
        ...overrides,
    }));
}

describe("LocalAssetWorkbench", () => {
    test("reuses the XiaTang tabs and shows local assets with the send action", () => {
        const html = render();

        expect(html).toContain("我的素材");
        expect(html).toContain("素材库");
        expect(html).toContain("全部");
        expect(html).toContain("文本");
        expect(html).toContain("场景");
        expect(html).toContain("雨夜车站");
        expect(html).toContain("发送到虾画");
        expect(html).toContain("搜索素材");
    });

    test("shows loading separately from a truly empty local asset list", () => {
        expect(render({ assets: [], loading: true })).toContain("正在读取本地素材");
        expect(render({ assets: [], loading: false })).toContain("暂无素材");
    });

    test("uses a batch selection action in the canvas picker", () => {
        expect(render({ selectionMode: true })).toContain("选择素材");
    });
});
