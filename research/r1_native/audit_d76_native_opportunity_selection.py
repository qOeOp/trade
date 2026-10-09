"""Read frozen H19a native order, fill, Position and account selection by D71 state."""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path
from statistics import mean, median

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parent
RUN = Path("/tmp/r1-h22a-paired-h19a-37")
D71 = ROOT / "results/2026-10-08-d71-asset-regimes.json"
D71_POSITIONS = ROOT / "results/2026-10-08-d71-asset-regime-positions.json.gz"
OUTPUT = ROOT / "results/2026-10-08-d76-native-opportunity-selection.json"
DETAIL = ROOT / "results/2026-10-08-d76-native-bundles.json.gz"
RANKS = ("low", "middle", "high")
EXPECTED = {
    "summary.json": "cd0212f4c6880469c5d5b9db0b8b931618590fc2914bff42417e95ea9e41b555",
    "orders.csv": "77cf20e8302d22d305f7fe9e0a4eec4fd9b4c38cda541d360f2c30440ba6fe7d",
    "fills.csv": "792aa68f2f12063770dbf00173c30c3d707b79d316a43864f05dba67eaed148e",
    "positions.csv": "d2230be30c5365f92f67f7b829e4f2f66f716f0144f48b6c1dabb6139547a569",
    "account.csv": "69530413f22af40f57c5290dcc06417580c9f95f395b0c7c465b1d95ac2ab33e",
    D71.name: "0d1b12ca483aa95f1ec4c0ed944223a5f43362c59dc28db1fc9caa53d4b080be",
    D71_POSITIONS.name: "624d4dd60a6742e6811c7e66733e971a1faeaeb803814e6af61034e8e9d7b5e9",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def csv_rows(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def coin_from_instrument(instrument: str) -> str:
    assert instrument.endswith("USDT-PERP.BINANCE")
    coin = instrument.removesuffix("USDT-PERP.BINANCE")
    return coin.removeprefix("1000") if coin in ("1000PEPE", "1000SHIB") else coin


def month_at(ns: int) -> str:
    return pd.Timestamp(ns, tz="UTC").strftime("%Y-%m-01T00:00:00+00:00")


def _segment(rows: list[dict], coin_days: float) -> dict:
    filled = [row for row in rows if row["any_positive_buy_fill"]]
    native_positions = [position for row in filled for position in row["native_positions"]]
    closed = [position for position in native_positions if position["closed"]]
    open_rows = [position for position in native_positions if not position["closed"]]
    wins = sum(Decimal(row["native_realized_pnl_usdt"]) > 0 for row in closed)
    pnl = sum((Decimal(row["native_realized_pnl_usdt"]) for row in closed), Decimal(0))
    delays = [row["first_fill_delay_days"] for row in filled]
    free = [row["prior_account_free_ratio"] for row in rows if row["prior_account_free_ratio"] is not None]
    account_lags = [row["prior_account_snapshot_lag_seconds"] for row in rows if row["prior_account_snapshot_lag_seconds"] is not None]
    return {
        "eligible_coin_days": coin_days,
        "submitted_bundles": len(rows),
        "submitted_per_100_coin_days": 100 * len(rows) / coin_days if coin_days else None,
        "positive_fill_bundles": len(filled),
        "positive_fill_rate": len(filled) / len(rows) if rows else None,
        "first_tier_positive_fill_bundles": sum(row["first_tier_positive_buy_fill"] for row in rows),
        "deeper_tier_positive_fill_bundles": sum(row["deeper_tier_positive_buy_fill"] for row in rows),
        "unfilled_terminal_status_pairs": dict(sorted(Counter(
            "/".join(row["native_entry_final_statuses"])
            for row in rows if not row["any_positive_buy_fill"]
        ).items())),
        "first_fill_delay_days_median": median(delays) if delays else None,
        "first_fill_delay_days_p90": float(np.quantile(delays, 0.9)) if delays else None,
        "native_positions": len(native_positions),
        "native_closed_positions": len(closed),
        "native_open_right_censored_positions": len(open_rows),
        "native_closed_wins": wins,
        "native_closed_win_rate": wins / len(closed) if closed else None,
        "native_closed_mean_net_r": mean(row["net_r_multiple"] for row in closed) if closed else None,
        "native_closed_pnl_usdt": str(pnl),
        "prior_account_free_ratio_median": median(free) if free else None,
        "prior_account_free_ratio_p10": float(np.quantile(free, 0.1)) if free else None,
        "prior_account_snapshot_lag_seconds_median": median(account_lags) if account_lags else None,
        "prior_account_snapshot_lag_seconds_p90": float(np.quantile(account_lags, 0.9)) if account_lags else None,
    }


def main() -> None:
    inputs = {name: sha((ROOT / "results" if name.startswith("2026-") else RUN) / name) for name in EXPECTED}
    if inputs != EXPECTED:
        raise RuntimeError(f"frozen native or D71 report identity mismatch: {inputs}")
    summary = json.loads((RUN / "summary.json").read_text())
    d71 = json.loads(D71.read_text())
    with gzip.open(D71_POSITIONS, "rt") as stream:
        d71_positions = json.load(stream)
    if not summary["integrity_passed"] or summary["denied_orders"] or summary["rejected_orders"]:
        raise RuntimeError("native H19a integrity failed")
    assert len(d71["coins"]) == len(summary["per_coin"]) == 37
    assert summary["signal_variant"] == "support-broad-two-tier-4h"
    assert len(d71["feature_states"]) == 481
    state_by_key = {}
    for state in d71["feature_states"]:
        key = (state["coin"], state["month_start_utc"])
        assert key not in state_by_key
        assert state["realized_volatility_tercile"] in RANKS
        state_by_key[key] = state

    orders = csv_rows(RUN / "orders.csv")
    by_order = {row["client_order_id"]: row for row in orders}
    assert len(by_order) == len(orders) == 17665
    parent = {
        oid: row for oid, row in by_order.items()
        if row["side"] == "BUY" and row["type"] == "LIMIT" and not row["parent_order_id"]
    }
    bundles = defaultdict(list)
    for oid, row in parent.items():
        bundles[oid.rsplit("-", 1)[0]].append(row)
    assert len(parent) == 5878 and len(bundles) == 2939
    assert all(len(value) == 2 for value in bundles.values())

    buy_fills = defaultdict(list)
    native_fills = csv_rows(RUN / "fills.csv")
    for fill in native_fills:
        if fill["order_side"] == "BUY":
            assert fill["client_order_id"] in parent
            assert Decimal(fill["last_qty"]) > 0
            buy_fills[fill["client_order_id"]].append(fill)
    assert len(native_fills) == 1722
    for oid, order in parent.items():
        native_qty = sum((Decimal(f["last_qty"]) for f in buy_fills[oid]), Decimal(0))
        assert native_qty == Decimal(order["filled_qty"])

    mapped_d71 = {row["position_id"]: row for row in d71_positions if row["variant"] == "H19a"}
    assert len(mapped_d71) == d71["runs"]["H19a"]["native_positions"] == 507
    position_by_bundle = defaultdict(list)
    for row in csv_rows(RUN / "positions.csv"):
        identity = row["position_id"]
        assert identity in mapped_d71
        opening = row["opening_order_id"]
        assert opening in parent
        bundle_id = opening.rsplit("-", 1)[0]
        position_by_bundle[bundle_id].append(mapped_d71[identity])
        assert bool(row["ts_closed"]) == mapped_d71[identity]["closed"]
    assert len(position_by_bundle) == 500
    assert sum(map(len, position_by_bundle.values())) == 507
    assert Counter(map(len, position_by_bundle.values())) == {1: 493, 2: 7}

    account = pd.read_csv(RUN / "account.csv", usecols=["ts_event", "total", "locked", "free"])
    account["ts_ns"] = pd.to_datetime(account["ts_event"], utc=True, format="mixed").dt.as_unit("ns").astype("int64")
    account = account.sort_values("ts_ns", kind="stable").drop_duplicates("ts_ns", keep="last")
    assert (account["total"] > 0).all()
    assert np.allclose(account["total"], account["locked"] + account["free"], atol=1e-5)
    account = account[["ts_ns", "total", "free"]].rename(columns={"ts_ns": "account_ts_ns"})

    start = pd.Timestamp(summary["period_start_utc"])
    end = pd.Timestamp(summary["period_end_utc"])
    assert start == pd.Timestamp("2025-10-17T00:00:00Z")
    assert end == pd.Timestamp("2026-10-07T08:30:00Z")
    assert account["account_ts_ns"].iloc[0] <= start.value
    assert account["account_ts_ns"].iloc[-1] <= end.value
    coin_days = Counter()
    for (coin, month), state in state_by_key.items():
        month_start = pd.Timestamp(month)
        next_month = month_start + pd.offsets.MonthBegin(1)
        days = max((min(end, next_month) - max(start, month_start)).total_seconds(), 0) / 86400
        coin_days[state["realized_volatility_tercile"]] += days
    assert abs(sum(coin_days.values()) - 37 * (end - start).total_seconds() / 86400) < 1e-8

    detail = []
    for bundle_id, pair in bundles.items():
        pair = sorted(pair, key=lambda row: Decimal(row["price"]), reverse=True)
        first, deeper = pair
        assert Decimal(first["price"]) > Decimal(deeper["price"]) > 0
        assert first["instrument_id"] == deeper["instrument_id"]
        assert first["ts_init"] == deeper["ts_init"]
        assert first["time_in_force"] == deeper["time_in_force"] == "GTD"
        coin = coin_from_instrument(first["instrument_id"])
        init_ns = int(first["ts_init"])
        month = month_at(init_ns)
        state = state_by_key[(coin, month)]
        assert start.value <= init_ns <= end.value
        fills = buy_fills[first["client_order_id"]] + buy_fills[deeper["client_order_id"]]
        earliest_fill = min((pd.Timestamp(fill["ts_event"]).value for fill in fills), default=None)
        positions = position_by_bundle.get(bundle_id, [])
        assert bool(fills) == bool(positions)
        for position in positions:
            assert position["coin"] == coin
            assert int(position["first_order_init_ns"]) == init_ns
            assert position["entry_submission_month_utc"] == month
            assert position["realized_volatility_tercile"] == state["realized_volatility_tercile"]
        detail.append({
            "bundle_id": bundle_id,
            "coin": coin,
            "submission_month_utc": month,
            "ts_init_ns": init_ns,
            "prior_volatility_rank": state["realized_volatility_tercile"],
            "first_tier_positive_buy_fill": bool(buy_fills[first["client_order_id"]]),
            "deeper_tier_positive_buy_fill": bool(buy_fills[deeper["client_order_id"]]),
            "any_positive_buy_fill": bool(fills),
            "first_fill_delay_days": (earliest_fill - init_ns) / 86_400_000_000_000 if earliest_fill else None,
            "native_entry_final_statuses": [first["status"], deeper["status"]],
            "native_positions": [{
                "position_id": position["position_id"],
                "closed": position["closed"],
                "native_realized_pnl_usdt": position["native_realized_pnl_usdt"],
                "net_r_multiple": float(position["net_r_multiple"]) if position["closed"] else None,
            } for position in positions],
        })

    bundle_times = pd.DataFrame({"ts_init_ns": [row["ts_init_ns"] for row in detail]})
    matched = pd.merge_asof(
        bundle_times.sort_values("ts_init_ns", kind="stable"),
        account,
        left_on="ts_init_ns",
        right_on="account_ts_ns",
        direction="backward",
        allow_exact_matches=False,
    )
    at_time = {
        int(row.ts_init_ns): (
            float(row.free / row.total),
            (int(row.ts_init_ns) - int(row.account_ts_ns)) / 1_000_000_000,
        )
        for row in matched.itertuples()
        if not pd.isna(row.account_ts_ns)
    }
    for row in detail:
        sample = at_time.get(row["ts_init_ns"])
        row["prior_account_free_ratio"] = sample[0] if sample else None
        row["prior_account_snapshot_lag_seconds"] = sample[1] if sample else None
    assert all(row["prior_account_free_ratio"] is not None for row in detail)
    assert all(0 <= row["prior_account_free_ratio"] <= 1.000001 for row in detail)
    assert all(0 < row["prior_account_snapshot_lag_seconds"] <= (end - start).total_seconds() + 864000
               for row in detail)

    detail.sort(key=lambda row: (row["ts_init_ns"], row["coin"], row["bundle_id"]))
    by_rank = {
        rank: _segment([row for row in detail if row["prior_volatility_rank"] == rank], coin_days[rank])
        for rank in RANKS
    }
    assert sum(item["submitted_bundles"] for item in by_rank.values()) == 2939
    assert sum(item["positive_fill_bundles"] for item in by_rank.values()) == 500
    assert sum(item["native_positions"] for item in by_rank.values()) == 507
    for rank in RANKS:
        frozen = d71["runs"]["H19a"]["feature_terciles"]["realized_volatility"][rank]
        assert by_rank[rank]["native_closed_positions"] == frozen["closed_positions"]
        assert by_rank[rank]["native_open_right_censored_positions"] == frozen["open_right_censored_positions"]
        assert by_rank[rank]["native_closed_wins"] == frozen["wins"]
        assert by_rank[rank]["native_closed_pnl_usdt"] == frozen["sum_closed_native_realized_pnl_usdt"]
    source_plans = sum(row["tiered_pullback"]["source_plans"] for row in summary["per_coin"])
    submitted = sum(row["tiered_pullback"]["submitted_bundles"] for row in summary["per_coin"])
    assert (source_plans, submitted) == (2940, 2939)
    per_coin = {}
    for coin in d71["coins"]:
        rows = [row for row in detail if row["coin"] == coin]
        native = next(item for item in summary["per_coin"] if item["coin"] == coin)
        assert len(rows) == native["tiered_pullback"]["submitted_bundles"]
        per_coin[coin] = {
            "submitted": len(rows),
            "filled_bundles": sum(row["any_positive_buy_fill"] for row in rows),
            "source_plans": native["tiered_pullback"]["source_plans"],
            "not_submitted_source_plans": native["tiered_pullback"]["source_plans"] - len(rows),
            "rank_counts": dict(sorted(Counter(row["prior_volatility_rank"] for row in rows).items())),
        }
    per_month = {}
    for month in sorted({state["month_start_utc"] for state in state_by_key.values()}):
        rows = [row for row in detail if row["submission_month_utc"] == month]
        per_month[month] = {
            "submitted": len(rows),
            "filled_bundles": sum(row["any_positive_buy_fill"] for row in rows),
            "rank_counts": dict(sorted(Counter(row["prior_volatility_rank"] for row in rows).items())),
        }
    DETAIL.write_bytes(gzip.compress(
        json.dumps(detail, ensure_ascii=False, separators=(",", ":")).encode(),
        mtime=0,
    ))
    output = {
        "schema": "r1-native-d76-opportunity-selection/v1",
        "preregistration_commit": "99ce63fa9",
        "account_timing_clarification_commit": "738544e51",
        "input_sha256": inputs,
        "native_run": str(RUN),
        "period_start_utc": summary["period_start_utc"],
        "period_end_utc": summary["period_end_utc"],
        "method": "Native two-tier parent BUY LIMIT bundles, fills, Positions and strictly prior native account snapshots grouped by D71 previous-60-day volatility rank at order submission. Eligible denominator retains all 37 coin-month states including zero-submission periods.",
        "source_plans": source_plans,
        "submitted_bundles": submitted,
        "unsubmitted_source_plans_without_order_timestamp": source_plans - submitted,
        "by_volatility_rank": by_rank,
        "per_coin": per_coin,
        "per_submission_month_utc": per_month,
        "bundle_detail_file": DETAIL.name,
        "bundle_detail_sha256": sha(DETAIL),
        "limitations": [
            "One Strategy source plan without a native submission timestamp is retained as unclassified; no feature rank or fill is invented for it.",
            "Pre-submission free/total comes from the latest strictly earlier exported native account snapshot and may be stale; it is not a hypothetical new order's risk admissibility.",
            "Bundle fill conversion is observed under the actual competing 37-coin account and conditional on the Strategy's signal and order logic. Removing a class would alter future slots, margin, fees, funding and equity.",
            "Closed Position net R is conditional on native fill and closure; open Positions are right-censored. These viewed-year group differences are not a filtered-portfolio backtest or independent validation.",
        ],
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"summary": str(OUTPUT), "sha256": sha(OUTPUT), "bundle_sha256": sha(DETAIL), "by_rank": by_rank}, ensure_ascii=False))


if __name__ == "__main__":
    main()
