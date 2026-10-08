"""
Audit frozen H14a 50-percent plans against registered source cases.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_h13_source_gate import _utc
from audit_h13b_source_gate import S27
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_retracement_source_cases import CASES
from audit_retracement_source_cases import _source_band_difference
from audit_trendline_signal_parity import INPUT_SHA256
from retracement_strategy import ConfirmedSupportPullback
from strategy import FOUR_HOUR_NS
from strategy import FourHour

from vibe_trading.indicators import WilderMovingAverage
from vibe_trading.persistence import ParquetDataCatalog


REGISTRATION_COMMIT = "e796e87f2"
S27_SHA256 = "284b15c1f4ac5476e8d4f548ffa46891c40a163965fe69b4c09e07fcdfe15d1c"
S24_SHA256 = "4cac7ad01f5825513f615dad9d73abc946c43bbba93dd1417fb22c7e1bdfd577"
D29_SHA256 = "af99c02990294d60daa64f89ed8b0605e337a251f2bba2f5630f5f7885b4aede"
D40_SHA256 = "bb18921df9639f8d1383fb1580638b06e42c2f48aace4a546136829994ff0aee"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _tiers(plan: dict) -> dict[str, float]:
    high, low = plan["b_high"], plan["a_low"]
    span = high - low
    return {ratio: high - float(ratio) * span for ratio in ("0.5", "0.618", "0.764")}


def _source_differences(plan: dict, bands: dict) -> dict[str, float]:
    tiers = _tiers(plan)
    differences = {
        ratio: _source_band_difference(value, *bands[ratio]) for ratio, value in tiers.items()
    }
    for key, field in (("low_anchor", "a_low"), ("high_anchor", "b_high")):
        if key in bands:
            differences[key] = _source_band_difference(plan[field], *bands[key])
    return differences


def _plan_row(plan, instrument, bands) -> dict:
    prices = [
        instrument.make_price(value).as_double() for value in (plan.entry, plan.stop, plan.target)
    ]
    entry, stop, target = prices
    room = (target - entry) / (entry - stop) if 0 < stop < entry < target else None
    raw = plan.as_dict()
    difference = _source_differences(raw, bands)
    return {
        **raw,
        "armed_utc": _utc(plan.ts_event),
        "tiers": _tiers(raw),
        "source_band_differences": difference,
        "source_geometry_match": all(value == 0 for value in difference.values()),
        "rounded_entry_stop_target": prices,
        "rounded_target_r": room,
        "rounded_1_5r_room": room is not None and room >= 1.5,
    }


def _advance_active(active, candle, selected_pair, instrument, bands):
    if active is None or candle.ts_event <= active.ts_event:
        return active, None, False
    if candle.low <= active.entry:
        return (
            None,
            {
                "touch_utc": _utc(candle.ts_event),
                "bar_low": candle.low,
                "plan": _plan_row(active, instrument, bands),
            },
            False,
        )
    if candle.ts_event >= active.ts_event + 30 * FOUR_HOUR_NS:
        return None, None, False
    if selected_pair is not None and selected_pair != (active.a_index, active.b_index):
        return None, None, True
    return active, None, False


def _scan(candles, instrument, cutoffs, bands) -> dict:
    by_cutoff = {_ns(value): value for value in cutoffs}
    state = ConfirmedSupportPullback(
        timing="confirmed-update",
        support_mode="none",
        entry_ratio=0.5,
        minimum_target_r=1.5,
    )
    atr = WilderMovingAverage(14)
    active = None
    rows = []
    first_touches = []
    supersessions = 0
    for bar in candles:
        candle = FourHour(bar.ts_event, float(bar.high), float(bar.low), float(bar.close))
        previous_close = state.candles[-1].close if state.candles else candle.close
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - previous_close),
            abs(candle.low - previous_close),
        )
        new_plan = state.on_closed(candle, atr.value if atr.initialized else None)
        atr.update_raw(true_range)
        selected = state.last_readout["impulse"]
        pair = (selected["a_index"], selected["b_index"]) if selected is not None else None
        active, touch, superseded = _advance_active(active, candle, pair, instrument, bands)
        if touch is not None:
            first_touches.append(touch)
        supersessions += superseded
        if new_plan is not None:
            if active is not None:
                raise RuntimeError("more than one live H14a plan")
            active = new_plan
        if candle.ts_event in by_cutoff:
            selected_row = None
            if selected is not None:
                selected_row = {
                    **selected,
                    "source_band_differences": _source_differences(
                        {"a_low": selected["a_low"], "b_high": selected["b_high"]},
                        bands,
                    ),
                }
            rows.append(
                {
                    "cutoff_utc": by_cutoff[candle.ts_event],
                    "last_completed_close": candle.close,
                    "last_completed_low": candle.low,
                    "selected_impulse": selected_row,
                    "active_untouched_plan": _plan_row(active, instrument, bands)
                    if active is not None
                    else None,
                    "current_decision_reason": state.last_readout["reason"],
                },
            )
        if candle.ts_event >= max(by_cutoff):
            break
    if len(rows) != len(by_cutoff):
        raise RuntimeError("source cutoffs lack complete native four-hour bars")
    return {
        "cutoffs": rows,
        "first_touches_through_last_cutoff": first_touches,
        "supersessions": supersessions,
    }


def _first_frozen_50_touch(candles, impulse) -> str | None:
    high_ns = _ns(impulse["high_anchor_utc"])
    tier = impulse["high"] - 0.5 * (impulse["high"] - impulse["low"])
    return next(
        (_utc(bar.ts_event) for bar in candles if bar.ts_event > high_ns and bar.low <= tier),
        None,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--s27", type=Path, required=True)
    parser.add_argument("--s24", type=Path, required=True)
    parser.add_argument("--d29", type=Path, required=True)
    parser.add_argument("--d40", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for path, expected in (
        (args.input_identity, INPUT_SHA256),
        (args.parity, PARITY_SHA256),
        (args.s27, S27_SHA256),
        (args.s24, S24_SHA256),
        (args.d29, D29_SHA256),
        (args.d40, D40_SHA256),
    ):
        if _sha(path) != expected:
            raise RuntimeError(f"registered source bytes changed: {path}")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    d29 = json.loads(args.d29.read_text())
    d40 = json.loads(args.d40.read_text())
    if (
        not parity["all_exact"]
        or len(parity["coins"]) != 37
        or Path(identity["minute_catalog_root"]) != args.catalog_root
    ):
        raise RuntimeError("registered native input coverage or root changed")
    source_rows = {}
    four_hour = {}
    cases = {
        "BTC": (S27["cutoffs"] + CASES["BTC"]["cutoffs"], S27["bands"]),
        "ETH": (CASES["ETH"]["cutoffs"], CASES["ETH"]["bands"]),
    }
    for coin, (cutoffs, _) in cases.items():
        input_row = next(row for row in identity["coins"] if row["coin"] == coin)
        parity_row = next(row for row in parity["coins"] if row["coin"] == coin)
        instrument_id, candles = _read_candles(
            args.catalog_root,
            input_row,
            parity_row,
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
        native = ParquetDataCatalog(str(args.catalog_root / coin / "minute")).instruments(
            instrument_ids=[instrument_id],
        )
        if len(native) != 1 or str(native[0].id) != instrument_id:
            raise RuntimeError(f"{coin}: native Instrument mismatch")
        four_hour[coin] = candles
        source_rows[coin] = {
            "instrument": instrument_id,
            "minute_catalog_sha256": input_row["minute_catalog"]["sha256"],
            "source_audits": {
                key: _scan(candles, native[0], subcutoffs, bands)
                for key, subcutoffs, bands in (
                    ("s27_primary", S27["cutoffs"], S27["bands"]),
                    ("s24_sensitivity", CASES["BTC"]["cutoffs"], CASES["BTC"]["bands"]),
                )
            }
            if coin == "BTC"
            else {"c19_negative": _scan(candles, native[0], cutoffs, CASES["ETH"]["bands"])},
        }
    s27_rows = source_rows["BTC"]["source_audits"]["s27_primary"]["cutoffs"]
    s27_matching = [
        row
        for row in s27_rows
        if row["active_untouched_plan"] is not None
        and row["active_untouched_plan"]["source_geometry_match"]
        and row["active_untouched_plan"]["rounded_1_5r_room"]
    ]
    s24_impulse = next(case for case in d29["cases"] if case["coin"] == "BTC")["cutoffs"][0][
        "impulse"
    ]
    s24_first_50_touch = _first_frozen_50_touch(four_hour["BTC"], s24_impulse)
    c19_rows = source_rows["ETH"]["source_audits"]["c19_negative"]["cutoffs"]
    c19_false_match = any(
        row["active_untouched_plan"] is not None
        and row["active_untouched_plan"]["source_geometry_match"]
        for row in c19_rows
    )
    if len(d40["cutoffs"]) != 4 or any(row["source_geometry_lead"] for row in d40["cutoffs"]):
        raise RuntimeError("SUI D40 disagreement differs from registered source result")
    result = {
        "method": "H14a source-date 50-percent untouched/rounded-room audit; no orders, fills, account or PnL",
        "registration_commit": REGISTRATION_COMMIT,
        "audit_source_sha256": _sha(Path(__file__)),
        "input_identity_sha256": INPUT_SHA256,
        "corrected_parity_sha256": PARITY_SHA256,
        "source_sha256": {
            "S27": S27_SHA256,
            "S24": S24_SHA256,
            "D29": D29_SHA256,
            "D40": D40_SHA256,
        },
        "coins": source_rows,
        "s27_matching_untouched_plan_cutoffs": len(s27_matching),
        "s24_selected_a_b": [s24_impulse["low"], s24_impulse["high"]],
        "s24_first_50_touch_after_b_utc": s24_first_50_touch,
        "c19_wrong_anchor_false_source_match": c19_false_match,
        "sui_registered_four_hour_selector_disagreement": d40["cutoffs"],
        "passed": bool(s27_matching) and not c19_false_match,
        "economic_data_read": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
