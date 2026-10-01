# Local Workspace Single Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make canvas projects, the “My Assets” index, and their local media resolve through one local-workspace backend across browser profiles, without stale writes recreating deleted data.

**Architecture:** Keep `local-workspace` and `data/infinite-canvas.db` / `data/files` as the canonical local source. Store asset metadata as per-ID JSON rows in SQLite, migrate each browser’s old LocalForage asset index once without deleting its cache, and merge optional account assets into the local source rather than replacing it. Canvas imports use a dedicated explicit import path; ordinary autosaves cannot restore tombstones. Both stores refresh from the backend on focus and a short interval.

**Tech Stack:** Go, Gin, GORM, SQLite, Next.js App Router, TypeScript, Zustand, Bun tests.

**Spec:** `docs/backend/canvas-data-structure.md` and the user-approved single-local-workspace repair scope in this conversation.

## Global Constraints

- Preserve the fixed backend address `127.0.0.1:8081`, database `data/infinite-canvas.db`, media directory `data/files`, and workspace ID `local-workspace`.
- Keep the existing `{ code, data, msg }` API response envelope and existing canvas routes backward compatible.
- Do not erase legacy LocalForage stores; a successful one-time migration may mark them imported but must leave their records recoverable.
- Use explicit import endpoints for intentional restore; autosave and synchronization must never clear a deletion tombstone.
- Preserve the optional account asset sync as a mirror; local-workspace remains authoritative and account hydration must merge instead of replacing it.
- Do not start Docker or depend on external API keys.
- Keep work in the current checkout because it contains user changes that an isolated worktree would omit; do not stage, revert, or commit unrelated changes.

## Review Focus

- Two browser profiles migrate different legacy assets at the same time: distinct IDs survive, matching IDs resolve deterministically, and old stores remain intact.
- A stale page saves after a project or asset was deleted: the tombstone wins and the item stays absent after refresh.
- Reimporting the same archive from the web and CLI resolves to the same stable identity; distinct archives that reuse one source ID are remapped instead of overwriting each other.
- A file referenced by another project or asset cannot be physically removed; a missing file behind an existing SHA row is repaired on reupload.
- Exporting `server:<id>` media puts the actual bytes in the ZIP; a failed read is reported rather than silently exporting a broken project.

---

### Task 1: Prevent stale canvas writes from restoring deleted projects

**Files:**
- Modify: `repository/local_canvas_project.go`
- Modify: `service/local_workspace.go`
- Modify: `handler/local_workspace.go`
- Modify: `router/router.go`
- Test: `repository/local_canvas_project_test.go`

**Interfaces:**
- Existing save/sync endpoints remain ordinary writes and skip tombstoned IDs.
- Add `POST /api/local/canvas/projects/import` for intentional import/restore; input `{ "projects": CanvasProject[] }`, output the active saved project list in the existing response envelope.

- [x] Add a repository test that creates a project, soft-deletes it, sends an older autosave, and asserts the active list remains empty.
- [x] Run `go test ./repository -run '^TestSaveLocalCanvasProjectDoesNotResurrectDeletedProject$' -count=1`; observed the expected failing regression before the fix.
- [x] Add an import test proving the explicit import operation restores the same ID after deletion.
- [x] Add an HTTP integration test for rejected stale saves, explicit restore, and repeat-import idempotency.
- [x] Implement normal-save tombstone preservation and the explicit import/restore repository/service/handler route.
- [x] Run focused repository and handler tests; both passed after implementation.

### Task 2: Put the asset index in the local workspace database

**Files:**
- Create: `model/local_workspace_asset.go`
- Create: `repository/local_workspace_asset.go`
- Modify: `repository/db.go`
- Modify: `service/local_workspace.go`
- Modify: `handler/local_workspace.go`
- Modify: `router/router.go`
- Modify: `docs/backend/backend-database.md`
- Test: `repository/local_workspace_asset_test.go`

**Interfaces:**
- `GET /api/local/assets` returns active `Asset[]`.
- `POST /api/local/assets/sync` accepts `{ "assets": Asset[] }` and returns the merged active array.
- `POST /api/local/assets/delete` accepts `{ "ids": string[] }` and idempotently marks those IDs deleted.
- Per-asset records retain stable IDs, `updatedAt`, and a deletion tombstone; older sync values cannot overwrite newer rows or restore tombstones.

- [x] Add repository tests for create/update ordering, stale update rejection, and delete-tombstone preservation.
- [x] Add the GORM model and repository operations with a fixed `local-workspace` key.
- [x] Add the three local asset routes using the existing `{code,data,msg}` handlers.
- [x] Verify the asset routes, stale snapshot behavior, and tombstones through HTTP integration tests.
- [x] Document the new table and fields in `docs/backend/backend-database.md`.

### Task 3: Make browser stores converge on the local backend

**Files:**
- Modify: `web/src/services/api/local-workspace.ts`
- Modify: `web/src/stores/use-asset-store.ts`
- Modify: `web/src/app/(user)/layout.tsx`
- Modify: `web/src/app/(user)/canvas/stores/use-canvas-store.ts`
- Modify: `web/src/app/(user)/canvas/page.tsx`
- Modify: `scripts/import-canvas-zip-local.mjs`
- Create: `web/src/app/(user)/canvas/utils/canvas-import-identity.ts`
- Test: canvas import identity and store reconciliation tests under their owning folders.

**Interfaces:**
- Web and CLI imports derive the same import key: preserve an explicit `importKey`, otherwise SHA-256 of the project JSON excluding root `createdAt` and `updatedAt`. The original project ID is retained unless it collides with a different import identity; collisions receive a deterministic ID derived from the import key.
- Each browser imports its old `infinite-canvas:asset_store` at most once; it writes migrated records to the backend and leaves the old browser data untouched.
- Canvas and asset stores refresh on focus and every three seconds, merge by stable ID and `updatedAt`, and drop previously-known IDs absent from the backend.
- Account asset hydration merges into the local asset store; it does not replace the local workspace snapshot.

- [x] Add Bun tests for timestamp-stable import identity, original-ID preservation, distinct source IDs, snapshot merge behavior, and legacy snapshot parsing; add Go regression coverage for colliding source IDs and repeat imports.
- [x] Route web imports through `/api/local/canvas/projects/import`; update the ZIP CLI to use the same identity rule and import endpoint.
- [x] Replace ongoing LocalForage asset persistence with local-workspace API persistence; retain LocalForage only for the one-time additive migration.
- [x] Add bounded focus/interval refresh for both stores without scheduling a write for a read-only refresh.
- [x] Verify focused Bun tests for import identity, local asset migration helpers, and backend media download.

### Task 4: Protect shared media and export backend files

**Files:**
- Modify: `service/local_storage.go`
- Modify: `repository/local_canvas_project.go`
- Modify: `repository/local_workspace_asset.go`
- Modify: `handler/local_workspace.go`
- Modify: `web/src/app/(user)/canvas/utils/canvas-export.ts`
- Test: local storage service tests and canvas export tests.

**Interfaces:**
- File upload streams to a temporary file while computing SHA-256; it does not read the complete upload into process memory.
- A matching SHA row is reused only when its file exists; if the file is missing, the same object is repaired from the new upload.
- File deletion is idempotent and refuses physical deletion while any project or asset record still references `server:<id>`; reference-bearing writes and deletion serialize, and writes reject UUID references whose file record has already been deleted.
- Canvas export fetches `server:<id>` from `/api/files/:id/content`, preserves MIME type, and fails visibly on HTTP errors.

- [x] Add regression coverage for duplicate-SHA missing-file repair, referenced-file deletion protection, and server media download/error handling.
- [x] Add regression coverage proving a deleted local media ID cannot be attached to a newly saved project.
- [x] Implement streaming upload, reference checks, server-blob export, and explicit error handling.
- [x] Run the focused Go service/handler tests and Bun media-download tests.

### Task 5: Record the implemented behavior and run final verification

**Files:**
- Modify: `docs/backend/canvas-data-structure.md`
- Modify: `docs/progress/todo.md`
- Modify: `docs/progress/pending-test.md`
- Modify: `CHANGELOG.md`

- [x] Update storage documentation to distinguish the canonical backend from legacy browser caches and optional account mirroring.
- [x] Record user-testable runtime scenarios in `pending-test.md` and update `CHANGELOG.md` at version-level summary.
- [x] Run `go test ./...`, the full web Bun test suite, TypeScript checking, and `git diff --check`; all passed.
- [x] Inspect the final scoped diffs and working-tree status; preserve unrelated pre-existing user changes without staging or reverting.
- [x] Complete a fresh read-only subagent review; resolve ID collisions, reference/deletion races, and invalid timestamp ordering with regression tests. Final review found no Critical/Important findings.
