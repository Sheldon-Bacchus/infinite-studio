// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { CanvasProject } from "../stores/use-canvas-store";
import { withStableCanvasImportIdentity } from "./import-identity";

const project = (overrides: Partial<CanvasProject> = {}) => ({
    id: "",
    title: "imported",
    createdAt: "",
    updatedAt: "",
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    agentConfig: null,
    autoTitlePending: false,
    backgroundMode: "lines" as const,
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    sidePanel: { open: true, width: 280 },
    agentPanel: { open: false, width: 464 },
    ...overrides,
}) as CanvasProject;

describe("withStableCanvasImportIdentity", () => {
    test("assigns the same identity despite volatile root timestamps", async () => {
        const source = project();
        const first = await withStableCanvasImportIdentity(source);
        const second = await withStableCanvasImportIdentity(project({ createdAt: "2026-09-23T12:00:00.000Z", updatedAt: "2026-09-24T12:00:00.000Z" }));

        expect(first.id).toBe(second.id);
        expect(first.importKey).toBe(second.importKey);
        expect(first.id).toMatch(/^imported-[a-f0-9]{24}$/);
        expect(first.importKey).toMatch(/^zip-project:[a-f0-9]{24}$/);
    });

    test("keeps the source ID but uses content identity as the import key", async () => {
        const result = await withStableCanvasImportIdentity(project({ id: "existing-project" }));

        expect(result.id).toBe("existing-project");
        expect(result.importKey).toMatch(/^zip-project:[a-f0-9]{24}$/);
        expect(result.importKey).not.toBe(result.id);
    });

    test("keeps distinct source IDs distinct", async () => {
        const first = await withStableCanvasImportIdentity(project({ id: "source-one" }));
        const second = await withStableCanvasImportIdentity(project({ id: "source-two" }));

        expect(first.importKey).not.toBe(second.importKey);
    });
});
