"""Compatibility entry point for the canonical DramaClaw MCP app.

The implementation lives in ``apps/dramaclaw-mcp-bridge``.  Keep this module
so existing ``python -m novelvideo.chat.dramaclaw_mcp`` integrations continue
to launch the same server while the repository organizes the standalone app
under ``apps``.
"""

from __future__ import annotations

import importlib.util
import runpy
from pathlib import Path
from types import ModuleType


_CANONICAL_MODULE: ModuleType | None = None


def _canonical_app() -> Path:
    for candidate in Path(__file__).resolve().parents:
        app_path = candidate / "apps" / "dramaclaw-mcp-bridge" / "dramaclaw_mcp.py"
        if app_path.is_file():
            return app_path
    raise RuntimeError("cannot locate apps/dramaclaw-mcp-bridge/dramaclaw_mcp.py")


def _canonical_module() -> ModuleType:
    global _CANONICAL_MODULE
    if _CANONICAL_MODULE is not None:
        return _CANONICAL_MODULE
    app_path = _canonical_app()
    spec = importlib.util.spec_from_file_location(
        "_dramaclaw_canonical_mcp_bridge_compat",
        app_path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load canonical MCP bridge from {app_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _CANONICAL_MODULE = module
    return module


def __getattr__(name: str):
    """Preserve legacy imports while keeping one canonical implementation."""

    return getattr(_canonical_module(), name)


def main() -> None:
    runpy.run_path(str(_canonical_app()), run_name="__main__")


if __name__ == "__main__":
    main()
