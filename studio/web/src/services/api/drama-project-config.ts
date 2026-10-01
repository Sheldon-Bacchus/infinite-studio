import { apiGet, apiPatch } from "./request";
import { useUserStore } from "@/stores/use-user-store";

export type DramaProjectConfig = {
	project_id?: string;
	name?: string;
	spine_template?: string | null;
	aspect_ratio?: string | null;
	visual_style?: string | null;
	narration_style?: string | null;
	ethnicity?: string | null;
	rhythm?: string | null;
	tts_provider?: string | null;
	tts_model?: string | null;
	tts_voice?: string | null;
	grid_mode?: string | null;
	grid_model?: string | null;
	video_backend?: string | null;
	use_director_render?: boolean | null;
	video_resolution?: string | null;
	add_subtitles?: boolean | null;
	sketch_image_selection?: string | null;
	render_image_selection?: string | null;
	sketch_aspect_padding?: boolean | null;
	scene_build_supported?: boolean;
	[key: string]: unknown;
};

export type DramaProjectConfigUpdate = Partial<Pick<DramaProjectConfig,
	| "spine_template"
	| "aspect_ratio"
	| "visual_style"
	| "narration_style"
	| "ethnicity"
	| "rhythm"
	| "tts_provider"
	| "tts_model"
	| "tts_voice"
	| "grid_mode"
	| "grid_model"
	| "video_backend"
	| "use_director_render"
	| "video_resolution"
	| "add_subtitles"
	| "sketch_image_selection"
	| "render_image_selection"
	| "sketch_aspect_padding"
>>;

const allowedStringFields = new Set([
	"visual_style", "narration_style", "ethnicity", "rhythm", "tts_provider", "tts_model",
	"tts_voice", "grid_mode", "grid_model", "video_backend", "video_resolution",
	"sketch_image_selection", "render_image_selection",
]);
const allowedBooleanFields = new Set(["use_director_render", "add_subtitles", "sketch_aspect_padding"]);
const allowedFields = new Set([
	"spine_template", "aspect_ratio", ...allowedStringFields, ...allowedBooleanFields,
]);

function validateProjectConfigPatch(patch: DramaProjectConfigUpdate) {
	if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
		throw new Error("虾集项目配置必须是对象");
	}
	const entries = Object.entries(patch);
	if (entries.length === 0) throw new Error("没有可保存的虾集项目配置");
	for (const [field, value] of entries) {
		if (!allowedFields.has(field)) throw new Error(`不支持的虾集项目配置字段：${field}`);
		if (value === null) continue;
		if (field === "spine_template" && value !== "drama" && value !== "narrated") {
			throw new Error("spine_template 只允许 drama 或 narrated");
		}
		if (field === "aspect_ratio" && value !== "2:3" && value !== "9:16" && value !== "16:9") {
			throw new Error("aspect_ratio 只允许 2:3、9:16 或 16:9");
		}
		if (allowedStringFields.has(field) && typeof value !== "string") {
			throw new Error(`虾集项目配置字段 ${field} 必须是字符串`);
		}
		if (allowedBooleanFields.has(field) && typeof value !== "boolean") {
			throw new Error(`虾集项目配置字段 ${field} 必须是布尔值`);
		}
	}
}

function projectConfigPath(projectId: string) {
	if (!projectId.trim()) throw new Error("虾集项目 ID 不能为空");
	return `/api/v1/drama/projects/${encodeURIComponent(projectId)}`;
}

export async function fetchDramaProjectConfig(projectId: string) {
	const config = await apiGet<DramaProjectConfig>(
		projectConfigPath(projectId), undefined, useUserStore.getState().token,
	);
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		throw new Error("虾集项目配置响应格式无效");
	}
	return config;
}

export async function updateDramaProjectConfig(projectId: string, patch: DramaProjectConfigUpdate) {
	validateProjectConfigPatch(patch);
	return apiPatch<DramaProjectConfig>(
		projectConfigPath(projectId), patch, useUserStore.getState().token,
	);
}
