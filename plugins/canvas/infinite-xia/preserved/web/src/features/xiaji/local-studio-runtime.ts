// SPDX-License-Identifier: AGPL-3.0-or-later

import { useAssetStore } from "@/stores/use-asset-store";
import { createLocalStudioRepository } from "./local-studio-repository";

export const localStudioRepository = createLocalStudioRepository({
    getAssets: () => useAssetStore.getState().assets,
    saveAssetsAndWait: (assets) => useAssetStore.getState().saveAssetsAndWait(assets),
    readCanonicalAssets: async () => {
        await useAssetStore.getState().refreshWorkspaceAssets();
        const state = useAssetStore.getState();
        if (state.workspaceError) throw new Error(state.workspaceError);
        return state.assets;
    },
});
