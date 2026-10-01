import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "../web/node_modules/fflate/esm/browser.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(
    repoRoot,
    "..",
    "..",
    "archive",
    "dramaclaw-storage",
    "output",
    "local",
    "continue_guga_dora_warm_comedy",
);
const outputArgIndex = process.argv.indexOf("--output");
const outputPath = path.resolve(
    repoRoot,
    outputArgIndex >= 0
        ? process.argv[outputArgIndex + 1] || "data/guga-dora-h3-single-bundle.zip"
        : "data/guga-dora-h3-single-bundle.zip",
);
const promptPath = path.join(repoRoot, "docs", "h3", "guga-dora-15s-ref2va-final-prompt.md");
const planPath = path.join(repoRoot, "docs", "h3", "guga-dora-15s-ref2va-reference-plan.json");

const mediaTypes = new Map([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".webp", "image/webp"],
    [".mp3", "audio/mpeg"],
    [".wav", "audio/wav"],
    [".m4a", "audio/mp4"],
    [".aac", "audio/aac"],
    [".ogg", "audio/ogg"],
]);

const categories = [
    {
        id: "characters",
        title: "人物",
        groupTitle: "DramaClaw 参考 · 人物",
        items: [
            { key: "dora", name: "DORA · 玩偶形态", relative: "assets/characters/DORA/identities/玩偶形态.png", role: "DORA identity", h3Selected: true, pictureIndex: 1 },
            { key: "guga", name: "GUGA · 企鹅玩偶形态", relative: "assets/characters/GUGA/identities/企鹅玩偶形态.png", role: "GUGA identity", h3Selected: false },
            { key: "laevatain", name: "LAEVATAIN · 红发黑红服装", relative: "assets/characters/LAEVATAIN/identities/红发黑红服装.png", role: "LAEVATAIN identity", h3Selected: true, pictureIndex: 2 },
            { key: "closure", name: "CLOSURE · 手机画面", relative: "assets/characters/CLOSURE/identities/手机画面.png", role: "CLOSURE phone-screen identity", h3Selected: false },
        ],
    },
    {
        id: "scenes",
        title: "场景",
        groupTitle: "DramaClaw 参考 · 场景",
        items: [
            { key: "scene-main", name: "上海老弄堂修车铺门口 · 主景", relative: "assets/scenes/上海老弄堂修车铺门口/master.png", role: "main scene geometry", h3Selected: true, pictureIndex: 3 },
            { key: "scene-reverse", name: "上海老弄堂修车铺门口 · 反向", relative: "assets/scenes/上海老弄堂修车铺门口/reverse_master.png", role: "reverse scene geometry", h3Selected: false },
        ],
    },
    {
        id: "props",
        title: "物品",
        groupTitle: "DramaClaw 参考 · 物品",
        items: [
            { key: "ebike", name: "外卖电动车", relative: "assets/props/外卖电动车/reference_3view.png", role: "electric delivery bicycle", h3Selected: true, pictureIndex: 4 },
            { key: "bag", name: "外卖袋", relative: "assets/props/外卖袋/reference_3view.png", role: "insulated delivery bag", h3Selected: true, pictureIndex: 5 },
            { key: "wrench", name: "小扳手", relative: "assets/props/小扳手/reference_3view.png", role: "small wrench", h3Selected: false },
            { key: "phone", name: "手机", relative: "assets/props/手机/reference_3view.png", role: "phone exterior", h3Selected: true, pictureIndex: 6 },
        ],
    },
    {
        id: "voices",
        title: "声线",
        groupTitle: "DramaClaw 参考 · 声线",
        items: [
            { key: "voice-dora", name: "DORA · 长声线参考", relative: "assets/characters/DORA/voices/voice_default.wav", role: "DORA voice identity", selectionReason: "continue 目录中 DORA 的最长有效参考；quickstart 的同内容重复文件不再重复导入", h3Selected: true, audioIndex: 1 },
            { key: "voice-guga", name: "GUGA · 长声线参考", relative: "assets/characters/GUGA/voices/voice_default_1789735149.wav", role: "GUGA voice identity", selectionReason: "continue 目录中 GUGA 的最长有效参考（12.03 秒）；短片段不载入", h3Selected: false },
            { key: "voice-laevatain", name: "LAEVATAIN · 长声线参考", relative: "assets/characters/LAEVATAIN/voices/voice_default.wav", role: "LAEVATAIN voice identity", selectionReason: "continue 目录中 LAEVATAIN 的最长有效参考；短片段不载入", h3Selected: true, audioIndex: 2 },
            { key: "voice-closure", name: "CLOSURE · 长声线参考", relative: "assets/characters/CLOSURE/voices/voice_default.wav", role: "CLOSURE voice identity", selectionReason: "continue 目录中 CLOSURE 的最长有效参考；短片段不载入", h3Selected: false },
        ],
    },
    {
        id: "storyboard",
        title: "最终分镜图",
        groupTitle: "DramaClaw 参考 · 最终分镜图",
        items: [
            { key: "shot-01", name: "SHOT-01 · 最终暖色分镜", relative: "freezone/_uploads/20260909_092036_063358_shot-01-final-warm.png", role: "storyboard anchor for Shot 1", h3Selected: true, pictureIndex: 7 },
            { key: "shot-02", name: "SHOT-02 · 最终暖色分镜", relative: "freezone/_uploads/20260909_092036_145958_shot-02-final-warm.png", role: "storyboard anchor for Shot 2", h3Selected: true, pictureIndex: 8 },
            { key: "shot-03", name: "SHOT-03 · 最终暖色分镜", relative: "freezone/_uploads/20260909_092036_225178_shot-03-final-warm.png", role: "continuity storyboard anchor", h3Selected: true, pictureIndex: 9 },
            { key: "shot-04", name: "SHOT-04 · 最终暖色分镜", relative: "freezone/_uploads/20260909_092036_318725_shot-04-final-warm.png", role: "later episode storyboard", h3Selected: false },
        ],
    },
];

function safe(value) {
    return value.replace(/[\\/:*?"<>|]/g, "_").replace(/[^\p{L}\p{N}_.-]+/gu, "_").slice(0, 120) || "asset";
}

function mimeFor(filePath) {
    return mediaTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

function kindFor(mimeType) {
    if (mimeType.startsWith("image/")) return "image";
    return "audio";
}

function imageDimensions(buffer, mimeType) {
    if (mimeType === "image/png" && buffer.length >= 24) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    if (mimeType === "image/webp" && buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
        const kind = buffer.toString("ascii", 12, 16);
        if (kind === "VP8X") return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
    if (mimeType === "image/jpeg") {
        let offset = 2;
        while (offset + 9 < buffer.length) {
            if (buffer[offset] !== 0xff) { offset += 1; continue; }
            const marker = buffer[offset + 1];
            const length = buffer.readUInt16BE(offset + 2);
            if (marker >= 0xc0 && marker <= 0xc3) return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
            offset += 2 + length;
        }
    }
    return undefined;
}

function audioDurationSeconds(buffer, mimeType) {
    if (mimeType !== "audio/wav" || buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") return undefined;
    let offset = 12;
    let byteRate;
    let dataBytes;
    while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString("ascii", offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        if (chunkId === "fmt " && chunkSize >= 16 && offset + 8 + 16 <= buffer.length) byteRate = buffer.readUInt32LE(offset + 16);
        if (chunkId === "data") {
            dataBytes = chunkSize;
            break;
        }
        offset += 8 + chunkSize + (chunkSize & 1);
    }
    return byteRate && dataBytes ? dataBytes / byteRate : undefined;
}

function displaySize(kind, dimensions) {
    if (kind === "audio") return { width: 360, height: 160 };
    const naturalWidth = dimensions?.width || 4;
    const naturalHeight = dimensions?.height || 3;
    const scale = Math.min(420 / naturalWidth, 280 / naturalHeight, 1);
    return { width: Math.max(180, Math.round(naturalWidth * scale)), height: Math.max(120, Math.round(naturalHeight * scale)) };
}

const prompt = readFileSync(promptPath, "utf8");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const zipEntries = {};
const nodes = [];
const connections = [];
const exportedFiles = [];
const selectedSourceNodeIds = [];
let totalBytes = 0;
let mediaCount = 0;

for (const [categoryIndex, category] of categories.entries()) {
    const groupId = `drama-h3-group-${category.id}`;
    const columns = 2;
    const cellWidth = 500;
    const cellHeight = 370;
    const groupX = categoryIndex * 1900;
    const rows = Math.max(1, Math.ceil(category.items.length / columns));
    const groupWidth = columns * cellWidth + 120;
    const groupHeight = rows * cellHeight + 180;

    category.items.forEach((item, itemIndex) => {
        const fullPath = path.join(sourceRoot, item.relative);
        const fileStat = statSync(fullPath);
        const buffer = readFileSync(fullPath);
        const mimeType = mimeFor(fullPath);
        const kind = kindFor(mimeType);
        const dimensions = kind === "image" ? imageDimensions(buffer, mimeType) : undefined;
        const durationSeconds = kind === "audio" ? audioDurationSeconds(buffer, mimeType) : undefined;
        const size = displaySize(kind, dimensions);
        const storageKey = `${kind}:dramaclaw:h3-single:${category.id}:${item.key}`;
        const pathInZip = `projects/local-assets/files/${safe(storageKey)}.${path.extname(item.relative).slice(1).toLowerCase()}`;
        const nodeId = `drama-h3-${category.id}-${item.key}`;
        const column = itemIndex % columns;
        const row = Math.floor(itemIndex / columns);
        const metadata = {
            groupId,
            sourceSystem: "dramaclaw",
            sourceProjectId: "continue_guga_dora_warm_comedy",
            sourceRevision: "canonical-single-bundle",
            sourceEntityType: category.id,
            sourceEntityId: item.relative,
            category: category.id,
            referenceRole: item.role,
            h3Selected: Boolean(item.h3Selected),
            h3PictureIndex: item.pictureIndex,
            h3AudioIndex: item.audioIndex,
            selectionReason: item.selectionReason,
            storageKey,
            content: kind === "image" ? storageKey : "",
            sourceUrl: "",
            status: "success",
            bytes: fileStat.size,
            mimeType,
            ...(dimensions ? { naturalWidth: dimensions.width, naturalHeight: dimensions.height } : {}),
            ...(durationSeconds ? { durationMs: Math.round(durationSeconds * 1000) } : {}),
        };
        nodes.push({
            id: nodeId,
            type: kind,
            title: `${category.title} · ${item.name}`,
            position: { x: groupX + 80 + column * cellWidth, y: 120 + row * cellHeight },
            width: size.width,
            height: size.height,
            metadata,
        });
        if (item.h3Selected) selectedSourceNodeIds.push(nodeId);
        exportedFiles.push({ storageKey, path: pathInZip, mimeType, bytes: fileStat.size });
        zipEntries[pathInZip] = new Uint8Array(buffer);
        totalBytes += fileStat.size;
        mediaCount += 1;
    });

    nodes.push({
        id: groupId,
        type: "group",
        title: category.groupTitle,
        position: { x: groupX, y: 0 },
        width: groupWidth,
        height: groupHeight,
        metadata: {
            sourceSystem: "dramaclaw",
            sourceProjectId: "continue_guga_dora_warm_comedy",
            sourceRevision: "canonical-single-bundle",
            sourceEntityType: category.id,
            sourceEntityId: category.id,
            requiredForH3: true,
            h3ReferenceLimit: category.id === "voices" ? 3 : category.id === "storyboard" ? 9 : undefined,
        },
    });
}

const configId = "drama-h3-final-config";
const allItems = categories.flatMap((category) => category.items);
const selectedPictureCount = allItems.filter((item) => item.h3Selected && item.pictureIndex).length;
const selectedAudioCount = allItems.filter((item) => item.h3Selected && item.audioIndex).length;
nodes.push({
    id: configId,
    type: "config",
    title: "AutoDL H3 · Ref2VA · 15 秒 · 9 图 + 声线",
    position: { x: 9700, y: 0 },
    width: 760,
    height: 620,
    metadata: {
        sourceSystem: "dramaclaw",
        sourceProjectId: "continue_guga_dora_warm_comedy",
        sourceRevision: "canonical-single-bundle",
        sourceEntityType: "h3-video-config",
        sourceEntityId: "MOTION-QS01",
        content: "",
        composerContent: prompt,
        prompt,
        generationMode: "video",
        videoMode: "reference",
        videoModel: "minimax_h3_image_audio_to_video_v2_15s",
        durationSeconds: 15,
        resolution: "768p横",
        aspectRatio: "16:9",
        referenceImageCount: selectedPictureCount,
        referenceAudioCount: selectedAudioCount,
        sourceNodeIds: selectedSourceNodeIds,
        referencePlan: plan,
        status: "idle",
    },
});

for (const sourceNodeId of selectedSourceNodeIds) {
    connections.push({ id: `drama-h3-ref-${sourceNodeId}`, fromNodeId: sourceNodeId, toNodeId: configId });
}

const processText = [
    "H3 参考流程（单目录、去重版）",
    "1. 人物：只保留每个角色的 canonical identity；本次 15 秒任务选 DORA、LAEVATAIN。",
    "2. 场景：主景负责空间几何；反向景保留在参考区，后续镜头再选。",
    "3. 物品：电动车、外卖袋、手机进入本次 9 图；小扳手留作后续镜头。",
    "4. 声线：声线是音频参考，不占图片 9 槽；本次只绑定实际说话的 DORA、LAEVATAIN。",
    "5. 最终分镜图：SHOT-01/02 是目标镜头锚点，SHOT-03 只作连续性参考。",
    "6. H3：每个 15 秒任务单独选槽位；不把整集所有人物、声线和分镜一次塞入同一个任务。",
].join("\n");
nodes.push({
    id: "drama-h3-process-notes",
    type: "text",
    title: "H3 参考流程与槽位规则",
    position: { x: 9700, y: 700 },
    width: 760,
    height: 360,
    metadata: {
        sourceSystem: "dramaclaw",
        sourceProjectId: "continue_guga_dora_warm_comedy",
        sourceRevision: "canonical-single-bundle",
        sourceEntityType: "h3-reference-process",
        sourceEntityId: "MOTION-QS01",
        content: processText,
        status: "success",
    },
});

const project = {
    id: "guga-dora-h3-reference-workspace",
    importKey: "dramaclaw:guga-dora:h3-reference-workspace",
    title: "GUGA DORA · DramaClaw 单目录 H3 参考工作区",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes,
    connections,
    chatSessions: [],
    activeChatId: null,
    agentConfig: null,
    autoTitlePending: false,
    backgroundMode: "lines",
    showImageInfo: true,
    viewport: { x: 0, y: 0, k: 0.42 },
    sidePanel: { open: true, width: 300 },
    agentPanel: { open: false, width: 464 },
};

const manifest = {
    app: "infinite-canvas",
    version: 3,
    exportedAt: new Date().toISOString(),
    projects: [{ project, files: exportedFiles }],
};
zipEntries["projects.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, zipSync(zipEntries, { level: 0 }));
console.log(JSON.stringify({
    outputPath,
    sourceRoot,
    sourceBundle: "continue_guga_dora_warm_comedy",
    mediaCount,
    selectedPictureCount,
    selectedAudioCount,
    nodeCount: nodes.length,
    connectionCount: connections.length,
    bytes: totalBytes,
    megabytes: Number((totalBytes / 1024 / 1024).toFixed(2)),
}, null, 2));
