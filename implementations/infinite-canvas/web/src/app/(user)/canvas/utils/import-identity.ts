import type { CanvasProject } from "../stores/use-canvas-store";

export async function withStableCanvasImportIdentity(project: CanvasProject): Promise<CanvasProject> {
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...identitySource } = project;
    const serialized = JSON.stringify(identitySource);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
    const now = new Date().toISOString();
    return {
        ...project,
        id: project.id || `imported-${fingerprint}`,
        importKey: project.importKey || `zip-project:${fingerprint}`,
        createdAt: project.createdAt || now,
        updatedAt: now,
    };
}
