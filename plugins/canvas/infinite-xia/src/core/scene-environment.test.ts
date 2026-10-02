import { describe, expect, test } from "bun:test";
import { parseSceneEnvironmentPrompt, serializeSceneEnvironmentPrompt } from "./scene-environment";

describe("XiaTang scene environment fields", () => {
    test("round-trips all seven labeled source sections without losing legacy free text", () => {
        const prompt = "正面：门窗\n左侧：石墙\n右侧：柜台\n背面：巷口\n光源：暖灯\n材质/风格：木石\n禁止元素：现代招牌";
        expect(serializeSceneEnvironmentPrompt(parseSceneEnvironmentPrompt(prompt))).toBe(prompt);
        expect(serializeSceneEnvironmentPrompt(parseSceneEnvironmentPrompt("旧格式场景描述"))).toBe("正面：旧格式场景描述");
    });
});
