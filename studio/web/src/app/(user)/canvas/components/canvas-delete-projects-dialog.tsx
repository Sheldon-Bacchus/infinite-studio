"use client";

import { Button, Modal } from "antd";

import { deleteCanvasTasks } from "@/services/api/canvas-tasks";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const localWorkspaceError = useCanvasStore((state) => state.localWorkspaceError);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const confirm = async () => {
        try {
            await deleteProjects(ids);
        } catch {
            return;
        }
        void Promise.all(ids.map((id) => deleteCanvasTasks(id))).catch(() => undefined);
        cleanupImages();
        removeSelectedIds(ids);
        setDeleteIds([]);
    };

    return (
        <Modal
            title="删除画布？"
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>取消</Button>
                    <Button danger type="primary" onClick={() => void confirm()}>
                        删除
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">将删除 {ids.length} 个画布，里面的节点和连线也会一起移除。</p>
            {localWorkspaceError ? (
                <p role="alert" className="mt-3 text-sm text-red-600">
                    {localWorkspaceError}
                </p>
            ) : null}
        </Modal>
    );
}
