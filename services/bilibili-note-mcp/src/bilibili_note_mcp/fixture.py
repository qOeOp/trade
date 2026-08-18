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
        draw.text(
            (130, 105), f"BTCUSDT 1H - research fixture - frame {frame_index}", fill="#e2e8f0"
        )
        support_y = 790 - frame_index * 5
        resistance_y = 295 + frame_index * 3
        draw.line((130, support_y, 1790, support_y), fill="#22c55e", width=8)
        draw.line((130, resistance_y, 1790, resistance_y), fill="#ef4444", width=8)
        draw.text((1450, support_y + 12), "SUPPORT 62,000", fill="#86efac")
        draw.text((1450, resistance_y - 28), "RESISTANCE 68,000", fill="#fca5a5")
        for candle in range(38):
            x = 160 + candle * 42
            drift = candle * 6 - 100 + frame_index * 8
            center = 650 - drift
            opening = center + (28 if candle % 3 == 0 else -18)
            closing = center + (-26 if candle % 3 == 0 else 22)
            high = min(opening, closing) - 38
            low = max(opening, closing) + 42
            color = "#22c55e" if closing < opening else "#ef4444"
            draw.line((x, high, x, low), fill=color, width=4)
            draw.rectangle(
                (x - 10, min(opening, closing), x + 10, max(opening, closing)), fill=color
            )
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
                "title": "支撑阻力研究假设示例",
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
视频展示了价格在支撑区域附近企稳的示例。

00:00:02.000 --> 00:00:04.000
上方阻力区域用于观察价格是否出现反应。

00:00:04.000 --> 00:00:06.000
具体市场、周期和风险参数需要进一步验证。
""",
        encoding="utf-8",
    )
    return root
