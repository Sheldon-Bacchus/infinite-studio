// SPDX-License-Identifier: AGPL-3.0-or-later

export function createSerializedAssetSnapshotWriter<T>(writeSnapshot: (snapshot: T) => Promise<T>): (snapshot: T) => Promise<T> {
    let previousWrite: Promise<void> = Promise.resolve();

    return (snapshot) => {
        const currentWrite = previousWrite.then(() => writeSnapshot(snapshot));
        previousWrite = currentWrite.then(() => undefined, () => undefined);
        return currentWrite;
    };
}
