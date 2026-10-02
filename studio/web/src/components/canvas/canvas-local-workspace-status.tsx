import { App } from "antd";

import { isLocalWorkspaceMode } from "@/services/api/local-workspace";
import { discardAndReloadLocalCanvasProject, retryLocalCanvasProject, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { discardAndReloadLocalWorkspaceAsset, retryLocalWorkspaceAsset, useAssetStore } from "@/stores/use-asset-store";
import { useLocalWorkspaceStore } from "@/stores/use-local-workspace-store";

export function CanvasLocalWorkspaceStatus({ recordId, recordType = "canvas" }: { recordId?: string; recordType?: "canvas" | "asset" }) {
    const { message, modal } = App.useApp();
    const connection = useLocalWorkspaceStore((state) => state.connection);
    const workspace = useLocalWorkspaceStore((state) => state.workspace);
    const saves = useLocalWorkspaceStore((state) => state.saves);
    const saveEntry = recordId
        ? [`${recordType}:${recordId}`, saves[`${recordType}:${recordId}`]] as const
        : Object.entries(saves).find(([, item]) => item.phase === "error" || item.phase === "conflict" || item.phase === "saving" || item.phase === "dirty");
    const saveKey = saveEntry?.[0];
    const save = saveEntry?.[1];
    const targetType = recordId ? recordType : saveKey?.startsWith("asset:") ? "asset" : "canvas";
    const targetId = recordId || (saveKey ? saveKey.slice(targetType.length + 1) : undefined);

    if (!isLocalWorkspaceMode) return null;

    const label = connection !== "ready"
        ? connection === "loading" || connection === "idle" ? "工作区连接中" : "工作区未连接"
        : save?.phase === "saving" ? "正在保存"
          : save?.phase === "dirty" ? "有未保存更改"
            : save?.phase === "conflict" ? "版本冲突，草稿已保留"
              : save?.phase === "error" ? "保存失败，草稿已保留"
                : save?.phase === "saved" ? "已保存" : "工作区已连接";
    const retry = async () => {
        if (connection === "error" || connection === "unavailable") {
            try {
                await useLocalWorkspaceStore.getState().connect();
                if (!useCanvasStore.getState().hydrated) await useCanvasStore.persist.rehydrate();
                if (!useAssetStore.getState().hydrated) await useAssetStore.persist.rehydrate();
            } catch (error) {
                message.error(error instanceof Error ? error.message : "工作区重连失败");
            }
            return;
        }
        if (!targetId || save?.phase !== "error") return;
        try {
            if (targetType === "asset") await retryLocalWorkspaceAsset(targetId);
            else await retryLocalCanvasProject(targetId);
            message.success("工作区保存成功");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "工作区保存失败");
        }
    };
    const discardConflict = () => {
        if (!targetId) return;
        modal.confirm({
            title: "放弃本地冲突草稿？",
            content: `这会丢弃此${targetType === "canvas" ? "画布" : "素材"}在当前浏览器中尚未保存的修改，并重新读取本地工作区的最新版本。`,
            okText: "丢弃并重载",
            okButtonProps: { danger: true },
            cancelText: "继续保留草稿",
            onOk: async () => {
                try {
                    let reloaded = true;
                    if (targetType === "asset") await discardAndReloadLocalWorkspaceAsset(targetId);
                    else reloaded = await discardAndReloadLocalCanvasProject(targetId);
                    message.success(reloaded ? "已重新读取工作区版本" : "工作区画布已删除；本地草稿已放弃");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "读取工作区版本失败；本地草稿仍保留");
                    throw error;
                }
            },
        });
    };

    return (
        <div className="flex min-w-0 flex-col text-[11px] leading-4 opacity-75" title={workspace ? `${workspace.dataRoot}\nworkspaceId: ${workspace.workspaceId}${save?.message ? `\n${save.message}` : ""}` : save?.message || undefined}>
            <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span>{label}</span>
                {connection === "error" || connection === "unavailable" ? <button type="button" className="underline underline-offset-2 hover:opacity-75" onClick={() => void retry()}>重连</button> : null}
                {connection === "ready" && save?.phase === "error" && targetId ? <button type="button" className="underline underline-offset-2 hover:opacity-75" onClick={() => void retry()}>重试保存</button> : null}
                {connection === "ready" && save?.phase === "conflict" && targetId ? <button type="button" className="underline underline-offset-2 hover:opacity-75" onClick={discardConflict}>放弃草稿并重载</button> : null}
            </div>
            {workspace ? <span className="max-w-48 truncate">{workspace.dataRoot}</span> : null}
            {workspace ? <span className="max-w-48 truncate font-mono">workspaceId: {workspace.workspaceId}</span> : null}
        </div>
    );
}
