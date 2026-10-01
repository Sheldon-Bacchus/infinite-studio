import assert from "node:assert/strict";
import test from "node:test";

let mcpSession;
try { mcpSession = await import("./mcp-session.mjs"); } catch { /* RED: implementation is not present yet */ }

function implementation(name) {
    const value = mcpSession?.[name];
    assert.equal(typeof value, "function", `${name} is not implemented yet`);
    return value;
}

test("connected canvas list exposes live IDs and the MCP-selected connection", () => {
    const listConnectedCanvases = implementation("listConnectedCanvases");
    const sessions = new Map([
        ["client-a", { clientId: "client-a", canvasId: "canvas-a", events: {}, tools: [{ name: "read" }] }],
        ["client-b", { clientId: "client-b", canvasId: "canvas-b", events: {}, tools: [] }],
        ["client-c", { clientId: "client-c", canvasId: "canvas-c", tools: [{ name: "stale" }] }],
    ]);

    assert.deepEqual(listConnectedCanvases(sessions, "client-b"), [
        { clientId: "client-a", canvasId: "canvas-a", connected: true, selected: false, toolCount: 1 },
        { clientId: "client-b", canvasId: "canvas-b", connected: true, selected: true, toolCount: 0 },
    ]);
});

test("connected canvas list preserves counts from the authenticated bridge response", () => {
    const listConnectedCanvases = implementation("listConnectedCanvases");
    assert.deepEqual(listConnectedCanvases([
        { clientId: "client-a", canvasId: "canvas-a", connected: true, toolCount: 28 },
    ], "client-a"), [
        { clientId: "client-a", canvasId: "canvas-a", connected: true, selected: true, toolCount: 28 },
    ]);
});

test("canvas selection requires an exact ID and refuses duplicate live tabs", () => {
    const resolveCanvasSelection = implementation("resolveCanvasSelection");
    const first = { clientId: "client-a", canvasId: "canvas-a", events: {}, tools: [] };
    const duplicate = { clientId: "client-b", canvasId: "canvas-a", events: {}, tools: [] };
    const other = { clientId: "client-c", canvasId: "canvas-c", events: {}, tools: [] };
    const sessions = new Map([[first.clientId, first], [duplicate.clientId, duplicate], [other.clientId, other]]);

    assert.throws(() => resolveCanvasSelection(sessions, { canvasId: "canvas-a" }), /多个连接/);
    assert.equal(resolveCanvasSelection(sessions, { canvasId: "canvas-a", clientId: "client-b" }), duplicate);
    assert.throws(() => resolveCanvasSelection(sessions, { canvasId: "missing" }), /未连接/);
    assert.throws(() => resolveCanvasSelection(sessions, { canvasId: "canvas-c", clientId: "client-a" }), /不匹配/);
});

test("a Codex-pinned canvas connection cannot be redirected to another canvas", () => {
    const resolveCanvasSelection = implementation("resolveCanvasSelection");
    const pinned = { clientId: "client-a", canvasId: "canvas-a", events: {}, tools: [] };
    const other = { clientId: "client-b", canvasId: "canvas-b", events: {}, tools: [] };
    const sessions = new Map([[pinned.clientId, pinned], [other.clientId, other]]);

    assert.equal(resolveCanvasSelection(sessions, { canvasId: "canvas-a", pinnedClientId: "client-a" }), pinned);
    assert.throws(() => resolveCanvasSelection(sessions, { canvasId: "canvas-b", pinnedClientId: "client-a" }), /固定/);
});

test("MCP tool-list notifications fire once per actual schema change", async () => {
    const createToolSchemaWatcher = implementation("createToolSchemaWatcher");
    let tools = [{ name: "get_canvas_summary", inputSchema: { type: "object" } }];
    let notificationCount = 0;
    const watcher = createToolSchemaWatcher({ getTools: async () => tools, notify: async () => { notificationCount += 1; } });

    await watcher.refresh();
    await watcher.refresh();
    assert.equal(notificationCount, 0);
    tools = [...tools, { name: "list_local_assets", inputSchema: { type: "object", properties: { page: { type: "number" } } } }];
    await watcher.refresh();
    await watcher.refresh();
    assert.equal(notificationCount, 1);
});

test("a failed tool-list notification stays visible and is retried until delivered", async () => {
    const createToolSchemaWatcher = implementation("createToolSchemaWatcher");
    let tools = [{ name: "page_action" }];
    let shouldFail = false;
    let notificationCount = 0;
    const watcher = createToolSchemaWatcher({
        getTools: async () => tools,
        notify: async () => {
            notificationCount += 1;
            if (shouldFail) throw new Error("client notification failed");
        },
    });

    await watcher.refresh();
    tools = [...tools, { name: "new_page_action" }];
    shouldFail = true;
    await assert.rejects(watcher.refresh(), /client notification failed/);
    shouldFail = false;
    assert.equal(await watcher.refresh(), true);
    assert.equal(notificationCount, 2);
});

test("canvas selection management tools are always available before a canvas is selected", () => {
    const tools = mcpSession?.CANVAS_SELECTION_TOOLS;
    assert.ok(Array.isArray(tools), "CANVAS_SELECTION_TOOLS is not implemented yet");
    assert.deepEqual(tools.map(({ name }) => name), ["list_connected_canvases", "select_canvas"]);
    assert.ok(tools.find(({ name }) => name === "select_canvas").inputSchema.required.includes("canvasId"));
});

test("canvas tools are advertised only from the selected live page", async () => {
    const createCanvasMcpController = implementation("createCanvasMcpController");
    const connections = [{ clientId: "client-a", canvasId: "canvas-a", connected: true, toolCount: 1 }];
    const pageTools = [
        { name: "get_canvas_summary", inputSchema: { type: "object" } },
        { name: "list_local_assets", inputSchema: { type: "object", properties: { page: { type: "number" } } } },
    ];
    const controller = createCanvasMcpController({
        getConnections: async () => connections,
        getTools: async () => pageTools,
        callCanvasTool: async () => ({ ok: true }),
        notifyToolsChanged: async () => {},
    });

    assert.deepEqual((await controller.listTools()).map(({ name }) => name), ["list_connected_canvases", "select_canvas"]);
    await controller.refreshTools();
    assert.deepEqual((await controller.listTools()).map(({ name }) => name), ["list_connected_canvases", "select_canvas"]);
    await controller.call("select_canvas", { canvasId: "canvas-a" });
    assert.deepEqual((await controller.listTools()).map(({ name }) => name), ["list_connected_canvases", "select_canvas", "get_canvas_summary", "list_local_assets"]);
});

test("static tools stay listed before selection and merge with live page tools by name", async () => {
    const createCanvasMcpController = implementation("createCanvasMcpController");
    const staticTools = [
        { name: "list_local_assets", description: "stable declaration", inputSchema: { type: "object" } },
    ];
    const pageTools = [
        { name: "list_local_assets", description: "live declaration", inputSchema: { type: "object", properties: { page: { type: "integer" } } } },
        { name: "get_canvas_summary", inputSchema: { type: "object" } },
    ];
    const routedCalls = [];
    const controller = createCanvasMcpController({
        getConnections: async () => [{ clientId: "client-a", canvasId: "canvas-a", connected: true }],
        getTools: async () => pageTools,
        callCanvasTool: async (call) => { routedCalls.push(call); return { ok: true }; },
        notifyToolsChanged: async () => {},
        staticTools,
    });

    const initial = await controller.listTools();
    assert.deepEqual(initial.map(({ name }) => name), ["list_connected_canvases", "select_canvas", "list_local_assets"]);
    await assert.rejects(controller.call("list_local_assets", {}), /尚未锁定目标画布/);
    await controller.call("select_canvas", { canvasId: "canvas-a" });
    const selected = await controller.listTools();
    assert.deepEqual(selected.map(({ name }) => name), ["list_connected_canvases", "select_canvas", "list_local_assets", "get_canvas_summary"]);
    assert.equal(selected.find(({ name }) => name === "list_local_assets").description, "live declaration");
    await controller.call("list_local_assets", { page: 1 });
    assert.deepEqual(routedCalls, [{ clientId: "client-a", name: "list_local_assets", arguments: { page: 1 } }]);
});

test("MCP controller exposes diagnostics first, then routes actions only to the exact selected canvas", async () => {
    const createCanvasMcpController = implementation("createCanvasMcpController");
    const connections = [
        { clientId: "client-a", canvasId: "canvas-a", connected: true, toolCount: 2 },
        { clientId: "client-b", canvasId: "canvas-b", connected: true, toolCount: 2 },
    ];
    const toolsByClientId = new Map(connections.map(({ clientId }) => [clientId, [
        { name: "get_canvas_summary", inputSchema: { type: "object" } },
        { name: "list_local_assets", inputSchema: { type: "object" } },
        { name: "page_specific_action", inputSchema: { type: "object" } },
    ]]));
    const routedCalls = [];
    const notifications = [];
    const controller = createCanvasMcpController({
        getConnections: async () => connections,
        getTools: async (clientId) => toolsByClientId.get(clientId) || [],
        callCanvasTool: async (call) => { routedCalls.push(call); return { ok: true, canvasId: call.clientId }; },
        notifyToolsChanged: async () => { notifications.push("changed"); },
    });

    await controller.refreshTools();
    assert.deepEqual((await controller.listTools()).map(({ name }) => name), ["list_connected_canvases", "select_canvas"]);
    await assert.rejects(controller.call("get_canvas_summary", {}), /尚未锁定目标画布/);
    await controller.call("select_canvas", { canvasId: "canvas-b" });
    assert.deepEqual((await controller.listTools()).map(({ name }) => name), ["list_connected_canvases", "select_canvas", "get_canvas_summary", "list_local_assets", "page_specific_action"]);
    await controller.call("list_local_assets", { page: 1 });
    assert.deepEqual(routedCalls, [{ clientId: "client-b", name: "list_local_assets", arguments: { page: 1 } }]);
    assert.equal(notifications.length, 1);
});

test("MCP controller drops stale canvas tools when the selected connection disappears", async () => {
    const createCanvasMcpController = implementation("createCanvasMcpController");
    let connections = [{ clientId: "client-a", canvasId: "canvas-a", connected: true, toolCount: 1 }];
    const controller = createCanvasMcpController({
        getConnections: async () => connections,
        getTools: async () => [{ name: "get_canvas_summary", inputSchema: { type: "object" } }],
        callCanvasTool: async () => ({ ok: true }),
        notifyToolsChanged: async () => {},
    });

    await controller.call("select_canvas", { canvasId: "canvas-a" });
    assert.ok((await controller.listTools()).some(({ name }) => name === "get_canvas_summary"));
    connections = [];
    assert.deepEqual((await controller.listTools()).map(({ name }) => name), ["list_connected_canvases", "select_canvas"]);
    await assert.rejects(controller.call("get_canvas_summary", {}), /连接已断开/);
});

test("tool registry errors clear page tools and leave only connection controls", async () => {
    const createCanvasMcpController = implementation("createCanvasMcpController");
    const controller = createCanvasMcpController({
        getConnections: async () => [{ clientId: "client-a", canvasId: "canvas-a", connected: true }],
        getTools: async () => { throw new Error("web tool registry unavailable"); },
        callCanvasTool: async () => ({ ok: true }),
        notifyToolsChanged: async () => {},
    });

    await controller.call("select_canvas", { canvasId: "canvas-a" });
    assert.deepEqual((await controller.listTools()).map(({ name }) => name), ["list_connected_canvases", "select_canvas"]);
    assert.match(controller.getToolStatus().error, /web tool registry unavailable/);
    await assert.rejects(controller.call("list_local_assets", {}), /web tool registry unavailable/);
});

test("an operation missing from the selected page is rejected", async () => {
    const createCanvasMcpController = implementation("createCanvasMcpController");
    const controller = createCanvasMcpController({
        getConnections: async () => [{ clientId: "client-a", canvasId: "canvas-a", connected: true }],
        getTools: async () => [],
        callCanvasTool: async () => ({ ok: true }),
        notifyToolsChanged: async () => {},
    });

    await controller.call("select_canvas", { canvasId: "canvas-a" });
    await assert.rejects(controller.call("list_local_assets", {}), /未注册工具：list_local_assets/);
});
