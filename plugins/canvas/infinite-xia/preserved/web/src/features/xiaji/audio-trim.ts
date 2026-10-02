export type DecodedAudioBuffer = {
    sampleRate: number;
    length: number;
    numberOfChannels: number;
    duration: number;
    getChannelData: (channel: number) => Float32Array;
};

export function trimDecodedAudioToWav(buffer: DecodedAudioBuffer, startSeconds: number, durationSeconds: number): Blob {
    if (!Number.isFinite(startSeconds) || startSeconds < 0) throw new Error("裁剪开始时间无效");
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("裁剪时长必须大于 0");
    if (startSeconds >= buffer.duration || startSeconds + durationSeconds > buffer.duration + 0.000001) {
        throw new Error("裁剪区间超出音频长度");
    }

    const sampleRate = buffer.sampleRate;
    const channelCount = buffer.numberOfChannels;
    const startFrame = Math.floor(startSeconds * sampleRate);
    const endFrame = Math.min(buffer.length, Math.max(startFrame + 1, Math.floor((startSeconds + durationSeconds) * sampleRate)));
    const frameCount = endFrame - startFrame;
    if (frameCount <= 0) throw new Error("裁剪区间没有音频数据");

    const dataBytes = frameCount * channelCount * 2;
    const bytes = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(bytes);
    const writeAscii = (offset: number, value: string) => {
        for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * 2, true);
    view.setUint16(32, channelCount * 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, "data");
    view.setUint32(40, dataBytes, true);

    let offset = 44;
    for (let frame = startFrame; frame < endFrame; frame += 1) {
        for (let channel = 0; channel < channelCount; channel += 1) {
            const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame] || 0));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }
    return new Blob([bytes], { type: "audio/wav" });
}
