"""Trials (`ledger.open_trial`) and the sealed runs of research and validation trials (`ledger.ingest_run`,
`ledger.ingest_capture_refusal`).

Every replay writes one trial row before its container starts: purpose, the executed source's content
hash, the pinned runtime image, its line and registration, and the execution identity read from the
coverage receipt's bytes (market commit, universe rule, lifecycle bundle, export content, the comparable
configuration, execution mode, starting balance, instruments), never taken from the caller. The row, its
instruments and start bundle, and the registration checks (the injected binder, so the ledger never imports
registration code) land in one transaction and one commit; any refusal rolls all of them back and no
container may start. While a validation registration has no trial, no other trial of its candidate may
trade inside its window.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
import copy
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path

from ledger import coverage, db, execution, metrics, problems, evidence
from shared.errors import Refusal
from shared.refusals import refuse


PURPOSES = ("explore", "precheck", "research", "validation")
UNBOUND = ("explore", "precheck")
EPOCH = datetime(1970, 1, 1)
MINUTE_NS = 60 * 10**9
INPUT_FIELDS = ("market_commit", "universe_rule", "symbols", "export_content_sha256")
WINDOW_FIELDS = ("start", "trade_start", "end")
EXECUTIONS = ("bars", "quotes")
CONFIG_KEYS = ("runtime_contract", "start", "trade_start", "end", "symbols", "account")  # the engine's keys
# Configuration keys export_content_sha256 already covers (the commit they were read at, the membership file's hash)
COVERED_CONFIG_KEYS = ("market_commit", "universe_sha256")
# Keys the trial row holds as its window and instruments; a precheck may differ from its registration in them.
CONFIG_SET_ASIDE = frozenset(("start", "trade_start", "end", "symbols"))

Binder = Callable[[db.LedgerConnection, int], None]


def _utc(ns: int) -> datetime:
    return EPOCH + timedelta(microseconds=ns // 1000)


def config_key(value: object) -> dict:
    """The effective configuration without its host-location keys (*_root, *_path) and what the inputs cover;
    values untouched."""
    if not isinstance(value, Mapping):
        raise refuse("IDENTITY_MALFORMED", "the effective configuration is not a mapping",
                     expected="a mapping with " + ", ".join(CONFIG_KEYS))
    missing = tuple(key for key in CONFIG_KEYS if key not in value)
    if missing:
        raise refuse("IDENTITY_MALFORMED", "the effective configuration lacks " + ", ".join(missing), missing=missing)
    return {key: copy.deepcopy(item) for key, item in value.items()
            if not str(key).endswith(("_root", "_path")) and key not in COVERED_CONFIG_KEYS}


def comparable_config_sha256(config: object) -> str:
    """The hash of the effective configuration two comparable runs share once their window and instruments
    (trial columns) are set aside: SHA-256 of the canonical JSON of config_key without CONFIG_SET_ASIDE."""
    kept = {key: value for key, value in config_key(config).items() if key not in CONFIG_SET_ASIDE}
    return hashlib.sha256(db.canonical_json(kept).encode("utf-8")).hexdigest()


def execution_identity(receipt: bytes) -> dict:
    """The trial columns a coverage receipt's bytes give: market_commit, universe_rule, lifecycle_bundle,
    export_sha256, comparable_config_sha256, execution, starting_balance and instruments."""
    try:
        parsed = json.loads(receipt.decode("utf-8"))
    except (AttributeError, UnicodeDecodeError, ValueError):
        parsed = None
    identity = parsed.get("input_identity") if isinstance(parsed, dict) else None
    config = parsed.get("effective_config") if isinstance(parsed, dict) else None
    account = config.get("account") if isinstance(config, Mapping) else None
    missing = [f"input_identity.{field}" for field in INPUT_FIELDS
               if not isinstance(identity, Mapping) or not identity.get(field)]
    symbols = identity.get("symbols") if isinstance(identity, Mapping) else None
    if symbols and (not isinstance(symbols, list) or any(not isinstance(item, str) or not item for item in symbols)):
        missing.append("input_identity.symbols")
    execution_mode = account.get("execution") if isinstance(account, Mapping) else None
    if execution_mode not in EXECUTIONS:
        missing.append("effective_config.account.execution")
    try:
        balance = Decimal(str(account["starting_balance_usdt"])) if isinstance(account, Mapping) else None
    except (KeyError, InvalidOperation):
        balance = None
    if balance is None or not balance.is_finite() or balance <= 0:
        missing.append("effective_config.account.starting_balance_usdt")
    if missing:
        raise refuse("TRIAL_INPUT_INCOMPLETE", "the coverage receipt's input identity or configuration is incomplete",
                     missing=tuple(missing))
    assert isinstance(identity, Mapping) and isinstance(symbols, list)
    return {"market_commit": identity["market_commit"], "universe_rule": identity["universe_rule"],
            "lifecycle_bundle": identity.get("lifecycle_bundle"), "export_sha256": identity["export_content_sha256"],
            "comparable_config_sha256": comparable_config_sha256(config), "execution": execution_mode,
            "starting_balance": balance, "instruments": sorted(set(symbols))}


def _require_unreserved(conn: db.LedgerConnection, source_sha256: str, trade_start: datetime,
                        trade_end: datetime, own: int | None) -> None:
    """Refuse a trial trading inside the window of a validation registration of its source that has no trial
    (`own`: the registration this trial runs)."""
    reserved = conn.rows("SELECT v.registration_id FROM validation_registration v WHERE v.source_sha256 = %s AND "
                         "v.window_start < %s AND %s < v.window_end AND NOT v.registration_id <=> %s AND NOT EXISTS "
                         "(SELECT 1 FROM trial b WHERE b.validation_registration_id = v.registration_id) "
                         "ORDER BY v.registration_id", (source_sha256, trade_end, trade_start, own))
    if reserved:
        raise refuse("OUT_OF_SAMPLE_RESERVED", f"the trading window overlaps the unbound validation registration "
                                               f"{reserved[0][0]} of this source", missing=(str(reserved[0][0]),))


def open_trial(conn: db.LedgerConnection, purpose: str, source_sha256: str, runtime_identity: Mapping,
               input_coverage: bytes, window: Mapping, start_context: Mapping, *, line_id: int | None = None,
               research_registration_id: int | None = None, validation_registration_id: int | None = None,
               binder: Binder | None = None) -> dict:
    """Write the trial row, its instruments and start bundle and run the registration checks as one write;
    returns the trial ID and marks the working directory as the trial's.

    `runtime_identity`: image_ref, image_digest, platform, runtime_contract, build_revision and `inspection`
    (the probe report). `input_coverage`: the coverage receipt bytes. `window`: start, trade_start, end in UTC
    nanoseconds. `start_context`: argv (the runner's, container paths only), workdir, source_bytes. A research
    trial names its line and registration, a validation trial its registration. Inside the caller's write the
    trial joins it; otherwise this call commits it.
    """
    if purpose not in PURPOSES:
        raise ValueError(f"purpose must be one of {PURPOSES}")
    if purpose in UNBOUND and binder is not None:
        raise refuse("BINDING_NOT_ALLOWED", f"a {purpose} replay takes no registration binder")
    if purpose not in UNBOUND and binder is None:
        raise refuse("BINDING_REQUIRED", f"a {purpose} replay needs its registration binder", missing=("binder",))
    identity = execution.pinned_identity(runtime_identity)
    if identity is None or not isinstance(runtime_identity.get("inspection"), Mapping) \
            or not runtime_identity["inspection"]:
        raise refuse("RUNTIME_NOT_PINNED", "the runtime image must be pinned by digest and carry its probe inspection",
                     missing=("runtime_identity",))
    missing = [f"window.{field}" for field in WINDOW_FIELDS
               if not isinstance(window, Mapping) or not isinstance(window.get(field), int)]
    if not isinstance(input_coverage, bytes) or not input_coverage:
        missing.append("input_coverage")
    if missing:
        raise refuse("TRIAL_INPUT_INCOMPLETE", "the coverage receipt or window is missing", missing=tuple(missing))
    if not window["start"] <= window["trade_start"] < window["end"] or window["start"] % MINUTE_NS:
        raise refuse("WINDOW_INVALID", "the trial window must satisfy input_start <= trade_start < trade_end with "
                                       "input_start on a whole UTC minute",
                     expected="start <= trade_start < end, start % 60 s == 0")
    columns = execution_identity(input_coverage)
    source = start_context.get("source_bytes")
    if not isinstance(source, bytes) or hashlib.sha256(source).hexdigest() != source_sha256:
        raise refuse("EXECUTION_IDENTITY", "the source bytes differ from the source hash", missing=("source_sha256",))
    argv = list(start_context.get("argv") or ())
    if any(not isinstance(item, str) for item in argv):
        raise refuse("TRIAL_INPUT_INCOMPLETE", "the runner argv is not a list of strings", missing=("argv",))
    payload = {"purpose": purpose, "source_sha256": source_sha256, "image_ref": identity["image_ref"],
               "window": {field: window[field] for field in WINDOW_FIELDS}, "argv": argv, "line_id": line_id,
               "research_registration_id": research_registration_id,
               "validation_registration_id": validation_registration_id,
               "input_coverage_sha256": hashlib.sha256(input_coverage).hexdigest()}
    op = db.derive_op_id("trial", payload)

    def insert(c, op_id):
        if purpose != "explore" and not c.rows("SELECT 1 FROM candidate WHERE source_sha256 = %s", (source_sha256,)):
            raise refuse("SOURCE_NOT_PUBLISHED", f"source {source_sha256} is no published candidate",
                         missing=(str(source_sha256),))
        c.rows("INSERT INTO trial (purpose, source_sha256, line_id, research_registration_id, "
               "validation_registration_id, image_ref, runtime_contract, platform, build_revision, market_commit, "
               "universe_rule, lifecycle_bundle, export_sha256, comparable_config_sha256, execution, "
               "starting_balance, input_start, trade_start, trade_end, runner_argv, op_id) "
               "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
               (purpose, source_sha256, line_id, research_registration_id, validation_registration_id,
                identity["image_ref"], identity["runtime_contract"], identity["platform"],
                identity.get("build_revision"), columns["market_commit"], columns["universe_rule"],
                columns["lifecycle_bundle"], columns["export_sha256"], columns["comparable_config_sha256"],
                columns["execution"], columns["starting_balance"], _utc(window["start"]),
                _utc(window["trade_start"]), _utc(window["end"]), db.canonical_json(argv), op_id))
        (trial_id,), = c.rows("SELECT LAST_INSERT_ID()")
        if columns["instruments"]:
            c.many("INSERT INTO trial_instrument (trial_id, instrument_id) VALUES (%s, %s)",
                   [(trial_id, symbol) for symbol in columns["instruments"]])
        bundle = execution.start_bundle(c, trial_id, input_coverage, source)
        if binder is not None:
            binder(c, trial_id)
        _require_unreserved(c, source_sha256, _utc(window["trade_start"]), _utc(window["end"]),
                            validation_registration_id)
        return {"trial_id": trial_id, "start_bundle": bundle}

    def replay(c, row):
        return {"trial_id": row["trial_id"], "start_bundle": f"trial-{row['trial_id']}-start"}

    written = db.write(conn, "open_trial", payload, "trial", insert, replay, op_id=op, attempts=db.WRITE_ATTEMPTS)
    if start_context.get("workdir") is not None:
        execution.write_marker(Path(start_context["workdir"]), written["record"]["trial_id"], op)
    return {**written["record"], "replayed": written["replayed"], "ledger_commit": written["commit"]}


RUN_PURPOSES = ("research", "validation")
SEALED_REPORTS = (metrics.SUMMARY, *metrics.REPORT_FILES.values())
# Refusals of the coverage check that come from what the runner wrote: they make the run invalid.
CONTENT_REFUSALS = frozenset({"INPUT_IDENTITY_MISMATCH", "COVERAGE_RECEIPT_INVALID", "COVERAGE_MISMATCH",
                              *coverage.LIFECYCLE_REFUSALS})
METRIC_ERRORS = (ValueError, ArithmeticError, KeyError, TypeError, IndexError)  # Decimal and native value errors


def _run_trial(conn: db.LedgerConnection, trial_id: int, require_new: bool) -> dict:
    trial = conn.one("SELECT trial_id, purpose, source_sha256, op_id FROM trial WHERE trial_id = %s", (trial_id,))
    if trial is None:
        raise refuse("TRIAL_NOT_FOUND", f"no trial {trial_id}", missing=(str(trial_id),))
    if trial["purpose"] not in RUN_PURPOSES:
        raise refuse("TRIAL_PURPOSE_INVALID", f"trial {trial_id} is a {trial['purpose']} replay; its reports stay a "
                                              "working copy", expected=" | ".join(RUN_PURPOSES))
    if require_new and conn.rows("SELECT 1 FROM run WHERE trial_id = %s", (trial_id,)):
        raise refuse("RUN_ALREADY_INGESTED", f"trial {trial_id} already has a run", missing=(str(trial_id),))
    return trial


def _plain(value):
    """A value as its canonical JSON reads back (tuples become lists), for comparisons with stored JSON."""
    return json.loads(json.dumps(value, sort_keys=True, default=str))


def _verified_files(capture: Mapping, trial_id: int, workdir: Path) -> dict[str, bytes]:
    """Every file the capture lists, read once from the working directory as regular files; refuses
    EXECUTION_IDENTITY when any differs from its manifest entry (changed, added, removed or a link)."""
    found, differs = {}, []
    for path, entry in sorted(capture["listed"].items()):
        target = workdir / path
        status = entry.get("status")
        if status in ("missing", "not_started"):
            if target.exists() or target.is_symlink():
                differs.append(path)
            continue
        data = metrics._regular(target)
        if status == "captured_empty":
            same = data == b""
        else:
            same = (data is not None and len(data) == entry.get("length")
                    and hashlib.sha256(data).hexdigest() == entry.get("sha256"))
        if same and data is not None:
            found[path] = data
        else:
            differs.append(path)
    if differs:
        raise refuse("EXECUTION_IDENTITY", f"the working directory of trial {trial_id} differs from its sealed capture "
                                           "in " + ", ".join(differs[:5]), missing=tuple(differs))
    return found


def _sealed_report(conn: db.LedgerConnection, trial_id: int, files: Mapping[str, bytes], input_identity: Mapping,
                   checkout: Path | None) -> tuple[list[dict], tuple]:
    """(failure reasons, (revision, report, daily rows, cycle rows)) of a run whose capture gave no reason:
    whatever the runner wrote that the report cannot read is a reason, never a refusal."""
    reason = problems.reason
    try:
        reports = metrics.load_files(files)
    except Refusal as exc:
        return [reason("NATIVE_REPORT_UNREADABLE", exc.message, ",".join(exc.missing) or None)], ()
    absent = [name for name in SEALED_REPORTS if name not in reports.present]
    if absent:
        return [reason("NATIVE_REPORT_MISSING", f"a passed run needs reports/{name}", f"reports/{name}")
                for name in absent], ()
    try:
        reports.lifecycle_events = coverage.original_coverage(conn, trial_id, input_identity)
    except Refusal as exc:
        if exc.code not in CONTENT_REFUSALS:
            raise
        return [reason(exc.code, exc.message, ",".join(exc.missing) or None)], ()
    revision = metrics.metrics_revision(checkout)
    try:
        report = metrics.metrics(reports)
        daily = metrics.daily_rows(reports)
        try:
            cycle_rows = metrics.cycle_rows(reports, metrics.cycles(reports.positions, reports.fills))
        except metrics.Unreconciled:
            cycle_rows = []  # the sealed report names why (cycles_cover_fills)
    except Refusal as exc:
        if exc.code != "REPORT_UNREADABLE":
            raise
        return [reason("SUMMARY_INCOMPLETE", exc.message, ",".join(exc.missing) or None)], ()
    except METRIC_ERRORS as exc:
        return [reason("METRICS_UNREADABLE", f"{type(exc).__name__}: {exc}", None)], ()
    return [], (revision, report, daily, cycle_rows)


def ingest_run(conn: db.LedgerConnection, trial_id: int, workdir: Path, input_identity: Mapping, *,
               host_reasons: list[dict] | tuple = (), checkout: Path | None = None) -> dict:
    """Store one sealed replay as a run in one write; returns {trial_id, status, failure_reasons}.

    Only the trial's original capture decides: its stages, outcome, audit result, runtime failures,
    native summary and fingerprint stage give the failure reasons, and the native reports are read
    from `workdir` (the start receipt's) only after every file there equals its sealed hash. A
    report the runner wrote that cannot be read makes the run invalid rather than refusing.
    `host_reasons` are what the host saw outside the capture (inputs changed during the replay);
    they only add reasons. The effective configuration and its hash come from the start receipt's
    sealed coverage receipt (`problems.config_sha256`), never from the caller. `checkout` is the
    product checkout whose HEAD names the metrics code (default: this repository).
    """
    workdir = Path(workdir)
    trial = _run_trial(conn, trial_id, require_new=False)  # a retry of the same write replays below
    spent = bool(conn.rows("SELECT 1 FROM run WHERE trial_id = %s", (trial_id,)))
    try:
        capture = execution.read_capture(conn, trial_id)
        if capture["status"] != "captured":
            raise refuse("CAPTURE_INCOMPLETE", f"trial {trial_id} has no original capture to ingest",
                         missing=(f"trial-{trial_id}-capture",))
        start = capture["start"]
        execution.require_marker(workdir, trial)
        receipt = capture["input_coverage"] if isinstance(capture["input_coverage"], Mapping) else {}
        config = receipt.get("effective_config")
        if not isinstance(config, Mapping):
            raise refuse("EXECUTION_IDENTITY", f"the start receipt of trial {trial_id} records no effective "
                                               f"configuration", missing=("effective_config",))
        if not isinstance(input_identity, Mapping) or _plain(dict(input_identity)) != start.get("input_identity"):
            raise refuse("EXECUTION_IDENTITY", f"the input identity differs from the coverage receipt of trial "
                                               f"{trial_id}", missing=("input_identity",))
        files = _verified_files(capture, trial_id, workdir)
    except Refusal as exc:
        if spent and exc.code in ("CAPTURE_INCOMPLETE", "EXECUTION_IDENTITY"):
            # only a retry with the very same directory can replay the stored write
            raise refuse("RUN_ALREADY_INGESTED", f"trial {trial_id} already has a run",
                         missing=(str(trial_id),)) from exc
        raise
    identity = {field: start["runtime_identity"][field] for field in execution.IDENTITY_FIELDS}
    reasons = problems.capture_problems(capture, trial["source_sha256"], identity, problems.config_sha256(config),
                                        files)
    reasons += [problems.reason(item["code"], item.get("message") or item["code"], item.get("locator"))
                for item in host_reasons or ()]
    summary = problems.json_object(problems.sealed(capture, problems.SUMMARY))
    bar = config.get("execution_bar_minutes")
    if summary is not None and summary.get("data_interval_minutes") != bar:
        reasons.append(problems.reason("CONFIG_MISMATCH", f"the summary's bars are {summary.get('data_interval_minutes')}"
                                                          f" minutes, the configuration's {bar}",
                                       "data_interval_minutes"))
    fingerprints, _ = problems.capture_fingerprint(capture, files)
    revision, report, daily, cycle_rows = None, None, [], []
    if not reasons:
        reasons, sealed = _sealed_report(conn, trial_id, files, start["input_identity"], checkout)
        if sealed:
            revision, report, daily, cycle_rows = sealed
    reasons = problems.unique(reasons)
    status = "invalid" if reasons else "passed"
    if status == "invalid":
        fingerprints = None
    payload = {"trial_id": trial_id, "status": status, "failure_reasons": reasons,
               "fingerprints": fingerprints, "product_commit": revision,
               "report_sha256": hashlib.sha256(db.canonical_json(report).encode()).hexdigest() if report else None}

    def insert(c, op_id):
        _run_trial(c, trial_id, require_new=True)
        c.rows("INSERT INTO run (trial_id, failure_reasons, fingerprints, op_id) VALUES (%s, %s, %s, %s)",
               (trial_id, db.canonical_json(reasons) if reasons else None,
                db.canonical_json(fingerprints) if fingerprints is not None else None, op_id))
        if status == "passed":
            c.rows("INSERT INTO run_reading (trial_id, report, product_commit) VALUES (%s, %s, %s)",
                   (trial_id, db.canonical_json(report), revision))
            if daily:
                c.many("INSERT INTO run_return (trial_id, ts_event_ns, native_return, mean_gross_notional) "
                       "VALUES (%s, %s, %s, %s)", [(trial_id, ts, value, mean) for ts, value, mean in daily])
            if cycle_rows:
                c.many("INSERT INTO run_cycle (trial_id, seq, instrument_id, side, ts_opened_ns, ts_closed_ns, "
                       "realized_pnl, commissions, funding, open_unrealized, plan_tag, closing_order_type, "
                       "closing_order_tag) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                       [(trial_id, row["seq"], row["instrument_id"], row["side"], row["ts_opened_ns"],
                         row["ts_closed_ns"], row["realized_pnl"], row["commissions"], row["funding"],
                         row["open_unrealized"], row["plan_tag"], row["closing_order_type"], row["closing_order_tag"])
                        for row in cycle_rows])
        return {"trial_id": trial_id, "status": status, "failure_reasons": reasons}

    written = db.write(conn, "ingest_run", payload, "run", insert, lambda c, row: run_record(row),
                       attempts=db.WRITE_ATTEMPTS)
    return {**written["record"], "replayed": written["replayed"], "ledger_commit": written["commit"]}


def run_record(row: Mapping) -> dict:
    """{trial_id, status, failure_reasons} of a run row."""
    reasons = row["failure_reasons"]
    return {"trial_id": row["trial_id"], "status": row["status"],
            "failure_reasons": (json.loads(reasons) if isinstance(reasons, (str, bytes)) else reasons) or []}


def latest_research(conn: db.LedgerConnection, source_sha256: str) -> int | None:
    """The trial of the latest passed research run of a source, by seal order (run.sealed_seq: the ledger head
    when it was sealed), not trial launch order or wall-clock ties."""
    found = conn.rows("SELECT r.trial_id FROM run r JOIN trial t ON t.trial_id = r.trial_id WHERE t.purpose = "
                      "'research' AND t.source_sha256 = %s AND r.status = 'passed' ORDER BY r.sealed_seq DESC "
                      "LIMIT 1", (source_sha256,))
    return found[0][0] if found else None


def ingest_capture_refusal(conn: db.LedgerConnection, trial_id: int, workdir: Path, host_error: Mapping) -> None:
    """Store a research or validation replay whose capture was refused for size: its recovery material
    and an invalid run (failure reason EXECUTION_CAPTURE_LIMIT) in one write, so the trial is spent.

    The recovery material is no evidence and its trial can never be sealed or pass afterwards.
    """
    workdir = Path(workdir)
    _run_trial(conn, trial_id, require_new=False)
    material = execution.recovery_material(conn, trial_id, workdir, host_error)
    reasons = [problems.reason("EXECUTION_CAPTURE_LIMIT", str(host_error.get("message")), material["bundle"])]
    digests = evidence.digests(material["files"])
    payload = {"trial_id": trial_id, "status": "invalid", "failure_reasons": reasons, "recovery": digests}

    def insert(c, op_id):
        _run_trial(c, trial_id, require_new=True)
        evidence.write_files(c, material["bundle"], material["files"], kind="recovery", trial_id=trial_id)
        c.rows("INSERT INTO run (trial_id, failure_reasons, fingerprints, op_id) VALUES (%s, %s, NULL, %s)",
               (trial_id, db.canonical_json(reasons), op_id))
        return {"trial_id": trial_id, "status": "invalid", "failure_reasons": reasons}

    db.write(conn, "ingest_capture_refusal", payload, "run", insert, lambda c, row: run_record(row),
             attempts=db.WRITE_ATTEMPTS)
