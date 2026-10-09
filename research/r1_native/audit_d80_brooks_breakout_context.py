"""Read-only Brooks-context classification of frozen H19a native bundles.

Only completed four-hour LAST bars visible when an order was submitted are used.
No orders, fills, account equity, or native Strategy behavior are simulated here.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import sys
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

import pandas as pd
from nautilus_trader.indicators import WilderMovingAverage
from nautilus_trader.model import BarType
from nautilus_trader.persistence import ParquetDataCatalog

ROOT = Path(__file__).resolve().parent
STRATEGIES = ROOT.parents[1] / "strategies" / "r1"
sys.path.insert(0, str(STRATEGIES))
from broad_swing_signal import BroadSwingPullback  # noqa: E402
from strategy import FourHour  # noqa: E402

RUN = Path("/tmp/r1-h22a-paired-h19a-37")
IDENTITY = ROOT / "results/2026-10-07-input-identity.json"
D77 = ROOT / "results/2026-10-08-d77-native-entry-geometry-bundles.json.gz"
D78 = ROOT / "results/2026-10-08-d78-post-fill-asset-path-positions.json.gz"
OUT = ROOT / "results/2026-10-08-d80-brooks-breakout-context.json"
DETAIL = ROOT / "results/2026-10-08-d80-brooks-breakout-context-bundles.json.gz"
HASHES = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    D77: "ed66b59b9f8db091572aaec1fb65146c629686cc94954fa3cb6fc991034c56b0",
    D78: "ad31d3f3cf4fa1981ccea7ccf5c6289a927c86b781a7b4cd85adaef8316afd6e",
    RUN / "summary.json": "cd0212f4c6880469c5d5b9db0b8b931618590fc2914bff42417e95ea9e41b555",
    RUN / "orders.csv": "77cf20e8302d22d305f7fe9e0a4eec4fd9b4c38cda541d360f2c30440ba6fe7d",
}
START = pd.Timestamp("2025-10-07T00:00:00Z").value
END = pd.Timestamp("2026-10-07T08:30:00Z").value
FIVE_MIN_NS = 300_000_000_000
FOUR_HOUR_NS = 48 * FIVE_MIN_NS
MILLISECOND_NS = 1_000_000


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        name = path.relative_to(root).as_posix().encode()
        digest.update(len(name).to_bytes(4, "big"))
        digest.update(name)
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def native_bars(catalog_root: Path, coin: str, tree_hash: str):
    minute_root = catalog_root / coin / "minute"
    if tree_digest(minute_root) != tree_hash:
        raise RuntimeError(f"{coin}: registered Nautilus Catalog tree changed")
    catalog = ParquetDataCatalog(str(minute_root))
    instrument_id = json.loads((minute_root / "r1-download-complete.json").read_text())["instrument"]
    instrument = catalog.instruments(instrument_ids=[instrument_id])[0]
    bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
    last = sorted(
        (bar for bar in catalog.query_bars([instrument_id], start=START, end=END)
         if bar.bar_type == bar_type),
        key=lambda bar: bar.ts_event,
    )
    expected = (END - START) // FIVE_MIN_NS
    if len(last) != expected:
        raise RuntimeError(f"{coin}: expected {expected} continuous native LAST bars, got {len(last)}")
    for i, bar in enumerate(last):
        if bar.ts_event != START + (i + 1) * FIVE_MIN_NS - MILLISECOND_NS:
            raise RuntimeError(f"{coin}: native LAST clock gap at {i}")
    bars = []
    for i in range(0, len(last) - len(last) % 48, 48):
        group = last[i : i + 48]
        bars.append({
            "end_ns": group[-1].ts_event,
            "open": float(group[0].open),
            "high": max(float(bar.high) for bar in group),
            "low": min(float(bar.low) for bar in group),
            "close": float(group[-1].close),
        })
    return instrument, bars, len(last)


def planned_keys(instrument, bars: list[dict]):
    selector = BroadSwingPullback()
    atr = WilderMovingAverage(14)
    previous_close = None
    plans = defaultdict(list)
    for i, bar in enumerate(bars):
        candle = FourHour(bar["end_ns"], bar["high"], bar["low"], bar["close"])
        prior_atr = atr.value if atr.initialized else None
        plan = selector.on_closed(candle, prior_atr)
        if plan is not None:
            span = plan.b_high - plan.a_low
            first = instrument.make_price(plan.b_high - 0.5 * span)
            deeper = instrument.make_price(plan.b_high - 0.618 * span)
            stop = instrument.make_price(plan.stop)
            target = instrument.make_price(plan.target)
            key = (str(first), str(deeper), str(stop), str(target))
            plans[key].append({"signal_i": i, "a_i": plan.a_index, "b_i": plan.b_index})
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - (previous_close if previous_close is not None else candle.close)),
            abs(candle.low - (previous_close if previous_close is not None else candle.close)),
        )
        atr.update_raw(true_range)
        previous_close = candle.close
    return plans


def classify(bundle: dict, parent: dict, plans: dict, bars: list[dict]):
    native = bundle["tier_geometry"]
    key = (native["first"]["entry"], native["deeper"]["entry"], native["first"]["stop"], native["first"]["target"])
    ts = int(parent["ts_init"])
    candidates = [p for p in plans.get(key, ()) if bars[p["signal_i"]]["end_ns"] < ts and ts - bars[p["signal_i"]]["end_ns"] <= 180 * FOUR_HOUR_NS]
    if not candidates:
        raise RuntimeError(f"{bundle['bundle_id']}: no native-rounded causal source plan for submitted order")
    possible_b = {p["b_i"] for p in candidates}
    if len(possible_b) != 1:
        raise RuntimeError(f"{bundle['bundle_id']}: ambiguous historical B context {sorted(possible_b)}")
    plan = max(candidates, key=lambda p: p["signal_i"])
    b_i = plan["b_i"]
    if b_i < 60 or b_i + 1 >= len(bars):
        raise RuntimeError(f"{bundle['bundle_id']}: unavailable prior range or next bar")
    b = bars[b_i]
    prior_upper = max(bar["high"] for bar in bars[b_i - 60 : b_i])
    close_break = b["close"] > prior_upper
    next_bar = bars[b_i + 1]
    next_available = next_bar["end_ns"] < ts
    follow = next_bar["close"] > b["close"] and next_bar["close"] > next_bar["open"] if next_available else None
    micro = next_bar["low"] > bars[b_i - 1]["high"] if next_available else None
    return {
        "signal_end_ns": bars[plan["signal_i"]]["end_ns"],
        "native_submission_ns": ts,
        "b_end_ns": b["end_ns"],
        "b_close_breaks_prior_60_high": close_break,
        "next_bar_complete_before_submission": next_available,
        "bull_followthrough_next_bar": follow,
        "micro_gap_next_low_above_pre_b_high": micro,
        "b_close_to_prior_60_high_pct": (b["close"] / prior_upper - 1) * 100,
    }


def summarize(rows: list[dict]) -> dict:
    closed = [p for row in rows for p in row["native_positions"] if p["closed"]]
    winners = [p for p in closed if Decimal(p["native_final_realized_pnl_usdt"]) > 0]
    losers = [p for p in closed if Decimal(p["native_final_realized_pnl_usdt"]) <= 0]
    win_sum = sum((Decimal(p["native_final_realized_pnl_usdt"]) for p in winners), Decimal(0))
    loss_sum = sum((Decimal(p["native_final_realized_pnl_usdt"]) for p in losers), Decimal(0))
    by_coin = defaultdict(lambda: [0, 0])
    by_month = defaultdict(lambda: [0, 0])
    for row in rows:
        for position in row["native_positions"]:
            if not position["closed"]:
                continue
            won = Decimal(position["native_final_realized_pnl_usdt"]) > 0
            by_coin[row["coin"]][0] += 1
            by_coin[row["coin"]][1] += won
            by_month[row["submission_month_utc"]][0] += 1
            by_month[row["submission_month_utc"]][1] += won
    return {
        "submitted_bundles": len(rows),
        "filled_bundles": sum(row["any_positive_buy_fill"] for row in rows),
        "native_positions": sum(len(row["native_positions"]) for row in rows),
        "native_closed": len(closed),
        "native_open": sum(not p["closed"] for row in rows for p in row["native_positions"]),
        "native_winners": len(winners),
        "native_winning_target_exits": sum(p["close_cause"] == "target" for p in winners),
        "native_closed_win_pct": 100 * len(winners) / len(closed) if closed else None,
        "native_closed_net_pnl_usdt": str(win_sum + loss_sum),
        "native_realized_payoff": float((win_sum / len(winners)) / (-loss_sum / len(losers))) if winners and losers else None,
        "closed_causes": dict(Counter(p["close_cause"] for p in closed)),
        "coin_bundle_counts": dict(sorted(Counter(row["coin"] for row in rows).items())),
        "submission_month_bundle_counts": dict(sorted(Counter(row["submission_month_utc"] for row in rows).items())),
        "coin_closed_winner_counts": {key: {"closed": value[0], "winners": value[1]} for key, value in sorted(by_coin.items())},
        "submission_month_closed_winner_counts": {key: {"closed": value[0], "winners": value[1]} for key, value in sorted(by_month.items())},
    }


def main() -> None:
    for path, expected in HASHES.items():
        if sha(path) != expected:
            raise RuntimeError(f"frozen native input changed: {path}")
    identity = json.loads(IDENTITY.read_text())
    summary = json.loads((RUN / "summary.json").read_text())
    if (summary["closed_trades"], summary["winning_trades"]) != (496, 212):
        raise RuntimeError("native H19a report changed")
    with gzip.open(D77, "rt") as stream:
        bundles = json.load(stream)
    with gzip.open(D78, "rt") as stream:
        position_rows = json.load(stream)
    by_position = {p["position_id"]: p for p in position_rows}
    if len(bundles) != 2939 or len(by_position) != 507:
        raise RuntimeError("D77/D78 native population changed")
    with (RUN / "orders.csv").open(newline="") as stream:
        orders = {row["client_order_id"]: row for row in csv.DictReader(stream)}
    coin_bundles = defaultdict(list)
    for bundle in bundles:
        coin_bundles[bundle["coin"]].append(bundle)
    all_rows = []
    catalog_counts = {}
    for coin_entry in identity["coins"]:
        coin = coin_entry["coin"]
        instrument, bars, count = native_bars(Path(identity["minute_catalog_root"]), coin, coin_entry["minute_catalog"]["sha256"])
        catalog_counts[coin] = {"native_last_bars": count, "complete_four_hour_bars": len(bars)}
        plans = planned_keys(instrument, bars)
        for bundle in coin_bundles[coin]:
            parent = orders[bundle["tier_geometry"]["first"]["parent_order_id"]]
            if parent["instrument_id"] != str(instrument.id) or parent["type"] != "LIMIT" or parent["side"] != "BUY":
                raise RuntimeError(f"{bundle['bundle_id']}: native parent mismatch")
            state = classify(bundle, parent, plans, bars)
            native_positions = [by_position[position_id] for position_id in bundle["native_position_ids"]]
            all_rows.append({
                "bundle_id": bundle["bundle_id"],
                "coin": coin,
                "submission_month_utc": bundle["submission_month_utc"],
                "prior_volatility_rank": bundle["prior_volatility_rank"],
                "any_positive_buy_fill": bundle["any_positive_buy_fill"],
                "native_positions": native_positions,
                **state,
            })
        print(f"{coin}: classified {len(coin_bundles[coin])} native bundles", flush=True)
    if len(all_rows) != 2939 or sum(len(row["native_positions"]) for row in all_rows) != 507:
        raise RuntimeError("not all original native bundles/Positions were classified")
    all_rows.sort(key=lambda row: (row["native_submission_ns"], row["bundle_id"]))
    classified = {
        "close_breakout": [r for r in all_rows if r["b_close_breaks_prior_60_high"]],
        "no_close_breakout": [r for r in all_rows if not r["b_close_breaks_prior_60_high"]],
        "close_breakout_followthrough": [r for r in all_rows if r["b_close_breaks_prior_60_high"] and r["bull_followthrough_next_bar"] is True],
        "close_breakout_no_followthrough": [r for r in all_rows if r["b_close_breaks_prior_60_high"] and r["bull_followthrough_next_bar"] is False],
        "close_breakout_next_unavailable": [r for r in all_rows if r["b_close_breaks_prior_60_high"] and r["bull_followthrough_next_bar"] is None],
        "observed_micro_gap": [r for r in all_rows if r["micro_gap_next_low_above_pre_b_high"] is True],
    }
    result = {
        "schema": "r1-native-d80-brooks-breakout-context/v1",
        "preregistration_commit": "0151ace23",
        "input_sha256": {path.name: sha(path) for path in HASHES},
        "strategy_source_sha256": {"broad_swing_signal.py": sha(STRATEGIES / "broad_swing_signal.py"), "strategy.py": sha(STRATEGIES / "strategy.py")},
        "catalog_counts": catalog_counts,
        "all": summarize(all_rows),
        "by_context": {key: summarize(rows) for key, rows in classified.items()},
        "detail_file": DETAIL.name,
        "limitations": ["The three source-meaningful features are one predeclared descriptive read, not gate variants selected by their score.", "Native closed PnL includes original fees/funding; group PnL is fill-selected and cannot be read as a shared-account filtered return.", "A gap that remains open at order submission is not measured by a single adjacent-bar micro-gap flag.", "Brooks's E-mini context and Ronnie's discretion may not map to a Binance perpetual four-hour strategy."],
    }
    with gzip.GzipFile(filename=str(DETAIL), mode="wb", compresslevel=6, mtime=0) as zipped:
        with io.TextIOWrapper(zipped, encoding="utf-8") as stream:
            json.dump(all_rows, stream, separators=(",", ":"), ensure_ascii=False)
    result["detail_sha256"] = sha(DETAIL)
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"all": result["all"], "by_context": {k: {x: v[x] for x in ("submitted_bundles", "filled_bundles", "native_closed", "native_closed_win_pct", "native_realized_payoff", "native_closed_net_pnl_usdt") } for k, v in result["by_context"].items()}}, indent=2))


if __name__ == "__main__":
    main()
