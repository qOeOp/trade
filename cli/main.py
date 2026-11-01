"""The product command line (`cli.main`): noun verb subcommands that print JSON; each command's
--help states its contract.

    uv run --frozen python -m cli.main <noun> <verb> [options] [-- runner arguments]

A ledger is named by `--ledger`: a profile file path, or a profile name in the ledger profile
directory (`TRADE_LEDGER_HOME`, default ~/.local/share/trade/ledgers); without it, the active
research ledger. A market database is named by `--market` the same way; without it, the active
market profile in the profile directory. Runner arguments (window and instrument scope) follow `--`.

A result is one JSON object on stdout. A refusal is one JSON object on stderr with exit 1: code,
message, missing, expected, write_status (not_written, written or unknown; rerun with operation_id
when unknown) and next_actions, the commands that supply what is missing. A command that changes the
ledger (or a market import or upgrade) then publishes that database when origin is behind it, adding
`published` or `publish_failed` (the write stays; the next write or publish retries); read
commands never publish. Each command's --help lists what it reads, writes and returns and its main
refusals.
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
import time
import tempfile
import textwrap
from typing import Literal

import pymysql

from ledger import admin, db, evidence, execution, judgments, lines, paths, strategies, targets, witness
from ledger import publish as publication
from ledger.errors import Refusal, refusal
from ledger.refusals import CATALOGUE, MARKET_CATALOGUE, refuse


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
    from the market's own catalogue entry where the code is shared with the ledger, else the catalogue."""
    return refusal(exc.code, exc.message, missing=exc.missing, write_status="not_written",
                   next_actions=tuple(MARKET_CATALOGUE.get(exc.code, CATALOGUE[exc.code])[1]))


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
        raise refuse(code, f"{path} is not UTF-8 JSON: {exc}", missing=(str(path),)) from exc
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
        assert config is not None  # refused above
        started = db.start_service(profile.service_root)
        try:
            with db.read_as_of(profile) as conn:
                commit = conn.resolved_commit
        except Refusal as exc:
            if not db.managed(config):
                db.stop_service(profile.service_root)
            raise refuse("SERVICE_START_FAILED", f"the service started but the ledger is not readable ({exc.code})",
                         missing=(profile.database,)) from exc
        return {"action": action, "running": True, "pid": started.get("pid"), "address": db.address(config),
                "branch": profile.research_branch, "ledger_commit": commit}
    address = db.address(config) if config is not None else None
    try:
        with db.read_as_of(profile) as conn:
            commit = conn.resolved_commit
    except Refusal:
        return {"action": action, "running": False, "address": address}
    return {"action": action, "running": True, "pid": db._pid(profile.service_root),
            "address": address, "branch": profile.research_branch, "ledger_commit": commit}


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


# Strings, quoted names and comments in one left-to-right pass, as the server lexes them: whichever starts
# first owns the text to its end, so a quote inside a comment or a comment marker inside a string hides
# nothing from the check.
LEXEMES = re.compile(r"'(?:[^'\\]|\\.|'')*'|\"(?:[^\"\\]|\\.)*\"|`[^`]*`|--[^\n]*|#[^\n]*|/\*.*?\*/", re.S)
# Dolt 2.4.2 executes the body of a /*! */ comment (measured: `/*!SET PERSIST max_connections = */ (SELECT 7)`
# sets it), and /*+ */ carries optimizer hints; neither is a comment to it, so neither is accepted anywhere
# outside a string.
EXECUTABLE_COMMENT = re.compile(r"/\*[!+]")
SERVER_FILES = {"OUTFILE", "DUMPFILE", "LOAD_FILE"}  # server file writes and reads; the service config refuses them too


def _statement_words(query: str) -> tuple[str, list[str], bool]:
    executable = False

    def blank(lexeme: re.Match) -> str:
        nonlocal executable
        if lexeme.group()[0] in "-#/" and EXECUTABLE_COMMENT.search(lexeme.group()):
            executable = True
        return " "

    stripped = LEXEMES.sub(blank, query)
    executable = executable or bool(EXECUTABLE_COMMENT.search(stripped))  # an unclosed /*! is no comment either
    return stripped, re.findall(r"[A-Za-z_]+", stripped.upper()), executable


def ledger_sql(profile: db.LedgerProfile, query: str, at: str | None) -> dict:
    """ledger sql: one read statement with the reader account, pinned to an exact version."""
    stripped, words, executable = _statement_words(query or "")
    body = stripped.strip().rstrip(";").strip()
    if not words or words[0] not in READ_FIRST or ";" in body or executable:
        raise refuse("WRITE_VIA_SQL", "only one " + ", ".join(READ_FIRST) + " statement is accepted",
                     expected="a single read statement")
    if SERVER_FILES.intersection(words):
        raise refuse("WRITE_VIA_SQL", "INTO OUTFILE, INTO DUMPFILE and LOAD_FILE reach server files and are not accepted",
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


SUBJECT_ROLES_HELP = (" | ".join(judgments.CANDIDATE_ROLES) + " name a candidate; "
                      "about names a candidate, trial or registration")


def _subject(text: str) -> dict:
    found = {}
    for part in text.split(","):
        key, sep, value = part.partition("=")
        if not sep or not key.strip():
            raise UsageError(f"--subject {text!r} is not role=ROLE,candidate=ID@N|trial=N|registration=BUNDLE "
                             f"({SUBJECT_ROLES_HELP})")
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


def line_select(conn: db.LedgerConnection, market: dict, start: str, window_start: str, window_end: str,
                market_at: str | None, note: str | None, slug: str, line_targets: tuple | None = None) -> dict:
    """line select: the user's research line (start candidate, development window, pinned market commit)
    and, when given, the user's targets for it."""
    from qualification import availability
    first, last = _utc_day(window_start), _utc_day(window_end)
    selected = lines.select_line(conn, market["database"], market_at or "main", first, last, start, note, slug=slug,
                                 market=_market_facts(market), reviews=availability.review_records,
                                 targets=line_targets)
    return {"bundle": selected["bundle"], "start": start,
            "window": {"start": first.isoformat(), "end": last.isoformat()},
            "market_commit": selected["market_commit"], "universe_rule": selected["universe_rule"],
            "content_sha256": selected["content_sha256"], "created": selected["created"],
            "targets": selected["targets"]}


# registration, hypothesis

def registration_add(profile: db.LedgerProfile, bundle: str, body: str, runtime: str | None, market: dict,
                     runner_argv: list[str], source: list[str], line: str | None = None) -> dict:
    """registration add: lock the registration body, test conditions, grid and execution identity."""
    from registration import register
    plan = _json_file(body, "REGISTRATION_INVALID")
    registered = register.register(profile, bundle, plan, runtime, market, list(runner_argv),
                                   [Path(item) for item in source or ()], line)
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
                   history: bool = False, history_before: int | None = None, full: bool = False) -> dict:
    from report import status
    return status.research_state(conn, line, at, history=history, history_before=history_before, full=full)


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


def replay_run(profile, market, at, candidate, runtime, runner_argv, hypothesis, validation, output=None) -> dict:
    from replay import entry
    if (hypothesis is None) == (validation is None):
        raise refuse("REGISTRATION_REQUIRED", "give exactly one of --hypothesis or --validation",
                     expected="--hypothesis registration-<name> xor --validation <id>")
    ran = entry.run(profile, market, at, candidate, runtime, list(runner_argv), hypothesis, validation,
                    Path(output) if output else None)
    with db.read_as_of(profile) as conn:
        commit = conn.resolved_commit
    return {**ran, "ledger_commit": commit}


def replay_report(profile, trial_id: int | None, directory: str | None, at: str | None, tables: bool,
                  reproduction: str | None, reproduction_trial: int | None, account: bool, exposures: bool) -> dict:
    """replay report: a sealed run's report (with --tables its drill-down tables, native ones from the
    run's kept directory or a verified reproduction), or an unsealed directory's report marked unverified."""
    from report import runs
    if directory is not None and trial_id is None:
        if not Path(directory).is_dir():
            raise refuse("DIRECTORY_NOT_FOUND", f"{directory} is not a directory", missing=(directory,))
        return {"source": "directory", **runs.directory_report(Path(directory), account=account)}
    if trial_id is None:
        raise UsageError("give --trial-id or --directory")
    with db.read_as_of(profile, at) as conn:
        trial = conn.one("SELECT purpose FROM trial WHERE trial_id = %s", (trial_id,))
    if directory and reproduction:
        raise UsageError("give either --directory (original cache) or --reproduction (regenerated cache)")
    cache_directory = directory or reproduction
    if trial is not None and trial["purpose"] == "precheck":
        return {"source": "precheck", **runs.precheck_report(
            profile, trial_id, at, directory=Path(cache_directory) if cache_directory else None,
            reproduction=reproduction_trial, account=account, exposures=exposures)}
    found = {"source": "sealed", **runs.run_report(profile, trial_id, at)}
    if tables or exposures or account or cache_directory:
        found["tables"] = runs.tables(trial_id, profile, at, account=account, exposures=exposures,
                                      directory=Path(cache_directory) if cache_directory else None,
                                      reproduction=reproduction_trial)
    return found


# market

def market_init(name: str, kind: Kind, service_root: Path, backup_root: Path | None = None) -> dict:
    """market init: an empty market database (tables, import and reader accounts, profile with its
    backup directory, required for the active one); the first `market import` writes its schema row
    and commit tests. Administration happens only here, in `market upgrade` and in `market backup`."""
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


def market_import_quotes(market: dict, month: str, cache_root: str | None, workers: int,
                         symbols: list[str] | None = None) -> dict:
    """market import-quotes: one UTC month of best bid/ask inferred from Binance aggTrades (market.quotes.RULE)
    as one market commit; `symbols` defaults to the month's universe members."""
    from market import store
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-\d{2}", month):
        raise refuse("MONTH_INVALID", f"{month!r} is not YYYY-MM", expected="YYYY-MM")
    try:
        first = date.fromisoformat(month + "-01")
    except ValueError as exc:
        raise refuse("MONTH_INVALID", f"{month!r} is not a month", expected="YYYY-MM") from exc
    if first > datetime.now(timezone.utc).date():
        raise refuse("MONTH_INVALID", f"{month} is after the current UTC month", expected="YYYY-MM")
    return store.import_quotes(market, first, Path(cache_root) if cache_root else store.default_cache(), workers,
                               symbols, log=lambda line: print(line, file=sys.stderr, flush=True))


def market_import_trades(market: dict, month: str, cache_root: str | None, symbols: list[str]) -> dict:
    """One explicit month of complete source aggTrades of each named contract, written at once; no replay or
    quote change."""
    from market import aggtrades, store
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-\d{2}", month):
        raise refuse("MONTH_INVALID", f"{month!r} is not YYYY-MM", expected="YYYY-MM")
    try:
        first = date.fromisoformat(month + "-01")
    except ValueError as exc:
        raise refuse("MONTH_INVALID", f"{month!r} is not a month", expected="YYYY-MM") from exc
    return aggtrades.import_month(market, first, Path(cache_root) if cache_root else store.default_cache(), symbols,
                                  log=lambda line: print(line, file=sys.stderr, flush=True))


def market_import_metrics(market: dict, month: str, cache_root: str | None, symbols: list[str] | None) -> dict:
    """The days of one explicit month of open interest and long/short ratios not yet held, per contract; no replay
    change."""
    from market import metrics, store
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-\d{2}", month):
        raise refuse("MONTH_INVALID", f"{month!r} is not YYYY-MM", expected="YYYY-MM")
    try:
        first = date.fromisoformat(month + "-01")
    except ValueError as exc:
        raise refuse("MONTH_INVALID", f"{month!r} is not a month", expected="YYYY-MM") from exc
    return metrics.import_month(market, first, Path(cache_root) if cache_root else store.default_cache(), symbols,
                                log=lambda line: print(line, file=sys.stderr, flush=True))


def market_follow(market: dict, symbols: list[str], cache_root: str | None, status: str | None) -> dict:
    """Keep the market's bars and the named contracts' metrics, quotes and complete aggTrades imported, unattended,
    publishing after each round; runs until stopped."""
    from market import follow, store
    profile = _market_ledger(market)

    def publish() -> dict | None:
        if profile.kind is None or not publication.unpublished(profile, MARKET_BRANCH):
            return None
        return publication.publish(profile, MARKET_BRANCH, _market_lock(profile))

    return follow.follow(market, symbols, Path(cache_root) if cache_root else store.default_cache(),
                         Path(status) if status else follow.default_status(), publish,
                         log=lambda line: print(line, file=sys.stderr, flush=True),
                         report=lambda line: print(line, flush=True))


def market_upgrade(market: dict) -> dict:
    """market upgrade: create the tables of market/schema.sql the market database lacks and drop the views
    it no longer defines (the administrator)."""
    return db.upgrade_market(market)


MARKET_BRANCH = "main"
MARKET_WRITES = {("market", "import"), ("market", "import-quotes"), ("market", "import-trades"),
                 ("market", "import-metrics"), ("market", "upgrade")}
# Commands that only read: they never publish, so a reader polling the ledger never races a writer's push.
READS = {("line", "list"), ("ledger", "sql"), ("ledger", "export"), ("ledger", "review"), ("candidate", "show"), ("candidate", "export"),
         ("candidate", "list"), ("evidence", "export"), ("hypothesis", "compare"), ("research", "status"),
         ("research", "state"), ("research", "graph"), ("validation", "report"), ("replay", "report"),
         ("market", "coverage"), ("market", "bars"), ("paper", "reconcile")}


def _market_ledger(market: dict) -> db.LedgerProfile:
    return db.LedgerProfile.from_json(dict(market))


def _market_lock(profile: db.LedgerProfile) -> str:
    return f"market-import:{profile.database}"


def ledger_publish(profile: db.LedgerProfile, remote: str | None) -> dict:
    """ledger publish: push the research branch and its tags to origin (named once with --remote)."""
    named = publication.set_remote(profile, remote) if remote else None
    return {**publication.publish(profile, profile.research_branch), "remote_set": named}


def market_publish(market: dict, remote: str | None) -> dict:
    """market publish: push the market database's main and tags to origin, holding its import lock."""
    profile = _market_ledger(market)
    named = publication.set_remote(profile, remote) if remote else None
    return {**publication.publish(profile, MARKET_BRANCH, _market_lock(profile)), "remote_set": named}


def _publish_after(args, result: dict) -> dict:
    """After a command that may write, publish the database it used once when origin is behind it: the
    ledger (any such command naming one) or the market (an import or upgrade). Read commands (READS)
    never publish. A failure leaves the write in place and is reported as publish_failed; the next
    ledger write or `ledger publish` publishes it. Profiles without a kind (a read-only copy) never
    publish."""
    key = (args.noun, args.verb)
    if (key in READS or key in {("ledger", "publish"), ("market", "publish"), ("ledger", "service")}
            or not isinstance(result, dict)):
        return result
    try:
        lock: str | None = None
        if key in MARKET_WRITES:
            profile, branch = _market_ledger(market_profile(args.market)), MARKET_BRANCH
            lock = _market_lock(profile)
        elif hasattr(args, "ledger"):
            profile = ledger_profile(args.ledger)
            branch = profile.research_branch
        else:
            return result
        if profile.kind is None or not publication.unpublished(profile, branch):
            return result
        started = time.monotonic()
        published = publication.publish(profile, branch, lock)
        timing = {"publish_seconds": round(time.monotonic() - started, 3)} if key == ("market", "import-trades") else {}
        return {**result, "published": published, **timing}
    except Refusal as exc:
        return {**result, "publish_failed": refusal_json(exc)}


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


def market_bars(market: dict, at: str | None, symbol: str, price_type: str, timeframe: str, start: str, end: str,
                limit: int, output: str | None) -> dict:
    """market bars: one contract's stored bars and funding settlements at a market commit, inline up to
    --limit bar periods or whole into a new temporary file."""
    from market import read
    if timeframe == "1d" and price_type != "LAST":
        raise UsageError("market bars --timeframe 1d gives the daily LAST bars only; drop --price-type MARK")
    target = _new_temporary(output) if output else None
    found = read.stored_bars(market, at, symbol, price_type, timeframe, start, end, None if target else limit)
    if target is None:
        return {**found, "output": None}
    target.write_text(json.dumps(found, ensure_ascii=False) + "\n", encoding="utf-8")
    return {**found, "output": str(target), "bars": {key: value for key, value in found["bars"].items() if key != "rows"},
            "funding": {key: value for key, value in found["funding"].items() if key != "rows"}}


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


def _workers(text: str) -> int:
    if not text.isdigit() or int(text) < 1:
        raise argparse.ArgumentTypeError(f"workers must be a whole number of at least 1, got {text!r}")
    return int(text)


def _count(text: str) -> int:
    if not text.isdigit() or int(text) < 1:
        raise argparse.ArgumentTypeError(f"must be a whole number of at least 1, got {text!r}")
    return int(text)


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
  --lifecycle-bundle lifecycle-<commit>    optional lifecycle bundle of the market commit
  --execution bars|quotes                  the execution environment (default bars); quotes drives matching and
                                           the native liquidation with the exported best bid/ask and needs
  --initial-margin R --maintenance-margin R   decimal rates, 0 < maintenance <= initial < 1
  --trade-ticks                            quotes only: export every stored aggregate trade as a TradeTick for the
                                           strategy's subscribe_trades (signal input; trades never match); a
                                           trading month without trades is TRADES_MISSING
  --metrics                                export the stored open interest and long/short ratios as custom
                                           data (engine.metrics_data_type, through subscribe_data), each row
                                           10 minutes after its create_time; a trading month without metrics is
                                           METRICS_MISSING, and an image older than the option refuses it"""
COVERAGE_EPILOG = """Facts only: it judges no contract, window or line.
coverage[].funding: rows, first_ms, last_ms; spacing [{spacing_ms, from_ms, to_ms}], the runs of equal
spacing between consecutive settlements, each time taken at its nearest whole UTC hour (a new run is a
spacing change); missing_settlements [{after_ms, before_ms, missing}], where a single interval is a
whole multiple k >= 2 of the spacing beside it (the same on both sides): k - 1 settlements missing.
Settlement times themselves: market bars.
coverage[].quotes: imports [{month, through (exclusive end day), quote_rule, commit, rows}], every
quote import holding the contract, rows counted by the import's receipt (its commit message); first_ms
and last_ms, the first and last stored quote in the interval; uncovered_intervals_ms, the [from, to)
parts of the interval no import covers.
coverage[].trades: the same for the complete aggregate trades a replay exports with --trade-ticks: imports
[{month, through, codec, commit, rows}], first_ms, last_ms, uncovered_intervals_ms.
coverage[].metrics: open interest and long/short ratios (market import-metrics): imports [{month, from,
through, commit, rows, missing_rows (five-minute rows the stored days lack), empty (rows per ratio the
archive left empty), unpublished (days without an archive)}], first_ms, last_ms (create_time),
uncovered_intervals_ms.
coverage[].terms: the terms row a replay of the commit trades on for the whole window, the latest
observed at the commit (CURRENT_SNAPSHOT_APPROXIMATION): observed_at, terms_source (exchange_info or
inferred), price_increment, size_increment, min_quantity, max_quantity, min_notional, min_price,
max_price (null for inferred terms)."""
BARS_EPILOG = """The source reviewer's price read: no trial, no exposure. Prices and volumes are decimals at the
stored scale. ts_event_ms is when the Catalog delivers the bar to a strategy: its close, ts_open_ms
plus the period minus 1 ms. 1m MARK bars become one mark price per minute at that close. 1d bars are
the Catalog's daily LAST bars, the complete UTC days derived from the stored minutes, which a
DAILY_WARMUP strategy receives before its input start; inside the window the engine aggregates the
minutes natively, stamped on close. Funding rows are the settlements in the same interval, each
delivered at its funding_time_ms. Without --output at most --limit bar periods from --start are
returned and next_start names where the rest begins (null when the interval is complete); with
--output the whole interval goes to the file, rows included, and the printed result keeps only the
counts. Lifecycle episodes are not applied (one contract as stored)."""


def _contract(reads: str, writes: str, returns: str, refuses: str) -> str:
    """A command's contract in its --help: what it reads, writes and returns, and its main refusals."""
    return "\n".join(textwrap.fill(text, 100, initial_indent=f"{label:<9}", subsequent_indent=" " * 9)
                     for label, text in (("reads", reads), ("writes", writes), ("returns", returns),
                                         ("refuses", refuses)))


# (reads, writes, returns, main refusals) of each command, shown in its --help. Writes that change a
# database publish it afterwards unless stated (_publish_after).
CONTRACTS: dict[tuple[str, str], tuple[str, str, str, str]] = {
    ("ledger", "init"): (
        "the profile directory; a Dolt 2.4.2 binary (RESEARCH_DOLT_BINARY or PATH); ledger/schema.sql",
        "the database (--name with - as _), its writer and reader accounts and the schema commit; the Dolt "
        "service under --service-root, started and left running when new; the profile file; never publishes",
        "profile, name, database, kind, service_root, accounts, branch_grant, schema_version, ledger_commit",
        "LEDGER_EXISTS (profile, active ledger or database exists); ISOLATION_BREACH (--kind active without "
        "--backup-root, or its service or backup in the checkout or a temporary root); INVALID_NAME; "
        "DOLT_BINARY; LEDGER_START"),
    ("ledger", "service"): (
        "the service's service.json; start, status and check read the research branch head (reader), check also "
        "the market database (reader); run reads its arguments, the DoltHub key directory and the public copies",
        "start launches the Dolt service, stop stops it (every database on that service root); a service compose "
        "runs (no socket in service.json) is only waited for by start; status and check write nothing; run (the "
        "compose service) serves in the foreground, on first start bootstrapping the service, the ledger and "
        "market databases cloned from their public copies, their accounts and profiles; with --readers, at "
        "every start before serving, <readers>/service.json holding only the port and the reader accounts; "
        "never publishes",
        "action, running; start and status add pid, address, branch, ledger_commit (status gives running false "
        "when the ledger is not readable); check adds ledger_commit, market_schema; run adds server_exit",
        "LEDGER_NOT_INITIALIZED (start: the service holds no such ledger); LEDGER_START; SERVICE_START_FAILED "
        "(started but the ledger is not readable; stopped again unless compose runs it); SERVICE_MANAGED (stop: "
        "compose runs it); run: BOOTSTRAP_REFUSED, BOOTSTRAP_FAILED, DOLTHUB_CREDENTIALS, SERVICE_CHECK_FAILED, "
        "ISOLATION_BREACH, USAGE_ERROR (--readers is the service directory); check: any refusal of reading "
        "either database"),
    ("ledger", "temp"): (
        "the temporary root",
        "a new directory (--root, default <tmp>/ledger-<hex>) holding a temporary ledger's profile file and its "
        "running service, as ledger init; never publishes",
        "profile (pass it as --ledger to later commands), root, address, accounts, ledger_commit",
        "NOT_TEMPORARY_PATH (--root outside the temporary root); PATH_EXISTS; DOLT_BINARY; LEDGER_START"),
    ("ledger", "sql"): (
        "the ledger at --at (default: the research branch head) with the reader account",
        "nothing; never publishes",
        "at, ledger_commit, columns, rows (binary values as {bytes: N})",
        "WRITE_VIA_SQL (not exactly one statement starting with a read keyword, a /*! or /*+ comment, or "
        "INTO OUTFILE, INTO DUMPFILE or LOAD_FILE); "
        "INVALID_REF, UNKNOWN_REF (--at); SQL_STATEMENT_FAILED (the server's error)"),
    ("ledger", "witness"): (
        "out-of-sample registration commits and witness rows (writer); the pinned TSA roots",
        "sends each unwitnessed registration commit's hash to the RFC 3161 authority and records the verified "
        "token as one ledger commit each; publishes",
        "checked, already, witnessed [{commit, registration_ids, stamped_at}], failed [{commit, reason, "
        "registration_ids}]; exit 1 when any failed (an unreachable authority is a failure, not a refusal)",
        "WITNESS_INVALID (a token does not verify or its time is out of range; earlier tokens stay)"),
    ("ledger", "review"): (
        "the ledger at --at (reader, which must hold no write privilege): commit tests, every table's diff, "
        "runs, captures, registrations, validations; the backup's head, read through linked table files",
        "nothing; never publishes",
        "at, commit, tests_run, *_checked counts, history, ok, findings [{code, table, record_id, commit, "
        "detail}], limitations (HISTORY_UNCHECKED without a backup); exit 1 when not ok",
        "LEDGER_PERMISSION (the reader holds a write privilege); INVALID_REF, UNKNOWN_REF (--at); backup "
        "problems are findings, not refusals"),
    ("ledger", "export"): (
        "runs, candidates and their sources, registration bundles, judgments and validations at --at (reader); "
        "--trial-id limits runs and their candidates",
        "<target>/backup (dolt_backup of the full history, synced to the head regardless of --at) and "
        "<target>/reproduce/ (manifest.json, candidates, runs, registrations, judgments, validations); target is "
        "the new --output (reproduce) or the profile's backup directory (backup); no ledger write; never publishes",
        "kind, ledger_commit, target, backup_path, manifest_path, content_hash, runs, candidates (counts)",
        "PATH_EXISTS (--output exists); BACKUP_TARGET_UNSET; EXPORT_PATH_INVALID (target in the service "
        "directory, the checkout or a Git work tree, or not an export of this ledger); UNKNOWN_RUN; "
        "BACKUP_DIVERGED; DOLT_BACKUP; EXPORT_MISMATCH"),
    ("ledger", "publish"): (
        "the administrator connection from service.json (the service must be running); origin, branches, tags",
        "with --remote: origin (DoltHub only for the active ledger, file:// for any); the research branch and "
        "every tag to origin; no ledger commit",
        "database, remote, branch, head, previous_head, tags (count), remote_set",
        "REMOTE_UNSET; REMOTE_MISMATCH (origin points elsewhere); PUBLISH_FORBIDDEN (DoltHub for a non-active "
        "ledger); DOLTHUB_CREDENTIALS; PUBLISH_REJECTED (remote changed elsewhere); PUBLISH_FAILED"),
    ("ledger", "upgrade"): (
        "service.json; the research branch's tables and triggers (administrator); ledger/schema.sql",
        "starts the service if needed; creates the missing tables and triggers in one commit (none when nothing "
        "is missing); publishes",
        "database, branch, created (names), commit (null when nothing was created)",
        "DIRTY_WORKING_SET (uncommitted changes on the branch); COMMIT_CHECK_FAILED; LEDGER_START"),
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
        "candidate, source_sha256, path, bytes, ledger_commit, notes (files written), missing_templates",
        "NOT_TEMPORARY_PATH; PATH_EXISTS (the source, AGENTS.md or strategy-header.md exists); "
        "UNKNOWN_CANDIDATE, BAD_REF; LEDGER_CORRUPT (the file does not reread to the source hash)"),
    ("candidate", "new"): (
        "the packaged strategy header template; no database",
        "a new directory under the temporary root with strategy.py (an entry class stub), AGENTS.md and "
        "strategy-header.md; no ledger",
        "output, files, missing_templates",
        "NOT_TEMPORARY_PATH; PATH_EXISTS; ENTRY_CLASS_INVALID (not a Python class name)"),
    ("candidate", "list"): (
        "candidates, registration attempts, trials, runs and source reviews at --at (reader); each run's "
        "economic evidence availability",
        "nothing; never publishes",
        "ledger_commit, checker, candidates [{strategy_id, revision, source_sha256, entry_class, "
        "runtime_contract, description, parent_strategy_id, parent_revision, difference, created_at, attempts "
        "[{bundle, trial_id, run_status, availability}], valid_evidence}]; large",
        "UNKNOWN_REF (--at); LEDGER_CORRUPT (a run or attempt names a missing trial or source); a run whose "
        "records do not verify is listed as unavailable, not refused"),
    ("evidence", "add"): (
        "--file paths (a directory is walked; links refused) and --note (stored as note.md)",
        "one evidence bundle and its files (writer); the same name and content again is a replay; publishes",
        "bundle, files {path: sha256}, write_status (written or replayed), ledger_commit",
        "EMPTY_EVIDENCE (no files or note, or an empty file); BUNDLE_EXISTS; RESERVED_BUNDLE (a product "
        "namespace such as registration-*, source-review-*, research-line-*, lifecycle-*, trial-N-*); "
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
        "attempt); RECOVERY_INCOMPLETE (another receipt, or required reports absent); TRIAL_NOT_FOUND; "
        "EXECUTION_IDENTITY; BUNDLE_EXISTS (a different recovery exists)"),
    ("judgment", "add"): (
        "--body (a regular UTF-8 file); the line, subjects and superseded judgment (writer, head); for a "
        "recommendation, the line's comparison table at --based-on",
        "one judgment row and its subject rows; the same content again is a replay; publishes",
        "judgment_id, ledger_commit, replayed",
        "LINE_UNKNOWN; COMMIT_NOT_ANCESTOR (--based-on is not an ancestor of the head); COMMIT_BEFORE_LINE; "
        "RECOMMENDATION_INCOMPLETE (a recommendation must name as a subject every candidate of the line's "
        "execution identity in the comparison table at --based-on: its `candidates`); SUPERSEDES_INVALID (missing, another kind or line, or already superseded); "
        "SUBJECT_UNKNOWN, SUBJECT_ROLE_MISMATCH"),
    ("line", "select"): (
        "the market database at --market-at (reader): commit, universe rule, latest complete day; the start "
        "candidate, its source reviews, the open lines and targets (writer, head)",
        "the bundle research-line-<UTC YYYYMMDD>-<slug> (research-line.json) and, when given, the line's targets "
        "in the same commit; a choice equal to an open line writes no line (created false); publishes",
        "bundle, start, window {start, end}, market_commit, universe_rule, content_sha256, created, targets",
        "START_REVIEW_REQUIRED (the start has no passed source review, or a failed one); START_NOT_FOUND; "
        "WINDOW_INVALID; WINDOW_OUT_OF_COVERAGE (end after the market's latest complete day); "
        "MARKET_COMMIT_UNRESOLVED; LINE_CONFLICT (today's name and slug hold another choice); LINE_DATA_TAKEN (an "
        "open line holds the same market commit and window); LINE_SLUG_INVALID; TARGETS_INVALID"),
    ("line", "targets"): (
        "the targets in force for the line or the default (writer, head)",
        "one line_target row superseding the one in force; values equal to it write nothing (written false); "
        "publishes",
        "max_drawdown, annual_return, source (line or default), target_id, created_at, line, written, commit",
        "RESEARCH_LINE_REQUIRED (no open line); LINE_AMBIGUOUS (several open lines and no --line); LINE_ENDED "
        "(--line is closed); LINE_UNKNOWN; TARGETS_INVALID (needs 0 < max-drawdown < 1 and 0 < annual-return < 1000)"),
    ("line", "close"): (
        "--summary (a regular UTF-8 file, at most 32 KB); the line bundles and tags at the head (reader)",
        "the tag line/<YYYYMMDD>-<slug> on the research head, its message the summary (administrator), which "
        "ends the line; no ledger row or commit; the tag goes out with the next publish; the same summary again "
        "is a replay of the existing tag",
        "line, tag, commit, replayed",
        "LINE_CLOSED (tagged with another summary); LINE_UNKNOWN; LINE_SUMMARY_INVALID"),
    ("registration", "add"): (
        "--body and --source files; the open line (--line), its trials, judgments and source reviews (writer, head); "
        "the market at the line's pinned commit (reader); the runtime image, resolved to its digest and probed",
        "the registration bundle (research-plan.json with body, execution and runtime ref) and one source-<sha256> "
        "bundle per --source, in one commit; the same bundle and content again is a replay; publishes",
        "bundle, content_hash, grid_points, execution {image_ref, image_digest, runtime_contract, "
        "effective_config, input_identity}, files [{name, sha256}], ledger_commit, replayed",
        "REGISTRATION_INVALID (body, design, lineage or an unpublished grid candidate); LINEAGE_MISMATCH (a grid "
        "candidate's parent is not body.parent, or its difference is not the first grid candidate's); "
        "RESEARCH_LINE_REQUIRED (no "
        "open line); LINE_AMBIGUOUS (several open lines and no --line); LINE_ENDED (--line is closed); LINE_UNKNOWN; "
        "INTERPRETATION_REQUIRED (a completed research trial of the line has no interpretation); REVIEW_DUE (5 or "
        "more research trials since the last recommendation); WINDOW_MISMATCH (body.window is not the line's); "
        "SOURCE_PRECHECK_REQUIRED, SOURCE_PRECHECK_FAILED; SOURCE_ALREADY_EXPOSED; RUN_NOT_PASSED, "
        "COMPARABILITY_MISMATCH, ECONOMIC_EVIDENCE_UNAVAILABLE (the control run); DUPLICATE_BUNDLE"),
    ("hypothesis", "compare"): (
        "the registration, the grid run and its control at --at (reader); market daily returns from the run's "
        "market database (a market failure only empties the market measures)",
        "nothing; never publishes",
        "bundle, trial_id, control_trial_id, research_parent, ledger_commit, registered_at, metrics_revision, "
        "catalogue, comparison_source_sha256, availability, evidence (paired daily log difference, intervals, p, "
        "design), attribution (headline, slices, predictions, trade_pairs), limitations; a registration without "
        "a control gives evidence and attribution null with a reason; large (one entry per trade pair)",
        "REGISTRATION_INVALID (no such registration bundle); RUN_NOT_IN_GRID; UNKNOWN_RUN; RUN_NOT_PASSED, "
        "COMPARABILITY_MISMATCH, ECONOMIC_EVIDENCE_UNAVAILABLE (either side); CLOCK_MISMATCH; "
        "COMPARISON_UNAVAILABLE (too few usable days)"),
    ("research", "status"): (
        "trials, runs, registration attempts, source reviews and validations of the whole ledger at --at "
        "(reader); no market",
        "nothing; never publishes",
        "ledger_commit; trials (counted trials of every purpose, ledger-wide); multiple_testing (what a deflated "
        "Sharpe of the line's runs reads: line, window_start, window_end, instruments (those of the line's research "
        "trials), research_trials and all_purpose_trials (counted trials on one of those instruments whose trading "
        "window overlaps the line's, across market commits and lines; all_purpose_trials adds precheck, explore "
        "and validation), runs_with_returns (the overlapping research runs with economic evidence and varying "
        "daily returns), mean_correlation (their mean pairwise daily-return correlation over common days), "
        "effective_trials (rho + (1 - rho) * research_trials, rho the mean correlation floored at 0), "
        "daily_sharpe_variance (the variance of their per-day Sharpe ratios); null without a line or before its "
        "first research trial); excluded_trials {reproductions, stopped_before_strategy} (left out of those counts); "
        "research_attempts and their outcomes (audit_passed, valid, diagnostic_only, invalid, unfinished); "
        "validation {registered, bound, unbound, unwitnessed}; unverified_runs; availability_checker; "
        "metrics_revision; comparison (the line's comparison table: execution_identity (the line's, from its "
        "latest research trial since line select; null before the first), runs [{candidate, trial_id, "
        "execution_identity {runtime_contract, execution, image_digest, key}, measures, dominated_by, "
        "non_dominated}] (dominance only within one identity), candidates (those of the line's identity, which a "
        "recommendation names), without_economic_evidence; null without a line)",
        "REFERENTIAL_GAP (a run or attempt names a missing trial); UNKNOWN_BUNDLE, LINE_CORRUPT (--line); "
        "UNKNOWN_REF (--at)"),
    ("research", "state"): (
        "the line record, targets, judgments, trials and source reviews at --at (reader); whether the active "
        "market database holds the line's market commit (reader)",
        "nothing; never publishes",
        "ledger_commit, line, execution_identity (the line's), targets, open_lines [{bundle, start, window_start, "
        "window_end, market_commit}], recommendation, priority, "
        "review_every, interpretations, search_exposures, unreviewed_trials (of the line's execution identity), "
        "trials_on_line (a count: the line's trials of every identity), gates [{code, message, missing}] "
        "(INTERPRETATION_REQUIRED, REVIEW_DUE, RUNTIME_UNSUPPORTED, MARKET_COMMIT_UNRESOLVED, "
        "RESEARCH_LINE_REQUIRED (no open line), LINE_AMBIGUOUS (several open lines, no --line): reported, not "
        "raised), judgment_history, earlier, facts (candidate list and research status, with --full or without a "
        "line), next_actions (only without a line: `line select`, or --line); line.ledger_commit is the commit "
        "read, not the "
        "line's own; large with --full",
        "LINE_UNKNOWN (--line is no research line); LINE_CORRUPT, LINE_FORMAT_UNSUPPORTED; UNKNOWN_REF (--at)"),
    ("line", "list"): (
        "all research line declarations and closing tags at --at (reader); no market",
        "nothing; never publishes",
        "ledger_commit, lines [{bundle, start, window_start, window_end, market_commit, created_at, closed, versions}] "
        "oldest first; closed is derived from closing tags at the commit read; versions are the candidates its "
        "research graph draws, oldest first",
        "LINE_CORRUPT, LINE_FORMAT_UNSUPPORTED; UNKNOWN_REF (--at)"),
    ("research", "graph"): (
        "the line, its candidates (full sources), trials, reviews and judgments at --at (reader); market daily "
        "returns inside the comparisons",
        "nothing; never publishes",
        "format (research-graph@3), source, scope {ledger_commit, start, end}, line, candidates [{id, parent, "
        "source, trials, comparison, reviews, status, ...}], events, gaps; large (every candidate's source)",
        "RESEARCH_LINE_REQUIRED (no open line); LINE_AMBIGUOUS (several open lines and no --line); UNKNOWN_BUNDLE, "
        "LINE_UNKNOWN (--line); UNKNOWN_REF (--at, --since); "
        "MARKET_UNREACHABLE (other comparison refusals only leave a comparison null)"),
    ("source", "review"): (
        "the candidate and the precheck trial at the head (reader); the runtime image, resolved to its digest; "
        "--items (JSON) and the precheck's original capture (writer)",
        "the bundle source-review-<trial>-<sha16> (source-review.json with the verdict, items and reviewer); the "
        "same content again is a replay; publishes",
        "bundle, candidate, source_sha256, image_digest, precheck_trial, verdict, ledger_commit, replayed",
        "PRECHECK_NOT_FOUND (the trial is no precheck of this source on this image); REVIEW_INVALID (unknown or "
        "missing items; each needs {status: passed|failed|unresolved|no_opportunity, note}; passed only when no "
        "item failed or is unresolved); RUNTIME_UNRESOLVED; UNKNOWN_CANDIDATE, BAD_REF; "
        "PRECHECK_CAPTURE_MISSING"),
    ("validation", "registration"): (
        "--design (JSON); the candidate (writer, head); --market-at in the market database (reader)",
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
        "registration_id, ledger_commit, metrics_revision, registration, witness, binding, availability, "
        "metrics, single, family {size, provisional, missing_p, members [{registration_id, p_one_sided, p_holm, ...}]}, "
        "same_candidate_registrations, limitations (UNWITNESSED, UNBOUND, UNFINISHED, NO_SINGLE_TEST, "
        "FAMILY_PROVISIONAL)",
        "REGISTRATION_UNKNOWN; LEDGER_CORRUPT (the binding names a missing trial); UNKNOWN_REF (--at)"),
    ("replay", "explore"): (
        "--strategy-file; the market at --at (default main), exported into a reused cache under the temporary "
        "directory; the runtime image (a tag is pulled)",
        "an explore trial with its start receipt and execution capture; the new --output directory (source, "
        "reports, audit, fingerprint, process.json); publishes",
        "purpose, status (passed or invalid), problems, path, trial_id, image_ref, market, metrics (unverified), "
        "metrics_note, next_actions; exit 0 even when invalid",
        "ENTRY_CLASS_INVALID; NOT_TEMPORARY_PATH, PATH_EXISTS (--output); RUNTIME_UNAVAILABLE; UNIVERSE_EMPTY; "
        "OUT_OF_SAMPLE_RESERVED (the window overlaps an unbound validation registration of this source); "
        "RUNNER_OPTION_RESERVED"),
    ("replay", "precheck"): (
        "the candidate (reader); the market at --at, exported fresh; the runtime image",
        "a precheck trial with its start receipt and execution capture; the new --output directory; publishes",
        "purpose, trial_id, execution_bundle, source_sha256, image_ref, input_key, config_key, status (passed or "
        "failed), problems, path, metrics, scope, exposure_exemption {trading_days, maximum_exempt_days, "
        "within_window_limit, note}; exit 1 unless passed",
        "BAD_REF, UNKNOWN_CANDIDATE; RUNTIME_NOT_CI_BUILT (no revision label); RUNTIME_CONTRACT_MISMATCH (the "
        "candidate's contract is not the image's); NOT_TEMPORARY_PATH, PATH_EXISTS; UNIVERSE_EMPTY; "
        "OUT_OF_SAMPLE_RESERVED"),
    ("replay", "run"): (
        "the candidate and the registration (writer, head); the market at --at, exported fresh; the runtime image; "
        "the checkout's HEAD (with --validation it must contain origin/main)",
        "the trial with its start receipt and binding (a research registration attempt or a validation binding), "
        "its execution capture, one run row and, when passed, the sealed result, daily returns and cycles; a "
        "working directory under /tmp, removed once stored unless it is the new --output directory, kept as the "
        "run's native report cache (kept and named on stderr after a failure); publishes",
        "purpose, strategy, trial_id, status, failure_reasons, image_ref, ledger_commit, path (with --output); "
        "exit 1 unless passed",
        "REGISTRATION_REQUIRED (not exactly one of --hypothesis, --validation); REGISTRATION_INVALID; "
        "EXECUTION_MISMATCH (window, instruments, image, config or inputs differ from the registration); "
        "SOURCE_MISMATCH (the candidate is not in the grid); SOURCE_PRECHECK_REQUIRED, SOURCE_PRECHECK_FAILED; "
        "GRID_ALREADY_ATTEMPTED; REGISTRATION_TOO_LATE; validation: STALE_CHECKOUT, RUNTIME_NOT_MAIN, "
        "REGISTRATION_CONSUMED, WINDOW_MISMATCH; LINE_ENDED (the registration's line is closed); "
        "NOT_TEMPORARY_PATH, PATH_EXISTS (--output)"),
    ("replay", "report"): (
        "the trial at --at (reader) and, for a sealed run, market daily returns from its market database (a "
        "failure only empties the market measures); --directory or --reproduction files; --directory alone "
        "reads no ledger",
        "nothing; never publishes",
        "source (sealed, precheck or directory) and that report: sealed gives status, audit, populations, "
        "activity, order_funnel, plans, headline, slices, closed_by_year, drawdown, capital, cost_basis, "
        "limitations, availability (performance null without economic evidence), plus tables with --tables, "
        "--account, --exposures, --directory or --reproduction; precheck gives capture, stages, outcome, "
        "runtime_failures, audit, reports, reports_verified; directory is marked unverified",
        "UNKNOWN_RUN (an explore trial or no run); RUN_NOT_PASSED, ECONOMIC_EVIDENCE_UNAVAILABLE (tables); "
        "REPRODUCTION_MISMATCH; DIRECTORY_NOT_FOUND; NATIVE_SUMMARY_MISSING, REPORT_PARSE_FAILED"),
    ("replay", "reproduce"): (
        "the original trial, its run or precheck capture and the candidate (writer, head); the market at the "
        "recorded commit; the recorded image digest; the runner arguments are rebuilt from the record",
        "an explore trial with its start receipt and capture (committed before the fingerprint check); the new "
        "--output directory, kept on a mismatch; publishes on success",
        "directory, trial_id, fingerprints_match (true), reproduction_trial_id",
        "REPRODUCTION_MISMATCH (inputs or config differ: nothing written; fingerprints or sealed facts differ, "
        "or the original has none: the trial is written); UNKNOWN_RUN, UNKNOWN_CANDIDATE; NOT_TEMPORARY_PATH, "
        "PATH_EXISTS; OUT_OF_SAMPLE_RESERVED"),
    ("market", "init"): (
        "the profile directory; a Dolt 2.4.2 binary (RESEARCH_DOLT_BINARY or PATH)",
        "the database with the tables of market/schema.sql (no schema row: the first import writes it), its "
        "import and reader accounts, the Dolt service under --service-root (started when new), the profile file; "
        "never publishes",
        "profile, name, database, kind, service_root, backup, accounts, commit",
        "LEDGER_EXISTS (profile, active market or database exists); ISOLATION_BREACH (--kind active without "
        "--backup-root, or its service or backup in the checkout or a temporary root); INVALID_NAME; DOLT_BINARY; "
        "LEDGER_START"),
    ("market", "backup"): (
        "the market main head (administrator, holding the import lock); the backup's head, read through "
        "linked table files",
        "an incremental dolt_backup sync to <profile backup>/backup; never publishes",
        "market, database, backup_path, market_commit, previous_head",
        "BACKUP_TARGET_UNSET; EXPORT_PATH_INVALID; CONCURRENT_IMPORT; BACKUP_DIVERGED (the backup head is not in "
        "main's history); DOLT_BACKUP"),
    ("market", "review"): (
        "the market main head (reader); the backup's head, read through linked table files",
        "nothing; never publishes",
        "market, database, commit, history, ok, findings (HISTORY_REWRITTEN, BACKUP_UNREADABLE), limitations "
        "(HISTORY_UNCHECKED without a backup); exit 1 when not ok",
        "MARKET_UNREACHABLE; SCHEMA_VERSION_MISMATCH (also a database never imported)"),
    ("market", "import"): (
        "the stored imports, bars, funding and terms (import account, holding the import lock); Binance public "
        "data: exchangeInfo, monthly and daily 1m kline and mark price archives (checked against their "
        "published CHECKSUM and cached under --cache-root), REST fill-ins and funding",
        "bars, funding, instrument terms and the month's universe members (a backfill also the members of the "
        "stored months whose look-back it completes) in one market commit through the commit tests; publishes "
        "the market",
        "month, universe_rule, scope, through, instruments_appended, bar_rows, funding_rows, universe_members, "
        "gaps, source_rows, excluded, inferred_terms, rounded_volumes, derived_findings, per_symbol, "
        "universe_filled (a backfill: the stored months it gave members), market_commit, seconds; progress lines "
        "on stderr",
        "MONTH_INVALID (the first import takes any closed month; after that only the latest month, to extend "
        "it, the month after it once it is complete, or the month just before the earliest (a backfill, insert "
        "only); a skipped month; a month not begun; a first import with no closed UTC day; on the current month's first day the import writes its members only); MONTH_EXISTS (the month is complete, a backfilled "
        "month already holds rows, or stored rows no longer match the sources); IMPORT_SCOPE (--symbols differs "
        "from earlier imports' scope); UNIVERSE_CHANGED (members differ from the stored ones); "
        "CONCURRENT_IMPORT; "
        "DIRTY_WORKING_SET; CHECKSUM_MISMATCH, ARCHIVE_NOT_PUBLISHED, SOURCE_UNREACHABLE"),
    ("market", "import-quotes"): (
        "the month's universe members, each contract's newest stored terms and stored quotes (import account, "
        "holding the import lock): every month, an earlier one included, is inferred with the price increment "
        "observed last, not the one in force that month; Binance daily aggTrades archives of every closed day of the month and the day before it "
        "(checksum-verified, cached under --cache-root)",
        "best bid/ask quote rows inferred from the trades, in one market commit; publishes the market",
        "month, through, quote_rule, symbols, quote_rows, per_symbol, archives (each day's SHA-256), "
        "market_commit, seconds; progress lines on stderr",
        "MONTH_INVALID (not YYYY-MM, after the current month, or no closed UTC day yet; any earlier month is "
        "accepted, in any order); MONTH_EXISTS (a named contract already has quotes in the month, so a partial "
        "month is never extended); MARKET_EMPTY (no bars yet); UNIVERSE_UNKNOWN (the month has no members; "
        "import its bars or name --symbols); TERMS_UNKNOWN; RULE_VERSION_MISMATCH; CONCURRENT_IMPORT"),
    ("market", "import-trades"): (
        "one explicit month of one or more named contracts and their existing complete trades (restricted import "
        "account, one connection per contract written at once while one more holds the same market-import lock); "
        "official daily aggTrades ZIPs and the eve, checksum-verified under --cache-root, downloaded and parsed in "
        "bounded chunks",
        "all eight source fields in agg_trade, one contract month per transaction and commit; a refused contract "
        "leaves the others' commits in place; publishes the market once; "
        "no change to bars, quotes or replay exports",
        "month, imports (one per contract in symbol order: month, through, symbols, codec "
        "(binance-aggtrades-int64-scale8-v1: price and quantity exactly x1e8), trade_rows, archives (daily SHA-256), "
        "readings (daily counts, first/last IDs/times and largest time gap), market_commit, seconds), trade_rows "
        "(all contracts), seconds; publish_seconds when automatic publication runs; daily progress on stderr",
        "MONTH_INVALID (no closed UTC day; any earlier month in any order); IMPORT_SCOPE (a repeated or malformed "
        "symbol); the first refused contract's refusal, naming the commits the others made; "
        "SCHEMA_MISMATCH (run market upgrade); MARKET_EMPTY; MONTH_EXISTS (partial months cannot be extended); "
        "SCALE_LOSS (any value is inexact or outside signed BIGINT: refuse the whole month, no rounding or fallback); "
        "SEQUENCE_GAP (within/between batches, days or eve); SOURCE_SHAPE; CHECKSUM_MISMATCH; ARCHIVE_NOT_PUBLISHED; "
        "RULE_VERSION_MISMATCH; CONCURRENT_IMPORT; DIRTY_WORKING_SET; COMMIT_CHECKS_DISABLED; DATA_TESTS_FAILED"),
    ("market", "import-metrics"): (
        "one explicit month of the named contracts (default: the month's universe members) and the metrics imports "
        "before it (restricted import account, holding the market-import lock); official daily metrics ZIPs, "
        "checksum-verified under --cache-root",
        "sum_open_interest and the three long/short ratios at each create_time in metrics, for each contract the days "
        "of the month after those already held through the last closed UTC day, one transaction and commit per "
        "contract; a refused contract leaves the earlier ones' commits; publishes the market once; no change to bars, "
        "quotes, trades or replay exports",
        "month, imports (one per contract in symbol order: month, from, through (exclusive end day), symbols, archives "
        "(daily SHA-256), readings (daily rows, repeated_rows merged, empty ratios), unpublished (days before the last "
        "published one without an archive; later ones wait for a later import), metrics_rows, market_commit), "
        "metrics_rows (all contracts), seconds; daily progress on stderr",
        "MONTH_INVALID (no closed UTC day); IMPORT_SCOPE; UNIVERSE_UNKNOWN; MONTH_EXISTS (every closed day already "
        "held); ARCHIVE_NOT_PUBLISHED (no day published); SOURCE_SHAPE (header, symbol, a create_time off the "
        "five-minute grid of its day, no open interest, a negative or non-decimal value, two different rows at one "
        "create_time; identical repeats are merged and counted); SCALE_LOSS (a value needs more than 16 decimals or 22 "
        "integer digits: no rounding); the first refused contract's refusal, naming the commits made before it; "
        "SCHEMA_MISMATCH (run market upgrade); MARKET_EMPTY; CHECKSUM_MISMATCH; CONCURRENT_IMPORT; DIRTY_WORKING_SET; "
        "COMMIT_CHECKS_DISABLED; DATA_TESTS_FAILED"),
    ("market", "follow"): (
        "each round: the market's import commits and the newest months' members (reader), the daily archives each "
        "import reads downloaded into --cache-root (bars: the last closed day's klines of every member; metrics; "
        "aggTrades streamed, a month with its eve, outside the import lock), and whether the market is ahead of "
        "origin (administrator)",
        "each round: market import of the bars' months through the last closed UTC day (the database's own scope; a "
        "day is sealed only once every member's daily klines archive is out, or 3 days after it closed); per "
        "contract market import-metrics of each month with days missing; market import-quotes (one contract a call) "
        "and market import-trades (the contracts due that month in one call) of every closed month after the "
        "contract's latest; once a month, each month between a contract's first and latest quotes or aggTrades that "
        "no import holds, when its archives are new to the cache or were republished; then one publish when the "
        "market is ahead of origin; --status marked running at the start and rewritten after every round. A "
        "contract no import holds is never imported; nothing is backfilled before the first month held",
        "nothing until stopped; one JSON line per round on stdout, as written to --status: at, last_closed_day, "
        "kinds {bars {scope}, metrics, quotes, trades {contract}: state (caught_up, waiting, lagging: still missing "
        "3 days after it closed, stopped, unknown), refusal, retry, rows, commits; bars through; metrics "
        "missing_from, missing_days; quotes and trades next_month, skipped, filled}, round_refusal, published, "
        "publish_refusal, publish_failing_since (the first round of the current run of refused publishes), "
        "next_round (an hour later while anything waits or the market is unreadable, else 00:30 UTC of the next "
        "day); import progress on stderr",
        "IMPORT_SCOPE at start. Rounds never exit: ARCHIVE_NOT_PUBLISHED, CONCURRENT_IMPORT, CONCURRENT_WRITE, "
        "MARKET_UNREACHABLE, LEDGER_UNAVAILABLE, MARKET_EMPTY, SOURCE_UNREACHABLE, PUBLISH_FAILED, CHECKSUM_MISMATCH "
        "and (but for bars) MONTH_EXISTS retry next round; a quotes or aggTrades SEQUENCE_GAP downloads the month "
        "again once, then skips the month (a gap on the eve stops the contract's kind instead); DIRTY_WORKING_SET, "
        "SCHEMA_VERSION_MISMATCH, COMMIT_CHECKS_DISABLED, DATA_TESTS_FAILED, the bars' RULE_VERSION_MISMATCH and the "
        "publish refusals PUBLISH_REJECTED, PUBLISH_FORBIDDEN, REMOTE_UNSET and REMOTE_INVALID stop everything; "
        "RULE_VERSION_MISMATCH and SCHEMA_MISMATCH stop their kind; any other refusal or error stops its contract's "
        "kind (for bars, the bars); NO_HISTORY and PARTIAL_MONTH (a latest month held short of its end) stop a "
        "contract's kind; stops last until the process restarts"),
    ("market", "upgrade"): (
        "service.json; the market tables (administrator)",
        "starts the service if needed; holding the import lock, creates the missing tables of market/schema.sql and drops the views "
        "it no longer defines, in one commit (none when nothing changes); publishes the market",
        "database, created, dropped, commit (null when nothing changed)",
        "CONCURRENT_IMPORT (an import or backup holds the import lock); DIRTY_WORKING_SET"),
    ("market", "publish"): (
        "the administrator connection; origin",
        "with --remote: origin and the dolt login key, as ledger publish; pushes main without force, fetches to "
        "check it, then every tag, holding the import lock",
        "database, remote, branch, head, previous_head, tags (count), remote_set",
        "REMOTE_UNSET; REMOTE_MISMATCH; PUBLISH_FORBIDDEN (a non-active database to a non-file remote); "
        "DOLTHUB_CREDENTIALS; CONCURRENT_IMPORT; PUBLISH_REJECTED; PUBLISH_FAILED"),
    ("market", "lifecycle"): (
        "the market commit --at (reader); --manifest and each --notice, validated against that commit before "
        "anything is written",
        "the ledger bundle lifecycle-<market commit> (lifecycle.json and the notices); the same content again is "
        "a replay; publishes the ledger",
        "bundle, market_commit, files {path: sha256}, episodes (count per contract), write_status, ledger_commit",
        "LIFECYCLE_INPUT (a file missing, not regular or not JSON, or the manifest does not fit the commit); "
        "BUNDLE_EXISTS (a different manifest; a correction belongs to a new market commit); "
        "MARKET_COMMIT_UNRESOLVED; SCHEMA_VERSION_MISMATCH (no import yet)"),
    ("market", "coverage"): (
        "bars, mark prices, funding, quotes, instruments and universe members at --at (reader), and the quote "
        "import commits reachable from it; without --symbols, every member of the months [--start, --end) "
        "touches; with --lifecycle-bundle, that ledger bundle",
        "nothing; never publishes",
        "commit, scope {symbols, start, end, expanded}, input_interval_ms, coverage [per contract], lifecycle, "
        "lifecycle_missing, interpretation",
        "INTERVAL_INVALID (not UTC whole minutes, or start not before end); EMPTY_SYMBOLS; UNKNOWN_SYMBOL; "
        "UNKNOWN_REF; LIFECYCLE_INPUT"),
    ("market", "bars"): (
        "bar, funding, instrument and market_schema at --at (reader), through the exporter's own reads "
        "(market.read_bars, market.daily_bars, market.read_funding)",
        "nothing in any database; with --output, one new file under the temporary root; never publishes",
        "commit, symbol, price_type, timeframe, interval {start, end, ms}, next_start, bars {columns, count, rows}, "
        "funding {columns, count, rows}, output",
        "INTERVAL_INVALID (not UTC whole minutes, start not before end; 1d: not whole UTC days); NO_TERMS (no such "
        "contract at the commit); UNKNOWN_REF; NOT_TEMPORARY_PATH, PATH_EXISTS (--output); USAGE_ERROR (1d with "
        "MARK)"),
    ("paper", "start"): (
        "the candidate (reader); this ledger's paper containers on Docker; the runtime image (a tag is pulled); "
        "the market commit --at (default main) and its current-month membership",
        "one paper_run row; the run directory <service>/paper/<database>/<paper_id> (source, membership); an "
        "internal Docker network with the runner and the egress proxy, left running (the command returns at "
        "once); the same --op-id again is a replay; publishes",
        "paper_id, candidate, source_sha256, image_ref, symbols, market_commit, directory, containers, "
        "ledger_commit, write_status (a replay gives paper_id, write_status, directory)",
        "PAPER_RUN_ACTIVE (this source already runs); PAPER_CONCURRENCY_LIMIT (4 running); EMPTY_SYMBOLS; "
        "UNKNOWN_CANDIDATE, BAD_REF; RUNTIME_UNAVAILABLE; LEDGER_UPGRADE_REQUIRED (no paper_run table); "
        "PAPER_START_FAILED (the containers did not start; the run is sealed invalid, write_status written)"),
    ("paper", "stop"): (
        "the paper run (reader); its runner container",
        "a STOP file for the runner (it cancels its orders and writes its summary), then SIGTERM after "
        "--wait-seconds and SIGKILL 30 s later; then seals as paper seal",
        "as paper seal",
        "PAPER_RUN_UNKNOWN; as paper seal"),
    ("paper", "seal"): (
        "the paper run and its seal (reader); its run directory (journal, summary, egress log) and runner log",
        "the bundle paper-<id>-capture (the journal by UTC day, summary, logs, seal.json), then removes the "
        "containers and network; an existing seal stands and is returned (write_status replayed); publishes",
        "paper_id, bundle, files {path: sha256}, seal (status complete or invalid, reasons, returns, drawdown, "
        "funding, fills, orders, gaps, limitations), ledger_commit, write_status",
        "PAPER_RUN_UNKNOWN; PAPER_RUN_ACTIVE (still running: stop it first); RUNTIME_UNAVAILABLE"),
    ("paper", "delete"): (
        "the paper run and its seal (service administrator, as the writer may not delete)",
        "removes the sealed run's paper_run row, its bundle paper-<id>-capture and the contents no other bundle names "
        "in one commit paper_delete:<id> on the research branch, then its run directory; Dolt history, the backup "
        "and the public copy keep them, and ledger review accepts exactly this deletion; the user's own action "
        "(an Agent asks first); publishes",
        "paper_id, bundle, contents_deleted, ledger_commit, write_status",
        "PAPER_RUN_UNKNOWN; PAPER_RUN_ACTIVE (not sealed: stop or seal it first); DIRTY_WORKING_SET; "
        "COMMIT_CHECKS_DISABLED"),
    ("paper", "list"): (
        "every paper run and its seal (reader); this ledger's paper containers on Docker",
        "nothing itself; not a declared read command, so it publishes the ledger when origin is behind it",
        "runs [{paper_id, candidate, source_sha256, symbols, state (running, ended, unsealed or sealed), "
        "created_at, image_ref, status, reasons, total_return, max_drawdown}], running, limit",
        "RUNTIME_UNAVAILABLE (docker did not answer)"),
    ("paper", "serve"): (
        "the paper runs, their seals and a candidate's last research replay (reader); each run's directory and "
        "capture bundle; this ledger's paper containers on Docker",
        "nothing itself: a start, stop, seal or delete from the page, the seal of a run that ended on its own and "
        "a new start of one Docker stopped from outside (SIGTERM, no STOP file), run paper start, stop, seal or "
        "delete (their writes)",
        "nothing until stopped; over HTTP on loopback (inside a container, on its own address), /api/paper/ lists "
        "the runs, streams a run's journal and readings, and answers a start or stop with that command's result",
        "USAGE_ERROR (a --host that is not loopback outside a container; inside one, no usable TMPDIR); over HTTP: "
        "FORBIDDEN (a Host or origin not allowed), NOT_FOUND, USAGE_ERROR (a bad body), NO_LAST_REPLAY, and the "
        "start, stop and seal refusals"),
    ("paper", "reconcile"): (
        "the sealed paper run, its candidate and its capture (reader); the market at --at (default main), exported "
        "into a reused cache under the temporary directory; the run's own runtime image",
        "nothing in any database (no trial, no exposure); the new --output directory (replay/ with the native "
        "reports and audit, reconcile.json); never publishes",
        "path, summary {paper_fills, replay_fills, same, price, quantity, time, paper_only, replay_only, "
        "look_ahead_suspects, missing_bars, differing_bars, late_bars, equity_max_difference}, replay {status, "
        "problems, path}",
        "PAPER_RUN_UNKNOWN; PAPER_RUN_ACTIVE (not sealed); PAPER_RECONCILE_EMPTY (no interval); "
        "PAPER_RECONCILE_UNCOVERED (the market lacks the interval's minutes); NOT_TEMPORARY_PATH, PATH_EXISTS "
        "(--output); RUNTIME_UNAVAILABLE"),
}


def _parser() -> Parser:
    parser = Parser(prog="python -m cli.main", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    nouns = parser.add_subparsers(dest="noun", required=True, parser_class=Parser)
    groups = {}

    def verbs(name: str, help_text: str):
        noun = nouns.add_parser(name, help=help_text, description=help_text)
        groups[name] = noun.add_subparsers(dest="verb", required=True, parser_class=Parser)
        return groups[name]

    def verb(group, name: str, help_text: str, epilog: str | None = None):
        return group.add_parser(name, help=help_text, description=help_text, epilog=epilog,
                                formatter_class=argparse.RawDescriptionHelpFormatter)

    def runner(group, name: str, help_text: str):
        return verb(group, name, help_text, RUNNER_EPILOG)

    ledger = verbs("ledger", "the research ledger: init, upgrade, service, temp, sql, witness, review, export, "
                             "publish")
    command = verb(ledger, "init", "initialize a new research ledger profile")
    command.add_argument("--name", required=True, help="profile name; the database is the name with - as _")
    command.add_argument("--kind", required=True, choices=db.KINDS, help="active, isolated or temporary")
    command.add_argument("--service-root", required=True, type=Path, help="directory of the Dolt service")
    command.add_argument("--research-branch", default="main", help="the branch research writes go to (default: main)")
    command.add_argument("--backup-root", type=Path, help="dolt_backup directory (required for --kind active)")
    command = verb(ledger, "service", "start, stop or read the ledger's database service; run it under compose")
    command.add_argument("action", choices=("start", "stop", "status", "check", "run"),
                         help="start, stop or status; check (both databases readable); run (the compose service)")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--service-root", type=Path, help="run: the service directory")
    command.add_argument("--data-dir", type=Path, help="run: the Dolt data directory (a volume under compose)")
    command.add_argument("--backup-root", type=Path, help="run: the directory holding each database's backup")
    command.add_argument("--credentials", type=Path, help="run: a `dolt login` ~/.dolt holding the DoltHub key")
    command.add_argument("--research-origin", help="run: the public copy the ledger is cloned from on first start")
    command.add_argument("--market-origin", help="run: the public copy the market is cloned from on first start")
    command.add_argument("--port", type=int, default=13330, help="run: the port to listen on (default: 13330)")
    command.add_argument("--readers", type=Path, help="run: a directory for the reader-only service.json of "
                         "containers that only read")
    command = verb(ledger, "temp", "an isolated temporary ledger under the temporary root")
    command.add_argument("--root", help="new directory under the temporary root (default: a fresh one)")
    command = verb(ledger, "sql", "one read-only query with the reader account")
    _ledger_option(command)
    command.add_argument("query", help="one SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, TABLE or VALUES statement")
    _at(command)
    command = verb(ledger, "witness", "timestamp out-of-sample registrations without a witness")
    _ledger_option(command)
    command.add_argument("--tsa-url", help="RFC 3161 timestamp authority URL (default: the built-in one)")
    command = verb(ledger, "review", "the whole review at one exact version")
    _ledger_option(command)
    _at(command)
    command = verb(ledger, "export", "full-history backup and reproduction manifest")
    _ledger_option(command)
    command.add_argument("--kind", required=True, choices=("reproduce", "backup"),
                         help="reproduce: into a new --output directory; backup: sync to the profile's backup")
    command.add_argument("--output", help="new directory (required for --kind reproduce)")
    _at(command)
    command.add_argument("--trial-id", type=int, action="append", dest="trial_ids",
                         help="a run to list in the manifest (repeatable; default: every run)")
    command = verb(ledger, "publish", "push the ledger to its public DoltHub copy (administrator)")
    command.epilog = ("Pushes the research branch, checks the remote head by a fetch, then pushes every tag. Never "
                      "forces: a remote changed elsewhere is PUBLISH_REJECTED. Commands that change the ledger "
                      "publish it themselves; this reruns a failed publish. --remote names origin once and installs "
                      "the `dolt login` key in the service's Dolt home.")
    _ledger_option(command)
    command.add_argument("--remote", help="the DoltHub repository URL, set once "
                                          "(https://doltremoteapi.dolthub.com/<owner>/<repository>)")
    command = verb(ledger, "upgrade", "add the tables this product version writes (administrator)")
    command.epilog = ("Creates the tables and triggers of ledger/schema.sql the research branch lacks, in one commit "
                      "through the commit checks. Existing tables, rows, accounts and grants are untouched.")
    _ledger_option(command)

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
    command.add_argument("--kind", required=True, choices=judgments.KINDS,
                         help="recommendation, priority, interpretation or search_exposure")
    command.add_argument("--line", required=True, help="research line bundle, research-line-<YYYYMMDD>-<slug>")
    command.add_argument("--based-on", required=True, help="the ledger commit the judgment reads")
    command.add_argument("--body", required=True, help="UTF-8 text file")
    command.add_argument("--subject", action="append", dest="subjects", default=[],
                         help="role=ROLE,candidate=ID@N | trial=N | registration=BUNDLE (repeatable; "
                              + SUBJECT_ROLES_HELP + ")")
    command.add_argument("--supersedes", type=int, help="the judgment ID this one replaces")
    _op_id(command)

    line = verbs("line", "research lines: list, select, targets, close")
    command = verb(line, "list", "list all historical and open research lines")
    _ledger_option(command)
    _at(command)
    command = verb(line, "select", "record the user's research line")
    command.epilog = ("One record per choice: a later change of start, window or market commit is a new line "
                      "record, never an edit. The UTC date and --slug name the line and its closing tag.")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--start", required=True,
                         help="start candidate as ID@N; a revision whose source review passed")
    command.add_argument("--window-start", required=True, help="development window start, YYYY-MM-DD UTC")
    command.add_argument("--window-end", required=True, help="development window end (exclusive), YYYY-MM-DD UTC")
    command.add_argument("--market-at", help="market commit, tag or branch to pin (default: main)")
    command.add_argument("--note", help="the user's context for the line")
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
    command = verb(line, "close", "end a line by tagging the research head with its summary")
    _ledger_option(command)
    command.add_argument("--line", required=True, help="an open line research state lists under open_lines")
    command.add_argument("--summary", required=True,
                         help="UTF-8 text file (at most 32 KB), the index later research searches: the direction, "
                              "what was tried, results with their run IDs, failures and why, lessons and advice; "
                              "numbers stay in the reports")

    registration = verbs("registration", "registrations: add")
    command = runner(registration, "add", "lock a registration")
    command.epilog = textwrap.fill(
        "Locks the body and its runtime and input identity as an immutable bundle; the runner arguments must "
        "match replay run. body.prechecks binds each grid candidate's passed source review. The body has no "
        "change: the stored body takes it from the grid candidates' --difference. Changing source, "
        "intent or grid needs a new registration; a consumed point is retried by a new one naming it in "
        "retry_of.", 100) + "\n\n" + RUNNER_EPILOG
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--bundle", required=True, help="new bundle name, registration-*")
    command.add_argument("--body", required=True, help="JSON body file; templates in "
                                                       ".agents/skills/research-round/templates/registration-*.json")
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP)
    command.add_argument("--line", help="the open research line to register on (default: the only open line)")
    command.add_argument("--source", action="append", default=[], help="a source original file (repeatable)")

    hypothesis = verbs("hypothesis", "registered hypotheses: compare")
    command = verb(hypothesis, "compare", "a grid run against its registered control")
    _ledger_option(command)
    command.add_argument("--bundle", required=True, help="registration bundle, registration-*")
    command.add_argument("--trial-id", required=True, type=int, help="a grid run of that registration")
    _at(command)

    research = verbs("research", "research facts: status, state, graph")
    command = verb(research, "status", "research fact counts and the line's comparison table")
    _ledger_option(command)
    command.add_argument("--line", help="research line bundle of the comparison table (default: the only open "
                                         "line)")
    _at(command)
    command = verb(research, "state", "the line record and its current judgments with read-time facts")
    _ledger_option(command)
    command.add_argument("--line", help="research line bundle (default: the only open line)")
    command.add_argument("--history", action="store_true",
                         help="include up to 20 original judgments, newest first, including superseded text and subjects")
    command.add_argument("--history-before", type=int,
                         help="include the next history page before this judgment ID (use next_before; implies --history)")
    command.add_argument("--full", action="store_true",
                         help="every current interpretation and search exposure, and the candidate list and research "
                              "status as facts (default: those after the current recommendation, earlier ones counted)")
    _at(command)
    command = verb(research, "graph", "the line as a research-graph@3 document, read from the ledger only")
    command.epilog = ("Composes the product's readers and adds no rule, so one ledger commit gives one graph. The "
                      "targets are the ones in force for the line at that commit (`line targets`); --since marks "
                      "where the scope under study starts. Check, render and compare it with "
                      "ide/ide.py. Writes nothing.")
    _ledger_option(command)
    command.add_argument("--line", help="research line bundle (default: the only open line)")
    command.add_argument("--since", help="ledger commit where the scope under study starts")
    command.add_argument("--workers", type=_workers, default=min(8, os.cpu_count() or 1),
                         help="processes computing the comparisons (default: 8 or the CPU count if fewer; 1 runs "
                              "them in this process); the graph is the same")
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
    command.add_argument("--market-at", help="market commit, tag or branch (default: main)")
    command.add_argument("--design", required=True, help="JSON file of the validation design")
    command.add_argument("--retry-of", type=int,
                         help="a bound interrupted, invalid or economically unavailable registration; keep its "
                              "candidate, window, universe rule and original test design")
    _op_id(command)
    command.add_argument("--tsa-url", help="RFC 3161 timestamp authority URL (default: the built-in one)")
    command = verb(validation, "report", "the out-of-sample report of a registration")
    command.epilog = ("The same measures and masking as development reports, with intervals, p and the Holm "
                      "correction over the window's registrations; no verdict.")
    _ledger_option(command)
    command.add_argument("--registration-id", required=True, type=int, help="validation registration ID")
    _at(command)

    replay = verbs("replay", "replays: explore, precheck, run, report, reproduce")
    command = runner(replay, "explore", "replay an unpublished strategy file (not evidence)")
    command.epilog = textwrap.fill(
        "Records an explore trial in the ledger; the replay counts as prior exposure of that source and is never "
        "economic evidence.", 100) + "\n\n" + RUNNER_EPILOG
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
        "with matching execution identity; other prior replays can still expose the source. A precheck that failed "
        "in the load or inputs stage, before any market data reached the strategy, is no exposure.", 100) + "\n\n" \
        + RUNNER_EPILOG
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--at", required=True, help="market commit, tag or branch")
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP)
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command = runner(replay, "run", "a sealed research or validation replay (runner arguments as registered)")
    command.epilog = textwrap.fill(
        "With --output the run's working directory stays as a cache of its native reports: replay report --trial-id "
        "N --directory DIR reads its orders, fills, account and order events after checking every report file "
        "against the run's sealed capture. Without it they come only from replay reproduce, which records an "
        "explore trial.", 100) + "\n\n" + RUNNER_EPILOG
    _ledger_option(command)
    _market_option(command)
    _at(command, "market")
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP)
    command.add_argument("--hypothesis", help="registration bundle, registration-* (or --validation)")
    command.add_argument("--validation", type=int, help="validation registration ID (or --hypothesis)")
    command.add_argument("--output", help="new directory under the temporary root that keeps the run's native "
                                          "reports as a cache (read with replay report --directory)")
    command = verb(replay, "report", "a sealed result, precheck technical facts/cache, or unverified directory")
    command.epilog = ("For a precheck, --directory verifies its original cache; for a run, the directory replay run "
                      "--output kept. When the cache is lost, run replay reproduce and pass its --reproduction "
                      "directory and --reproduction-trial; a reproduction never replaces the original's failures.")
    _ledger_option(command)
    command.add_argument("--trial-id", type=int, help="trial holding a sealed result or original precheck")
    command.add_argument("--directory", help="original cache with --trial-id (a precheck's, or the one replay run "
                                             "--output kept); otherwise an unverified directory")
    _at(command)
    command.add_argument("--tables", action="store_true", help="add the drill-down tables")
    command.add_argument("--reproduction", help="the directory `replay reproduce` wrote")
    command.add_argument("--reproduction-trial", type=int, help="the reproduction_trial_id `replay reproduce` returned")
    command.add_argument("--account", action="store_true", help="add the native account table")
    command.add_argument("--exposures", action="store_true", help="add the capital exposures table")
    command = verb(replay, "reproduce", "regenerate a sealed result's or precheck's reports into /tmp, "
                                                  "recording an explore trial")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--trial-id", required=True, type=int, help="original trial holding a result or precheck")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command.epilog = ("Records an explore trial in the ledger. "
                      "Hands over the directory only when its semantic fingerprint equals the recorded one. "
                      "Identically reproducing the precheck a registration cites adds no exposure; any other "
                      "reproduction or exploration of a source counts as its prior exposure.")

    market = verbs("market", "market data: init, upgrade, import, import-quotes, import-trades, import-metrics, "
                             "follow, lifecycle, coverage, bars, backup, review, publish")
    command = verb(market, "init", "create an empty market database and its profile")
    command.add_argument("--name", required=True, help="profile name; the database is the name with - as _")
    command.add_argument("--kind", required=True, choices=("active", "isolated", "temporary"),
                         help="active, isolated or temporary")
    command.add_argument("--service-root", required=True, help="directory of the Dolt service")
    command.add_argument("--backup-root", type=Path, help="dolt_backup directory (required for --kind active)")
    command = verb(market, "backup", "sync the market database's history to its backup directory")
    _market_option(command)
    command = verb(market, "review", "check that the market backup's head is an ancestor of main")
    _market_option(command)
    command = verb(market, "import", "import one month as one market commit")
    _market_option(command)
    command.add_argument("--month", required=True, help="UTC month, YYYY-MM")
    command.add_argument("--cache-root", help="download cache directory (default: trade-market-cache in the temporary directory)")
    command.add_argument("--workers", type=int, default=4, help="parallel import processes (default: 4)")
    command.add_argument("--symbols", nargs="+",
                         help="engineering allowlist for an isolated market database; every import of a database "
                              "keeps the same scope")
    command = verb(market, "import-quotes", "import one month of inferred best bid/ask as one market commit")
    _market_option(command)
    command.add_argument("--month", required=True, help="UTC month, YYYY-MM")
    command.add_argument("--cache-root", help="download cache directory (default: trade-market-cache in the temporary directory)")
    command.add_argument("--workers", type=int, default=4, help="parallel archive downloads (default: 4)")
    command.add_argument("--symbols", nargs="+", help="contracts (default: the month's universe members)")
    command = verb(market, "import-trades", "import one month of complete source aggTrades per contract, one commit each")
    _market_option(command)
    command.add_argument("--month", required=True, help="UTC month, YYYY-MM")
    command.add_argument("--symbols", required=True, nargs="+", help="USD-M perpetual contracts, written at once")
    command.add_argument("--cache-root", help="download cache (default: trade-market-cache in the temporary directory)")
    command = verb(market, "import-metrics", "import the days of one month of open interest and long/short ratios "
                                               "not yet held, one commit per contract")
    _market_option(command)
    command.add_argument("--month", required=True, help="UTC month, YYYY-MM")
    command.add_argument("--symbols", nargs="+", help="contracts (default: the month's universe members)")
    command.add_argument("--cache-root", help="download cache (default: trade-market-cache in the temporary directory)")
    command = verb(market, "follow", "keep the bars, and the named contracts' metrics, quotes and complete "
                                      "aggTrades, imported and published, until stopped")
    _market_option(command)
    command.add_argument("--symbols", required=True, nargs="+",
                         help="contracts whose metrics, quotes and aggTrades to keep (each already imported once)")
    command.add_argument("--cache-root", help="download cache (default: trade-market-cache in the temporary directory)")
    command.add_argument("--status", help="status file rewritten every round (default: market-import/status.json "
                                          "in the temporary directory)")
    command.epilog = ("Imports through market import, import-metrics, import-quotes and import-trades and publishes "
                      "as market publish does; adds no import rule. Bars follow the database's own scope. The first "
                      "round starts 5 minutes after start. The healthcheck is market.follow.check(): unhealthy while "
                      "anything is stopped, lagging or unknown, or the status is older than 26 hours; skipped months "
                      "are not.")
    command = verb(market, "upgrade", "create the market tables the database lacks and drop views the schema no longer "
                                     "defines (administrator)")
    _market_option(command)
    command = verb(market, "publish", "push the market database to its public DoltHub copy (administrator)")
    command.epilog = ("Holds the import lock, pushes main, checks the remote head by a fetch, then pushes every tag; "
                      "never forces. Imports and upgrades publish themselves; this reruns a failed publish.")
    _market_option(command)
    command.add_argument("--remote", help="the DoltHub repository URL, set once")
    command = verb(market, "lifecycle", "write the lifecycle bundle of a market commit")
    _ledger_option(command)
    _market_option(command)
    _at(command, "market")
    command.add_argument("--manifest", required=True, help="lifecycle.json (native-lifecycle-v1)")
    command.add_argument("--notice", action="append", dest="notices", default=[], help="an exchange notice it cites")
    _op_id(command)
    command = verb(market, "coverage", "per-contract coverage facts at a market commit", COVERAGE_EPILOG)
    _market_option(command)
    _at(command, "market")
    command.add_argument("--symbols", nargs="+", help="Binance symbols (default: every universe member in the window)")
    command.add_argument("--start", required=True, help="input interval start, UTC ISO-8601 with Z")
    command.add_argument("--end", required=True, help="input interval end, UTC ISO-8601 with Z")
    _ledger_option(command)
    command.add_argument("--lifecycle-bundle", help="lifecycle-<commit> bundle to add lifecycle episodes (needs --ledger)")

    command = verb(market, "bars", "one contract's stored bars and funding at a market commit", BARS_EPILOG)
    _market_option(command)
    _at(command, "market")
    command.add_argument("--symbol", required=True, help="one Binance symbol such as BTCUSDT")
    command.add_argument("--price-type", choices=("LAST", "MARK"), default="LAST",
                         help="LAST trade bars or MARK price bars (default: LAST; 1d is LAST only)")
    command.add_argument("--timeframe", choices=("1m", "1d"), default="1m",
                         help="1m stored minutes or 1d derived daily bars (default: 1m)")
    command.add_argument("--start", required=True, help="interval start, UTC ISO-8601 with Z")
    command.add_argument("--end", required=True, help="interval end (exclusive), UTC ISO-8601 with Z")
    command.add_argument("--limit", type=_count, default=1440,
                         help="most bar periods returned inline (default: 1440, one day of minutes)")
    command.add_argument("--output", help="new JSON file under the temporary root for the whole interval")

    paper = verbs("paper", "paper runs on live public market data with simulated fills: start, stop, seal, delete, list, "
                           "reconcile, serve")
    command = verb(paper, "start", "declare a paper run of a candidate and start its containers")
    command.epilog = textwrap.fill(
        "Binance public market data and Nautilus Sandbox fills only, no credential (engine.paper); the runner "
        "reaches the network only through an egress proxy that admits Binance's public USD-M hosts. Membership "
        "is the current month's at the market commit. Paper runs add no trial count and no exposure.", 100)
    _ledger_option(command)
    _market_option(command)
    _at(command, "market")
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    scope = command.add_mutually_exclusive_group(required=True)
    scope.add_argument("--symbols", nargs="+", help="Binance symbols such as BTCUSDT")
    scope.add_argument("--universe", choices=("pool",), help="every member of the current month")
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP)
    command.add_argument("--memory", default="4g", help="the runner container's memory limit (default: 4g)")
    command.add_argument("--duration-seconds", type=int, help="stop after this long (engineering trials)")
    _op_id(command)
    command = verb(paper, "stop", "stop a running paper run and seal it")
    _ledger_option(command)
    command.add_argument("--paper-id", required=True, type=int, help="paper run ID")
    command.add_argument("--wait-seconds", type=int, default=60, help="seconds the runner gets to cancel its orders "
                                                                      "and write its summary before it is killed")
    command = verb(paper, "seal", "seal an ended paper run into the ledger")
    _ledger_option(command)
    command.add_argument("--paper-id", required=True, type=int, help="paper run ID")
    command = verb(paper, "delete", "delete a sealed paper run from the ledger (the user's own action)")
    command.epilog = textwrap.fill(
        "Deleting a run is the user's decision, never an Agent's own (AGENTS.md). The run leaves the research branch "
        "in one commit by the service administrator; Dolt history, the backup and the public copy keep it.", 100)
    _ledger_option(command)
    command.add_argument("--paper-id", required=True, type=int, help="paper run ID")
    command = verb(paper, "list", "every paper run with its state and seal readings")
    _ledger_option(command)
    command = verb(paper, "reconcile", "replay a sealed paper run on the archive and compare it order by order")
    command.epilog = textwrap.fill(
        "The replay takes the run's source, runtime image, contracts and the interval its runner received bars for; "
        "only the market commit is chosen here. It is no trial and adds no exposure; nothing reaches the ledger "
        "(paper.reconcile).", 100)
    _ledger_option(command)
    _market_option(command)
    _at(command, "market")
    command.add_argument("--paper-id", required=True, type=int, help="paper run ID")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command.add_argument("--timeout-seconds", type=float, help="stop the replay after this long")
    command = verb(paper, "serve", "serve the ledger's paper runs to the trade IDE's Paper panel")
    command.epilog = ("Listens on loopback only, or inside a container on its own address with TMPDIR a host directory "
                      "mounted at its own path (paper.serve); the IDE service reaches it with --paper. Starts, stops and "
                      "seals run this command line, and runs that end on their own are sealed as they are found; one that "
                      "Docker stopped from outside starts again as a new run of the same contracts.")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--host", default="127.0.0.1",
                         help="address to listen on: loopback, or inside a container 0.0.0.0")
    command.add_argument("--port", type=int, default=8767)
    command.add_argument("--allow-host", action="append", default=[], dest="hosts",
                         help="Host header a request may carry (default: 127.0.0.1, localhost and "
                              "host.docker.internal at PORT); repeatable")
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP + " for the runs it starts")

    for noun_name, group in groups.items():
        for verb_name, command in group.choices.items():
            notes = command.epilog  # a one-paragraph note is wrapped here; a formatted one keeps its lines
            notes = textwrap.fill(notes, 100) if notes and "\n" not in notes else notes
            contract = CONTRACTS.get((noun_name, verb_name))
            command.epilog = "\n\n".join(part for part in (_contract(*contract) if contract else None, notes) if part)
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
    if key == ("market", "import-quotes"):
        return market_import_quotes(market_profile(args.market), args.month, args.cache_root, args.workers,
                                    args.symbols), 0
    if key == ("market", "import-trades"):
        return market_import_trades(market_profile(args.market), args.month, args.cache_root, args.symbols), 0
    if key == ("market", "import-metrics"):
        return market_import_metrics(market_profile(args.market), args.month, args.cache_root, args.symbols), 0
    if key == ("market", "follow"):
        return market_follow(market_profile(args.market), args.symbols, args.cache_root, args.status), 0
    if key == ("market", "upgrade"):
        return market_upgrade(market_profile(args.market)), 0
    if key == ("market", "publish"):
        return market_publish(market_profile(args.market), args.remote), 0
    if key == ("market", "coverage"):
        return market_coverage(market_profile(args.market), args.at, args.symbols, args.start, args.end, args.ledger,
                               args.lifecycle_bundle), 0
    if key == ("market", "bars"):
        return market_bars(market_profile(args.market), args.at, args.symbol, args.price_type, args.timeframe,
                           args.start, args.end, args.limit, args.output), 0
    if key == ("replay", "reproduce"):
        from cli import replay as cli_replay
        return cli_replay.replay_reproduce(ledger_profile(args.ledger), market_profile(args.market), args.trial_id,
                                           args.output), 0
    if key == ("ledger", "service") and args.action in ("run", "check"):
        from cli import service
        if args.action == "check":
            return service.check(ledger_profile(args.ledger), market_profile(args.market)), 0
        if not (args.service_root and args.data_dir and args.backup_root):
            raise refuse("USAGE_ERROR", "ledger service run needs --service-root, --data-dir and --backup-root")
        return service.run(args.service_root, args.data_dir, args.backup_root, args.credentials,
                           {service.LEDGER: args.research_origin, service.MARKET: args.market_origin}, args.port,
                           args.readers)
    profile = ledger_profile(args.ledger)
    if key == ("ledger", "upgrade"):
        return db.upgrade(profile), 0
    if key == ("ledger", "publish"):
        return ledger_publish(profile, args.remote), 0
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
    if key == ("line", "list"):
        from report import graph
        return graph.line_list(profile, args.at), 0
    if key == ("line", "select"):
        market = market_profile(args.market)
        with db.connect(profile, "writer") as conn:
            return line_select(conn, market, args.start, args.window_start, args.window_end, args.market_at,
                               args.note, args.slug, _targets(args)), 0
    if key == ("line", "targets"):
        with db.connect(profile, "writer") as conn:
            line_bundle = None if args.default else lines.open_line(conn, args.line)["bundle"]
            return targets.set_targets(conn, line_bundle, args.max_drawdown, args.annual_return), 0
    if key == ("line", "close"):
        return lines.close_line(profile, args.line, _regular_file(args.summary, "LINE_SUMMARY_INVALID")), 0
    if key == ("registration", "add"):
        return registration_add(profile, args.bundle, args.body, args.runtime, market_profile(args.market),
                                runner_argv, args.source, args.line), 0
    if key == ("hypothesis", "compare"):
        return hypothesis_compare(profile, args.bundle, args.trial_id, args.at), 0
    if key == ("research", "status"):
        return research_status(profile, args.at, args.line), 0
    if key == ("research", "state"):
        with db.connect(profile, "reader") as conn:
            return research_state(conn, args.line, args.at, history=args.history,
                                  history_before=args.history_before, full=args.full), 0
    if key == ("research", "graph"):
        from report import graph
        return graph.research_graph(profile, args.line, args.at, since=args.since, workers=args.workers), 0
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
                           args.hypothesis, args.validation, args.output)
        return found, 0 if found.get("status") == "passed" else 1
    if key == ("replay", "report"):
        return replay_report(profile, args.trial_id, args.directory, args.at, args.tables, args.reproduction,
                             args.reproduction_trial, args.account, args.exposures), 0
    if key == ("market", "lifecycle"):
        return market_lifecycle(profile, market_profile(args.market), args.at, args.manifest, args.notices,
                                args.op_id), 0
    if args.noun == "paper":
        from paper import runs as paper_runs
        if args.verb == "start":
            return paper_runs.start(profile, market_profile(args.market), args.at, args.candidate,
                                    None if args.universe else args.symbols, args.runtime, args.memory,
                                    args.duration_seconds, args.op_id), 0
        if args.verb == "stop":
            return paper_runs.stop(profile, args.paper_id, args.wait_seconds), 0
        if args.verb == "seal":
            return paper_runs.seal(profile, args.paper_id), 0
        if args.verb == "delete":
            return paper_runs.delete(profile, args.paper_id), 0
        if args.verb == "list":
            return paper_runs.listing(profile), 0
        if args.verb == "reconcile":
            from paper import reconcile
            return reconcile.reconcile(profile, market_profile(args.market), args.at, args.paper_id, Path(args.output),
                                       args.timeout_seconds), 0
        if args.verb == "serve":
            from paper import serve
            serve.serve(args.ledger, args.market, args.host, args.port, args.hosts, Path(__file__).resolve().parents[1],
                        args.runtime)
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
        result = _publish_after(args, result)
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
