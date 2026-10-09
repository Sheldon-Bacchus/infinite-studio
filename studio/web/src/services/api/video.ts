import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { dataUrlToFile, readFileAsDataUrl } from "@/lib/image-utils";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio } from "@/lib/media-size";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import { getVideoAdapterConfigFingerprint, type CompiledVideoInput } from "@/lib/canvas/canvas-video-inputs";
import { clampAutoDLDuration, isAutoDLWorkflow, resolveAutoDLResolution } from "@/lib/autodl-video-settings";
import { buildAutoDLSlotAssignment } from "@/lib/canvas/canvas-reference-submission";
import type { CanvasVideoInputBinding } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = { id: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
export type RequestOptions = { signal?: AbortSignal; onSubmitting?: () => Promise<void> };
export type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[]; referenceBindings?: CanvasVideoInputBinding[] };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "gemini" | "autodl" | "plugin"; model: string };
type GeminiInlineData = { bytesBase64Encoded: string; mimeType: string };
type GeminiVideoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
};
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationResult> {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw videoTaskFailed(state.error);
        if (attempt === 119) throw new Error(apiText("videoTimeout", { provider: "" }));
        await delay(2500, options?.signal);
    }
    throw new Error(apiText("videoTimeout", { provider: "" }));
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

function videoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "VideoTaskFailed";
    return error;
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (requestConfig.apiFormat === "autodl" || isAutoDLWorkflow(selectedModel, requestConfig)) return createAutoDLVideoTask(requestConfig, selectedModel, prompt, references, options);
    // 非 AutoDL 的 H3 契约仍未核实，保持仅供草稿预览。
    if (/h3/i.test(selectedModel)) {
        throw new Error(i18n.t("canvas.videoInput.issues.contractUnverified") || "MiniMax H3 服务端完整契约（AutoDL 工作流与真实字段映射）尚未核实，当前仅支持草稿预览，禁止提交");
    }
    if (requestConfig.apiFormat === "gemini") return createGeminiVideoTask(requestConfig, selectedModel, prompt, references, options);
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function createVideoGenerationTaskFromInput(config: AiConfig, input: CompiledVideoInput, options?: RequestOptions): Promise<VideoGenerationTask> {
    const snapshot = input.snapshot;
    if (snapshot.adapterConfigFingerprint !== getVideoAdapterConfigFingerprint(config, snapshot.model)) throw new Error(apiText("videoInputUnsupported"));
    if (input.issues?.length > 0) throw new Error(input.issues[0].message);

    const isH3Model = /h3/i.test(snapshot.model);
    const requestConfig = resolveModelRequestConfig(config, snapshot.model);
    if (isH3Model && !isAutoDLWorkflow(snapshot.model, requestConfig)) {
        throw new Error(i18n.t("canvas.videoInput.issues.contractUnverified") || "MiniMax H3 服务端完整契约（AutoDL 工作流与真实字段映射）尚未核实，当前仅支持草稿预览，禁止提交");
    }

    const script = resolveModelScript(config, snapshot.model);
    if (!["text-only-video-v1", "script-video-v1", "openai-video-v1", "gemini-video-v1"].includes(snapshot.adapterId)) throw new Error(apiText("videoInputUnsupported"));
    if (snapshot.adapterId === "text-only-video-v1" && input.bindings.length) throw new Error(apiText("videoInputUnsupported"));
    if (snapshot.adapterId === "script-video-v1" && !script) throw new Error(apiText("videoInputUnsupported"));
    if (snapshot.adapterId === "openai-video-v1" && (script || requestConfig.apiFormat !== "openai")) throw new Error(apiText("videoInputUnsupported"));
    if (snapshot.adapterId === "gemini-video-v1" && (script || requestConfig.apiFormat !== "gemini")) throw new Error(apiText("videoInputUnsupported"));
    const imageCount = input.images.length;
    if (snapshot.params.mode === "frames" && imageCount > 2) throw new Error(apiText("videoInputFrameLimit"));
    const frameBindings = input.bindings.filter((binding) => binding.mediaType === "image");
    if ((snapshot.adapterId === "openai-video-v1" || snapshot.adapterId === "gemini-video-v1") && snapshot.params.mode === "frames" && frameBindings.some((binding, index) => binding.usage !== (index === 0 ? "first_frame" : "last_frame"))) throw new Error(apiText("videoInputFrameRole"));
    if (snapshot.adapterId === "gemini-video-v1" && (input.videos.length > 1 || input.audios.length > 1)) throw new Error(apiText("videoInputGeminiLimit"));
    const inputConfig: AiConfig = {
        ...config,
        model: snapshot.model,
        videoMode: snapshot.params.mode,
        videoSeconds: snapshot.params.seconds,
        size: snapshot.params.size,
        vquality: snapshot.params.resolution,
        videoGenerateAudio: String(snapshot.params.generateAudio),
        videoWatermark: String(snapshot.params.watermark),
    };
    return createVideoGenerationTask(inputConfig, input.prompt, input.images, {
        signal: options?.signal,
        onSubmitting: options?.onSubmitting,
        videos: input.videos,
        audios: input.audios,
        referenceBindings: input.bindings,
    });
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "autodl") return pollAutoDLVideoTask(requestConfig, task, options);
    if (task.provider === "gemini") return pollGeminiVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    if (options?.onSubmitting) {
        await options.onSubmitting();
    }
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            videos,
            audios,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size, config.vquality),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: videoAspectRatio(config.size),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                mode: resolveVideoMode(config.videoMode, refs.length),
                ...(options?.referenceBindings ? { referenceBindings: options.referenceBindings } : {}),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export type StoreGeneratedVideoOptions = { strict?: boolean };

export async function storeGeneratedVideo(result: VideoGenerationResult, options?: StoreGeneratedVideoOptions): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch (error) {
            if (options?.strict) throw error;
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error(apiText("noPlayableVideo"));
}

type AutoDLTaskResponse = {
    code?: string | number;
    msg?: string;
    message?: string;
    request_id?: string;
    data?: {
        task_id?: string;
        workflow?: string;
        status?: string;
        message?: string;
        results?: Array<{ url?: string; type?: string; file_type?: string; output_type?: string }>;
    } | null;
};

function autoDLBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const raw = (config.baseUrl || "https://autodl.art").trim().replace(/\/+$/, "");
    return raw || "https://autodl.art";
}

/** AutoDL ComfyUI 令牌直接放在 Authorization，不带 Bearer 前缀，与官方接口一致。 */
function autoDLHeaders(config: Pick<AiConfig, "apiKey">) {
    const token = config.apiKey.trim().replace(/^Bearer\s+/i, "");
    return { Authorization: token, "Content-Type": "application/json" };
}

async function resolveAutoDLImageUrl(image: ReferenceImage) {
    if (image.url && isPublicMediaUrl(image.url)) return image.url;
    if (image.dataUrl && isPublicMediaUrl(image.dataUrl)) return image.dataUrl;
    return await imageToDataUrl(image);
}

async function resolveAutoDLVideoUrl(video: ReferenceVideo, options?: RequestOptions) {
    if (video.url && isPublicMediaUrl(video.url)) return video.url;
    const file = await referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options);
    return await readFileAsDataUrl(file);
}

async function resolveAutoDLAudioUrl(audio: ReferenceAudio, options?: RequestOptions) {
    if (audio.url && isPublicMediaUrl(audio.url)) return audio.url;
    const file = await referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options);
    return await readFileAsDataUrl(file);
}

/** 提交前按工作流契约解析清晰度、时长并落位素材；任一必填缺失都会在此抛错。 */
export async function buildAutoDLRequestBody(workflowId: string, config: AiConfig, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions) {
    const resolution = resolveAutoDLResolution(workflowId, config.size, config.vquality);
    const duration = clampAutoDLDuration(config.videoSeconds, 5);
    const imageUrls = await Promise.all(references.map(resolveAutoDLImageUrl));
    const audioUrls = await Promise.all((options?.audios || []).map((audio) => resolveAutoDLAudioUrl(audio, options)));
    const videoUrls = await Promise.all((options?.videos || []).map((video) => resolveAutoDLVideoUrl(video, options)));
    const assignment = buildAutoDLSlotAssignment(workflowId, prompt, duration, resolution, imageUrls, audioUrls, videoUrls);
    const body: Record<string, unknown> = { prompt: assignment.prompt, duration: assignment.duration, resolution: assignment.resolution, ...assignment.slots };
    if (workflowId === "minimax_h3_image_audio_to_video") return { ref_image_0: assignment.slots["ref_image_0"], ref_audio_0: assignment.slots["ref_audio_0"], audio_duration: assignment.duration, resolution: assignment.resolution };
    if (workflowId === "minimax_h3_lightx2v") return { prompt: assignment.prompt, first_frame: assignment.slots["first_frame"], last_frame: assignment.slots["last_frame"], duration: assignment.duration, resolution: assignment.resolution };
    if (workflowId === "wan2.2animate-v4-motion_retargeting") return { ref_image: assignment.slots["ref_image"], ref_video: assignment.slots["ref_video"], resolution: assignment.resolution };
    return body;
}

async function createAutoDLVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const workflowId = modelOptionName(model).trim();
    const body = await buildAutoDLRequestBody(workflowId, config, prompt, references, options);
    const url = withLocalProxy(`${autoDLBaseUrl(config)}/api/v1/comfyui/comfyui_workflow/${encodeURIComponent(workflowId)}`);
    if (options?.onSubmitting) {
        await options.onSubmitting();
    }
    try {
        const response = await axios.post<AutoDLTaskResponse>(url, body, { headers: autoDLHeaders(config), signal: options?.signal });
        const payload = response.data;
        if (payload.code && payload.code !== "Success" && payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("videoTaskCreateFailed"));
        const taskId = payload.data?.task_id;
        if (!taskId) throw new Error(readApiErrorMessage(payload) || apiText("noVideoTaskId"));
        return { id: taskId, provider: "autodl", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

/** 失败只返回 failed 状态，绝不在此发起备用收费生成。 */
async function pollAutoDLVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const url = withLocalProxy(`${autoDLBaseUrl(config)}/api/v1/comfyui/comfyui_workflow/result/${encodeURIComponent(task.id)}`);
    try {
        const response = await axios.get<AutoDLTaskResponse>(url, { headers: autoDLHeaders(config), signal: options?.signal });
        const payload = response.data;
        if (payload.code && payload.code !== "Success" && payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("videoTaskQueryFailed"));
        const data = payload.data;
        const status = String(data?.status || "").toUpperCase();
        if (status === "SUCCESS") {
            const results = Array.isArray(data?.results) ? data!.results! : [];
            const item = results.find((entry) => entry.type === "video" || entry.file_type === "mp4" || (typeof entry.url === "string" && isPublicMediaUrl(entry.url))) || results[0];
            const videoUrl = item?.url;
            if (!videoUrl) throw new Error(apiText("noPlayableVideo"));
            return { status: "completed", result: await videoResultFromUrl(videoUrl, options) };
        }
        if (status === "FAILED" || status === "CANCELLED") {
            return { status: "failed", error: readApiErrorMessage(data?.message) || readApiErrorMessage(payload) || apiText("videoGenerationFailed") };
        }
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    body.append("size", normalizeVideoSize(config.size, config.vquality) || "1280x720");
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("generate_audio", String(boolConfig(config.videoGenerateAudio, true)));
    body.append("watermark", String(boolConfig(config.videoWatermark, false)));
    body.append("mode", mode);
    if (mode === "frames") {
        if (images[0]) body.append("first_frame", images[0], "first.png");
        if (images[1]) body.append("last_frame", images[1], "last.png");
    } else {
        images.forEach((file) => body.append("image[]", file, "ref.png"));
    }
    videos.forEach((file) => body.append("video[]", file));
    audios.forEach((file) => body.append("audio[]", file));
    if (options?.onSubmitting) {
        await options.onSubmitting();
    }
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (video.status === "completed") {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(withLocalProxy(url), { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

async function createGeminiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const instance: Record<string, unknown> = { prompt };
    if (mode === "frames") {
        if (images[0]) instance.image = parseDataUrlInline(images[0]);
        if (images[1]) instance.lastFrame = parseDataUrlInline(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseDataUrlInline(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = await fileToGeminiInline(videos[0]);
    if (audios[0]) instance.audio = await fileToGeminiInline(audios[0]);
    if (options?.onSubmitting) {
        await options.onSubmitting();
    }
    try {
        const created = unwrapEnvelope((await axios.post<ApiEnvelope<GeminiVideoOperation>>(geminiVideoUrl(config, model, "predictLongRunning"), {
            instances: [instance],
            parameters: {
                aspectRatio: videoAspectRatio(config.size),
                durationSeconds: Number(normalizeVideoSeconds(config.videoSeconds)) || 8,
                resolution: normalizeVideoResolution(config.vquality),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                addWatermark: boolConfig(config.videoWatermark, false),
            },
        }, { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("noVideoTask"));
        if (!created.name) throw new Error(apiText("noVideoTaskId"));
        return { id: created.name, provider: "gemini", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollGeminiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapEnvelope((await axios.get<ApiEnvelope<GeminiVideoOperation>>(geminiOperationUrl(config, task.id), { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("videoTaskQueryFailed"));
        if (state.error) return { status: "failed", error: readApiErrorMessage(state.error.message) || apiText("videoGenerationFailed") };
        if (!state.done) return { status: "pending" };
        const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed", error: apiText("noPlayableVideo") };
        const url = uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${config.apiKey}`;
        return { status: "completed", result: await videoResultFromUrl(url, options) };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function geminiVideoBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiVideoUrl(config: Pick<AiConfig, "baseUrl">, model: string, action: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/models/${encodeURIComponent(modelOptionName(model).replace(/^models\//, ""))}:${action}`);
}

function geminiOperationUrl(config: Pick<AiConfig, "baseUrl">, name: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/${name.replace(/^\//, "")}`);
}

function geminiVideoHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

function videoAspectRatio(size: string) {
    const ratio = inferVideoRatio(size);
    return ratio === "auto" ? "16:9" : ratio;
}

function parseDataUrlInline(dataUrl: string, fallbackType = "image/png"): GeminiInlineData {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallbackType };
}

async function fileToGeminiInline(file: File): Promise<GeminiInlineData> {
    return parseDataUrlInline(await readFileAsDataUrl(file), file.type || "application/octet-stream");
}

async function referenceMediaToFile(item: { name: string; type?: string; url?: string; storageKey?: string }, fallbackName: string, errorKey: "invalidReferenceVideo" | "invalidReferenceAudio", options?: RequestOptions) {
    let blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob) {
        const url = item.storageKey ? await resolveMediaUrl(item.storageKey, item.url || "") : item.url || "";
        if (!url) throw new Error(apiText(errorKey));
        try {
            blob = await (await fetch(url, { signal: options?.signal })).blob();
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error(apiText(errorKey));
        }
    }
    if (!blob.size) throw new Error(apiText(errorKey));
    return new File([blob], item.name || fallbackName, { type: item.type || blob.type || "application/octet-stream" });
}

function normalizeVideoSeconds(value: string) {
    return clampVideoSeconds(value);
}

function resolveVideoMode(mode: string | undefined, imageCount: number) {
    if (mode === "reference" || imageCount > 2) return "reference";
    return "frames";
}

function normalizeVideoSize(value: string, resolution?: string) {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    if (ratio === "auto") return null;
    return computeVideoSize(resolution || "720", ratio);
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || apiText("videoDownloadFailed"));
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
