// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { DramaCharacterIdentity, DramaIdentityTask } from "@/services/api/drama-identities";
import { CharacterIdentitiesManagerView, type CharacterIdentitiesManagerViewProps } from "./character-identities-manager";

const identity: DramaCharacterIdentity = {
    identity_id: "林雨_雨夜",
    identity_name: "雨夜",
    age_group: "青年",
    appearance_details: "黑色雨衣，银色耳坠",
    face_prompt: "短发，眼神坚定",
    body_type: "修长",
    image_url: "/api/v1/drama/media?url=identity.png",
    costume_image_url: "/api/v1/drama/media?url=costume.png",
    portrait_image_url: "/api/v1/drama/media?url=identity-portrait.png",
};

const emptyValues = { identity_name: "", age_group: "", appearance_details: "", face_prompt: "", body_type: "" };

function render(overrides: Partial<CharacterIdentitiesManagerViewProps> = {}) {
    const props: CharacterIdentitiesManagerViewProps = {
        characters: [{ name: "林雨" }, { name: "周岚" }],
        selectedCharacter: "林雨",
        selectedCharacterDetails: { name: "林雨", role: "主角", description: "雨夜归来的侦探", portrait_url: "/api/v1/drama/media?url=character-portrait.png" },
        identities: [identity],
        attemptsByIdentityId: { [identity.identity_id]: { image_attempts: 3, portrait_attempts: 1 } },
        attemptsLoading: false,
        attemptsError: "",
        taskReceipt: null as DramaIdentityTask | null,
        unknownWriteMessage: "",
        unknownWriteRefreshed: false,
        loadingCharacters: false,
        loadingIdentities: false,
        charactersError: "",
        identitiesError: "",
        operationError: "",
        editor: null,
        deleteConfirmId: null,
        assetDeleteConfirm: null,
        busy: false,
        onSelectCharacter: () => undefined,
        onRetryCharacters: () => undefined,
        onRetryIdentities: () => undefined,
        onBuildCharacters: () => undefined,
        onGenerateCharacterPortrait: () => undefined,
        onUploadCharacterPortrait: () => undefined,
        onGenerateIdentityImage: () => undefined,
        onGenerateIdentityPortrait: () => undefined,
        onUploadIdentityAsset: () => undefined,
        onRequestDeleteIdentityAsset: () => undefined,
        onCancelDeleteAsset: () => undefined,
        onConfirmDeleteAsset: () => undefined,
        onRetryAttempts: () => undefined,
        onRecheckUnknownWrite: () => undefined,
        onConfirmUnknownWriteChecked: () => undefined,
        onCreate: () => undefined,
        onEdit: () => undefined,
        onChangeEditor: () => undefined,
        onCancelEditor: () => undefined,
        onSubmit: () => undefined,
        onRequestDelete: () => undefined,
        onCancelDelete: () => undefined,
        onConfirmDelete: () => undefined,
        ...overrides,
    };
    return renderToStaticMarkup(createElement(CharacterIdentitiesManagerView, props));
}

describe("character identities manager", () => {
    test("lets the user select a character and shows its identity fields and media", () => {
        const html = render();
        for (const value of ["选择角色", "林雨", "周岚", "身份：雨夜", "青年", "黑色雨衣，银色耳坠", "短发，眼神坚定", "修长", "identity.png", "新增身份", "编辑", "删除"]) {
            expect(html).toContain(value);
        }
    });

    test("shows independent loading, retryable errors, and empty states", () => {
        expect(render({ loadingCharacters: true })).toContain("正在加载角色");
        expect(render({ loadingIdentities: true })).toContain("正在加载身份");
        expect(render({ charactersError: "角色读取失败" })).toContain("重试角色");
        expect(render({ identitiesError: "身份读取失败" })).toContain("重试身份");
        expect(render({ identities: [] })).toContain("暂无身份");
    });

    test("renders create and edit forms with only the source-hook fields", () => {
        const create = render({ identities: [], editor: { mode: "create", identity: null, values: emptyValues } });
        const createForm = create.slice(create.indexOf("<form"), create.indexOf("</form>"));
        for (const field of ["身份名称", "年龄段", "外貌与服装"]) expect(createForm).toContain(field);
        for (const field of ["体型", "fish_voice_id"]) expect(createForm).not.toContain(field);
        expect(create).toContain("创建身份");

        const edit = render({ identities: [], editor: { mode: "edit", identity, values: { ...emptyValues, identity_name: "雨夜" } } });
        for (const field of ["身份名称", "年龄段", "外貌与服装", "面部提示词", "体型"]) expect(edit).toContain(field);
        expect(edit).toContain("保存身份");
    });

    test("requires explicit confirmation before deleting an identity", () => {
        const html = render({ deleteConfirmId: identity.identity_id });
        expect(html).toContain("确认删除身份“雨夜”");
        expect(html).toContain("确认删除");
        expect(html).toContain("取消");
    });

    test("shows a separate error when an identity write fails", () => {
        const html = render({ operationError: "DramaClaw 暂不可用" });
        expect(html).toContain("身份操作失败");
        expect(html).toContain("DramaClaw 暂不可用");
    });

    test("exposes source-backed character build, portrait, identity assets, and attempt counts", () => {
        const html = render();
        for (const value of [
            "角色详情", "主角", "雨夜归来的侦探", "character-portrait.png", "从小说补充缺失角色", "生成角色头像", "上传角色头像",
            "生成身份主图", "上传身份主图", "删除身份主图", "costume.png", "上传服装参考图", "删除服装参考图",
            "identity-portrait.png", "生成身份肖像", "上传身份肖像", "图片尝试：3", "肖像尝试：1",
        ]) expect(html).toContain(value);
        expect(html).not.toContain("删除身份肖像");
    });

    test("shows source task identifiers and locks writes while a result is unknown", () => {
        const task: DramaIdentityTask = { task_type: "identity_image", task_id: "task-42", scope: "character:林雨:identity:雨夜" };
        const accepted = render({ taskReceipt: task });
        expect(accepted).toContain("identity_image");
        expect(accepted).toContain("task-42");

        const unknown = render({ unknownWriteMessage: "虾塘写入结果未知", unknownWriteRefreshed: true });
        expect(unknown).toContain("虾塘写入结果未知");
        expect(unknown).toContain("重新读取当前状态");
        expect(unknown).toContain("我已在虾塘核对状态，允许继续");
        expect(unknown).toContain("disabled=\"\"");
    });

    test("reports attempts errors with a retry action", () => {
        const html = render({ attemptsError: "attempts 服务不可用" });
        expect(html).toContain("attempts 服务不可用");
        expect(html).toContain("重试尝试次数");
    });
});
