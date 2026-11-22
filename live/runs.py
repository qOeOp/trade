"""Host lifecycle for one private Live account slot, with retained originals.

No command writes to research or Paper. An ambiguous launch owns the account slot
until the runner observes it flat (natively, or the whole account at Binance), or every
runner it started is proven to have exited without arming. A dead container is never flat evidence. An ended run gives
up its containers and network; its directory remains the execution record.
"""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal, InvalidOperation
import hashlib
from datetime import UTC, datetime
import os
from pathlib import Path
import re
import shutil
from typing import Any

from engine.config import Refusal as EngineRefusal, is_leverage
from engine.live_errors import LiveRefusal
from engine.live_venue import MANIFEST_FORMAT, read_credentials
from ledger import db, strategies
from shared.errors import Refusal
from runtime import image
from live import host as host_runtime
from live import admission, configuration, key, state


VALIDATION_NOTE = ("status is the bound run's audit status (unbound, bound, passed, invalid), no verdict on returns: "
                   "read validation report --validation N. A registration covers this candidate on its "
                   "universe_rule.")
# The runner's flat events and the states they end a run in; venue_flat is the whole account at Binance only.
FLAT = {"clean_stop": "clean_stopped", "reconciled_flat": "reconciled_flat", "venue_flat": "venue_flat"}
ENDED = {*FLAT.values(), "not_armed", "preflight_complete", "preflight_failed"}
UNRESOLVED_NOTE = ("Exposure may remain at Binance and nothing will close it: follow 'Unresolved Live runs' in "
                   "live/README.md now (live stop, close and cancel at Binance, then Reconcile account on the "
                   "Live page).")
REPEATABLE = {"preflight_complete", "preflight_failed"}  # no slot and no order: this run may still start
# The runner's events that end a run (engine.live.ENDED_EVENTS). An armed run whose latest start ended in none of them,
# with no stop asked for, and whose runner did not end by itself in failure, was interrupted: it keeps its slot,
# positions and exchange stops, and starts again as itself.
RUN_ENDED = frozenset({"clean_stop", "reconciled_flat", "venue_flat", "reconcile_stopped", "unresolved"})
# The runner's own exit statuses for a failure (1) and a refusal (2), engine.live.main. A start that ended so decided
# to end, even where it could write no ending event (a refusal before its journal, a failed write); a killed runner
# (137 and other signal statuses) and one that gives the start back (3) did not.
FAILED_EXITS = frozenset({1, 2})
KEY_EVENTS = frozenset({"key_check_failed", "key_check_passed"})  # live.control.check_key_locked's lifecycle rows
RESTARTS_PER_HOUR = 3  # automatic starts of an interrupted run; beyond them the user is told and decides (design §3.4)
HOUR_NS = 3600 * 10**9
EVIDENCE_MISSING = ("no passed run, or audited explore inside a research window, of this source on these instruments in "
                    "bars runs the replay code of this execution image; replay it at the wallet's balance on a matching "
                    "replay image (engine/README.md) and prepare a new run")


def inspect_runner(root: Path, run_id: str, directory: Path, manifest: dict, launch: dict) -> dict | None:
    started = next((row for row in reversed(host_events(directory))
                    if row["event"] == "container_started" and row.get("container") == launch["container"]), None)
    return host_runtime.container_identity(root, run_id, directory, manifest, launch["container"], "runner", mode=launch["mode"],
                      credentials_path=launch.get("credentials_path"),
                      container_id=started.get("container_id") if started else None)


def earlier(directory: Path) -> bool:
    """A run an earlier version prepared: its manifest names another format. 0.x keeps no compatibility between
    versions (the user, 2026-11-14): such a run stays on disk, and no listing, release check or operation reads it."""
    try:
        return state.read(directory / "inputs" / "manifest.json").get("format") != MANIFEST_FORMAT
    except LiveRefusal:
        return False  # no manifest yet: a preparation of this version, read and refused as it is


def read_manifest(root: Path, run_id: str) -> tuple[Path, dict]:
    directory = state.directory(root, run_id)
    manifest = state.read(directory / "inputs" / "manifest.json")
    if manifest.get("format") != MANIFEST_FORMAT:  # earlier(): to this version no such run exists
        raise state.fail("LIVE_RECORD_UNAVAILABLE", "the private Live record is absent or malformed")
    if manifest.get("run_id") != run_id:
        raise state.fail("LIVE_IDENTITY_CHANGED", "the private manifest does not identify this run")
    if not isinstance(manifest.get("research_at"), str) or not db.COMMIT_HASH.fullmatch(manifest["research_at"]):
        raise state.fail("LIVE_RECORD_UNAVAILABLE", "the private Live record is absent or malformed")
    for filename, digest in (("strategy.py", manifest["source"]["source_sha256"]),
                             ("universe.json", manifest["universe_sha256"])):
        path = directory / "inputs" / filename
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the declared Live inputs have changed")
    return directory, manifest


def host_events(directory: Path) -> list[dict]:
    return state.events(directory / "lifecycle.jsonl")


def request_rows(root: Path, request_id: str) -> list[tuple[str, dict]]:
    """The preparation and launch rows `request_id` made, with their run IDs: what a request sent again is compared
    with (runs.earlier: no other run is read)."""
    directory = root / "runs"
    if not directory.is_dir():
        return []
    return [(item.name, row) for item in sorted(directory.iterdir()) if not earlier(item)
            for row in host_events(item) if row.get("request_id") == request_id]


def latest_launch(directory: Path) -> dict | None:
    return next((row for row in reversed(host_events(directory)) if row["event"] == "launch_requested"), None)


def _flat(directory: Path, run_id: str) -> str | None:
    """The state a flat event of the latest launch ends the run in."""
    launch = latest_launch(directory)
    if launch is None:
        return None
    return next((FLAT[row["event"]] for row in state.events(directory / "out" / "events.jsonl")
                 if row.get("event") in FLAT and row.get("run_id") == run_id
                 and row.get("observed_ns", row.get("ts_ns", 0)) >= launch["observed_ns"]), None)


def _interrupted(directory: Path, launch: dict | None, actual: dict | None) -> bool:
    """The latest start was a run that armed and ended in no ending event, no stop was asked for, and its runner
    (`actual`, the inspected container, when there is one) did not end by its own failure or refusal."""
    if launch is None or launch["mode"] != "run" or not os.path.lexists(directory / "out" / "armed.json") \
            or os.path.lexists(directory / "out" / "STOP"):
        return False
    if actual is not None and actual["State"].get("ExitCode") in FAILED_EXITS:
        return False
    return not any(row.get("event") in RUN_ENDED for row in _since(directory, launch))


def _since(directory: Path, launch: dict) -> list[dict]:
    return [row for row in state.events(directory / "out" / "events.jsonl")
            if row.get("observed_ns", 0) >= launch["observed_ns"]]


def write_months_locked(root: Path, run_id: str, market_root: Path, now_ns: int) -> list[str]:
    """inputs/membership/<YYYY-MM>.json for each month after the run's market day that the market holds, as Paper's
    (market.universe.write_months): the runner reads a month's file once the month has begun and, until it is there,
    denies entries on the contract. The market is read only once a month after the last written has begun; a
    written file is never rewritten. Returns the months written."""
    from engine.membership import MONTHS
    from market import universe
    directory, manifest = read_manifest(root, run_id)
    folder = directory / "inputs" / MONTHS
    written = sorted(path.stem for path in folder.glob("*.json")) if folder.is_dir() else []
    last = max([str(manifest["market"]["market_day"])[:7], *written])
    year, month = map(int, last.split("-"))
    due = datetime(year + month // 12, month % 12 + 1, 1, tzinfo=UTC)
    if now_ns < int(due.timestamp()) * 10**9:
        return []
    state.private_directory(folder)
    return universe.write_months({"holds": "market", "root": str(market_root)}, folder, list(manifest["symbols"]),
                                 last, state.replace)  # durable and whole, as the runner reads it


def restarts_due(directory: Path, now_ns: int) -> bool:
    """Whether the control may start an interrupted run again: at most RESTARTS_PER_HOUR restarts (the first start
    and its restarts are all run launches) in the last hour."""
    return _run_launches(directory, now_ns) <= RESTARTS_PER_HOUR


def _run_launches(directory: Path, now_ns: int) -> int:
    return sum(row["event"] == "launch_requested" and row.get("mode") == "run"
               and now_ns - row.get("observed_ns", 0) < HOUR_NS for row in host_events(directory))


def active_run(root: Path) -> str | None:
    rows = state.events(root / "account.jsonl")
    active = None
    for row in rows:
        if row["event"] == "reserved":
            active = row["run_id"]
        elif row["event"] == "released" and row["run_id"] == active:
            active = None
    return active


def _never_armed(root: Path, run_id: str, directory: Path, manifest: dict) -> bool:
    """A runner constructs its source only after arming, so an exited unarmed runner placed no order."""
    # Containers first: a runner still alive could arm between the file check and its inspection.
    for launch in host_events(directory):
        if launch["event"] == "launch_requested" and launch["mode"] != "preflight":
            # Every launch: a timed-out `docker run` can stay alive behind a later one, and a missing
            # container proves nothing.
            actual = inspect_runner(root, run_id, directory, manifest, launch)
            if actual is None or actual["State"].get("Status") != "exited":
                return False
    output = directory / "out"
    return (not os.path.lexists(output / "armed.json")
            and not any(row.get("event") == "connecting" for row in state.events(output / "events.jsonl")))


def _release_if_resolved(root: Path, run_id: str, directory: Path) -> None:
    launch = latest_launch(directory)
    _, manifest = read_manifest(root, run_id)
    actual = inspect_runner(root, run_id, directory, manifest, launch) if launch else None
    if active_run(root) != run_id:
        return
    flat = _flat(directory, run_id)
    if actual and not actual["State"].get("Running") and actual["State"].get("ExitCode") == 0 and flat:
        state.append(root / "account.jsonl", "released", run_id,
                     reason="venue_flat" if flat == "venue_flat" else "native_and_venue_flat")
    elif _never_armed(root, run_id, directory, manifest):
        state.append(root / "account.jsonl", "released", run_id, reason="never_armed")


def _released_unarmed(root: Path, run_id: str) -> bool:
    return any(row["event"] == "released" and row["run_id"] == run_id and row.get("reason") == "never_armed"
               for row in state.events(root / "account.jsonl"))


def since_removal(directory: Path) -> list[dict]:
    events = host_events(directory)
    last = max((index for index, row in enumerate(events) if row["event"] == "recycled"), default=-1)
    return events[last + 1:]


def recycled(directory: Path) -> dict | None:
    """The record of a removal that still describes the run; a later launch starts over."""
    for row in reversed(host_events(directory)):
        if row["event"] == "launch_requested":
            return None
        if row["event"] == "recycled":
            return row
    return None


def settled_state(root: Path, run_id: str, launch: dict | None) -> str | None:
    """A release after the latest launch already decided the run, so no container has to be read."""
    if launch is None or active_run(root) == run_id:
        return None
    reason = next((row.get("reason") for row in reversed(state.events(root / "account.jsonl"))
                   if row["event"] == "released" and row["run_id"] == run_id
                   and row["observed_ns"] >= launch["observed_ns"]), None)
    if reason == "never_armed":
        return "not_armed"
    if reason == "native_and_venue_flat":
        return "reconciled_flat" if launch["mode"] == "reconcile" else "clean_stopped"
    return "venue_flat" if reason == "venue_flat" else None


def _log_file(directory: Path, container: str) -> Path:
    return directory / "containers" / (container + ".log")


def _recycle(root: Path, run_id: str, directory: Path, result: str, launch: dict) -> None:
    """Give up an ended run's resources, keeping what `live logs` reads. Never changes the run's result."""
    try:
        recorded = recycled(directory)
        containers = host_runtime.owned_containers(root, run_id)
        if recorded is None:
            if any(item["Config"]["Labels"].get(f"{host_runtime.LABEL}.role") != "egress"
                   and item["State"].get("Status") != "exited" for item in containers):
                return  # A runner from an earlier launch that timed out could still be alive.
            state.private_directory(directory / "containers")
            exit_code = 0 if result in FLAT.values() else None
            for item in containers:
                name = item["Name"].removeprefix("/")
                if name == launch["container"]:
                    exit_code = item["State"].get("ExitCode")
                output = host_runtime.docker("logs", item["Id"])
                if output.returncode:
                    return
                # Whole or absent: the container is removed on the strength of this file.
                state.replace(_log_file(directory, name), (output.stdout + output.stderr).encode())
            # Recorded first: a removal cut short is finished later and never leaves a run that looks unended.
            state.append(directory / "lifecycle.jsonl", "recycled", run_id, state=result, exit_code=exit_code)
        elif since_removal(directory):
            # Resources made by a start that never launched: without a new record they would look still present.
            state.append(directory / "lifecycle.jsonl", "recycled", run_id, state=recorded["state"],
                         exit_code=recorded["exit_code"])
        host_runtime.remove_resources(root, run_id, containers)
    except (LiveRefusal, OSError):
        return


def _recycle_others(root: Path, current: str) -> None:
    """Runs nobody asks about again would otherwise keep their proxy until the host is rebuilt."""
    try:
        template = f'{{{{.Label "{host_runtime.LABEL}.run"}}}}'
        found = host_runtime.checked("ps", "-a", "--no-trunc", "--filter", f"label={host_runtime.LABEL}.run", "--format", template)
        found += "\n" + host_runtime.checked("network", "ls", "--filter", f"label={host_runtime.LABEL}.run", "--format", template)
    except (LiveRefusal, OSError):
        return
    for run_id in sorted(set(found.split()) - {current}):
        try:
            directory, manifest = read_manifest(root, run_id)
            launch = latest_launch(directory)
            if launch is None or active_run(root) == run_id:
                continue
            recorded = recycled(directory)
            result = (recorded["state"] if recorded else settled_state(root, run_id, launch)
                      or _outcome(root, run_id, directory, manifest, launch)[0])
            if result in ENDED:
                _recycle(root, run_id, directory, result, launch)
        except (LiveRefusal, OSError, KeyError):
            continue


def _credentials(path: Path, binding: str | None = None) -> str:
    found = read_credentials(path)
    if binding is not None and found.binding != binding:
        raise state.fail("LIVE_ACCOUNT_CHANGED", "this run cannot use a different API key")
    return found.binding


def _positive(value: str, name: str) -> str:
    try:
        amount = Decimal(value)
        if not amount.is_finite() or amount <= 0:
            raise ValueError
        return str(amount)
    except (InvalidOperation, ValueError) as exc:
        raise state.fail("LIVE_CONFIG", f"{name} must be a finite positive decimal") from exc


def _bound_credential(root: Path, run_id: str, directory: Path, path: Path, mode: str) -> dict | None:
    """A prepared run launches only with its own managed credential version (credentials.run_path_locked)."""
    prepared = next((row for row in host_events(directory) if row.get("event") == "prepared"), None)
    if prepared is None:
        return None
    from live import credentials as credential_store
    expected = credential_store.run_path_locked(root, run_id, mode)
    if path.resolve() != expected.resolve():
        raise state.fail("LIVE_CREDENTIAL_CHANGED", "the prepared run requires its original credential version file")
    return prepared


# The refusals of ledger.strategies.read_runnable that say the reference names no candidate a run can load.
NOT_RUNNABLE = frozenset({"BAD_REF", "UNKNOWN_CANDIDATE", "SOURCE_SIZE", "ENTRY_CLASS_INVALID", "SOURCE_SYNTAX",
                          "ENTRY_CLASS_NOT_UNIQUE"})


def runnable(reader: db.LedgerConnection, candidate: str) -> dict:
    """The candidate on the reader's commit whose source loads (ledger.strategies.read_runnable), as Paper takes it;
    LIVE_SOURCE_MISSING when it is absent there or its source does not load."""
    try:
        return strategies.read_runnable(reader, candidate)
    except Refusal as exc:
        if exc.code in NOT_RUNNABLE:
            raise state.fail("LIVE_SOURCE_MISSING", f"{candidate} is no runnable candidate here ({exc.code})") from None
        raise


def _candidate(research: db.LedgerProfile, research_at: str, candidate: str) -> dict:
    """The candidate at research_at; Live runs its own source and nothing else (no adapted file)."""
    with db.read_as_of(research, research_at) as reader:
        found = runnable(reader, candidate)
    if hashlib.sha256(found["source"]).hexdigest() != found["source_sha256"]:
        raise state.fail("LIVE_IDENTITY_CHANGED", "the candidate's stored source does not hash to its source_sha256")
    return found


def _evidence(research: db.LedgerProfile, research_at: str, source_sha256: str, symbols: list[str],
              inspection: dict, runner_args: list[str], leverage: str | None) -> list[dict]:
    """The replays at research_at that back running this source live: on exactly Live's instruments, in the bars
    environment, either a passed sealed run or a completed explore whose audit passed (`replay explore` of the
    candidate at the wallet's balance) trading only inside a research trial's window of this source (a window it
    already saw: no new exposure, no holdout spent), on an image whose replay code (admission.REPLAY_CODE) equals this
    execution image's. A sealed run on other replay code still counts through an explore that reproduces it on
    matching code. Only replays at `leverage` (their effective configuration's) back a run at it (re-judge C-083);
    None, for the page before the user picks one, lists them at any."""
    from ledger import execution
    from registration import reproduction
    with db.read_as_of(research, research_at) as reader:
        rows = reader.dicts("SELECT t.trial_id, t.purpose, t.image_ref, t.starting_balance, t.trade_start, "
                            "t.trade_end, r.status FROM trial t "
                            "LEFT JOIN run r ON r.trial_id = t.trial_id "
                            "WHERE t.source_sha256 = %s AND t.execution = 'bars' ORDER BY t.trial_id",
                            (source_sha256,))
        instruments: dict[int, set] = {}
        for trial_id, symbol in reader.rows("SELECT i.trial_id, i.symbol FROM trial_instrument i "
                                            "JOIN trial t ON t.trial_id = i.trial_id WHERE t.source_sha256 = %s",
                                            (source_sha256,)):
            instruments.setdefault(trial_id, set()).add(symbol)
        seen = [(row["trade_start"], row["trade_end"]) for row in rows if row["purpose"] == "research"]
        backing = []
        for row in rows:
            if instruments.get(row["trial_id"]) != set(symbols):
                continue
            if row["status"] == "passed":
                images = [row["image_ref"], *(item["image_ref"]
                                              for item in reproduction.reproductions(reader, row["trial_id"]))]
            elif (row["purpose"] == "explore"
                  and any(start <= row["trade_start"] and row["trade_end"] <= end for start, end in seen)
                  and reproduction.fingerprint_hash(execution.read_capture(reader, row["trial_id"])) is not None):
                images = [row["image_ref"]]
            else:
                continue
            backing.append((row, images))
        captures: dict[int, Any] = execution.read_captures(reader, [row["trial_id"] for row, _ in backing], listing=True)
    described: dict[str, bool] = {}

    def same_code(image_ref: str) -> bool:
        if image_ref not in described:
            described[image_ref] = (admission.replay_code(image_ref, runner_args)
                                  == {name: inspection[name] for name in admission.REPLAY_CODE})
        return described[image_ref]

    result = []
    for row, images in backing:
        try:  # an unreadable capture (a Refusal) or a configuration without a leverage backs nothing
            traded = captures[row["trial_id"]]["input_coverage"]["effective_config"]["account"]["default_leverage"]
        except (KeyError, TypeError):
            continue
        matching = next((ref for ref in dict.fromkeys(images) if same_code(ref)), None)
        if matching is not None and leverage in (None, traded):
            balance = Decimal(row["starting_balance"]).normalize()
            result.append({"trial_id": row["trial_id"], "starting_balance_usdt": format(balance, "f"),
                           "image_ref": matching})
    return result


def _describe(symbols: list[str]) -> list[str]:
    """The runner arguments of the execution image's --describe probe, which reports its replay code."""
    return ["--market-root", "/unused", "--market-day", "live", "--symbols", *symbols,
            "--start", "2026-01-01T00:00:00Z", "--end", "2026-01-02T00:00:00Z"]


def replay_evidence(research: db.LedgerProfile, research_at: str, source_sha256: str, symbols: list[str],
                    runtime: str) -> list[dict]:
    """The replays prepare_locked would record for this source (_evidence), read ahead so the page can show them
    before a run is prepared. Read only; preparation still checks again and refuses as before."""
    describe = _describe(symbols)
    inspection = image.inspect_runtime(image.resolve(runtime), describe)
    return _evidence(research, research_at, source_sha256, symbols, inspection, describe, None)


def _settings(root: Path, run_id: str, environment: str, drawdown_brake: str, duration_seconds: int | None,
              memory: str, leverage: str) -> dict:
    """A run's settings as its manifest records them, checked."""
    if duration_seconds is not None and (isinstance(duration_seconds, bool) or not isinstance(duration_seconds, int)
                                         or duration_seconds < 1):
        raise state.fail("LIVE_CONFIG", "duration-seconds must be a positive integer, or absent to run until stopped")
    brake = _positive(drawdown_brake, "drawdown-brake")
    if Decimal(brake) > Decimal(configuration.BRAKE_DEFAULT):
        raise state.fail("LIVE_CONFIG", f"the drawdown brake can only be tighter than {configuration.BRAKE_DEFAULT}")
    if not is_leverage(leverage):
        raise state.fail("LIVE_CONFIG", "leverage must be an integer from 1 to 125")
    return {"environment": configuration.environment(environment), "drawdown_brake": brake,
            "duration_seconds": duration_seconds, "memory": memory, "leverage": leverage,
            "proxy_url": f"http://{host_runtime.resource_names(root, run_id)['egress']}:3128"}


def prepared_locked(root: Path, run_id: str, request_id: str, candidate: str, symbols: list[str], credential_ref: str,
                    **settings) -> dict | None:
    """The manifest of `run_id` when `request_id` already prepared it with these choices (a request sent again), None
    when no run of that ID was published. The same ID with other choices is LIVE_REQUEST_CONFLICT; a run another
    request prepared, LIVE_RUN_CONFLICT. Nothing is read again at the research head."""
    directory = state.directory(root, run_id)
    if not os.path.lexists(directory):
        return None
    _, prior = read_manifest(root, run_id)
    prepared = next((row for row in host_events(directory) if row["event"] == "prepared"), None)
    if prepared is None or prepared.get("request_id") != request_id:
        raise state.fail("LIVE_RUN_CONFLICT", "run-id was already prepared by another request")
    if (f"{prior['candidate']['strategy_id']}@{prior['candidate']['revision']}" != candidate
            or prior["symbols"] != symbols or prepared.get("credential_ref") != credential_ref
            or prior["config"] != _settings(root, run_id, **settings)):
        raise state.fail("LIVE_REQUEST_CONFLICT", "request-id already prepared this run with other choices")
    return prior


def _clear_staging(staging: Path) -> None:
    """A preparation that stopped before it was published left only inputs: no secret, nothing started."""
    if not os.path.lexists(staging):
        return
    if staging.is_symlink() or not staging.is_dir():
        raise state.fail("LIVE_DIRECTORY", "the private staging directory is unavailable")
    shutil.rmtree(staging)
    state.fsync_parent(staging)


def prepare_locked(root: Path, run_id: str, research: db.LedgerProfile, research_at: str, candidate: str,
                    symbols: list[str], universe: bytes, credentials: Path, runtime: str, *,
                    environment: str, drawdown_brake: str, duration_seconds: int | None, memory: str,
                    leverage: str, market_root: Path, credential_ref: str, request_id: str,
                    reconciled: Callable[[str, list[str]], None]) -> dict:
    """Capture immutable inputs, before any account effect: the candidate's own source at research_at (the run's
    research commit, kept in its manifest), the membership `universe`, the pinned image and the market's terms.
    `reconciled` (live.reconcile.require) refuses LIVE_PAPER_UNRECONCILED unless a Paper run of the source on the
    contracts reconciles with its replay. Everything is written under staging/<run_id>, then renamed into runs/ whole:
    a preparation cut short is redone by the same request, and a published one is returned as it is
    (prepared_locked)."""
    settings = {"environment": environment, "drawdown_brake": drawdown_brake, "duration_seconds": duration_seconds,
                "memory": memory, "leverage": leverage}
    configuration.symbols(symbols)
    config = _settings(root, run_id, environment, drawdown_brake, duration_seconds, memory, leverage)
    prior = prepared_locked(root, run_id, request_id, candidate, symbols, credential_ref, **settings)
    if prior is not None:
        return prior
    if not db.COMMIT_HASH.fullmatch(research_at):
        raise state.fail("LIVE_RESEARCH_COMMIT", "Live requires the exact full research commit")
    binding = _credentials(credentials)
    staging = state.private_directory(root / "staging") / run_id
    _clear_staging(staging)
    try:
        for part in (staging, staging / "inputs", staging / "out", staging / "egress"):
            state.private_directory(part)
        state.write_new(staging / "inputs" / "universe.json", universe)
        found = _candidate(research, research_at, candidate)
        from engine.load import read_universe
        try:
            read_universe(staging / "inputs" / "universe.json", symbols)
        except EngineRefusal as exc:
            raise state.fail("LIVE_UNIVERSE", str(exc)) from None
        identity = image.resolve(runtime)
        describe = _describe(symbols)
        inspection = image.inspect_runtime(identity, describe)
        image.require_main_build(identity, inspection)
        admission.unfalsified(research, research_at, found["source_sha256"], market_root)
        # Recorded, possibly none: a run without it may still check the account (and read the wallet a replay must
        # start near), but never starts (launch_locked, engine.live_venue.require_evidence).
        evidence = _evidence(research, research_at, found["source_sha256"], symbols, inspection, describe, leverage)
        reconciled(found["source_sha256"], symbols)
        market = _market_terms(market_root, symbols)
        key = hashlib.sha256(run_id.encode()).hexdigest()[:12]
        manifest = {"format": MANIFEST_FORMAT, "run_id": run_id, "research_at": research_at,
                    "candidate": {name: found[name] for name in ("strategy_id", "revision")},
                    "source": {name: found[name] for name in ("source_sha256", "entry_class")},
                    "runtime": identity, "symbols": symbols, "config": config, "credential_binding": binding,
                    "trader_id": f"LIVE-{key}", "account_id": f"BINANCE-LIVE-{key}",
                    "strategy_file": "/inputs/strategy.py", "universe_file": "/inputs/universe.json",
                    "universe_sha256": hashlib.sha256(universe).hexdigest(), "market": market, "evidence": evidence}
        state.write_new(staging / "inputs" / "strategy.py", found["source"])
        state.write_new(staging / "inputs" / "manifest.json", state.encode(manifest))
        state.append(staging / "lifecycle.jsonl", "prepared", run_id, request_id=request_id,
                     credential_ref=credential_ref)
    except Exception:
        _clear_staging(staging)
        raise
    directory = state.directory(root, run_id)
    if not os.path.lexists(directory.parent):
        state.private_directory(directory.parent)
    os.rename(staging, directory)
    state.fsync_parent(staging)
    state.fsync_parent(directory)
    return manifest


def _market_terms(market_root: Path, symbols: list[str]) -> dict:
    """The market's latest market day and each contract's terms there, which the runner compares with exchangeInfo
    before each entry (TERMS_CHANGED)."""
    from market import files, instrument
    try:
        opened = files.open_market({"root": str(market_root)}, "reader")
        market_day = files.resolve_day(opened, None)
        return {"market_day": market_day,
                "terms": {symbol: instrument.terms(opened, market_day, symbol) for symbol in symbols}}
    except Refusal as exc:
        raise state.fail("LIVE_MARKET_TERMS", exc.message) from None


def review(research: db.LedgerProfile, manifest: dict) -> dict:
    """What the operator reads before start: the pinned source and image and the facts at the run's research commit,
    no gate and no conclusion. An absent candidate is refused, so an empty list means no registration."""
    from registration import validation
    candidate, source, research_at = manifest["candidate"], manifest["source"], manifest["research_at"]
    with db.read_as_of(research, research_at) as reader:
        found = strategies.read_candidate(reader, f"{candidate['strategy_id']}@{candidate['revision']}")
        if found["source_sha256"] != source["source_sha256"]:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the prepared source is not this candidate's")
        registrations = validation.candidate_registrations(reader, found["source_sha256"])
    return {"research_at": research_at, "candidate": candidate, "source_sha256": source["source_sha256"],
            "entry_class": source["entry_class"], "image_ref": manifest["runtime"]["image_ref"],
            "evidence": manifest["evidence"],
            "validations": registrations, "validation_note": VALIDATION_NOTE}


def require_confirmed_locked(root: Path, run_id: str, source_sha256: str) -> None:
    _, manifest = read_manifest(root, run_id)
    if source_sha256 != manifest["source"]["source_sha256"]:
        raise state.fail("LIVE_IDENTITY_CHANGED", "the confirmation must be the source_sha256 this run's "
                                                  "preflight or status shows; nothing was started")


def _network(root: Path, run_id: str, directory: Path, manifest: dict) -> dict:
    names = host_runtime.resource_names(root, run_id)
    events = since_removal(directory)
    network_created = next((row for row in reversed(events) if row["event"] == "network_created"), None)
    network_id = network_created.get("network_id") if network_created else None
    network = host_runtime.network_identity(names["network"], run_id, network_id)
    if network is None:
        if network_created:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the original private network is missing; no replacement is created")
        host_runtime.checked("network", "create", "--internal", "--label", f"{host_runtime.LABEL}.run={run_id}", names["network"])
        network = host_runtime.network_identity(names["network"], run_id)
        if network is None:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the created private network cannot be verified")
        state.append(directory / "lifecycle.jsonl", "network_created", run_id, network_id=network["Id"])
    created = next((row for row in reversed(events) if row["event"] == "egress_created"), None)
    actual = host_runtime.container_identity(root, run_id, directory, manifest, names["egress"], "egress",
                        container_id=created.get("container_id") if created else None)
    if actual is None:
        if created:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the original egress container is missing; no replacement is created")
        command = host_runtime.egress_command(manifest, directory, run_id, names)
        identifier = host_runtime.checked(*command[1:])
        if not re.fullmatch(r"[0-9a-f]{64}", identifier):
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "Docker did not return the created egress identity")
        host_runtime.checked("network", "connect", "bridge", names["egress"])
        if host_runtime.container_identity(root, run_id, directory, manifest, names["egress"], "egress", container_id=identifier) is None:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the created egress container cannot be verified")
        state.append(directory / "lifecycle.jsonl", "egress_created", run_id, container_id=identifier)
    elif not actual["State"].get("Running"):
        host_runtime.checked("start", actual["Id"])
    return names


def sent_locked(root: Path, run_id: str, mode: str, request_id: str) -> dict | None:
    """The answer to a launch `request_id` already made of this run (a request sent again), which is not made twice;
    None when it made none."""
    directory, _ = read_manifest(root, run_id)
    sent = next((row for row in host_events(directory)
                 if row["event"] == "launch_requested" and row.get("request_id") == request_id), None)
    if sent is None:
        return None
    if sent["mode"] != mode:
        raise state.fail("LIVE_REQUEST_CONFLICT", "request-id already launched this run in another mode")
    return {"run_id": run_id, "mode": mode, "write_status": "replayed"}


def launch_locked(root: Path, run_id: str, credentials: Path, mode: str, *, request_id: str | None = None) -> dict:
    """Start the run's runner once. `launch_requested` (with `request_id`) is durable before `docker run`, so the same
    request never starts a second one (sent_locked). While the latest launch's container cannot be found and was not
    recycled, nothing new is launched: it may still be alive."""
    if mode not in ("preflight", "run", "reconcile"):
        raise state.fail("LIVE_MODE", "unknown Live operation")
    if request_id is not None and (replayed := sent_locked(root, run_id, mode, request_id)) is not None:
        return replayed
    directory, manifest = read_manifest(root, run_id)
    if mode == "run" and not manifest["evidence"]:
        raise state.fail("LIVE_EVIDENCE_MISSING", EVIDENCE_MISSING)
    _bound_credential(root, run_id, directory, credentials, mode)
    _credentials(credentials, manifest["credential_binding"])
    recorded = recycled(directory)
    if recorded and recorded["state"] not in REPEATABLE and mode != "run":
        # Before the slot: its original network and egress are gone, so nothing could run.
        raise state.fail("LIVE_RUN_MISSING", "this run has ended and given up its containers; prepare a new run-id")
    if recorded and recorded["state"] in REPEATABLE and not since_removal(directory):
        # A removal cut short must not leave old resources for this launch to adopt unrecorded.
        host_runtime.remove_resources(root, run_id, host_runtime.owned_containers(root, run_id))
    active = active_run(root)
    if active and active != run_id:
        other, _ = read_manifest(root, active)
        _release_if_resolved(root, active, other)
        if active_run(root):
            raise state.fail("LIVE_ACCOUNT_OWNED", f"run {active} still owns this account slot")
    latest = latest_launch(directory)
    if latest:
        actual = inspect_runner(root, run_id, directory, manifest, latest)
        if actual is None and recorded is None:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the latest runner of this run cannot be found; nothing new "
                                                        "is launched while it may still be alive")
        if actual and actual["State"].get("Running"):
            if latest["mode"] == mode:
                return {"run_id": run_id, "mode": mode, "state": "running", "write_status": "replayed"}
            raise state.fail("LIVE_RUNNING", "the previous Live process must end before another mode starts")
        if mode == "run" and any(row.get("mode") == "run" for row in host_events(directory)) \
                and not _interrupted(directory, latest, actual):
            raise state.fail("LIVE_RESTART_REQUIRES_RECONCILIATION",
                             "only an interrupted Live run starts again; after not_armed, prepare a new run-id")
    if mode == "reconcile" and not os.path.lexists(directory / "out" / "armed.json"):
        # Checked here too: a released run must not take the slot back only to be refused by its runner.
        raise state.fail("LIVE_RUN_MISSING", "reconciliation needs the original armed execution")
    if mode != "reconcile":
        key.require_limits(credentials, manifest["config"]["environment"])
    _recycle_others(root, run_id)
    if mode != "preflight" and active_run(root) is None:
        state.append(root / "account.jsonl", "reserved", run_id)
    names = _network(root, run_id, directory, manifest)
    attempt = sum(row["event"] == "launch_requested" for row in host_events(directory)) + 1
    runner = names["network"] + f"-{mode}-{attempt}"
    command = host_runtime.runner_command(manifest, directory, run_id, credentials, mode, runner, names)
    credentials_path = str(credentials.resolve())
    state.append(directory / "lifecycle.jsonl", "launch_requested", run_id, mode=mode, container=runner,
                 credentials_path=credentials_path,
                 **({"request_id": request_id} if request_id is not None else {}))
    try:
        identifier = host_runtime.checked(*command[1:])
        if not re.fullmatch(r"[0-9a-f]{64}", identifier):
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "Docker did not return the launched runner identity")
        if host_runtime.container_identity(root, run_id, directory, manifest, runner, "runner", mode=mode,
                      credentials_path=credentials_path, container_id=identifier) is None:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the launched runner cannot be verified")
    except Exception:
        state.append(directory / "lifecycle.jsonl", "launch_unresolved", run_id, mode=mode)
        raise
    state.append(directory / "lifecycle.jsonl", "container_started", run_id, mode=mode, container=runner,
                 container_id=identifier)
    return {"run_id": run_id, "mode": mode, "state": "starting", "write_status": "written",
            "directory": str(directory), "container": runner}


def _outcome(root: Path, run_id: str, directory: Path, manifest: dict, launch: dict | None, *,
             release: bool = True) -> tuple[str, int | None]:
    actual = inspect_runner(root, run_id, directory, manifest, launch) if launch else None
    if release:
        _release_if_resolved(root, run_id, directory)
    flat = _flat(directory, run_id) if launch and actual and actual["State"].get("ExitCode") == 0 else None
    running = bool(actual and actual["State"].get("Running"))
    result = ("running" if running else flat if flat
              else "not_armed" if launch and _released_unarmed(root, run_id)
              else "interrupted" if actual and _interrupted(directory, launch, actual)
              else "unresolved" if launch else "prepared")
    if launch and launch["mode"] == "preflight" and actual and not running:
        result = "preflight_complete" if actual["State"].get("ExitCode") == 0 else "preflight_failed"
    return result, actual["State"].get("ExitCode") if actual else None


def stop_reason(directory: Path) -> str | None:
    """The first stop is the run's cause; a later reconcile writes its own, and a start that ended to warm up again
    (engine.live_connection.rewarm) is none. A damaged journal must not hide the state."""
    try:
        rows = state.events(directory / "out" / "events.jsonl")
    except LiveRefusal:
        return None
    return next((row.get("reason") for row in rows if row.get("event") == "stopping"
                 and row.get("reason") != "rewarming"), None)


def maintain_locked(root: Path, run_id: str) -> dict:
    """Maintain an existing run while the caller owns its original account lock."""
    return _status_view(root, run_id, maintain=True)


def observe_locked(root: Path, run_id: str) -> dict:
    """Inspect existing host evidence without release, archive, cleanup, or venue access, under the caller's lock.

    This is the host view, not an HTTP-safe response: the web projection must select
    safe fields and must not pass through arbitrary source stop reasons.
    """
    return _status_view(root, run_id, maintain=False)


def observe(root: Path, run_id: str) -> dict:
    with state.reading(root) as root:
        return observe_locked(root, run_id)


def _status_view(root: Path, run_id: str, *, maintain: bool) -> dict:
    directory, manifest = read_manifest(root, run_id)
    launch = latest_launch(directory)
    # A slot taken after the record belongs to a start that never launched, and needs its release check.
    recorded = recycled(directory) if active_run(root) != run_id else None
    settled = settled_state(root, run_id, launch)
    if recorded:
        result, exit_code = recorded["state"], recorded["exit_code"]
    elif settled:
        result, exit_code = settled, 0 if settled != "not_armed" else None
    elif maintain:
        result, exit_code = _outcome(root, run_id, directory, manifest, launch)
    else:
        result, exit_code = _outcome(root, run_id, directory, manifest, launch, release=False)
    if maintain and launch and result in ENDED and active_run(root) != run_id:
        _recycle(root, run_id, directory, result, launch)
    return {"run_id": run_id, "state": result, "mode": launch["mode"] if launch else None,
            "account_owned": active_run(root) == run_id, "container": launch["container"] if launch else None,
            "candidate": manifest["candidate"], "source": manifest["source"],
            "image_ref": manifest["runtime"]["image_ref"], "symbols": manifest["symbols"],
            "exit_code": exit_code,
            "stop_reason": stop_reason(directory),
            **({"note": UNRESOLVED_NOTE} if result == "unresolved" else {})}


def stop(root: Path, run_id: str) -> dict:
    with state.serialized(root) as root:
        return stop_locked(root, run_id)


def stop_locked(root: Path, run_id: str) -> dict:
    directory, _ = read_manifest(root, run_id)
    target = directory / "out" / "STOP"
    if not target.exists():
        state.write_new(target, b"operator stop\n")
        state.append(directory / "lifecycle.jsonl", "stop_requested", run_id)
    return {"run_id": run_id, "state": "stop_requested", "write_status": "written",
            "note": "The runner must confirm flat; no process is killed and no external order is canceled."}


def logs(root: Path, run_id: str, tail: int = 200) -> dict:
    if not 1 <= tail <= 2000:
        raise state.fail("LIVE_LOG_LIMIT", "tail must be between 1 and 2000 lines")
    with state.reading(root) as root:
        directory, manifest = read_manifest(root, run_id)
        launch = latest_launch(directory)
        if not launch:
            return {"run_id": run_id, "lines": []}
        if recycled(directory):
            try:
                text = _log_file(directory, launch["container"]).read_text(errors="replace")
            except OSError as exc:
                raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the retained Live log is unavailable") from exc
            return {"run_id": run_id, "lines": text[-131072:].splitlines()[-tail:]}
        actual = inspect_runner(root, run_id, directory, manifest, launch)
        if actual is None:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the retained Live container is unavailable")
        result = host_runtime.docker("logs", "--tail", str(tail), actual["Id"])
        if result.returncode:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the retained Live log is unavailable")
        return {"run_id": run_id, "lines": (result.stdout + result.stderr)[-131072:].splitlines()[-tail:]}
