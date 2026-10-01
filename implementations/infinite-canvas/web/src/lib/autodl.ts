import type { AutoDLWorkflow } from "@/services/api/autodl";
import { channelIdForActiveModel, channelProtocolForConfig, localChannelForActiveModel, type AiConfig } from "@/stores/use-config-store";

export function isAutoDLConfig(config: AiConfig, model = config.model) {
    return channelProtocolForConfig({ ...config, model }) === "autodl";
}

export function autoDLBaseUrl(config: AiConfig, model = config.model) {
    const active = { ...config, model };
    const channel = active.channelMode === "remote"
        ? active.publicChannels.find((item) => item.id === channelIdForActiveModel(active)) || active.publicChannels[0]
        : localChannelForActiveModel(active);
    return (channel?.baseUrl || "https://autodl.art").trim().replace(/\/+$/, "");
}

export function getAutoDLCapabilities(workflow?: AutoDLWorkflow) {
    if (!workflow?.input_rules || workflow.kind === "unsupported") return undefined;
    const rules = workflow.input_rules;
    const images = Object.keys(rules).filter((key) => /^ref_image(?:_\d+)?$/.test(key));
    const audios = Object.keys(rules).filter((key) => /^ref_audio(?:_\d+)?$/.test(key));
    const videos = Object.keys(rules).filter((key) => /^ref_video(?:_\d+)?$/.test(key));
    return {
        promptRequired: Boolean(rules.prompt?.required),
        imageMax: images.length,
        audioMax: audios.length,
        videoMax: videos.length,
        firstFrame: Boolean(rules.first_frame),
        lastFrame: Boolean(rules.last_frame),
        duration: rules.duration || rules.audio_duration,
    };
}

export type AutoDLReferenceInputCounts = { imageCount: number; videoCount: number; audioCount: number; firstFrame: boolean; lastFrame: boolean };

export function getAutoDLReferenceInputError(capabilities: NonNullable<ReturnType<typeof getAutoDLCapabilities>>, input: AutoDLReferenceInputCounts) {
    if (input.imageCount > capabilities.imageMax) return `${input.imageCount} 张参考图片超过工作流限制（最多支持 ${capabilities.imageMax} 张）`;
    if (input.videoCount > capabilities.videoMax) return capabilities.videoMax ? `${input.videoCount} 个参考视频超过工作流限制（最多支持 ${capabilities.videoMax} 个）` : `当前 AutoDL 工作流不支持参考视频，但已选择 ${input.videoCount} 个`;
    if (input.audioCount > capabilities.audioMax) return capabilities.audioMax ? `${input.audioCount} 段参考音频超过工作流限制（最多支持 ${capabilities.audioMax} 段）` : `当前 AutoDL 工作流不支持参考音频，但已选择 ${input.audioCount} 段`;
    if (input.firstFrame && !capabilities.firstFrame) return "当前 AutoDL 工作流不支持首帧图片";
    if (input.lastFrame && !capabilities.lastFrame) return "当前 AutoDL 工作流不支持尾帧图片";
    return null;
}

export function normalizeAutoDLDuration(value: string, workflow?: AutoDLWorkflow) {
    const rule = getAutoDLCapabilities(workflow)?.duration;
    if (!rule) return value;
    const parsed = Number(value.trim() || rule.default);
    if (!Number.isFinite(parsed)) return String(rule.default ?? "");
    const seconds = rule.type === "integer" ? Math.floor(parsed) : parsed;
    return String(Math.min(rule.max ?? Infinity, Math.max(rule.min ?? 0, seconds)));
}
