// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig omits Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function subject() {
    return await import("./prop-reference-writeback").catch(() => null);
}

describe("prop reference candidate writeback", () => {
    test("uploads a candidate without pushing, then pushes only after explicit confirmation", async () => {
        const feature = await subject();
        expect(feature).not.toBeNull();
        if (!feature) return;

        const events: string[] = [];
        let pushed: { projectId: string; sourceUrl: string; target: Record<string, string | number>; markStale: boolean } | null = null;
        const candidate = { url: "/freezone/candidates/red-umbrella.png", filename: "red-umbrella.png", size: 128 };
        const pushResult = { target_url: "/props/红伞.png", stale_marked: 2, affected_count: 3 };
        const actions = feature.createPropReferenceWritebackActions({
            upload: async (_projectId: string, _file: Blob, _filename: string) => {
                events.push("upload");
                return candidate;
            },
            createIdentity: async () => undefined,
            push: async (projectId: string, sourceUrl: string, target: Record<string, string | number> & { kind: string }, markStale: boolean) => {
                events.push("push");
                pushed = { projectId, sourceUrl, target, markStale };
                return pushResult;
            },
        });

        const uploaded = await actions.uploadCandidate("drama-1", new Blob(["image"]), "red-umbrella.png");
        expect(uploaded.url).toBe(candidate.url);
        expect(events).toEqual(["upload"]);

        const result = await actions.confirm({
            projectId: "drama-1",
            propName: "红伞",
            candidate: uploaded,
            impact: { affected_count: 3, affected_beats: [{ episode: 1, beat: 2 }, { episode: 2, beat: 1 }] },
            markStale: true,
        });

        expect(events).toEqual(["upload", "push"]);
        expect(pushed).toEqual({
            projectId: "drama-1",
            sourceUrl: candidate.url,
            target: { kind: "prop_ref", prop_id: "红伞" },
            markStale: true,
        });
        expect(result.result).toEqual(pushResult);
    });

    test("refuses confirmation without a candidate or loaded impact and never reports push failure as success", async () => {
        const feature = await subject();
        expect(feature).not.toBeNull();
        if (!feature) return;

        let pushCalls = 0;
        const actions = feature.createPropReferenceWritebackActions({
            upload: async () => ({ url: "/candidate.png", filename: "candidate.png", size: 1 }),
            createIdentity: async () => undefined,
            push: async () => {
                pushCalls += 1;
                throw new Error("request timed out");
            },
        });

        await expect(actions.confirm({ projectId: "drama-1", propName: "红伞", candidate: null, impact: null, markStale: false })).rejects.toThrow();
        await expect(actions.confirm({
            projectId: "drama-1",
            propName: "红伞",
            candidate: { url: "/candidate.png", filename: "candidate.png", size: 1 },
            impact: null,
            markStale: false,
        })).rejects.toThrow();
        expect(pushCalls).toBe(0);

        await expect(actions.confirm({
            projectId: "drama-1",
            propName: "红伞",
            candidate: { url: "/candidate.png", filename: "candidate.png", size: 1 },
            impact: { affected_count: 0, affected_beats: [] },
            markStale: false,
        })).rejects.toMatchObject({ step: "push" });
        expect(pushCalls).toBe(1);
    });

    test("renders selected prop, candidate, affected episodes, success counts, and unknown timeout state", async () => {
        const feature = await subject();
        expect(feature).not.toBeNull();
        if (!feature) return;

        const render = (overrides: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(feature.PropReferenceWritebackView, {
            props: [{ name: "红伞" }],
            selectedProp: "红伞",
            filename: "red-umbrella.png",
            fileTypeValid: true,
            candidate: { url: "/freezone/candidates/red-umbrella.png", filename: "red-umbrella.png", size: 128 },
            impact: { affected_count: 2, affected_beats: [{ episode: 1, beat: 2 }, { episode: 3, beat: 4 }] },
            result: null,
            error: "",
            outcomeUnknown: false,
            busy: false,
            operation: null,
            markStale: true,
            onSelectProp: () => undefined,
            onSelectFile: () => undefined,
            onToggleStale: () => undefined,
            onUpload: () => undefined,
            onReloadImpact: () => undefined,
            onConfirm: () => undefined,
            ...overrides,
        }));

        const staged = render();
        expect(staged).toContain("红伞");
        expect(staged).toContain("red-umbrella.png");
        expect(staged).toContain("影响 2 个分镜");
        expect(staged).toContain("第1集·分镜2");
        expect(staged).toContain("第3集·分镜4");
        expect(staged).toContain("确认写回道具参考图");

        const succeeded = render({ result: { stale_marked: 1, affected_count: 2 } });
        expect(succeeded).toContain("道具参考图已写回");
        expect(succeeded).toContain("stale_marked");
        expect(succeeded).toContain("1");
        expect(succeeded).toContain("affected_count");
        expect(succeeded).toContain("2");

        const unknown = render({ outcomeUnknown: true, error: "request timed out" });
        expect(unknown).toContain("写回结果未知");
        expect(unknown).toContain("request timed out");
        expect(unknown).toContain("不要直接重试");
        expect(unknown).not.toContain("道具参考图已写回");
    });
});
