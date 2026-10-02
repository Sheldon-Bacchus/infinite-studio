// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw episode beat browsing layout.
import { Send } from "lucide-react";

import type { DramaImportBeat } from "@/services/api/drama-import";

export function BeatBrowser({
    beats,
    selectedBeat,
    onSelect,
    onSend,
}: {
    beats: DramaImportBeat[];
    selectedBeat?: number | null;
    onSelect: (beat: number | null) => void;
    onSend: (beat: DramaImportBeat) => void;
}) {
    return (
        <section className="space-y-3" aria-label="虾集分镜">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">分镜</h2>
                <button type="button" onClick={() => onSelect(null)} className="text-xs text-muted-foreground hover:text-foreground">全部分镜</button>
            </div>
            {!beats.length ? <p className="text-xs text-muted-foreground">选择集数查看分镜</p> : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {beats.map((beat) => (
                        <article key={beat.beatNumber} className={`min-w-56 rounded-lg border p-3 ${selectedBeat === beat.beatNumber ? "border-primary/60 bg-accent/50" : "border-border bg-card"}`}>
                            <button type="button" onClick={() => onSelect(beat.beatNumber)} className="block w-full text-left">
                                <h3 className="truncate text-sm font-medium text-foreground">镜头 {beat.beatNumber} · {beat.title || "未命名"}</h3>
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{beat.content || beat.visualDescription || beat.prompt || "暂无分镜描述"}</p>
                            </button>
                            <button type="button" onClick={() => onSend(beat)} className="mt-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-foreground hover:bg-accent">
                                <Send aria-hidden="true" className="size-3" />发送到虾画
                            </button>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
