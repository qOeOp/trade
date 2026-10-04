from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import pytest
from conftest import MemoryTranscript, make_draft, primitive_dependencies
from mcp import Client

from video_note_mcp import __main__ as cli_module
from video_note_mcp.adapters.fixture_distiller import DeterministicDistiller
from video_note_mcp.adapters.media_ffmpeg import FfmpegMedia
from video_note_mcp.adapters.note_publisher import LocalNotePublisher
from video_note_mcp.application.create_note import CreateBilibiliNote
from video_note_mcp.application.ports import DownloadedSource
from video_note_mcp.application.progress import ProgressReporter
from video_note_mcp.fixture import FIXTURE_URL
from video_note_mcp.mcp_server import TOOL_NAME, build_server


def _server(use_case):
    return build_server(use_case)


class BlockingSource:
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()

    async def download(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> DownloadedSource:
        self.started.set()
        try:
            await asyncio.Event().wait()
        finally:
            self.cancelled.set()
        raise AssertionError("unreachable")


class SlowCleanupSource:
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.cleanup_started = asyncio.Event()
        self.allow_cleanup = asyncio.Event()
        self.cleanup_terminal = asyncio.Event()

    async def download(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> DownloadedSource:
        del url, workspace, progress
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cleanup_started.set()
            try:
                await self.allow_cleanup.wait()
            finally:
                self.cleanup_terminal.set()
            raise


async def test_mcp_client_cancellation_reaches_active_source_before_return() -> None:
    source = BlockingSource()
    use_case = CreateBilibiliNote(
        source=source,
        media=FfmpegMedia(),
        distiller=DeterministicDistiller(),
        publisher=LocalNotePublisher(),
        **primitive_dependencies(MemoryTranscript(make_draft())),
    )
    async with Client(_server(use_case)) as client:
        call = asyncio.create_task(
            client.call_tool(TOOL_NAME, {"url": FIXTURE_URL, "quality": "fast"})
        )
        await asyncio.wait_for(source.started.wait(), timeout=1)
        call.cancel()
        result = await call
        await asyncio.wait_for(source.cancelled.wait(), timeout=1)
    assert result.is_error is True
    assert result.structured_content["code"] == "CANCELLED"
    assert result.structured_content["reason"] == "request_cancelled"


async def test_repeated_mcp_cancellation_waits_for_cleanup_and_emits_one_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    records: list[dict[str, object]] = []

    def write(fd: int, payload: bytes) -> int:
        assert fd == 2
        records.append(json.loads(payload))
        return len(payload)

    source = SlowCleanupSource()
    use_case = CreateBilibiliNote(
        source=source,
        media=FfmpegMedia(),
        distiller=DeterministicDistiller(),
        publisher=LocalNotePublisher(),
        **primitive_dependencies(MemoryTranscript(make_draft())),
    )
    monkeypatch.setattr("video_note_mcp.application.operator_events.os.write", write)
    async with Client(_server(use_case)) as client:
        call = asyncio.create_task(
            client.call_tool(TOOL_NAME, {"url": FIXTURE_URL, "quality": "fast"})
        )
        await asyncio.wait_for(source.started.wait(), timeout=1)
        call.cancel("first")
        await asyncio.wait_for(source.cleanup_started.wait(), timeout=1)
        call.cancel("second")
        await asyncio.sleep(0)
        assert not call.done()
        assert not source.cleanup_terminal.is_set()
        source.allow_cleanup.set()
        result = await call
    assert source.cleanup_terminal.is_set()
    assert result.is_error is True
    assert result.structured_content["code"] == "CANCELLED"
    assert [record["event"] for record in records] == ["request_started", "request_cancelled"]


async def test_public_cli_rejects_deterministic_mode_without_fixture_before_serve(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called = False

    async def forbidden_serve(fixture_root: Path | None, deterministic: bool) -> int:
        nonlocal called
        del fixture_root, deterministic
        called = True
        return 0

    monkeypatch.setattr(sys, "argv", ["video-note-mcp", "--deterministic"])
    monkeypatch.setattr(cli_module, "_serve", forbidden_serve)
    with pytest.raises(SystemExit) as exit_status:
        await cli_module._async_main()
    assert exit_status.value.code == 2
    assert called is False


@pytest.mark.parametrize("legacy", [False, True])
async def test_transport_success_has_durable_illustrated_contract(tmp_path, draft, legacy):
    from test_note_contract import use_case

    from video_note_mcp.domain.models import (
        PublicBilibiliNoteResultV4,
    )

    app = use_case(draft, tmp_path)
    observed = []

    async def capture(progress, total, message):
        assert total == 100
        observed.append(progress)

    async with Client(_server(app)) as client:
        listed = await client.list_tools()
        name = TOOL_NAME
        if legacy:
            name = name.replace("video_note.", "bilibili_note.")
        result = await client.call_tool(
            name,
            {"url": FIXTURE_URL, "quality": "fast"},
            progress_callback=capture,
        )
    assert not result.is_error
    validated = PublicBilibiliNoteResultV4.model_validate_json(
        json.dumps(result.structured_content)
    )
    assert len(validated.images) == 2
    assert len(result.content) == 1
    assert result.content[0].text == validated.rendered_markdown
    assert observed == sorted(observed)
    assert observed[0] == 5
    assert 100 not in observed
    assert {t.name for t in listed.tools} == {
        "video_note." + name
        for name in ("create", "download", "import", "transcribe", "frames", "render")
    }
    assert not app._source.workspace.exists()
    assert all(
        path.is_file()
        for path in map(Path, (validated.note_path, validated.html_path, *validated.images))
    )


async def test_author_failure_is_typed_and_never_publishes(tmp_path, draft):
    from test_note_contract import use_case

    from video_note_mcp.application.errors import BilibiliNoteFailure

    class Reject:
        async def distill(self, *args):
            raise BilibiliNoteFailure("DISTILLATION_FAILED", "provider_response_invalid")

    app = use_case(draft, tmp_path, author=Reject())
    observed = []

    async def capture(progress, total, message):
        observed.append(progress)

    async with Client(_server(app)) as client:
        result = await client.call_tool(
            TOOL_NAME,
            {"url": FIXTURE_URL, "quality": "fast"},
            progress_callback=capture,
        )
    assert result.is_error
    assert result.structured_content["schema"] == "bilibili-note.error/v1"
    assert result.structured_content["code"] == "DISTILLATION_FAILED"
    assert "rendered_markdown" not in result.structured_content
    assert 89 not in observed
    assert 100 not in observed
    assert list(tmp_path.iterdir()) == []


async def test_stdio_fixture_success_and_transcript_gap(tmp_path):
    from mcp import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client

    from video_note_mcp.fixture import generate_fixture

    fixture = generate_fixture(tmp_path / "fixture")
    output = tmp_path / "published"
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-m", "video_note_mcp", "--fixture-root", str(fixture), "--deterministic"],
        cwd=Path.cwd(),
        env={
            "BILIBILI_NOTE_OUTPUT_DIR": str(output),
            "BILIBILI_NOTE_ARTIFACT_DIR": os.environ["BILIBILI_NOTE_ARTIFACT_DIR"],
        },
    )
    async with stdio_client(parameters) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            success = await session.call_tool(TOOL_NAME, {"url": FIXTURE_URL, "quality": "fast"})
            subtitle = fixture / "subtitles.vtt"
            subtitle.write_text(
                "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nfirst\n\n"
                "00:00:03.000 --> 00:00:06.000\nsecond\n",
                encoding="utf-8",
            )
            observed = []

            async def capture(progress, total, message):
                observed.append(progress)

            gap = await session.call_tool(
                TOOL_NAME, {"url": FIXTURE_URL, "quality": "fast"}, progress_callback=capture
            )
    assert not success.is_error
    assert success.structured_content["schema"] == "bilibili-note.result/v4"
    assert len(success.structured_content["images"]) >= 2
    assert len(list(output.glob("note-*"))) == 1
    assert gap.is_error
    assert gap.structured_content["code"] == "TRANSCRIPT_INCOMPLETE"
    assert observed == [5, 25]


def test_live_runtime_uses_direct_author():
    from video_note_mcp.adapters.direct_notes import DirectDistiller

    app = cli_module._use_case(None, deterministic=False)
    assert isinstance(app._distiller, DirectDistiller)


@pytest.mark.parametrize(
    "name", ["video_note.search_and_create", "bilibili_note.search_and_create"]
)
async def test_retired_search_names_never_start_processing(name):
    source = BlockingSource()
    app = CreateBilibiliNote(
        source,
        FfmpegMedia(),
        DeterministicDistiller(),
        LocalNotePublisher(),
        **primitive_dependencies(MemoryTranscript(make_draft())),
    )
    async with Client(build_server(app)) as client:
        assert {tool.name for tool in (await client.list_tools()).tools} == {
            "video_note." + name
            for name in ("create", "download", "import", "transcribe", "frames", "render")
        }
        result = await client.call_tool(name, {"query": "paper airplane"})
    assert result.is_error
    assert result.structured_content["reason"] == "tool_name_invalid"
    assert not source.started.is_set()
