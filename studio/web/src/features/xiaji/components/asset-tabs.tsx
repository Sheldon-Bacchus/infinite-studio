// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw characters.lazy.tsx asset tabs.
import { Plus, Search } from "lucide-react";

import type { DramaAssetCategory, DramaAssetMediaFilter } from "../asset-query";

export type XiaJiAssetViewState = {
    view: "mine" | "library";
    category: DramaAssetCategory;
    mediaType: DramaAssetMediaFilter;
    tag: string;
    query: string;
};

const MEDIA_FILTERS: Array<{ value: DramaAssetMediaFilter; label: string }> = [
    { value: "all", label: "全部" },
    { value: "text", label: "文本" },
    { value: "image", label: "图片" },
    { value: "video", label: "视频" },
    { value: "audio", label: "音频" },
];

const CATEGORIES: Array<{ value: DramaAssetCategory; label: string }> = [
    { value: "all", label: "全部分类" },
    { value: "characters", label: "人物" },
    { value: "scenes", label: "场景" },
    { value: "props", label: "道具" },
    { value: "voices", label: "声线" },
    { value: "beats", label: "分镜" },
];

export function AssetTabs({
    state,
    tags,
    categories,
    showViews = true,
    onChange,
    onAdd,
}: {
    state: XiaJiAssetViewState;
    tags: string[];
    categories?: string[];
    showViews?: boolean;
    onChange: (value: Partial<XiaJiAssetViewState>) => void;
    onAdd?: () => void;
}) {
    const categoryOptions = categories !== undefined
        ? [{ value: "all", label: "全部分类" }, ...categories.map((value) => ({ value, label: CATEGORIES.find((category) => category.value === value)?.label || value }))]
        : CATEGORIES;
    return (
        <section className="space-y-4 border-b border-border/60 px-5 py-4">
            {showViews ? <div className="flex items-center gap-7 border-b border-border/40">
                {([
                    ["mine", "我的素材"],
                    ["library", "素材库"],
                ] as const).map(([view, label]) => (
                    <button
                        key={view}
                        type="button"
                        role="tab"
                        aria-selected={state.view === view}
                        onClick={() => onChange({ view })}
                        className={`-mb-px border-b-2 px-0.5 pb-2 text-sm font-medium transition-colors ${state.view === view ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                    >
                        {label}
                    </button>
                ))}
            </div> : null}

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {MEDIA_FILTERS.map(({ value, label }) => (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={state.mediaType === value}
                        onClick={() => onChange({ mediaType: value })}
                        className={`border-b-2 px-0.5 pb-1 text-sm transition-colors ${state.mediaType === value ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="grid gap-1 text-xs text-muted-foreground">
                    分类
                    <select
                        aria-label="分类"
                        value={state.category}
                        onChange={(event) => onChange({ category: event.target.value as DramaAssetCategory })}
                        className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        {categoryOptions.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
                    </select>
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                    标签
                    <select
                        aria-label="标签"
                        value={state.tag}
                        onChange={(event) => onChange({ tag: event.target.value })}
                        className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <option value="all">全部</option>
                        {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                    </select>
                </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-ring sm:max-w-lg">
                    <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <input
                        type="search"
                        aria-label="搜索素材"
                        placeholder="搜索素材"
                        value={state.query}
                        onChange={(event) => onChange({ query: event.target.value })}
                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    />
                </label>
                {onAdd && (
                    <button type="button" onClick={onAdd} className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                        <Plus aria-hidden="true" className="size-4" />
                        添加
                    </button>
                )}
            </div>
        </section>
    );
}
