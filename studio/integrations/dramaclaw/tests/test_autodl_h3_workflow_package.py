import importlib.util
import json
from pathlib import Path
import shutil


PACKAGE_ROOT = (
    Path(__file__).resolve().parents[1]
    / "review-packages"
    / "autodl-h3-workflow-registry"
)


def _read_manifest() -> dict:
    return json.loads((PACKAGE_ROOT / "manifest.json").read_text(encoding="utf-8"))


def _load_validator():
    path = PACKAGE_ROOT / "validate_workflow_package.py"
    spec = importlib.util.spec_from_file_location("autodl_h3_validator", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_manifest_registers_independent_h3_workflow_files() -> None:
    manifest = _read_manifest()
    entries = manifest["workflows"]

    assert {entry["workflow_id"] for entry in entries} == {
        "minimax_h3_zm_u24",
        "minimax_h3_zm_u08",
        "minimax_h3_image_audio_to_video_v2_15s",
        "minimax_h3_image_audio_to_video",
    }
    assert len(entries) == 4
    assert len({entry["key"] for entry in entries}) == len(entries)
    assert len({entry["workflow_id"] for entry in entries}) == len(entries)

    for entry in entries:
        path = PACKAGE_ROOT / entry["file"]
        assert path.is_file(), entry["file"]
        workflow = json.loads(path.read_text(encoding="utf-8"))
        assert workflow["workflow_key"] == entry["key"]
        assert workflow["workflow_id"] == entry["workflow_id"]


def test_multimodal_15s_declares_h3_reference_limits() -> None:
    manifest = _read_manifest()
    entry = next(
        item for item in manifest["workflows"] if item["key"] == "h3-ref2va-audio-15s"
    )
    workflow = json.loads((PACKAGE_ROOT / entry["file"]).read_text(encoding="utf-8"))

    assert workflow["status"] == "active"
    assert workflow["request_schema"]["properties"]["duration"]["max"] == 15
    assert workflow["canvas_binding"]["max_reference_images"] == 9
    assert workflow["canvas_binding"]["max_reference_audios"] == 3


def test_zm_variants_use_the_verified_multimodal_schema() -> None:
    manifest = _read_manifest()

    for key in ("h3-zm-u24", "h3-zm-u08"):
        entry = next(item for item in manifest["workflows"] if item["key"] == key)
        workflow = json.loads((PACKAGE_ROOT / entry["file"]).read_text(encoding="utf-8"))
        properties = workflow["request_schema"]["properties"]

        assert workflow["status"] == "active"
        assert workflow["verification"]["status"] == "verified"
        assert workflow["request_schema"]["required"] == ["prompt", "ref_image_0"]
        assert properties["duration"]["max"] == 15
        assert "480p(1:1)" in properties["resolution"]["values"]
        assert workflow["canvas_binding"]["max_reference_images"] == 9
        assert workflow["canvas_binding"]["max_reference_audios"] == 3


def test_single_image_audio_uses_the_official_sync_schema() -> None:
    manifest = _read_manifest()
    entry = next(item for item in manifest["workflows"] if item["key"] == "h3-single-image-audio")
    workflow = json.loads((PACKAGE_ROOT / entry["file"]).read_text(encoding="utf-8"))
    properties = workflow["request_schema"]["properties"]

    assert workflow["status"] == "active"
    assert workflow["request_schema"]["required"] == ["ref_image_0", "ref_audio_0"]
    assert "prompt" not in properties
    assert properties["audio_duration"]["max"] == 15
    assert "1080p横" in properties["resolution"]["values"]


def test_all_selected_workflows_are_verified_and_active() -> None:
    manifest = _read_manifest()

    assert all(entry["status"] == "active" for entry in manifest["workflows"])
    assert all(
        json.loads((PACKAGE_ROOT / entry["file"]).read_text(encoding="utf-8"))["verification"]["status"]
        == "verified"
        for entry in manifest["workflows"]
    )


def test_offline_validator_accepts_the_review_package() -> None:
    validator = _load_validator()

    assert validator.validate_package(PACKAGE_ROOT) == []


def test_offline_validator_rejects_duplicate_workflow_ids(tmp_path: Path) -> None:
    validator = _load_validator()
    package_copy = tmp_path / "package"
    shutil.copytree(PACKAGE_ROOT, package_copy)
    manifest_path = package_copy / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["workflows"][1]["workflow_id"] = manifest["workflows"][0]["workflow_id"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    errors = validator.validate_package(package_copy)

    assert any("duplicate workflow_id" in error for error in errors)


def test_offline_validator_rejects_missing_workflow_file(tmp_path: Path) -> None:
    validator = _load_validator()
    package_copy = tmp_path / "package"
    shutil.copytree(PACKAGE_ROOT, package_copy)
    manifest_path = package_copy / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["workflows"][0]["file"] = "workflows/not-found.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    errors = validator.validate_package(package_copy)

    assert any("missing JSON file" in error for error in errors)


def test_offline_validator_rejects_unregistered_workflow_file(tmp_path: Path) -> None:
    validator = _load_validator()
    package_copy = tmp_path / "package"
    shutil.copytree(PACKAGE_ROOT, package_copy)
    (package_copy / "workflows" / "extra.json").write_text("{}", encoding="utf-8")

    errors = validator.validate_package(package_copy)

    assert any("unregistered workflow file" in error for error in errors)


def test_offline_validator_rejects_invalid_status(tmp_path: Path) -> None:
    validator = _load_validator()
    package_copy = tmp_path / "package"
    shutil.copytree(PACKAGE_ROOT, package_copy)
    manifest_path = package_copy / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["workflows"][0]["status"] = "experimental"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    errors = validator.validate_package(package_copy)

    assert any("status is invalid" in error for error in errors)


def test_offline_validator_rejects_reference_slot_overflow(tmp_path: Path) -> None:
    validator = _load_validator()
    package_copy = tmp_path / "package"
    shutil.copytree(PACKAGE_ROOT, package_copy)
    workflow_path = package_copy / "workflows" / "h3-ref2va-audio-15s.json"
    workflow = json.loads(workflow_path.read_text(encoding="utf-8"))
    workflow["canvas_binding"]["max_reference_images"] = 10
    workflow_path.write_text(json.dumps(workflow), encoding="utf-8")

    errors = validator.validate_package(package_copy)

    assert any("max_reference_images" in error for error in errors)
