"""D99: one preregistered read of completed failed-range-breakout opportunities."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from nautilus_trader.indicators import WilderMovingAverage

from audit_d80_brooks_breakout_context import native_bars
from strategy import BOX_BARS, FOUR_HOUR_NS, STOP_BUFFER_ATR, FourHour, _confirmed_box_edges


ROOT = Path(__file__).resolve().parent
IDENTITY = ROOT / "results/2026-10-07-input-identity.json"
EXPECTED_IDENTITY = "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc"
REGISTRATION = "1cde9ac59"
TRADE_START_NS = 1_760_659_200_000_000_000  # 2025-10-17 00:00:00 UTC
MILLISECOND_NS = 1_000_000


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def classify(
    instrument,
    history: list[FourHour],
    current: dict,
    following: dict,
    prior_atr: float | None,
) -> tuple[str, dict | None]:
    if prior_atr is None:
        return "atr_unavailable", None
    candle = FourHour(current["end_ns"], current["high"], current["low"], current["close"])
    box = _confirmed_box_edges(history, candle, prior_atr)
    if box is None:
        return "no_mature_box", None
    upper, lower, upper_touches, lower_touches = box
    if not current["low"] < lower:
        return "no_lower_edge_sweep", None
    if not current["close"] > lower:
        return "no_completed_reclaim", None
    span = current["high"] - current["low"]
    if not (
        span > 0
        and current["close"] > current["open"]
        and current["close"] >= current["low"] + 0.75 * span
    ):
        return "no_strong_bull_reversal", None
    trigger = instrument.make_price(current["high"] + instrument.price_increment.as_double())
    stop = instrument.make_price(current["low"] - STOP_BUFFER_ATR * prior_atr)
    target = instrument.make_price((upper + lower) / 2)
    trigger_px, stop_px, target_px = (x.as_double() for x in (trigger, stop, target))
    if not (0 < stop_px < trigger_px < target_px and trigger_px > current["high"]):
        return "invalid_native_price_geometry", None
    next_reaches_trigger = following["high"] >= trigger_px
    next_reaches_stop = following["low"] <= stop_px
    next_reaches_target = following["high"] >= target_px
    return "valid", {
        "signal_end_ns": current["end_ns"],
        "decision_ns": current["end_ns"] + MILLISECOND_NS,
        "next_end_ns": following["end_ns"],
        "prior_box_high": upper,
        "prior_box_low": lower,
        "prior_box_upper_touch_bars": len(upper_touches),
        "prior_box_lower_touch_bars": len(lower_touches),
        "prior_atr": prior_atr,
        "signal_open": current["open"],
        "signal_high": current["high"],
        "signal_low": current["low"],
        "signal_close": current["close"],
        "native_trigger": str(trigger),
        "native_stop": str(stop),
        "native_midpoint_target": str(target),
        "planned_target_to_stop_r": (target_px - trigger_px) / (trigger_px - stop_px),
        "next_bar_reaches_trigger": next_reaches_trigger,
        "next_bar_also_reaches_stop": next_reaches_trigger and next_reaches_stop,
        "next_bar_also_reaches_target": next_reaches_trigger and next_reaches_target,
    }


def inspect_coin(identity: dict, catalog_root: Path) -> tuple[dict, list[dict]]:
    coin = identity["coin"]
    instrument, bars, minute_count = native_bars(
        catalog_root,
        coin,
        identity["minute_catalog"]["sha256"],
    )
    if minute_count != 105222 or len(bars) != minute_count // 48:
        raise RuntimeError(f"{coin}: registered LAST coverage changed")
    previous_close = None
    atr = WilderMovingAverage(14)
    history: list[FourHour] = []
    stages: Counter[str] = Counter()
    valid: list[dict] = []
    for i, current in enumerate(bars):
        if i > 0 and current["end_ns"] - bars[i - 1]["end_ns"] != FOUR_HOUR_NS:
            raise RuntimeError(f"{coin}: incomplete four-hour decision clock")
        decision_ns = current["end_ns"] + MILLISECOND_NS
        if TRADE_START_NS <= decision_ns and i + 1 < len(bars):
            stage, event = classify(
                instrument,
                history,
                current,
                bars[i + 1],
                atr.value if atr.initialized else None,
            )
            stages[stage] += 1
            if event is not None:
                event["coin"] = coin
                event["utc_month"] = datetime.fromtimestamp(decision_ns / 1e9, tz=UTC).strftime("%Y-%m")
                valid.append(event)
        true_range = max(
            current["high"] - current["low"],
            abs(current["high"] - (previous_close if previous_close is not None else current["close"])),
            abs(current["low"] - (previous_close if previous_close is not None else current["close"])),
        )
        atr.update_raw(true_range)
        history.append(FourHour(current["end_ns"], current["high"], current["low"], current["close"]))
        history = history[-BOX_BARS:]
        previous_close = current["close"]
    return {"coin": coin, "minute_bars_verified": minute_count, "complete_four_hour_bars": len(bars), "stages": dict(stages)}, valid


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--detail", type=Path, required=True)
    args = parser.parse_args()
    if sha(IDENTITY) != EXPECTED_IDENTITY:
        raise RuntimeError("registered input identity changed")
    identity = json.loads(IDENTITY.read_text())
    catalog_root = Path(identity["minute_catalog_root"])
    coins = identity["coins"]
    if len(coins) != 37 or len({row["coin"] for row in coins}) != 37:
        raise RuntimeError("registered 37-coin universe changed")
    by_coin: list[dict] = []
    events: list[dict] = []
    for coin in coins:
        summary, selected = inspect_coin(coin, catalog_root)
        by_coin.append(summary)
        events.extend(selected)
    months = Counter(event["utc_month"] for event in events)
    coin_counts = Counter(event["coin"] for event in events)
    stages = Counter()
    for coin in by_coin:
        stages.update(coin["stages"])
    reaches = sum(event["next_bar_reaches_trigger"] for event in events)
    result = {
        "method": "D99 preregistered read-only native LAST Catalog/Instrument opportunity capacity; no order or fill simulation",
        "registration_commit": REGISTRATION,
        "source": "https://www.brookstradingcourse.com/futures-market/trading-strategies-microtrendlines-microchannels/",
        "identity_sha256": sha(IDENTITY),
        "exposed_input_window_utc": ["2025-10-07T00:00:00Z", "2026-10-07T08:30:00Z"],
        "trade_start_utc": "2025-10-17T00:00:00Z",
        "catalogs_verified": len(by_coin),
        "per_coin": by_coin,
        "decision_funnel": {
            "eligible_complete_decisions": sum(stages.values()),
            "mature_h10_boxes": sum(stages.values()) - stages["atr_unavailable"] - stages["no_mature_box"],
            "lower_edge_sweeps": sum(stages[key] for key in ("no_completed_reclaim", "no_strong_bull_reversal", "invalid_native_price_geometry", "valid")),
            "completed_reclaims": sum(stages[key] for key in ("no_strong_bull_reversal", "invalid_native_price_geometry", "valid")),
            "strong_bull_reversals": stages["invalid_native_price_geometry"] + stages["valid"],
            "valid_native_price_geometry": stages["valid"],
            "first_failure_counts": dict(stages),
        },
        "valid_native_price_geometry_signals": len(events),
        "next_complete_bar_reaches_buy_stop_price": reaches,
        "valid_signal_coins": len(coin_counts),
        "valid_signal_utc_months": len(months),
        "next_bar_trigger_and_stop_ohlc_ambiguous": sum(event["next_bar_also_reaches_stop"] for event in events),
        "next_bar_trigger_and_target_ohlc_ambiguous": sum(event["next_bar_also_reaches_target"] for event in events),
        "valid_signals_by_coin": dict(sorted(coin_counts.items())),
        "valid_signals_by_utc_month": dict(sorted(months.items())),
        "registered_capacity_gate": len(events) >= 100 and reaches >= 40 and len(coin_counts) >= 15 and len(months) >= 6,
        "limits": "Signals are not native orders; next-bar OHLC reach is not a native fill, cost, funded Position or shared-account equity. Seen annual window is development data.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    args.detail.write_text(json.dumps(events, indent=2) + "\n")


if __name__ == "__main__":
    main()
