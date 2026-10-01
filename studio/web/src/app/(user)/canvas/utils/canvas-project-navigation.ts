export function resolveCanvasProjectById<T extends { id: string }>(projects: T[], id: string) {
    return projects.find((project) => project.id === id) || null;
}

export function openExistingCanvasProject(id: string, navigate: (path: string) => void) {
    const canvasId = id.trim();
    if (!canvasId) throw new Error("画布 ID 不能为空");
    navigate(`/canvas/${encodeURIComponent(canvasId)}`);
}

export function createAndOpenCanvasProject(title: string, createProject: (title: string) => string, navigate: (path: string) => void) {
    const id = createProject(title);
    if (!id.trim()) throw new Error("新建画布没有返回 ID");
    openExistingCanvasProject(id, navigate);
    return id;
}
