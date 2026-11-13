"""Immutable private credential versions, serialized by the existing Live root lock.

All ``*_locked`` functions are called while the caller holds ``state.serialized``
(or, for listing, ``state.reading``). They never acquire another lock, connect to a
venue, release custody, or restart a runner. Secret uploads are dispatched once by
``live.requests``; this module never retries a partially completed upload.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import stat
import time

from engine.live_errors import LiveRefusal
from live import configuration, runs, state


REF = re.compile(r"[0-9a-f]{32}\Z")


def _ref(value: str) -> str:
    if not isinstance(value, str) or not REF.fullmatch(value):
        raise state.fail("LIVE_CREDENTIAL_REF", "the credential version reference is invalid")
    return value


def _directory(root: Path, *, create: bool = False) -> Path:
    directory = root / "credentials"
    if create:
        return state.private_directory(directory)
    try:
        mode = directory.lstat()
    except FileNotFoundError:
        return directory
    if not stat.S_ISDIR(mode.st_mode) or mode.st_mode & 0o077:
        raise state.fail("LIVE_CREDENTIAL_STORE", "the private credential directory is unavailable")
    return directory


def _path(root: Path, credential_ref: str) -> Path:
    return _directory(root) / (_ref(credential_ref) + ".json")


def _available(path: Path) -> bool:
    """Only filesystem metadata: a GET must never open secret bytes."""
    try:
        mode = path.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISREG(mode.st_mode) and not mode.st_mode & 0o077


def events_locked(root: Path) -> list[dict]:
    path = _directory(root) / "metadata.jsonl"
    if os.path.lexists(path) and not _available(path):
        raise state.fail("LIVE_CREDENTIAL_STORE", "the private credential history is unavailable")
    rows = state.events(path)
    saved: set[str] = set()
    selected: set[str] = set()
    removed: set[str] = set()
    for row in rows:
        ref, event, observed = row.get("credential_ref"), row.get("event"), row.get("observed_ns")
        if (set(row) != {"event", "credential_ref", "observed_ns"}
                or not isinstance(ref, str) or not REF.fullmatch(ref)
                or isinstance(observed, bool) or not isinstance(observed, int) or observed < 0
                or not isinstance(event, str) or event not in {"saved", "selected", "removed"}):
            raise state.fail("LIVE_CREDENTIAL_STORE", "the private credential history is incomplete")
        if event == "saved":
            invalid = ref in saved
            saved.add(ref)
        elif event == "selected":
            invalid = ref not in saved or ref in selected or ref in removed
            selected.add(ref)
        else:
            invalid = ref not in saved or ref in removed
            removed.add(ref)
        if invalid:
            raise state.fail("LIVE_CREDENTIAL_STORE", "the private credential history is inconsistent")
    return rows


def _current(rows: list[dict]) -> str | None:
    current = None
    for row in rows:
        if row["event"] == "selected":
            current = row["credential_ref"]
        elif row["event"] == "removed" and current == row["credential_ref"]:
            current = None
    return current


def _append(root: Path, event: str, credential_ref: str) -> None:
    path = _directory(root) / "metadata.jsonl"
    descriptor = os.open(path, os.O_CREAT | os.O_APPEND | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "ab") as stream:
        stream.write(state.encode({"event": event, "credential_ref": credential_ref, "observed_ns": time.time_ns()}))
        stream.flush()
        os.fsync(stream.fileno())
    state.fsync_parent(path)


def _runs(root: Path, *, exclude_run_id: str | None = None) -> list[tuple[str, Path, dict, list[dict], str | None]]:
    directory = root / "runs"
    if not os.path.lexists(directory):
        return []
    if directory.is_symlink() or not directory.is_dir():
        raise state.fail("LIVE_CREDENTIAL_BUSY", "retained Live execution ownership is unknown")
    result = []
    try:
        for item in sorted(directory.iterdir()):
            if item.is_symlink() or not item.is_dir() or not state.RUN_ID.fullmatch(item.name):
                raise ValueError
            if item.name == exclude_run_id:
                continue  # Only the explicitly proved local partial-prepare target may be excluded.
            run_dir, manifest = runs.read_manifest(root, item.name)
            events = runs.host_events(run_dir)
            prepared = [row for row in events if row.get("event") == "prepared"]
            if len(prepared) != 1:
                raise ValueError
            credential_ref = prepared[0].get("credential_ref")
            if credential_ref is not None:
                _ref(credential_ref)
            result.append((item.name, run_dir, manifest, events, credential_ref))
    except (OSError, ValueError, KeyError, TypeError, LiveRefusal):
        raise state.fail("LIVE_CREDENTIAL_BUSY", "retained Live execution ownership is unknown") from None
    return result


def _in_use(root: Path, item: tuple[str, Path, dict, list[dict], str | None], active: str | None) -> bool:
    run_id, directory, manifest, rows, _ = item
    if active == run_id:
        return True
    launches = [row for row in rows if row.get("event") == "launch_requested"]
    if not launches:
        return (os.path.lexists(directory / "out" / "armed.json")
                or bool(state.events(directory / "out" / "events.jsonl")))
    recycled = runs.recycled(directory)
    if recycled and recycled.get("state") in runs.ENDED:
        return False  # Original cleanup verified all retained runners before recording this fact.
    for launch in launches:
        actual = runs.inspect_runner(root, run_id, directory, manifest, launch)
        if (actual is None or actual["State"].get("Status") != "exited"
                or actual["State"].get("Running") is not False):
            return True  # Includes an earlier, timed-out preflight even when it owned no slot.
    if launches[-1]["mode"] == "preflight":
        return False
    return runs.settled_state(root, run_id, launches[-1]) is None


def _require_idle(root: Path, *, credential_ref: str | None = None, legacy_only: bool = False,
                  exclude_run_id: str | None = None) -> None:
    """No state repair: mutation is blocked until the original host path resolves it."""
    try:
        active = runs.active_run(root)
        retained = _runs(root, exclude_run_id=exclude_run_id)
        if active is not None and active not in {item[0] for item in retained}:
            raise ValueError
        for item in retained:
            bound = item[4]
            if legacy_only and bound is not None:
                continue
            if credential_ref is not None and bound is not None and bound != credential_ref:
                continue
            if _in_use(root, item, active):
                raise ValueError
    except (OSError, ValueError, KeyError, TypeError, LiveRefusal):
        raise state.fail("LIVE_CREDENTIAL_BUSY", "an active or unresolved execution still requires its credentials") from None


def _clear(root: Path, request_id: str | None) -> None:
    from live import requests
    requests.require_clear(root, request_id=request_id)


def _require_present(root: Path, credential_ref: str, rows: list[dict]) -> Path:
    _ref(credential_ref)
    saved = any(row["event"] == "saved" and row["credential_ref"] == credential_ref for row in rows)
    removed = any(row["event"] == "removed" and row["credential_ref"] == credential_ref for row in rows)
    path = _path(root, credential_ref)
    if not saved or removed or not _available(path):
        raise state.fail("LIVE_CREDENTIAL_UNAVAILABLE", "the bound credential version is unavailable")
    return path


def listing_locked(root: Path) -> list[dict]:
    """Nonsecret metadata only, including historical versions and preparation references."""
    rows = events_locked(root)
    if not rows:
        return []
    current = _current(rows)
    retained = _runs(root)
    removed = {row["credential_ref"] for row in rows if row["event"] == "removed"}
    return [{"credential_ref": row["credential_ref"], "observed_ns": str(row["observed_ns"]),
             "selected": current == row["credential_ref"], "removed": row["credential_ref"] in removed,
             "available": row["credential_ref"] not in removed and _available(_path(root, row["credential_ref"])),
             "referenced_runs": [item[0] for item in retained if item[4] == row["credential_ref"]]}
            for row in rows if row["event"] == "saved"]


def save_locked(root: Path, credential_ref: str, api_key: str, api_secret: str, *,
                request_id: str | None = None) -> dict:
    """One upload, one immutable file, one selection; never repair/replay an old ref."""
    _ref(credential_ref)
    if any(not isinstance(value, str) or not value or value != value.strip() for value in (api_key, api_secret)):
        raise state.fail("LIVE_CREDENTIAL_FILE", "provide a nonempty API key and secret")
    data = state.encode({"api_key": api_key, "api_secret": api_secret})
    if len(data) > 16384:
        raise state.fail("LIVE_CREDENTIAL_FILE", "the credential input is too large")
    _clear(root, request_id)
    _require_idle(root)
    rows = events_locked(root)
    directory = _directory(root, create=True)
    final = directory / (credential_ref + ".json")
    pending = directory / ("." + credential_ref + ".pending")
    if (any(row["credential_ref"] == credential_ref for row in rows)
            or os.path.lexists(final) or os.path.lexists(pending)):
        raise state.fail("LIVE_CREDENTIAL_CONFLICT", "this credential version cannot be saved again")
    try:
        state.write_new(pending, data)
        # No overwrite: a fully fsynced file becomes visible under its immutable final name.
        os.link(pending, final, follow_symlinks=False)
        state.fsync_parent(final)
        pending.unlink()
        state.fsync_parent(pending)
        _append(root, "saved", credential_ref)
        _append(root, "selected", credential_ref)
    except OSError:
        raise state.fail("LIVE_CREDENTIAL_STORE", "credential saving is incomplete; query the original request") from None
    return next(row for row in listing_locked(root) if row["credential_ref"] == credential_ref)


def remove_locked(root: Path, credential_ref: str, *, request_id: str | None = None) -> dict:
    """Remove only this local copy; history remains and no venue revocation occurs."""
    _ref(credential_ref)
    _clear(root, request_id)
    _require_idle(root, credential_ref=credential_ref)
    rows = events_locked(root)
    if not any(row["event"] == "saved" and row["credential_ref"] == credential_ref for row in rows):
        raise state.fail("LIVE_CREDENTIAL_UNAVAILABLE", "the credential version is unknown")
    if not any(row["event"] == "removed" and row["credential_ref"] == credential_ref for row in rows):
        path = _path(root, credential_ref)
        if os.path.lexists(path) and not _available(path):
            raise state.fail("LIVE_CREDENTIAL_STORE", "the credential file identity is unavailable")
        try:
            path.unlink(missing_ok=True)
            state.fsync_parent(path)
            _append(root, "removed", credential_ref)
        except OSError:
            raise state.fail("LIVE_CREDENTIAL_STORE", "credential removal is incomplete; query the original request") from None
    return next(row for row in listing_locked(root) if row["credential_ref"] == credential_ref)


def prepare_path_locked(root: Path, expected_ref: str, *, request_id: str | None = None) -> Path:
    _clear(root, request_id)
    _require_idle(root, legacy_only=True)
    rows = events_locked(root)
    if _current(rows) != _ref(expected_ref):
        raise state.fail("LIVE_CREDENTIAL_CHANGED", "the selected credential changed; prepare the run again")
    return _require_present(root, expected_ref, rows)


def resolve_prepare_path_locked(root: Path, run_id: str, credential_ref: str, request_id: str) -> Path:
    """Resolve only the original credential for an explicit local missing-input recovery.

    The target may lack its manifest, but may have no launch/native/account effects.
    Every other run still goes through the ordinary ownership scan. This establishes
    scope, not source/configuration validity: the original prepare verifies all frozen
    values and existing bytes before it fills a missing file.
    """
    from live import requests
    credential_ref = _ref(credential_ref)
    directory = state.directory(root, run_id)
    claim = requests.read_locked(root, request_id)
    required = {"research_at", "candidate", "symbols", "source_sha256", "entry_class", "universe_sha256",
                "runtime", "config", "source_id", "universe_file"}
    config_fields = configuration.CONFIG_KEYS | {"memory"}
    try:
        if (claim is None or requests.is_closed(claim) or claim["disposition"] is not None
                or claim["command"]["action"] != "prepare"
                or claim["command"]["target"] != {"run_id": run_id, "credential_ref": credential_ref}):
            raise ValueError
        inputs = claim["command"]["inputs"]
        if (not required <= inputs.keys() or not isinstance(inputs["config"], dict)
                or not config_fields <= inputs["config"].keys()
                or any(inputs[key] is None for key in required)
                or any(inputs["config"][key] is None for key in config_fields - {"duration_seconds"})):
            raise ValueError
        if os.path.lexists(directory):
            mode = directory.lstat()
            if not stat.S_ISDIR(mode.st_mode) or mode.st_mode & 0o077:
                raise ValueError
            if {path.name for path in directory.iterdir()} - {"inputs", "out", "egress", "lifecycle.jsonl"}:
                raise ValueError
        for name in ("inputs", "out", "egress"):
            path = directory / name
            if os.path.lexists(path):
                mode = path.lstat()
                if not stat.S_ISDIR(mode.st_mode) or mode.st_mode & 0o077:
                    raise ValueError
                if name != "inputs" and any(path.iterdir()):
                    raise ValueError
        for path in (root / "account.jsonl", directory / "lifecycle.jsonl"):
            if os.path.lexists(path) and not _available(path):
                raise ValueError
        if any(row.get("run_id") == run_id for row in state.events(root / "account.jsonl")):
            raise ValueError
        rows = state.events(directory / "lifecycle.jsonl")
        if len(rows) > 1 or any(set(row) != {"event", "run_id", "observed_ns", "request_id", "credential_ref"}
                               or type(row["observed_ns"]) is not int or row["observed_ns"] < 0
                               or row.get("event") != "prepared" or row.get("run_id") != run_id
                               or row.get("request_id") != request_id or row.get("credential_ref") != credential_ref
                               for row in rows):
            raise ValueError
    except (OSError, ValueError, KeyError, TypeError):
        raise state.fail("LIVE_RUN_CONFLICT", "the original local preparation scope cannot be established") from None
    _clear(root, request_id)
    _require_idle(root, exclude_run_id=run_id)
    versions = events_locked(root)
    if _current(versions) != credential_ref:
        raise state.fail("LIVE_CREDENTIAL_CHANGED", "the selected credential changed; prepare the run again")
    return _require_present(root, credential_ref, versions)


def run_path_locked(root: Path, run_id: str, mode: str, *, request_id: str | None = None) -> Path:
    _clear(root, request_id)
    if mode not in {"run", "preflight", "reconcile"}:
        raise state.fail("LIVE_MODE", "unknown Live operation")
    matches = [item for item in _runs(root) if item[0] == run_id]
    if len(matches) != 1 or matches[0][4] is None:
        raise state.fail("LIVE_CREDENTIAL_UNMANAGED", "this run has no managed credential version")
    credential_ref = matches[0][4]
    assert credential_ref is not None
    rows = events_locked(root)
    if mode != "reconcile":
        _require_idle(root, legacy_only=True)
        if _current(rows) != credential_ref:
            raise state.fail("LIVE_CREDENTIAL_CHANGED", "the selected credential changed; prepare the run again")
    return _require_present(root, credential_ref, rows)


def recover_locked(root: Path, claim: dict) -> str | None:
    """Explicitly settle this local transaction after reacquiring its original lock.

    Returns an incomplete disposition code, or None for an already-recorded / newly
    finished removal effect. No secret is read, resent, restored, or selected here.
    Ambiguous history or an in-use identity raises and keeps the request unknown.
    """
    from live import requests
    if requests.is_closed(claim):
        raise state.fail("LIVE_REQUEST_CLOSED_UNCLAIMED", "this request ID was closed before acceptance")
    action = claim["command"]["action"]
    credential_ref = _ref(claim["command"]["target"]["credential_ref"])
    if action not in {"credential_save", "credential_remove"}:
        raise state.fail("LIVE_CREDENTIAL_STORE", "this is not a credential transaction")
    _clear(root, claim["request_id"])
    _require_idle(root, credential_ref=credential_ref if action == "credential_remove" else None)
    rows = [row for row in events_locked(root) if row["credential_ref"] == credential_ref]
    final = _path(root, credential_ref)
    pending = final.parent / ("." + credential_ref + ".pending")
    if any(os.path.lexists(path) and not _available(path) for path in (final, pending)):
        raise state.fail("LIVE_CREDENTIAL_STORE", "the interrupted credential file identity is unknown")
    if action == "credential_save":
        if any(row["event"] == "selected" for row in rows):
            return None  # The original complete saved/selected association remains authoritative.
        return "LIVE_CREDENTIAL_INCOMPLETE"  # All remnants remain; a fresh request needs a fresh ref.
    if not any(row["event"] == "saved" for row in rows):
        raise state.fail("LIVE_CREDENTIAL_STORE", "the original credential removal identity is unknown")
    if any(row["event"] == "removed" for row in rows):
        return None
    if os.path.lexists(final):
        return "LIVE_CREDENTIAL_INCOMPLETE"  # Do not replay the deletion.
    _append(root, "removed", credential_ref)
    return None
