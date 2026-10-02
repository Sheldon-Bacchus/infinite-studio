// SPDX-License-Identifier: AGPL-3.0-or-later

export type LocalEpisodeDraft = {
    title: string;
    order: number;
    sourceEpisodeNumber?: number;
    synopsis: string;
};

const CHINESE_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function parseEpisodeNumber(value: string): number | undefined {
    if (/^\d+$/.test(value)) return Number(value);
    let total = 0;
    let current = 0;
    for (const char of value) {
        if (char === "百") {
            total += (current || 1) * 100;
            current = 0;
        } else if (char === "十") {
            total += (current || 1) * 10;
            current = 0;
        } else if (char in CHINESE_DIGITS) {
            current = CHINESE_DIGITS[char];
        } else return undefined;
    }
    const parsed = total + current;
    return parsed > 0 ? parsed : undefined;
}

function synopsis(content: string) {
    return content.trim().slice(0, 360);
}

export function previewLocalEpisodeStructure(text: string, projectTitle: string): LocalEpisodeDraft[] {
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    const headings = [...normalized.matchAll(/^\s*(?:#{1,6}[ \t]*)?(?:(第([0-9零〇一二三四五六七八九十百两]+)\s*[章节集回][^\n]*)|((?:episode|chapter)\s*(\d+)[^\n]*))\s*$/gim)];
    if (!headings.length) return [];

    return headings.map((match, index) => {
        const start = (match.index || 0) + match[0].length;
        const end = headings[index + 1]?.index ?? normalized.length;
        const title = match[0].trim().replace(/^#{1,6}[ \t]*/, "");
        const sourceNumber = parseEpisodeNumber(match[2] || match[4] || "");
        return {
            title,
            order: index + 1,
            ...(sourceNumber ? { sourceEpisodeNumber: sourceNumber } : {}),
            synopsis: synopsis(normalized.slice(start, end)),
        };
    });
}
