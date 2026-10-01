"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Checkbox, Input, Modal, Select, Space, Spin } from "antd";

import {
    createDramaIdentity,
    fetchDramaAssetHistory,
    fetchDramaAssetCatalog,
    fetchDramaPushImpact,
    pushDramaCandidate,
    restoreDramaAssetHistory,
    uploadDramaCandidate,
    type DramaAssetHistory,
    type DramaImportAsset,
    type DramaPushTarget,
} from "@/services/api/drama-import";
import { assetsForWritebackProject, canBrowseDramaHistory, dramaHistoryDescriptor, runWritebackAction, WritebackActionError } from "../writeback";

function asPushTarget(value: Record<string, unknown> | undefined): DramaPushTarget | null {
    if (!value || typeof value.kind !== "string") return null;
    const target: Record<string, string | number> = { kind: value.kind };
    for (const [key, item] of Object.entries(value)) {
        if (key === "kind") continue;
        if (typeof item === "string" || typeof item === "number") target[key] = item;
        else return null;
    }
    return target as DramaPushTarget;
}

function targetLabel(asset: DramaImportAsset) {
    const target = asset.slotTarget || {};
    const character = typeof target.character === "string" ? ` · ${target.character}` : "";
    const episode = typeof target.episode === "number" ? ` · 第${target.episode}集/${target.beat ?? ""}` : "";
    return `${asset.label || asset.role}${character}${episode}（${asset.role}）`;
}

function historyKindLabel(kind: string) {
    return ({ portrait: "角色立绘", identity: "身份图", identity_costume: "服装图", identity_portrait: "身份肖像" } as Record<string, string>)[kind] || kind;
}

const EMPTY_ASSETS: DramaImportAsset[] = [];

export function WritebackDialog({
    open,
    onClose,
    initialProjectId = "",
    initialAsset,
    sourceFile,
    sourceFilename = "canvas-result.png",
    availableAssets = EMPTY_ASSETS,
}: {
    open: boolean;
    onClose: () => void;
    initialProjectId?: string;
    initialAsset?: DramaImportAsset | null;
    sourceFile?: Blob;
    sourceFilename?: string;
    availableAssets?: DramaImportAsset[];
}) {
    const { message, modal } = App.useApp();
    const [projectId, setProjectId] = useState(initialProjectId);
    const [file, setFile] = useState<Blob | null>(sourceFile || null);
    const [filename, setFilename] = useState(sourceFilename);
    const [candidate, setCandidate] = useState<{ url: string; filename?: string; size?: number } | null>(null);
    const [catalogAssets, setCatalogAssets] = useState<DramaImportAsset[]>(availableAssets);
    const [loadedProjectId, setLoadedProjectId] = useState(initialProjectId);
    const [selectedAssetId, setSelectedAssetId] = useState(initialAsset?.id || "");
    const [identityCharacter, setIdentityCharacter] = useState("");
    const [identityName, setIdentityName] = useState("");
    const [appearanceDetails, setAppearanceDetails] = useState("");
    const [markStale, setMarkStale] = useState(false);
    const [impact, setImpact] = useState<{ affected_count: number; affected_beats: Array<{ episode: number; beat: number }> } | null>(null);
    const [history, setHistory] = useState<DramaAssetHistory | null>(null);
    const [loading, setLoading] = useState(false);
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [error, setError] = useState("");
    const [uncertainWrite, setUncertainWrite] = useState(false);

    useEffect(() => {
        if (!open) return;
        setProjectId(initialProjectId);
        setFile(sourceFile || null);
        setFilename(sourceFilename);
        setCandidate(null);
        setCatalogAssets(availableAssets);
        setLoadedProjectId(initialProjectId);
        setSelectedAssetId(initialAsset?.id || "");
        setIdentityCharacter(typeof initialAsset?.slotTarget?.character === "string"
            ? initialAsset.slotTarget.character
            : typeof initialAsset?.meta?.character === "string" ? initialAsset.meta.character : "");
        setIdentityName("");
        setAppearanceDetails("");
        setImpact(null);
        setHistory(null);
        setError("");
        setUncertainWrite(false);
        setMarkStale(false);
    }, [open, initialProjectId, initialAsset, sourceFile, sourceFilename, availableAssets]);

    const projectAssets = useMemo(() => assetsForWritebackProject(projectId, initialProjectId, loadedProjectId, availableAssets, catalogAssets), [projectId, initialProjectId, loadedProjectId, availableAssets, catalogAssets]);
    const targets = useMemo(() => {
        const unique = new Map<string, DramaImportAsset>();
        for (const asset of projectAssets) {
            if (asset.exists && asset.pushable === true && asPushTarget(asset.slotTarget)) unique.set(asset.id, asset);
        }
        return [...unique.values()];
    }, [projectAssets]);
    const selectedAsset = targets.find((asset) => asset.id === selectedAssetId);
    const target = asPushTarget(selectedAsset?.slotTarget);
    const historyAsset = selectedAsset || projectAssets.find((asset) => asset.id === initialAsset?.id);
    const historyDescriptor = historyAsset ? dramaHistoryDescriptor(historyAsset) : null;

    const loadCatalog = async () => {
        const id = projectId.trim();
        if (!id) return setError("请先输入 DramaClaw 项目 ID");
        setCatalogLoading(true);
        setError("");
        try {
            const catalog = await fetchDramaAssetCatalog(id);
            setCatalogAssets(catalog.assets);
            setLoadedProjectId(id);
            setImpact(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "读取虾集素材目录失败");
        } finally {
            setCatalogLoading(false);
        }
    };

    const uploadOnly = async () => {
        if (!file || !projectId.trim()) return setError("请先选择素材并填写项目 ID");
        setLoading(true);
        setError("");
        setUncertainWrite(false);
        try {
            const result = await uploadDramaCandidate(projectId.trim(), file, filename);
            setCandidate(result);
            message.success("候选素材已保存到虾集，可继续选择创建身份或替换素材");
        } catch (cause) {
            setUncertainWrite(true);
            setError(cause instanceof Error ? cause.message : "保存候选失败");
        } finally {
            setLoading(false);
        }
    };

    const readImpact = async () => {
        if (!projectId.trim() || !target) return setError("请选择一个可替换的虾集素材槽位");
        setLoading(true);
        setError("");
        try {
            setImpact(await fetchDramaPushImpact(projectId.trim(), target));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "读取替换影响范围失败");
        } finally {
            setLoading(false);
        }
    };

    const runConfirmedAction = async (kind: "identity" | "replace") => {
        const id = projectId.trim();
        if (!id || (!candidate && !file)) return setError("请先选择或保存候选素材");
        if (kind === "identity" && (!identityCharacter.trim() || !identityName.trim())) return setError("创建角色身份需要填写人物名和身份名");
        if (kind === "replace" && (!target || !impact)) return setError("请先选择目标槽位并读取影响范围");
        setLoading(true);
        setError("");
        setUncertainWrite(false);
        try {
            const result = await runWritebackAction(kind === "identity" ? {
                kind,
                projectId: id,
                ...(candidate ? { candidate } : { file: file!, filename }),
                identity: { character: identityCharacter.trim(), identity_name: identityName.trim(), appearance_details: appearanceDetails.trim() },
            } : {
                kind,
                projectId: id,
                ...(candidate ? { candidate } : { file: file!, filename }),
                target: target!,
                markStale,
            }, {
                upload: uploadDramaCandidate,
                createIdentity: createDramaIdentity,
                push: pushDramaCandidate,
            });
            if (result.cancelled) return;
            setCandidate(result.candidate);
            message.success(kind === "identity" ? "已创建角色身份" : "已替换虾集素材");
            setImpact(null);
            if (kind === "replace") await loadCatalog();
        } catch (cause) {
            if (cause instanceof WritebackActionError && cause.candidate) setCandidate(cause.candidate);
            setUncertainWrite(cause instanceof WritebackActionError);
            setError(cause instanceof Error ? cause.message : "虾集写回失败");
        } finally {
            setLoading(false);
        }
    };

    const confirmReplace = () => {
        if (!selectedAsset || !impact) return;
        const beats = impact.affected_beats.slice(0, 8).map((beat) => `第${beat.episode}集·分镜${beat.beat}`).join("、");
        modal.confirm({
            title: "确认替换虾集素材？",
            content: <div className="space-y-2"><p>目标：{targetLabel(selectedAsset)}</p><p>DramaClaw 会替换该槽位，并自动备份当前文件。影响分镜：{impact.affected_count} 个{beats ? `（${beats}${impact.affected_count > 8 ? "等" : ""}）` : ""}。</p><p>此写入没有请求幂等键；如果请求结果不确定，请先刷新虾集目录核对，勿直接重试。</p></div>,
            okText: "确认替换",
            cancelText: "取消",
            onOk: () => runConfirmedAction("replace"),
        });
    };

    const loadHistory = async () => {
        if (!historyDescriptor || !projectId.trim()) return;
        setLoading(true);
        setError("");
        try {
            setHistory(await fetchDramaAssetHistory(projectId.trim(), historyDescriptor.character, historyDescriptor.kind, historyDescriptor.identityId));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "读取角色素材历史失败");
        } finally {
            setLoading(false);
        }
    };

    const confirmRestore = (historyId: string) => {
        if (!historyDescriptor || !projectId.trim() || historyAsset?.restoreAvailable !== true) return;
        modal.confirm({
            title: "确认恢复角色素材？",
            content: "选中的历史文件会覆盖当前角色素材；DramaClaw 会按其角色素材历史机制处理当前文件。",
            okText: "确认恢复",
            cancelText: "取消",
            onOk: async () => {
                setLoading(true);
                try {
                    const restored = await restoreDramaAssetHistory(projectId.trim(), historyDescriptor.character, {
                        kind: historyDescriptor.kind,
                        ...(historyDescriptor.identityId ? { identity_id: historyDescriptor.identityId } : {}),
                        history_id: historyId,
                    });
                    if (!restored.restored) throw new Error("虾集未确认角色素材恢复成功");
                    message.success("角色素材已恢复");
                    await loadHistory();
                    await loadCatalog();
                } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "恢复角色素材失败；请刷新虾集目录核对");
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    return (
        <Modal title="虾集素材写回" open={open} onCancel={onClose} footer={null} width={620} destroyOnHidden>
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">写回只在你点击对应操作并确认后发生。先保存候选，再分别创建新身份或替换现有槽位。</p>
                <div className="flex gap-2">
                    <Input aria-label="DramaClaw 项目 ID" value={projectId} onChange={(event) => {
                        const nextId = event.target.value;
                        if (nextId.trim() !== projectId.trim()) {
                            setLoadedProjectId("");
                            setCatalogAssets([]);
                            setSelectedAssetId("");
                            setCandidate(null);
                            setIdentityCharacter("");
                            setIdentityName("");
                        }
                        setProjectId(nextId);
                        setImpact(null);
                        setHistory(null);
                    }} placeholder="DramaClaw 项目 ID" />
                    <Button loading={catalogLoading} onClick={loadCatalog}>读取素材</Button>
                </div>
                <label className="block space-y-1 text-sm">
                    <span>候选文件（图片、视频或音频）</span>
                    <input aria-label="候选文件" type="file" accept="image/*,video/*,audio/*" onChange={(event) => { const picked = event.target.files?.[0] || null; setFile(picked); setFilename(picked?.name || sourceFilename); setCandidate(null); setError(""); }} />
                    {file ? <span className="block text-xs text-muted-foreground">{filename} · {Math.ceil(file.size / 1024)} KB</span> : null}
                </label>
                <Button type="primary" loading={loading} disabled={!file || !projectId.trim()} onClick={uploadOnly}>保存候选到虾集</Button>
                {candidate ? <Alert type="success" showIcon message="候选已保存" description={<span className="break-all">{candidate.url}</span>} /> : null}

                <section className="space-y-2 rounded-lg border border-border p-3">
                    <h3 className="font-medium">创建角色身份</h3>
                    <div className="grid grid-cols-2 gap-2">
                        <Input aria-label="人物名" value={identityCharacter} onChange={(event) => setIdentityCharacter(event.target.value)} placeholder="人物名" />
                        <Input aria-label="身份名" value={identityName} onChange={(event) => setIdentityName(event.target.value)} placeholder="身份名" />
                    </div>
                    <Input aria-label="外观说明" value={appearanceDetails} onChange={(event) => setAppearanceDetails(event.target.value)} placeholder="外观说明（可选）" />
                    <Button loading={loading} disabled={!projectId.trim() || (!candidate && !file) || !identityCharacter.trim() || !identityName.trim()} onClick={() => {
                        modal.confirm({ title: "确认创建角色身份？", content: `将从${candidate ? "已保存候选" : "所选文件"}为 ${identityCharacter} 创建新身份 ${identityName}。`, okText: "确认创建", cancelText: "取消", onOk: () => runConfirmedAction("identity") });
                    }}>确认创建身份</Button>
                </section>

                <section className="space-y-2 rounded-lg border border-border p-3">
                    <h3 className="font-medium">替换现有素材</h3>
                    <Select
                        className="w-full"
                        aria-label="替换目标槽位"
                        value={selectedAssetId || undefined}
                        placeholder="选择可替换的虾集素材槽位"
                        options={targets.map((asset) => ({ value: asset.id, label: targetLabel(asset) }))}
                        onChange={(value) => { setSelectedAssetId(value); setImpact(null); setHistory(null); }}
                    />
                    {selectedAsset ? <p className="text-xs text-muted-foreground">目标槽位：{targetLabel(selectedAsset)}。替换时上游会自动备份当前文件。</p> : null}
                    <Space wrap>
                        <Button loading={loading} disabled={!target || !projectId.trim()} onClick={readImpact}>读取影响分镜</Button>
                        <Checkbox checked={markStale} onChange={(event) => setMarkStale(event.target.checked)}>标记影响分镜为过期</Checkbox>
                    </Space>
                    {impact ? <Alert type="info" showIcon message={`影响 ${impact.affected_count} 个分镜`} description={impact.affected_beats.slice(0, 8).map((beat) => `第${beat.episode}集·分镜${beat.beat}`).join("、") || "没有关联分镜"} /> : null}
                    <Button danger loading={loading} disabled={!target || !impact || (!candidate && !file)} onClick={confirmReplace}>确认替换素材</Button>
                </section>

                    {historyAsset && canBrowseDramaHistory(historyAsset) ? <section className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between"><h3 className="font-medium">角色素材历史 · {historyKindLabel(historyDescriptor?.kind || "")}</h3><Button loading={loading} onClick={loadHistory}>读取历史</Button></div>
                    {!historyAsset.restoreAvailable ? <p className="text-xs text-muted-foreground">上游提供历史浏览，但未提供恢复链接。</p> : null}
                    {history ? <div className="max-h-48 space-y-2 overflow-auto">{history.entries.length ? history.entries.map((entry) => <div key={entry.history_id} className="flex items-center justify-between gap-2 rounded border border-border/70 p-2 text-xs"><span>{entry.filename} · {new Date(entry.created_at).toLocaleString()}</span>{historyAsset.restoreAvailable ? <Button size="small" onClick={() => confirmRestore(entry.history_id)}>恢复</Button> : null}</div>) : <p className="text-xs text-muted-foreground">暂无历史备份。</p>}</div> : null}
                </section> : null}

                {error ? <Alert type={uncertainWrite ? "warning" : "error"} showIcon message={uncertainWrite ? "写回结果待核对" : "操作失败"} description={uncertainWrite ? `${error}。候选文件可能已经留在虾集的 _uploads 目录，或目标写入已完成但响应丢失。请刷新虾集素材目录/角色历史确认状态，再决定下一步；系统没有自动重试。` : error} /> : null}
                {loading ? <Spin size="small" /> : null}
            </div>
        </Modal>
    );
}
