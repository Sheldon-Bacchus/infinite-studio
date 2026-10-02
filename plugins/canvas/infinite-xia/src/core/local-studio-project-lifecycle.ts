// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Asset } from "./asset-types";
import { getLocalStudioRecord } from "./local-studio-model";
import { listXiaTangProjectAssets } from "./xia-tang-local-model";

export function collectLocalStudioProjectAssetIds(assets: Asset[], projectAssetId: string): string[] {
    const project = assets.find((asset) => asset.id === projectAssetId);
    const projectRecord = project ? getLocalStudioRecord(project) : null;
    if (projectRecord?.recordType !== "project") return [];

    const includedIds = new Set<string>([projectAssetId]);
    for (const asset of assets) {
        const localStudio = getLocalStudioRecord(asset);
        const source = asset.metadata?.localStudioSource as { projectAssetId?: unknown } | undefined;
        if (localStudio && localStudio.recordType !== "project" && localStudio.projectAssetId === projectAssetId) {
            includedIds.add(asset.id);
        }
        if (
            source?.projectAssetId === projectAssetId ||
            (asset.id === projectRecord.sourceAssetId && asset.category === "xiaji:source" &&
                (source?.projectAssetId === undefined || source.projectAssetId === projectAssetId))
        ) {
            includedIds.add(asset.id);
        }
    }
    for (const asset of listXiaTangProjectAssets(assets, projectAssetId)) includedIds.add(asset.id);

    return assets.filter((asset) => includedIds.has(asset.id)).map((asset) => asset.id);
}

export type CanvasAssetReferenceSource = { id: string; title: string; nodes: unknown[]; xiajiProjectAssetId?: string };

function findAssetReferences(value: unknown, found = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
        for (const item of value) findAssetReferences(item, found);
    } else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
            const normalizedKey = key.toLowerCase();
            if (typeof item === "string" && (normalizedKey.endsWith("assetid") || normalizedKey === "sourceentityid")) {
                found.add(item);
            } else if (Array.isArray(item) && normalizedKey.endsWith("assetids")) {
                for (const id of item) if (typeof id === "string") found.add(id);
            }
            findAssetReferences(item, found);
        }
    }
    return found;
}

export function findCanvasReferencesToAssets(
    projects: CanvasAssetReferenceSource[],
    assetIds: ReadonlySet<string>,
) {
    return projects.flatMap((project) => {
        const canvasReferences = findAssetReferences(project.nodes);
        if (project.xiajiProjectAssetId) canvasReferences.add(project.xiajiProjectAssetId);
        const referencedAssetIds = [...assetIds].filter((id) => canvasReferences.has(id));
        return referencedAssetIds.length
            ? [{ canvasId: project.id, canvasTitle: project.title, assetIds: referencedAssetIds }]
            : [];
    });
}

export function findOtherStudioReferencesToAssets(
    assets: Asset[],
    projectAssetId: string,
    assetIds: ReadonlySet<string>,
): string[] {
    return [...new Set(assets.flatMap((asset) => {
        const record = getLocalStudioRecord(asset);
        if (!record) return [];
        if (record.recordType === "project") {
            return record.sourceAssetId && assetIds.has(record.sourceAssetId) && asset.id !== projectAssetId ? [asset.title] : [];
        }
        if (record.projectAssetId === projectAssetId) return [];
        return record.recordType === "beat" && record.referencedAssetIds.some((id) => assetIds.has(id)) ? [asset.title] : [];
    }))];
}

export type DeleteLocalStudioProjectDependencies = {
    getAssets: () => Asset[];
    listCanvasProjects: () => Promise<CanvasAssetReferenceSource[]>;
    deleteAssets: (ids: string[]) => Promise<unknown>;
    listAssets: () => Promise<Asset[]>;
};

export async function deleteLocalStudioProject(
    projectAssetId: string,
    dependencies: DeleteLocalStudioProjectDependencies,
): Promise<string[]> {
    const assets = dependencies.getAssets();
    const assetIds = collectLocalStudioProjectAssetIds(assets, projectAssetId);
    if (!assetIds.length) throw new Error("项目不存在或关联记录已经变化，请刷新后重试");

    const otherReferences = findOtherStudioReferencesToAssets(assets, projectAssetId, new Set(assetIds));
    if (otherReferences.length) {
        throw new Error(`项目素材仍被其他虾镜内容引用：${otherReferences.join("、")}。请先解除引用。`);
    }

    const canvasProjects = await dependencies.listCanvasProjects();
    const canvasReferences = findCanvasReferencesToAssets(canvasProjects, new Set(assetIds));
    if (canvasReferences.length) {
        throw new Error(`项目素材仍被画布引用：${canvasReferences.map((item) => item.canvasTitle).join("、")}。请先在画布解除引用。`);
    }

    await dependencies.deleteAssets(assetIds);
    const remaining = await dependencies.listAssets();
    const undeletedCount = assetIds.filter((id) => remaining.some((asset) => asset.id === id)).length;
    if (undeletedCount) throw new Error(`本地存储仍返回 ${undeletedCount} 条项目记录，删除未完成`);
    return assetIds;
}
