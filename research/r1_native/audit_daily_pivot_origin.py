"""
D42 causal daily-origin geometry on registered native Binance Catalogs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_daily_signal_counts import DAY_NS
from audit_daily_signal_counts import _daily_bars
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_retracement_source_cases import CASES
from audit_retracement_source_cases import _source_band_difference
from audit_source_daily_context import _tree_digest
from audit_sui_tier_geometry import CUTOFFS as SUI_CUTOFFS
from audit_sui_tier_geometry import SOURCE_BANDS as SUI_BANDS
from audit_trendline_signal_parity import INPUT_SHA256
from strategy import BOX_BARS


REGISTRATION_COMMIT = "9d32263e5"
S36_SHA256 = "91e6e5e4bcc87ebc36668669b04a1c8b712479ed17e719824c4db1b69cb415be"
D29_SHA256 = "af99c02990294d60daa64f89ed8b0605e337a251f2bba2f5630f5f7885b4aede"
D40_SHA256 = "bb18921df9639f8d1383fb1580638b06e42c2f48aace4a546136829994ff0aee"
FOUR_HOUR_NS = 4 * 60 * 60 * 1_000_000_000
DAILY_ORDER = 3
DAILY_LOOKBACK_DAYS = 30
MIN_ANCHOR_SPAN = 6
RATIOS = ("0.5", "0.618", "0.764")


def _utc(ns: int) -> str:
    from datetime import UTC
    from datetime import datetime

    return datetime.fromtimestamp(ns / 1e9, UTC).isoformat()


def _daily_pivots(days, cutoff_ns: int) -> list[int]:
    """
    Return only order-3 lows whose three right-hand days are closed.
    """
    last_available = max(i for i, day in enumerate(days) if day.available_ns <= cutoff_ns)
    return [
        j
        for j in range(DAILY_ORDER, last_available - DAILY_ORDER + 1)
        if days[j].low == min(days[k].low for k in range(j - DAILY_ORDER, j + DAILY_ORDER + 1))
    ]


def _one_cutoff(candles, days, cutoff: str, bands: dict, anchor_bands: dict) -> dict:
    cutoff_ns = _ns(cutoff)
    by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
    decision_i = by_time.get(cutoff_ns)
    if decision_i is None or decision_i < BOX_BARS:
        raise RuntimeError(f"incomplete four-hour history at {cutoff}")
    known = candles[: decision_i + 1]
    first_b = decision_i - BOX_BARS + 1
    b = max(range(first_b, decision_i + 1), key=lambda j: (float(known[j].high), -j))
    b_ns = known[b].ts_event
    high = float(known[b].high)
    pivot_candidates = [
        j
        for j in _daily_pivots(days, cutoff_ns)
        if cutoff_ns - DAILY_LOOKBACK_DAYS * DAY_NS <= days[j].available_ns < b_ns
    ]
    row = {
        "decision_utc": cutoff,
        "last_completed_four_hour_utc": _utc(known[-1].ts_event),
        "last_completed_close": float(known[-1].close),
        "selected_high_utc": _utc(b_ns),
        "selected_high": high,
        "high_age_four_hour_bars": decision_i - b,
        "eligible_daily_pivot_count": len(pivot_candidates),
        "selected_daily_pivot": None,
        "no_impulse_reason": None,
        "impulse": None,
        "levels": None,
        "anchor_band_differences": None,
        "all_levels_in_source_bands": False,
        "first_50_touch_after_high_utc": None,
        "source_geometry_lead": False,
    }
    if not pivot_candidates:
        row["no_impulse_reason"] = "no confirmed daily low in the 30-day window before B"
        return row
    a = pivot_candidates[-1]
    low = float(days[a].low)
    span_bars = (b_ns - days[a].available_ns) // FOUR_HOUR_NS
    row["selected_daily_pivot"] = {
        "pivot_day_close_utc": _utc(days[a].available_ns),
        "pivot_day_low": low,
        "three_day_confirmation_utc": _utc(days[a + DAILY_ORDER].available_ns),
        "span_four_hour_bars_from_pivot_day_close": span_bars,
    }
    if span_bars < MIN_ANCHOR_SPAN:
        row["no_impulse_reason"] = "latest daily low is fewer than six four-hour bars before B"
        return row
    if high <= low:
        row["no_impulse_reason"] = "selected high does not exceed selected daily low"
        return row
    if float(known[-1].close) >= high:
        row["no_impulse_reason"] = "current completed close is not below selected high"
        return row
    row["impulse"] = {
        "low_anchor_utc": _utc(days[a].available_ns),
        "low_confirmed_utc": _utc(days[a + DAILY_ORDER].available_ns),
        "low": low,
        "high_anchor_utc": _utc(b_ns),
        "high": high,
        "high_age_four_hour_bars": decision_i - b,
        "anchor_span_four_hour_bars": span_bars,
    }
    row["levels"] = {
        ratio: {
            "price": high - float(ratio) * (high - low),
            "source_chart_band": list(bands[ratio]),
            "signed_difference_from_band": _source_band_difference(
                high - float(ratio) * (high - low),
                *bands[ratio],
            ),
        }
        for ratio in RATIOS
    }
    row["all_levels_in_source_bands"] = all(
        level["signed_difference_from_band"] == 0 for level in row["levels"].values()
    )
    if anchor_bands:
        row["anchor_band_differences"] = {
            "low_anchor": _source_band_difference(low, *anchor_bands["low_anchor"]),
            "high_anchor": _source_band_difference(high, *anchor_bands["high_anchor"]),
        }
    for bar in known[b + 1 :]:
        if bar.low <= row["levels"]["0.5"]["price"]:
            row["first_50_touch_after_high_utc"] = _utc(bar.ts_event)
            break
    row["source_geometry_lead"] = (
        row["all_levels_in_source_bands"]
        and (not anchor_bands or all(x == 0 for x in row["anchor_band_differences"].values()))
        and (not anchor_bands or row["first_50_touch_after_high_utc"] is None)
    )
    return row


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--s36", type=Path, required=True)
    parser.add_argument("--d29", type=Path, required=True)
    parser.add_argument("--d40", type=Path, required=True)
    parser.add_argument("--minute-root", type=Path, required=True)
    parser.add_argument("--daily-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for path, expected in (
        (args.input_identity, INPUT_SHA256),
        (args.parity, PARITY_SHA256),
        (args.s36, S36_SHA256),
        (args.d29, D29_SHA256),
        (args.d40, D40_SHA256),
    ):
        if _sha(path) != expected:
            raise RuntimeError(f"registered source bytes changed: {path}")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    if (
        not parity["all_exact"]
        or len(parity["coins"]) != 37
        or Path(identity["minute_catalog_root"]) != args.minute_root
        or Path(identity["daily_catalog_root"]) != args.daily_root
    ):
        raise RuntimeError("registered Catalog roots or full-coverage parity changed")
    d29 = json.loads(args.d29.read_text())
    d40 = json.loads(args.d40.read_text())
    identities = {row["coin"]: row for row in identity["coins"]}
    parities = {row["coin"]: row for row in parity["coins"]}
    cases = {
        "SUI": (SUI_CUTOFFS, {ratio: SUI_BANDS[ratio] for ratio in RATIOS}, SUI_BANDS),
        "BTC": (CASES["BTC"]["cutoffs"], CASES["BTC"]["bands"], None),
        "ETH": (CASES["ETH"]["cutoffs"], CASES["ETH"]["bands"], None),
    }
    result = {
        "method": "D42 fixed daily order-3 low origin; source geometry only, no orders or PnL",
        "registration_commit": REGISTRATION_COMMIT,
        "audit_source_sha256": _sha(Path(__file__)),
        "input_identity_sha256": INPUT_SHA256,
        "corrected_parity_sha256": PARITY_SHA256,
        "s36_source_sha256": S36_SHA256,
        "d29_result_sha256": D29_SHA256,
        "d40_result_sha256": D40_SHA256,
        "daily_pivot_order": DAILY_ORDER,
        "daily_lookback_days": DAILY_LOOKBACK_DAYS,
        "cases": {},
        "economic_data_read": False,
    }
    for coin, (cutoffs, bands, anchor_bands) in cases.items():
        input_row = identities[coin]
        daily_hash = _tree_digest(args.daily_root / coin / "daily")
        if daily_hash != input_row["daily_catalog"]["sha256"]:
            raise RuntimeError(f"{coin}: daily Catalog changed from registered identity")
        instrument, candles = _read_candles(
            args.minute_root,
            input_row,
            parities[coin],
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
        days, warmup_count, aggregated_count = _daily_bars(
            args.daily_root,
            args.minute_root,
            coin,
            instrument,
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
        rows = [_one_cutoff(candles, days, cutoff, bands, anchor_bands) for cutoff in cutoffs]
        if coin == "SUI":
            expected = d40["cutoffs"]
        else:
            expected = next(case["cutoffs"] for case in d29["cases"] if case["coin"] == coin)
        if len(rows) != len(expected) or any(
            row["decision_utc"] != old["decision_utc"]
            or row["selected_high_utc"] != old["impulse"]["high_anchor_utc"]
            or row["selected_high"] != old["impulse"]["high"]
            for row, old in zip(rows, expected, strict=True)
        ):
            raise RuntimeError(f"{coin}: B anchor changed from D29/D40")
        result["cases"][coin] = {
            "instrument": instrument,
            "minute_catalog_sha256": input_row["minute_catalog"]["sha256"],
            "daily_catalog_sha256": daily_hash,
            "external_daily_warmup_bars": warmup_count,
            "five_minute_aggregated_daily_bars": aggregated_count,
            "source_bands": bands,
            "anchor_bands": anchor_bands
            and {key: anchor_bands[key] for key in ("low_anchor", "high_anchor")},
            "cutoffs": rows,
            "geometry_lead_at_any_cutoff": any(row["source_geometry_lead"] for row in rows),
        }
    result["all_three_assets_have_geometry_lead"] = all(
        row["geometry_lead_at_any_cutoff"] for row in result["cases"].values()
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
