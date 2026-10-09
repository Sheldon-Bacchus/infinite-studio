import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../../CHANGELOG.md"), "utf8");

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

function localAgentBootstrap(): Plugin {
    return {
        name: "local-agent-bootstrap",
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url !== "/api/local-agent/bootstrap") return next();
                res.setHeader("Cache-Control", "no-store");
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
                const host = String(req.headers.host || "");
                const origin = req.headers.origin;
                const fetchSite = req.headers["sec-fetch-site"];
                if (host !== "127.0.0.1:43863" || (origin && origin !== "http://127.0.0.1:43863") || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
                    res.statusCode = 403;
                    res.end(JSON.stringify({ ok: false, error: "local bootstrap origin rejected" }));
                    return;
                }
                const configDir = process.env.CANVAS_AGENT_CONFIG_DIR ? resolve(process.env.CANVAS_AGENT_CONFIG_DIR) : resolve(homedir(), ".infinite-studio");
                const configFile = resolve(configDir, "canvas-agent.json");
                if (!existsSync(configFile)) { res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: "local agent is not running" })); return; }
                try {
                    const config = JSON.parse(readFileSync(configFile, "utf8")) as { url?: string; token?: string };
                    const agentUrl = config.url ? new URL(config.url) : null;
                    if (!agentUrl || !config.token || agentUrl.protocol !== "http:" || agentUrl.hostname !== "127.0.0.1" || agentUrl.port !== "17371") throw new Error("invalid local agent config");
                    res.end(JSON.stringify({ ok: true, url: config.url, token: config.token }));
                } catch { res.statusCode = 503; res.end(JSON.stringify({ ok: false, error: "local agent configuration is unavailable" })); }
            });
        },
    };
}

export default defineConfig(({ mode }) => {
    const localWorkspaceMode = loadEnv(mode, webDir, "VITE_").VITE_STORAGE_MODE === "local-workspace";
    const accessToken = process.env.LOCAL_WORKSPACE_ACCESS_TOKEN;
    if (localWorkspaceMode && !accessToken) throw new Error("Local workspace mode requires a server-only access token");

    const workspaceProxy = localWorkspaceMode
        ? {
              "/api/local": {
                  target: "http://127.0.0.1:8086",
                  changeOrigin: true,
                  headers: { "X-Local-Workspace-Token": accessToken || "" },
              },
              "/api/files": {
                  target: "http://127.0.0.1:8086",
                  changeOrigin: true,
                  headers: { "X-Local-Workspace-Token": accessToken || "" },
              },
          }
        : undefined;

    return {
        base: process.env.VITE_BASE || "/",
        plugins: [react(), localPluginsManifest(), localAgentBootstrap()],
        resolve: {
            alias: {
                "@": resolve(webDir, "src"),
            },
        },
        server: {
            host: "127.0.0.1",
            port: 43863,
            strictPort: true,
            proxy: workspaceProxy,
        },
        define: {
            __APP_VERSION__: JSON.stringify(localVersion),
            __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
        },
    };
});
