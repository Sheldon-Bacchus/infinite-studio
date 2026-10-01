// @ts-expect-error Bun supplies bun:test at runtime; browser tsconfig omits Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
    DramaCharacterVoiceSlot,
    DramaNarratorVoiceSource,
    DramaNarratorVoiceStatus,
} from "@/services/api/drama-import";
import { VoiceAssetManagerView, type VoiceAssetManagerViewProps } from "./voice-asset-manager";

const characterSlots: DramaCharacterVoiceSlot[] = [
    { slot: "default", label: "默认", path: "voices/default.wav", url: "/media/default.wav", required: true },
    { slot: "child", label: "儿童", path: "", url: "", inherited_from_default: true },
    { slot: "youth", label: "青年", path: "voices/youth.wav", url: "/media/youth.wav" },
    { slot: "middle", label: "中年", path: "", url: "" },
    { slot: "elder", label: "老年", path: "", url: "" },
];

const narrator: DramaNarratorVoiceStatus = {
    narration_style: "third_person",
    source: "uploaded",
    reference_path: "audio/narrator.wav",
    reference_url: "/media/narrator.wav",
    heading: "旁白声线已设置",
    detail: "使用项目旁白参考音频",
    is_first_person: false,
};

const narratorSources: DramaNarratorVoiceSource[] = [
    { label: "第 1 集旁白", path: "episodes/1/audio/narration.wav", rel_path: "episodes/1/audio/narration.wav" },
];

function render(overrides: Partial<VoiceAssetManagerViewProps> = {}) {
    const props: VoiceAssetManagerViewProps = {
        characters: [{ name: "林雨", age_group: "youth" }],
        selectedCharacter: "林雨",
        characterSlots: [],
        narratorStatus: null,
        narratorSources: [],
        selectedNarratorSource: "",
        loadingCharacters: false,
        loadingCharacterVoice: false,
        loadingNarrator: false,
        loadingNarratorSources: false,
        characterError: "",
        characterVoiceError: "",
        narratorError: "",
        narratorSourcesError: "",
        actionError: "",
        busy: false,
        recordingTarget: "",
        isRecording: false,
        recordedPreviewUrl: "",
        trimTarget: null,
        trimStart: "0",
        trimDuration: "4",
        onRetryCharacters: () => undefined,
        onRetryCharacterVoice: () => undefined,
        onRetryNarrator: () => undefined,
        onRetryNarratorSources: () => undefined,
        onSelectCharacter: () => undefined,
        onSelectNarratorSource: () => undefined,
        onUploadCharacter: () => undefined,
        onRecordCharacter: () => undefined,
        onStopRecording: () => undefined,
        onSaveRecording: () => undefined,
        onCancelRecording: () => undefined,
        onTrimCharacter: () => undefined,
        onDeleteCharacter: () => undefined,
        onUploadNarrator: () => undefined,
        onRecordNarrator: () => undefined,
        onCopyNarrator: () => undefined,
        onTrimNarrator: () => undefined,
        onDeleteNarrator: () => undefined,
        onTrimStartChange: () => undefined,
        onTrimDurationChange: () => undefined,
        onSubmitTrim: () => undefined,
        onCancelTrim: () => undefined,
        ...overrides,
    };

    return renderToStaticMarkup(createElement(VoiceAssetManagerView, props));
}

describe("DramaClaw voice asset manager SSR", () => {
    test("shows loading and recoverable errors for characters and narrator voice", () => {
        expect(render({ loadingCharacters: true })).toContain("正在加载角色");
        expect(render({ loadingCharacterVoice: true })).toContain("正在加载角色声线");
        expect(render({ loadingNarrator: true })).toContain("正在加载旁白声线");

        const failure = render({
            characterError: "角色列表不可用",
            narratorError: "旁白服务不可用",
        });
        expect(failure).toContain("角色列表不可用");
        expect(failure).toContain("旁白服务不可用");
        expect(failure).toContain("重试角色");
        expect(failure).toContain("重试旁白");
    });

    test("renders character selection and DramaClaw's five voice slots with playback and controls", () => {
        const html = render({ characterSlots });

        for (const value of ["选择角色", "林雨", "默认", "儿童", "青年", "中年", "老年", "继承默认声线"]) {
            expect(html).toContain(value);
        }
        expect((html.match(/<audio/g) || []).length).toBe(2);
        for (const action of ["上传默认声线", "录制默认声线", "裁剪默认声线", "删除默认声线", "上传老年声线", "录制老年声线"]) {
            expect(html).toContain(action);
        }

        const missingDefault = render({ characterSlots: characterSlots.map((slot) => slot.slot === "default" ? { ...slot, path: "", url: "" } : slot) });
        expect(missingDefault).toContain("缺少必需的默认声线");
    });

    test("renders narrator status, playback, upload, recording, source copy, trim, and delete", () => {
        const html = render({ narratorStatus: narrator, narratorSources });

        for (const value of [
            "项目旁白声线", "旁白声线已设置", "使用项目旁白参考音频", "第三人称旁白", "第 1 集旁白",
            "上传旁白声线", "录制旁白声线", "从项目音频复制", "裁剪旁白声线", "删除旁白声线",
        ]) {
            expect(html).toContain(value);
        }
        expect(html).toContain("<audio");
    });

    test("shows recording preview and trim form states without requiring a browser", () => {
        const recording = render({ recordingTarget: "character:林雨:default", isRecording: true });
        expect(recording).toContain("正在录音");
        expect(recording).toContain("停止录音");

        const preview = render({ recordingTarget: "character:林雨:default", recordedPreviewUrl: "data:audio/webm;base64,AA==" });
        expect(preview).toContain("录音完成");
        expect(preview).toContain("保存录音");

        const trimming = render({ trimTarget: { kind: "character", slot: "default", sourcePath: "voices/default.wav" } });
        expect(trimming).toContain("裁剪声线音频");
        expect(trimming).toContain("开始秒数");
        expect(trimming).toContain("保留时长");
        expect(trimming).toContain("应用裁剪");
    });
});
