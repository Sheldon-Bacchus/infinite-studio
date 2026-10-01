type LocalCanvasSyncNoticeProps = {
    message: string | null;
    draft?: { draftId: string; savedAt: string; project: { id: string; title: string } };
    recoveringDraft?: boolean;
    onRecover?: (draftId: string) => void;
};

export function LocalCanvasSyncNotice({ message, draft, recoveringDraft = false, onRecover }: LocalCanvasSyncNoticeProps) {
    if (!message && !draft) return null;

    return (
        <div role="alert" className="absolute left-4 right-4 top-16 z-[80] mx-auto max-w-2xl rounded-lg border border-red-500/40 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-xl">
            <div className="font-semibold">{message ? "画布保存暂停" : "检测到未保存的冲突副本"}</div>
            {message ? <p className="mt-1">{message}</p> : null}
            {draft ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p>“{draft.project.title}”有一份冲突时自动保存的副本。</p>
                    <button
                        type="button"
                        disabled={recoveringDraft || !onRecover}
                        onClick={() => onRecover?.(draft.draftId)}
                        className="rounded-md border border-red-200/50 px-3 py-1.5 font-medium hover:bg-red-900 disabled:cursor-wait disabled:opacity-60"
                    >
                        {recoveringDraft ? "正在恢复…" : "恢复为新画布"}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
