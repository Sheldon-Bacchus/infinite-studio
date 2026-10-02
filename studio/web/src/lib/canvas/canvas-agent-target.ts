export function isAgentCanvasTargetReady(expectedLoadKey: string, currentLoadKey: string, projectReady: boolean) {
    return projectReady && expectedLoadKey === currentLoadKey;
}
