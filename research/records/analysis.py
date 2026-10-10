"""Reconciled native economics of sealed native runs (linear USDT instruments).

This module keeps only what an Agent should not grade for itself: it reads
manifest-verified native reports, splits closed-position PnL into fill price
PnL, commissions and funding, and accepts that split only when it reconciles
to the audited native economics. The paired interval is bound to the
preregistered primary response. Descriptive statistics are left to the Agent
(see the nautilus-report-analysis skill); ``tables`` hands it the same verified,
parsed reports so it never re-parses native formats. Names follow
docs/plans/native-rd-analysis-fields.zh.md; a value that cannot be derived is
null with its reason in ``limitations``.
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
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
REPORT_FILES = ("summary.json", "audit.json", "fills.csv", "positions.csv", "returns_series.csv")
# Readings added to compare ``metrics`` by --analysis, keyed by report key path.
PAIR_READINGS = (
    "closed_trades", "closed.price_pnl_usdt", "closed.fill_commissions_usdt", "closed.reported_funding_usdt",
    "closed.reported_realized_pnl_usdt", "open_positions", "unrealized_residual_usdt",
)
EX_ANTE_LIMITATION = ("The control was bound at registration after results; no machine-verifiable "
                      "ex-ante reference declaration exists.")
PAIRED_METHOD = ("paired ISO-week bootstrap of daily log-return differences on already viewed native "
                 "daily returns, reported as annualized relative growth; exploratory, unadjusted for prior tests")
PAIRED_SEED = 20261008
PAIRED_DRAWS = 5000
_ECONOMICS = ("closed", "closed_trades", "open_positions", "unrealized_residual_usdt")
# Native report cells by column name. Python reprs, "<decimal> <currency>" money and string flags;
# columns not named here stay strings.
_LISTS = frozenset({"events", "adjustments", "commissions", "tags", "linked_order_ids", "venue_order_ids",
                    "trade_ids", "margins"})
_MONEY = frozenset({"realized_pnl", "unrealized_pnl", "commission"})
_DECIMALS = frozenset({"quantity", "filled_qty", "display_qty", "price", "trigger_price", "avg_px", "slippage",
                       "last_qty", "last_px", "peak_qty", "buy_qty", "sell_qty", "multiplier", "avg_px_open",
                       "avg_px_close", "realized_return", "total", "locked", "free"})
_INTEGERS = frozenset({"expire_time_ns", "duration_ns"})
_NANOSECONDS = frozenset({"ts_init", "ts_last"})  # integers in orders and positions, datetimes in fills
_FLAGS = frozenset({"is_snapshot", "is_inverse", "is_reduce_only", "is_post_only", "is_quote_quantity",
                    "reconciliation", "reported"})


class _Unreconciled(Exception):
    """Native facts outside the supported linear-USDT scope or failing a reconciliation."""


def report(root: Path, run_id: str) -> dict:
    """Reconciled economics of one sealed run, without reading Dolt."""
    output, _, _ = _analyze(Path(root), run_id)
    output = {
        **{key: output[key] for key in ("run_id", "status", "problems", "manifest_sha256", "record_binding",
                                        "summary_ref", "audit_ref")},
        "analysis": _identity(("research/records/analysis.py",)),
        **{key: output[key] for key in ("native_economics", *_ECONOMICS, "limitations")},
    }
    check_size(output)
    return output


def pair(root: Path, candidate: dict, control: dict, selection: dict | None) -> dict:
    """Readings that extend a passed formal compare, from both Dolt-anchored seals.

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
        output, returns, _ = _analyze(Path(root), run["run_id"])
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
    return {
        "strategy_binding": [candidate.get("strategy_binding"), control.get("strategy_binding")],
        "artifact_manifest_ref": [candidate.get("artifact_manifest_ref"), control.get("artifact_manifest_ref")],
        "selection": selection,
        "metrics": {name: entry(_path(left, name), _path(right, name)) for name in PAIR_READINGS},
        "paired_daily_returns": paired,
        "analysis": _identity(("research/records/analysis.py",)),
        "limitations": limitations,
    }


def tables(root: Path, run_id: str, *, account: bool = False) -> dict:
    """Parsed native reports of one passed seal whose closed-position split reconciles.

    Reads only manifest-verified bytes and computes no statistics. Top-level money
    cells become ``Decimal`` in the run's single currency (nested event and
    adjustment dicts keep their raw strings), list cells become lists, flags become
    booleans and empty cells ``None``. Each position row also carries ``funding``
    and, when closed, its reconciled fill price PnL (``price_pnl``), its exact close
    time (``ts_closed_ns``, from ``ts_last``; the native ``ts_closed`` passes through
    float64) and the tags of the order that closed it (``closing_order_tags``, empty
    for an untagged order, ``None`` if that order is absent); all three are ``None``
    while open. Each fill carries the ``cycle_position_id`` of the
    position row whose events contain it. ``daily_returns`` is ``None`` with a
    limitation when the trade-window returns do not compound to final equity.
    ``account`` adds account.csv, which can be very large.
    """
    names = (*REPORT_FILES, "orders.csv", *(("account.csv",) if account else ()))
    output, returns, parsed = _analyze(Path(root), run_id, names)
    needed = {"orders.csv", *(("account.csv",) if account else ())}
    if output["closed_trades"] is None or not needed <= parsed["reports"].keys():
        raise RecordError(f"{run_id}: tables need a passed seal whose native reports reconcile",
                          expected="`artifacts report` with non-null closed_trades",
                          next_actions=["Read the limitations from `artifacts report`; do not analyze this seal."],
                          write_status="not_written")
    orders = [_typed(row) for row in _rows(parsed["reports"]["orders.csv"])]
    tags_of = {order.get("client_order_id"): order.get("tags") or [] for order in orders}
    positions = []
    for row, cycle in zip(parsed["positions"], parsed["cycles"], strict=True):
        typed, closed = _typed(row), cycle["closed"]
        positions.append({**typed, "closed": closed, "funding": cycle["funding"],
                          "price_pnl": cycle["price"] if closed else None,
                          "ts_closed_ns": typed.get("ts_last") if closed else None,
                          "closing_order_tags": tags_of.get(typed.get("closing_order_id")) if closed else None})
    cycle_of = {event_id: row["position_id"] for row, cycle in zip(parsed["positions"], parsed["cycles"], strict=True)
                for event_id in cycle["event_ids"]}
    reports = parsed["reports"]
    return {
        "run_id": run_id,
        "manifest_sha256": output["manifest_sha256"],
        "files_sha256": {name: hashlib.sha256(data).hexdigest() for name, data in reports.items()},
        "currency": "USDT",
        "summary": parsed["summary"],
        "audit": parsed["audit"],
        "reconciled": {key: output[key] for key in ("native_economics", *_ECONOMICS)},
        "limitations": output["limitations"],
        "orders": orders,
        "fills": [{**_typed(row), "cycle_position_id": cycle_of[row["event_id"]]} for row in parsed["fills"]],
        "positions": positions,
        "account": [_typed(row) for row in _rows(reports["account.csv"])] if account else None,
        "daily_returns": None if returns is None else [{"ts_event_ns": ts, "native_return": value}
                                                       for ts, value in returns],
    }


def _typed(row: dict) -> dict:
    result = {}
    for column, value in row.items():
        try:
            if not value:
                result[column] = None
            elif column in _LISTS:
                items = _list(value)
                result[column] = [_usdt(item) for item in items] if column == "commissions" else items
            elif column in _MONEY:
                result[column] = _usdt(value)
            elif column in _DECIMALS:
                result[column] = Decimal(value)
            elif column in _INTEGERS or (column in _NANOSECONDS and value.isdigit()):
                result[column] = int(value)
            elif column in _FLAGS:
                result[column] = {"True": True, "False": False}[value]
            else:
                result[column] = value
        except (_Unreconciled, ArithmeticError, KeyError, SyntaxError, ValueError) as exc:
            raise RecordError(f"native report cell {column}={value[:80]!r} has an unexpected format: {exc}",
                              path=f"/{column}",
                              next_actions=["Report this as a reader defect; read the raw CSV following the "
                                            "nautilus-report-analysis skill meanwhile."],
                              write_status="not_written") from exc
    return result


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


def _analyze(root: Path, run_id: str, names: tuple[str, ...] = REPORT_FILES
             ) -> tuple[dict, list[tuple[int, float]] | None, dict]:
    """Report output, accepted trade-window returns and the verified parsed rows behind them."""
    checked, manifest, reports = _sealed(root, run_id, names)
    files = manifest["files"]

    def ref(name):
        item = files.get(f"reports/{name}")
        return None if item is None else {"path": f"artifact://{run_id}/reports/{name}", "sha256": item["sha256"]}

    summary = json.loads(reports["summary.json"]) if "summary.json" in reports else None
    audit = json.loads(reports["audit.json"]) if "audit.json" in reports else None
    output = {
        "run_id": run_id, "status": manifest["status"], "problems": manifest.get("problems", []),
        "manifest_sha256": checked["manifest_sha256"], "record_binding": manifest.get("record_binding"),
        "summary_ref": ref("summary.json"), "audit_ref": ref("audit.json"),
        "native_economics": None, **dict.fromkeys(_ECONOMICS),
    }
    limitations = _unique(list((summary or {}).get("limitations", [])) + list((audit or {}).get("coverage_limits", [])))
    output["limitations"] = limitations
    parsed = {"reports": reports, "summary": summary, "audit": audit}
    if manifest["status"] != "passed" or summary is None:
        limitations.append("The seal did not pass; native economics are not read.")
        return output, None, parsed
    economics = (audit or {}).get("native_economics")
    output["native_economics"] = economics
    if economics is None:
        limitations.append("native_economics is absent from the audit; unrealized_residual_usdt is null "
                           "and the decomposition is checked only against the seal's own reports.")
    returns = _returns(reports["returns_series.csv"], summary, limitations)
    try:
        positions, fills = _rows(reports["positions.csv"]), _rows(reports["fills.csv"])
        cycles = _cycles(positions, fills)
        output.update(_economics(cycles, fills, summary, economics, limitations))
        parsed.update(positions=positions, fills=fills, cycles=cycles)
    except _Unreconciled as exc:
        limitations.append(f"Economic readings are null: {exc}")
    return output, returns, parsed


def _sealed(root: Path, run_id: str, names: tuple[str, ...] = REPORT_FILES) -> tuple[dict, dict, dict[str, bytes]]:
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
    for name in names:
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
        raise _Unreconciled(f"non-USDT money {value!r} is outside the supported linear USDT scope")
    return Decimal(amount)


def _money(value: Decimal | None) -> str | None:
    return None if value is None else format(value.quantize(Decimal("0.00000001")), "f")


def _unique(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


def _returns(data: bytes, summary: dict, limitations: list[str]) -> list[tuple[int, float]] | None:
    """Trade-window daily returns, accepted only when they compound to the native final equity."""
    start = datetime.fromisoformat(summary["period_start_utc"])
    start_ns = (start - EPOCH) // timedelta(microseconds=1) * 1000
    returns = [(int(row["ts_event_ns"]), float(row["native_return"])) for row in _rows(data)]
    returns = [(ts, value) for ts, value in returns if ts >= start_ns]
    if not returns or any(value <= -1 for _, value in returns):
        limitations.append("The trade-window native daily return series is empty or invalid.")
        return None
    growth = Decimal(repr(math.prod(1 + value for _, value in returns)))
    if abs(Decimal(summary["starting_balance_usdt"]) * growth - Decimal(summary["final_equity_usdt"])) > TOLERANCE:
        limitations.append("Trade-window native daily returns do not compound to final_equity_usdt.")
        return None
    return returns


def _cycles(positions: list[dict], fills: list[dict]) -> list[dict]:
    """Each position row's fill cash flow, commissions and funding; every fill belongs to exactly one row."""
    cycles, events = [], Counter()
    for row in positions:
        if row.get("is_inverse") != "False" or not row.get("multiplier"):
            raise _Unreconciled("only linear instruments with a recorded multiplier are supported")
        multiplier = Decimal(row["multiplier"])
        funding = Decimal(0)
        for adjustment in _list(row["adjustments"]):
            if adjustment["adjustment_type"] != "FUNDING" or adjustment.get("quantity_change") is not None:
                raise _Unreconciled(f"unsupported position adjustment {adjustment['adjustment_type']}")
            funding += _usdt(adjustment["pnl_change"])
        price, event_ids = Decimal(0), []
        for event in _list(row["events"]):
            events[event["event_id"]] += 1
            event_ids.append(event["event_id"])
            notional = Decimal(event["last_qty"]) * Decimal(event["last_px"]) * multiplier
            price += notional if event["order_side"] == "SELL" else -notional
        cycles.append({"closed": bool(row["ts_closed"]), "realized": _usdt(row["realized_pnl"]), "funding": funding,
                       "price": price, "event_ids": event_ids,
                       "commissions": sum((_usdt(item) for item in _list(row["commissions"])), Decimal(0))})
    if events != Counter(row["event_id"] for row in fills if "event_id" in row) or any(n != 1 for n in events.values()):
        raise _Unreconciled("position events do not cover each native fill exactly once")
    return cycles


def _economics(cycles: list[dict], fills: list[dict], summary: dict, economics: dict | None,
               limitations: list[str]) -> dict:
    closed = [cycle for cycle in cycles if cycle["closed"]]
    opened = [cycle for cycle in cycles if not cycle["closed"]]

    def total(items, key):
        return sum((item[key] for item in items), Decimal(0))

    if abs(total(cycles, "commissions") - sum((_usdt(row["commission"]) for row in fills), Decimal(0))) > TOLERANCE:
        raise _Unreconciled("position commissions differ from fill commissions")
    if any(abs(c["price"] - c["commissions"] + c["funding"] - c["realized"]) > TOLERANCE for c in closed):
        raise _Unreconciled("a closed position's fill cash flow, commissions and funding do not equal its realized PnL")
    if len(closed) != summary["closed_trades"]:
        raise _Unreconciled("closed position rows differ from summary closed_trades")
    residual = None
    if economics is not None:
        expected = {"realized": economics["reported_realized_pnl_usdt"], "commissions": economics["fill_commissions_usdt"],
                    "funding": economics["reported_funding_usdt"]}
        if any(abs(total(cycles, key) - Decimal(value)) > TOLERANCE for key, value in expected.items()):
            raise _Unreconciled("position totals differ from the audited native_economics")
        residual = Decimal(summary["final_equity_usdt"]) - Decimal(economics["final_balance_usdt"])
        if not opened and residual != 0:
            limitations.append("unrealized_residual_usdt is nonzero although no position remains open.")
    if any(abs(c["realized"] - (c["funding"] - c["commissions"])) > TOLERANCE for c in opened):
        limitations.append("Open-position realized PnL includes partial-close price PnL, not only entry commissions and funding.")
    if not closed:
        limitations.append("No position closed: closed-position readings are null.")
    return {
        "closed": {
            key: _money(total(closed, field)) if closed else None
            for key, field in (("reported_realized_pnl_usdt", "realized"), ("fill_commissions_usdt", "commissions"),
                               ("reported_funding_usdt", "funding"), ("price_pnl_usdt", "price"))
        },
        "closed_trades": len(closed),
        "open_positions": len(opened),
        "unrealized_residual_usdt": _money(residual),
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


def _interval(values: list[float]) -> list[float]:
    ordered = sorted(values)
    return [ordered[int((len(ordered) - 1) * q)] for q in (0.025, 0.975)]


def _paired(candidate: list[tuple[int, float]], control: list[tuple[int, float]]) -> dict:
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
