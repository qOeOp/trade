"""The single-run report and the one drill-down reader (`report.run_report`, `report.tables`,
`report.directory_report`, `report.load_directory`).

A sealed run's report is its latest sealed result plus the measures derived at read time from its
position cycles and daily series, in the catalogue's column order, all behind the qualification
view. Native detail beyond those two tables is read only from a verified reproduction: the
directory replay.reproduce wrote, whose every report file matches the sealed capture of the
reproduction trial it returned and whose fingerprint stage sealed the run's recorded fingerprint.
An unsealed directory gets the same functions and the same criterion, marked unverified; it is no
evidence.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
import hashlib
from pathlib import Path

from ledger import db, execution, metrics, problems, reproduction as reproduced_identity
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
    return {"trial_id": run["trial_id"], "status": run["status"],
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


def report_of(conn: db.LedgerConnection, trial_id: int, facts: Mapping | None = None, market: Mapping | None = None,
              value: Mapping | None = None) -> dict:
    """The single-run report of one run on an open (pinned) connection."""
    facts = facts or measures.run_facts(conn, trial_id)
    run, trial, sealed = facts["run"], facts["trial"], facts["sealed"]
    value = value or availability.assess(conn, _row(run, trial))
    catalogue = duties.measure_catalogue()
    identity = (facts["capture"].get("start") or {}).get("runtime_identity") or {}
    output = {"trial_id": run["trial_id"], "status": run["status"],
              "purpose": trial["purpose"], "source_sha256": trial["source_sha256"],
              "runtime": {"image_ref": trial["image_ref"], "image_digest": trial["image_digest"],
                          "runtime_contract": identity.get("runtime_contract"),
                          "build_revision": identity.get("build_revision")},
              "trade_window": {"input_start": trial["input_start"], "trade_start": trial["trade_start"],
                               "trade_end": trial["trade_end"]},
              "created_at": run["created_at"], "ledger_commit": db.head_commit(conn),
              "catalogue": (sealed or {}).get("catalogue", measures.CATALOGUE_REVISION),
              "read_catalogue": measures.CATALOGUE_REVISION,
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


def run_report(ledger, trial_id: int, at: str | None = None) -> dict:
    """The single-run report of a sealed run at a ledger version (default: the research head)."""
    with db.read_as_of(profile_of(ledger), at) as conn:
        return report_of(conn, trial_id)


def precheck_report(ledger, trial_id: int, at: str | None = None, *, directory: Path | None = None,
                    reproduction: int | None = None, account: bool = False, exposures: bool = False) -> dict:
    """Original technical facts plus optional verified cached native detail, never economic evidence.

An original directory must match its original capture byte for byte. A regenerated directory
must match its own capture and the original semantic fingerprint. Original summary/audit/logs
remain authoritative; regenerated diagnostics never replace the original execution's facts.
"""
    profile = profile_of(ledger)
    with db.read_as_of(profile, at) as conn:
        trial = reproduced_identity.trial_record(conn, trial_id)
        if trial is None or trial["purpose"] != "precheck":
            raise refuse("TRIAL_PURPOSE_INVALID", f"trial {trial_id} is not a precheck", missing=(str(trial_id),))
        captured = execution.read_capture(conn, trial_id)
        fingerprint, _ = problems.capture_fingerprint(captured)
        output = {"trial_id": trial_id, "purpose": "precheck", "ledger_commit": db.head_commit(conn),
                  "source_sha256": trial["source_sha256"], "image_ref": trial["image_ref"],
                  "capture": captured["status"], "stages": captured.get("stages"),
                  "outcome": captured.get("outcome"), "runtime_failures": captured.get("runtime_failures", []),
                  "summary": problems.json_object(problems.sealed(captured, problems.SUMMARY)),
                  "audit": problems.json_object(problems.sealed(captured, execution.AUDIT_RESULT)),
                  "reports": None, "reports_verified": False,
                  "economic_evidence_available": False,
                  "limitation": "technical precheck only; original execution facts are authoritative"}
        # Failure logs and other original observations remain readable even without report caches.
        output["diagnostics"] = {path: data.decode("utf-8", errors="replace")
                                 for path, data in captured.get("files", {}).items() if path.endswith(".txt")}
        if directory is None:
            if reproduction is not None:
                raise _mismatch(Path("/tmp"), trial_id, "a reproduction requires its directory", "directory")
            return output
        if reproduction is None:
            differs = _differing_files(directory, captured.get("listed") or {})
            if captured["status"] != "captured" or differs:
                raise _mismatch(directory, trial_id, "original precheck cache differs", *(differs or ["capture"]))
        else:
            facts = {"run": {"trial_id": trial_id, "fingerprints": fingerprint},
                     "trial": trial, "capture": captured}
            with db.read_as_of(profile) as head:
                verify_reproduction(head, directory, facts, reproduction)
        output.update(reports=_reproduced(directory, account, exposures, positions=True), reports_verified=True,
                      directory=str(directory), reproduction_trial_id=reproduction)
        return output


def _typed_cycles(cycles: list[dict]) -> list[dict]:
    return [{key: (metrics.money(item) if isinstance(item, Decimal) else item) for key, item in cycle.items()
             if key != "trial_id"} for cycle in cycles]


def tables(trial_id: int, ledger=None, at: str | None = None, account: bool = False, exposures: bool = False,
           directory: Path | None = None, reproduction: int | None = None) -> dict:
    """The drill-down tables of a passed run with economic evidence: its position cycles and daily
    series from the ledger, and, from a verified reproduction (the `directory` replay.reproduce wrote
    and the `reproduction` trial ID it returned), its native orders, fills, account, order events and
    exposures. Typed only.

    Keys: trial_id, positions (one row per NETTING cycle, snapshot rows kept: seq, instrument_id, side,
    ts_opened_ns, ts_closed_ns, realized_pnl, commissions, funding, price_pnl, open_unrealized,
    plan_tag, closing_order_type, closing_order_tag), daily_returns (ts_event_ns, native_return,
    mean_gross_notional), reconciled (closed-cycle totals), availability, metrics_revision,
    ledger_commit, limitations, and orders, fills, account, exposures, order_events, reproduction
    (None without a reproduction; account and exposures only when asked)."""
    profile = profile_of(ledger)
    with db.read_as_of(profile, at) as conn:
        facts = measures.run_facts(conn, trial_id)
        run, trial = facts["run"], facts["trial"]
        if run["status"] != "passed":
            raise refuse("RUN_NOT_PASSED", f"run {trial_id} is {run['status']}", missing=(str(trial_id),),
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
    found = {"trial_id": trial_id, "positions": _typed_cycles(facts["cycles"]),
             "daily_returns": None if series is None else [
                 {"ts_event_ns": ts, "native_return": value,
                  "mean_gross_notional": metrics.money(mean) if isinstance(mean, Decimal) else mean}
                 for ts, value, mean in facts["returns"]],
             "reconciled": {**reconciled, "closed_cycles": len(closed)}, "availability": value,
             "metrics_revision": (facts["sealed"] or {}).get("metrics_revision"), "ledger_commit": commit,
             "orders": None, "fills": None, "account": None, "exposures": None, "order_events": None,
             "reproduction": None}
    if directory is not None or reproduction is not None:
        if directory is None:
            raise refuse("REPRODUCTION_MISMATCH", "a reproduction trial is read only with its directory",
                         missing=("directory",))
        with db.read_as_of(profile) as head:  # the reproduction trial is newer than any earlier version read
            verify_reproduction(head, Path(directory), facts, reproduction)
        reports = load_directory(Path(directory))
        native = metrics.cycle_rows(reports, metrics.cycles(reports.positions, reports.fills))
        stored = facts.get("stored_cycles", facts["cycles"])
        if len(native) != len(stored):
            raise _mismatch(Path(directory), trial_id, "native cycle population differs", "positions")
        for original, recovered in zip(stored, native, strict=True):
            for name, expected in recovered.items():
                if original.get(name) is not None and original[name] != expected:
                    raise _mismatch(Path(directory), trial_id, f"native cycle {recovered['seq']} differs: {name}", name)
            recovered["realized_pnl_source"] = "verified-native-reproduction"
        found.update(_reproduced(Path(directory), account, exposures), reproduction=reproduction,
                     positions=_typed_cycles(native))
    found["limitations"] = dedupe(limitations)
    return found


def _mismatch(directory: Path, trial_id: int, why: str, *missing: str) -> Refusal:
    return refuse("REPRODUCTION_MISMATCH", f"{directory} is no verified reproduction of run {trial_id}: {why}",
                  missing=missing or ("reproduction",))


def _differing_files(directory: Path, listed: Mapping) -> list[str]:
    """The report, audit and fingerprint files of `directory` that differ from the capture's manifest
    entries (by SHA-256), are missing although captured or hashed, or exist although not listed."""
    root, base = (directory, directory / "reports") if (directory / "reports").is_dir() else (directory.parent,
                                                                                               directory)
    wanted = {path: entry for path, entry in listed.items()
              if path.startswith("reports/") or path in (execution.AUDIT_RESULT, execution.FINGERPRINT_RESULT)}
    differs = []
    for path, entry in sorted(wanted.items()):
        data = execution._regular(base / path.removeprefix("reports/") if path.startswith("reports/") else root / path)
        status = entry.get("status") if isinstance(entry, Mapping) else None
        if status in ("captured", "hashed"):
            same = data is not None and hashlib.sha256(data).hexdigest() == entry.get("sha256")
        elif status == "captured_empty":
            same = data == b""
        else:
            same = data is None
        if not same:
            differs.append(path)
    if base.is_dir():
        for path in sorted(base.rglob("*")):
            name = f"reports/{path.relative_to(base).as_posix()}"
            if not path.is_dir() and name not in wanted:
                differs.append(name)
    return differs


def verify_reproduction(conn: db.LedgerConnection, directory: Path, facts: Mapping, reproduction) -> None:
    """REPRODUCTION_MISMATCH unless `reproduction` is the explore trial replay.reproduce wrote for this
    run (same source, image digest and inputs), its capture is complete, its fingerprint stage sealed
    the run's recorded fingerprint, and every report file in `directory` matches that capture."""
    run, trial = facts["run"], facts["trial"]
    if not isinstance(reproduction, int) or isinstance(reproduction, bool):
        raise _mismatch(directory, run["trial_id"], "native detail is read only from a verified reproduction; give the "
                                                  "trial ID replay.reproduce returned", "reproduction")
    found = conn.one(f"SELECT trial_id, purpose, source_sha256, {db.IMAGE_DIGEST} FROM trial WHERE trial_id = %s",
                     (reproduction,))
    if found is None:
        raise _mismatch(directory, run["trial_id"], f"no trial {reproduction}", "reproduction")
    try:
        capture = execution.read_capture(conn, reproduction)
    except Refusal as exc:
        raise _mismatch(directory, run["trial_id"], f"the capture of trial {reproduction} does not verify "
                                                  f"({exc.code})", "reproduction") from exc
    if capture["status"] != "captured":
        raise _mismatch(directory, run["trial_id"], f"trial {reproduction} has no execution capture", "capture")
    if not reproduced_identity.matches(conn, reproduction, trial["trial_id"]):
        raise _mismatch(directory, run["trial_id"], "the sealed execution identity, stages or fingerprint differ",
                        "execution_identity")
    root = directory if (directory / "reports").is_dir() else directory.parent
    fingerprint, _ = problems.capture_fingerprint(capture, execution.read_files(root, (execution.FINGERPRINT_RESULT,)))
    if run["fingerprints"] is None or fingerprint is None or fingerprint != run["fingerprints"]:
        raise _mismatch(directory, run["trial_id"], f"the fingerprint stage of trial {reproduction} did not seal the "
                                                  "run's recorded fingerprint", execution.FINGERPRINT_RESULT)
    differs = _differing_files(directory, capture["listed"])
    if differs:
        raise _mismatch(directory, run["trial_id"], f"files differ from the capture of trial {reproduction}: "
                        + ", ".join(differs[:5]), *differs)


def _reproduced(directory: Path, account: bool, exposures: bool, *, positions: bool = False) -> dict:
    reports = load_directory(directory)
    found = metrics.cycles(reports.positions, reports.fills)
    position_of = {event_id: row.get("position_id") for row, cycle in zip(reports.positions, found, strict=True)
                   for event_id in cycle["event_ids"]}
    detail = {"orders": reports.orders,
              "fills": [{**fill, "cycle_position_id": position_of.get(fill.get("event_id"))} for fill in reports.fills],
              "account": reports.account if account else None,
              "exposures": list(reports.exposures or ()) if exposures else None, "order_events": reports.order_events}
    if positions:
        detail["positions"] = reports.positions
    return detail


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
    assert summary is not None  # load_directory refuses a directory without a summary
    rows = []
    try:
        rows = metrics.cycle_rows(reports, metrics.cycles(reports.positions, reports.fills))
    except metrics.Unreconciled:
        pass
    return {"sealed": sealed, "returns": metrics.daily_rows(reports), "cycles": rows, "effective_config": {},
            "native_economics": (reports.audit or {}).get("native_economics"),
            "starting_balance": Decimal(str(summary["starting_balance_usdt"])),
            "final_equity": Decimal(str(summary["final_equity_usdt"])),
            "trade_start_ns": metrics.utc_ns(summary["period_start_utc"]),
            "trade_end_ns": metrics.utc_ns(summary["period_end_utc"]), "input_identity": {}}


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
    elif reports.audit.get("passed") is not True:
        reasons.append("AUDIT_FAILED: the directory's audit result did not pass")
    value = {"economic_evidence_available": not reasons, "reasons": reasons, "checker": availability.check_identity(),
             "unverified": UNVERIFIED, "limitations": [UNVERIFIED]}
    output = {"directory": str(directory), "exploration": True, "metrics_revision": metrics.metrics_revision(),
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
    output["limitations"] = dedupe(sealed["limitations"], [UNVERIFIED])
    return availability.mask(output, value)
