"""
Read registered SUI source-date geometry from the existing native LAST Catalog.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_retracement_source_cases import _one_cutoff
from audit_retracement_source_cases import _source_band_difference
from audit_trendline_signal_parity import INPUT_SHA256


REGISTRATION_COMMIT = "51de37e62"
S36_SHA256 = "91e6e5e4bcc87ebc36668669b04a1c8b712479ed17e719824c4db1b69cb415be"
CUTOFFS = (
    "2026-01-07T00:00:00+00:00",
    "2026-01-07T04:00:00+00:00",
    "2026-01-07T08:00:00+00:00",
    "2026-01-07T12:00:00+00:00",
)
SOURCE_BANDS = {
    "low_anchor": (1.35, 1.42),
    "high_anchor": (2.00, 2.06),
    "0.5": (1.68, 1.74),
    "0.618": (1.60, 1.67),
    "0.764": (1.50, 1.58),
}


def _source_cutoff(candles, cutoff: str) -> dict:
    row = _one_cutoff(
        candles,
        cutoff,
        {key: SOURCE_BANDS[key] for key in ("0.5", "0.618", "0.764")},
    )
    row["anchor_band_differences"] = None
    row["first_50_touch_after_high_utc"] = None
    row["first_618_touch_after_high_utc"] = None
    row["source_geometry_lead"] = False
    impulse = row["impulse"]
    if impulse is None:
        return row
    row["anchor_band_differences"] = {
        "low_anchor": _source_band_difference(
            impulse["low"],
            *SOURCE_BANDS["low_anchor"],
        ),
        "high_anchor": _source_band_difference(
            impulse["high"],
            *SOURCE_BANDS["high_anchor"],
        ),
    }
    by_time = {candle.ts_event: i for i, candle in enumerate(candles)}
    b = by_time[_ns(impulse["high_anchor_utc"])]
    i = by_time[_ns(cutoff)]
    for candle in candles[b + 1 : i + 1]:
        if (
            row["first_50_touch_after_high_utc"] is None
            and candle.low <= row["levels"]["0.5"]["price"]
        ):
            row["first_50_touch_after_high_utc"] = _utc(candle.ts_event)
        if (
            row["first_618_touch_after_high_utc"] is None
            and candle.low <= row["levels"]["0.618"]["price"]
        ):
            row["first_618_touch_after_high_utc"] = _utc(candle.ts_event)
    row["source_geometry_lead"] = (
        row["all_levels_in_source_bands"]
        and all(difference == 0 for difference in row["anchor_band_differences"].values())
        and impulse["high_age_four_hour_bars"] <= 12
        and row["first_50_touch_after_high_utc"] is None
    )
    return row


def _utc(ns: int) -> str:
    from datetime import UTC
    from datetime import datetime

    return datetime.fromtimestamp(ns / 1e9, UTC).isoformat()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--s36", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.input_identity.read_bytes()).hexdigest() != INPUT_SHA256:
        raise RuntimeError("registered input identity bytes changed")
    if hashlib.sha256(args.parity.read_bytes()).hexdigest() != PARITY_SHA256:
        raise RuntimeError("corrected full-coverage parity bytes changed")
    if hashlib.sha256(args.s36.read_bytes()).hexdigest() != S36_SHA256:
        raise RuntimeError("S36 source evidence bytes changed")
    s36 = json.loads(args.s36.read_text())
    if (
        s36["case"] != "S36"
        or s36["source"]["media_sha256"]
        != "c0ad840743b3e8f91ecb8018ea6a865334c16b03aa1e8771cda463006d6e0608"
    ):
        raise RuntimeError("S36 original media identity differs")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    if not parity["all_exact"] or len(parity["coins"]) != 37:
        raise RuntimeError("corrected 37-coin native-input coverage is required")
    input_row = next(row for row in identity["coins"] if row["coin"] == "SUI")
    parity_row = next(row for row in parity["coins"] if row["coin"] == "SUI")
    instrument, candles = _read_candles(
        args.catalog_root,
        input_row,
        parity_row,
        _ns(parity["start_utc"]),
        _ns(parity["end_utc"]),
    )
    cutoffs = [_source_cutoff(candles, cutoff) for cutoff in CUTOFFS]
    result = {
        "method": "D40 registered SUI source-date causal four-hour geometry; no orders, fills, PnL or account replay",
        "registration_commit": REGISTRATION_COMMIT,
        "audit_source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "input_identity_sha256": INPUT_SHA256,
        "corrected_parity_sha256": PARITY_SHA256,
        "s36_source_sha256": S36_SHA256,
        "instrument": instrument,
        "minute_catalog_sha256": input_row["minute_catalog"]["sha256"],
        "source_bands": SOURCE_BANDS,
        "cutoffs": cutoffs,
        "source_geometry_lead_at_any_cutoff": any(row["source_geometry_lead"] for row in cutoffs),
        "economic_data_read": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
