// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { DramaAssetDomain, DramaAssetDomainItem } from "@/services/api/drama-import";
import { DomainAssetManagerView, type DomainAssetManagerViewProps } from "./domain-asset-manager";

const character: DramaAssetDomainItem = {
    name: "林雨",
    role: "女主角",
    gender: "女",
    age_group: "青年",
    aliases: ["小雨", "林记者"],
    description: "独立的记者",
    face_prompt: "短发，眼神坚定",
    body_type: "修长",
    is_main: true,
};

const scene: DramaAssetDomainItem = {
    name: "旧车站",
    scene_type: "interior",
    time_of_day: "夜晚",
    environment_prompt: "潮湿的站台，冷色灯光",
    variant_prompt: "雨夜版本",
    description: "故事开场地点",
    notes: "保留旧时钟",
};

const prop: DramaAssetDomainItem = {
    name: "红伞",
    prop_type: "object",
    visual_prompt: "磨损的红色长柄伞",
    description: "林雨随身携带",
    owner: "林雨",
    aliases: ["雨伞"],
    notes: "伞柄有划痕",
};

function render(overrides: Partial<DomainAssetManagerViewProps> = {}) {
    const props: DomainAssetManagerViewProps = {
        domain: "characters",
        items: [],
        loading: false,
        error: "",
        editor: null,
        deleteConfirmName: null,
        busy: false,
        onRetry: () => undefined,
        onCreate: () => undefined,
        onEdit: () => undefined,
        onRequestDelete: () => undefined,
        onCancelDelete: () => undefined,
        onConfirmDelete: () => undefined,
        onCloseEditor: () => undefined,
        onSubmit: () => undefined,
        ...overrides,
    };

    return renderToStaticMarkup(createElement(DomainAssetManagerView, props));
}

describe("DramaClaw domain asset manager SSR", () => {
    test("shows the returned character, scene, and prop fields", () => {
        const html = [
            render({ domain: "characters", items: [character] }),
            render({ domain: "scenes", items: [scene] }),
            render({ domain: "props", items: [prop] }),
        ].join("");

        for (const value of [
            "林雨", "女主角", "女", "青年", "小雨、林记者", "独立的记者", "短发，眼神坚定", "修长", "主角", "是",
            "旧车站", "interior", "夜晚", "潮湿的站台，冷色灯光", "雨夜版本", "故事开场地点", "保留旧时钟",
            "红伞", "object", "磨损的红色长柄伞", "林雨随身携带", "雨伞", "伞柄有划痕",
        ]) {
            expect(html).toContain(value);
        }
    });

    test("renders loading, failure with retry, and empty states", () => {
        expect(render({ loading: true })).toContain("正在加载角色");
        const failure = render({ error: "服务暂不可用" });
        expect(failure).toContain("服务暂不可用");
        expect(failure).toContain("重试");
        expect(render({ domain: "scenes" })).toContain("暂无场景");
        expect(render({ domain: "props" })).toContain("暂无道具");
    });

    test("renders create and edit forms with the exact domain fields", () => {
        const cases: Array<{ domain: DramaAssetDomain; item: DramaAssetDomainItem; labels: string[] }> = [
            { domain: "characters", item: character, labels: ["名称", "别名", "角色定位", "性别", "年龄段", "描述", "面部提示词", "体型", "主角"] },
            { domain: "scenes", item: scene, labels: ["名称", "场景类型", "时间", "环境提示词", "变化提示词", "描述", "备注"] },
            { domain: "props", item: prop, labels: ["名称", "别名", "道具类型", "视觉提示词", "描述", "所属角色", "备注"] },
        ];

        for (const { domain, item, labels } of cases) {
            const html = render({ domain, editor: { mode: "edit", item } });
            for (const label of labels) expect(html).toContain(label);
            expect(html).toContain("保存");
            expect(html).toContain("取消");
        }

        expect(render({ domain: "characters", editor: { mode: "create", item: null } })).toContain("新增角色");
        expect(render({ domain: "scenes", editor: { mode: "create", item: null } })).toContain("新增场景");
        expect(render({ domain: "props", editor: { mode: "create", item: null } })).toContain("新增道具");
    });

    test("shows add, edit, delete, and explicit delete confirmation controls", () => {
        const html = render({ items: [character] });
        expect(html).toContain("新增角色");
        expect(html).toContain('aria-label="编辑 林雨"');
        expect(html).toContain('aria-label="删除 林雨"');

        const confirmation = render({ items: [character], deleteConfirmName: "林雨" });
        expect(confirmation).toContain("确认删除角色“林雨”");
        expect(confirmation).toContain("确认删除");
        expect(confirmation).toContain("取消");
    });
});
