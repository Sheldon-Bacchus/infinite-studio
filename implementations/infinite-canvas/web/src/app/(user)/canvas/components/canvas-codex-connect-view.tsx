"use client";

import { Button, Tooltip, Typography } from "antd";
import { Copy, MessageSquare, PlugZap } from "lucide-react";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { useCodexAgent } from "../agent/use-codex-agent";

const pluginCommand = "codex plugin marketplace add https://github.com/tigerowo/infinite-canvas.git\ncodex plugin add canvas-agent@infinite-canvas";

export function CanvasCodexConnectView({ agent, onChat }: {
    agent: Pick<ReturnType<typeof useCodexAgent>, "status" | "error" | "disconnect">;
    onChat: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const copyText = useCopyText();
    const connected = agent.status === "ready";
    const connecting = agent.status === "connecting";
    const statusText = { idle: "未连接", connecting: "连接中", ready: "已连接", error: "连接失败" }[agent.status];
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
            <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">网页连接</span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: theme.node.stroke, color: connected ? theme.node.text : theme.node.muted }}><span className="size-1.5 rounded-full bg-current" />{statusText}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>连接信息由 Codex 插件自动传入。</p>
                    </div>
                    <Button type="default" icon={<PlugZap className="size-4" />} disabled={!connected && !connecting} onClick={agent.disconnect}>
                        {connected || connecting ? "断开" : "等待 Codex 插件连接"}
                    </Button>
                </div>
                <div className="mt-3 grid gap-3">
                    {agent.error ? <Typography.Text type="danger" role="alert" className="!text-xs leading-5">{agent.error}</Typography.Text> : null}
                    {connected ? <Button type="primary" icon={<MessageSquare className="size-4" />} onClick={onChat}>进入 Codex 对话</Button> : null}
                </div>
            </div>
        </div>
    );
}
