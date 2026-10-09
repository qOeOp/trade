"""Read-only, causally timed post-touch strong bull response orderability audit."""

from __future__ import annotations

import bisect
import gzip
import hashlib
import io
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

from audit_d80_brooks_breakout_context import native_bars, summarize


ROOT = Path(__file__).resolve().parent
IDENTITY = ROOT / "results/2026-10-07-input-identity.json"
D77 = ROOT / "results/2026-10-08-d77-native-entry-geometry-bundles.json.gz"
D78 = ROOT / "results/2026-10-08-d78-post-fill-asset-path-positions.json.gz"
D80 = ROOT / "results/2026-10-08-d80-brooks-breakout-context-bundles.json.gz"
SUMMARY = Path("/tmp/r1-h22a-paired-h19a-37/summary.json")
OUT = ROOT / "results/2026-10-08-d82-post-touch-bull-response.json"
DETAIL = ROOT / "results/2026-10-08-d82-post-touch-bull-response-bundles.json.gz"
HASHES = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    D77: "ed66b59b9f8db091572aaec1fb65146c629686cc94954fa3cb6fc991034c56b0",
    D78: "ad31d3f3cf4fa1981ccea7ccf5c6289a927c86b781a7b4cd85adaef8316afd6e",
    D80: "ac941cfa197cee805c38d7447c296e05aa5819344312cd755e5d574dcac192c4",
    SUMMARY: "cd0212f4c6880469c5d5b9db0b8b931618590fc2914bff42417e95ea9e41b555",
}
STATUSES = (
    "end_censored",
    "no_bull_response",
    "signal_but_stop_crossed",
    "signal_but_original_closed",
    "signal_but_unorderable",
    "orderable_signal",
)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def closed_slow_winners(positions: list[dict]) -> int:
    return sum(
        p["closed"]
        and Decimal(p["native_final_realized_pnl_usdt"]) > 0
        and p["landmarks"]["3"]["state"] == "observed"
        and p["landmarks"]["3"]["mfe_first_r"] < 0.5
        for p in positions
    )


def scored_group(rows: list[dict]) -> dict:
    result = summarize(rows)
    result["original_closed_slow_winners_at_d78_third_landmark"] = sum(closed_slow_winners(row["native_positions"]) for row in rows)
    result["original_closed_winning_bundles"] = sum(
        any(p["closed"] for p in row["native_positions"])
        and sum(Decimal(p["native_final_realized_pnl_usdt"]) for p in row["native_positions"]) > 0
        for row in rows
    )
    result["d80_context_bundle_counts"] = dict(Counter("close_breakout" if row["b_close_breaks_prior_60_high"] else "no_close_breakout" for row in rows))
    result["prior_volatility_rank_bundle_counts"] = dict(Counter(row["prior_volatility_rank"] for row in rows))
    return result


def make_row(bundle: dict, original: dict, positions: list[dict], instrument, bars: list[dict], ends: list[int]) -> dict:
    first_ns = min(p["first_fill_ns"] for p in positions)
    first_i = bisect.bisect_left(ends, first_ns)
    if first_i == len(bars):
        state = {"state": "end_censored", "signal": False, "bar_close_ns": None}
    else:
        bar = bars[first_i]
        low = Decimal(str(bar["low"]))
        high = Decimal(str(bar["high"]))
        open_ = Decimal(str(bar["open"]))
        close = Decimal(str(bar["close"]))
        stop = Decimal(bundle["tier_geometry"]["first"]["stop"])
        target = Decimal(bundle["tier_geometry"]["first"]["target"])
        if target != Decimal(bundle["tier_geometry"]["deeper"]["target"]) or stop != Decimal(bundle["tier_geometry"]["deeper"]["stop"]):
            raise RuntimeError(f"{original['bundle_id']}: native tier target/stop mismatch")
        signal = high > low and close > open_ and close >= low + Decimal("0.75") * (high - low)
        crossed_stop = low <= stop
        closed_before = any(p["native_close_ns"] is not None and p["native_close_ns"] <= bar["end_ns"] for p in positions)
        tick = Decimal(str(instrument.price_increment))
        trigger = Decimal(str(instrument.make_price(float(high + tick))))
        if trigger <= high:
            raise RuntimeError(f"{original['bundle_id']}: native trigger did not advance one tick")
        orderable_geometry = stop < trigger < target
        if not signal:
            status = "no_bull_response"
        elif crossed_stop:
            status = "signal_but_stop_crossed"
        elif closed_before:
            status = "signal_but_original_closed"
        elif not orderable_geometry:
            status = "signal_but_unorderable"
        else:
            status = "orderable_signal"
        candidate_r = (target - trigger) / (trigger - stop) if orderable_geometry else None
        state = {
            "state": status,
            "signal": signal,
            "bar_close_ns": bar["end_ns"],
            "signal_delay_minutes_after_first_native_fill": (bar["end_ns"] - first_ns) / 60_000_000_000,
            "bar_open": str(open_),
            "bar_high": str(high),
            "bar_low": str(low),
            "bar_close": str(close),
            "bar_low_crossed_original_stop": crossed_stop,
            "original_position_closed_before_bar_complete": closed_before,
            "native_price_increment": str(tick),
            "indicative_next_bar_buy_stop_trigger": str(trigger),
            "original_stop_px": str(stop),
            "original_target_b_px": str(target),
            "candidate_trigger_geometry_orderable": orderable_geometry,
            "candidate_target_to_stop_r_if_orderable": float(candidate_r) if candidate_r is not None else None,
            "original_first_tier_planned_target_r": bundle["tier_geometry"]["first"]["planned_target_r"],
            "target_r_change_if_orderable": float(candidate_r) - bundle["tier_geometry"]["first"]["planned_target_r"] if candidate_r is not None else None,
            "target_b_already_touched_in_signal_bar": high >= target,
        }
    return {
        "bundle_id": original["bundle_id"],
        "coin": original["coin"],
        "submission_month_utc": original["submission_month_utc"],
        "prior_volatility_rank": original["prior_volatility_rank"],
        "b_close_breaks_prior_60_high": original["b_close_breaks_prior_60_high"],
        "any_positive_buy_fill": True,
        "first_native_buy_fill_ns": first_ns,
        "native_positions": positions,
        **state,
    }


def main() -> None:
    for path, expected in HASHES.items():
        if sha(path) != expected:
            raise RuntimeError(f"frozen D82 input changed: {path}")
    identity = json.loads(IDENTITY.read_text())
    report = json.loads(SUMMARY.read_text())
    if (report["closed_trades"], report["winning_trades"]) != (496, 212):
        raise RuntimeError("native H19a report changed")
    with gzip.open(D77, "rt") as stream:
        bundles = {row["bundle_id"]: row for row in json.load(stream)}
    with gzip.open(D78, "rt") as stream:
        native_positions = {row["position_id"]: row for row in json.load(stream)}
    with gzip.open(D80, "rt") as stream:
        original = {row["bundle_id"]: row for row in json.load(stream)}
    if (len(bundles), len(native_positions), len(original)) != (2939, 507, 2939):
        raise RuntimeError("native source population changed")
    by_coin = defaultdict(list)
    for bundle in bundles.values():
        if bundle["any_positive_buy_fill"]:
            by_coin[bundle["coin"]].append(bundle)
    rows = []
    catalog_counts = {}
    for entry in identity["coins"]:
        coin = entry["coin"]
        instrument, bars, count = native_bars(Path(identity["minute_catalog_root"]), coin, entry["minute_catalog"]["sha256"])
        ends = [bar["end_ns"] for bar in bars]
        catalog_counts[coin] = {"native_last_bars": count, "complete_four_hour_bars": len(bars)}
        for bundle in by_coin[coin]:
            prior = original[bundle["bundle_id"]]
            positions = [native_positions[position_id] for position_id in bundle["native_position_ids"]]
            if not positions or prior["coin"] != coin or not prior["any_positive_buy_fill"]:
                raise RuntimeError(f"{bundle['bundle_id']}: native fill identity mismatch")
            rows.append(make_row(bundle, prior, positions, instrument, bars, ends))
    if len(rows) != 500 or sum(len(row["native_positions"]) for row in rows) != 507:
        raise RuntimeError("not all 500 native filled bundles/507 Positions matched")
    rows.sort(key=lambda row: (row["first_native_buy_fill_ns"], row["bundle_id"]))
    by_status = {status: scored_group([row for row in rows if row["state"] == status]) for status in STATUSES}
    feasible = [row for row in rows if row["state"] == "orderable_signal"]
    result = {
        "schema": "r1-native-d82-post-touch-bull-response/v1",
        "preregistration_commit": "77185d1fc",
        "input_sha256": {path.name: sha(path) for path in HASHES},
        "catalog_counts": catalog_counts,
        "all_original_filled_bundles": scored_group(rows),
        "independent_censor_checks": {
            "bars_low_crossed_original_stop": sum(row.get("bar_low_crossed_original_stop", False) for row in rows),
            "original_position_closed_before_bar_complete": sum(row.get("original_position_closed_before_bar_complete", False) for row in rows),
            "strong_bull_response_at_completed_bar": sum(row["signal"] for row in rows),
            "strong_bull_response_with_stop_crossing": sum(row["signal"] and row.get("bar_low_crossed_original_stop", False) for row in rows),
        },
        "by_post_touch_status": by_status,
        "orderable_signal": {
            "count": len(feasible),
            "median_delay_minutes": sorted(row["signal_delay_minutes_after_first_native_fill"] for row in feasible)[len(feasible) // 2] if feasible else None,
            "median_candidate_target_r": sorted(row["candidate_target_to_stop_r_if_orderable"] for row in feasible)[len(feasible) // 2] if feasible else None,
            "median_original_first_tier_target_r": sorted(row["original_first_tier_planned_target_r"] for row in feasible)[len(feasible) // 2] if feasible else None,
            "target_b_already_touched_in_signal_bar": sum(row["target_b_already_touched_in_signal_bar"] for row in feasible),
        },
        "limitations": ["The original first native BUY fill is a real touch clock, not a simulated earlier OHLC touch for an unfilled order.", "A strong bull response is observed only after its containing four-hour bar completes; this diagnostic does not create an order or model the next-bar trigger fill.", "The upper-quarter close is one frozen researcher encoding, not a numeric rule stated by Brooks or Ronnie.", "Original Position net outcomes include fees/funding, but conditioning on a post-fill bar is selected-fill evidence, not a native candidate return or win rate.", "Four-hour OHLC cannot resolve intrabar sequencing; stop crossing and native closure are reported separately."],
    }
    with gzip.GzipFile(filename=str(DETAIL), mode="wb", compresslevel=6, mtime=0) as zipped:
        with io.TextIOWrapper(zipped, encoding="utf-8") as stream:
            json.dump(rows, stream, separators=(",", ":"), ensure_ascii=False)
    result["detail_file"] = DETAIL.name
    result["detail_sha256"] = sha(DETAIL)
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"all": {k: result["all_original_filled_bundles"][k] for k in ("filled_bundles", "native_positions", "native_closed", "native_winners", "original_closed_slow_winners_at_d78_third_landmark")}, "by_status": {k: {x: v[x] for x in ("filled_bundles", "native_closed", "native_winners", "original_closed_slow_winners_at_d78_third_landmark")} for k, v in by_status.items()}, "orderable_signal": result["orderable_signal"]}, indent=2))


if __name__ == "__main__":
    main()
