"use client";

import { Alert, Button, Checkbox, Select } from "antd";
import { useState, type ChangeEvent } from "react";

import {
    createDramaIdentity,
    fetchDramaPushImpact,
    pushDramaCandidate,
    uploadDramaCandidate,
    type DramaCandidateUploadResult,
    type DramaPushImpact,
    type DramaPushResult,
    type DramaPushTarget,
} from "@/services/api/drama-import";
import { isSupportedWritebackMimeType, runWritebackAction, WritebackActionError, type WritebackApi } from "../writeback";

export type PropReferenceOption = { name: string };

export type ConfirmPropReferenceWritebackInput = {
    projectId: string;
    propName: string;
    candidate: DramaCandidateUploadResult | null;
    impact: DramaPushImpact | null;
    markStale: boolean;
};

export type PropReferenceWritebackApi = {
    upload: (projectId: string, file: Blob, filename: string) => Promise<DramaCandidateUploadResult>;
    createIdentity: WritebackApi["createIdentity"];
    push: WritebackApi["push"];
};

export type PropReferenceWritebackOutcome = {
    cancelled: false;
    candidate: Pick<DramaCandidateUploadResult, "url">;
    result: DramaPushResult;
};

export function propReferenceTarget(propName: string): DramaPushTarget {
    return { kind: "prop_ref", prop_id: propName };
}

export function createPropReferenceWritebackActions(api: PropReferenceWritebackApi) {
    return {
        uploadCandidate: (projectId: string, file: Blob, filename: string) => api.upload(projectId, file, filename),
        confirm: async (input: ConfirmPropReferenceWritebackInput): Promise<PropReferenceWritebackOutcome> => {
            if (!input.candidate) throw new Error("请先上传候选图片");
            if (!input.impact) throw new Error("请先读取受影响集数和分镜");
            if (!input.projectId.trim() || !input.propName.trim()) throw new Error("请选择虾集项目和道具");
            const outcome = await runWritebackAction({
                kind: "replace",
                projectId: input.projectId,
                candidate: input.candidate,
                target: propReferenceTarget(input.propName),
                markStale: input.markStale,
            }, api);
            if (outcome.cancelled) throw new Error("道具参考图写回意外取消");
            return {
                cancelled: false,
                candidate: outcome.candidate,
                result: outcome.result as DramaPushResult,
            };
        },
    };
}

const defaultActions = createPropReferenceWritebackActions({
    upload: uploadDramaCandidate,
    createIdentity: createDramaIdentity,
    push: pushDramaCandidate,
});

export type PropReferenceWritebackViewProps = {
    props: PropReferenceOption[];
    selectedProp: string;
    filename: string;
    fileTypeValid: boolean;
    candidate: DramaCandidateUploadResult | null;
    impact: DramaPushImpact | null;
    result: DramaPushResult | null;
    error: string;
    outcomeUnknown: boolean;
    busy: boolean;
    operation: "upload" | "impact" | "push" | null;
    markStale: boolean;
    onSelectProp: (name: string) => void;
    onSelectFile: (file: File | null) => void;
    onToggleStale: (checked: boolean) => void;
    onUpload: () => void;
    onReloadImpact: () => void;
    onConfirm: () => void;
};

export function PropReferenceWritebackView({
    props,
    selectedProp,
    filename,
    fileTypeValid,
    candidate,
    impact,
    result,
    error,
    outcomeUnknown,
    busy,
    operation,
    markStale,
    onSelectProp,
    onSelectFile,
    onToggleStale,
    onUpload,
    onReloadImpact,
    onConfirm,
}: PropReferenceWritebackViewProps) {
    const impactRows = impact?.affected_beats ?? [];
    const canUpload = Boolean(selectedProp && filename && fileTypeValid && !busy);
    const canConfirm = Boolean(selectedProp && candidate && impact && !busy && !outcomeUnknown && !result);

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">先将图片保存为虾集候选，再核对影响范围。只有点击“确认写回”才会替换该道具参考图。</p>

            <label className="block space-y-1 text-sm">
                <span>选择虾集道具</span>
                <Select
                    className="w-full"
                    aria-label="选择虾集道具"
                    placeholder="选择道具"
                    value={selectedProp || undefined}
                    options={props.map(({ name }) => ({ value: name, label: name }))}
                    onChange={onSelectProp}
                />
            </label>

            <label className="block space-y-1 text-sm">
                <span>候选参考图片</span>
                <input
                    aria-label="候选参考图片"
                    type="file"
                    accept="image/*"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => onSelectFile(event.currentTarget.files?.[0] ?? null)}
                />
                {filename ? <span className="block text-xs text-muted-foreground">{filename}</span> : null}
                {filename && !fileTypeValid ? <span className="block text-xs text-destructive">请选择有效的图片文件。</span> : null}
            </label>

            <div className="flex flex-wrap gap-2">
                <Button type="primary" loading={operation === "upload"} disabled={!canUpload} onClick={onUpload}>
                    上传候选图片
                </Button>
                {candidate ? (
                    <Button loading={operation === "impact"} disabled={busy} onClick={onReloadImpact}>
                        {impact ? "刷新受影响范围" : "读取受影响范围"}
                    </Button>
                ) : null}
            </div>

            {candidate ? (
                <Alert
                    type="success"
                    showIcon
                    title="候选图片已上传，尚未写回"
                    description={<span className="break-all">{candidate.filename || filename} · {candidate.url}</span>}
                />
            ) : null}

            {impact ? (
                <Alert
                    type="info"
                    showIcon
                    title={`影响 ${impact.affected_count} 个分镜`}
                    description={impactRows.length
                        ? impactRows.slice(0, 12).map(({ episode, beat }) => `第${episode}集·分镜${beat}`).join("、")
                        : "没有关联分镜"}
                />
            ) : null}

            {impact ? (
                <Checkbox checked={markStale} disabled={busy} onChange={(event) => onToggleStale(event.target.checked)}>
                    将受影响分镜标记为过期
                </Checkbox>
            ) : null}

            <Button danger loading={operation === "push"} disabled={!canConfirm} onClick={onConfirm}>
                确认写回道具参考图
            </Button>

            {result ? (
                <Alert
                    type="success"
                    showIcon
                    title="道具参考图已写回"
                    description={[
                        typeof result.stale_marked === "number" ? `stale_marked：${result.stale_marked}` : null,
                        typeof result.affected_count === "number" ? `affected_count：${result.affected_count}` : null,
                    ].filter(Boolean).join(" · ") || result.target_url}
                />
            ) : null}

            {error ? (
                <Alert
                    type={outcomeUnknown ? "warning" : "error"}
                    showIcon
                    title={outcomeUnknown ? "写回结果未知" : "操作失败"}
                    description={outcomeUnknown
                        ? `${error}。请求可能已到达 DramaClaw，但响应未能确认。请先核对虾塘道具和受影响分镜状态，不要直接重试。`
                        : error}
                />
            ) : null}
        </div>
    );
}

export function PropReferenceWriteback({ projectId, props, onComplete }: {
    projectId: string;
    props: PropReferenceOption[];
    onComplete?: () => void;
}) {
    const [selectedProp, setSelectedProp] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [candidate, setCandidate] = useState<DramaCandidateUploadResult | null>(null);
    const [impact, setImpact] = useState<DramaPushImpact | null>(null);
    const [result, setResult] = useState<DramaPushResult | null>(null);
    const [error, setError] = useState("");
    const [outcomeUnknown, setOutcomeUnknown] = useState(false);
    const [operation, setOperation] = useState<PropReferenceWritebackViewProps["operation"]>(null);
    const [markStale, setMarkStale] = useState(false);

    const clearWritebackState = () => {
        setCandidate(null);
        setImpact(null);
        setResult(null);
        setError("");
        setOutcomeUnknown(false);
        setMarkStale(false);
    };

    const uploadCandidate = async () => {
        if (!projectId.trim() || !selectedProp || !file || !isSupportedWritebackMimeType(file.type) || !file.type.toLowerCase().startsWith("image/")) {
            setError("请选择道具和有效的图片文件。");
            return;
        }

        setOperation("upload");
        setError("");
        setOutcomeUnknown(false);
        try {
            const uploaded = await defaultActions.uploadCandidate(projectId.trim(), file, file.name);
            setCandidate(uploaded);
            setImpact(null);
            setResult(null);

            setOperation("impact");
            try {
                const loadedImpact = await fetchDramaPushImpact(projectId.trim(), propReferenceTarget(selectedProp));
                setImpact(loadedImpact);
            } catch (cause) {
                setError(`候选图片已上传，但读取受影响范围失败：${cause instanceof Error ? cause.message : "未知错误"}`);
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "候选图片上传失败");
        } finally {
            setOperation(null);
        }
    };

    const reloadImpact = async () => {
        if (!candidate || !selectedProp) return;
        setOperation("impact");
        if (!outcomeUnknown) setError("");
        setImpact(null);
        setResult(null);
        try {
            setImpact(await fetchDramaPushImpact(projectId.trim(), propReferenceTarget(selectedProp)));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "读取受影响范围失败");
        } finally {
            setOperation(null);
        }
    };

    const confirmWriteback = async () => {
        setOperation("push");
        setError("");
        setOutcomeUnknown(false);
        let completedResult: DramaPushResult | undefined;
        try {
            const confirmed = await defaultActions.confirm({ projectId: projectId.trim(), propName: selectedProp, candidate, impact, markStale });
            setResult(confirmed.result);
            completedResult = confirmed.result;
        } catch (cause) {
            const uncertain = cause instanceof WritebackActionError && cause.step === "push";
            setOutcomeUnknown(uncertain);
            setError(cause instanceof Error ? cause.message : "道具参考图写回失败");
        } finally {
            setOperation(null);
        }
        if (completedResult) onComplete?.();
    };

    const selectProp = (name: string) => {
        setSelectedProp(name);
        clearWritebackState();
    };

    const selectFile = (picked: File | null) => {
        setFile(picked);
        clearWritebackState();
    };

    const fileTypeValid = Boolean(file && isSupportedWritebackMimeType(file.type) && file.type.toLowerCase().startsWith("image/"));

    return (
        <PropReferenceWritebackView
            props={props}
            selectedProp={selectedProp}
            filename={file?.name ?? ""}
            fileTypeValid={fileTypeValid}
            candidate={candidate}
            impact={impact}
            result={result}
            error={error}
            outcomeUnknown={outcomeUnknown}
            busy={operation !== null}
            operation={operation}
            markStale={markStale}
            onSelectProp={selectProp}
            onSelectFile={selectFile}
            onToggleStale={setMarkStale}
            onUpload={uploadCandidate}
            onReloadImpact={reloadImpact}
            onConfirm={confirmWriteback}
        />
    );
}
