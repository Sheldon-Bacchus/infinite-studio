import { useCallback, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import i18n from "@/i18n";
import { useAgentStore } from "@/stores/use-agent-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { isAgentCanvasTargetReady } from "@/lib/canvas/canvas-agent-target";
import { isLocalWorkspaceMode } from "@/services/api/local-workspace";
import { flushLocalCanvasProject, getLocalCanvasProjectSaveInfo, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useLocalWorkspaceStore } from "@/stores/use-local-workspace-store";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;
type AgentUndoState = { projectLoadKey: string; snapshot: CanvasAgentSnapshot };
const startedAgentGenerations = new Set<string>();

type AgentBridgeParams = {
    projectId: string;
    projectLoadKey: string;
    projectLoadKeyRef: MutableRefObject<string>;
    projectReady: boolean;
    projectReadyRef: MutableRefObject<boolean>;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

/**
 * Bridge between the canvas and local Agent: publish the current snapshot and apply/undo capabilities
 * to the Agent store for the local Codex panel. All members except applyAgentOps are internal.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { projectId, projectLoadKey, projectLoadKeyRef, projectReady, projectReadyRef, title, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const localWorkspaceId = useLocalWorkspaceStore((state) => state.workspace?.workspaceId);
    const canvasRevision = useLocalWorkspaceStore((state) => state.saves[`canvas:${projectId}`]?.revision ?? undefined);
    const [agentUndoState, setAgentUndoState] = useState<AgentUndoState | null>(null);
    const agentUndoSnapshot = agentUndoState?.projectLoadKey === projectLoadKey ? agentUndoState.snapshot : null;
    const projectTitle = title || i18n.t("canvas.project.untitled");
    const isProjectReady = useCallback(() => isAgentCanvasTargetReady(projectLoadKey, projectLoadKeyRef.current, projectReadyRef.current), [projectLoadKey, projectLoadKeyRef, projectReadyRef]);
    const assertProjectReady = useCallback(() => {
        if (!isProjectReady()) throw new Error("画布尚未恢复完成或目标已切换，已拒绝 Agent 操作");
    }, [isProjectReady]);

    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport, ...(isLocalWorkspaceMode ? { workspaceId: localWorkspaceId, canvasRevision } : {}) }), [canvasRevision, connections, localWorkspaceId, projectTitle, nodes, projectId, selectedNodeIds, viewport]);
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[], operationId?: string, deferGeneration = false) => {
            assertProjectReady();
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
                operationId,
            );
            if (deferGeneration && operationId && generationOps.length) {
                const targets = new Set(generationOps.filter((op) => before.nodes.find((node) => node.id === op.nodeId)?.metadata?.agentOperationId !== operationId).map((op) => op.nodeId));
                if (targets.size) next.nodes = next.nodes.map((node) => targets.has(node.id) ? { ...node, metadata: { ...node.metadata, agentOperationId: operationId } } : node);
            }
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoState({ projectLoadKey, snapshot: before });
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length && !deferGeneration) {
                queueMicrotask(() => {
                    if (!isProjectReady()) return;
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    });
                });
            }
            return { ...next, projectId, title: projectTitle };
        },
        [assertProjectReady, projectLoadKey, projectTitle, projectId],
    );
    const applyAgentOpsAndPersist = useCallback(async (ops?: CanvasAgentOp[], operationId?: string) => {
        assertProjectReady();
        const previousNodes = nodesRef.current;
        const previousConnections = connectionsRef.current;
        const previousViewport = viewportRef.current;
        const safeOps = (Array.isArray(ops) ? ops : []).filter((op) => op?.type);
        const hasCanonicalOps = safeOps.some((op) => op?.type !== "select_nodes");
        const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op?.type === "run_generation" && Boolean(op.nodeId));
        const shouldStartGeneration = (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            const key = operationId ? `${projectLoadKey}\0${operationId}\0${nodeId}` : "";
            if (!operationId || node?.metadata?.agentOperationId !== operationId) return true;
            return node.metadata.status === "idle" && !startedAgentGenerations.has(key);
        };
        const generationToStart = generationOps.filter((op) => shouldStartGeneration(op.nodeId));
        const startGenerations = () => generationToStart.forEach((op) => {
            if (!isProjectReady()) return;
            const key = operationId ? `${projectLoadKey}\0${operationId}\0${op.nodeId}` : "";
            if (key) startedAgentGenerations.add(key);
            queueMicrotask(() => {
                if (!isProjectReady()) {
                    if (key) startedAgentGenerations.delete(key);
                    return;
                }
                const target = nodesRef.current.find((node) => node.id === op.nodeId);
                const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
            });
        });
        const result = applyAgentOps(ops, operationId, true);
        if (!isLocalWorkspaceMode) {
            startGenerations();
            return result;
        }
        const workspace = useLocalWorkspaceStore.getState().workspace;
        if (result.nodes === previousNodes && result.connections === previousConnections && result.viewport === previousViewport) {
            const save = useLocalWorkspaceStore.getState().saves[`canvas:${projectId}`];
            try {
                if ((operationId && hasCanonicalOps) || (save && ["dirty", "saving", "error", "conflict"].includes(save.phase))) await flushLocalCanvasProject(projectId, hasCanonicalOps ? operationId : undefined);
                const info = getLocalCanvasProjectSaveInfo(projectId);
                startGenerations();
                return { ...result, ...(workspace ? { workspaceId: workspace.workspaceId } : {}), canvasRevision: info.revision ?? undefined, operationId: hasCanonicalOps ? operationId || info.operationId || undefined : undefined, persisted: true, persistenceStatus: "persisted" as const };
            } catch (error) {
                const info = getLocalCanvasProjectSaveInfo(projectId);
                return { ...result, ...(workspace ? { workspaceId: workspace.workspaceId } : {}), canvasRevision: info.revision ?? undefined, operationId: info.operationId || operationId, persisted: false, persistenceStatus: "applied-not-persisted" as const, persistenceError: error instanceof Error ? error.message : "本地工作区保存失败" };
            }
        }
        try {
            useCanvasStore.getState().updateProject(projectId, { nodes: result.nodes, connections: result.connections, viewport: result.viewport }, operationId);
            const write = await flushLocalCanvasProject(projectId, operationId);
            startGenerations();
            return { ...result, workspaceId: write.workspaceId, canvasRevision: write.revision, operationId: write.operationId, persisted: true, persistenceStatus: "persisted" as const };
        } catch (error) {
            const info = getLocalCanvasProjectSaveInfo(projectId);
            return {
                ...result,
                ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
                canvasRevision: info.revision ?? undefined,
                operationId: info.operationId ?? undefined,
                persisted: false,
                persistenceStatus: "applied-not-persisted" as const,
                persistenceError: error instanceof Error ? error.message : "本地工作区保存失败",
            };
        }
    }, [applyAgentOps, assertProjectReady, isProjectReady, projectId, projectLoadKey]);
    const undoAgentOps = useCallback(() => {
        if (!isProjectReady() || !agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoState(null);
        return { ...agentUndoSnapshot, projectId, title: projectTitle };
    }, [agentUndoSnapshot, isProjectReady, projectTitle, projectId]);

    useEffect(() => setAgentUndoState(null), [projectLoadKey]);

    useEffect(() => {
        if (!projectReady || !isProjectReady()) {
            setAgentCanvasContext(null);
            return;
        }
        setAgentCanvasContext({ snapshot: agentSnapshot, applyOps: applyAgentOps, applyOpsAndPersist: applyAgentOpsAndPersist, undoOps: undoAgentOps, canUndo: Boolean(agentUndoSnapshot) });
        return () => setAgentCanvasContext(null);
    }, [agentSnapshot, applyAgentOps, applyAgentOpsAndPersist, agentUndoSnapshot, isProjectReady, projectReady, setAgentCanvasContext, undoAgentOps]);

    return { applyAgentOps };
}
