import assert from "node:assert/strict";
import test from "node:test";

import { publicReferenceURL } from "./public-reference-url";

test("public reference URLs accept HTTP(S) and reject private or local targets", () => {
    assert.equal(publicReferenceURL("https://cdn.example.com/ref.png"), "https://cdn.example.com/ref.png");
    for (const url of [
        "http://localhost/ref.png",
        "http://127.0.0.1/ref.png",
        "http://192.168.1.10/ref.png",
        "http://10.0.0.3/ref.png",
        "http://[fd00::1]/ref.png",
        "https://user:secret@cdn.example.com/ref.png",
        "data:image/png;base64,AA==",
        "blob:https://example.com/id",
    ]) assert.equal(publicReferenceURL(url), "", url);
});
