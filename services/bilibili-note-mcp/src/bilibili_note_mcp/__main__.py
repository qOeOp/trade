from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path

from mcp.server.stdio import stdio_server

from bilibili_note_mcp.adapters.asr_siliconflow import SiliconFlowAsr
from bilibili_note_mcp.adapters.bilibili_media_ytdlp import YtDlpBilibiliMedia
from bilibili_note_mcp.adapters.bilibili_search import BilibiliSearch
from bilibili_note_mcp.adapters.bilibili_source import BilibiliSource
from bilibili_note_mcp.adapters.distillers import (
    DeterministicCandidateVerifier,
    DeterministicDistiller,
    SiliconFlowDistiller,
)
from bilibili_note_mcp.adapters.fixture_search import FixtureSearch
from bilibili_note_mcp.adapters.fixture_source import FixtureSource
from bilibili_note_mcp.adapters.media_ffmpeg import FfmpegMedia
from bilibili_note_mcp.adapters.strategy_aggregation import (
    DeterministicStrategyAggregator,
    SiliconFlowStrategySynthesisVerifier,
    SiliconFlowStrategySynthesizer,
)
from bilibili_note_mcp.application.create_note import CreateBilibiliNote
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.search_notes import SearchAndCreateBilibiliNotes
from bilibili_note_mcp.application.strategy_aggregation import (
    VerifiedStrategySynthesisAggregator,
)
from bilibili_note_mcp.fixture import FIXTURE_URL, generate_fixture
from bilibili_note_mcp.mcp_server import build_server
from bilibili_note_mcp.presentation.markdown import MarkdownRenderer
from bilibili_note_mcp.stdio_admission import strict_mcp_stdio_admission


def _use_case(fixture_root: Path | None, deterministic: bool) -> CreateBilibiliNote:
    source = (
        FixtureSource(fixture_root)
        if fixture_root
        else BilibiliSource(
            transcript=SiliconFlowAsr(),
            media=YtDlpBilibiliMedia(),
        )
    )
    distiller = DeterministicDistiller() if deterministic else SiliconFlowDistiller()
    verifier = DeterministicCandidateVerifier()
    return CreateBilibiliNote(
        source=source,
        media=FfmpegMedia(),
        distiller=distiller,
        verifier=verifier,
        renderer=MarkdownRenderer(),
    )


def _search_use_case(
    fixture_root: Path | None,
    create_note: CreateBilibiliNote,
) -> SearchAndCreateBilibiliNotes:
    search = FixtureSearch() if fixture_root else BilibiliSearch()
    aggregator = (
        DeterministicStrategyAggregator()
        if fixture_root
        else VerifiedStrategySynthesisAggregator(
            synthesizer=SiliconFlowStrategySynthesizer(),
            verifier=SiliconFlowStrategySynthesisVerifier(),
        )
    )
    return SearchAndCreateBilibiliNotes(
        search=search,
        create_note=create_note,
        aggregator=aggregator,
        renderer=MarkdownRenderer(),
    )


def _receipt(payload: object) -> dict[str, object]:
    from bilibili_note_mcp.application.create_note import BundlePayload

    assert isinstance(payload, BundlePayload)
    rendered = payload.rendered_markdown
    return {
        "ok": True,
        "schema": "bilibili-note.result/v3",
        "public_image_count": 0,
        "section_count": rendered.count("## "),
    }


async def _self_check(with_provider: bool) -> int:
    with tempfile.TemporaryDirectory(prefix="bilibili-note-fixture-") as scratch:
        root = generate_fixture(Path(scratch))
        use_case = _use_case(root, deterministic=not with_provider)
        return await _run_once(use_case, FIXTURE_URL)


async def _run_once(use_case: CreateBilibiliNote, url: str) -> int:
    try:
        payload = await use_case.execute(url)
    except BilibiliNoteFailure as e:
        print(json.dumps({"ok": False, "code": e.code, "reason": e.reason}))
        return 1
    print(json.dumps(_receipt(payload), ensure_ascii=False, sort_keys=True))
    return 0


async def _serve(fixture_root: Path | None, deterministic: bool) -> int:
    create_note = _use_case(fixture_root, deterministic)
    server = build_server(create_note, _search_use_case(fixture_root, create_note))
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
    args = parser.parse_args()
    if args.with_provider and not args.self_check:
        parser.error("--with-provider requires --self-check")
    if args.deterministic and args.fixture_root is None:
        parser.error("--deterministic requires --fixture-root")
    if args.create:
        return await _run_once(_use_case(None, deterministic=False), args.create)
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
