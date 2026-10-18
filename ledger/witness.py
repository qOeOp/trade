"""External time witness for validation registrations (`ledger.witness`, `ledger.sync_witness`,
`ledger.token_time`, `ledger.stamped_at`); ported from research/records/witness.py.

After a validation registration's commit lands, the SHA-256 of its 32-character commit hash is
sent to a public RFC 3161 timestamp authority; only that digest leaves the machine. The returned
TimeStampToken is verified offline with `openssl ts -verify` against the pinned roots, as of its
own genTime, and stored by a second write in `witness`. The token's genTime is the only time it
proves: the registration existed then.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hashlib
import http.client
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.request

from ledger import db
from ledger.errors import Refusal
from ledger.refusals import refuse


# The default authority. Seam: the design reads it from the ledger configuration, which no
# profile field holds yet.
TSA_URL = "https://timestamp.digicert.com"
ROOTS = Path(__file__).with_name("tsa-roots.pem")
ROOTS_SHA256 = "c2dc4afb1860e6f3a219951b3524f9105bcebaf0ee41bcb08708d70f595c1cee"
COMMIT = re.compile(r"[0-9a-v]{32}\Z")
CLOCK_TOLERANCE = timedelta(seconds=300)  # uncalibrated example value
_TIME = re.compile(r"Time stamp: (\w{3})\s+(\d+) (\d\d:\d\d:\d\d)(?:\.(\d+))? (\d{4}) GMT")
_NONCE = re.compile(r"Nonce: 0x([0-9A-Fa-f]+)")


def _openssl(*argv: str) -> subprocess.CompletedProcess:
    return subprocess.run(["openssl", *argv], capture_output=True, text=True, check=False, timeout=60)


def _invalid(commit: str, why: str) -> Refusal:
    return refuse("WITNESS_INVALID", f"the timestamp token for {commit} {why}", missing=(str(commit),))


def _roots(tsa_roots: Path | None) -> Path:
    if tsa_roots is not None:
        return Path(tsa_roots)
    if hashlib.sha256(ROOTS.read_bytes()).hexdigest() != ROOTS_SHA256:
        raise refuse("WITNESS_INVALID", "the shipped timestamp roots differ from their pinned hash")
    return ROOTS


def token_time(token: bytes, commit: str, tsa_roots: Path | None = None, expected_nonce: int | None = None) -> datetime:
    """Verify a TimeStampToken (DER) for `commit` offline against the pinned roots; return its genTime (UTC)."""
    if not isinstance(token, bytes) or not token or not isinstance(commit, str) or not COMMIT.fullmatch(commit):
        raise _invalid(str(commit), "or its commit is malformed")
    roots = _roots(tsa_roots)
    with tempfile.TemporaryDirectory() as directory:
        data, path = Path(directory, "commit"), Path(directory, "token.der")
        data.write_text(commit, encoding="ascii")
        path.write_bytes(token)
        text = _openssl("ts", "-reply", "-in", str(path), "-token_in", "-text")
        found = _TIME.search(text.stdout)
        if text.returncode or not found or "Hash Algorithm: sha256" not in text.stdout:
            raise _invalid(commit, "is unreadable or not a SHA-256 TSTInfo")
        month, day, clock, fraction, year = found.groups()
        moment = datetime.strptime(f"{month} {day} {clock} {year}", "%b %d %H:%M:%S %Y").replace(tzinfo=UTC)
        if fraction:
            moment = moment.replace(microsecond=int(fraction.ljust(6, "0")[:6]))
        if expected_nonce is not None:
            nonce = _NONCE.search(text.stdout)
            if nonce is None or int(nonce.group(1), 16) != expected_nonce:
                raise _invalid(commit, "does not carry the request's nonce")
        checked = _openssl("ts", "-verify", "-in", str(path), "-token_in", "-data", str(data), "-CAfile", str(roots),
                           "-attime", str(int(moment.timestamp())))
        if checked.returncode or "Verification: OK" not in checked.stdout:
            raise _invalid(commit, "does not verify against the commit and the pinned roots")
    return moment


def _query(commit: str) -> tuple[bytes, int]:
    """A TimeStampReq for SHA-256(commit) with a random nonce and certReq; returns (DER, nonce)."""
    with tempfile.TemporaryDirectory() as directory:
        data, query = Path(directory, "commit"), Path(directory, "query.tsq")
        data.write_text(commit, encoding="ascii")
        made = _openssl("ts", "-query", "-data", str(data), "-sha256", "-cert", "-out", str(query))
        text = _openssl("ts", "-query", "-in", str(query), "-text")
        nonce = _NONCE.search(text.stdout)
        if made.returncode or text.returncode or nonce is None:
            raise RuntimeError("openssl cannot build a timestamp query")
        return query.read_bytes(), int(nonce.group(1), 16)


def _post(url: str, query: bytes) -> bytes:
    request = urllib.request.Request(url, data=query, headers={"Content-Type": "application/timestamp-query"})
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - https TSA endpoint
        return response.read()


def _granted_token(response: bytes) -> bytes | None:
    """The TimeStampToken of a granted TimeStampResp, else None."""
    with tempfile.TemporaryDirectory() as directory:
        reply, token = Path(directory, "reply.tsr"), Path(directory, "token.der")
        reply.write_bytes(response)
        text = _openssl("ts", "-reply", "-in", str(reply), "-text")
        if text.returncode or not re.search(r"Status: Granted", text.stdout):
            return None
        out = _openssl("ts", "-reply", "-in", str(reply), "-token_out", "-out", str(token))
        return token.read_bytes() if out.returncode == 0 and token.exists() else None


def _registered_at(conn: db.LedgerConnection, commit: str) -> datetime | None:
    found = conn.rows("SELECT MIN(to_created_at) FROM dolt_diff_validation_registration WHERE to_commit = %s "
                      "AND diff_type = 'added'", (commit,))
    return found[0][0] if found and found[0][0] is not None else None


def _stored(conn: db.LedgerConnection, commit: str) -> dict | None:
    return conn.one("SELECT token FROM witness WHERE commit_hash = %s", (commit,))


def _witness_commit(conn: db.LedgerConnection, commit: str) -> str | None:
    found = conn.rows("SELECT to_commit FROM dolt_diff_witness WHERE to_commit_hash = %s AND diff_type = 'added' "
                      "LIMIT 1", (commit,))
    return found[0][0] if found else None


def witness(conn: db.LedgerConnection, commit: str, tsa_url: str | None = None,
            tsa_roots: Path | None = None) -> dict:
    """Timestamp one validation registration commit and store the token; idempotent per commit."""
    url = tsa_url or TSA_URL
    if not url.startswith("https://"):
        raise ValueError("the timestamp authority endpoint must be https")
    registered = _registered_at(conn, commit) if isinstance(commit, str) and COMMIT.fullmatch(commit) else None
    if registered is None:
        raise refuse("NOT_REGISTRATION_COMMIT", f"commit {commit!r} added no validation registration",
                     missing=(str(commit),))
    result = {"commit": commit, "tsa": url, "reason": None}
    stored = _stored(conn, commit)
    if stored is not None:
        return {**result, "status": "already_stamped", "tsa": None,
                "stamped_at": token_time(bytes(stored["token"]), commit, tsa_roots),
                "witness_commit": _witness_commit(conn, commit)}
    query, nonce = _query(commit)
    try:
        token = _granted_token(_post(url, query))
    except (OSError, urllib.error.URLError, http.client.HTTPException):
        token = None
    if token is None:
        return {**result, "status": "failed", "stamped_at": None, "witness_commit": None,
                "reason": "WITNESS_UNAVAILABLE"}
    moment = token_time(token, commit, tsa_roots, nonce)
    earliest = registered.replace(tzinfo=UTC)
    if moment.microsecond == 0:  # a whole-second genTime is compared at its own resolution
        earliest = earliest.replace(microsecond=0)
    if moment < earliest or moment > datetime.now(UTC) + CLOCK_TOLERANCE:
        raise _invalid(commit, "has a genTime before the registration or after the local clock")

    def insert(c, op):
        c.rows("INSERT INTO witness (commit_hash, token, op_id) VALUES (%s, %s, %s)", (commit, token, op))
        return {"commit_hash": commit}

    try:
        written = db.write(conn, "witness", {"commit": commit}, "witness", insert, op_id=f"witness:{commit}")
    except Refusal as exc:
        if exc.code == "CONCURRENT_WRITE" and _stored(conn, commit) is not None:
            return witness(conn, commit, tsa_url, tsa_roots)
        raise
    if written["replayed"]:
        return witness(conn, commit, tsa_url, tsa_roots)
    return {**result, "status": "stamped", "stamped_at": moment, "witness_commit": written["commit"]}


def stamped_at(conn: db.LedgerConnection, commit: str, tsa_roots: Path | None = None) -> datetime | None:
    """The verified genTime of the commit's stored token, or None when it has none."""
    stored = _stored(conn, commit)
    return None if stored is None else token_time(bytes(stored["token"]), commit, tsa_roots)


def sync_witness(conn: db.LedgerConnection, tsa_url: str | None = None, tsa_roots: Path | None = None) -> dict:
    """Timestamp every validation registration commit that has no token yet, oldest first."""
    commits = [commit for commit, _ in conn.rows(
        "SELECT to_commit, MIN(to_created_at) AS first FROM dolt_diff_validation_registration "
        "WHERE diff_type = 'added' GROUP BY to_commit ORDER BY first")]
    witnessed, already, failed = [], 0, []
    for commit in commits:
        if _stored(conn, commit) is not None:
            already += 1
            continue
        outcome = witness(conn, commit, tsa_url, tsa_roots)
        if outcome["status"] == "stamped":
            witnessed.append(commit)
        elif outcome["status"] == "already_stamped":
            already += 1
        else:
            failed.append({"commit": commit, "reason": outcome["reason"]})
    return {"witnessed": witnessed, "already": already, "failed": failed}
