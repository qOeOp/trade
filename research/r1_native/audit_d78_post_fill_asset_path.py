"""Read H19a native post-fill four-hour evidence by causal volatility state."""

from __future__ import annotations

import ast
import bisect
import csv
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd
from nautilus_trader.model import BarType, OrderFilled, Position, PositionAdjusted
from nautilus_trader.persistence import ParquetDataCatalog


ROOT = Path(__file__).resolve().parent
RUN = Path("/tmp/r1-h22a-paired-h19a-37")
IDENTITY = ROOT / "results/2026-10-07-input-identity.json"
D71_POSITIONS = ROOT / "results/2026-10-08-d71-asset-regime-positions.json.gz"
D77 = ROOT / "results/2026-10-08-d77-native-entry-geometry.json"
D77_DETAIL = ROOT / "results/2026-10-08-d77-native-entry-geometry-bundles.json.gz"
OUT = ROOT / "results/2026-10-08-d78-post-fill-asset-path.json"
DETAIL = ROOT / "results/2026-10-08-d78-post-fill-asset-path-positions.json.gz"
EXPECTED = {
    IDENTITY.name: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    D71_POSITIONS.name: "624d4dd60a6742e6811c7e66733e971a1faeaeb803814e6af61034e8e9d7b5e9",
    D77.name: "0c358599d9956634c292f0a7efda2a4049088f25b2ad690fce283e22537c44e6",
    D77_DETAIL.name: "ed66b59b9f8db091572aaec1fb65146c629686cc94954fa3cb6fc991034c56b0",
    "summary.json": "cd0212f4c6880469c5d5b9db0b8b931618590fc2914bff42417e95ea9e41b555",
    "orders.csv": "77cf20e8302d22d305f7fe9e0a4eec4fd9b4c38cda541d360f2c30440ba6fe7d",
    "fills.csv": "792aa68f2f12063770dbf00173c30c3d707b79d316a43864f05dba67eaed148e",
    "positions.csv": "d2230be30c5365f92f67f7b829e4f2f66f716f0144f48b6c1dabb6139547a569",
}
START_NS = pd.Timestamp("2025-10-07T00:00:00Z").value
END_NS = pd.Timestamp("2026-10-07T08:30:00Z").value
FIVE_MIN_NS = 300_000_000_000
FOUR_HOUR_NS = 48 * FIVE_MIN_NS
MILLISECOND_NS = 1_000_000
EXPECTED_BARS = (END_NS - START_NS) // FIVE_MIN_NS
LANDMARKS = (1, 3, 5, 10)
RANKS = ("low", "middle", "high")


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


def csv_rows(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def amount(value: object) -> Decimal:
    return Decimal(str(value).split()[0])


def _replay(instrument, events: list[dict], adjustments: list[dict], until_ns: int | None):
    sequence = [(int(row["ts_event"]), 0, row) for row in events]
    sequence.extend((int(row["ts_event"]), 1, row) for row in adjustments)
    sequence.sort(key=lambda item: (item[0], item[1]))
    position = None
    for timestamp, kind, raw in sequence:
        if until_ns is not None and timestamp > until_ns:
            break
        if kind == 0:
            event = OrderFilled.from_dict(raw)
            if position is None:
                position = Position(instrument, event)
            else:
                position.apply(event)
        else:
            if position is None:
                raise RuntimeError("native funding adjustment precedes first fill")
            position.apply_adjustment(PositionAdjusted.from_dict(raw))
    if position is None:
        raise RuntimeError("native Position has no opening fill")
    return position


def _four_hour_bars(root: Path, coin: str, instrument_id: str) -> tuple[object, list[dict]]:
    catalog = ParquetDataCatalog(str(root / coin / "minute"))
    instrument = catalog.instruments(instrument_ids=[instrument_id])[0]
    bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
    last = sorted(
        (bar for bar in catalog.query_bars([instrument_id], start=START_NS, end=END_NS)
         if bar.bar_type == bar_type),
        key=lambda bar: bar.ts_event,
    )
    if len(last) != EXPECTED_BARS:
        raise RuntimeError(f"{coin}: incomplete native LAST bars {len(last)} vs {EXPECTED_BARS}")
    for i, bar in enumerate(last):
        if bar.ts_event != START_NS + (i + 1) * FIVE_MIN_NS - MILLISECOND_NS:
            raise RuntimeError(f"{coin}: noncontiguous native five-minute LAST bar {i}")
    complete = []
    for i in range(0, len(last) - len(last) % 48, 48):
        group = last[i : i + 48]
        complete.append({
            "start_ns": START_NS + i * FIVE_MIN_NS,
            "end_ns": group[-1].ts_event,
            "high": max(Decimal(str(bar.high)) for bar in group),
            "low": min(Decimal(str(bar.low)) for bar in group),
            "close": Decimal(str(group[-1].close)),
        })
    return instrument, complete


def _cause(position: dict, orders: dict[str, dict]) -> str:
    if not position["ts_closed"]:
        return "open_at_end"
    close_id = position["closing_order_id"]
    if close_id not in orders:
        raise RuntimeError(f"{position['position_id']}: native close order missing")
    return {"STOP_MARKET": "stop", "LIMIT": "target", "MARKET": "time_market"}.get(
        orders[close_id]["type"], f"other_{orders[close_id]['type']}"
    )


def _position_path(position: dict, d71: dict, d77: dict, instrument, bars: list[dict], orders: dict[str, dict]) -> dict:
    events = ast.literal_eval(position["events"])
    adjustments = ast.literal_eval(position["adjustments"])
    if not events or any(row["type"] != "OrderFilled" for row in events):
        raise RuntimeError(f"{position['position_id']}: invalid native fill history")
    if any(row["type"] != "PositionAdjusted" for row in adjustments):
        raise RuntimeError(f"{position['position_id']}: invalid native adjustment history")
    buys = [row for row in events if row["order_side"] == "BUY"]
    first = buys[0]
    if first["client_order_id"] != position["opening_order_id"]:
        raise RuntimeError(f"{position['position_id']}: native first fill/order mismatch")
    entry = Decimal(str(first["last_px"]))
    parent_id = first["client_order_id"]
    native_tiers = d77["tier_geometry"]
    matching = [item for item in native_tiers.values() if item["parent_order_id"] == parent_id]
    if len(matching) != 1:
        raise RuntimeError(f"{position['position_id']}: original native tier not unique")
    stop = Decimal(matching[0]["stop"])
    target = Decimal(matching[0]["target"])
    first_entry = Decimal(native_tiers["first"]["entry"])
    approx_a = 2 * first_entry - target
    risk = entry - stop
    if not 0 < stop < entry < target or not 0 < approx_a < first_entry < target or risk <= 0:
        raise RuntimeError(f"{position['position_id']}: invalid original risk/source geometry")
    first_ns = int(first["ts_event"])
    closed_ns = pd.Timestamp(position["ts_closed"]).value if position["ts_closed"] else None
    final = _replay(instrument, events, adjustments, None)
    final_pnl = amount(final.realized_pnl)
    if abs(final_pnl - amount(position["realized_pnl"])) > Decimal("0.000001"):
        raise RuntimeError(f"{position['position_id']}: native Position/PnL replay mismatch")
    if abs(final_pnl - Decimal(d71["native_realized_pnl_usdt"])) > Decimal("0.000001"):
        raise RuntimeError(f"{position['position_id']}: D71 fee/funding net PnL mismatch")
    cause = _cause(position, orders)
    starts = [bar["start_ns"] for bar in bars]
    first_full = bisect.bisect_left(starts, first_ns)
    landmarks = {}
    for n in LANDMARKS:
        idx = first_full + n - 1
        if idx >= len(bars):
            landmarks[str(n)] = {"state": "closed_censored" if closed_ns is not None else "end_censored"}
            continue
        bar = bars[idx]
        if closed_ns is not None and closed_ns <= bar["end_ns"]:
            landmarks[str(n)] = {"state": "closed_censored", "close_cause": cause}
            continue
        path = bars[first_full : idx + 1]
        mark = _replay(instrument, events, adjustments, bar["end_ns"])
        if not mark.is_open:
            raise RuntimeError(f"{position['position_id']}: native Position closed before observed landmark")
        native_price = instrument.make_price(float(bar["close"]))
        native_mark_pnl = amount(mark.total_pnl(native_price))
        exit_fee = (
            bar["close"] * amount(mark.quantity) * amount(instrument.multiplier)
            * amount(instrument.taker_fee)
        )
        indicative = native_mark_pnl - exit_fee
        mfe = (max(item["high"] for item in path) - entry) / risk
        mae = (min(item["low"] for item in path) - entry) / risk
        landmarks[str(n)] = {
            "state": "observed",
            "bar_close_ns": bar["end_ns"],
            "mfe_first_r": float(mfe),
            "mae_first_r": float(mae),
            "close_first_r": float((bar["close"] - entry) / risk),
            "approx_a_low_breached": any(item["low"] < approx_a for item in path),
            "approx_a_close_breached": any(item["close"] < approx_a for item in path),
            "later_entry_after_landmark": any(int(item["ts_event"]) > bar["end_ns"] for item in buys),
            "entry_buy_fill_events_by_landmark": sum(int(item["ts_event"]) <= bar["end_ns"] for item in buys),
            "native_open_qty": str(mark.quantity),
            "native_mark_pnl_usdt": str(native_mark_pnl),
            "indicative_taker_exit_fee_usdt": str(exit_fee),
            "indicative_full_exit_pnl_usdt": str(indicative),
            "native_final_minus_indicative_usdt": str(final_pnl - indicative) if closed_ns is not None else None,
        }
    return {
        "position_id": position["position_id"],
        "bundle_id": position["opening_order_id"].rsplit("-", 1)[0],
        "coin": d71["coin"],
        "prior_volatility_rank": d71["realized_volatility_tercile"],
        "first_order_submission_month_utc": d71["entry_submission_month_utc"],
        "first_fill_ns": first_ns,
        "native_close_ns": closed_ns,
        "closed": closed_ns is not None,
        "close_cause": cause,
        "native_final_realized_pnl_usdt": str(final_pnl),
        "native_final_net_r": float(d71["net_r_multiple"]) if closed_ns is not None else None,
        "first_fill_px": str(entry),
        "original_stop_px": str(stop),
        "target_b_px": str(target),
        "approx_a_px": str(approx_a),
        "native_buy_fill_events": len(buys),
        "landmarks": landmarks,
    }


def _cohort(rows: list[dict], n: int) -> dict:
    observed = [row for row in rows if row["landmarks"][str(n)]["state"] == "observed"]
    closed = [row for row in observed if row["closed"]]
    wins = [row for row in closed if Decimal(row["native_final_realized_pnl_usdt"]) > 0]
    targets = [row for row in closed if row["close_cause"] == "target"]
    delta = sum((Decimal(row["landmarks"][str(n)]["native_final_minus_indicative_usdt"]) for row in closed), Decimal(0))
    pnl = sum((Decimal(row["native_final_realized_pnl_usdt"]) for row in closed), Decimal(0))
    mfe = [row["landmarks"][str(n)]["mfe_first_r"] for row in observed]
    mae = [row["landmarks"][str(n)]["mae_first_r"] for row in observed]
    return {
        "observed_positions": len(observed),
        "closed_by_report_end": len(closed),
        "open_at_report_end": len(observed) - len(closed),
        "eventual_closed_winners": len(wins),
        "eventual_closed_win_rate": len(wins) / len(closed) if closed else None,
        "eventual_target_exits": len(targets),
        "eventual_target_net_pnl_usdt": str(sum((Decimal(row["native_final_realized_pnl_usdt"]) for row in targets), Decimal(0))),
        "eventual_closed_native_net_pnl_usdt": str(pnl),
        "eventual_closed_mean_net_r": float(np.mean([row["native_final_net_r"] for row in closed])) if closed else None,
        "native_continuation_minus_indicative_full_exit_sum_usdt": str(delta),
        "native_continuation_minus_indicative_full_exit_mean_usdt": str(delta / len(closed)) if closed else None,
        "mfe_first_r_median": float(np.median(mfe)) if mfe else None,
        "mae_first_r_median": float(np.median(mae)) if mae else None,
        "approx_a_low_breached": sum(row["landmarks"][str(n)]["approx_a_low_breached"] for row in observed),
        "approx_a_close_breached": sum(row["landmarks"][str(n)]["approx_a_close_breached"] for row in observed),
        "later_entry_after_landmark": sum(row["landmarks"][str(n)]["later_entry_after_landmark"] for row in observed),
    }


def main() -> None:
    inputs = {name: sha((ROOT / "results" if name.startswith("2026-") else RUN) / name) for name in EXPECTED}
    if inputs != EXPECTED:
        raise RuntimeError(f"D78 frozen input identity mismatch: {inputs}")
    identity = json.loads(IDENTITY.read_text())
    root = Path(identity["minute_catalog_root"])
    d77 = json.loads(D77.read_text())
    with gzip.open(D77_DETAIL, "rt") as stream:
        d77_detail = {row["bundle_id"]: row for row in json.load(stream)}
    with gzip.open(D71_POSITIONS, "rt") as stream:
        d71_positions = {row["position_id"]: row for row in json.load(stream) if row["variant"] == "H19a"}
    summary = json.loads((RUN / "summary.json").read_text())
    if not summary["integrity_passed"] or summary["signal_variant"] != "support-broad-two-tier-4h":
        raise RuntimeError("frozen H19a native run integrity failed")
    orders = {row["client_order_id"]: row for row in csv_rows(RUN / "orders.csv")}
    positions = csv_rows(RUN / "positions.csv")
    if len(orders) != 17665 or len(positions) != len(d71_positions) != 507:
        raise RuntimeError("frozen H19a native Position/order counts changed")
    by_coin = defaultdict(list)
    for position in positions:
        if position["position_id"] not in d71_positions:
            raise RuntimeError("unmapped D71 native Position")
        by_coin[d71_positions[position["position_id"]]["coin"]].append(position)
    if len(identity["coins"]) != 37 or len(by_coin) != 37:
        raise RuntimeError("registered 37-coin pool differs")

    rows = []
    bar_counts = {}
    for item in identity["coins"]:
        coin = item["coin"]
        folder = root / coin / "minute"
        digest = tree_digest(folder)
        if digest != item["minute_catalog"]["sha256"]:
            raise RuntimeError(f"{coin}: native minute Catalog digest changed")
        instrument_id = f"{('1000' if coin in ('PEPE','SHIB') else '')}{coin}USDT-PERP.BINANCE"
        instrument, bars = _four_hour_bars(root, coin, instrument_id)
        bar_counts[coin] = len(bars)
        for position in by_coin[coin]:
            detail = d71_positions[position["position_id"]]
            bundle_id = position["opening_order_id"].rsplit("-", 1)[0]
            d77_bundle = d77_detail.get(bundle_id)
            if d77_bundle is None or position["position_id"] not in d77_bundle["native_position_ids"]:
                raise RuntimeError(f"{coin}: D77 native bundle/Position identity mismatch")
            if d77_bundle["prior_volatility_rank"] != detail["realized_volatility_tercile"]:
                raise RuntimeError(f"{coin}: causal volatility state mismatch")
            rows.append(_position_path(position, detail, d77_bundle, instrument, bars, orders))
    rows.sort(key=lambda row: row["position_id"])
    if len(rows) != 507 or set(bar_counts.values()) != {EXPECTED_BARS // 48}:
        raise RuntimeError("incomplete H19a native Position/four-hour landmark coverage")
    by_rank = {}
    for rank in RANKS:
        cohort = [row for row in rows if row["prior_volatility_rank"] == rank]
        bundle_map = defaultdict(list)
        for row in cohort:
            bundle_map[row["bundle_id"]].append(row)
        expected_filled = d77["by_prior_volatility_rank"][rank]["positively_filled_bundles"]
        if len(bundle_map) != expected_filled:
            raise RuntimeError(f"{rank}: D77 filled-bundle count mismatch")
        result = {
            "native_positions": len(cohort),
            "filled_native_bundles": len(bundle_map),
            "closed_positions": sum(row["closed"] for row in cohort),
            "landmarks": {},
        }
        for n in LANDMARKS:
            states = Counter(row["landmarks"][str(n)]["state"] for row in cohort)
            observed = [row for row in cohort if row["landmarks"][str(n)]["state"] == "observed"]
            censored_causes = Counter(
                row["close_cause"] for row in cohort
                if row["landmarks"][str(n)]["state"] == "closed_censored"
            )
            block = {
                "state_counts": dict(sorted(states.items())),
                "closed_before_landmark_causes": dict(sorted(censored_causes.items())),
                "all_observed": _cohort(observed, n),
            }
            early_stop_bundles = [
                members for members in bundle_map.values()
                if any(
                    member["landmarks"][str(n)]["state"] == "closed_censored"
                    and member["close_cause"] == "stop"
                    for member in members
                )
            ]
            block["native_filled_bundle_early_stop"] = {
                "filled_bundles": len(bundle_map),
                "bundles_with_any_stop_before_landmark": len(early_stop_bundles),
                "multi_position_bundles_among_early_stop": sum(len(members) > 1 for members in early_stop_bundles),
                "native_positions_in_early_stop_bundles": sum(len(members) for members in early_stop_bundles),
                "first_stop_close_date_counts": dict(sorted(Counter(
                    pd.Timestamp(min(
                        member["native_close_ns"] for member in members
                        if member["landmarks"][str(n)]["state"] == "closed_censored"
                        and member["close_cause"] == "stop"
                    ), tz="UTC").strftime("%Y-%m-%d")
                    for members in early_stop_bundles
                ).items())),
            }
            if n == 3:
                slow = [row for row in observed if row["landmarks"]["3"]["mfe_first_r"] < 0.5]
                advancing = [row for row in observed if row["landmarks"]["3"]["mfe_first_r"] >= 0.5]
                block["primary_slow_below_half_r"] = _cohort(slow, n)
                block["primary_advancing_at_least_half_r"] = _cohort(advancing, n)
            result["landmarks"][str(n)] = block
        by_rank[rank] = result
    assert [by_rank[rank]["native_positions"] for rank in RANKS] == [175, 166, 166]
    DETAIL.write_bytes(gzip.compress(json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode(), mtime=0))
    output = {
        "schema": "r1-native-d78-post-fill-asset-path/v2",
        "preregistration_commit": "bc966221d",
        "bundle_unit_correction_commit": "c769f731a",
        "input_sha256": inputs,
        "market_catalog_tree_sha256": {item["coin"]: item["minute_catalog"]["sha256"] for item in identity["coins"]},
        "complete_four_hour_bars_per_coin": bar_counts,
        "native_run": str(RUN),
        "method": "Read-only pinned Nautilus Position event/funding replay at complete UTC four-hour LAST landmarks after the first native BUY fill; D71 causal volatility state at first order submission; indicative taker exit is not an order/account counterfactual.",
        "by_prior_volatility_rank": by_rank,
        "position_detail_file": DETAIL.name,
        "position_detail_sha256": sha(DETAIL),
        "limitations": [
            "Completed-bar highs/lows cannot resolve intrabar sequence; the entry-containing partial four-hour bar and already closed Positions are excluded from later observed states.",
            "Approximate A is inferred from native rounded H19a 50% entry/B target; it is not a source-exact line or the author's confirmed structural invalidation.",
            "Indicative full exit at the observed LAST close includes native prior fills/funding and an extra taker fee but is not a native submitted order, cannot release/reallocate future account capital, and omits subsequent alternative funding/path changes.",
            "Viewed-year subgroup outcomes and four landmarks do not qualify an asset filter, exit rule or the Goal; eventual winners after slow starts are explicit counterexamples.",
        ],
    }
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(OUT), "sha256": sha(OUT), "detail_sha256": sha(DETAIL),
                      "at_three": {rank: by_rank[rank]["landmarks"]["3"] for rank in RANKS}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
