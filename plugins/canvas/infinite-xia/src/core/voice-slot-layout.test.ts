import { describe, expect, test } from "bun:test";

import { getXiaTangVoiceSlotRows } from "./voice-slot-layout";

describe("DramaClaw voice slot layout adaptation", () => {
    test("maps the default sample to the character's primary age slot", () => {
        expect(getXiaTangVoiceSlotRows("青年")).toEqual([
            { displaySlot: "child", storageSlot: "child", label: "幼年（可选覆盖）", required: false },
            { displaySlot: "youth", storageSlot: "default", label: "青年（默认 · 必填）", required: true },
            { displaySlot: "middle", storageSlot: "middle", label: "中年（可选覆盖）", required: false },
            { displaySlot: "elder", storageSlot: "elder", label: "老年（可选覆盖）", required: false },
        ]);
    });

    test("shows a separate required default row when no recognized age is set", () => {
        expect(getXiaTangVoiceSlotRows(undefined)).toEqual([
            { displaySlot: "default", storageSlot: "default", label: "默认（必填）", required: true },
            { displaySlot: "child", storageSlot: "child", label: "幼年（可选覆盖）", required: false },
            { displaySlot: "youth", storageSlot: "youth", label: "青年（可选覆盖）", required: false },
            { displaySlot: "middle", storageSlot: "middle", label: "中年（可选覆盖）", required: false },
            { displaySlot: "elder", storageSlot: "elder", label: "老年（可选覆盖）", required: false },
        ]);
    });

    test("accepts upstream and local age values without creating duplicate default slots", () => {
        expect(getXiaTangVoiceSlotRows("young")[1]?.storageSlot).toBe("default");
        expect(getXiaTangVoiceSlotRows("youth")[1]?.storageSlot).toBe("default");
        expect(getXiaTangVoiceSlotRows("elder")[3]?.storageSlot).toBe("default");
        expect(getXiaTangVoiceSlotRows("unknown")[0]?.storageSlot).toBe("default");
    });
});
