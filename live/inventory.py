"""Read-only evidence of Live containers outside the installed execution scope.

Discovery neither creates ownership nor adopts resources. Inaccessible foreign
history stays unavailable; installation cutover must separately inspect known
legacy roots even when their containers have already disappeared.
"""

from pathlib import Path
import re

from engine.live_errors import LiveRefusal
from live import runs, state


def _unavailable():
    return state.fail("LIVE_ACCOUNT_OWNED", "another retained Live execution cannot be proved resolved")


def _identity(found: dict) -> tuple[Path, str, str]:
    labels = (found.get("Config") or {}).get("Labels") or {}
    run_id, role = labels.get("trade.live.run"), labels.get("trade.live.role")
    if not isinstance(run_id, str) or not state.RUN_ID.fullmatch(run_id) or role not in {"runner", "egress"}:
        raise _unavailable()
    reports = [m for m in found.get("Mounts", []) if m.get("Type") == "bind" and m.get("Destination") == "/reports"]
    if len(reports) != 1 or not isinstance(reports[0].get("Source"), str):
        raise _unavailable()
    report = Path(reports[0]["Source"])
    suffix = Path("runs") / run_id / ("out" if role == "runner" else "egress")
    if not report.is_absolute() or tuple(report.parts[-3:]) != suffix.parts:
        raise _unavailable()
    return report.parents[2], run_id, role


def _verified(root: Path, run_id: str, role: str, found: dict) -> None:
    directory, manifest = runs._manifest(root, run_id)
    name = found.get("Name", "").removeprefix("/")
    if role == "runner":
        launch = next((row for row in runs._host_events(directory)
                       if row.get("event") == "launch_requested" and row.get("container") == name), None)
        actual = runs._runner(root, run_id, directory, manifest, launch) if launch else None
    else:
        actual = runs._container(root, run_id, directory, manifest, name, "egress")
    if actual is None or actual.get("Id") != found.get("Id"):
        raise _unavailable()


def require_clear(root: Path) -> None:
    """Caller holds canonical account.lock; never wait on a foreign account lock."""
    try:
        ids = runs._checked("ps", "-aq", "--no-trunc", "--filter", "label=trade.live.run").splitlines()
        if len(ids) != len(set(ids)) or any(not re.fullmatch(r"[0-9a-f]{64}", item) for item in ids):
            raise _unavailable()
        for identity in ids:
            found = runs._inspect("container", identity)
            if found is None or found.get("Id") != identity:
                raise _unavailable()
            owner, run_id, role = _identity(found)
            if owner == root:
                _verified(root, run_id, role, found)
                continue
            # A shared, nonblocking read keeps the original root's state consistent,
            # without an inverted wait between independently held account locks.
            with state.existing(owner, blocking=False):
                _verified(owner, run_id, role, found)
                from live import release
                if (release.idle_locked(owner) != "idle"
                        or (found.get("State") or {}).get("Running") is not False
                        or (found.get("State") or {}).get("Status") != "exited"):
                    raise _unavailable()
    except (LiveRefusal, OSError, ValueError, KeyError, TypeError, AttributeError):
        raise _unavailable() from None
