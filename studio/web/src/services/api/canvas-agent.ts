import i18n from "@/i18n";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { AgentReasoningEffort } from "@/stores/use-agent-store";

type AgentConfigResponse = { ok?: boolean; protocolVersion?: number; url?: string; token?: string; hasToken?: boolean };
export type AgentConnectionStatus = {
    webAgentEnabled?: boolean;
    occupant?: string;
    connections: Array<{
        sessionId: string;
        bindCode?: string;
        label: string;
        revoked: boolean;
        executionState?: "executing" | "completed" | "failed" | "unknown" | "idle";
        binding?: { sessionId: string; bindCode?: string; clientId: string; projectId: string; revision: string };
    }>;
    clients: Array<{
        clientId: string;
        projectId: string;
        title: string;
        revision?: string;
    }>;
};

export type WebAgentSwitchResponse = { ok?: boolean; webAgentEnabled?: boolean; occupant?: string; error?: string };

export function getWebAgentSwitch(endpoint: string, token: string) {
    return fetchAgentJson<WebAgentSwitchResponse>(endpoint, token, "/api/agent/web-switch");
}

export function setWebAgentSwitch(endpoint: string, token: string, enabled: boolean) {
    return fetchAgentJson<WebAgentSwitchResponse>(endpoint, token, "/api/agent/web-switch", jsonPost({ enabled }));
}

export function getAgentConnections(endpoint: string, token: string) {
    return fetchAgentJson<AgentConnectionStatus>(endpoint, token, "/api/connections/status", jsonPost({}));
}

export function bindAgentConnection(endpoint: string, token: string, sessionId: string, clientId: string, takeover: boolean, force = false) {
    return fetchAgentJson(endpoint, token, "/api/connections/bind", jsonPost({ sessionId, clientId, takeover, force }));
}

export function validateAgentTool(endpoint: string, token: string, clientId: string, requestId: string) {
    return fetchAgentJson(endpoint, token, "/api/tools/validate", jsonPost({ clientId, requestId }));
}

export type AgentLocalAsset = { assetId: string; fileName: string; relativePath: string; directoryIndex: number; kind: "image" | "video" | "audio"; size: number };

export function getAgentLocalAssetDirectories(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; directories?: string[] }>(endpoint, token, "/agent/local-assets/settings");
}

export function setAgentLocalAssetDirectories(endpoint: string, token: string, directories: string[]) {
    return fetchAgentJson<{ ok?: boolean; directories?: string[] }>(endpoint, token, "/agent/local-assets/settings", jsonPost({ directories }));
}

/** 二次校验导入请求：目录授权已被撤销或切换画布后，服务端会拒绝。 */
export function validateLocalAssetImport(endpoint: string, token: string, clientId: string, requestId: string) {
    return fetchAgentJson<{ ok?: boolean; assetIds?: string[] }>(endpoint, token, `/agent/local-assets/requests/${encodeURIComponent(requestId)}?clientId=${encodeURIComponent(clientId)}`);
}

export async function fetchLocalAssetFile(endpoint: string, token: string, clientId: string, requestId: string, assetId: string) {
    const url = `${endpoint}/agent/local-assets/files/${encodeURIComponent(assetId)}?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}&requestId=${encodeURIComponent(requestId)}`;
    const res = await fetch(url);
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || i18n.t("apiErrors.localAssetReadFailed"));
    }
    return res.blob();
}

export type AgentDiagnosticResult = {
    serviceAvailable: boolean;
    tokenValid: boolean;
    detail: string;
};

export async function diagnoseAgentConnection(endpoint: string, token: string): Promise<AgentDiagnosticResult> {
    try {
        const health = await fetch(`${endpoint}/health`);
        if (!health.ok) {
            return {
                serviceAvailable: false,
                tokenValid: false,
                detail: `Agent 服务未运行或健康检查失败：HTTP ${health.status}（${endpoint}）`,
            };
        }
    } catch {
        return {
            serviceAvailable: false,
            tokenValid: false,
            detail: `无法访问 Agent 服务（${endpoint}），请确认后台服务已启动且端口无冲突`,
        };
    }

    try {
        const response = await fetch(`${endpoint}/api/connections/status`, {
            ...jsonPost({}),
            headers: { "content-type": "application/json", "x-canvas-agent-token": token },
        });
        if (response.status === 401) {
            return {
                serviceAvailable: true,
                tokenValid: false,
                detail: "连接 Token 无效，鉴权失败；请使用启动器提供的最新连接信息",
            };
        }
        if (response.status === 403) {
            return {
                serviceAvailable: true,
                tokenValid: false,
                detail: "请求被 Agent 服务拒绝（HTTP 403 权限不足或来源受限）",
            };
        }
        if (!response.ok) {
            return {
                serviceAvailable: true,
                tokenValid: false,
                detail: `Agent 连接检查失败：HTTP ${response.status}`,
            };
        }
        return {
            serviceAvailable: true,
            tokenValid: true,
            detail: "Agent 服务可用，Token 已通过；网页长连接未建立，请重新连接",
        };
    } catch (error) {
        return {
            serviceAvailable: true,
            tokenValid: false,
            detail: `Agent 服务健康检查已通过，但连接状态请求失败：${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
const AGENT_MESSAGE_ASSET_PATTERN = /^agent-asset:([a-f0-9]{64})\/([a-f0-9]{64}\.(?:gif|jpe?g|png|webp))$/;

export class AgentApiError<T = unknown> extends Error {
    constructor(readonly status: number, readonly response: T & { code?: string; error?: string; msg?: string }) {
        super(response.error || response.msg || i18n.t("agent.state.requestFailed"));
        this.name = "AgentApiError";
    }
}

export type AgentSkillScope = "user" | "repo" | "system" | "admin";
export type AgentSkillInterface = { displayName?: string | null; shortDescription?: string | null; defaultPrompt?: string | null };
export type AgentSkillSummary = {
    name: string;
    description: string;
    shortDescription?: string | null;
    interface?: AgentSkillInterface | null;
    dependencies?: unknown;
    path: string;
    scope: AgentSkillScope;
    enabled: boolean;
    managed: boolean;
};
export type AgentSkillDetail = {
    name: string;
    description: string;
    instructions: string;
    interface?: AgentSkillInterface | null;
    path: string;
    managed: true;
    revision: string;
};
export type AgentSkillInput = { name?: string; description: string; instructions: string; interface?: AgentSkillInterface | null; expectedRevision?: string };
export type AgentSkillDraft = { name: string; displayName: string; description: string; instructions: string; shortDescription: string; defaultPrompt: string };
export type AgentSkillDraftInput = { source: "conversation" | "canvas"; threadId: string; clientId: string; model?: string; effort?: AgentReasoningEffort };
export type AgentSkillsResponse = { ok?: boolean; data?: AgentSkillSummary[]; errors?: unknown[] };
export type AgentSkillResponse = { ok?: boolean; data?: AgentSkillDetail };
export type AgentSkillDraftResponse = { ok?: boolean; data?: AgentSkillDraft };

export type CanvasStateReceipt = { ok: boolean; clientId?: string; projectId?: string; revision?: string | number; error?: string };

export async function postState(endpoint: string, token: string, clientId: string, snapshot: CanvasAgentSnapshot | null, explicitRevision?: string): Promise<CanvasStateReceipt> {
    try {
        const revision = explicitRevision
            ?? (typeof snapshot?.canvasRevision === "number" ? String(snapshot.canvasRevision) : undefined)
            ?? (snapshot?.operationId ? String(snapshot.operationId) : undefined)
            ?? (snapshot?.projectId ? `rev-${crypto.randomUUID()}` : undefined);
        const response = await fetch(`${endpoint}/canvas/state?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(snapshot ? { ...snapshot, hasCanvas: true, revision } : { hasCanvas: false }),
        });
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
        const data = await response.json();
        return {
            ok: Boolean(data?.ok),
            clientId: data?.clientId,
            projectId: data?.projectId,
            revision: data?.revision !== undefined ? String(data.revision) : undefined,
        };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

export async function activateAgentClient(endpoint: string, token: string, clientId: string) {
    try {
        await fetch(`${endpoint}/canvas/activate?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, { method: "POST" });
    } catch {}
}

export async function postToolResult(endpoint: string, token: string, clientId: string, body: { requestId: string; result?: unknown; error?: string }) {
    await fetchAgentJson(endpoint, token, `/canvas/result?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function postCodexApproval(endpoint: string, token: string, requestId: string, decision: "accept" | "acceptForSession" | "decline") {
    await fetchAgentJson(endpoint, token, "/agent/codex/approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, decision }) });
}

export async function interruptCodexTurn(endpoint: string, token: string, threadId?: string) {
    await fetchAgentJson(endpoint, token, "/agent/codex/interrupt", jsonPost({ threadId }));
}

export async function acknowledgeCodexHistory(endpoint: string, token: string, threadId: string, turnIds: string[]) {
    await fetchAgentJson(endpoint, token, "/agent/codex/history/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId, turnIds }) });
}

export async function revealAgentLocalFile(endpoint: string, token: string, path: string) {
    await fetchAgentJson(endpoint, token, "/agent/local-file/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
}

export function resolveAgentMessageAssetUrl(endpoint: string, token: string, value: string) {
    const match = AGENT_MESSAGE_ASSET_PATTERN.exec(value);
    if (!match) return value.startsWith("agent-asset:") ? "" : value;
    const baseUrl = endpoint.trim().replace(/\/$/, "");
    return baseUrl && token ? `${baseUrl}/agent/message-assets/${match[1]}/${match[2]}?token=${encodeURIComponent(token)}` : "";
}

export function fetchCodexSkills(endpoint: string, token: string, forceReload = false) {
    return fetchAgentJson<AgentSkillsResponse>(endpoint, token, `/agent/codex/skills${forceReload ? "?forceReload=1" : ""}`);
}

export function fetchCodexSkill(endpoint: string, token: string, name: string) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}`);
}

export function createCodexSkill(endpoint: string, token: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, "/agent/codex/skills", jsonPost(input));
}

export function createCodexSkillDraft(endpoint: string, token: string, input: AgentSkillDraftInput) {
    return fetchAgentJson<AgentSkillDraftResponse>(endpoint, token, "/agent/codex/skills/draft", jsonPost(input));
}

export function updateCodexSkill(endpoint: string, token: string, name: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}`, jsonPost(input));
}

export function deleteCodexSkill(endpoint: string, token: string, name: string, expectedRevision: string) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}/delete`, jsonPost({ expectedRevision }));
}

export function setCodexSkillEnabled(endpoint: string, token: string, skill: Pick<AgentSkillSummary, "name" | "path">, enabled: boolean) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(skill.name)}/enabled`, jsonPost({ ...skill, enabled }));
}

export async function fetchAgentJson<T>(endpoint: string, token: string, path: string, init?: RequestInit) {
    const url = `${endpoint}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; msg?: string };
    if (!res.ok) throw new AgentApiError(res.status, data);
    return data;
}

export async function discoverAgentConfig(endpoint: string) {
    try {
        const res = await fetch(`${endpoint}/config`);
        if (!res.ok) return null;
        const data = (await res.json()) as AgentConfigResponse;
        return data.ok ? data : null;
    } catch {
        return null;
    }
}

export async function discoverLocalAgentBootstrap() {
    try {
        const res = await fetch("/api/local-agent/bootstrap", { cache: "no-store" });
        if (!res.ok) return null;
        const data = (await res.json()) as AgentConfigResponse;
        return data.ok ? data : null;
    } catch {
        return null;
    }
}

function jsonPost(body: unknown): RequestInit {
    return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
