"""Isolated installed authority; test-only dependency injection, never a product override."""

import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

from deploy.live_configuration import CONTROL, READER, ROOT
from deploy.release_host import durable_json, route_config
from live import authority, configuration, inventory, release, requests, state

WEB = "trade-release-web-" + "a" * 40
BOOTSTRAP = """
import sys, pathlib
from live import authority, inventory
authority.STATE = pathlib.Path(sys.argv[1])
inventory.require_clear = lambda root: None
from cli.main import main
sys.exit(main(sys.argv[2:]))
"""


def install(test, root, raw=None, *, mock_inventory=True):
    """`root` is `<release state>/live-root`, as on every release host; `raw` may give the snapshot's runtime and
    market directory, and the release state's own root and reader always replace what it names."""
    root = root.resolve()
    if root.name != ROOT:
        raise ValueError(f"an installed custody root is <release state>/{ROOT}")
    with state.serialized(root):
        pass
    home = root.parent
    raw = raw or {}
    raw = {"format": CONTROL, "root": str(root), "research_ledger": str(home / READER),
           "runtime": raw.get("runtime", "ghcr.io/qoeop/trade-runtime@sha256:" + "b" * 64),
           "market_root": raw.get("market_root", str(home / "unused-market"))}
    durable_json(home / "router/active.json", route_config(WEB))

    def snapshot(web=WEB):
        file = home / "live" / web.removeprefix("trade-release-web-") / "configuration.json"
        value = {**raw, "socket": str(file.parent / "socket/control.sock")}
        durable_json(file, value)
        return SimpleNamespace(file=file, raw=value, config=configuration.parse(value), binding=release.Binding(home, web))

    initial = snapshot()
    changes = [(authority, "STATE", home)]
    if mock_inventory:
        changes.append((inventory, "require_clear", lambda root: None))
    for target, name, value in changes:
        change = patch.object(target, name, value)
        change.start()
        test.addCleanup(change.stop)
    return SimpleNamespace(**vars(initial), state=home, snapshot=snapshot)


def inject_cli(test, home):
    original = subprocess.run

    def run(argv, *args, **kwargs):
        if argv[:3] == [sys.executable, "-m", "cli.main"]:
            argv = [sys.executable, "-c", BOOTSTRAP, str(home), *argv[3:]]
        return original(argv, *args, **kwargs)

    change = patch.object(subprocess, "run", side_effect=run)
    change.start()
    test.addCleanup(change.stop)


def prepare(*args, scope, **kwargs):
    """The locked preparation the paired control runs, with the installed admission."""
    from live import runs
    with scope.serialized(args[0]) as root:
        scope.admit_locked(root)
        return runs.prepare_locked(root, *args[1:], **kwargs)


def launch(root, run_id, credentials, mode, *, scope):
    """The locked launch the paired control runs, with the installed admission."""
    from live import runs
    with scope.serialized(root) as root:
        scope.admit_locked(root)
        return runs.launch_locked(root, run_id, credentials, mode)


def maintain(root, run_id):
    """The control's maintenance of a run (runs.maintain_locked) under the account lock."""
    from live import runs
    with state.serialized(root) as root:
        return runs.maintain_locked(root, run_id)


def recover(root, request_id):
    """The control's explicit recovery of a request (requests.recover_locked) under the account lock."""
    with state.serialized(root) as root:
        return requests.recover_locked(root, request_id)
