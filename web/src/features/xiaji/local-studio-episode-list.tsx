// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import { Button, Input, Tag } from "antd";
import { ArrowDown, ArrowUp, Check, Pencil, X } from "lucide-react";

import type { Asset } from "@/stores/use-asset-store";
import { getLocalStudioRecord, type LocalStudioEpisodeStats } from "./local-studio-model";

function episodeContent(episode: Asset): string {
    return episode.kind === "text" ? episode.data.content : "";
}

export function LocalStudioEpisodeList({
    episodes,
    beatCounts,
    episodeStats = {},
    editingEpisodeId,
    saving,
    onEdit,
    onCancelEdit,
    onSave,
    onMove,
}: {
    episodes: Asset[];
    beatCounts: Record<string, number>;
    episodeStats?: Record<string, LocalStudioEpisodeStats>;
    editingEpisodeId: string | null;
    saving: boolean;
    onEdit: (episodeId: string) => void;
    onCancelEdit: () => void;
    onSave: (episodeId: string, title: string, synopsis: string) => void;
    onMove: (episodeId: string, direction: -1 | 1) => void;
}) {
    const [title, setTitle] = useState("");
    const [synopsis, setSynopsis] = useState("");
    const editingEpisode = episodes.find((episode) => episode.id === editingEpisodeId);
    const editingRecord = editingEpisode ? getLocalStudioRecord(editingEpisode) : null;

    useEffect(() => {
        setTitle(editingRecord?.recordType === "episode" ? editingRecord.title : "");
        setSynopsis(editingRecord?.recordType === "episode" ? editingRecord.synopsis || (editingEpisode ? episodeContent(editingEpisode) : "") : "");
    }, [editingEpisodeId]);

    return (
        <section aria-label="分集规划列表" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {episodes.map((episode, index) => {
                const record = getLocalStudioRecord(episode);
                if (record?.recordType !== "episode") return null;
                const editing = episode.id === editingEpisodeId;
                const stats = episodeStats[episode.id];
                const beatCount = stats?.beatCount ?? beatCounts[episode.id] ?? 0;
                return (
                    <article key={episode.id} aria-label={`第 ${record.order} 集：${record.title}`} className="flex flex-col rounded-xl border border-border bg-card/50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Tag color="blue">第 {record.order} 集</Tag>
                                    <strong className="truncate">{record.title}</strong>
                                    {record.sourceEpisodeNumber ? <span className="text-xs text-muted-foreground">来源第 {record.sourceEpisodeNumber} 集</span> : null}
                                </div>
                                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{record.synopsis || episodeContent(episode) || "暂无梗概"}</p>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button size="small" aria-label={`上移${record.title}`} disabled={saving || index === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => onMove(episode.id, -1)} />
                                <Button size="small" aria-label={`下移${record.title}`} disabled={saving || index === episodes.length - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => onMove(episode.id, 1)} />
                            </div>
                        </div>
                        <div aria-label="分集制作统计" className="my-4 flex flex-wrap gap-2 border-y border-border/60 py-3 text-xs text-muted-foreground">
                            {stats ? <span>{stats.sourceTextLineCount} 行文本</span> : null}
                            <span>{stats?.scriptLineCount ?? 0} 行剧本</span>
                            <span>{beatCount} 个镜头</span>
                            <span>{stats?.identityCount ?? 0} 个身份</span>
                            <span>{stats?.sceneCount ?? 0} 个场景</span>
                            <span>{stats?.propCount ?? 0} 个道具</span>
                            <Tag color={stats?.scriptReady ? "green" : "default"}>{stats?.scriptReady ? "剧本已保存" : "待写剧本"}</Tag>
                        </div>
                        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap gap-1">
                                <Button size="small" aria-label={`编辑${record.title}`} disabled={saving} icon={<Pencil className="size-3.5" />} onClick={() => onEdit(episode.id)}>编辑</Button>
                                <Button size="small" disabled={saving} href={`/xiaji/project/${encodeURIComponent(record.projectAssetId)}/episodes/by-id/${encodeURIComponent(episode.id)}/beats`}>镜头</Button>
                                <Button size="small" disabled={saving} href={`/xiaji/project/${encodeURIComponent(record.projectAssetId)}/episodes/by-id/${encodeURIComponent(episode.id)}/compose`}>合成</Button>
                            </div>
                            <Button type="primary" size="small" disabled={saving} href={`/xiaji/project/${encodeURIComponent(record.projectAssetId)}/episodes/by-id/${encodeURIComponent(episode.id)}/script`}>查看详情</Button>
                        </div>
                        {editing ? (
                            <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
                                <Input aria-label="分集标题" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
                                <Input.TextArea aria-label="分集梗概" value={synopsis} rows={3} onChange={(event) => setSynopsis(event.target.value)} />
                                <div className="flex justify-end gap-2">
                                    <Button icon={<X className="size-4" />} disabled={saving} onClick={onCancelEdit}>取消</Button>
                                    <Button type="primary" icon={<Check className="size-4" />} loading={saving} disabled={!title.trim()} onClick={() => onSave(episode.id, title, synopsis)}>保存分集</Button>
                                </div>
                            </div>
                        ) : null}
                    </article>
                );
            })}
        </section>
    );
}
