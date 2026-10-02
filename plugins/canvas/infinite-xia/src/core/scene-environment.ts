// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw's scene-environment-prompt.tsx; keeps its seven-heading contract.

export const SCENE_ENVIRONMENT_SECTIONS = [
    { key: "front", label: "正面" },
    { key: "left", label: "左侧" },
    { key: "right", label: "右侧" },
    { key: "back", label: "背面" },
    { key: "light", label: "光源" },
    { key: "material", label: "材质/风格" },
    { key: "forbidden", label: "禁止元素" },
] as const;

export type SceneEnvironmentKey = (typeof SCENE_ENVIRONMENT_SECTIONS)[number]["key"];
export type SceneEnvironmentFields = Record<SceneEnvironmentKey, string>;

function emptyFields(): SceneEnvironmentFields {
    return { front: "", left: "", right: "", back: "", light: "", material: "", forbidden: "" };
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSceneEnvironmentPrompt(prompt: string | null | undefined): SceneEnvironmentFields {
    const result = emptyFields();
    const text = (prompt || "").replace(/\r\n/g, "\n").trim();
    if (!text) return result;
    const labels = SCENE_ENVIRONMENT_SECTIONS.map(({ label }) => escapeRegExp(label)).join("|");
    const headingPattern = new RegExp(`(?:^|\\n)\\s*(${labels})\\s*[:：]`, "g");
    const hits: Array<{ key: SceneEnvironmentKey; labelStart: number; contentStart: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = headingPattern.exec(text)) !== null) {
        const section = SCENE_ENVIRONMENT_SECTIONS.find((candidate) => candidate.label === match?.[1]);
        if (section) hits.push({ key: section.key, labelStart: match.index, contentStart: match.index + match[0].length });
    }
    if (!hits.length) {
        result.front = text;
        return result;
    }
    for (let index = 0; index < hits.length; index += 1) {
        const current = hits[index];
        const end = hits[index + 1]?.labelStart ?? text.length;
        const content = text.slice(current.contentStart, end).trim();
        result[current.key] = result[current.key] ? `${result[current.key]}\n${content}` : content;
    }
    const preamble = text.slice(0, hits[0].labelStart).trim();
    if (preamble) result.front = result.front ? `${preamble}\n${result.front}` : preamble;
    return result;
}

export function serializeSceneEnvironmentPrompt(fields: SceneEnvironmentFields) {
    return SCENE_ENVIRONMENT_SECTIONS
        .map(({ key, label }) => ({ label, value: (fields[key] || "").trim() }))
        .filter(({ value }) => value.length > 0)
        .map(({ label, value }) => `${label}：${value}`)
        .join("\n");
}
