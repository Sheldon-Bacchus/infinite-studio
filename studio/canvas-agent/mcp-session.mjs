export const CANVAS_SELECTION_TOOLS = [
    {
        name: "list_connected_canvases",
        description: "列出 Agent 当前已连接的画布 ID、连接 ID 和工具数量；只读，不修改画布。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "select_canvas",
        description: "按真实画布 ID 锁定本 MCP 会话的目标；同一画布有多个标签时必须从连接列表指定 clientId。不会修改画布。",
        inputSchema: {
            type: "object",
            properties: {
                canvasId: { type: "string", minLength: 1 },
                clientId: { type: "string", minLength: 1 },
            },
            required: ["canvasId"],
            additionalProperties: false,
        },
    },
];

function valuesOf(sessions) {
    if (sessions instanceof Map) return [...sessions.values()];
    return Array.isArray(sessions) ? sessions : [];
}

function isConnected(session) {
    return Boolean(session && session.canvasId && (session.events || session.connected === true));
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

export function listConnectedCanvases(sessions, selectedClientId = "") {
    return valuesOf(sessions)
        .filter(isConnected)
        .map(({ clientId, canvasId, tools, toolCount }) => ({
            clientId,
            canvasId,
            connected: true,
            selected: clientId === selectedClientId,
            toolCount: Array.isArray(tools) ? tools.length : Number.isSafeInteger(toolCount) ? toolCount : 0,
        }));
}

export function resolveCanvasSelection(sessions, { canvasId, clientId, pinnedClientId } = {}) {
    if (typeof canvasId !== "string" || !canvasId.trim()) throw new Error("必须提供真实 canvasId");
    const connected = valuesOf(sessions).filter(isConnected);

    if (pinnedClientId) {
        if (clientId && clientId !== pinnedClientId) throw new Error("此 MCP 会话固定到其他连接，不能切换 clientId");
        const pinned = connected.find((session) => session.clientId === pinnedClientId);
        if (!pinned) throw new Error("固定的画布连接尚未连接");
        if (pinned.canvasId !== canvasId) throw new Error(`此 MCP 会话固定到画布 ${pinned.canvasId}，与目标不匹配`);
        return pinned;
    }

    const matchingCanvas = connected.filter((session) => session.canvasId === canvasId);
    if (clientId) {
        const specified = matchingCanvas.find((session) => session.clientId === clientId);
        if (specified) return specified;
        const otherCanvas = connected.find((session) => session.clientId === clientId);
        if (otherCanvas) throw new Error(`clientId 与 canvasId 不匹配：连接指向 ${otherCanvas.canvasId}`);
        throw new Error("指定的画布连接未连接或已断开");
    }
    if (matchingCanvas.length === 0) throw new Error(`目标画布未连接：${canvasId}`);
    if (matchingCanvas.length > 1) throw new Error(`目标画布存在多个连接，请从列表中指定 clientId：${matchingCanvas.map((session) => session.clientId).join(", ")}`);
    return matchingCanvas[0];
}

export function createToolSchemaWatcher({ getTools, notify }) {
    let previousSchema;
    let activeRefresh;
    return {
        refresh() {
            if (activeRefresh) return activeRefresh;
            activeRefresh = Promise.resolve().then(getTools).then(async (tools) => {
                const schema = JSON.stringify(Array.isArray(tools) ? tools : []);
                if (previousSchema === undefined) {
                    previousSchema = schema;
                    return false;
                }
                if (schema === previousSchema) return false;
                await notify();
                previousSchema = schema;
                return true;
            }).finally(() => { activeRefresh = undefined; });
            return activeRefresh;
        },
    };
}

export function createCanvasMcpController({ getConnections, getTools, callCanvasTool, notifyToolsChanged, pinnedClientId = "", staticTools = [] }) {
    let selectedClientId = pinnedClientId;
    let selectedCanvasId = "";
    let dynamicTools = [];
    let pageToolNames = new Set();
    let toolRegistryError = "";
    let toolNotificationError = "";
    let selectionError = "";

    async function selectedTools() {
        if (!selectedClientId) return [];
        try {
            const connections = await getConnections();
            const selected = connections.find((connection) => connection.clientId === selectedClientId);
            if (!selected) {
                if (!pinnedClientId) { selectedClientId = ""; selectedCanvasId = ""; }
                dynamicTools = [];
                pageToolNames = new Set();
                toolRegistryError = "";
                selectionError = "目标画布连接已断开，请重新连接并选择画布";
                return [];
            }
            if (selectedCanvasId && selected.canvasId !== selectedCanvasId) {
                throw new Error("画布连接 ID 已指向其他项目，请重新选择目标画布");
            }
            selectedCanvasId = selected.canvasId;
            const tools = await getTools(selectedClientId);
            if (!Array.isArray(tools)) throw new Error("画布页面返回的工具清单格式无效");
            pageToolNames = new Set(tools.filter((tool) => tool && typeof tool.name === "string").map(({ name }) => name));
            const seenToolNames = new Set();
            dynamicTools = tools.filter((tool) => {
                if (!tool || typeof tool.name !== "string" || seenToolNames.has(tool.name)) return false;
                seenToolNames.add(tool.name);
                return true;
            });
            toolRegistryError = "";
            selectionError = "";
            return dynamicTools;
        } catch (error) {
            dynamicTools = [];
            pageToolNames = new Set();
            toolRegistryError = errorMessage(error);
            return [];
        }
    }

    function getToolStatus() {
        return {
            selectedCanvasId,
            selectedClientId,
            pageToolCount: pageToolNames.size,
            dynamicToolCount: dynamicTools.length,
            error: selectionError || toolRegistryError || toolNotificationError || null,
        };
    }

    const schemaWatcher = createToolSchemaWatcher({ getTools: selectedTools, notify: notifyToolsChanged });

    async function refreshDynamicTools() {
        try {
            const changed = await schemaWatcher.refresh();
            toolNotificationError = "";
            return changed;
        } catch (error) {
            toolNotificationError = errorMessage(error);
            return false;
        }
    }

    return {
        async listTools() {
            const tools = await selectedTools();
            const definitions = new Map();
            for (const tool of [...staticTools, ...tools]) {
                if (!tool || typeof tool.name !== "string" || CANVAS_SELECTION_TOOLS.some(({ name }) => name === tool.name)) continue;
                definitions.set(tool.name, tool);
            }
            return [...CANVAS_SELECTION_TOOLS, ...definitions.values()];
        },
        async refreshTools() {
            return refreshDynamicTools();
        },
        async call(name, args = {}, signal) {
            if (name === "list_connected_canvases") {
                await selectedTools();
                return {
                    connections: listConnectedCanvases(await getConnections(), selectedClientId),
                    toolRegistry: getToolStatus(),
                };
            }
            if (name === "select_canvas") {
                const selected = resolveCanvasSelection(await getConnections(), {
                    canvasId: args.canvasId,
                    clientId: args.clientId,
                    pinnedClientId,
                });
                selectedClientId = selected.clientId;
                selectedCanvasId = selected.canvasId;
                selectionError = "";
                toolRegistryError = "";
                await refreshDynamicTools();
                return {
                    ok: true,
                    selectedCanvasId,
                    clientId: selectedClientId,
                    toolCount: Number.isSafeInteger(selected.toolCount) ? selected.toolCount : Array.isArray(selected.tools) ? selected.tools.length : 0,
                    toolRegistry: getToolStatus(),
                };
            }
            if (!selectedClientId) throw new Error(selectionError || "尚未锁定目标画布；先调用 list_connected_canvases，再用 select_canvas 选择真实 canvasId");
            const targetClientId = selectedClientId;
            await selectedTools();
            if (selectionError) throw new Error(selectionError);
            if (!selectedClientId || selectedClientId !== targetClientId || selectedCanvasId === "") {
                throw new Error(selectionError || "目标画布连接已断开，请重新连接并选择画布");
            }
            if (toolRegistryError) throw new Error(`无法读取目标画布的工具清单：${toolRegistryError}`);
            if (!pageToolNames.has(name)) {
                throw new Error(`当前画布未注册工具：${name}；请重新连接画布并读取实时工具清单`);
            }
            return callCanvasTool({ clientId: targetClientId, name, arguments: args }, signal);
        },
        getToolStatus,
        get selectedCanvasId() { return selectedCanvasId; },
        get selectedClientId() { return selectedClientId; },
    };
}
