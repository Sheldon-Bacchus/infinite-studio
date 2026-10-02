// SPDX-License-Identifier: AGPL-3.0-or-later
import localforage from "localforage";
import type { PluginStorage } from "@infinite-canvas/plugin-sdk";

// Explicit namespace also works while the host restores nodes before registering plugins.
const store = localforage.createInstance({ name: "infinite-canvas-plugins", storeName: "infinite-xia" });
export const storage: PluginStorage = {
    get: (key) => store.getItem(key),
    set: async (key, value) => { await store.setItem(key, value); },
    remove: async (key) => { await store.removeItem(key); },
};
