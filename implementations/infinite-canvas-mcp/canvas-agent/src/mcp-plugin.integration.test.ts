import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("Codex plugin runtime exposes generic local-asset import", { timeout: 45_000 }, async (t) => {
    const pluginConfigPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../plugins/infinite-canvas/.mcp.json");
    const pluginConfig = JSON.parse(fs.readFileSync(pluginConfigPath, "utf8")) as {
        mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };
    const server = Object.values(pluginConfig.mcpServers).find((entry) => entry.args.at(-1) === "mcp");
    assert.ok(server, "Codex plugin must configure an MCP server command");

    const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "infinite-studio-mcp-test-"));
    const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: {
            ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
            HOME: temporaryHome,
            USERPROFILE: temporaryHome,
            ...server.env,
        },
    });
    const client = new Client({ name: "infinite-studio-plugin-test", version: "1.0.0" });
    t.after(async () => {
        await client.close().catch(() => {});
        fs.rmSync(temporaryHome, { recursive: true, force: true });
    });

    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some(({ name }) => name === "assets_import_to_canvas"), "plugin must load the general asset-import tool from its configured runtime");
});
