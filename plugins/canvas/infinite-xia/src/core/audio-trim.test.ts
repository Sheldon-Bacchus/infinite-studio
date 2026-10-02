import { describe, expect, test } from "bun:test";

import { trimDecodedAudioToWav } from "./audio-trim";

describe("local voice audio trimming", () => {
    test("encodes the selected time range as a playable PCM WAV", async () => {
        const buffer = {
            sampleRate: 4,
            length: 4,
            numberOfChannels: 1,
            duration: 1,
            getChannelData: () => new Float32Array([0, 0.5, -0.5, 1]),
        };

        const wav = trimDecodedAudioToWav(buffer, 0.25, 0.5);
        const bytes = new DataView(await wav.arrayBuffer());

        expect(wav.type).toBe("audio/wav");
        expect(bytes.byteLength).toBe(48);
        expect(bytes.getUint32(40, true)).toBe(4);
        expect(bytes.getInt16(44, true)).toBeGreaterThan(16000);
        expect(bytes.getInt16(46, true)).toBeLessThan(-16000);
    });

    test("rejects empty or out-of-range trim intervals", () => {
        const buffer = { sampleRate: 10, length: 10, numberOfChannels: 1, duration: 1, getChannelData: () => new Float32Array(10) };
        expect(() => trimDecodedAudioToWav(buffer, 1, 1)).toThrow("裁剪区间超出音频长度");
        expect(() => trimDecodedAudioToWav(buffer, 0.2, 0)).toThrow("裁剪时长必须大于 0");
    });
});
