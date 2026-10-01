// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 ClaymoreLab
// Adapted from DramaClaw's CharacterVoicePanel age-to-default slot mapping.

export type XiaTangVoiceSlot = "default" | "child" | "youth" | "middle" | "elder";
export type XiaTangAgeSlot = Exclude<XiaTangVoiceSlot, "default">;

export type XiaTangVoiceSlotRow = {
    displaySlot: XiaTangVoiceSlot;
    storageSlot: XiaTangVoiceSlot;
    label: string;
    required: boolean;
};

const AGE_SLOT_ORDER: XiaTangAgeSlot[] = ["child", "youth", "middle", "elder"];
const AGE_LABELS: Record<XiaTangAgeSlot, string> = {
    child: "幼年",
    youth: "青年",
    middle: "中年",
    elder: "老年",
};

function normalizeAgeGroup(value: unknown): XiaTangAgeSlot | undefined {
    if (value === "child" || value === "幼年" || value === "儿童") return "child";
    if (value === "youth" || value === "young" || value === "青年") return "youth";
    if (value === "middle" || value === "中年") return "middle";
    if (value === "elder" || value === "老年") return "elder";
    return undefined;
}

/**
 * DramaClaw stores a character's primary voice in `default`; the panel displays
 * that sample under the character's age and shows other ages as optional overrides.
 */
export function getXiaTangVoiceSlotRows(ageGroup: unknown): XiaTangVoiceSlotRow[] {
    const primaryAge = normalizeAgeGroup(ageGroup);
    if (!primaryAge) {
        return [
            { displaySlot: "default", storageSlot: "default", label: "默认（必填）", required: true },
            ...AGE_SLOT_ORDER.map((slot) => ({
                displaySlot: slot,
                storageSlot: slot,
                label: `${AGE_LABELS[slot]}（可选覆盖）`,
                required: false,
            })),
        ];
    }

    return AGE_SLOT_ORDER.map((slot) => ({
        displaySlot: slot,
        storageSlot: slot === primaryAge ? "default" : slot,
        label: slot === primaryAge ? `${AGE_LABELS[slot]}（默认 · 必填）` : `${AGE_LABELS[slot]}（可选覆盖）`,
        required: slot === primaryAge,
    }));
}

