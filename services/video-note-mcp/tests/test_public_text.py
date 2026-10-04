from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from conftest import make_draft
from PIL import Image

from video_note_mcp.adapters.note_publisher import LocalNotePublisher
from video_note_mcp.application.errors import BilibiliNoteFailure


@pytest.mark.parametrize(
    "payload",
    [
        "<script>alert(1)</script>",
        '<img src="https://evil.example/x" onerror="alert(1)">',
        "![external](https://evil.example/x)",
        "[click](javascript:alert(1))",
        "&lt;script&gt;alert(1)&lt;/script&gt;",
        "`code` **bold** # Heading",
    ],
)
def test_untrusted_prose_and_title_are_escaped(tmp_path, payload):
    draft = make_draft(title=payload, text=payload)
    result = LocalNotePublisher(tmp_path).publish((draft,))
    html = Path(result.html_path).read_text()
    markdown = Path(result.note_path).read_text()
    assert "<script>" not in html
    assert 'src="https://evil.example/' not in html
    assert 'href="javascript:' not in html
    assert html.count("<img ") == 2
    assert markdown.count("\n![") == 2
    assert html.count("<h1>") == 1
    assert "https://www.bilibili.com/video/" in html


def test_publisher_uses_real_png_relative_bundle_and_absolute_terminal_paths(tmp_path, draft):
    result = LocalNotePublisher(tmp_path).publish((draft,))
    assert len(result.images) == 2
    for filename, frame in zip(result.images, draft.frames, strict=True):
        assert Path(filename).is_absolute()
        assert Path(filename).read_bytes() == frame.png_bytes
        with Image.open(filename) as image:
            assert image.format == "PNG"
            assert image.size == (1280, 720)
        assert filename in result.rendered_markdown
    saved = Path(result.note_path).read_text()
    assert "images/source-1-1.png" in saved
    assert str(tmp_path) not in saved
    assert "&t=2" in saved
    assert not list(tmp_path.glob(".staging-*"))


@pytest.mark.parametrize("mutation", ["digest", "invalid_png", "dimensions"])
def test_invalid_assets_never_leave_partial_bundles(tmp_path, draft, mutation):
    frame = draft.frames[0]
    if mutation == "digest":
        frame = replace(frame, asset_ref="0" * 64)
    elif mutation == "invalid_png":
        import hashlib

        raw = b"not a png"
        frame = replace(frame, png_bytes=raw, asset_ref=hashlib.sha256(raw).hexdigest())
    else:
        frame = replace(frame, width=1)
    with pytest.raises(BilibiliNoteFailure):
        LocalNotePublisher(tmp_path).publish((replace(draft, frames=(frame, *draft.frames[1:])),))
    assert list(tmp_path.iterdir()) == []


def test_symlink_root_rejected_without_writing_target(tmp_path, draft):
    actual = tmp_path / "actual"
    actual.mkdir()
    link = tmp_path / "link"
    link.symlink_to(actual, target_is_directory=True)
    with pytest.raises(BilibiliNoteFailure, match="output_root_symlink"):
        LocalNotePublisher(link / "nested").publish((draft,))
    assert list(actual.iterdir()) == []


def test_atomic_rename_failure_rolls_back_and_preserves_existing_bundle(
    tmp_path, draft, monkeypatch
):
    publisher = LocalNotePublisher(tmp_path)
    existing = publisher.publish((draft,))
    original = Path(existing.note_path).read_bytes()

    def fail(*args):
        raise OSError("rename failed")

    monkeypatch.setattr("video_note_mcp.adapters.note_publisher.os.rename", fail)
    with pytest.raises(BilibiliNoteFailure):
        publisher.publish((draft,))
    assert Path(existing.note_path).read_bytes() == original
    assert list(tmp_path.iterdir()) == [Path(existing.note_path).parent]


def test_model_cannot_supply_paths_or_external_images(draft):
    from pydantic import ValidationError

    from video_note_mcp.domain.models import ScreenshotSelection

    for wire in (
        {"frame_id": "../../escape", "caption": "x"},
        {"frame_id": "F01", "caption": "x", "path": "/tmp/escape"},
        {"frame_id": "F01", "caption": "x", "url": "https://evil.example/x"},
    ):
        with pytest.raises(ValidationError):
            ScreenshotSelection.model_validate(wire)


def test_existing_empty_bundle_is_not_replaced(tmp_path, draft, monkeypatch):
    from types import SimpleNamespace

    existing = tmp_path / "note-collision"
    existing.mkdir()
    monkeypatch.setattr(
        "video_note_mcp.adapters.note_publisher.uuid.uuid4",
        lambda: SimpleNamespace(hex="collision"),
    )
    with pytest.raises(BilibiliNoteFailure, match="bundle_publication_failed"):
        LocalNotePublisher(tmp_path).publish((draft,))
    assert existing.is_dir()
    assert list(existing.iterdir()) == []
    assert list(tmp_path.iterdir()) == [existing]


def test_oversize_direct_terminal_is_rejected_before_commit(tmp_path, draft, monkeypatch):
    monkeypatch.setattr(
        "video_note_mcp.adapters.note_publisher.render", lambda *args, **kwargs: "x" * 262145
    )
    with pytest.raises(BilibiliNoteFailure, match="bundle_publication_failed"):
        LocalNotePublisher(tmp_path).publish((draft,))
    assert list(tmp_path.iterdir()) == []
