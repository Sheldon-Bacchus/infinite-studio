// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, it } from "bun:test";

import * as navigation from "./canvas-project-navigation";

describe("canvas project navigation", () => {
    it("resolves one project by exact canvas id and never falls back to another id", () => {
        const resolve = (navigation as Record<string, unknown>).resolveCanvasProjectById as <T extends { id: string }>(projects: T[], id: string) => T | null;
        expect(typeof resolve).toBe("function");
        const first = { id: "canvas-a", title: "A" };
        const second = { id: "canvas-b", title: "B" };
        expect(resolve([first, second], "canvas-b")).toBe(second);
        expect(resolve([first, second], "missing")).toBe(null);
    });

    it("reopens the requested existing canvas id without creating or merging a project", () => {
        const open = (navigation as Record<string, unknown>).openExistingCanvasProject as (id: string, navigate: (path: string) => void) => void;
        expect(typeof open).toBe("function");

        const projectIds = ["canvas-a", "canvas-b"];
        const routes: string[] = [];
        open("canvas-b", (path) => routes.push(path));

        expect(routes).toEqual(["/canvas/canvas-b"]);
        expect(projectIds).toEqual(["canvas-a", "canvas-b"]);
    });

    it("creates a fresh id only for the new-project entry and opens that exact id", () => {
        const createAndOpen = (navigation as Record<string, unknown>).createAndOpenCanvasProject as (
            title: string,
            createProject: (title: string) => string,
            navigate: (path: string) => void,
        ) => string;
        expect(typeof createAndOpen).toBe("function");

        const projectIds = ["canvas-a", "canvas-b"];
        const routes: string[] = [];
        let createCalls = 0;
        const createdId = createAndOpen(
            "new project",
            () => {
                createCalls += 1;
                const newId = "canvas-c";
                projectIds.unshift(newId);
                return newId;
            },
            (path) => routes.push(path),
        );

        expect(createCalls).toBe(1);
        expect(createdId).toBe("canvas-c");
        expect(routes).toEqual(["/canvas/canvas-c"]);
        expect(projectIds).toEqual(["canvas-c", "canvas-a", "canvas-b"]);
    });
});
