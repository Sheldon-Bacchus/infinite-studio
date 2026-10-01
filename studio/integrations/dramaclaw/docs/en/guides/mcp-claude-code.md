# Driving DramaClaw from an AI agent (MCP)

DramaClaw ships an [MCP](https://modelcontextprotocol.io) server that exposes the
whole drama pipeline — ingest, characters, script, storyboards, first frames,
video, audio, compose, export — as the tool set reported by `tools/list`. Any MCP-speaking agent
(**Claude Code**, Codex, etc.) can use it to build a drama end to end.

The canonical server (`apps/dramaclaw-mcp-bridge/dramaclaw_mcp.py`) is a thin stdio bridge over
the DramaClaw REST API: each tool is an HTTP call to your running instance, so it
inherits the same auth, project guards, and task queue as the web UI.

The legacy module `src/novelvideo/chat/dramaclaw_mcp.py` remains as a compatibility
entry point for existing `python -m novelvideo.chat.dramaclaw_mcp` integrations.

## Prerequisites

- A running DramaClaw instance (`docker compose up -d`, REST API on `:8780`).
- A configured, funded model gateway (Settings → Model Config) — the agent can
  plan/script without it, but image/video/audio generation needs working models.
- Local checkout with [`uv`](https://docs.astral.sh/uv/) synced (`uv sync`) so the
  `novelvideo` package is importable.

## Auth: two modes

The server authenticates to the API with two environment variables:

| Variable | Purpose |
|---|---|
| `DRAMACLAW_API_URL` | Base URL of your instance, e.g. `http://localhost:8780` |
| `DRAMACLAW_CE_OWNER` | Set to `1` for **CE** (self-host): calls are made as the local owner, no token needed. The target **must be loopback** (`localhost`, `127.0.0.1`, `::1`, `[::1]`) |
| `DRAMACLAW_CE_OWNER_ALLOW_REMOTE` | Unsafe override: set to `1` to allow tokenless CE-owner mode against a **non-loopback** `DRAMACLAW_API_URL` (see the warning below) |
| `DRAMACLAW_AGENT_TOKEN` | **EE / multi-user** only: a scoped agent-session bearer token |
| `DRAMACLAW_PROJECT_ID` | Optional conflict check; tools always require explicit `project_id` |
| `DRAMACLAW_ASSET_IMPORT_ROOTS` | Optional, `os.pathsep`-separated local directories allowed for character voice imports |

**Community Edition** trusts local requests as the owner, so `DRAMACLAW_CE_OWNER=1`
is all you need — no token to mint. On EE, set `DRAMACLAW_AGENT_TOKEN` instead;
CE-owner mode is ignored when a token is present (the token always takes
precedence and its `Authorization` header is sent).

**Loopback is enforced.** Because tokenless owner mode sends *unauthenticated,
owner-level* requests, the bridge refuses any `DRAMACLAW_API_URL` whose host is
not a loopback address (`localhost`, `127.0.0.1`, `::1`, `[::1]`) with a clear
error. If you genuinely must reach a remote CE without a token — e.g. an SSH
tunnel you fully control — opt in explicitly with
`DRAMACLAW_CE_OWNER_ALLOW_REMOTE=1`. This is deliberately a separate variable so
it can never be enabled by accident; prefer a scoped `DRAMACLAW_AGENT_TOKEN` for
any non-local target.

## Connect Claude Code

This repo ships a project [`.mcp.json`](../../../.mcp.json). Open the repo in
Claude Code and approve the `dramaclaw` server when prompted — that's it.

Or add it explicitly:

```bash
claude mcp add dramaclaw \
  --env DRAMACLAW_API_URL=http://localhost:8780 \
  --env DRAMACLAW_CE_OWNER=1 \
  -- uv run python apps/dramaclaw-mcp-bridge/dramaclaw_mcp.py
```

For local character voice imports, set `DRAMACLAW_ASSET_IMPORT_ROOTS` in the
MCP process environment to the asset directory you explicitly approve. It is
intentionally not hardcoded in the checked-in `.mcp.json`, because that path is
machine-specific and may point outside this repository.

Verify the tools are live:

```bash
claude mcp list        # dramaclaw → ✓ connected
```

> **Running via Docker only?** Launch the bridge inside the container instead:
> set the `.mcp.json` command to
> `docker compose exec -T -e DRAMACLAW_API_URL=http://localhost:8780 -e DRAMACLAW_CE_OWNER=1 api python apps/dramaclaw-mcp-bridge/dramaclaw_mcp.py`.

## What the agent can do

The tools cover the full pipeline. A typical end-to-end run:

1. `dramaclaw_post` → `/projects/{p}/ingest/upload` + `/ingest/start` — ingest a manuscript
2. `dramaclaw_build_characters` → extract the cast
3. `dramaclaw_plan_episodes` → segment into episodes
4. `dramaclaw_plan_identities` → per-episode identities
5. `dramaclaw_generate_script` → episode script
6. `dramaclaw_generate_portrait` / `dramaclaw_generate_scene_master` → key art
7. `dramaclaw_generate_sketches` → storyboards
8. `dramaclaw_render_first_frames` → first frames
9. `dramaclaw_start_single_video` → shot video
10. `dramaclaw_generate_audio` → voice-over
11. `dramaclaw_compose_episode` → assemble
12. `dramaclaw_get_final_video` → the finished episode (returns a servable URL)

Generation is **asynchronous**: a tool call starts a task, then the agent polls
`dramaclaw_pipeline_status` / `dramaclaw_list_tasks` / `dramaclaw_get_task` until
it completes. Each tool's description names the exact task to poll. The generic
`dramaclaw_get` / `dramaclaw_post` / `dramaclaw_put` / `dramaclaw_patch` / `dramaclaw_delete` tools
are an escape hatch for any endpoint not covered by a curated verb.

## Character voice result contract

The three character voice tools use a normalized result envelope. The bridge
returns the same JSON object in the text content and in MCP `structuredContent`:

```json
{
  "ok": true,
  "error_kind": null,
  "phase": "readback",
  "error": null,
  "project_id": "project-id",
  "character": "character-name",
  "requested_slot": "default",
  "source": {"filename": "voice.wav", "size_bytes": 1234, "sha256": "..."},
  "stored_matches_source": true,
  "verification": {"required_slot": "default", "required_ready": true},
  "ui_verification": {
    "verified": false,
    "reason": "MCP verifies DramaClaw backend state only"
  },
  "isError": false
}
```

`dramaclaw_import_character_voice` is not successful after upload alone. It
must perform the POST, perform a GET read-back, and compare the persisted slot
metadata with the source snapshot. `default` is the required character slot;
`child`, `youth`, `middle`, and `elder` are optional age-group overrides and do
not make an empty `default` slot ready. `available_count: 0` is reported as a
real empty backend result and normalized as `prerequisite_missing`, not replaced
with a placeholder success.

For failures, `error_kind` is one of `validation_error`, `transport_error`,
`http_error`, `persistence_mismatch`, `prerequisite_missing`, or
`protocol_error`; `phase` identifies validation, upload, readback, normalize,
or verify. `ui_verification.verified` remains false because MCP confirms
backend state only. A successful MCP call therefore does not claim browser
visibility, TTS generation, video generation, or media production.

The evidence boundary is intentionally explicit:

| State | Direct evidence | What it does not prove |
|---|---|---|
| Declared | `tools/list` contains the tool and schema | The tool was invoked or the backend is reachable |
| Invoked | MCP `tools/call` returned a result | An upload or persistence change occurred |
| Uploaded | A dedicated multipart POST returned a usable response | The file was persisted correctly |
| Read back | A GET returned structured slot records | The required `default` slot is ready |
| Default ready | `verification.required_ready=true` after GET | Browser visibility or media generation |
| UI visible | A separate browser/UI receipt | TTS, video, compose, or final-film completion |
| Media produced | A separate provider/task/output receipt | Creator approval or publication |

If upload and read-back metadata disagree, the bridge returns
`persistence_mismatch` and does not retry, delete, restore, or roll back the
slot. An operator must separately authorize and identify the exact
`project_id`, character, and slot before taking any corrective action; unrelated
project assets are outside this recovery boundary.

## Security notes

- CE-owner mode grants **full owner access** to the instance it points at — only
  use it against a **local** CE you control. Never point it at a shared instance.
- The bridge enforces this: tokenless CE-owner mode only accepts a **loopback**
  `DRAMACLAW_API_URL` and errors out on any remote host unless you set the
  explicit `DRAMACLAW_CE_OWNER_ALLOW_REMOTE=1` override.
- On EE, use a scoped `DRAMACLAW_AGENT_TOKEN`; the server enforces the token's
  project boundary and write scopes.
