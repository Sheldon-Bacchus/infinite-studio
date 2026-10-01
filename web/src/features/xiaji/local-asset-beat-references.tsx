// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Film } from "lucide-react";

import type { Asset } from "@/stores/use-asset-store";
import { listLocalStudioAssetBeatReferences } from "./local-studio-model";
import { localStudioRoutes } from "./local-studio-routes";

export function LocalAssetBeatReferences({
    assets,
    assetId,
    initialExpanded = false,
}: {
    assets: Asset[];
    assetId: string;
    initialExpanded?: boolean;
}) {
    const [expanded, setExpanded] = useState(initialExpanded);
    const references = expanded ? listLocalStudioAssetBeatReferences(assets, assetId) : [];

    return (
        <section className="rounded-lg border border-border/70 bg-card/30 p-4">
            <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 text-left text-sm font-medium hover:text-foreground">
                <Film aria-hidden="true" className="size-4 text-muted-foreground" />
                <span>出现于镜头</span>
                {expanded ? <span className="text-xs tabular-nums text-muted-foreground">({references.length})</span> : null}
                <ChevronDown aria-hidden="true" className={`ml-auto size-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
            {expanded ? references.length ? (
                <div className="mt-3 flex max-h-52 flex-wrap gap-2 overflow-y-auto">
                    {references.map((reference) => (
                        <Link key={reference.beatAssetId} href={localStudioRoutes.beats(reference.projectAssetId, reference.episodeAssetId, "text", reference.beatAssetId)} className="rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground">
                            第 {reference.episodeOrder} 集 · 镜头 {reference.beatOrder} · {reference.beatTitle}
                        </Link>
                    ))}
                </div>
            ) : <p className="mt-3 text-xs text-muted-foreground">暂无关联镜头</p> : null}
        </section>
    );
}
