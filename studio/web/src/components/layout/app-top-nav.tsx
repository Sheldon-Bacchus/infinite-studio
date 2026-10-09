import { Bot, ListTodo, Menu } from "lucide-react";
import { Button, Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { discoverLocalAgentBootstrap } from "@/services/api/canvas-agent";
import { isLocalWorkspaceMode } from "@/services/api/local-workspace";
import { TaskCenter } from "@/components/tasks/task-center";
import { useGenerationTaskStore } from "@/stores/use-generation-task-store";

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [taskCenterOpen, setTaskCenterOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const taskEntries = useGenerationTaskStore((state) => state.entries);
    const taskCount = taskEntries.filter((entry) => ["checking", "queued", "running", "needs_attention", "blocked"].includes(entry.task?.status || entry.status)).length;
    const hideHeader = /^\/sudio\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.path === `/${slug}`) ? (navigationTools.find((tool) => tool.path === `/${slug}`)!.slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || (!isLocalWorkspaceMode && !agentToken.trim())) return;
        autoConnectRef.current = true;
        void (async () => {
            const current = useAgentStore.getState();
            const localEndpoint = /^http:\/\/127\.0\.0\.1:1737[12]\/?$/.test(current.url);
            if (isLocalWorkspaceMode && localEndpoint) {
                const config = await discoverLocalAgentBootstrap();
                if (useAgentStore.getState().enabled) return;
                if (!config?.url || !config.token) {
                    current.setAgentState({ connectError: "未找到片场 Agent 配置，请在桌面服务管理器启动 Agent 后点击连接" });
                    return;
                }
                current.setAgentState({ url: config.url, token: config.token });
            }
            connectAgent({ silent: true });
        })();
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    useEffect(() => {
        const openTask = () => setTaskCenterOpen(true);
        window.addEventListener("infinite-studio:task-open", openTask);
        return () => window.removeEventListener("infinite-studio:task-open", openTask);
    }, []);

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                    <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-5 px-6">
                        <div className="flex min-w-0 items-center">
                            <Link to="/" className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <span
                                    className="size-5 shrink-0 bg-current"
                                    style={{
                                        mask: "url(/studio-logo.svg) center / contain no-repeat",
                                        WebkitMask: "url(/studio-logo.svg) center / contain no-repeat",
                                    }}
                                />
                                <span className="text-base font-medium">{t("meta.title")}</span>
                            </Link>

                            <button
                                type="button"
                                className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 md:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label={t("topNav.openMenu")}
                                title={t("topNav.menu")}
                            >
                                <Menu className="size-5" />
                            </button>

                            <nav className="hide-scrollbar ml-8 hidden h-14 min-w-0 items-center gap-7 overflow-x-auto md:flex">
                                {navigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={tool.path}
                                            className={cn(
                                                "relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                                                active
                                                    ? "font-medium text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100"
                                                    : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                            )}
                                        >
                                            <Icon className="size-4" />
                                            <span className="truncate">{t(`navigation.${tool.slug}`)}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                            <Tooltip title="任务中心">
                                <Button
                                    type="text"
                                    shape="circle"
                                    className="!h-8 !w-8 !min-w-8"
                                    icon={
                                        <span className="relative">
                                            <ListTodo className="size-4" />
                                            {taskCount > 0 && <span className="absolute -right-2 -top-2 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-4 text-white">{taskCount > 9 ? "9+" : taskCount}</span>}
                                        </span>
                                    }
                                    onClick={() => setTaskCenterOpen(true)}
                                    aria-label="任务中心"
                                />
                            </Tooltip>
                            <Tooltip title={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}>
                                <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")} />
                            </Tooltip>
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
            <TaskCenter open={taskCenterOpen} onClose={() => setTaskCenterOpen(false)} />
            {hideHeader && (
                <Button type="text" className="fixed right-4 top-4 z-30" icon={<ListTodo className="size-4" />} onClick={() => setTaskCenterOpen(true)} aria-label="任务中心">
                    任务{taskCount > 0 ? ` ${taskCount}` : ""}
                </Button>
            )}
        </>
    );
}
