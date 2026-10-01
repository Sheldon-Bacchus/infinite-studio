// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";

import {
    createDramaCharacterIdentity,
    deleteDramaCharacterIdentity,
    deleteDramaIdentityAsset,
    fetchDramaIdentityAttempts,
    fetchDramaCharacterIdentities,
    normalizeDramaCharacterIdentities,
    startDramaCharacterBuild,
    startDramaCharacterPortrait,
    startDramaIdentityImage,
    startDramaIdentityPortrait,
    uploadDramaCharacterPortrait,
    uploadDramaIdentityAsset,
    updateDramaCharacterIdentity,
} from "./drama-identities";
import { useUserStore } from "@/stores/use-user-store";

const previousRequest = axios.request;
const previousPost = axios.post;
const previousUser = useUserStore.getState();

afterEach(() => {
    axios.request = previousRequest;
    axios.post = previousPost;
    useUserStore.setState(previousUser);
});

describe("DramaClaw character identity API", () => {
    test("uses the source-shaped local routes and exact write fields", async () => {
        useUserStore.setState({ token: "canvas-token" });
        const requests: Array<{ method?: string; url: string; data?: unknown; headers?: unknown }> = [];
        axios.request = (async (config) => {
            requests.push({ method: config.method, url: String(config.url), data: config.data, headers: config.headers });
            return { data: { code: 0, data: config.method === "GET" ? [{ identity_id: "林雨_雨夜", identity_name: "雨夜" }] : { identity_id: "林雨_雨夜", identity_name: "雨夜" }, msg: "ok" }, status: 200 } as never;
        }) as typeof axios.request;

        const identities = await fetchDramaCharacterIdentities("demo / one", "林/雨");
        await createDramaCharacterIdentity("demo / one", "林/雨", { identity_name: "雨夜", age_group: "青年", appearance_details: "雨衣" });
        await updateDramaCharacterIdentity("demo / one", "林/雨", "林雨_雨夜", { identity_name: "雨夜", appearance_details: "雨衣", face_prompt: "短发", age_group: "青年", body_type: "修长" });
        await deleteDramaCharacterIdentity("demo / one", "林/雨", "林雨_雨夜");

        expect(identities[0].identity_name).toBe("雨夜");
        expect(requests.map(({ method, url }) => [method, url])).toEqual([
            ["GET", "/api/v1/drama/projects/demo%20%2F%20one/characters/%E6%9E%97%2F%E9%9B%A8/identities"],
            ["POST", "/api/v1/drama/projects/demo%20%2F%20one/characters/%E6%9E%97%2F%E9%9B%A8/identities"],
            ["PATCH", "/api/v1/drama/projects/demo%20%2F%20one/characters/%E6%9E%97%2F%E9%9B%A8/identities/%E6%9E%97%E9%9B%A8_%E9%9B%A8%E5%A4%9C"],
            ["DELETE", "/api/v1/drama/projects/demo%20%2F%20one/characters/%E6%9E%97%2F%E9%9B%A8/identities/%E6%9E%97%E9%9B%A8_%E9%9B%A8%E5%A4%9C"],
        ]);
        expect(requests[1].data).toEqual({ identity_name: "雨夜", age_group: "青年", appearance_details: "雨衣" });
        expect(requests[2].data).toEqual({ identity_name: "雨夜", appearance_details: "雨衣", face_prompt: "短发", age_group: "青年", body_type: "修长" });
        expect(requests[3].data).toBeUndefined();
        expect(requests[0].headers).toMatchObject({ Authorization: "Bearer canvas-token" });
    });

    test("normalizes identity rows and rejects malformed source records", () => {
        expect(normalizeDramaCharacterIdentities([{ identity_id: "hero_young", identity_name: "青年", image_url: "/api/v1/drama/media?url=x" }])).toEqual([
            expect.objectContaining({ identity_id: "hero_young", identity_name: "青年", image_url: "/api/v1/drama/media?url=x" }),
        ]);
        expect(() => normalizeDramaCharacterIdentities({})).toThrow("响应格式无效");
        expect(() => normalizeDramaCharacterIdentities([{ identity_id: "missing-name" }])).toThrow("身份数据无效");
    });

    test("uses source task routes and retains the task type and task id", async () => {
        useUserStore.setState({ token: "canvas-token" });
        const requests: Array<{ method?: string; url: string; data?: unknown }> = [];
        axios.request = (async (config) => {
            requests.push({ method: config.method, url: String(config.url), data: config.data });
            const data = config.url?.endsWith("/build")
                ? { ok: true, task_type: "build_characters", task_id: "build-42" }
                : String(config.url).endsWith("/portrait-async")
                    ? { ok: true, task_type: "character_portrait", task_id: "portrait-43", scope: "character:林雨:portrait" }
                    : String(config.url).endsWith("/generate-async") && !String(config.url).includes("/portrait/")
                        ? { ok: true, task_type: "identity_image", task_id: "identity-44", scope: "character:林雨:identity:雨夜" }
                        : { ok: true, task_type: "character_portrait", task_id: "identity-portrait-45", scope: "character:林雨:identity_portrait:雨夜" };
            return { data: { code: 0, data, msg: "ok" }, status: 200 } as never;
        }) as typeof axios.request;

        const build = await startDramaCharacterBuild("demo");
        const portrait = await startDramaCharacterPortrait("demo", "林雨", { model: "image-v1", ethnicity: "Chinese" });
        const image = await startDramaIdentityImage("demo", "林雨", "林雨_雨夜", { style: "ink" });
        const identityPortrait = await startDramaIdentityPortrait("demo", "林雨", "林雨_雨夜", { model: "image-v1" });

        expect([build, portrait, image, identityPortrait].map(({ task_type, task_id }) => [task_type, task_id])).toEqual([
            ["build_characters", "build-42"],
            ["character_portrait", "portrait-43"],
            ["identity_image", "identity-44"],
            ["character_portrait", "identity-portrait-45"],
        ]);
        expect(requests.map(({ method, url }) => [method, url])).toEqual([
            ["POST", "/api/v1/drama/projects/demo/characters/build"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%E9%9B%A8/portrait-async"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%E9%9B%A8/identities/%E6%9E%97%E9%9B%A8_%E9%9B%A8%E5%A4%9C/generate-async"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%E9%9B%A8/identities/%E6%9E%97%E9%9B%A8_%E9%9B%A8%E5%A4%9C/portrait/generate-async"],
        ]);
        expect(requests[1].data).toEqual({ model: "image-v1", ethnicity: "Chinese" });
        expect(requests[2].data).toEqual({ style: "ink" });
        expect(requests[3].data).toEqual({ model: "image-v1" });
    });

    test("reads attempt counts and writes only the portrait, identity image, and costume source slots", async () => {
        useUserStore.setState({ token: "canvas-token" });
        const requests: Array<{ method?: string; url: string; data?: unknown }> = [];
        axios.post = (async (url, data, config) => {
            requests.push({ method: "POST", url: String(url), data });
            if (data instanceof FormData) expect(data.get("file")).toBeInstanceOf(File);
            return { data: { code: 0, data: { portrait_url: "/media/portrait.png" }, msg: "ok" }, status: 200 } as never;
        }) as typeof axios.post;
        axios.request = (async (config) => {
            requests.push({ method: config.method, url: String(config.url), data: config.data });
            if (config.method === "GET") {
                return { data: { code: 0, data: { image_attempts: 3, portrait_attempts: 1 }, msg: "ok" }, status: 200 } as never;
            }
            return { data: { code: 0, data: { deleted: true }, msg: "ok" }, status: 200 } as never;
        }) as typeof axios.request;
        const file = new File(["image-bytes"], "portrait.png", { type: "image/png" });

        const attempts = await fetchDramaIdentityAttempts("demo", "林雨", "林雨_雨夜");
        await uploadDramaCharacterPortrait("demo", "林雨", file);
        await uploadDramaIdentityAsset("demo", "林雨", "林雨_雨夜", "雨夜", "image", file);
        await uploadDramaIdentityAsset("demo", "林雨", "林雨_雨夜", "雨夜", "costume", file);
        await uploadDramaIdentityAsset("demo", "林雨", "林雨_雨夜", "雨夜", "portrait", file);
        await deleteDramaIdentityAsset("demo", "林雨", "林雨_雨夜", "image");
        await deleteDramaIdentityAsset("demo", "林雨", "林雨_雨夜", "costume");

        expect(attempts).toEqual({ image_attempts: 3, portrait_attempts: 1 });
        expect(requests.map(({ method, url }) => [method, url])).toEqual([
            ["GET", "/api/v1/drama/projects/demo/characters/%E6%9E%97%E9%9B%A8/identities/%E6%9E%97%E9%9B%A8_%E9%9B%A8%E5%A4%9C/attempts"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%E9%9B%A8/portrait/upload"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%E9%9B%A8/identities/by-name/%E9%9B%A8%E5%A4%9C/upload"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%E9%9B%A8/identities/%E6%9E%97%E9%9B%A8_%E9%9B%A8%E5%A4%9C/costume/upload"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%E9%9B%A8/identities/%E6%9E%97%E9%9B%A8_%E9%9B%A8%E5%A4%9C/portrait/upload"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%E9%9B%A8/identities/%E6%9E%97%E9%9B%A8_%E9%9B%A8%E5%A4%9C/image/delete"],
            ["POST", "/api/v1/drama/projects/demo/characters/%E6%9E%97%E9%9B%A8/identities/%E6%9E%97%E9%9B%A8_%E9%9B%A8%E5%A4%9C/costume/delete"],
        ]);
    });
});
