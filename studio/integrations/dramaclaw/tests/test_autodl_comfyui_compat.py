from __future__ import annotations

import importlib.util
import json
import sys
import uuid
from pathlib import Path


_BRIDGE_PATH = (
    Path(__file__).resolve().parents[1]
    / "apps"
    / "dramaclaw-mcp-bridge"
    / "autodl_comfyui_compat.py"
)


def _load_bridge(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://relay.example")
    name = f"test_autodl_compat_{uuid.uuid4().hex}"
    spec = importlib.util.spec_from_file_location(name, _BRIDGE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def test_h3_references_include_audio_and_select_image_audio_workflow(monkeypatch, tmp_path):
    bridge = _load_bridge(monkeypatch, tmp_path)
    workflow = {
        "1": {"class_type": "LoadImage", "inputs": {"image": "character.png"}},
        "2": {"class_type": "LoadAudio", "inputs": {"audio": "dialogue.wav"}},
        "3": {
            "class_type": "MiniMaxH3ReferenceToVideo",
            "inputs": {
                "ref_images.ref_image_0": ["1", 0],
                "ref_audios.ref_audio_0": ["2", 0],
            },
        },
    }

    images = bridge.referenced_image_names(workflow, workflow["3"])
    audios = bridge.referenced_audio_names(workflow, workflow["3"])
    workflow_id, payload = bridge.build_autodl_payload(
        prompt="",
        resolution="768p竖",
        duration=6,
        image_urls=[bridge.media_url(images[0])],
        audio_urls=[bridge.media_url(audios[0])],
    )

    assert images == ["character.png"]
    assert audios == ["dialogue.wav"]
    assert workflow_id == "minimax_h3_image_audio_to_video"
    assert payload == {
        "ref_image_0": "http://relay.example/media/character.png",
        "ref_audio_0": "http://relay.example/media/dialogue.wav",
        "resolution": "768p竖",
        "audio_duration": 6,
    }


def test_h3_multi_reference_payload_keeps_all_reference_slots(monkeypatch, tmp_path):
    bridge = _load_bridge(monkeypatch, tmp_path)
    workflow_id, payload = bridge.build_autodl_payload(
        prompt="人物根据参考音频说话",
        resolution="480p竖",
        duration=5,
        image_urls=["img-0", "img-1"],
        audio_urls=["aud-0", "aud-1"],
    )

    assert workflow_id == "minimax_h3_image_audio_to_video_v2_15s"
    assert payload == {
        "prompt": "人物根据参考音频说话",
        "duration": 5,
        "resolution": "480p竖",
        "ref_image_0": "img-0",
        "ref_image_1": "img-1",
        "ref_audio_0": "aud-0",
        "ref_audio_1": "aud-1",
    }


def test_receipt_keeps_workflow_task_and_result(monkeypatch, tmp_path):
    bridge = _load_bridge(monkeypatch, tmp_path)
    task = {
        "autodl_task_id": "task-123",
        "workflow_id": "minimax_h3_image_audio_to_video",
        "created_at": 1.0,
        "status": "submitted",
        "payload": {"ref_image_0": "image-url", "ref_audio_0": "audio-url"},
        "submit_response": {"code": "Success", "data": {"task_id": "task-123"}},
    }

    bridge._persist_receipt(task)
    task.update(
        status="completed",
        result_response={"code": "Success", "data": {"status": "SUCCESS"}},
        result_url="https://result.example/video.mp4",
    )
    bridge._persist_receipt(task)

    receipt = json.loads((bridge.RECEIPTS_DIR / "task-123.json").read_text(encoding="utf-8"))
    assert receipt["workflow_id"] == "minimax_h3_image_audio_to_video"
    assert receipt["autodl_task_id"] == "task-123"
    assert receipt["status"] == "completed"
    assert receipt["result_response"]["data"]["status"] == "SUCCESS"
    assert receipt["result_url"] == "https://result.example/video.mp4"
