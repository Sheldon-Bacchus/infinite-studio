// SPDX-License-Identifier: AGPL-3.0-or-later

export type LocalStudioScriptPromptInput = {
    projectType: string;
    episodeOrder: number;
    episodeTitle: string;
    synopsis?: string;
    sourceText: string;
    mode: "script" | "line-by-line";
    targetLines?: number;
    minCharsPerLine?: number;
    maxCharsPerLine?: number;
};

export function buildLocalStudioScriptPrompt(input: LocalStudioScriptPromptInput): string {
    const isNarrated = input.projectType === "narrated";
    const task = isNarrated
        ? `将本集改写成适合解说漫剧的口播稿。目标 ${input.targetLines || 20} 行，每行 ${input.minCharsPerLine || 15} 到 ${input.maxCharsPerLine || 30} 个字，保持情节因果与人物称呼一致。`
        : "根据本集原文改写成可拍摄的分集剧本，包含场景标题、动作、人物和对白。";
    const lineMode = input.mode === "line-by-line"
        ? "每行单独成句，按行输出，不要合并段落。"
        : "按自然段输出完整正文。";

    return [
        task,
        lineMode,
        `第 ${input.episodeOrder} 集：${input.episodeTitle}`,
        `本集梗概：${input.synopsis?.trim() || "请根据原文安排本集情节"}`,
        `项目原文：\n${input.sourceText.slice(0, 24000)}`,
        "只返回剧本正文，不返回解释，不声称保存或生成媒体。",
    ].join("\n\n");
}
