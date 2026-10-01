// @ts-expect-error Bun supplies bun:test at runtime; the browser tsconfig does not include Bun types.
import { describe, expect, test } from "bun:test";

import { navigationTools } from "./navigation-tools";

describe("application navigation tools", () => {
    test("exposes one top-level XiaJi workspace entry", () => {
        const xiajiEntries = navigationTools.filter((tool) => tool.slug === "xiaji");
        expect(xiajiEntries).toHaveLength(1);
        expect(xiajiEntries[0].label).toBe("无限虾");
    });
});
