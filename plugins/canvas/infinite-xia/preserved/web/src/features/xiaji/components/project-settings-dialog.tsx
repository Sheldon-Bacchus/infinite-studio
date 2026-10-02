"use client";

import { useCallback, useEffect, useState } from "react";

import {
	fetchDramaProjectConfig,
	updateDramaProjectConfig,
	type DramaProjectConfig,
	type DramaProjectConfigUpdate,
} from "@/services/api/drama-project-config";

type EditableField = "spine_template" | "aspect_ratio" | "visual_style" | "narration_style" | "ethnicity";
type ProjectSettingsDraft = Record<EditableField, string>;

const SELECT_OPTIONS: Record<Exclude<EditableField, "visual_style">, Array<{ value: string; label: string }>> = {
	spine_template: [
		{ value: "drama", label: "影视剧" },
		{ value: "narrated", label: "解说剧" },
	],
	aspect_ratio: [
		{ value: "2:3", label: "2:3" },
		{ value: "9:16", label: "9:16" },
		{ value: "16:9", label: "16:9" },
	],
	narration_style: [
		{ value: "first_person", label: "第一人称" },
		{ value: "third_person", label: "第三人称" },
	],
	ethnicity: [
		{ value: "Chinese", label: "Chinese" },
		{ value: "Japanese", label: "Japanese" },
		{ value: "Korean", label: "Korean" },
		{ value: "Western", label: "Western" },
		{ value: "Mixed", label: "Mixed" },
	],
};

const FIELD_LABELS: Record<EditableField, string> = {
	spine_template: "项目类型",
	aspect_ratio: "画面比例",
	visual_style: "视觉风格",
	narration_style: "解说视角",
	ethnicity: "人物人种",
};

export type ProjectSettingsDialogProps = {
	projectId: string;
	open: boolean;
	onClose: () => void;
	onSaved?: (config: DramaProjectConfig) => void;
};

export type ProjectSettingsDialogViewProps = ProjectSettingsDialogProps & {
	config: DramaProjectConfig | null;
	draft: ProjectSettingsDraft;
	loading: boolean;
	loadError: string;
	saveError: string;
	saving: boolean;
	saved: boolean;
	dirty: boolean;
	onRetry: () => void;
	onFieldChange: (field: EditableField, value: string) => void;
	onSave: () => void;
};

function optionsWithCurrent(field: Exclude<EditableField, "visual_style">, current: string) {
	const options = SELECT_OPTIONS[field];
	if (!current || options.some((option) => option.value === current)) return options;
	return [{ value: current, label: `${current}（当前源配置）` }, ...options];
}

function ConfigSelect({
	field,
	value,
	onChange,
}: {
	field: Exclude<EditableField, "visual_style">;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<select
			aria-label={FIELD_LABELS[field]}
			className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
			value={value}
			onChange={(event) => onChange(event.currentTarget.value)}
		>
			<option value="">未配置</option>
			{optionsWithCurrent(field, value).map((option) => (
				<option key={option.value} value={option.value}>{option.label}</option>
			))}
		</select>
	);
}

export function ProjectSettingsDialogView({
	projectId,
	open,
	config,
	draft,
	loading,
	loadError,
	saveError,
	saving,
	saved,
	dirty,
	onClose,
	onRetry,
	onFieldChange,
	onSave,
}: ProjectSettingsDialogViewProps) {
	if (!open) return null;
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="presentation">
			<section aria-labelledby="xiaji-project-settings-title" aria-modal="true" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl" role="dialog">
				<header className="mb-5 flex items-start justify-between gap-4">
					<div>
						<h2 className="text-lg font-semibold" id="xiaji-project-settings-title">虾集项目配置</h2>
						<p className="mt-1 text-sm text-muted-foreground">项目 {typeof config?.name === "string" ? config.name : projectId} · 配置由 DramaClaw 保存</p>
					</div>
					<button aria-label="关闭项目配置" className="rounded px-2 py-1 text-muted-foreground hover:bg-muted" onClick={onClose} type="button">关闭</button>
				</header>
				{loading ? <p className="py-8 text-center text-sm text-muted-foreground" role="status">正在读取项目配置…</p>
					: loadError ? (
						<div className="space-y-3" role="alert">
							<p className="text-sm text-destructive">读取项目配置失败：{loadError}</p>
							<button className="rounded-md border border-border px-3 py-2 text-sm" onClick={onRetry} type="button">重试</button>
						</div>
					) : (
						<form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
							{(Object.keys(FIELD_LABELS) as EditableField[]).map((field) => (
								<label className="block space-y-1.5" key={field}>
									<span className="text-sm font-medium">{FIELD_LABELS[field]}</span>
									{field === "visual_style" ? (
										<input
											aria-label={FIELD_LABELS[field]}
											className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
											value={draft[field]}
											onChange={(event) => onFieldChange(field, event.currentTarget.value)}
										/>
									) : (
										<ConfigSelect field={field} value={draft[field]} onChange={(value) => onFieldChange(field, value)} />
									)}
								</label>
							))}
							<p className="text-xs text-muted-foreground">视觉风格按虾集项目可用风格 ID 校验；已存在但不在固定选项中的枚举值会保留显示为当前源配置。</p>
							{saveError && <p className="text-sm text-destructive" role="alert">保存失败：{saveError}</p>}
							{saved && <p className="text-sm text-emerald-600" role="status">保存成功，已刷新项目配置</p>}
							<footer className="flex justify-end gap-2 border-t border-border pt-4">
								<button className="rounded-md border border-border px-3 py-2 text-sm" disabled={saving} onClick={onClose} type="button">取消</button>
								<button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={!dirty || saving} type="submit">{saving ? "正在保存…" : "保存配置"}</button>
							</footer>
						</form>
					)}
			</section>
		</div>
	);
}

function toDraft(config: DramaProjectConfig): ProjectSettingsDraft {
	return {
		spine_template: typeof config.spine_template === "string" ? config.spine_template : "",
		aspect_ratio: typeof config.aspect_ratio === "string" ? config.aspect_ratio : "",
		visual_style: typeof config.visual_style === "string" ? config.visual_style : "",
		narration_style: typeof config.narration_style === "string" ? config.narration_style : "",
		ethnicity: typeof config.ethnicity === "string" ? config.ethnicity : "",
	};
}

export function ProjectSettingsDialog({ projectId, open, onClose, onSaved }: ProjectSettingsDialogProps) {
	const [config, setConfig] = useState<DramaProjectConfig | null>(null);
	const [draft, setDraft] = useState<ProjectSettingsDraft>({ spine_template: "", aspect_ratio: "", visual_style: "", narration_style: "", ethnicity: "" });
	const [patch, setPatch] = useState<DramaProjectConfigUpdate>({});
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState("");
	const [saveError, setSaveError] = useState("");
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [reloadNonce, setReloadNonce] = useState(0);

	useEffect(() => {
		if (!open) return;
		let active = true;
		setLoading(true);
		setLoadError("");
		setSaveError("");
		setSaved(false);
		fetchDramaProjectConfig(projectId).then((nextConfig) => {
			if (!active) return;
			setConfig(nextConfig);
			setDraft(toDraft(nextConfig));
			setPatch({});
		}).catch((error: unknown) => {
			if (active) setLoadError(error instanceof Error ? error.message : "虾集项目配置读取失败");
		}).finally(() => {
			if (active) setLoading(false);
		});
		return () => { active = false; };
	}, [open, projectId, reloadNonce]);

	const handleFieldChange = useCallback((field: EditableField, value: string) => {
		setDraft((current) => ({ ...current, [field]: value }));
		setPatch((current) => {
			const next = { ...current };
			if (value === (config?.[field] ?? "")) delete next[field];
			else next[field] = value;
			return next;
		});
		setSaved(false);
		setSaveError("");
	}, [config]);

	const handleSave = useCallback(async () => {
		if (Object.keys(patch).length === 0 || saving) return;
		setSaving(true);
		setSaveError("");
		setSaved(false);
		try {
			await updateDramaProjectConfig(projectId, patch);
			try {
				const refreshed = await fetchDramaProjectConfig(projectId);
				setConfig(refreshed);
				setDraft(toDraft(refreshed));
				setPatch({});
				setSaved(true);
				onSaved?.(refreshed);
			} catch (error) {
				const message = error instanceof Error ? error.message : "虾集项目配置刷新失败";
				setSaveError(`配置已保存，但刷新失败：${message}`);
			}
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : "虾集项目配置保存失败");
		} finally {
			setSaving(false);
		}
	}, [onSaved, patch, projectId, saving]);

	const handleRetry = useCallback(() => setReloadNonce((nonce) => nonce + 1), []);
	const viewConfig = config;
	const dirty = Object.keys(patch).length > 0;
	return (
		<ProjectSettingsDialogView
			projectId={projectId}
			open={open}
			config={viewConfig}
			draft={draft}
			loading={loading}
			loadError={loadError}
			saveError={saveError}
			saving={saving}
			saved={saved}
			dirty={dirty}
			onClose={onClose}
			onRetry={handleRetry}
			onFieldChange={handleFieldChange}
			onSave={() => { void handleSave(); }}
		/>
	);
}
