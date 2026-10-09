"""D83 read-only, five-complete-bar High 2 potential native stop-entry audit."""

from __future__ import annotations

import bisect
import gzip
import hashlib
import io
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

from audit_d80_brooks_breakout_context import native_bars
from audit_d82_post_touch_bull_response import scored_group


ROOT = Path(__file__).resolve().parent
IDENTITY = ROOT / "results/2026-10-07-input-identity.json"
D82 = ROOT / "results/2026-10-08-d82-post-touch-bull-response.json"
D82_DETAIL = ROOT / "results/2026-10-08-d82-post-touch-bull-response-bundles.json.gz"
OUT = ROOT / "results/2026-10-08-d83-high2-post-touch.json"
DETAIL = ROOT / "results/2026-10-08-d83-high2-post-touch-bundles.json.gz"
HASHES = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    D82: "209f2532bcdc8348f3e792443683ccc933f59085c4ffca41dec2a7dd6df1c7e6",
    D82_DETAIL: "3e30f06d99f4173d193a5f9051551c3412194dcb5c022d3a06146b02135788e1",
}
STATUSES = (
    "end_censored",
    "invalidated_before_setup",
    "no_high1_within_window",
    "no_lower_high_within_window",
    "setup_unorderable",
    "setup_no_trigger",
    "trigger_intrabar_ambiguous",
    "potential_trigger",
)
FOUR_HOUR_NS = 14_400_000_000_000


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def d(value: object) -> Decimal:
    return Decimal(str(value))


def classify(original: dict, instrument, bars: list[dict], ends: list[int]) -> dict:
    fill_ns = original["first_native_buy_fill_ns"]
    touch_i = bisect.bisect_left(ends, fill_ns)
    if touch_i >= len(bars) or touch_i + 5 >= len(bars):
        return {**original, "high2_state": "end_censored"}
    stop = d(original["original_stop_px"])
    target = d(original["original_target_b_px"])
    if not 0 < stop < target:
        raise RuntimeError(f"{original['bundle_id']}: native stop/target invalid")
    tick = d(instrument.price_increment)
    window = bars[touch_i : touch_i + 6]
    high1_i = None
    setup_i = None
    invalidation = None
    for i in range(touch_i, touch_i + 5):
        bar = bars[i]
        if d(bar["low"]) <= stop:
            invalidation = {"bar_offset_from_touch": i - touch_i, "kind": "stop", "bar_end_ns": bar["end_ns"]}
            break
        if d(bar["high"]) >= target:
            invalidation = {"bar_offset_from_touch": i - touch_i, "kind": "target", "bar_end_ns": bar["end_ns"]}
            break
        if i == touch_i:
            continue  # This bar is partly pre-touch; never call its highs a post-touch High 1.
        if high1_i is None:
            if d(bar["high"]) > d(bars[i - 1]["high"]):
                high1_i = i
        elif d(bar["high"]) < d(bars[i - 1]["high"]):
            setup_i = i
            break
    common = {
        **original,
        "touch_bar_end_ns": bars[touch_i]["end_ns"],
        "high1_bar_end_ns": bars[high1_i]["end_ns"] if high1_i is not None else None,
        "lower_high_setup_bar_end_ns": bars[setup_i]["end_ns"] if setup_i is not None else None,
        "prior_stop_or_target_invalidation": invalidation,
        "original_native_closed_by_setup": any(
            p["native_close_ns"] is not None
            and setup_i is not None
            and p["native_close_ns"] <= bars[setup_i]["end_ns"]
            for p in original["native_positions"]
        ),
    }
    if invalidation is not None:
        return {**common, "high2_state": "invalidated_before_setup"}
    if high1_i is None:
        return {**common, "high2_state": "no_high1_within_window"}
    if setup_i is None:
        return {**common, "high2_state": "no_lower_high_within_window"}
    trigger_i = setup_i + 1
    if trigger_i > touch_i + 5:
        raise RuntimeError("High 2 trigger escaped registered five-bar window")
    setup = bars[setup_i]
    trigger_bar = bars[trigger_i]
    trigger = d(instrument.make_price(float(d(setup["high"]) + tick)))
    if trigger <= d(setup["high"]):
        raise RuntimeError(f"{original['bundle_id']}: native tick did not increase trigger")
    orderable = stop < trigger < target
    triggered = d(trigger_bar["high"]) >= trigger
    ambiguous = triggered and (d(trigger_bar["low"]) <= stop or d(trigger_bar["high"]) >= target)
    if not orderable:
        status = "setup_unorderable"
    elif not triggered:
        status = "setup_no_trigger"
    elif ambiguous:
        status = "trigger_intrabar_ambiguous"
    else:
        status = "potential_trigger"
    return {
        **common,
        "high2_state": status,
        "native_price_increment": str(tick),
        "hypothetical_stop_entry_order_time_ns": setup["end_ns"],
        "hypothetical_buy_stop_trigger": str(trigger),
        "next_full_bar_end_ns": trigger_bar["end_ns"],
        "next_bar_high_reached_trigger": triggered,
        "next_bar_low_touched_original_stop": d(trigger_bar["low"]) <= stop,
        "next_bar_high_touched_original_b_target": d(trigger_bar["high"]) >= target,
        "target_to_stop_r_if_orderable": float((target - trigger) / (trigger - stop)) if orderable else None,
        "setup_delay_complete_four_hour_bars": setup_i - touch_i,
        "potential_trigger_delay_complete_four_hour_bars": trigger_i - touch_i,
    }


def main() -> None:
    for path, expected in HASHES.items():
        if sha(path) != expected:
            raise RuntimeError(f"frozen D83 input changed: {path}")
    identity = json.loads(IDENTITY.read_text())
    d82 = json.loads(D82.read_text())
    if d82["detail_sha256"] != HASHES[D82_DETAIL]:
        raise RuntimeError("D82 detail pointer changed")
    with gzip.open(D82_DETAIL, "rt") as stream:
        original = json.load(stream)
    if len(original) != 500 or sum(len(row["native_positions"]) for row in original) != 507:
        raise RuntimeError("original H19a native opportunity population changed")
    by_coin = defaultdict(list)
    for row in original:
        by_coin[row["coin"]].append(row)
    rows = []
    catalog_counts = {}
    for entry in identity["coins"]:
        coin = entry["coin"]
        instrument, bars, count = native_bars(Path(identity["minute_catalog_root"]), coin, entry["minute_catalog"]["sha256"])
        ends = [bar["end_ns"] for bar in bars]
        catalog_counts[coin] = {"native_last_bars": count, "complete_four_hour_bars": len(bars)}
        for original_row in by_coin[coin]:
            rows.append(classify(original_row, instrument, bars, ends))
    if len(rows) != 500 or len({row["bundle_id"] for row in rows}) != 500:
        raise RuntimeError("not all native touch opportunities classified")
    rows.sort(key=lambda row: (row["first_native_buy_fill_ns"], row["bundle_id"]))
    by_status = {status: scored_group([row for row in rows if row["high2_state"] == status]) for status in STATUSES}
    placed = [row for row in rows if row.get("hypothetical_stop_entry_order_time_ns") is not None and row["high2_state"] != "setup_unorderable"]
    potential = [row for row in rows if row["high2_state"] == "potential_trigger"]
    candidate_r = sorted(row["target_to_stop_r_if_orderable"] for row in potential)
    # An explicitly optimistic stand-alone capacity illustration. Every
    # potential event is assumed filled at its trigger, all 25 bp of account
    # equity risk is available, losers lose exactly 1R, and fees/caps vanish.
    # It is not a native portfolio score or an edge estimate.
    sum_target_r = sum(candidate_r)
    required_period_fraction = 119423.20655418588 / 100000 - 1
    illustrated_period_fraction_at_60pct = 0.0025 * (0.6 * sum_target_r - 0.4 * len(potential))
    required_win_fraction_at_25bp = (
        required_period_fraction / 0.0025 + len(potential)
    ) / (sum_target_r + len(potential)) if potential else None
    required_risk_fraction_at_60pct = (
        required_period_fraction / (0.6 * sum_target_r - 0.4 * len(potential))
        if 0.6 * sum_target_r - 0.4 * len(potential) > 0 else None
    )
    result = {
        "schema": "r1-native-d83-high2-post-touch/v1",
        "preregistration_commit": "ee38e7f85",
        "input_sha256": {path.name: sha(path) for path in HASHES},
        "catalog_counts": catalog_counts,
        "all_original_native_filled_bundles": scored_group(rows),
        "by_high2_state": by_status,
        "causal_orderability": {
            "native_filled_bundle_opportunities": len(rows),
            "hypothetical_causally_placeable_stop_orders": len(placed),
            "potential_next_bar_triggers_without_same_bar_stop_or_target_ambiguity": len(potential),
            "trigger_intrabar_ambiguous": len([row for row in rows if row["high2_state"] == "trigger_intrabar_ambiguous"]),
            "median_target_to_original_stop_r_among_potential_triggers": candidate_r[len(candidate_r) // 2] if candidate_r else None,
            "original_winning_positions_among_potential_triggers": by_status["potential_trigger"]["native_winners"],
            "original_slow_winning_positions_among_potential_triggers": by_status["potential_trigger"]["original_closed_slow_winners_at_d78_third_landmark"],
        },
        "optimistic_standalone_capacity_illustration": {
            "hypothetical_risk_fraction_of_initial_account_per_potential_trigger": 0.0025,
            "assumed_all_potential_triggers_fill_at_trigger": True,
            "assumed_loser_r": -1,
            "assumed_win_probability": 0.6,
            "sum_geometric_target_r": sum_target_r,
            "period_return_fraction_before_fee_funding_caps_compounding": illustrated_period_fraction_at_60pct,
            "strict_20pct_annual_period_return_threshold_fraction": required_period_fraction,
            "required_win_fraction_at_25bp_before_costs": required_win_fraction_at_25bp,
            "required_risk_fraction_per_event_at_60pct_before_costs": required_risk_fraction_at_60pct,
        },
        "limitations": ["The touch time is an original H19a native BUY fill, so this is selected-opportunity coverage, not a replay of a later entry rule.", "A completed next bar whose high reaches a hypothetical native buy stop is not proof of a native order or fill; no substitute fee, funding or account path was created.", "The five-full-bar horizon is the sole registered interpretation of a few bars, not an optimized parameter.", "Touch-containing bar extrema can predate the fill; using them for structural invalidation is conservative and may censor a valid later setup.", "A potential trigger bar that also touches old stop or target is separated because four-hour OHLC cannot establish intrabar order."],
    }
    with gzip.GzipFile(filename=str(DETAIL), mode="wb", compresslevel=6, mtime=0) as zipped:
        with io.TextIOWrapper(zipped, encoding="utf-8") as stream:
            json.dump(rows, stream, separators=(",", ":"), ensure_ascii=False)
    result["detail_file"] = DETAIL.name
    result["detail_sha256"] = sha(DETAIL)
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"causal_orderability": result["causal_orderability"], "capacity": result["optimistic_standalone_capacity_illustration"], "states": {k: {m: v[m] for m in ("filled_bundles", "native_winners", "original_closed_slow_winners_at_d78_third_landmark")} for k, v in by_status.items()}}, indent=2))


if __name__ == "__main__":
    main()
