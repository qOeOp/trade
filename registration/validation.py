"""Out-of-sample validation (`registration.validation_register`, `registration.validation_bind`,
`registration.membership_unchanged`, `registration.require_fresh`).

The user starts a validation: one candidate, a window that begins after the registration is both
recorded and witnessed by an RFC 3161 token, a universe rule and a declared design. The one replay
bound to it must match the registration in source, universe, window, coverage, account terms and
runtime; binding consumes the registration whatever the replay's outcome.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import subprocess

from ledger import db, execution, strategies, witness
from ledger.errors import Refusal
from ledger.refusals import refuse
from registration import comparability, register, seams


EPOCH = datetime(1970, 1, 1)


def _ns(moment: datetime) -> int:
    delta = moment - EPOCH
    return (delta.days * 86_400 + delta.seconds) * 10**9 + delta.microseconds * 1000


def _naive_utc(moment) -> datetime:
    return moment.astimezone(UTC).replace(tzinfo=None) if moment.tzinfo is not None else moment


def _months(start: datetime, end: datetime) -> list[str]:
    """Every YYYY-MM month that [start, end) touches."""
    months, month = [], seams.month_of(start)
    last = seams.month_of(end - timedelta(microseconds=1))
    while month <= last:
        months.append(month)
        month = seams.next_month(month)
    return months


def _git(root: Path, *argv: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(root), *argv], capture_output=True, text=True, check=False, timeout=120)


def require_fresh(checkout: Path | None = None, remote: str = "origin") -> None:
    """Refuse unless the product checkout's HEAD contains the remote's latest main commit; uncommitted
    or untracked files in its work tree are not checked."""
    root = Path(checkout) if checkout is not None else seams.current.checkout()

    def stale(why: str):
        return refuse("STALE_CHECKOUT", why, missing=(str(root),))
    inside = _git(root, "rev-parse", "--is-inside-work-tree")
    if inside.returncode or inside.stdout.strip() != "true":
        raise stale(f"{root} is not a git work tree")
    listed = _git(root, "ls-remote", remote, "refs/heads/main")
    heads = [line.split()[0] for line in listed.stdout.splitlines() if line.strip()]
    if listed.returncode or len(heads) != 1:
        raise stale(f"the main commit of {remote} cannot be queried")
    if _git(root, "merge-base", "--is-ancestor", heads[0], "HEAD").returncode:
        raise stale(f"HEAD does not contain {remote} main {heads[0]}")


def _by_month(rows) -> dict[str, list[tuple]]:
    grouped: dict[str, list[tuple]] = {}
    for row in rows:
        grouped.setdefault(str(row[0]), []).append(tuple(row))
    return {month: sorted(items) for month, items in grouped.items()}


def _covered(interval: tuple[int, int], given: list) -> bool:
    start, end = interval
    for lo, hi in sorted(tuple(item) for item in given or ()):
        if lo <= start < hi:
            start = hi
        if start >= end:
            return True
    return start >= end


def membership_unchanged(market, registration: Mapping, inputs: Mapping) -> None:
    """Refuse MEMBERSHIP_CHANGED unless the replay's universe keeps the registered rule, every month up to
    and including the registration month, every window month and every member of the path the
    strategy receives."""
    adapter = seams.current.market(market)
    identity = inputs["identity"]

    def changed(why: str, *missing: str):
        return refuse("MEMBERSHIP_CHANGED", why, missing=missing)
    if identity.get("universe_rule") != registration["universe_rule"]:
        raise changed(f"universe rule {identity.get('universe_rule')} is not the registered "
                      f"{registration['universe_rule']}", "universe_rule")
    registered_month = seams.month_of(registration["created_at"])
    then = _by_month(adapter.universe_month(registration["market_commit"]))
    now = _by_month(adapter.universe_month(identity["market_commit"]))
    for month in sorted(set(then) | set(now)):
        if month <= registered_month and then.get(month) != now.get(month):
            symbols = sorted({row[1] for row in set(then.get(month, [])) ^ set(now.get(month, []))})
            raise changed(f"members of {month} changed between the market commits: " + ", ".join(symbols), month,
                          *symbols)
    start, end = _naive_utc(registration["window_start"]), _naive_utc(registration["window_end"])
    absent = [month for month in _months(start, end) if month not in now]
    if absent:
        raise changed("window months not produced at the market commit: " + ", ".join(absent), *absent)
    derived = adapter.membership_path(identity["market_commit"], _ns(end))["membership"]
    given = identity.get("membership") or {}
    for symbol, intervals in sorted(derived.items()):
        for lo, hi in intervals:
            clipped = (max(lo, _ns(start)), min(hi, _ns(end)))
            if clipped[0] < clipped[1] and not _covered(clipped, given.get(symbol)):
                raise changed(f"{symbol} is removed from or shortened in the strategy's membership",
                              seams.month_of(EPOCH + timedelta(microseconds=clipped[0] // 1000)), symbol)


def _registration(conn: db.LedgerConnection, registration_id) -> dict | None:
    return conn.one("SELECT * FROM validation_registration WHERE registration_id = %s", (registration_id,)) \
        if isinstance(registration_id, int) and not isinstance(registration_id, bool) else None


def _birth_commit(conn: db.LedgerConnection, registration_id: int) -> str | None:
    found = conn.rows("SELECT to_commit FROM dolt_diff_validation_registration WHERE to_registration_id = %s "
                      "AND diff_type = 'added' LIMIT 1", (registration_id,))
    return found[0][0] if found else None


def _retry_allowed(conn: db.LedgerConnection, original: dict) -> bool:
    bound = conn.one("SELECT trial_id FROM validation_binding WHERE registration_id = %s",
                     (original["registration_id"],))
    return bound is not None and register.retryable(conn, bound["trial_id"])


def _same_registration(prior: Mapping, payload: Mapping) -> bool:
    design = json.loads(prior["design"]) if isinstance(prior["design"], str) else prior["design"]
    return ({"candidate": f"{prior['strategy_id']}@{prior['revision']}", "market_commit": prior["market_commit"],
             "universe_rule": prior["universe_rule"], "window_start": prior["window_start"].isoformat(),
             "window_end": prior["window_end"].isoformat(), "design": design, "retry_of": prior["retry_of"]}
            == dict(payload))


def validation_register(ledger: db.LedgerProfile, candidate: str, window_start: datetime, window_end: datetime,
                        universe_rule: str, market: str | None, design: Mapping, retry_of: int | None,
                        op_id: str | None, *, market_profile, tsa_url: str | None = None,
                        tsa_roots: Path | None = None) -> dict:
    """Write one validation registration in one commit, then witness that commit; a failed witness
    leaves the registration in place. The same op_id returns the existing registration.

    `market` is the market commit reference (None: the market's default head), resolved through the
    market database `market_profile`."""
    try:
        register.validate_design(design)
    except Refusal as exc:
        raise refuse("DESIGN_INVALID", exc.message, missing=exc.missing) from exc
    if (not isinstance(window_start, datetime) or not isinstance(window_end, datetime)
            or window_start.utcoffset() != timedelta(0) or window_end.utcoffset() != timedelta(0)
            or not window_start < window_end):
        raise refuse("WINDOW_INVALID", "the window needs UTC start and end times with start before end",
                     expected="window_start < window_end, both UTC")
    start, end = _naive_utc(window_start), _naive_utc(window_end)
    with db.connect(ledger, "writer") as conn:
        try:
            row = strategies.read_candidate(conn, candidate)
        except Refusal as exc:
            if exc.code in ("UNKNOWN_CANDIDATE", "BAD_REF"):
                raise refuse("CANDIDATE_UNKNOWN", f"{candidate!r} is no published candidate",
                             missing=(str(candidate),)) from exc
            raise
        market_commit = seams.current.market(market_profile).resolve_commit(market)
        if retry_of is not None:
            original = _registration(conn, retry_of)
            if (original is None or (original["strategy_id"], original["revision"]) != (row["strategy_id"], row["revision"])
                    or (original["window_start"], original["window_end"]) != (start, end)
                    or original["universe_rule"] != universe_rule or not _retry_allowed(conn, original)):
                raise refuse("RETRY_NOT_ALLOWED", f"registration {retry_of} cannot be retried", missing=(str(retry_of),))
        payload = {"candidate": f"{row['strategy_id']}@{row['revision']}", "market_commit": market_commit,
                   "universe_rule": universe_rule, "window_start": start.isoformat(), "window_end": end.isoformat(),
                   "design": dict(design), "retry_of": retry_of}

        def insert(c, op):
            c.rows("INSERT INTO validation_registration (strategy_id, revision, market_commit, universe_rule, "
                   "window_start, window_end, design, retry_of, op_id, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, "
                   "%s, %s, UTC_TIMESTAMP(6))",
                   (row["strategy_id"], row["revision"], market_commit, universe_rule, start, end,
                    db.canonical_json(dict(design)), retry_of, op))
            (registration_id,), = c.rows("SELECT LAST_INSERT_ID()")
            created = c.rows("SELECT created_at FROM validation_registration WHERE registration_id = %s",
                             (registration_id,))[0][0]
            if retry_of is None and start <= created:
                raise refuse("REGISTRATION_TOO_LATE", f"the window starts at {start}, not after the registration "
                                                      f"time {created}", missing=("window_start",))
            return {"registration_id": registration_id}

        def replay(c, prior):  # the same op_id returns the existing registration only for the same content
            if not _same_registration(prior, payload):
                raise refuse("OP_ID_CONFLICT", f"operation {op_id} already registered other content as validation "
                                               f"registration {prior['registration_id']}",
                             missing=(str(op_id),))
            return {"registration_id": prior["registration_id"]}

        written = db.write(conn, "validation_register", payload, "validation_registration", insert, replay, op_id=op_id)
        registration_id = written["record"]["registration_id"]
        created_at = conn.rows("SELECT created_at FROM validation_registration WHERE registration_id = %s",
                               (registration_id,))[0][0]
        commit = _birth_commit(conn, registration_id)
        try:
            stamped = witness.witness(conn, commit, tsa_url, tsa_roots)
            result = ({"status": "stamped", "stamped_at": stamped["stamped_at"], "error": None}
                      if stamped["status"] in ("stamped", "already_stamped")
                      else {"status": "failed", "stamped_at": None, "error": stamped["reason"]})
        except Refusal as exc:
            result = {"status": "failed", "stamped_at": None, "error": exc.code}
        except (ValueError, RuntimeError, OSError) as exc:  # the registration is committed; the witness is retried
            result = {"status": "failed", "stamped_at": None, "error": str(exc)}
    return {"registration_id": registration_id, "ledger_commit": commit, "created_at": created_at, "witness": result,
            "replayed": written["replayed"]}


def _origin(conn: db.LedgerConnection, registration: dict) -> dict:
    while registration["retry_of"] is not None:
        registration = _registration(conn, registration["retry_of"])
    return registration


def validation_bind(conn: db.LedgerConnection, registration_id: int, trial_id: int, source_sha256: str,
                    identity: Mapping, inspection: Mapping, *, market, checkout: Path | None = None,
                    remote: str = "origin", tsa_roots: Path | None = None) -> None:
    """Inside the validation trial's write: check everything against the registration, then bind it once.

    The trial's inputs are read from what it records: its row (source, instruments, windows) and its
    start receipt (input identity in execution.json; export receipts and effective configuration in
    input-coverage.json). `market` is the market profile the membership is reread from AS OF."""
    require_fresh(checkout, remote)
    seams.current.require_main_build(dict(identity), dict(inspection))
    trial = conn.one("SELECT trial_id, purpose, source_sha256, image_digest, instruments, input_start, trade_start, trade_end, "
                     "op_id, created_at FROM trial WHERE trial_id = %s", (trial_id,))
    if trial is None:
        raise refuse("TRIAL_NOT_FOUND", f"no trial {trial_id} in this transaction", missing=(str(trial_id),))
    if trial["purpose"] != "validation":
        raise refuse("BINDING_NOT_ALLOWED", f"a {trial['purpose']} trial takes no validation binder")
    if trial["image_digest"] != identity.get("image_digest"):
        raise refuse("RUNTIME_NOT_MAIN", f"trial {trial_id} ran {trial['image_digest']}, not the checked main build",
                     missing=("image_digest",))
    registration = _registration(conn, registration_id)
    if registration is None:
        raise refuse("REGISTRATION_UNKNOWN", f"no validation registration {registration_id!r}",
                     missing=(str(registration_id),))
    candidate = strategies.read_candidate(conn, f"{registration['strategy_id']}@{registration['revision']}")
    if candidate["source_sha256"] != source_sha256 or trial["source_sha256"] != source_sha256:
        raise refuse("SOURCE_MISMATCH", f"source {trial['source_sha256']} is not the registered candidate's",
                     missing=(str(trial["source_sha256"]),))
    recorded = execution.read_capture(conn, trial_id)
    coverage = recorded["input_coverage"] if isinstance(recorded["input_coverage"], Mapping) else {}
    started = recorded["start"].get("input_identity")
    started = started if isinstance(started, Mapping) else {}
    instruments = json.loads(trial["instruments"]) if isinstance(trial["instruments"], str) else trial["instruments"]
    if (not isinstance(instruments, list) or instruments != started.get("symbols")
            or not isinstance(started.get("membership"), Mapping) or set(started["membership"]) != set(instruments)):
        raise refuse("MEMBERSHIP_CHANGED", f"trial {trial_id} trades instruments other than its recorded membership",
                     missing=("instruments",))
    membership_unchanged(market, registration, {"identity": started})
    start, end = registration["window_start"], registration["window_end"]
    if not (trial["trade_start"] == start and trial["trade_end"] == end and trial["created_at"] > end):
        raise refuse("WINDOW_MISMATCH", f"trial {trial_id} trades [{trial['trade_start']}, {trial['trade_end']}) at "
                                        f"{trial['created_at']}; the registered window is [{start}, {end})",
                     missing=("window",))
    receipts = coverage.get("export_receipts") if isinstance(coverage.get("export_receipts"), Mapping) else {}
    needed = (_ns(trial["input_start"]), _ns(trial["trade_end"]))
    uncovered = [symbol for symbol in instruments if not isinstance(receipts.get(symbol), Mapping)
                 or not receipts[symbol].get("start_ns", needed[0] + 1) <= needed[0]
                 or not receipts[symbol].get("end_ns", needed[1] - 1) >= needed[1]]
    if uncovered:
        raise refuse("COVERAGE_INCOMPLETE", "members without a covering receipt: " + ", ".join(uncovered),
                     missing=tuple(uncovered))
    origin = _origin(conn, registration)
    commit = _birth_commit(conn, origin["registration_id"])
    stamped = witness.stamped_at(conn, commit, tsa_roots) if commit else None
    if stamped is None or not stamped < start.replace(tzinfo=UTC):
        raise refuse("REGISTRATION_TOO_LATE", f"registration {origin['registration_id']} has no witness before the "
                                              f"window starts at {start}", missing=(str(origin["registration_id"]),))
    latest = conn.one("SELECT r.run_id FROM run r JOIN trial t ON t.trial_id = r.trial_id WHERE t.purpose = 'research' "
                      "AND t.source_sha256 = %s AND r.status = 'passed' ORDER BY r.run_id DESC LIMIT 1",
                      (source_sha256,))
    if latest is None:
        raise refuse("CONFIG_MISMATCH", "the candidate has no valid research run to compare account terms with",
                     missing=("research run",))
    research = register.control_run(conn, latest["run_id"])
    if comparability.config_key(research["effective_config"])["account"] != comparability.config_key(
            coverage.get("effective_config"))["account"]:
        raise refuse("CONFIG_MISMATCH", f"the account terms differ from research run {latest['run_id']}",
                     missing=("account",))
    if conn.rows("SELECT 1 FROM validation_binding WHERE registration_id = %s OR trial_id = %s",
                 (registration_id, trial_id)):
        raise refuse("REGISTRATION_CONSUMED", f"registration {registration_id} or trial {trial_id} is already bound",
                     missing=(str(registration_id),))
    try:
        conn.rows("INSERT INTO validation_binding (registration_id, trial_id, op_id) VALUES (%s, %s, %s)",
                  (registration_id, trial_id, trial["op_id"]))
    except Refusal as exc:
        if exc.code == "DOLT_SQL_ERROR":
            raise refuse("REGISTRATION_CONSUMED", f"registration {registration_id} is already bound",
                         missing=(str(registration_id),)) from exc
        raise


def validation_binder(registration_id: int, source_sha256: str, identity: Mapping, inspection: Mapping,
                      **options) -> Callable[[db.LedgerConnection, int], None]:
    """The binder ledger.open_trial calls for a validation replay."""
    return lambda conn, trial_id: validation_bind(conn, registration_id, trial_id, source_sha256, identity,
                                                  inspection, **options)
