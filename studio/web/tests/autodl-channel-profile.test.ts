if (!globalThis.localStorage) {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, String(v)),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
    };
}

import { expect, test } from "bun:test";
import { createModelChannel, defaultBaseUrlForApiFormat, useConfigStore } from "../src/stores/use-config-store";
import { importAutoDLWorkflowProfile } from "../src/services/config-file";
import { isAutoDLWorkflow, AUTODL_CORE_WORKFLOWS } from "../src/lib/autodl-video-settings";
import { fetchImageModels } from "../src/services/api/image";

test("creates and normalizes autodl channel apiFormat correctly", () => {
    const channel = createModelChannel({
        name: "AutoDL Test",
        apiFormat: "autodl",
    });
    expect(channel.apiFormat).toBe("autodl");
    expect(channel.baseUrl).toBe("https://autodl.art");
    expect(defaultBaseUrlForApiFormat("autodl")).toBe("https://autodl.art");
});

test("identifies autodl workflow via apiFormat", () => {
    expect(isAutoDLWorkflow("custom-model", { apiFormat: "autodl" })).toBe(true);
    expect(isAutoDLWorkflow("minimax_h3_zm_u24")).toBe(true);
    expect(isAutoDLWorkflow("openai/gpt-4o", { apiFormat: "openai", baseUrl: "https://api.openai.com" })).toBe(false);
});

test("importAutoDLWorkflowProfile sets apiFormat to autodl and preserves existing apiKey", () => {
    const initialConfig = useConfigStore.getState().config;
    useConfigStore.setState({
        config: {
            ...initialConfig,
            channels: [
                createModelChannel({
                    id: "autodl-core",
                    name: "AutoDL",
                    baseUrl: "https://autodl.art",
                    apiKey: "existing-secret-key",
                    apiFormat: "autodl",
                }),
            ],
        },
    });

    importAutoDLWorkflowProfile({
        app: "infinite-canvas",
        profile: "model-channel-profile",
        id: "autodl-core-workflows",
        version: 1,
        channel: {
            id: "autodl-core",
            name: "AutoDL",
            baseUrl: "https://autodl.art",
            apiFormat: "autodl",
            models: [...AUTODL_CORE_WORKFLOWS],
        },
        defaultVideoModel: "minimax_h3_zm_u24",
    });

    const updatedChannels = useConfigStore.getState().config.channels;
    const autodlChannel = updatedChannels.find((ch) => ch.id === "autodl-core");
    expect(autodlChannel).toBeDefined();
    expect(autodlChannel?.apiFormat).toBe("autodl");
    expect(autodlChannel?.apiKey).toBe("existing-secret-key");
    expect(autodlChannel?.baseUrl).toBe("https://autodl.art");
    expect(autodlChannel?.models.length).toBe(5);
});

test("fetchImageModels returns core workflows directly for autodl without remote call", async () => {
    const models = await fetchImageModels({
        baseUrl: "https://autodl.art",
        apiKey: "",
        apiFormat: "autodl",
    });
    expect(models).toEqual([...AUTODL_CORE_WORKFLOWS]);
});
