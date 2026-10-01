// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as noticeModule from "./local-canvas-sync-notice";

describe("LocalCanvasSyncNotice", () => {
    it("shows save conflicts and renders nothing when there is no error", () => {
        const Notice = (noticeModule as Record<string, unknown>).LocalCanvasSyncNotice as (props: { message: string | null }) => unknown;

        expect(typeof Notice).toBe("function");
        const markup = renderToStaticMarkup(createElement(Notice as never, { message: "画布已在其他页面修改，请刷新后确认并重试" }));
        expect(markup).toContain('role="alert"');
        expect(markup).toContain("画布已在其他页面修改，请刷新后确认并重试");
        expect(renderToStaticMarkup(createElement(Notice as never, { message: null }))).toBe("");
    });

    it("offers an explicit new-project recovery after reloading a conflicted canvas", () => {
        const Notice = (noticeModule as Record<string, unknown>).LocalCanvasSyncNotice as (props: {
            message: string | null;
            draft?: { draftId: string; savedAt: string; project: { id: string; title: string } };
            onRecover?: (draftId: string) => void;
        }) => unknown;
        const markup = renderToStaticMarkup(
            createElement(Notice as never, {
                message: null,
                draft: {
                    draftId: "draft-1",
                    savedAt: "2026-09-29T10:00:00.000Z",
                    project: { id: "same-canvas", title: "未保存编辑" },
                },
                onRecover: () => undefined,
            }),
        );

        expect(markup).toContain("检测到未保存的冲突副本");
        expect(markup).toContain("恢复为新画布");
        expect(markup).toContain("未保存编辑");
    });
});
