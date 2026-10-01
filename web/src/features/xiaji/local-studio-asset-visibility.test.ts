// SPDX-License-Identifier: AGPL-3.0-or-later

// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import type { Asset } from "@/stores/use-asset-store";
import { isInternalLocalStudioAsset, visibleLocalStudioAssets } from "./local-studio-asset-visibility";

const legacyReturnOperation = {
    id: "legacy-operation",
    kind: "text",
    title: "旧回主线记录",
    coverUrl: "",
    tags: [],
    category: "internal:local-studio",
    source: "internal",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    data: { content: "{}" },
    metadata: { localStudio: { internalKind: "return-to-mainline-operation" } },
} as Asset;

const visibleAsset = {
    ...legacyReturnOperation,
    id: "visible-asset",
    title: "角色资料",
    metadata: { xiaTang: { domain: "character", recordType: "entity" } },
} as Asset;

describe("local studio asset visibility", () => {
    test("keeps legacy internal return records out of user asset lists", () => {
        expect(isInternalLocalStudioAsset(legacyReturnOperation)).toBe(true);
        expect(visibleLocalStudioAssets([legacyReturnOperation, visibleAsset])).toEqual([visibleAsset]);
    });
});
