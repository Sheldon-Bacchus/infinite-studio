import { isLocalWorkspaceMode } from "@/services/api/local-workspace";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useLocalWorkspaceStore } from "@/stores/use-local-workspace-store";

export function CanvasLocalWorkspaceStatus({ recordId, recordType = "canvas" }: { recordId?: string; recordType?: "canvas" | "asset" }) {
    const connection = useLocalWorkspaceStore((state) => state.connection);
    const workspace = useLocalWorkspaceStore((state) => state.workspace);
    const saves = useLocalWorkspaceStore((state) => state.saves);
    const save = recordId ? saves[`${recordType}:${recordId}`] : Object.values(saves).find((item) => item.phase === "error" || item.phase === "conflict" || item.phase === "saving" || item.phase === "dirty");

    if (!isLocalWorkspaceMode) return null;

    const label = connection !== "ready"
        ? connection === "loading" || connection === "idle" ? "工作区连接中" : "工作区未连接"
        : save?.phase === "saving" ? "正在保存"
          : save?.phase === "dirty" ? "有未保存更改"
            : save?.phase === "conflict" ? "版本冲突，草稿已保留"
              : save?.phase === "error" ? "保存失败，草稿已保留"
                : save?.phase === "saved" ? "已保存" : "工作区已连接";
    const retry = () => {
        void useCanvasStore.persist.rehydrate();
        void useAssetStore.persist.rehydrate();
    };

    return (
        <div className="flex min-w-0 flex-col text-[11px] leading-4 opacity-75" title={workspace ? `${workspace.dataRoot}\nworkspaceId: ${workspace.workspaceId}${save?.message ? `\n${save.message}` : ""}` : save?.message || undefined}>
            <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span>{label}</span>
                {connection === "error" || connection === "unavailable" ? <button type="button" className="underline underline-offset-2 hover:opacity-75" onClick={retry}>重连</button> : null}
            </div>
            {workspace ? <span className="max-w-48 truncate">{workspace.dataRoot}</span> : null}
            {workspace ? <span className="max-w-48 truncate font-mono">workspaceId: {workspace.workspaceId}</span> : null}
        </div>
    );
}
