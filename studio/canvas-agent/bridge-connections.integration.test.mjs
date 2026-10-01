import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("authenticated connection diagnostics return only live canvas IDs and schemas", { timeout: 20_000 }, async (t) => {
    const reservation = createServer();
    await new Promise((resolveListen) => reservation.listen(0, "127.0.0.1", resolveListen));
    const port = reservation.address().port;
    await new Promise((resolveClose) => reservation.close(resolveClose));

    const home = await mkdtemp(join(tmpdir(), "canvas-agent-bridge-test-"));
    const token = "canvas-agent-test-token-not-a-credential";
    const env = {
        PATH: process.env.PATH || "",
        SystemRoot: process.env.SystemRoot || "",
        WINDIR: process.env.WINDIR || "",
        USERPROFILE: home,
        HOME: home,
        TEMP: home,
        TMP: home,
        CANVAS_AGENT_TOKEN: token,
        CANVAS_AGENT_PORT: String(port),
    };
    const child = spawn(process.execPath, [resolve(import.meta.dirname, "index.mjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let eventStream;
    t.after(async () => {
        await eventStream?.body?.cancel().catch(() => {});
        if (child.exitCode === null) child.kill();
        if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 2000))]);
        const tempRoot = resolve(tmpdir());
        const resolvedHome = resolve(home);
        assert.ok(resolvedHome.startsWith(tempRoot + "\\") && resolvedHome !== tempRoot);
        await rm(resolvedHome, { recursive: true, force: true });
    });
    const ready = new Promise((resolveReady, rejectReady) => {
        const timer = setTimeout(() => rejectReady(new Error(`Agent did not start: ${output}`)), 5_000);
        child.stdout.on("data", (chunk) => {
            output += chunk.toString();
            if (output.includes("Local URL: ")) { clearTimeout(timer); resolveReady(); }
        });
        child.stderr.on("data", (chunk) => { output += chunk.toString(); });
        child.once("error", (error) => { clearTimeout(timer); rejectReady(error); });
        child.once("exit", (code) => { if (code !== 0) { clearTimeout(timer); rejectReady(new Error(`Agent exited ${code}: ${output}`)); } });
    });
    await ready;

    const endpoint = `http://127.0.0.1:${port}`;
    eventStream = await fetch(`${endpoint}/events?${new URLSearchParams({ clientId: "client-target", token })}`);
    assert.equal(eventStream.status, 200);
    const schema = [{ name: "get_canvas_summary", description: "summary", inputSchema: { type: "object" } }];
    const connect = await fetch(endpoint + "/connect", {
        method: "POST",
        headers: { "content-type": "application/json", "x-canvas-agent-token": token },
        body: JSON.stringify({ clientId: "client-target", canvasId: "SBlHyQQ7zOCh3YzS34Acf", tools: schema }),
    });
    assert.equal(connect.status, 200);

    const unauthorized = await fetch(endpoint + "/connections");
    assert.equal(unauthorized.status, 401);
    const response = await fetch(endpoint + "/connections", { headers: { "x-canvas-agent-token": token } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        connections: [{ clientId: "client-target", canvasId: "SBlHyQQ7zOCh3YzS34Acf", connected: true, selected: false, toolCount: 1 }],
    });
});
