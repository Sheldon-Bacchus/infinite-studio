import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { McpConnections, type CanvasBinding, type ExecutionState } from "./mcp-connections.js";
import type { ServerResponse } from "node:http";

import type { AgentAttachment } from "../agent/types.js";
import { logger } from "../utils/logger.js";
import { buildCanvasToolRequest, fitAttachmentNodeSize } from "./operations.js";
import type { ToolName } from "./schemas.js";
import { compactCanvasState, compactNode, isToolName, nextCanvasX, parseToolInput } from "./tools.js";
import { LocalAssets } from "./local-assets.js";
import type { CanvasSnapshot } from "./types.js";

type PendingRequest = { clientId: string; localAssetIds?: string[]; projectId?: string; binding?: CanvasBinding; state: ExecutionState; resolve: (value: unknown) => void; reject: (error: Error) => void };
type TurnAttachment = { clientId: string; id: string; name: string; type: string; size: number; width: number; height: number; dataUrl: string };
type ReplayEvent = { type: string; payload: Record<string, unknown> };
export type CodexState = { busy: boolean; threadId: string; turnId: string };
export type McpStartupState = "starting" | "ready" | "failed" | "cancelled";
export type ConversationState = {
    revision: number;
    conversationId: string;
    threadId: string;
    status: "idle" | "preparing" | "ready" | "warning" | "running" | "failed";
    mcpStatuses: Record<string, { status: McpStartupState; error?: string | null; failureReason?: string | null }>;
    sourceClientId?: string;
    error?: string;
};
type McpInventoryItem = { name: string; authStatus?: string };
export const AGENT_PROTOCOL_VERSION = 8;

const SITE_TOOLS = new Set<ToolName>([
    "site_navigate",
    "canvas_list_projects",
    "workbench_image_get_config",
    "workbench_image_generate",
    "workbench_video_get_config",
    "workbench_video_generate",
    "prompts_search",
    "assets_list",
    "assets_add",
    "generation_get_status",
    "canvas_import_local_assets",
]);

/** 管理网页画布连接、状态、附件和工具请求。 */
export class CanvasSession {
    readonly mcpConnections = new McpConnections();
    readonly localAssets: LocalAssets;
    private toolScope = new AsyncLocalStorage<CanvasBinding>();
    private clients = new Map<string, ServerResponse>();
    private clientFocusOrder = new Map<string, number>();
    private pending = new Map<string, PendingRequest>();
    private pendingApprovals = new Map<string, Record<string, unknown>>();
    private canvasStates = new Map<string, CanvasSnapshot & { revision?: string }>();
    private turnAttachments = new Map<string, TurnAttachment>();
    private codexReplayEvents = new Map<string, ReplayEvent>();
    private codexReplayActiveItems = new Set<string>();
    private codexMutationBusy = false;
    private activeClientId = "";
    private boundClientId = "";
    private focusSequence = 0;
    private codexState: CodexState = { busy: false, threadId: "", turnId: "" };
    private webAgentEnabled = false;
    private conversationState: ConversationState;
    private conversationInventoryComplete = false;
    private preparedConversationThreadId = "";

    constructor(activeThreadId = "", localAssetDirectories: string[] = []) {
        this.localAssets = new LocalAssets(localAssetDirectories);
        this.conversationState = {
            revision: 1,
            conversationId: activeThreadId || crypto.randomUUID(),
            threadId: activeThreadId,
            status: activeThreadId ? "ready" : "idle",
            mcpStatuses: {},
        };
    }

    get isWebAgentEnabled(): boolean {
        return this.webAgentEnabled;
    }

    private findExternalLeaseConflict(action = "启用网页 Agent"): string | null {
        const busyConn = this.mcpConnections.list().find(
            (conn) => conn.executionState === "executing" || conn.executionState === "unknown"
        );
        if (busyConn) {
            return `外部聊天通道（${busyConn.bindCode || busyConn.label}）正处于 ${busyConn.executionState} 状态，无法${action}`;
        }
        const hasExecutingPending = [...this.pending.values()].some((item) => item.state === "executing");
        if (hasExecutingPending) {
            return `当前存在正在执行中的操作，受租约保护，无法${action}`;
        }
        return null;
    }

    checkExternalLease(action = "发起任务"): string | null {
        return this.findExternalLeaseConflict(action);
    }

    assertNoExternalLease(action = "发起任务"): void {
        const conflict = this.findExternalLeaseConflict(action);
        if (conflict) {
            throw new Error(conflict);
        }
    }

    setWebAgentEnabled(enabled: boolean) {
        if (enabled) {
            this.assertNoExternalLease("启用网页 Agent");
        } else {
            if (this.codexState.busy) {
                throw new Error("网页 Agent 正在执行任务，请先结束或中断任务后再关闭");
            }
        }
        this.webAgentEnabled = enabled;
    }

    getOccupant(): string {
        if (this.codexState.busy) {
            return "网页Agent";
        }
        const executingConn = this.mcpConnections.list().find(
            (conn) => conn.executionState === "executing" || conn.executionState === "unknown"
        );
        if (executingConn) {
            return executingConn.bindCode;
        }
        const boundConn = this.mcpConnections.list().find(
            (c) => !c.revoked && c.binding && (!this.targetClientId || c.binding.clientId === this.targetClientId)
        ) || this.mcpConnections.list().find((c) => !c.revoked && c.binding);
        if (boundConn) {
            return boundConn.bindCode;
        }
        return "空闲";
    }

    /** 获取当前目标网页的画布状态。 */
    private get canvasState() {
        return this.clients.has(this.targetClientId) ? this.canvasStates.get(this.targetClientId) || null : null;
    }

    /** 获取当前 turn 绑定或最近激活的网页客户端。 */
    private get targetClientId() {
        const binding = this.toolScope.getStore();
        if (binding) {
            if (!this.mcpConnections.valid(binding) || this.canvasStates.get(binding.clientId)?.projectId !== binding.projectId) throw new Error("画布绑定已失效，拒绝旧请求");
            return binding.clientId;
        }
        return this.boundClientId || this.activeClientId;
    }

    connectionStatus() {
        return {
            webAgentEnabled: this.webAgentEnabled,
            occupant: this.getOccupant(),
            connections: this.mcpConnections.list(),
            clients: [...this.clients.keys()].map((clientId) => ({
                clientId,
                projectId: this.canvasStates.get(clientId)?.projectId || "",
                title: this.canvasStates.get(clientId)?.title || "",
                revision: this.canvasStates.get(clientId)?.revision || "",
            })),
        };
    }

    clientList() {
        return [...this.clients.keys()].map((clientId) => ({
            clientId,
            projectId: this.canvasStates.get(clientId)?.projectId || "",
            title: this.canvasStates.get(clientId)?.title || "",
            revision: this.canvasStates.get(clientId)?.revision || "",
        }));
    }

    private syncConnectionExecutionState(sessionId?: string, fallback: ExecutionState = "idle", expectedRevision?: string) {
        if (!sessionId) return;
        const currentBinding = this.mcpConnections.getBinding(sessionId);
        if (expectedRevision && currentBinding?.revision !== expectedRevision) return;
        const items = [...this.pending.values()].filter((item) => {
            if (item.binding?.sessionId !== sessionId) return false;
            // 新绑定状态不能被旧请求推导污染，按当前 binding revision 聚合
            if (currentBinding) {
                return item.binding.revision === currentBinding.revision;
            }
            return !item.binding;
        });
        if (items.some((item) => item.state === "executing")) {
            this.mcpConnections.setExecutionState(sessionId, "executing");
        } else if (items.some((item) => item.state === "unknown")) {
            this.mcpConnections.setExecutionState(sessionId, "unknown");
        } else {
            this.mcpConnections.setExecutionState(sessionId, fallback);
        }
    }

    bindMcpConnection(identifier: string, clientId: string, takeover = false, force = false) {
        const state = this.canvasStates.get(clientId);
        if (!this.clients.has(clientId) || !state?.projectId) throw new Error("目标网页未连接或画布尚未同步");
        if (this.codexState.busy) throw new Error("网页 Agent 正在执行，请先结束或中断当前任务再接管");

        const clientPending = [...this.pending.values()].filter((item) => item.clientId === clientId);
        if (clientPending.some((item) => item.state === "executing")) {
            throw new Error("工具操作已开始执行，受租约保护，请等待操作结束后再绑定或接管");
        }

        // 全部验证通过前，绝不执行 clearUnknown / reject，防止失败绑定也改变租约
        const { binding, revokedBindings, previousBinding } = this.mcpConnections.bind(identifier, clientId, state.projectId, takeover, force);

        // 全部验证成功后才精确撤销对应绑定及其 pending
        const revokedRevisions = new Set(revokedBindings.map((item) => `${item.sessionId}\0${item.revision}`));
        this.pending.forEach((item, requestId) => {
            // 被接管通道中与被撤销 revision 匹配的 pending
            if (item.binding && revokedRevisions.has(`${item.binding.sessionId}\0${item.binding.revision}`)) {
                this.pending.delete(requestId);
                item.reject(new Error(force && item.state === "unknown" ? "用户强制接管，原租约已强行释放" : "画布独占通道已被接管，旧请求已失效"));
                return;
            }
            // 同一通道重绑也取消旧 revision pending
            if (previousBinding && item.binding && item.binding.sessionId === previousBinding.sessionId && item.binding.revision === previousBinding.revision) {
                this.pending.delete(requestId);
                item.reject(new Error(force && item.state === "unknown" ? "用户强制接管，原租约已强行释放" : "画布通道已重新绑定，旧版本请求已失效"));
                return;
            }
            // 强制接管/重绑时：所选通道清理它自己的 unknown pending（包括无 binding 时遗留的 unknown）
            if (force && item.binding?.sessionId === binding.sessionId && item.state === "unknown") {
                this.pending.delete(requestId);
                item.reject(new Error("用户强制接管，原租约已强行释放"));
                return;
            }
        });

        this.emitAll("connection_changed", this.connectionStatus());
        return binding;
    }

    callMcpTool(sessionId: string, name: unknown, input: unknown, internal = false) {
        if (internal) {
            if (!this.codexState.busy || !this.boundClientId) throw new Error("网页 Agent 没有正在执行的绑定任务");
            return this.callTool(name, input);
        }
        const toolNameStr = String(name || "");
        const isReadTool = SITE_TOOLS.has(toolNameStr as ToolName)
            || toolNameStr === "canvas_get_state"
            || toolNameStr === "canvas_get_selection"
            || toolNameStr === "canvas_export_snapshot";
        if (!isReadTool && this.codexState.busy) {
            throw new Error("网页 Agent 正在使用画布,请稍后");
        }
        const binding = this.mcpConnections.get(sessionId);
        if (!isReadTool && !this.mcpConnections.valid(binding)) {
            throw new Error("当前操作为写操作，缺少可信的独占通道授权，已被安全拒绝。请先在连接面板绑定当前对话的独占通道。");
        }
        return this.toolScope.run(binding, () => this.callTool(name, input));
    }

    validateToolRequest(clientId: string, requestId: string) {
        const item = this.pending.get(requestId);
        if (!item || item.clientId !== clientId) throw new Error("请求已取消或画布绑定已变更，拒绝执行");
        if (item.state === "unknown") throw new Error("请求已处于未知状态，受租约保护，拒绝执行");
        if (item.binding && !this.mcpConnections.valid(item.binding)) throw new Error("绑定已被接管，拒绝旧请求");
        if (item.projectId !== this.canvasStates.get(clientId)?.projectId) throw new Error("网页已切换画布，拒绝旧请求");
        item.state = "executing";
        if (item.binding) this.syncConnectionExecutionState(item.binding.sessionId, "executing", item.binding.revision);
    }

    /** 本地素材导入请求中的 assetId 只属于本请求；先按真实路径重新校验再返回给网页。 */
    async localAssetRequestIds(clientId: string, requestId: string) {
        const item = this.pending.get(requestId);
        if (!item || !item.localAssetIds || item.clientId !== clientId || !this.clients.has(clientId)) throw new Error("本地素材导入请求已失效或不属于当前网页");
        for (const id of item.localAssetIds) await this.localAssets.resolve(id);
        return item.localAssetIds;
    }

    /** 返回 Canvas Agent 当前连接状态。 */
    health() {
        return { ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, hasCanvas: Boolean(this.canvasState), clients: this.clients.size, codexBusy: this.codexState.busy, webAgentEnabled: this.webAgentEnabled, occupant: this.getOccupant(), conversation: this.conversationStateSnapshot };
    }

    /** 返回 Codex 是否正在执行任务。 */
    get codexBusy() {
        return this.codexState.busy;
    }

    get codexThreadId() {
        return this.codexState.threadId;
    }

    /** Return a copy that callers can restore after a temporary Codex operation. */
    get codexStateSnapshot(): CodexState {
        return { ...this.codexState };
    }

    /** 返回站点级对话的权威快照。 */
    get conversationStateSnapshot(): ConversationState {
        return { ...this.conversationState, mcpStatuses: { ...this.conversationState.mcpStatuses } };
    }

    /** 原子开始一次新建或恢复对话流程。 */
    beginConversation(options: { threadId?: string; conversationId?: string; sourceClientId?: string } = {}) {
        this.conversationInventoryComplete = false;
        this.preparedConversationThreadId = "";
        return this.updateConversation({
            conversationId: options.conversationId || options.threadId || crypto.randomUUID(),
            threadId: options.threadId || "",
            status: "preparing",
            mcpStatuses: {},
            sourceClientId: options.sourceClientId,
            error: undefined,
        });
    }

    /** 记录预热阶段单个 MCP 服务的启动状态。 */
    updateConversationMcp(name: string, status: McpStartupState, error?: string | null, failureReason?: string | null) {
        if (!name || this.conversationState.status !== "preparing") return this.conversationStateSnapshot;
        const snapshot = this.updateConversation({
            mcpStatuses: { ...this.conversationState.mcpStatuses, [name]: { status, error, failureReason } },
        });
        return this.conversationInventoryComplete && this.preparedConversationThreadId
            ? this.completeConversationPreparation(this.preparedConversationThreadId)
            : snapshot;
    }

    /** 用 app-server 的完整 MCP 清单补齐未发送逐项通知的服务。 */
    completeConversationMcpInventory(services: McpInventoryItem[]) {
        if (this.conversationState.status !== "preparing") return this.conversationStateSnapshot;
        const mcpStatuses = { ...this.conversationState.mcpStatuses };
        services.filter((item) => item.name).forEach((item) => {
            const current = mcpStatuses[item.name];
            if (current?.status === "failed" || current?.status === "cancelled") return;
            mcpStatuses[item.name] = item.authStatus === "notLoggedIn"
                ? { status: "failed", error: "MCP 服务未登录", failureReason: "reauthenticationRequired" }
                : { status: "ready" };
        });
        this.conversationInventoryComplete = true;
        return this.updateConversation({ mcpStatuses });
    }

    /** MCP 清单读取结束后提交线程和最终可发送状态。 */
    completeConversationPreparation(threadId: string) {
        this.preparedConversationThreadId = threadId;
        const statuses = this.conversationState.mcpStatuses;
        const hasPending = !this.conversationInventoryComplete || Object.values(statuses).some((item) => item.status === "starting");
        const requiredFailure = statuses.sudio?.status !== "ready";
        const hasFailure = Object.values(statuses).some((item) => item.status === "failed" || item.status === "cancelled");
        const requiredFailureDetail = statuses.sudio?.error;
        return this.updateConversation({
            threadId,
            status: hasPending ? "preparing" : requiredFailure ? "failed" : hasFailure ? "warning" : "ready",
            error: requiredFailure ? `Infinite Canvas MCP 初始化失败${requiredFailureDetail ? `：${requiredFailureDetail}` : ""}` : undefined,
        });
    }

    /** 将创建线程或读取 MCP 清单的失败保存为不可发送状态。 */
    failConversationPreparation(error: string) {
        this.conversationInventoryComplete = false;
        this.preparedConversationThreadId = "";
        return this.updateConversation({ status: "failed", error });
    }

    /** 切换到无需重新预热的既有状态，例如删除当前对话后的空状态。 */
    activateConversation(threadId: string, sourceClientId?: string) {
        this.conversationInventoryComplete = false;
        this.preparedConversationThreadId = "";
        return this.updateConversation({
            conversationId: threadId || crypto.randomUUID(),
            threadId,
            status: threadId ? "ready" : "idle",
            mcpStatuses: {},
            sourceClientId,
            error: undefined,
        });
    }

    markConversationRunning(threadId: string) {
        if (!threadId || threadId !== this.conversationState.threadId || !["ready", "warning"].includes(this.conversationState.status)) return this.conversationStateSnapshot;
        return this.updateConversation({ status: "running" });
    }

    finishConversationRun(threadId: string) {
        if (!threadId || threadId !== this.conversationState.threadId) return this.conversationStateSnapshot;
        const hasFailure = Object.values(this.conversationState.mcpStatuses).some((item) => item.status === "failed" || item.status === "cancelled");
        return this.updateConversation({ status: hasFailure ? "warning" : "ready" });
    }

    /** 判断网页客户端是否仍连接到当前 Agent。 */
    hasClient(clientId: string) {
        return this.clients.has(clientId);
    }

    /** 读取指定网页上报的画布，避免提炼时受最近焦点或其他标签页影响。 */
    canvasStateForClient(clientId: string) {
        return this.clients.has(clientId) ? this.canvasStates.get(clientId) || null : null;
    }

    /** 原子取得 Codex 写操作权限，避免多个网页并发切换或修改会话。 */
    beginCodexMutation() {
        if (this.codexState.busy || this.codexMutationBusy) return false;
        this.codexMutationBusy = true;
        return true;
    }

    /** 释放 Codex 写操作权限。 */
    endCodexMutation() {
        this.codexMutationBusy = false;
    }

    /** 返回当前 Codex turn 的线程、turn 和发起网页。 */
    get codexEventScope() {
        return {
            threadId: this.codexState.threadId,
            turnId: this.codexState.busy ? this.codexState.turnId : "",
            sourceClientId: this.codexState.busy ? this.boundClientId : "",
        };
    }

    /** 返回刷新后仍需展示的 Codex 权限请求。 */
    get codexPendingApprovals() {
        return [...this.pendingApprovals.values()];
    }

    /** 跟踪需要跨页面重连恢复的 Codex 权限请求。 */
    trackCodexEvent(type: string, payload: Record<string, unknown>) {
        const requestId = String(payload.requestId || "");
        if (type === "codex_approval" && requestId) this.pendingApprovals.set(requestId, payload);
        if (type === "codex_approval_resolved" && requestId) this.pendingApprovals.delete(requestId);
        if (type === "agent_error") this.pendingApprovals.clear();
    }

    /** 更新并广播 Codex 运行状态；静默后台活动可保留上一 turn 的断线重放。 */
    setCodexState(patch: Partial<CodexState>, options: { preserveReplay?: boolean } = {}) {
        const next = { ...this.codexState, ...patch };
        const threadChanged = next.threadId !== this.codexState.threadId;
        const turnChanged = Boolean(this.codexState.turnId && next.turnId && next.turnId !== this.codexState.turnId);
        const nextTurnStarted = !this.codexState.busy && next.busy;
        if (!options.preserveReplay && (threadChanged || turnChanged || nextTurnStarted)) {
            this.codexReplayEvents.clear();
            this.codexReplayActiveItems.clear();
        }
        if (!next.busy) {
            if (this.boundClientId && !this.clients.has(this.boundClientId)) this.boundClientId = "";
        }
        if (next.busy === this.codexState.busy && next.threadId === this.codexState.threadId && next.turnId === this.codexState.turnId) return;
        this.codexState = next;
        logger.debug("Codex state changed", this.codexState);
        this.emitAll("codex_state", this.codexState);
    }

    /** 权威历史已覆盖指定 turn 后，清理其断线重放事件。 */
    acknowledgeCodexHistory(threadId: string, turnIds: string[]) {
        const acknowledged = new Set(turnIds.filter(Boolean));
        if (!threadId || !acknowledged.size) return;
        this.codexReplayEvents.forEach((event, key) => {
            const eventThreadId = String(event.payload.threadId || event.payload.thread_id || "");
            const eventTurnId = String(event.payload.turnId || event.payload.turn_id || "");
            if (eventThreadId === threadId && acknowledged.has(eventTurnId)) {
                this.codexReplayEvents.delete(key);
                this.codexReplayActiveItems.delete(key);
            }
        });
    }

    /** 建立网页与 Canvas Agent 之间的 SSE 连接。 */
    openEvents(url: URL, res: ServerResponse, activeThreadId = "") {
        const clientId = url.searchParams.get("clientId") || crypto.randomUUID();
        const statusOnly = url.searchParams.get("role") === "status";
        logger.info("SSE client connected", { clientId, statusOnly });
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        if (!statusOnly) {
            this.clients.set(clientId, res);
            if (!this.clientFocusOrder.has(clientId)) this.clientFocusOrder.set(clientId, 0);
            if (!this.activeClientId) {
                this.activeClientId = clientId;
                this.clientFocusOrder.set(clientId, ++this.focusSequence);
            }
        }
        sendEvent(res, "hello", { ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, clientId, workspace: { activeThreadId }, conversation: this.conversationStateSnapshot, codex: this.codexState, webAgentEnabled: this.webAgentEnabled, occupant: this.getOccupant(), pendingApprovals: this.codexPendingApprovals });
        if (!statusOnly && activeThreadId && this.codexState.threadId === activeThreadId) this.codexReplayEvents.forEach((event) => sendEvent(res, event.type, event.payload));
        const timer = setInterval(() => sendEvent(res, "ping", { time: Date.now() }), 15000);
        res.on("close", () => {
            clearInterval(timer);
            logger.info("SSE client disconnected", { clientId, statusOnly });
            if (statusOnly || this.clients.get(clientId) !== res) return;
            this.clients.delete(clientId);
            this.clientFocusOrder.delete(clientId);
            this.canvasStates.delete(clientId);
            this.mcpConnections.invalidateClientBindings(clientId, true);
            this.pending.forEach((item, requestId) => {
                if (item.clientId !== clientId) return;
                if (item.state === "executing" || item.state === "unknown") {
                    item.state = "unknown";
                    const isCurrent = item.binding && this.mcpConnections.getBinding(item.binding.sessionId)?.revision === item.binding.revision;
                    if (isCurrent && item.binding) this.syncConnectionExecutionState(item.binding.sessionId, "unknown", item.binding.revision);
                    logger.warn("Executing tool entered unknown state due to client disconnect", { requestId, clientId });
                    item.reject(new Error("请求页面已断开"));
                } else {
                    item.state = "failed";
                    this.pending.delete(requestId);
                    const isCurrent = item.binding && this.mcpConnections.getBinding(item.binding.sessionId)?.revision === item.binding.revision;
                    if (isCurrent && item.binding) this.syncConnectionExecutionState(item.binding.sessionId, "failed", item.binding.revision);
                    item.reject(new Error("请求页面已断开"));
                }
            });
            if (this.activeClientId === clientId) this.activeClientId = [...this.clients.keys()].sort((a, b) => (this.clientFocusOrder.get(b) || 0) - (this.clientFocusOrder.get(a) || 0))[0] || "";
            this.emitAll("connection_changed", this.connectionStatus());
        });
    }

    private updateConversation(patch: Partial<Omit<ConversationState, "revision">>) {
        this.conversationState = { ...this.conversationState, ...patch, revision: this.conversationState.revision + 1 };
        const snapshot = this.conversationStateSnapshot;
        this.emitAll("conversation_changed", snapshot);
        return snapshot;
    }

    /** 保存指定网页上报的最新画布快照，并返回包含 clientId、projectId、revision 的回执。 */
    updateState(body: unknown, clientId?: string): { clientId: string; projectId: string; revision: string } | null {
        const targetClientId = clientId || this.activeClientId;
        if (!targetClientId || !this.clients.has(targetClientId)) return null;
        const payload = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
        const projectId = typeof payload.projectId === "string" ? payload.projectId : "";
        const revision = typeof payload.revision === "string" && payload.revision.trim()
            ? payload.revision.trim()
            : typeof payload.revision === "number"
                ? String(payload.revision)
                : typeof payload.canvasRevision === "number" || typeof payload.canvasRevision === "string"
                    ? String(payload.canvasRevision)
                    : typeof payload.operationId === "string" && payload.operationId
                        ? payload.operationId
                        : (projectId ? `rev-${crypto.randomUUID()}` : "");

        const previousState = this.canvasStates.get(targetClientId);
        const prevProjectId = previousState?.projectId || "";
        // 4 切换画布要永久失效旧绑定，切回也不复活；执行中副作用仍保留 unknown 提示
        if (prevProjectId && projectId !== prevProjectId) {
            logger.info("Canvas switched for client, permanently invalidating bindings", { clientId: targetClientId, prevProjectId, nextProjectId: projectId });
            this.mcpConnections.invalidateClientBindings(targetClientId, true);
            this.pending.forEach((item, requestId) => {
                if (item.clientId === targetClientId) {
                    if (item.state === "executing" || item.state === "unknown") {
                        item.state = "unknown";
                        const isCurrent = item.binding && this.mcpConnections.getBinding(item.binding.sessionId)?.revision === item.binding.revision;
                        if (isCurrent && item.binding) this.syncConnectionExecutionState(item.binding.sessionId, "unknown", item.binding.revision);
                        item.reject(new Error("网页已切换画布，执行中或未知状态操作保持未知状态"));
                    } else {
                        item.state = "failed";
                        this.pending.delete(requestId);
                        const isCurrent = item.binding && this.mcpConnections.getBinding(item.binding.sessionId)?.revision === item.binding.revision;
                        if (isCurrent && item.binding) this.syncConnectionExecutionState(item.binding.sessionId, "failed", item.binding.revision);
                        item.reject(new Error("网页已切换画布，旧请求已失效"));
                    }
                }
            });
            this.emitAll("connection_changed", this.connectionStatus());
        }

        const state = { ...payload, clientId: targetClientId, projectId, revision } as CanvasSnapshot & { revision?: string };
        this.canvasStates.set(targetClientId, state);
        logger.debug("Canvas state updated", { clientId: targetClientId, projectId, revision, nodes: state.nodes?.length || 0, connections: state.connections?.length || 0 });
        return { clientId: targetClientId, projectId, revision };
    }

    /** 将指定网页设为最近激活的工具目标。 */
    activateClient(clientId: string) {
        if (!this.clients.has(clientId)) throw new Error("当前网页未连接");
        this.activeClientId = clientId;
        this.clientFocusOrder.set(clientId, ++this.focusSequence);
        logger.debug("Canvas client activated", { clientId });
    }

    /** 将当前 Agent turn 固定绑定到指定网页。 */
    bindClient(clientId: string) {
        if (!this.clients.has(clientId)) throw new Error("当前网页未连接");
        this.boundClientId = clientId;
        logger.debug("Canvas client bound to turn", { clientId });
    }

    /** 解除当前 Agent turn 的网页绑定。 */
    releaseClient(clientId: string) {
        if (this.boundClientId === clientId) this.boundClientId = "";
        logger.debug("Canvas client released from turn", { clientId });
    }

    /** 保存当前 turn 可用的图片附件并返回安全引用。 */
    setTurnAttachments(clientId: string, attachments: AgentAttachment[]) {
        this.turnAttachments.clear();
        return attachments.flatMap((item, index) => {
            if (!item.dataUrl?.startsWith("data:image/")) return [];
            const id = item.id?.trim() || `attachment-${crypto.randomUUID()}`;
            const attachment: TurnAttachment = {
                clientId,
                id,
                name: item.name?.trim() || `图片 ${index + 1}`,
                type: item.type?.startsWith("image/") ? item.type : item.dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png",
                size: positiveNumber(item.size, 0),
                width: positiveNumber(item.width, 1024),
                height: positiveNumber(item.height, 1024),
                dataUrl: item.dataUrl,
            };
            this.turnAttachments.set(id, attachment);
            return [{ id, name: attachment.name, type: attachment.type, size: attachment.size, width: attachment.width, height: attachment.height }];
        });
    }

    /** 清理指定网页或全部 turn 附件。 */
    clearTurnAttachments(clientId?: string) {
        this.turnAttachments.forEach((item, id) => {
            if (!clientId || item.clientId === clientId) this.turnAttachments.delete(id);
        });
    }

    /** 获取属于指定网页 turn 的图片附件。 */
    getTurnAttachment(clientId: string, attachmentId: string) {
        const attachment = this.turnAttachments.get(attachmentId);
        if (!attachment) throw new Error(`找不到本轮图片附件：${attachmentId}`);
        if (attachment.clientId !== clientId) throw new Error("图片附件不属于当前 turn 的发起标签页");
        return attachment;
    }

    /** 接收网页返回的工具调用结果。 */
    resolveResult(clientId: string, body: { requestId?: string; error?: string; result?: unknown }) {
        const item = body.requestId ? this.pending.get(body.requestId) : null;
        if (!item || !body.requestId || item.clientId !== clientId) return false;

        const isBindingRevoked = item.binding ? !this.mcpConnections.valid(item.binding) : false;
        const isProjectMismatch = item.projectId !== this.canvasStates.get(clientId)?.projectId;
        const isUnknown = item.state === "unknown";

        // late result 属于 unknown 或已失效，应拒绝且保留 unknown 状态，不让拒绝旧结果解除租约
        if (isUnknown || isBindingRevoked || isProjectMismatch) {
            logger.warn("Rejecting late canvas tool result without releasing lease", {
                requestId: body.requestId,
                clientId,
                state: item.state,
                isUnknown,
                isBindingRevoked,
                isProjectMismatch,
            });
            return false;
        }

        this.pending.delete(body.requestId);
        logger.debug("Canvas tool result received", { clientId, requestId: body.requestId, error: body.error, result: body.result });
        if (body.error) {
            item.state = "failed";
            if (item.binding) this.syncConnectionExecutionState(item.binding.sessionId, "failed", item.binding.revision);
            item.reject(new Error(body.error));
        } else {
            item.state = "completed";
            if (item.binding) this.syncConnectionExecutionState(item.binding.sessionId, "completed", item.binding.revision);
            item.resolve(body.result);
        }
        return true;
    }

    /** 向全部已连接网页广播事件。 */
    emitAll(type: string, payload: unknown) {
        this.clients.forEach((client) => sendEvent(client, type, payload));
    }

    /** 向全部网页广播带线程归属的事件。 */
    emitThread(type: string, threadId: string, payload: Record<string, unknown> = {}) {
        const data: Record<string, unknown> = { ...payload, threadId };
        const replayKey = codexReplayKey(type, data);
        const eventTurnId = String(data.turnId || data.turn_id || "");
        const currentScope = threadId === this.codexState.threadId && (!this.codexState.turnId || !eventTurnId || eventTurnId === this.codexState.turnId);
        if (this.codexState.busy && currentScope && replayKey) {
            const item = recordValue(data.item);
            const eventType = String(data.type || "");
            if (type === "agent_event" && item.id && (eventType === "item.started" || eventType === "item.updated")) this.codexReplayActiveItems.add(replayKey);
            if (type === "agent_event" && item.id && eventType === "item.completed") this.codexReplayActiveItems.delete(replayKey);
            if (type === "agent_event" && (eventType === "turn.completed" || eventType === "error")) this.clearReplayActiveTurn(threadId, eventTurnId);
            const replayData = this.replaySnapshot(replayKey, data);
            this.codexReplayEvents.set(replayKey, { type, payload: { ...replayData, replayed: true } });
            while (this.codexReplayEvents.size > 240) {
                const evictable = [...this.codexReplayEvents.keys()].find((key) => !this.codexReplayActiveItems.has(key));
                if (!evictable) break;
                this.codexReplayEvents.delete(evictable);
            }
        }
        this.emitAll(type, data);
    }

    /** 为断线重连保存完整的最新文本快照，实时连接仍只接收增量。 */
    private replaySnapshot(replayKey: string, data: Record<string, unknown>) {
        if (data.type !== "item.updated" && data.type !== "item.completed") return data;
        const item = recordValue(data.item);
        if (!item.id) return data;
        const previous = recordValue(recordValue(this.codexReplayEvents.get(replayKey)?.payload).item);
        const delta = String(item.delta || "");
        if (!delta) return data;
        const previousText = String(previous.text || "");
        const { delta: _delta, ...snapshotItem } = item;
        return { ...data, item: { ...previous, ...snapshotItem, text: `${previousText}${delta}` } };
    }

    private clearReplayActiveTurn(threadId: string, turnId: string) {
        const prefix = `item:${turnId}:`;
        this.codexReplayActiveItems.forEach((key) => {
            if (key.startsWith(prefix)) this.codexReplayActiveItems.delete(key);
        });
        if (!turnId) return;
        this.codexReplayActiveItems.forEach((key) => {
            const event = this.codexReplayEvents.get(key);
            const eventThreadId = String(event?.payload.threadId || event?.payload.thread_id || "");
            const eventTurnId = String(event?.payload.turnId || event?.payload.turn_id || "");
            if (eventThreadId === threadId && eventTurnId === turnId) this.codexReplayActiveItems.delete(key);
        });
    }

    /** 校验工具参数并将调用分派到当前目标网页。 */
    async callTool(name: unknown, rawInput: unknown) {
        if (!isToolName(name)) throw new Error(`未知工具：${String(name)}`);
        logger.info("MCP tool called", { name, input: rawInput, targetClientId: this.targetClientId });
        const input = parseToolInput(name, rawInput) as Record<string, unknown>;
        if (name === "local_assets_search") return await this.localAssets.search(input as { keyword?: string; kind?: "all" | "image" | "video" | "audio" });
        if (name === "canvas_import_local_assets") return await this.importLocalAssets(input as { assetIds: string[]; x?: number; y?: number });
        if (SITE_TOOLS.has(name)) {
            if (!this.clients.size) throw new Error("当前没有已连接网页");
            const operationId = name === "assets_add" ? this.canvasOperationId(name, input) : undefined;
            return await this.requestCanvasTool(name, input, operationId);
        }
        const readTool = ["canvas_get_state", "canvas_get_selection", "canvas_export_snapshot"].includes(name);
        if (readTool && (!this.clients.size || !this.canvasState)) throw new Error("当前没有已连接画布");
        if (name === "canvas_get_state" || name === "canvas_export_snapshot") return compactCanvasState(this.canvasState);
        if (name === "canvas_get_selection") {
            const ids = new Set(this.canvasState?.selectedNodeIds || []);
            return { nodes: (this.canvasState?.nodes || []).filter((node) => ids.has(node.id)).map(compactNode) };
        }
        const operationId = this.canvasOperationId(name, input);
        if (name === "canvas_create_attachment_nodes") return await this.createAttachmentNodes(input as { attachmentIds: string[]; x?: number; y?: number; gap?: number; direction?: "row" | "column" }, operationId);
        if (!this.clients.size) throw new Error("当前没有已连接画布");
        const request = buildCanvasToolRequest(name, input, this.canvasState, operationId);
        return await this.requestCanvasTool(request.name, request.input, operationId);
    }

    private canvasOperationId(name: ToolName, input: Record<string, unknown>) {
        const scope = this.codexState.busy && this.codexState.turnId
            ? `${this.codexState.threadId}\0${this.codexState.turnId}`
            : crypto.randomUUID();
        const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])])) : value;
        const digest = crypto.createHash("sha256").update(JSON.stringify({ scope, name, input: stable(input) })).digest("hex").slice(0, 48);
        return `agent_${digest}`;
    }

    /** 解析本地素材临时 ID，并把导入请求交给当前网页创建节点。 */
    private async importLocalAssets(input: { assetIds: string[]; x?: number; y?: number }) {
        if (!this.clients.size) throw new Error("当前没有已连接画布");
        const ids = Array.from(new Set(input.assetIds || []));
        if (!ids.length) throw new Error("请先提供要导入的 assetIds");
        const assets = [];
        for (const id of ids) assets.push((await this.localAssets.resolve(id)).asset);
        const operationId = this.canvasOperationId("canvas_import_local_assets", input);
        return await this.requestCanvasTool(
            "canvas_import_local_assets",
            { assets, x: Number(input.x ?? nextCanvasX(this.canvasState)), y: Number(input.y ?? 0), projectId: this.canvasStates.get(this.targetClientId)?.projectId },
            { operationId, localAssetIds: ids },
        );
    }

    /** 将当前 turn 的附件转换为画布图片节点。 */
    private async createAttachmentNodes(input: { attachmentIds: string[]; x?: number; y?: number; gap?: number; direction?: "row" | "column" }, operationId: string) {
        const clientId = this.targetClientId;
        if (!this.clients.has(clientId)) throw new Error("当前没有已连接画布");
        const attachments = input.attachmentIds.map((id) => this.getTurnAttachment(clientId, id));
        const x = Number(input.x ?? nextCanvasX(this.canvasState));
        const y = Number(input.y ?? 0);
        const gap = Number(input.gap ?? 40);
        const direction = input.direction || "row";
        let offset = 0;
        const nodes = attachments.map((attachment) => {
            const size = fitAttachmentNodeSize(attachment.width, attachment.height);
            const node = {
                id: `image-${crypto.createHash("sha256").update(`${operationId}\0${attachment.id}`).digest("hex").slice(0, 24)}`,
                attachmentId: attachment.id,
                title: attachment.name,
                position: { x: direction === "row" ? x + offset : x, y: direction === "column" ? y + offset : y },
                width: size.width,
                height: size.height,
            };
            offset += (direction === "row" ? size.width : size.height) + gap;
            return node;
        });
        await this.requestCanvasTool("canvas_create_attachment_nodes", { nodes }, operationId);
        return { nodes: nodes.map(({ id, attachmentId, title }) => ({ id, attachmentId, title })) };
    }

    /** 向目标网页发送工具请求并等待调用结果。 */
    private async requestCanvasTool(name: ToolName, input: Record<string, unknown>, operationId?: string | { operationId?: string; localAssetIds?: string[] }) {
        const options = typeof operationId === "string" ? { operationId } : operationId || {};
        const requestId = crypto.randomUUID();
        const clientId = this.targetClientId;
        const client = this.clients.get(clientId);
        if (!client) throw new Error("当前没有已连接画布");
        logger.debug("Canvas tool request sent", { requestId, name, input, clientId });
        return await new Promise((resolve, reject) => {
            const binding = this.toolScope.getStore();
            let timer: ReturnType<typeof setTimeout> | null = null;
            const item: PendingRequest = {
                clientId,
                localAssetIds: options.localAssetIds,
                projectId: this.canvasStates.get(clientId)?.projectId,
                binding,
                state: "idle",
                resolve: (value) => {
                    if (timer) clearTimeout(timer);
                    item.state = "completed";
                    this.pending.delete(requestId);
                    const isCurrent = binding && this.mcpConnections.getBinding(binding.sessionId)?.revision === binding.revision;
                    if (binding && isCurrent) this.syncConnectionExecutionState(binding.sessionId, "completed", binding.revision);
                    resolve(value);
                },
                reject: (error) => {
                    if (timer) clearTimeout(timer);
                    // 保持 unknown，不要被 reject 回调覆盖为 failed
                    if (item.state !== "unknown") {
                        item.state = "failed";
                        this.pending.delete(requestId);
                        const isCurrent = binding && this.mcpConnections.getBinding(binding.sessionId)?.revision === binding.revision;
                        if (binding && isCurrent) this.syncConnectionExecutionState(binding.sessionId, "failed", binding.revision);
                    }
                    reject(error);
                },
            };
            this.pending.set(requestId, item);

            timer = setTimeout(() => {
                const current = this.pending.get(requestId);
                logger.warn("Canvas tool request timed out", { requestId, name, clientId, state: current?.state });
                if (current) {
                    const isCurrent = binding && this.mcpConnections.getBinding(binding.sessionId)?.revision === binding.revision;
                    // pending timeout 中未执行请求与执行中请求分开，只有已执行才 unknown
                    if (current.state === "executing") {
                        current.state = "unknown";
                        if (binding && isCurrent) this.syncConnectionExecutionState(binding.sessionId, "unknown", binding.revision);
                        logger.warn("Executing tool entered unknown state due to timeout", { requestId });
                    } else {
                        current.state = "failed";
                        this.pending.delete(requestId);
                        if (binding && isCurrent) this.syncConnectionExecutionState(binding.sessionId, "failed", binding.revision);
                    }
                }
                reject(new Error("画布操作超时"));
            }, 30000);

            sendEvent(client, "tool_call", { requestId, name, input, projectId: item.projectId, ...(options.operationId ? { operationId: options.operationId } : {}) });
        });
    }
}

/** 为运行中 turn 的可重放事件生成稳定键。 */
function codexReplayKey(type: string, payload: Record<string, unknown>) {
    const turnId = String(payload.turnId || payload.turn_id || "");
    if (type === "chat_message") {
        const message = recordValue(payload.message);
        const clientMessageId = String(message.clientMessageId || "");
        if (clientMessageId) return `chat:${clientMessageId}`;
        const messageId = String(message.itemId || message.id || "");
        return messageId ? `chat:${turnId}:${messageId}` : "";
    }
    if (type === "agent_error") return `error:${turnId}`;
    if (type !== "agent_event") return "";
    const item = recordValue(payload.item);
    if (item.id) return `item:${turnId}:${String(item.id)}`;
    const eventType = String(payload.type || "");
    if (eventType === "plan.updated") return `plan:${turnId}`;
    if (eventType === "usage.updated") return `usage:${turnId}`;
    if (eventType === "turn.completed" || eventType === "error") return `${eventType}:${turnId}`;
    return "";
}

function recordValue(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 向 SSE 连接写入一个事件。 */
function sendEvent(res: ServerResponse, type: string, payload: unknown) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}
/** 将未知数值转换为正数，否则使用默认值。 */
function positiveNumber(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}
