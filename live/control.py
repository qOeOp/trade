"""Operator web commands over the existing Live custody and native lifecycle."""

from __future__ import annotations

import hashlib
from datetime import date, datetime
from pathlib import Path
import re
import threading
import time

from engine.live_errors import REFUSALS, LiveRefusal
from engine.live_venue import EVIDENCE_TOLERANCE
from ledger import db, paper as paper_records
from shared.errors import Refusal
from live import authority, configuration, credentials, key, notify, reconcile, release, runs, state, views


REQUEST_ID = re.compile(r"[a-z0-9][a-z0-9-]{7,63}\Z")
# The actions on one prepared run (POST /api/live/runs/<run_id>/<action>, live.serve).
RUN_ACTIONS = frozenset({"preflight", "start", "reconcile", "stop", "maintain"})
LAUNCHES = {"preflight": "preflight", "start": "run", "reconcile": "reconcile"}  # action: runner mode

MESSAGES = {
    "LIVE_RELEASE_UNAVAILABLE": "This Live control is not accepting new operations during release handover.",
    "LIVE_CONFIG": "Check the candidate and the supported run settings.",
    "LIVE_SOURCE_MISSING": "This version is no candidate Live can run: it is absent at the research head or its source does not load.",
    "LIVE_SYMBOLS": "Name distinct Binance USDT perpetuals such as BTCUSDT.",
    "LIVE_UNIVERSE": "The market directory gives these contracts no membership this month.",
    "LIVE_REQUEST_CONFLICT": "This request ID already belongs to a different operation.",
    "LIVE_CREDENTIAL_CHANGED": "The selected credential changed. Prepare a new run.",
    "LIVE_CREDENTIAL_BUSY": "An active or unresolved execution still requires its credential version.",
    "LIVE_CREDENTIAL_UNAVAILABLE": "The required local credential version is unavailable.",
    "LIVE_CREDENTIAL_UNMANAGED": "This run has no managed credential version and cannot launch.",
    "LIVE_ACCOUNT_OWNED": "Another Live execution is active or cannot yet be verified as resolved.",
    "LIVE_KEY_WITHDRAWAL": "This API key permits withdrawals and cannot start this Live run.",
    "LIVE_KEY_IP_UNRESTRICTED": "A Live run needs an API key restricted to this host's IP at Binance.",
    "LIVE_KEY_UNVERIFIED": "The API key permissions could not be verified.",
    "LIVE_IDENTITY_CHANGED": "The retained inputs, confirmation or resource identity do not match.",
    "LIVE_EVIDENCE_MISSING": "No passed replay of this candidate on these instruments at this leverage runs this image's replay code.",
    "LIVE_CANDIDATE_FALSIFIED": "The line's closing history test found this candidate short of its targets.",
    "LIVE_HISTORY_UNDECIDED": "The line's closing history test has not decided this candidate yet.",
    "LIVE_PAPER_UNRECONCILED": "No sealed Paper run of this candidate on these contracts matches its replay yet.",
    "LIVE_RESTART_REQUIRES_RECONCILIATION": "An attempted run cannot restart its strategy. Review the original execution.",
    "LIVE_NOTIFY_TOKEN": "Telegram did not accept this bot token. Copy it again from @BotFather.",
    "LIVE_NOTIFY_NO_CHAT": "No private chat has messaged this bot yet. Send it any message from Telegram, then save again.",
    "LIVE_NOTIFY_CHATS": "More than one private chat has messaged this bot. Create a new bot that only you message.",
    "LIVE_NOTIFY_TELEGRAM": "Telegram could not be reached or did not deliver. Try again later.",
    "LIVE_NOTIFY_UNCONFIGURED": "Save a Telegram bot token first.",
    "LIVE_NOTIFY_STORE": "The private notification settings are unavailable.",
    "LIVE_NOTIFY_BUSY": "Another Live control is sending notifications. Try again in a moment.",
}


def error(code: str, request_id: str | None = None) -> dict:
    known = code if code in REFUSALS else "LIVE_RECORD_UNAVAILABLE"
    body = {"ok": False, "error": {"code": known, "message": MESSAGES.get(
        known, "Live could not confirm this operation. Check the run or key, then send the same request again.")}}
    if isinstance(request_id, str) and REQUEST_ID.fullmatch(request_id):
        body["request_id"] = request_id
    return body


def _profile(config: configuration.Configuration) -> db.LedgerProfile:
    return db.LedgerProfile.from_json(state.read(config.research_ledger))


def _review(config: configuration.Configuration, root: Path, run_id: str) -> dict:
    _, manifest = runs.read_manifest(root, run_id)
    result = runs.review(_profile(config), manifest)
    # The CLI serializer already formats these reader datetime values. Direct HTTP
    # reads need the same wire dates, without a general str(object) fallback.
    result["validations"] = [
        {**row, **{name: row[name].isoformat() if isinstance(row.get(name), (date, datetime)) else row.get(name)
                   for name in ("window_start", "window_end")}}
        for row in result["validations"]]
    return result


def run_view(config: configuration.Configuration, run_id: str, *, review: bool = True) -> dict:
    result = views.run_view(config.root, run_id)
    if review:
        try:
            with state.reading(config.root) as root:
                result["review"] = _review(config, root, run_id)
            result["review_error"] = None
        except Exception as exc:
            result["review"] = None
            result["review_error"] = {"code": exc.code if isinstance(exc, LiveRefusal) else "LIVE_RESEARCH_COMMIT"}
    return result


# What replay evidence is read for: a research commit, a source hash and the contracts, in the run's order.
EvidenceKey = tuple[str, str, tuple[str, ...]]


class Evidence:
    """The replay evidence (runs.replay_evidence) of each (research commit, source, contracts) the page asked about,
    read in the background so the page shows it before a run is prepared. Display only: preparation reads it again
    and refuses as before. At a fixed research commit and execution image a found or missing answer stays; an unknown
    one (an image or ledger unreadable) is read again after RETRY_NS. The LIMIT most recently asked keys are kept."""

    RETRY_NS = 300 * 1_000_000_000
    LIMIT = 32

    def __init__(self) -> None:
        self._found: dict[EvidenceKey, dict | None] = {}  # None: asked, not read yet
        self._lock = threading.Lock()
        self._reading = False

    def view(self, key: EvidenceKey) -> dict:
        """The answer for `key`; a key not asked before is asked now and is "checking" until check() reads it."""
        with self._lock:
            found = self._found.pop(key, None)
            self._found[key] = found  # the most recently asked last
            while len(self._found) > self.LIMIT:
                del self._found[next(iter(self._found))]
        state_, replays = (found["state"], found["replays"]) if found else ("checking", [])
        return {"state": state_, "replays": replays, "tolerance": str(EVIDENCE_TOLERANCE)}

    def request(self, config: configuration.Configuration, key: EvidenceKey) -> dict:
        """view(), and a read of the asked keys started now unless one is under way (check() takes later keys too)."""
        result = self.view(key)
        with self._lock:
            idle = not self._reading
        if result["state"] == "checking" and idle:
            threading.Thread(target=self.check, args=(config,), daemon=True).start()
        return result

    def _due(self, done: set) -> EvidenceKey | None:
        now = time.monotonic_ns()
        return next((key for key, found in self._found.items() if key not in done and (
            found is None or (found["state"] == "unknown" and now - found["at"] >= self.RETRY_NS))), None)

    def check(self, config: configuration.Configuration) -> None:
        """Read each asked key not answered yet, and an unknown answer RETRY_NS old, once; one reader at a time."""
        with self._lock:
            if self._reading:
                return
            self._reading = True
        done: set = set()
        try:
            while True:
                with self._lock:
                    key = self._due(done)
                    if key is None:
                        self._reading = False  # under the lock: a key asked after this starts its own read
                        return
                done.add(key)
                research_at, source_sha256, symbols = key
                try:
                    rows = runs.replay_evidence(_profile(config), research_at, source_sha256, list(symbols),
                                                config.runtime)
                    found = {"state": "found" if rows else "missing", "replays": [
                        {"trial_id": row["trial_id"], "starting_balance_usdt": row["starting_balance_usdt"],
                         **({"leverage": row["leverage"]} if row.get("leverage") is not None else {})}
                        for row in rows]}
                except Exception:
                    found = {"state": "unknown", "replays": []}
                with self._lock:
                    if key in self._found:
                        self._found[key] = {**found, "at": time.monotonic_ns()}
        except BaseException:
            with self._lock:
                self._reading = False
            raise


def candidate(config: configuration.Configuration, ref: str) -> dict:
    """The candidate `ref` at the research head, as a run of it would be prepared now (_prepare reads it again),
    and the contracts of its last research replay (ledger.paper.last_research_symbols), which the page offers."""
    with db.read_as_of(_profile(config)) as reader:
        found = runs.runnable(reader, ref)
        last = paper_records.last_research_symbols(reader, found["source_sha256"])
        research_at = reader.resolved_commit
    return {"candidate": ref, "research_at": research_at, "source_sha256": found["source_sha256"],
            "entry_class": found["entry_class"], "last_symbols": last["symbols"] if last else None}


def evidence_view(config: configuration.Configuration, evidence: Evidence, ref: str, symbols: list[str]) -> dict:
    """The replay evidence of `ref` at the research head on `symbols`, read in the background (Evidence)."""
    head = candidate(config, ref)
    return {**evidence.request(config, (head["research_at"], head["source_sha256"], tuple(symbols))),
            "research_at": head["research_at"]}


def paper_view(config: configuration.Configuration, reconciliation: reconcile.Reconciliation, ref: str,
               symbols: list[str]) -> dict:
    """Whether a Paper run of `ref`'s source at the research head on `symbols` reconciles (live.reconcile), derived
    in the background: {state: checking | reconciled | unreconciled, paper_id, reasons, source_sha256}."""
    configuration.symbols(symbols)
    head = candidate(config, ref)
    return {**reconciliation.request(config, (head["source_sha256"], tuple(symbols))),
            "source_sha256": head["source_sha256"]}


def listing(config: configuration.Configuration, *, binding: release.Binding | None = None) -> dict:
    """What the page shows before a run: availability, keys, retained runs, notifications and the run settings'
    defaults. The candidate and its contracts are the page's choice (candidate, evidence_view)."""
    result = {"availability": "ready", "write_enabled": True, "write_reason": None, "maintenance_enabled": True,
              "defaults": dict(configuration.DEFAULTS), "credentials": [], "runs": [], "notify": notify.view(config.root)}
    def availability() -> None:
        try:
            authority.retained(config, binding).admit_locked(config.root)
        except LiveRefusal as exc:
            result.update(write_enabled=False, write_reason=exc.code)
        try:
            authority.retained(config, binding).admit_locked(config.root, maintenance=True)
        except LiveRefusal:
            result["maintenance_enabled"] = False

    if not config.root.exists():
        availability()  # Pure derived display, never permission to perform a later effect.
        return result
    with state.reading(config.root) as root:
        availability()
        result["credentials"] = credentials.listing_locked(root)
        directory = root / "runs"
        if directory.is_symlink():
            raise state.fail("LIVE_RECORD_UNAVAILABLE", "the retained runs directory is unavailable")
        if directory.exists():
            ids = sorted(path.name for path in directory.iterdir() if not runs.earlier(path))
            if any(not state.RUN_ID.fullmatch(run_id) for run_id in ids):
                raise state.fail("LIVE_RECORD_UNAVAILABLE", "the retained runs directory is incomplete")
            result["runs"] = [run_view(config, run_id, review=False) for run_id in ids]
    return result


def _universe(config: configuration.Configuration, symbols: list[str]) -> bytes:
    """The membership file of `symbols` at the market's latest market day (market.universe.selection, as Paper
    derives it): what engine.load.read_universe reads, frozen in the run's inputs."""
    from market.universe import selection
    try:
        _, membership, _ = selection({"root": str(config.market_root)}, None, symbols, time.time_ns())
    except Refusal as exc:
        raise state.fail("LIVE_UNIVERSE", f"the market gives these contracts no membership: {exc}") from None
    return state.encode(membership)


def _reconciled(config: configuration.Configuration, ref: str):
    """Preparation's Paper check: this runs in `live web-command`, so it asks the serving control (paper_view)."""
    return lambda source_sha256, symbols: reconcile.require(config, ref, source_sha256, symbols)


def _prepare(config: configuration.Configuration, root: Path, body: dict, request_id: str) -> None:
    """Prepare body's run: the candidate at the research head, the chosen contracts, their membership and the run
    settings, frozen in its manifest. Sent again, a published run is returned as it is (runs.prepared_locked), never
    read again at a new head."""
    settings = {**configuration.run_config(body["config"]), "memory": configuration.RUNNER_MEMORY}
    run_id, ref, candidate, symbols = body["run_id"], body["credential_ref"], body["candidate"], body["symbols"]
    if runs.prepared_locked(root, run_id, request_id, candidate, symbols, ref, **settings) is not None:
        return
    path = credentials.prepare_path_locked(root, settings["environment"], ref)
    research = _profile(config)
    with db.read_as_of(research) as reader:
        research_at = reader.resolved_commit
    manifest = runs.prepare_locked(root, run_id, research, research_at, candidate, symbols,
                                   _universe(config, symbols), path, config.runtime, **settings,
                                   market_root=config.market_root, request_id=request_id, credential_ref=ref,
                                   reconciled=_reconciled(config, candidate))
    # A failed review cannot open a venue connection.
    runs.review(research, manifest)


def _operation(config: configuration.Configuration, action: str, target: dict, body: dict, root: Path,
               request_id: str) -> None:
    if action == "credential_save":
        credentials.save_locked(root, target["environment"], target["credential_ref"], body["api_key"], body["api_secret"])
    elif action == "credential_remove":
        credentials.remove_locked(root, target["environment"], target["credential_ref"])
    elif action == "prepare":
        _prepare(config, root, body, request_id)
    elif action == "stop":
        runs.stop_locked(root, target["run_id"])
    elif action == "maintain":
        runs.maintain_locked(root, target["run_id"])
    else:
        run_id, mode = target["run_id"], LAUNCHES[action]
        if runs.sent_locked(root, run_id, mode, request_id) is not None:
            return  # sent again: no key read, no second runner
        path = credentials.run_path_locked(root, run_id, mode)
        if action == "preflight":
            # The original preparation, read at its own research commit.
            runs.review(_profile(config), runs.read_manifest(root, run_id)[1])
        if action == "start":
            runs.require_confirmed_locked(root, run_id, body["confirm_real_orders"])
        runs.launch_locked(root, run_id, path, mode, request_id=request_id)


def _credential_ref(request_id: str) -> str:
    """A save's version reference: stable for this one upload intent, never a key fingerprint."""
    return hashlib.sha256(("live-credential:" + request_id).encode()).hexdigest()[:32]


def _require_unused(root: Path, request_id: str, action: str, target: dict) -> None:
    """A request ID names one operation: the effect rows it already made (a preparation or launch row, or a saved
    version) must be this action's on this target, else LIVE_REQUEST_CONFLICT."""
    for run_id, row in runs.request_rows(root, request_id):
        made = "prepare" if row["event"] == "prepared" else next(
            (name for name, mode in LAUNCHES.items() if mode == row.get("mode")), None)
        if made != action or run_id != target.get("run_id"):
            raise state.fail("LIVE_REQUEST_CONFLICT", "request-id already names a different Live operation")
    # A save sent again is the same save only in its own environment.
    if any(row["credential_ref"] == _credential_ref(request_id)
           and (action != "credential_save" or environment != target.get("environment"))
           for environment in configuration.ENVIRONMENTS for row in credentials.events_locked(root, environment)):
        raise state.fail("LIVE_REQUEST_CONFLICT", "request-id already names a different Live operation")


def restart_interrupted_locked(root: Path, run_id: str, now_ns: int) -> dict | None:
    """Start an interrupted run again as itself (design §3.4), with the credential it was started with; past
    runs.RESTARTS_PER_HOUR the control records restart_limited once and leaves the run to the user."""
    directory = state.directory(root, run_id)
    if not runs.restarts_due(directory, now_ns):
        rows = state.events(directory / "lifecycle.jsonl")
        launched = max((index for index, row in enumerate(rows) if row["event"] == "launch_requested"), default=-1)
        if not any(row["event"] == "restart_limited" for row in rows[launched + 1:]):
            state.append(directory / "lifecycle.jsonl", "restart_limited", run_id)
        return None
    path = credentials.run_path_locked(root, run_id, "run")
    return runs.launch_locked(root, run_id, path, "run")


_KEY_CHECKED: dict[str, float] = {}  # run ID -> monotonic time of this control's latest check of its key


def check_key_locked(root: Path, run_id: str, now: float) -> None:
    """While a run trades, read its key's permissions every key.CHECK_SECONDS (design §3.9). A key that can withdraw,
    lost its IP restriction or cannot be read is journalled (`key_check_failed`, once per cause) and the user told; the
    run goes on, since stopping it would close its positions. A later pass is journalled once (`key_check_passed`)."""
    if now - _KEY_CHECKED.get(run_id, float("-inf")) < key.CHECK_SECONDS:
        return
    _KEY_CHECKED[run_id] = now
    directory = state.directory(root, run_id)
    try:
        key.require_limits(credentials.run_path_locked(root, run_id, "run"),
                           runs.read_manifest(root, run_id)[1]["config"]["environment"])
        code = None
    except LiveRefusal as exc:
        code = exc.code
    last = next((row for row in reversed(state.events(directory / "lifecycle.jsonl"))
                 if row["event"] in runs.KEY_EVENTS), None)
    failed = last is not None and last["event"] == "key_check_failed"
    if code is not None and not (failed and last is not None and last.get("code") == code):
        state.append(directory / "lifecycle.jsonl", "key_check_failed", run_id, code=code)
    elif code is None and failed:
        state.append(directory / "lifecycle.jsonl", "key_check_passed", run_id)


def execute(config: configuration.Configuration, action: str, target: str | None, body: dict, *,
            binding: release.Binding | None = None) -> tuple[int, dict]:
    """Called only by `live web-command` for the paired Web, never a general command-line proxy."""
    if action in notify.ACTIONS:
        # Notification settings are not account operations: no request ID, journal or account lock.
        try:
            return 200, {"ok": True, "data": {"notify": notify.execute(config, action, body)}}
        except Exception as exc:
            code = exc.code if isinstance(exc, LiveRefusal) else "LIVE_RECORD_UNAVAILABLE"
            return (502 if code == "LIVE_NOTIFY_TELEGRAM" else 400 if isinstance(exc, LiveRefusal) else 500), error(code)
    request_id = body.get("request_id") if isinstance(body, dict) else None
    try:
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            raise state.fail("LIVE_REQUEST_ID", "provide one valid request identifier")
        if action == "prepare":
            configuration.fields(body, {"request_id", "run_id", "candidate", "symbols", "credential_ref", "config"})
            configuration.text(body["run_id"], state.RUN_ID)
            configuration.text(body["candidate"], configuration.CANDIDATE)
            configuration.symbols(body["symbols"])
            configuration.text(body["credential_ref"], credentials.REF)
            configuration.run_config(body["config"])
            subject = {"run_id": body["run_id"], "credential_ref": body["credential_ref"]}
        elif action == "credential_save":
            configuration.fields(body, {"request_id", "environment", "api_key", "api_secret"})
            subject = {"credential_ref": _credential_ref(request_id),
                       "environment": configuration.environment(body["environment"])}
        elif action == "credential_remove":
            configuration.fields(body, {"request_id", "environment"})
            subject = {"credential_ref": configuration.text(target, credentials.REF),
                       "environment": configuration.environment(body["environment"])}
        elif action in RUN_ACTIONS:
            configuration.fields(body, {"request_id", "confirm_real_orders"} if action == "start" else {"request_id"})
            if action == "start":
                configuration.text(body["confirm_real_orders"], configuration.DIGEST)
            subject = {"run_id": configuration.text(target, state.RUN_ID)}
        else:
            raise configuration.fail()
        scope = authority.retained(config, binding)
        # One account lock around the check, the admission and the effect: a request sent twice at once runs once.
        with scope.serialized(config.root) as root:
            _require_unused(root, request_id, action, subject)
            if action != "stop":  # STOP stays available during a release handover
                scope.admit_locked(root, maintenance=action == "maintain")
            _operation(config, action, subject, body, root, request_id)
        return (202 if action in LAUNCHES else 200), {
            "ok": True, "data": {"request_id": request_id, "action": action, **subject}}
    except Exception as exc:
        code = exc.code if isinstance(exc, LiveRefusal) else "LIVE_RECORD_UNAVAILABLE"
        status = (503 if code == "LIVE_RELEASE_UNAVAILABLE" else
                  409 if code in {"LIVE_REQUEST_CONFLICT", "LIVE_CREDENTIAL_BUSY",
                                 "LIVE_CREDENTIAL_CHANGED", "LIVE_ACCOUNT_OWNED"}
                  else 400 if isinstance(exc, LiveRefusal) else 500)
        return status, error(code, request_id if isinstance(request_id, str) else None)
