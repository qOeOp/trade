"""The single-run report and the one drill-down reader (`report.run_report`, `report.tables`,
`report.directory_report`, `report.load_directory`).

A sealed run's report is its latest sealed result plus the measures derived at read time from its
position cycles and daily series, in the catalogue's column order, all behind the qualification
view. Native detail beyond those two tables is read only from a reproduction directory whose
semantic fingerprint equals the recorded one. An unsealed directory gets the same functions and the
same criterion, marked unverified; it is no evidence.
"""

from __future__ import annotations

import ast
from collections.abc import Mapping
from decimal import Decimal
import json
from pathlib import Path

from ledger import db, execution, metrics
from ledger.errors import Refusal
from ledger.refusals import refuse
from qualification import availability
from registration import duties
from report import measures


UNVERIFIED = "unsealed, source unverified, not evidence"
# The native report columns ledger.metrics reads (engine.write_native_reports writes them).
COLUMNS = {"orders": ("client_order_id", "instrument_id", "type", "status", "filled_qty", "ts_init", "ts_last", "tags",
                      "parent_order_id", "is_reduce_only"),
           "fills": ("client_order_id", "event_id", "last_qty", "last_px", "commission", "liquidity_side", "ts_event"),
           "positions": ("position_id", "instrument_id", "entry", "events", "adjustments", "multiplier", "is_inverse",
                         "realized_pnl", "commissions", "ts_opened", "ts_last", "ts_closed", "opening_order_id",
                         "closing_order_id"),
           "account": ("ts_event", "total", "locked")}
REQUIRED_REPORTS = tuple(name for name in execution.NATIVE_REPORTS if name != metrics.SUMMARY)


def profile_of(ledger) -> db.LedgerProfile:
    """A ledger profile from a profile, a profile name, or None (the active research ledger)."""
    if isinstance(ledger, db.LedgerProfile):
        return ledger
    if ledger is not None:
        return db.load_profile(ledger)
    active = [value for value in db.profiles().values() if value.kind == "active" and value.holds == "research"]
    if not active:
        raise refuse("LEDGER_UNKNOWN", "there is no active research ledger profile", missing=("active",))
    return active[0]


def dedupe(*groups) -> list[str]:
    return list(dict.fromkeys(item for group in groups for item in (group or ()) if item))


def _row(run: Mapping, trial: Mapping) -> dict:
    return {"run_id": run["run_id"], "trial_id": run["trial_id"], "status": run["status"],
            "source_sha256": trial["source_sha256"], "image_digest": trial["image_digest"],
            "purpose": trial["purpose"]}


def cost_basis(facts: Mapping) -> dict | None:
    """The account terms and the observed fee rate (commissions over notional) by liquidity side."""
    sides = ((facts.get("sealed") or {}).get("fees_by_liquidity_side@2"))
    if not isinstance(sides, Mapping):
        return None
    by_side, fills = {}, sum(int(item.get("fills") or 0) for item in sides.values())
    for side, item in sides.items():
        notional = Decimal(item["notional"]) if item.get("notional") else Decimal(0)
        by_side[side] = {**item, "observed_rate": float(Decimal(item["commissions"]) / notional) if notional else None}
    return {"account": (facts.get("effective_config") or {}).get("account"), "by_liquidity_side": by_side,
            "taker_fill_share": (int((sides.get("TAKER") or {}).get("fills") or 0) / fills) if fills else None}


def slices_of(derived: Mapping, catalogue: Mapping, comparison: bool = False) -> list[dict]:
    """The catalogue's slices in order, each with its measures from `derived` (single-run slices only
    unless `comparison`)."""
    return [{"id": item["id"], "title": item["title"], "duties": item["duties"],
             "measures": {measures.key(name): derived.get(measures.key(name)) for name in item["measures"]}}
            for item in catalogue["slices"] if comparison or item["id"] not in measures.COMPARISON_ONLY]


def report_of(conn: db.LedgerConnection, run_id: int, facts: Mapping | None = None, market: Mapping | None = None,
              value: Mapping | None = None) -> dict:
    """The single-run report of one run on an open (pinned) connection."""
    facts = facts or measures.run_facts(conn, run_id)
    run, trial, sealed = facts["run"], facts["trial"], facts["sealed"]
    value = value or availability.assess(conn, _row(run, trial))
    catalogue = duties.measure_catalogue()
    identity = (facts["capture"].get("start") or {}).get("runtime_identity") or {}
    output = {"run_id": run["run_id"], "trial_id": run["trial_id"], "status": run["status"],
              "purpose": trial["purpose"], "source_sha256": trial["source_sha256"],
              "runtime": {"image_ref": trial["image_ref"], "image_digest": trial["image_digest"],
                          "runtime_contract": identity.get("runtime_contract"),
                          "build_revision": identity.get("build_revision")},
              "trade_window": {"input_start": trial["input_start"], "trade_start": trial["trade_start"],
                               "trade_end": trial["trade_end"]},
              "created_at": run["created_at"], "ledger_commit": db.head_commit(conn),
              "catalogue": (sealed or {}).get("catalogue", measures.CATALOGUE_REVISION),
              "metrics_revision": (sealed or {}).get("metrics_revision"), "audit": run["audit"],
              "failure_reasons": run["failure_reasons"] or [], "populations": (sealed or {}).get("populations"),
              "activity": (sealed or {}).get("activity"), "order_funnel": (sealed or {}).get("order_funnel@1"),
              "plans": (sealed or {}).get("plans_valid@1"),
              "headline": None, "slices": None, "closed_by_year": None, "drawdown": None, "capital": None,
              "cost_basis": None}
    if run["status"] == "passed" and value["economic_evidence_available"]:
        derived = measures.derive_measures(facts, catalogue, market if market is not None else
                                           measures.market_for(facts))
        output.update(headline={measures.key(name): derived[measures.key(name)] for name in measures.HEADLINE},
                      slices=slices_of(derived, catalogue), closed_by_year=measures.closed_by_year(facts["cycles"]),
                      drawdown=(sealed or {}).get("drawdown"), capital=(sealed or {}).get("capital"),
                      cost_basis=cost_basis(facts))
    output["limitations"] = dedupe((sealed or {}).get("limitations"), value.get("limitations"))
    return availability.mask(output, dict(value))


def run_report(ledger, run_id: int, at: str | None = None) -> dict:
    """The single-run report of a sealed run at a ledger version (default: the research head)."""
    with db.read_as_of(profile_of(ledger), at) as conn:
        return report_of(conn, run_id)


def _typed_cycles(cycles: list[dict]) -> list[dict]:
    return [{key: (metrics.money(item) if isinstance(item, Decimal) else item) for key, item in cycle.items()
             if key != "run_id"} for cycle in cycles]


def tables(run_id: int, ledger=None, at: str | None = None, account: bool = False, exposures: bool = False,
           directory: Path | None = None) -> dict:
    """The drill-down tables of a passed run with economic evidence: its position cycles and daily
    series from the ledger, and, from a reproduction `directory` whose semantic fingerprint equals
    the recorded one, its native orders, fills, account, order events and exposures. Typed only."""
    with db.read_as_of(profile_of(ledger), at) as conn:
        facts = measures.run_facts(conn, run_id)
        run, trial = facts["run"], facts["trial"]
        if run["status"] != "passed":
            raise refuse("RUN_NOT_PASSED", f"run {run_id} is {run['status']}", missing=(str(run_id),),
                         expected="a passed sealed run")
        value = availability.require(conn, _row(run, trial))
        commit = db.head_commit(conn)
    limitations = list(value["limitations"])
    summary = {"period_start_utc": str(facts["trade_start_ns"]), "period_end_utc": str(facts["trade_end_ns"]),
               "starting_balance_usdt": str(facts["starting_balance"]), "final_equity_usdt": str(facts["final_equity"])}
    series = None
    if facts["starting_balance"] is not None and facts["final_equity"] is not None:
        series = metrics.daily_returns([(ts, value) for ts, value, _ in facts["returns"]], summary, limitations)
    else:
        limitations.append("ACCOUNT_UNKNOWN: the starting balance or final equity is not recorded")
    closed = [cycle for cycle in facts["cycles"] if cycle["ts_closed_ns"] is not None]
    reconciled = {name: metrics.money(sum((Decimal(cycle[column]) for cycle in closed), Decimal(0)))
                  for name, column in (("realized_pnl_usdt", "realized_pnl"), ("commissions_usdt", "commissions"),
                                       ("funding_usdt", "funding"), ("price_pnl_usdt", "price_pnl"))}
    found = {"run_id": run_id, "positions": _typed_cycles(facts["cycles"]),
             "daily_returns": None if series is None else [
                 {"ts_event_ns": ts, "native_return": value,
                  "mean_gross_notional": metrics.money(mean) if isinstance(mean, Decimal) else mean}
                 for ts, value, mean in facts["returns"]],
             "reconciled": {**reconciled, "closed_cycles": len(closed)}, "availability": value,
             "metrics_revision": (facts["sealed"] or {}).get("metrics_revision"), "ledger_commit": commit,
             "orders": None, "fills": None, "account": None, "exposures": None, "order_events": None}
    if directory is not None:
        found.update(_reproduced(Path(directory), run, account, exposures))
    found["limitations"] = dedupe(limitations)
    return found


def _reproduced(directory: Path, run: Mapping, account: bool, exposures: bool) -> dict:
    recorded = run["fingerprints"]
    sealed = execution._regular(directory / execution.FINGERPRINT_RESULT)
    try:
        fingerprint = json.loads(sealed.decode("utf-8")) if sealed is not None else None
    except (UnicodeDecodeError, ValueError):
        fingerprint = None
    if recorded is None or fingerprint is None or fingerprint != recorded:
        raise refuse("REPRODUCTION_MISMATCH", f"{directory} does not carry the semantic fingerprint recorded for run "
                                              f"{run['run_id']}", missing=(execution.FINGERPRINT_RESULT,))
    reports = load_directory(directory)
    found = metrics.cycles(reports.positions, reports.fills)
    position_of = {event_id: row.get("position_id") for row, cycle in zip(reports.positions, found)
                   for event_id in cycle["event_ids"]}
    return {"orders": reports.orders,
            "fills": [{**fill, "cycle_position_id": position_of.get(fill.get("event_id"))} for fill in reports.fills],
            "account": reports.account if account else None,
            "exposures": reports.exposures if exposures else None, "order_events": reports.order_events}


def load_directory(directory: Path) -> metrics.Reports:
    """The native reports a runner wrote into an exploration or precheck directory, parsed as the
    sealed format; nothing is hashed or checked for provenance and the ledger is not read."""
    directory = Path(directory)
    if not directory.is_dir():
        raise refuse("DIRECTORY_NOT_FOUND", f"{directory} is not a readable directory", missing=(str(directory),))
    base = directory / "reports" if (directory / "reports").is_dir() else directory
    if not (base / metrics.SUMMARY).is_file() or (base / metrics.SUMMARY).is_symlink():
        raise refuse("NATIVE_SUMMARY_MISSING", f"{base} holds no {metrics.SUMMARY}", missing=(metrics.SUMMARY,))
    absent = [name for name in REQUIRED_REPORTS if not (base / name).is_file() or (base / name).is_symlink()]
    if absent:
        raise refuse("REPORT_PARSE_FAILED", f"{base} lacks " + ", ".join(absent), missing=tuple(absent))
    reports = metrics.load_directory(directory)
    if reports.summary is None:
        raise refuse("REPORT_PARSE_FAILED", f"{base / metrics.SUMMARY} is not a JSON object", missing=(metrics.SUMMARY,))
    for name, columns in COLUMNS.items():
        rows = getattr(reports, name)
        lacking = [column for column in columns if rows and column not in rows[0]]
        if lacking:
            raise refuse("REPORT_PARSE_FAILED", f"{metrics.REPORT_FILES[name]} lacks " + ", ".join(lacking),
                         missing=tuple(f"{metrics.REPORT_FILES[name]}:{column}" for column in lacking))
    return reports


def directory_facts(reports: metrics.Reports, sealed: Mapping) -> dict:
    """The facts derive_measures reads, built from a directory's native reports (no ledger)."""
    summary = reports.summary
    rows = []
    try:
        rows = metrics.cycle_rows(reports, metrics.cycles(reports.positions, reports.fills))
    except metrics.Unreconciled:
        pass
    for row in rows:
        row["price_pnl"] = (None if row["ts_closed_ns"] is None
                            else row["realized_pnl"] + row["commissions"] - row["funding"])
    return {"sealed": sealed, "returns": metrics.daily_rows(reports), "cycles": rows, "effective_config": {},
            "starting_balance": Decimal(str(summary["starting_balance_usdt"])),
            "final_equity": Decimal(str(summary["final_equity_usdt"])),
            "trade_start_ns": metrics.utc_ns(summary["period_start_utc"]),
            "trade_end_ns": metrics.utc_ns(summary["period_end_utc"]), "input_identity": {}}


def _runner_limitations(summary: Mapping) -> list[str]:
    found = summary.get("limitations")
    if isinstance(found, str):
        try:
            found = ast.literal_eval(found)
        except (SyntaxError, ValueError):
            found = [found]
    return [str(item) for item in found] if isinstance(found, list) else []


def directory_report(directory: Path, account: bool = False) -> dict:
    """The report of an unsealed exploration or precheck directory with the sealed run's functions and
    criterion, marked unverified; for the Agent's self-check before registering, never evidence."""
    reports = load_directory(directory)
    try:
        sealed = metrics.metrics(reports)
    except Refusal as exc:
        if exc.code != "REPORT_UNREADABLE":
            raise
        raise refuse("REPORT_PARSE_FAILED", exc.message, missing=exc.missing) from exc
    reasons = availability.native_reasons(sealed)
    if reports.audit is None:
        reasons.append("AUDIT_RESULT_MISSING: the directory holds no audit result")
    value = {"economic_evidence_available": not reasons, "reasons": reasons, "checker": availability.check_identity(),
             "unverified": UNVERIFIED, "limitations": [UNVERIFIED]}
    output = {"directory": str(directory), "exploration": True, "metrics_revision": sealed["metrics_revision"],
              "catalogue": sealed["catalogue"], "populations": sealed["populations"], "activity": sealed["activity"],
              "order_funnel": sealed["order_funnel@1"], "plans": sealed["plans_valid@1"], "headline": None,
              "slices": None, "drawdown": None, "capital": None, "cost_basis": None}
    if not reasons:
        facts = directory_facts(reports, sealed)
        derived = measures.derive_measures(facts, market={"error": "MARKET_RETURNS_UNAVAILABLE: not read for an "
                                                                   "unsealed directory"})
        output.update(headline={measures.key(name): derived[measures.key(name)] for name in measures.HEADLINE},
                      slices=slices_of(derived, duties.measure_catalogue()), drawdown=sealed["drawdown"],
                      capital=sealed["capital"], cost_basis=cost_basis(facts))
    if account:
        output["account"] = reports.account
    output["limitations"] = dedupe(_runner_limitations(reports.summary), sealed["limitations"], [UNVERIFIED])
    return availability.mask(output, value)
