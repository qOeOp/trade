"""D102: frozen read-only native-Catalog capacity of first role-reversal retests."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from nautilus_trader.indicators import WilderMovingAverage

from audit_d80_brooks_breakout_context import native_bars


HERE = Path(__file__).resolve().parent
IDENTITY = HERE / "results/2026-10-07-input-identity.json"
EXPECTED_IDENTITY = "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc"
REGISTRATION_COMMIT = "086bb37e3"
FOUR_HOUR_NS = 14_400_000_000_000
TRADE_START_NS = 1_760_659_200_000_000_000
ONE_MS_NS = 1_000_000
PIVOT_ORDER = 8
LOOKBACK = 180
BREAKOUT_PRIOR_CLOSES = 10
BREAKOUT_BODY_BARS = 20
RETEST_BARS = 10
AREA_ATR = 0.25
STOP_ATR = 0.25


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def upper_quarter_bull(bar: dict) -> bool:
    span = bar["high"] - bar["low"]
    return span > 0 and bar["close"] > bar["open"] and bar["close"] >= bar["low"] + 0.75 * span


def last_confirmed_high(bars: list[dict], i: int) -> tuple[int, float] | None:
    # The breakout bar i is not part of the pivot or its confirming right side.
    for j in range(i - PIVOT_ORDER - 1, max(PIVOT_ORDER - 1, i - LOOKBACK - 1), -1):
        if bars[j]["high"] == max(row["high"] for row in bars[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]):
            return j, bars[j]["high"]
    return None


def first_breakout(bars: list[dict], i: int, prior_atr: float | None) -> tuple[str, dict | None]:
    if i < LOOKBACK or prior_atr is None or prior_atr <= 0:
        return "breakout_history_unavailable", None
    pivot = last_confirmed_high(bars, i)
    if pivot is None:
        return "no_confirmed_high", None
    j, level = pivot
    if any(bars[k]["close"] > level for k in range(i - BREAKOUT_PRIOR_CLOSES, i)):
        return "old_level_already_closed_above", None
    bar = bars[i]
    if bar["close"] <= level:
        return "no_completed_breakout", None
    prior_body = sum(abs(bars[k]["close"] - bars[k]["open"]) for k in range(i - BREAKOUT_BODY_BARS, i)) / BREAKOUT_BODY_BARS
    if not upper_quarter_bull(bar) or bar["close"] - bar["open"] < prior_body:
        return "breakout_response_not_strong", None
    return "breakout", {"index": i, "pivot_index": j, "level": level, "atr": prior_atr, "breakout_high": bar["high"], "breakout_end_ns": bar["end_ns"]}


def retest(instrument, active: dict, bar: dict, following: dict) -> tuple[str, dict | None]:
    level = active["level"]
    if bar["low"] > level + AREA_ATR * active["atr"]:
        return "no_first_retest_yet", None
    if bar["close"] <= level or not upper_quarter_bull(bar):
        return "first_retest_weak_or_broken", None
    trigger = instrument.make_price(bar["high"] + instrument.price_increment.as_double())
    stop = instrument.make_price(bar["low"] - STOP_ATR * active["atr"])
    target = instrument.make_price(active["breakout_high"])
    trigger_px, stop_px, target_px = [item.as_double() for item in (trigger, stop, target)]
    if not (0 < stop_px < trigger_px < target_px and trigger_px > bar["high"] and stop_px < bar["low"]):
        return "invalid_native_price_geometry", None
    room_r = (target_px - trigger_px) / (trigger_px - stop_px)
    if room_r < 1:
        return "below_one_r_to_breakout_high", None
    return "valid", {
        "breakout_end_ns": active["breakout_end_ns"],
        "pivot_end_ns": active["pivot_end_ns"],
        "retest_end_ns": bar["end_ns"],
        "decision_ns": bar["end_ns"] + ONE_MS_NS,
        "next_end_ns": following["end_ns"],
        "bars_after_breakout": active["bars_after_breakout"],
        "old_resistance": level,
        "prior_atr": active["atr"],
        "native_trigger": str(trigger),
        "native_stop": str(stop),
        "native_breakout_high_target": str(target),
        "planned_r_to_target": room_r,
        "next_bar_reaches_trigger": following["high"] >= trigger_px,
        "next_bar_trigger_and_stop_ambiguous": following["high"] >= trigger_px and following["low"] <= stop_px,
        "next_bar_trigger_and_target_ambiguous": following["high"] >= trigger_px and following["high"] >= target_px,
    }


def inspect_coin(row: dict, root: Path) -> tuple[dict, list[dict]]:
    coin = row["coin"]
    instrument, bars, minute_count = native_bars(root, coin, row["minute_catalog"]["sha256"])
    if minute_count != 105222 or len(bars) != minute_count // 48:
        raise RuntimeError(f"{coin}: native LAST coverage changed")
    prior_close = None
    atr = WilderMovingAverage(14)
    stages: Counter[str] = Counter()
    events = []
    active = None
    for i, bar in enumerate(bars):
        if i and bar["end_ns"] - bars[i - 1]["end_ns"] != FOUR_HOUR_NS:
            raise RuntimeError(f"{coin}: incomplete four-hour clock")
        if bar["end_ns"] + ONE_MS_NS >= TRADE_START_NS and i + 1 < len(bars):
            if active is not None:
                age = i - active["index"]
                if age > RETEST_BARS:
                    stages["breakout_expired_without_retest"] += 1
                    active = None
                else:
                    active["bars_after_breakout"] = age
                    stage, event = retest(instrument, active, bar, bars[i + 1])
                    stages[stage] += 1
                    if stage != "no_first_retest_yet":
                        active = None
                    if event is not None:
                        event["coin"] = coin
                        event["utc_month"] = datetime.fromtimestamp(event["decision_ns"] / 1e9, UTC).strftime("%Y-%m")
                        events.append(event)
            if active is None:
                stage, selected = first_breakout(bars, i, atr.value if atr.initialized else None)
                stages[stage] += 1
                if selected is not None:
                    selected["pivot_end_ns"] = bars[selected["pivot_index"]]["end_ns"]
                    active = selected
        tr = max(bar["high"] - bar["low"], abs(bar["high"] - (prior_close if prior_close is not None else bar["close"])), abs(bar["low"] - (prior_close if prior_close is not None else bar["close"])))
        atr.update_raw(tr)
        prior_close = bar["close"]
    return {"coin": coin, "verified_five_minute_bars": minute_count, "complete_four_hour_bars": len(bars), "stage_counts": dict(stages)}, events


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--detail", type=Path, required=True)
    args = parser.parse_args()
    if sha(IDENTITY) != EXPECTED_IDENTITY:
        raise RuntimeError("registered Catalog identity changed")
    identity = json.loads(IDENTITY.read_text())
    coins = identity["coins"]
    if len(coins) != 37 or len({row["coin"] for row in coins}) != 37:
        raise RuntimeError("registered universe changed")
    root = Path(identity["minute_catalog_root"])
    summaries, events = [], []
    for row in coins:
        summary, new = inspect_coin(row, root)
        summaries.append(summary)
        events.extend(new)
    stages = Counter()
    for row in summaries:
        stages.update(row["stage_counts"])
    by_coin = Counter(e["coin"] for e in events)
    by_month = Counter(e["utc_month"] for e in events)
    reaches = sum(e["next_bar_reaches_trigger"] for e in events)
    result = {
        "method": "D102 preregistered read-only native LAST Catalog role-reversal retest capacity; no orders, fills or PnL",
        "registration_commit": REGISTRATION_COMMIT,
        "identity_sha256": sha(IDENTITY),
        "exposed_input_window_utc": ["2025-10-07T00:00:00Z", "2026-10-07T08:30:00Z"],
        "trade_start_utc": "2025-10-17T00:00:00Z",
        "catalogs_verified": len(summaries),
        "per_coin": summaries,
        "stage_counts": dict(stages),
        "valid_native_price_geometry_signals": len(events),
        "next_complete_bar_reaches_buy_stop_price": reaches,
        "valid_signal_coins": len(by_coin),
        "valid_signal_utc_months": len(by_month),
        "by_coin": dict(sorted(by_coin.items())),
        "by_utc_month": dict(sorted(by_month.items())),
        "next_bar_trigger_and_stop_ohlc_ambiguous": sum(e["next_bar_trigger_and_stop_ambiguous"] for e in events),
        "next_bar_trigger_and_target_ohlc_ambiguous": sum(e["next_bar_trigger_and_target_ambiguous"] for e in events),
        "h25a_submission_clock_overlap": "unknown: H25a source-decision clock was not proven comparable to the new retest decision clock in this read",
        "registered_capacity_gate": len(events) >= 150 and reaches >= 50 and len(by_coin) >= 20 and len(by_month) >= 8,
        "limits": "Valid signals and next-bar OHLC reach are not native orders/fills, fee/funding-inclusive Positions or shared-account equity. The year is exposed development data.",
    }
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    args.detail.write_text(json.dumps(events, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
