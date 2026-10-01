// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as listModule from "./canvas-conflict-draft-list";

describe("CanvasConflictDraftList", () => {
    it("keeps a deleted canvas's recovery draft reachable from the canvas library", () => {
        const DraftList = (listModule as Record<string, unknown>).CanvasConflictDraftList as (props: {
            drafts: Array<{ draftId: string; savedAt: string; project: { id: string; title: string } }>;
            recoveringDraftId?: string | null;
            onRecover?: (draftId: string) => void;
        }) => unknown;
        expect(typeof DraftList).toBe("function");

        const markup = renderToStaticMarkup(
            createElement(DraftList as never, {
                drafts: [{ draftId: "deleted-canvas-draft", savedAt: "2026-09-29T10:00:00.000Z", project: { id: "deleted-canvas", title: "已删除原项目的编辑" } }],
                onRecover: () => undefined,
            }),
        );

        expect(markup).toContain('data-canvas-id="deleted-canvas"');
        expect(markup).toContain("已删除原项目的编辑");
        expect(markup).toContain("恢复为新画布");
    });
});
