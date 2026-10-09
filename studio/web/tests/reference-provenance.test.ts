import { expect, test } from "bun:test";

import type { CanvasNodeData, CanvasVideoInputBinding, CanvasVideoInputSnapshot } from "../src/types/canvas";

Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => undefined } });

const [{ default: i18n }, { CanvasNodeType }, { buildDetailedReferencePlan, buildSubmissionProvenanceReferences }, { compiledVideoInputFromSnapshot }] = await Promise.all([
    import("../src/i18n"),
    import("../src/types/canvas"),
    import("../src/lib/canvas/canvas-reference-plan"),
    import("../src/lib/canvas/canvas-video-inputs"),
]);

const node = (id: string, type: CanvasNodeType, metadata: Record<string, unknown> = {}): CanvasNodeData => ({
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
    metadata,
});

const binding = (bindingId: string, order: number, usage: "camera" | "action", fileId = "video-file", storageKey = "video-key"): CanvasVideoInputBinding => ({
    bindingId,
    assetId: fileId,
    nodeId: "video-node",
    mediaType: "video",
    usage,
    order,
    contentVersion: "capture-v1",
    mimeType: "video/mp4",
    mediaRef: { fileId, storageKey },
});

const snapshot = (bindings: CanvasVideoInputBinding[], mapping: CanvasVideoInputSnapshot["mapping"] = []): CanvasVideoInputSnapshot => ({
    schemaVersion: 1,
    snapshotId: "snapshot-1",
    sourceNodeId: "config-node",
    adapterId: "openai-video-v1",
    adapterConfigFingerprint: "fingerprint",
    model: "video-model",
    prompt: "fixed prompt",
    params: { mode: "reference", seconds: "5", size: "720p", resolution: "720p", aspectRatio: "16:9", generateAudio: true, watermark: false },
    groupMembers: [],
    bindings,
    mapping,
    fingerprint: "fingerprint",
});

test("reference plan creates a distinct stable-keyed entry for each same-node binding", () => {
    const first = binding("binding-camera", 1, "camera");
    const second = binding("binding-action", 2, "action");
    const config = node("config-node", CanvasNodeType.Config, { videoBindings: [first, second] });
    const media = node("video-node", CanvasNodeType.Video, {
        content: "blob:current-video",
        fileId: "current-file",
        storageKey: "current-key",
        assetId: "current-asset",
        contentVersion: "current-version",
    });

    const plan = buildDetailedReferencePlan(config, [config, media], [{ id: "edge", fromNodeId: media.id, toNodeId: config.id }]);

    expect(plan.activeItems.map((item) => item.stableId)).toEqual(["binding:binding-camera", "binding:binding-action"]);
    expect(new Set(plan.activeItems.map((item) => item.key)).size).toBe(2);
    expect(plan.activeItems.map((item) => item.usage)).toEqual([
        i18n.t("canvas.videoInput.usages.camera"),
        i18n.t("canvas.videoInput.usages.action"),
    ]);
    expect(plan.activeItems.map((item) => item.fileId)).toEqual(["video-file", "video-file"]);
});

test("submitted video provenance follows snapshot bindings and exact bindingId, ignoring candidate rows and current node state", () => {
    const camera = binding("binding-camera", 1, "camera", "captured-file", "captured-key");
    const action = binding("binding-action", 2, "action", "captured-file", "captured-key");
    const fixed = snapshot([action, camera], [
        { tag: "Video 1", name: "Captured title", kind: "video", bindingId: camera.bindingId, nodeId: camera.nodeId, status: "valid", previewUrl: "https://media.test/preview?token=secret" },
        { tag: "Legacy mapping", name: "Renamed current node.mp4", kind: "video", nodeId: action.nodeId, status: "valid", previewUrl: "https://media.test/current?token=current-secret" },
        { tag: "Candidate text", name: "Unsubmitted candidate", kind: "text", nodeId: "candidate", status: "unverified" },
        { tag: "Submitted text", name: "Captured notes", kind: "text", nodeId: "notes", status: "valid" },
    ]);
    const media = node("video-node", CanvasNodeType.Video, {
        content: "https://media.test/current-thumbnail?token=current-secret",
        fileId: "current-file",
        storageKey: "current-key",
    });
    const generationContext = {
        prompt: "fixed prompt",
        referenceImages: [{ id: "candidate-image", name: "candidate.png", type: "image/png", dataUrl: "data:image/png;base64,unused" }],
        referenceVideos: [{ id: "candidate-video", name: "candidate.mp4", type: "video/mp4", url: "https://media.test/candidate" }],
        referenceAudios: [],
    };

    const references = buildSubmissionProvenanceReferences({
        mode: "video",
        nodes: [media],
        generationContext,
        fixedVideoInput: { prompt: fixed.prompt, snapshot: fixed },
    });

    expect(references.map((item) => item.stableId)).toEqual([
        "prompt:text:Submitted text",
        "binding:binding-camera",
        "binding:binding-action",
    ]);
    expect(references[0].title).toBe("Captured notes");
    expect(references.some((item) => item.title === "Unsubmitted candidate")).toBe(false);
    expect(references[1]).toMatchObject({ title: "Captured title", fileId: "captured-file", storageKey: "captured-key", previewUrl: "https://media.test/preview" });
    expect(references[2]).toMatchObject({ title: i18n.t("canvas.provenance.sourceInfoUnknown"), fileId: "captured-file", storageKey: "captured-key" });
    expect(references[2].previewUrl).toBeUndefined();
    expect(references.some((item) => item.title.includes("Renamed current"))).toBe(false);
    expect(JSON.stringify(references)).not.toContain("current-secret");
});

test("snapshot compilation preserves order, including stable order for ties, and submits only bound media", () => {
    const late = { ...binding("late", 2, "action"), nodeId: "late-video" };
    const tiedA = { ...binding("tie-a", 1, "camera"), nodeId: "tie-a-video" };
    const tiedB = { ...binding("tie-b", 1, "action"), nodeId: "tie-b-video" };
    const compiled = compiledVideoInputFromSnapshot(snapshot([late, tiedA, tiedB], [
        { tag: "Candidate", name: "not submitted", kind: "video", nodeId: "candidate", status: "unverified" },
    ]));

    expect(compiled.bindings.map((item) => item.bindingId)).toEqual(["tie-a", "tie-b", "late"]);
    expect(compiled.videos.map((item) => item.id)).toEqual(["tie-a-video", "tie-b-video", "late-video"]);
});
