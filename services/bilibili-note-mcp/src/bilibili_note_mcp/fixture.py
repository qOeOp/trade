from __future__ import annotations

import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

FIXTURE_URL = "https://www.bilibili.com/video/BV1bK411W797?p=1"


def generate_fixture(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    frames = root / "frames"
    frames.mkdir(exist_ok=True)
    for frame_index in range(1, 7):
        image = Image.new("RGB", (1920, 1080), "#0b1020")
        draw = ImageDraw.Draw(image)
        draw.rectangle((100, 80, 1820, 950), outline="#334155", width=3)
        draw.text((130, 105), f"Water cycle - fixture frame {frame_index}", fill="#e2e8f0")
        for index, label in enumerate(("EVAPORATION", "CONDENSATION", "PRECIPITATION")):
            x = 160 + index * 560
            color = "#38bdf8" if index == (frame_index - 1) % 3 else "#64748b"
            draw.rounded_rectangle((x, 330, x + 450, 680), radius=30, outline=color, width=12)
            draw.text((x + 70, 490), label, fill="#e2e8f0")
            if index < 2:
                draw.line((x + 455, 500, x + 545, 500), fill="#38bdf8", width=10)
                draw.polygon(((x + 545, 500), (x + 520, 480), (x + 520, 520)), fill="#38bdf8")
        image.save(frames / f"frame-{frame_index:03d}.png", format="PNG")
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-framerate",
            "1",
            "-i",
            str(frames / "frame-%03d.png"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "1",
            "-y",
            str(root / "media.mp4"),
        ],
        check=True,
    )
    (root / "source.json").write_text(
        json.dumps(
            {
                "platform": "bilibili",
                "requested_url": FIXTURE_URL,
                "canonical_url": FIXTURE_URL,
                "video_id": "BV1bK411W797",
                "part_id": "fixture-cid-1",
                "part_index": 1,
                "title": "水循环过程演示",
                "author_name": "Offline Fixture",
                "published_at": "2026-08-11T00:00:00Z",
                "duration_ms": 6000,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (root / "subtitles.vtt").write_text(
        """WEBVTT

00:00:00.000 --> 00:00:02.000
水受热蒸发，水蒸气进入空气。

00:00:02.000 --> 00:00:04.000
水蒸气冷却后凝结为小水滴。

00:00:04.000 --> 00:00:06.000
水滴聚集后以降水的形式回到地面。
""",
        encoding="utf-8",
    )
    return root
