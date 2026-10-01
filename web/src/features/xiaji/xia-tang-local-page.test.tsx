// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getXiaTangEditorFields, XiaTangAssetTabs, XiaTangWorkspaceActions } from "./xia-tang-local-page";

describe("XiaTang local page navigation", () => {
    test("keeps the closed generic editor safe on the voice domain", () => {
        expect(getXiaTangEditorFields("entity", "voice")).toEqual([]);
    });

    test("renders the four source asset tabs as a peer tablist", () => {
        const html = renderToStaticMarkup(createElement(XiaTangAssetTabs, { active: "character", onChange: () => undefined }));

        expect(html).toContain("role=\"tablist\"");
        for (const label of ["角色", "场景", "道具", "声线"]) expect(html).toContain(label);
        expect(html).toContain("aria-selected=\"true\"");
    });

    test("keeps project navigation and asset creation without a redundant send-to-canvas action", () => {
        const html = renderToStaticMarkup(createElement(XiaTangWorkspaceActions, {
            projectAssetId: "project-1",
            activeDomain: "character",
            busy: false,
            onNavigate: () => undefined,
            onRefresh: () => undefined,
            onAdd: () => undefined,
        }));

        expect(html).toContain("返回项目");
        expect(html).toContain("新增角色");
        expect(html).not.toContain("发送到虾画");
    });
});
