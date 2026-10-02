import { afterEach, beforeEach, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";

import { commitLocalWorkspaceImport, prepareLocalWorkspaceImport } from "../src/lib/local-workspace/import";

const originalFetch = globalThis.fetch;
const fetchCalls: Array<{ url: string; method: string }> = [];
const serverProjects = new Map<string, { workspaceId: string; id: string; revision: number; data: ReturnType<typeof createProject> }>();
const operationResults = new Map<string, { workspaceId: string; id: string; revision: number; data: ReturnType<typeof createProject>; operationId: string }>();
const projectCommitCalls: string[] = [];
let failProjectIdOnce: string | null = null;

beforeEach(() => {
    fetchCalls.length = 0;
    serverProjects.clear();
    operationResults.clear();
    projectCommitCalls.length = 0;
    failProjectIdOnce = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const method = init?.method || "GET";
        fetchCalls.push({ url, method });
        if (url.startsWith("data:")) {
            const [header, encoded = ""] = url.split(",", 2);
            const mimeType = header.slice(5).split(";")[0];
            const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
            return new Response(new Blob([bytes], { type: mimeType }));
        }
        if (url === "/api/local/workspace") {
            return Response.json({ code: 0, data: { schemaVersion: 1, workspaceId: "test-workspace", dataRoot: "test-data", storage: "sqlite", serviceInstanceId: "test-service" }, msg: "ok" });
        }
        if (url === "/api/local/canvas/projects" && method === "GET") return Response.json({ code: 0, data: [...serverProjects.values()], msg: "ok" });
        if (url === "/api/local/files" && method === "POST") {
            const form = init?.body as FormData;
            const file = form.get("file") as File;
            const fileId = String(form.get("fileId"));
            const data = { fileId, storageKey: `file:${fileId}`, sha256: "a".repeat(64), bytes: file.size, mimeType: file.type || "application/octet-stream", url: `/api/files/${fileId}/content` };
            return Response.json({ code: 0, data, msg: "ok" }, { status: 201 });
        }
        const projectPath = /^\/api\/local\/canvas\/projects\/([^/]+)$/.exec(url);
        if (projectPath && method === "PUT") {
            const id = decodeURIComponent(projectPath[1]);
            projectCommitCalls.push(id);
            if (failProjectIdOnce === id) {
                failProjectIdOnce = null;
                return Response.json({ code: 1, data: null, msg: "simulated service failure" }, { status: 503 });
            }
            const request = JSON.parse(String(init?.body)) as { workspaceId: string; operationId: string; baseRevision: number | null; data: ReturnType<typeof createProject> };
            const previous = operationResults.get(request.operationId);
            if (previous) return Response.json({ code: 0, data: previous, msg: "ok" });
            const current = serverProjects.get(id);
            if ((request.baseRevision === null && current) || (request.baseRevision !== null && current?.revision !== request.baseRevision)) {
                return Response.json({ code: 1, data: null, msg: "revision conflict" }, { status: 409 });
            }
            const record = { workspaceId: request.workspaceId, id, revision: (current?.revision || 0) + 1, data: request.data };
            const result = { ...record, operationId: request.operationId };
            serverProjects.set(id, record);
            operationResults.set(request.operationId, result);
            return Response.json({ code: 0, data: result, msg: "ok" });
        }
        return Response.json({ code: 1, data: null, msg: "unexpected request" }, { status: 404 });
    }) as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("restores an inline child image without replacing it with its parent's file", async () => {
    const childDataUrl = `data:image/png;base64,${btoa("child-image")}`;
    const project = createProject({
        content: "/api/files/parent/content",
        storageKey: "file:parent",
        fileId: "parent",
        images: [{ id: "child", status: "success", content: childDataUrl, storageKey: "image:missing-child", naturalWidth: 10, naturalHeight: 10, bytes: 11, mimeType: "image/png" }],
    });

    const plan = await prepareLocalWorkspaceImport(createArchive(project));
    const metadata = plan.projects[0]?.canonicalProject.nodes[0]?.metadata;
    const child = metadata?.images?.[0];
    const childFileId = child?.storageKey?.slice("file:".length);

    expect(plan.errors).toEqual([]);
    expect(childFileId).toStartWith("import_");
    expect(childFileId).not.toBe(metadata?.storageKey?.slice("file:".length));
    expect(child?.content).toBe(`/api/files/${childFileId}/content`);
});

test("does not let a data URL in prompt hide a missing media file", async () => {
    const project = createProject({
        content: "/api/files/missing/content",
        storageKey: "file:missing",
        prompt: `data:image/png;base64,${btoa("unrelated-prompt-image")}`,
    });
    const plan = await prepareLocalWorkspaceImport(createArchive(project));

    expect(plan.errors.join("\n")).toContain("file:missing");
    await expect(commitLocalWorkspaceImport(plan)).rejects.toThrow("ZIP 中存在错误");
    expect(fetchCalls.some(({ url }) => url === "/api/local/files")).toBe(false);
});

test("keeps a media original and its independent cover mapped to different files", async () => {
    const project = createProject({
        content: "/api/files/main/content",
        storageKey: "file:main",
        coverUrl: "/api/files/cover/content",
        coverFileId: "cover",
    });
    const plan = await prepareLocalWorkspaceImport(createArchive(project, false, [
        { storageKey: "file:main", path: "projects/canvas-1/files/main.png", bytes: new Uint8Array([1, 2, 3]) },
        { storageKey: "file:cover", path: "projects/canvas-1/files/cover.png", bytes: new Uint8Array([4, 5, 6]) },
    ]));
    const metadata = plan.projects[0]?.canonicalProject.nodes[0]?.metadata;
    const mainFileId = metadata?.storageKey?.slice("file:".length);
    const coverFileId = metadata?.coverFileId;

    expect(plan.errors).toEqual([]);
    expect(mainFileId).toStartWith("import_");
    expect(coverFileId).toStartWith("import_");
    expect(coverFileId).not.toBe(mainFileId);
    expect(metadata?.content).toBe(`/api/files/${mainFileId}/content`);
    expect(metadata?.coverUrl).toBe(`/api/files/${coverFileId}/content`);
});

test("resumes a partially imported ZIP and skips already committed canvases", async () => {
    const archive = createArchive([createProject({}, "canvas-1", "node-1"), createProject({}, "canvas-2", "node-2")], false);
    failProjectIdOnce = "canvas-2";
    const adopted: string[] = [];
    const firstPlan = await prepareLocalWorkspaceImport(archive);

    await expect(commitLocalWorkspaceImport(firstPlan, (project) => adopted.push(project.id))).rejects.toThrow("simulated service failure");
    expect(adopted).toEqual(["canvas-1"]);
    expect([...serverProjects.keys()]).toEqual(["canvas-1"]);

    const retryPlan = await prepareLocalWorkspaceImport(archive);
    expect(retryPlan.projects.map((item) => item.state)).toEqual(["same", "new"]);
    const imported = await commitLocalWorkspaceImport(retryPlan, (project) => adopted.push(project.id));
    expect(imported.map((project) => project.id)).toEqual(["canvas-2"]);
    expect(adopted).toEqual(["canvas-1", "canvas-2"]);
    expect(serverProjects.get("canvas-1")?.data.nodes[0]?.id).toBe("node-1");

    const duplicatePlan = await prepareLocalWorkspaceImport(archive);
    expect(duplicatePlan.projects.map((item) => item.state)).toEqual(["same", "same"]);
    expect(await commitLocalWorkspaceImport(duplicatePlan)).toEqual([]);
    expect(projectCommitCalls).toEqual(["canvas-1", "canvas-2", "canvas-2"]);
});

test("rejects a different project with an existing canvas ID without overwriting it", async () => {
    serverProjects.set("canvas-1", { workspaceId: "test-workspace", id: "canvas-1", revision: 3, data: createProject({ prompt: "saved" }) });
    const plan = await prepareLocalWorkspaceImport(createArchive(createProject({ prompt: "incoming" }), false));

    expect(plan.projects[0]?.state).toBe("conflict");
    await expect(commitLocalWorkspaceImport(plan)).rejects.toThrow("已拒绝导入");
    expect(projectCommitCalls).toEqual([]);
    expect(serverProjects.get("canvas-1")?.data.nodes[0]?.metadata?.prompt).toBe("saved");
});

function createProject(metadata: Record<string, unknown>, id = "canvas-1", nodeId = "node-1") {
    return {
        id,
        title: "导入测试",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [{ id: nodeId, type: "image", title: "图片", position: { x: 0, y: 0 }, width: 100, height: 100, metadata }],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}

function createArchive(
    project: ReturnType<typeof createProject> | ReturnType<typeof createProject>[],
    includeParentFile = true,
    extraFiles: Array<{ storageKey: string; path: string; bytes: Uint8Array }> = [],
) {
    const projects = Array.isArray(project) ? project : [project];
    const parentFile = new Uint8Array([1, 2, 3]);
    const manifest = {
        app: "infinite-canvas",
        version: 3,
        exportedAt: "2026-01-01T00:00:00.000Z",
        projects: projects.map((item) => ({
            project: item,
            files: [
                ...(includeParentFile ? [{ storageKey: "file:parent", path: `projects/${item.id}/files/parent.png`, mimeType: "image/png", bytes: parentFile.byteLength }] : []),
                ...extraFiles.filter((file) => file.path.startsWith(`projects/${item.id}/files/`)).map((file) => ({ ...file, mimeType: "image/png", bytes: file.bytes.byteLength })),
            ],
        })),
    };
    const entries: Record<string, Uint8Array> = { "projects.json": strToU8(JSON.stringify(manifest)) };
    if (includeParentFile) projects.forEach((item) => { entries[`projects/${item.id}/files/parent.png`] = parentFile; });
    extraFiles.forEach((file) => { entries[file.path] = file.bytes; });
    const archive = zipSync(entries, { level: 0 });
    return new File([archive], "canvas-export.zip", { type: "application/zip" });
}
