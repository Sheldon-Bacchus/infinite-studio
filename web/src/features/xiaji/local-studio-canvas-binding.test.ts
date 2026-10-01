// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import * as localStudioCanvasBinding from "./local-studio-canvas-binding";
import { isLocalStudioCanvasBound, resolveLocalStudioCanvasBinding } from "./local-studio-canvas-binding";

type EnsureCanvasBinding = (
    projectAssetId: string,
    title: string,
    dependencies: {
        refresh: () => Promise<Array<{ id: string; xiajiProjectAssetId?: string }>>;
        create: (title: string, projectAssetId: string) => string;
        save: (canvasId: string, projectAssetId: string) => Promise<unknown>;
    },
) => Promise<string>;
const ensureCanvasBinding = (localStudioCanvasBinding as unknown as { ensureLocalStudioProjectCanvasBinding?: EnsureCanvasBinding }).ensureLocalStudioProjectCanvasBinding;

describe("local studio project canvas creation", () => {
    test("exposes the save-and-readback binding operation used after project creation", () => {
        expect(ensureCanvasBinding).toBeTypeOf("function");
    });

    test("creates and verifies one canvas for a newly saved project", async () => {
        expect(ensureCanvasBinding).toBeTypeOf("function");
        if (!ensureCanvasBinding) return;
        let projects: Array<{ id: string; xiajiProjectAssetId?: string }> = [];
        let createCalls = 0;
        let saveCalls = 0;
        const canvasId = await ensureCanvasBinding("project-1", "剧本 · 虾画", {
            refresh: async () => projects,
            create: (title, projectAssetId) => {
                createCalls += 1;
                expect(title).toBe("剧本 · 虾画");
                expect(projectAssetId).toBe("project-1");
                return "canvas-1";
            },
            save: async (id, projectAssetId) => {
                saveCalls += 1;
                projects = [{ id, xiajiProjectAssetId: projectAssetId }];
            },
        });

        expect(canvasId).toBe("canvas-1");
        expect(createCalls).toBe(1);
        expect(saveCalls).toBe(1);
    });

    test("reuses the canonical canvas without creating a duplicate", async () => {
        expect(ensureCanvasBinding).toBeTypeOf("function");
        if (!ensureCanvasBinding) return;
        let createCalls = 0;
        const canvasId = await ensureCanvasBinding("project-1", "剧本 · 虾画", {
            refresh: async () => [{ id: "canonical", xiajiProjectAssetId: "project-1" }],
            create: () => { createCalls += 1; return "unexpected"; },
            save: async () => { throw new Error("must not save"); },
        });

        expect(canvasId).toBe("canonical");
        expect(createCalls).toBe(0);
    });

    test("recovers the canonical canvas after an ambiguous save response", async () => {
        expect(ensureCanvasBinding).toBeTypeOf("function");
        if (!ensureCanvasBinding) return;
        let projects: Array<{ id: string; xiajiProjectAssetId?: string }> = [];
        const canvasId = await ensureCanvasBinding("project-1", "剧本 · 虾画", {
            refresh: async () => projects,
            create: () => "candidate",
            save: async (id, projectAssetId) => {
                projects = [{ id, xiajiProjectAssetId: projectAssetId }];
                throw new Error("response lost");
            },
        });

        expect(canvasId).toBe("candidate");
    });

    test("does not retry creation when persistence cannot be confirmed", async () => {
        expect(ensureCanvasBinding).toBeTypeOf("function");
        if (!ensureCanvasBinding) return;
        let createCalls = 0;
        await expect(ensureCanvasBinding("project-1", "剧本 · 虾画", {
            refresh: async () => [],
            create: () => { createCalls += 1; return "candidate"; },
            save: async () => { throw new Error("offline"); },
        })).rejects.toThrow("不能重复新建");
        expect(createCalls).toBe(1);
    });
});

describe("canonical local studio canvas binding", () => {
    test("resolves a canvas only by the explicit project asset ID", () => {
        expect(resolveLocalStudioCanvasBinding([
            { id: "same-title", xiajiProjectAssetId: "another-project" },
            { id: "bound-canvas", xiajiProjectAssetId: "project-1" },
        ], "project-1")).toEqual({ status: "bound", canvasId: "bound-canvas" });
    });

    test("returns unbound when no canvas carries the project ID", () => {
        expect(resolveLocalStudioCanvasBinding([{ id: "unrelated" }], "project-1")).toEqual({ status: "unbound" });
    });

    test("surfaces duplicate bindings instead of choosing a canvas arbitrarily", () => {
        expect(resolveLocalStudioCanvasBinding([
            { id: "canvas-b", xiajiProjectAssetId: "project-1" },
            { id: "canvas-a", xiajiProjectAssetId: "project-1" },
        ], "project-1")).toEqual({ status: "conflict", canvasIds: ["canvas-a", "canvas-b"] });
    });

    test("requires every canvas import to match its canonical Xiaji project ID", () => {
        expect(isLocalStudioCanvasBound({ id: "canvas-1", xiajiProjectAssetId: "project-1" }, "project-1")).toBe(true);
        expect(isLocalStudioCanvasBound({ id: "canvas-1" }, "project-1")).toBe(false);
        expect(isLocalStudioCanvasBound({ id: "canvas-1", xiajiProjectAssetId: "project-2" }, "project-1")).toBe(false);
    });
});
