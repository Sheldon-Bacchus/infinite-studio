// SPDX-License-Identifier: AGPL-3.0-or-later

export type LocalStudioCanvasBindingSource = {
    id: string;
    xiajiProjectAssetId?: string;
};

export function isLocalStudioCanvasBound(canvas: LocalStudioCanvasBindingSource, projectAssetId: string): boolean {
    return Boolean(projectAssetId.trim()) && canvas.xiajiProjectAssetId === projectAssetId;
}

export type LocalStudioCanvasBinding =
    | { status: "unbound" }
    | { status: "bound"; canvasId: string }
    | { status: "conflict"; canvasIds: string[] };

export type EnsureLocalStudioProjectCanvasDependencies = {
    refresh: () => Promise<LocalStudioCanvasBindingSource[]>;
    create: (title: string, projectAssetId: string) => string;
    save: (canvasId: string, projectAssetId: string) => Promise<unknown>;
};


export function resolveLocalStudioCanvasBinding(
    projects: LocalStudioCanvasBindingSource[],
    projectAssetId: string,
): LocalStudioCanvasBinding {
    const canvasIds = projects
        .filter((project) => project.xiajiProjectAssetId === projectAssetId)
        .map((project) => project.id)
        .sort();

    if (!canvasIds.length) return { status: "unbound" };
    if (canvasIds.length > 1) return { status: "conflict", canvasIds };
    return { status: "bound", canvasId: canvasIds[0] };
}

/** Create one project canvas, then confirm the canonical binding from persisted state. */
export async function ensureLocalStudioProjectCanvasBinding(
    projectAssetId: string,
    title: string,
    dependencies: EnsureLocalStudioProjectCanvasDependencies,
): Promise<string> {
    const canonicalProjectAssetId = projectAssetId.trim();
    if (!canonicalProjectAssetId) throw new Error("虾料项目 ID 不能为空");

    const existingProjects = await dependencies.refresh();
    const existingBinding = resolveLocalStudioCanvasBinding(existingProjects, canonicalProjectAssetId);
    if (existingBinding.status === "conflict") {
        throw new Error(`项目已关联多个画布：${existingBinding.canvasIds.join("、")}。请先处理重复绑定。`);
    }
    if (existingBinding.status === "bound") return existingBinding.canvasId;

    const canvasId = dependencies.create(title, canonicalProjectAssetId);
    if (!canvasId.trim()) throw new Error("创建项目画布没有返回画布 ID");
    try {
        await dependencies.save(canvasId, canonicalProjectAssetId);
        const savedProjects = await dependencies.refresh();
        const savedBinding = resolveLocalStudioCanvasBinding(savedProjects, canonicalProjectAssetId);
        if (savedBinding.status === "bound") return savedBinding.canvasId;
        if (savedBinding.status === "conflict") {
            throw new Error(`项目已关联多个画布：${savedBinding.canvasIds.join("、")}。请先处理重复绑定。`);
        }
        throw new Error("画布保存后未确认唯一项目绑定");
    } catch (saveError) {
        const canonicalProjects = await dependencies.refresh().catch(() => null);
        const canonicalBinding = canonicalProjects
            ? resolveLocalStudioCanvasBinding(canonicalProjects, canonicalProjectAssetId)
            : null;
        if (canonicalBinding?.status === "bound") return canonicalBinding.canvasId;
        if (canonicalBinding?.status === "conflict") {
            throw new Error(`项目已关联多个画布：${canonicalBinding.canvasIds.join("、")}。请先处理重复绑定。`);
        }
        throw new Error(`画布保存结果待确认；请刷新项目后核验，不能重复新建。${saveError instanceof Error ? ` ${saveError.message}` : ""}`);
    }
}

