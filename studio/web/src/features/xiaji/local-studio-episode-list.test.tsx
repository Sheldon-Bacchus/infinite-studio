// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Asset } from "@/stores/use-asset-store";
import { LocalStudioEpisodeList } from "./local-studio-episode-list";

const episodes: Asset[] = [
    { id: "episode-1", kind: "text", title: "第一集", coverUrl: "", tags: [], category: "xiaji:episode", source: "test", data: { content: "开场相遇" }, metadata: { localStudio: { schemaVersion: 1, recordType: "episode", projectAssetId: "project-1", order: 1, sourceEpisodeNumber: 4, title: "第一集", synopsis: "开场相遇" } }, createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z" },
    { id: "episode-2", kind: "text", title: "第二集", coverUrl: "", tags: [], category: "xiaji:episode", source: "test", data: { content: "再次相遇" }, metadata: { localStudio: { schemaVersion: 1, recordType: "episode", projectAssetId: "project-1", order: 2, sourceEpisodeNumber: 9, title: "第二集", synopsis: "再次相遇" } }, createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z" },
];

describe("LocalStudioEpisodeList", () => {
    test("shows source-style episode cards, script status, local planning counts, and a detail entry", () => {
        const html = renderToStaticMarkup(createElement(LocalStudioEpisodeList, {
            episodes,
            beatCounts: { "episode-1": 2, "episode-2": 1 },
            episodeStats: {
                "episode-1": { sourceTextLineCount: 2, scriptLineCount: 3, beatCount: 2, identityCount: 1, sceneCount: 1, propCount: 1, scriptReady: true },
                "episode-2": { sourceTextLineCount: 1, scriptLineCount: 0, beatCount: 1, identityCount: 0, sceneCount: 0, propCount: 0, scriptReady: false },
            },
            editingEpisodeId: null,
            saving: false,
            onEdit: () => undefined,
            onCancelEdit: () => undefined,
            onSave: () => undefined,
            onMove: () => undefined,
        }));

        expect(html).toContain("查看详情");
        expect(html).toContain("2 行文本");
        expect(html).toContain("3 行剧本");
        expect(html).toContain("1 个身份");
        expect(html).toContain("1 个场景");
        expect(html).toContain("1 个道具");
        expect(html).toContain("剧本已保存");
        expect(html).toContain("待写剧本");
    });

    test("shows episode editing and ordering controls while preserving source order labels", () => {
        const html = renderToStaticMarkup(createElement(LocalStudioEpisodeList, {
            episodes,
            beatCounts: { "episode-1": 2, "episode-2": 1 },
            editingEpisodeId: "episode-1",
            saving: false,
            onEdit: () => undefined,
            onCancelEdit: () => undefined,
            onSave: () => undefined,
            onMove: () => undefined,
        }));

        expect(html).toContain("第 1 集");
        expect(html).toContain("来源第 4 集");
        expect(html).toContain("来源第 9 集");
        expect(html).toContain('aria-label="编辑第一集"');
        expect(html).toContain('aria-label="上移第一集"');
        expect(html).toContain('aria-label="下移第二集"');
        expect(html).toContain('aria-label="分集标题"');
        expect(html).toContain('aria-label="分集梗概"');
        expect(html).toContain("2 个镜头");
    });
});
