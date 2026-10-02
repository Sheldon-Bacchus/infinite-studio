// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";

import { deleteDramaSceneFile, fetchDramaSceneBuildTask, fetchDramaScenePlatePreview, fetchDramaSceneTask, fetchDramaScenes, startDramaSceneGeneration, startDramaSceneBuild, uploadDramaSceneFile } from "./drama-scenes";
import { useUserStore } from "@/stores/use-user-store";

const originalFetch = globalThis.fetch;
const originalUser = useUserStore.getState();

afterEach(() => {
    globalThis.fetch = originalFetch;
    useUserStore.setState(originalUser);
});

describe("DramaClaw scene API", () => {
    test("uses summary=true for the scene list and repeated names for detail reads", async () => {
        useUserStore.setState({ token: "canvas-token" });
        const requests: Array<{ url: string; method?: string; query?: string; headers?: unknown }> = [];
        const previousRequest = axios.request;
        axios.request = (async (config) => {
            const query = typeof config.paramsSerializer === "object" ? config.paramsSerializer.serialize?.(config.params) : undefined;
            requests.push({
                url: String(config.url),
                method: config.method,
                query,
                headers: config.headers,
            });
            return { data: { code: 0, data: [{ name: "旧车站", base_scene_id: "city", variant_id: "rain", master_url: "/api/v1/drama/media?url=x" }], msg: "ok" }, status: 200 } as never;
        }) as typeof axios.request;
        try {
            const summary = await fetchDramaScenes("project-a");
            const details = await fetchDramaScenes("project-a", { summary: false, names: ["旧车站", "雨夜版本"] });
            expect(summary[0].name).toBe("旧车站");
            expect(details[0].variant_id).toBe("rain");
        } finally {
            axios.request = previousRequest;
        }

        expect(requests.map(({ method, url, query }) => [method, url, query])).toEqual([
            ["GET", "/api/v1/drama/projects/project-a/scenes", "summary=true"],
            ["GET", "/api/v1/drama/projects/project-a/scenes", "names=%E6%97%A7%E8%BD%A6%E7%AB%99&names=%E9%9B%A8%E5%A4%9C%E7%89%88%E6%9C%AC&summary=false"],
        ]);
        expect(requests[0].headers).toMatchObject({ Authorization: "Bearer canvas-token" });
    });

    test("requests plate preview with source field names", async () => {
        const requests: Array<{ url: string; query?: string }> = [];
        const previousRequest = axios.request;
        axios.request = (async (config) => {
            const query = typeof config.paramsSerializer === "object" ? config.paramsSerializer.serialize?.(config.params) : undefined;
            requests.push({ url: String(config.url), query });
            return { data: { code: 0, data: { scene_id: "hall", resolved_scene_name: "hall__rain__night", render: { status: "time_baked" } }, msg: "ok" }, status: 200 } as never;
        }) as typeof axios.request;
        try {
            const preview = await fetchDramaScenePlatePreview("project-a", { scene_id: "hall", variant_id: "rain", time_of_day: "night" });
            expect(preview.render.status).toBe("time_baked");
        } finally {
            axios.request = previousRequest;
        }

        expect(requests).toEqual([
            {
                url: "/api/v1/drama/projects/project-a/scenes/plate-preview",
                query: "scene_id=hall&time_of_day=night&variant_id=rain",
            },
        ]);
    });

    test("keeps the source build task identity and refreshes status through the confirmed task route", async () => {
        const requests: Array<{ method?: string; url: string; body?: unknown }> = [];
        const previousRequest = axios.request;
        axios.request = (async (config) => {
            requests.push({ method: config.method, url: String(config.url), body: config.data });
            const data = config.url?.endsWith("/build") ? { ok: true, task_type: "build_scenes", task_id: "source-17" } : { task_type: "build_scenes", task_id: "source-17", status: "running", progress: 0.25 };
            return { data: { code: 0, data, msg: "ok" }, status: 200 } as never;
        }) as typeof axios.request;
        try {
            const started = await startDramaSceneBuild("project-a");
            const state = await fetchDramaSceneBuildTask("project-a");
            expect(started.task_id).toBe("source-17");
            expect(started.task_type).toBe("build_scenes");
            expect(started.status).toBeUndefined();
            expect(state).toMatchObject({ task_id: "source-17", task_type: "build_scenes", status: "running", progress: 0.25 });
        } finally {
            axios.request = previousRequest;
        }

        expect(requests).toEqual([
            { method: "POST", url: "/api/v1/drama/projects/project-a/scenes/build", body: {} },
            { method: "GET", url: "/api/v1/drama/projects/project-a/scenes/build-task", body: undefined },
        ]);
    });

    test("starts only source-confirmed scene master, reverse, pano and 3GS operations", async () => {
        const requests: Array<{ method?: string; url: string; body?: unknown }> = [];
        const previousRequest = axios.request;
        axios.request = (async (config) => {
            requests.push({ method: config.method, url: String(config.url), body: config.data });
            return { data: { code: 0, data: { task_type: "source-task", task_id: "upstream-9", scope: "source-scope", task_key: "source-key" }, msg: "ok" }, status: 200 } as never;
        }) as typeof axios.request;
        try {
            const master = await startDramaSceneGeneration("project-a", "旧车站", "master", { model: "image-selection" });
            await startDramaSceneGeneration("project-a", "旧车站", "reverse");
            await startDramaSceneGeneration("project-a", "旧车站", "pano", { source: "master" });
            await startDramaSceneGeneration("project-a", "旧车站", "3gs-master");
            await startDramaSceneGeneration("project-a", "旧车站", "3gs-reverse");
            await startDramaSceneGeneration("project-a", "旧车站", "3gs-pano");
            expect(master).toMatchObject({ task_type: "source-task", task_id: "upstream-9", scope: "source-scope", task_key: "source-key" });
        } finally {
            axios.request = previousRequest;
        }

        expect(requests).toEqual([
            { method: "POST", url: "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/generate/master", body: { model: "image-selection" } },
            { method: "POST", url: "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/generate/reverse", body: {} },
            { method: "POST", url: "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/generate/pano", body: { source: "master" } },
            { method: "POST", url: "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/generate/3gs-master", body: {} },
            { method: "POST", url: "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/generate/3gs-reverse", body: {} },
            { method: "POST", url: "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/generate/3gs-pano", body: {} },
        ]);
    });

    test("reads task state by scene operation and source identity, including source null", async () => {
        const requests: Array<{ url: string; query?: string }> = [];
        const previousRequest = axios.request;
        axios.request = (async (config) => {
            const query = typeof config.paramsSerializer === "object" ? config.paramsSerializer.serialize?.(config.params) : undefined;
            requests.push({ url: String(config.url), query });
            return { data: { code: 0, data: { task_type: "source-task", task_id: "upstream-9", scope: "source-scope", status: "running", progress: 0.5 }, msg: "ok" }, status: 200 } as never;
        }) as typeof axios.request;
        try {
            const task = await fetchDramaSceneTask("project-a", "旧车站", "pano", "master");
            expect(task).toMatchObject({ task_id: "upstream-9", status: "running", progress: 0.5 });
            await fetchDramaSceneTask("project-a", "旧车站", "3gs-pano");
        } finally {
            axios.request = previousRequest;
        }

        expect(requests).toEqual([
            { url: "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/tasks/pano", query: "source=master" },
            { url: "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/tasks/3gs-pano", query: "" },
        ]);
    });

    test("uploads each supported source file kind as authenticated multipart and deletes through source actions", async () => {
        useUserStore.setState({ token: "canvas-token" });
        const calls: Array<{ url: string; method?: string; body?: BodyInit | null; headers?: HeadersInit }> = [];
        const apiCalls: Array<{ url: string; method?: string }> = [];
        const previousRequest = axios.request;
        axios.request = (async (config) => {
            apiCalls.push({ url: String(config.url), method: config.method });
            return { data: { code: 0, data: { deleted: true }, msg: "ok" }, status: 200 } as never;
        }) as typeof axios.request;
        globalThis.fetch = (async (input, init) => {
            calls.push({ url: String(input), method: init?.method, body: init?.body, headers: init?.headers });
            return new Response(JSON.stringify({ code: 0, data: { name: "旧车站", master_url: "/api/v1/drama/media?url=master" }, msg: "ok" }), { status: 200 });
        }) as typeof fetch;

        try {
            for (const [kind, filename] of [
                ["master", "master.png"],
                ["pano", "pano.jpg"],
                ["custom", "scene.ply"],
            ] as const) {
                await uploadDramaSceneFile("project-a", "旧车站", kind, new File([kind], filename));
                await deleteDramaSceneFile("project-a", "旧车站", kind);
            }
        } finally {
            axios.request = previousRequest;
        }

        expect(calls.map(({ method, url }) => [method, url])).toEqual([
            ["POST", "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/master/upload"],
            ["POST", "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/pano/upload"],
            ["POST", "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/custom/upload"],
        ]);
        expect(apiCalls.map(({ method, url }) => [method, url])).toEqual([
            ["POST", "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/master/delete"],
            ["POST", "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/pano/delete"],
            ["POST", "/api/v1/drama/projects/project-a/scenes/%E6%97%A7%E8%BD%A6%E7%AB%99/custom/delete"],
        ]);
        expect(((calls[0].body as FormData).get("file") as File).name).toBe("master.png");
        expect(((calls[1].body as FormData).get("file") as File).name).toBe("pano.jpg");
        expect(((calls[2].body as FormData).get("file") as File).name).toBe("scene.ply");
        expect(calls[0].headers).toMatchObject({ Authorization: "Bearer canvas-token" });
    });
});
