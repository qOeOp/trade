"""External witness: an RFC 3161 timestamp of every freeze and confirmation-plan commit.

After the record's commit lands, the 32 ASCII characters of its Dolt commit hash are sent as a
SHA-256 imprint to a public timestamp authority (DigiCert, else Sectigo). The signed response is
stored in the `witness` table by a second write, since it stamps the first commit. Verification is
offline with `openssl ts -verify` against the roots pinned in `tsa-roots.pem`, as of the token's own
time. The token's time is what a confirmation checks: its plan was stamped before its window began.
Nothing but the hash leaves the machine.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request

from research.records import db
from research.records.common import RecordError


TSAS = ("http://timestamp.digicert.com", "http://timestamp.sectigo.com")
ROOTS = Path(__file__).with_name("tsa-roots.pem")
COMMIT = re.compile(r"[0-9a-v]{32}\Z")


def _openssl(*argv: str) -> subprocess.CompletedProcess:
    return subprocess.run(["openssl", *argv], capture_output=True, text=True, check=False, timeout=60)


def _request_token(commit: str) -> tuple[str, bytes]:
    """Ask each authority in turn for a signed timestamp of the commit hash; return (url, DER response)."""
    errors = []
    with tempfile.TemporaryDirectory() as directory:
        data, query = Path(directory, "commit"), Path(directory, "query.tsq")
        data.write_text(commit, encoding="ascii")
        made = _openssl("ts", "-query", "-data", str(data), "-sha256", "-cert", "-out", str(query))
        if made.returncode:
            raise RecordError(f"openssl cannot build a timestamp query: {made.stderr.strip()}", code="WITNESS_UNAVAILABLE")
        for url in TSAS:
            request = urllib.request.Request(url, data=query.read_bytes(),
                                             headers={"Content-Type": "application/timestamp-query"})
            try:
                with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - fixed public TSA URLs
                    token = response.read()
                token_time(token, commit)
                return url, token
            except (OSError, RecordError) as exc:
                errors.append(f"{url}: {exc}")
    raise RecordError("no timestamp authority answered: " + "; ".join(errors), code="WITNESS_UNAVAILABLE")


def token_time(token: bytes, commit: str) -> datetime:
    """Verify a stored response against the commit hash and the pinned roots; return its time (naive UTC)."""
    with tempfile.TemporaryDirectory() as directory:
        data, reply = Path(directory, "commit"), Path(directory, "reply.tsr")
        data.write_text(commit, encoding="ascii")
        reply.write_bytes(token)
        text = _openssl("ts", "-reply", "-in", str(reply), "-text")
        found = re.search(r"Status: Granted\..*?Time stamp: (\w{3})\s+(\d+) (\d\d:\d\d:\d\d)(?:\.(\d+))? (\d{4}) GMT",
                          text.stdout, re.S)
        if text.returncode or not found:
            raise RecordError(f"timestamp response for {commit} is unreadable or not granted", code="WITNESS_INVALID")
        month, day, clock, fraction, year = found.groups()
        moment = datetime.strptime(f"{month} {day} {clock} {year}", "%b %d %H:%M:%S %Y")
        if fraction:
            moment = moment.replace(microsecond=int(fraction.ljust(6, "0")[:6]))
        checked = _openssl("ts", "-verify", "-in", str(reply), "-data", str(data), "-CAfile", str(ROOTS),
                           "-attime", str(int(moment.replace(tzinfo=UTC).timestamp())))
        if checked.returncode or "Verification: OK" not in checked.stdout:
            raise RecordError(f"timestamp response for {commit} does not verify: {checked.stderr.strip()[:200]}",
                              code="WITNESS_INVALID")
    return moment


def witness(profile: dict, kind: str, record_id: int, commit: str, conn=None) -> dict:
    """Timestamp one committed record and store the response; idempotent per commit."""
    if not COMMIT.fullmatch(commit):
        raise RecordError(f"invalid Dolt commit {commit!r}", code="WITNESS_INVALID")
    url, token = _request_token(commit)

    def insert(conn):
        added = db.rows(conn, "SELECT 1 FROM dolt_diff_freeze WHERE to_commit = %s AND diff_type = 'added' UNION ALL "
                              "SELECT 1 FROM dolt_diff_confirmation_plan WHERE to_commit = %s AND diff_type = 'added'",
                        (commit, commit))
        if not added:
            raise RecordError(f"commit {commit} added no freeze or confirmation plan on this round",
                              code="WITNESS_INVALID", write_status="not_written")
        db.rows(conn, "INSERT INTO witness (commit_hash, token, op_id) VALUES (%s, %s, %s)",
                (commit, token, f"witness:{commit}"))
        return {"commit_hash": commit}

    written = db.write(profile, kind="witness", op=f"witness:{commit}", table="witness", insert=insert, conn=conn)
    return {"status": "witnessed", "kind": kind, "record_id": record_id, "commit": commit, "tsa": url,
            "stamped_at": token_time(token, commit).isoformat() + "Z", "witness_commit": written.get("commit")}


def stamped_at(conn, commit: str) -> datetime | None:
    """The verified time of the commit's stored timestamp, or None when it has none."""
    row = db.one(conn, "SELECT token FROM witness WHERE commit_hash = %s", (commit,))
    return None if row is None else token_time(row["token"], commit)


def sync(profile: dict) -> dict:
    """Timestamp every freeze and confirmation plan of the open round that has none yet."""
    with db.session(profile) as conn:
        missing = db.rows(conn, "SELECT d.to_commit, d.kind, d.record_id FROM ("
                                "SELECT to_commit, 'freeze' AS kind, to_freeze_id AS record_id FROM dolt_diff_freeze "
                                "WHERE diff_type = 'added' UNION ALL SELECT to_commit, 'confirmation_plan', to_plan_id "
                                "FROM dolt_diff_confirmation_plan WHERE diff_type = 'added') d "
                                "LEFT JOIN witness w ON w.commit_hash = d.to_commit WHERE w.commit_hash IS NULL")
        return {"witnessed": [witness(profile, kind, record_id, commit, conn=conn) for commit, kind, record_id in missing]}
