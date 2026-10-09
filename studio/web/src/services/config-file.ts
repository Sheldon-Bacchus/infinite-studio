import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { usePromptSourceStore, type PromptSource, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import { createModelChannel, defaultConfig, defaultWebdavSyncConfig, encodeChannelModel, modelOptionsFromChannels, normalizeChannelModels, normalizeModelOptionValue, useConfigStore, type AiConfig, type ChannelModel, type ModelChannel, type WebdavSyncConfig } from "@/stores/use-config-store";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

type ModelChannelProfileFile = {
    app: "infinite-canvas";
    profile: "model-channel-profile";
    id: string;
    version: 1;
    channel: Partial<ModelChannel> & { models: Array<string | ChannelModel> };
    defaultVideoModel?: string;
};

const autoDLModels: ChannelModel[] = [
    { name: "minimax_h3_zm_u24", displayName: "MiniMax H3 多图多音频生视频（升级画质）", capability: "video" },
    { name: "minimax_h3_image_audio_to_video_v2_15s", displayName: "MiniMax H3 多图多音频生视频（原版，15秒）", capability: "video" },
    { name: "minimax_h3_image_audio_to_video", displayName: "MiniMax H3 图像与音频转视频", capability: "video" },
    { name: "minimax_h3_lightx2v", displayName: "MiniMax H3 LightX2V 快速视频生成", capability: "video" },
    { name: "wan2.2animate-v4-motion_retargeting", displayName: "Wan 2.2 Animate V4 动作迁移", capability: "video" },
];

export type ConfigImportResult = "full-config" | "model-profile";

export function exportAppConfig() {
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const payload: AppConfigFile = {
        app: "infinite-canvas",
        version: 1,
        exportedAt: new Date().toISOString(),
        config,
        webdav,
        promptSources: { sources, schedule },
    };
    const date = new Date().toISOString().slice(0, 10);
    saveAs(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `infinite-canvas-config-${date}.json`);
}

export async function importAppConfig(file: File): Promise<ConfigImportResult> {
    const parsed = JSON.parse(await file.text()) as Partial<AppConfigFile & ModelChannelProfileFile>;
    if (isAutoDLWorkflowProfile(parsed)) {
        importAutoDLWorkflowProfile(parsed);
        return "model-profile";
    }
    if (parsed.app !== "infinite-canvas" || !parsed.config || typeof parsed.config !== "object") {
        throw new Error(i18n.t("config.invalidFile"));
    }

    const currentConfig = useConfigStore.getState();
    const nextConfig = { ...defaultConfig, ...parsed.config };
    const nextWebdav = { ...defaultWebdavSyncConfig, ...(parsed.webdav || {}) };
    useConfigStore.setState({ config: nextConfig, webdav: nextWebdav });
    const rehydrated = useConfigStore.persist.getOptions().merge?.({ config: nextConfig, webdav: nextWebdav }, useConfigStore.getState());
    if (rehydrated) {
        useConfigStore.setState({
            ...currentConfig,
            config: rehydrated.config,
            webdav: rehydrated.webdav,
        });
    }

    if (parsed.promptSources && typeof parsed.promptSources === "object") {
        const currentPromptState = usePromptSourceStore.getState();
        const rehydratedPrompts = usePromptSourceStore.persist.getOptions().merge?.(parsed.promptSources, currentPromptState);
        if (rehydratedPrompts) usePromptSourceStore.setState(rehydratedPrompts);
    }
    return "full-config";
}

function isAutoDLWorkflowProfile(value: unknown): value is ModelChannelProfileFile {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<ModelChannelProfileFile>;
    return candidate.app === "infinite-canvas" && candidate.profile === "model-channel-profile" && candidate.id === "autodl-core-workflows" && Boolean(candidate.channel);
}

export function importAutoDLWorkflowProfile(profile?: Partial<ModelChannelProfileFile>) {
    const current = useConfigStore.getState();
    const currentConfig = current.config;
    const incoming = profile?.channel;
    const channelId = incoming?.id?.trim() || "autodl-core";
    const baseUrl = incoming?.baseUrl?.trim();
    if (!baseUrl) throw new Error(i18n.t("config.invalidFile"));
    const existing = currentConfig.channels.find((channel) => channel.id === channelId || channel.apiFormat === "autodl" || isAutoDLBaseUrl(channel.baseUrl));
    const targetId = existing?.id || channelId;
    const mergedChannel = createModelChannel({
        id: targetId,
        name: incoming?.name?.trim() || existing?.name || "AutoDL",
        baseUrl,
        apiKey: existing?.apiKey || incoming?.apiKey || "",
        apiFormat: "autodl",
        models: normalizeChannelModels(incoming?.models?.length ? incoming.models : autoDLModels),
    });
    const channels = existing
        ? currentConfig.channels.map((channel) => (channel.id === existing.id ? mergedChannel : channel))
        : [...currentConfig.channels, mergedChannel];
    const models = modelOptionsFromChannels(channels);
    const defaultVideoName = (profile?.defaultVideoModel || "minimax_h3_zm_u24").trim();
    const videoModel = mergedChannel.models.some((model) => model.name === defaultVideoName)
        ? encodeChannelModel(mergedChannel.id, defaultVideoName)
        : normalizeModelOptionValue(currentConfig.videoModel, channels);
    const nextConfig: AiConfig = {
        ...currentConfig,
        channels,
        models,
        videoModel,
    };
    useConfigStore.setState({ config: nextConfig });
}

function isAutoDLBaseUrl(baseUrl: string) {
    try {
        const hostname = new URL(baseUrl.trim()).hostname.toLowerCase();
        return hostname === "autodl.art" || hostname.endsWith(".autodl.art");
    } catch {
        return false;
    }
}
