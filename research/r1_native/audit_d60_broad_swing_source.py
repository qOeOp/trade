"""
Read the preregistered D60 broad-swing source gate from native LAST bars.

This diagnostic selects causal A/B geometry and tracks prospective order reach. It does
not create fills, estimate PnL, or replace a Nautilus backtest.

"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_h13_source_gate import _utc
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_s44_h15a_source_geometry import A_BAND
from audit_s44_h15a_source_geometry import B_BAND
from audit_s44_h15a_source_geometry import S44_SHA256
from audit_s44_h15a_source_geometry import SOURCE_CUTOFF_NS
from audit_s44_h15a_source_geometry import SOURCE_START_NS
from audit_trendline_signal_parity import INPUT_SHA256
from strategy import STOP_BUFFER_ATR
from strategy import FourHour

from vibe_trading.indicators import WilderMovingAverage


REGISTRATION_COMMIT = "150c36d37299b8bf8723f82ed7b940a0578518fb"
PIVOT_ORDER = 8
ANCHOR_LOOKBACK = 180
BOX_BARS = 60
MIN_ANCHOR_SPAN = 6
PLAN_LIFE_BARS = 180
S27_CUTOFFS = {_ns("2026-04-10T00:00:00Z"), _ns("2026-04-10T04:00:00Z")}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _pivot_low(candles: list[FourHour], j: int) -> bool:
    window = candles[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]
    return candles[j].low == min(bar.low for bar in window)


def _selected(candles: list[FourHour], i: int, prior_atr: float | None) -> dict | None:
    if i + 1 < ANCHOR_LOOKBACK or prior_atr is None or prior_atr <= 0:
        return None
    b = max(range(i - BOX_BARS + 1, i + 1), key=lambda j: (candles[j].high, -j))
    eligible = [
        j
        for j in range(max(PIVOT_ORDER, b - ANCHOR_LOOKBACK + 1), b - MIN_ANCHOR_SPAN + 1)
        if j + PIVOT_ORDER <= b and _pivot_low(candles, j)
    ]
    if not eligible:
        return None
    a = min(eligible, key=lambda j: (candles[j].low, j))
    low, high = candles[a].low, candles[b].high
    if not 0 < low < high:
        return None
    span = high - low
    return {
        "a_index": a,
        "b_index": b,
        "a_low": low,
        "b_high": high,
        "level_50": high - 0.5 * span,
        "level_618": high - 0.618 * span,
        "level_764": high - 0.764 * span,
        "stop": high - 0.764 * span - STOP_BUFFER_ATR * prior_atr,
        "target": high,
    }


def _eligible_at_decision(candles: list[FourHour], i: int, selected: dict) -> bool:
    b = selected["b_index"]
    return candles[i].close > selected["level_50"] and all(
        candles[j].low > selected["level_50"] for j in range(b + 1, i + 1)
    )


def _source_match(geometry: dict) -> bool:
    return (
        A_BAND[0] <= geometry["a_low"] <= A_BAND[1] and B_BAND[0] <= geometry["b_high"] <= B_BAND[1]
    )


def _plan_row(selected: dict, i: int, candle: FourHour, candles: list[FourHour]) -> dict:
    return {
        **selected,
        "a_close_utc": _utc(candles[selected["a_index"]].ts_event),
        "b_close_utc": _utc(candles[selected["b_index"]].ts_event),
        "armed_index": i,
        "armed_utc": _utc(candle.ts_event),
        "source_band_match": _source_match(selected),
        "first_50_reach_utc": None,
        "first_618_reach_utc": None,
        "first_reach_bar_below_stop": False,
        "retired_reason": None,
        "retired_utc": None,
    }


def _record_selected(
    selected_pairs: dict[tuple[int, int], dict],
    selected: dict,
    pair: tuple[int, int],
    candle: FourHour,
    state: list[FourHour],
) -> None:
    if pair not in selected_pairs:
        selected_pairs[pair] = {
            **selected,
            "a_close_utc": _utc(state[pair[0]].ts_event),
            "b_close_utc": _utc(state[pair[1]].ts_event),
            "first_selected_utc": _utc(candle.ts_event),
            "selected_complete_bars": 0,
            "source_band_match": _source_match(selected),
        }
    selected_pairs[pair]["selected_complete_bars"] += 1


def _advance_active(active: dict | None, selected: dict | None, i: int, candle: FourHour):
    if active is None or i <= active["armed_index"]:
        return active
    reason = None
    if i >= active["armed_index"] + PLAN_LIFE_BARS:
        reason = "expired"
    elif (
        active["first_50_reach_utc"] is None
        and selected is not None
        and selected["b_high"] > active["b_high"]
    ):
        reason = "new_strictly_higher_b_before_first_reach"
    if reason is not None:
        active["retired_reason"] = reason
        active["retired_utc"] = _utc(candle.ts_event)
        return None
    if active["first_50_reach_utc"] is None and candle.low <= active["level_50"]:
        active["first_50_reach_utc"] = _utc(candle.ts_event)
        active["first_reach_bar_below_stop"] = candle.low <= active["stop"]
    if active["first_618_reach_utc"] is None and candle.low <= active["level_618"]:
        active["first_618_reach_utc"] = _utc(candle.ts_event)
    return active


def _scan(candles: list) -> dict:
    state: list[FourHour] = []
    atr = WilderMovingAverage(14)
    selected_pairs: dict[tuple[int, int], dict] = {}
    planned_pairs: set[tuple[int, int]] = set()
    plans: list[dict] = []
    active: dict | None = None
    source_bars = 0
    countercases: list[dict] = []
    for raw in candles:
        if raw.ts_event >= SOURCE_CUTOFF_NS:
            break
        candle = FourHour(raw.ts_event, float(raw.high), float(raw.low), float(raw.close))
        prior_close = state[-1].close if state else candle.close
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - prior_close),
            abs(candle.low - prior_close),
        )
        state.append(candle)
        i = len(state) - 1
        selected = _selected(state, i, atr.value if atr.initialized else None)
        atr.update_raw(true_range)
        pair = (selected["a_index"], selected["b_index"]) if selected else None
        if SOURCE_START_NS <= candle.ts_event < SOURCE_CUTOFF_NS:
            source_bars += 1
            if selected is not None:
                _record_selected(selected_pairs, selected, pair, candle, state)

        active = _advance_active(active, selected, i, candle)

        if (
            active is None
            and pair is not None
            and pair not in planned_pairs
            and _eligible_at_decision(state, i, selected)
        ):
            active = _plan_row(selected, i, candle, state)
            planned_pairs.add(pair)
            if SOURCE_START_NS <= candle.ts_event < SOURCE_CUTOFF_NS:
                plans.append(active)
        if candle.ts_event in S27_CUTOFFS:
            countercases.append(
                {
                    "cutoff_utc": _utc(candle.ts_event),
                    "selected": selected,
                    "active": {**active} if active is not None else None,
                    "s27_source_a": 67_711.0,
                    "s27_source_b": 72_858.5,
                },
            )
    if active is not None and active in plans:
        active["retired_reason"] = "live_at_source_cutoff"
    if source_bars != 372 or len(countercases) != len(S27_CUTOFFS):
        raise RuntimeError("source-window or S27 cutoff coverage changed")
    matched = [row for row in plans if row["source_band_match"]]
    passed = [row for row in matched if row["first_50_reach_utc"] is not None]
    return {
        "complete_source_window_four_hour_bars": source_bars,
        "distinct_selected_pairs": len(selected_pairs),
        "source_band_selected_pairs": sum(
            row["source_band_match"] for row in selected_pairs.values()
        ),
        "armed_source_window_bundles": len(plans),
        "source_band_armed_bundles": len(matched),
        "source_band_live_first_50_reaches": len(passed),
        "source_gate_pass": bool(passed),
        "s27_local_wave_countercases": countercases,
        "selected_pairs": sorted(
            selected_pairs.values(),
            key=lambda row: (row["a_index"], row["b_index"]),
        ),
        "bundles": plans,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--s44", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for path, expected in (
        (args.input_identity, INPUT_SHA256),
        (args.parity, PARITY_SHA256),
        (args.s44, S44_SHA256),
    ):
        if _sha(path) != expected:
            raise RuntimeError(f"frozen input changed: {path}")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    if not parity["all_exact"] or len(parity["coins"]) != 37:
        raise RuntimeError("complete 37-coin parity required")
    btc_input = next(row for row in identity["coins"] if row["coin"] == "BTC")
    btc_parity = next(row for row in parity["coins"] if row["coin"] == "BTC")
    instrument, candles = _read_candles(
        Path(identity["minute_catalog_root"]),
        btc_input,
        btc_parity,
        _ns(parity["start_utc"]),
        _ns(parity["end_utc"]),
    )
    if instrument != "BTCUSDT-PERP.BINANCE":
        raise RuntimeError("BTC Binance perpetual identity changed")
    output = {
        "schema": "r1-native-read-only-source-diagnostic/v1",
        "id": "D60",
        "registration_commit": REGISTRATION_COMMIT,
        "method": "preregistered broad-swing BTC A/B source gate on complete native LAST four-hour candles; no fills, PnL or annual score",
        "input_sha256": {
            "identity": INPUT_SHA256,
            "parity": PARITY_SHA256,
            "s44": S44_SHA256,
        },
        "instrument_id": instrument,
        "source_window_utc": [_utc(SOURCE_START_NS), _utc(SOURCE_CUTOFF_NS)],
        "source_frame_bands": {"a_low": list(A_BAND), "b_high": list(B_BAND)},
        "frozen_parameters": {
            "pivot_order": PIVOT_ORDER,
            "anchor_lookback_at_b": ANCHOR_LOOKBACK,
            "b_max_window": BOX_BARS,
            "minimum_span": MIN_ANCHOR_SPAN,
            "bundle_life_bars": PLAN_LIFE_BARS,
            "entry_ratios": [0.5, 0.618],
            "stop_ratio": 0.764,
            "stop_buffer_prior_atr": STOP_BUFFER_ATR,
        },
        **_scan(candles),
        "economic_data_read": False,
        "limitations": [
            "The source frame is from a different venue and has broad visual bands.",
            "LAST-bar level reach is not a verified Nautilus fill; same-bar stop ambiguity is retained.",
            "S44 source geometry cannot independently qualify profitability on the exposed year.",
        ],
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
