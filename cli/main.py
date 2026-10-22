"""The product command line (`cli.main`): noun verb subcommands that print JSON; each command's
--help states its contract.

    uv run --frozen python -m cli.main <noun> <verb> [options] [-- runner arguments]

A ledger is named by `--ledger`: a profile file path, or a profile name in the ledger profile
directory (`TRADE_LEDGER_HOME`, default ~/.local/share/trade/ledgers); without it, the active
research ledger. A market database is named by `--market` the same way; without it, the active
market profile in the profile directory. Runner arguments (window and instrument scope) follow `--`.
"""

from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import hashlib
from importlib.resources import files
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sys
import tempfile
import textwrap
from typing import Literal

import pymysql

from ledger import admin, db, evidence, execution, judgments, lines, paths, strategies, witness
from ledger.errors import Refusal, refusal
from ledger.refusals import CATALOGUE, refuse


TEMPLATES = files("cli").joinpath("templates")
WORKDIR_TEMPLATE, HEADER_TEMPLATE = "workdir-agents.md", "strategy-header.md"
# `ledger sql` statement kinds: reads only. The reader account on a pinned revision database is the
# write boundary; this first-word check keeps statements such as SET PERSIST, which any account may
# run on Dolt 2.4.2, off the reader path, and nothing inside a read is scanned for keywords.
READ_FIRST = ("SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH", "TABLE", "VALUES")


# Output

class UsageError(Exception):
    pass


def _jsonable(value):
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_jsonable(item) for item in value]
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"bytes": len(value)}
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, float) and value != value:
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _print(stream, value) -> None:
    stream.write(json.dumps(_jsonable(value), ensure_ascii=False, indent=2, sort_keys=False) + "\n")
    stream.flush()


def refusal_json(exc: Refusal) -> dict:
    """The printed form of a refusal: its fields and its catalogue repair commands."""
    value = exc.as_dict()
    value["next_actions"] = list(exc.next_actions) or list(CATALOGUE.get(exc.code, ("", ()))[1])
    return value


def _market_refusal(exc) -> Refusal:
    """A market package refusal (market.sources.MarketError) as a ledger refusal, its repair commands
    from the catalogue."""
    return refusal(exc.code, exc.message, missing=exc.missing, write_status="not_written",
                   next_actions=tuple(CATALOGUE[exc.code][1]))


# Profiles

def _read_profile_file(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise refuse("LEDGER_UNKNOWN", f"{path} is not a readable profile file", missing=(str(path),)) from exc
    if not isinstance(value, dict):
        raise refuse("LEDGER_UNKNOWN", f"{path} is not a profile", missing=(str(path),))
    return value


def _is_path(value: str) -> bool:
    return "/" in value or value.endswith(".json")


def ledger_profile(value: str | None) -> db.LedgerProfile:
    """The research ledger a command names: a profile file, a profile name, or the active one."""
    from report import runs
    if value is not None and _is_path(value):
        try:
            return db.LedgerProfile.from_json(_read_profile_file(Path(value).expanduser()))
        except (KeyError, TypeError) as exc:
            raise refuse("LEDGER_UNKNOWN", f"{value} is not a ledger profile", missing=(value,)) from exc
    return runs.profile_of(value)


def _active_market_profile() -> dict:
    for path in sorted(db.home().glob("*.json")) if db.home().is_dir() else ():
        try:
            candidate = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if (isinstance(candidate, dict) and "market" in (candidate.get("kind"), candidate.get("holds"))
                and candidate.get("role", candidate.get("kind")) == "active"):
            return candidate
    raise refuse("LEDGER_UNKNOWN", "no active market profile in the ledger profile directory", missing=("--market",))


def market_profile(value: str | None) -> dict:
    """The market database a command names: a profile file, a profile name, or the active one in the
    profile directory."""
    if value is not None and _is_path(value):
        found = _read_profile_file(Path(value).expanduser())
    elif value is not None:
        found = _read_profile_file(db.home() / f"{value}.json")
    else:
        found = _active_market_profile()
    if "market" not in (found.get("kind"), found.get("holds")) or not found.get("database"):
        raise refuse("LEDGER_KIND", f"profile {found.get('name')!r} is not a market database", missing=("--market",))
    return found


def _market_facts(profile: dict) -> Callable[[str, str], dict]:
    """market.resolve_commit and market.freshness for ledger.select_line."""
    from market import store

    def facts(market_database: str, market_at: str) -> dict:
        if market_database != profile["database"]:
            raise refuse("MARKET_COMMIT_UNRESOLVED", f"{market_database} is not the market profile's database",
                         missing=(market_database,))
        try:
            return store.freshness(profile, market_at)
        except store.MarketError as exc:
            raise _market_refusal(exc) from exc
    return facts


# Small argument helpers

def _regular_file(path: str, code: str = "SOURCE_UNREADABLE") -> bytes:
    found = Path(path)
    try:
        if found.is_symlink() or not found.is_file():
            raise OSError("not a regular file")
        return found.read_bytes()
    except OSError as exc:
        raise refuse(code, f"{path} is not a readable regular file", missing=(str(path),)) from exc


def _json_file(path: str, code: str) -> dict:
    data = _regular_file(path, code)
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise refuse(code, f"{path} is not UTF-8 JSON", missing=(str(path),)) from exc
    if not isinstance(value, dict):
        raise refuse(code, f"{path} is not a JSON object", missing=(str(path),))
    return value


def _utc_day(text: str) -> date:
    if not isinstance(text, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise refuse("WINDOW_INVALID", f"{text!r} is not a YYYY-MM-DD UTC day", expected="YYYY-MM-DD")
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise refuse("WINDOW_INVALID", f"{text!r} is not a calendar day", expected="YYYY-MM-DD") from exc


def _utc_time(text: str) -> datetime:
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise refuse("WINDOW_INVALID", f"{text!r} is not an ISO-8601 time", expected="UTC as YYYY-MM-DDTHH:MM:SSZ") from exc
    if moment.utcoffset() != timedelta(0):
        raise refuse("WINDOW_INVALID", f"{text!r} is not a UTC time", expected="UTC as YYYY-MM-DDTHH:MM:SSZ")
    return moment


def _new_temporary(path: str) -> Path:
    return paths.temporary_path(path, require_new=True)


# ledger

Kind = Literal["active", "isolated", "temporary"]  # db.KINDS, the --kind choices


def ledger_init(name: str, kind: Kind, service_root: Path, research_branch: str = "main",
                backup_root: Path | None = None) -> dict:
    """ledger init: a new research ledger profile (database = the profile name with - as _), its
    accounts, branch grant and commit verification group; administration happens only here."""
    from report import review
    database = name.replace("-", "_") if isinstance(name, str) else name
    created = db.init(name, database, Path(service_root), kind, research_branch, backup_root)
    profile = created["profile"]
    with db.read_as_of(profile) as conn:
        version = conn.rows("SELECT version FROM ledger_schema WHERE singleton = 1")
        head = conn.rows("SELECT seq, op_id FROM ledger_head WHERE singleton = 1")
        tests = {name for (name,) in conn.rows("SELECT test_name FROM dolt_tests")}
        commit = conn.resolved_commit
    if version != [(db.SCHEMA_VERSION,)] or [tuple(row) for row in head] != [(0, "schema")] or tests != set(
            review.product_commit_tests()):
        raise refuse("LEDGER_CORRUPT", f"ledger {name} does not read back as initialized", missing=(name,))
    accounts = (db._service(profile.service_root) or {}).get("databases", {}).get(profile.database, {})
    return {"profile": str(db.home() / f"{name}.json"), "name": name, "database": profile.database,
            "kind": profile.kind, "service_root": str(profile.service_root),
            "accounts": {role: accounts.get(role, {}).get("user") for role in db.ROLES},
            "branch_grant": created["branch_grant"], "schema_version": created["schema_version"],
            "ledger_commit": commit}


def ledger_service(profile: db.LedgerProfile, action: str) -> dict:
    """ledger service start | stop | status."""
    config = db._service(profile.service_root)
    if action == "stop":
        if config is None:
            return {"action": action, "running": False}
        return {"action": action, "running": db.stop_service(profile.service_root)["running"]}
    if action == "start" and (config is None or profile.database not in config.get("databases", {})):
        raise refuse("LEDGER_NOT_INITIALIZED", f"{profile.service_root} holds no initialized ledger {profile.database}",
                     missing=(profile.database,))
    if action == "start":
        started = db.start_service(profile.service_root)
        try:
            with db.read_as_of(profile) as conn:
                commit = conn.resolved_commit
        except Refusal as exc:
            db.stop_service(profile.service_root)
            raise refuse("SERVICE_START_FAILED", f"the service started but the ledger is not readable ({exc.code})",
                         missing=(profile.database,)) from exc
        return {"action": action, "running": True, "pid": started.get("pid"), "address": (config or {}).get("socket"),
                "branch": profile.research_branch, "ledger_commit": commit}
    try:
        with db.read_as_of(profile) as conn:
            commit = conn.resolved_commit
    except Refusal:
        return {"action": action, "running": False, "address": (config or {}).get("socket")}
    return {"action": action, "running": True, "pid": db._pid(profile.service_root),
            "address": (config or {}).get("socket"), "branch": profile.research_branch, "ledger_commit": commit}


def ledger_temp(root: str | None) -> dict:
    """ledger temp: an isolated temporary ledger under the temporary root, with its own profile file,
    database name, port and service; later commands name it with --ledger <profile>."""
    token = secrets.token_hex(4)
    given = Path(root) if root else Path(tempfile.gettempdir()) / f"ledger-{token}"
    root_path = paths.temporary_path(given, require_new=True)
    name = f"temp-{token}"
    root_path.mkdir(mode=0o700, parents=True)
    previous = os.environ.get("TRADE_LEDGER_HOME")
    os.environ["TRADE_LEDGER_HOME"] = str(root_path)  # the profile file is written into the new root
    try:
        created = ledger_init(name, "temporary", root_path / "s")
    except BaseException:
        if (root_path / "s" / "service.json").exists():
            db.stop_service(root_path / "s")
        shutil.rmtree(root_path, ignore_errors=True)
        raise
    finally:
        if previous is None:
            os.environ.pop("TRADE_LEDGER_HOME", None)
        else:
            os.environ["TRADE_LEDGER_HOME"] = previous
    profile = ledger_profile(created["profile"])
    status = ledger_service(profile, "status")
    return {"profile": created["profile"], "root": str(root_path), "address": status.get("address"),
            "accounts": created["accounts"], "ledger_commit": status.get("ledger_commit") or created["ledger_commit"]}


def _statement_words(query: str) -> tuple[str, list[str]]:
    stripped = re.sub(r"'(?:[^'\\]|\\.|'')*'|\"(?:[^\"\\]|\\.)*\"|`[^`]*`", " ", query)
    stripped = re.sub(r"--[^\n]*|#[^\n]*|/\*.*?\*/", " ", stripped, flags=re.S)
    return stripped, re.findall(r"[A-Za-z_]+", stripped.upper())


def ledger_sql(profile: db.LedgerProfile, query: str, at: str | None) -> dict:
    """ledger sql: one read statement with the reader account, pinned to an exact version."""
    stripped, words = _statement_words(query or "")
    body = stripped.strip().rstrip(";").strip()
    if not words or words[0] not in READ_FIRST or ";" in body:
        raise refuse("WRITE_VIA_SQL", "only one " + ", ".join(READ_FIRST) + " statement is accepted",
                     expected="a single read statement")
    with db.read_as_of(profile, at) as conn:
        if words[0] == "EXPLAIN":
            # Dolt 2.4.2 sends some unavailable plan estimates as literal NULL in numeric fields.
            # Scope the compatibility decoding to this read connection's EXPLAIN result.
            conn.raw.decoders = {
                kind: (lambda value, convert=convert: None if value == "NULL" else convert(value))
                if convert in (int, float, Decimal) else convert
                for kind, convert in conn.raw.decoders.items()}
        with conn.raw.cursor() as cursor:
            try:
                cursor.execute(query.strip().rstrip(";"))
            except pymysql.MySQLError as exc:
                raise db._sql_error(exc, statement=True) from exc
            columns = [column[0] for column in cursor.description or ()]
            found = [list(row) for row in cursor.fetchall()]
        return {"at": at, "ledger_commit": conn.resolved_commit, "columns": columns, "rows": found}


def ledger_witness(conn: db.LedgerConnection, tsa_url: str | None) -> dict:
    """ledger witness: timestamp every out-of-sample registration commit that has none yet."""
    synced = witness.sync_witness(conn, tsa_url)
    registrations: dict[str, list[int]] = {}
    for commit, registration_id in conn.rows("SELECT to_commit, to_registration_id FROM dolt_diff_validation_registration "
                                             "WHERE diff_type = 'added'"):
        registrations.setdefault(commit, []).append(registration_id)
    return {"checked": len(synced["witnessed"]) + synced["already"] + len(synced["failed"]),
            "already": synced["already"],
            "witnessed": [{"commit": commit, "registration_ids": registrations.get(commit, []),
                           "stamped_at": witness.stamped_at(conn, commit)} for commit in synced["witnessed"]],
            "failed": [{**item, "registration_ids": registrations.get(item["commit"], [])} for item in synced["failed"]]}


def ledger_review(conn: db.LedgerConnection, at: str | None) -> dict:
    """ledger review: the whole review at one exact version; findings only."""
    from report import review
    return review.review_all(conn, at)


def ledger_export(profile: db.LedgerProfile, kind: str, output: str | None, at: str | None,
                  trial_ids: list[int] | None) -> dict:
    """ledger export: the full-history backup and reproduction manifest into a new directory
    (reproduce), or the incremental backup sync to the profile's backup directory (backup)."""
    if kind == "reproduce":
        if not output:
            raise UsageError("ledger export --kind reproduce needs --output")
        target = Path(output).expanduser().absolute()
        if os.path.lexists(target):
            raise refuse("PATH_EXISTS", f"{target} already exists", missing=(str(target),))
    else:
        if profile.backup_root is None:
            raise refuse("BACKUP_TARGET_UNSET", f"profile {profile.name} declares no backup directory",
                         missing=("backup",))
        target = Path(profile.backup_root)
    created = not target.exists()
    exported = admin.export_history(profile, target, at, trial_ids, with_backup=True)
    manifest = Path(exported["manifest_path"])
    if hashlib.sha256(manifest.read_bytes()).hexdigest() != exported["content_hash"]:
        if created:
            shutil.rmtree(target, ignore_errors=True)
        raise refuse("EXPORT_MISMATCH", f"{manifest} does not reread to the exported content hash",
                     missing=(str(manifest),))
    return {"kind": kind, "ledger_commit": exported["commit"], "target": str(target),
            "backup_path": exported["backup_path"], "manifest_path": str(manifest),
            "content_hash": exported["content_hash"], "runs": exported["runs"], "candidates": exported["candidates"]}


# candidate

def _workdir_notes(directory: Path, candidate: str) -> dict:
    """AGENTS.md (the packaged workdir template with the candidate filled in) and strategy-header.md
    (its file header template, verbatim) beside a working copy; a template not present is reported."""
    written, missing = [], []
    for name, target in ((WORKDIR_TEMPLATE, "AGENTS.md"), (HEADER_TEMPLATE, HEADER_TEMPLATE)):
        source = TEMPLATES.joinpath(name)
        if not source.is_file():
            missing.append(f"cli/templates/{name}")
            continue
        text = source.read_text(encoding="utf-8")
        if name == WORKDIR_TEMPLATE:
            text = text.replace("<strategy_id@revision>", candidate)
        (directory / target).write_text(text, encoding="utf-8")
        written.append(target)
    return {"notes": written, "missing_templates": missing}


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


def _candidate_record(row: Mapping, commit: str) -> dict:
    parent = f"{row['parent_strategy_id']}@{row['parent_revision']}" if row.get("parent_strategy_id") else None
    return {"candidate": f"{row['strategy_id']}@{row['revision']}", "strategy_id": row["strategy_id"],
            "revision": row["revision"], "source_sha256": row["source_sha256"], "entry_class": row["entry_class"],
            "runtime_contract": row["runtime_contract"], "description": row["description"], "parent": parent,
            "difference": row["difference"], "created_at": row["created_at"], "ledger_commit": commit}


def candidate_show(profile: db.LedgerProfile, candidate: str, at: str | None) -> dict:
    """candidate show: the candidate record at a ledger version, without its source bytes."""
    strategies.parse_ref(candidate)
    with db.read_as_of(profile, at) as conn:
        return _candidate_record(strategies.read_candidate(conn, candidate), conn.resolved_commit)


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
            "bytes": len(row["source"]), "ledger_commit": commit, **_workdir_notes(target.parent, candidate)}


STRATEGY_STUB = '''{header}
from decimal import Decimal

from nautilus_trader.config import StrategyConfig
from nautilus_trader.trading import Strategy


class {entry_class}(Strategy):
    """The one entry class. Decide only on closed bars; read trading facts (orders, fills,
    positions, account) from the engine's state, never from counters of your own."""

    def __init__(self, instrument_id, daily_bar_type, *, trade_start_ns, historical_daily_bars,
                 execution_bar_minutes, strategy_id, universe_membership):
        super().__init__(StrategyConfig(strategy_id=strategy_id))
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
        increment and the venue rejects an order below the minimums."""
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
    header_template = TEMPLATES.joinpath(HEADER_TEMPLATE)
    header = header_template.read_text(encoding="utf-8") if header_template.is_file() else ""
    header = '"""' + (header.replace('"""', "'''").strip() or f"{strategy_id}: the file header goes here.") + '\n"""'
    directory.mkdir(mode=0o700, parents=True)
    (directory / "strategy.py").write_text(STRATEGY_STUB.format(header=header, entry_class=entry_class),
                                           encoding="utf-8")
    notes = _workdir_notes(directory, f"{strategy_id}@<revision>")
    return {"output": str(directory), "files": ["strategy.py", *notes["notes"]],
            "missing_templates": notes["missing_templates"]}


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


def _subject(text: str) -> dict:
    found = {}
    for part in text.split(","):
        key, sep, value = part.partition("=")
        if not sep or not key.strip():
            raise UsageError(f"--subject {text!r} is not role=…,candidate=ID@N|trial=N|registration=BUNDLE")
        found[key.strip()] = value.strip()
    subject: dict[str, str | int | None] = {"role": found.pop("role", None)}
    for key, target in (("candidate", "candidate"), ("trial", "trial_id"), ("registration", "registration_bundle")):
        if key in found:
            value = found.pop(key)
            if target == "trial_id" and not value.isdigit():
                raise UsageError(f"--subject trial={value!r} is not a trial ID")
            subject[target] = int(value) if target == "trial_id" else value
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
                                  compared=lambda line_bundle, at: status.compared_candidates(profile, line_bundle, at))


def line_select(conn: db.LedgerConnection, market: dict, start: str, window_start: str, window_end: str,
                market_at: str | None, note: str | None, slug: str) -> dict:
    """line select: the user's research line (start candidate, development window, pinned market commit)."""
    from qualification import availability
    first, last = _utc_day(window_start), _utc_day(window_end)
    selected = lines.select_line(conn, market["database"], market_at or "main", first, last, start, note, slug=slug,
                                 market=_market_facts(market), reviews=availability.review_records)
    return {"bundle": selected["bundle"], "start": start,
            "window": {"start": first.isoformat(), "end": last.isoformat()},
            "market_commit": selected["market_commit"], "universe_rule": selected["universe_rule"],
            "content_sha256": selected["content_sha256"], "created": selected["created"]}


# registration, hypothesis

def registration_add(profile: db.LedgerProfile, bundle: str, body: str, runtime: str | None, market: dict,
                     runner_argv: list[str], source: list[str]) -> dict:
    """registration add: lock the registration body, test conditions, grid and execution identity."""
    from registration import register
    plan = _json_file(body, "REGISTRATION_INVALID")
    registered = register.register(profile, bundle, plan, runtime, market, list(runner_argv),
                                   [Path(item) for item in source or ()])
    with db.read_as_of(profile) as conn:
        files = evidence.load_bundle(conn, bundle)["digests"]
    return {"bundle": registered["bundle"], "content_hash": registered["sha256"], "grid_points": len(plan["grid"]),
            "execution": registered["execution"], "files": [{"name": name, "sha256": digest}
                                                           for name, digest in sorted(files.items())],
            "ledger_commit": registered["ledger_commit"], "replayed": registered["replayed"]}


def hypothesis_compare(profile: db.LedgerProfile, bundle: str, trial_id: int, at: str | None) -> dict:
    """hypothesis compare: the comparison report of a grid run with its registered control (report.compare)."""
    from report import comparison
    return comparison.compare(profile, bundle, trial_id, at)


# research, source review

def research_status(profile: db.LedgerProfile, at: str | None, line: str | None) -> dict:
    from report import status
    return status.research_status(profile, at, line)


def research_state(conn: db.LedgerConnection, line: str | None, at: str | None, *,
                   history: bool = False, history_before: int | None = None) -> dict:
    from report import status
    return status.research_state(conn, line, at, history=history, history_before=history_before)


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
    return {"bundle": recorded["bundle"], "candidate": candidate, "source_sha256": recorded["source_sha256"],
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


# replay

def replay_explore(profile, market, at, strategy_file, strategy_class, output, runtime, runner_argv) -> dict:
    from replay import entry
    found = entry.explore(profile, market, at, Path(strategy_file), strategy_class, Path(output), runtime,
                          list(runner_argv))
    found["metrics_note"] = "source unverified: for orientation only, never evidence"
    found["next_actions"] = ["This source is now exposed by an exploration; derive and publish a new candidate to "
                             "register."]
    return found


def replay_precheck(profile, market, at, candidate, runtime, runner_argv, output) -> dict:
    from replay import entry
    return entry.precheck(profile, market, at, candidate, runtime, list(runner_argv), Path(output))


def replay_run(profile, market, at, candidate, runtime, runner_argv, hypothesis, validation) -> dict:
    from replay import entry
    if (hypothesis is None) == (validation is None):
        raise refuse("REGISTRATION_REQUIRED", "give exactly one of --hypothesis or --validation",
                     expected="--hypothesis registration-<name> xor --validation <id>")
    ran = entry.run(profile, market, at, candidate, runtime, list(runner_argv), hypothesis, validation)
    with db.read_as_of(profile) as conn:
        commit = conn.resolved_commit
    return {**ran, "ledger_commit": commit}


def replay_report(profile, trial_id: int | None, directory: str | None, at: str | None, tables: bool,
                  reproduction: str | None, reproduction_trial: int | None, account: bool, exposures: bool) -> dict:
    """replay report: a sealed run's report (with --tables its drill-down tables, native ones from a
    verified reproduction), or an unsealed directory's report marked unverified."""
    from report import runs
    if directory is not None and trial_id is None:
        if not Path(directory).is_dir():
            raise refuse("DIRECTORY_NOT_FOUND", f"{directory} is not a directory", missing=(directory,))
        return {"source": "directory", **runs.directory_report(Path(directory), account=account)}
    if trial_id is None:
        raise UsageError("give --trial-id or --directory")
    with db.read_as_of(profile, at) as conn:
        trial = conn.one("SELECT purpose FROM trial WHERE trial_id = %s", (trial_id,))
    if trial is not None and trial["purpose"] == "precheck":
        if directory and reproduction:
            raise UsageError("give either --directory (original cache) or --reproduction (regenerated cache)")
        cache_directory = directory or reproduction
        return {"source": "precheck", **runs.precheck_report(
            profile, trial_id, at, directory=Path(cache_directory) if cache_directory else None,
            reproduction=reproduction_trial, account=account, exposures=exposures)}
    if directory is not None:
        raise UsageError("--directory with --trial-id reads an original precheck cache; use --reproduction for a run")
    found = {"source": "sealed", **runs.run_report(profile, trial_id, at)}
    if tables or exposures or account or reproduction:
        found["tables"] = runs.tables(trial_id, profile, at, account=account, exposures=exposures,
                                      directory=Path(reproduction) if reproduction else None,
                                      reproduction=reproduction_trial)
    return found


# market

def market_init(name: str, kind: Kind, service_root: Path, backup_root: Path | None = None) -> dict:
    """market init: an empty market database (tables, import and reader accounts, profile with its
    backup directory, required for the active one); the first `market import` writes its schema row
    and commit tests. Administration happens only here and in `market backup`."""
    database = name.replace("-", "_") if isinstance(name, str) else name
    return db.init_market(name, database, Path(service_root), kind, backup_root)


def market_backup(market: dict) -> dict:
    """market backup: the incremental dolt_backup sync of the market database to its profile's backup
    directory (ledger.market_backup)."""
    return admin.market_backup(market)


def market_review(market: dict) -> dict:
    """market review: whether the latest market backup's head is still an ancestor of main; findings only."""
    from report import review
    return review.market_review(market)


def market_import(market: dict, month: str, cache_root: str | None, workers: int,
                  symbols: list[str] | None = None) -> dict:
    """market import: one UTC month of Binance public data as one market commit; `symbols` is the
    engineering allowlist of an isolated market database."""
    from market import store
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-\d{2}", month):
        raise refuse("MONTH_INVALID", f"{month!r} is not YYYY-MM", expected="YYYY-MM")
    try:
        first = date.fromisoformat(month + "-01")
    except ValueError as exc:
        raise refuse("MONTH_INVALID", f"{month!r} is not a month", expected="YYYY-MM") from exc
    if first > datetime.now(timezone.utc).date():
        raise refuse("MONTH_INVALID", f"{month} is after the current UTC month", expected="YYYY-MM")
    return store.import_month(market, first, Path(cache_root) if cache_root else store.default_cache(), workers,
                              symbols, log=lambda line: print(line, file=sys.stderr, flush=True))


def market_lifecycle(profile: db.LedgerProfile, market: dict, at: str | None, manifest: str, notices: list[str],
                     op: str | None) -> dict:
    """market lifecycle: the lifecycle evidence bundle lifecycle-<commit> of a market commit, from its
    manifest and the exchange notices it cites (registration.record_lifecycle)."""
    from registration import inputs
    return inputs.record_lifecycle(profile, market, at, Path(manifest), [Path(item) for item in notices or ()], op)


def market_coverage(market: dict, at: str | None, symbols: list[str] | None, start: str, end: str,
                    ledger: str | None, lifecycle_bundle: str | None) -> dict:
    """market coverage: per-contract coverage facts at a market commit, with lifecycle receipts."""
    from market import coverage, store
    from registration import inputs, seams
    lifecycle = None
    if lifecycle_bundle is not None:
        if ledger is None:
            raise UsageError("--lifecycle-bundle needs --ledger")
        with store.connect(market, "reader") as conn:
            commit = store.resolve_commit(conn, at)
        _, files = inputs.load_lifecycle(ledger_profile(ledger), lifecycle_bundle, commit,
                                         market=seams.current.market(market))
        lifecycle = (json.loads(files[inputs.LIFECYCLE].decode("utf-8")), files)
    expanded = symbols is None
    if symbols is None:
        symbols = coverage.universe_members(market, at, start, end)
    found = coverage.diagnose_coverage(market, at, list(symbols), start, end, lifecycle)
    found["scope"] = {"symbols": list(symbols), "start": start, "end": end, "expanded": expanded}
    return found


# The dispatch table

class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise UsageError(message)


def _ledger_option(parser, required: bool = False) -> None:
    parser.add_argument("--ledger", required=required, help="ledger profile file or name (default: the active ledger)")


def _market_option(parser) -> None:
    parser.add_argument("--market", help="market profile file or name (default: the active market profile in "
                                         "the profile directory)")


def _at(parser, what: str = "ledger") -> None:
    parser.add_argument("--at", help=f"{what} commit, tag or branch (default: the head)")


def _op_id(parser) -> None:
    parser.add_argument("--op-id", help="operation ID; the same ID and content again is a replay (default: derived "
                                        "from the content)")


CANDIDATE_HELP = "candidate as ID@N (strategy ID and revision)"
RUNTIME_HELP = "runtime image tag or digest; a tag resolves to its digest"
RUNTIME_DEFAULT_HELP = RUNTIME_HELP + " (default: the main tag)"
RUNNER_EPILOG = """runner arguments after -- (engine/README.md):
  --symbols SYMBOL ... | --universe pool   Binance symbols such as BTCUSDT, or every universe member
  --start T --trade-start T --end T        UTC ISO-8601 with Z on the minute grid, start <= trade-start < end;
                                           --trade-start defaults to --start
  --lifecycle-bundle lifecycle-<commit>    optional lifecycle bundle of the market commit"""
COVERAGE_EPILOG = """Facts only: it judges no contract, window or line.
output keys: commit, scope, input_interval_ms, coverage (per contract), lifecycle,
lifecycle_missing, interpretation; coverage[].funding.event_times_ms is most of the output"""


def _parser() -> Parser:
    parser = Parser(prog="python -m cli.main", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    nouns = parser.add_subparsers(dest="noun", required=True, parser_class=Parser)

    def verbs(name: str, help_text: str):
        noun = nouns.add_parser(name, help=help_text)
        return noun.add_subparsers(dest="verb", required=True, parser_class=Parser)

    def runner(group, name: str, help_text: str):
        return group.add_parser(name, help=help_text, description=help_text, epilog=RUNNER_EPILOG,
                                formatter_class=argparse.RawDescriptionHelpFormatter)

    ledger = verbs("ledger", "the research ledger: init, service, temp, sql, witness, review, export")
    command = ledger.add_parser("init", help="initialize a new research ledger profile")
    command.add_argument("--name", required=True, help="profile name; the database is the name with - as _")
    command.add_argument("--kind", required=True, choices=db.KINDS, help="active, isolated or temporary")
    command.add_argument("--service-root", required=True, type=Path, help="directory of the Dolt service")
    command.add_argument("--research-branch", default="main", help="the branch research writes go to (default: main)")
    command.add_argument("--backup-root", type=Path, help="dolt_backup directory (required for --kind active)")
    command = ledger.add_parser("service", help="start, stop or read the ledger's database service")
    command.add_argument("action", choices=("start", "stop", "status"), help="start, stop or status")
    _ledger_option(command)
    command = ledger.add_parser("temp", help="an isolated temporary ledger under the temporary root")
    command.add_argument("--root", help="new directory under the temporary root (default: a fresh one)")
    command = ledger.add_parser("sql", help="one read-only query with the reader account")
    _ledger_option(command)
    command.add_argument("query", help="one SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, TABLE or VALUES statement")
    _at(command)
    command = ledger.add_parser("witness", help="timestamp out-of-sample registrations without a witness")
    _ledger_option(command)
    command.add_argument("--tsa-url", help="RFC 3161 timestamp authority URL (default: the built-in one)")
    command = ledger.add_parser("review", help="the whole review at one exact version")
    _ledger_option(command)
    _at(command)
    command = ledger.add_parser("export", help="full-history backup and reproduction manifest")
    _ledger_option(command)
    command.add_argument("--kind", required=True, choices=("reproduce", "backup"),
                         help="reproduce: into a new --output directory; backup: sync to the profile's backup")
    command.add_argument("--output", help="new directory (required for --kind reproduce)")
    _at(command)
    command.add_argument("--trial-id", type=int, action="append", dest="trial_ids",
                         help="a run to list in the manifest (repeatable; default: every run)")

    candidate = verbs("candidate", "candidates: publish, show, export, new, list")
    command = candidate.add_parser("publish", help="publish one single-file source as a candidate")
    _ledger_option(command)
    command.add_argument("--file", required=True, help="the UTF-8 strategy source file")
    command.add_argument("--strategy-id", required=True, help="strategy ID; a new one starts at revision 1")
    command.add_argument("--entry-class", required=True, help="the entry class name in the file")
    command.add_argument("--description", required=True, help="one line on what the candidate does")
    command.add_argument("--parent", help="parent candidate as ID@N (omit for a root)")
    command.add_argument("--difference", help="what changed from the parent")
    _op_id(command)
    command = candidate.add_parser("show", help="a candidate record without its source")
    _ledger_option(command)
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    _at(command)
    command = candidate.add_parser("export", help="a candidate's source as a temporary working copy")
    _ledger_option(command)
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--output", required=True,
                         help="new source file under the temporary root, in a fresh candidate working directory; "
                              "AGENTS.md and strategy-header.md beside it must also be absent")
    _at(command)
    command = candidate.add_parser("new", help="a strategy scaffold in a new temporary directory")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command.add_argument("--strategy-id", required=True, help="strategy ID for the file header")
    command.add_argument("--entry-class", default="Strategy1", help="entry class name (default: Strategy1)")
    command = candidate.add_parser("list", help="every candidate with its registration attempts")
    _ledger_option(command)
    _at(command)

    evidence_noun = verbs("evidence", "Agent evidence bundles: add, export")
    command = evidence_noun.add_parser("add", help="append an evidence bundle")
    _ledger_option(command)
    command.add_argument("--bundle", required=True, help="new bundle name")
    command.add_argument("--file", action="append", dest="files", default=[], help="a file to add (repeatable)")
    command.add_argument("--note", help="text stored as note.md")
    _op_id(command)
    command = evidence_noun.add_parser("export", help="a bundle's files into a new temporary directory")
    _ledger_option(command)
    command.add_argument("--bundle", required=True, help="bundle name")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    _at(command)

    execution_noun = verbs("execution", "execution captures: recover")
    command = execution_noun.add_parser("recover", help="append recovered bytes of a kept precheck directory")
    _ledger_option(command)
    command.add_argument("--trial-id", required=True, type=int, help="the precheck trial whose capture was refused")
    command.add_argument("--workdir", required=True, help="the kept precheck directory")
    command.add_argument("--failure-receipt", required=True, help="the failure receipt the refusal wrote")

    judgment = verbs("judgment", "Agent judgments: add")
    command = judgment.add_parser("add", help="append one judgment")
    command.epilog = ("A judgment binds to a line, its subjects and the --based-on commit and is never edited. "
                      "--supersedes corrects the same conclusion; an independent conclusion is a new judgment, "
                      "and both stay readable (research state --history).")
    _ledger_option(command)
    command.add_argument("--kind", required=True, choices=judgments.KINDS,
                         help="recommendation, priority, interpretation or search_exposure")
    command.add_argument("--line", required=True, help="research line bundle, research-line-<YYYYMMDD>-<slug>")
    command.add_argument("--based-on", required=True, help="the ledger commit the judgment reads")
    command.add_argument("--body", required=True, help="UTF-8 text file")
    command.add_argument("--subject", action="append", dest="subjects", default=[],
                         help="role=…,candidate=ID@N | trial=N | registration=BUNDLE (repeatable)")
    command.add_argument("--supersedes", type=int, help="the judgment ID this one replaces")
    _op_id(command)

    line = verbs("line", "research lines: select, close")
    command = line.add_parser("select", help="record the user's research line")
    command.epilog = ("One record per choice: a later change of start, window or market commit is a new line "
                      "record, never an edit. The UTC date and --slug name the line and its closing tag.")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--start", required=True,
                         help="start candidate as ID@N; a revision whose source review passed")
    command.add_argument("--window-start", required=True, help="development window start, YYYY-MM-DD UTC")
    command.add_argument("--window-end", required=True, help="development window end (exclusive), YYYY-MM-DD UTC")
    command.add_argument("--market-at", help="market commit, tag or branch to pin (default: main)")
    command.add_argument("--note", help="the user's two research targets (maximum drawdown, minimum annual return) "
                                        "and other context")
    command.add_argument("--slug", required=True,
                         help="the line's direction as lowercase words joined by hyphens")
    command = line.add_parser("close", help="tag an ended line's last commit with its summary")
    _ledger_option(command)
    command.add_argument("--line", required=True, help="an ended line research state lists under unclosed_lines")
    command.add_argument("--summary", required=True,
                         help="UTF-8 text file (at most 32 KB), the index later research searches: the direction, "
                              "what was tried, results with their run IDs, failures and why, lessons and advice; "
                              "numbers stay in the reports")

    registration = verbs("registration", "registrations: add")
    command = runner(registration, "add", "lock a registration")
    command.epilog = textwrap.fill(
        "Locks the body and its runtime and input identity as an immutable bundle; the runner arguments must "
        "match replay run. body.prechecks binds each grid candidate's passed source review. Changing source, "
        "intent or grid needs a new registration; a consumed point is retried by a new one naming it in "
        "retry_of.", 100) + "\n\n" + RUNNER_EPILOG
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--bundle", required=True, help="new bundle name, registration-*")
    command.add_argument("--body", required=True, help="JSON body file; templates in "
                                                       ".agents/skills/research-round/templates/registration-*.json")
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP)
    command.add_argument("--source", action="append", default=[], help="a source original file (repeatable)")

    hypothesis = verbs("hypothesis", "registered hypotheses: compare")
    command = hypothesis.add_parser("compare", help="a grid run against its registered control")
    _ledger_option(command)
    command.add_argument("--bundle", required=True, help="registration bundle, registration-*")
    command.add_argument("--trial-id", required=True, type=int, help="a grid run of that registration")
    _at(command)

    research = verbs("research", "research facts: status, state")
    command = research.add_parser("status", help="research fact counts and the line's comparison table")
    _ledger_option(command)
    command.add_argument("--line", help="research line bundle of the comparison table (default: the current line)")
    _at(command)
    command = research.add_parser("state", help="the line record and its current judgments with read-time facts")
    _ledger_option(command)
    command.add_argument("--line", help="research line bundle (default: the current line)")
    command.add_argument("--history", action="store_true",
                         help="include up to 20 original judgments, newest first, including superseded text and subjects")
    command.add_argument("--history-before", type=int,
                         help="include the next history page before this judgment ID (use next_before; implies --history)")
    _at(command)

    source = verbs("source", "independent source reviews: review")
    command = source.add_parser("review", help="record an independent source review of a precheck")
    _ledger_option(command)
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--runtime", required=True, help=RUNTIME_HELP + "; the precheck's image")
    command.add_argument("--precheck-trial", required=True, type=int, help="the precheck trial reviewed")
    command.add_argument("--verdict", required=True, choices=("passed", "failed"), help="passed or failed")
    command.add_argument("--items", required=True, help="JSON file with api, causal, activity and readiness")
    command.add_argument("--reviewer", required=True, help="the reviewer's name, not the author's")

    validation = verbs("validation", "out-of-sample validations: registration, report")
    command = validation.add_parser("registration", help="register one out-of-sample validation")
    command.epilog = ("Records the user's candidate, window and universe rule and requests an RFC 3161 timestamp; "
                      "ledger witness retries a missing one. replay run --validation runs it once.")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--window-start", required=True, help="UTC time, YYYY-MM-DDTHH:MM:SSZ")
    command.add_argument("--window-end", required=True, help="UTC time, YYYY-MM-DDTHH:MM:SSZ")
    command.add_argument("--universe-rule", required=True, help="the market commit's universe rule")
    command.add_argument("--market-at", help="market commit, tag or branch (default: main)")
    command.add_argument("--design", required=True, help="JSON file of the validation design")
    command.add_argument("--retry-of", type=int, help="the registration ID this retries")
    _op_id(command)
    command.add_argument("--tsa-url", help="RFC 3161 timestamp authority URL (default: the built-in one)")
    command = validation.add_parser("report", help="the out-of-sample report of a registration")
    command.epilog = ("The same measures and masking as development reports, with intervals, p and the Holm "
                      "correction over the window's registrations; no verdict.")
    _ledger_option(command)
    command.add_argument("--registration-id", required=True, type=int, help="validation registration ID")
    _at(command)

    replay = verbs("replay", "replays: explore, precheck, run, report, reproduce")
    command = runner(replay, "explore", "replay an unpublished strategy file (not evidence)")
    _ledger_option(command)
    _market_option(command)
    _at(command, "market")
    command.add_argument("--strategy-file", required=True, help="the draft strategy source file")
    command.add_argument("--strategy-class", required=True, help="its entry class name")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP)
    command = runner(replay, "precheck", "the declared native precheck of a published candidate")
    from registration.precheck import PRECHECK_MAX_DAYS
    command.epilog = textwrap.fill(
        f"Exposure exemption permits at most {PRECHECK_MAX_DAYS} trading days (--trade-start, or --start, to "
        "--end; warm-up is excluded). Longer prechecks still execute and can pass technically, but expose the "
        "source and prevent its first research registration. Exemption also requires this precheck to be cited "
        "with matching execution identity; other prior replays can still expose the source.", 100) + "\n\n" \
        + RUNNER_EPILOG
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--at", required=True, help="market commit, tag or branch")
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--runtime", required=True, help=RUNTIME_HELP)
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command = runner(replay, "run", "a sealed research or validation replay (runner arguments as registered)")
    _ledger_option(command)
    _market_option(command)
    _at(command, "market")
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP)
    command.add_argument("--hypothesis", help="registration bundle, registration-* (or --validation)")
    command.add_argument("--validation", type=int, help="validation registration ID (or --hypothesis)")
    command = replay.add_parser("report", help="a sealed result, precheck technical facts/cache, or unverified directory")
    command.epilog = ("For a precheck, --directory verifies its original cache. When the cache is lost, run replay "
                      "reproduce and pass its --reproduction directory and --reproduction-trial; a reproduction "
                      "never replaces the original's failures.")
    _ledger_option(command)
    command.add_argument("--trial-id", type=int, help="trial holding a sealed result or original precheck")
    command.add_argument("--directory", help="original precheck cache with --trial-id; otherwise an unverified directory")
    _at(command)
    command.add_argument("--tables", action="store_true", help="add the drill-down tables")
    command.add_argument("--reproduction", help="the directory `replay reproduce` wrote")
    command.add_argument("--reproduction-trial", type=int, help="the reproduction_trial_id `replay reproduce` returned")
    command.add_argument("--account", action="store_true", help="add the native account table")
    command.add_argument("--exposures", action="store_true", help="add the capital exposures table")
    command = replay.add_parser("reproduce", help="regenerate a sealed result's or precheck's reports into /tmp, "
                                                  "recording an explore trial")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--trial-id", required=True, type=int, help="original trial holding a result or precheck")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command.epilog = ("Hands over the directory only when its semantic fingerprint equals the recorded one. "
                      "Identically reproducing the precheck a registration cites adds no exposure; any other "
                      "reproduction or exploration of a source counts as its prior exposure.")

    market = verbs("market", "market data: init, import, lifecycle, coverage, backup, review")
    command = market.add_parser("init", help="create an empty market database and its profile")
    command.add_argument("--name", required=True, help="profile name; the database is the name with - as _")
    command.add_argument("--kind", required=True, choices=("active", "isolated", "temporary"),
                         help="active, isolated or temporary")
    command.add_argument("--service-root", required=True, help="directory of the Dolt service")
    command.add_argument("--backup-root", type=Path, help="dolt_backup directory (required for --kind active)")
    command = market.add_parser("backup", help="sync the market database's history to its backup directory")
    _market_option(command)
    command = market.add_parser("review", help="check that the market backup's head is an ancestor of main")
    _market_option(command)
    command = market.add_parser("import", help="import one month as one market commit")
    _market_option(command)
    command.add_argument("--month", required=True, help="UTC month, YYYY-MM")
    command.add_argument("--cache-root", help="download cache directory (default: trade-market-cache in the temporary directory)")
    command.add_argument("--workers", type=int, default=4, help="parallel import processes (default: 4)")
    command.add_argument("--symbols", nargs="+", help="engineering allowlist (isolated market databases only)")
    command = market.add_parser("lifecycle", help="write the lifecycle bundle of a market commit")
    _ledger_option(command)
    _market_option(command)
    _at(command, "market")
    command.add_argument("--manifest", required=True, help="lifecycle.json (native-lifecycle-v1)")
    command.add_argument("--notice", action="append", dest="notices", default=[], help="an exchange notice it cites")
    _op_id(command)
    command = market.add_parser("coverage", help="per-contract coverage facts at a market commit",
                                epilog=COVERAGE_EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)
    _market_option(command)
    _at(command, "market")
    command.add_argument("--symbols", nargs="+", help="Binance symbols (default: every universe member in the window)")
    command.add_argument("--start", required=True, help="input interval start, UTC ISO-8601 with Z")
    command.add_argument("--end", required=True, help="input interval end, UTC ISO-8601 with Z")
    _ledger_option(command)
    command.add_argument("--lifecycle-bundle", help="lifecycle-<commit> bundle to add lifecycle episodes (needs --ledger)")
    return parser


RUNNER_COMMANDS = {("replay", "explore"), ("replay", "precheck"), ("replay", "run"), ("registration", "add")}


def _dispatch(args, runner_argv: list[str]) -> tuple[dict, int]:
    """(result, exit code) of one parsed command."""
    key = (args.noun, args.verb)
    if runner_argv and key not in RUNNER_COMMANDS:
        raise UsageError(f"{args.noun} {args.verb} takes no runner arguments after --")
    if key == ("ledger", "init"):
        return ledger_init(args.name, args.kind, args.service_root, args.research_branch, args.backup_root), 0
    if key == ("ledger", "temp"):
        return ledger_temp(args.root), 0
    if key == ("candidate", "new"):
        return candidate_new(args.output, args.strategy_id, args.entry_class), 0
    if key == ("market", "init"):
        return market_init(args.name, args.kind, args.service_root, args.backup_root), 0
    if key == ("market", "backup"):
        return market_backup(market_profile(args.market)), 0
    if key == ("market", "review"):
        found = market_review(market_profile(args.market))
        return found, 0 if found["ok"] else 1
    if key == ("market", "import"):
        return market_import(market_profile(args.market), args.month, args.cache_root, args.workers, args.symbols), 0
    if key == ("market", "coverage"):
        return market_coverage(market_profile(args.market), args.at, args.symbols, args.start, args.end, args.ledger,
                               args.lifecycle_bundle), 0
    if key == ("replay", "reproduce"):
        from cli import replay as cli_replay
        return cli_replay.replay_reproduce(ledger_profile(args.ledger), market_profile(args.market), args.trial_id,
                                           args.output), 0
    profile = ledger_profile(args.ledger)
    if key == ("ledger", "service"):
        return ledger_service(profile, args.action), 0
    if key == ("ledger", "sql"):
        return ledger_sql(profile, args.query, args.at), 0
    if key == ("ledger", "export"):
        return ledger_export(profile, args.kind, args.output, args.at, args.trial_ids), 0
    if key == ("ledger", "witness"):
        with db.connect(profile, "writer") as conn:
            found = ledger_witness(conn, args.tsa_url)
        return found, 1 if found["failed"] else 0
    if key == ("ledger", "review"):
        with db.connect(profile, "reader") as conn:
            found = ledger_review(conn, args.at)
        return found, 0 if found["ok"] else 1
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
    if key == ("line", "select"):
        market = market_profile(args.market)
        with db.connect(profile, "writer") as conn:
            return line_select(conn, market, args.start, args.window_start, args.window_end, args.market_at,
                               args.note, args.slug), 0
    if key == ("line", "close"):
        return lines.close_line(profile, args.line, _regular_file(args.summary, "LINE_SUMMARY_INVALID")), 0
    if key == ("registration", "add"):
        return registration_add(profile, args.bundle, args.body, args.runtime, market_profile(args.market),
                                runner_argv, args.source), 0
    if key == ("hypothesis", "compare"):
        return hypothesis_compare(profile, args.bundle, args.trial_id, args.at), 0
    if key == ("research", "status"):
        return research_status(profile, args.at, args.line), 0
    if key == ("research", "state"):
        with db.connect(profile, "reader") as conn:
            return research_state(conn, args.line, args.at, history=args.history,
                                  history_before=args.history_before), 0
    if key == ("source", "review"):
        return source_review(profile, args.candidate, args.runtime, args.precheck_trial, args.verdict, args.items,
                             args.reviewer), 0
    if key == ("validation", "registration"):
        return validation_registration(profile, args.candidate, args.window_start, args.window_end, args.universe_rule,
                                       args.market_at, market_profile(args.market), args.design, args.retry_of,
                                       args.op_id, args.tsa_url), 0
    if key == ("validation", "report"):
        return validation_report(profile, args.registration_id, args.at), 0
    if key == ("replay", "explore"):
        found = replay_explore(profile, market_profile(args.market), args.at, args.strategy_file, args.strategy_class,
                               args.output, args.runtime, runner_argv)
        return found, 0
    if key == ("replay", "precheck"):
        found = replay_precheck(profile, market_profile(args.market), args.at, args.candidate, args.runtime,
                                runner_argv, args.output)
        return found, 0 if found["status"] == "passed" else 1
    if key == ("replay", "run"):
        found = replay_run(profile, market_profile(args.market), args.at, args.candidate, args.runtime, runner_argv,
                           args.hypothesis, args.validation)
        return found, 0 if found.get("status") == "passed" else 1
    if key == ("replay", "report"):
        return replay_report(profile, args.trial_id, args.directory, args.at, args.tables, args.reproduction,
                             args.reproduction_trial, args.account, args.exposures), 0
    if key == ("market", "lifecycle"):
        return market_lifecycle(profile, market_profile(args.market), args.at, args.manifest, args.notices,
                                args.op_id), 0
    raise UsageError(f"unknown command {args.noun} {args.verb}")


def main(argv: list[str] | None = None) -> int:
    """Parse `<noun> <verb> [options] [-- runner arguments]`, run it, print one JSON result."""
    from market import store
    argv = list(sys.argv[1:] if argv is None else argv)
    runner_argv: list[str] = []
    if "--" in argv:
        split = argv.index("--")
        argv, runner_argv = argv[:split], argv[split + 1:]
    try:
        args = _parser().parse_args(argv)
        result, code = _dispatch(args, runner_argv)
    except UsageError as exc:
        found = refuse("USAGE_ERROR", str(exc))
        _print(sys.stderr, refusal_json(found))
        return 1
    except Refusal as exc:
        _print(sys.stderr, refusal_json(exc))
        return 1
    except store.MarketError as exc:
        _print(sys.stderr, refusal_json(_market_refusal(exc)))
        return 1
    _print(sys.stdout, result)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
