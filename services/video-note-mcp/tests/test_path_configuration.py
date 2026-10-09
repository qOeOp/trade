"""Host path configuration is explicit and portable between working directories."""

import hashlib
import json
from pathlib import Path

import pytest

from video_note_mcp.adapters.artifact_store import ArtifactStore
from video_note_mcp.adapters.asr_mlx import MlxAsr
from video_note_mcp.adapters.local_import import LocalImport
from video_note_mcp.adapters.note_publisher import LocalNotePublisher
from video_note_mcp.adapters.subprocesses import CapturedProcess
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.progress import NullProgressReporter


@pytest.mark.parametrize("configured_by", ["argument", "environment"])
def test_relative_output_is_refused_without_binding_to_cwd(
    tmp_path, draft, monkeypatch, configured_by
):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("BILIBILI_NOTE_OUTPUT_DIR", "relative-notes")
    publisher = (
        LocalNotePublisher(Path("relative-notes"))
        if configured_by == "argument"
        else LocalNotePublisher()
    )
    with pytest.raises(BilibiliNoteFailure, match="output_root_not_absolute"):
        publisher.publish((draft,))
    assert not (tmp_path / "relative-notes").exists()


def test_user_home_output_configuration_publishes_absolute_paths(tmp_path, draft, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("BILIBILI_NOTE_OUTPUT_DIR", "~/notes")
    result = LocalNotePublisher().publish((draft,))
    assert Path(result.note_path).is_relative_to(tmp_path / "notes")
    assert Path(result.note_path).is_file()


@pytest.mark.parametrize("configured_by", ["argument", "environment"])
def test_user_home_artifact_configuration_keeps_absolute_and_symlink_checks(
    tmp_path, monkeypatch, configured_by
):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("BILIBILI_NOTE_ARTIFACT_DIR", "~/artifacts")
    store = ArtifactStore(Path("~/artifacts") if configured_by == "argument" else None)
    store._root()
    assert (tmp_path / "artifacts").is_dir()
    link = tmp_path / "linked-artifacts"
    link.symlink_to(tmp_path / "artifacts", target_is_directory=True)
    with pytest.raises(BilibiliNoteFailure, match="artifact_root_invalid"):
        ArtifactStore(Path("~/linked-artifacts"))._root()


def test_user_home_import_configuration_copies_bytes_and_keeps_symlink_check(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("BILIBILI_NOTE_IMPORT_DIR", "~/inbox")
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    raw = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00"
    (inbox / "video.mp4").write_bytes(raw)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    path, digest = LocalImport()._copy("video.mp4", workspace)
    assert path.read_bytes() == raw
    assert digest == hashlib.sha256(raw).hexdigest()
    link = tmp_path / "linked-inbox"
    link.symlink_to(inbox, target_is_directory=True)
    monkeypatch.setenv("BILIBILI_NOTE_IMPORT_DIR", "~/linked-inbox")
    with pytest.raises(BilibiliNoteFailure, match="import_filename_invalid"):
        LocalImport()._copy("video.mp4", workspace)


@pytest.mark.parametrize("configured_by", ["argument", "environment"])
@pytest.mark.parametrize("configured", ["~/mlx/bin/python", "python3", "./python3"])
async def test_mlx_configuration_preserves_interpreter_selection(
    tmp_path, monkeypatch, configured_by, configured
):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("BILIBILI_NOTE_MLX_PYTHON", configured)
    commands = []

    async def captured(*args, **kwargs):
        commands.append(args)
        if args[0] == "ffmpeg":
            return CapturedProcess(0, b"", b"")
        return CapturedProcess(
            0,
            json.dumps(
                {
                    "audio_duration_ms": 4000,
                    "language": "zh",
                    "segments": [{"start_ms": 0, "end_ms": 4000, "text": "fixture"}],
                }
            ).encode(),
            b"",
        )

    monkeypatch.setattr("video_note_mcp.adapters.asr_mlx.run_captured", captured)
    engine = MlxAsr(configured if configured_by == "argument" else None)
    await engine.transcribe(tmp_path / "source.mp4", 4000, tmp_path, NullProgressReporter())
    expected = str(tmp_path / "mlx/bin/python") if configured.startswith("~") else configured
    assert commands[1][0] == expected
