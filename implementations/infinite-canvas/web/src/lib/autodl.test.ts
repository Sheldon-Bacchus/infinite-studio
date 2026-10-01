import assert from "node:assert/strict";
import test from "node:test";

import type { AutoDLWorkflow } from "@/services/api/autodl";
import { getAutoDLCapabilities, getAutoDLReferenceInputError } from "./autodl";

function capabilities(input_rules: AutoDLWorkflow["input_rules"]) {
    const result = getAutoDLCapabilities({ uuid: "workflow", name: "workflow", kind: "video", input_rules });
    assert.ok(result);
    return result;
}

test("AutoDL preflight accepts reference counts within workflow capacity", () => {
    const limits = capabilities({ ref_image_0: { type: "image" }, ref_image_1: { type: "image" }, ref_audio_0: { type: "audio" } });
    assert.equal(getAutoDLReferenceInputError(limits, { imageCount: 2, videoCount: 0, audioCount: 1, firstFrame: false, lastFrame: false }), null);
});

test("AutoDL preflight rejects too many references and unsupported media before upload", () => {
    const limits = capabilities({ ref_image_0: { type: "image" }, ref_image_1: { type: "image" } });
    assert.match(getAutoDLReferenceInputError(limits, { imageCount: 3, videoCount: 0, audioCount: 0, firstFrame: false, lastFrame: false }) || "", /3 张.*最多支持 2 张/);
    assert.match(getAutoDLReferenceInputError(limits, { imageCount: 0, videoCount: 1, audioCount: 0, firstFrame: false, lastFrame: false }) || "", /不支持参考视频/);
    assert.match(getAutoDLReferenceInputError(limits, { imageCount: 0, videoCount: 0, audioCount: 1, firstFrame: false, lastFrame: false }) || "", /不支持参考音频/);
    assert.match(getAutoDLReferenceInputError(limits, { imageCount: 0, videoCount: 0, audioCount: 0, firstFrame: true, lastFrame: false }) || "", /不支持首帧/);
});
