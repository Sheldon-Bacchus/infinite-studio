import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from "../canvas/schemas.js";
import { AGENT_PROMPT, loadConfig, type CanvasAgentConfig, VERSION } from "../config.js";

type CanvasAgentToolResponse = { ok?: boolean; result?: unknown; error?: string };

const internalToken = process.env.CANVAS_AGENT_INTERNAL_TOKEN || "";
const internal = Boolean(internalToken) && process.env.CANVAS_AGENT_INTERNAL === "1";

function mcpHeaders(config: CanvasAgentConfig) {
    return {
        "content-type": "application/json",
        "x-canvas-agent-token": config.token,
        ...(internal ? { "x-canvas-internal-token": internalToken } : {}),
    };
}

/** 启动通过标准输入输出通信的 MCP 服务。 */
export async function startMcpServer() {
    const config = loadConfig(true);
    const server = new McpServer({ name: "canvas-agent", version: VERSION }, { instructions: AGENT_PROMPT });

    server.registerTool("canvas_connection_status", {
        description: "读取或创建本对话 MCP 独占通道绑定码和凭据；首次调用留空 channelToken 创建新通道并返回凭据与绑定码；带 channelToken 查询自身通道与网页目标。（共享 MCP 进程中各聊天须独立保管凭据 channelToken）",
        inputSchema: {
            channelToken: z.string().optional().describe("已有通道凭据。首次调用请留空以创建新通道。"),
        },
    }, async ({ channelToken }) => {
        if (internal) {
            const status = await connectionRequest(config, "/api/connections/status", {});
            return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
        }
        if (!channelToken) {
            const created = await connectionRequest(config, "/api/connections/create", {});
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        channelToken: created.channelToken,
                        bindCode: created.bindCode,
                        label: created.label,
                        mcpProcessPid: process.pid,
                        instructions: `当前对话的独占通道绑定码为【${created.bindCode}】。凭据 channelToken: 【${created.channelToken}】。\n【重要提示】在共享 MCP 进程中各聊天必须独立保管凭据 channelToken，并在后续所有画布工具调用（如 canvas_apply_ops、canvas_bind_connection 等）中显式传入 channelToken 参数。\n请在网页端的 Agent 连接面板中选择或输入该绑定码进行绑定。绑定后本对话方可对画布执行写操作。`,
                    }, null, 2),
                }],
            };
        }
        const status = await connectionRequest(config, "/api/connections/status", { channelToken });
        return {
            content: [{
                type: "text",
                text: JSON.stringify(status, null, 2),
            }],
        };
    });

    server.registerTool("canvas_bind_connection", {
        description: "明确将本聊天独占通道绑定指定网页；takeover=true 接管并使旧连接失效，force=true 强行释放 unknown 租约并接管。（共享 MCP 进程中各聊天须独立保管凭据 channelToken）",
        inputSchema: {
            clientId: z.string().describe("网页客户端 ID"),
            channelToken: internal ? z.string().optional().describe("通道凭据") : z.string().describe("当前聊天的独占通道凭据（调用 canvas_connection_status 获取）"),
            takeover: z.boolean().optional().describe("是否接管已有绑定"),
            force: z.boolean().optional().describe("是否强行释放 unknown 租约"),
        },
    }, async ({ clientId, channelToken, takeover, force }) => {
        const result = await connectionRequest(config, "/api/connections/bind", { clientId, channelToken, takeover, force });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

    toolNames.forEach((name) => registerCanvasTool(server, config, name));
    await server.connect(new StdioServerTransport());
}

/** 向 MCP Server 注册单个 Canvas Agent 工具。 */
function registerCanvasTool(server: McpServer, config: CanvasAgentConfig, name: ToolName) {
    const schema = toolInputSchemas[name];
    const shape = internal
        ? schema.shape
        : {
            ...schema.shape,
            channelToken: z.string().describe("当前聊天的独占通道凭据（调用 canvas_connection_status 获取）。共享 MCP 进程中各聊天必须独立保管并显式传入。"),
        };
    const description = internal
        ? toolDescriptions[name]
        : `${toolDescriptions[name]}（共享 MCP 进程中各聊天须独立保管凭据 channelToken）`;
    server.registerTool(name, { description, inputSchema: shape }, async (rawInput: unknown) => {
        const input = (rawInput && typeof rawInput === "object" ? { ...rawInput } : {}) as Record<string, unknown>;
        const channelToken = typeof input.channelToken === "string" ? input.channelToken : undefined;
        delete input.channelToken;
        const parsedInput = schema.parse(input);
        const result = await postCanvasAgentTool(config, name, parsedInput, channelToken);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    });
}

/** 将 MCP 工具调用转发到本地 Canvas Agent HTTP 服务。 */
async function postCanvasAgentTool(config: CanvasAgentConfig, name: ToolName, input: unknown, channelToken?: string) {
    const res = await fetch(`${config.url}/api/tools`, {
        method: "POST",
        headers: mcpHeaders(config),
        body: JSON.stringify({ name, input, channelToken }),
    });
    const body = (await res.json()) as CanvasAgentToolResponse;
    if (!body.ok) throw new Error(body.error || "tool call failed");
    return body.result;
}

async function connectionRequest(config: CanvasAgentConfig, path: string, input: Record<string, unknown>) {
    const res = await fetch(`${config.url}${path}`, {
        method: "POST",
        headers: mcpHeaders(config),
        body: JSON.stringify(input),
    });
    const body = await res.json() as CanvasAgentToolResponse & Record<string, unknown>;
    if (!res.ok || !body.ok) throw new Error(body.error || "连接操作失败");
    return body;
}
