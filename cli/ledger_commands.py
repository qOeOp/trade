"""ledger: the research ledger's administration and reads (init, service, temp, sql, witness, review, export,
publish, mirror, sync)."""

from __future__ import annotations

from decimal import Decimal
import hashlib
import os
from pathlib import Path
import re
import secrets
import shutil
import tempfile

import pymysql

from cli.common import Kind, UsageError, _at, _ledger_option
from ledger import admin, db, witness
from ledger import publish as publication
from shared import paths, profiles
from shared.errors import Refusal
from shared.refusals import refuse


NOUNS = ("ledger",)


# `ledger sql` statement kinds: reads only. The reader account on a pinned revision database is the
# write boundary; this first-word check keeps statements such as SET PERSIST off the reader path (any
# account could run it on Dolt 2.4.2; 2.7.2 asks for SUPER, measured 2026-11-11), and nothing inside a
# read is scanned for keywords.
READ_FIRST = ("SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH", "TABLE", "VALUES")


def ledger_init(name: str, kind: Kind, service_root: Path, backup_root: Path | None = None,
                holds: str = "research") -> dict:
    """ledger init: a new research ledger or Paper database profile (database = the profile name with - as
    _), its accounts and branch grant; administration happens only here."""
    database = name.replace("-", "_") if isinstance(name, str) else name
    created = db.init(name, database, Path(service_root), kind, backup_root, holds=holds)
    profile = created["profile"]
    with db.read_as_of(profile) as conn:
        version = conn.rows("SELECT version FROM ledger_schema WHERE singleton = 1")
        head = conn.rows("SELECT seq, op_id FROM ledger_head WHERE singleton = 1")
        commit = conn.resolved_commit
    if version != [(db.SCHEMAS[holds][1],)] or [tuple(row) for row in head] != [(0, "schema")]:
        raise refuse("LEDGER_CORRUPT", f"ledger {name} does not read back as initialized", missing=(name,))
    accounts = (db._service(profile.service_root) or {}).get("databases", {}).get(profile.database, {})
    return {"profile": str(profiles.home() / f"{name}.json"), "name": name, "database": profile.database,
            "kind": profile.kind, "holds": profile.holds, "service_root": str(profile.service_root),
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
                "branch": db.BRANCH, "ledger_commit": commit}
    address = db.address(config) if config is not None else None
    try:
        with db.read_as_of(profile) as conn:
            commit = conn.resolved_commit
        published = publication.state(profile)
    except Refusal:
        return {"action": action, "running": False, "address": address}
    return {"action": action, "running": True, "pid": db._pid(profile.service_root),
            "address": address, "branch": db.BRANCH, "ledger_commit": commit, **published}


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
    profile = db.profile(created["profile"])
    status = ledger_service(profile, "status")
    return {"profile": created["profile"], "root": str(root_path), "address": status.get("address"),
            "accounts": created["accounts"], "ledger_commit": status.get("ledger_commit") or created["ledger_commit"]}


# Strings, quoted names and comments in one left-to-right pass, as the server lexes them: whichever starts
# first owns the text to its end, so a quote inside a comment or a comment marker inside a string hides
# nothing from the check.
LEXEMES = re.compile(r"'(?:[^'\\]|\\.|'')*'|\"(?:[^\"\\]|\\.)*\"|`[^`]*`|--[^\n]*|#[^\n]*|/\*.*?\*/", re.S)


# Dolt executes the body of a /*! */ comment (measured: `/*!SET PERSIST max_connections = */ (SELECT 7)` sets it
# on 2.4.2; on 2.7.2 a reader gets the SET's privilege error, 2026-11-11), and /*+ */ carries optimizer hints; neither is a comment to it, so neither is accepted anywhere
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
            # Dolt sends unavailable plan estimates as literal NULL in numeric fields (2.4.2; 2.7.2 too, 2026-11-11).
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


def ledger_review(conn: db.LedgerConnection, at: str | None, since: str | None) -> dict:
    """ledger review: the review at one exact version of the commits after --since; findings only."""
    from report import review
    return review.review_all(conn, at, since)


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


def ledger_publish(profile: db.LedgerProfile, remote: str | None) -> dict:
    """ledger publish: push the research branch to origin (named once with --remote)."""
    if remote is None:
        return {**publication.publish(profile), "remote_set": None}
    published, named = publication.name_and_publish(profile, remote)
    return {**published, "remote_set": named}


CONTRACTS: dict[tuple[str, str], tuple[str, str, str, str]] = {
    ("ledger", "sync"): (
        "the configured origin of a reader-only research replica; its administrator account",
        "fetches origin, validates the immutable research commit and fast-forwards the replica only; never publishes",
        "database, origin, previous_commit, ledger_commit, changed",
        "REPLICA_REQUIRED; REMOTE_UNSET; REPLICA_BUSY; DIRTY_WORKING_SET; REPLICA_INVALID; REPLICA_SYNC_FAILED"),
    ("ledger", "mirror"): (
        "a public research origin and new service/data/profile directories, or an intact existing mirror",
        "serves a reader-only research mirror, a separate isolated Paper database and internal sync API; never publishes",
        "action, server_exit",
        "REPLICA_REQUIRED; REMOTE_MISMATCH; BOOTSTRAP_REFUSED; BOOTSTRAP_FAILED; SERVICE_CHECK_FAILED; USAGE_ERROR"),
    ("ledger", "init"): (
        "the profile directory; a Dolt 2.7.2 binary (RESEARCH_DOLT_BINARY or PATH); ledger/schema.sql, or "
        "ledger/paper.sql with --holds paper",
        "the database (--name with - as _), its writer and reader accounts and the schema commit; the Dolt "
        "service under --service-root, started and left running when new; the profile file; never publishes",
        "profile, name, database, kind, holds, service_root, accounts, branch_grant, schema_version, ledger_commit",
        "LEDGER_EXISTS (profile, active ledger or database exists); ISOLATION_BREACH (--kind active without "
        "--backup-root, or its service or backup in the checkout or a temporary root); LEDGER_KIND (--kind active "
        "with --holds paper); INVALID_NAME; DOLT_BINARY; LEDGER_START"),
    ("ledger", "service"): (
        "the service's service.json; start, status and check read the research branch head (reader); run reads its "
        "arguments, the DoltHub key directory and the ledger's public copy",
        "start launches the Dolt service, stop stops it (every database on that service root); a service compose "
        "runs (no socket in service.json) is only waited for by start; status and check write nothing; run (the "
        "compose service) serves in the foreground, on first start bootstrapping the service, the ledger cloned "
        "from its public copy, its accounts and profile; with --readers, at "
        "every start before serving, <readers>/service.json holding only the port and the reader accounts; with "
        "--controllers, <controllers>/ holding the Paper controller's service.json (Paper's accounts and the research "
        "reader) and profiles; with --setup, a first start that lacks or fails on the repository or the key waits on the IDE's page "
        "(a key is made in an empty key directory; a new ledger is published when that page or the configuration "
        "names an empty repository); run publishes every 5 minutes when origin is behind; otherwise never publishes",
        "action, running; start and status add pid, address, branch, ledger_commit (status gives running false "
        "when the ledger is not readable, and adds remote: where it is published, null when nowhere, and unpublished: "
        "whether that copy's last known head differs from the ledger's, behind_seconds: the age of the oldest "
        "commit it lacks, and diverged: its head is not an ancestor of the ledger's); check adds ledger_commit; "
        "run adds server_exit",
        "LEDGER_NOT_INITIALIZED (start: the service holds no such ledger); LEDGER_START; SERVICE_START_FAILED "
        "(started but the ledger is not readable; stopped again unless compose runs it); SERVICE_MANAGED (stop: "
        "compose runs it); run: BOOTSTRAP_REFUSED, BOOTSTRAP_FAILED, DOLTHUB_CREDENTIALS, SERVICE_CHECK_FAILED, "
        "ISOLATION_BREACH, USAGE_ERROR (--readers or --controllers is the service directory; --setup without --credentials or not "
        "host:port); with --setup a first start's refusals go to the page, with REMOTE_INVALID and PUBLISH_FAILED; "
        "check: any refusal of reading either database"),
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
        "the ledger at --at (reader, which must hold no write privilege): the commits after --since (every commit "
        "without it), their row changes, constraint checks, readings, witnesses, runs and captures; the backup's "
        "head, read through linked table files",
        "nothing; never publishes",
        "at, since, commit, tables_checked, *_checked counts, history, ok, findings [{code, table, record_id, commit, "
        "detail}] (a changed or removed commitment row, a reading replaced outside a reseal commit, a witness "
        "commit that adds no registration of its own, a run whose stored facts differ from its capture; "
        "HISTORY_REWRITTEN when --since is no ancestor, and then every commit is checked), "
        "limitations (HISTORY_UNCHECKED without a backup); exit 1 when not ok",
        "LEDGER_PERMISSION (the reader holds a write privilege); INVALID_REF, UNKNOWN_REF (--at); backup "
        "problems are findings, not refusals"),
    ("ledger", "export"): (
        "runs, candidates and their sources, and the declaration tables (lines, targets, closings, registrations, "
        "grid points, designs, source reviews, validations, judgments) at --at (reader); --trial-id limits runs and "
        "their candidates",
        "<target>/backup (dolt_backup of the full history, synced to the head regardless of --at) and "
        "<target>/reproduce/ (manifest.json, candidates, runs, one <table>.json per declaration table); target is "
        "the new --output (reproduce) or the profile's backup directory (backup); no ledger write; never publishes",
        "kind, ledger_commit, target, backup_path, manifest_path, content_hash, runs, candidates (counts)",
        "PATH_EXISTS (--output exists); BACKUP_TARGET_UNSET; EXPORT_PATH_INVALID (target in the service "
        "directory, the checkout or a Git work tree, or not an export of this ledger); UNKNOWN_RUN; "
        "BACKUP_DIVERGED; DOLT_BACKUP; EXPORT_MISMATCH"),
    ("ledger", "publish"): (
        "the administrator connection from service.json (the service must be running); origin, branches",
        "with --remote: origin (DoltHub only for the active ledger, file:// for any); the research branch to "
        "origin; no ledger commit",
        "database, remote, branch, head, previous_head, remote_set",
        "REMOTE_UNSET; REMOTE_MISMATCH (origin points elsewhere); PUBLISH_FORBIDDEN (DoltHub for a non-active "
        "ledger); DOLTHUB_CREDENTIALS; PUBLISH_REJECTED (remote changed elsewhere); PUBLISH_FAILED"),
}


def register(verbs, verb, runner) -> None:
    """Add the ledger nouns to the parser with `cli.main._parser`'s verbs, verb and runner."""
    ledger = verbs("ledger", "the research ledger: init, service, temp, sql, witness, review, export, "
                             "publish, mirror, sync")
    command = verb(ledger, "init", "initialize a new research ledger or Paper database profile")
    command.add_argument("--name", required=True, help="profile name; the database is the name with - as _")
    command.add_argument("--kind", required=True, choices=db.KINDS, help="active, isolated or temporary")
    command.add_argument("--holds", choices=tuple(db.SCHEMAS), default="research",
                         help="research (ledger/schema.sql, the default) or paper (ledger/paper.sql: Paper's execution "
                              "records, never published, never active)")
    command.add_argument("--service-root", required=True, type=Path, help="directory of the Dolt service")
    command.add_argument("--backup-root", type=Path, help="dolt_backup directory (required for --kind active)")
    command = verb(ledger, "service", "start, stop or read the ledger's database service; run it under compose")
    command.add_argument("action", choices=("start", "stop", "status", "check", "run"),
                         help="start, stop or status; check (the ledger readable); run (the compose service)")
    _ledger_option(command)
    command.add_argument("--service-root", type=Path, help="run: the service directory")
    command.add_argument("--data-dir", type=Path, help="run: the Dolt data directory (a volume under compose)")
    command.add_argument("--backup-root", type=Path, help="run: the directory holding each database's backup")
    command.add_argument("--credentials", type=Path, help="run: a `dolt login` ~/.dolt holding the DoltHub key")
    command.add_argument("--research-origin", help="run: on first start, the DoltHub repository the ledger is cloned from, or, when it is empty, published to")
    command.add_argument("--port", type=int, default=13330, help="run: the port to listen on (default: 13330)")
    command.add_argument("--readers", type=Path, help="run: a directory for the reader-only service.json of "
                         "containers that only read")
    command.add_argument("--controllers", type=Path, help="run: a directory for the Paper controller's service.json "
                         "and profiles (its accounts and the research reader only)")
    command.add_argument("--setup", metavar="HOST:PORT", help="run: how the IDE reaches this service's first-start "
                         "port, opened only while there is no service.json")
    command = verb(ledger, "mirror", "serve a public research replica and a separate Paper execution database")
    for option, text in (("service-root", "directory of the Dolt service"),
                         ("data-dir", "the Dolt data directory (a volume under compose)"),
                         ("backup-root", "the directory holding each database's backup"),
                         ("readers", "a directory for the reader-only service.json of containers that only read"),
                         ("controllers", "a private directory for the Paper controller's service and profile files")):
        command.add_argument(f"--{option}", required=True, type=Path, help=text)
    command.add_argument("--research-origin", required=True,
                         help="the public DoltHub repository the research mirror follows (file:// for isolated "
                              "verification)")
    command.add_argument("--port", type=int, default=13330, help="the Dolt port to listen on (default: 13330)")
    command.add_argument("--http-host", default="127.0.0.1",
                         help="address of the internal sync API (default: 127.0.0.1)")
    command.add_argument("--http-port", type=int, default=8769, help="port of the internal sync API (default: 8769)")
    command.add_argument("--allow-host", action="append", default=[], dest="hosts",
                         help="Host header a sync request may carry (default: 127.0.0.1 and localhost at "
                              "HTTP_PORT); repeatable")
    command = verb(ledger, "sync", "fetch and validate the configured public research replica")
    _ledger_option(command)
    command = verb(ledger, "temp", "an isolated temporary ledger under the temporary root")
    command.add_argument("--root", help="new directory under the temporary root (default: a fresh one)")
    command = verb(ledger, "sql", "one read-only query with the reader account")
    _ledger_option(command)
    command.add_argument("query", help="one SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, TABLE or VALUES statement")
    _at(command)
    command = verb(ledger, "witness", "timestamp out-of-sample registrations without a witness")
    _ledger_option(command)
    command.add_argument("--tsa-url", help="the only RFC 3161 timestamp authority to ask (default: DigiCert, "
                                          "then Sectigo when DigiCert grants no token)")
    command = verb(ledger, "review", "the review at one exact version of the commits after --since")
    _ledger_option(command)
    command.add_argument("--since", help="the commit an earlier review checked (default: every commit)")
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
    command.epilog = ("Pushes the research branch and checks the remote head by a fetch. Never "
                      "forces: a remote changed elsewhere is PUBLISH_REJECTED. Commands that change the ledger "
                      "publish it themselves; this reruns a failed publish. --remote names origin once and installs "
                      "the `dolt login` key in the service's Dolt home.")
    _ledger_option(command)
    command.add_argument("--remote", help="the DoltHub repository URL, set once "
                                          "(https://doltremoteapi.dolthub.com/<owner>/<repository>)")


def dispatch(args, runner_argv: list[str]) -> tuple[dict, int]:
    """(result, exit code) of one parsed ledger command."""
    key = (args.noun, args.verb)
    if key == ("ledger", "init"):
        return ledger_init(args.name, args.kind, args.service_root, args.backup_root, args.holds), 0
    if key == ("ledger", "temp"):
        return ledger_temp(args.root), 0
    if key == ("ledger", "mirror"):
        from cli import replica
        return replica.run(args.service_root, args.data_dir, args.backup_root, args.research_origin, args.port,
                           args.readers, args.controllers, args.http_host, args.http_port, args.hosts)
    if key == ("ledger", "service") and args.action in ("run", "check"):
        from cli import service
        if args.action == "check":
            return service.check(db.profile(args.ledger)), 0
        if not (args.service_root and args.data_dir and args.backup_root):
            raise refuse("USAGE_ERROR", "ledger service run needs --service-root, --data-dir and --backup-root")
        return service.run(args.service_root, args.data_dir, args.backup_root, args.credentials,
                           args.research_origin, args.port,
                           args.readers, args.setup, args.controllers)
    # `ledger service` acts on a service, which a profile of either content names.
    profile = db.profile(args.ledger, holds=None if key == ("ledger", "service") else "research")
    if key == ("ledger", "sync"):
        from ledger import replica as research_replica
        return research_replica.sync(profile), 0
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
            found = ledger_review(conn, args.at, args.since)
        return found, 0 if found["ok"] else 1
    raise UsageError(f"unknown command {args.noun} {args.verb}")
