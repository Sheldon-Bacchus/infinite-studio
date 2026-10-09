import { inferVideoRatio } from "@/lib/media-size";

import { modelOptionName } from "@/stores/use-config-store";

/**
 * AutoDL ComfyUI 官方工作流的能力契约。
 * 分辨率为官方工作流实际声明支持的目标值；未声明的 1088p 不静默降级，直接在提交前拦截。
 */
export interface AutoDLSettingsCapabilities {
    readonly resolutions: readonly string[];
    readonly ratios: readonly string[];
    readonly customResolution: boolean;
    readonly showMode: false;
}

const AUTODL_CAPABILITIES: Record<string, AutoDLSettingsCapabilities> = {
    minimax_h3_zm_u24: { resolutions: ["480", "768"], ratios: ["16:9", "9:16", "1:1"], customResolution: false, showMode: false },
    minimax_h3_image_audio_to_video_v2_15s: { resolutions: ["480", "768"], ratios: ["16:9", "9:16"], customResolution: false, showMode: false },
    minimax_h3_image_audio_to_video: { resolutions: ["480", "768", "1080"], ratios: ["16:9", "9:16"], customResolution: false, showMode: false },
    minimax_h3_lightx2v: { resolutions: ["480", "768"], ratios: ["16:9", "9:16", "1:1"], customResolution: false, showMode: false },
    "wan2.2animate-v4-motion_retargeting": { resolutions: [], ratios: ["16:9", "9:16"], customResolution: false, showMode: false },
};

export const AUTODL_CORE_WORKFLOWS = [
    "minimax_h3_zm_u24",
    "minimax_h3_image_audio_to_video_v2_15s",
    "minimax_h3_image_audio_to_video",
    "minimax_h3_lightx2v",
    "wan2.2animate-v4-motion_retargeting",
] as const;

export function cleanAutoDLWorkflowId(workflowId: string): string {
    const raw = String(workflowId || "").trim();
    if (!raw) return "";
    const index = raw.indexOf("::");
    return index >= 0 ? raw.slice(index + 2) : raw;
}

/** 优先依据明确的 autodl apiFormat 协议路由，同时兼顾已知工作流名与 autodl.art 主机名判定。 */
export function isAutoDLWorkflow(model: string, config?: { baseUrl?: string; apiFormat?: string }): boolean {
    if (config?.apiFormat === "autodl") return true;
    const name = cleanAutoDLWorkflowId(modelOptionName(model));
    if ((AUTODL_CORE_WORKFLOWS as readonly string[]).includes(name)) return true;
    const baseUrl = config?.baseUrl;
    if (!baseUrl) return false;
    try {
        return /(^|\.)autodl\.(?:art|com)$/i.test(new URL(baseUrl).hostname);
    } catch {
        return baseUrl.toLowerCase().includes("autodl.art");
    }
}

export function clampAutoDLDuration(value: string | number | undefined, fallback = 5): number {
    const number = Math.round(Number(value) || fallback);
    return Math.max(1, Math.min(15, number));
}

export function getAutoDLSettingsCapabilities(workflowId: string): AutoDLSettingsCapabilities | null {
    const id = cleanAutoDLWorkflowId(workflowId);
    if (!id || !(id in AUTODL_CAPABILITIES)) return null;
    return AUTODL_CAPABILITIES[id];
}

export function getAutoDLVideoResolutionPresets(workflowId: string): readonly string[] | null {
    const id = cleanAutoDLWorkflowId(workflowId);
    if (id === "wan2.2animate-v4-motion_retargeting") return ["portrait", "landscape"];
    const capabilities = getAutoDLSettingsCapabilities(id);
    return capabilities ? capabilities.resolutions : null;
}

/** 校验比例与清晰度，返回工作流要求的 resolution 字符串；不支持时直接报错，不静默降级。 */
export function resolveAutoDLResolution(workflowId: string, size?: string, vquality?: string): string {
    const id = cleanAutoDLWorkflowId(workflowId);
    const capabilities = getAutoDLSettingsCapabilities(id);
    if (!capabilities) throw new Error(`未知的 AutoDL 工作流: ${workflowId || "未指定"}`);

    const ratio = inferVideoRatio(size || "16:9");
    if (!capabilities.ratios.includes(ratio)) throw new Error(`AutoDL 工作流 ${id} 不支持所选比例: ${ratio}`);

    if (id === "wan2.2animate-v4-motion_retargeting") {
        return ratio === "9:16" ? "464*832px(竖版)" : "832*464px(横版)";
    }

    const rawQuality = String(vquality ?? "").trim().toLowerCase();
    if (!rawQuality) throw new Error("清晰度不能为空");

    let target = "";
    if (rawQuality === "high" || rawQuality === "medium" || rawQuality === "auto" || rawQuality === "standard") target = "768";
    else if (rawQuality === "low") target = "480";
    else if (rawQuality === "720" || rawQuality === "720p") target = "768";
    else {
        const match = rawQuality.match(/^(\d+)p?$/);
        target = match ? match[1] : rawQuality;
    }

    if (!capabilities.resolutions.includes(target)) throw new Error(`AutoDL 工作流 ${id} 不支持分辨率: ${vquality || target}`);

    if (ratio === "1:1") return `${target}p(1:1)`;
    if (ratio === "9:16") return `${target}p竖`;
    return `${target}p横`;
}

