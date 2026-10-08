"""
Describe shared-account margin and marked position exposure from native reports.

This is a read-only diagnostic. It does not alter sizing or replace the native portfolio
return denominator.

"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _timestamp_ns(values) -> np.ndarray:
    return (
        pd.to_datetime(values, utc=True, format="mixed").dt.as_unit("ns").astype("int64").to_numpy()
    )


def _account_usage(run: Path, start_ns: int, end_ns: int) -> dict:
    account = pd.read_csv(run / "account.csv", usecols=["ts_event", "total", "locked", "free"])
    account["ts_ns"] = _timestamp_ns(account.ts_event)
    account = account.sort_values("ts_ns", kind="stable").drop_duplicates("ts_ns", keep="last")
    if account.empty or account.ts_ns.iloc[0] > start_ns or account.ts_ns.iloc[-1] > end_ns:
        raise RuntimeError("native account snapshots do not cover the replay interval")
    if not np.allclose(account.total, account.locked + account.free, atol=1e-5):
        raise RuntimeError("native account total does not reconcile with locked and free")
    earlier = account[account.ts_ns <= start_ns].tail(1).copy()
    earlier.loc[:, "ts_ns"] = start_ns
    steps = pd.concat(
        [earlier, account[(account.ts_ns > start_ns) & (account.ts_ns <= end_ns)]],
        ignore_index=True,
    )
    next_times = np.r_[steps.ts_ns.to_numpy()[1:], end_ns]
    weights = next_times - steps.ts_ns.to_numpy()
    if np.any(weights < 0) or weights.sum() != end_ns - start_ns:
        raise RuntimeError("native account snapshot clock has a gap or reversal")
    locked = steps.locked.to_numpy()
    total = steps.total.to_numpy()
    peak = steps.iloc[int(np.argmax(locked))]
    return {
        "account_report_rows": len(account),
        "final_realized_account_balance_usdt": float(account.total.iloc[-1]),
        "final_locked_margin_usdt": float(account.locked.iloc[-1]),
        "peak_locked_margin_usdt": float(peak.locked),
        "peak_locked_margin_utc": pd.Timestamp(int(peak.ts_ns), tz="UTC").isoformat(),
        "time_weighted_mean_locked_margin_usdt": float(np.average(locked, weights=weights)),
        "time_weighted_mean_locked_fraction_of_account_total": float(
            np.average(locked / total, weights=weights),
        ),
        "time_fraction_zero_locked_margin": float(weights[locked == 0].sum() / weights.sum()),
    }


def _position_usage(  # noqa: C901 - checks native bars and fills together.
    run: Path,
    root: Path,
    summary: dict,
    start_ns: int,
    end_ns: int,
) -> dict:
    fills = pd.read_csv(
        run / "fills.csv",
        usecols=["instrument_id", "order_side", "last_qty", "ts_event"],
    )
    fills["ts_ns"] = _timestamp_ns(fills.ts_event)
    if not fills.ts_ns.between(start_ns, end_ns).all():
        raise RuntimeError("native fill lies outside the replay interval")
    positions = pd.read_csv(
        run / "positions.csv",
        usecols=["instrument_id", "quantity", "ts_closed"],
    )
    live = positions[positions.ts_closed.isna()].groupby("instrument_id").quantity.sum()
    total_notional = None
    active_positions = None
    reference_times = None
    for row in summary["per_coin"]:
        instrument_id = row["instrument"]
        catalog = ParquetDataCatalog(str(root / row["coin"] / "minute"))
        instruments = catalog.instruments(instrument_ids=[instrument_id])
        if len(instruments) != 1:
            raise RuntimeError(f"missing native Instrument for {row['coin']}")
        multiplier = instruments[0].multiplier.as_double()
        mark_type = BarType.from_str(f"{instrument_id}-5-MINUTE-MARK-EXTERNAL")
        bars = catalog.query_bars([instrument_id], start=start_ns, end=end_ns)
        mark = sorted(
            (bar for bar in bars if bar.bar_type == mark_type),
            key=lambda bar: bar.ts_event,
        )
        times = np.fromiter((bar.ts_event for bar in mark), dtype=np.int64)
        prices = np.fromiter((float(bar.close) for bar in mark), dtype=np.float64)
        if len(times) != row["counts"]["mark"] - (
            start_ns - int(summary["input_start_utc_ns"])
        ) // (5 * 60_000_000_000):
            raise RuntimeError(f"{row['coin']}: MARK coverage differs from native summary")
        if reference_times is None:
            reference_times = times
            total_notional = np.zeros(len(times), dtype=np.float64)
            active_positions = np.zeros(len(times), dtype=np.int16)
        elif not np.array_equal(times, reference_times):
            raise RuntimeError(f"{row['coin']}: MARK grid differs from other coins")
        coin_fills = fills[fills.instrument_id == instrument_id].sort_values("ts_ns", kind="stable")
        fill_times = coin_fills.ts_ns.to_numpy()
        signed = np.where(
            coin_fills.order_side.to_numpy() == "BUY",
            coin_fills.last_qty.to_numpy(),
            -coin_fills.last_qty.to_numpy(),
        )
        cumulative = np.r_[0.0, np.cumsum(signed)]
        qty = cumulative[np.searchsorted(fill_times, times, side="right")]
        if np.any(qty < -1e-6):
            raise RuntimeError(f"{row['coin']}: native fills create a net short")
        expected_end_qty = float(live.get(instrument_id, 0.0))
        if not np.isclose(qty[-1], expected_end_qty, atol=1e-5):
            raise RuntimeError(f"{row['coin']}: final fills and open position disagree")
        total_notional += np.maximum(qty, 0) * prices * multiplier
        active_positions += qty > 1e-6
    if len(reference_times) < 2 or reference_times[-1] > end_ns:
        raise RuntimeError("native MARK grid does not cover the portfolio interval")
    step = 5 * 60_000_000_000
    if np.any(np.diff(reference_times) != step):
        raise RuntimeError("native MARK grid is not contiguous")
    peak_index = int(np.argmax(total_notional))
    return {
        "mark_observations": len(reference_times),
        "native_fills": len(fills),
        "final_open_positions": int(live.size),
        "final_marked_open_notional_usdt": float(total_notional[-1]),
        "peak_marked_open_notional_usdt": float(total_notional[peak_index]),
        "peak_marked_open_notional_utc": pd.Timestamp(
            int(reference_times[peak_index]),
            tz="UTC",
        ).isoformat(),
        "time_weighted_mean_marked_open_notional_usdt": float(total_notional.mean()),
        "time_fraction_zero_open_notional": float((total_notional == 0).mean()),
        "peak_simultaneously_open_coins": int(active_positions.max()),
        "time_weighted_mean_simultaneously_open_coins": float(active_positions.mean()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    summary_path = args.run / "summary.json"
    summary = json.loads(summary_path.read_text())
    if (
        not summary["integrity_passed"]
        or summary["account_model"].split(",")[0] != "one native BacktestEngine margin account"
    ):
        raise RuntimeError("one complete native shared-account run is required")
    start_ns = pd.Timestamp(summary["period_start_utc"]).value
    end_ns = pd.Timestamp(summary["period_end_utc"]).value
    summary["input_start_utc_ns"] = pd.Timestamp(summary["input_start_utc"]).value
    account = _account_usage(args.run, start_ns, end_ns)
    positions = _position_usage(args.run, args.catalog_root, summary, start_ns, end_ns)
    final_equity = float(summary["final_equity_usdt"])
    initial = float(summary["starting_balance_usdt"])
    output = {
        "schema": "r1-native-capital-utilization-diagnostic/v1",
        "run": str(args.run),
        "input_sha256": {
            name: _sha(args.run / name)
            for name in ("summary.json", "account.csv", "fills.csv", "positions.csv")
        },
        "period_start_utc": summary["period_start_utc"],
        "period_end_utc": summary["period_end_utc"],
        "initial_portfolio_equity_usdt": initial,
        "final_native_portfolio_equity_usdt": final_equity,
        "ending_unrealized_pnl_usdt": final_equity - account["final_realized_account_balance_usdt"],
        "account_period_return_pct": summary["period_return_pct"],
        "account_annualized_return_pct": summary["annualized_return_pct"],
        "descriptive_net_change_over_mean_locked_margin": (final_equity - initial)
        / account["time_weighted_mean_locked_margin_usdt"],
        "descriptive_net_change_over_mean_marked_open_notional": (final_equity - initial)
        / positions["time_weighted_mean_marked_open_notional_usdt"],
        "account": account,
        "positions": positions,
        "limitations": [
            "Locked margin includes native order/position reservations and is not the same as executed notional.",
            "Marked position notional uses five-minute MARK closes and native fill quantity, so same-bar event order is only five-minute resolved.",
            "Return over average occupied capital is descriptive and must not replace shared-account annualized return or be interpreted as a standalone investable CAGR.",
        ],
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
