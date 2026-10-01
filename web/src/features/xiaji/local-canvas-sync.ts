export type LocalCanvasSyncPayload<T extends { id: string }> = {
    projects: T[];
    expectedProjects: Record<string, T | null>;
};

export type LocalCanvasConflictDraft<T extends { id: string }> = {
    draftId: string;
    savedAt: string;
    project: T;
};

type LocalCanvasConflictStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const LOCAL_CANVAS_CONFLICT_DRAFT_PREFIX = "infinite-canvas:conflict-draft:v1:";

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

export function saveLocalCanvasConflictDraft<T extends { id: string }>(
    storage: LocalCanvasConflictStorage,
    project: T,
    savedAt = new Date().toISOString(),
    draftId = globalThis.crypto.randomUUID(),
) {
    const existingDrafts = listLocalCanvasConflictDrafts<T>(storage, project.id);
    const stableDraftId = existingDrafts[0]?.draftId || draftId;
    for (const existing of existingDrafts.slice(1)) removeLocalCanvasConflictDraft(storage, project.id, existing.draftId);
    const draft: LocalCanvasConflictDraft<T> = { draftId: stableDraftId, savedAt, project };
    storage.setItem(localCanvasConflictDraftKey(project.id, stableDraftId), JSON.stringify(draft));
    return draft;
}

export function saveLocalCanvasConflictDrafts<T extends { id: string }>(
    storage: LocalCanvasConflictStorage,
    currentProjects: T[],
    canonicalProjects: T[] | null,
) {
    const changedProjects = buildLocalCanvasSyncPayload(currentProjects, canonicalProjects).projects;
    return changedProjects.map((project) => saveLocalCanvasConflictDraft(storage, project));
}

export function listLocalCanvasConflictDrafts<T extends { id: string }>(storage: LocalCanvasConflictStorage, canvasId?: string) {
    const matchingPrefix = canvasId ? `${LOCAL_CANVAS_CONFLICT_DRAFT_PREFIX}${encodeURIComponent(canvasId)}:` : LOCAL_CANVAS_CONFLICT_DRAFT_PREFIX;
    const drafts: LocalCanvasConflictDraft<T>[] = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(matchingPrefix)) continue;
        const raw = storage.getItem(key);
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw) as LocalCanvasConflictDraft<T>;
            if (typeof parsed.draftId === "string" && typeof parsed.savedAt === "string" && parsed.project?.id) drafts.push(parsed);
        } catch {
            // Leave malformed recovery data untouched so the application never deletes a user's only copy.
        }
    }
    return drafts.sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
}

export function removeLocalCanvasConflictDraft(storage: LocalCanvasConflictStorage, canvasId: string, draftId: string) {
    storage.removeItem(localCanvasConflictDraftKey(canvasId, draftId));
}

export function createLocalCanvasRecoveryProject<
    T extends {
        id: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        importKey?: string;
        xiajiProjectAssetId?: string;
        autoTitlePending?: boolean;
        pendingAgentRequest?: unknown;
    },
>(project: T, id: string, restoredAt: string): T {
    return {
        ...project,
        id,
        title: `${project.title}（恢复副本）`,
        createdAt: restoredAt,
        updatedAt: restoredAt,
        importKey: undefined,
        xiajiProjectAssetId: undefined,
        autoTitlePending: false,
        pendingAgentRequest: undefined,
    };
}

function localCanvasConflictDraftKey(canvasId: string, draftId: string) {
    return `${LOCAL_CANVAS_CONFLICT_DRAFT_PREFIX}${encodeURIComponent(canvasId)}:${encodeURIComponent(draftId)}`;
}
