"""Admission derived from the existing Web release transaction and committed router.

No release state is stored here. The host holds its release lock and the existing
Live account lock itself across this read-only inspection and its metadata write.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import stat

from engine.live_errors import LiveRefusal
from live import requests, runs, state


WEB = re.compile(r"trade-release-web-[0-9a-f]{40}\Z")  # a control's own Web
# A routed Web, which may serve ahead of the control that owns the account (`-pre`: deploy.release_host.AHEAD,
# docs/plans/live-web-first-release-20261108.zh.md). Such a Web has no control of its own.
SERVING = re.compile(r"trade-release-web-([0-9a-f]{40})(-pre)?\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
OWNER = re.compile(r"live-([0-9a-f]{40})\Z")
AGENT = re.compile(r"trade-release-agent-[0-9a-f]{40}\Z")


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


def _pairs(pairs: list[tuple[str, object]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate release metadata key")
        result[key] = value
    return result


def _read(path: Path) -> dict:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("release metadata is not regular")
        value = json.load(stream, object_pairs_hook=_pairs)
    if not isinstance(value, dict):
        raise ValueError("release metadata is not an object")
    return value


def _web(value) -> bool:
    return isinstance(value, str) and SERVING.fullmatch(value) is not None


def _sha(web: str) -> str:
    found = SERVING.fullmatch(web)
    if found is None:
        raise ValueError("release metadata names an unmanaged Web")
    return found.group(1)


def _ahead(web: str) -> bool:
    found = SERVING.fullmatch(web)
    return found is not None and found.group(2) is not None


def _committed(binding: Binding) -> tuple[str, str]:
    """The committed Web and the revision of the control that owns the account.

    This is the existing deploy.release_host.route_config format, not another pointer: after a Web-only
    release the owner rides on the route as its `@id`; without one the Web's own control owns it.
    """
    value = _read(binding.state / "router" / "active.json")
    routes = value["apps"]["http"]["servers"]["ide"]["routes"]
    if not isinstance(routes, list) or len(routes) != 1 or len(routes[0]["handle"]) != 1:
        raise ValueError("ambiguous release route")
    proxy = routes[0]["handle"][0]
    upstreams = proxy["upstreams"]
    if proxy["handler"] != "reverse_proxy" or not isinstance(upstreams, list) or len(upstreams) != 1:
        raise ValueError("ambiguous release upstream")
    dial = upstreams[0]["dial"]
    if not isinstance(dial, str) or not dial.endswith(":8765") or not _web(dial[:-5]):
        raise ValueError("unknown release upstream")
    web = dial[:-5]
    if "@id" not in routes[0]:
        if _ahead(web):
            raise ValueError("a Web ahead of its control names no owner")
        return web, _sha(web)
    owner = OWNER.fullmatch(routes[0]["@id"]) if isinstance(routes[0]["@id"], str) else None
    if owner is None:
        raise ValueError("unknown release owner")
    return web, owner.group(1)


def _transaction(binding: Binding) -> dict | None:
    path = binding.state / "transaction.json"
    try:
        value = _read(path)
    except FileNotFoundError:
        # A broken symlink is retained malformed metadata, never proof of no transaction.
        if os.path.lexists(path):
            raise ValueError("unavailable release transaction") from None
        return None
    keys = set(value) - {"agent_before"}
    if (keys not in ({"candidate", "previous"}, {"candidate", "previous", "candidate_owner"},
                     {"candidate", "previous", "previous_owner"})
            or not _web(value["candidate"])
            or _ahead(value["candidate"]) and "candidate_owner" not in value
            or not _web(value["previous"]) or value["candidate"] == value["previous"]
            or any(not isinstance(value.get(key, ""), str) or key in value and not REVISION.fullmatch(value[key])
                   for key in ("candidate_owner", "previous_owner"))):
        raise ValueError("unknown release transaction")
    if "agent_before" in value and not (isinstance(value["agent_before"], str) and AGENT.fullmatch(value["agent_before"])):
        raise ValueError("unknown previous Agent")
    return value


def admission_locked(binding: Binding | None, *, maintenance: bool = False) -> None:
    """Caller holds the account lock through its effect; STOP never calls this gate."""
    if binding is None:
        raise _unavailable()
    try:
        (committed, owner), transaction = _committed(binding), _transaction(binding)
        mine = _sha(binding.web_name)
        if transaction is None:
            allowed = owner == mine
        elif "candidate_owner" in transaction:
            # A Web-only release keeps this control as owner throughout: the account's work goes on.
            allowed = (committed in {transaction["candidate"], transaction["previous"]}
                       and owner == transaction["candidate_owner"] == mine)
        else:
            previous = transaction.get("previous_owner", _sha(transaction["previous"]))
            allowed = (maintenance and committed in {transaction["candidate"], transaction["previous"]}
                       and mine == previous)
        if not allowed:
            raise ValueError("release ownership does not permit this effect")
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        raise _unavailable() from None


def _events(path: Path) -> list[dict]:
    if os.path.lexists(path) and not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("unavailable custody journal")
    return state.events(path)


def idle_locked(root: Path) -> str:
    """Read custody and verified retained runners, including every unarchived preflight."""
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
        active = runs._active(root)
        if active is not None and active not in {item.name for item in retained}:
            return "unavailable"
        for item in retained:
            if any((item / part).is_symlink() or not (item / part).is_dir() for part in ("inputs", "out")):
                return "unavailable"
            run_dir, manifest = runs._manifest(root, item.name)
            rows = _events(run_dir / "lifecycle.jsonl")
            if (sum(row.get("event") == "prepared" for row in rows) != 1
                    or any(row.get("run_id") != item.name for row in rows)):
                return "unavailable"
            native = _events(run_dir / "out" / "events.jsonl")
            if not any(row.get("event") == "launch_requested" for row in rows) and (
                    native or os.path.lexists(run_dir / "out" / "armed.json")):
                return "unavailable"
            observed = runs._status_view(root, item.name, maintain=False)
            if observed["account_owned"] or observed["state"] == "running":
                return "busy"
            if observed["state"] not in {"prepared", *runs.ENDED}:
                return "unavailable"
            # A latest finished preflight does not prove an earlier timed-out one exited.
            # Original recycling already verified all runners; inspect only its later window.
            for launch in runs._since_removal(run_dir):
                if launch.get("event") != "launch_requested":
                    continue
                actual = runs._runner(root, item.name, run_dir, manifest, launch)
                if actual is None:
                    return "unavailable"
                if actual["State"].get("Running") is True:
                    return "busy"
                if (actual["State"].get("Status") != "exited"
                        or actual["State"].get("Running") is not False):
                    return "unavailable"
        return "idle"
    except (LiveRefusal, OSError, ValueError, KeyError, TypeError):
        return "unavailable"
