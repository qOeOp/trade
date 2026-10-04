from __future__ import annotations

import asyncio
import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from mcp import Client

from video_note_mcp.__main__ import _use_case
from video_note_mcp.adapters.artifact_store import ArtifactStore
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.domain.artifacts import DownloadedSource
from video_note_mcp.fixture import FIXTURE_URL, generate_fixture
from video_note_mcp.mcp_server import build_server


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    monkeypatch.setenv("BILIBILI_NOTE_ARTIFACT_DIR", str(tmp_path / "artifacts"))
    monkeypatch.setenv("BILIBILI_NOTE_OUTPUT_DIR", str(tmp_path / "notes"))
    fixture = generate_fixture(tmp_path / "fixture")
    return fixture, _use_case(fixture, deterministic=True)


def authored(evidence):
    segments = evidence["transcript"]["segments"]
    refs = [s["evidence_id"] for s in segments]
    return {
        "overview": [{"text": "完整步骤", "evidence_refs": refs}],
        "chapters": [
            {
                "title": "操作过程",
                "points": [
                    {"text": s["text"], "evidence_refs": [s["evidence_id"]]} for s in segments
                ],
                "screenshots": [{"frame_id": f["frame_id"]} for f in evidence["frames"][:2]],
            }
        ],
        "takeaways": [],
    }


async def call(client, name, arguments):
    result = await client.call_tool("video_note." + name, arguments)
    assert not result.is_error, result.structured_content
    return result.structured_content


async def test_asr_failure_restart_import_frames_and_render(runtime):
    fixture, app = runtime
    app._transcript.transcribe = AsyncMock(
        side_effect=BilibiliNoteFailure("TRANSCRIPT_UNAVAILABLE", "test_asr_failed")
    )
    async with Client(build_server(app)) as client:
        failed = await client.call_tool(
            "video_note.create", {"url": FIXTURE_URL, "quality": "fast"}
        )
    assert failed.is_error
    recovery = failed.structured_content["recovery"]
    assert set(recovery) == {"media_id"}
    assert app.artifacts.load_media(recovery["media_id"]).media_path.is_file()
    resumed = _use_case(fixture, deterministic=True)
    resumed._source.download = AsyncMock(side_effect=AssertionError("must not redownload"))
    resumed._transcript.transcribe = AsyncMock(side_effect=AssertionError("must not call ASR"))
    async with Client(build_server(resumed)) as client:
        retained = await call(client, "download", {"media_id": recovery["media_id"]})
        assert retained["source"]["duration_ms"] == 6000
        transcript = await call(
            client,
            "import",
            {
                "kind": "transcript",
                "media_id": recovery["media_id"],
                "segments": [
                    {"start_ms": 0, "end_ms": 3000, "text": "先观察蒸发过程。"},
                    {"start_ms": 3000, "end_ms": 6000, "text": "最后观察降水回到地面。"},
                ],
            },
        )
        assert transcript["transcript"]["method"] == "imported"
        assert (
            "covered_duration_ms" not in transcript["transcript"]
            or transcript["transcript"]["covered_duration_ms"] is None
        )
        evidence = await call(client, "frames", {"transcript_id": transcript["transcript_id"]})
        pngs = await asyncio.gather(
            *(asyncio.to_thread(Path(f["path"]).read_bytes) for f in evidence["frames"])
        )
        assert all(png.startswith(b"\x89PNG") for png in pngs)
        result = await call(
            client, "render", {"evidence_id": evidence["evidence_id"], "note": authored(evidence)}
        )
    html = await asyncio.to_thread(Path(result["html_path"]).read_text)
    assert "外部导入" in html and "最后观察降水回到地面" in html
    assert result["images"] and all(
        await asyncio.gather(*(asyncio.to_thread(Path(p).is_file) for p in result["images"]))
    )
    resumed._source.download.assert_not_awaited()
    resumed._transcript.transcribe.assert_not_awaited()


async def test_author_failure_retains_evidence_and_render_needs_no_model(runtime):
    _, app = runtime
    app._distiller.distill = AsyncMock(
        side_effect=BilibiliNoteFailure("DISTILLATION_FAILED", "test_author_failed")
    )
    async with Client(build_server(app)) as client:
        failure = await client.call_tool(
            "video_note.create", {"url": FIXTURE_URL, "quality": "fast"}
        )
        ids = failure.structured_content["recovery"]
        assert set(ids) == {"media_id", "transcript_id", "evidence_id"}
        app._source.download = AsyncMock(side_effect=AssertionError("unexpected download"))
        app._transcript.transcribe = AsyncMock(side_effect=AssertionError("unexpected ASR"))
        app._media.extract_frames = AsyncMock(side_effect=AssertionError("unexpected extraction"))
        evidence = await call(client, "frames", {"evidence_id": ids["evidence_id"]})
        result = await call(
            client, "render", {"evidence_id": ids["evidence_id"], "note": authored(evidence)}
        )
        invalid = authored(evidence)
        invalid["chapters"][0]["points"][0]["evidence_refs"] = ["E999"]
        rejected = await client.call_tool(
            "video_note.render", {"evidence_id": ids["evidence_id"], "note": invalid}
        )
    assert (
        rejected.is_error
        and rejected.structured_content["recovery"]["evidence_id"] == ids["evidence_id"]
    )
    assert len(list(Path(result["note_path"]).parent.parent.glob("note-*"))) == 1
    app._distiller.distill.assert_awaited_once()
    app._transcript.transcribe.assert_not_awaited()
    app._media.extract_frames.assert_not_awaited()


async def test_download_and_transcribe_independent_review_failure_keeps_raw(runtime):
    _, app = runtime
    async with Client(build_server(app)) as client:
        media = await call(client, "download", {"url": FIXTURE_URL})
        assert await asyncio.to_thread(Path(media["media_path"]).is_file)
        app._source.download = AsyncMock(side_effect=AssertionError("unexpected download"))
        failed = await client.call_tool(
            "video_note.transcribe", {"media_id": media["media_id"], "quality": "precise"}
        )
        assert failed.structured_content["reason"] == "reviewer_not_configured"
        raw_id = failed.structured_content["recovery"]["transcript_id"]
        raw, quality = app.artifacts.load_transcript(raw_id)
        assert quality == "fast" and raw.transcript.segments[-1].end_ms == 6000
        good = await call(client, "transcribe", {"media_id": media["media_id"], "quality": "fast"})
        assert good["transcript"]["segments"][-1]["end_ms"] == 6000
    app._source.download.assert_not_awaited()


@pytest.mark.parametrize(
    "segments",
    [
        [{"start_ms": 1, "end_ms": 6000, "text": "缺开头"}],
        [{"start_ms": 0, "end_ms": 5999, "text": "缺结尾"}],
        [
            {"start_ms": 0, "end_ms": 2000, "text": "一"},
            {"start_ms": 3000, "end_ms": 6000, "text": "二"},
        ],
    ],
)
async def test_import_rejects_incomplete_timeline(runtime, segments):
    _, app = runtime
    async with Client(build_server(app)) as client:
        media = await call(client, "download", {"url": FIXTURE_URL})
        result = await client.call_tool(
            "video_note.import",
            {"kind": "transcript", "media_id": media["media_id"], "segments": segments},
        )
    assert result.is_error and result.structured_content["code"] == "TRANSCRIPT_INCOMPLETE"
    assert not list(app.artifacts.root.glob("transcript-*"))


async def test_local_import_actual_audio_video_to_note(runtime, tmp_path, monkeypatch):
    fixture, app = runtime
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    monkeypatch.setenv("BILIBILI_NOTE_IMPORT_DIR", str(inbox))
    await asyncio.to_thread(
        subprocess.run,
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(fixture / "media.mp4"),
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=16000:cl=mono",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            str(inbox / "lesson.mp4"),
        ],
        check=True,
    )
    async with Client(build_server(app)) as client:
        media = await call(
            client, "import", {"kind": "media", "filename": "lesson.mp4", "title": "本地课程"}
        )
        assert media["source"]["platform"] == "local" and media["source"]["author_name"] is None
        duration = media["source"]["duration_ms"]
        transcript = await call(
            client,
            "import",
            {
                "kind": "transcript",
                "media_id": media["media_id"],
                "segments": [
                    {"start_ms": 0, "end_ms": duration // 2, "text": "第一步观察画面。"},
                    {"start_ms": duration // 2, "end_ms": duration, "text": "第二步记录变化。"},
                ],
            },
        )
        evidence = await call(client, "frames", {"transcript_id": transcript["transcript_id"]})
        note = await call(
            client, "render", {"evidence_id": evidence["evidence_id"], "note": authored(evidence)}
        )
    html = await asyncio.to_thread(Path(note["html_path"]).read_text)
    assert "本地导入" in html and "外部导入" in html
    assert 'href="local:' not in html and "&t=" not in html


@pytest.mark.parametrize(
    "filename",
    ["../media.mp4", "/tmp/media.mp4", "https://example.org/video.mp4", "link.mp4", "media.mp4"],
)
async def test_import_refuses_paths_symlink_or_no_audio(runtime, monkeypatch, filename):
    fixture, app = runtime
    monkeypatch.setenv("BILIBILI_NOTE_IMPORT_DIR", str(fixture))
    (fixture / "link.mp4").symlink_to(fixture / "media.mp4")
    async with Client(build_server(app)) as client:
        result = await client.call_tool(
            "video_note.import", {"kind": "media", "filename": filename, "title": "test"}
        )
    assert result.is_error
    assert not app.artifacts.root.exists()


def stored_source(tmp_path, draft):
    path = tmp_path / "source.mp4"
    path.write_bytes(b"fixture media bytes")
    return DownloadedSource(draft.source, path, "bs_" + "a" * 64)


def test_store_tamper_expiry_and_wrong_kind(tmp_path, draft, monkeypatch):
    store = ArtifactStore(tmp_path / "store")
    identity = store.save_media(stored_source(tmp_path, draft))
    assert store.load_media(identity).source == draft.source
    for operation, value in [
        (store.load_transcript, identity),
        (store.load_media, "../source.mp4"),
    ]:
        with pytest.raises(BilibiliNoteFailure):
            operation(value)
    monkeypatch.setattr("video_note_mcp.adapters.artifact_store.time.time", lambda: 10**12)
    with pytest.raises(BilibiliNoteFailure, match="expired"):
        store.load_media(identity)
    monkeypatch.undo()
    store.load_media(identity).media_path.write_bytes(b"changed")
    with pytest.raises(BilibiliNoteFailure, match="digest"):
        store.load_media(identity)


def test_store_parallel_capacity_is_atomic(tmp_path, draft):
    store = ArtifactStore(tmp_path / "store", max_entries=1)
    source = stored_source(tmp_path, draft)

    def save():
        try:
            return store.save_media(source)
        except BilibiliNoteFailure:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(lambda _: save(), range(2)))
    assert sum(i is not None for i in ids) == 1
    assert len(list(store.root.glob("media-*"))) == 1
    assert not list(store.root.glob(".staging-*"))
    tiny = ArtifactStore(tmp_path / "tiny", max_bytes=1)
    with pytest.raises(BilibiliNoteFailure, match="capacity"):
        tiny.save_media(source)
    assert not list(tiny.root.glob("media-*"))


async def test_store_foreign_binding_and_frame_symlink(runtime):
    _, app = runtime
    media_id = await app.download(FIXTURE_URL)
    transcript_id = await app.transcribe(media_id)
    source, quality = app.artifacts.load_transcript(transcript_id)
    with pytest.raises(BilibiliNoteFailure, match="parent_mismatch"):
        app.artifacts.save_transcript(
            media_id, replace(source, source_snapshot_ref="different"), quality
        )
    evidence_id = await app.frames(transcript_id)
    _, _, frames = app.artifacts.load_frames(evidence_id)
    with pytest.raises(BilibiliNoteFailure, match="binding"):
        app.artifacts.save_frames(
            transcript_id, (replace(frames[0], transcript_refs=("E999",)), *frames[1:])
        )
    directory = app.artifacts.root / evidence_id
    frame = directory / "F01.png"
    outside = directory.parent / "outside.png"
    outside.write_bytes(frame.read_bytes())
    frame.unlink()
    frame.symlink_to(outside)
    with pytest.raises(BilibiliNoteFailure):
        app.artifacts.load_frames(evidence_id)


async def test_stdio_process_restart_can_resume_and_publish(runtime, tmp_path):
    import sys

    from mcp import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client

    fixture, app = runtime
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-m", "video_note_mcp", "--fixture-root", str(fixture), "--deterministic"],
        cwd=Path.cwd(),
        env={
            "BILIBILI_NOTE_ARTIFACT_DIR": str(app.artifacts.root),
            "BILIBILI_NOTE_OUTPUT_DIR": str(tmp_path / "published"),
        },
    )
    async with stdio_client(parameters) as (reader, writer):
        async with ClientSession(reader, writer) as client:
            await client.initialize()
            media = await call(client, "download", {"url": FIXTURE_URL})
    # The first server process is gone; only the persisted ID crosses this boundary.
    async with stdio_client(parameters) as (reader, writer):
        async with ClientSession(reader, writer) as client:
            await client.initialize()
            transcript = await call(
                client, "transcribe", {"media_id": media["media_id"], "quality": "fast"}
            )
            evidence = await call(client, "frames", {"transcript_id": transcript["transcript_id"]})
            note = await call(
                client,
                "render",
                {"evidence_id": evidence["evidence_id"], "note": authored(evidence)},
            )
    assert await asyncio.to_thread(Path(note["html_path"]).is_file)
    assert note["images"]


async def test_cancel_during_media_commit_waits_for_copy_before_scratch_cleanup(
    runtime, monkeypatch
):
    import threading

    _, app = runtime
    started, release = threading.Event(), threading.Event()
    original = app.artifacts.save_media
    committed = []

    def blocked(source):
        started.set()
        assert release.wait(5)
        assert source.media_path.is_file()
        committed.append(original(source))
        return committed[0]

    monkeypatch.setattr(app.artifacts, "save_media", blocked)
    task = asyncio.create_task(app.download(FIXTURE_URL))
    assert await asyncio.to_thread(started.wait, 5)
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    release.set()
    with pytest.raises(asyncio.CancelledError) as failure:
        await task
    assert failure.value.recovery == {"media_id": committed[0]}
    assert app.artifacts.load_media(committed[0]).media_path.is_file()


def test_failed_artifact_commit_leaves_no_partial_record(tmp_path, draft, monkeypatch):
    store = ArtifactStore(tmp_path / "store")
    source = stored_source(tmp_path, draft)

    def fail_copy(source, target):
        target.write_bytes(b"partial")
        raise OSError("synthetic disk failure")

    monkeypatch.setattr("video_note_mcp.adapters.artifact_store.copy_bounded_media", fail_copy)
    with pytest.raises(BilibiliNoteFailure):
        store.save_media(source)
    assert not list(store.root.glob("media-*"))
    assert not list(store.root.glob(".staging-*"))


def test_abandoned_staging_counts_toward_capacity(tmp_path, draft):
    store = ArtifactStore(tmp_path / "store", max_bytes=20)
    abandoned = store.root / ".staging-abandoned"
    abandoned.mkdir(parents=True)
    (abandoned / "media.mp4").write_bytes(b"x" * 20)
    with pytest.raises(BilibiliNoteFailure, match="capacity"):
        store.save_media(stored_source(tmp_path, draft))
    assert (abandoned / "media.mp4").is_file()


async def test_cancelled_create_returns_committed_ids_for_restart(runtime):
    fixture, app = runtime
    started = asyncio.Event()

    async def blocked_author(*args):
        started.set()
        await asyncio.Event().wait()

    app._distiller.distill = blocked_author
    async with Client(build_server(app)) as client:
        task = asyncio.create_task(
            client.call_tool("video_note.create", {"url": FIXTURE_URL, "quality": "fast"})
        )
        await asyncio.wait_for(started.wait(), 5)
        task.cancel()
        result = await task
    assert result.is_error and result.structured_content["code"] == "CANCELLED"
    ids = result.structured_content["recovery"]
    assert set(ids) == {"media_id", "transcript_id", "evidence_id"}
    resumed = _use_case(fixture, deterministic=True)
    resumed._source.download = AsyncMock(side_effect=AssertionError("no redownload"))
    resumed._transcript.transcribe = AsyncMock(side_effect=AssertionError("no ASR"))
    async with Client(build_server(resumed)) as client:
        evidence = await call(client, "frames", {"evidence_id": ids["evidence_id"]})
        await call(
            client, "render", {"evidence_id": ids["evidence_id"], "note": authored(evidence)}
        )


async def test_review_resume_uses_original_transcript_without_asr(runtime):
    from types import SimpleNamespace

    fixture, app = runtime
    async with Client(build_server(app)) as client:
        media = await call(client, "download", {"url": FIXTURE_URL})
        failed = await client.call_tool(
            "video_note.transcribe", {"media_id": media["media_id"], "quality": "precise"}
        )
    raw_id = failed.structured_content["recovery"]["transcript_id"]
    raw, _ = app.artifacts.load_transcript(raw_id)
    resumed = _use_case(fixture, deterministic=True)
    resumed._transcript.transcribe = AsyncMock(side_effect=AssertionError("must not rerun ASR"))
    resumed._reviewer = SimpleNamespace(review=AsyncMock(return_value=()))
    async with Client(build_server(resumed)) as client:
        result = await call(client, "transcribe", {"transcript_id": raw_id, "quality": "precise"})
    reviewed, quality = resumed.artifacts.load_transcript(result["transcript_id"])
    assert quality == "precise"
    assert reviewed.transcript == raw.transcript
    resumed._transcript.transcribe.assert_not_awaited()
    resumed._reviewer.review.assert_awaited_once()
    async with Client(build_server(resumed)) as client:
        retained = await call(
            client, "transcribe", {"transcript_id": result["transcript_id"], "quality": "standard"}
        )
    assert retained["transcript_id"] == result["transcript_id"]
    assert retained["quality"] == "precise"
    resumed._reviewer.review.assert_awaited_once()


async def test_cancelled_review_preserves_raw_transcript(runtime):
    from types import SimpleNamespace

    _, app = runtime
    started = asyncio.Event()

    async def review(*args):
        started.set()
        await asyncio.Event().wait()

    app._reviewer = SimpleNamespace(review=review)
    async with Client(build_server(app)) as client:
        media = await call(client, "download", {"url": FIXTURE_URL})
        task = asyncio.create_task(
            client.call_tool(
                "video_note.transcribe", {"media_id": media["media_id"], "quality": "precise"}
            )
        )
        await asyncio.wait_for(started.wait(), 5)
        task.cancel()
        result = await task
    assert result.structured_content["code"] == "CANCELLED"
    ids = result.structured_content["recovery"]
    assert ids["media_id"] == media["media_id"]
    _, quality = app.artifacts.load_transcript(ids["transcript_id"])
    assert quality == "fast"
