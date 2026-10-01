// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw's episode list and send-to-canvas action.
import { Send } from "lucide-react";

import type { DramaImportEpisode } from "@/services/api/drama-import";

export function EpisodeBrowser({
    episodes,
    selectedEpisode,
    onSelect,
    onSend,
}: {
    episodes: DramaImportEpisode[];
    selectedEpisode?: number | null;
    onSelect: (episode: number | null) => void;
    onSend: (episode: DramaImportEpisode) => void;
}) {
    return (
        <section className="space-y-3" aria-label="虾集集数">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">集数</h2>
                <button type="button" onClick={() => onSelect(null)} className="text-xs text-muted-foreground hover:text-foreground">全部集数</button>
            </div>
            {!episodes.length ? <p className="text-xs text-muted-foreground">加载虾集项目后显示集数</p> : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {episodes.map((episode) => (
                        <article key={episode.number} className={`min-w-48 rounded-lg border p-3 ${selectedEpisode === episode.number ? "border-primary/60 bg-accent/50" : "border-border bg-card"}`}>
                            <button type="button" onClick={() => onSelect(episode.number)} className="block w-full text-left">
                                <h3 className="truncate text-sm font-medium text-foreground">第 {episode.number} 集 · {episode.title || "未命名"}</h3>
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{episode.summary || `${episode.beatCount} 个分镜`}</p>
                            </button>
                            <button type="button" onClick={() => onSend(episode)} className="mt-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-foreground hover:bg-accent">
                                <Send aria-hidden="true" className="size-3" />发送到虾画
                            </button>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
