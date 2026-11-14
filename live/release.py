"""Admission derived from the existing Web release transaction and committed router.

No release state is stored here. The host holds its release lock and the existing
Live account lock itself across this read-only inspection and its metadata write.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import stat

from deploy import release_host
from deploy.live_configuration import read_object
from deploy.release_host import REVISION, route_name
from engine.live_errors import LiveRefusal
from live import requests, runs, state


WEB = re.compile(re.escape(release_host.WEB) + REVISION.pattern)  # a control's own Web


def _unavailable():
    return state.fail("LIVE_RELEASE_UNAVAILABLE", "this control cannot confirm release ownership for a new effect")


@dataclass(frozen=True)
class Binding:
    state: Path
    web_name: str

    def __post_init__(self):
        if not self.state.is_absolute() or not isinstance(self.web_name, str) or not WEB.fullmatch(self.web_name):
            raise _unavailable()


def parse_binding(path: Path | None, name: str | None) -> Binding | None:
    if path is None and name is None:
        return None  # Parsing can report omitted binding; no new-effect admission accepts it.
    if path is None or name is None:
        raise _unavailable()
    return Binding(path, name)


def _sha(name, prefix: str = release_host.WEB) -> str:
    """The revision of a managed release container's name."""
    if isinstance(name, str):
        try:
            return release_host.revision(name, prefix)
        except RuntimeError:
            pass
    raise ValueError("release metadata names an unmanaged container")


def _web(value) -> bool:
    try:
        return bool(_sha(value))
    except ValueError:
        return False


def _committed(binding: Binding) -> str:
    """The committed Web, whose own control owns the account (deploy.release_host.route_config)."""
    value = read_object(binding.state / "router" / "active.json")
    routes = value["apps"]["http"]["servers"]["ide"]["routes"]
    if not isinstance(routes, list) or len(routes) != 1 or len(routes[0]["handle"]) != 1:
        raise ValueError("ambiguous release route")
    proxy = routes[0]["handle"][0]
    upstreams = proxy["upstreams"]
    if proxy["handler"] != "reverse_proxy" or not isinstance(upstreams, list) or len(upstreams) != 1:
        raise ValueError("ambiguous release upstream")
    try:
        return route_name(value)
    except RuntimeError:
        raise ValueError("unknown release upstream") from None


def _transaction(binding: Binding) -> dict | None:
    path = binding.state / "transaction.json"
    try:
        value = read_object(path)
    except FileNotFoundError:
        # A broken symlink is retained malformed metadata, never proof of no transaction.
        if os.path.lexists(path):
            raise ValueError("unavailable release transaction") from None
        return None
    if (set(value) - {"agent_before"} != {"candidate", "previous"}
            or not _web(value["candidate"]) or not _web(value["previous"]) or value["candidate"] == value["previous"]):
        raise ValueError("unknown release transaction")
    if "agent_before" in value:
        _sha(value["agent_before"], release_host.AGENT)
    return value


def admission_locked(binding: Binding | None, *, maintenance: bool = False) -> None:
    """Caller holds the account lock through its effect; STOP never calls this gate."""
    if binding is None:
        raise _unavailable()
    try:
        committed, transaction = _committed(binding), _transaction(binding)
        if transaction is None:
            allowed = committed == binding.web_name
        else:
            allowed = (maintenance and committed in {transaction["candidate"], transaction["previous"]}
                       and binding.web_name == transaction["previous"])
        if not allowed:
            raise ValueError("release ownership does not permit this effect")
    except (OSError, ValueError, RuntimeError, KeyError, IndexError, TypeError):
        raise _unavailable() from None


def _events(path: Path) -> list[dict]:
    if os.path.lexists(path) and not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("unavailable custody journal")
    return state.events(path)


def idle_locked(root: Path) -> str:
    """idle, busy or unavailable, from custody and verified retained runners, including every unarchived preflight.
    Busy only once every run was read: one run that cannot be verified makes the whole account unavailable."""
    busy = False
    try:
        mode = root.lstat().st_mode
        if (not stat.S_ISDIR(mode) or mode & 0o077
                or not stat.S_ISREG((root / "account.lock").lstat().st_mode)):
            return "unavailable"
        requests.require_clear(root)
        account = _events(root / "account.jsonl")
        if any(row.get("event") not in {"reserved", "released"}
               or not isinstance(row.get("run_id"), str) or not state.RUN_ID.fullmatch(row["run_id"])
               for row in account):
            return "unavailable"
        directory = root / "runs"
        retained = []
        if os.path.lexists(directory):
            if directory.is_symlink() or not directory.is_dir():
                return "unavailable"
            retained = sorted(directory.iterdir())
            if any(item.is_symlink() or not item.is_dir() or not state.RUN_ID.fullmatch(item.name)
                   for item in retained):
                return "unavailable"
            retained = [item for item in retained if not runs.earlier(item)]
        active = runs.active_run(root)
        if active is not None and active not in {item.name for item in retained}:
            return "unavailable"
        for item in retained:
            if any((item / part).is_symlink() or not (item / part).is_dir() for part in ("inputs", "out")):
                return "unavailable"
            run_dir, manifest = runs.read_manifest(root, item.name)
            rows = _events(run_dir / "lifecycle.jsonl")
            if (sum(row.get("event") == "prepared" for row in rows) != 1
                    or any(row.get("run_id") != item.name for row in rows)):
                return "unavailable"
            native = _events(run_dir / "out" / "events.jsonl")
            if not any(row.get("event") == "launch_requested" for row in rows) and (
                    native or os.path.lexists(run_dir / "out" / "armed.json")):
                return "unavailable"
            observed = runs.observe_locked(root, item.name)
            if observed["account_owned"] or observed["state"] == "running":
                busy = True
                continue
            if observed["state"] not in {"prepared", *runs.ENDED}:
                return "unavailable"
            # A latest finished preflight does not prove an earlier timed-out one exited.
            # Original recycling already verified all runners; inspect only its later window.
            for launch in runs.since_removal(run_dir):
                if launch.get("event") != "launch_requested":
                    continue
                actual = runs.inspect_runner(root, item.name, run_dir, manifest, launch)
                if actual is None:
                    return "unavailable"
                if actual["State"].get("Running") is True:
                    busy = True
                    break
                if (actual["State"].get("Status") != "exited"
                        or actual["State"].get("Running") is not False):
                    return "unavailable"
        return "busy" if busy else "idle"
    except (LiveRefusal, OSError, ValueError, KeyError, TypeError):
        return "unavailable"
