export type AutoDLReferenceKind = "image" | "video" | "audio";

const h3ImageAudio15sWorkflow = "minimax_h3_image_audio_to_video_v2_15s";

export function supportsAutoDLBase64Reference(workflowId: string, endpoint: string, kind: AutoDLReferenceKind) {
    return workflowId === h3ImageAudio15sWorkflow && endpoint === "/videos" && (kind === "image" || kind === "audio");
}

export async function fetchMediaAsDataUrl(source: string, fallbackMimeType: string, fetcher: typeof fetch = fetch) {
    const response = await fetcher(source);
    if (!response.ok) throw new Error(`参考素材读取失败：${response.status}`);
    const blob = await response.blob();
    const mimeType = blob.type || fallbackMimeType || "application/octet-stream";
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const base64: string[] = [];
    const chunkSize = 0x6000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        base64.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))));
    }
    return `data:${mimeType};base64,${base64.join("")}`;
}
