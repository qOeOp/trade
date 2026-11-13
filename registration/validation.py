"""Out-of-sample validation (`registration.validation_register`, `registration.validation_bind`,
`registration.membership_unchanged`, `registration.require_fresh`; `registration.require_current` for research).

The user starts a validation: one candidate, a window that begins after the registration is both
recorded and witnessed by an RFC 3161 token, a universe rule and a declared design. The one replay
bound to it keeps the original registration's source, universe, window, test design and account
baseline, with complete coverage and a verified main runtime; binding consumes the registration
whatever the replay's outcome.
"""

from __future__ import annotations

from collections.abc import Mapping
import dataclasses
from datetime import UTC, datetime, timedelta
from pathlib import Path
import subprocess

from ledger import db, execution, strategies, witness
from ledger import trials
from shared.errors import Refusal
from shared.refusals import refuse
from registration import register, seams


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


def require_current(checkout: Path | None = None, remote: str = "origin") -> None:
    """Research registration and replay: refuse unless the product checkout's HEAD is the locally fetched
    `<remote>/main` and its work tree has no uncommitted or untracked file, so a run records the commit it ran
    from. No network: the checkout fetches first."""
    root = Path(checkout) if checkout is not None else seams.current.checkout()

    def stale(why: str):
        return refuse("STALE_CHECKOUT", why, missing=(str(root),), expected=f"HEAD = {remote}/main, clean work tree")
    head = _git(root, "rev-parse", "HEAD")
    main = _git(root, "rev-parse", "--verify", "--quiet", f"refs/remotes/{remote}/main")
    if head.returncode:
        raise stale(f"{root} is not a git work tree")
    if main.returncode:
        raise stale(f"{root} has no fetched {remote}/main")
    if head.stdout.strip() != main.stdout.strip():
        raise stale(f"HEAD {head.stdout.strip()[:9]} is not {remote}/main {main.stdout.strip()[:9]}")
    changed = _git(root, "status", "--porcelain")
    if changed.returncode or changed.stdout.strip():
        raise stale(f"the work tree has uncommitted or untracked files: {' '.join(changed.stdout.split()[:6])}")


def _by_month(rows) -> dict[str, list[tuple]]:
    grouped: dict[str, list[tuple]] = {}
    for row in rows:
        grouped.setdefault(str(row[0]), []).append(tuple(row))
    return {month: sorted(items) for month, items in grouped.items()}


def _covered(interval: tuple[int, int], given: list | None) -> bool:
    start, end = interval
    for lo, hi in sorted(tuple(item) for item in given or ()):
        if lo <= start < hi:
            start = hi
        if start >= end:
            return True
    return start >= end


def membership_unchanged(market, registration: Mapping, inputs: Mapping, baseline: Mapping) -> None:
    """Refuse MEMBERSHIP_CHANGED unless the replay's universe keeps the registered rule, every month up to
    and including the registration month, every window month and every member of the path the
    strategy receives (`inputs["membership"]`, the membership file's content). `baseline` is the selection of the candidate's baseline research run: a run on
    `{"symbols": S}` is validated on exactly S and only S's members are checked; any other baseline
    (the whole universe) keeps every member of the pool."""
    adapter = seams.current.market(market)
    identity = inputs["identity"]

    def changed(why: str, *missing: str):
        return refuse("MEMBERSHIP_CHANGED", why, missing=missing)
    if identity.get("universe_rule") != registration["universe_rule"]:
        raise changed(f"universe rule {identity.get('universe_rule')} is not the registered "
                      f"{registration['universe_rule']}", "universe_rule")
    registered_month = seams.month_of(registration["created_at"])
    then = _by_month(adapter.universe_month(registration["market_day"]))
    now = _by_month(adapter.universe_month(identity["market_day"]))
    for month in sorted(set(then) | set(now)):
        if month <= registered_month and then.get(month) != now.get(month):
            symbols = sorted({row[1] for row in set(then.get(month, [])) ^ set(now.get(month, []))})
            raise changed(f"members of {month} changed between the market days: " + ", ".join(symbols), month,
                          *symbols)
    start, end = _naive_utc(registration["window_start"]), _naive_utc(registration["window_end"])
    absent = [month for month in _months(start, end) if month not in now]
    if absent:
        raise changed("window months not produced at the market day: " + ", ".join(absent), *absent)
    derived = adapter.membership_path(identity["market_day"], _ns(end))["membership"]
    received = inputs.get("membership")
    given = received.get("membership") if isinstance(received, Mapping) else None
    given = given if isinstance(given, Mapping) else {}
    subset = None if baseline.get("universe") is True else baseline.get("symbols")
    if subset:
        chosen = identity.get("selection") or {}
        if sorted(chosen.get("symbols") or ()) != sorted(subset):
            raise changed(f"the replay selects {chosen}, not the baseline research run's symbols {sorted(subset)}",
                          "selection")
        derived = {symbol: derived[symbol] for symbol in subset if symbol in derived}
    for symbol, intervals in sorted(derived.items()):
        for lo, hi in intervals:
            clipped = (max(lo, _ns(start)), min(hi, _ns(end)))
            if clipped[0] < clipped[1] and not _covered(clipped, given.get(symbol)):
                raise changed(f"{symbol} is removed from or shortened in the strategy's membership",
                              seams.month_of(EPOCH + timedelta(microseconds=clipped[0] // 1000)), symbol)


def candidate_registrations(conn: db.LedgerConnection, source_sha256: str) -> list[dict]:
    """Every out-of-sample registration of one candidate; status is the bound run's audit status, no verdict on returns."""
    return [{"registration_id": item["registration_id"], "window_start": item["window_start"],
             "window_end": item["window_end"], "universe_rule": item["universe_rule"], "retry_of": item["retry_of"],
             "status": item["status"] or ("bound" if item["trial_id"] else "unbound")}
            for item in conn.dicts("SELECT g.registration_id, g.window_start, g.window_end, g.universe_rule, g.retry_of, "
                                   "t.trial_id, r.status FROM validation_registration g LEFT JOIN trial t ON "
                                   "t.validation_registration_id = g.registration_id LEFT JOIN run r ON r.trial_id = "
                                   "t.trial_id WHERE g.source_sha256 = %s ORDER BY g.registration_id", (source_sha256,))]


def _registration(conn: db.LedgerConnection, registration_id) -> dict | None:
    return conn.one("SELECT * FROM validation_registration WHERE registration_id = %s", (registration_id,)) \
        if isinstance(registration_id, int) and not isinstance(registration_id, bool) else None


def birth_commit(conn: db.LedgerConnection, registration_id: int) -> str | None:
    """The commit that added a validation registration (the one its witness stamps)."""
    found = conn.rows("SELECT to_commit FROM dolt_diff_validation_registration WHERE to_registration_id = %s "
                      "AND diff_type = 'added' LIMIT 1", (registration_id,))
    return found[0][0] if found else None


def _retry_allowed(conn: db.LedgerConnection, original: dict) -> bool:
    bound = conn.one("SELECT trial_id FROM trial WHERE validation_registration_id = %s", (original["registration_id"],))
    return bound is not None and register.retryable(conn, bound["trial_id"])


def _same_registration(conn: db.LedgerConnection, prior: Mapping, payload: Mapping) -> bool:
    return ({"source_sha256": prior["source_sha256"], "market_day": prior["market_day"],
             "universe_rule": prior["universe_rule"], "window_start": prior["window_start"].isoformat(),
             "window_end": prior["window_end"].isoformat(),
             "design": register.read_design(conn, prior["comparison_design_id"]), "retry_of": prior["retry_of"]}
            == dict(payload))


def validation_register(ledger: db.LedgerProfile, candidate: str, window_start: datetime, window_end: datetime,
                        universe_rule: str, market: str | None, design: Mapping, retry_of: int | None,
                        op_id: str | None, *, market_profile, tsa_url: str | None = None) -> dict:
    """Write one validation registration in one commit, then witness that commit; a failed witness
    leaves the registration in place. The same op_id returns the existing registration.

    `market` is the market day reference (None: the market's default head), resolved through the
    market `market_profile`."""
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
        market_day = seams.current.market(market_profile).resolve_day(market)
        if retry_of is not None:
            original = _registration(conn, retry_of)
            if (original is None or original["source_sha256"] != row["source_sha256"]
                    or (original["window_start"], original["window_end"]) != (start, end)
                    or original["universe_rule"] != universe_rule
                    or register.read_design(conn, original_registration(conn, original)["comparison_design_id"])
                    != dict(design) or not _retry_allowed(conn, original)):
                raise refuse("RETRY_NOT_ALLOWED", f"registration {retry_of} cannot be retried", missing=(str(retry_of),))
        payload = {"source_sha256": row["source_sha256"], "market_day": market_day,
                   "universe_rule": universe_rule, "window_start": start.isoformat(), "window_end": end.isoformat(),
                   "design": dict(design), "retry_of": retry_of}

        def insert(c, op):
            (now,), = c.rows("SELECT UTC_TIMESTAMP(6)")
            if retry_of is None and start <= now:  # the table's CHECK holds it too
                raise refuse("REGISTRATION_TOO_LATE", f"the window starts at {start}, not after the registration "
                                                      f"time {now}", missing=("window_start",))
            c.rows("INSERT INTO validation_registration (source_sha256, market_day, universe_rule, window_start, "
                   "window_end, comparison_design_id, retry_of, op_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                   (row["source_sha256"], market_day, universe_rule, start, end, register.write_design(c, design),
                    retry_of, op))
            (registration_id,), = c.rows("SELECT LAST_INSERT_ID()")
            return {"registration_id": registration_id}

        def replay(c, prior):  # the same op_id returns the existing registration only for the same content
            if not _same_registration(c, prior, payload):
                raise refuse("OP_ID_CONFLICT", f"operation {op_id} already registered other content as validation "
                                               f"registration {prior['registration_id']}",
                             missing=(str(op_id),))
            return {"registration_id": prior["registration_id"]}

        written = db.write(conn, "validation_register", payload, "validation_registration", insert, replay, op_id=op_id)
        registration_id = written["record"]["registration_id"]
        created_at = conn.rows("SELECT created_at FROM validation_registration WHERE registration_id = %s",
                               (registration_id,))[0][0]
        commit = birth_commit(conn, registration_id)
        try:
            stamped = witness.witness(conn, commit, tsa_url)
            result = ({"status": "stamped", "stamped_at": stamped["stamped_at"], "error": None}
                      if stamped["status"] in ("stamped", "already_stamped")
                      else {"status": "failed", "stamped_at": None, "error": stamped["reason"]})
        except Refusal as exc:
            result = {"status": "failed", "stamped_at": None, "error": exc.code}
        except (ValueError, RuntimeError, OSError) as exc:  # the registration is committed; the witness is retried
            result = {"status": "failed", "stamped_at": None, "error": str(exc)}
    return {"registration_id": registration_id, "ledger_commit": commit, "created_at": created_at, "witness": result,
            "replayed": written["replayed"]}


def original_registration(conn: db.LedgerConnection, registration: dict) -> dict:
    """Follow retry_of to the registration whose preregistration boundary admission and reports use."""
    while registration["retry_of"] is not None:
        original = _registration(conn, registration["retry_of"])
        assert original is not None  # the foreign key on retry_of keeps the original registration
        registration = original
    return registration


def validation_bind(conn: db.LedgerConnection, registration_id: int, row: Mapping, source_sha256: str,
                    identity: Mapping, inspection: Mapping, *, market, checkout: Path | None = None,
                    remote: str = "origin") -> dict:
    """Inside the validation trial's write, before its row: check everything against the registration, which
    the trial then consumes once.

    `row` is the trial row about to be written (open_trial's binder argument): its source, instruments, windows
    and coverage receipt (input identity, export receipts and effective configuration). `market` is the market
    profile the membership is reread from AS OF."""
    require_fresh(checkout, remote)
    seams.current.require_main_build(dict(identity), dict(inspection))
    if row["purpose"] != "validation":
        raise refuse("BINDING_NOT_ALLOWED", f"a {row['purpose']} trial takes no validation binder")
    if row["image_digest"] != identity.get("image_digest"):
        raise refuse("RUNTIME_NOT_MAIN", f"the trial runs {row['image_digest']}, not the checked main build",
                     missing=("image_digest",))
    registration = _registration(conn, registration_id)
    if registration is None:
        raise refuse("REGISTRATION_UNKNOWN", f"no validation registration {registration_id!r}",
                     missing=(str(registration_id),))
    origin = original_registration(conn, registration)
    if registration["source_sha256"] != source_sha256 or row["source_sha256"] != source_sha256:
        raise refuse("SOURCE_MISMATCH", f"source {row['source_sha256']} is not the registered candidate's",
                     missing=(str(row["source_sha256"]),))
    coverage: Mapping = row["input_coverage"] if isinstance(row.get("input_coverage"), Mapping) else {}
    started: Mapping = coverage["input_identity"] if isinstance(coverage.get("input_identity"), Mapping) else {}
    instruments = list(row["instruments"])
    received = coverage.get("membership")
    members = received.get("membership") if isinstance(received, Mapping) else None
    if (instruments != sorted(started.get("symbols") or ())
            or not isinstance(members, Mapping) or set(members) != set(instruments)):
        raise refuse("MEMBERSHIP_CHANGED", "the trial trades instruments other than its recorded membership",
                     missing=("instruments",))
    read = received.get("market_day") if isinstance(received, Mapping) else None
    if read != row["market_day"]:
        raise refuse("MEMBERSHIP_CHANGED", f"the membership file the trial read is of market day "
                                           f"{read}, not the trial's market day "
                                           f"{row['market_day']}", missing=("membership",))
    if row["universe_rule"] != registration["universe_rule"]:
        raise refuse("MEMBERSHIP_CHANGED", f"universe rule {row['universe_rule']} is not the registered "
                                           f"{registration['universe_rule']}", missing=("universe_rule",))
    start, end = registration["window_start"], registration["window_end"]
    stamp = witness.registration_stamp(conn, origin["registration_id"])
    if stamp is None or not stamp[1] < start.replace(tzinfo=UTC):
        raise refuse("REGISTRATION_TOO_LATE", f"registration {origin['registration_id']} has no witness before the "
                                              f"window starts at {start}", missing=(str(origin["registration_id"]),))
    commit = stamp[0]
    # Derive the baseline from the original registration's immutable snapshot, not later research
    # or a retry's newer commit. No duplicate account/configuration identity is stored.
    with db.read_as_of(conn.profile, commit) as registered:
        latest = trials.latest_research(registered, source_sha256)
        if latest is None:
            raise refuse("CONFIG_MISMATCH", f"the candidate had no passed research run at original registration "
                                           f"{origin['registration_id']} ({commit})", missing=("research run",))
        research = execution.read_capture(registered, latest)
    baseline = (research["start"].get("input_identity") or {}).get("selection")
    membership_unchanged(market, origin, {"identity": started, "membership": received},
                         baseline if isinstance(baseline, Mapping) else {})
    (now,), = conn.rows("SELECT UTC_TIMESTAMP(6)")
    if not (row["trade_start"] == start and row["trade_end"] == end and now > end):
        raise refuse("WINDOW_MISMATCH", f"the trial trades [{row['trade_start']}, {row['trade_end']}) at {now}; the "
                                        f"registered window is [{start}, {end})", missing=("window",))
    receipts = coverage.get("export_receipts")
    receipts = receipts if isinstance(receipts, Mapping) else {}
    needed = (_ns(row["input_start"]), _ns(row["trade_end"]))
    uncovered = [symbol for symbol in instruments if not isinstance(receipts.get(symbol), Mapping)
                 or not receipts[symbol].get("start_ns", needed[0] + 1) <= needed[0]
                 or not receipts[symbol].get("end_ns", needed[1] - 1) >= needed[1]]
    if uncovered:
        raise refuse("COVERAGE_INCOMPLETE", "members without a covering receipt: " + ", ".join(uncovered),
                     missing=tuple(uncovered))
    if trials.config_key((research["input_coverage"] or {}).get("effective_config"))["account"] != trials.config_key(
            coverage.get("effective_config"))["account"]:
        raise refuse("CONFIG_MISMATCH", f"the account terms differ from research run {latest} fixed at original "
                                       f"registration {origin['registration_id']} ({commit})",
                     missing=("account",))
    if conn.rows("SELECT 1 FROM trial WHERE validation_registration_id = %s", (registration_id,)):
        raise refuse("REGISTRATION_CONSUMED", f"registration {registration_id} is already bound",
                     missing=(str(registration_id),))
    return {"validation_registration_id": registration_id}


@dataclasses.dataclass(frozen=True)
class ValidationBinder:
    """The binder ledger.open_trial calls for a validation replay."""
    registration_id: int
    source_sha256: str
    identity: Mapping
    inspection: Mapping
    options: Mapping

    @property
    def registration(self) -> dict:
        return {"validation_registration_id": self.registration_id}

    def __call__(self, conn: db.LedgerConnection, row: Mapping) -> dict:
        return validation_bind(conn, self.registration_id, row, self.source_sha256, self.identity, self.inspection,
                               **self.options)


def validation_binder(registration_id: int, source_sha256: str, identity: Mapping, inspection: Mapping,
                      **options) -> ValidationBinder:
    return ValidationBinder(registration_id, source_sha256, identity, inspection, options)
