"use client";

import { Alert, Button, Card, Descriptions, Select, Space, Typography } from "antd";
import { useEffect, useState } from "react";

import {
	fetchDramaPropReferenceTask,
	startDramaPropReferenceGeneration,
	type DramaPropReferenceStartResponse,
	type DramaPropReferenceTaskRecord,
	type DramaPropReferenceTaskResponse,
} from "@/services/api/drama-props";

export type DramaPropReferenceOption = { name: string };

export type PropReferenceGenerationManagerViewProps = {
	props: DramaPropReferenceOption[];
	selectedProp: string;
	startResponse: DramaPropReferenceStartResponse | null;
	taskResponse: DramaPropReferenceTaskResponse | null;
	busy: boolean;
	error: string;
	onSelectProp: (name: string) => void;
	onStart: () => void;
	onRefresh: () => void;
};

export function dramaPropReferenceSelectOptions(props: DramaPropReferenceOption[]) {
	return props.filter((prop) => prop.name.trim()).map((prop) => ({ value: prop.name, label: prop.name }));
}

const SOURCE_TASK_FIELDS: Array<[keyof DramaPropReferenceTaskRecord, string]> = [
	["task_type", "源端任务类型"],
	["task_id", "源端 task_id"],
	["status", "源端状态（原值）"],
	["scope", "源端 scope"],
	["progress", "源端 progress（原值）"],
	["error", "源端错误"],
	["error_code", "源端错误码"],
];

function sourceValue(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

function SourceTaskFields({ task }: { task: DramaPropReferenceTaskRecord }) {
	return (
		<Descriptions size="small" column={1} bordered>
			{SOURCE_TASK_FIELDS.map(([field, label]) => {
				const value = sourceValue(task[field]);
				return value === undefined ? null : <Descriptions.Item key={field} label={label}>{value}</Descriptions.Item>;
			})}
		</Descriptions>
	);
}

export function PropReferenceGenerationManagerView({
	props,
	selectedProp,
	startResponse,
	taskResponse,
	busy,
	error,
	onSelectProp,
	onStart,
	onRefresh,
}: PropReferenceGenerationManagerViewProps) {
	const options = dramaPropReferenceSelectOptions(props);
	return (
		<Card title="生成道具参考图" size="small">
			<Space orientation="vertical" size="middle" style={{ width: "100%" }}>
				<Alert
					type="info"
					showIcon
					title="调用 DramaClaw 道具 reference/generate-async。任务标识、状态和错误以虾集源端响应为准。"
				/>
				{options.length === 0 ? (
					<Alert type="info" title="暂无可生成参考图的道具" />
				) : (
					<>
						<Select
							aria-label="选择道具"
							placeholder="选择现有道具"
							value={selectedProp || undefined}
							options={options}
							onChange={onSelectProp}
							style={{ width: "100%" }}
						/>
						<Space wrap>
							<Button type="primary" loading={busy} disabled={!selectedProp || busy} onClick={onStart}>
								启动虾集生成任务
							</Button>
							<Button loading={busy} disabled={!selectedProp || busy} onClick={onRefresh}>
								刷新源任务状态
							</Button>
						</Space>
					</>
				)}
				{error && <Alert type="error" showIcon title={error} />}
				{startResponse && (
					<section aria-label="虾集启动响应">
						<Typography.Text strong>虾集启动响应</Typography.Text>
						<Descriptions size="small" column={1} bordered style={{ marginTop: 8 }}>
							{([
								["task_type", "源端 task_type"],
								["task_id", "源端 task_id"],
								["task_key", "源端 task_key"],
								["scope", "源端 scope"],
								["backend", "源端 backend"],
								["queue", "源端 queue"],
								["message", "源端 message"],
							] as const).map(([field, label]) => {
								const value = sourceValue(startResponse[field]);
								return value === undefined ? null : <Descriptions.Item key={field} label={label}>{value}</Descriptions.Item>;
							})}
						</Descriptions>
						{taskResponse === null && <Alert type="info" title="启动响应没有状态字段；请刷新源任务状态核对。" style={{ marginTop: 8 }} />}
					</section>
				)}
				{taskResponse && (
					<section aria-label="虾集任务状态">
						<Typography.Text strong>虾集任务状态查询响应</Typography.Text>
						{taskResponse.data === null ? (
							<Alert
								type="warning"
								title="源端返回 data: null"
								description={taskResponse.message || "源端未提供 message"}
								style={{ marginTop: 8 }}
							/>
						) : (
							<SourceTaskFields task={taskResponse.data} />
						)}
						<details style={{ marginTop: 8 }}>
							<summary>查看原始 DramaClaw 响应</summary>
							<pre style={{ overflowX: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(taskResponse, null, 2)}</pre>
						</details>
					</section>
				)}
			</Space>
		</Card>
	);
}

export function PropReferenceGenerationManager({
	projectId,
	props,
}: {
	projectId: string;
	props: DramaPropReferenceOption[];
}) {
	const [selectedProp, setSelectedProp] = useState(props[0]?.name || "");
	const [startResponse, setStartResponse] = useState<DramaPropReferenceStartResponse | null>(null);
	const [taskResponse, setTaskResponse] = useState<DramaPropReferenceTaskResponse | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (!props.some((prop) => prop.name === selectedProp)) {
			setSelectedProp(props[0]?.name || "");
			setStartResponse(null);
			setTaskResponse(null);
		}
	}, [props, selectedProp]);

	function selectProp(name: string) {
		setSelectedProp(name);
		setStartResponse(null);
		setTaskResponse(null);
		setError("");
	}

	async function start() {
		if (!selectedProp) return;
		setBusy(true);
		setError("");
		setStartResponse(null);
		setTaskResponse(null);
		try {
			setStartResponse(await startDramaPropReferenceGeneration(projectId, selectedProp));
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause);
			setError(`虾集启动响应未确认：${message}。先刷新该道具的源任务状态；核对前不要重复提交，以免重复排队或计费。`);
		} finally {
			setBusy(false);
		}
	}

	async function refresh() {
		if (!selectedProp) return;
		setBusy(true);
		setError("");
		try {
			setTaskResponse(await fetchDramaPropReferenceTask(projectId, selectedProp));
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause);
			setError(`读取虾集源任务失败：${message}。当前保留上一次已读取的状态。`);
		} finally {
			setBusy(false);
		}
	}

	return (
		<PropReferenceGenerationManagerView
			props={props}
			selectedProp={selectedProp}
			startResponse={startResponse}
			taskResponse={taskResponse}
			busy={busy}
			error={error}
			onSelectProp={selectProp}
			onStart={start}
			onRefresh={refresh}
		/>
	);
}
