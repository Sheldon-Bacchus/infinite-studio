type PersistedCanvasState<T> = { projects: T[]; deletedProjects: unknown[] };

export function shouldPersistCanvasState<T>(queuedHydration: PersistedCanvasState<T> | null, nextState: PersistedCanvasState<T>) {
    return !queuedHydration || queuedHydration.projects !== nextState.projects || queuedHydration.deletedProjects !== nextState.deletedProjects;
}
