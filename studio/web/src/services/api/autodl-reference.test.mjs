import assert from "node:assert/strict";
import test from "node:test";

const referenceUtils = await import("./autodl-reference.ts").catch((error) => {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return null;
    throw error;
});

test("only the H3 15-second video workflow inlines image and audio references", () => {
    assert.ok(referenceUtils, "AutoDL reference helpers should exist");
    assert.equal(referenceUtils.supportsAutoDLBase64Reference("minimax_h3_image_audio_to_video_v2_15s", "/videos", "image"), true);
    assert.equal(referenceUtils.supportsAutoDLBase64Reference("minimax_h3_image_audio_to_video_v2_15s", "/videos", "audio"), true);
    assert.equal(referenceUtils.supportsAutoDLBase64Reference("minimax_h3_image_audio_to_video_v2_15s", "/videos", "video"), false);
    assert.equal(referenceUtils.supportsAutoDLBase64Reference("minimax_h3_image_audio_to_video_v2", "/videos", "image"), false);
    assert.equal(referenceUtils.supportsAutoDLBase64Reference("minimax_h3_image_audio_to_video_v2_15s", "/audio/speech", "audio"), false);
});

test("local media response becomes a MIME-preserving base64 data URL", async () => {
    assert.ok(referenceUtils, "AutoDL reference helpers should exist");
    const result = await referenceUtils.fetchMediaAsDataUrl(
        "/api/files/local-image/content",
        "image/png",
        async () => new Response(new Blob([new Uint8Array([0, 1, 255])], { type: "image/png" })),
    );
    assert.equal(result, "data:image/png;base64,AAH/");
});

test("local media read failures surface the HTTP status", async () => {
    assert.ok(referenceUtils, "AutoDL reference helpers should exist");
    await assert.rejects(
        referenceUtils.fetchMediaAsDataUrl("/api/files/missing/content", "audio/mpeg", async () => new Response("", { status: 404 })),
        /参考素材读取失败：404/,
    );
});
