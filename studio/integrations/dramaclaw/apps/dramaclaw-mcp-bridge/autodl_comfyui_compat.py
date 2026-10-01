"""Small native-ComfyUI compatibility bridge for AutoDL's wrapped H3 API.

DramaClaw's ComfyUI adaptor speaks the native ComfyUI protocol
(`/upload/image`, `/prompt`, `/history/<id>`, `/view`).  AutoDL exposes the
same workflows through a different JSON API.  This bridge keeps the native
surface local and translates only the H3 inputs required by the configured
workflow to AutoDL's public workflow API.

The bridge is intentionally dependency-light apart from ``requests``.  It is
not a general workflow executor: it accepts the API-format workflow emitted
by RelayClaw, extracts prompt/duration/reference images, and delegates the
paid generation to AutoDL.  The public base URL is used only for AutoDL to
fetch uploaded reference images.
"""

from __future__ import annotations

import cgi
import json
import mimetypes
import os
import re
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

import requests


HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8891"))
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
AUTODL_BASE_URL = os.getenv("AUTODL_BASE_URL", "https://autodl.art").rstrip("/")
AUTODL_TOKEN = os.getenv("AUTODL_TOKEN", "").strip()
AUTODL_WORKFLOW_ID = os.getenv(
    "AUTODL_WORKFLOW_ID", "minimax_h3_lightx2v_v5_15s"
).strip()
AUTODL_IMAGE_AUDIO_WORKFLOW_ID = os.getenv(
    "AUTODL_IMAGE_AUDIO_WORKFLOW_ID", "minimax_h3_image_audio_to_video"
).strip()
AUTODL_MULTI_IMAGE_AUDIO_WORKFLOW_ID = os.getenv(
    "AUTODL_MULTI_IMAGE_AUDIO_WORKFLOW_ID",
    "minimax_h3_image_audio_to_video_v2_15s",
).strip()
AUTODL_AUDIO_DURATION_FIELD = os.getenv(
    "AUTODL_AUDIO_DURATION_FIELD", "audio_duration"
).strip()
STORAGE_DIR = Path(
    os.getenv(
        "STORAGE_DIR",
        str(Path(__file__).resolve().parent / "runtime" / "autodl-comfyui-bridge"),
    )
)
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
RECEIPTS_DIR = STORAGE_DIR / "receipts"
RECEIPTS_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(250 * 1024 * 1024)))

TASKS: dict[str, dict[str, Any]] = {}
TASKS_LOCK = threading.Lock()


def json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def safe_filename(value: str) -> str:
    value = Path(value or "relayclaw-input.png").name
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return value or "relayclaw-input.png"


def primitive_value(workflow: dict[str, Any], node_id: str, visited: set[str] | None = None) -> Any:
    """Follow the simple connections used by the shipped H3 workflows."""

    if not node_id:
        return None
    visited = visited or set()
    if node_id in visited:
        return None
    visited.add(node_id)
    node = workflow.get(str(node_id))
    if not isinstance(node, dict):
        return None
    inputs = node.get("inputs") or {}
    class_type = str(node.get("class_type", "")).lower()
    if "value" in inputs and (
        "primitive" in class_type
        or class_type in {"string", "float", "int"}
        or class_type == "comfymathexpression"
    ):
        value = inputs.get("value")
        if value is not None:
            return value
    for key in ("value", "text", "prompt", "duration", "seconds", "length", "frames"):
        value = inputs.get(key)
        if isinstance(value, list) and value:
            nested = primitive_value(workflow, str(value[0]), visited)
            if nested is not None:
                return nested
        elif value is not None and not isinstance(value, (dict, list)):
            return value
    return None


def connected_node_id(value: Any) -> str:
    if isinstance(value, list) and value:
        return str(value[0])
    return ""


def h3_node(workflow: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    for node_id, raw in workflow.items():
        if not isinstance(raw, dict):
            continue
        class_type = str(raw.get("class_type", "")).lower()
        if "minimaxh3" in class_type or "minimax_h3" in class_type:
            return str(node_id), raw
    raise ValueError("workflow has no MiniMax H3 node")


def extract_prompt(workflow: dict[str, Any], node: dict[str, Any]) -> str:
    inputs = node.get("inputs") or {}
    value = inputs.get("prompt")
    if isinstance(value, list) and value:
        resolved = primitive_value(workflow, str(value[0]))
        if resolved is not None:
            return str(resolved).strip()
    if isinstance(value, str):
        return value.strip()
    for raw in workflow.values():
        if not isinstance(raw, dict):
            continue
        class_type = str(raw.get("class_type", "")).lower()
        if "primitivestring" in class_type:
            candidate = (raw.get("inputs") or {}).get("value")
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
    return ""


def extract_duration(workflow: dict[str, Any], node: dict[str, Any]) -> int:
    inputs = node.get("inputs") or {}
    raw = inputs.get("length")
    if isinstance(raw, list) and raw:
        resolved = primitive_value(workflow, str(raw[0]))
        try:
            if resolved is not None:
                return max(1, min(15, int(round(float(resolved)))))
        except (TypeError, ValueError):
            pass
    for raw_node in workflow.values():
        if not isinstance(raw_node, dict):
            continue
        inputs = raw_node.get("inputs") or {}
        meta = raw_node.get("_meta") or {}
        title = str(meta.get("title", "")).lower()
        if "duration" not in title and "duration" not in str(raw_node.get("class_type", "")).lower():
            continue
        value = inputs.get("value")
        if isinstance(value, (int, float)):
            return max(1, min(15, int(round(value))))
    return 6


def direct_number(workflow: dict[str, Any], value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, list) and value:
        resolved = primitive_value(workflow, str(value[0]))
        try:
            return float(resolved)
        except (TypeError, ValueError):
            return None
    return None


def extract_resolution(workflow: dict[str, Any], node: dict[str, Any]) -> str:
    inputs = node.get("inputs") or {}
    width = direct_number(workflow, inputs.get("width"))
    height = direct_number(workflow, inputs.get("height"))
    if width and height:
        tier = "480p" if min(width, height) <= 512 else "768p"
        return f"{tier}{'竖' if height > width else '横'}"
    for raw in workflow.values():
        if not isinstance(raw, dict) or raw.get("class_type") != "ResolutionSelector":
            continue
        ratio = str((raw.get("inputs") or {}).get("aspect_ratio", "")).lower()
        megapixels = (raw.get("inputs") or {}).get("megapixels")
        tier = "480p" if isinstance(megapixels, (int, float)) and megapixels <= 0.25 else "768p"
        if "9:16" in ratio or "portrait" in ratio or "3:4" in ratio:
            return tier + "竖"
        return tier + "横"
    return "768p竖"


def referenced_image_names(workflow: dict[str, Any], node: dict[str, Any]) -> list[str]:
    refs: list[tuple[int, str]] = []
    inputs = node.get("inputs") or {}
    for key, value in inputs.items():
        if key.startswith("ref_images.ref_image_"):
            try:
                index = int(key.rsplit("_", 1)[1])
            except ValueError:
                continue
            loader_id = connected_node_id(value)
            loader = workflow.get(loader_id) or {}
            image = str((loader.get("inputs") or {}).get("image", "")).strip()
            if image:
                refs.append((index, image))
        elif key in {"first_frame", "image"}:
            loader_id = connected_node_id(value)
            loader = workflow.get(loader_id) or {}
            image = str((loader.get("inputs") or {}).get("image", "")).strip()
            if image:
                refs.append((len(refs), image))
    if not refs:
        for node_value in workflow.values():
            if not isinstance(node_value, dict) or node_value.get("class_type") != "LoadImage":
                continue
            image = str((node_value.get("inputs") or {}).get("image", "")).strip()
            if image:
                refs.append((len(refs), image))
    refs.sort(key=lambda item: item[0])
    result: list[str] = []
    for _, name in refs:
        if name not in result:
            result.append(name)
    return result[:9]


def _connected_media_name(
    workflow: dict[str, Any],
    value: Any,
    input_names: tuple[str, ...],
) -> str:
    loader_id = connected_node_id(value)
    if loader_id:
        loader = workflow.get(loader_id) or {}
        loader_inputs = loader.get("inputs") or {}
        for input_name in input_names:
            media = str(loader_inputs.get(input_name, "")).strip()
            if media:
                return media
    if isinstance(value, str):
        return value.strip()
    return ""


def referenced_audio_names(workflow: dict[str, Any], node: dict[str, Any]) -> list[str]:
    """Extract audio references from native H3 API-format connections."""

    refs: list[tuple[int, str]] = []
    inputs = node.get("inputs") or {}
    for key, value in inputs.items():
        if key.startswith("ref_audios.ref_audio_"):
            try:
                index = int(key.rsplit("_", 1)[1])
            except ValueError:
                continue
            audio = _connected_media_name(workflow, value, ("audio", "filename", "file"))
            if audio:
                refs.append((index, audio))
        elif key in {"audio", "reference_audio", "ref_audio"}:
            audio = _connected_media_name(workflow, value, ("audio", "filename", "file"))
            if audio:
                refs.append((len(refs), audio))
    if not refs:
        for node_value in workflow.values():
            if not isinstance(node_value, dict):
                continue
            class_type = str(node_value.get("class_type", "")).lower()
            if "loadaudio" not in class_type:
                continue
            audio = _connected_media_name(
                workflow,
                node_value.get("inputs", {}).get("audio"),
                ("audio", "filename", "file"),
            )
            if audio:
                refs.append((len(refs), audio))
    refs.sort(key=lambda item: item[0])
    result: list[str] = []
    for _, name in refs:
        if name not in result:
            result.append(name)
    return result[:3]


def select_workflow_id(image_names: list[str], audio_names: list[str]) -> str:
    """Select the AutoDL public workflow from the supplied media references."""

    if audio_names and len(image_names) == 1 and len(audio_names) == 1:
        return AUTODL_IMAGE_AUDIO_WORKFLOW_ID
    if audio_names:
        return AUTODL_MULTI_IMAGE_AUDIO_WORKFLOW_ID
    return AUTODL_WORKFLOW_ID


def build_autodl_payload(
    *,
    prompt: str,
    resolution: str,
    duration: int,
    image_urls: list[str],
    audio_urls: list[str],
) -> tuple[str, dict[str, Any]]:
    """Build the flat request body expected by the selected AutoDL workflow."""

    workflow_id = select_workflow_id(image_urls, audio_urls)
    if audio_urls and len(image_urls) == 1 and len(audio_urls) == 1:
        payload: dict[str, Any] = {
            "ref_image_0": image_urls[0],
            "ref_audio_0": audio_urls[0],
            "resolution": resolution,
        }
        payload[AUTODL_AUDIO_DURATION_FIELD or "audio_duration"] = duration
        return workflow_id, payload

    if not prompt:
        raise ValueError("H3 prompt is empty")
    payload = {"prompt": prompt, "duration": duration, "resolution": resolution}
    for index, url in enumerate(image_urls[:9]):
        payload[f"ref_image_{index}"] = url
    for index, url in enumerate(audio_urls[:3]):
        payload[f"ref_audio_{index}"] = url
    return workflow_id, payload


def media_url(filename: str) -> str:
    if not PUBLIC_BASE_URL:
        raise RuntimeError("PUBLIC_BASE_URL is required for AutoDL reference media")
    return PUBLIC_BASE_URL + "/media/" + quote(filename, safe="")


def _receipt_path(task_id: str) -> Path:
    return RECEIPTS_DIR / f"{safe_filename(task_id)}.json"


def _persist_receipt(task: dict[str, Any]) -> None:
    task_id = str(task.get("autodl_task_id") or "").strip()
    if not task_id:
        return
    receipt = {
        "schema_version": "autodl_workflow_receipt.v1",
        "workflow_id": str(task.get("workflow_id") or ""),
        "autodl_task_id": task_id,
        "created_at": task.get("created_at"),
        "status": task.get("status") or "submitted",
        "payload": task.get("payload") or {},
        "submit_response": task.get("submit_response"),
        "result_response": task.get("result_response"),
        "result_url": task.get("result_url") or "",
    }
    path = _receipt_path(task_id)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)
    task["receipt_path"] = str(path)


def autodl_headers() -> dict[str, str]:
    if not AUTODL_TOKEN:
        raise RuntimeError("AUTODL_TOKEN is not configured")
    return {
        "Authorization": AUTODL_TOKEN,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def autodl_result(task_id: str) -> dict[str, Any]:
    response = requests.get(
        f"{AUTODL_BASE_URL}/api/v1/comfyui/comfyui_workflow/result/{quote(task_id, safe='')}",
        headers=autodl_headers(),
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("AutoDL returned a non-object result")
    return payload


def poll_task(task: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    if now - float(task.get("last_poll", 0)) < 1.0 and task.get("last_payload"):
        return task["last_payload"]
    payload = autodl_result(str(task["autodl_task_id"]))
    task["last_poll"] = now
    task["last_payload"] = payload
    task["result_response"] = payload
    data = payload.get("data") or {}
    status = str(data.get("status", "")).upper()
    task["status"] = status.lower() or "unknown"
    if status in {"SUCCESS", "COMPLETED", "SUCCEEDED"}:
        results = data.get("results") or []
        for item in results:
            if isinstance(item, dict) and item.get("url"):
                task["result_url"] = str(item["url"])
                break
    _persist_receipt(task)
    return payload


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "DramaClaw-AutoDL-Compat/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[autodl-compat] " + (fmt % args), flush=True)

    def send_json(self, status: int, value: Any) -> None:
        body = json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "provider": "autodl",
                    "workflow": AUTODL_WORKFLOW_ID,
                    "image_audio_workflow": AUTODL_IMAGE_AUDIO_WORKFLOW_ID,
                    "multi_image_audio_workflow": AUTODL_MULTI_IMAGE_AUDIO_WORKFLOW_ID,
                },
            )
            return
        if parsed.path.startswith("/media/"):
            filename = safe_filename(unquote(parsed.path[len("/media/") :]))
            path = STORAGE_DIR / filename
            if not path.is_file():
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "media_not_found"})
                return
            data = path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mimetypes.guess_type(filename)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=900")
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path.startswith("/history/"):
            task_id = unquote(parsed.path[len("/history/") :]).strip()
            with TASKS_LOCK:
                task = TASKS.get(task_id)
            if task is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "task_not_found"})
                return
            try:
                payload = poll_task(task)
            except Exception as exc:  # noqa: BLE001
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": "autodl_poll_failed", "message": str(exc)[:500]})
                return
            data = payload.get("data") or {}
            status = str(data.get("status", "")).upper()
            if status in {"FAILED", "ERROR"}:
                entry = {"status": {"status_str": "error", "completed": True, "message": str(data.get("message", "AutoDL task failed"))}, "outputs": {}}
            elif task.get("result_url"):
                filename = f"autodl_{task_id}.mp4"
                task["result_filename"] = filename
                entry = {
                    "status": {"status_str": "success", "completed": True},
                    "outputs": {"autodl": {"videos": [{"filename": filename, "subfolder": "", "type": "output"}]}},
                }
            else:
                entry = {"status": {"status_str": "running", "completed": False}, "outputs": {}}
            entry["metadata"] = {
                "workflow_id": task.get("workflow_id") or "",
                "autodl_task_id": task.get("autodl_task_id") or task_id,
                "receipt_path": task.get("receipt_path") or "",
            }
            self.send_json(HTTPStatus.OK, {task_id: entry})
            return
        if parsed.path == "/view":
            filename = parse_qs(parsed.query).get("filename", [""])[0]
            with TASKS_LOCK:
                task = next((item for item in TASKS.values() if item.get("result_filename") == filename), None)
            if task is None or not task.get("result_url"):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "result_not_ready"})
                return
            try:
                response = requests.get(str(task["result_url"]), timeout=180, stream=True)
                response.raise_for_status()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", response.headers.get("Content-Type", "video/mp4"))
                if response.headers.get("Content-Length"):
                    self.send_header("Content-Length", response.headers["Content-Length"])
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        self.wfile.write(chunk)
            except Exception as exc:  # noqa: BLE001
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": "result_fetch_failed", "message": str(exc)[:500]})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in {"/upload/image", "/upload/audio"}:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_UPLOAD_BYTES:
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "upload_too_large"})
                return
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                },
            )
            field_name = "audio" if parsed.path == "/upload/audio" else "image"
            item = form[field_name] if field_name in form else None
            if item is None and "file" in form:
                item = form["file"]
            if isinstance(item, list):
                item = item[0]
            if item is None or not getattr(item, "file", None):
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": f"{field_name}_field_required"})
                return
            fallback = "relayclaw-input.wav" if field_name == "audio" else "relayclaw-input.png"
            name = f"{uuid.uuid4().hex}_{safe_filename(getattr(item, 'filename', fallback))}"
            data = item.file.read(MAX_UPLOAD_BYTES + 1)
            if len(data) > MAX_UPLOAD_BYTES:
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "upload_too_large"})
                return
            (STORAGE_DIR / name).write_bytes(data)
            self.send_json(HTTPStatus.OK, {"name": name, "subfolder": "", "type": "input"})
            return
        if parsed.path == "/prompt":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length))
                workflow = body.get("prompt") or {}
                if not isinstance(workflow, dict):
                    raise ValueError("prompt must be an object")
                _, h3 = h3_node(workflow)
                prompt = extract_prompt(workflow, h3)
                image_names = referenced_image_names(workflow, h3)
                audio_names = referenced_audio_names(workflow, h3)
                image_urls: list[str] = []
                audio_urls: list[str] = []
                for filename in image_names:
                    if not (STORAGE_DIR / safe_filename(filename)).is_file():
                        raise ValueError(f"uploaded reference is missing: {filename}")
                    image_urls.append(media_url(safe_filename(filename)))
                for filename in audio_names:
                    if not (STORAGE_DIR / safe_filename(filename)).is_file():
                        raise ValueError(f"uploaded reference is missing: {filename}")
                    audio_urls.append(media_url(safe_filename(filename)))
                if audio_urls and not image_urls:
                    raise ValueError("H3 audio sync requires ref_image_0")
                if not prompt and not audio_urls:
                    raise ValueError("H3 prompt is empty")
                duration = extract_duration(workflow, h3)
                resolution = extract_resolution(workflow, h3)
                workflow_id, payload = build_autodl_payload(
                    prompt=prompt,
                    resolution=resolution,
                    duration=duration,
                    image_urls=image_urls,
                    audio_urls=audio_urls,
                )
                response = requests.post(
                    f"{AUTODL_BASE_URL}/api/v1/comfyui/comfyui_workflow/{quote(workflow_id, safe='')}",
                    headers=autodl_headers(),
                    json=payload,
                    timeout=120,
                )
                response.raise_for_status()
                result = response.json()
                data = result.get("data") or {}
                task_id = str(data.get("task_id", "")).strip()
                if str(result.get("code", "")).lower() != "success" or not task_id:
                    raise RuntimeError(f"AutoDL submit rejected: {response.text[:600]}")
                task = {
                    "autodl_task_id": task_id,
                    "workflow_id": workflow_id,
                    "created_at": time.time(),
                    "status": "submitted",
                    "payload": payload,
                    "submit_response": result,
                }
                with TASKS_LOCK:
                    TASKS[task_id] = task
                _persist_receipt(task)
                print(
                    f"[autodl-compat] submitted task={task_id} workflow={workflow_id} "
                    f"images={len(image_urls)} audios={len(audio_urls)} resolution={resolution}",
                    flush=True,
                )
                self.send_json(
                    HTTPStatus.OK,
                    {
                        "prompt_id": task_id,
                        "number": 0,
                        "node_errors": {},
                        "metadata": {
                            "workflow_id": workflow_id,
                            "autodl_task_id": task_id,
                            "receipt_path": task.get("receipt_path") or "",
                        },
                    },
                )
            except Exception as exc:  # noqa: BLE001
                print(f"[autodl-compat] submit failed: {exc}", flush=True)
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": {"message": str(exc)[:1000]}})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})


def main() -> None:
    if not AUTODL_TOKEN:
        raise SystemExit("AUTODL_TOKEN is required")
    if not PUBLIC_BASE_URL:
        raise SystemExit("PUBLIC_BASE_URL is required")
    server = ThreadingHTTPServer((HOST, PORT), BridgeHandler)
    print(f"[autodl-compat] listening on {HOST}:{PORT} public={PUBLIC_BASE_URL}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
