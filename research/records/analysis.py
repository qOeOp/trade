"""Read-only diagnosis of sealed native R1 reports.

Readings come from manifest-verified native reports; names and definitions
follow docs/plans/native-rd-analysis-fields.zh.md. The analyzer never writes a
seal, reads Dolt for a single run, or re-values positions. A reading it cannot
derive is null and its reason is listed in ``limitations``.
"""

from __future__ import annotations

import ast
import csv
import hashlib
import io
import json
import math
import random
from collections import Counter, OrderedDict
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path

from research.records.common import ROOT, RecordError


OUTPUT_LIMIT = 32_768
TOLERANCE = Decimal("0.000001")
DAY_NS = 86_400_000_000_000
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
REPORT_FILES = ("summary.json", "audit.json", "orders.csv", "fills.csv", "positions.csv", "returns_series.csv")
SUMMARY_FIELDS = (
    "input_start_utc", "period_start_utc", "period_end_utc", "data_interval_minutes",
    "starting_balance_usdt", "final_equity_usdt", "net_change_usdt", "annualized_return_pct",
    "native_sharpe_365", "native_max_drawdown_daily_close", "closed_trades", "winning_trades",
    "closed_trade_win_rate",
)
# Readings added to compare ``metrics`` by --analysis, keyed by report key path.
PAIR_READINGS = (
    "closed_trades", "closed.entry_notional_usdt", "closed.price_pnl_usdt",
    "closed.fill_commissions_usdt", "closed.reported_funding_usdt",
    "closed.reported_realized_pnl_usdt", "unrealized_residual_usdt", "open_positions",
    "closed_bps_of_entry_notional.price_pnl", "closed_bps_of_entry_notional.fill_commissions",
    "closed_bps_of_entry_notional.reported_funding", "closed_bps_of_entry_notional.reported_realized",
    "taker_fill_notional_share",
)
EX_ANTE_LIMITATION = ("The control was bound at registration after results; no machine-verifiable "
                      "ex-ante reference declaration exists.")
PAIRED_METHOD = ("paired ISO-week bootstrap of daily log-return differences on already viewed native "
                 "daily returns, reported as annualized relative growth; exploratory, unadjusted for prior tests")
PAIRED_SEED = 20261008
PAIRED_DRAWS = 5000


class _Unsupported(Exception):
    """Native facts outside the R1 linear-USDT scope or failing a boundary check."""


def report(root: Path, run_id: str) -> dict:
    """Diagnose one sealed run without reading Dolt."""
    output, _ = _analyze(Path(root), run_id)
    output["analysis"] = _identity(("research/records/analysis.py",))
    output = _ordered(output)
    check_size(output)
    return output


def pair(root: Path, candidate: dict, control: dict, selection: dict | None) -> dict:
    """Readings that extend a passed formal compare, from both manifest-verified seals.

    The returned ``metrics`` entries are added to the compare ``metrics`` object.
    """
    sides = []
    for run in (candidate, control):
        anchor = run.get("artifact_manifest_ref") or {}
        if anchor.get("path") != f"artifact://{run['run_id']}/manifest.json" or not anchor.get("sha256"):
            raise RecordError(f"{run['run_id']}: --analysis requires a Dolt-anchored sealed manifest",
                              code="decision_pair_integrity", path="/artifact_manifest_ref",
                              expected=f"artifact://{run['run_id']}/manifest.json with its sha256",
                              next_actions=["Compare without --analysis, or register a sealed native run."],
                              write_status="not_written")
        output, returns = _analyze(Path(root), run["run_id"])
        if anchor["sha256"] != output["manifest_sha256"]:
            raise RecordError(f"{run['run_id']}: sealed manifest differs from its Dolt anchor",
                              code="decision_pair_integrity", path="/artifact_manifest_ref",
                              expected=anchor["sha256"], write_status="not_written")
        sides.append((output, returns))
    (left, left_returns), (right, right_returns) = sides
    shared = set(left["limitations"]) & set(right["limitations"])
    limitations = _unique([item for item in left["limitations"] if item in shared]
                          + [f"{side['run_id']}: {item}" for side in (left, right)
                             for item in side["limitations"] if item not in shared]
                          + [EX_ANTE_LIMITATION])
    paired = None
    if not selection or selection.get("primary_response") != "final_equity_usdt":
        limitations.append("paired_daily_returns is null: the candidate's preregistered primary_response "
                           "is not final_equity_usdt")
    elif left_returns is None or right_returns is None:
        limitations.append("paired_daily_returns is null: a native daily return series is unavailable")
    elif [ts for ts, _ in left_returns] != [ts for ts, _ in right_returns]:
        limitations.append("paired_daily_returns is null: the native daily-return timelines differ")
    else:
        paired = _paired(left_returns, right_returns)
    months = sorted(set(left["monthly_account_return_pct"] or {}) | set(right["monthly_account_return_pct"] or {}))
    return {
        "strategy_binding": [candidate.get("strategy_binding"), control.get("strategy_binding")],
        "artifact_manifest_ref": [candidate.get("artifact_manifest_ref"), control.get("artifact_manifest_ref")],
        "selection": selection,
        "metrics": {name: entry(_path(left, name), _path(right, name)) for name in PAIR_READINGS},
        "by_instrument": _pair_instruments(left["by_instrument"], right["by_instrument"]),
        "monthly_account_return_pct": {
            month: entry((left["monthly_account_return_pct"] or {}).get(month),
                         (right["monthly_account_return_pct"] or {}).get(month))
            for month in months
        },
        "paired_daily_returns": paired,
        "analysis": _identity(("research/records/analysis.py", "backtest/r1/checks/compare_paired_returns.py")),
        "limitations": limitations,
    }


def entry(candidate, control) -> dict:
    """Compare entry shape shared with ``compare`` metrics."""
    return {"candidate": candidate, "control": control, "difference": difference(candidate, control)}


def difference(candidate, control) -> str | None:
    """Exact decimal difference, or null when either side is not a finite number."""
    if any(value is None or isinstance(value, bool) for value in (candidate, control)):
        return None
    try:
        left, right = Decimal(str(candidate)), Decimal(str(control))
    except InvalidOperation:
        return None
    if not (left.is_finite() and right.is_finite()):
        return None
    return format(left - right, "f")


def check_size(output: dict) -> None:
    size = len(json.dumps(output, ensure_ascii=False, indent=2).encode())
    if size > OUTPUT_LIMIT:
        raise RecordError(f"analysis output is {size} bytes, above the {OUTPUT_LIMIT}-byte bound",
                          expected=f"at most {OUTPUT_LIMIT} UTF-8 bytes at indent=2",
                          next_actions=["Report this as an analyzer defect; do not truncate or drop readings to fit."],
                          write_status="not_written")


def _analyze(root: Path, run_id: str) -> tuple[dict, list[tuple[int, float]] | None]:
    checked, manifest, reports = _sealed(root, run_id)
    files = manifest["files"]

    def ref(name):
        item = files.get(f"reports/{name}")
        return None if item is None else {"path": f"artifact://{run_id}/reports/{name}", "sha256": item["sha256"]}

    summary = json.loads(reports["summary.json"]) if "summary.json" in reports else None
    audit = json.loads(reports["audit.json"]) if "audit.json" in reports else None
    economics = (audit or {}).get("native_economics")
    output = {
        "run_id": run_id, "status": manifest["status"], "problems": manifest.get("problems", []),
        "manifest_sha256": checked["manifest_sha256"], "record_binding": manifest.get("record_binding"),
        "summary_ref": ref("summary.json"), "audit_ref": ref("audit.json"),
        **{field: (summary or {}).get(field) for field in SUMMARY_FIELDS},
        "native_economics": economics,
    }
    limitations = _unique(list((summary or {}).get("limitations", [])) + list((audit or {}).get("coverage_limits", [])))
    if manifest["status"] != "passed" or summary is None:
        output.update(dict.fromkeys((*SUMMARY_FIELDS, "native_economics", *_DERIVED)))
        output["limitations"] = limitations + ["The seal did not pass; native economics are not read."]
        return output, None
    if economics is None:
        limitations.append("native_economics is absent from the audit; unrealized_residual_usdt is null "
                           "and the account boundary is checked only against the seal's own reports.")
    output.update(_orders(_rows(reports["orders.csv"]), limitations))
    returns = _returns(reports["returns_series.csv"], summary)
    output.update(_returns_readings(returns, summary, limitations))
    if output["monthly_account_return_pct"] is None:
        returns = None  # rejected series: no reading, including the paired interval, uses it
    try:
        output.update(_positions(_rows(reports["positions.csv"]), _rows(reports["fills.csv"]),
                                 summary, economics, limitations))
    except _Unsupported as exc:
        output.update(dict.fromkeys(_POSITION_DERIVED))
        limitations.append(f"Position-derived readings are null: {exc}")
    output["limitations"] = limitations
    return output, returns


_POSITION_DERIVED = (
    "closed", "open_positions", "open_entry_notional_usdt", "unrealized_residual_usdt",
    "closed_bps_of_entry_notional", "closed_realized_pnl_quantiles_usdt", "taker_fill_notional_share",
    "closed_duration_hours_quantiles", "zero_duration_closed", "max_consecutive_losing_closed",
    "by_instrument", "by_entry_side",
)
_DERIVED = _POSITION_DERIVED + (
    "orders_by_tag_status", "partially_filled_orders", "max_drawdown_daily_close_dates", "worst_day",
    "monthly_account_return_pct",
)
_ORDER = (
    "run_id", "status", "problems", "manifest_sha256", "record_binding", "summary_ref", "audit_ref", "analysis",
    *SUMMARY_FIELDS, "native_economics", "closed", "open_positions", "open_entry_notional_usdt",
    "unrealized_residual_usdt", "closed_bps_of_entry_notional", "closed_realized_pnl_quantiles_usdt",
    "taker_fill_notional_share", "orders_by_tag_status", "partially_filled_orders",
    "closed_duration_hours_quantiles", "zero_duration_closed", "max_drawdown_daily_close_dates", "worst_day",
    "max_consecutive_losing_closed", "monthly_account_return_pct", "by_instrument", "by_entry_side", "limitations",
)


def _ordered(output: dict) -> dict:
    return {key: output[key] for key in _ORDER}


def _sealed(root: Path, run_id: str) -> tuple[dict, dict, dict[str, bytes]]:
    """Verify the seal, then parse only bytes re-hashed against its manifest."""
    from research.records.artifacts import ArtifactError, verify
    try:
        checked = verify(root, run_id)
    except (ArtifactError, RecordError, OSError, KeyError, ValueError) as exc:
        raise RecordError(f"{run_id}: sealed report verification failed: {exc}", path=f"{root}/{run_id}",
                          next_actions=["Check the run ID and artifact root, then restore an edited or missing seal "
                                        "from its verified backup; do not analyze unsealed or edited reports."],
                          write_status="not_written") from exc
    path = root.resolve() / run_id
    raw = (path / "manifest.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != checked["manifest_sha256"]:
        raise RecordError(f"{run_id}: manifest changed after verification", write_status="not_written")
    manifest = json.loads(raw)
    reports = {}
    for name in REPORT_FILES:
        item = manifest["files"].get(f"reports/{name}")
        if item is None:
            continue
        data = (path / "reports" / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise RecordError(f"{run_id}: reports/{name} changed after verification", write_status="not_written")
        reports[name] = data
    return checked, manifest, reports


def _rows(data: bytes) -> list[dict]:
    csv.field_size_limit(2**31 - 1)  # positions.events holds every fill of a cycle in one cell
    return list(csv.DictReader(io.StringIO(data.decode("utf-8"), newline="")))


def _list(value: str) -> list:
    # Native reports write Python reprs (single quotes, None), not JSON.
    return ast.literal_eval(value) if value else []


def _usdt(value: str) -> Decimal:
    amount, _, currency = value.partition(" ")
    if currency != "USDT":
        raise _Unsupported(f"non-USDT money {value!r} is outside the R1 linear USDT scope")
    return Decimal(amount)


def _money(value: Decimal | None) -> str | None:
    return None if value is None else format(value.quantize(Decimal("0.00000001")), "f")


def _ns(text: str) -> int:
    moment = datetime.fromisoformat(text)
    return (moment - EPOCH) // timedelta(microseconds=1) * 1000


def _iso(ns: int) -> str:
    return (EPOCH + timedelta(microseconds=ns // 1000)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _nearest_rank(values: list, probability: float):
    ordered = sorted(values)
    return ordered[max(1, math.ceil(probability * len(ordered))) - 1]


def _unique(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


def _orders(orders: list[dict], limitations: list[str]) -> dict:
    if not orders:
        return {"orders_by_tag_status": {}, "partially_filled_orders": 0}
    missing = sorted({"tags", "status", "filled_qty", "quantity"} - set(orders[0]))
    if missing:
        limitations.append(f"Order readings are null: orders.csv lacks {', '.join(missing)}.")
        return {"orders_by_tag_status": None, "partially_filled_orders": None}
    counts: dict[str, Counter] = {}
    partial = 0
    for order in orders:
        tags = _list(order["tags"])
        counts.setdefault("+".join(tags) if tags else "untagged", Counter())[order["status"]] += 1
        partial += Decimal(0) < Decimal(order["filled_qty"]) < Decimal(order["quantity"])
    return {
        "orders_by_tag_status": {key: dict(sorted(value.items())) for key, value in sorted(counts.items())},
        "partially_filled_orders": partial,
    }


def _returns(data: bytes, summary: dict) -> list[tuple[int, float]]:
    start = _ns(summary["period_start_utc"])
    returns = [(int(row["ts_event_ns"]), float(row["native_return"])) for row in _rows(data)]
    return [(ts, value) for ts, value in returns if ts >= start]


def _returns_readings(returns: list[tuple[int, float]], summary: dict, limitations: list[str]) -> dict:
    empty = {"max_drawdown_daily_close_dates": None, "worst_day": None, "monthly_account_return_pct": None}
    if not returns or any(value <= -1 for _, value in returns):
        limitations.append("Daily return readings are null: the trade-window native return series is empty or invalid.")
        return empty
    growth = math.prod(1 + value for _, value in returns)
    implied = Decimal(summary["starting_balance_usdt"]) * Decimal(repr(growth))
    if abs(implied - Decimal(summary["final_equity_usdt"])) > TOLERANCE:
        limitations.append("Daily return readings are null: trade-window returns do not compound to final_equity_usdt.")
        return empty
    end = _ns(summary["period_end_utc"])
    curve, equity = [(_ns(summary["period_start_utc"]), 1.0)], 1.0
    for ts, value in returns:
        equity *= 1 + value
        curve.append((min(ts + DAY_NS, end), equity))
    peak_value, peak_time, depth, worst = -1.0, None, 0.0, None
    for ts, value in curve:
        if value > peak_value:
            peak_value, peak_time = value, ts
        if value / peak_value - 1 < depth:
            depth, worst = value / peak_value - 1, (peak_time, ts, peak_value)
    dates = None
    if worst is None:
        limitations.append("No daily-close drawdown: max_drawdown_daily_close_dates is null.")
    else:
        if abs(depth - summary["native_max_drawdown_daily_close"]) > 1e-12:
            limitations.append("max_drawdown_daily_close_dates is null: its depth differs from native_max_drawdown_daily_close.")
        else:
            peak_time, trough_time, level = worst
            recovered = next((ts for ts, value in curve if ts > trough_time and value >= level), None)
            dates = {"peak_utc": _iso(peak_time), "trough_utc": _iso(trough_time),
                     "recovered_utc": None if recovered is None else _iso(recovered)}
    day, value = min(returns, key=lambda item: (item[1], item[0]))
    months: dict[str, float] = {}
    for ts, daily in returns:
        month = _iso(ts)[:7]
        months[month] = months.get(month, 1.0) * (1 + daily)
    return {
        "max_drawdown_daily_close_dates": dates,
        "worst_day": {"day": _iso(day)[:10], "return_pct": value * 100},
        "monthly_account_return_pct": {month: (growth - 1) * 100 for month, growth in months.items()},
    }


def _positions(positions: list[dict], fills: list[dict], summary: dict, economics: dict | None,
               limitations: list[str]) -> dict:
    cycles, events = [], Counter()
    taker = total_notional = Decimal(0)
    for row in positions:
        if row.get("is_inverse") != "False" or not row.get("multiplier"):
            raise _Unsupported("only linear instruments with a recorded multiplier are supported")
        multiplier = Decimal(row["multiplier"])
        funding = Decimal(0)
        for adjustment in _list(row["adjustments"]):
            if adjustment["adjustment_type"] != "FUNDING" or adjustment.get("quantity_change") is not None:
                raise _Unsupported(f"unsupported position adjustment {adjustment['adjustment_type']}")
            funding += _usdt(adjustment["pnl_change"])
        price = entry_notional = Decimal(0)
        for event in _list(row["events"]):
            events[event["event_id"]] += 1
            notional = Decimal(event["last_qty"]) * Decimal(event["last_px"]) * multiplier
            price += notional if event["order_side"] == "SELL" else -notional
            entry_notional += notional if event["order_side"] == row["entry"] else 0
            total_notional += notional
            taker += notional if event["liquidity_side"] == "TAKER" else 0
        cycles.append({
            "instrument": row["instrument_id"], "entry": row["entry"], "closed": bool(row["ts_closed"]),
            "realized": _usdt(row["realized_pnl"]), "funding": funding, "price": price,
            "commissions": sum((_usdt(item) for item in _list(row["commissions"])), Decimal(0)),
            "entry_notional": entry_notional, "duration": int(row["duration_ns"]),
            "order": (int(row["ts_last"]), row["instrument_id"], row["opening_order_id"]),
        })
    fill_ids = Counter(row["event_id"] for row in fills if "event_id" in row)
    if events != fill_ids or any(count != 1 for count in fill_ids.values()):
        raise _Unsupported("position events do not cover each native fill exactly once")
    fill_commissions = sum((_usdt(row["commission"]) for row in fills if "commission" in row), Decimal(0))
    closed = [cycle for cycle in cycles if cycle["closed"]]
    opened = [cycle for cycle in cycles if not cycle["closed"]]

    def total(items, key):
        return sum((item[key] for item in items), Decimal(0))

    if abs(total(cycles, "commissions") - fill_commissions) > TOLERANCE:
        raise _Unsupported("position commissions differ from fill commissions")
    if any(abs(c["price"] - c["commissions"] + c["funding"] - c["realized"]) > TOLERANCE for c in closed):
        raise _Unsupported("a closed position's fill cash flow, commissions and funding do not equal its realized PnL")
    if len(closed) != summary["closed_trades"]:
        raise _Unsupported("closed position rows differ from summary closed_trades")
    if economics is not None:
        expected = {"realized": economics["reported_realized_pnl_usdt"], "commissions": economics["fill_commissions_usdt"],
                    "funding": economics["reported_funding_usdt"]}
        if any(abs(total(cycles, key) - Decimal(value)) > TOLERANCE for key, value in expected.items()):
            raise _Unsupported("position totals differ from the audited native_economics")
    if any(abs(c["realized"] - (c["funding"] - c["commissions"])) > TOLERANCE for c in opened):
        limitations.append("Open-position realized PnL includes partial-close price PnL, not only entry commissions and funding.")
    residual = None
    if economics is not None:
        residual = Decimal(summary["final_equity_usdt"]) - Decimal(economics["final_balance_usdt"])
        if not opened and residual != 0:
            limitations.append("unrealized_residual_usdt is nonzero although no position remains open.")
    instruments = {item["instrument"]: [0, Decimal(0)] for item in summary.get("per_coin", [])}
    for cycle in cycles:
        if cycle["instrument"] not in instruments:
            raise _Unsupported(f"{cycle['instrument']} is outside the summary instrument universe")
        row = instruments[cycle["instrument"]]
        row[0] += cycle["closed"]
        row[1] += cycle["realized"]
    sides: dict[str, list] = {}
    for cycle in cycles:
        side = sides.setdefault(cycle["entry"], [0, Decimal(0)])
        side[0] += cycle["closed"]
        side[1] += cycle["realized"]
    base = total(closed, "entry_notional")
    components = {"price_pnl": total(closed, "price"), "fill_commissions": total(closed, "commissions"),
                  "reported_funding": total(closed, "funding"), "reported_realized": total(closed, "realized")}
    streak = longest = 0
    for cycle in sorted(closed, key=lambda item: item["order"]):
        streak = streak + 1 if cycle["realized"] <= 0 else 0
        longest = max(longest, streak)
    hours = [cycle["duration"] / 3.6e12 for cycle in closed]
    for missing, reason in ((not closed, "No position closed: closed-position readings are null."),
                            (not opened, "No position remains open: open_entry_notional_usdt is null."),
                            (not total_notional, "No fill: taker_fill_notional_share is null."),
                            (len(sides) < 2, "Fewer than two entry sides: by_entry_side is null.")):
        if missing:
            limitations.append(reason)
    return {
        "closed": {
            "reported_realized_pnl_usdt": _money(components["reported_realized"]) if closed else None,
            "fill_commissions_usdt": _money(components["fill_commissions"]) if closed else None,
            "reported_funding_usdt": _money(components["reported_funding"]) if closed else None,
            "price_pnl_usdt": _money(components["price_pnl"]) if closed else None,
            "entry_notional_usdt": _money(base) if closed else None,
        },
        "open_positions": len(opened),
        "open_entry_notional_usdt": _money(total(opened, "entry_notional")) if opened else None,
        "unrealized_residual_usdt": _money(residual),
        "closed_bps_of_entry_notional": (
            {key: float(value / base * 10_000) for key, value in components.items()} if base else None),
        "closed_realized_pnl_quantiles_usdt": (
            {f"p{round(p * 100):02d}": _money(_nearest_rank([c["realized"] for c in closed], p))
             for p in (0.05, 0.5, 0.95)} if closed else None),
        "taker_fill_notional_share": float(taker / total_notional) if total_notional else None,
        "closed_duration_hours_quantiles": (
            {"p50": _nearest_rank(hours, 0.5), "p90": _nearest_rank(hours, 0.9), "max": max(hours)} if closed else None),
        "zero_duration_closed": sum(c["duration"] == 0 for c in closed) if closed else None,
        "max_consecutive_losing_closed": longest if closed else None,
        "by_instrument": {
            "columns": ["instrument", "closed_trades", "reported_realized_pnl_usdt"],
            "rows": [[name, row[0], _money(row[1])] for name, row in sorted(instruments.items())],
        },
        "by_entry_side": (
            {side: {"closed_trades": value[0], "reported_realized_pnl_usdt": _money(value[1])}
             for side, value in sorted(sides.items())} if len(sides) > 1 else None),
    }


def _identity(paths: tuple[str, ...]) -> dict:
    return {
        "source_files_sha256": {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in paths},
        "dependency_lock_sha256": hashlib.sha256((ROOT / "uv.lock").read_bytes()).hexdigest(),
    }


def _path(output: dict, name: str):
    value = output
    for part in name.split("."):
        if value is None:
            return None
        value = value.get(part)
    return value


def _pair_instruments(left: dict | None, right: dict | None) -> dict | None:
    if left is None or right is None:
        return None
    # Both seals are anchored to the summaries compare already checked for an equal universe.
    control = {row[0]: row for row in right["rows"]}
    return {
        "columns": ["instrument", "candidate_closed_trades", "control_closed_trades",
                    "candidate_reported_realized_pnl_usdt", "control_reported_realized_pnl_usdt",
                    "difference_reported_realized_pnl_usdt"],
        "rows": [[name, closed, control[name][1], realized, control[name][2], difference(realized, control[name][2])]
                 for name, closed, realized in left["rows"]],
    }


def _paired(candidate: list[tuple[int, float]], control: list[tuple[int, float]]) -> dict:
    from backtest.r1.checks.compare_paired_returns import _interval
    weeks: OrderedDict[tuple[int, int], list[float]] = OrderedDict()
    for (ts, left), (_, right) in zip(candidate, control, strict=True):
        iso = (EPOCH + timedelta(microseconds=ts // 1000)).isocalendar()
        weeks.setdefault((iso.year, iso.week), []).append(math.log1p(left) - math.log1p(right))
    blocks = list(weeks.values())

    def growth(values):
        return (math.exp(365 * sum(values) / len(values)) - 1) * 100

    generator = random.Random(PAIRED_SEED)  # noqa: S311 - reproducible research resampling.
    draws = [growth([value for _ in blocks for value in generator.choice(blocks)]) for _ in range(PAIRED_DRAWS)]
    return {
        "method": PAIRED_METHOD,
        "seed": PAIRED_SEED,
        "draws": PAIRED_DRAWS,
        "days": len(candidate),
        "week_blocks": len(blocks),
        "observed_annualized_relative_growth_pct": growth([value for block in blocks for value in block]),
        "bootstrap_95pct_annualized_relative_growth_pct": _interval(draws),
    }
