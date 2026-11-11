"""The research records: candidate, evidence, execution, judgment, line, registration, hypothesis, research, source and validation."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, timedelta
import hashlib
from importlib.resources import files
import os
from pathlib import Path
import shutil
import tempfile
import textwrap

from cli.common import (CANDIDATE_HELP, RUNNER_EPILOG, RUNTIME_DEFAULT_HELP, RUNTIME_HELP, UsageError, _at, _count,
                        _json_file, _ledger_option, _market_facts, _market_option, _new_temporary, _op_id,
                        _regular_file, _utc_time, refusal_json)
from cli.ledger_commands import ledger_export
from ledger import db, evidence, execution, judgments, lines, strategies, targets
from shared import profiles
from shared.errors import Refusal
from shared.refusals import refuse


NOUNS = ("candidate", "evidence", "execution", "judgment", "line", "registration", "hypothesis", "research", "source",
         "validation")


TEMPLATES = files("cli").joinpath("templates")
WORKDIR_TEMPLATE, HEADER_TEMPLATE = "workdir-agents.md", "strategy-header.md"


# candidate

def _workdir_notes(directory: Path, candidate: str) -> list[str]:
    """AGENTS.md (the packaged workdir template with the candidate filled in) and strategy-header.md
    (its file header template, verbatim) beside a working copy; the names written."""
    written = []
    for name, target in ((WORKDIR_TEMPLATE, "AGENTS.md"), (HEADER_TEMPLATE, HEADER_TEMPLATE)):
        text = TEMPLATES.joinpath(name).read_text(encoding="utf-8")
        if name == WORKDIR_TEMPLATE:
            text = text.replace("<strategy_id@revision>", candidate)
        (directory / target).write_text(text, encoding="utf-8")
        written.append(target)
    return written


def _require_absent(*targets: Path) -> None:
    for target in targets:
        if os.path.lexists(target):
            raise refuse("PATH_EXISTS", f"{target} already exists; candidate export needs a fresh working directory "
                         "for its source, candidate-specific AGENTS.md and strategy-header.md",
                         missing=(str(target),))


def candidate_publish(profile: db.LedgerProfile, file: str, strategy_id: str, entry_class: str, description: str,
                      parent: str | None, difference: str | None, op: str | None) -> dict:
    """candidate publish: one single-file UTF-8 source as a candidate, a root without --parent."""
    source = _regular_file(file)
    published = strategies.publish_candidate(profile, source, strategy_id, entry_class, description, parent,
                                             difference, op)
    return {"candidate": published["candidate"], "source_sha256": published["source_sha256"], "parent": parent,
            "runtime_contract": published["runtime_contract"], "ledger_commit": published["ledger_commit"],
            "replayed": published["replayed"]}


def _candidate_record(conn: db.LedgerConnection, row: Mapping, commit: str) -> dict:
    parent = (strategies.name(strategies.candidate_by_sha(conn, row["parent_source_sha256"]))
              if row.get("parent_source_sha256") else None)
    return {"candidate": f"{row['strategy_id']}@{row['revision']}", "strategy_id": row["strategy_id"],
            "revision": row["revision"], "source_sha256": row["source_sha256"], "entry_class": row["entry_class"],
            "runtime_contract": row["runtime_contract"], "description": row["description"], "parent": parent,
            "difference": row["difference"], "created_at": row["created_at"], "ledger_commit": commit}


def candidate_show(profile: db.LedgerProfile, candidate: str, at: str | None) -> dict:
    """candidate show: the candidate record at a ledger version, without its source bytes."""
    strategies.parse_ref(candidate)
    with db.read_as_of(profile, at) as conn:
        return _candidate_record(conn, strategies.read_candidate(conn, candidate), conn.resolved_commit)


def candidate_export(profile: db.LedgerProfile, candidate: str, output: str, at: str | None) -> dict:
    """candidate export: the source bytes to a new file under the temporary root, with the working
    directory notes beside it."""
    target = _new_temporary(output)
    _require_absent(target.parent / "AGENTS.md", target.parent / HEADER_TEMPLATE)
    with db.read_as_of(profile, at) as conn:
        row = strategies.read_candidate(conn, candidate)
        commit = conn.resolved_commit
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
        stream.write(row["source"])
    if hashlib.sha256(target.read_bytes()).hexdigest() != row["source_sha256"]:
        target.unlink(missing_ok=True)
        raise refuse("LEDGER_CORRUPT", f"{target} does not reread to the source hash of {candidate}",
                     missing=(candidate,))
    return {"candidate": candidate, "source_sha256": row["source_sha256"], "path": str(target),
            "bytes": len(row["source"]), "ledger_commit": commit, "notes": _workdir_notes(target.parent, candidate)}


STRATEGY_STUB = '''{header}
from decimal import Decimal

from nautilus_trader.trading import Strategy


class {entry_class}(Strategy):
    """The one entry class. Decide only on closed bars; read trading facts (orders, fills,
    positions, account) from the engine's state, never from counters of your own."""

    WARMUP = {{}}  # {{period: bars}}: the history on_historical_bars receives before on_start, per kline period

    def __init__(self, instrument_id, bar_type, *, trade_start_ns, execution_bar_minutes, strategy_id,
                 universe_membership):
        super().__init__()  # the runner allocates and configures the strategy
        self.instrument_id = instrument_id
        self.trade_start_ns = trade_start_ns

    def equity(self):
        """Account equity in the instrument's quote currency: portfolio.equity(venue=...) maps each
        currency to Money, keyed by Currency (not by its code)."""
        instrument = self.cache.instrument(self.instrument_id)
        found = self.portfolio.equity(venue=self.instrument_id.venue).get(instrument.quote_currency)
        return found.as_decimal() if found is not None else Decimal(0)

    def order_quantity(self, quantity, price=None):
        """`quantity` rounded down to the size increment, or None when it is below the increment,
        min_quantity or (given a price) min_notional; make_qty(round_down=True) raises below the
        increment and the venue rejects an order below the minimums. Market-data price/indicator
        inputs used to derive quantity and price must come from completed events strictly earlier
        than submission; this helper rounds and checks specifications, not their timestamps."""
        instrument = self.cache.instrument(self.instrument_id)
        quantity = Decimal(str(quantity))
        if quantity < instrument.size_increment.as_decimal():
            return None
        made = instrument.make_qty(quantity, round_down=True)
        if instrument.min_quantity is not None and made < instrument.min_quantity:
            return None
        if (price is not None and instrument.min_notional is not None and made.as_decimal() * Decimal(str(price))
                * instrument.multiplier.as_decimal() < instrument.min_notional.as_decimal()):
            return None
        return made

    def replay_diagnostics(self):
        """Diagnostic hook: counts the strategy reports about itself (summary only, never evidence);
        never a native report fact's name."""
        return {{}}

    def replay_integrity_findings(self, orders_denied_or_rejected):
        """Self-check hook: every finding returned, and every denied or rejected order, makes the run invalid."""
        return []
'''


def candidate_new(output: str, strategy_id: str, entry_class: str) -> dict:
    """candidate new: a strategy scaffold in a new temporary directory; writes no ledger."""
    directory = _new_temporary(output)
    if not entry_class.isidentifier():
        raise refuse("ENTRY_CLASS_INVALID", f"{entry_class!r} is not one Python class name")
    header = TEMPLATES.joinpath(HEADER_TEMPLATE).read_text(encoding="utf-8")
    header = '"""' + header.replace('"""', "'''").strip() + '\n"""'
    directory.mkdir(mode=0o700, parents=True)
    (directory / "strategy.py").write_text(STRATEGY_STUB.format(header=header, entry_class=entry_class),
                                           encoding="utf-8")
    notes = _workdir_notes(directory, f"{strategy_id}@<revision>")
    return {"output": str(directory), "files": ["strategy.py", *notes]}


def candidate_list(profile: db.LedgerProfile, at: str | None) -> dict:
    """candidate list: every candidate with its lineage and registration attempts (report.candidates)."""
    from report import candidates
    return candidates.candidates(profile, at)


# evidence

def evidence_add(conn: db.LedgerConnection, bundle: str, files: list[str], note: str | None, op: str | None) -> dict:
    """evidence add: an Agent evidence bundle of files and an optional note (note.md)."""
    if not files and not note:
        raise refuse("EMPTY_EVIDENCE", "an evidence bundle needs files or a note", missing=("--file", "--note"))
    work = None
    sources = [Path(item) for item in files or ()]
    try:
        if note:
            work = Path(tempfile.mkdtemp(prefix="evidence-note-"))
            (work / "note.md").write_text(note, encoding="utf-8")
            sources.append(work / "note.md")
        added = evidence.add_bundle(conn, bundle, sources, op)
    finally:
        if work is not None:
            shutil.rmtree(work, ignore_errors=True)
    return {"bundle": added["bundle"], "files": added["files"], "write_status": added["write_status"],
            "ledger_commit": added["ledger_commit"]}


def evidence_export(profile: db.LedgerProfile, bundle: str, output: str, at: str | None) -> dict:
    """evidence export: a bundle's files, each hash recomputed, into a new temporary directory."""
    target = _new_temporary(output)
    with db.read_as_of(profile, at) as conn:
        loaded = evidence.load_bundle(conn, bundle)
        commit = conn.resolved_commit
    listed = []
    for name, data in sorted(loaded["files"].items()):
        path = target / name
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.write_bytes(data)
        listed.append({"name": name, "sha256": loaded["digests"][name], "bytes": len(data)})
    if not listed:
        target.mkdir(mode=0o700, parents=True)
    return {"bundle": bundle, "at_commit": commit, "path": str(target), "files": listed}


# execution, judgments, lines

def execution_recover(profile: db.LedgerProfile, trial_id: int, workdir: str, failure_receipt: str) -> dict:
    """execution recover: recovered bytes of a kept precheck directory, marked recovery material."""
    recovered = execution.recover_capture(profile, trial_id, Path(workdir), Path(failure_receipt))
    return {"trial_id": trial_id, "recovery_bundle": recovered["bundle"], "original_capture": "missing",
            "limitation": recovered["limitation"], "ledger_commit": recovered["ledger_commit"]}


SUBJECT_ROLES_HELP = (" | ".join(judgments.CANDIDATE_ROLES) + " name a candidate; "
                      "about names a candidate, trial or registration, and a trial or registration may omit it")


def _subject(text: str) -> dict:
    found = {}
    for part in text.split(","):
        key, sep, value = part.partition("=")
        if not sep or not key.strip():
            raise UsageError(f"--subject {text!r} is not [role=ROLE,]candidate=ID@N|trial=N|registration=N "
                             f"({SUBJECT_ROLES_HELP})")
        found[key.strip()] = value.strip()
    subject: dict[str, str | int | None] = {"role": found.pop("role", None)}
    for key, target in (("candidate", "candidate"), ("trial", "trial_id"), ("registration", "registration_id")):
        if key in found:
            value = found.pop(key)
            if target != "candidate" and not value.isdigit():
                raise UsageError(f"--subject {key}={value!r} is not an ID")
            subject[target] = int(value) if target != "candidate" else value
    if found:
        raise UsageError(f"--subject has unknown keys {sorted(found)}")
    return subject


def judgment_add(profile: db.LedgerProfile, kind: str, line: str, based_on: str, body: str, subjects: list[str],
                 supersedes: int | None, op: str | None) -> dict:
    """judgment add: one judgment (body from a UTF-8 file) and its subjects."""
    data = _regular_file(body, "JUDGMENT_BODY_UNREADABLE")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise refuse("JUDGMENT_BODY_UNREADABLE", f"{body} is not UTF-8", missing=(body,)) from exc
    from report import status
    return judgments.add_judgment(profile, kind, line, based_on, text, [_subject(item) for item in subjects or ()],
                                  supersedes, op,
                                  compared=lambda line_name, at: status.compared_candidates(profile, line_name, at))


def _targets_options(command, omitted: str | None) -> None:
    command.add_argument("--max-drawdown", required=omitted is None,
                         help="the user's maximum drawdown as a fraction (0.15 for 15%%)" + (f"; {omitted}" if omitted else ""))
    command.add_argument("--annual-return", required=omitted is None,
                         help="the user's minimum annual return as a fraction (0.20 for 20%%)")


def _targets(args) -> tuple[str, str] | None:
    """(maximum drawdown, minimum annual return) as given, None when both are omitted."""
    given = (args.max_drawdown, args.annual_return)
    if given == (None, None):
        return None
    if None in given:
        raise refuse("TARGETS_INVALID", "give both research targets or neither",
                     expected="--max-drawdown and --annual-return together")
    return given


def _market_days(market: dict) -> tuple[date, date]:
    """(the market's first day, the day after its latest complete day) at the newest day."""
    from registration import seams
    source = seams.current.market(market)
    first_day, latest = source.days(source.resolve_commit(None))
    return first_day, latest + timedelta(days=1)


def line_close(profile: db.LedgerProfile, line: str, summary: bytes, market: dict) -> dict:
    """line close: end the line, then sync the profile's backup (`ledger export --kind backup`). The closing
    stands whatever the sync does: a refused sync is reported as backup_failed, and `ledger review` reports the
    backup as behind until a sync succeeds."""
    closed = lines.close_line(profile, line, summary, _market_days(market))
    if profile.backup_root is None:
        return {**closed, "backup": None}
    try:
        synced = ledger_export(profile, "backup", None, None, None)
    except Refusal as exc:
        return {**closed, "backup": None, "backup_failed": refusal_json(exc)}
    return {**closed, "backup": {"ledger_commit": synced["ledger_commit"], "backup_path": synced["backup_path"]}}


def line_select(conn: db.LedgerConnection, market: dict, start: str, market_at: str | None, slug: str,
                line_targets: tuple | None = None) -> dict:
    """line select: the user's research line (start candidate, pinned market commit; the development period is
    the product's rule) and, when given, the user's targets for it."""
    from registration import precheck
    selected = lines.select_line(conn, market_at or "main", start, slug=slug, market=_market_facts(market),
                                 reviews=precheck.review_records, targets=line_targets)
    line = lines.read_line(conn, selected["line_id"])
    return {"line": selected["line"], "line_id": selected["line_id"], "start": start,
            "window": {"start": line["dev_start"], "end": line["dev_end"]},
            "market_day": selected["market_day"], "universe_rule": selected["universe_rule"],
            "created": selected["created"], "targets": selected["targets"]}


# registration, hypothesis

def registration_add(profile: db.LedgerProfile, body: str, runtime: str | None, market: dict,
                     runner_argv: list[str], source: list[str], line: str | None = None) -> dict:
    """registration add: lock the registration body, test conditions, grid and execution identity."""
    from registration import register
    plan = _json_file(body, "REGISTRATION_INVALID")
    registered = register.register(profile, plan, runtime, market, list(runner_argv),
                                   [Path(item) for item in source or ()], line)
    return {"registration_id": registered["registration_id"], "line": registered["line"],
            "grid_points": len(plan["grid"]), "execution": registered["execution"],
            "ledger_commit": registered["ledger_commit"], "replayed": registered["replayed"]}


def hypothesis_compare(profile: db.LedgerProfile, registration: int, trial_id: int, at: str | None) -> dict:
    """hypothesis compare: the comparison report of a grid run with its registered control (report.compare)."""
    from report import comparison
    return comparison.compare(profile, registration, trial_id, at)


# research, source review

def research_status(profile: db.LedgerProfile, at: str | None, line: str | None) -> dict:
    from report import status
    return status.research_status(profile, at, line)


def research_state(conn: db.LedgerConnection, line: str | None, at: str | None, *,
                   history: bool = False, history_before: int | None = None, full: bool = False) -> dict:
    from registration import seams
    from report import status
    try:
        current = seams.current.resolve_runtime(None)["image_ref"]
    except Refusal:
        current = None
    return status.research_state(conn, line, at, history=history, history_before=history_before, full=full,
                                 current_image=current)


def source_review(profile: db.LedgerProfile, candidate: str, runtime: str, precheck_trial: int, verdict: str,
                  items: str, reviewer: str) -> dict:
    """source review: an independent review of a candidate's native precheck on one runtime image."""
    from registration import precheck, seams
    with db.connect(profile, "reader") as conn:
        row = strategies.read_candidate(conn, candidate)
        try:
            identity = seams.current.resolve_runtime(runtime)
        except Refusal as exc:
            raise refuse("RUNTIME_UNRESOLVED", f"{runtime} does not resolve to an image digest ({exc.code})",
                         missing=(str(runtime),)) from exc
        trial = conn.one(f"SELECT purpose, source_sha256, {db.IMAGE_DIGEST} FROM trial WHERE trial_id = %s", (precheck_trial,))
    if trial is None or (trial["purpose"], trial["source_sha256"], trial["image_digest"]) != (
            "precheck", row["source_sha256"], identity["image_digest"]):
        raise refuse("PRECHECK_NOT_FOUND", f"trial {precheck_trial} is no precheck of {candidate} on "
                                           f"{identity['image_ref']}", missing=(str(precheck_trial),))
    review_items = _json_file(items, "REVIEW_INVALID")
    body = {"trial_id": precheck_trial, "verdict": verdict,
            **{name: review_items.get(name) for name in precheck.ITEMS}}
    extra = sorted(set(review_items) - set(precheck.ITEMS))
    if extra:
        raise refuse("REVIEW_INVALID", "the review items hold unknown fields: " + ", ".join(extra), missing=tuple(extra))
    recorded = precheck.record_review(profile, body, reviewer)
    return {"review_id": recorded["review_id"], "candidate": candidate, "source_sha256": recorded["source_sha256"],
            "image_digest": recorded["image_digest"], "precheck_trial": precheck_trial, "verdict": verdict,
            "ledger_commit": recorded["ledger_commit"], "replayed": recorded["replayed"]}


# validation

def validation_registration(profile: db.LedgerProfile, candidate: str, window_start: str, window_end: str,
                            universe_rule: str, market_at: str | None, market: dict, design: str,
                            retry_of: int | None, op: str | None, tsa_url: str | None) -> dict:
    """validation registration: one out-of-sample registration, then its time witness."""
    from registration import validation
    registered = validation.validation_register(profile, candidate, _utc_time(window_start), _utc_time(window_end),
                                                universe_rule, market_at, _json_file(design, "DESIGN_INVALID"),
                                                retry_of, op, market_profile=market, tsa_url=tsa_url)
    stamped = registered["witness"]
    next_actions = [] if stamped["status"] == "stamped" else [
        "Run `ledger witness` before the window starts; a registration without a witness older than its window "
        "start is refused as REGISTRATION_TOO_LATE when a validation replay binds it."]
    return {"registration_id": registered["registration_id"], "candidate": candidate,
            "window": {"start": window_start, "end": window_end}, "registered_at": registered["created_at"],
            "ledger_commit": registered["ledger_commit"], "witness": stamped, "replayed": registered["replayed"],
            "next_actions": next_actions}


def validation_report(profile: db.LedgerProfile, registration_id: int, at: str | None) -> dict:
    from report import comparison
    return comparison.validation_report(profile, registration_id, at)


# `research runs --by`: report.status.RUN_MEASURE_KEYS, named here so the parser imports no report code.
RUN_MEASURES = ("annual_return", "mark_max_drawdown", "sharpe_365", "sharpe_lo", "plan_win_rate", "cycles",
                "daily_turnover")


CONTRACTS: dict[tuple[str, str], tuple[str, str, str, str]] = {
    ("candidate", "publish"): (
        "--file (a regular UTF-8 Python file, parsed and compiled, never run); the parent and existing candidates "
        "(writer, head)",
        "one candidate row (revision = the strategy ID's highest + 1); the same strategy ID, source, entry class "
        "and parent again is a replay returning the stored record; publishes",
        "candidate, source_sha256, parent, runtime_contract, ledger_commit, replayed",
        "SOURCE_EXISTS (these bytes are already a candidate); SOURCE_SYNTAX, SOURCE_SIZE; ENTRY_CLASS_NOT_UNIQUE "
        "(not exactly one top-level class of that name); LINEAGE_INCOMPLETE (--parent and --difference go "
        "together); UNKNOWN_CANDIDATE, BAD_REF (parent); OP_ID_CONFLICT"),
    ("candidate", "show"): (
        "the candidate at --at (reader); its source hash is recomputed",
        "nothing; never publishes",
        "candidate, strategy_id, revision, source_sha256, entry_class, runtime_contract, description, parent, "
        "difference, created_at, ledger_commit",
        "BAD_REF (not ID@N); UNKNOWN_CANDIDATE; UNKNOWN_REF (--at); LEDGER_CORRUPT (source does not match its "
        "hash)"),
    ("candidate", "export"): (
        "the candidate's source at --at (reader); the packaged working directory templates",
        "the source file (--output, new, under the temporary root) and AGENTS.md and strategy-header.md beside "
        "it; no ledger write; never publishes",
        "candidate, source_sha256, path, bytes, ledger_commit, notes (files written)",
        "NOT_TEMPORARY_PATH; PATH_EXISTS (the source, AGENTS.md or strategy-header.md exists); "
        "UNKNOWN_CANDIDATE, BAD_REF; LEDGER_CORRUPT (the file does not reread to the source hash)"),
    ("candidate", "new"): (
        "the packaged strategy header template; no database",
        "a new directory under the temporary root with strategy.py (an entry class stub), AGENTS.md and "
        "strategy-header.md; no ledger",
        "output, files",
        "NOT_TEMPORARY_PATH; PATH_EXISTS; ENTRY_CLASS_INVALID (not a Python class name)"),
    ("candidate", "list"): (
        "candidates, research trials of registration grid points, runs and source reviews at --at (reader); each "
        "run's economic evidence availability",
        "nothing; never publishes",
        "ledger_commit, checker, candidates [{strategy_id, revision, source_sha256, entry_class, "
        "runtime_contract, description, parent_source_sha256, parent, difference, created_at, attempts "
        "[{registration_id, trial_id, run_status, availability}], valid_evidence}]; large",
        "UNKNOWN_REF (--at); a run whose records do not verify is listed as unavailable, not refused"),
    ("evidence", "add"): (
        "--file paths (a directory is walked; links refused) and --note (stored as note.md)",
        "one evidence bundle and its files (writer); the same name and content again is a replay; publishes",
        "bundle, files {path: sha256}, write_status (written or replayed), ledger_commit",
        "EMPTY_EVIDENCE (no files or note, or an empty file); BUNDLE_EXISTS; RESERVED_BUNDLE (a product "
        "namespace: lifecycle-*, trial-N-*); "
        "INVALID_EVIDENCE_PATH; MEDIA_NOT_KEPT (video or audio); EVIDENCE_TOO_LARGE (a file over 64 MiB)"),
    ("evidence", "export"): (
        "any bundle at --at (reader), product namespaces included; every hash is recomputed",
        "the bundle's files into a new directory under the temporary root; no ledger write; never publishes",
        "bundle, at_commit, path, files [{name, sha256, bytes}]",
        "NOT_TEMPORARY_PATH; PATH_EXISTS; UNKNOWN_BUNDLE; LEDGER_CORRUPT (a file does not match its hash)"),
    ("execution", "recover"): (
        "the precheck trial and its start receipt (writer, head); --failure-receipt (an EXECUTION_CAPTURE_LIMIT "
        "refusal); process.json and the capture files in --workdir (the receipt's own workdir)",
        "the bundle trial-<id>-recovery (the files, recovery.json, host-error.json), marked recovery material; "
        "the original capture stays missing; the same bytes again are a replay; publishes",
        "trial_id, recovery_bundle, original_capture (missing), limitation, ledger_commit",
        "RECOVERY_NOT_APPLICABLE (not a precheck, capture present, another workdir, or the trial has a run or "
        "a registration relies on it); RECOVERY_INCOMPLETE (another receipt, or required reports absent); TRIAL_NOT_FOUND; "
        "EXECUTION_IDENTITY; BUNDLE_EXISTS (a different recovery exists)"),
    ("judgment", "add"): (
        "--body (a regular UTF-8 file); the line, subjects and superseded judgment (writer, head); for a "
        "recommendation, the line's comparison table at --based-on",
        "one judgment row and its subject rows; the same content again is a replay; publishes",
        "judgment_id, ledger_commit, replayed",
        "LINE_UNKNOWN; COMMIT_NOT_ANCESTOR (--based-on is not an ancestor of the head); COMMIT_BEFORE_LINE; "
        "RECOMMENDATION_INCOMPLETE (a recommendation must name as a subject every candidate of the line's own trials "
        "and start with a run of its execution identity in the comparison table at --based-on: its `candidates`); "
        "SUPERSEDES_INVALID (missing, another kind or line, or already superseded); "
        "SUBJECT_UNKNOWN, SUBJECT_ROLE_MISMATCH"),
    ("line", "select"): (
        "the market at --market-at (reader): commit, universe rule, latest complete day; the start "
        "candidate, its source reviews, the open lines and targets (writer, head)",
        "one research_line row named <slug> and, when given, the line's targets in the same commit; the same "
        "choice under that name again writes no line (created false); publishes",
        "line, line_id, start, window {start, end} (the development period: the 12 calendar quarters before the "
        "holdout, the 8 quarters ending at the last quarter end before today that the market covers; 4 quarters "
        "when the start's precheck instruments have fewer than 24 quarters of coverage before it), market_day, "
        "universe_rule, created, targets",
        "START_REVIEW_REQUIRED (the start has no passed source review, or a failed one); START_NOT_FOUND; "
        "LINE_HISTORY_SHORT (those instruments have fewer than 12 quarters of coverage before it); "
        "MARKET_COMMIT_UNRESOLVED (no commit, universe rule or complete day); LINE_CONFLICT (the name holds another choice); LINE_SLUG_INVALID; "
        "TARGETS_INVALID"),
    ("line", "targets"): (
        "the targets in force for the line or the default (writer, head)",
        "one line_target row superseding the one in force; values equal to it write nothing (written false); "
        "publishes",
        "max_drawdown, annual_return, source (line or default), target_id, created_at, line, written, commit",
        "RESEARCH_LINE_REQUIRED (no open line); LINE_AMBIGUOUS (several open lines and no --line); LINE_ENDED "
        "(--line is closed); LINE_UNKNOWN; TARGETS_INVALID (needs 0 < max-drawdown < 1 and 0 < annual-return < 1000)"),
    ("line", "history"): (
        "the open line, its passed research runs and history trials (writer, head); the market at --market-at "
        "(default: the newest day): its first day and latest complete day; each run's runtime image, probed",
        "one history trial and its run per segment left (each calendar year before the development period as a "
        "veto segment, the period again as the control, the two-year holdout after it as one segment, the forward "
        "segment after the holdout), candidates by development-period Sharpe; "
        "a segment with a history run is skipped, so a rerun resumes; publishes",
        "line, market_day, ran [{source_sha256, segment, run, history_trial_id, status}], left, participants, "
        "segments_without_trading",
        "LINE_UNKNOWN, LINE_ENDED; MARKET_COMMIT_UNRESOLVED; REPRODUCTION_CONFIG_DIFFERS (the image gives a run "
        "another effective configuration); the replay refusals of a sealed run"),
    ("line", "close"): (
        "--summary (a regular UTF-8 file, at most 32 KB); the line, its history trials and its closing at the head "
        "(writer); the market's first and latest complete day at the newest day",
        "one line_close row holding the summary, which ends the line; the same summary again is a replay; then the "
        "profile's backup is synced as `ledger export --kind backup` does; publishes",
        "line, line_id, closed_at, ledger_commit, replayed, backup ({ledger_commit, backup_path}, null without a backup "
        "directory or when the sync was refused), backup_failed (the sync's refusal; the closing stands)",
        "HISTORY_INCOMPLETE (a segment of the closing history test has no history run: `line history`); "
        "LINE_CLOSED (closed with another summary); LINE_UNKNOWN; LINE_SUMMARY_INVALID"),
    ("line", "list"): (
        "the open research lines (with --all the closed ones too), their closings and targets at --at (reader); "
        "no market",
        "nothing; never publishes",
        "ledger_commit, lines [{line_id, name, start, dev_start, dev_end, market_day, created_at, closed, targets, "
        "versions}] oldest first; versions are the candidates its research graph draws, oldest first",
        "UNKNOWN_REF (--at)"),
    ("registration", "add"): (
        "--body and --source files; the open line (--line), its trials, judgments and source reviews (writer, head); "
        "the market at the line's pinned commit (reader); the runtime image, resolved to its digest and probed",
        "one research_registration row with its grid points and comparison design, and one source-<sha256> "
        "bundle per --source, in one commit; the same line, body and execution again is a replay; publishes",
        "registration_id, line, grid_points, execution {image_ref, market_day, universe_rule, lifecycle_bundle, "
        "export_sha256, comparable_config_sha256, image_digest}, ledger_commit, replayed",
        "REGISTRATION_INVALID (body, design, lineage or an unpublished grid candidate); LINEAGE_MISMATCH (the grid "
        "candidates do not share one parent, or their difference is not the first grid candidate's); "
        "RESEARCH_LINE_REQUIRED (no "
        "open line); LINE_AMBIGUOUS (several open lines and no --line); LINE_ENDED (--line is closed, or its closing has begun: it has a history trial); LINE_UNKNOWN; "
        "INTERPRETATION_REQUIRED (a completed research trial of the line has no interpretation); REVIEW_DUE (5 or "
        "more research trials since the last recommendation); WINDOW_MISMATCH (the runner window is not the line's); "
        "SOURCE_PRECHECK_REQUIRED, SOURCE_PRECHECK_FAILED; SOURCE_ALREADY_EXPOSED; RUN_NOT_PASSED, "
        "COMPARABILITY_MISMATCH, ECONOMIC_EVIDENCE_UNAVAILABLE (the control run)"),
    ("hypothesis", "compare"): (
        "the registration, the grid run and its control at --at (reader); market daily returns from the run's "
        "market (a market failure only empties the market measures)",
        "nothing; never publishes",
        "registration_id, trial_id, control_trial_id, research_parent, ledger_commit, registered_at, "
        "product_commit, comparison_source_sha256, availability, evidence (paired daily log difference, intervals, p, "
        "design), attribution (headline, slices, predictions, trade_pairs), limitations; a registration without "
        "a control gives evidence and attribution null with a reason; large (one entry per trade pair)",
        "REGISTRATION_INVALID (no such research registration); RUN_NOT_IN_GRID; UNKNOWN_RUN; RUN_NOT_PASSED, "
        "COMPARABILITY_MISMATCH, ECONOMIC_EVIDENCE_UNAVAILABLE (either side); CLOCK_MISMATCH; "
        "COMPARISON_UNAVAILABLE (too few usable days)"),
    ("research", "status"): (
        "trials, runs, research trials of registrations, source reviews and validations of the whole ledger at --at "
        "(reader); no market",
        "nothing; never publishes",
        "ledger_commit; trials (counted trials of every purpose, ledger-wide); multiple_testing (what a deflated "
        "Sharpe of the line's runs reads: line, dev_start, dev_end, instruments (those of the line's research "
        "trials), research_trials and all_purpose_trials (counted trials on one of those instruments whose trading "
        "window overlaps the line's, across market commits and lines; all_purpose_trials adds precheck, explore "
        "and validation), runs_with_returns (the overlapping research runs with economic evidence and varying "
        "daily returns), mean_correlation (their mean pairwise daily-return correlation over common days), "
        "effective_trials (rho + (1 - rho) * research_trials, rho the mean correlation floored at 0), "
        "daily_sharpe_variance (the variance of their per-day Sharpe ratios); null without a line or before its "
        "first research trial); excluded_trials {reproductions, stopped_before_strategy} (left out of those counts); "
        "lines (the lines whose attempts are counted: --line, else the open lines); research_attempts and their "
        "outcomes (audit_passed, valid, diagnostic_only, invalid, unfinished) on those lines; "
        "validation {registered, bound, unbound, unwitnessed}; unverified_runs; availability_checker; "
        "product_commit; comparison (the line's comparison table: line, dev_start, dev_end, universe_rule, "
        "execution_identity (the line's, from its "
        "latest research trial since line select; null before the first), runs [{candidate, trial_id, "
        "execution_identity {runtime_contract, execution, image_digest, keys}, measures, dominated_by, "
        "non_dominated}] (dominance only within one identity), candidates (those of the line's identity, which a "
        "recommendation names), without_economic_evidence; null without a line)",
        "LINE_UNKNOWN (--line); "
        "UNKNOWN_REF (--at)"),
    ("research", "state"): (
        "the line record, targets, judgments, trials and source reviews at --at (reader); whether the active "
        "market holds the line's market commit (reader)",
        "nothing in the ledger, never publishes; pulls the main runtime image each time, which moves the local "
        "`main` tag, to learn the current image",
        "ledger_commit, line, execution_identity (the line's), current_image (the main image's digest reference; null "
        "when it cannot be resolved), runs_behind_image (the line's passed runs not yet on it: `replay reproduce "
        "--image`; null without it), targets, open_lines "
        "[{name, start, dev_start, dev_end, market_day}], recommendation, priority, "
        "review_every, undistinguished_runs {trials, uncompared, distinguished} (the line's latest runs read back "
        "for a due change of approach, null without a line: trials leave candidate and control undistinguished, uncompared "
        "have no comparison and neither count nor clear, distinguished ended the reading; reported, not a gate; "
        "the Agent discounts runs before the user's last choice of line or approach and scale-only runs, which the ledger does not "
        "tell), interpretations, search_exposures, unreviewed_trials (of the line's execution identity), "
        "trials_on_line (a count: the line's trials of every identity), gates [{code, message, missing}] "
        "(INTERPRETATION_REQUIRED, REVIEW_DUE, RUNTIME_UNSUPPORTED, MARKET_COMMIT_UNRESOLVED, "
        "RESEARCH_LINE_REQUIRED (no open line), LINE_AMBIGUOUS (several open lines, no --line): reported, not "
        "raised), judgment_history, earlier, facts (candidate list and research status, with --full), next_actions (only without a line: `line select`, or --line); line.ledger_commit is the commit "
        "read, not the "
        "line's own; large with --full",
        "LINE_UNKNOWN (--line is no research line); UNKNOWN_REF (--at); LEDGER_UNAVAILABLE, LEDGER_PERMISSION, "
        "SCHEMA_MISMATCH, MARKET_UNREACHABLE (a service undistinguished_runs' comparisons read is unreachable, "
        "refuses the account or holds another schema: the read refuses rather than list runs it never compared)"),
    ("research", "history"): (
        "the line's research and history trials, their runs, captures and stored facts, and its targets at --at "
        "(reader); no market",
        "nothing; never publishes",
        "ledger_commit, short_days, lines [{line, closed, dev_start, dev_end, targets, participants, research_trials, "
        "rows [{source_sha256, run, development (the research run's cell), cells [{trial_id, kind (veto, control, "
        "holdout or forward), label, trade_start, trade_end, status, whole_year, short, measures {annual_return, "
        "mark_max_drawdown, sharpe_365, cycles, plan_win_rate} (passed runs only)}], control_reproduces, summary "
        "{veto {whole_years, profitable_years, median_annual_return, worst_annual_return, worst_mark_max_drawdown, "
        "years_meeting_targets, meets_targets}, holdout {annual_return, mark_max_drawdown, meets_targets}, "
        "meets_targets, judged_on (veto and holdout, holdout, or null)} or null when the control does not "
        "reproduce}]}]. Rows by development-period Sharpe. The veto passes when every whole veto year's drawdown is "
        "at most the target and their median annual return at least the target; the holdout when its drawdown is at "
        "most the target and its annual return at least the target; meets_targets when both pass, or the holdout "
        "alone when no veto year counts. A falsification test, not "
        "out-of-sample validation; picking by it is a choice among `participants` candidates",
        "LINE_UNKNOWN"),
    ("research", "runs"): (
        "trials, runs, candidates, lines, targets and every listed run's stored facts at --at (reader); no market",
        "nothing; never publishes",
        "ledger_commit, line, by, runs_listed (before --limit), without_economic_evidence (a count), groups [{group, "
        "runtime_contract, execution, image_digest, window_start, window_end, universe_rule}], lines [{line, "
        "targets {max_drawdown, annual_return, source} or null}], runs [{candidate, trial_id, group, lines (those "
        "the run belongs to), measures {annual_return, mark_max_drawdown, sharpe_365, sharpe_lo, "
        "plan_win_rate, cycles, daily_turnover} (values as `replay report` derives them), null_reasons (only "
        "when a measure is null)}]. Every passed research run with economic evidence: of the open lines, or with --line "
        "that line's comparison table (`research status`). Ordered by trial ID, or by the one --by measure (drawdown "
        "ascending, the others descending, nulls last). A listing by one measure, not the comparison table, a "
        "recommendation or a score: runs of different groups differ in window, instruments, configuration or image, "
        "so their order is no comparison; the first value is the best of runs_listed runs, which no ledger-wide "
        "multiple-testing reading adjusts (a line's is `research status` multiple_testing); ordered by drawdown, runs "
        "that barely trade come first (read cycles). Targets are listed as stated, never compared with a run",
        "LINE_UNKNOWN (--line); UNKNOWN_REF (--at); LEDGER_CORRUPT"),
    ("research", "unchanged"): (
        "what changed between --since and --at, with the line's versions, trials, registrations and reviews (reader)",
        "nothing; never publishes",
        "unchanged, reason (what reaches the line, or null), since, ledger_commit",
        "LINE_UNKNOWN (--line); UNKNOWN_REF (--at, --since)"),
    ("research", "counts"): (
        "the line's research trials and every counted trial with its capture manifest at --at (reader)",
        "nothing; never publishes",
        "trial_counts (research_trials, all_purpose_trials, as `research graph` gives them; null before the line's "
        "first research trial), ledger_commit",
        "LINE_UNKNOWN (--line); UNKNOWN_REF (--at); LEDGER_CORRUPT"),
    ("research", "graph"): (
        "the line, its candidates (full sources), trials, reviews and judgments at --at (reader); market daily "
        "returns inside the comparisons",
        "nothing; never publishes",
        "format (research-graph@3), source, scope {ledger_commit, start, end}, line (with gates [{code, message}], "
        "the gates `research state` reads before the next registration), candidates [{id, parent, "
        "source, trials, comparison, reviews, status, ...}], events, gaps; large (every candidate's source)",
        "RESEARCH_LINE_REQUIRED (no open line); LINE_AMBIGUOUS (several open lines and no --line); "
        "LINE_UNKNOWN (--line); UNKNOWN_REF (--at, --since); "
        "MARKET_UNREACHABLE (other comparison refusals only leave a comparison null)"),
    ("research", "comparison"): (
        "one registered run, its control and their source reviews at --at (reader); market daily returns",
        "nothing; never publishes",
        "comparison: the object `research graph` gives that version, or null when it has none",
        "UNKNOWN_REF (--at); MARKET_UNREACHABLE (other comparison refusals give comparison null)"),
    ("source", "review"): (
        "the candidate and the precheck trial at the head (reader); the runtime image, resolved to its digest; "
        "--items (JSON) and the precheck's original capture (writer)",
        "one source_review row (the verdict, items and reviewer); the same content again is a replay; publishes",
        "review_id, candidate, source_sha256, image_digest, precheck_trial, verdict, ledger_commit, replayed",
        "PRECHECK_NOT_FOUND (the trial is no precheck of this source on this image); REVIEW_INVALID (unknown or "
        "missing items; each needs {status: passed|failed|unresolved|no_opportunity, note}; passed only when no "
        "item failed or is unresolved); RUNTIME_UNRESOLVED; UNKNOWN_CANDIDATE, BAD_REF; "
        "PRECHECK_CAPTURE_MISSING"),
    ("validation", "registration"): (
        "--design (JSON); the candidate (writer, head); --market-at in the market (reader)",
        "one validation_registration row; then sends the commit hash's SHA-256 to the RFC 3161 authority and "
        "records a verified token as a second commit (a failed witness keeps the registration and reports "
        "witness.status failed); publishes",
        "registration_id, candidate, window, registered_at, ledger_commit, witness {status, stamped_at, error}, "
        "replayed, next_actions",
        "DESIGN_INVALID; WINDOW_INVALID; REGISTRATION_TOO_LATE (--window-start not after now; retries exempt); "
        "CANDIDATE_UNKNOWN; MARKET_COMMIT_UNRESOLVED; RETRY_NOT_ALLOWED; OP_ID_CONFLICT; the universe rule is "
        "checked only when a replay binds the registration"),
    ("validation", "report"): (
        "the registration, its witness, binding and run at --at (reader), and the registrations of the same "
        "window and universe rule; market daily returns (a failure only empties the market measures)",
        "nothing; never publishes",
        "registration_id, ledger_commit, product_commit, registration, witness, binding, window_read_before_binding "
        "(trials of any source trading inside the window, made after the original registration and before the "
        "binding), availability, metrics, single, family {size, provisional, missing_p, members [{registration_id "
        "(an original registration: a retry is no member of its own), latest_attempt (whose p it takes), "
        "p_one_sided, p_holm, ...}]}, "
        "same_candidate_registrations, limitations (UNWITNESSED, UNBOUND, UNFINISHED, NO_SINGLE_TEST, "
        "FAMILY_PROVISIONAL)",
        "REGISTRATION_UNKNOWN; LEDGER_CORRUPT (the binding names a missing trial); UNKNOWN_REF (--at)"),
}


def register(verbs, verb, runner) -> None:
    """Add the research record nouns to the parser with `cli.main._parser`'s verbs, verb and runner."""
    candidate = verbs("candidate", "candidates: publish, show, export, new, list")
    command = verb(candidate, "publish", "publish one single-file source as a candidate")
    _ledger_option(command)
    command.add_argument("--file", required=True, help="the UTF-8 strategy source file")
    command.add_argument("--strategy-id", required=True, help="strategy ID; a new one starts at revision 1")
    command.add_argument("--entry-class", required=True, help="the entry class name in the file")
    command.add_argument("--description", required=True, help="one line on what the candidate does")
    command.add_argument("--parent", help="parent candidate as ID@N (omit for a root)")
    command.add_argument("--difference", help="what changed from the parent")
    _op_id(command)
    command = verb(candidate, "show", "a candidate record without its source")
    _ledger_option(command)
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    _at(command)
    command = verb(candidate, "export", "a candidate's source as a temporary working copy")
    _ledger_option(command)
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--output", required=True,
                         help="new source file under the temporary root, in a fresh candidate working directory; "
                              "AGENTS.md and strategy-header.md beside it must also be absent")
    _at(command)
    command = verb(candidate, "new", "a strategy scaffold in a new temporary directory")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command.add_argument("--strategy-id", required=True, help="strategy ID for the file header")
    command.add_argument("--entry-class", default="Strategy1", help="entry class name (default: Strategy1)")
    command = verb(candidate, "list", "every candidate with its registration attempts")
    _ledger_option(command)
    _at(command)

    evidence_noun = verbs("evidence", "Agent evidence bundles: add, export")
    command = verb(evidence_noun, "add", "append an evidence bundle")
    _ledger_option(command)
    command.add_argument("--bundle", required=True, help="new bundle name")
    command.add_argument("--file", action="append", dest="files", default=[], help="a file to add (repeatable)")
    command.add_argument("--note", help="text stored as note.md")
    _op_id(command)
    command = verb(evidence_noun, "export", "a bundle's files into a new temporary directory")
    _ledger_option(command)
    command.add_argument("--bundle", required=True, help="bundle name")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    _at(command)

    execution_noun = verbs("execution", "execution captures: recover")
    command = verb(execution_noun, "recover", "append recovered bytes of a kept precheck directory")
    _ledger_option(command)
    command.add_argument("--trial-id", required=True, type=int, help="the precheck trial whose capture was refused")
    command.add_argument("--workdir", required=True, help="the kept precheck directory")
    command.add_argument("--failure-receipt", required=True, help="the failure receipt the refusal wrote")

    judgment = verbs("judgment", "Agent judgments: add")
    command = verb(judgment, "add", "append one judgment")
    command.epilog = ("A judgment binds to a line, its subjects and the --based-on commit and is never edited. "
                      "--supersedes corrects the same conclusion; an independent conclusion is a new judgment, "
                      "and both stay readable (research state --history).")
    _ledger_option(command)
    command.add_argument("--kind", required=True,
                         help="recommendation, priority, interpretation or search_exposure")
    command.add_argument("--line", required=True, help="research line name (its slug)")
    command.add_argument("--based-on", required=True, help="the ledger commit the judgment reads")
    command.add_argument("--body", required=True, help="UTF-8 text file of at most 65,535 bytes")
    command.add_argument("--subject", action="append", dest="subjects", default=[],
                         help="[role=ROLE,]candidate=ID@N | trial=N | registration=N (repeatable; "
                              + SUBJECT_ROLES_HELP + ")")
    command.add_argument("--supersedes", type=int, help="the judgment ID this one replaces")
    _op_id(command)

    line = verbs("line", "research lines: list, select, targets, history, close")
    command = verb(line, "list", "list the open research lines")
    _ledger_option(command)
    command.add_argument("--all", action="store_true", help="list the closed lines too")
    _at(command)
    command = verb(line, "select", "record the user's research line")
    command.epilog = ("One record per choice: a later change of start or market commit is a new line record, never "
                      "an edit. --slug names the line. The development period is not a choice: Q is the last "
                      "calendar quarter end before today that the market covers, the holdout the 8 quarters ending "
                      "at Q and the development period the 12 quarters before the holdout (4 when the instruments of "
                      "the start's precheck have fewer than 24 quarters of coverage before Q; under 12, no line). "
                      "Lines opened in one quarter share it; the holdout, the history before the period and the "
                      "forward segment after Q are replayed only when the line closes.")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--start", required=True,
                         help="start candidate as ID@N; a revision whose source review passed")
    command.add_argument("--market-at", help="market commit to pin (default: the newest day)")
    _targets_options(command, "the line reads the ledger default when both are omitted")
    command.add_argument("--slug", required=True,
                         help="the line's direction as lowercase words joined by hyphens")
    command = verb(line, "targets", "record the user's research targets for an open line or the default")
    command.epilog = ("The targets are the user's, recorded only as the user states them; they guide reading reports, "
                      "never candidate eligibility. A change supersedes the targets in force, and the same targets "
                      "again write nothing. A line without its own targets reads the ledger default.")
    _ledger_option(command)
    scope = command.add_mutually_exclusive_group()
    scope.add_argument("--line", help="an open research line (default: the only open line)")
    scope.add_argument("--default", action="store_true", help="the ledger default for lines without their own")
    _targets_options(command, None)
    command = verb(line, "history", "run the line's closing history test")
    command.epilog = ("Every candidate with a passed research run on the line replays its latest such run over each "
                      "calendar year before the development period (veto), the period again (a control that must "
                      "reproduce the run), the two-year holdout after it in one run and the forward segment after "
                      "the holdout: same source, image and configuration, another window. The candidates are fixed "
                      "by the line's first history trial. Rerun to resume; "
                      "`line close` needs every segment to have a run.")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--line", required=True, help="an open research line")
    command.add_argument("--market-at", help="market commit (default: the newest day)")
    command.add_argument("--limit", type=int, help="run at most this many segments")
    command = verb(line, "close", "end a line with its summary")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--line", required=True, help="an open line research state lists under open_lines")
    command.add_argument("--summary", required=True,
                         help="UTF-8 text file (at most 32 KB), the index later research searches: the direction, "
                              "what was tried, results with their run IDs, failures and why, lessons and advice; "
                              "numbers stay in the reports")

    registration = verbs("registration", "registrations: add")
    command = runner(registration, "add", "lock a registration")
    command.epilog = textwrap.fill(
        "Locks the body and its runtime and input identity as an immutable registration; the runner arguments "
        "must match replay run. body.prechecks names each grid candidate's passed source review by review_id. "
        "Parent and change are the grid candidates' (--parent, --difference); the window is the line's. "
        "Changing source, intent or grid needs a new registration; a consumed point is retried by a new one "
        "naming its registration_id in retry_of.", 100) + "\n\n" + RUNNER_EPILOG
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--body", required=True, help="JSON body file; templates in "
                                                       ".agents/skills/research-round/templates/registration-*.json")
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP)
    command.add_argument("--line", help="the open research line to register on (default: the only open line)")
    command.add_argument("--source", action="append", default=[], help="a source original file (repeatable)")

    hypothesis = verbs("hypothesis", "registered hypotheses: compare")
    command = verb(hypothesis, "compare", "a grid run against its registered control")
    _ledger_option(command)
    command.add_argument("--registration", required=True, type=int, help="research registration ID")
    command.add_argument("--trial-id", required=True, type=int, help="a grid run of that registration")
    _at(command)

    research = verbs("research", "research facts: status, state, runs, history, graph")
    command = verb(research, "status", "research fact counts and the line's comparison table")
    _ledger_option(command)
    command.add_argument("--line", help="research line name of the comparison table (default: the only open "
                                         "line)")
    _at(command)
    command = verb(research, "state", "the line record and its current judgments with read-time facts")
    _ledger_option(command)
    command.add_argument("--line", help="research line name (default: the only open line)")
    command.add_argument("--history", action="store_true",
                         help="include up to 20 original judgments, newest first, including superseded text and subjects")
    command.add_argument("--history-before", type=int,
                         help="include the next history page before this judgment ID (use next_before; implies --history)")
    command.add_argument("--full", action="store_true",
                         help="every current interpretation and search exposure, and the candidate list and research "
                              "status as facts (default: those after the current recommendation, earlier ones counted)")
    _at(command)
    command = verb(research, "runs", "every research run with its measures, by one measure")
    _ledger_option(command)
    command.add_argument("--line", help="only that line's comparison table (default: the open lines' runs)")
    command.add_argument("--by", choices=RUN_MEASURES, help="order by this measure (default: by trial ID)")
    command.add_argument("--limit", type=_count, help="keep the first N runs (default: all)")
    _at(command)
    command = verb(research, "history", "a line's closing history test, by year")
    _ledger_option(command)
    command.add_argument("--line", help="one research line (default: every line with history trials)")
    _at(command)
    command = verb(research, "unchanged", "whether a line's graph is the same at two ledger commits")
    command.epilog = ("From what changed between the commits, without drawing: any change it does not recognize answers "
                      "false. Lets the IDE keep a graph it holds. Writes nothing.")
    _ledger_option(command)
    command.add_argument("--line", required=True, help="research line name")
    command.add_argument("--since", required=True, help="the ledger commit of the graph held")
    _at(command)
    command = verb(research, "counts", "a line's trial counts, as `research graph` gives them")
    command.epilog = ("They cover the whole ledger's trials on the line's contracts, so they move with trials the rest "
                      "of the graph never reads. Lets the IDE keep a graph it holds and still show them. Writes nothing.")
    _ledger_option(command)
    command.add_argument("--line", required=True, help="research line name")
    _at(command)
    command = verb(research, "graph", "the line as a research-graph@3 document, read from the ledger only")
    command.epilog = ("Composes the product's readers and adds no rule, so one ledger commit gives one graph. The "
                      "targets are the ones in force for the line at that commit (`line targets`); --since marks "
                      "where the scope under study starts. Check, render and compare it with "
                      "ide/ide.py. Writes nothing.")
    _ledger_option(command)
    command.add_argument("--line", help="research line name (default: the only open line)")
    command.add_argument("--since", help="ledger commit where the scope under study starts")
    command.add_argument("--workers", type=_count, default=min(8, os.cpu_count() or 1),
                         help="processes computing the comparisons (default: 8 or the CPU count if fewer; 1 runs "
                              "them in this process); the graph is the same")
    command.add_argument("--without-comparisons", action="store_true",
                         help="leave every version's comparison null and skip their bootstraps; the rest of the graph "
                              "is the same (`research comparison` gives one version's)")
    command.add_argument("--without-counts", action="store_true",
                         help="leave the line's trial_counts null and skip reading them, with their refusals; the rest "
                              "of the graph is the same (`research counts` gives them, and a caller must read them)")
    _at(command)
    command = verb(research, "comparison", "one version's comparison, as `research graph` gives it")
    command.epilog = ("Names the version by its registration and its last research run. Writes nothing.")
    _ledger_option(command)
    command.add_argument("--registration", type=int, required=True, help="the research registration ID")
    command.add_argument("--trial-id", type=int, required=True, help="the registered run")
    _at(command)

    source = verbs("source", "independent source reviews: review")
    command = verb(source, "review", "record an independent source review of a precheck")
    command.epilog = ("Records the review in the ledger. A failed review removes economic evidence from every run "
                      "of the same source and image, including runs sealed before it; their reports then give "
                      "the reason instead of measures.")
    _ledger_option(command)
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--runtime", required=True, help=RUNTIME_HELP + "; the precheck's image")
    command.add_argument("--precheck-trial", required=True, type=int, help="the precheck trial reviewed")
    command.add_argument("--verdict", required=True, choices=("passed", "failed"), help="passed or failed")
    command.add_argument("--items", required=True, help="JSON file with api, causal, activity and readiness")
    command.add_argument("--reviewer", required=True, help="the reviewer's name, not the author's")

    validation = verbs("validation", "out-of-sample validations: registration, report")
    command = verb(validation, "registration", "register one out-of-sample validation")
    command.epilog = ("Records the user's candidate, window and universe rule and requests an RFC 3161 timestamp; "
                      "ledger witness retries a missing one. replay run --validation runs it once. "
                      "Binding derives account terms from research sealed at the original registration commit; "
                      "later research and retry registrations cannot replace that baseline.")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--window-start", required=True, help="UTC time, YYYY-MM-DDTHH:MM:SSZ")
    command.add_argument("--window-end", required=True, help="UTC time, YYYY-MM-DDTHH:MM:SSZ")
    command.add_argument("--universe-rule", required=True, help="the market commit's universe rule")
    command.add_argument("--market-at", help="market commit (default: the newest day)")
    command.add_argument("--design", required=True, help="JSON file of the validation design")
    command.add_argument("--retry-of", type=int,
                         help="a bound interrupted, invalid or economically unavailable registration; keep its "
                              "candidate, window, universe rule and original test design")
    _op_id(command)
    command.add_argument("--tsa-url", help="the only RFC 3161 timestamp authority to ask (default: DigiCert, "
                                          "then Sectigo when DigiCert grants no token)")
    command = verb(validation, "report", "the out-of-sample report of a registration")
    command.epilog = ("The same measures and masking as development reports, with intervals, p and the Holm "
                      "correction over the window's registrations; no verdict.")
    _ledger_option(command)
    command.add_argument("--registration-id", required=True, type=int, help="validation registration ID")
    _at(command)


def dispatch(args, runner_argv: list[str]) -> tuple[dict, int]:
    """(result, exit code) of one parsed research record command."""
    key = (args.noun, args.verb)
    if key == ("candidate", "new"):
        return candidate_new(args.output, args.strategy_id, args.entry_class), 0
    profile = db.profile(args.ledger, holds="research")
    if key == ("candidate", "publish"):
        return candidate_publish(profile, args.file, args.strategy_id, args.entry_class, args.description, args.parent,
                                 args.difference, args.op_id), 0
    if key == ("candidate", "show"):
        return candidate_show(profile, args.candidate, args.at), 0
    if key == ("candidate", "export"):
        return candidate_export(profile, args.candidate, args.output, args.at), 0
    if key == ("candidate", "list"):
        return candidate_list(profile, args.at), 0
    if key == ("evidence", "add"):
        with db.connect(profile, "writer") as conn:
            return evidence_add(conn, args.bundle, args.files, args.note, args.op_id), 0
    if key == ("evidence", "export"):
        return evidence_export(profile, args.bundle, args.output, args.at), 0
    if key == ("execution", "recover"):
        return execution_recover(profile, args.trial_id, args.workdir, args.failure_receipt), 0
    if key == ("judgment", "add"):
        return judgment_add(profile, args.kind, args.line, args.based_on, args.body, args.subjects, args.supersedes,
                            args.op_id), 0
    if key == ("line", "list"):
        from report import graph
        return graph.line_list(profile, args.at, args.all), 0
    if key == ("line", "select"):
        market = profiles.market(args.market)
        with db.connect(profile, "writer") as conn:
            return line_select(conn, market, args.start, args.market_at,
                               args.slug, _targets(args)), 0
    if key == ("line", "targets"):
        with db.connect(profile, "writer") as conn:
            line_id = None if args.default else lines.open_line(conn, args.line)["line_id"]
            return targets.set_targets(conn, line_id, args.max_drawdown, args.annual_return), 0
    if key == ("line", "history"):
        from replay import history
        return history.run_history(profile, profiles.market(args.market), args.market_at, args.line, args.limit), 0
    if key == ("line", "close"):
        return line_close(profile, args.line, _regular_file(args.summary, "LINE_SUMMARY_INVALID"),
                          profiles.market(args.market)), 0
    if key == ("registration", "add"):
        return registration_add(profile, args.body, args.runtime, profiles.market(args.market),
                                runner_argv, args.source, args.line), 0
    if key == ("hypothesis", "compare"):
        return hypothesis_compare(profile, args.registration, args.trial_id, args.at), 0
    if key == ("research", "status"):
        return research_status(profile, args.at, args.line), 0
    if key == ("research", "state"):
        with db.connect(profile, "reader") as conn:
            return research_state(conn, args.line, args.at, history=args.history,
                                  history_before=args.history_before, full=args.full), 0
    if key == ("research", "history"):
        from report import history as report_history
        return report_history.research_history(profile, args.at, args.line), 0
    if key == ("research", "runs"):
        from report import status as report_status
        return report_status.research_runs(profile, args.at, args.line, args.by, args.limit), 0
    if key == ("research", "unchanged"):
        from report import graph
        return graph.unchanged_since(profile, args.line, args.since, args.at), 0
    if key == ("research", "graph"):
        from report import graph
        return graph.research_graph(profile, args.line, args.at, since=args.since, workers=args.workers,
                                    comparisons=not args.without_comparisons, counts=not args.without_counts), 0
    if key == ("research", "counts"):
        from report import graph
        return graph.line_counts(profile, args.line, args.at), 0
    if key == ("research", "comparison"):
        from report import graph
        return graph.version_comparison(profile, args.registration, args.trial_id, args.at), 0
    if key == ("source", "review"):
        return source_review(profile, args.candidate, args.runtime, args.precheck_trial, args.verdict, args.items,
                             args.reviewer), 0
    if key == ("validation", "registration"):
        return validation_registration(profile, args.candidate, args.window_start, args.window_end, args.universe_rule,
                                       args.market_at, profiles.market(args.market), args.design, args.retry_of,
                                       args.op_id, args.tsa_url), 0
    if key == ("validation", "report"):
        return validation_report(profile, args.registration_id, args.at), 0
    raise UsageError(f"unknown command {args.noun} {args.verb}")
