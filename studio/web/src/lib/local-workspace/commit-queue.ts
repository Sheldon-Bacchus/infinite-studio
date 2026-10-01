import { nanoid } from "nanoid";

import { LocalWorkspaceError, type SavePhase, type WriteResult } from "./types";

type PendingCommit<T> = {
    data: T;
    baseRevision: number | null;
    operationId: string;
    editVersion: number;
};

type DraftCommit<T> = { data: T; version: number; operationId?: string };

export type CommitQueueSnapshot<T> = {
    phase: SavePhase;
    revision: number | null;
    draft: T | null;
    operationId: string | null;
    error: LocalWorkspaceError | null;
};

export class CommitQueue<T extends { id: string }> {
    private revision: number | null;
    private draft: DraftCommit<T> | null = null;
    private pending: PendingCommit<T> | null = null;
    private version = 0;
    private phase: SavePhase = "clean";
    private error: LocalWorkspaceError | null = null;
    private active: Promise<WriteResult<T>> | null = null;
    private completed = new Map<string, { data: T; result: WriteResult<T> }>();
    private listeners = new Set<(snapshot: CommitQueueSnapshot<T>) => void>();

    constructor(
        private readonly workspaceId: string,
        private readonly recordId: string,
        revision: number | null,
        private readonly commit: (data: T, baseRevision: number | null, operationId: string) => Promise<WriteResult<T>>,
    ) {
        this.revision = revision;
    }

    snapshot(): CommitQueueSnapshot<T> {
        return {
            phase: this.phase,
            revision: this.revision,
            draft: this.draft?.data ?? null,
            operationId: this.pending?.operationId ?? null,
            error: this.error,
        };
    }

    subscribe(listener: (snapshot: CommitQueueSnapshot<T>) => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    enqueue(data: T, operationId?: string) {
        if (data.id !== this.recordId) throw new LocalWorkspaceError("提交记录 ID 与队列目标不一致", "invalid");
        const completed = operationId ? this.completed.get(operationId) : undefined;
        if (completed) {
            if (stableJSON(completed.data) !== stableJSON(data)) {
                this.version += 1;
                this.draft = { data, version: this.version };
                this.error = new LocalWorkspaceError("相同 operationId 对应了不同工作区记录修改；草稿已保留", "conflict");
                this.phase = "conflict";
                this.publish();
                return;
            }
            return;
        }
        const duplicate = this.pending?.operationId === operationId ? this.pending : this.draft?.operationId === operationId ? this.draft : null;
        if (operationId && duplicate) {
            if (stableJSON(duplicate.data) !== stableJSON(data)) {
                this.version += 1;
                this.draft = { data, version: this.version };
                this.error = new LocalWorkspaceError("相同 operationId 对应了不同工作区记录修改；草稿已保留", "conflict");
                this.phase = "conflict";
                this.publish();
                return;
            }
            return;
        }
        this.version += 1;
        this.draft = { data, version: this.version, operationId };
        if (this.phase !== "saving" && this.phase !== "error" && this.phase !== "conflict") this.phase = "dirty";
        this.publish();
    }

    flush(operationId?: string): Promise<WriteResult<T>> {
        if (this.phase === "conflict" && this.error) return Promise.reject(this.error);
        const completed = operationId ? this.completed.get(operationId) : undefined;
        if (completed) return Promise.resolve(completed.result);
        if (this.active) return this.active.then((result) => operationId ? this.completed.get(operationId)?.result || result : result);
        if (!this.pending && !this.draft) return Promise.reject(new LocalWorkspaceError("没有待保存的工作区草稿", "invalid"));
        const active = this.drain();
        this.active = active;
        const settled = active.finally(() => {
            if (this.active === active) {
                this.active = null;
                if ((this.pending || this.draft) && this.phase !== "error" && this.phase !== "conflict") void this.flush().catch(() => undefined);
            }
        });
        return operationId ? settled.then((result) => this.completed.get(operationId)?.result || result) : settled;
    }

    rebase(revision: number, workspaceId: string, recordId: string) {
        if (workspaceId !== this.workspaceId || recordId !== this.recordId || !Number.isSafeInteger(revision) || revision < 1) {
            throw new LocalWorkspaceError("冲突回读的工作区或记录身份不匹配", "invalid");
        }
        this.revision = revision;
        this.pending = null;
        this.error = null;
        this.phase = this.draft ? "dirty" : "clean";
        this.publish();
    }

    discardDraft() {
        this.draft = null;
        this.pending = null;
        this.error = null;
        this.phase = "clean";
        this.publish();
    }

    private async drain(): Promise<WriteResult<T>> {
        let result: WriteResult<T> | null = null;
        while (this.pending || this.draft) {
            if (this.phase === "conflict" && this.error) throw this.error;
            if (!this.pending) {
                const draft = this.draft;
                if (!draft) break;
                this.pending = {
                    data: draft.data,
                    baseRevision: this.revision,
                    operationId: draft.operationId || nanoid(),
                    editVersion: draft.version,
                };
            }

            const pending = this.pending;
            this.phase = "saving";
            this.error = null;
            this.publish();
            try {
                result = await this.commit(pending.data, pending.baseRevision, pending.operationId);
            } catch (error) {
                this.error = error instanceof LocalWorkspaceError ? error : new LocalWorkspaceError("工作区保存失败；草稿已保留", "server");
                this.phase = this.error.phase === "conflict" ? "conflict" : "error";
                this.publish();
                throw this.error;
            }

            if (
                result.workspaceId !== this.workspaceId ||
                result.id !== this.recordId ||
                result.operationId !== pending.operationId ||
                result.revision !== (pending.baseRevision ?? 0) + 1
            ) {
                this.error = new LocalWorkspaceError("工作区确认回执与提交不一致；草稿已保留", "invalid");
                this.phase = "error";
                this.publish();
                throw this.error;
            }

            this.revision = result.revision;
            this.completed.set(pending.operationId, { data: pending.data, result });
            this.pending = null;
            if (this.draft?.version === pending.editVersion) this.draft = null;
            if (this.phase !== "conflict") {
                this.phase = this.draft ? "dirty" : "saved";
                this.error = null;
            }
            this.publish();
        }
        if (!result) throw new LocalWorkspaceError("没有待保存的工作区草稿", "invalid");
        return result;
    }

    private publish() {
        const snapshot = this.snapshot();
        this.listeners.forEach((listener) => listener(snapshot));
    }
}

function stableJSON(value: unknown): string {
    const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort((item as Record<string, unknown>)[key])])) : item;
    return JSON.stringify(sort(value));
}
