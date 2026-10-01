// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, it } from "bun:test";

import * as canvasSync from "./local-canvas-sync";

describe("buildLocalCanvasSyncPayload", () => {
    it("only sends changed canvases with the last canonical snapshots", () => {
        const build = (canvasSync as Record<string, unknown>).buildLocalCanvasSyncPayload as (
            current: Array<{ id: string; title: string }>,
            canonical: Array<{ id: string; title: string }>,
        ) => { projects: Array<{ id: string; title: string }>; expectedProjects: Record<string, { id: string; title: string } | null> };

        expect(typeof build).toBe("function");
        expect(
            build(
                [
                    { id: "changed", title: "new title" },
                    { id: "unchanged", title: "same title" },
                    { id: "created", title: "new canvas" },
                ],
                [
                    { id: "changed", title: "old title" },
                    { id: "unchanged", title: "same title" },
                ],
            ),
        ).toEqual({
            projects: [
                { id: "changed", title: "new title" },
                { id: "created", title: "new canvas" },
            ],
            expectedProjects: {
                changed: { id: "changed", title: "old title" },
                created: null,
            },
        });
    });

    it("builds delete expectations from canonical projects instead of edited local state", () => {
        const build = (canvasSync as Record<string, unknown>).buildLocalCanvasDeleteExpectations as (ids: string[], canonical: Array<{ id: string; title: string }>) => Record<string, { id: string; title: string } | null>;

        expect(typeof build).toBe("function");
        expect(build(["canvas-a", "not-created"], [{ id: "canvas-a", title: "canonical title" }])).toEqual({
            "canvas-a": { id: "canvas-a", title: "canonical title" },
            "not-created": null,
        });
    });
});

describe("shared canvas refresh policy", () => {
    it("does not replace the active canvas baseline underneath an open canvas tab", () => {
        const shouldRefresh = (canvasSync as Record<string, unknown>).shouldRefreshSharedCanvasProjects as (activeCanvasId: string | null) => boolean;
        expect(typeof shouldRefresh).toBe("function");
        expect(shouldRefresh("open-canvas")).toBe(false);
        expect(shouldRefresh(null)).toBe(true);
    });
});

describe("conflict draft asset retention", () => {
    it("includes recovery projects when collecting projects that still reference media", () => {
        const includeDrafts = (canvasSync as Record<string, unknown>).includeLocalCanvasConflictDraftProjects as <T extends { id: string }>(
            projects: T[],
            drafts: Array<{ project: T }>,
        ) => T[];
        expect(typeof includeDrafts).toBe("function");
        const original = { id: "other-project", title: "active" };
        const draft = { id: "deleted-project", title: "recoverable" };
        expect(includeDrafts([original], [{ project: draft }])).toEqual([original, draft]);
    });
});

describe("local canvas conflict drafts", () => {
    it("keeps a rejected same-canvas edit recoverable after a page reload", () => {
        const saveDraft = (canvasSync as Record<string, unknown>).saveLocalCanvasConflictDraft as (
            storage: MemoryStorage,
            project: { id: string; title: string; nodes: Array<{ id: string }> },
            savedAt: string,
            draftId: string,
        ) => void;
        const listDrafts = (canvasSync as Record<string, unknown>).listLocalCanvasConflictDrafts as (
            storage: MemoryStorage,
            canvasId: string,
        ) => Array<{ draftId: string; savedAt: string; project: { id: string; title: string; nodes: Array<{ id: string }> } }>;

        expect(typeof saveDraft).toBe("function");
        expect(typeof listDrafts).toBe("function");

        const values = new Map<string, string>();
        const beforeReload = new MemoryStorage(values);
        const conflictedProject = { id: "same-canvas", title: "tab two edits", nodes: [{ id: "unsaved-node" }] };
        saveDraft(beforeReload, conflictedProject, "2026-09-29T10:00:00.000Z", "tab-two-draft");

        const afterReload = new MemoryStorage(values);
        expect(listDrafts(afterReload, "same-canvas")).toEqual([
            { draftId: "tab-two-draft", savedAt: "2026-09-29T10:00:00.000Z", project: conflictedProject },
        ]);
        expect(listDrafts(afterReload, "another-canvas")).toEqual([]);
    });

    it("backs up changed snapshots while leaving unchanged projects out of the conflict draft", () => {
        const saveDrafts = (canvasSync as Record<string, unknown>).saveLocalCanvasConflictDrafts as (
            storage: MemoryStorage,
            currentProjects: Array<{ id: string; title: string }>,
            canonicalProjects: Array<{ id: string; title: string }>,
        ) => Array<{ project: { id: string; title: string } }>;
        const listDrafts = (canvasSync as Record<string, unknown>).listLocalCanvasConflictDrafts as (
            storage: MemoryStorage,
            canvasId?: string,
        ) => Array<{ project: { id: string; title: string } }>;
        expect(typeof saveDrafts).toBe("function");

        const storage = new MemoryStorage(new Map());
        saveDrafts(
            storage,
            [
                { id: "same-canvas", title: "unsaved tab edits" },
                { id: "unchanged-canvas", title: "same" },
            ],
            [
                { id: "same-canvas", title: "canonical winner" },
                { id: "unchanged-canvas", title: "same" },
            ],
        );

        expect(listDrafts(storage).map((draft) => draft.project)).toEqual([{ id: "same-canvas", title: "unsaved tab edits" }]);
    });

    it("replaces the earlier draft for the same canvas so the newest blocked edits stay recoverable", () => {
        const saveDraft = (canvasSync as Record<string, unknown>).saveLocalCanvasConflictDraft as (
            storage: MemoryStorage,
            project: { id: string; title: string },
            savedAt: string,
            draftId: string,
        ) => { draftId: string };
        const listDrafts = (canvasSync as Record<string, unknown>).listLocalCanvasConflictDrafts as (
            storage: MemoryStorage,
            canvasId: string,
        ) => Array<{ draftId: string; project: { id: string; title: string } }>;

        const storage = new MemoryStorage(new Map());
        const first = saveDraft(storage, { id: "same-canvas", title: "first edits" }, "2026-09-29T10:00:00.000Z", "same-draft");
        const latest = saveDraft(storage, { id: "same-canvas", title: "latest edits" }, "2026-09-29T10:01:00.000Z", "new-draft-id");

        expect(latest.draftId).toBe(first.draftId);
        expect(listDrafts(storage, "same-canvas")).toHaveLength(1);
        expect(listDrafts(storage, "same-canvas")[0]?.project.title).toBe("latest edits");
    });

    it("turns a conflict draft into a new independent project without changing its nodes", () => {
        const createRecoveryProject = (canvasSync as Record<string, unknown>).createLocalCanvasRecoveryProject as (
            project: {
                id: string;
                title: string;
                createdAt: string;
                updatedAt: string;
                importKey?: string;
                xiajiProjectAssetId?: string;
                autoTitlePending?: boolean;
                pendingAgentRequest?: unknown;
                nodes: Array<{ id: string }>;
            },
            id: string,
            restoredAt: string,
        ) => Record<string, unknown>;

        expect(typeof createRecoveryProject).toBe("function");
        const project = {
            id: "same-canvas",
            title: "当前项目",
            createdAt: "2026-09-28T08:00:00.000Z",
            updatedAt: "2026-09-29T10:00:00.000Z",
            importKey: "source-project",
            xiajiProjectAssetId: "bound-asset",
            autoTitlePending: true,
            pendingAgentRequest: { prompt: "do not replay" },
            nodes: [{ id: "unsaved-node" }],
        };

        expect(createRecoveryProject(project, "recovered-canvas", "2026-09-29T10:05:00.000Z")).toEqual({
            ...project,
            id: "recovered-canvas",
            title: "当前项目（恢复副本）",
            createdAt: "2026-09-29T10:05:00.000Z",
            updatedAt: "2026-09-29T10:05:00.000Z",
            importKey: undefined,
            xiajiProjectAssetId: undefined,
            autoTitlePending: false,
            pendingAgentRequest: undefined,
        });
    });
});

class MemoryStorage {
    constructor(private readonly values: Map<string, string>) {}

    get length() {
        return this.values.size;
    }

    key(index: number) {
        return Array.from(this.values.keys())[index] ?? null;
    }

    getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string) {
        this.values.set(key, value);
    }

    removeItem(key: string) {
        this.values.delete(key);
    }
}
