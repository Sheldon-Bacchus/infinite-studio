import { readdirSync, readFileSync } from "node:fs";
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
        plugins: [react(), localPluginsManifest()],
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
