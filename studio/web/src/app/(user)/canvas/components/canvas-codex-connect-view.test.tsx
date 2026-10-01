// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as connectViewModule from "./canvas-codex-connect-view";

describe("CanvasCodexConnectView", () => {
    it("keeps direct Agent Token connection available beside the Codex plugin path", () => {
        const ConnectView = (connectViewModule as Record<string, unknown>).CanvasCodexConnectView as (props: unknown) => unknown;
        const markup = renderToStaticMarkup(createElement(ConnectView as never, {
            agent: {
                connection: { endpoint: "http://127.0.0.1:3210", token: "" },
                status: "idle",
                error: "",
                connect: async () => true,
                disconnect: () => undefined,
            },
            onChat: () => undefined,
        }));

        expect(markup).toContain("方式一：在 Codex 中使用插件");
        expect(markup).toContain("方式二：直接运行 Agent");
        expect(markup).toContain('aria-label="本地 Agent 地址"');
        expect(markup).toContain('aria-label="连接 Token"');
    });
});
