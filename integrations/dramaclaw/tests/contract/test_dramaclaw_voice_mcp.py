"""Deterministic contract tests for the DramaClaw voice MCP tools."""

from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest


_MISSING = object()
_PLUGIN_PATH = (
    Path(__file__).resolve().parents[2]
    / ".hermes"
    / "plugins"
    / "dramaclaw"
    / "__init__.py"
)


def _load_plugin_module():
    tools_pkg = types.ModuleType("tools")
    registry = types.ModuleType("tools.registry")
    registry.tool_error = lambda value: value
    registry.tool_result = lambda value: value
    tools_pkg.registry = registry
    previous = {
        name: sys.modules.get(name, _MISSING)
        for name in ("tools", "tools.registry")
    }
    sys.modules["tools"] = tools_pkg
    sys.modules["tools.registry"] = registry
    try:
        spec = importlib.util.spec_from_file_location(
            "test_dramaclaw_voice_contract_plugin",
            _PLUGIN_PATH,
        )
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, value in previous.items():
            if value is _MISSING:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value


def _slots(*, default_hash: str = "", youth_hash: str = "") -> list[dict[str, object]]:
    values = {"default": default_hash, "youth": youth_hash}
    return [
        {
            "slot": slot,
            "path": f"voices/{slot}.wav" if digest else "",
            "url": f"/static/voices/{slot}.wav" if digest else "",
            "exists": bool(digest),
            "sha256": digest,
        }
        for slot, digest in (
            ("default", values["default"]),
            ("child", ""),
            ("youth", values["youth"]),
            ("middle", ""),
            ("elder", ""),
        )
    ]


def _response(slots: list[dict[str, object]]) -> dict[str, object]:
    return {"ok": True, "status_code": 200, "data": {"slots": slots}}


def test_default_import_is_post_then_get_and_compares_source_hash(tmp_path, monkeypatch):
    plugin = _load_plugin_module()
    source = tmp_path / "少年女孩.wav"
    source_bytes = b"voice-contract-default"
    source.write_bytes(source_bytes)
    monkeypatch.setenv("DRAMACLAW_ASSET_IMPORT_ROOTS", str(tmp_path))

    calls: list[tuple[str, str]] = []
    source_hash = hashlib.sha256(source_bytes).hexdigest()

    def fake_upload(method, path, *, file_name, file_bytes):
        calls.append((method, path))
        assert file_name == source.name
        assert file_bytes == source_bytes
        return {
            "ok": True,
            "status_code": 201,
            "data": {"path": "voices/default.wav", "sha256": source_hash},
        }

    def fake_request(method, path, **_kwargs):
        calls.append((method, path))
        return _response(_slots(default_hash=source_hash))

    monkeypatch.setattr(plugin, "_request_multipart", fake_upload)
    monkeypatch.setattr(plugin, "_request", fake_request)

    result = plugin._handle_import_character_voice(
        {
            "project_id": "project/one",
            "name": "飞碧球",
            "local_path": str(source),
        }
    )

    assert result["ok"] is True
    assert result["error_kind"] is None
    assert result["isError"] is False
    assert result["requested_slot"] == "default"
    assert result["source"] == {
        "filename": source.name,
        "size_bytes": len(source_bytes),
        "sha256": source_hash,
    }
    assert result["stored_matches_source"] is True
    assert result["verification"]["required_ready"] is True
    assert result["ui_verification"] == {
        "verified": False,
        "reason": "MCP verifies DramaClaw backend state only",
    }
    assert calls == [
        (
            "POST",
            "/api/v1/projects/project%2Fone/characters/%E9%A3%9E%E7%A2%A7%E7%90%83/"
            "voice-samples/default/upload",
        ),
        (
            "GET",
            "/api/v1/projects/project%2Fone/characters/%E9%A3%9E%E7%A2%A7%E7%90%83/voice-samples",
        ),
    ]


def test_import_readback_hash_mismatch_is_persistence_error(tmp_path, monkeypatch):
    plugin = _load_plugin_module()
    source = tmp_path / "voice.wav"
    source.write_bytes(b"source")
    monkeypatch.setenv("DRAMACLAW_ASSET_IMPORT_ROOTS", str(tmp_path))

    monkeypatch.setattr(
        plugin,
        "_request_multipart",
        lambda *_args, **_kwargs: {
            "ok": True,
            "status_code": 201,
            "data": {"path": "voices/default.wav"},
        },
    )
    monkeypatch.setattr(
        plugin,
        "_request",
        lambda *_args, **_kwargs: _response(_slots(default_hash="different")),
    )

    result = plugin._handle_import_character_voice(
        {"project_id": "p1", "name": "咕嘎", "local_path": str(source)}
    )

    assert result["ok"] is False
    assert result["error_kind"] == "persistence_mismatch"
    assert result["phase"] == "readback"
    assert result["stored_matches_source"] is False
    assert result["isError"] is True
    assert result["readback"]["status_code"] == 200


def test_invalid_slot_is_validation_error_without_http(tmp_path, monkeypatch):
    plugin = _load_plugin_module()
    source = tmp_path / "voice.wav"
    source.write_bytes(b"voice")
    monkeypatch.setenv("DRAMACLAW_ASSET_IMPORT_ROOTS", str(tmp_path))

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("invalid input must not send HTTP")

    monkeypatch.setattr(plugin, "_request_multipart", fail_if_called)
    monkeypatch.setattr(plugin, "_request", fail_if_called)

    result = plugin._handle_import_character_voice(
        {
            "project_id": "p1",
            "name": "飞碧球",
            "local_path": str(source),
            "slot": "invalid",
        }
    )

    assert result["ok"] is False
    assert result["error_kind"] == "validation_error"
    assert result["phase"] == "validation"
    assert result["isError"] is True


def test_youth_override_does_not_make_empty_default_ready(tmp_path, monkeypatch):
    plugin = _load_plugin_module()
    source = tmp_path / "youth.wav"
    source_bytes = b"youth-voice"
    source.write_bytes(source_bytes)
    monkeypatch.setenv("DRAMACLAW_ASSET_IMPORT_ROOTS", str(tmp_path))
    source_hash = hashlib.sha256(source_bytes).hexdigest()

    monkeypatch.setattr(
        plugin,
        "_request_multipart",
        lambda *_args, **_kwargs: {
            "ok": True,
            "status_code": 201,
            "data": {"path": "voices/youth.wav", "sha256": source_hash},
        },
    )
    monkeypatch.setattr(
        plugin,
        "_request",
        lambda *_args, **_kwargs: _response(_slots(youth_hash=source_hash)),
    )

    result = plugin._handle_import_character_voice(
        {
            "project_id": "p1",
            "name": "飞碧球",
            "local_path": str(source),
            "slot": "youth",
        }
    )

    assert result["ok"] is True
    assert result["requested_slot"] == "youth"
    assert result["stored_matches_source"] is True
    assert result["verification"]["required_ready"] is False
    assert result["warning"]


def test_explicit_project_conflicts_with_default_project(monkeypatch):
    plugin = _load_plugin_module()
    monkeypatch.setenv("DRAMACLAW_PROJECT_ID", "wrong-default")
    captured: list[str] = []

    def fake_request(method, path, **_kwargs):
        captured.append(path)
        return _response(_slots())

    monkeypatch.setattr(plugin, "_request", fake_request)
    result = plugin._handle_verify_character_voice(
        {"project_id": "explicit-project", "name": "飞碧球"}
    )

    assert result["ok"] is False
    assert result["error_kind"] == "validation_error"
    assert "project_id conflict" in result["error"]
    assert captured == []


def test_project_id_does_not_fall_back_to_environment(monkeypatch):
    plugin = _load_plugin_module()
    monkeypatch.setenv("DRAMACLAW_PROJECT_ID", "legacy-project")
    captured: list[str] = []

    def fake_request(method, path, **_kwargs):
        captured.append(path)
        return _response(_slots())

    monkeypatch.setattr(plugin, "_request", fake_request)
    result = plugin._handle_verify_character_voice({"name": "飞碧球"})

    assert result["ok"] is False
    assert result["error_kind"] == "validation_error"
    assert "pass the target project ID explicitly" in result["error"]
    assert captured == []


def test_canvas_get_returns_project_identity_before_canvas(monkeypatch):
    plugin = _load_plugin_module()
    calls: list[str] = []

    def fake_request(method, path, **_kwargs):
        calls.append(path)
        if path == "/api/v1/projects/current-project":
            return {
                "ok": True,
                "status_code": 200,
                "data": {"project_id": "current-project", "name": "当前项目"},
            }
        return {"ok": True, "status_code": 200, "data": {"canvas_id": "canvas-1"}}

    monkeypatch.setattr(plugin, "_request", fake_request)
    result = plugin._handle_get(
        {
            "project_id": "current-project",
            "path": "/api/v1/projects/current-project/freezone/canvases/canvas-1",
        }
    )

    assert calls == [
        "/api/v1/projects/current-project",
        "/api/v1/projects/current-project/freezone/canvases/canvas-1",
    ]
    assert result["project_context"] == {
        "project_id": "current-project",
        "project_name": "当前项目",
    }


def test_project_scoped_tool_schemas_require_project_id():
    plugin = _load_plugin_module()

    for name, schema, _handler in plugin.TOOLS:
        properties = schema["parameters"]["properties"]
        assert "project_id" in properties, name
        assert "project_id" in schema["parameters"]["required"], name
        assert "DRAMACLAW_PROJECT_ID" not in properties["project_id"].get("description", "")


@pytest.mark.parametrize(
    ("response", "expected_kind"),
    [
        ({"ok": False, "error": "network_error: refused"}, "transport_error"),
        ({"ok": False, "status_code": 503, "error": "unavailable"}, "http_error"),
        (
            {
                "ok": False,
                "status_code": 200,
                "code": "voice_prereq_required",
                "error": "default voice missing",
            },
            "prerequisite_missing",
        ),
    ],
)
def test_verify_error_taxonomy(response, expected_kind, monkeypatch):
    plugin = _load_plugin_module()
    monkeypatch.setattr(plugin, "_request", lambda *_args, **_kwargs: response)

    result = plugin._handle_verify_character_voice(
        {"project_id": "p1", "name": "飞碧球"}
    )

    assert result["ok"] is False
    assert result["error_kind"] == expected_kind
    assert result["isError"] is True
    assert result["ui_verification"]["verified"] is False


def test_verify_malformed_success_is_protocol_error(monkeypatch):
    plugin = _load_plugin_module()
    monkeypatch.setattr(
        plugin,
        "_request",
        lambda *_args, **_kwargs: {"ok": True, "status_code": 200, "data": {}},
    )

    result = plugin._handle_verify_character_voice(
        {"project_id": "p1", "name": "飞碧球"}
    )

    assert result["ok"] is False
    assert result["error_kind"] == "protocol_error"
    assert result["phase"] == "normalize"


def test_audio_reference_empty_result_is_not_fabricated_success(monkeypatch):
    plugin = _load_plugin_module()
    monkeypatch.setattr(
        plugin,
        "_request",
        lambda *_args, **_kwargs: {
            "ok": True,
            "status_code": 200,
            "data": {
                "characters": [
                    {
                        "character_name": "飞碧球",
                        "is_main": True,
                        "age_group": "youth",
                        "available_count": 0,
                        "voices": [{"scope": "character_default", "path": ""}],
                        "identities": [],
                    }
                ],
                "narrator": {},
                "available": [],
            },
        },
    )

    result = plugin._handle_verify_character_audio_references(
        {"project_id": "p1", "name": "飞碧球"}
    )

    assert result["ok"] is False
    assert result["error_kind"] == "prerequisite_missing"
    assert result["available_count"] == 0
    assert result["characters"][0]["effective_ready"] is False
    assert result["isError"] is True
    assert result["ui_verification"]["verified"] is False


def test_bridge_text_and_structured_content_have_same_voice_state(monkeypatch):
    bridge_path = Path(__file__).resolve().parents[2] / "apps" / "dramaclaw-mcp-bridge" / "dramaclaw_mcp.py"
    spec = importlib.util.spec_from_file_location("test_dramaclaw_mcp_bridge", bridge_path)
    assert spec is not None and spec.loader is not None
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)

    payload = {
        "ok": False,
        "error_kind": "transport_error",
        "phase": "verify",
        "error": "network_error: refused",
        "data": {},
        "ui_verification": dict(bridge.VOICE_UI_VERIFICATION),
        "isError": True,
    }
    original = bridge.TOOLS["dramaclaw_verify_character_voice"]
    monkeypatch.setitem(
        bridge.TOOLS,
        "dramaclaw_verify_character_voice",
        (original[0], lambda _args: json.dumps(payload)),
    )

    result = asyncio.run(
        bridge.call_tool("dramaclaw_verify_character_voice", {"name": "飞碧球"})
    )
    text_payload = json.loads(result.content[0].text)

    assert result.isError is True
    assert result.structuredContent == payload
    assert text_payload == result.structuredContent

    unknown = asyncio.run(bridge.call_tool("dramaclaw_missing_tool", {}))
    assert unknown.isError is True
    assert unknown.structuredContent["error_kind"] == "protocol_error"
    assert json.loads(unknown.content[0].text) == unknown.structuredContent

    monkeypatch.setitem(
        bridge.TOOLS,
        "dramaclaw_verify_character_voice",
        (original[0], lambda _args: "not-json"),
    )
    malformed = asyncio.run(
        bridge.call_tool("dramaclaw_verify_character_voice", {"name": "飞碧球"})
    )
    assert malformed.isError is True
    assert malformed.structuredContent["error_kind"] == "protocol_error"
    assert json.loads(malformed.content[0].text) == malformed.structuredContent
