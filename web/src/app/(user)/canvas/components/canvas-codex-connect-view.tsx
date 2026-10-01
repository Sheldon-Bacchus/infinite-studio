"use client";

import { useEffect, useState } from "react";
import { Button, Input, Tooltip, Typography } from "antd";
import { Copy, KeyRound, Link2, MessageSquare, PlugZap } from "lucide-react";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CANVAS_AGENT_RUNTIME } from "../agent/agent-runtime-config";
import type { useCodexAgent } from "../agent/use-codex-agent";

const pluginCommand = `codex plugin marketplace add ${CANVAS_AGENT_RUNTIME.application.repository}.git\ncodex plugin add ${CANVAS_AGENT_RUNTIME.agentRuntime.pluginName}@infinite-canvas`;
const startCommand = `npx -y ${CANVAS_AGENT_RUNTIME.agentRuntime.packageSpecifier}`;

export function CanvasCodexConnectView({ agent, onChat }: {
    agent: Pick<ReturnType<typeof useCodexAgent>, "connection" | "status" | "error" | "connect" | "disconnect">;
    onChat: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const copyText = useCopyText();
    const [draft, setDraft] = useState(agent.connection);
    const connected = agent.status === "ready";
    const connecting = agent.status === "connecting";
    const statusText = { idle: "未连接", connecting: "连接中", ready: "已连接", error: "连接失败" }[agent.status];
    useEffect(() => setDraft(agent.connection), [agent.connection.endpoint, agent.connection.token]);
    const commandBlock = (command: string, label?: string) => (
        <div className="flex items-center gap-2 rounded-md border px-2.5 py-2" style={{ borderColor: theme.node.stroke }}>
            {label ? <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>{label}</span> : null}
            <code className="thin-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-pre text-[11px] leading-5">{command}</code>
            <Tooltip title="复制命令"><Button type="text" size="small" className="!size-6 !min-w-6 shrink-0" style={{ color: theme.node.muted }} icon={<Copy className="size-3.5" />} onClick={() => copyText(command, "命令已复制")} aria-label={label ? `复制${label}命令` : "复制命令"} /></Tooltip>
        </div>
    );
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-base font-semibold leading-6">连接本地 Agent</h2>
                <p className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>通过 Codex 插件连接画布。</p>
            </div>
            <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">统一 Agent 运行时</div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                        <span className="size-1.5 rounded-full bg-emerald-500" />唯一启用
                    </span>
                </div>
                <div className="grid gap-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                    <div><span className="opacity-65">应用主线：</span>{CANVAS_AGENT_RUNTIME.application.label} · {CANVAS_AGENT_RUNTIME.application.version}</div>
                    <div><span className="opacity-65">Agent 包：</span><code>{CANVAS_AGENT_RUNTIME.agentRuntime.packageSpecifier}</code></div>
                    <div><span className="opacity-65">MCP：</span><code>{CANVAS_AGENT_RUNTIME.agentRuntime.mcpServerName}</code> · 端口 {CANVAS_AGENT_RUNTIME.agentRuntime.defaultPort}</div>
                    <div><span className="opacity-65">协议：</span>{CANVAS_AGENT_RUNTIME.agentRuntime.transport}</div>
                </div>
                <p className="text-[11px] leading-5" style={{ color: theme.node.muted }}>
                    社区替代包不加载：{CANVAS_AGENT_RUNTIME.alternatives[0]?.packageName || "未配置"}。所有画布 Agent、Codex 插件和直接 MCP 均使用上面的唯一运行时。
                </p>
            </div>
            <div className="space-y-2 px-3 py-2.5">
                <h3 className="text-sm font-medium">方式一：在 Codex 中使用插件</h3>
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>安装本项目的 Infinite Canvas 插件后，让 Codex 打开并连接画布。插件会启动本地 Agent，并自动带入连接信息。</p>
                {commandBlock(pluginCommand)}
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>安装插件后新建 Codex 对话，说“帮我打开并连接到 Infinite Canvas”。</p>
            </div>
            <div className="space-y-2 rounded-lg border px-3 py-2.5" style={{ borderColor: theme.node.stroke }}>
                <div className="text-xs font-medium">Codex 插件提醒</div>
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>插件会启动本地 Agent 并自动传递连接信息。</p>
            </div>
            <div className="space-y-2 px-3 py-2.5">
                <h3 className="text-sm font-medium">方式二：直接运行 Agent</h3>
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>在终端运行以下命令，自动下载并启动 Agent。首次启动生成并保存 Token，以后运行同一命令即可。</p>
                {commandBlock(startCommand)}
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>首次直接连接可粘贴终端中的 Connect token，网页会自动记住；通过插件打开时无需手填。</p>
            </div>
            <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">网页连接</span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: theme.node.stroke, color: connected ? theme.node.text : theme.node.muted }}><span className="size-1.5 rounded-full bg-current" />{statusText}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>自动使用插件带入或已保存的连接信息，也可手动填写。</p>
                    </div>
                    <Button type={connected || connecting ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={async () => {
                        if (connected || connecting) agent.disconnect();
                        else if (await agent.connect(draft)) onChat();
                    }}>{connected || connecting ? "断开" : "连接"}</Button>
                </div>
                <div className="mt-3 grid gap-3">
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}><Link2 className="size-3.5" />本地地址 <span className="opacity-70">Local URL</span></span>
                        <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} aria-label="本地 Agent 地址" value={draft.endpoint} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))} placeholder={`http://127.0.0.1:${CANVAS_AGENT_RUNTIME.agentRuntime.defaultPort}`} />
                    </label>
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}><KeyRound className="size-3.5" />连接 Token <span className="opacity-70">Connect token</span></span>
                        <Input.Password size="large" prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />} aria-label="连接 Token" value={draft.token} onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))} placeholder="插件自动填入，或粘贴 Connect token" />
                    </label>
                    {agent.error ? <Typography.Text type="danger" role="alert" className="!text-xs leading-5">{agent.error}</Typography.Text> : null}
                    {connected ? <Button type="primary" icon={<MessageSquare className="size-4" />} onClick={onChat}>进入 Codex 对话</Button> : null}
                </div>
            </div>
        </div>
    );
}
