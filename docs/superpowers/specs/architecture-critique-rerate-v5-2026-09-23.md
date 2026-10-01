## Verdict: REVISE

The design has clear requirements and ownership boundaries, but the revisioned save contract does not explicitly cover the existing autosave path.

## Seven dimensions

| Dimension | Rating | Reason |
|---|---|---|
| 1. Requirement and quality-attribute fidelity | 🟢 | §1.1 defines concrete acceptance criteria for the four domain pages and their operations. |
| 2. Boundary cohesion and coupling | 🟢 | §§3–5 keep DramaClaw as source of truth and CanvasProject as a selected-content snapshot. |
| 3. Force-based pattern restraint | 🟢 | §§6.1–6.5 reuse domain APIs and canvas services without adding generic jobs or assets layers. |
| 4. Data, state, ownership, invariants, trust | 🟡 | Ownership and selection boundaries are explicit, but revision handling covers only one save path. |
| 5. YAGNI and change tolerance | 🟢 | The scope matches the full-page requirement and excludes sibling workspaces. |
| 6. Failure, concurrency, retry, idempotency, scale | 🔴 | §6.4 requires atomic revision checks, but the existing autosave path uses a separate sync route that the spec does not bring under that contract. |
| 7. Decision rationale and rejected alternatives | 🟡 | §3.2 compares backend options, but §9 gives no fallback if direct component reuse cannot be cleared for distribution. |

## Findings

### Blocker

- **Unify canvas writes under the revision contract.** §§5.10–5.12 and 6.4 define `expectedRevision` for `POST /api/local/canvas/projects`. The cited [store](<E:/all-agent-workspace/codex-projects/infinite-canvas/web/src/app/(user)/canvas/stores/use-canvas-store.ts:70>) autosaves through `syncLocalCanvasProjects`, and [router](<E:/all-agent-workspace/codex-projects/infinite-canvas/router/router.go:142>) registers a separate `/canvas/projects/sync` route. Specify that autosaves also use the ordered revisioned path, or define per-project CAS for `/sync`; otherwise ordinary writes can bypass the importer’s revision guarantee.

### Should-fix

- **Specify generation retry behavior.** §6.3 permits retry after a synchronous provider request times out but does not say how to reconcile providers without task lookup or idempotency. Retrying may submit a second billable generation. Limit retries to reconcilable calls or define the duplicate-submission behavior.
- **Define a licensing fallback.** §9 gates distribution on file-level review but relies on direct component migration. State how implementation proceeds if that reuse is not cleared, such as independent reimplementation or a separately distributed component.

### Nit

- **Clarify `sourceSystem`.** §5.3 omits it from the selection shape, while §6.4 includes it in `sourceKey` alongside the `"xiaji"` namespace. Define it as a constant or an explicit selection field.