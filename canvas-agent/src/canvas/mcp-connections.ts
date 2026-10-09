import crypto from "node:crypto";

export type ExecutionState = "executing" | "completed" | "failed" | "unknown" | "idle";

export type CanvasBinding = {
    sessionId: string;
    bindCode: string;
    clientId: string;
    projectId: string;
    revision: string;
};

export type ConnectionRecord = {
    sessionId: string;
    bindCode: string;
    label: string;
    binding?: CanvasBinding;
    revoked: boolean;
    executionState: ExecutionState;
};

/** MCP 显式独占通道身份与画布绑定；被接管连接不自动改投其他网页。 */
export class McpConnections {
    private connections = new Map<string, ConnectionRecord>();
    private tokenToSessionId = new Map<string, string>();

    createChannel(label = ""): { record: ConnectionRecord; channelToken: string } {
        const sessionId = crypto.randomUUID();
        const channelToken = crypto.randomBytes(24).toString("hex");
        const bindCode = `CH-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
        const record: ConnectionRecord = {
            sessionId,
            bindCode,
            label: label || `独占通道 ${bindCode}`,
            revoked: false,
            executionState: "idle",
        };
        this.connections.set(sessionId, record);
        this.tokenToSessionId.set(channelToken, sessionId);
        return { record, channelToken };
    }

    findByToken(channelToken: string): ConnectionRecord | undefined {
        if (!channelToken) return undefined;
        const sessionId = this.tokenToSessionId.get(channelToken);
        if (!sessionId) return undefined;
        return this.connections.get(sessionId);
    }

    getBinding(sessionId: string): CanvasBinding | undefined {
        return this.connections.get(sessionId)?.binding;
    }

    list() {
        return [...this.connections.values()].map((value) => ({ ...value }));
    }

    findByIdentifier(identifier: string): ConnectionRecord | undefined {
        if (!identifier) return undefined;
        const direct = this.connections.get(identifier);
        if (direct) return direct;
        const upper = identifier.toUpperCase();
        return [...this.connections.values()].find((c) => c.bindCode.toUpperCase() === upper || c.bindCode.replace(/^CH-/, "").toUpperCase() === upper);
    }

    bind(identifier: string, clientId: string, projectId: string, takeover: boolean, force = false): { binding: CanvasBinding; revokedBindings: CanvasBinding[]; previousBinding?: CanvasBinding } {
        const connection = this.findByIdentifier(identifier);
        if (!connection) throw new Error("未找到指定的独占通道或绑定码，请先在目标对话调用 canvas_connection_status");
        if (connection.executionState === "executing") {
            throw new Error("当前通道操作正在执行中，受租约保护，请等待执行完成");
        }

        // unknown 同一通道重绑须 force
        if (connection.executionState === "unknown" && !force) {
            const err = new Error("当前通道操作处于 unknown 状态（可能发生网络中断或超时，后台副作用可能已发生）。如确认重新绑定，请使用强制接管/强制绑定");
            (err as unknown as Record<string, unknown>).code = "UNKNOWN_LEASE";
            throw err;
        }

        const previous = [...this.connections.values()].filter(
            (item) => (item.binding?.projectId === projectId || (clientId && item.binding?.clientId === clientId))
                && item.sessionId !== connection.sessionId
                && (!item.revoked || item.executionState === "unknown")
        );

        if (previous.length > 0 && !takeover) {
            throw new Error("目标画布已被其他聊天通道占用，如需使用请选择接管连接");
        }

        const executingPrevious = previous.find((item) => item.executionState === "executing");
        if (executingPrevious) {
            throw new Error("被接管通道的操作正在执行中，受租约保护，无法立即接管，请等待操作结束");
        }

        const unknownPrevious = previous.find((item) => item.executionState === "unknown");
        if (unknownPrevious && !force) {
            const err = new Error("原通道操作处于 unknown 状态（可能发生网络中断或超时，后台副作用可能已发生）。如确认接管，请使用强制接管");
            (err as unknown as Record<string, unknown>).code = "UNKNOWN_LEASE";
            throw err;
        }

        const revokedBindings: CanvasBinding[] = [];
        for (const item of previous) {
            if (item.binding) revokedBindings.push(item.binding);
            item.binding = undefined;
            item.revoked = true;
            item.executionState = "failed";
        }

        const previousBinding = connection.binding;

        connection.binding = {
            sessionId: connection.sessionId,
            bindCode: connection.bindCode,
            clientId,
            projectId,
            revision: crypto.randomUUID(),
        };
        connection.revoked = false;
        connection.executionState = "idle";
        return { binding: connection.binding, revokedBindings, previousBinding };
    }

    setExecutionState(sessionId: string, state: ExecutionState) {
        const connection = this.connections.get(sessionId);
        if (connection) connection.executionState = state;
    }

    invalidateClientBindings(clientId: string, preserveUnknown = true): CanvasBinding[] {
        const revoked: CanvasBinding[] = [];
        for (const conn of this.connections.values()) {
            if (conn.binding?.clientId === clientId) {
                revoked.push(conn.binding);
                conn.revoked = true;
                if (conn.executionState === "executing" || conn.executionState === "unknown") {
                    conn.executionState = preserveUnknown ? "unknown" : "failed";
                } else {
                    conn.executionState = "failed";
                }
            }
        }
        return revoked;
    }

    get(sessionId: string): CanvasBinding {
        const value = this.connections.get(sessionId);
        if (!value?.binding || value.revoked) {
            throw new Error("当前 MCP 连接未绑定画布或已被接管，缺少可信独占通道身份，拒绝操作");
        }
        return value.binding;
    }

    valid(binding: CanvasBinding): boolean {
        const conn = this.connections.get(binding.sessionId);
        if (!conn || conn.revoked) return false;
        return conn.binding?.revision === binding.revision;
    }

    remove(sessionId: string) {
        this.connections.delete(sessionId);
        for (const [token, id] of this.tokenToSessionId.entries()) {
            if (id === sessionId) this.tokenToSessionId.delete(token);
        }
    }
}
