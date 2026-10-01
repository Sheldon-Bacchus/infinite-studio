// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";

import { createDramaAssetDomainItem, createDramaIdentity, deleteDramaAssetDomainItem, deleteDramaCharacterVoiceSample, deleteDramaNarratorVoice, fetchDramaAssetHistory, fetchDramaAssetDomain, fetchDramaCharacterVoiceSamples, fetchDramaNarratorVoice, fetchDramaNarratorVoiceSources, fetchDramaPushImpact, pushDramaCandidate, recordDramaCharacterVoiceSample, recordDramaNarratorVoice, restoreDramaAssetHistory, trimDramaCharacterVoiceSample, trimDramaNarratorVoice, updateDramaAssetDomainItem, uploadDramaCandidate, uploadDramaCharacterVoiceSample, uploadDramaNarratorVoice } from "./drama-import";
import { useUserStore } from "@/stores/use-user-store";

const originalFetch = globalThis.fetch;
const originalUser = useUserStore.getState();

afterEach(() => {
    globalThis.fetch = originalFetch;
    useUserStore.setState(originalUser);
});

describe("DramaClaw writeback API", () => {
    test("reads and mutates source character and narrator voice routes", async () => {
        useUserStore.setState({ token: "canvas-token" });
        const requests: Array<{ url: string; method?: string; body?: BodyInit | null; headers?: HeadersInit }> = [];
        globalThis.fetch = (async (input, init) => {
            const url = String(input);
            requests.push({ url, method: init?.method, body: init?.body, headers: init?.headers });
            const data = url.includes("voice-samples")
                ? { character: "林/雨", slots: [] }
                : url.endsWith("/sources") ? { options: [] } : { reference_path: "audio/narrator.wav", is_first_person: false };
            return new Response(JSON.stringify({ code: 0, data, msg: "ok" }), { status: 200 });
        }) as typeof fetch;

        await fetchDramaCharacterVoiceSamples("demo", "林/雨");
        await recordDramaCharacterVoiceSample("demo", "林/雨", "default", "data:audio/webm;base64,AA==");
        await uploadDramaCharacterVoiceSample("demo", "林/雨", "youth", new Blob(["voice"]), "voice.wav");
        await trimDramaCharacterVoiceSample("demo", "林/雨", "youth", { source_path: "audio/voice.wav", start_seconds: 1, duration_seconds: 2 });
        await deleteDramaCharacterVoiceSample("demo", "林/雨", "youth");
        await fetchDramaNarratorVoice("demo");
        await fetchDramaNarratorVoiceSources("demo");
        await recordDramaNarratorVoice("demo", "data:audio/webm;base64,AA==");
        await uploadDramaNarratorVoice("demo", new Blob(["narrator"]), "narrator.wav");
        await trimDramaNarratorVoice("demo", { start_seconds: 0, duration_seconds: 3 });
        await deleteDramaNarratorVoice("demo");

        expect(requests.map(({ method, url }) => [method, url])).toEqual([
            ["GET", "/api/v1/drama/projects/demo/characters/%E6%9E%97%2F%E9%9B%A8/voice-samples"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%2F%E9%9B%A8/voice-samples/default/record"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%2F%E9%9B%A8/voice-samples/youth/upload"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%2F%E9%9B%A8/voice-samples/youth/trim"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%2F%E9%9B%A8/voice-samples/youth/delete"],
            ["GET", "/api/v1/drama/projects/demo/narrator-voice"],
            ["GET", "/api/v1/drama/projects/demo/narrator-voice/sources"],
            ["POST", "/api/v1/drama/projects/demo/narrator-voice/record"],
            ["POST", "/api/v1/drama/projects/demo/narrator-voice/upload"],
            ["POST", "/api/v1/drama/projects/demo/narrator-voice/trim"],
            ["POST", "/api/v1/drama/projects/demo/narrator-voice/delete"],
        ]);
        expect((requests[2].body as FormData).get("file")).toBeInstanceOf(Blob);
        expect(JSON.parse(String(requests[3].body))).toEqual({ source_path: "audio/voice.wav", start_seconds: 1, duration_seconds: 2 });
        expect(JSON.parse(String(requests[7].body))).toEqual({ data_url: "data:audio/webm;base64,AA==" });
        expect((requests[8].body as FormData).get("file")).toBeInstanceOf(Blob);
        expect(requests[0].headers).toMatchObject({ Authorization: "Bearer canvas-token" });
    });

    test("reads and mutates only the explicit asset domain routes", async () => {
        useUserStore.setState({ token: "canvas-token" });
        const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
        const previousRequest = axios.request;
        axios.request = (async (config) => {
            requests.push({ url: String(config.url), method: config.method, body: config.data });
            return { data: { code: 0, data: [{ name: "雨夜", role: "主角" }], msg: "ok" }, status: 200 } as never;
        }) as typeof axios.request;
        let characters;
        try {
            characters = await fetchDramaAssetDomain("demo", "characters");
            await createDramaAssetDomainItem("demo", "props", { name: "红伞", prop_type: "object" });
            await updateDramaAssetDomainItem("demo", "scenes", "车站/雨夜", { description: "站台" });
            await deleteDramaAssetDomainItem("demo", "characters", "林雨");
        } finally {
            axios.request = previousRequest;
        }

        expect(characters[0].name).toBe("雨夜");
        expect(requests.map((request) => [request.method, request.url])).toEqual([
            ["GET", "/api/v1/drama/projects/demo/domain/characters"],
            ["POST", "/api/v1/drama/projects/demo/domain/props"],
            ["PATCH", "/api/v1/drama/projects/demo/domain/scenes/%E8%BD%A6%E7%AB%99%2F%E9%9B%A8%E5%A4%9C"],
            ["POST", "/api/v1/drama/projects/demo/domain/characters/%E6%9E%97%E9%9B%A8/delete"],
        ]);
        expect(requests[1].body).toEqual({ name: "红伞", prop_type: "object" });
        expect(requests[3].body).toEqual({});
    });

    test("uploads a candidate through the authenticated local proxy as multipart", async () => {
        useUserStore.setState({ token: "canvas-token" });
        let requestUrl = "";
        let requestInit: RequestInit | undefined;
        globalThis.fetch = (async (input, init) => {
            requestUrl = String(input);
            requestInit = init;
            return new Response(JSON.stringify({ code: 0, data: { url: "/static/projects/demo/freezone/_uploads/frame.png", filename: "frame.png", size: 3 }, msg: "ok" }), { status: 200 });
        }) as typeof fetch;

        const result = await uploadDramaCandidate("demo / one", new Blob(["png"]), "frame.png");
        const form = requestInit?.body as FormData;
        expect(requestUrl).toBe("/api/v1/drama/projects/demo%20%2F%20one/freezone/upload");
        expect(requestInit?.headers).toMatchObject({ Authorization: "Bearer canvas-token" });
        expect(form.get("file")).toBeInstanceOf(Blob);
        expect(result).toMatchObject({ filename: "frame.png", size: 3 });
    });

    test("posts explicit identity and canonical slot actions to their separate routes", async () => {
        useUserStore.setState({ token: "canvas-token" });
        const requests: Array<{ url: string; body: unknown }> = [];
        globalThis.fetch = (async (input, init) => {
            requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
            return new Response(JSON.stringify({ code: 0, data: { target_url: "/static/target.png", target_path: "private-path", backup: "old.png", stale_marked: 0, affected_count: 0 }, msg: "ok" }), { status: 200 });
        }) as typeof fetch;

        await createDramaIdentity("demo", { source_url: "/static/projects/demo/freezone/_uploads/candidate.png", character: "林雨", identity_name: "雨夜" });
        await pushDramaCandidate("demo", "/static/projects/demo/freezone/_uploads/candidate.png", { kind: "portrait", character: "林雨" });

        expect(requests.map((request) => request.url)).toEqual([
            "/api/v1/drama/projects/demo/freezone/assets/identities",
            "/api/v1/drama/projects/demo/freezone/push",
        ]);
        expect(requests[0].body).toMatchObject({ source_url: "/static/projects/demo/freezone/_uploads/candidate.png", character: "林雨", identity_name: "雨夜" });
        expect(requests[1].body).toMatchObject({ source_url: "/static/projects/demo/freezone/_uploads/candidate.png", target: { kind: "portrait", character: "林雨" }, mark_stale: false });
    });

    test("lists and restores only the character asset history route", async () => {
        useUserStore.setState({ token: "canvas-token" });
        const requests: Array<{ url: string; body?: unknown }> = [];
        globalThis.fetch = (async (input, init) => {
            requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
            return new Response(JSON.stringify({ code: 0, data: { entries: [], restored: true }, msg: "ok" }), { status: 200 });
        }) as typeof fetch;

        await fetchDramaAssetHistory("demo", "林/雨", "identity_portrait", "hero-1");
        await restoreDramaAssetHistory("demo", "林/雨", { kind: "identity_portrait", identity_id: "hero-1", history_id: "_history/old.png" });

        expect(requests[0].url).toBe("/api/v1/drama/projects/demo/characters/%E6%9E%97%2F%E9%9B%A8/asset-history?kind=identity_portrait&identity_id=hero-1");
        expect(requests[1].url).toBe("/api/v1/drama/projects/demo/characters/%E6%9E%97%2F%E9%9B%A8/asset-history/restore");
        expect(requests[1].body).toMatchObject({ kind: "identity_portrait", identity_id: "hero-1", history_id: "_history/old.png" });
    });

    test("reads the source-reported affected beat count before a canonical replacement", async () => {
        useUserStore.setState({ token: "canvas-token" });
        let requestUrl = "";
        globalThis.fetch = (async (input) => {
            requestUrl = String(input);
            return new Response(JSON.stringify({ code: 0, data: { affected_beats: [{ episode: 1, beat: 2 }], affected_count: 1 }, msg: "ok" }), { status: 200 });
        }) as typeof fetch;
        const result = await fetchDramaPushImpact("demo", { kind: "portrait", character: "hero" });
        expect(requestUrl).toBe("/api/v1/drama/projects/demo/freezone/impact");
        expect(result.affected_count).toBe(1);
    });

    test("surfaces API errors without retrying a write", async () => {
        globalThis.fetch = (async () => new Response(JSON.stringify({ code: 1, data: null, msg: "候选文件超过上传限制" }), { status: 413 })) as typeof fetch;
        await expect(uploadDramaCandidate("demo", new Blob(["large"]), "large.bin")).rejects.toThrow("候选文件超过上传限制");
    });

    test("does not treat an upstream restored=false response as success", async () => {
        globalThis.fetch = (async () => new Response(JSON.stringify({ code: 0, data: { restored: false }, msg: "ok" }), { status: 200 })) as typeof fetch;
        await expect(restoreDramaAssetHistory("demo", "hero", { kind: "portrait", history_id: "old.png" })).rejects.toThrow("未确认恢复成功");
    });
});
