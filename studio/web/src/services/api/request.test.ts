// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { ApiRequestError, isAuthenticationFailure } from "./request";

describe("API authentication error classification", () => {
    test("clears a session only for explicit unauthorized responses", () => {
        expect(isAuthenticationFailure(new ApiRequestError("未登录", 401))).toBe(true);
        expect(isAuthenticationFailure(new ApiRequestError("权限不足", 403))).toBe(true);
        expect(isAuthenticationFailure(new ApiRequestError("服务不可用", 503))).toBe(false);
        expect(isAuthenticationFailure(new ApiRequestError("接口连接失败", null))).toBe(false);
        expect(isAuthenticationFailure(new Error("unknown failure"))).toBe(false);
    });
});
