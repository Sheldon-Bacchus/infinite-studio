// SPDX-License-Identifier: AGPL-3.0-or-later

export type LocalStudioIntakeActionInput = {
    title: string;
    sourceText: string;
    draftCount: number;
    saving: boolean;
    analyzing: boolean;
};

export function tryAcquireLocalStudioSubmission(lock: { current: boolean }): boolean {
    if (lock.current) return false;
    lock.current = true;
    return true;
}

export function getLocalStudioIntakeActions(input: LocalStudioIntakeActionInput) {
    let saveHint = input.draftCount
        ? `识别到 ${input.draftCount} 集；检查后可与原稿一起保存。`
        : "项目和原稿可以先保存；分集可稍后导入 Agent 产物。";

    if (input.saving) saveHint = "正在保存项目，请稍候。";
    else if (!input.title.trim()) saveHint = "请先填写项目名称。";
    else if (!input.sourceText.trim()) saveHint = "请先上传或粘贴小说/剧本原文。";

    return {
        primaryAction: "recognize-headings" as const,
        primaryLabel: "按标题识别",
        primaryDisabled: input.saving || input.analyzing || !input.sourceText.trim(),
        saveDisabled: input.saving || !input.title.trim() || !input.sourceText.trim(),
        saveLabel: "保存项目并进入虾镜",
        nextStepHint: "保存成功后自动进入该项目的虾镜分集页。",
        saveHint,
    };
}
