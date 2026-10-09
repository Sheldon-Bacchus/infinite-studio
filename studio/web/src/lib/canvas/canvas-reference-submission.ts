import i18n from "@/i18n";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type AutoDLSlotAssignment<T> = {
    prompt: string;
    duration: number;
    resolution: string;
    slots: Record<string, T>;
};

/**
 * 把已解析的图片 / 音频 / 视频按官方工作流字段落位。
 * 每个工作流要求的必填素材缺失时直接抛错，交由提交前拦截处理。
 */
export function buildAutoDLSlotAssignment<T>(
    workflowId: string,
    prompt: string,
    duration: number,
    resolution: string,
    images: T[],
    audios: T[],
    videos: T[],
): AutoDLSlotAssignment<T> {
    const textPrompt = prompt.trim();
    const slots: Record<string, T> = {};

    if (workflowId === "minimax_h3_image_audio_to_video_v2_15s") {
        if (!textPrompt) throw new Error(apiText("videoPromptRequired"));
        images.slice(0, 9).forEach((item, index) => (slots[`ref_image_${index}`] = item));
        audios.slice(0, 3).forEach((item, index) => (slots[`ref_audio_${index}`] = item));
        return { prompt: textPrompt, duration, resolution, slots };
    }

    if (workflowId === "minimax_h3_zm_u24") {
        if (!textPrompt) throw new Error(apiText("videoPromptRequired"));
        if (images.length === 0) throw new Error(apiText("autoDLImageRequired"));
        images.slice(0, 9).forEach((item, index) => (slots[`ref_image_${index}`] = item));
        audios.slice(0, 3).forEach((item, index) => (slots[`ref_audio_${index}`] = item));
        return { prompt: textPrompt, duration, resolution, slots };
    }

    if (workflowId === "minimax_h3_image_audio_to_video") {
        const refImage = images[0];
        if (!refImage) throw new Error(apiText("autoDLImageRequired"));
        const refAudio = audios[0];
        if (!refAudio) throw new Error(apiText("autoDLAudioRequired"));
        slots["ref_image_0"] = refImage;
        slots["ref_audio_0"] = refAudio;
        return { prompt: "", duration, resolution, slots };
    }

    if (workflowId === "minimax_h3_lightx2v") {
        if (!textPrompt) throw new Error(apiText("videoPromptRequired"));
        const firstFrame = images[0];
        if (!firstFrame) throw new Error(apiText("autoDLFirstFrameRequired"));
        const lastFrame = images[1] || firstFrame;
        slots["first_frame"] = firstFrame;
        slots["last_frame"] = lastFrame;
        return { prompt: textPrompt, duration, resolution, slots };
    }

    if (workflowId === "wan2.2animate-v4-motion_retargeting") {
        const refImage = images[0];
        if (!refImage) throw new Error(apiText("autoDLImageRequired"));
        const refVideo = videos[0];
        if (!refVideo) throw new Error(apiText("autoDLVideoRequired"));
        slots["ref_image"] = refImage;
        slots["ref_video"] = refVideo;
        return { prompt: "", duration, resolution, slots };
    }

    throw new Error(`未知的 AutoDL 工作流: ${workflowId}`);
}

