"""
Read H19a native reports for the preregistered D63 capital-binding check.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd


EXPECTED_SHA256 = {
    "summary.json": "7d95658949badb9b76ead4b7fcbebda8b5901c836b332bc9bec57dc0d859f7ec",
    "account.csv": "3915a20a8daf2ab25993dea1b3be7676e21db2c623b0aa8c9a096d6b9d4364b3",
    "orders.csv": "9bc7228673948e0299e2f208405d870eb7c8b2215ce44b0b10006102da97feaa",
    "fills.csv": "3b798730719e633f02bcd2fc05977cacbeaecb539d9de584536bc25a71ffa391",
    "positions.csv": "54e211bcf50de11269800a2c7f8e0e2a77e3704a1efd30292e60b7ec96a77a3a",
}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _timestamp_ns(values: pd.Series) -> np.ndarray:
    return (
        pd.to_datetime(values, utc=True, format="mixed").dt.as_unit("ns").astype("int64").to_numpy()
    )


def _utc(ns: int) -> str:
    return pd.Timestamp(ns, tz="UTC").isoformat()


def _read_reports(run: Path) -> tuple[dict, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    actual = {name: _sha(run / name) for name in EXPECTED_SHA256}
    if actual != EXPECTED_SHA256:
        raise RuntimeError(f"registered native report identity mismatch: {actual}")
    summary = json.loads((run / "summary.json").read_text())
    if not summary["integrity_passed"] or summary["denied_orders"] or summary["rejected_orders"]:
        raise RuntimeError("H19a accepted run integrity or order event counts changed")
    account = pd.read_csv(
        run / "account.csv",
        usecols=["ts_event", "total", "locked", "free", "margins"],
    )
    orders = pd.read_csv(
        run / "orders.csv",
        usecols=[
            "client_order_id",
            "instrument_id",
            "side",
            "type",
            "status",
            "parent_order_id",
            "ts_init",
            "ts_last",
        ],
    )
    fills = pd.read_csv(
        run / "fills.csv",
        usecols=[
            "client_order_id",
            "instrument_id",
            "order_side",
            "last_qty",
            "ts_event",
        ],
    )
    return summary, account, orders, fills


def _fill_state(fills: pd.DataFrame) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    fills["ts_ns"] = _timestamp_ns(fills.ts_event)
    result = {}
    for instrument, coin_rows in fills.groupby("instrument_id", sort=False):
        rows = coin_rows.sort_values("ts_ns", kind="stable")
        signed = np.where(
            rows.order_side.to_numpy() == "BUY",
            rows.last_qty,
            -rows.last_qty,
        )
        result[instrument] = (
            rows.ts_ns.to_numpy(),
            np.r_[0.0, np.cumsum(signed)],
        )
    return result


def _entry_state(
    orders: pd.DataFrame,
    end_ns: int,
) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    entry = orders[
        (orders.side == "BUY") & (orders.type == "LIMIT") & orders.parent_order_id.isna()
    ].copy()
    entry["end_ns"] = np.where(
        entry.status.isin(("ACCEPTED", "SUBMITTED", "PENDING_CANCEL")),
        end_ns + 1,
        entry.ts_last,
    )
    return {
        instrument: (
            rows.ts_init.to_numpy(dtype=np.int64),
            rows.end_ns.to_numpy(dtype=np.int64),
        )
        for instrument, rows in entry.groupby("instrument_id", sort=False)
    }


def _reservation_usage(
    account: pd.DataFrame,
    fill_state: dict[str, tuple[np.ndarray, np.ndarray]],
    entry_state: dict[str, tuple[np.ndarray, np.ndarray]],
    start_ns: int,
    end_ns: int,
) -> dict:
    account["ts_ns"] = _timestamp_ns(account.ts_event)
    account = account.sort_values("ts_ns", kind="stable").drop_duplicates(
        "ts_ns",
        keep="last",
    )
    if account.empty or account.ts_ns.iloc[0] > start_ns or account.ts_ns.iloc[-1] > end_ns:
        raise RuntimeError(
            "native account snapshots do not cover the eligible interval",
        )
    if not np.allclose(account.total, account.locked + account.free, atol=1e-5):
        raise RuntimeError("account total does not reconcile with locked and free")
    initial = account[account.ts_ns <= start_ns].tail(1).copy()
    initial.loc[:, "ts_ns"] = start_ns
    states = pd.concat(
        [initial, account[(account.ts_ns > start_ns) & (account.ts_ns <= end_ns)]],
        ignore_index=True,
    )
    times = states.ts_ns.to_numpy(dtype=np.int64)
    weights = np.r_[times[1:], end_ns] - times
    if np.any(weights < 0) or weights.sum() != end_ns - start_ns:
        raise RuntimeError(
            "native account snapshot timeline does not cover the interval",
        )
    flat_margin = np.zeros(len(states))
    matched_flat_margin = np.zeros(len(states))
    unmatched_rows = 0
    flat_instruments = 0
    margin_records = 0
    for i, state in enumerate(states.itertuples()):
        native_margins = ast.literal_eval(state.margins)
        margin_sum = 0.0
        for margin in native_margins:
            instrument = margin["instrument_id"]
            initial_margin = float(margin["initial"])
            maintenance = float(margin["maintenance"])
            margin_sum += initial_margin + maintenance
            margin_records += 1
            fill_times, cumulative_qty = fill_state.get(
                instrument,
                (np.array([], dtype=np.int64), np.array([0.0])),
            )
            qty = cumulative_qty[np.searchsorted(fill_times, state.ts_ns, side="right")]
            if initial_margin <= 0 or not np.isclose(qty, 0, atol=1e-8):
                continue
            flat_instruments += 1
            if abs(maintenance) > 1e-5:
                raise RuntimeError("flat instrument has nonzero maintenance margin")
            flat_margin[i] += initial_margin
            starts, ends = entry_state.get(
                instrument,
                (np.array([], dtype=np.int64), np.array([], dtype=np.int64)),
            )
            if np.any((starts <= state.ts_ns) & (state.ts_ns < ends)):
                matched_flat_margin[i] += initial_margin
            else:
                unmatched_rows += 1
        if not np.isclose(margin_sum, state.locked, atol=1e-5):
            raise RuntimeError(
                f"native instrument margin sum does not match locked at {_utc(state.ts_ns)}",
            )
    locked = states.locked.to_numpy(dtype=float)
    free = states.free.to_numpy(dtype=float)
    min_free_idx = int(np.argmin(free))
    peak_flat_idx = int(np.argmax(flat_margin))
    return {
        "unique_native_account_snapshots": len(account),
        "eligible_account_states": len(states),
        "native_margin_records_examined": margin_records,
        "flat_instrument_margin_records": flat_instruments,
        "flat_margin_without_matching_open_entry_records": unmatched_rows,
        "minimum_free_usdt": float(free[min_free_idx]),
        "minimum_free_utc": _utc(int(times[min_free_idx])),
        "time_weighted_mean_locked_usdt": float(np.average(locked, weights=weights)),
        "time_weighted_mean_flat_initial_margin_usdt": float(
            np.average(flat_margin, weights=weights),
        ),
        "time_weighted_mean_matched_flat_entry_margin_usdt": float(
            np.average(matched_flat_margin, weights=weights),
        ),
        "flat_initial_margin_share_of_mean_locked": float(
            np.average(flat_margin, weights=weights) / np.average(locked, weights=weights),
        ),
        "matched_flat_entry_margin_share_of_mean_locked": float(
            np.average(matched_flat_margin, weights=weights) / np.average(locked, weights=weights),
        ),
        "peak_flat_initial_margin_usdt": float(flat_margin[peak_flat_idx]),
        "peak_flat_initial_margin_utc": _utc(int(times[peak_flat_idx])),
        "time_fraction_any_flat_initial_margin": float(
            weights[flat_margin > 0].sum() / weights.sum(),
        ),
        "time_fraction_free_above_half_initial": float(
            weights[free > 50_000].sum() / weights.sum(),
        ),
    }


def _first_fill_age(orders: pd.DataFrame, fills: pd.DataFrame) -> dict:
    entry = orders[
        (orders.side == "BUY") & (orders.type == "LIMIT") & orders.parent_order_id.isna()
    ]
    first = (
        fills[fills.order_side == "BUY"]
        .groupby("client_order_id", sort=False)
        .ts_ns.min()
        .rename("first_fill_ns")
    )
    matched = entry.join(first, on="client_order_id").dropna(subset=["first_fill_ns"])
    age_days = (
        matched.first_fill_ns.to_numpy(dtype=np.int64) - matched.ts_init.to_numpy(dtype=np.int64)
    ) / 86_400_000_000_000
    if len(age_days) != 881 or np.any(age_days < 0):
        raise RuntimeError("native positive entry count or event order changed")
    return {
        "native_positively_filled_entry_orders": len(age_days),
        "submission_to_first_fill_days_median": float(np.median(age_days)),
        "submission_to_first_fill_days_p90": float(np.quantile(age_days, 0.9)),
        "submission_to_first_fill_days_max": float(np.max(age_days)),
        "first_fill_within_one_day": int(np.count_nonzero(age_days <= 1)),
        "first_fill_after_seven_days": int(np.count_nonzero(age_days > 7)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    summary, account, orders, fills = _read_reports(args.run)
    start_ns = pd.Timestamp(summary["period_start_utc"]).value
    end_ns = pd.Timestamp(summary["period_end_utc"]).value
    fill_state = _fill_state(fills)
    entry_state = _entry_state(orders, end_ns)
    reservation = _reservation_usage(account, fill_state, entry_state, start_ns, end_ns)
    age = _first_fill_age(orders, fills)
    output = {
        "schema": "r1-native-d63-capital-binding-diagnostic/v1",
        "preregistration_commit": "a3069a4f9",
        "input_sha256": EXPECTED_SHA256,
        "method": "Native account last snapshot per timestamp, time weighted over order eligibility; flat-symbol initial margin from native balances and fill position state; accepted BUY LIMIT coverage from native order lifecycle. No new orders or PnL.",
        "account_reservation": reservation,
        "entry_fill_age": age,
        "native_denied_orders": summary["denied_orders"],
        "native_rejected_orders": summary["rejected_orders"],
        "sizing_dependencies": {
            "strategy_source": "tiered_retracement_strategy.py:_tier_quantities",
            "portfolio_equity": True,
            "available_free_balance": False,
            "outstanding_order_reservations": False,
            "per_tier_stop_risk_fraction": 0.0025 / 2,
            "per_tier_coin_notional_fraction": 0.05 / 2,
        },
        "binding_capital_to_larger_next_order_gate_passed": not (
            summary["denied_orders"] == 0
            and summary["rejected_orders"] == 0
            and reservation["minimum_free_usdt"] > 50_000
        ),
        "limitations": [
            "A flat-symbol initial margin is a lower-bound native order reservation, not executed exposure.",
            "Account snapshots are held until the next native account event; they do not reconstruct every intrabar transient.",
            "Order submission-to-fill age is descriptive; a dormant near-price rule can miss fast touches and needs a separate preregistered native replay.",
            "The capital-binding decision applies only to unchanged H19a sizing and this accepted shared-account run.",
        ],
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
