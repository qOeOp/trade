"""
Compare a frozen AAVE video candle with causal native five-minute bars.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from itertools import pairwise
from pathlib import Path

from audit_source_daily_context import _sha
from audit_source_daily_context import _source_ideas
from audit_source_daily_context import _tree_digest

from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


FRAME_SHA256 = "098011d0681c064d948e1713863b78b5c02f26fcafd517899003531e37a9d8ba"
IDEA_UUID = "daIJgg2k"
FRAME_OHLC = {"open": 220.91, "high": 241.83, "low": 219.55, "close": 238.03}
FRAME_CLOCK = datetime(2025, 3, 6, 3, 0, 55, tzinfo=UTC)
DAY_OPEN = datetime(2025, 3, 6, tzinfo=UTC)
INTERVAL_NS = 300_000_000_000
MILLISECOND_NS = 1_000_000


def _ns(value: datetime) -> int:
    return int(value.timestamp() * 1_000_000_000)


def _aggregate(bars: list, day_open: datetime, cutoff_ns: int) -> dict:
    completed = [bar for bar in bars if bar.ts_event + MILLISECOND_NS <= cutoff_ns]
    if not completed:
        raise RuntimeError("no completed LAST bars before cutoff")
    expected_first = _ns(day_open) + INTERVAL_NS - MILLISECOND_NS
    if completed[0].ts_event != expected_first or any(
        right.ts_event - left.ts_event != INTERVAL_NS for left, right in pairwise(completed)
    ):
        raise RuntimeError("LAST bars have a coverage gap or unexpected day start")
    expected_count = (cutoff_ns - _ns(day_open)) // INTERVAL_NS
    if len(completed) != expected_count:
        raise RuntimeError("LAST bar count differs from cutoff coverage")
    return {
        "cutoff_ns": cutoff_ns,
        "bar_count": len(completed),
        "first_bar_event_ns": completed[0].ts_event,
        "last_bar_event_ns": completed[-1].ts_event,
        "last_bar_complete_ns": completed[-1].ts_event + MILLISECOND_NS,
        "ohlc": {
            "open": float(completed[0].open),
            "high": max(float(bar.high) for bar in completed),
            "low": min(float(bar.low) for bar in completed),
            "close": float(completed[-1].close),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--minute-root", type=Path, required=True)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--frame", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if _sha(args.frame) != FRAME_SHA256:
        raise RuntimeError("source frame changed")
    identity = json.loads(args.input_identity.read_text())
    if Path(identity["minute_catalog_root"]) != args.minute_root:
        raise RuntimeError("minute Catalog identity root differs")
    aave = next(row for row in identity["coins"] if row["coin"] == "AAVE")
    root = (
        args.minute_root
        if identity.get("layout") == "direct"
        else args.minute_root / "AAVE" / "minute"
    )
    digest = _tree_digest(root)
    if digest != aave["minute_catalog"]["sha256"]:
        raise RuntimeError("AAVE minute Catalog changed from registered input")
    ideas, archive_sha = _source_ideas()
    published = datetime.fromisoformat(ideas[IDEA_UUID]["created_at"])
    publication_ns = _ns(published)
    if not _ns(FRAME_CLOCK) < publication_ns < _ns(DAY_OPEN + timedelta(days=1)):
        raise RuntimeError("source publication and frame-clock candidate are not in the same day")
    completion = json.loads((root / "r1-download-complete.json").read_text())
    instrument = completion["instrument"]
    common = {
        "source_archive_sha256": archive_sha,
        "source_idea_uuid": IDEA_UUID,
        "source_published_utc": published.isoformat(),
        "source_frame_sha256": FRAME_SHA256,
        "source_frame_clock_assumption_utc": FRAME_CLOCK.isoformat(),
        "source_frame_ohlc_approx": FRAME_OHLC,
        "input_identity_sha256": _sha(args.input_identity),
        "minute_catalog_sha256": digest,
        "instrument": instrument,
        "catalog_start_ns": completion["start_ns"],
        "catalog_end_ns": completion["end_ns"],
    }
    if completion["start_ns"] > _ns(DAY_OPEN) or completion["end_ns"] < publication_ns:
        args.output.write_text(
            json.dumps(
                common
                | {
                    "status": "unavailable_outside_registered_catalog_window",
                    "scope": "Catalog coverage only; no bars, orders or PnL were read.",
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
        )
        return
    bar_type = BarType.from_str(f"{instrument}-5-MINUTE-LAST-EXTERNAL")
    catalog = ParquetDataCatalog(str(root))
    bars = sorted(
        (
            bar
            for bar in catalog.query_bars(
                [instrument],
                start=_ns(DAY_OPEN),
                end=publication_ns,
            )
            if bar.bar_type == bar_type and bar.ts_event + MILLISECOND_NS <= publication_ns
        ),
        key=lambda bar: bar.ts_event,
    )
    frame_cutoff = _aggregate(bars, DAY_OPEN, _ns(FRAME_CLOCK))
    publication_cutoff = _aggregate(bars, DAY_OPEN, publication_ns)
    break_day_open = DAY_OPEN - timedelta(days=3)
    break_day_end_ns = _ns(break_day_open + timedelta(days=1))
    break_day_bars = sorted(
        (
            bar
            for bar in catalog.query_bars(
                [instrument],
                start=_ns(break_day_open),
                end=break_day_end_ns,
            )
            if bar.bar_type == bar_type and bar.ts_event + MILLISECOND_NS <= break_day_end_ns
        ),
        key=lambda bar: bar.ts_event,
    )
    break_day = _aggregate(break_day_bars, break_day_open, break_day_end_ns)
    break_day["registered_daily_close"] = 180.85
    break_day["registered_support_lower"] = 191.99
    break_day["five_minute_close_matches_daily"] = (
        abs(break_day["ohlc"]["close"] - 180.85) < 0.000001
    )
    break_day["five_minute_close_below_support"] = break_day["ohlc"]["close"] < 191.99
    frame_cutoff["difference_from_frame"] = {
        field: round(frame_cutoff["ohlc"][field] - value, 8) for field, value in FRAME_OHLC.items()
    }
    frame_cutoff["relative_difference_from_frame"] = {
        field: round(abs(frame_cutoff["ohlc"][field] - value) / value, 8)
        for field, value in FRAME_OHLC.items()
    }
    frame_cutoff["close_within_one_percent"] = (
        frame_cutoff["relative_difference_from_frame"]["close"] <= 0.01
    )
    args.output.write_text(
        json.dumps(
            common
            | {
                "status": "read",
                "scope": "Source-clock price alignment only; no orders or PnL.",
                "frame_clock_cutoff": frame_cutoff,
                "publication_cutoff": publication_cutoff,
                "support_break_day": break_day,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
    )


if __name__ == "__main__":
    main()
