"""Durable operator intent around existing Live effects, never a retry queue.

All ``*_locked`` functions and ``require_clear`` run under the exclusive account lock
(``state.serialized``, or the control's ``Authority.serialized``).
Only ``dispatch`` creates a claim; a repeated ID never calls its operation again.
The original lifecycle remains the authority for what actually happened.
"""

from __future__ import annotations

from collections.abc import Callable
import json
import os
from pathlib import Path
import re
import stat
import time

from engine.live_errors import LiveRefusal, REFUSALS
from live import state


REQUEST_ID = re.compile(r"[a-z0-9][a-z0-9-]{7,63}\Z")
# The actions on one prepared run (POST /api/live/runs/<run_id>/<action>, live.serve).
RUN_ACTIONS = frozenset({"preflight", "start", "reconcile", "stop", "maintain", "runtime_switch",
                         "runtime_switch_cancel"})
ACTIONS = RUN_ACTIONS | {"prepare", "credential_save", "credential_remove"}
# A confirmed runtime switch and its cancel (live.runs): the lifecycle row that names the request is its effect.
SWITCH_ROWS = {"runtime_switch": ("runtime_switch_requested", "request_id"),
               "runtime_switch_cancel": ("runtime_switch_canceled", "cancel_request_id")}
LAUNCHES = frozenset({"preflight", "start", "reconcile"})
NONCONFLICTING = frozenset({"stop", "maintain", "runtime_switch_cancel"})  # each only takes an effect away
SECRET_FIELDS = frozenset({"api_key", "api_secret", "secret", "password", "authorization", "listenkey", "signature"})


def _path(root: Path, request_id: str) -> Path:
    if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
        raise state.fail("LIVE_REQUEST_ID", "request-id must contain 8–64 lowercase letters, digits or hyphens")
    return root / "requests" / (request_id + ".jsonl")


def _canonical(command: dict) -> dict:
    from live.credentials import REF

    def safe(value):
        if isinstance(value, dict):
            return all(isinstance(key, str) and key.lower() not in SECRET_FIELDS and safe(item)
                       for key, item in value.items())
        if isinstance(value, list):
            return all(safe(item) for item in value)
        return value is None or isinstance(value, (str, int, float, bool))

    try:
        if (not isinstance(command, dict) or set(command) != {"action", "target", "inputs"}
                or command["action"] not in ACTIONS or not isinstance(command["target"], dict)
                or not isinstance(command["inputs"], dict) or not safe(command)):
            raise ValueError
        target = command["target"]
        if set(target) - {"run_id", "credential_ref"}:
            raise ValueError
        if "run_id" in target and (not isinstance(target["run_id"], str)
                                  or not state.RUN_ID.fullmatch(target["run_id"])):
            raise ValueError
        if "credential_ref" in target and (not isinstance(target["credential_ref"], str)
                                          or not REF.fullmatch(target["credential_ref"])):
            raise ValueError
        if command["action"].startswith("credential_"):
            if set(target) != {"credential_ref"}:
                raise ValueError
        elif "run_id" not in target:
            raise ValueError
        data = state.encode(command)
        if len(data) > 65536:
            raise ValueError
        return json.loads(data)
    except (ValueError, TypeError, RecursionError) as exc:
        raise state.fail("LIVE_REQUEST_COMMAND", "a request requires one fixed, non-secret Live command") from exc


def _append(path: Path, event: str, **fields) -> None:
    data = state.encode({"event": event, "observed_ns": time.time_ns(), **fields})
    descriptor = os.open(path, os.O_APPEND | os.O_WRONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    state.fsync_parent(path)


def same_command(first: dict, second: dict) -> bool:
    """JSON booleans and numbers are distinct even though Python considers True == 1."""
    return state.encode(first) == state.encode(second)


def is_closed(record: dict | None) -> bool:
    """Whether this ID was explicitly closed before any durable command claim."""
    return record is not None and record.get("event") == "closed_unclaimed"


def read_locked(root: Path, request_id: str) -> dict | None:
    """Return the original declaration or an explicit pre-claim closure, never a new command."""
    path = _path(root, request_id)
    if (root / "requests").is_symlink():
        raise state.fail("LIVE_REQUEST_UNAVAILABLE", "the private request journal is unavailable")
    if not os.path.lexists(path):
        return None
    if not stat.S_ISREG(path.lstat().st_mode):
        raise state.fail("LIVE_REQUEST_UNAVAILABLE", "the retained request is not a regular journal")
    rows = state.events(path)
    try:
        if len(rows) == 1 and rows[0].get("event") == "closed_unclaimed":
            row = rows[0]
            if (set(row) != {"event", "observed_ns"} or type(row["observed_ns"]) is not int
                    or row["observed_ns"] < 0):
                raise ValueError
            return {"request_id": request_id, "event": "closed_unclaimed", "observed_ns": row["observed_ns"]}
        if (not rows or rows[0].get("event") != "claimed" or set(rows[0]) != {"event", "observed_ns", "command"}
                or any(not isinstance(row.get("observed_ns"), int) or isinstance(row["observed_ns"], bool)
                       for row in rows)
                or len(rows) > 2
                or any(row.get("event") not in {"refused", "interrupted", "observed"}
                       or set(row) != {"event", "observed_ns", "code"}
                       or row.get("code") not in REFUSALS | {"LIVE_REQUEST_NOT_DISPATCHED", "LIVE_REQUEST_OBSERVED"}
                       for row in rows[1:])):
            raise ValueError
        command = _canonical(rows[0]["command"])
        if len(rows) == 2:
            disposition = rows[1]
            if (disposition["event"] == "observed" and (
                    command["action"] != "maintain" or disposition["code"] != "LIVE_REQUEST_OBSERVED")
                    or disposition["event"] == "refused" and disposition["code"] not in REFUSALS
                    or disposition["event"] == "interrupted" and (
                        disposition["code"] not in {"LIVE_REQUEST_NOT_DISPATCHED", "LIVE_CREDENTIAL_INCOMPLETE"}
                        or disposition["code"] == "LIVE_CREDENTIAL_INCOMPLETE"
                        and not command["action"].startswith("credential_"))):
                raise ValueError
        return {"request_id": request_id, "event": "claimed", "command": command, "observed_ns": rows[0]["observed_ns"],
                "disposition": rows[1] if len(rows) == 2 else None}
    except (ValueError, TypeError, KeyError) as exc:
        raise state.fail("LIVE_REQUEST_UNAVAILABLE", "the retained request declaration is incomplete") from exc


def _run_effect(root: Path, claim: dict) -> dict | None:
    from live import runs

    command = claim["command"]
    run_id = command["target"]["run_id"]
    directory = state.directory(root, run_id)
    rows = state.events(directory / "lifecycle.jsonl")
    action = command["action"]
    if action == "stop":
        if not (directory / "out" / "STOP").is_file() or (directory / "out" / "STOP").is_symlink():
            return None
        runs.read_manifest(root, run_id)
        return {"source": "stop", "cursor": "1"}
    for index, row in enumerate(rows):
        if action in SWITCH_ROWS and (row.get("event"), row.get(SWITCH_ROWS[action][1])) \
                == (SWITCH_ROWS[action][0], claim["request_id"]):
            return {"source": "lifecycle", "cursor": str(index + 1)}
        if action == "prepare" and row.get("event") == "prepared":
            if row.get("request_id") != claim["request_id"]:
                previous = read_locked(root, row["request_id"]) if row.get("request_id") else None
                if not previous or is_closed(previous) or not same_command(previous["command"], command):
                    continue
            _, manifest = runs.read_manifest(root, run_id)
            runs.require_frozen_prepare(root, claim["request_id"], manifest,
                                         command["inputs"].get("research_at"), command["inputs"].get("candidate"),
                                         command["target"].get("credential_ref"))
            return {"source": "lifecycle", "cursor": str(index + 1)}
        if action in LAUNCHES and row.get("event") == "launch_requested":
            _, manifest = runs.read_manifest(root, run_id)
            same_request = row.get("request_id") == claim["request_id"]
            if not same_request:
                expected_mode = "run" if action == "start" else action
                if any(later.get("event") == "launch_requested" for later in rows[index + 1:]):
                    continue
                if row.get("mode") != expected_mode:
                    continue
                if action == "start" and command["inputs"].get("confirm_real_orders") != manifest["source"]["source_sha256"]:
                    continue
                prepared = next((item for item in rows if item.get("event") == "prepared"), None)
                if "credential_ref" in command["target"] and (
                        not prepared or prepared.get("credential_ref") != command["target"]["credential_ref"]):
                    continue
            # Completed removal/release has its own identity checks; no missing-container shortcut.
            after = rows[index + 1:]
            next_launch = next((offset for offset, item in enumerate(after) if item.get("event") == "launch_requested"), len(after))
            recycled = next((item for item in after[:next_launch] if item.get("event") == "recycled"), None)
            settled = runs.settled_state(root, run_id, row)
            actual = runs.inspect_runner(root, run_id, directory, manifest, row) if not recycled and not settled else None
            actual_state = actual.get("State", {}) if actual else {}
            if not same_request:
                # A fresh intent can adopt only the already-running identical operation, never a past exit.
                if actual_state.get("Running") is True:
                    return {"source": "lifecycle", "cursor": str(index + 1)}
                continue
            if ((recycled and recycled["observed_ns"] >= row["observed_ns"])
                    or settled is not None or actual_state.get("Running") is True
                    or actual_state.get("Status") == "exited" and actual_state.get("Running") is False):
                return {"source": "lifecycle", "cursor": str(index + 1)}
    return None


def _credential_effect(root: Path, claim: dict) -> dict | None:
    from live import credentials
    rows = credentials.events_locked(root)
    ref = claim["command"]["target"]["credential_ref"]
    # The version is uniquely allocated to this intent; wall clocks may step backwards.
    matches = [(index, row) for index, row in enumerate(rows) if row.get("credential_ref") == ref]
    if claim["command"]["action"] == "credential_remove":
        # Removing an already recorded removed version is an idempotent local intent.
        found = next((index for index, row in enumerate(rows) if row.get("credential_ref") == ref
                      and row.get("event") == "removed"), None)
    else:
        saved = next((index for index, row in matches if row.get("event") == "saved"), None)
        found = next((index for index, row in matches if row.get("event") == "selected"
                      and saved is not None and index > saved), None)
    return {"source": "credentials", "cursor": str(found + 1)} if found is not None else None


def _effect(root: Path, claim: dict) -> dict | None:
    if claim["command"]["action"].startswith("credential_"):
        return _credential_effect(root, claim)
    return _run_effect(root, claim)


def view_locked(root: Path, request_id: str) -> dict:
    claim = read_locked(root, request_id)
    if claim is None:
        raise state.fail("LIVE_REQUEST_MISSING", "this request has not been recorded")
    if is_closed(claim):
        return {"request_id": request_id, "action": "unknown", "target": {}, "outcome": "refused",
                "code": "LIVE_REQUEST_CLOSED_UNCLAIMED"}
    command = claim["command"]
    result = {"request_id": request_id, "action": command["action"], "target": command["target"],
              "outcome": "outcome_unknown"}
    disposition = claim["disposition"]
    if disposition:
        result.update(outcome="effect_recorded" if disposition["event"] == "observed" else "refused",
                      code=disposition["code"])
        return result
    try:
        effect = _effect(root, claim)
    except (LiveRefusal, OSError, KeyError, TypeError, ValueError):
        return result
    if effect:
        result.update(outcome="effect_recorded", event_ref=effect)
    return result


def view(root: Path, request_id: str) -> dict:
    """Pure lookup: never completes, retries, repairs, or releases anything."""
    with state.reading(root) as root:
        return view_locked(root, request_id)


def require_clear(root: Path, request_id: str | None = None) -> None:
    """Every effect-expanding entrance shares this conflict check."""
    directory = root / "requests"
    if not os.path.lexists(directory):
        return
    if directory.is_symlink() or not directory.is_dir():
        raise state.fail("LIVE_REQUEST_UNAVAILABLE", "the private request journal is unavailable")
    for path in sorted(directory.iterdir()):
        if request_id and path.name == request_id + ".jsonl":
            continue
        if path.suffix != ".jsonl" or not REQUEST_ID.fullmatch(path.stem):
            raise state.fail("LIVE_REQUEST_UNAVAILABLE", "the private request journal contains an unknown record")
        claim = read_locked(root, path.stem)
        if claim and not is_closed(claim) and claim["command"]["action"] not in NONCONFLICTING \
                and view_locked(root, path.stem)["outcome"] == "outcome_unknown":
            raise state.fail("LIVE_REQUEST_UNRESOLVED", "a previous Live operation still has an unknown outcome")


def _no_dispatch(root: Path, claim: dict) -> bool:
    """Called only under the reacquired root lock; not a proof that no network existed."""
    action, target = claim["command"]["action"], claim["command"]["target"]
    if action.startswith("credential_"):
        from live import credentials
        ref = target["credential_ref"]
        directory = root / "credentials"
        rows = credentials.events_locked(root)
        rows = [row for row in rows if row.get("credential_ref") == ref]
        final = directory / (ref + ".json")
        if action == "credential_save":
            return not rows and not os.path.lexists(final) and not os.path.lexists(directory / ("." + ref + ".pending"))
        if not rows or any(row.get("event") == "removed" for row in rows) or not os.path.lexists(final):
            return False
        mode = final.lstat().st_mode
        return stat.S_ISREG(mode) and not mode & 0o077 and any(row.get("event") == "saved" for row in rows)
    if action not in LAUNCHES:
        if action in SWITCH_ROWS:  # both write one lifecycle row naming the request, or nothing
            from live import runs
            runs.read_manifest(root, target["run_id"])
            event, field = SWITCH_ROWS[action]
            return not any(row.get("event") == event and row.get(field) == claim["request_id"]
                           for row in state.events(state.directory(root, target["run_id"]) / "lifecycle.jsonl"))
        if action == "prepare":
            directory = state.directory(root, target["run_id"])
            if not os.path.lexists(directory):
                return True
            from live import runs
            rows = state.events(directory / "lifecycle.jsonl")
            if any(row.get("event") == "prepared" and row.get("request_id") != claim["request_id"] for row in rows):
                runs.read_manifest(root, target["run_id"])
                return True
            return False
        return False
    directory = state.directory(root, target["run_id"])
    # Require readable original inputs and complete existing evidence before deciding absence.
    from live import runs
    runs.read_manifest(root, target["run_id"])
    state.events(root / "account.jsonl")
    state.events(directory / "out" / "events.jsonl")
    rows = state.events(directory / "lifecycle.jsonl")
    return not any(row.get("event") == "launch_requested" and row.get("request_id") == claim["request_id"]
                   for row in rows)


def recover_locked(root: Path, request_id: str) -> dict:
    """Explicit control recovery only; it never calls an operation or accesses a venue."""
    claim = read_locked(root, request_id)
    if claim is None:
        # The same lock covers claiming and closing: a delayed dispatch cannot win after this.
        # O_EXCL and the reader's non-regular/incomplete checks preserve every retained record.
        state.private_directory(root / "requests")
        state.write_new(_path(root, request_id), state.encode({"event": "closed_unclaimed", "observed_ns": time.time_ns()}))
        return view_locked(root, request_id)
    result = view_locked(root, request_id)
    if result["outcome"] != "outcome_unknown":
        return result
    try:
        absent = _no_dispatch(root, claim)
    except (LiveRefusal, OSError, KeyError, TypeError, ValueError):
        absent = False
    if absent:
        _append(_path(root, request_id), "interrupted", code="LIVE_REQUEST_NOT_DISPATCHED")
    elif claim["command"]["action"].startswith("credential_"):
        from live import credentials
        try:
            code = credentials.recover_locked(root, claim)
        except (LiveRefusal, OSError, KeyError, TypeError, ValueError):
            code = None
        if code is not None:
            _append(_path(root, request_id), "interrupted", code=code)
    return view_locked(root, request_id)


def dispatch(root: Path, request_id: str, command: dict, operation: Callable[[Path, str], object], *,
             admit_new: Callable[[Path], None] | None = None, serialized=state.serialized) -> dict:
    """Claim and execute once under the original root lock; returns the request's view, never the operation's result."""
    command = _canonical(command)
    _path(root, request_id)
    with serialized(root) as root:
        prior = read_locked(root, request_id)
        if prior is not None:
            if is_closed(prior):
                return {"request": view_locked(root, request_id)}
            if not same_command(prior["command"], command):
                raise state.fail("LIVE_REQUEST_CONFLICT", "request-id already names a different Live command")
            return {"request": view_locked(root, request_id)}
        if admit_new is not None:
            admit_new(root)
        if command["action"] not in NONCONFLICTING:
            require_clear(root)
        if command["action"] == "credential_save" and (root / "requests").exists():
            for path in (root / "requests").iterdir():
                other = read_locked(root, path.stem)
                if other and not is_closed(other) and other["command"]["action"] == "credential_save" \
                        and other["command"]["target"] == command["target"]:
                    raise state.fail("LIVE_REQUEST_CONFLICT", "a credential version belongs to its original upload request")
        state.private_directory(root / "requests")
        state.write_new(_path(root, request_id), state.encode({"event": "claimed", "observed_ns": time.time_ns(),
                                                             "command": command}))
        try:
            operation(root, request_id)
        except Exception as exc:
            # A switch writes one lifecycle row or nothing: with none written, any failure of one is a refusal, so it
            # never leaves an unknown outcome that blocks the run's later restarts.
            if not isinstance(exc, LiveRefusal) and command["action"] not in SWITCH_ROWS:
                raise
            claim = read_locked(root, request_id)
            try:
                absent = claim is not None and _no_dispatch(root, claim)
            except (LiveRefusal, OSError, KeyError, TypeError, ValueError):
                absent = False
            if absent:
                _append(_path(root, request_id), "refused",
                        code=exc.code if isinstance(exc, LiveRefusal) else "LIVE_SWITCH_CHECK")
            raise
        if command["action"] == "maintain":
            # A read/maintenance command can successfully inspect an already unchanged run.
            _append(_path(root, request_id), "observed", code="LIVE_REQUEST_OBSERVED")
        return {"request": view_locked(root, request_id)}
