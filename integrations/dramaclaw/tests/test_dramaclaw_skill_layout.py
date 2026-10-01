"""Regression tests for the grouped DramaClaw Skill layout."""

from __future__ import annotations

import re
from pathlib import Path

import yaml


SKILLS_ROOT = Path(__file__).resolve().parents[1] / ".hermes" / "skills" / "dramaclaw"
EXPECTED_CHILD_SKILLS = {
    "dramaclaw--api",
    "dramaclaw--asset-ingress",
    "dramaclaw--async",
    "dramaclaw--delivery",
    "dramaclaw--interaction",
    "dramaclaw--pipeline",
    "dramaclaw--read",
    "dramaclaw--routing",
    "dramaclaw--runtime-guardrails",
    "dramaclaw--update",
}
LOCAL_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
VALID_NAME_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def _frontmatter(path: Path) -> dict[str, object]:
    lines = path.read_text(encoding="utf-8").splitlines()
    assert lines and lines[0].strip() == "---", path
    end = next(index for index, line in enumerate(lines[1:], 1) if line.strip() == "---")
    metadata = yaml.safe_load("\n".join(lines[1:end]))
    assert isinstance(metadata, dict), path
    return metadata


def test_grouped_dramaclaw_children_are_real_skills():
    assert (SKILLS_ROOT / "SKILL.md").is_file()
    assert not (SKILLS_ROOT / "modules").exists()

    children = {
        path.name
        for path in SKILLS_ROOT.iterdir()
        if path.is_dir() and path.name.startswith("dramaclaw--")
    }
    assert children == EXPECTED_CHILD_SKILLS

    root_metadata = _frontmatter(SKILLS_ROOT / "SKILL.md")
    assert root_metadata["name"] == "dramaclaw"
    assert isinstance(root_metadata["description"], str)
    assert root_metadata["description"].strip()

    for directory_name in sorted(EXPECTED_CHILD_SKILLS):
        skill_file = SKILLS_ROOT / directory_name / "SKILL.md"
        metadata = _frontmatter(skill_file)
        capability = directory_name.removeprefix("dramaclaw--")
        assert metadata["name"] == f"dramaclaw-{capability}"
        assert VALID_NAME_RE.fullmatch(str(metadata["name"]))
        assert isinstance(metadata["description"], str)
        assert metadata["description"].strip()


def test_all_grouped_skill_markdown_links_resolve():
    missing: list[str] = []
    for markdown in SKILLS_ROOT.rglob("*.md"):
        for raw_target in LOCAL_LINK_RE.findall(markdown.read_text(encoding="utf-8")):
            target = raw_target.split("#", 1)[0].strip().strip("<>")
            if not target or "://" in target or target.startswith("mailto:"):
                continue
            if not (markdown.parent / target).resolve().exists():
                missing.append(f"{markdown}: {raw_target}")
    assert not missing, "\n".join(missing)
