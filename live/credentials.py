"""Immutable private credential versions, serialized by the existing Live root lock.

Each Binance environment (live.configuration.ENVIRONMENTS: the real account, Binance Demo Trading) keeps its own
versions, history and selection under ``credentials/<environment>/``: saving one never replaces the other, and a run
binds a version of its own environment only (the user, 2026-11-21: 「demo 和 live都有各自的key才对吧」).

All ``*_locked`` functions are called while the caller holds ``state.serialized``
(or, for listing, ``state.reading``). They never acquire another lock, connect to a
venue, release custody, or restart a runner. A save sent again with its request (the same version reference)
finishes what it left undone; a version left unfinished is never selected otherwise.
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


def _ref(value: object) -> str:
    if not isinstance(value, str) or not REF.fullmatch(value):
        raise state.fail("LIVE_CREDENTIAL_REF", "the credential version reference is invalid")
    return value


def _directory(root: Path, environment: str, *, create: bool = False) -> Path:
    parent = root / "credentials"
    directory = parent / configuration.environment(environment)
    if create:
        state.private_directory(parent)
        return state.private_directory(directory)
    for path in (parent, directory):
        try:
            mode = path.lstat()
        except FileNotFoundError:
            return directory
        if not stat.S_ISDIR(mode.st_mode) or mode.st_mode & 0o077:
            raise state.fail("LIVE_CREDENTIAL_STORE", "the private credential directory is unavailable")
    return directory


def _path(root: Path, environment: str, credential_ref: str) -> Path:
    return _directory(root, environment) / (_ref(credential_ref) + ".json")


def _available(path: Path) -> bool:
    """Only filesystem metadata: a GET must never open secret bytes."""
    try:
        mode = path.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISREG(mode.st_mode) and not mode.st_mode & 0o077


def events_locked(root: Path, environment: str) -> list[dict]:
    path = _directory(root, environment) / "metadata.jsonl"
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


def _append(root: Path, environment: str, event: str, credential_ref: str) -> None:
    path = _directory(root, environment) / "metadata.jsonl"
    descriptor = os.open(path, os.O_CREAT | os.O_APPEND | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "ab") as stream:
        stream.write(state.encode({"event": event, "credential_ref": credential_ref, "observed_ns": time.time_ns()}))
        stream.flush()
        os.fsync(stream.fileno())
    state.fsync_parent(path)


UNRESOLVED = "an active or unresolved execution still requires its credentials"


def _runs(root: Path, environment: str | None = None) -> list[tuple[str, Path, dict, list[dict], str]]:
    """Each retained run of this version with its prepared credential reference (runs.earlier: no other is read); of
    `environment` only when given."""
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
            if runs.earlier(item):
                continue
            run_dir, manifest = runs.read_manifest(root, item.name)
            events = runs.host_events(run_dir)
            prepared = [row for row in events if row.get("event") == "prepared"]
            if len(prepared) != 1:
                raise ValueError
            credential_ref = _ref(prepared[0].get("credential_ref"))
            if environment is not None and manifest["config"]["environment"] != environment:
                continue
            result.append((item.name, run_dir, manifest, events, credential_ref))
    except (OSError, ValueError, KeyError, TypeError, LiveRefusal):
        raise state.fail("LIVE_CREDENTIAL_BUSY", "retained Live execution ownership is unknown") from None
    return result


def _in_use(root: Path, item: tuple[str, Path, dict, list[dict], str], active: str | None) -> bool:
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


def _require_idle(root: Path, environment: str, *, credential_ref: str | None = None) -> None:
    """No state repair: mutation is blocked until the original host path resolves it. Only the runs of `environment`
    hold its keys."""
    blocking = None
    try:
        active = runs.active_run(root)
        if active is not None and active not in {item[0] for item in _runs(root)}:
            raise ValueError
        retained = _runs(root, environment)
        for item in retained:
            if credential_ref is not None and item[4] != credential_ref:
                continue
            if _in_use(root, item, active):
                blocking = item
                break
    except (OSError, ValueError, KeyError, TypeError, LiveRefusal):
        raise state.fail("LIVE_CREDENTIAL_BUSY", UNRESOLVED) from None
    if blocking is not None:
        raise state.fail("LIVE_CREDENTIAL_BUSY", UNRESOLVED)


def _require_known(root: Path) -> None:
    """Every retained run and the account slot read whole: a new effect never proceeds beside unknown ownership."""
    try:
        retained = {item[0] for item in _runs(root)}
        active = runs.active_run(root)
        if active is not None and active not in retained:
            raise ValueError
    except (OSError, ValueError, KeyError, TypeError, LiveRefusal):
        raise state.fail("LIVE_CREDENTIAL_BUSY", UNRESOLVED) from None


def _require_present(root: Path, environment: str, credential_ref: str, rows: list[dict]) -> Path:
    _ref(credential_ref)
    saved = any(row["event"] == "saved" and row["credential_ref"] == credential_ref for row in rows)
    removed = any(row["event"] == "removed" and row["credential_ref"] == credential_ref for row in rows)
    path = _path(root, environment, credential_ref)
    if not saved or removed or not _available(path):
        raise state.fail("LIVE_CREDENTIAL_UNAVAILABLE", "the bound credential version is unavailable")
    return path


def listing_locked(root: Path) -> dict[str, list[dict]]:
    """Each environment's nonsecret metadata only, including historical versions and preparation references."""
    return {environment: _listing(root, environment) for environment in configuration.ENVIRONMENTS}


def _listing(root: Path, environment: str) -> list[dict]:
    rows = events_locked(root, environment)
    if not rows:
        return []
    current = _current(rows)
    retained = _runs(root, environment)
    removed = {row["credential_ref"] for row in rows if row["event"] == "removed"}
    return [{"credential_ref": row["credential_ref"], "observed_ns": str(row["observed_ns"]),
             "selected": current == row["credential_ref"], "removed": row["credential_ref"] in removed,
             "available": row["credential_ref"] not in removed
             and _available(_path(root, environment, row["credential_ref"])),
             "referenced_runs": [item[0] for item in retained if item[4] == row["credential_ref"]]}
            for row in rows if row["event"] == "saved"]


def _item(root: Path, environment: str, credential_ref: str) -> dict:
    return next(row for row in _listing(root, environment) if row["credential_ref"] == credential_ref)


def save_locked(root: Path, environment: str, credential_ref: str, api_key: str, api_secret: str) -> dict:
    """One upload, one immutable file, one selection. The same version sent again returns what it recorded, or
    finishes it: a saved one is selected, and files no history names are written again."""
    _ref(credential_ref)
    if any(not isinstance(value, str) or not value or value != value.strip() for value in (api_key, api_secret)):
        raise state.fail("LIVE_CREDENTIAL_FILE", "provide a nonempty API key and secret")
    data = state.encode({"api_key": api_key, "api_secret": api_secret})
    if len(data) > 16384:
        raise state.fail("LIVE_CREDENTIAL_FILE", "the credential input is too large")
    recorded = {row["event"] for row in events_locked(root, environment) if row["credential_ref"] == credential_ref}
    if recorded & {"selected", "removed"}:
        return _item(root, environment, credential_ref)  # its first send finished
    _require_idle(root, environment)
    directory = _directory(root, environment, create=True)
    final = directory / (credential_ref + ".json")
    pending = directory / ("." + credential_ref + ".pending")
    try:
        if "saved" not in recorded:
            for path in (pending, final):  # an earlier send of this version stopped before its history
                if os.path.lexists(path):
                    if not _available(path):
                        raise state.fail("LIVE_CREDENTIAL_STORE", "the credential file identity is unavailable")
                    path.unlink()
                    state.fsync_parent(path)
            state.write_new(pending, data)
            # No overwrite: a fully fsynced file becomes visible under its immutable final name.
            os.link(pending, final, follow_symlinks=False)
            state.fsync_parent(final)
            pending.unlink()
            state.fsync_parent(pending)
            _append(root, environment, "saved", credential_ref)
        _require_present(root, environment, credential_ref, events_locked(root, environment))
        _append(root, environment, "selected", credential_ref)
    except OSError:
        raise state.fail("LIVE_CREDENTIAL_STORE", "credential saving is incomplete; send the same save again") from None
    return _item(root, environment, credential_ref)


def remove_locked(root: Path, environment: str, credential_ref: str) -> dict:
    """Remove only this local copy; history remains and no venue revocation occurs."""
    _ref(credential_ref)
    rows = events_locked(root, environment)
    if not any(row["event"] == "saved" and row["credential_ref"] == credential_ref for row in rows):
        raise state.fail("LIVE_CREDENTIAL_UNAVAILABLE", "the credential version is unknown")
    if any(row["event"] == "removed" and row["credential_ref"] == credential_ref for row in rows):
        return _item(root, environment, credential_ref)
    _require_idle(root, environment, credential_ref=credential_ref)
    path = _path(root, environment, credential_ref)
    if os.path.lexists(path) and not _available(path):
        raise state.fail("LIVE_CREDENTIAL_STORE", "the credential file identity is unavailable")
    try:
        path.unlink(missing_ok=True)
        state.fsync_parent(path)
        _append(root, environment, "removed", credential_ref)
    except OSError:
        raise state.fail("LIVE_CREDENTIAL_STORE", "credential removal is incomplete; send the same removal again") from None
    return _item(root, environment, credential_ref)


def prepare_path_locked(root: Path, environment: str, expected_ref: str) -> Path:
    """The selected key of `environment`, which a run of that environment binds; a reference saved under the other
    environment is not selected here (LIVE_CREDENTIAL_CHANGED)."""
    _require_known(root)
    rows = events_locked(root, environment)
    if _current(rows) != _ref(expected_ref):
        raise state.fail("LIVE_CREDENTIAL_CHANGED", "the selected credential of this environment changed; prepare the "
                                                    "run again")
    return _require_present(root, environment, expected_ref, rows)


def run_path_locked(root: Path, run_id: str, mode: str) -> Path:
    if mode not in {"run", "preflight", "reconcile"}:
        raise state.fail("LIVE_MODE", "unknown Live operation")
    matches = [item for item in _runs(root) if item[0] == run_id]
    if len(matches) != 1:
        raise state.fail("LIVE_CREDENTIAL_UNMANAGED", "this run has no managed credential version")
    credential_ref, environment = matches[0][4], matches[0][2]["config"]["environment"]
    rows = events_locked(root, environment)
    if mode != "reconcile":
        _require_known(root)
        if _current(rows) != credential_ref:
            raise state.fail("LIVE_CREDENTIAL_CHANGED", "the selected credential changed; prepare the run again")
    return _require_present(root, environment, credential_ref, rows)
