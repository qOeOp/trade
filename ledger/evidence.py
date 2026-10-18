"""Evidence bundles (`ledger.add_bundle`, `ledger.load_bundle`).

A bundle is a named set of files stored as exact bytes; the ledger derives each file's SHA-256
and length, so a writer cannot pair altered bytes with an old hash, and every read recomputes it.
Agents name their own bundles; the sealed namespace of replays (trial-<id>-execution,
trial-<id>-execution-start, trial-<id>-recovery-*) is written only by product code through
`write_files`. A bundle name is its identity: it is never replaced.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path, PurePosixPath
import re

from ledger import db
from ledger.refusals import refuse


BUNDLE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\Z")
RESERVED = re.compile(r"trial-[0-9]+-(execution|execution-start|recovery(-.*)?)\Z")
PATH_LIMIT = 512
MAX_FILE_BYTES = 64 * 1024 * 1024  # uncalibrated example value
MEDIA_SUFFIXES = {".mp4", ".m4a", ".m4v", ".webm", ".mkv", ".mov", ".avi", ".mp3", ".wav", ".aac", ".opus",
                  ".flac", ".ogg"}


def check_name(bundle) -> str:
    if not isinstance(bundle, str) or not BUNDLE.fullmatch(bundle):
        raise refuse("INVALID_BUNDLE_NAME", f"invalid bundle name {bundle!r}",
                     expected="[A-Za-z0-9][A-Za-z0-9_.-]{0,159}")
    return bundle


def _path_refused(name: str) -> None:
    raise refuse("INVALID_EVIDENCE_PATH", f"evidence path {name!r} is a link, absolute, contains .., repeats "
                                          "another or is too long")


def _read_sources(sources: list[Path]) -> dict[str, bytes]:
    found: list[tuple[str, Path]] = []
    for given in sources:
        given = Path(given)
        if given.is_symlink() or not given.exists():
            _path_refused(str(given))
        if given.is_dir():
            for directory, names, files in os.walk(given, followlinks=False):
                for name in sorted(names) + sorted(files):
                    path = Path(directory) / name
                    if path.is_symlink():
                        _path_refused(path.relative_to(given).as_posix())
                for name in sorted(files):
                    path = Path(directory) / name
                    found.append((path.relative_to(given).as_posix(), path))
        else:
            found.append((given.name, given))
    files: dict[str, bytes] = {}
    for name, path in found:
        posix = PurePosixPath(name)
        if (name in files or posix.is_absolute() or ".." in posix.parts or len(name.encode()) > PATH_LIMIT
                or not path.is_file()):
            _path_refused(name)
        if posix.suffix.lower() in MEDIA_SUFFIXES:
            raise refuse("MEDIA_NOT_KEPT", f"{name}: media files are not kept; store derived evidence only",
                         missing=(name,))
        data = path.read_bytes()
        if not data:
            raise refuse("EMPTY_EVIDENCE", f"{name}: empty evidence files are refused", missing=(name,))
        if len(data) > MAX_FILE_BYTES:
            raise refuse("EVIDENCE_TOO_LARGE", f"{name}: larger than {MAX_FILE_BYTES} bytes", missing=(name,),
                         expected=f"at most {MAX_FILE_BYTES} bytes per file")
        files[name] = data
    if not files:
        raise refuse("EMPTY_EVIDENCE", "the sources hold no evidence file")
    return files


def digests(files: dict[str, bytes]) -> dict[str, str]:
    return {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}


def write_files(conn: db.LedgerConnection, kind: str, bundle: str, files: dict[str, bytes], op_id: str) -> dict:
    """Insert one bundle and its files as one write (or inside the caller's write); any namespace."""
    hashes = digests(files)

    def insert(c, op):
        if c.one("SELECT bundle FROM evidence_bundle WHERE bundle = %s", (bundle,)):
            raise refuse("BUNDLE_EXISTS", f"bundle {bundle} already exists with other content", missing=(bundle,))
        c.rows("INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES (%s, %s, UTC_TIMESTAMP(6))",
               (bundle, op))
        c.many("INSERT INTO evidence (bundle, path, content) VALUES (%s, %s, %s)",
               [(bundle, name, data) for name, data in sorted(files.items())])
        return {"bundle": bundle, "files": hashes}

    def replay(c, row):
        stored = dict(c.rows("SELECT path, sha256 FROM evidence WHERE bundle = %s ORDER BY path", (row["bundle"],)))
        return {"bundle": row["bundle"], "files": stored}

    return db.write(conn, kind, {"bundle": bundle, "files": hashes}, "evidence_bundle", insert, replay, op_id=op_id)


def add_bundle(conn: db.LedgerConnection, bundle: str, sources: list[Path], op_id: str | None = None) -> dict:
    """Append an Agent bundle from files or directories; the same content again is a replay."""
    check_name(bundle)
    if RESERVED.fullmatch(bundle):
        raise refuse("RESERVED_BUNDLE", f"{bundle} lies in the product's sealed namespace", missing=(bundle,))
    files = _read_sources(sources)
    op = op_id or db.derive_op_id("evidence", {"bundle": bundle, "files": digests(files)})
    written = write_files(conn, "add_bundle", bundle, files, op)
    return {"bundle": written["record"]["bundle"], "files": written["record"]["files"],
            "write_status": written["write_status"], "ledger_commit": written["commit"]}


def _fetch(conn: db.LedgerConnection, bundle: str, clause: str) -> tuple[dict | None, list[tuple]]:
    head = conn.one(f"SELECT bundle, created_at FROM evidence_bundle{clause} WHERE bundle = %s", (bundle,))
    files = conn.rows(f"SELECT path, content, sha256 FROM evidence{clause} WHERE bundle = %s ORDER BY path",
                      (bundle,)) if head else []
    return head, files


def load_bundle(conn: db.LedgerConnection, bundle: str, at: str | None = None) -> dict:
    """Every file of a bundle at an exact ledger version, each hash recomputed; no partial result."""
    check_name(bundle)
    commit, clause = db.as_of(conn, at)
    head, rows = _fetch(conn, bundle, clause)
    if head is None:
        raise refuse("UNKNOWN_BUNDLE", f"no bundle {bundle} at {commit}", missing=(bundle,))
    files, hashes = {}, {}
    for path, content, stored in rows:
        content = bytes(content)
        if hashlib.sha256(content).hexdigest() != stored:
            raise refuse("LEDGER_CORRUPT", f"stored file {bundle}/{path} differs from its content hash",
                         missing=(f"{bundle}/{path}",))
        files[path], hashes[path] = content, stored
    return {"bundle": bundle, "commit": commit, "created_at": head["created_at"], "files": files, "digests": hashes}
