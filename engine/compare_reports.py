"""Compare two native replays field by field for engineering parity (engine.compare_reports).

Use it when a change should preserve behavior (runner, image, dependency or Nautilus version):
both runs use the same strategy source, inputs, window and account. The comparison is semantic for
orders, fills and positions, because the pinned Nautilus gives no identity that survives a rerun:
every source runs with ``use_uuid_client_order_ids`` (engine.strategy.source_config), so client order
IDs, and the IDs that name them (linked, parent and spawn IDs), are a fresh UUID4 every run, as are
event and initialization IDs; HEDGING position IDs (``BINANCE-{raw}-{n}``) are numbered by the runner
and differ between the streamed runner and BacktestNode, as venue order IDs may. So every UUID in
those tables is masked, the position and venue order ID columns and the raw event lists are left
out, and each table is sorted by all its remaining columns, time first, before rows are paired.
A source without UUID client order IDs keeps its IDs compared; trade IDs, which the pinned Nautilus
derives without the client order ID, are compared. The account and returns stay strict: every
column, in the engine's row order, unmasked. Every funding adjustment and the summary's account
metrics must match too. Read only.
"""

import argparse
import ast
import csv
import hashlib
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import NamedTuple

from engine.compare import RANDOM
from engine.config import Refusal
from engine.native_csv import dict_reader


TABLES = ("orders", "fills", "positions", "account", "returns_series")
# Columns left out: identifiers numbered by the runner, and the raw event lists (funding is compared on its own).
VOLATILE = {
    "orders": {"init_id", "venue_order_id", "position_id"},
    "fills": {"venue_order_id", "event_id", "position_id"},
    "positions": {
        "position_id",
        "events",
        "adjustments",
        "venue_order_ids",
    },
    "account": set(),
    "returns_series": set(),
}
# The columns a table with rows must have, or it is refused as unreadable.
REQUIRED = {
    "orders": ("client_order_id",),
    "fills": ("client_order_id", "ts_event", "last_qty", "last_px"),
    "positions": ("opening_order_id", "closing_order_id", "ts_opened"),
    "account": (),
    "returns_series": (),
}
# The columns, where present, that lead each semantic table's sort and locate a mismatch; the account and
# returns keep the engine's row order and are not masked.
KEYS = {
    "orders": ("ts_init", "instrument_id"),
    "fills": ("ts_event", "instrument_id"),
    "positions": ("ts_opened", "instrument_id"),
}
# The summary's account figures (engine.summary_statistics) and the closed and winning counts the
# auditor reconciles.
METRICS = (
    "final_equity_usdt",
    "net_change_usdt",
    "period_return",
    "annual_return",
    "sharpe_365",
    "closed_trades",
    "winning_trades",
)
ACCOUNT_TOLERANCE = Decimal("0.00000001")  # one hundred-millionth; an uncalibrated example value
FIRST_MISMATCHES = 3


def _tolerance(value) -> Decimal:
    try:
        tolerance = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise Refusal("INVALID_TOLERANCE", f"the account tolerance {value!r} is not a decimal") from exc
    if not tolerance.is_finite() or tolerance < 0:
        raise Refusal("INVALID_TOLERANCE", f"the account tolerance {value!r} is negative or not finite")
    return tolerance


class _ReportTable(NamedTuple):
    columns: frozenset[str]
    rows: list[dict[str, str]]


def _rows(directory: Path, name: str) -> _ReportTable:
    try:
        with (directory / f"{name}.csv").open(newline="") as stream:
            reader = dict_reader(stream)
            columns = frozenset(reader.fieldnames or ())
            rows = list(reader)
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        raise Refusal("REPORT_TABLE_UNREADABLE", f"{directory / f'{name}.csv'}: {exc}") from exc
    missing = [key for key in REQUIRED[name] if rows and key not in columns]
    if missing:
        raise Refusal("REPORT_TABLE_UNREADABLE", f"{directory / f'{name}.csv'} lacks {', '.join(missing)}")
    return _ReportTable(columns, rows)


def _summary(directory: Path) -> dict:
    path = directory / "summary.json"
    try:
        summary = json.loads(path.read_text())
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise Refusal("REPORT_TABLE_UNREADABLE", f"{path}: {exc}") from exc
    if not isinstance(summary, dict) or "engine_version" not in summary or not any(key in summary for key in METRICS):
        raise Refusal("REPORT_TABLE_UNREADABLE", f"{path} lacks the engine version or the account metrics")
    return summary


def _funding(directory: Path, positions: list[dict[str, str]]) -> list[tuple[str, int, str]]:
    result = []
    try:
        for row in positions:
            for event in ast.literal_eval(row["adjustments"]) if row["adjustments"] else []:
                if event.get("adjustment_type") == "FUNDING":
                    result.append((event["instrument_id"], event["ts_event"], event["pnl_change"]))
    except (KeyError, ValueError, SyntaxError, AttributeError, TypeError) as exc:
        raise Refusal("REPORT_TABLE_UNREADABLE", f"{directory / 'positions.csv'} adjustments: {exc}") from exc
    return sorted(result)


def _metric_equal(left, right, tolerance: Decimal) -> bool:
    """Equal within the tolerance; an undefined reading (no trades) matches only itself."""
    if left is None or right is None:
        return left is right
    return abs(Decimal(str(left)) - Decimal(str(right))) <= tolerance


def _paired(name: str, rows: list[dict[str, str]], columns: list[str]) -> list[dict[str, str]]:
    """The rows as compared: in a semantic table each UUID masked and the rows sorted by `columns`;
    the account and returns as the engine wrote them."""
    if name not in KEYS:
        return [{column: row[column] for column in columns} for row in rows]
    masked = [{column: RANDOM.sub("~", row[column]) for column in columns} for row in rows]
    return sorted(masked, key=lambda row: tuple(row[column] for column in columns))


def _table(name: str, left: _ReportTable, right: _ReportTable) -> dict:
    left_columns, right_columns = left.columns - VOLATILE[name], right.columns - VOLATILE[name]
    compared = sorted(left_columns & right_columns)
    keys = [column for column in KEYS.get(name, ()) if column in compared]
    ordered = [*keys, *(column for column in compared if column not in keys)]
    mismatches = []
    for index, (a, b) in enumerate(zip(_paired(name, left.rows, ordered), _paired(name, right.rows, ordered),
                                       strict=False)):
        different = [column for column in compared if a[column] != b[column]]
        if different:
            mismatches.append({"row": index, "key": {key: a[key] for key in keys},
                               "fields": {column: {"reference": a[column], "candidate": b[column]}
                                          for column in different}})
    return {
        "counts": [len(left.rows), len(right.rows)],
        "column_match": left_columns == right_columns,
        "compared_columns": compared,
        "excluded_columns": sorted((left.columns | right.columns) & VOLATILE[name]),
        "mismatch_count": len(mismatches),
        "first_mismatches": mismatches[:FIRST_MISMATCHES],
    }


def compare_reports(reference: Path, candidate: Path, account_tolerance: Decimal = ACCOUNT_TOLERANCE) -> dict:
    """engine.compare_reports: the two report directories' tables, funding adjustments and account
    metrics compared; writes nothing."""
    reference, candidate = Path(reference), Path(candidate)
    for directory in (reference, candidate):
        if not directory.is_dir():
            raise Refusal("REPORT_DIR_MISSING", f"{directory} is not a report directory")
    if reference.resolve() == candidate.resolve():
        raise Refusal("SAME_REPORT_DIRECTORY", f"{reference} and {candidate} are one directory")
    for directory in (reference, candidate):
        missing = [name for name in (*(f"{table}.csv" for table in TABLES), "summary.json")
                   if not (directory / name).is_file()]
        if missing:
            raise Refusal("REPORT_DIR_MISSING", f"{directory} lacks {', '.join(missing)}")
    tolerance = _tolerance(account_tolerance)
    summaries = {"reference": _summary(reference), "candidate": _summary(candidate)}
    tables = {name: (_rows(reference, name), _rows(candidate, name)) for name in TABLES}
    funding = _funding(reference, tables["positions"][0].rows), _funding(candidate, tables["positions"][1].rows)
    compared = {name: _table(name, left, right) for name, (left, right) in tables.items()}
    funding_mismatches = [{"index": index, "reference": list(a) if a else None, "candidate": list(b) if b else None}
                          for index, (a, b) in enumerate(zip(funding[0] + [None] * (len(funding[1]) - len(funding[0])),
                                                             funding[1] + [None] * (len(funding[0]) - len(funding[1])),
                                                             strict=True))
                          if a != b]
    metrics = {}
    for metric in METRICS:
        values = {side: summary.get(metric) for side, summary in summaries.items()}
        comparable = all(metric in summary for summary in summaries.values())
        metrics[metric] = {**values, "within_tolerance": comparable and _metric_equal(values["reference"],
                                                                                      values["candidate"], tolerance)}
    passed = (
        all(table["counts"][0] == table["counts"][1] and table["column_match"] and table["mismatch_count"] == 0
            for table in compared.values())
        and not funding_mismatches
        and all(metric["within_tolerance"] for metric in metrics.values())
    )
    return {
        "passed": passed,
        "tables": compared,
        "funding_adjustments": {"counts": [len(funding[0]), len(funding[1])], "mismatch_count": len(funding_mismatches),
                                "first_mismatches": funding_mismatches[:FIRST_MISMATCHES]},
        "metrics": metrics,
        "summary_sha256": {side: hashlib.sha256((directory / "summary.json").read_bytes()).hexdigest()
                           for side, directory in (("reference", reference), ("candidate", candidate))},
        "engine_version": {side: summary["engine_version"] for side, summary in summaries.items()},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--account-tolerance", default=str(ACCOUNT_TOLERANCE))
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    result = compare_reports(args.reference, args.candidate, args.account_tolerance)
    output = json.dumps(result, indent=2) + "\n"
    if args.receipt:
        args.receipt.write_text(output)
    print(output)
    raise SystemExit(0 if result["passed"] else 1)
