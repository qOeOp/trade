"""Generic HTML/progressive-media acquisition without platform handoffs or external downloaders."""

from __future__ import annotations

import json
import socket
import sys
from pathlib import Path
from typing import Any
from unittest.mock import patch
from urllib.parse import urlsplit

import yt_dlp  # type: ignore[import-untyped]
from yt_dlp.extractor.generic import GenericIE  # type: ignore[import-untyped]
from yt_dlp.networking._urllib import RedirectHandler, UrllibRH  # type: ignore[import-untyped]

from video_note_mcp.adapters._ytdlp_worker import _QuietLogger
from video_note_mcp.adapters.extractor_http import (
    bounded_response,
    public_resolver,
    refuse_redirect,
)
from video_note_mcp.adapters.strict_json import decode_strict_json_object
from video_note_mcp.application.resource_limits import MEDIA_DOWNLOAD_BYTES
from video_note_mcp.domain.generic_url import validate_generic_url

SCHEMA = "video-note-generic-worker/v1"


class PublicVideoDL(yt_dlp.YoutubeDL):  # type: ignore[misc]
    requests_left = 24
    media_mode = False

    def urlopen(self, request: Any) -> Any:
        url = request if isinstance(request, str) else request.url
        validate_generic_url(url)
        self.requests_left -= 1
        if self.requests_left < 0:
            raise ValueError("generic_request_limit")
        response = super().urlopen(request)
        return bounded_response(response, MEDIA_DOWNLOAD_BYTES if self.media_mode else 4 * 1024**2)

    def build_request_director(self, handlers: Any, preferences: Any = None) -> Any:
        return super().build_request_director([UrllibRH], preferences)


def single_video(info: Any) -> dict[str, Any]:
    if isinstance(info, dict) and info.get("_type") == "playlist":
        entries = info.get("entries")
        if not isinstance(entries, list) or len(entries) != 1:
            raise ValueError("generic_single_video_required")
        info = entries[0]
    if (
        not isinstance(info, dict)
        or info.get("_type", "video") != "video"
        or info.get("is_live")
        or info.get("has_drm")
        or info.get("live_status") not in (None, "not_live", "was_live")
    ):
        raise ValueError("generic_finite_video_required")
    return info


def progressive_url(info: dict[str, Any]) -> str:
    formats = info.get("formats") or [info]
    if not isinstance(formats, list) or len(formats) > 100:
        raise ValueError("generic_formats_invalid")
    candidates = []
    for f in formats:
        if not isinstance(f, dict):
            raise ValueError("generic_format_invalid")
        url = f.get("url")
        if (
            not isinstance(url, str)
            or f.get("protocol") not in (None, "https")
            or f.get("has_drm")
            or f.get("fragments")
            or f.get("manifest_url")
            or f.get("acodec") == "none"
            or f.get("vcodec") == "none"
        ):
            continue
        validate_generic_url(url)
        candidates.append(url)
    if not candidates:
        raise ValueError("generic_progressive_video_required")
    # Missing dimensions are measured after download; never guess that a rendition is HD.
    return candidates[0]


def run(request: dict[str, Any]) -> dict[str, Any]:
    if set(request) != {"schema", "url", "workspace"} or request["schema"] != SCHEMA:
        raise ValueError("generic_request_invalid")
    target = validate_generic_url(request["url"]).canonical_url()
    workspace = Path(request["workspace"])
    if not workspace.is_absolute() or workspace.is_symlink() or not workspace.is_dir():
        raise ValueError("generic_workspace_invalid")
    options = {
        "quiet": True,
        "no_warnings": True,
        "logger": _QuietLogger(),
        "proxy": "",
        "cachedir": False,
        "socket_timeout": 20,
        "retries": 0,
        "extractor_retries": 0,
        "noplaylist": True,
        "remote_components": set(),
        "js_runtimes": {},
    }
    with (
        patch.object(socket, "getaddrinfo", public_resolver(socket.getaddrinfo, None)),
        patch.object(RedirectHandler, "redirect_request", refuse_redirect),
    ):
        with PublicVideoDL(options, auto_init=False) as downloader:
            downloader.add_info_extractor(GenericIE())
            info = single_video(
                downloader.extract_info(target, download=False, process=False, ie_key="Generic")
            )
            media_url = progressive_url(info)
            downloader.media_mode = True
            with (
                downloader.urlopen(media_url) as response,
                (workspace / "source.mp4").open("xb") as out,
            ):
                while chunk := response.read(64 * 1024):
                    out.write(chunk)

    def text(key: str, limit: int) -> str | None:
        value = info.get(key)
        return value.strip() if isinstance(value, str) and 0 < len(value.strip()) <= limit else None

    return {
        "schema": SCHEMA,
        "ok": True,
        "url": target,
        "title": text("title", 500),
        "author": (
            None if text("uploader", 200) == urlsplit(target).hostname else text("uploader", 200)
        ),
        "date": text("upload_date", 8),
    }


def main() -> None:
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise ValueError("generic_request_too_large")
        result = run(decode_strict_json_object(raw))
    except Exception:
        result = {"schema": SCHEMA, "ok": False, "reason": "generic_acquisition_failed"}
    sys.stdout.write(json.dumps(result) + "\n")


if __name__ == "__main__":
    main()
