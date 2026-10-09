import { Fragment, useEffect, useState } from "react";
import { App, Button, Input, Select, Tooltip, theme as antdTheme } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { AlertTriangle, Copy, KeyRound, Link2, PlugZap, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore } from "@/stores/use-agent-store";
import { bindAgentConnection, getAgentConnections, type AgentConnectionStatus } from "@/services/api/canvas-agent";
import { getAgentLocalAssetDirectories, setAgentLocalAssetDirectories } from "@/services/api/canvas-agent";

const AGENT_PLUGIN_REMOVE_COMMAND = "codex plugin remove sudio";
const AGENT_MCP_REMOVE_COMMAND = "codex mcp remove sudio";

export function AgentConnectView({
    theme,
    clientId,
    url,
    token,
    enabled,
    connected,
    activity,
    connectError,
    onUrlChange,
    onTokenChange,
    onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    clientId: string;
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
}) {
    const { t } = useTranslation();
    const { message, modal } = App.useApp();
    const { token: tokenTheme } = antdTheme.useToken();
    const [connections, setConnections] = useState<AgentConnectionStatus | null>(null);
    const [selectedSession, setSelectedSession] = useState("");
    const [bindingError, setBindingError] = useState("");
    const [bindingBusy, setBindingBusy] = useState(false);

    const serviceAvailable = useAgentStore((state) => state.serviceAvailable);
    const historyReady = useAgentStore((state) => state.historyReady);
    const canvasSynced = useAgentStore((state) => state.canvasSynced);
    const canvasSyncReceipt = useAgentStore((state) => state.canvasSyncReceipt);
    const conversation = useAgentStore((state) => state.conversation);
    const canvasContext = useAgentStore((state) => state.canvasContext);

    const refreshConnections = async () => {
        try {
            setConnections(await getAgentConnections(url.replace(/\/$/, ""), token));
            setBindingError("");
        } catch (error) {
            setBindingError(error instanceof Error ? error.message : "读取连接失败");
        }
    };

    const bindConnection = async (takeover: boolean, force = false) => {
        setBindingBusy(true);
        try {
            await bindAgentConnection(url.replace(/\/$/, ""), token, selectedSession, clientId, takeover, force);
            await refreshConnections();
            message.success(takeover ? (force ? "已强制接管连接" : "已接管连接，旧租约已失效") : "已绑定所选 MCP 连接");
        } catch (error) {
            setBindingError(error instanceof Error ? error.message : "绑定失败");
        } finally {
            setBindingBusy(false);
        }
    };

    const confirmTakeover = () => {
        modal.confirm({
            title: "确认接管连接？",
            content: "该连接当前已被其他客户端绑定，接管将撤销其写入权限并将通道绑定到当前网页。",
            okText: "接管连接",
            cancelText: t("common.cancel"),
            onOk: () => bindConnection(true, false),
        });
    };

    const confirmForceTakeover = () => {
        modal.confirm({
            title: "确认强制接管连接？",
            content: "副作用可能已在后台发生，接管将强行释放原租约并建立新绑定。",
            okText: "强制接管",
            okType: "danger",
            cancelText: t("common.cancel"),
            onOk: () => bindConnection(true, true),
        });
    };

    useEffect(() => {
        let active = true;
        setConnections(null);
        setSelectedSession("");
        if (connected) {
            void getAgentConnections(url.replace(/\/$/, ""), token)
                .then((value) => {
                    if (active) setConnections(value);
                })
                .catch((error) => {
                    if (active) setBindingError(error instanceof Error ? error.message : "读取连接失败");
                });
        }
        return () => {
            active = false;
        };
    }, [connected, url, token]);

    const steps = [
        { title: t("agent.connect.pluginTitle"), text: t("agent.connect.pluginText") },
        { title: t("agent.connect.directTitle"), text: t("agent.connect.directText"), command: 'powershell -NoProfile -File "E:/all-agent-workspace/infinite-studio/canvas-agent/start-local.ps1"' },
    ];
    const statusText = connectError ? t("agent.status.failed") : connected ? activity : enabled ? t("agent.status.connecting") : t("agent.status.disconnected");
    const statusColor = connectError ? theme.node.text : theme.node.muted;
    const copyCommand = (command: string) => {
        copyToClipboard(command);
        message.success(t("agent.connect.commandCopied"));
    };
    const codexPluginReminder = (
        <div className="rounded-lg border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
            <div className="font-medium" style={{ color: theme.node.text }}>
                {t("agent.connect.pluginReminder")}
            </div>
            <div className="mt-1">{t("agent.connect.pluginReminderText")}</div>
            <div className="mt-2 grid gap-1.5">
                {[
                    [t("agent.connect.removePlugin"), AGENT_PLUGIN_REMOVE_COMMAND],
                    [t("agent.connect.removeMcp"), AGENT_MCP_REMOVE_COMMAND],
                ].map(([label, command]) => (
                    <div key={command} className="flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                        <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                            {label}
                        </span>
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                        <Tooltip title={t("agent.connect.copyCommand")}>
                            <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                        </Tooltip>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("agent.connect.title")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.connect.description")}
                    </div>
                </div>
                <div className="space-y-2">
                    {steps.map((step, index) => {
                        const command = "command" in step ? step.command : "";
                        return (
                            <Fragment key={step.title}>
                                <div className="rounded-lg px-3 py-2.5">
                                    <div className="text-sm font-medium leading-5">{step.title}</div>
                                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                        {step.text}
                                    </div>
                                    {command ? (
                                        <div className="mt-2 flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                                            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                                            <Tooltip title={t("agent.connect.copyCommand")}>
                                                <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                                            </Tooltip>
                                        </div>
                                    ) : null}
                                </div>
                                {index === 0 ? codexPluginReminder : null}
                            </Fragment>
                        );
                    })}
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">{t("agent.connect.webConnection")}</span>
                                <span
                                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4"
                                    style={{ borderColor: connected || enabled || connectError ? statusColor : theme.node.stroke, color: statusColor }}
                                >
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {t("agent.connect.autoDiscover")}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}
                        </Button>
                    </div>
                    <div className="mt-3 grid gap-2.5">
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <Link2 className="size-3.5" />
                                {t("agent.connect.localAddress")}
                                <span className="font-normal opacity-70">Local URL</span>
                            </span>
                            <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder={t("agent.connect.urlPlaceholder")} />
                            </label>
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <KeyRound className="size-3.5" />
                                {t("agent.connect.token")}
                                <span className="font-normal opacity-70">Connect token</span>
                            </span>
                            <Input.Password
                                size="large"
                                prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />}
                                value={token}
                                onChange={(event) => onTokenChange(event.target.value)}
                                placeholder={t("agent.connect.tokenPlaceholder")}
                            />
                        </label>
                        {connectError ? (
                            <div className="rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: tokenTheme.colorErrorBorder, color: tokenTheme.colorErrorText, background: tokenTheme.colorErrorBg }}>
                                {connectError}
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* 分阶段状态指示器 (T002) */}
                {url && token ? <LocalAssetDirectories url={url} token={token} theme={theme} /> : null}
                <div className="rounded-lg border p-3 space-y-2 text-xs" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex items-center justify-between">
                        <span className="font-semibold" style={{ color: theme.node.text }}>系统分阶段状态</span>
                        {connected ? (
                            <Button size="small" type="text" className="!h-6 !text-xs !px-1.5" icon={<RefreshCw className="size-3" />} onClick={() => void refreshConnections()}>
                                刷新
                            </Button>
                        ) : null}
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                        <div className="flex items-center justify-between py-1 border-b" style={{ borderColor: theme.node.stroke }}>
                            <span style={{ color: theme.node.muted }}>1. 服务可用性 (HTTP)</span>
                            <span className="flex items-center gap-1.5 font-medium">
                                <span className="size-2 rounded-full" style={{ background: serviceAvailable ? tokenTheme.colorSuccess : tokenTheme.colorError }} />
                                <span>{serviceAvailable ? "服务正常" : "未启动或不可用"}</span>
                            </span>
                        </div>
                        <div className="flex items-center justify-between py-1 border-b" style={{ borderColor: theme.node.stroke }}>
                            <span style={{ color: theme.node.muted }}>2. 网页长连接 (SSE)</span>
                            <span className="flex items-center gap-1.5 font-medium">
                                <span className="size-2 rounded-full" style={{ background: connected ? tokenTheme.colorSuccess : enabled ? tokenTheme.colorWarning : theme.node.muted }} />
                                <span>{connected ? "已建立" : enabled ? "连接中..." : "未连接"}</span>
                            </span>
                        </div>
                        <div className="flex items-center justify-between py-1 border-b" style={{ borderColor: theme.node.stroke }}>
                            <span style={{ color: theme.node.muted }}>3. MCP 服务状态</span>
                            <span className="flex items-center gap-1.5 font-medium">
                                <span
                                    className="size-2 rounded-full"
                                    style={{
                                        background: conversation.status === "ready"
                                            ? tokenTheme.colorSuccess
                                            : conversation.status === "warning"
                                                ? tokenTheme.colorWarning
                                                : conversation.status === "preparing"
                                                    ? tokenTheme.colorInfo
                                                    : conversation.status === "failed"
                                                        ? tokenTheme.colorError
                                                        : theme.node.muted,
                                    }}
                                />
                                <span>
                                    {conversation.status === "ready"
                                        ? "全部就绪"
                                        : conversation.status === "warning"
                                            ? "部分就绪"
                                            : conversation.status === "preparing"
                                                ? "正在启动"
                                                : conversation.status === "failed"
                                                    ? "启动失败"
                                                    : "空闲"}
                                    {Object.keys(conversation.mcpStatuses || {}).length ? ` (${Object.keys(conversation.mcpStatuses).length}个服务)` : ""}
                                </span>
                            </span>
                        </div>
                        <div className="flex items-center justify-between py-1 border-b" style={{ borderColor: theme.node.stroke }}>
                            <span style={{ color: theme.node.muted }}>4. 历史同步状态</span>
                            <span className="flex items-center gap-1.5 font-medium">
                                <span className="size-2 rounded-full" style={{ background: historyReady ? tokenTheme.colorSuccess : connected ? tokenTheme.colorWarning : theme.node.muted }} />
                                <span>{historyReady ? "已就绪" : connected ? "同步中..." : "未就绪"}</span>
                            </span>
                        </div>
                        <div className="flex items-center justify-between py-1">
                            <span style={{ color: theme.node.muted }}>5. 画布同步状态</span>
                            <span className="flex items-center gap-1.5 font-medium">
                                <span className="size-2 rounded-full" style={{ background: canvasSynced ? tokenTheme.colorSuccess : theme.node.muted }} />
                                <span>{canvasSynced ? "已同步" : "未同步"}</span>
                            </span>
                        </div>
                        {canvasSyncReceipt ? (
                            <div className="rounded border px-2 py-1 text-[11px] leading-relaxed" style={{ background: tokenTheme.colorSuccessBg, borderColor: tokenTheme.colorSuccessBorder, color: tokenTheme.colorSuccessText }}>
                                已同步当前画布「{canvasContext?.snapshot?.title || "未命名画布"}」状态
                            </div>
                        ) : canvasContext?.snapshot?.projectId ? (
                            <div className="rounded border px-2 py-1 text-[11px] leading-relaxed" style={{ background: tokenTheme.colorInfoBg, borderColor: tokenTheme.colorInfoBorder, color: tokenTheme.colorInfoText }}>
                                当前画布「{canvasContext?.snapshot?.title || "未命名画布"}」（等待同步）
                            </div>
                        ) : (
                            <div className="text-[11px]" style={{ color: theme.node.muted }}>
                                未打开具体画布
                            </div>
                        )}
                    </div>
                </div>

                {/* 画布与对话独占通道绑定 (T007, T008) */}
                {connected ? (
                    <div className="rounded-lg border p-3 space-y-3 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                        <div className="flex items-center justify-between">
                            <div className="font-semibold">画布与对话独占通道</div>
                            <Button size="small" type="text" className="!h-6 !text-xs !px-1.5" icon={<RefreshCw className="size-3" />} onClick={() => void refreshConnections()}>
                                刷新通道
                            </Button>
                        </div>
                        <div style={{ color: theme.node.muted }}>
                            在 Codex 对话中调用 <code>canvas_connection_status</code> 查看绑定码，并在下方选择对应的独占通道。
                        </div>

                        {connections ? (
                            <div className="space-y-2.5">
                                <Select
                                    className="w-full"
                                    placeholder="选择目标对话返回的 MCP 独占通道"
                                    value={selectedSession || undefined}
                                    onChange={setSelectedSession}
                                    options={connections.connections.map((item) => ({
                                        value: item.sessionId,
                                        label: `${item.bindCode ? `[${item.bindCode}] ` : ""}${item.label} (${item.revoked ? "已被接管" : item.binding ? (item.binding.clientId === clientId ? "已绑定当前网页" : "已绑定其他客户端") : "未绑定"})`,
                                    }))}
                                />

                                {selectedSession && (() => {
                                    const selected = connections.connections.find((c) => c.sessionId === selectedSession);
                                    if (!selected) return null;

                                    const currentProjectId = canvasSyncReceipt?.projectId || canvasContext?.snapshot?.projectId || "";
                                    const canvasOccupant = currentProjectId
                                        ? connections.connections.find((c) => (c.binding?.projectId === currentProjectId || c.binding?.clientId === clientId) && c.sessionId !== selected.sessionId && (!c.revoked || c.executionState === "unknown"))
                                        : undefined;

                                    const isBoundToCurrentCanvas = !selected.revoked && selected.binding?.clientId === clientId && Boolean(currentProjectId) && selected.binding?.projectId === currentProjectId;
                                    const isBoundToOther = Boolean(selected.binding && !isBoundToCurrentCanvas);

                                    const selectedExecuting = selected.executionState === "executing";
                                    const selectedUnknown = selected.executionState === "unknown";

                                    const occupantExecuting = canvasOccupant?.executionState === "executing";
                                    const occupantUnknown = canvasOccupant?.executionState === "unknown";

                                    const needsTakeover = Boolean(canvasOccupant || isBoundToOther);
                                    const isBlockedByExecuting = selectedExecuting || occupantExecuting;
                                    const needsForce = selectedUnknown || occupantUnknown;

                                    return (
                                        <div className="rounded border p-2.5 space-y-2" style={{ borderColor: theme.node.stroke }}>
                                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                                <div><span style={{ color: theme.node.muted }}>绑定码: </span><span className="font-mono font-medium">{selected.bindCode || "无"}</span></div>
                                                <div><span style={{ color: theme.node.muted }}>执行状态: </span>
                                                    <span
                                                        className="font-medium"
                                                        style={{
                                                            color: selectedExecuting
                                                                ? tokenTheme.colorWarning
                                                                : selectedUnknown
                                                                    ? tokenTheme.colorError
                                                                    : undefined,
                                                        }}
                                                    >
                                                        {selected.executionState === "executing"
                                                            ? "执行中"
                                                            : selected.executionState === "unknown"
                                                                ? "未知状态"
                                                                : selected.executionState || "空闲"}
                                                    </span>
                                                </div>
                                                <div className="col-span-2 truncate"><span style={{ color: theme.node.muted }}>通道名称: </span><span>{selected.label}</span></div>
                                                <div className="col-span-2">
                                                    <span style={{ color: theme.node.muted }}>当前绑定: </span>
                                                    <span>
                                                        {isBoundToCurrentCanvas
                                                            ? "已绑定到当前网页画布"
                                                            : selected.revoked
                                                                ? (selected.executionState === "unknown" ? "已撤销授权（原租约未知态保留）" : "已撤销授权")
                                                                : selected.binding
                                                                    ? (selected.binding.clientId === clientId
                                                                        ? "已绑定本网页其他画布"
                                                                        : "已绑定其他客户端")
                                                                    : "未绑定任何客户端"}
                                                    </span>
                                                </div>
                                                {canvasOccupant ? (
                                                    <div className="col-span-2" style={{ color: tokenTheme.colorWarningText }}>
                                                        <span style={{ color: theme.node.muted }}>当前画布占用者: </span>
                                                        <span>{canvasOccupant.bindCode ? `[${canvasOccupant.bindCode}] ` : ""}{canvasOccupant.label} ({canvasOccupant.revoked ? (canvasOccupant.executionState === "unknown" ? "已失效但保留租约" : "已失效") : canvasOccupant.executionState === "unknown" ? "未知状态" : canvasOccupant.executionState === "executing" ? "执行中" : "空闲"})</span>
                                                    </div>
                                                ) : null}
                                            </div>

                                            {selectedExecuting ? (
                                                <div className="rounded border px-2.5 py-1.5 text-xs flex items-center gap-2" style={{ background: tokenTheme.colorWarningBg, borderColor: tokenTheme.colorWarningBorder, color: tokenTheme.colorWarningText }}>
                                                    <AlertTriangle className="size-4 shrink-0" />
                                                    <span>所选通道正在执行写入操作，受租约保护，请等待写入执行完毕。</span>
                                                </div>
                                            ) : null}

                                            {occupantExecuting ? (
                                                <div className="rounded border px-2.5 py-1.5 text-xs flex items-center gap-2" style={{ background: tokenTheme.colorWarningBg, borderColor: tokenTheme.colorWarningBorder, color: tokenTheme.colorWarningText }}>
                                                    <AlertTriangle className="size-4 shrink-0" />
                                                    <span>当前画布占用者正在执行写入操作，受租约保护，无法接管，请等待操作结束。</span>
                                                </div>
                                            ) : null}

                                            {selectedUnknown ? (
                                                <div className="rounded border px-2.5 py-1.5 text-xs flex items-center gap-2" style={{ background: tokenTheme.colorErrorBg, borderColor: tokenTheme.colorErrorBorder, color: tokenTheme.colorErrorText }}>
                                                    <AlertTriangle className="size-4 shrink-0" />
                                                    <span>所选通道处于未知执行态（可能发生网络中断或超时），后台副作用可能已发生。如确认原操作已终止，请使用强制接管/绑定。</span>
                                                </div>
                                            ) : null}

                                            {occupantUnknown ? (
                                                <div className="rounded border px-2.5 py-1.5 text-xs flex items-center gap-2" style={{ background: tokenTheme.colorErrorBg, borderColor: tokenTheme.colorErrorBorder, color: tokenTheme.colorErrorText }}>
                                                    <AlertTriangle className="size-4 shrink-0" />
                                                    <span>当前画布占用者处于未知执行态，后台副作用可能已发生。接管将强行释放原租约并建立新绑定。</span>
                                                </div>
                                            ) : null}

                                            {canvasOccupant && !occupantExecuting && !occupantUnknown ? (
                                                <div className="rounded border px-2.5 py-1.5 text-xs flex items-center gap-2" style={{ background: tokenTheme.colorInfoBg, borderColor: tokenTheme.colorInfoBorder, color: tokenTheme.colorInfoText }}>
                                                    <span>当前画布已被【{canvasOccupant.bindCode || canvasOccupant.label}】占用，绑定所选通道将接管当前画布。</span>
                                                </div>
                                            ) : null}

                                            <div className="flex flex-wrap gap-2 pt-1">
                                                {isBoundToCurrentCanvas && !needsForce ? (
                                                    <span className="text-[11px] font-medium py-1" style={{ color: tokenTheme.colorSuccess }}>当前通道已正常独占当前画布</span>
                                                ) : isBlockedByExecuting ? (
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        disabled
                                                    >
                                                        {needsTakeover ? "接管连接（操作执行中）" : "绑定当前对话（操作执行中）"}
                                                    </Button>
                                                ) : needsForce ? (
                                                    <Button
                                                        type="primary"
                                                        danger
                                                        size="small"
                                                        loading={bindingBusy}
                                                        onClick={() => confirmForceTakeover()}
                                                    >
                                                        {needsTakeover ? "强制接管连接" : "强制重新绑定"}
                                                    </Button>
                                                ) : needsTakeover ? (
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        loading={bindingBusy}
                                                        onClick={() => confirmTakeover()}
                                                    >
                                                        接管连接
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        loading={bindingBusy}
                                                        onClick={() => void bindConnection(false)}
                                                    >
                                                        绑定当前对话
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        ) : null}

                        {bindingError ? (
                            <div className="rounded border px-2.5 py-2 text-xs leading-5" style={{ background: tokenTheme.colorErrorBg, borderColor: tokenTheme.colorErrorBorder, color: tokenTheme.colorErrorText }}>
                                {bindingError}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}


function LocalAssetDirectories({ url, token, theme }: { url: string; token: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [directories, setDirectories] = useState<string[]>([]);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const endpoint = url.replace(/\/$/, "");

    useEffect(() => {
        if (!endpoint || !token) return;
        let canceled = false;
        void getAgentLocalAssetDirectories(endpoint, token)
            .then((data) => {
                if (!canceled) setDirectories(Array.isArray(data.directories) ? data.directories : []);
            })
            .catch(() => undefined);
        return () => {
            canceled = true;
        };
    }, [endpoint, token]);

    const save = async (next: string[]) => {
        setBusy(true);
        try {
            const data = await setAgentLocalAssetDirectories(endpoint, token, next);
            setDirectories(Array.isArray(data.directories) ? data.directories : next);
            message.success(t("agent.localAssets.saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.localAssets.readFailed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-lg border p-3 space-y-2 text-xs" style={{ borderColor: theme.node.stroke }}>
            <div className="font-semibold" style={{ color: theme.node.text }}>{t("agent.localAssets.title")}</div>
            <div className="leading-5" style={{ color: theme.node.muted }}>{t("agent.localAssets.description")}</div>
            <div className="space-y-1.5">
                {directories.length ? (
                    directories.map((directory) => (
                        <div key={directory} className="flex items-center gap-2 rounded-md border px-2 py-1" style={{ borderColor: theme.toolbar.border }}>
                            <span className="min-w-0 flex-1 truncate" style={{ color: theme.node.text }} title={directory}>{directory}</span>
                            <Button size="small" type="text" className="!h-6 !px-1.5 !text-xs" disabled={busy} onClick={() => void save(directories.filter((item) => item !== directory))}>
                                {t("agent.localAssets.remove")}
                            </Button>
                        </div>
                    ))
                ) : (
                    <div style={{ color: theme.node.muted }}>{t("agent.localAssets.noDirectories")}</div>
                )}
            </div>
            <div className="flex items-center gap-2">
                <Input size="small" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("agent.localAssets.placeholder")} />
                <Button size="small" disabled={busy || !draft.trim()} onClick={() => void save([...directories, draft.trim()]).then(() => setDraft(""))}>
                    {t("agent.localAssets.add")}
                </Button>
            </div>
        </div>
    );
}
