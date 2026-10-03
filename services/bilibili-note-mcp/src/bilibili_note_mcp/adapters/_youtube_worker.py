"""Isolated YouTube-only extractor. No arbitrary yt-dlp URLs or ambient credentials."""

from __future__ import annotations

import json
import socket
import sys
import time
from pathlib import Path
from typing import Any
from unittest.mock import patch
from urllib.parse import urlsplit

import yt_dlp  # type: ignore[import-untyped]
from yt_dlp.networking._urllib import RedirectHandler, UrllibRH  # type: ignore[import-untyped]

from bilibili_note_mcp.adapters._ytdlp_worker import (
    _classify_failure,
    _cleanup_partial,
    _DownloadMetrics,
    _QuietLogger,
)
from bilibili_note_mcp.adapters.egress import admitted_loopback_proxy
from bilibili_note_mcp.adapters.extractor_http import (
    bounded_response,
    public_resolver,
    refuse_redirect,
)
from bilibili_note_mcp.adapters.strict_json import decode_strict_json_object
from bilibili_note_mcp.application.resource_limits import MEDIA_DOWNLOAD_BYTES
from bilibili_note_mcp.domain.models import MAX_SOURCE_DURATION_MS
from bilibili_note_mcp.domain.youtube_url import VIDEO_ID, validate_youtube_url

SCHEMA = "video-note-youtube-worker/v1"


def admit_url(value: str) -> None:
    parts = urlsplit(value)
    host = parts.hostname or ""
    if (
        parts.scheme != "https"
        or parts.port not in (None, 443)
        or parts.username
        or parts.password
        or parts.fragment
        or not (
            host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtubei.googleapis.com"}
            or host.endswith(".googlevideo.com")
        )
    ):
        raise ValueError("youtube_egress_denied")


class YoutubeOnlyDL(yt_dlp.YoutubeDL):  # type: ignore[misc]
    def urlopen(self, request: Any) -> Any:
        url = request if isinstance(request, str) else getattr(request, "url", None)
        if not isinstance(url, str):
            url = request.full_url
        admit_url(url)
        response = super().urlopen(request)
        maximum = (
            MEDIA_DOWNLOAD_BYTES
            if (urlsplit(url).hostname or "").endswith(".googlevideo.com")
            else 4 * 1024 * 1024
        )
        return bounded_response(response, maximum)

    def build_request_director(self, handlers: Any, preferences: Any = None) -> Any:
        return super().build_request_director([UrllibRH], preferences)


def metadata(info: Any, expected_id: str | None = None) -> dict[str, Any]:
    if not isinstance(info, dict) or info.get("_type", "video") != "video":
        raise ValueError("youtube_video_required")
    identity = info.get("id")
    if not isinstance(identity, str) or not VIDEO_ID.fullmatch(identity):
        raise ValueError("youtube_identity_invalid")
    if expected_id is not None and identity != expected_id:
        raise ValueError("youtube_identity_changed")
    if info.get("is_live") or info.get("live_status") not in (None, "not_live", "was_live"):
        raise ValueError("youtube_finite_video_required")
    duration = info.get("duration")
    if (
        not isinstance(duration, (int, float))
        or isinstance(duration, bool)
        or not 0 < duration <= MAX_SOURCE_DURATION_MS / 1000
    ):
        raise ValueError("youtube_duration_invalid")
    title, author = info.get("title"), info.get("uploader") or info.get("channel")
    if not isinstance(title, str) or not 1 <= len(title) <= 500:
        raise ValueError("youtube_title_invalid")
    if not isinstance(author, str) or not 1 <= len(author) <= 200:
        raise ValueError("youtube_author_invalid")
    width, height = info.get("width"), info.get("height")
    if type(width) is not int or type(height) is not int:
        raise ValueError("youtube_dimensions_invalid")
    return {
        "id": identity,
        "title": title,
        "author": author,
        "date": info.get("upload_date"),
        "duration_ms": round(duration * 1000),
        "width": width,
        "height": height,
        "format_id": str(info.get("format_id") or "unknown")[:100],
    }


def run(request: dict[str, Any]) -> dict[str, Any]:
    if set(request) != {"schema", "operation", "value", "limit", "workspace", "proxy"}:
        raise ValueError("youtube_request_invalid")
    operation, value = request["operation"], request["value"]
    if request["schema"] != SCHEMA or operation not in {"metadata", "media", "search"}:
        raise ValueError("youtube_request_invalid")
    if not isinstance(value, str):
        raise ValueError("youtube_request_invalid")
    proxy = admitted_loopback_proxy(request["proxy"])
    workspace = None
    if operation == "media":
        if not isinstance(request["workspace"], str):
            raise ValueError("youtube_workspace_invalid")
        workspace = Path(request["workspace"])
        if not workspace.is_absolute() or workspace.is_symlink() or not workspace.is_dir():
            raise ValueError("youtube_workspace_invalid")
    elif request["workspace"] is not None:
        raise ValueError("youtube_workspace_invalid")
    if operation == "search":
        limit = request["limit"]
        if type(limit) is not int or not 1 <= limit <= 9 or not 2 <= len(value) <= 200:
            raise ValueError("youtube_search_invalid")
        target, extractor = f"ytsearch{limit}:{value}", "YoutubeSearch"
        expected_id = None
    else:
        parsed = validate_youtube_url(value)
        if value != parsed.canonical_url() or request["limit"] != 1:
            raise ValueError("youtube_request_invalid")
        target, extractor, expected_id = value, "Youtube", parsed.video_id
    metrics = _DownloadMetrics()
    options = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _QuietLogger(),
        "noplaylist": True,
        "cachedir": False,
        "proxy": proxy or "",
        "socket_timeout": 20,
        "retries": 0,
        "fragment_retries": 0,
        "extractor_retries": 0,
        "remote_components": set(),
        "js_runtimes": {"deno": {}, "node": {}},
        "format": (
            "bv[height>=720][width>=720][height<=1920]+ba/b[height>=720][width>=720][height<=1920]"
        ),
        "format_sort": ["res:720"],
        "merge_output_format": "mp4",
        "max_filesize": MEDIA_DOWNLOAD_BYTES,
        "progress_hooks": [metrics.progress_hook],
        "extract_flat": "in_playlist" if operation == "search" else False,
    }
    if workspace:
        options["outtmpl"] = str(workspace / "source.%(ext)s")
    with (
        patch.object(socket, "getaddrinfo", public_resolver(socket.getaddrinfo, proxy)),
        patch.object(RedirectHandler, "redirect_request", refuse_redirect),
    ):
        for attempt in range(3):
            metrics.begin_attempt()
            try:
                with YoutubeOnlyDL(options) as downloader:
                    info = downloader.extract_info(target, download=False, ie_key=extractor)
                    if operation == "search":
                        entries = list(info.get("entries") or [])[: request["limit"]]
                        rows = []
                        for entry in entries:
                            identity = entry.get("id")
                            title = entry.get("title")
                            if (
                                isinstance(identity, str)
                                and VIDEO_ID.fullmatch(identity)
                                and isinstance(title, str)
                                and 1 <= len(title) <= 500
                                and not entry.get("is_live")
                            ):
                                rows.append(
                                    {
                                        "video_id": identity,
                                        "title": title,
                                        "canonical_url": f"https://www.youtube.com/watch?v={identity}",
                                    }
                                )
                        return {"schema": SCHEMA, "ok": True, "candidates": rows}
                    result = metadata(info, expected_id)
                    if operation == "media":
                        downloader.process_info(info)
                    return {"schema": SCHEMA, "ok": True, "metadata": result}
            except Exception as e:
                metrics.finish_failed_attempt()
                if workspace:
                    _cleanup_partial(workspace)
                cause = _classify_failure(e).cause
                if cause in {"transient", "rate_limited"} and attempt < 2:
                    time.sleep((1, 2)[attempt])
                    continue
                raise
    raise AssertionError("unreachable")


def main() -> None:
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise ValueError("youtube_request_too_large")
        result = run(decode_strict_json_object(raw))
    except Exception:
        result = {"schema": SCHEMA, "ok": False, "reason": "youtube_acquisition_failed"}
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")


if __name__ == "__main__":
    main()
