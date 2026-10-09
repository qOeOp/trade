"""D84 read-only strong-breakout complement to the registered High 2 path."""

from __future__ import annotations

import bisect
import gzip
import hashlib
import io
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from audit_d80_brooks_breakout_context import native_bars
from audit_d82_post_touch_bull_response import scored_group


ROOT = Path(__file__).resolve().parent
IDENTITY = ROOT / "results/2026-10-07-input-identity.json"
D82 = ROOT / "results/2026-10-08-d82-post-touch-bull-response-bundles.json.gz"
D83 = ROOT / "results/2026-10-08-d83-high2-post-touch.json"
D83_DETAIL = ROOT / "results/2026-10-08-d83-high2-post-touch-bundles.json.gz"
OUT = ROOT / "results/2026-10-08-d84-later-bull-breakout.json"
DETAIL = ROOT / "results/2026-10-08-d84-later-bull-breakout-bundles.json.gz"
HASHES = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    D82: "3e30f06d99f4173d193a5f9051551c3412194dcb5c022d3a06146b02135788e1",
    D83: "2c94f7b360c38418d8317f1a771c5f00a586ea757dca30466ed7e82d041a90a0",
    D83_DETAIL: "57132f9b7b498df70115622219b3a4ba7e087813d0e3b1f178976725fc9d796d",
}
STATUSES = (
    "end_censored",
    "invalidated_before_signal",
    "no_strong_breakout_within_window",
    "signal_unorderable",
    "signal_no_next_bar_trigger",
    "trigger_intrabar_ambiguous",
    "potential_trigger",
)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def d(value: object) -> Decimal:
    return Decimal(str(value))


def classify(original: dict, instrument, bars: list[dict], ends: list[int]) -> dict:
    touch_i = bisect.bisect_left(ends, original["first_native_buy_fill_ns"])
    if touch_i >= len(bars) or touch_i + 5 >= len(bars):
        return {"state": "end_censored"}
    stop = d(original["original_stop_px"])
    target = d(original["original_target_b_px"])
    tick = d(instrument.price_increment)
    invalidation = None
    signal_i = None
    for i in range(touch_i, touch_i + 5):
        bar = bars[i]
        if d(bar["low"]) <= stop:
            invalidation = {"kind": "stop", "offset_from_touch": i - touch_i, "bar_end_ns": bar["end_ns"]}
            break
        if d(bar["high"]) >= target:
            invalidation = {"kind": "target", "offset_from_touch": i - touch_i, "bar_end_ns": bar["end_ns"]}
            break
        if i == touch_i:
            continue  # The containing bar is only partly post-touch.
        low = d(bar["low"])
        high = d(bar["high"])
        close = d(bar["close"])
        if (
            high > low
            and close > d(bar["open"])
            and close >= low + Decimal("0.75") * (high - low)
            and close > d(bars[i - 1]["high"])
        ):
            signal_i = i
            break
    base = {
        "touch_bar_end_ns": bars[touch_i]["end_ns"],
        "prior_stop_or_target_invalidation": invalidation,
        "signal_bar_end_ns": bars[signal_i]["end_ns"] if signal_i is not None else None,
        "original_native_closed_by_signal": any(
            p["native_close_ns"] is not None
            and signal_i is not None
            and p["native_close_ns"] <= bars[signal_i]["end_ns"]
            for p in original["native_positions"]
        ),
    }
    if invalidation is not None:
        return {**base, "state": "invalidated_before_signal"}
    if signal_i is None:
        return {**base, "state": "no_strong_breakout_within_window"}
    signal = bars[signal_i]
    next_bar = bars[signal_i + 1]
    trigger = d(instrument.make_price(float(d(signal["high"]) + tick)))
    if trigger <= d(signal["high"]):
        raise RuntimeError(f"{original['bundle_id']}: native increment did not raise trigger")
    orderable = stop < trigger < target
    reached = d(next_bar["high"]) >= trigger
    ambiguous = reached and (d(next_bar["low"]) <= stop or d(next_bar["high"]) >= target)
    if not orderable:
        state = "signal_unorderable"
    elif not reached:
        state = "signal_no_next_bar_trigger"
    elif ambiguous:
        state = "trigger_intrabar_ambiguous"
    else:
        state = "potential_trigger"
    return {
        **base,
        "state": state,
        "native_price_increment": str(tick),
        "hypothetical_stop_entry_order_time_ns": signal["end_ns"],
        "hypothetical_buy_stop_trigger": str(trigger),
        "next_full_bar_end_ns": next_bar["end_ns"],
        "next_bar_high_reached_trigger": reached,
        "next_bar_low_touched_original_stop": d(next_bar["low"]) <= stop,
        "next_bar_high_touched_original_b_target": d(next_bar["high"]) >= target,
        "target_to_stop_r_if_orderable": float((target - trigger) / (trigger - stop)) if orderable else None,
        "signal_delay_complete_four_hour_bars": signal_i - touch_i,
        "potential_trigger_delay_complete_four_hour_bars": signal_i + 1 - touch_i,
    }


def main() -> None:
    for path, expected in HASHES.items():
        if sha(path) != expected:
            raise RuntimeError(f"frozen D84 input changed: {path}")
    identity = json.loads(IDENTITY.read_text())
    d83_summary = json.loads(D83.read_text())
    if d83_summary["detail_sha256"] != HASHES[D83_DETAIL]:
        raise RuntimeError("D83 native detail pointer changed")
    with gzip.open(D82, "rt") as stream:
        originals = {row["bundle_id"]: row for row in json.load(stream)}
    with gzip.open(D83_DETAIL, "rt") as stream:
        high2 = {row["bundle_id"]: row for row in json.load(stream)}
    if len(originals) != 500 or len(high2) != 500 or set(originals) != set(high2):
        raise RuntimeError("original native bundle population changed")
    by_coin = defaultdict(list)
    for row in originals.values():
        by_coin[row["coin"]].append(row)
    rows = []
    catalog_counts = {}
    for entry in identity["coins"]:
        coin = entry["coin"]
        instrument, bars, count = native_bars(Path(identity["minute_catalog_root"]), coin, entry["minute_catalog"]["sha256"])
        ends = [bar["end_ns"] for bar in bars]
        catalog_counts[coin] = {"native_last_bars": count, "complete_four_hour_bars": len(bars)}
        for original in by_coin[coin]:
            strong = classify(original, instrument, bars, ends)
            prior = high2[original["bundle_id"]]
            rows.append({
                **original,
                "strong_breakout": strong,
                "high2_state": prior["high2_state"],
                "high2_order_time_ns": prior.get("hypothetical_stop_entry_order_time_ns"),
                "high2_target_to_stop_r": prior.get("target_to_stop_r_if_orderable"),
            })
    if len(rows) != 500 or len({row["bundle_id"] for row in rows}) != 500:
        raise RuntimeError("not all native touch bundles classified")
    rows.sort(key=lambda row: (row["first_native_buy_fill_ns"], row["bundle_id"]))
    by_status = {status: scored_group([row for row in rows if row["strong_breakout"]["state"] == status]) for status in STATUSES}
    strong_potential = [row for row in rows if row["strong_breakout"]["state"] == "potential_trigger"]
    high2_potential = [row for row in rows if row["high2_state"] == "potential_trigger"]
    overlap = [row for row in rows if row["strong_breakout"]["state"] == "potential_trigger" and row["high2_state"] == "potential_trigger"]
    union = []
    for row in rows:
        strong_ok = row["strong_breakout"]["state"] == "potential_trigger"
        high2_ok = row["high2_state"] == "potential_trigger"
        if not strong_ok and not high2_ok:
            continue
        if strong_ok and high2_ok:
            strong_time = row["strong_breakout"]["hypothetical_stop_entry_order_time_ns"]
            high2_time = row["high2_order_time_ns"]
            chosen = "high2" if high2_time <= strong_time else "strong_breakout"
        else:
            chosen = "high2" if high2_ok else "strong_breakout"
        target_r = row["high2_target_to_stop_r"] if chosen == "high2" else row["strong_breakout"]["target_to_stop_r_if_orderable"]
        union.append({**row, "selected_source_branch": chosen, "selected_target_to_stop_r": target_r})
    sum_r = sum(row["selected_target_to_stop_r"] for row in union)
    n = len(union)
    period_threshold = 119423.20655418588 / 100000 - 1
    expected_r_sum_at_60 = 0.6 * sum_r - 0.4 * n
    result = {
        "schema": "r1-native-d84-later-bull-breakout/v1",
        "preregistration_commit": "85bd3f269",
        "input_sha256": {path.name: sha(path) for path in HASHES},
        "catalog_counts": catalog_counts,
        "all_original_native_filled_bundles": scored_group(rows),
        "by_strong_breakout_state": by_status,
        "source_branch_coverage": {
            "strong_breakout_potential_triggers": len(strong_potential),
            "high2_potential_triggers": len(high2_potential),
            "overlap_potential_triggers": len(overlap),
            "unique_union_potential_triggers": n,
            "unique_union_selected_high2": sum(row["selected_source_branch"] == "high2" for row in union),
            "unique_union_selected_strong_breakout": sum(row["selected_source_branch"] == "strong_breakout" for row in union),
            "union_original_outcomes": scored_group(union),
            "sum_unique_union_geometric_target_r": sum_r,
        },
        "optimistic_unique_union_capacity_illustration": {
            "assumed_risk_fraction_of_initial_account_per_potential_trigger": 0.0025,
            "assumed_win_probability": 0.6,
            "period_return_fraction_before_fees_funding_caps_compounding": 0.0025 * expected_r_sum_at_60,
            "strict_20pct_annual_period_return_threshold_fraction": period_threshold,
            "required_win_fraction_at_25bp_before_costs": (period_threshold / 0.0025 + n) / (sum_r + n) if n else None,
            "required_risk_fraction_at_60pct_before_costs": period_threshold / expected_r_sum_at_60 if expected_r_sum_at_60 > 0 else None,
        },
        "limitations": ["Both branches use original H19a native touch clocks and old Position results, not new Strategy fills or a paired account return.", "Strong-breakout upper-quarter geometry is inherited from D82, and five complete bars from D83; neither was swept for annual PnL.", "A potential next-bar high reaching a hypothetical buy stop is not execution proof, and same-bar stop/target overlap is excluded as ambiguous.", "The unique union chooses the earlier hypothetical order time, with a fixed High 2 tie break; it is not a combined Nautilus order lifecycle.", "The 25-bp/60%-win capacity calculation assumes perfect trigger fills, exactly -1R losses, no costs or caps, and fixed initial-capital risk."],
    }
    with gzip.GzipFile(filename=str(DETAIL), mode="wb", compresslevel=6, mtime=0) as zipped:
        with io.TextIOWrapper(zipped, encoding="utf-8") as stream:
            json.dump(rows, stream, separators=(",", ":"), ensure_ascii=False)
    result["detail_file"] = DETAIL.name
    result["detail_sha256"] = sha(DETAIL)
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"coverage": {k: v for k, v in result["source_branch_coverage"].items() if k != "union_original_outcomes"}, "union_original": {k: result["source_branch_coverage"]["union_original_outcomes"][k] for k in ("native_closed", "native_winners", "original_closed_slow_winners_at_d78_third_landmark")}, "capacity": result["optimistic_unique_union_capacity_illustration"]}, indent=2))


if __name__ == "__main__":
    main()
