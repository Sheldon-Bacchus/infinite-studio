import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

test("stdio MCP exposes explicit canvas selection, refreshes changed tools, and pins calls", { timeout: 30_000 }, async (t) => {
    let canvasTools = [
        { name: "get_canvas_summary", description: "summary", inputSchema: { type: "object" } },
        { name: "list_local_assets", description: "assets", inputSchema: { type: "object" } },
        { name: "update_text_node", description: "update text", inputSchema: { type: "object", properties: { nodeId: { type: "string" }, title: { type: "string" }, content: { type: "string" } }, required: ["nodeId"] } },
    ];
    let toolRegistryError = "";
    const calls = [];
    const connections = [
        { clientId: "client-target", canvasId: "SBlHyQQ7zOCh3YzS34Acf", connected: true, toolCount: 1 },
        { clientId: "client-other", canvasId: "zseKV2hzRtS1Gk22aBI2_", connected: true, toolCount: 1 },
    ];
    const server = createServer(async (req, res) => {
        const send = (status, value) => {
            res.writeHead(status, { "content-type": "application/json" });
            res.end(JSON.stringify(value));
        };
        if (req.headers["x-canvas-agent-token"] !== "mcp-session-test-token") return send(401, { error: "bad test token" });
        if (req.method === "GET" && req.url.startsWith("/connections")) return send(200, { connections });
        if (req.method === "GET" && req.url.startsWith("/tools")) {
            if (toolRegistryError) return send(503, { error: toolRegistryError });
            return send(200, new URL(req.url, "http://127.0.0.1").searchParams.get("clientId") ? canvasTools : []);
        }
        if (req.method === "POST" && req.url === "/tools/call") {
            let body = "";
            for await (const chunk of req) body += chunk;
            const call = JSON.parse(body);
            calls.push(call);
            return send(200, { ok: true, canvasId: connections.find(({ clientId }) => clientId === call.clientId)?.canvasId, name: call.name });
        }
        return send(404, { error: "unknown test endpoint" });
    });
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = server.address().port;
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [resolve(import.meta.dirname, "index.mjs"), "mcp"],
        env: {
            ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string")),
            CANVAS_AGENT_TOKEN: "mcp-session-test-token",
            CANVAS_AGENT_PORT: String(port),
            CANVAS_AGENT_SOURCE: "external",
            CANVAS_AGENT_CLIENT_ID: "",
        },
    });
    const client = new Client({ name: "canvas-agent-test", version: "1.0.0" });
    let notificationCount = 0;
    const notificationWaiters = [];
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        notificationCount += 1;
        for (const waiter of notificationWaiters.splice(0)) waiter();
    });
    t.after(async () => {
        await client.close().catch(() => {});
        await new Promise((resolveClose) => server.close(resolveClose));
    });
    await client.connect(transport);

    const firstList = await client.listTools();
    const firstToolNames = firstList.tools.map(({ name }) => name);
    assert.ok(firstToolNames.includes("list_connected_canvases"));
    assert.ok(firstToolNames.includes("select_canvas"));
    for (const name of ["get_canvas_summary", "list_local_assets", "bind_config_media", "update_text_node"]) {
        assert.ok(firstToolNames.includes(name), `static community tool ${name} should be available before selection`);
    }
    assert.deepEqual(firstList.tools.find(({ name }) => name === "update_text_node").inputSchema.required, ["nodeId"]);

    const listed = await client.callTool({ name: "list_connected_canvases", arguments: {} });
    assert.match(listed.content[0].text, /SBlHyQQ7zOCh3YzS34Acf/);
    assert.match(listed.content[0].text, /zseKV2hzRtS1Gk22aBI2_/);

    const selected = await client.callTool({ name: "select_canvas", arguments: { canvasId: "SBlHyQQ7zOCh3YzS34Acf" } });
    const selectedResult = JSON.parse(selected.content[0].text);
    assert.equal(selectedResult.selectedCanvasId, "SBlHyQQ7zOCh3YzS34Acf");
    assert.equal(selectedResult.toolRegistry.pageToolCount, 3);
    const selectedToolNames = (await client.listTools()).tools.map(({ name }) => name);
    assert.equal(new Set(selectedToolNames).size, selectedToolNames.length, "static and live tool lists must not duplicate names");
    assert.ok(selectedToolNames.includes("get_canvas_summary"));
    assert.ok(selectedToolNames.includes("list_local_assets"));
    assert.ok(!selectedToolNames.includes("import_local_assets"));
    await waitForNotifications(1);

    const updatedText = await client.callTool({ name: "update_text_node", arguments: { nodeId: "prompt-node", content: "revised H3 prompt" } });
    assert.match(updatedText.content[0].text, /update_text_node/);

    canvasTools = [...canvasTools, { name: "page_specific_action", description: "extra", inputSchema: { type: "object" } }];
    await waitForNotifications(2);
    assert.ok((await client.listTools()).tools.some(({ name }) => name === "page_specific_action"));

    const result = await client.callTool({ name: "list_local_assets", arguments: { page: 1 } });
    assert.match(result.content[0].text, /SBlHyQQ7zOCh3YzS34Acf/);
    assert.deepEqual(calls.map(({ clientId, name, arguments: args }) => ({ clientId, name, ...(args?.content === undefined ? {} : { content: args.content }) })), [
        { clientId: "client-target", name: "update_text_node", content: "revised H3 prompt" },
        { clientId: "client-target", name: "list_local_assets" },
    ]);

    toolRegistryError = "web tool registry unavailable";
    const failedToolCall = await client.callTool({ name: "get_canvas_summary", arguments: {} });
    assert.equal(failedToolCall.isError, true);
    assert.match(failedToolCall.content[0].text, /web tool registry unavailable/);
    const diagnostic = await client.callTool({ name: "list_connected_canvases", arguments: {} });
    assert.match(JSON.parse(diagnostic.content[0].text).toolRegistry.error, /web tool registry unavailable/);

    async function waitForNotifications(target) {
        const deadline = Date.now() + 5_000;
        while (notificationCount < target && Date.now() < deadline) {
            await Promise.race([
                new Promise((resolveWait) => notificationWaiters.push(resolveWait)),
                delay(100),
            ]);
        }
        assert.ok(notificationCount >= target, `expected ${target} tool-list notifications, received ${notificationCount}`);
    }
});

test("an unreachable Agent returns a diagnostic naming its HTTP endpoint", { timeout: 15_000 }, async (t) => {
    const reservation = createNetServer();
    await new Promise((resolveListen) => reservation.listen(0, "127.0.0.1", resolveListen));
    const port = reservation.address().port;
    await new Promise((resolveClose) => reservation.close(resolveClose));
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [resolve(import.meta.dirname, "index.mjs"), "mcp"],
        env: {
            ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string")),
            CANVAS_AGENT_TOKEN: "mcp-session-test-token",
            CANVAS_AGENT_PORT: String(port),
            CANVAS_AGENT_SOURCE: "external",
            CANVAS_AGENT_CLIENT_ID: "",
        },
    });
    const client = new Client({ name: "canvas-agent-unreachable-test", version: "1.0.0" });
    t.after(async () => {
        await client.close().catch(() => {});
    });
    await client.connect(transport);

    const result = await client.callTool({ name: "list_connected_canvases", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, new RegExp(`Canvas Agent.*http://127\\.0\\.0\\.1:${port}/connections`));
    assert.doesNotMatch(result.content[0].text, /mcp-session-test-token/);
});
