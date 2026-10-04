from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import sys
import tempfile
from pathlib import Path

from mcp.server.stdio import stdio_server

from video_note_mcp.adapters.asr_mlx import MLX_IDENTITY, MlxAsr
from video_note_mcp.adapters.asr_siliconflow import SiliconFlowAsr
from video_note_mcp.adapters.audio_review import AudioReviewer
from video_note_mcp.adapters.bilibili_media_ytdlp import YtDlpBilibiliMedia
from video_note_mcp.adapters.bilibili_source import BilibiliSource
from video_note_mcp.adapters.direct_notes import DirectDistiller
from video_note_mcp.adapters.fixture_distiller import DeterministicDistiller
from video_note_mcp.adapters.fixture_source import FixtureSource
from video_note_mcp.adapters.generic_source import GenericSource
from video_note_mcp.adapters.media_ffmpeg import FfmpegMedia
from video_note_mcp.adapters.note_publisher import LocalNotePublisher
from video_note_mcp.adapters.source_cache import SourceCache
from video_note_mcp.adapters.video_source import VideoSource
from video_note_mcp.adapters.youtube_source import YoutubeSource
from video_note_mcp.application.create_note import CreateBilibiliNote
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.fixture import FIXTURE_URL, generate_fixture
from video_note_mcp.mcp_server import build_server
from video_note_mcp.stdio_admission import strict_mcp_stdio_admission


def _use_case(fixture_root: Path | None, deterministic: bool) -> CreateBilibiliNote:
    local = platform.system() == "Darwin" and platform.machine() == "arm64"
    engine = os.environ.get("BILIBILI_NOTE_ASR", "mlx" if local else "siliconflow")
    if engine not in ("mlx", "siliconflow"):
        raise ValueError("BILIBILI_NOTE_ASR must be mlx or siliconflow")
    transcript = MlxAsr() if engine == "mlx" else SiliconFlowAsr()
    cache = SourceCache(MLX_IDENTITY) if engine == "mlx" else None
    source = (
        FixtureSource(fixture_root)
        if fixture_root
        else VideoSource(
            BilibiliSource(transcript=transcript, cache=cache, media=YtDlpBilibiliMedia()),
            YoutubeSource(transcript=transcript, cache=cache),
            GenericSource(transcript=transcript),
        )
    )
    distiller = DeterministicDistiller() if deterministic else DirectDistiller()
    return CreateBilibiliNote(
        source=source,
        media=FfmpegMedia(),
        distiller=distiller,
        publisher=LocalNotePublisher(),
        reviewer=None if deterministic else AudioReviewer(),
    )


def _receipt(payload: object) -> dict[str, object]:
    from video_note_mcp.application.ports import PublishedNote

    assert isinstance(payload, PublishedNote)
    return {
        "ok": True,
        "schema": "bilibili-note.result/v4",
        "note_path": payload.note_path,
        "html_path": payload.html_path,
        "public_image_count": len(payload.images),
    }


async def _self_check(with_provider: bool) -> int:
    with tempfile.TemporaryDirectory(prefix="bilibili-note-fixture-") as scratch:
        root = generate_fixture(Path(scratch))
        use_case = _use_case(root, deterministic=not with_provider)
        return await _run_once(use_case, FIXTURE_URL)


async def _run_once(use_case: CreateBilibiliNote, url: str, quality: str = "fast") -> int:
    try:
        from typing import cast

        from video_note_mcp.domain.models import Quality

        payload = await use_case.execute(url, quality=cast(Quality, quality))
    except BilibiliNoteFailure as e:
        print(json.dumps({"ok": False, "code": e.code, "reason": e.reason}))
        return 1
    print(json.dumps(_receipt(payload), ensure_ascii=False, sort_keys=True))
    return 0


async def _serve(fixture_root: Path | None, deterministic: bool) -> int:
    create_note = _use_case(fixture_root, deterministic)
    server = build_server(create_note)
    with strict_mcp_stdio_admission():
        async with stdio_server() as (read_stream, write_stream):
            await server.run(read_stream, write_stream, server.create_initialization_options())
    return 0


async def _async_main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture-root", type=Path)
    parser.add_argument("--deterministic", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--with-provider", action="store_true")
    parser.add_argument("--create")
    parser.add_argument("--quality", choices=("fast", "standard", "precise"), default="standard")
    args = parser.parse_args()
    if args.with_provider and not args.self_check:
        parser.error("--with-provider requires --self-check")
    if args.deterministic and args.fixture_root is None:
        parser.error("--deterministic requires --fixture-root")
    if args.create:
        return await _run_once(_use_case(None, deterministic=False), args.create, args.quality)
    if args.self_check:
        return await _self_check(args.with_provider)
    return await _serve(args.fixture_root, args.deterministic)


def main() -> None:
    try:
        code = asyncio.run(_async_main())
    except KeyboardInterrupt:
        code = 130
    sys.exit(code)


if __name__ == "__main__":
    main()
