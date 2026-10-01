// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { CANVAS_AGENT_ACTION_NAMES, CANVAS_AGENT_TOOLS, isCanvasAgentMediaGenerationAction, normalizeCanvasAgentAction } from "./canvas-agent-tools";

describe("local asset MCP tools", () => {
    test("publishes project context and staged Agent artifact handoff tools", () => {
        expect(CANVAS_AGENT_ACTION_NAMES).toContain("get_xiaji_project_context");
        expect(CANVAS_AGENT_ACTION_NAMES).toContain("stage_xiaji_artifact_package");
        const stageTool = CANVAS_AGENT_TOOLS.find((item) => item.function.name === "stage_xiaji_artifact_package")!;
        expect(stageTool.function.parameters.required).toEqual(["package"]);
        expect(normalizeCanvasAgentAction("stage_xiaji_artifact_package", { package: { schemaVersion: 1, packageId: "pkg-1" } }).arguments)
            .toEqual({ package: { schemaVersion: 1, packageId: "pkg-1" } });
        expect(() => normalizeCanvasAgentAction("stage_xiaji_artifact_package", { package: "not-json-object" })).toThrow("package 必须是对象");
    });

    test("keeps all Xiaji project read, write, and context actions out of the user-configured model tool list", async () => {
        const module = await import("./canvas-agent-tools");
        expect(typeof module.CANVAS_AGENT_USER_MODEL_TOOLS).toBe("object");
        const restrictedNames = [
            "preview_xiaji_episode_context", "import_xiaji_episode_context", "arrange_xiaji_episode_canvas",
            "preview_xiaji_project_context", "import_xiaji_project_context", "arrange_xiaji_project_canvas",
            "get_xiaji_project_context", "stage_xiaji_artifact_package",
        ];
        expect(module.CANVAS_AGENT_USER_MODEL_TOOLS.filter((tool) => restrictedNames.includes(tool.function.name))).toEqual([]);
    });

    test("registers local asset query, config draft, copy import, and media binding actions", () => {
        expect(CANVAS_AGENT_ACTION_NAMES).toEqual(expect.arrayContaining(["list_local_assets", "create_config_draft", "import_assets_to_canvas", "bind_config_media"]));
        expect(CANVAS_AGENT_TOOLS.map((tool) => tool.function.name)).toEqual(expect.arrayContaining(["list_local_assets", "create_config_draft", "import_assets_to_canvas", "bind_config_media"]));
        expect(CANVAS_AGENT_ACTION_NAMES).not.toContain("import_local_assets");
        expect(CANVAS_AGENT_TOOLS.map((tool) => tool.function.name)).not.toContain("import_local_assets");
    });

    test("registers a strict read-only Xiaji episode preview tool with required local IDs", () => {
        expect(CANVAS_AGENT_ACTION_NAMES).toContain("preview_xiaji_episode_context");
        const tool = CANVAS_AGENT_TOOLS.find((item) => item.function.name === "preview_xiaji_episode_context")!;
        expect(tool.function.parameters).toMatchObject({
            type: "object",
            required: ["projectAssetId", "episodeAssetId"],
            additionalProperties: false,
            properties: { projectAssetId: { type: "string" }, episodeAssetId: { type: "string" } },
        });
        expect(normalizeCanvasAgentAction("preview_xiaji_episode_context", { projectAssetId: "project-1", episodeAssetId: "episode-1" }).arguments)
            .toEqual({ projectAssetId: "project-1", episodeAssetId: "episode-1" });
        expect(() => normalizeCanvasAgentAction("preview_xiaji_episode_context", { projectAssetId: "project-1" })).toThrow("缺少必填参数");
        expect(() => normalizeCanvasAgentAction("preview_xiaji_episode_context", { projectAssetId: "project-1", episodeAssetId: "episode-1", url: "/private/file" })).toThrow("不支持参数");
        expect(isCanvasAgentMediaGenerationAction("preview_xiaji_episode_context")).toBe(false);
    });

    test("registers project-structure preview, approved import, and second-stage arrangement tools", () => {
        expect(CANVAS_AGENT_ACTION_NAMES).toEqual(expect.arrayContaining([
            "preview_xiaji_project_context", "import_xiaji_project_context", "arrange_xiaji_project_canvas",
        ]));
        const preview = CANVAS_AGENT_TOOLS.find((item) => item.function.name === "preview_xiaji_project_context")!;
        expect(preview.function.parameters).toMatchObject({
            required: ["projectAssetId"],
            additionalProperties: false,
        });
        expect(normalizeCanvasAgentAction("preview_xiaji_project_context", { projectAssetId: "project-1" }).arguments)
            .toEqual({ projectAssetId: "project-1" });
        const importTool = CANVAS_AGENT_TOOLS.find((item) => item.function.name === "import_xiaji_project_context")!;
        expect(importTool.function.parameters.required).toEqual(["projectAssetId", "sourceDigest", "sourceAssetIds"]);
        expect(normalizeCanvasAgentAction("import_xiaji_project_context", {
            projectAssetId: "project-1", sourceDigest: "a".repeat(64), sourceAssetIds: ["project-1", "source-1"],
        }).arguments).toEqual({ projectAssetId: "project-1", sourceDigest: "a".repeat(64), sourceAssetIds: ["project-1", "source-1"] });
        const arrangeTool = CANVAS_AGENT_TOOLS.find((item) => item.function.name === "arrange_xiaji_project_canvas")!;
        expect(arrangeTool.function.parameters.required).toEqual(["projectionId", "manifestDigest", "approvedNodeIds"]);
        expect(isCanvasAgentMediaGenerationAction("import_xiaji_project_context")).toBe(false);
    });

    test("registers an explicit approved-ID import contract with closed mode and change-policy enums", () => {
        expect(CANVAS_AGENT_ACTION_NAMES).toContain("import_xiaji_episode_context");
        const tool = CANVAS_AGENT_TOOLS.find((item) => item.function.name === "import_xiaji_episode_context")!;
        expect(tool.function.parameters).toMatchObject({
            required: ["projectAssetId", "episodeAssetId", "sourceDigest", "mode", "sourceAssetIds", "changedSourcePolicy", "idempotencyKey"],
            additionalProperties: false,
            properties: {
                mode: { type: "string", enum: ["complete", "selected"] },
                changedSourcePolicy: { type: "string", enum: ["create-new", "reject"] },
            },
        });
        expect(normalizeCanvasAgentAction("import_xiaji_episode_context", {
            projectAssetId: "project-1", episodeAssetId: "episode-1", sourceDigest: "a".repeat(64), mode: "complete",
            sourceAssetIds: ["script-1", "beat-1"], changedSourcePolicy: "reject", idempotencyKey: "approval-1",
        }).arguments).toEqual({
            projectAssetId: "project-1", episodeAssetId: "episode-1", sourceDigest: "a".repeat(64), mode: "complete",
            sourceAssetIds: ["script-1", "beat-1"], changedSourcePolicy: "reject", idempotencyKey: "approval-1",
        });
        expect(() => normalizeCanvasAgentAction("import_xiaji_episode_context", {
            projectAssetId: "project-1", episodeAssetId: "episode-1", sourceDigest: "bad", mode: "complete",
            sourceAssetIds: ["script-1", "script-1"], changedSourcePolicy: "reject", idempotencyKey: "approval-1",
        })).toThrow();
        expect(isCanvasAgentMediaGenerationAction("import_xiaji_episode_context")).toBe(false);
    });

    test("requires a second explicit projection digest and exact node list before arranging or connecting", () => {
        expect(CANVAS_AGENT_ACTION_NAMES).toContain("arrange_xiaji_episode_canvas");
        const tool = CANVAS_AGENT_TOOLS.find((item) => item.function.name === "arrange_xiaji_episode_canvas")!;
        expect(tool.function.parameters).toMatchObject({
            required: ["projectionId", "manifestDigest", "approvedNodeIds", "idempotencyKey"],
            additionalProperties: false,
            properties: {
                manifestDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
                approvedNodeIds: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 500 },
            },
        });
        expect(normalizeCanvasAgentAction("arrange_xiaji_episode_canvas", {
            projectionId: "xiaji:projection", manifestDigest: "b".repeat(64), approvedNodeIds: ["script-node", "beat-node"], idempotencyKey: "review-1",
        }).arguments).toEqual({
            projectionId: "xiaji:projection", manifestDigest: "b".repeat(64), approvedNodeIds: ["script-node", "beat-node"], idempotencyKey: "review-1",
        });
        expect(() => normalizeCanvasAgentAction("arrange_xiaji_episode_canvas", {
            projectionId: "xiaji:projection", manifestDigest: "bad", approvedNodeIds: ["script-node"], idempotencyKey: "review-1",
        })).toThrow();
        expect(() => normalizeCanvasAgentAction("arrange_xiaji_episode_canvas", {
            projectionId: "xiaji:projection", manifestDigest: "b".repeat(64), approvedNodeIds: ["script-node", "script-node"], idempotencyKey: "review-1",
        })).toThrow();
        expect(isCanvasAgentMediaGenerationAction("arrange_xiaji_episode_canvas")).toBe(false);
    });

    test("normalizes a local asset query with explicit pagination", () => {
        expect(normalizeCanvasAgentAction("list_local_assets", { keyword: "guga", type: "image", page: 2, pageSize: 10 }).arguments).toEqual({
            keyword: "guga",
            type: "image",
            page: 2,
            pageSize: 10,
        });
    });

    test("registers a general asset import action that does not require a shot group", () => {
        expect(CANVAS_AGENT_ACTION_NAMES).toContain("import_assets_to_canvas");
        expect(CANVAS_AGENT_TOOLS.map((tool) => tool.function.name)).toContain("import_assets_to_canvas");
        const tool = CANVAS_AGENT_TOOLS.find((item) => item.function.name === "import_assets_to_canvas")!;
        expect(tool.function.parameters).toMatchObject({
            type: "object",
            required: ["assetIds"],
            additionalProperties: false,
            properties: {
                assetIds: { type: "array", minItems: 1, maxItems: 50, items: { type: "string", minLength: 1 } },
                x: { type: "number" },
                y: { type: "number" },
            },
        });
        expect(normalizeCanvasAgentAction("import_assets_to_canvas", {
            assetIds: ["asset-image-1", "asset-video-2"],
            x: 120,
            y: 240,
        }).arguments).toEqual({ assetIds: ["asset-image-1", "asset-video-2"], x: 120, y: 240 });
        expect(normalizeCanvasAgentAction("import_assets_to_canvas", { assetIds: ["asset-text-1"] }).arguments)
            .toEqual({ assetIds: ["asset-text-1"] });
        expect(() => normalizeCanvasAgentAction("import_assets_to_canvas", { assetIds: ["asset-1", "asset-1"] })).toThrow("assetIds 不能重复");
        expect(() => normalizeCanvasAgentAction("import_assets_to_canvas", { assetIds: [] })).toThrow("assetIds 必须包含 1 到 50 个素材 ID");
        expect(() => normalizeCanvasAgentAction("import_assets_to_canvas", { assetIds: ["asset-1"], x: "left" })).toThrow("x 必须是有限数字");
        expect(() => normalizeCanvasAgentAction("import_assets_to_canvas", { assetIds: ["asset-1"], url: "/private/file" })).toThrow("不支持参数");
        expect(isCanvasAgentMediaGenerationAction("import_assets_to_canvas")).toBe(false);
    });

    test("normalizes idle video config drafts and ordered media chips", () => {
        expect(
            normalizeCanvasAgentAction("create_config_draft", {
                shotKey: "SHOT-05",
                groupNodeId: "group-05",
                promptNodeId: "prompt-05",
                durationSeconds: 7,
                aspectRatio: "16:9",
                quality: "768p",
            }).arguments,
        ).toEqual({
            shotKey: "SHOT-05",
            groupNodeId: "group-05",
            promptNodeId: "prompt-05",
            durationSeconds: 7,
            aspectRatio: "16:9",
            quality: "768",
        });

        expect(
            normalizeCanvasAgentAction("bind_config_media", {
                configNodeId: "config-05",
                mediaNodeIds: ["image-1", "audio-1"],
            }).arguments,
        ).toEqual({ configNodeId: "config-05", mediaNodeIds: ["image-1", "audio-1"] });
    });

    test("routes local asset operations away from the media generation branch", () => {
        expect(["list_local_assets", "import_assets_to_canvas", "create_config_draft", "bind_config_media"].map(isCanvasAgentMediaGenerationAction)).toEqual([false, false, false, false]);
        expect(["generate_image", "edit_image", "generate_video", "generate_audio"].map(isCanvasAgentMediaGenerationAction)).toEqual([true, true, true, true]);
    });
});
