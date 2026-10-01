type CanvasConflictDraft = {
    draftId: string;
    savedAt: string;
    project: { id: string; title: string };
};

type CanvasConflictDraftListProps = {
    drafts: CanvasConflictDraft[];
    recoveringDraftId?: string | null;
    onRecover?: (draftId: string) => void;
};

export function CanvasConflictDraftList({ drafts, recoveringDraftId = null, onRecover }: CanvasConflictDraftListProps) {
    if (drafts.length === 0) return null;

    return (
        <section aria-label="未保存的画布恢复副本" className="rounded-xl border border-amber-400/50 bg-amber-50 p-5 dark:bg-amber-950/30">
            <h2 className="text-base font-semibold">未保存的画布恢复副本</h2>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">副本会另存为新画布，不会覆盖或合并原项目。</p>
            <div className="mt-4 grid gap-3">
                {drafts.map((draft) => (
                    <article key={draft.draftId} data-canvas-id={draft.project.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-300/70 bg-white/70 px-4 py-3 dark:border-stone-700 dark:bg-black/20">
                        <div>
                            <h3 className="font-medium">{draft.project.title}</h3>
                            <p className="mt-1 text-xs text-stone-500">恢复副本 · {new Date(draft.savedAt).toLocaleString("zh-CN")}</p>
                        </div>
                        <button
                            type="button"
                            disabled={recoveringDraftId !== null || !onRecover}
                            onClick={() => onRecover?.(draft.draftId)}
                            className="rounded-md border border-stone-400 px-3 py-1.5 text-sm font-medium hover:bg-stone-100 disabled:cursor-wait disabled:opacity-60 dark:border-stone-600 dark:hover:bg-white/10"
                        >
                            {recoveringDraftId === draft.draftId ? "正在恢复…" : "恢复为新画布"}
                        </button>
                    </article>
                ))}
            </div>
        </section>
    );
}
