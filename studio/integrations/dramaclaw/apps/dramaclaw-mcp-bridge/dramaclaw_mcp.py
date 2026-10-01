"""Canonical stdio MCP bridge for DramaClaw.

This app exposes the DramaClaw toolset to MCP-speaking clients.  The business
tool definitions remain in ``.hermes/plugins/dramaclaw`` so Hermes and MCP use
the same API contracts, authorization rules, and read-back verification.

Run from the repository root with::

    uv run python apps/dramaclaw-mcp-bridge/dramaclaw_mcp.py
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import types as py_types
from pathlib import Path
from typing import Any

from mcp import types
from mcp.server import Server
from mcp.server.stdio import stdio_server


def _repo_root() -> Path:
    """Find the checkout containing the shared Hermes plugin."""

    for candidate in Path(__file__).resolve().parents:
        plugin_path = candidate / ".hermes" / "plugins" / "dramaclaw" / "__init__.py"
        if plugin_path.is_file():
            return candidate
    raise RuntimeError("cannot locate the DramaClaw repository root")


def _install_hermes_registry_shim() -> None:
    if "tools.registry" in sys.modules:
        return

    tools_pkg = py_types.ModuleType("tools")
    registry = py_types.ModuleType("tools.registry")

    def tool_result(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False)

    def tool_error(message: Any) -> str:
        return json.dumps({"ok": False, "error": str(message)}, ensure_ascii=False)

    registry.tool_result = tool_result
    registry.tool_error = tool_error
    tools_pkg.registry = registry
    sys.modules.setdefault("tools", tools_pkg)
    sys.modules["tools.registry"] = registry


def _load_dramaclaw_plugin() -> Any:
    _install_hermes_registry_shim()
    plugin_path = _repo_root() / ".hermes" / "plugins" / "dramaclaw" / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        "_dramaclaw_hermes_plugin_for_mcp",
        plugin_path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load DramaClaw plugin from {plugin_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _tool_index(plugin: Any) -> dict[str, tuple[dict[str, Any], Any]]:
    index: dict[str, tuple[dict[str, Any], Any]] = {}
    for entry in getattr(plugin, "TOOLS", ()):
        if not isinstance(entry, tuple) or len(entry) != 3:
            continue
        name, schema, handler = entry
        if isinstance(name, str) and isinstance(schema, dict) and callable(handler):
            index[name] = (schema, handler)
    return index


PLUGIN = _load_dramaclaw_plugin()
TOOLS = _tool_index(PLUGIN)
SERVER = Server("dramaclaw", version="0.1.0")
VOICE_TOOL_NAMES = frozenset(
    {
        "dramaclaw_import_character_voice",
        "dramaclaw_verify_character_voice",
        "dramaclaw_verify_character_audio_references",
    }
)
VOICE_UI_VERIFICATION = {
    "verified": False,
    "reason": "MCP verifies DramaClaw backend state only",
}


@SERVER.list_tools()
async def list_tools() -> list[types.Tool]:
    result: list[types.Tool] = []
    for name, (schema, _handler) in sorted(TOOLS.items()):
        parameters = schema.get("parameters") if isinstance(schema, dict) else None
        result.append(
            types.Tool(
                name=name,
                description=str(schema.get("description") or ""),
                inputSchema=parameters if isinstance(parameters, dict) else {"type": "object"},
            )
        )
    return result


def _voice_protocol_error(message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "error_kind": "protocol_error",
        "phase": "normalize",
        "error": message,
        "data": {},
        "ui_verification": dict(VOICE_UI_VERIFICATION),
        "isError": True,
    }


def _normalize_voice_handler_result(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return _voice_protocol_error("voice tool returned non-JSON text")
        if isinstance(parsed, dict):
            return parsed
    return _voice_protocol_error("voice tool returned a non-object result")


@SERVER.call_tool(validate_input=True)
async def call_tool(
    name: str,
    arguments: dict[str, Any],
) -> types.CallToolResult | list[types.TextContent]:
    item = TOOLS.get(name)
    if item is None:
        payload = _voice_protocol_error(f"unknown DramaClaw tool: {name}")
        serialized = json.dumps(payload, ensure_ascii=False)
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=serialized)],
            structuredContent=payload,
            isError=True,
        )
    _schema, handler = item
    text = handler(arguments or {})
    if name in VOICE_TOOL_NAMES:
        payload = _normalize_voice_handler_result(text)
        serialized = json.dumps(payload, ensure_ascii=False)
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=serialized)],
            structuredContent=payload,
            isError=payload.get("ok") is False or payload.get("isError") is True,
        )
    return [types.TextContent(type="text", text=str(text or ""))]


async def _main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await SERVER.run(
            read_stream,
            write_stream,
            SERVER.create_initialization_options(),
        )


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
