"""Real subprocess lifecycle checks for the canonical DramaClaw MCP bridge."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


REPO_ROOT = Path(__file__).resolve().parents[2]
BRIDGE = REPO_ROOT / "apps" / "dramaclaw-mcp-bridge" / "dramaclaw_mcp.py"
VOICE_TOOLS = {
    "dramaclaw_import_character_voice",
    "dramaclaw_verify_character_voice",
    "dramaclaw_verify_character_audio_references",
}


async def _tool_names(parameters: StdioServerParameters) -> set[str]:
    async with stdio_client(parameters) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            result = await session.list_tools()
    return {tool.name for tool in result.tools}


@pytest.mark.asyncio
async def test_canonical_stdio_initialize_list_and_read_only_call():
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(BRIDGE)],
        cwd=REPO_ROOT,
        env={
            "DRAMACLAW_API_URL": "http://127.0.0.1:1",
            "DRAMACLAW_CE_OWNER": "1",
            "DRAMACLAW_API_TIMEOUT_SECONDS": "30",
        },
    )

    async with stdio_client(params) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            initialized = await session.initialize()
            tools = await session.list_tools()
            names = {tool.name for tool in tools.tools}
            result = await session.call_tool(
                "dramaclaw_verify_character_voice",
                {"project_id": "contract-project", "name": "飞碧球"},
            )

    assert initialized.serverInfo.name == "dramaclaw"
    assert VOICE_TOOLS <= names
    assert result.isError is True
    assert result.structuredContent["ok"] is False
    assert result.structuredContent["error_kind"] == "transport_error"
    assert json.loads(result.content[0].text) == result.structuredContent


@pytest.mark.asyncio
async def test_legacy_entry_has_the_same_tool_list_as_canonical_entry():
    common_env = {
        "DRAMACLAW_API_URL": "http://127.0.0.1:1",
        "DRAMACLAW_CE_OWNER": "1",
    }
    canonical = StdioServerParameters(
        command=sys.executable,
        args=[str(BRIDGE)],
        cwd=REPO_ROOT,
        env=common_env,
    )
    legacy = StdioServerParameters(
        command=sys.executable,
        args=["-m", "novelvideo.chat.dramaclaw_mcp"],
        cwd=REPO_ROOT,
        env={**common_env, "PYTHONPATH": str(REPO_ROOT / "src")},
    )

    assert await _tool_names(canonical) == await _tool_names(legacy)
