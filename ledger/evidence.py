"""Evidence bundles (`ledger.add_bundle`, `ledger.load_bundle`).

A bundle is a named set of files, each naming its content by SHA-256. Every distinct content is
stored once (`evidence_content`) and the ledger derives its hash, so a writer cannot pair altered
bytes with an old hash, and every read recomputes it.
Agents name their own bundles through `add_bundle`; the product namespaces (replay receipts and
seals, registrations, source reviews, research lines, lifecycle facts) are written only by
product code through `write_files`. A bundle name is its identity: it is never replaced.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path, PurePosixPath
import re

from ledger import db
from ledger.refusals import refuse


BUNDLE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\Z")
RESERVED = re.compile(r"(trial-[0-9]+-(execution|execution-start|recovery(-.*)?)|registration-.*|source-review-.*"
                      r"|research-line-[0-9]+|lifecycle-[0-9a-v]{32})\Z")
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


def _path_ok(name: str) -> bool:
    posix = PurePosixPath(name)
    return bool(name) and not posix.is_absolute() and ".." not in posix.parts and len(name.encode()) <= PATH_LIMIT


def _check_content(name: str, data: bytes) -> None:
    if not data:
        raise refuse("EMPTY_EVIDENCE", f"{name}: empty evidence files are refused", missing=(name,))
    if len(data) > MAX_FILE_BYTES:
        raise refuse("EVIDENCE_TOO_LARGE", f"{name}: larger than {MAX_FILE_BYTES} bytes", missing=(name,),
                     expected=f"at most {MAX_FILE_BYTES} bytes per file")


def _read_sources(sources: list[Path]) -> dict[str, bytes]:
    found: list[tuple[str, Path]] = []
    for given in sources:
        given = Path(given)
        if given.is_symlink() or not given.exists():
            _path_refused(str(given))
        if given.is_dir():
            for directory, names, filenames in os.walk(given, followlinks=False):
                for name in sorted(names) + sorted(filenames):
                    path = Path(directory) / name
                    if path.is_symlink():
                        _path_refused(path.relative_to(given).as_posix())
                for name in sorted(filenames):
                    path = Path(directory) / name
                    found.append((path.relative_to(given).as_posix(), path))
        else:
            found.append((given.name, given))
    files: dict[str, bytes] = {}
    for name, path in found:
        if name in files or not _path_ok(name) or not path.is_file():
            _path_refused(name)
        if PurePosixPath(name).suffix.lower() in MEDIA_SUFFIXES:
            raise refuse("MEDIA_NOT_KEPT", f"{name}: media files are not kept; store derived evidence only",
                         missing=(name,))
        data = path.read_bytes()
        _check_content(name, data)
        files[name] = data
    if not files:
        raise refuse("EMPTY_EVIDENCE", "the sources hold no evidence file")
    return files


def files_from(clause: str = "") -> str:
    """The FROM clause of bundle files with their bytes (`e.bundle`, `e.path`, `e.sha256`, `c.content`),
    optionally AS OF one commit (`clause` from ledger.as_of)."""
    return f"evidence{clause} e JOIN evidence_content{clause} c ON c.sha256 = e.sha256"


def digests(files: dict[str, bytes]) -> dict[str, str]:
    return {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}


def _stored(conn: db.LedgerConnection, bundle: str) -> dict[str, str] | None:
    if not conn.rows("SELECT 1 FROM evidence_bundle WHERE bundle = %s", (bundle,)):
        return None
    return dict(conn.rows("SELECT path, sha256 FROM evidence WHERE bundle = %s ORDER BY path", (bundle,)))


def write_files(conn: db.LedgerConnection, bundle: str, files: dict[str, bytes], op_id: str) -> dict:
    """The product's bundle writer: insert one bundle of bytes inside the caller's `ledger.write`.

    Any namespace; the same name with the same content is a no-op, with other content BUNDLE_EXISTS.
    """
    if not conn.in_write:
        raise ValueError("write_files runs inside the caller's ledger.write")
    check_name(bundle)
    for name, data in files.items():
        if not isinstance(name, str) or not _path_ok(name):
            _path_refused(str(name))
        _check_content(name, data)
    hashes = digests(files)
    stored = _stored(conn, bundle)
    if stored is not None:
        if stored == hashes:
            return {"bundle": bundle, "files": hashes}
        raise refuse("BUNDLE_EXISTS", f"bundle {bundle} already exists with other content", missing=(bundle,))
    conn.rows("INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES (%s, %s, UTC_TIMESTAMP(6))",
              (bundle, op_id))
    if files:
        # Each distinct content once: the ones already stored are only referenced.
        contents = {hashes[name]: data for name, data in files.items()}
        known = {sha for (sha,) in conn.rows("SELECT sha256 FROM evidence_content WHERE sha256 IN ("
                                             + ", ".join(["%s"] * len(contents)) + ")", tuple(contents))}
        new = [(data,) for sha, data in sorted(contents.items()) if sha not in known]
        if new:
            conn.many("INSERT INTO evidence_content (content) VALUES (%s)", new)
        conn.many("INSERT INTO evidence (bundle, path, sha256) VALUES (%s, %s, %s)",
                  [(bundle, name, hashes[name]) for name in sorted(files)])
    return {"bundle": bundle, "files": hashes}


def add_bundle(conn: db.LedgerConnection, bundle: str, sources: list[Path], op_id: str | None = None) -> dict:
    """Append an Agent bundle from files or directories; the same content again is a replay."""
    check_name(bundle)
    if RESERVED.fullmatch(bundle):
        raise refuse("RESERVED_BUNDLE", f"{bundle} lies in a product namespace", missing=(bundle,))
    files = _read_sources(sources)
    hashes = digests(files)
    op = op_id or db.derive_op_id("evidence", {"bundle": bundle, "files": hashes})

    def insert(c, operation):
        if _stored(c, bundle) is not None:
            raise refuse("BUNDLE_EXISTS", f"bundle {bundle} already exists with other content", missing=(bundle,))
        return write_files(c, bundle, files, operation)

    def replay(c, row):
        stored = _stored(c, row["bundle"])
        if row["bundle"] != bundle or stored != hashes:
            raise refuse("OP_ID_CONFLICT", f"operation {row['op_id']} already names another bundle or content",
                         missing=(row["op_id"],))
        return {"bundle": bundle, "files": stored}

    written = db.write(conn, "add_bundle", {"bundle": bundle, "files": hashes}, "evidence_bundle", insert, replay,
                       op_id=op)
    return {"bundle": written["record"]["bundle"], "files": written["record"]["files"],
            "write_status": written["write_status"], "ledger_commit": written["commit"]}


def _fetch(conn: db.LedgerConnection, bundle: str, clause: str) -> tuple[dict | None, list[tuple]]:
    head = conn.one(f"SELECT bundle, created_at FROM evidence_bundle{clause} WHERE bundle = %s", (bundle,))
    files = conn.rows(f"SELECT e.path, c.content, e.sha256 FROM {files_from(clause)} WHERE e.bundle = %s "
                      "ORDER BY e.path", (bundle,)) if head else []
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
