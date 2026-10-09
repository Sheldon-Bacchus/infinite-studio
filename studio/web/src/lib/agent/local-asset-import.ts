import i18n from "@/i18n";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { audioMetadata, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { randomId } from "@/lib/utils";
import { fetchLocalAssetFile, validateLocalAssetImport, type AgentLocalAsset } from "@/services/api/canvas-agent";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import type { AgentCanvasContext } from "@/stores/use-agent-store";
import { CanvasNodeType } from "@/types/canvas";

const rt = (key: string, options?: Record<string, unknown>) => i18n.t(`agent.localAssets.${key}`, options);

/**
 * 把 local_assets_search 的 assetIds 导入当前片场画布。
 * 复用 uploadImage / uploadMediaFile：本地工作区模式下原件会写入 workspace-service files，
 * 返回持久 fileId 与 storageKey=file:ID，节点 metadata 直接带上，刷新或换浏览器不丢原件。
 */
export async function importLocalAssetNodes(
    endpoint: string,
    token: string,
    clientId: string,
    requestId: string,
    input: Record<string, unknown>,
    getContext: () => AgentCanvasContext | null,
): Promise<{ nodes: Array<{ id: string; assetId: string; title: string; kind: AgentLocalAsset["kind"]; fileId?: string }> }> {
    const projectId = String(input.projectId || "");
    const context = () => {
        const current = getContext();
        if (!current || current.snapshot.projectId !== projectId) throw new Error(rt("canvasChanged"));
        return current;
    };
    context();
    const assets = input.assets as AgentLocalAsset[];
    if (!Array.isArray(assets) || !assets.length) throw new Error(rt("noAssets"));

    const startX = Number(input.x) || 0;
    const startY = Number(input.y) || 0;
    const results: Array<{ id: string; assetId: string; title: string; kind: AgentLocalAsset["kind"]; fileId?: string; op: CanvasAgentOp }> = [];
    let offset = 0;
    for (const asset of assets) {
        context();
        const blob = await fetchLocalAssetFile(endpoint, token, clientId, requestId, asset.assetId);
        const id = `${asset.kind}-${randomId()}`;
        let width: number;
        let height: number;
        let metadata;
        if (asset.kind === "image") {
            const image = await uploadImage(blob);
            const size = fitNodeSize(image.width, image.height);
            width = size.width;
            height = size.height;
            metadata = imageMetadata(image);
            results.push({ id, assetId: asset.assetId, title: asset.fileName, kind: asset.kind, fileId: image.fileId, op: { type: "add_node", id, nodeType: asset.kind, title: asset.fileName, position: { x: startX + offset, y: startY }, width, height, metadata } });
        } else {
            const file = await uploadMediaFile(blob, asset.kind);
            const spec = NODE_DEFAULT_SIZE[asset.kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Audio];
            const size = asset.kind === "video" ? fitNodeSize(file.width || 1280, file.height || 720, spec.width, spec.width) : spec;
            width = size.width;
            height = size.height;
            metadata = asset.kind === "video" ? videoMetadata(file) : audioMetadata(file);
            results.push({ id, assetId: asset.assetId, title: asset.fileName, kind: asset.kind, fileId: file.fileId, op: { type: "add_node", id, nodeType: asset.kind, title: asset.fileName, position: { x: startX + offset, y: startY }, width, height, metadata } });
        }
        offset += width + 40;
    }

    // 沿用既有工具请求校验：过期、撤销授权或切换画布后不能继续写入。
    await validateLocalAssetImport(endpoint, token, clientId, requestId);
    context();
    await context().applyOpsAndPersist([...results.map((entry) => entry.op), { type: "select_nodes", ids: results.map((entry) => entry.id) }]);
    return { nodes: results.map(({ id, assetId, title, kind, fileId }) => ({ id, assetId, title, kind, fileId })) };
}

