"""Export and backup (`ledger.export_history`, `market_backup`), and the two facts the whole-ledger
review needs from here: that a connection is a reader, and the head commit of the latest backup.

Records are read only through the reader account at one exact version. The full-history backup is
an incremental dolt_backup sync by the service's administrator (the only account that may run it),
to `<destination>/backup` outside the service directory and any Git work tree; its head is read
back from a restored copy in a new temporary directory. The reproduction manifest beside it,
`<destination>/reproduce/`, lists every exported run's replay identity; replaying from it can be
checked with engine.compare_reports.

A sync that would replace a backup whose head is no commit of the history (another database's
backup, or a rewritten commit) is refused, since dolt_backup overwrites it silently (measured on
Dolt 2.4.2). The market database is backed up the same way, to `<profile backup>/backup`, holding
its import lock.
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import overload

import pymysql

from ledger import db, evidence, metrics, strategies
from ledger.refusals import refuse


EXPORT_FORMAT = "ledger-export-v1"
MANIFEST = "manifest.json"
BACKUP, REPRODUCE = "backup", "reproduce"
WRITE_PRIVILEGES = ("INSERT", "UPDATE", "DELETE")


def require_reader(conn: db.LedgerConnection) -> None:
    """LEDGER_PERMISSION unless the connection's account holds no write privilege on its database."""
    if conn.role != "reader":
        raise refuse("LEDGER_PERMISSION", "this reader needs the reader account, not the writer")
    database = conn.profile.database
    held = [kind for (kind,) in conn.rows(
        "SELECT privilege_type FROM information_schema.schema_privileges WHERE table_schema = %s UNION ALL "
        "SELECT privilege_type FROM information_schema.table_privileges WHERE table_schema = %s UNION ALL "
        "SELECT privilege_type FROM information_schema.user_privileges", (database, database))]
    if any(kind.upper() in WRITE_PRIVILEGES for kind in held):
        raise refuse("LEDGER_PERMISSION", "the connection's account holds a write privilege; use the reader account")


def _admin(profile: db.LedgerProfile):
    config = db._service(profile.service_root)
    if config is None:
        raise refuse("LEDGER_UNKNOWN", f"{profile.service_root} is not a ledger service directory")
    return config, db.service_connection(config["socket"], user="root", password=config["root_password"],
                                         database=profile.database, autocommit=True, connect_timeout=5)


@overload
def backup_path(profile: db.LedgerProfile, destination: Path) -> Path: ...


@overload
def backup_path(profile: db.LedgerProfile, destination: None = None) -> Path | None: ...


def backup_path(profile: db.LedgerProfile, destination: Path | None = None) -> Path | None:
    """The full-history backup of a profile: `<destination or backup_root>/backup`."""
    root = destination if destination is not None else profile.backup_root
    return None if root is None else Path(root) / BACKUP


def backup_head(profile: db.LedgerProfile, backup: Path, branch: str | None = None) -> str | None:
    """The research branch head of a dolt_backup copy, read from a restore in a new temporary
    directory (deleted afterwards); None when there is no backup. A restore or listing that fails,
    times out or returns no readable branch list is DOLT_BACKUP."""
    backup = Path(backup)
    if not backup.is_dir():
        return None
    config = db._service(profile.service_root) or {}
    binary = config.get("binary")
    if not binary:
        raise refuse("DOLT_BINARY", "the ledger service records no Dolt executable")
    work = Path(tempfile.mkdtemp(prefix="backup-head-"))
    try:
        environment = {**os.environ, "DOLT_ROOT_PATH": str(work / "home")}
        (work / "home").mkdir()
        for key, value in (("user.name", "Research Ledger"), ("user.email", "research-ledger@example.invalid")):
            subprocess.run([binary, "config", "--global", "--add", key, value], env=environment, check=True,
                           capture_output=True, timeout=60)
        restored = subprocess.run([binary, "backup", "restore", backup.resolve().as_uri(), "restored"], cwd=work,
                                  env=environment, capture_output=True, text=True, timeout=600)
        if restored.returncode:
            raise refuse("DOLT_BACKUP", f"the backup at {backup} cannot be restored", missing=(str(backup),))
        listed = subprocess.run([binary, "sql", "-r", "json", "-q", "SELECT name, hash FROM dolt_branches"],
                                cwd=work / "restored", env=environment, capture_output=True, text=True, timeout=600)
        if listed.returncode:
            raise refuse("DOLT_BACKUP", f"the branches of the backup at {backup} cannot be listed",
                         missing=(str(backup),))
        value = json.loads(listed.stdout or "{}")
        rows = value.get("rows", []) if isinstance(value, dict) else None
        if not isinstance(rows, list) or not all(isinstance(row, dict) and "name" in row and "hash" in row
                                                 for row in rows):
            raise refuse("DOLT_BACKUP", f"the backup at {backup} returned no readable branch list",
                         missing=(str(backup),))
        heads = {row["name"]: row["hash"] for row in rows}
        return heads.get(branch or profile.research_branch)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError) as exc:
        raise refuse("DOLT_BACKUP", f"the head of the backup at {backup} cannot be read ({type(exc).__name__})",
                     missing=(str(backup),)) from exc
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _inside_work_tree(path: Path) -> bool:
    for parent in (path, *path.parents):
        if (parent / ".git").exists():
            return True
    return False


def _check_destination(profile: db.LedgerProfile, destination: Path) -> Path:
    destination = Path(destination).expanduser().absolute()
    if (destination.resolve().is_relative_to(Path(profile.service_root).resolve())
            or destination.resolve().is_relative_to(db.REPOSITORY.resolve()) or _inside_work_tree(destination)):
        raise refuse("EXPORT_PATH_INVALID", f"{destination} lies inside the ledger service directory or a Git work tree",
                     missing=(str(destination),))
    if destination.exists():
        manifest = destination / REPRODUCE / MANIFEST
        try:
            value = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            value = None
        if not isinstance(value, dict) or value.get("ledger_name") != profile.name or value.get(
                "database") != profile.database:
            raise refuse("EXPORT_PATH_INVALID", f"{destination} exists and is no export of ledger {profile.name}",
                         missing=(str(destination),))
    return destination


def _json(value) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=1, ensure_ascii=False, default=str) + "\n").encode("utf-8")


def _sync_backup(profile: db.LedgerProfile, target: Path, head: str) -> str | None:
    """Sync the whole history to `target` and return the head the backup held before. An existing
    backup whose head is no commit of the branch's history (a rewritten commit, or another
    database's backup) is BACKUP_DIVERGED: dolt_backup would overwrite it silently."""
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    existing = target.is_dir() and any(target.iterdir())
    previous = backup_head(profile, target) if existing else None
    try:
        _, admin = _admin(profile)
    except pymysql.MySQLError as exc:
        raise refuse("DOLT_BACKUP", "the service administrator could not connect for the backup") from exc
    try:
        with admin.cursor() as cursor:
            if existing:
                cursor.execute("SELECT COUNT(*) FROM dolt_log(%s) WHERE commit_hash = %s",
                               (profile.research_branch, previous))
                if previous is None or not cursor.fetchone()[0]:
                    raise refuse("BACKUP_DIVERGED", f"the backup head {previous} at {target} is no commit of the "
                                                    f"history of {profile.database}; nothing was synced",
                                 missing=(str(target),))
            cursor.execute("CALL DOLT_BACKUP('sync-url', %s)", (target.resolve().as_uri(),))
    except pymysql.MySQLError as exc:
        raise refuse("DOLT_BACKUP", f"dolt_backup sync to {target} failed", missing=(str(target),)) from exc
    finally:
        admin.close()
    if backup_head(profile, target) != head:
        raise refuse("DOLT_BACKUP", f"the backup head at {target} differs from the ledger head {head}",
                     missing=(str(target),))
    return previous


def _run_record(conn: db.LedgerConnection, run_id: int) -> dict:
    loaded = metrics.load_run(conn, run_id)
    capture, trial, run = loaded["capture"], loaded["trial"], loaded["run"]
    coverage = capture.get("input_coverage") if isinstance(capture.get("input_coverage"), Mapping) else {}
    start = capture.get("start") or {}
    attempt = conn.one("SELECT registration_bundle FROM registration_attempt WHERE trial_id = %s", (trial["trial_id"],))
    binding = conn.one("SELECT registration_id FROM validation_binding WHERE trial_id = %s", (trial["trial_id"],))
    return {"run": run, "trial": trial, "sealed": loaded["sealed"],
            "returns": [[ts, value, metrics.money(mean) if mean is not None else None]
                        for ts, value, mean in loaded["returns"]],
            "cycles": [{key: (metrics.money(item) if isinstance(item, metrics.Decimal) else item)
                        for key, item in cycle.items()} for cycle in loaded["cycles"]],
            "replay_identity": {"run_id": run_id, "trial_id": trial["trial_id"], "purpose": trial["purpose"],
                                "source_sha256": trial["source_sha256"], "image_ref": trial["image_ref"],
                                "image_digest": trial["image_digest"], "runtime_identity": start.get("runtime_identity"),
                                "input_identity": start.get("input_identity"),
                                "effective_config": coverage.get("effective_config"),
                                "market_commit": (start.get("input_identity") or {}).get("market_commit"),
                                "window": {"input_start": trial["input_start"], "trade_start": trial["trade_start"],
                                           "trade_end": trial["trade_end"]},
                                "fingerprints": run["fingerprints"],
                                "registration_bundle": (attempt or {}).get("registration_bundle"),
                                "validation_registration": (binding or {}).get("registration_id")}}


def export_history(profile, destination: Path, at: str | None = None, run_ids: list | None = None,
                   with_backup: bool = True) -> dict:
    """Export the ledger at one exact version through the reader account: the full-history backup
    (with_backup) and the reproduction manifest with candidate sources, run rows, sealed results,
    daily series, position cycles, registrations and judgments, and every run's replay identity."""
    profile = db.load_profile(profile) if isinstance(profile, str) else profile
    destination = _check_destination(profile, destination)
    with db.read_as_of(profile, at) as conn:
        require_reader(conn)
        commit = db.head_commit(conn)
        sealed = [run_id for (run_id,) in conn.rows("SELECT run_id FROM run ORDER BY run_id")]
        wanted = sealed if run_ids is None else [int(item) for item in run_ids]
        absent = [str(item) for item in wanted if item not in sealed]
        if absent:
            raise refuse("UNKNOWN_RUN", "no sealed run " + ", ".join(absent) + f" at {commit}", missing=tuple(absent))
        records = {run_id: _run_record(conn, run_id) for run_id in wanted}
        sources = {record["trial"]["source_sha256"] for record in records.values()}
        candidates = [row for row in conn.dicts("SELECT strategy_id, revision, source_sha256 FROM candidate ORDER BY "
                                                "strategy_id, revision") if run_ids is None or row["source_sha256"] in sources]
        files: dict[str, bytes] = {}
        listed = []
        for row in candidates:
            ref = f"{row['strategy_id']}@{row['revision']}"
            found = strategies.read_candidate(conn, ref)
            if hashlib.sha256(found["source"]).hexdigest() != row["source_sha256"]:
                raise refuse("LEDGER_CORRUPT", f"the source of {ref} differs from its stored hash", missing=(ref,))
            path = f"candidates/{ref}.py"
            files[path] = found["source"]
            listed.append({"candidate": ref, "source_sha256": row["source_sha256"], "path": path})
        for run_id, record in records.items():
            files[f"runs/{run_id}.json"] = _json(record)
        bundles = [bundle for (bundle,) in conn.rows("SELECT bundle FROM evidence_bundle WHERE bundle LIKE "
                                                     "'registration-%' ORDER BY bundle")]
        for bundle in bundles:
            for path, data in evidence.load_bundle(conn, bundle)["files"].items():
                files[f"registrations/{bundle}/{path}"] = data
        files["judgments.json"] = _json(conn.dicts("SELECT * FROM judgment ORDER BY judgment_id"))
        files["judgment_subjects.json"] = _json(conn.dicts("SELECT * FROM judgment_subject ORDER BY judgment_id, seq"))
        files["validations.json"] = _json(conn.dicts("SELECT * FROM validation_registration ORDER BY registration_id"))
        head = db.resolve_commit(conn, profile.research_branch)
    images = sorted({record["replay_identity"]["image_ref"] for record in records.values()})
    market_commits = sorted({record["replay_identity"]["market_commit"] for record in records.values()
                             if record["replay_identity"]["market_commit"]})
    unavailable = [{"run_id": run_id, "reason": "no semantic fingerprint: a replay cannot be checked against it"}
                   for run_id, record in records.items() if record["run"]["status"] == "passed"
                   and record["run"]["fingerprints"] is None]
    manifest = {"format": EXPORT_FORMAT, "ledger_name": profile.name, "database": profile.database, "at": at,
                "commit": commit, "candidates": listed,
                "runs": [record["replay_identity"] for record in records.values()], "registrations": bundles,
                "images": images, "market_commits": market_commits, "unavailable": unavailable,
                "files": {path: hashlib.sha256(data).hexdigest() for path, data in sorted(files.items())},
                "check": "replay each run by its identity (replay.reproduce) and compare with engine.compare_reports"}
    encoded = _json(manifest)
    backup = None
    if with_backup:
        backup = backup_path(profile, destination)
        _sync_backup(profile, backup, head)
    staging = destination / f".{REPRODUCE}.{os.getpid()}"
    shutil.rmtree(staging, ignore_errors=True)
    for path, data in {**files, MANIFEST: encoded}.items():
        target = staging / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    final = destination / REPRODUCE
    retired = destination / f".{REPRODUCE}.old.{os.getpid()}"
    shutil.rmtree(retired, ignore_errors=True)
    if final.exists():
        final.rename(retired)  # the old export moves aside, the new one moves in, then the old one goes
    try:
        staging.rename(final)
    except OSError:
        if retired.exists() and not final.exists():
            retired.rename(final)  # the earlier export stays in place
        shutil.rmtree(staging, ignore_errors=True)
        raise
    shutil.rmtree(retired, ignore_errors=True)
    return {"at": at, "commit": commit, "ledger_name": profile.name, "backup_path": str(backup) if backup else None,
            "candidates": len(listed), "runs": len(records), "images": images, "market_commits": market_commits,
            "manifest_path": str(final / MANIFEST), "content_hash": hashlib.sha256(encoded).hexdigest(),
            "unavailable": unavailable}


def market_backup(market: Mapping) -> dict:
    """market backup: the market database's whole history synced incrementally by the service
    administrator to `<profile backup>/backup`, outside the service directory, the checkout, any Git
    work tree and (for the active database) the temporary roots. The import lock is held so no
    import lands during the sync; the backup's head must equal main afterwards."""
    profile = db.LedgerProfile.from_json(dict(market))
    if profile.backup_root is None:
        raise refuse("BACKUP_TARGET_UNSET", f"market profile {profile.name} declares no backup directory",
                     missing=("backup",))
    root = Path(profile.backup_root).expanduser().absolute()
    if (root.resolve().is_relative_to(Path(profile.service_root).resolve())
            or root.resolve().is_relative_to(db.REPOSITORY.resolve()) or _inside_work_tree(root)):
        raise refuse("EXPORT_PATH_INVALID", f"{root} lies inside the market service directory or a Git work tree",
                     missing=(str(root),))
    if profile.kind == "active" and db._is_temporary(root):
        raise refuse("ISOLATION_BREACH", "the active market database keeps its backup outside temporary roots",
                     missing=(str(root),))
    target = backup_path(profile, root)
    if os.path.lexists(target) and not target.is_dir():
        raise refuse("EXPORT_PATH_INVALID", f"{target} exists and is not a backup directory", missing=(str(target),))
    try:
        _, conn = _admin(profile)
    except pymysql.MySQLError as exc:
        raise refuse("DOLT_BACKUP", "the service administrator could not connect for the backup") from exc
    try:
        with conn.cursor() as cursor:
            lock = f"market-import:{profile.database}"
            cursor.execute("SELECT GET_LOCK(%s, 0)", (lock,))
            if cursor.fetchone()[0] != 1:
                raise refuse("CONCURRENT_IMPORT", f"an import of {profile.database} holds {lock}; nothing was synced",
                             missing=(lock,))
            cursor.execute("SELECT hash FROM dolt_branches WHERE name = 'main'")
            (head,), = cursor.fetchall()
            previous = _sync_backup(profile, target, head)
    except pymysql.MySQLError as exc:
        raise refuse("DOLT_BACKUP", f"the market backup to {target} failed", missing=(str(target),)) from exc
    finally:
        conn.close()  # also releases the import lock
    return {"market": profile.name, "database": profile.database, "backup_path": str(target), "market_commit": head,
            "previous_head": previous}
