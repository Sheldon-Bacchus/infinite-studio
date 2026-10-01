// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { getStudioWorkflowNavigation, localStudioRoutes } from "./local-studio-routes";

describe("LocalStudio route builders", () => {
    test("encodes stable project and episode asset IDs in canonical routes", () => {
        expect(localStudioRoutes.project("project / 一")).toBe("/xiaji/project/project%20%2F%20%E4%B8%80/episodes");
        expect(localStudioRoutes.script("p 1", "e/2")).toBe("/xiaji/project/p%201/episodes/by-id/e%2F2/script");
        expect(localStudioRoutes.beats("p 1", "e/2", "video")).toBe("/xiaji/project/p%201/episodes/by-id/e%2F2/beats?sub=video");
        expect(localStudioRoutes.beats("p 1", "e/2", "text", "beat 3")).toBe("/xiaji/project/p%201/episodes/by-id/e%2F2/beats?sub=text&beatAssetId=beat%203");
    });

    test("shows the supported workflow entries and omits the removed XiaMian module", () => {
        const withoutProject = getStudioWorkflowNavigation();
        const withProject = getStudioWorkflowNavigation("project / 一");

        expect(withoutProject.map(({ label }) => label)).toEqual(["虾料", "虾塘", "虾镜"]);
        expect(withProject.map(({ label }) => label)).toEqual(["虾料", "虾塘", "虾镜"]);
    });
});
