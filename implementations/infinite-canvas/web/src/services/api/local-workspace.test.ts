// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { downloadLocalWorkspaceFile } from "./local-workspace";

describe("downloadLocalWorkspaceFile", () => {
    test("reads server-backed media through the shared file content route", async () => {
        let requested = "";
        const blob = new Blob(["shared media"], { type: "video/mp4" });
        const result = await downloadLocalWorkspaceFile("object/id", async (input) => {
            requested = String(input);
            return new Response(blob, { status: 200 });
        });

        expect(requested).toBe("/api/files/object%2Fid/content");
        expect(result.type).toBe("video/mp4");
        expect(await result.text()).toBe("shared media");
    });

    test("surfaces missing media instead of silently producing an incomplete archive", async () => {
        await expect(downloadLocalWorkspaceFile("missing", async () => new Response("", { status: 404 })))
            .rejects.toThrow("本地媒体读取失败：404");
    });
});
