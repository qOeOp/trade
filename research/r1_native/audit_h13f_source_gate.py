"""
Audit preregistered H13f first-touch decisions on verified native LAST bars.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_h13_source_gate import _inside_bands
from audit_h13_source_gate import _utc
from audit_h13b_source_gate import S27
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_retracement_source_cases import CASES
from audit_trendline_signal_parity import INPUT_SHA256
from retracement_strategy import ConfirmedSupportPullback
from retracement_strategy import RetracementPlan
from retracement_strategy import classify_first_touch_rejection
from retracement_strategy import retire_first_touch_plan
from strategy import FourHour

from vibe_trading.indicators import WilderMovingAverage
from vibe_trading.persistence import ParquetDataCatalog


S23_START = _ns("2026-01-08T00:00:00+00:00")
S23_END = _ns("2026-01-09T08:00:00+00:00")
S24_ANCHORS = (87_189.2, 94_760.3)
REGISTRATION_COMMIT = "07e1e11fd68c8ad8c34bb611ecc84d4728f1d616"


def _plan_row(plan: RetracementPlan) -> dict:
    return {**plan.as_dict(), "armed_utc": _utc(plan.ts_event)}


def _matching_s24(plan: dict) -> bool:
    return (
        abs(plan["a_low"] - S24_ANCHORS[0]) < 1e-6
        and abs(plan["b_high"] - S24_ANCHORS[1]) < 1e-6
        and _inside_bands(plan, CASES["BTC"]["bands"])
    )


def _touch_event(plan: RetracementPlan, candle: FourHour, instrument, coin: str) -> dict:
    reason, entry = classify_first_touch_rejection(
        plan,
        candle,
        round_price=lambda value: instrument.make_price(value).as_double(),
    )
    return {
        "decision_utc": _utc(candle.ts_event),
        "bar_high": candle.high,
        "bar_low": candle.low,
        "bar_close": candle.close,
        "plan": _plan_row(plan),
        "reason": reason,
        "planned_market_entry": entry,
        "planned_target_r": (
            (plan.target - entry) / (entry - plan.stop)
            if entry is not None and entry > plan.stop
            else None
        ),
        "s24_anchor_and_tier_match": _matching_s24(plan.as_dict()) if coin == "BTC" else False,
        "s27_anchor_and_tier_match": (
            S27["bands"]["low_anchor"][0] <= plan.a_low <= S27["bands"]["low_anchor"][1]
            and S27["bands"]["high_anchor"][0] <= plan.b_high <= S27["bands"]["high_anchor"][1]
            and _inside_bands(plan.as_dict(), S27["bands"])
        )
        if coin == "BTC"
        else False,
        "c19_tier_match": (
            _inside_bands(plan.as_dict(), CASES["ETH"]["bands"]) if coin == "ETH" else False
        ),
    }


def _append_s23_window(rows: list[dict], item: dict, *, coin: str, ts_event: int) -> None:
    if coin == "BTC" and S23_START <= ts_event <= S23_END:
        rows.append(item)


def _scan(candles, instrument, *, coin: str, cutoffs: tuple[str, ...]) -> dict:
    cutoff_ns = {_ns(value): value for value in cutoffs}
    last_ns = max((*cutoff_ns, S23_END if coin == "BTC" else 0))
    state = ConfirmedSupportPullback(timing="confirmed-update")
    atr = WilderMovingAverage(14)
    active: RetracementPlan | None = None
    window_plans: list[dict] = []
    window_touch_events: list[dict] = []
    cutoff_rows: list[dict] = []
    counts = {"armed": 0, "superseded": 0, "expired": 0, "first_touches": 0, "admitted": 0}
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
        selected_pair = (selected["a_index"], selected["b_index"]) if selected is not None else None
        active, retirement = retire_first_touch_plan(active, selected_pair, candle.ts_event)
        if retirement is not None:
            counts[retirement] += 1
        touched_here = None
        if active is not None and candle.ts_event > active.ts_event and candle.low <= active.entry:
            touched_here = _touch_event(active, candle, instrument, coin)
            counts["first_touches"] += 1
            if touched_here["reason"] == "admitted-rejection":
                counts["admitted"] += 1
            _append_s23_window(
                window_touch_events,
                touched_here,
                coin=coin,
                ts_event=candle.ts_event,
            )
            active = None
        if new_plan is not None:
            if active is not None:
                raise RuntimeError("more than one live H13f plan")
            active = new_plan
            counts["armed"] += 1
            _append_s23_window(
                window_plans,
                _plan_row(new_plan),
                coin=coin,
                ts_event=candle.ts_event,
            )
        if candle.ts_event in cutoff_ns:
            cutoff_rows.append(
                {
                    "cutoff_utc": cutoff_ns[candle.ts_event],
                    "active_plan": _plan_row(active) if active else None,
                    "first_touch_at_cutoff": touched_here,
                    "last_readout": state.last_readout,
                },
            )
        if candle.ts_event >= last_ns:
            break
    if len(cutoff_rows) != len(cutoff_ns):
        raise RuntimeError(f"{coin}: source cutoffs lack native completed bars")
    return {
        "coin": coin,
        "instrument": str(instrument.id),
        "counts_through_last_source_cutoff": counts,
        "s23_window_armed_plans": window_plans,
        "s23_window_first_touches": window_touch_events,
        "cutoffs": cutoff_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.input_identity.read_bytes()).hexdigest() != INPUT_SHA256:
        raise RuntimeError("registered input identity bytes changed")
    if hashlib.sha256(args.parity.read_bytes()).hexdigest() != PARITY_SHA256:
        raise RuntimeError("corrected full-coverage parity bytes changed")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    if not parity["all_exact"] or len(parity["coins"]) != 37:
        raise RuntimeError("corrected 37-coin source coverage is required")
    rows = {}
    for coin in ("BTC", "ETH"):
        input_row = next(row for row in identity["coins"] if row["coin"] == coin)
        parity_row = next(row for row in parity["coins"] if row["coin"] == coin)
        instrument_id, candles = _read_candles(
            args.catalog_root,
            input_row,
            parity_row,
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
        catalog = ParquetDataCatalog(str(args.catalog_root / coin / "minute"))
        instruments = catalog.instruments(instrument_ids=[instrument_id])
        if len(instruments) != 1 or str(instruments[0].id) != instrument_id:
            raise RuntimeError(f"{coin}: native Instrument mismatch")
        rows[coin] = _scan(
            candles,
            instruments[0],
            coin=coin,
            cutoffs=CASES[coin]["cutoffs"]
            if coin == "ETH"
            else (
                *CASES["BTC"]["cutoffs"],
                *S27["cutoffs"],
            ),
        )
    s23_matching = [
        event
        for event in rows["BTC"]["s23_window_first_touches"]
        if event["s24_anchor_and_tier_match"] and event["reason"] == "admitted-rejection"
    ]
    premature = [
        cutoff
        for cutoff in rows["BTC"]["cutoffs"]
        if cutoff["first_touch_at_cutoff"] is not None
        and cutoff["first_touch_at_cutoff"]["reason"] == "admitted-rejection"
        and (
            cutoff["first_touch_at_cutoff"]["s24_anchor_and_tier_match"]
            or cutoff["first_touch_at_cutoff"]["s27_anchor_and_tier_match"]
        )
    ]
    c19_false = [
        cutoff
        for cutoff in rows["ETH"]["cutoffs"]
        if cutoff["first_touch_at_cutoff"] is not None
        and cutoff["first_touch_at_cutoff"]["reason"] == "admitted-rejection"
        and not cutoff["first_touch_at_cutoff"]["c19_tier_match"]
    ]
    s24_cutoff_plans = [
        cutoff
        for cutoff in rows["BTC"]["cutoffs"]
        if cutoff["cutoff_utc"] in CASES["BTC"]["cutoffs"]
        and cutoff["active_plan"] is not None
        and _matching_s24(cutoff["active_plan"])
    ]
    s27_cutoff_plans = [
        cutoff
        for cutoff in rows["BTC"]["cutoffs"]
        if cutoff["cutoff_utc"] in S27["cutoffs"]
        and cutoff["active_plan"] is not None
        and S27["bands"]["low_anchor"][0]
        <= cutoff["active_plan"]["a_low"]
        <= S27["bands"]["low_anchor"][1]
        and S27["bands"]["high_anchor"][0]
        <= cutoff["active_plan"]["b_high"]
        <= S27["bands"]["high_anchor"][1]
        and _inside_bands(cutoff["active_plan"], S27["bands"])
    ]
    result = {
        "method": "registered H13f source-only first-touch decision audit on native LAST Catalog; no orders, fills, account or PnL read",
        "registration_commit": REGISTRATION_COMMIT,
        "input_identity_sha256": INPUT_SHA256,
        "corrected_parity_sha256": PARITY_SHA256,
        "s23_window_start_utc": _utc(S23_START),
        "s23_window_end_utc": _utc(S23_END),
        "coins": rows,
        "s23_s24_anchor_admitted_rejections": len(s23_matching),
        "s24_untouched_matching_cutoff_plans": len(s24_cutoff_plans),
        "s27_untouched_matching_cutoff_plans": len(s27_cutoff_plans),
        "premature_matching_entries_at_s24_s27_cutoffs": len(premature),
        "c19_wrong_anchor_false_claims_at_cutoffs": len(c19_false),
        "passed": (
            bool(s23_matching)
            and bool(s24_cutoff_plans)
            and bool(s27_cutoff_plans)
            and not premature
            and not c19_false
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
