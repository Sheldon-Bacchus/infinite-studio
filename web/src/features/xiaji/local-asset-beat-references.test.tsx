// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Asset } from "@/stores/use-asset-store";
import { LocalAssetBeatReferences } from "./local-asset-beat-references";

const assets: Asset[] = [
    { id: "episode-1", kind: "text", title: "第一集", coverUrl: "", tags: [], category: "xiaji:episode", source: "test", data: { content: "" }, metadata: { localStudio: { schemaVersion: 1, recordType: "episode", projectAssetId: "project-1", order: 1, title: "第一集" } }, createdAt: "now", updatedAt: "now" },
    { id: "beat-1", kind: "text", title: "车站初遇", coverUrl: "", tags: [], category: "xiaji:beat", source: "test", data: { content: "雨夜相遇" }, metadata: { localStudio: { schemaVersion: 1, recordType: "beat", projectAssetId: "project-1", episodeAssetId: "episode-1", order: 2, referencedAssetIds: ["character-1"] } }, createdAt: "now", updatedAt: "now" },
];

describe("LocalAssetBeatReferences", () => {
    test("shows locally stored episode and Beat references with stable deep links", () => {
        const html = renderToStaticMarkup(createElement(LocalAssetBeatReferences, { assets, assetId: "character-1", initialExpanded: true }));

        expect(html).toContain("出现于镜头");
        expect(html).toContain("第 1 集 · 镜头 2 · 车站初遇");
        expect(html).toContain('href="/xiaji/project/project-1/episodes/by-id/episode-1/beats?sub=text&amp;beatAssetId=beat-1"');
    });

    test("shows an explicit empty state when the asset has no local Beat references", () => {
        const html = renderToStaticMarkup(createElement(LocalAssetBeatReferences, { assets, assetId: "not-used", initialExpanded: true }));
        expect(html).toContain("暂无关联镜头");
    });
});
