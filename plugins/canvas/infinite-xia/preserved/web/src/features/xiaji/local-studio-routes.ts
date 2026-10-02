// SPDX-License-Identifier: AGPL-3.0-or-later

const encode = (value: string) => encodeURIComponent(value);

export const localStudioRoutes = {
    ingest: "/xiaji/ingest",
    projects: "/xiaji/projects",
    project: (projectAssetId: string) => `/xiaji/project/${encode(projectAssetId)}/episodes`,
    projectHome: (projectAssetId: string) => `/xiaji/project/${encode(projectAssetId)}`,
    characters: (projectAssetId: string) => `/xiaji/project/${encode(projectAssetId)}/characters`,
    episodes: (projectAssetId: string) => `/xiaji/project/${encode(projectAssetId)}/episodes`,
    ingestProject: (projectAssetId: string) => `/xiaji/project/${encode(projectAssetId)}/ingest`,
    episode: (projectAssetId: string, episodeAssetId: string) => `/xiaji/project/${encode(projectAssetId)}/episodes/by-id/${encode(episodeAssetId)}`,
    script: (projectAssetId: string, episodeAssetId: string) => `/xiaji/project/${encode(projectAssetId)}/episodes/by-id/${encode(episodeAssetId)}/script`,
    beats: (projectAssetId: string, episodeAssetId: string, sub = "text", beatAssetId?: string) => {
        const search = `sub=${encode(sub)}${beatAssetId ? `&beatAssetId=${encode(beatAssetId)}` : ""}`;
        return `/xiaji/project/${encode(projectAssetId)}/episodes/by-id/${encode(episodeAssetId)}/beats?${search}`;
    },
    compose: (projectAssetId: string, episodeAssetId: string, focusBeatAssetId?: string) => {
        const path = `/xiaji/project/${encode(projectAssetId)}/episodes/by-id/${encode(episodeAssetId)}/compose`;
        return focusBeatAssetId ? `${path}?focusBeatAssetId=${encode(focusBeatAssetId)}` : path;
    },
};

export function getStudioWorkflowNavigation(projectAssetId?: string) {
    return [
        { label: "虾料", href: localStudioRoutes.ingest, disabledReason: null },
        { label: "虾塘", href: "/xiaji", disabledReason: null },
        {
            label: "虾镜",
            href: projectAssetId ? localStudioRoutes.episodes(projectAssetId) : localStudioRoutes.projects,
            disabledReason: null,
        },
    ] as const;
}
