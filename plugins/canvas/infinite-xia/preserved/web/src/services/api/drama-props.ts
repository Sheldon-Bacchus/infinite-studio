import { apiGet, apiPost } from "./request";
import { useUserStore } from "@/stores/use-user-store";

export type DramaPropReferenceStartResponse = {
	ok: true;
	task_type: string;
	task_id?: string;
	task_key?: string;
	scope?: string;
	backend?: string;
	queue?: string;
	message?: string;
	[key: string]: unknown;
};

export type DramaPropReferenceTaskRecord = {
	task_type?: string;
	task_id?: string;
	status?: unknown;
	progress?: unknown;
	error?: unknown;
	error_code?: unknown;
	scope?: string | null;
	[key: string]: unknown;
};

export type DramaPropReferenceTaskResponse = {
	ok: true;
	data: DramaPropReferenceTaskRecord | null;
	message?: string;
	[key: string]: unknown;
};

export function startDramaPropReferenceGeneration(
	projectId: string,
	propName: string,
	payload: { model?: string } = {},
) {
	return apiPost<DramaPropReferenceStartResponse>(
		`/api/v1/drama/projects/${encodeURIComponent(projectId)}/props/${encodeURIComponent(propName)}/reference/generate-async`,
		payload,
		useUserStore.getState().token,
	);
}

export function fetchDramaPropReferenceTask(projectId: string, propName: string) {
	return apiGet<DramaPropReferenceTaskResponse>(
		`/api/v1/drama/projects/${encodeURIComponent(projectId)}/props/${encodeURIComponent(propName)}/reference/task`,
		undefined,
		useUserStore.getState().token,
	);
}
