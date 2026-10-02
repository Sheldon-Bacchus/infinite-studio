import type { DramaBeatMedia, DramaMediaByBeat } from "@/app/(user)/canvas/utils/drama-import";
import type { DramaImportAsset, DramaImportEpisode } from "@/services/api/drama-import";
import type { UploadedFile } from "@/services/file-storage";
import type { UploadedImage } from "@/services/image-storage";

export type DramaMediaStorage = {
    download: (url: string) => Promise<Blob>;
    uploadImage: (blob: Blob) => Promise<UploadedImage>;
    uploadMedia: (blob: Blob, prefix: string) => Promise<UploadedFile>;
};

function materializedMediaMetadata(media: UploadedFile | UploadedImage) {
    return {
        storageKey: media.storageKey,
        bytes: media.bytes,
        mimeType: media.mimeType,
        ...(typeof media.width === "number" ? { width: media.width } : {}),
        ...(typeof media.height === "number" ? { height: media.height } : {}),
        ...("durationMs" in media && typeof media.durationMs === "number" ? { durationMs: media.durationMs } : {}),
    };
}

export async function prepareDramaAsset(asset: DramaImportAsset, storage: DramaMediaStorage): Promise<DramaImportAsset> {
    if (asset.mediaType === "text") return asset;
    if (!["image", "video", "audio"].includes(asset.mediaType)) {
        throw new Error(`虾画暂不支持 ${asset.mediaType || "未知"} 素材类型`);
    }
    if (!asset.exists || !asset.url) throw new Error("虾集源文件缺失，无法导入虾画");
    if (asset.meta?.sourceSystem === "infinite-canvas") return asset;
    const blob = await storage.download(asset.url);
    if (asset.mediaType === "image") {
        const uploaded = await storage.uploadImage(blob);
        return { ...asset, url: uploaded.url, meta: { ...asset.meta, ...materializedMediaMetadata(uploaded) } };
    }
    if (asset.mediaType === "video" || asset.mediaType === "audio") {
        const prefix = `drama-${asset.mediaType}-${asset.id || "asset"}`;
        const uploaded = await storage.uploadMedia(blob, prefix);
        return { ...asset, url: uploaded.url, meta: { ...asset.meta, ...materializedMediaMetadata(uploaded) } };
    }
    return asset;
}

export async function prepareDramaAssetSelection(assets: DramaImportAsset[], storage: DramaMediaStorage) {
    const ready: DramaImportAsset[] = [];
    const failed: Array<{ asset: DramaImportAsset; message: string }> = [];
    for (const asset of assets) {
        try {
            ready.push(await prepareDramaAsset(asset, storage));
        } catch (cause) {
            failed.push({ asset, message: cause instanceof Error ? cause.message : "素材转存失败" });
        }
    }
    return { ready, failed };
}

export async function prepareDramaEpisodeMedia(episode: DramaImportEpisode, storage: DramaMediaStorage) {
    const mediaByBeat: DramaMediaByBeat = {};
    let failedMediaCount = 0;
    const beats = await Promise.all(episode.beats.map(async (beat) => {
        const media: DramaBeatMedia = {};
        const imageUrl = beat.frameUrl || beat.sketchUrl;
        if (imageUrl) {
            try {
                media.image = await storage.uploadImage(await storage.download(imageUrl));
            } catch {
                failedMediaCount += 1;
            }
        }
        if (beat.videoUrl) {
            try {
                media.video = await storage.uploadMedia(await storage.download(beat.videoUrl), `drama-video-ep-${episode.number}-beat-${beat.beatNumber}`);
            } catch {
                failedMediaCount += 1;
            }
        }
        if (beat.audioUrl) {
            try {
                const uploaded = await storage.uploadMedia(await storage.download(beat.audioUrl), `drama-audio-ep-${episode.number}-beat-${beat.beatNumber}`);
                media.audio = { ...uploaded, durationMs: beat.audioDurationSeconds ? beat.audioDurationSeconds * 1000 : uploaded.durationMs };
            } catch {
                failedMediaCount += 1;
            }
        }
        if (media.image || media.video || media.audio) mediaByBeat[beat.beatNumber] = media;
        return {
            ...beat,
            ...(!media.image && imageUrl ? { frameUrl: "", sketchUrl: "" } : {}),
            ...(!media.video && beat.videoUrl ? { videoUrl: "" } : {}),
            ...(!media.audio && beat.audioUrl ? { audioUrl: "" } : {}),
        };
    }));

    return {
        episode: { ...episode, beats },
        mediaByBeat,
        failedMediaCount,
    };
}
