// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { resolvePostLoginRedirect } from "./login-redirect";

describe("post-login redirect", () => {
    test("preserves a protected Xiaji destination for regular users", () => {
        expect(resolvePostLoginRedirect("/xiaji", "user")).toBe("/xiaji");
    });

    test("keeps admin paths restricted to administrators", () => {
        expect(resolvePostLoginRedirect("/admin/users", "user")).toBe("/");
        expect(resolvePostLoginRedirect("/admin/users", "admin")).toBe("/admin/users");
    });
});
