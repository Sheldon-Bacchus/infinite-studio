export type CanvasAgentRuntimeAlternative = {
    label: string;
    repository: string;
    packageName: string;
    status: string;
    reason: string;
};

export type CanvasAgentRuntimeManifest = {
    schemaVersion: number;
    selection: string;
    application: {
        label: string;
        repository: string;
        version: string;
        features: string[];
    };
    agentRuntime: {
        id: string;
        label: string;
        repository: string;
        packageName: string;
        packageSpecifier: string;
        mcpServerName: string;
        pluginName: string;
        defaultPort: number;
        transport: string;
    };
    alternatives: CanvasAgentRuntimeAlternative[];
    policy: {
        singleRuntime: boolean;
        doNotMixPackages: boolean;
        sourceOfTruth: string;
    };
};

const fallback: CanvasAgentRuntimeManifest = {
    schemaVersion: 1,
    selection: "local-repository",
    application: {
        label: "当前仓库应用主线",
        repository: "https://github.com/Sheldon-Bacchus/infinite-studio",
        version: "local",
        features: [],
    },
    agentRuntime: {
        id: "tigerowo-infinite-canvas-agent",
        label: "Infinite Canvas Agent（唯一运行时）",
        repository: "https://github.com/tigerowo/infinite-canvas",
        packageName: "@tigerowo/canvas-agent",
        packageSpecifier: "@tigerowo/canvas-agent@latest",
        mcpServerName: "infinite-canvas-core",
        pluginName: "canvas-agent",
        defaultPort: 3210,
        transport: "MCP stdio → 本地 HTTP 画布桥接",
    },
    alternatives: [],
    policy: { singleRuntime: true, doNotMixPackages: true, sourceOfTruth: "本文件" },
};

function readRuntimeManifest(): CanvasAgentRuntimeManifest {
    try {
        const parsed = JSON.parse(process.env.NEXT_PUBLIC_CANVAS_AGENT_RUNTIME || "null") as CanvasAgentRuntimeManifest;
        if (parsed?.agentRuntime?.packageName && parsed.agentRuntime?.mcpServerName) return parsed;
    } catch { /* 使用内置兜底，面板仍能显示统一运行时 */ }
    return fallback;
}

export const CANVAS_AGENT_RUNTIME = readRuntimeManifest();
