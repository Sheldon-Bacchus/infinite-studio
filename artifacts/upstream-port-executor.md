I completed the port. All five upstream modules plus the provenance snapshot work are implemented and wired; the report is at [upstream-port-executor.md](E:/all-agent-workspace/infinite-studio/artifacts/upstream-port-executor.md).

## What I implemented

**Module 1 — reference sorting, numbering, copy relationships**
New [canvas-reference-plan.ts](E:/all-agent-workspace/infinite-studio/studio/web/src/lib/canvas/canvas-reference-plan.ts) and [canvas-reference-copy.ts](E:/all-agent-workspace/infinite-studio/studio/web/src/lib/canvas/canvas-reference-copy.ts). `referenceNodeOrder` now drives both the displayed numbering and the submitted order for image, text and video paths; the reference bar supports drag and arrow reordering. Copy/paste expands groups, keeps external incoming edges only when the source still exists, deep-clones metadata, and remaps node, binding, group and order references. `duplicateNode`/`copySelectedNodes`/`pasteCopiedNodes` in [project.tsx](E:/all-agent-workspace/infinite-studio/studio/web/src/pages/canvas/project.tsx) now use these modules.

**Module 2 — local-assets MCP with persistent workspace fileId**
New [local-assets.ts](E:/all-agent-workspace/infinite-studio/canvas-agent/src/canvas/local-assets.ts), plus `local_assets_search` / `canvas_import_local_assets` tools, directory-authorization endpoints, and a per-request asset scoping check. The browser side ([local-asset-import.ts](E:/all-agent-workspace/infinite-studio/studio/web/src/lib/agent/local-asset-import.ts)) imports originals through the media upload path, so in local-workspace mode the原件 lands in workspace-service files with a persistent `fileId`/`storageKey=file:ID`. Studio `sudio` identity and protocol 8 preserved.

**Module 3 — AutoDL five workflows**
New [autodl-video-settings.ts](E:/all-agent-workspace/infinite-studio/studio/web/src/lib/autodl-video-settings.ts) and [canvas-reference-submission.ts](E:/all-agent-workspace/infinite-studio/studio/web/src/lib/canvas/canvas-reference-submission.ts); [video.ts](E:/all-agent-workspace/infinite-studio/studio/web/src/services/api/video.ts) now has an `autodl` provider with submit and poll, full pre-submit validation, and no automatic paid fallback. Non-AutoDL channels and the existing H3 draft block are unchanged; 1088p is still rejected per official capability.

**Module 4 — video download** — [video-download.ts](E:/all-agent-workspace/infinite-studio/studio/web/src/lib/canvas/video-download.ts) keeps the existing `saveAs(content)` path and prefers the local `fileId` original when present; failures report the real reason and offer to open the original address without claiming a completed download. The analysis is preserved in the report.

**Module 5 — /sudio routing** — `/sudio` and `/sudio/:id` are primary, old `/canvas` routes redirect with query and hash preserved, and navigation, works links, launcher hints and MCP `site_navigate` text are updated.

**Provenance** — new [canvas-node-input-provenance.tsx](E:/all-agent-workspace/infinite-studio/studio/web/src/components/canvas/canvas-node-input-provenance.tsx) renders the immutable confirmed snapshot in both confirm dialogs, marking detached sources. CHANGELOG, pending-test and HANDOFF updated.

## Honest gaps

- No AutoDL preset package or config-merge import path (repo has no `plugins/model-profiles/`, and the existing importer replaces the whole config, which would drop existing channels/tokens — deliberately untouched).
- Image/text/audio paths have no independent confirm-snapshot card; non-Works canvases still keep only node metadata rather than a separate per-attempt history.
- Remote signed-URL download remains unobservable; no fetch fallback was added, per the analysis.

## Verification

I did not run tests, build, typecheck, browser or any paid generation. I statically parsed all 29 touched/new files with the project's esbuild (0 failures) as a syntax check only. Suggested commands left for pending-test: `cd studio/web && bun test` and `cd canvas-agent && npm test`.

Three decisions are worth your call: whether to add the AutoDL import path, whether to extend snapshots to image/text/audio and non-Works attempts, and whether remote signed-URL download needs any fallback.