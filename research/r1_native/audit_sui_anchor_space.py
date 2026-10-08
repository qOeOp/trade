"""
Enumerate D41's complete causal SUI low-anchor space without selecting a plan.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_retracement_source_cases import _anchor_space
from audit_retracement_source_cases import _source_band_difference
from audit_sui_tier_geometry import CUTOFFS
from audit_sui_tier_geometry import SOURCE_BANDS
from audit_sui_tier_geometry import _utc
from audit_trendline_signal_parity import INPUT_SHA256


REGISTRATION_COMMIT = "13b040b40"
D40_SHA256 = "bb18921df9639f8d1383fb1580638b06e42c2f48aace4a546136829994ff0aee"


def _one_space(candles, cutoff: str, d40_row: dict) -> dict:
    row = _anchor_space(
        candles,
        cutoff,
        {key: SOURCE_BANDS[key] for key in ("0.5", "0.618", "0.764")},
        d40_row,
    )
    by_time = {candle.ts_event: i for i, candle in enumerate(candles)}
    b = by_time[_ns(row["selected_high_utc"])]
    i = by_time[_ns(cutoff)]
    row["last_completed_close"] = float(candles[i].close)
    if row["last_completed_close"] >= row["selected_high"]:
        raise RuntimeError(f"D41 decision close reached B at {cutoff}")
    for candidate in row["candidates"]:
        low = candidate["low"]
        candidate["low_anchor_band_difference"] = _source_band_difference(
            low,
            *SOURCE_BANDS["low_anchor"],
        )
        level_50 = candidate["levels"]["0.5"]["price"]
        candidate["first_50_touch_after_high_utc"] = next(
            (_utc(candle.ts_event) for candle in candles[b + 1 : i + 1] if candle.low <= level_50),
            None,
        )
        candidate["all_anchor_and_tier_bands_match"] = (
            candidate["valid_impulse"]
            and candidate["low_anchor_band_difference"] == 0
            and candidate["all_levels_in_source_bands"]
        )
    row["source_band_match_count"] = sum(
        candidate["all_anchor_and_tier_bands_match"] for candidate in row["candidates"]
    )
    row["untouched_source_band_match_count"] = sum(
        candidate["all_anchor_and_tier_bands_match"]
        and candidate["first_50_touch_after_high_utc"] is None
        for candidate in row["candidates"]
    )
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--d40", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.input_identity.read_bytes()).hexdigest() != INPUT_SHA256:
        raise RuntimeError("registered input identity bytes changed")
    if hashlib.sha256(args.parity.read_bytes()).hexdigest() != PARITY_SHA256:
        raise RuntimeError("corrected full-coverage parity bytes changed")
    if hashlib.sha256(args.d40.read_bytes()).hexdigest() != D40_SHA256:
        raise RuntimeError("D40 result bytes changed")
    d40 = json.loads(args.d40.read_text())
    if d40["instrument"] != "SUIUSDT-PERP.BINANCE" or d40["source_bands"] != {
        key: list(value) for key, value in SOURCE_BANDS.items()
    }:
        raise RuntimeError("D40 instrument or source bands changed")
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
    d40_cutoffs = {row["decision_utc"]: row for row in d40["cutoffs"]}
    if set(d40_cutoffs) != set(CUTOFFS):
        raise RuntimeError("D40 cutoff set changed")
    cutoffs = [_one_space(candles, cutoff, d40_cutoffs[cutoff]) for cutoff in CUTOFFS]
    result = {
        "method": "D41 complete causal SUI order-8 low space; no anchor selected, orders, fills, PnL or account replay",
        "registration_commit": REGISTRATION_COMMIT,
        "audit_source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "d40_result_sha256": D40_SHA256,
        "input_identity_sha256": INPUT_SHA256,
        "corrected_parity_sha256": PARITY_SHA256,
        "instrument": instrument,
        "minute_catalog_sha256": input_row["minute_catalog"]["sha256"],
        "source_bands": SOURCE_BANDS,
        "cutoffs": cutoffs,
        "any_source_band_match": any(row["source_band_match_count"] for row in cutoffs),
        "economic_data_read": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
