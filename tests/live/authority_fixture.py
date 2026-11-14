"""Isolated installed authority; test-only dependency injection, never a product override."""

import copy
import hashlib
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

from deploy.live_configuration import OPERATOR_FIELDS
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


def install(test, root, raw=None, *, release_state=None, mock_inventory=True):
    root = root.resolve()
    with state.serialized(root):
        pass
    home = release_state or root / "installation"
    source = root / "fixture-source.py"
    if raw is None:
        source.write_text("class Example: pass\n")
        raw = {"format": "live-control-v1", "root": str(root), "socket": "unused",
               "research_ledger": str(root / "unused-reader.json"), "research_at": "a" * 32,
               "runtime": "ghcr.io/qoeop/trade-runtime@sha256:" + "b" * 64,
               "universe_file": str(root / "unused-universe.json"), "memory": "2g",
               "defaults": {"duration_seconds": 8100, "leverage": "3"},
               "market_root": str(root / "unused-market"),
               "sources": [{"source_id": "example", "candidate": "example@1",
                            "entry_class": "Example", "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                            "purpose": "controlled", "symbols": ["BTCUSDT"]}]}
    raw = copy.deepcopy(raw)
    raw["root"] = str(root)
    declared = {"format": "live-deployment-v1", **{key: raw[key] for key in OPERATOR_FIELDS}}
    durable_json(home / "live/configuration.json", declared)
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
