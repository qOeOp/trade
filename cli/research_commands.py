"""The research records: candidate, evidence, execution, judgment, line, registration, hypothesis, research, source and validation."""

from __future__ import annotations

from collections.abc import Mapping
import contextlib
import functools
import hashlib
from importlib.resources import files
import os
from pathlib import Path
import shutil
import tempfile

from cli.common import (AT, CANDIDATE_HELP, LEDGER, MARKET, MARKET_DAY, OP_ID, RUNTIME_DEFAULT_HELP, RUNTIME_HELP,
                        _count, _json_file, _new_temporary, _regular_file, _utc_time, command, one_of, option,
                        refusal_json)
from cli.ledger_commands import ledger_export
from cli.strategy_stub import STRATEGY_STUB
from ledger import db, evidence, execution, judgments, lines, strategies
from shared import profiles
from shared.errors import Refusal
from shared.refusals import refuse


NOUNS = {"candidate": "candidates", "evidence": "Agent evidence bundles", "execution": "execution captures",
         "judgment": "Agent judgments", "line": "research lines", "registration": "registrations",
         "hypothesis": "registered hypotheses", "research": "research facts", "source": "independent source reviews",
         "validation": "out-of-sample validations"}
CANDIDATE = option("--candidate", required=True, help=CANDIDATE_HELP)
OUTPUT = option("--output", required=True, help="new directory under the temporary root")


def _research(args) -> db.LedgerProfile:
    return db.profile(args.ledger, holds="research")


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


def candidate_publish(args):
    """One single-file UTF-8 source as a candidate, a root without --parent."""
    source = _regular_file(args.file)
    published = strategies.publish_candidate(_research(args), source, args.strategy_id, args.entry_class,
                                             args.description, args.parent, args.difference, args.op_id)
    return {"candidate": published["candidate"], "source_sha256": published["source_sha256"], "parent": args.parent,
            "ledger_commit": published["ledger_commit"],
            "replayed": published["replayed"]}


def _candidate_record(conn: db.LedgerConnection, row: Mapping, commit: str) -> dict:
    parent = (strategies.name(strategies.candidate_by_sha(conn, row["parent_source_sha256"]))
              if row.get("parent_source_sha256") else None)
    return {"candidate": f"{row['strategy_id']}@{row['revision']}", "strategy_id": row["strategy_id"],
            "revision": row["revision"], "source_sha256": row["source_sha256"], "entry_class": row["entry_class"],
            "description": row["description"], "parent": parent,
            "difference": row["difference"], "created_at": row["created_at"], "ledger_commit": commit}


def candidate_show(args):
    """The candidate record at a ledger version, without its source bytes."""
    strategies.parse_ref(args.candidate)
    with db.read_as_of(_research(args), args.at) as conn:
        return _candidate_record(conn, strategies.read_candidate(conn, args.candidate), conn.resolved_commit)


def candidate_export(args):
    """The source bytes to a new file under the temporary root, with the working directory notes beside it."""
    candidate = args.candidate
    target = _new_temporary(args.output)
    _require_absent(target.parent / "AGENTS.md", target.parent / HEADER_TEMPLATE)
    with db.read_as_of(_research(args), args.at) as conn:
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


def _header_block(template: str) -> str:
    """The docstring in strategy-header.md's text block, quotes included: the header a new source fills in."""
    block = template.split("```text\n", 1)[1].split("\n```", 1)[0].strip()
    assert block.startswith('"""') and block.endswith('"""')  # the packaged template's shape
    return block


def candidate_new(output: str, strategy_id: str, entry_class: str) -> dict:
    """candidate new: a strategy scaffold in a new temporary directory; writes no ledger."""
    directory = _new_temporary(output)
    if not entry_class.isidentifier():
        raise refuse("ENTRY_CLASS_INVALID", f"{entry_class!r} is not one Python class name")
    header = _header_block(TEMPLATES.joinpath(HEADER_TEMPLATE).read_text(encoding="utf-8"))
    directory.mkdir(mode=0o700, parents=True)
    (directory / "strategy.py").write_text(STRATEGY_STUB.format(header=header, entry_class=entry_class),
                                           encoding="utf-8")
    notes = _workdir_notes(directory, f"{strategy_id}@<revision>")
    return {"output": str(directory), "files": ["strategy.py", *notes]}


def _candidate_new(args):
    return candidate_new(args.output, args.strategy_id, args.entry_class)


def candidate_list(args):
    """Every candidate with its lineage and registration attempts (report.candidates)."""
    from report import candidates
    return candidates.candidates(_research(args), args.at)


# evidence

def evidence_add(args):
    """An Agent evidence bundle of files and an optional note (note.md)."""
    with db.connect(_research(args), "writer") as conn:
        if not args.files and not args.note:
            raise refuse("EMPTY_EVIDENCE", "an evidence bundle needs files or a note", missing=("--file", "--note"))
        work = None
        sources = [Path(item) for item in args.files or ()]
        try:
            if args.note:
                work = Path(tempfile.mkdtemp(prefix="evidence-note-"))
                (work / "note.md").write_text(args.note, encoding="utf-8")
                sources.append(work / "note.md")
            added = evidence.add_bundle(conn, args.bundle, sources, args.op_id)
        finally:
            if work is not None:
                shutil.rmtree(work, ignore_errors=True)
    return {"bundle": added["bundle"], "files": added["files"], "write_status": added["write_status"],
            "ledger_commit": added["ledger_commit"]}


def evidence_export(args):
    """A bundle's files, each hash recomputed, into a new temporary directory."""
    target = _new_temporary(args.output)
    with db.read_as_of(_research(args), args.at) as conn:
        loaded = evidence.load_bundle(conn, args.bundle)
        commit = conn.resolved_commit
    listed = []
    for name, data in sorted(loaded["files"].items()):
        path = target / name
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.write_bytes(data)
        listed.append({"name": name, "sha256": loaded["digests"][name], "bytes": len(data)})
    if not listed:
        target.mkdir(mode=0o700, parents=True)
    return {"bundle": args.bundle, "at_commit": commit, "path": str(target), "files": listed}


# execution, judgments, lines

def execution_recover(args):
    """Recovered bytes of a kept precheck directory, marked recovery material."""
    recovered = execution.recover_capture(_research(args), args.trial_id, Path(args.workdir),
                                          Path(args.failure_receipt))
    return {"trial_id": args.trial_id, "recovery_bundle": recovered["bundle"], "original_capture": "missing",
            "limitation": recovered["limitation"], "ledger_commit": recovered["ledger_commit"]}


SUBJECT_FORM = "role=ROLE,candidate=ID@N | [role=about,]trial=N | [role=about,]registration=N"
SUBJECT_ROLES_HELP = (" | ".join(judgments.CANDIDATE_ROLES) + " name a candidate; "
                      "about names a candidate, trial or registration, and a trial or registration may omit it")


def _subject(text: str) -> dict:
    found = {}
    for part in text.split(","):
        key, sep, value = part.partition("=")
        if not sep or not key.strip():
            raise refuse("USAGE_ERROR", f"--subject {text!r} is not {SUBJECT_FORM} ({SUBJECT_ROLES_HELP})")
        found[key.strip()] = value.strip()
    subject: dict[str, str | int | None] = {"role": found.pop("role", None)}
    for key, target in (("candidate", "candidate"), ("trial", "trial_id"), ("registration", "registration_id")):
        if key in found:
            value = found.pop(key)
            if target != "candidate" and not value.isdigit():
                raise refuse("USAGE_ERROR", f"--subject {key}={value!r} is not an ID")
            subject[target] = int(value) if target != "candidate" else value
    if found:
        raise refuse("USAGE_ERROR", f"--subject has unknown keys {sorted(found)}")
    return subject


def judgment_add(args):
    """One judgment (body from a UTF-8 file) and its subjects."""
    profile = _research(args)
    data = _regular_file(args.body, "JUDGMENT_BODY_UNREADABLE")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise refuse("JUDGMENT_BODY_UNREADABLE", f"{args.body} is not UTF-8", missing=(args.body,)) from exc
    return judgments.add_judgment(profile, args.kind, args.line, args.based_on, text,
                                  [_subject(item) for item in args.subjects or ()], args.supersedes, args.op_id)


def _target_options(omitted: str | None):
    return (option("--max-drawdown", required=omitted is None,
                   help="the user's maximum drawdown as a fraction (0.15 for 15%%)" + (f"; {omitted}" if omitted else "")),
            option("--annual-return", required=omitted is None,
                   help="the user's minimum annual return as a fraction (0.20 for 20%%)"))


def _targets(args) -> tuple[str, str] | None:
    """(maximum drawdown, minimum annual return) as given, None when both are omitted."""
    given = (args.max_drawdown, args.annual_return)
    if given == (None, None):
        return None
    if None in given:
        raise refuse("TARGETS_INVALID", "give both research targets or neither",
                     expected="--max-drawdown and --annual-return together")
    return given


def _market_facts(market: dict):
    """The market facts ledger.select_line reads at a market reference, through the registration market seam."""
    from registration import seams
    source = seams.current.market(market)

    def facts(market_at: str) -> dict:
        market_day = source.resolve_day(market_at)
        return {"market_day": market_day, "universe_rule": source.universe_rule(market_day),
                "latest_complete_day": source.days(market_day)[1],
                "covered": functools.partial(lines.run_covered, market=seams.coverage(source, market_day))}
    return facts


def line_list(args):
    from report import graph
    return graph.line_list(_research(args), args.at, args.all, args.readings, args.full)


def line_select(args):
    """The user's research line (start candidate, pinned market day; the development period is the product's rule)
    and, when given, the user's targets for it."""
    from registration import precheck
    profile, market = _research(args), profiles.market(args.market)
    with db.connect(profile, "writer") as conn:
        selected = lines.select_line(conn, args.market_day, args.start, slug=args.slug, market=_market_facts(market),
                                     reviews=precheck.review_records, targets=_targets(args))
        line = lines.read_line(conn, selected["line_id"])
    return {"line": selected["line"], "line_id": selected["line_id"], "start": args.start,
            "window": {"start": line["dev_start"], "end": line["dev_end"]},
            "market_day": selected["market_day"], "universe_rule": selected["universe_rule"],
            "created": selected["created"], "targets": selected["targets"]}


def line_targets(args):
    with db.connect(_research(args), "writer") as conn:
        line_id = None if args.default else lines.open_line(conn, args.line)["line_id"]
        return lines.set_targets(conn, line_id, args.max_drawdown, args.annual_return)


def line_history(args):
    from replay import history
    return history.run_history(_research(args), profiles.market(args.market), args.market_day, args.line, args.limit)


def line_close(profile: db.LedgerProfile, line: str, summary: bytes, market: dict) -> dict:
    """line close: end the line, then sync the profile's backup (`ledger export --kind backup`). The closing
    stands whatever the sync does: a refused sync is reported as backup_failed, and `ledger review` reports the
    backup as behind until a sync succeeds."""
    from report import history as report_history
    closed = lines.close_line(profile, line, summary, report_history.market_days(market), report_history.qualified)
    if profile.backup_root is None:
        return {**closed, "backup": None}
    try:
        synced = ledger_export(profile, "backup", None, None)
    except Refusal as exc:
        return {**closed, "backup": None, "backup_failed": refusal_json(exc)}
    return {**closed, "backup": {"ledger_commit": synced["ledger_commit"], "backup_path": synced["backup_path"]}}


def _line_close(args):
    return line_close(_research(args), args.line, _regular_file(args.summary, "LINE_SUMMARY_INVALID"),
                      profiles.market(args.market))


# registration, hypothesis

def registration_add(args):
    """Lock the registration body, test conditions, grid and execution identity."""
    from registration import register
    profile = _research(args)
    plan = _json_file(args.body, "REGISTRATION_INVALID")
    registered = register.register(profile, plan, args.runtime, profiles.market(args.market), list(args.runner_argv),
                                   [Path(item) for item in args.source or ()], args.line)
    return {"registration_id": registered["registration_id"], "line": registered["line"],
            "grid_points": len(plan["grid"]), "execution": registered["execution"],
            "ledger_commit": registered["ledger_commit"], "replayed": registered["replayed"]}


def hypothesis_compare(args):
    """The comparison report of a grid run with its registered control (report.compare)."""
    from report import comparison
    return comparison.compare(_research(args), args.registration, args.trial_id, args.at)


# research, source review

# `research runs --by`: report.status.RUN_MEASURES, named here so the parser imports no report code.
RUN_MEASURES = ("annual_return", "mark_max_drawdown", "sharpe_365", "sharpe_lo", "plan_win_rate", "cycles",
                "daily_turnover", "alpha_basket", "beta_basket")


def research_status(args):
    from report import status
    return status.research_status(_research(args), args.at, args.line)


def research_state(args):
    from registration import seams
    from report import status
    profile, current = _research(args), None
    if not args.without_image:
        with contextlib.suppress(Refusal):
            current = seams.current.resolve_runtime(None)["image_ref"]
    return status.research_state(profile, args.line, args.at, history=args.history,
                                 history_before=args.history_before, full=args.full, current_image=current)


def research_runs(args):
    from report import status
    return status.research_runs(_research(args), args.at, args.line, args.by, args.limit)


def research_history(args):
    from report import history
    return history.research_history(_research(args), profiles.market(args.market), args.at, args.line)


def research_unchanged(args):
    from report import graph
    return graph.unchanged_since(_research(args), args.line, args.since, args.at)


def research_counts(args):
    from report import graph
    return graph.line_counts(_research(args), args.line, args.at)


def research_multiple_testing(args):
    from report import testing
    return testing.line_testing(_research(args), args.line, args.at)


def research_graph(args):
    from report import graph
    return graph.research_graph(_research(args), args.line, args.at, since=args.since, workers=args.workers,
                                comparisons=not args.without_comparisons, counts=not args.without_counts)


def research_comparison(args):
    from report import graph
    return graph.version_comparison(_research(args), args.registration, args.trial_id, args.at)


def source_review(args):
    """An independent review of a candidate's native precheck on one runtime image."""
    from registration import precheck, seams
    profile, candidate, runtime, precheck_trial = _research(args), args.candidate, args.runtime, args.trial_id
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
    review_items = _json_file(args.items, "REVIEW_INVALID")
    body = {"trial_id": precheck_trial, "verdict": args.verdict,
            **{name: review_items.get(name) for name in precheck.ITEMS}}
    extra = sorted(set(review_items) - set(precheck.ITEMS))
    if extra:
        raise refuse("REVIEW_INVALID", "the review items hold unknown fields: " + ", ".join(extra), missing=tuple(extra))
    recorded = precheck.record_review(profile, body, args.reviewer)
    return {"review_id": recorded["review_id"], "candidate": candidate, "source_sha256": recorded["source_sha256"],
            "image_digest": recorded["image_digest"], "precheck_trial": precheck_trial, "verdict": args.verdict,
            "ledger_commit": recorded["ledger_commit"], "replayed": recorded["replayed"]}


# validation

def validation_registration(args):
    """One out-of-sample registration, then its time witness."""
    from registration import validation
    from report import history
    profile = _research(args)
    registered = validation.validation_register(
        profile, args.candidate, _utc_time(args.window_start), _utc_time(args.window_end), args.universe_rule,
        args.market_day, _json_file(args.design, "DESIGN_INVALID"), args.retry_of, args.op_id,
        market_profile=profiles.market(args.market), unfalsified=history.require_unfalsified, tsa_url=args.tsa_url)
    stamped = registered["witness"]
    # A retry binds by its original registration's witness (registration.validation.validation_bind).
    next_actions = [] if stamped["status"] == "stamped" or args.retry_of is not None else [
        "Run `ledger witness` before the window starts; a registration without a witness older than its window "
        "start is refused as REGISTRATION_TOO_LATE when a validation replay binds it."]
    return {"registration_id": registered["registration_id"], "candidate": args.candidate,
            "window": {"start": args.window_start, "end": args.window_end}, "registered_at": registered["created_at"],
            "ledger_commit": registered["ledger_commit"], "witness": stamped, "replayed": registered["replayed"],
            "next_actions": next_actions}


def validation_report(args):
    from report import comparison
    return comparison.validation_report(_research(args), args.validation, args.at)


COMMANDS = [
    command(candidate_publish, "candidate", "publish", "publish one single-file source as a candidate", (
        "--file (a regular UTF-8 Python file, parsed and compiled, never run); the parent and existing candidates "
        "(writer, head)",
        "one candidate row (revision = the strategy ID's highest + 1); the same strategy ID, source, entry class "
        "and parent again is a replay returning the stored record",
        "candidate, source_sha256, parent, ledger_commit, replayed",
        "SOURCE_EXISTS (these bytes are already a candidate); SOURCE_SYNTAX, SOURCE_SIZE; ENTRY_CLASS_NOT_UNIQUE "
        "(not exactly one top-level class of that name); DUTY_HEADER_INVALID (the header lacks one of the 27 duty "
        "lines or a valid stance); LINEAGE_INCOMPLETE (--parent and --difference go "
        "together); UNKNOWN_CANDIDATE, BAD_REF (parent); OP_ID_CONFLICT"), LEDGER,
         option("--file", required=True, help="the UTF-8 strategy source file"),
         option("--strategy-id", required=True, help="strategy ID; a new one starts at revision 1"),
         option("--entry-class", required=True, help="the entry class name in the file"),
         option("--description", required=True, help="one line on what the candidate does"),
         option("--parent", help="parent candidate as ID@N (omit for a root)"),
         option("--difference", help="what changed from the parent"), OP_ID),
    command(candidate_show, "candidate", "show", "a candidate record without its source", (
        "the candidate at --at (reader); its source hash is recomputed",
        "nothing",
        "candidate, strategy_id, revision, source_sha256, entry_class, description, parent, "
        "difference, created_at, ledger_commit",
        "BAD_REF (not ID@N); UNKNOWN_CANDIDATE; UNKNOWN_REF (--at); LEDGER_CORRUPT (source does not match its "
        "hash)"), LEDGER, CANDIDATE, AT),
    command(candidate_export, "candidate", "export", "a candidate's source as a temporary working copy", (
        "the candidate's source at --at (reader); the packaged working directory templates",
        "the source file (--output, new, under the temporary root) and AGENTS.md and strategy-header.md beside "
        "it; no ledger write",
        "candidate, source_sha256, path, bytes, ledger_commit, notes (files written)",
        "NOT_TEMPORARY_PATH; PATH_EXISTS (the source, AGENTS.md or strategy-header.md exists); "
        "UNKNOWN_CANDIDATE, BAD_REF; LEDGER_CORRUPT (the file does not reread to the source hash)"), LEDGER,
         CANDIDATE,
         option("--output", required=True,
                help="new source file under the temporary root, in a fresh candidate working directory; "
                     "AGENTS.md and strategy-header.md beside it must also be absent"),
         AT),
    command(_candidate_new, "candidate", "new", "a strategy scaffold in a new temporary directory", (
        "the packaged strategy header template; no database",
        "a new directory under the temporary root with strategy.py (an entry class stub), AGENTS.md and "
        "strategy-header.md; no ledger",
        "output, files",
        "NOT_TEMPORARY_PATH; PATH_EXISTS; ENTRY_CLASS_INVALID (not a Python class name)"),
         OUTPUT, option("--strategy-id", required=True, help="strategy ID for the file header"),
         option("--entry-class", default="Strategy1", help="entry class name (default: Strategy1)")),
    command(candidate_list, "candidate", "list", "every candidate with its registration attempts", (
        "candidates, research trials of registration grid points, runs and source reviews at --at (reader); each "
        "run's economic evidence availability",
        "nothing",
        "ledger_commit, checker, candidates [{strategy_id, revision, source_sha256, entry_class, "
        "description, parent_source_sha256, parent, difference, created_at, attempts "
        "[{registration_id, trial_id, run_status, availability}], valid_evidence}]; large",
        "UNKNOWN_REF (--at); a run whose records do not verify is listed as unavailable, not refused"), LEDGER, AT),
    command(evidence_add, "evidence", "add", "append an evidence bundle", (
        "--file paths (a directory is walked; links refused) and --note (stored as note.md)",
        "one evidence bundle and its files (writer); the same name and content again is a replay",
        "bundle, files {path: sha256}, write_status (written or replayed), ledger_commit",
        "EMPTY_EVIDENCE (no files or note, or an empty file); BUNDLE_EXISTS; RESERVED_BUNDLE (a product "
        "namespace: lifecycle-*, trial-N-*); "
        "INVALID_EVIDENCE_PATH; MEDIA_NOT_KEPT (video or audio); EVIDENCE_TOO_LARGE (a file over 64 MiB)"), LEDGER,
         option("--bundle", required=True, help="new bundle name"),
         option("--file", action="append", dest="files", default=[], help="a file to add (repeatable)"),
         option("--note", help="text stored as note.md"), OP_ID),
    command(evidence_export, "evidence", "export", "a bundle's files into a new temporary directory", (
        "any bundle at --at (reader), product namespaces included; every hash is recomputed",
        "the bundle's files into a new directory under the temporary root; no ledger write",
        "bundle, at_commit, path, files [{name, sha256, bytes}]",
        "NOT_TEMPORARY_PATH; PATH_EXISTS; UNKNOWN_BUNDLE; LEDGER_CORRUPT (a file does not match its hash)"), LEDGER,
         option("--bundle", required=True, help="bundle name"), OUTPUT, AT),
    command(execution_recover, "execution", "recover", "append recovered bytes of a kept precheck directory", (
        "the precheck trial and its start receipt (writer, head); --failure-receipt (an EXECUTION_CAPTURE_LIMIT "
        "refusal); process.json and the capture files in --workdir (the receipt's own workdir)",
        "the bundle trial-<id>-recovery (the files, recovery.json, host-error.json), marked recovery material; "
        "the original capture stays missing; the same bytes again are a replay",
        "trial_id, recovery_bundle, original_capture (missing), limitation, ledger_commit",
        "RECOVERY_NOT_APPLICABLE (not a precheck, capture present, another workdir, or the trial has a run or "
        "a registration relies on it); RECOVERY_INCOMPLETE (another receipt, or required reports absent); TRIAL_NOT_FOUND; "
        "EXECUTION_IDENTITY; BUNDLE_EXISTS (a different recovery exists)"), LEDGER,
         option("--trial-id", required=True, type=int, help="the precheck trial whose capture was refused"),
         option("--workdir", required=True, help="the kept precheck directory"),
         option("--failure-receipt", required=True, help="the failure receipt the refusal wrote")),
    command(judgment_add, "judgment", "add", "append one judgment", (
        "--body (a regular UTF-8 file); the line, subjects and superseded judgment (writer, head)",
        "one judgment row and its subject rows; the same content again is a replay",
        "judgment_id, ledger_commit, replayed",
        "JUDGMENT_BODY_EMPTY (a blank body); LINE_UNKNOWN; COMMIT_NOT_ANCESTOR (--based-on is not an ancestor of the "
        "head); COMMIT_BEFORE_LINE; SUPERSEDES_INVALID (missing, another kind or line, or already superseded); "
        "SEARCH_EXPOSURE_VARIANTS_MISSING (a search_exposure body whose first line is not `Evaluated variants: K`); "
        "SUBJECT_UNKNOWN, SUBJECT_ROLE_MISMATCH"), LEDGER,
         option("--kind", required=True, help="recommendation, priority, interpretation or search_exposure"),
         option("--line", required=True, help="research line name (its slug)"),
         option("--based-on", required=True, help="the ledger commit the judgment reads"),
         option("--body", required=True, help="UTF-8 text file of at most 65,535 bytes"),
         option("--subject", action="append", dest="subjects", default=[],
                help=f"{SUBJECT_FORM} (repeatable; {SUBJECT_ROLES_HELP})"),
         option("--supersedes", type=int, help="the judgment ID this one replaces"), OP_ID,
         epilog="A judgment binds to a line, its subjects and the --based-on commit and is never edited. --supersedes "
                "corrects the same conclusion; an independent conclusion is a new judgment, and both stay readable "
                "(research state --history)."),
    command(line_list, "line", "list", "list the open research lines", (
        "the open research lines (with --all the closed ones too), their closings and targets at --at (reader); "
        "with --readings the recommendation judgments and each recommended version's latest research run; no market",
        "nothing",
        "ledger_commit, lines [{line_id, name, start, dev_start, dev_end, market_day, created_at, closed, "
        "summary (with --full: a closed line's closing summary, else null), targets, candidates, recommendation (with --readings: {recommended, since, research_runs, runs_since, trial_id, "
        "eligible, annual_return, max_drawdown} or null)}] oldest first; candidates are those its research "
        "graph draws, oldest first; a recommendation is the latest current judgment's version, since the first of the "
        "latest judgments naming it, and its latest sealed research run on the line read as the graph reads it "
        "(measures only while it is eligible)",
        "UNKNOWN_REF (--at)"), LEDGER,
         option("--all", action="store_true", help="list the closed lines too"),
         option("--full", action="store_true", help="add each closed line's closing summary (up to 32 KiB a line; "
                "one line's is also `line.summary` of research state --line)"),
         option("--readings", action="store_true",
                help="add each line's recommendation as its research graph's summary reads it, without the graph"),
         AT),
    command(line_select, "line", "select", "record the user's research line", (
        "the market at --market-day (reader): market day, universe rule, latest complete day; the start "
        "candidate, its source reviews, the open lines and targets (writer, head)",
        "one research_line row named <slug> and, when given, the line's targets in the same commit; the same "
        "choice under that name again writes no line (created false)",
        "line, line_id, start, window {start, end} (the development period: the calendar quarters before the "
        "holdout, the 8 quarters ending at the last quarter end before today that the market covers; C - 12 of them "
        "but at least 4 and at most 12, C the quarters of the start's precheck instruments' coverage before it), market_day, "
        "universe_rule, created, targets",
        "START_REVIEW_REQUIRED (the start has no passed source review, or a failed one); START_NOT_FOUND; "
        "LINE_HISTORY_SHORT (those instruments have fewer than 12 quarters of coverage before it); "
        "MARKET_DAY_UNRESOLVED (no market day, universe rule or complete day); LINE_CONFLICT (the name holds another choice); LINE_SLUG_INVALID; "
        "TARGETS_INVALID"), LEDGER, MARKET,
         option("--start", required=True, help="start candidate as ID@N; a revision whose source review passed"),
         MARKET_DAY, *_target_options("the line reads the ledger default when both are omitted"),
         option("--slug", required=True, help="the line's direction as lowercase words joined by hyphens"),
         epilog="One record per choice: a later change of start or market day is a new line record, never an edit. "
                "--slug names the line. The development period is not a choice: Q is the last calendar quarter end "
                "before today that the market covers, the holdout the 8 quarters ending at Q and the development "
                "period the C - 12 quarters before the holdout, at least 4 and at most 12, where C is the quarters the "
                "start's precheck instruments are covered before Q (under 12, no line). Lines opened in one quarter "
                "share it; the holdout, the history before the period and the forward segment after Q are replayed "
                "only when the line closes."),
    command(line_targets, "line", "targets", "record the user's research targets for an open line or the default", (
        "the targets in force for the line or the default (writer, head)",
        "one line_target row superseding the one in force; values equal to it write nothing (written false)",
        "max_drawdown, annual_return, source (line or default), target_id, created_at, line, written, commit",
        "RESEARCH_LINE_REQUIRED (no open line); LINE_AMBIGUOUS (several open lines and no --line); LINE_ENDED "
        "(--line is closed); LINE_UNKNOWN; TARGETS_INVALID (needs 0 < max-drawdown < 1 and 0 < annual-return < 1000)"),
         LEDGER,
         one_of(option("--line", help="an open research line (default: the only open line)"),
                option("--default", action="store_true", help="the ledger default for lines without their own")),
         *_target_options(None),
         epilog="The targets are the user's, recorded only as the user states them; they guide reading reports, never "
                "candidate eligibility. A change supersedes the targets in force, and the same targets again write "
                "nothing. A line without its own targets reads the ledger default."),
    command(line_history, "line", "history", "run the line's closing history test", (
        "the open line, its passed research runs with their economic evidence and its history trials (writer, "
        "head); the market at --market-day "
        "(default: the newest day): its first day and latest complete day; each run's runtime image, probed",
        "one history trial and its run per segment left (each year of four quarters counted back from the "
        "development period's start as a veto segment, labelled YYYY-MM by its first month, the period again as the control, the two-year holdout after it as one segment, the forward "
        "segment after the holdout), candidates by development-period Sharpe; segments replay several at once, as "
        "many as Docker's memory (its total less what its containers hold) has room for at a stage's 16 GiB limit; "
        "a segment with a passed history run is skipped, so a rerun resumes; after the segments without a run, "
        "one more history trial per segment whose latest history run is invalid (it supersedes that run, which "
        "stays; a failure of the strategy's own fails again)",
        "line, market_day, ran [{source_sha256, segment, run, history_trial_id, status, replaces (the invalid "
        "history trial a rerun supersedes, else null)}], left (segments without a run), invalid_left (segments "
        "with an invalid run not replayed this time: --limit), participants (the "
        "candidates), without_economic_evidence [{source_sha256, candidate, run, reasons}] (the participants left "
        "out), segments_without_trading",
        "LINE_UNKNOWN, LINE_ENDED; MARKET_DAY_UNRESOLVED; HISTORY_MARKET_DAY_EARLY (--market-day before the line's "
        "own market day); REPRODUCTION_CONFIG_DIFFERS (the image gives a run "
        "another effective configuration); the replay refusals of a sealed run (the first in segment order; the "
        "segments already running still seal, and no other starts)"), LEDGER, MARKET,
         option("--line", required=True, help="an open research line"), MARKET_DAY,
         option("--limit", type=_count, help="run at most this many segments"),
         epilog="Every candidate, a source with a passed research run on the line whose latest such run carries "
                "economic evidence (the judgment `research status` reads), replays that run over each year before the "
                "development period, counted back from its start (veto), the period again (a control that must reproduce the run), the "
                "two-year holdout after it in one run and the forward segment after the holdout: same source, image "
                "and configuration, another window. The sources that can take part are fixed by the line's first "
                "history trial; one without economic evidence is left out and named. Rerun to resume; each call also "
                "replays once more every segment whose latest run is invalid; `line close` needs every segment to "
                "have a run."),
    command(_line_close, "line", "close", "end a line with its summary", (
        "--summary (a regular UTF-8 file, at most 32 KB); the line, its passed research runs with their economic "
        "evidence, its history trials and its closing at the head "
        "(writer); the market's first and latest complete day at the newest day",
        "one line_close row holding the summary, which ends the line; the same summary again is a replay; then the "
        "profile's backup is synced as `ledger export --kind backup` does",
        "line, line_id, closed_at, ledger_commit, replayed, backup ({ledger_commit, backup_path}, null without a backup "
        "directory or when the sync was refused), backup_failed (the sync's refusal; the closing stands)",
        "HISTORY_INCOMPLETE (a segment of the closing history test has no history run: `line history`; only the "
        "segments of its candidates count, the participants whose run carries economic evidence); "
        "LINE_CLOSED (closed with another summary); LINE_UNKNOWN; LINE_SUMMARY_INVALID"), LEDGER, MARKET,
         option("--line", required=True, help="an open line research state lists under open_lines"),
         option("--summary", required=True,
                help="UTF-8 text file (at most 32 KB), the index later research searches: the direction, what was "
                     "tried, results with their run IDs, failures and why, lessons and advice; how the closing history "
                     "test came out, veto and holdout apart, as a falsification test, never validation, without "
                     "copying each candidate's verdicts (`research history` gives them); the holdout's earlier "
                     "searches (holdout_prior_trials of `research history`, and outside this ledger: the three earlier "
                     "ledger generations searched 2024-10 to 2026-10 about 3,100 times, which this ledger does not "
                     "count); the date `line history` read the forward segment, after which only Paper and later data "
                     "are unseen; other numbers stay in the reports")),
    command(registration_add, "registration", "add", "lock a registration", (
        "--body and --source files; the open line (--line), its trials, judgments and source reviews (writer, head); "
        "the market at the line's pinned market day (reader); the runtime image, resolved to its digest and probed",
        "one research_registration row with its grid points and comparison design, and one source-<sha256> "
        "bundle per --source, in one commit; the same line, body and execution again is a replay",
        "registration_id, line, grid_points, execution {image_ref, market_day, universe_rule, lifecycle_bundle, "
        "export_sha256, comparable_config_sha256, image_digest}, ledger_commit, replayed",
        "STALE_CHECKOUT (HEAD is not the fetched origin/main, or the work tree has uncommitted or untracked files; "
        "checked before anything else); "
        "REGISTRATION_INVALID (body, design, lineage or an unpublished grid candidate); LINEAGE_MISMATCH (the grid "
        "candidates do not share one parent, or their difference is not the first grid candidate's); "
        "RESEARCH_LINE_REQUIRED (no "
        "open line); LINE_AMBIGUOUS (several open lines and no --line); LINE_ENDED (--line is closed, or its closing has begun: it has a history trial); LINE_UNKNOWN; "
        "INTERPRETATION_REQUIRED (a completed research trial of the line has no interpretation); REVIEW_DUE (5 or "
        "more research trials since the last recommendation); WINDOW_MISMATCH (the runner window is not the line's); "
        "SOURCE_PRECHECK_REQUIRED, SOURCE_PRECHECK_FAILED; SOURCE_ALREADY_EXPOSED; RUN_NOT_PASSED, "
        "COMPARABILITY_MISMATCH, ECONOMIC_EVIDENCE_UNAVAILABLE (the control run)"), LEDGER, MARKET,
         option("--body", required=True, help="JSON body file; templates in "
                                               ".agents/skills/research-round/templates/registration-*.json"),
         option("--runtime", help=RUNTIME_DEFAULT_HELP),
         option("--line", help="the open research line to register on (default: the only open line)"),
         option("--source", action="append", default=[], help="a source original file (repeatable)"),
         runner=True,
         epilog="Locks the body and its runtime and input identity as an immutable registration; the runner arguments "
                "must match replay run. body.prechecks names each grid candidate's passed source review by review_id. "
                "Parent and change are the grid candidates' (--parent, --difference); the window is the line's. "
                "Changing source, intent or grid needs a new registration; a consumed point is retried by a new one "
                "naming its registration_id in retry_of."),
    command(hypothesis_compare, "hypothesis", "compare", "a grid run against its registered control", (
        "the registration, the grid run and its control at --at (reader); market daily returns from the run's "
        "market (a market failure only empties the market measures)",
        "nothing",
        "registration_id, trial_id, control_trial_id, research_parent, ledger_commit, registered_at, "
        "product_commit, comparison_source_sha256, availability, evidence (paired daily log difference, intervals, p, "
        "design), attribution (headline, slices, predictions, trade_pairs), limitations; a registration without "
        "a control gives evidence and attribution null with a reason; large (one entry per trade pair)",
        "REGISTRATION_INVALID (no such research registration); RUN_NOT_IN_GRID; UNKNOWN_RUN; RUN_NOT_PASSED, "
        "COMPARABILITY_MISMATCH, ECONOMIC_EVIDENCE_UNAVAILABLE (either side); CLOCK_MISMATCH; "
        "COMPARISON_UNAVAILABLE (too few usable days)"), LEDGER,
         option("--registration", required=True, type=int, help="research registration ID"),
         option("--trial-id", required=True, type=int, help="a grid run of that registration"), AT),
    command(research_status, "research", "status", "research fact counts and the line's comparison table", (
        "trials, runs, research trials of registrations, source reviews and validations of the whole ledger at --at "
        "(reader); the market's daily returns over each compared run's window (alpha_basket and beta_basket)",
        "nothing",
        "ledger_commit; trials (counted trials of every purpose, ledger-wide); multiple_testing (what a deflated "
        "Sharpe of the line's runs reads: line, dev_start, dev_end, instruments (those of the line's research "
        "trials), research_trials and all_purpose_trials (counted trials on one of those instruments whose trading "
        "window overlaps the line's, across market days and lines; all_purpose_trials adds precheck, explore "
        "and validation), sweep_variants (the variants assessed without a replay that the current search_exposure "
        "judgments of the line and of those trials' lines declare, the largest K along each supersession chain), "
        "trials_with_sweeps (all_purpose_trials + sweep_variants), runs_with_returns (the overlapping research runs with economic evidence and varying "
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
        "execution_identity {execution, image_digest, keys}, measures (each {value, sample_size, "
        "null_reason (only when null)}, its definition is in `replay report`: annual_return, "
        "mark_max_drawdown, sharpe_365, plan_win_rate, breakeven_fee_multiple, alpha_basket (with standard_error), "
        "beta_basket; alpha_basket and beta_basket with pnl_sum, their USDT split of the daily PnL sum), deflated_sharpe "
        "{effective_trials, trials_with_sweeps} (the run's deflated Sharpe at each multiple_testing count with its "
        "daily_sharpe_variance; null without that reading), worst_dev_year_return and return_without_best_year "
        "(replay report dev_years), worst_dev_quarter_return and return_without_best_quarter (dev_quarters, null as "
        "there), net_without_top_instrument (closed-cycle net PnL in USDT without top_instrument, the contract that "
        "contributes most in the direction of the total; both null for one contract or no closed cycle), all display only, dominated_by, non_dominated}] (dominance only within one "
        "identity and only on dominance_measures: annual_return, mark_max_drawdown, sharpe_365; the plan win rate, "
        "breakeven_fee_multiple, alpha_basket and beta_basket are shown only), candidates (those of the line's identity, which a "
        "recommendation names), without_economic_evidence; null without a line)",
        "LINE_UNKNOWN (--line); "
        "UNKNOWN_REF (--at)"), LEDGER,
         option("--line", help="research line name of the comparison table (default: the only open line)"), AT),
    command(research_state, "research", "state", "the line record and its current judgments", (
        "the line record, targets, judgments, trials and source reviews at --at (reader); whether the active "
        "market holds the line's market day (reader)",
        "nothing in the ledger; pulls the main runtime image each time, which moves the local "
        "`main` tag, to learn the current image (not with --without-image)",
        "ledger_commit, line, execution_identity (the line's), current_image (the main image's digest reference; null "
        "when it cannot be resolved or with --without-image), runs_behind_image (the line's passed runs not yet on it: `replay reproduce "
        "--image`; null without it), targets, open_lines "
        "[{name, start, dev_start, dev_end, market_day}], recommendation, priority (each judgment with its subjects, their null "
        "keys left out, and with --full their read-time facts), "
        "review_every, undistinguished_runs {trials, uncompared, distinguished} (the line's latest runs read back "
        "for a due change of approach, null without a line: trials leave candidate and control undistinguished, uncompared "
        "have no comparison and neither count nor clear, distinguished ended the reading; reported, not a gate; "
        "the Agent discounts runs a recorded change of approach answers (a priority judgment, research-round) and scale-only "
        "runs, which this list does not tell), interpretations, search_exposures, unreviewed_trials (of the line's execution identity), "
        "trials_on_line (a count: the line's trials of every identity), gates [{code, message, missing}] "
        "(INTERPRETATION_REQUIRED, REVIEW_DUE, MARKET_DAY_UNRESOLVED, "
        "RESEARCH_LINE_REQUIRED (no open line), LINE_AMBIGUOUS (several open lines, no --line): reported, not "
        "raised), judgment_history, earlier, facts (candidate list and research status, with --full), next_actions (the steps the gates call for: `line select`, --line, or each gate's repair; empty without a gate); line.ledger_commit is the commit "
        "read, not the "
        "line's own; large with --full",
        "LINE_UNKNOWN (--line is no research line); UNKNOWN_REF (--at); LEDGER_UNAVAILABLE, LEDGER_PERMISSION, "
        "SCHEMA_MISMATCH, MARKET_UNREACHABLE (a service undistinguished_runs' comparisons read is unreachable, "
        "refuses the account or holds another schema: the read refuses rather than list runs it never compared)"),
         LEDGER, option("--line", help="research line name (default: the only open line)"),
         option("--history", action="store_true",
                help="include up to 20 original judgments, newest first, including superseded text and subjects"),
         option("--history-before", type=int,
                help="include the next history page before this judgment ID (use next_before; implies --history)"),
         option("--full", action="store_true",
                help="every current interpretation and search exposure, the read-time facts of each current "
                     "judgment's subjects, and the candidate list and research status as facts (default: those "
                     "after the current recommendation, earlier ones counted, no facts)"),
         option("--without-image", action="store_true",
                help="pull no runtime image: current_image and runs_behind_image are null (the IDE's read)"),
         AT),
    command(research_runs, "research", "runs", "every research run with its measures, by one measure", (
        "trials, runs, candidates, lines, targets and every listed run's stored facts at --at (reader); the market's "
        "daily returns over each run's window (alpha_basket and beta_basket)",
        "nothing",
        "ledger_commit, line, by, runs_listed (before --limit), without_economic_evidence (a count), groups [{group, "
        "execution, image_digest, window_start, window_end, universe_rule}], lines [{line, "
        "targets {max_drawdown, annual_return, source} or null}], runs [{candidate, trial_id, group, lines (those "
        "the run belongs to), measures {annual_return, mark_max_drawdown, sharpe_365, sharpe_lo, "
        "plan_win_rate, cycles, daily_turnover, alpha_basket, beta_basket} (values as `replay report` derives them), "
        "alpha_basket_standard_error, null_reasons (only when a measure is null)}]. Every passed research run with economic evidence: of the open lines, or with --line "
        "that line's comparison table (`research status`). Ordered by trial ID, or by the one --by measure (drawdown "
        "ascending, the others descending, nulls last). A listing by one measure, not the comparison table, a "
        "recommendation or a score: runs of different groups differ in window, instruments, configuration or image, "
        "so their order is no comparison; the first value is the best of runs_listed runs, which no ledger-wide "
        "multiple-testing reading adjusts (a line's is `research status` multiple_testing); ordered by drawdown, runs "
        "that barely trade come first (read cycles). Targets are listed as stated, never compared with a run",
        "LINE_UNKNOWN (--line); UNKNOWN_REF (--at); LEDGER_CORRUPT"), LEDGER,
         option("--line", help="only that line's comparison table (default: the open lines' runs)"),
         option("--by", choices=RUN_MEASURES, help="order by this measure (default: by trial ID)"),
         option("--limit", type=_count, help="keep the first N runs (default: all)"), AT),
    command(research_history, "research", "history", "a line's closing history test, by year", (
        "the line's research and history trials, their runs, captures and stored facts, the source reviews and its "
        "targets at --at (reader); the market's first and latest complete days at its newest day (the segments the "
        "test plans), read only when there is a line to read",
        "nothing",
        "ledger_commit, short_days, lines [{line, closed, dev_start, dev_end, targets, participants, research_trials, "
        "rows [{source_sha256, candidate (ID@N), run, development (the research run's cell), cells [{trial_id, kind (veto, control, "
        "holdout or forward), label, trade_start, trade_end, status, whole_year, short, measures {annual_return, "
        "mark_max_drawdown, sharpe_365, cycles, plan_win_rate} (passed runs only), superseded (the segment's earlier "
        "history trials: an invalid run `line history` replayed again)}], control_reproduces, summary "
        "{veto {whole_years, profitable_years, median_annual_return, worst_annual_return, worst_mark_max_drawdown, "
        "years_meeting_targets, meets_targets}, holdout {annual_return, mark_max_drawdown, meets_targets, "
        "deflated_sharpe (at the participant count), deflated_sharpe_with_prior_trials (at the participants plus "
        "holdout_prior_trials, same variance; null without that count)}, meets_targets, judged_on (veto and holdout, holdout, or null), missing [veto YEAR, "
        "control, holdout or targets]} or null when the control does not reproduce}], discount {trials (the participants), trials_with_prior (plus holdout_prior_trials), holdouts_with_returns, daily_sharpe_variance (of "
        "their per-day holdout Sharpe ratios)}, holdout_prior_trials {trials, instruments, by_line [{line, purpose, "
        "trials}]} (the earlier searches of the holdout: counted trials of any purpose and line on the line's "
        "instruments whose trading window overlaps it, the line's own history trials left out; searches outside this "
        "ledger do not show; null before the line's first research trial), without_economic_evidence "
        "[{source_sha256, candidate, run, reasons}]}]. Rows by development-period Sharpe. A row is a candidate: a "
        "source with a passed research run on the line whose latest such run carries economic evidence now, as "
        "`research status` judges it; `participants` counts them. A source whose run does not (a failed source "
        "review, no real activity) is named in without_economic_evidence with the reasons and no reading, also "
        "when it lost the evidence after its history runs. "
        "deflated_sharpe is the holdout's "
        "deflated Sharpe at the participant count (the `research status` formula), null when it cannot be computed. The veto passes when every whole veto year's drawdown is "
        "at most the target and their median annual return at least the target; the holdout when its drawdown is at "
        "most the target and its annual return at least the target; meets_targets when both pass, or the holdout "
        "alone when the test has no whole veto year. whole_years counts every whole veto year replayed. The verdict "
        "needs every reading it is defined on: a veto year the test plans (one with something to trade on the "
        "market) without a history run yet, a whole veto year whose run is invalid or missing or lacks a reading, "
        "a part veto year without a passed run (a passed one is read in no summary), a control without a run, a holdout without a countable reading and a line without targets are named in "
        "missing, and with anything missing meets_targets and judged_on are null, whatever the holdout's own verdict. "
        "A falsification test, not "
        "out-of-sample validation; picking by it is a choice among `participants` candidates",
        "LINE_UNKNOWN; MARKET_DAY_UNRESOLVED (the market)"), LEDGER, MARKET,
         option("--line", help="one research line (default: every line with history trials)"), AT),
    command(research_unchanged, "research", "unchanged", "whether a line's graph is the same at two ledger commits", (
        "what changed between --since and --at, with the line's versions, trials, registrations and reviews (reader)",
        "nothing",
        "unchanged, reason (what reaches the line, or null), since, ledger_commit",
        "LINE_UNKNOWN (--line); UNKNOWN_REF (--at, --since)"),
         LEDGER, option("--line", required=True, help="research line name"),
         option("--since", required=True, help="the ledger commit of the graph held"), AT,
         epilog="From what changed between the commits, without drawing: any change it does not recognize answers "
                "false. Lets the IDE keep a graph it holds. Writes nothing."),
    command(research_counts, "research", "counts", "a line's trial counts, as `research graph` gives them", (
        "the line's research trials and every counted trial with its capture manifest at --at (reader)",
        "nothing",
        "trial_counts (research_trials, all_purpose_trials, sweep_variants, trials_with_sweeps, "
        "as `research graph` gives them; null before the line's "
        "first research trial), ledger_commit",
        "LINE_UNKNOWN (--line); UNKNOWN_REF (--at); LEDGER_CORRUPT"), LEDGER,
         option("--line", required=True, help="research line name"), AT,
         epilog="They cover the whole ledger's trials on the line's contracts, so they move with trials the rest of "
                "the graph never reads. Lets the IDE keep a graph it holds and still show them. Writes nothing."),
    command(research_multiple_testing, "research", "multiple-testing",
            "a line's multiple-testing reading and its runs' deflated Sharpe ranges, as `research status` gives them", (
        "every counted trial with its capture manifest, the overlapping research runs' daily returns and the line's "
        "passed research runs at --at (reader)",
        "nothing",
        "ledger_commit; multiple_testing (as `research status`; null before the line's first research trial); "
        "deflated_sharpe (by trial ID, each of the line's passed research runs with economic evidence: "
        "{effective_trials, trials_with_sweeps}, null before the line's first research trial)",
        "LINE_UNKNOWN (--line); UNKNOWN_REF (--at); LEDGER_CORRUPT"), LEDGER,
         option("--line", required=True, help="research line name"), AT,
         epilog="Without the comparison table and the market read behind it: lets the IDE show them beside a run. "
                "Writes nothing."),
    command(research_graph, "research", "graph", "the line as a research-graph@4 document, read from the ledger only", (
        "the line, its candidates (full sources), trials, reviews and judgments at --at (reader); market daily "
        "returns inside the comparisons",
        "nothing",
        "format (research-graph@4), source, scope {ledger_commit, start, end}, line (with gates [{code, message}], "
        "the gates `research state` reads before the next registration), candidates [{id, parent, "
        "source, trials, comparison, reviews, status, ...}], events, gaps; large (every candidate's source)",
        "RESEARCH_LINE_REQUIRED (no open line); LINE_AMBIGUOUS (several open lines and no --line); "
        "LINE_UNKNOWN (--line); UNKNOWN_REF (--at, --since); "
        "MARKET_UNREACHABLE (other comparison refusals only leave a comparison null)"),
         LEDGER, option("--line", help="research line name (default: the only open line)"),
         option("--since", help="ledger commit where the scope under study starts"),
         option("--workers", type=_count, default=min(8, os.cpu_count() or 1),
                help="processes computing the comparisons (default: 8 or the CPU count if fewer; 1 runs "
                     "them in this process); the graph is the same"),
         option("--without-comparisons", action="store_true",
                help="leave every version's comparison null and skip their bootstraps; the rest of the graph "
                     "is the same (`research comparison` gives one version's)"),
         option("--without-counts", action="store_true",
                help="leave the line's trial_counts null and skip reading them, with their refusals; the rest "
                     "of the graph is the same (`research counts` gives them, and a caller must read them)"),
         AT,
         epilog="Composes the product's readers and adds no rule, so one ledger commit gives one graph. The targets "
                "are the ones in force for the line at that commit (`line targets`); --since marks where the scope "
                "under study starts. Check, render and compare it with ide/ide.py. Writes nothing."),
    command(research_comparison, "research", "comparison", "one version's comparison, as `research graph` gives it", (
        "one registered run, its control and their source reviews at --at (reader); market daily returns",
        "nothing",
        "comparison: the object `research graph` gives that version, or null when it has none",
        "UNKNOWN_REF (--at); MARKET_UNREACHABLE (other comparison refusals give comparison null)"),
         LEDGER, option("--registration", type=int, required=True, help="the research registration ID"),
         option("--trial-id", type=int, required=True, help="the registered run"), AT,
         epilog="Names the version by its registration and its last research run. Writes nothing."),
    command(source_review, "source", "review", "record an independent source review of a precheck", (
        "the candidate and the precheck trial at the head (reader); the runtime image, resolved to its digest; "
        "--items (JSON) and the precheck's original capture (writer)",
        "one source_review row (the verdict, items and reviewer); the same content again is a replay",
        "review_id, candidate, source_sha256, image_digest, precheck_trial, verdict, ledger_commit, replayed",
        "PRECHECK_NOT_FOUND (the trial is no precheck of this source on this image); REVIEW_INVALID (unknown or "
        "missing items; each needs {status: passed|failed|unresolved, note}; passed only when every "
        "item passed); RUNTIME_UNRESOLVED; UNKNOWN_CANDIDATE, BAD_REF; "
        "PRECHECK_CAPTURE_MISSING"), LEDGER, CANDIDATE,
         option("--runtime", required=True, help=RUNTIME_HELP + "; the precheck's image"),
         option("--trial-id", required=True, type=int, help="the precheck trial reviewed"),
         option("--verdict", required=True, choices=("passed", "failed"), help="passed or failed"),
         option("--items", required=True, help="JSON file with api, causal, activity and readiness"),
         option("--reviewer", required=True, help="the reviewer's name, not the author's"),
         epilog="Records the review in the ledger. A failed review removes economic evidence from every run of the "
                "same source and image, including runs sealed before it; their reports then give the reason instead "
                "of measures."),
    command(validation_registration, "validation", "registration", "register one out-of-sample validation", (
        "--design (JSON); the candidate (writer, head); --market-day in the market (reader)",
        "one validation_registration row; then sends the commit hash's SHA-256 to the RFC 3161 authority and "
        "records a verified token as a second commit (a failed witness keeps the registration and reports "
        "witness.status failed)",
        "registration_id, candidate, window, registered_at, ledger_commit, witness {status, stamped_at, error}, "
        "replayed, next_actions",
        "DESIGN_INVALID; WINDOW_INVALID; REGISTRATION_TOO_LATE (--window-start not after now; retries exempt); "
        "CANDIDATE_UNKNOWN; CANDIDATE_FALSIFIED (its line's closing history test judged it not meeting the "
        "targets); HISTORY_UNDECIDED (no history test of it, or one that has not decided it: missing names what it "
        "lacks); MARKET_DAY_UNRESOLVED; RETRY_NOT_ALLOWED; OP_ID_CONFLICT; the universe rule is "
        "checked only when a replay binds the registration"), LEDGER,
         MARKET, CANDIDATE, option("--window-start", required=True, help="UTC time, YYYY-MM-DDTHH:MM:SSZ"),
         option("--window-end", required=True, help="UTC time, YYYY-MM-DDTHH:MM:SSZ"),
         option("--universe-rule", required=True, help="the market day's universe rule"), MARKET_DAY,
         option("--design", required=True, help="JSON file of the validation design"),
         option("--retry-of", type=int,
                help="a bound interrupted, invalid or economically unavailable registration; keep its "
                     "candidate, window, universe rule and original test design"),
         OP_ID,
         option("--tsa-url", help="the only RFC 3161 timestamp authority to ask (default: DigiCert, "
                                  "then Sectigo when DigiCert grants no token)"),
         epilog="Records the user's candidate, window and universe rule and requests an RFC 3161 timestamp; ledger "
                "witness retries a missing one. replay run --validation runs it once. Binding derives account terms "
                "from research sealed at the original registration commit; later research and retry registrations "
                "cannot replace that baseline."),
    command(validation_report, "validation", "report", "the out-of-sample report of a registration", (
        "the registration, its witness, binding and run at --at (reader), and the registrations of the same "
        "window and universe rule; market daily returns (a failure only empties the market measures)",
        "nothing",
        "registration_id, ledger_commit, product_commit, registration, witness, binding, window_read_before_binding "
        "(trials of any source trading inside the window, made after the original registration and before the "
        "binding), availability, metrics, single, family {size, provisional, missing_p, members [{registration_id "
        "(an original registration: a retry is no member of its own), latest_attempt (whose p it takes), "
        "p_one_sided, p_holm, ...}]}, "
        "same_candidate_registrations, limitations (UNWITNESSED, UNBOUND, UNFINISHED, NO_SINGLE_TEST, "
        "FAMILY_PROVISIONAL)",
        "REGISTRATION_UNKNOWN; LEDGER_CORRUPT (the binding names a missing trial); UNKNOWN_REF (--at)"), LEDGER,
         option("--validation", required=True, type=int, help="validation registration ID"), AT,
         epilog="The same measures and masking as development reports, with intervals, p and the Holm correction "
                "over the window's registrations; no verdict."),
]
