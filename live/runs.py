"""Host lifecycle for one private Live account slot, with retained originals.

No command writes to research or Paper. An ambiguous launch owns the account slot
until the runner observes it flat (natively, or the whole account at Binance), or every
runner it started is proven to have exited without arming. A dead container is never flat evidence. An ended run gives
up its containers and network; its directory remains the execution record.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
import hashlib
import os
from pathlib import Path
import re
import secrets
import time

from engine.config import Refusal as EngineRefusal, is_leverage
from engine.live_errors import LiveRefusal
from engine.live_venue import MANIFEST_FORMAT, read_credentials
from ledger import db, strategies
from shared.errors import Refusal
from runtime import image
from live import host as host_runtime
from live import configuration, key, requests, state


VALIDATION_NOTE = ("status is the bound run's audit status (unbound, bound, passed, invalid), no verdict on returns: "
                   "read validation report <registration_id>. A registration covers this candidate on its "
                   "universe_rule.")
# The runner's flat events and the states they end a run in; venue_flat is the whole account at Binance only.
FLAT = {"clean_stop": "clean_stopped", "reconciled_flat": "reconciled_flat", "venue_flat": "venue_flat"}
ENDED = {*FLAT.values(), "not_armed", "preflight_complete", "preflight_failed"}
UNRESOLVED_NOTE = ("Exposure may remain at Binance and nothing will close it: follow 'Unresolved Live runs' in "
                   "engine/README.md now (live stop, close and cancel at Binance, then live reconcile).")
REPEATABLE = {"preflight_complete", "preflight_failed"}  # no slot and no order: this run may still start
# The runner's events that end a run (engine.live.ENDED_EVENTS). An armed run whose latest start ended in none of them,
# with no stop asked for, was interrupted: it keeps its slot, positions and exchange stops, and starts again as itself.
RUN_ENDED = frozenset({"clean_stop", "reconciled_flat", "venue_flat", "reconcile_stopped", "unresolved"})
RESTARTS_PER_HOUR = 3  # automatic starts of an interrupted run; beyond them the user is told and decides (design §3.4)
HOUR_NS = 3600 * 10**9


def _runner(root: Path, run_id: str, directory: Path, manifest: dict, launch: dict) -> dict | None:
    started = next((row for row in reversed(_host_events(directory))
                    if row["event"] == "container_started" and row.get("container") == launch["container"]), None)
    return host_runtime.container_identity(root, run_id, directory, manifest, launch["container"], "runner", mode=launch["mode"],
                      credentials_path=launch.get("credentials_path"),
                      container_id=started.get("container_id") if started else None,
                      runtime=launch_runtime(directory, manifest, launch))


def _manifest(root: Path, run_id: str) -> tuple[Path, dict]:
    directory = state.directory(root, run_id)
    manifest = state.read(directory / "inputs" / "manifest.json")
    if manifest.get("run_id") != run_id:
        raise state.fail("LIVE_IDENTITY_CHANGED", "the private manifest does not identify this run")
    if manifest.get("format") != MANIFEST_FORMAT:
        raise state.fail("LIVE_RUN_FORMAT", "this run was prepared under an earlier manifest format, which is no "
                                            "longer read")
    for filename, digest in (("strategy.py", manifest["source"]["source_sha256"]),
                             ("universe.json", manifest["universe_sha256"])):
        path = directory / "inputs" / filename
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the declared Live inputs have changed")
    return directory, manifest


def _host_events(directory: Path) -> list[dict]:
    return state.events(directory / "lifecycle.jsonl")


def _latest_launch(directory: Path) -> dict | None:
    return next((row for row in reversed(_host_events(directory)) if row["event"] == "launch_requested"), None)


def _flat(directory: Path, run_id: str) -> str | None:
    """The state a flat event of the latest launch ends the run in."""
    launch = _latest_launch(directory)
    if launch is None:
        return None
    return next((FLAT[row["event"]] for row in state.events(directory / "out" / "events.jsonl")
                 if row.get("event") in FLAT and row.get("run_id") == run_id
                 and row.get("observed_ns", row.get("ts_ns", 0)) >= launch["observed_ns"]), None)


def _interrupted(directory: Path, launch: dict | None) -> bool:
    """The latest start was a run that armed and ended in no ending event, and no stop was asked for."""
    if launch is None or launch["mode"] != "run" or not os.path.lexists(directory / "out" / "armed.json") \
            or os.path.lexists(directory / "out" / "STOP"):
        return False
    rows = [row for row in state.events(directory / "out" / "events.jsonl")
            if row.get("observed_ns", 0) >= launch["observed_ns"]]
    return not any(row.get("event") in RUN_ENDED for row in rows)


# A confirmed new runtime image (design §3.8, the user 2026-11-13: the same run takes it at its next flat moment). The
# runner reads SWITCH beside STOP (engine.live_connection.SWITCH, RUNNER_CONTRACT 2); lifecycle.jsonl holds the rest.
SWITCH = "SWITCH"
SWITCH_EVENTS = frozenset({"runtime_switch_requested", "runtime_switched", "runtime_switch_canceled",
                           "runtime_switch_failed"})
SWITCH_STARTS = frozenset({"rewarming", "held_flat"})  # a start that ended flat without ending the run


def pending_switch(directory: Path) -> dict | None:
    """The confirmed switch the run has not taken yet, canceled or failed."""
    rows = [row for row in _host_events(directory) if row["event"] in SWITCH_EVENTS]
    return rows[-1] if rows and rows[-1]["event"] == "runtime_switch_requested" else None


def launch_runtime(directory: Path, manifest: dict, launch: dict | None) -> dict:
    """The image a launch ran on: the manifest's, or the confirmed switch's it names (`image_ref`)."""
    ref = launch.get("image_ref") if launch else None
    if ref is None or ref == manifest["runtime"]["image_ref"]:
        return manifest["runtime"]
    found = next((row["runtime"] for row in reversed(_host_events(directory))
                  if row["event"] == "runtime_switch_requested" and row["runtime"]["image_ref"] == ref), None)
    if found is None:
        raise state.fail("LIVE_IDENTITY_CHANGED", "a launch names a runtime image no switch confirmed")
    return found


def _since(directory: Path, launch: dict) -> list[dict]:
    return [row for row in state.events(directory / "out" / "events.jsonl")
            if row.get("observed_ns", 0) >= launch["observed_ns"]]


def _launch_runtime_locked(directory: Path, run_id: str, manifest: dict, latest: dict | None,
                           mode: str) -> tuple[dict, str | None, list[tuple[str, dict]]]:
    """The image this launch runs on, the switch request it takes, if any, and the lifecycle rows that say so, which
    the caller appends only after `launch_requested` (a launch cut short before it changes no image).

    - A switch's first start that ended before its warm-up (the new image did not start: a refusal, a native cache it
      cannot read) falls back once to the image before it (the user, 2026-11-13), for a run start or a
      reconciliation.
    - A run start after one that ended flat without ending the run (SWITCH_STARTS) takes a pending switch, if its
      image is still on this host.
    """
    current = launch_runtime(directory, manifest, latest)
    if mode == "preflight" or latest is None or latest["mode"] != "run":
        return current, None, []
    rows = _since(directory, latest)
    if latest.get("switch_request_id") and not any(row.get("event") == "warmup" for row in rows):
        before = [row for row in _host_events(directory) if row["event"] == "launch_requested"
                  and row["observed_ns"] < latest["observed_ns"]]
        return launch_runtime(directory, manifest, before[-1] if before else None), None, [(
            "runtime_switch_failed", {"request_id": latest["switch_request_id"], "code": "LIVE_RUNTIME_START",
                                      "image_ref": current["image_ref"]})]
    pending = pending_switch(directory)
    if mode != "run" or pending is None or not any(row.get("event") in SWITCH_STARTS for row in rows):
        return current, None, []
    target = pending["runtime"]
    if host_runtime.inspect("image", target["image_ref"]) is None:
        return current, None, [("runtime_switch_failed", {"request_id": pending["request_id"],
                                                          "code": "RUNTIME_UNAVAILABLE",
                                                          "image_ref": target["image_ref"]})]
    return target, pending["request_id"], [("runtime_switched", {"request_id": pending["request_id"],
                                                                 "image_ref": target["image_ref"],
                                                                 "previous": current["image_ref"]})]


def sync_switch_locked(root: Path, run_id: str, now_ns: int) -> None:
    """SWITCH follows lifecycle.jsonl: present while a confirmed switch is pending, no stop was asked for, and the run
    may start twice more within the hour (restarts_due): on the new image, and once more on the old one should the new
    one not start. The runner never ends a start it cannot start again."""
    directory = state.directory(root, run_id)
    target = directory / "out" / SWITCH
    wanted = pending_switch(directory) is not None and _run_launches(directory, now_ns) < RESTARTS_PER_HOUR \
        and not os.path.lexists(directory / "out" / "STOP")
    if wanted and not os.path.lexists(target):
        state.write_new(target, b"runtime switch\n")
    elif not wanted and os.path.lexists(target):
        target.unlink()
        state.fsync_parent(target)


def _cancel_switch(root: Path, run_id: str, directory: Path, reason: str, request_id: str | None = None) -> None:
    pending = pending_switch(directory)
    if pending is not None:
        state.append(directory / "lifecycle.jsonl", "runtime_switch_canceled", run_id,
                     request_id=pending["request_id"], reason=reason,
                     **({"cancel_request_id": request_id} if request_id else {}))
    if os.path.lexists(directory / "out" / SWITCH):
        (directory / "out" / SWITCH).unlink()
        state.fsync_parent(directory / "out" / SWITCH)


def request_switch_locked(root: Path, run_id: str, runtime: str, research: db.LedgerProfile, research_at: str,
                          request_id: str | None = None) -> dict:
    """Confirm the release's runtime image for a running run (design §3.8). The same checks as a start on that image:
    a main CI build of the manifest's runtime contract, on whose replay code the replay that backed this run's first
    arming still passes (the same trial, so no other balance). The runner takes it at its next flat moment."""
    directory, manifest = _manifest(root, run_id)
    launch = _latest_launch(directory)
    result, _ = _outcome(root, run_id, directory, manifest, launch, release=False)
    if launch is None or launch["mode"] != "run" or result != "running" \
            or os.path.lexists(directory / "out" / "STOP"):
        raise state.fail("LIVE_SWITCH", "only a running Live run with no stop asked for takes a new runtime image")
    if pending_switch(directory) is not None:
        raise state.fail("LIVE_SWITCH", "this run already waits for a new runtime image; cancel that first")
    try:  # the image's and the ledger's own refusals, named in the message
        identity = image.resolve(runtime)
        if identity["image_ref"] == launch_runtime(directory, manifest, launch)["image_ref"]:
            raise state.fail("LIVE_SWITCH", "this run already runs on the release's runtime image")
        describe = _describe(manifest["symbols"])
        inspection = image.inspect_runtime(identity, describe)
        revision = image.require_main_build(identity, inspection)
        if identity["runtime_contract"] != manifest["runtime"]["runtime_contract"]:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the source and fixed runtime contracts differ")
        evidence = _evidence(research, research_at, manifest["source"]["source_sha256"], manifest["symbols"],
                             inspection, describe)
    except Refusal as exc:
        raise state.fail("LIVE_SWITCH_CHECK", f"{exc.code}: {exc.message}") from exc
    armed = next((row for row in state.events(directory / "out" / "events.jsonl")
                  if row.get("event") == "replay_evidence"), None)
    if armed is None or armed.get("trial_id") not in {row["trial_id"] for row in evidence}:
        raise state.fail("LIVE_EVIDENCE_MISSING", "the replay that backed this run's first arming does not run the "
                                                  "replay code of the new runtime image; replay it on a matching "
                                                  "replay image (engine/README.md)")
    state.append(directory / "lifecycle.jsonl", "runtime_switch_requested", run_id,
                 runtime={**identity, "build_revision": revision}, research_at=research_at,
                 trial_id=armed["trial_id"], request_id=request_id or secrets.token_hex(16))
    sync_switch_locked(root, run_id, time.time_ns())
    return {"run_id": run_id, "state": "switch_requested", "write_status": "written",
            "image_ref": identity["image_ref"]}


def cancel_switch_locked(root: Path, run_id: str, request_id: str | None = None) -> dict:
    directory, _ = _manifest(root, run_id)
    if pending_switch(directory) is None:
        raise state.fail("LIVE_SWITCH", "this run waits for no new runtime image")
    _cancel_switch(root, run_id, directory, "user", request_id)
    return {"run_id": run_id, "state": "switch_canceled", "write_status": "written"}


def restarts_due(directory: Path, now_ns: int) -> bool:
    """Whether the control may start an interrupted run again: at most RESTARTS_PER_HOUR restarts (the first start
    and its restarts are all run launches) in the last hour."""
    return _run_launches(directory, now_ns) <= RESTARTS_PER_HOUR


def _run_launches(directory: Path, now_ns: int) -> int:
    return sum(row["event"] == "launch_requested" and row.get("mode") == "run"
               and now_ns - row.get("observed_ns", 0) < HOUR_NS for row in _host_events(directory))


def _active(root: Path) -> str | None:
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
    for launch in _host_events(directory):
        if launch["event"] == "launch_requested" and launch["mode"] != "preflight":
            # Every launch: a timed-out `docker run` can stay alive behind a later one, and a missing
            # container proves nothing.
            actual = _runner(root, run_id, directory, manifest, launch)
            if actual is None or actual["State"].get("Status") != "exited":
                return False
    output = directory / "out"
    return (not os.path.lexists(output / "armed.json")
            and not any(row.get("event") == "connecting" for row in state.events(output / "events.jsonl")))


def _release_if_resolved(root: Path, run_id: str, directory: Path) -> None:
    launch = _latest_launch(directory)
    _, manifest = _manifest(root, run_id)
    actual = _runner(root, run_id, directory, manifest, launch) if launch else None
    if _active(root) != run_id:
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


def _since_removal(directory: Path) -> list[dict]:
    events = _host_events(directory)
    last = max((index for index, row in enumerate(events) if row["event"] == "recycled"), default=-1)
    return events[last + 1:]


def _recycled(directory: Path) -> dict | None:
    """The record of a removal that still describes the run; a later launch starts over."""
    for row in reversed(_host_events(directory)):
        if row["event"] == "launch_requested":
            return None
        if row["event"] == "recycled":
            return row
    return None


def _settled(root: Path, run_id: str, launch: dict | None) -> str | None:
    """A release after the latest launch already decided the run, so no container has to be read."""
    if launch is None or _active(root) == run_id:
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
        recorded = _recycled(directory)
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
                path = _log_file(directory, name)
                pending = path.with_suffix(".pending")
                pending.unlink(missing_ok=True)
                state.write_new(pending, (output.stdout + output.stderr).encode())
                os.replace(pending, path)
                state.fsync_parent(path)
            # Recorded first: a removal cut short is finished later and never leaves a run that looks unended.
            state.append(directory / "lifecycle.jsonl", "recycled", run_id, state=result, exit_code=exit_code)
        elif _since_removal(directory):
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
            directory, manifest = _manifest(root, run_id)
            launch = _latest_launch(directory)
            if launch is None or _active(root) == run_id:
                continue
            recorded = _recycled(directory)
            result = (recorded["state"] if recorded else _settled(root, run_id, launch)
                      or _outcome(root, run_id, directory, manifest, launch)[0])
            if result in ENDED:
                _recycle(root, run_id, directory, result, launch)
        except (LiveRefusal, OSError, KeyError):
            continue


def _credentials(path: Path, binding: str | None = None) -> str:
    try:
        found = read_credentials(path)
    except EngineRefusal as exc:
        raise state.fail(exc.code, str(exc)) from None
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


def _bound_credential(root: Path, run_id: str, directory: Path, path: Path, mode: str,
                      request_id: str | None) -> dict | None:
    """A prepared run launches only with its own managed credential version (credentials.run_path_locked)."""
    prepared = next((row for row in _host_events(directory) if row.get("event") == "prepared"), None)
    if prepared is None:
        return None
    from live import credentials as credential_store
    expected = credential_store.run_path_locked(root, run_id, mode, request_id=request_id)
    if path.resolve() != expected.resolve():
        raise state.fail("LIVE_CREDENTIAL_CHANGED", "the prepared run requires its original credential version file")
    return prepared


def _candidate(research: db.LedgerProfile, research_at: str, candidate: str, source_sha256: str | None) -> dict:
    """The candidate at research_at; Live runs its own source and nothing else (no adapted file)."""
    with db.read_as_of(research, research_at) as reader:
        found = strategies.read_candidate(reader, candidate)
    if hashlib.sha256(found["source"]).hexdigest() != found["source_sha256"]:
        raise state.fail("LIVE_IDENTITY_CHANGED", "the candidate's stored source does not hash to its source_sha256")
    if source_sha256 is not None and found["source_sha256"] != source_sha256:
        raise state.fail("LIVE_IDENTITY_CHANGED", f"{candidate} at research_at is source {found['source_sha256']}, "
                                                  f"not the declared {source_sha256}")
    return found


# What --describe reports of the replay closure: equal values mean the same replay code (R2, user 2026-11-12).
REPLAY_CODE = ("source_files_sha256", "audit_source_sha256", "dependency_lock_sha256")


def _evidence(research: db.LedgerProfile, research_at: str, source_sha256: str, symbols: list[str],
              inspection: dict, runner_args: list[str]) -> list[dict]:
    """The replays at research_at that back running this source live: on exactly Live's instruments, in the bars
    environment, either a passed sealed run or a completed explore whose audit passed (`replay explore` of the
    candidate at the wallet's balance) trading only inside a research trial's window of this source (a window it
    already saw: no new exposure, no holdout spent), on an image whose replay code (REPLAY_CODE) equals this
    execution image's. A sealed run on other replay code still counts through an explore that reproduces it on
    matching code."""
    from ledger import execution
    from registration import reproduction
    with db.read_as_of(research, research_at) as reader:
        rows = reader.dicts("SELECT t.trial_id, t.purpose, t.image_ref, t.starting_balance, t.trade_start, "
                            "t.trade_end, r.status FROM trial t "
                            "LEFT JOIN run r ON r.trial_id = t.trial_id "
                            "WHERE t.source_sha256 = %s AND t.execution = 'bars' ORDER BY t.trial_id",
                            (source_sha256,))
        instruments: dict[int, set] = {}
        for trial_id, symbol in reader.rows("SELECT i.trial_id, i.instrument_id FROM trial_instrument i "
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
    described: dict[str, bool] = {}

    def same_code(image_ref: str) -> bool:
        if image_ref not in described:
            try:
                found = image.inspect_runtime(image.resolve(image_ref), runner_args)
                described[image_ref] = all(found[name] == inspection[name] for name in REPLAY_CODE)
            except Refusal:
                described[image_ref] = False  # an image that cannot be read now backs nothing
        return described[image_ref]

    result = []
    for row, images in backing:
        matching = next((ref for ref in dict.fromkeys(images) if same_code(ref)), None)
        if matching is not None:
            balance = Decimal(row["starting_balance"]).normalize()
            result.append({"trial_id": row["trial_id"], "starting_balance_usdt": format(balance, "f"),
                           "image_ref": matching})
    return result


def _describe(symbols: list[str]) -> list[str]:
    """The runner arguments of the execution image's --describe probe, which reports its replay code."""
    return ["--market-root", "/unused", "--market-day", "live", "--symbols", *symbols,
            "--start", "2026-01-01T00:00:00Z", "--end", "2026-01-02T00:00:00Z"]


def replay_evidence(research: db.LedgerProfile, research_at: str, source_sha256: str, symbols: list[str],
                    runtime: str | None) -> list[dict]:
    """The replays prepare_locked would record for this source (_evidence), read ahead so the page can show them
    before a run is prepared. Read only; preparation still checks again and refuses as before."""
    describe = _describe(symbols)
    inspection = image.inspect_runtime(image.resolve(runtime or image.EXECUTION), describe)
    return _evidence(research, research_at, source_sha256, symbols, inspection, describe)


def prepare_locked(root: Path, run_id: str, research: db.LedgerProfile, research_at: str, candidate: str,
                    symbols: list[str], universe: Path, credentials: Path, runtime: str | None, *,
                    drawdown_brake: str, duration_seconds: int | None, memory: str, leverage: str,
                    market_root: Path, source_sha256: str | None = None, request_id: str | None = None,
                    credential_ref: str | None = None, recover_partial: bool = False) -> dict:
    """Capture immutable source inputs using the reader, before any account effect. The source is the candidate's
    own, read from the ledger; `source_sha256`, when the declaration names it, must be that candidate's."""
    requests.require_clear(root, request_id)
    directory = state.directory(root, run_id)
    bound_prepared = _bound_credential(root, run_id, directory, credentials, "preflight", request_id)
    binding = _credentials(credentials)
    if not db.COMMIT_HASH.fullmatch(research_at):
        raise state.fail("LIVE_RESEARCH_COMMIT", "Live requires the exact full research commit")
    if (not symbols or len(set(symbols)) != len(symbols)
            or any(not re.fullmatch(r"[A-Z0-9]+USDT", symbol) for symbol in symbols)):
        raise state.fail("LIVE_SYMBOLS", "Live requires distinct explicit USD-M symbols")
    if duration_seconds is not None and (isinstance(duration_seconds, bool) or not isinstance(duration_seconds, int)
                                         or duration_seconds < 1):
        raise state.fail("LIVE_CONFIG", "duration-seconds must be a positive integer, or absent to run until stopped")
    brake = _positive(drawdown_brake, "drawdown-brake")
    if Decimal(brake) > Decimal(configuration.BRAKE_DEFAULT):
        raise state.fail("LIVE_CONFIG", f"the drawdown brake can only be tighter than {configuration.BRAKE_DEFAULT}")
    if not is_leverage(leverage):
        raise state.fail("LIVE_CONFIG", "leverage must be an integer from 1 to 125")
    config = {"drawdown_brake": brake,
              "duration_seconds": duration_seconds, "memory": memory, "leverage": leverage,
              "proxy_url": f"http://{host_runtime.resource_names(root, run_id)['egress']}:3128"}
    if directory.exists() and not recover_partial:
        _, prior = _manifest(root, run_id)
        source_ref = f"{prior['candidate']['strategy_id']}@{prior['candidate']['revision']}"
        if (source_ref != candidate or prior["symbols"] != symbols or prior["config"] != config
                or prior["credential_binding"] != binding
                or universe.is_symlink()
                or hashlib.sha256(universe.read_bytes()).hexdigest() != prior["universe_sha256"]
                # A repeat names the pinned digest or no runtime; a tag can move, so it is refused.
                or runtime is not None and runtime != prior["runtime"]["image_ref"]
                # Last, so the candidate is read only when everything else matches.
                or prior["source"]["source_sha256"]
                != _candidate(research, research_at, candidate, source_sha256)["source_sha256"]):
            raise state.fail("LIVE_RUN_CONFLICT", "run-id already binds different inputs, settings or credentials")
        if bound_prepared and request_id is None:
            original_id = bound_prepared.get("request_id")
            if not original_id:
                raise state.fail("LIVE_RUN_CONFLICT", "the prepared run's original research snapshot is unavailable")
            _require_frozen_prepare(root, original_id, prior, research_at, candidate,
                                    bound_prepared["credential_ref"])
        if request_id is not None:
            prepared = next((row for row in _host_events(directory) if row.get("event") == "prepared"), None)
            original = requests.read_locked(root, prepared["request_id"]) if prepared and prepared.get("request_id") else None
            current = requests.read_locked(root, request_id)
            if (not prepared or prepared.get("credential_ref") != credential_ref or not original or not current
                    or requests.is_closed(original) or requests.is_closed(current)):
                raise state.fail("LIVE_RUN_CONFLICT", "a prepared run retains its original request and research snapshot")
            if current["command"]["action"] == "preflight" and current["command"]["target"].get("run_id") == run_id:
                _require_frozen_prepare(root, original["request_id"], prior, research_at, candidate, credential_ref)
            else:
                _require_frozen_prepare(root, request_id, prior, research_at, candidate, credential_ref)
                if not requests.same_command(original["command"], current["command"]):
                    raise state.fail("LIVE_RUN_CONFLICT", "a prepared run retains its original request and research snapshot")
        return prior
    found = _candidate(research, research_at, candidate, source_sha256)
    if universe.is_symlink():
        raise state.fail("LIVE_UNIVERSE", "the universe must be a regular file")
    universe_bytes = universe.read_bytes()
    from engine.load import read_universe
    try:
        read_universe(universe, symbols)
    except EngineRefusal as exc:
        raise state.fail("LIVE_UNIVERSE", str(exc)) from None
    identity = image.resolve(runtime or image.EXECUTION)
    describe = _describe(symbols)
    inspection = image.inspect_runtime(identity, describe)
    image.require_main_build(identity, inspection)
    if found["runtime_contract"] != identity["runtime_contract"]:
        raise state.fail("LIVE_IDENTITY_CHANGED", "the source and fixed runtime contracts differ")
    evidence = _evidence(research, research_at, found["source_sha256"], symbols, inspection, describe)
    if not evidence:
        raise state.fail("LIVE_EVIDENCE_MISSING", "no passed run, or audited explore inside a research window, of this "
                                                  "source on these instruments in bars runs the replay code of this "
                                                  "execution image; replay it at the wallet's balance on a matching "
                                                  "replay image (engine/README.md)")
    market = _market_terms(market_root, symbols)
    source_bytes = found["source"]
    key = hashlib.sha256(run_id.encode()).hexdigest()[:12]
    manifest = {"format": MANIFEST_FORMAT, "run_id": run_id,
                "candidate": {name: found[name] for name in ("strategy_id", "revision")},
                "source": {name: found[name] for name in ("source_sha256", "entry_class")},
                "runtime": identity, "symbols": symbols, "config": config, "credential_binding": binding,
                "trader_id": f"LIVE-{key}", "account_id": f"BINANCE-LIVE-{key}",
                "strategy_file": "/inputs/strategy.py", "universe_file": "/inputs/universe.json",
                "universe_sha256": hashlib.sha256(universe_bytes).hexdigest(), "market": market,
                "evidence": evidence}
    if request_id is not None:
        _require_frozen_prepare(root, request_id, manifest, research_at, candidate, credential_ref)
    elif recover_partial:
        raise state.fail("LIVE_RUN_CONFLICT", "partial preparation needs its original fixed request")
    files = ((directory / "inputs" / "strategy.py", source_bytes),
             (directory / "inputs" / "universe.json", universe_bytes),
             (directory / "inputs" / "manifest.json", state.encode(manifest)))
    prior_events = _host_events(directory) if recover_partial else []
    if recover_partial:
        # A local-only recovery may fill missing inputs, never overwrite a partial or different write.
        if any(row.get("event") != "prepared" or row.get("request_id") != request_id
               or row.get("credential_ref") != credential_ref for row in prior_events):
            raise state.fail("LIVE_RUN_CONFLICT", "partial preparation has other retained lifecycle effects")
        for path, data in files:
            if os.path.lexists(path) and (path.is_symlink() or not path.is_file() or path.read_bytes() != data):
                raise state.fail("LIVE_RUN_CONFLICT", "partial preparation contains different retained bytes")
    for part in (directory, directory / "inputs", directory / "out", directory / "egress"):
        state.private_directory(part)
    for path, data in files:
        if not recover_partial or not os.path.lexists(path):
            state.write_new(path, data)
    if not prior_events:
        state.append(directory / "lifecycle.jsonl", "prepared", run_id,
                     **({"request_id": request_id} if request_id is not None else {}),
                     **({"credential_ref": credential_ref} if credential_ref is not None else {}))
    return manifest


def _market_terms(market_root: Path, symbols: list[str]) -> dict:
    """The market's latest market day and each contract's terms there, which the runner compares with exchangeInfo
    before each entry (TERMS_CHANGED)."""
    from market import files, instrument
    from market.sources import MarketError
    try:
        opened = files.open_market({"root": str(market_root)}, "reader")
        market_day = files.resolve_day(opened, None)
        return {"market_day": market_day,
                "terms": {symbol: instrument.terms(opened, market_day, symbol) for symbol in symbols}}
    except MarketError as exc:
        raise state.fail("LIVE_MARKET_TERMS", str(exc)) from None


def _require_frozen_prepare(root: Path, request_id: str, manifest: dict, research_at: str, candidate: str,
                            credential_ref: str | None) -> None:
    claim = requests.read_locked(root, request_id)
    command = claim["command"] if claim and not requests.is_closed(claim) else {}
    inputs = command.get("inputs", {})
    wanted = {"research_at": research_at, "candidate": candidate, "symbols": manifest["symbols"],
              "source_sha256": manifest["source"]["source_sha256"], "entry_class": manifest["source"]["entry_class"],
              "universe_sha256": manifest["universe_sha256"], "runtime": manifest["runtime"]["image_ref"],
              "config": {name: manifest["config"][name] for name in (
                  "drawdown_brake", "duration_seconds", "leverage", "memory")}}
    if (command.get("action") != "prepare" or claim is None or claim["disposition"] is not None
            or command.get("target") != {"run_id": manifest["run_id"], "credential_ref": credential_ref}
            or any(inputs.get(name) != value for name, value in wanted.items())):
        raise state.fail("LIVE_RUN_CONFLICT", "preparation differs from its original immutable request")


def review(research: db.LedgerProfile, research_at: str, manifest: dict) -> dict:
    """What the operator reads before start: the pinned source and image and the facts at this commit, no gate and no
    conclusion. An absent candidate is refused, so an empty list means no registration."""
    from registration import validation
    candidate, source = manifest["candidate"], manifest["source"]
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
    _, manifest = _manifest(root, run_id)
    if source_sha256 != manifest["source"]["source_sha256"]:
        raise state.fail("LIVE_IDENTITY_CHANGED", "the confirmation must be the source_sha256 this run's "
                                                  "preflight or status shows; nothing was started")


def _network(root: Path, run_id: str, directory: Path, manifest: dict) -> dict:
    names = host_runtime.resource_names(root, run_id)
    events = _since_removal(directory)
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


def launch_locked(root: Path, run_id: str, credentials: Path, mode: str, *, request_id: str | None = None) -> dict:
    if mode not in ("preflight", "run", "reconcile"):
        raise state.fail("LIVE_MODE", "unknown Live operation")
    requests.require_clear(root, request_id)
    directory, manifest = _manifest(root, run_id)
    _bound_credential(root, run_id, directory, credentials, mode, request_id)
    _credentials(credentials, manifest["credential_binding"])
    recorded = _recycled(directory)
    if recorded and recorded["state"] not in REPEATABLE and mode != "run":
        # Before the slot: its original network and egress are gone, so nothing could run.
        raise state.fail("LIVE_RUN_MISSING", "this run has ended and given up its containers; prepare a new run-id")
    if recorded and recorded["state"] in REPEATABLE and not _since_removal(directory):
        # A removal cut short must not leave old resources for this launch to adopt unrecorded.
        host_runtime.remove_resources(root, run_id, host_runtime.owned_containers(root, run_id))
    active = _active(root)
    if active and active != run_id:
        other, _ = _manifest(root, active)
        _release_if_resolved(root, active, other)
        if _active(root):
            raise state.fail("LIVE_ACCOUNT_OWNED", f"run {active} still owns this account slot")
    latest = _latest_launch(directory)
    if latest:
        actual = _runner(root, run_id, directory, manifest, latest)
        if actual and actual["State"].get("Running"):
            if latest["mode"] == mode:
                return {"run_id": run_id, "mode": mode, "state": "running", "write_status": "replayed", "warnings": []}
            raise state.fail("LIVE_RUNNING", "the previous Live process must end before another mode starts")
        if mode == "run" and any(row.get("mode") == "run" for row in _host_events(directory)) \
                and not _interrupted(directory, latest):
            raise state.fail("LIVE_RESTART_REQUIRES_RECONCILIATION",
                             "only an interrupted Live run starts again; after not_armed, prepare a new run-id")
    if mode == "reconcile" and not os.path.lexists(directory / "out" / "armed.json"):
        # Checked here too: a released run must not take the slot back only to be refused by its runner.
        raise state.fail("LIVE_RUN_MISSING", "reconciliation needs the original armed execution")
    warnings = [] if mode == "reconcile" else key.require_limits(credentials)
    _recycle_others(root, run_id)
    if mode != "preflight" and _active(root) is None:
        state.append(root / "account.jsonl", "reserved", run_id)
    names = _network(root, run_id, directory, manifest)
    runtime, switch_request, switch_rows = _launch_runtime_locked(directory, run_id, manifest, latest, mode)
    attempt = sum(row["event"] == "launch_requested" for row in _host_events(directory)) + 1
    runner = names["network"] + f"-{mode}-{attempt}"
    command = host_runtime.runner_command(manifest, directory, run_id, credentials, mode, runner, names, runtime)
    credentials_path = str(credentials.resolve())
    state.append(directory / "lifecycle.jsonl", "launch_requested", run_id, mode=mode, container=runner,
                 credentials_path=credentials_path, image_ref=runtime["image_ref"],
                 **({"switch_request_id": switch_request} if switch_request is not None else {}),
                 **({"request_id": request_id} if request_id is not None else {}))
    for event, fields in switch_rows:
        state.append(directory / "lifecycle.jsonl", event, run_id, **fields)
    # After the launch is counted and a switch taken or failed here is recorded: no SWITCH the restart budget or the
    # journal no longer allows reaches the runner.
    sync_switch_locked(root, run_id, time.time_ns())
    try:
        identifier = host_runtime.checked(*command[1:])
        if not re.fullmatch(r"[0-9a-f]{64}", identifier):
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "Docker did not return the launched runner identity")
        if host_runtime.container_identity(root, run_id, directory, manifest, runner, "runner", mode=mode,
                      credentials_path=credentials_path, container_id=identifier, runtime=runtime) is None:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the launched runner cannot be verified")
    except Exception:
        state.append(directory / "lifecycle.jsonl", "launch_unresolved", run_id, mode=mode)
        raise
    state.append(directory / "lifecycle.jsonl", "container_started", run_id, mode=mode, container=runner,
                 container_id=identifier)
    return {"run_id": run_id, "mode": mode, "state": "starting", "write_status": "written",
            "directory": str(directory), "container": runner, "warnings": warnings}


def _outcome(root: Path, run_id: str, directory: Path, manifest: dict, launch: dict | None, *,
             release: bool = True) -> tuple[str, int | None]:
    actual = _runner(root, run_id, directory, manifest, launch) if launch else None
    if release:
        _release_if_resolved(root, run_id, directory)
    flat = _flat(directory, run_id) if launch and actual and actual["State"].get("ExitCode") == 0 else None
    running = bool(actual and actual["State"].get("Running"))
    result = ("running" if running else flat if flat
              else "not_armed" if launch and _released_unarmed(root, run_id)
              else "interrupted" if actual and _interrupted(directory, launch)
              else "unresolved" if launch else "prepared")
    if launch and launch["mode"] == "preflight" and actual and not running:
        result = "preflight_complete" if actual["State"].get("ExitCode") == 0 else "preflight_failed"
    return result, actual["State"].get("ExitCode") if actual else None


def _stop_reason(directory: Path) -> str | None:
    """The first stop is the run's cause; a later reconcile writes its own, and a start that ended to warm up again
    (engine.live_connection.rewarm) is none. A damaged journal must not hide the state."""
    try:
        rows = state.events(directory / "out" / "events.jsonl")
    except LiveRefusal:
        return None
    return next((row.get("reason") for row in rows if row.get("event") == "stopping"
                 and row.get("reason") != "rewarming"), None)


def status(root: Path, run_id: str) -> dict:
    with state.serialized(root) as root:
        return maintain_locked(root, run_id)


def maintain_locked(root: Path, run_id: str) -> dict:
    """Maintain an existing run while the caller owns its original account lock."""
    return _status_view(root, run_id, maintain=True)


def observe(root: Path, run_id: str) -> dict:
    """Inspect existing host evidence without release, archive, cleanup, or venue access.

    This is the host view, not an HTTP-safe response: the web projection must select
    safe fields and must not pass through arbitrary source stop reasons.
    """
    with state.reading(root) as root:
        return _status_view(root, run_id, maintain=False)


def _status_view(root: Path, run_id: str, *, maintain: bool) -> dict:
    directory, manifest = _manifest(root, run_id)
    launch = _latest_launch(directory)
    # A slot taken after the record belongs to a start that never launched, and needs its release check.
    recorded = _recycled(directory) if _active(root) != run_id else None
    settled = _settled(root, run_id, launch)
    if recorded:
        result, exit_code = recorded["state"], recorded["exit_code"]
    elif settled:
        result, exit_code = settled, 0 if settled != "not_armed" else None
    elif maintain:
        result, exit_code = _outcome(root, run_id, directory, manifest, launch)
    else:
        result, exit_code = _outcome(root, run_id, directory, manifest, launch, release=False)
    if maintain and result not in {"running", "interrupted"}:
        _cancel_switch(root, run_id, directory, "ended")  # a run that will not start again takes no new image
    if maintain and launch and result in ENDED and _active(root) != run_id:
        _recycle(root, run_id, directory, result, launch)
    return {"run_id": run_id, "state": result, "mode": launch["mode"] if launch else None,
            "account_owned": _active(root) == run_id, "container": launch["container"] if launch else None,
            "candidate": manifest["candidate"], "source": manifest["source"],
            "image_ref": launch_runtime(directory, manifest, launch)["image_ref"], "symbols": manifest["symbols"],
            "exit_code": exit_code,
            "stop_reason": _stop_reason(directory),
            **({"note": UNRESOLVED_NOTE} if result == "unresolved" else {})}


def stop(root: Path, run_id: str) -> dict:
    with state.serialized(root) as root:
        return stop_locked(root, run_id)


def stop_locked(root: Path, run_id: str) -> dict:
    directory, _ = _manifest(root, run_id)
    target = directory / "out" / "STOP"
    if not target.exists():
        state.write_new(target, b"operator stop\n")
        state.append(directory / "lifecycle.jsonl", "stop_requested", run_id)
    _cancel_switch(root, run_id, directory, "stopped")
    return {"run_id": run_id, "state": "stop_requested", "write_status": "written",
            "note": "The runner must confirm flat; no process is killed and no external order is canceled."}


def logs(root: Path, run_id: str, tail: int = 200) -> dict:
    if not 1 <= tail <= 2000:
        raise state.fail("LIVE_LOG_LIMIT", "tail must be between 1 and 2000 lines")
    with state.reading(root) as root:
        directory, manifest = _manifest(root, run_id)
        launch = _latest_launch(directory)
        if not launch:
            return {"run_id": run_id, "lines": []}
        if _recycled(directory):
            try:
                text = _log_file(directory, launch["container"]).read_text(errors="replace")
            except OSError as exc:
                raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the retained Live log is unavailable") from exc
            return {"run_id": run_id, "lines": text[-131072:].splitlines()[-tail:]}
        actual = _runner(root, run_id, directory, manifest, launch)
        if actual is None:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the retained Live container is unavailable")
        result = host_runtime.docker("logs", "--tail", str(tail), actual["Id"])
        if result.returncode:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the retained Live log is unavailable")
        return {"run_id": run_id, "lines": (result.stdout + result.stderr)[-131072:].splitlines()[-tail:]}
