import localforage from "localforage";

export type LocalCanvasSyncPayload<T extends { id: string }> = {
    projects: T[];
    expectedProjects: Record<string, T | null>;
};

export type LocalCanvasConflictDraft<T extends { id: string }> = {
    draftId: string;
    savedAt: string;
    project: T;
};

const conflictDraftStore = localforage.createInstance({ name: "infinite-canvas", storeName: "canvas_conflict_drafts" });
const conflictDraftPrefix = "infinite-canvas:conflict-draft:v1:";

export function buildLocalCanvasSyncPayload<T extends { id: string }>(currentProjects: T[], canonicalProjects: T[] | null): LocalCanvasSyncPayload<T> {
    const canonicalById = new Map((canonicalProjects || []).map((project) => [project.id, project]));
    const projects: T[] = [];
    const expectedProjects: Record<string, T | null> = {};
    for (const project of currentProjects) {
        const canonical = canonicalById.get(project.id) || null;
        if (canonical && JSON.stringify(canonical) === JSON.stringify(project)) continue;
        projects.push(project);
        expectedProjects[project.id] = canonical;
    }
    return { projects, expectedProjects };
}

export function buildLocalCanvasDeleteExpectations<T extends { id: string }>(ids: string[], canonicalProjects: T[]) {
    const canonicalById = new Map(canonicalProjects.map((project) => [project.id, project]));
    return Object.fromEntries(ids.map((id) => [id, canonicalById.get(id) || null])) as Record<string, T | null>;
}

export function shouldRefreshSharedCanvasProjects(activeCanvasId: string | null) {
    return activeCanvasId === null;
}

export function includeLocalCanvasConflictDraftProjects<T extends { id: string }>(projects: T[], drafts: Array<{ project: T }>) {
    return [...projects, ...drafts.map((draft) => draft.project)];
}

export async function listLocalCanvasConflictDrafts<T extends { id: string }>(canvasId?: string) {
    const drafts: LocalCanvasConflictDraft<T>[] = [];
    const matchingPrefix = canvasId ? `${conflictDraftPrefix}${encodeURIComponent(canvasId)}:` : conflictDraftPrefix;
    await conflictDraftStore.iterate<unknown, void>((value, key) => {
        if (!key.startsWith(matchingPrefix)) return;
        try {
            const parsed = typeof value === "string" ? JSON.parse(value) as LocalCanvasConflictDraft<T> : value as LocalCanvasConflictDraft<T>;
            if (typeof parsed?.draftId === "string" && typeof parsed?.savedAt === "string" && parsed.project?.id) drafts.push(parsed);
        } catch {
            // Keep malformed recovery data untouched.
        }
    });
    return drafts.sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
}

export async function saveLocalCanvasConflictDrafts<T extends { id: string }>(currentProjects: T[], canonicalProjects: T[] | null) {
    const changedProjects = buildLocalCanvasSyncPayload(currentProjects, canonicalProjects).projects;
    const drafts: LocalCanvasConflictDraft<T>[] = [];
    for (const project of changedProjects) {
        const existing = await listLocalCanvasConflictDrafts<T>(project.id);
        const draft: LocalCanvasConflictDraft<T> = {
            draftId: existing[0]?.draftId || crypto.randomUUID(),
            savedAt: new Date().toISOString(),
            project,
        };
        await conflictDraftStore.setItem(localCanvasConflictDraftKey(project.id, draft.draftId), draft);
        await Promise.all(existing.slice(1).map((item) => removeLocalCanvasConflictDraft(project.id, item.draftId)));
        drafts.push(draft);
    }
    return drafts;
}

export async function removeLocalCanvasConflictDraft(canvasId: string, draftId: string) {
    await conflictDraftStore.removeItem(localCanvasConflictDraftKey(canvasId, draftId));
}

export function createLocalCanvasRecoveryProject<T extends { id: string; title: string; createdAt: string; updatedAt: string; importKey?: string; autoTitlePending?: boolean; pendingAgentRequest?: unknown }>(project: T, id: string, restoredAt: string): T {
    return {
        ...project,
        id,
        title: `${project.title}（恢复副本）`,
        createdAt: restoredAt,
        updatedAt: restoredAt,
        importKey: undefined,
        autoTitlePending: false,
        pendingAgentRequest: undefined,
    };
}

function localCanvasConflictDraftKey(canvasId: string, draftId: string) {
    return `${conflictDraftPrefix}${encodeURIComponent(canvasId)}:${encodeURIComponent(draftId)}`;
}
