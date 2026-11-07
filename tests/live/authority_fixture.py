"""Isolated installed authority; test-only dependency injection, never a product override."""

import copy
import hashlib
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

from deploy.live_configuration import OPERATOR_FIELDS
from deploy.release_host import durable_json, route_config
from live import authority, configuration, inventory, release, state

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
               "universe_file": str(root / "unused-universe.json"), "symbols": ["BTCUSDT"], "memory": "2g",
               "defaults": {"budget_usdt": "90", "max_notional_per_order": "90", "max_loss_usdt": "2", "duration_seconds": 8100},
               "sources": [{"source_id": "example", "candidate": "example@1", "strategy_file": str(source),
                            "entry_class": "Example", "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                            "purpose": "controlled", "single_order_source_reviewed": True}]}
    raw = copy.deepcopy(raw)
    raw["root"] = str(root)
    declared = {"format": "live-deployment-v1", **{key: raw[key] for key in OPERATOR_FIELDS}}
    durable_json(home / "live/configuration.json", declared)
    durable_json(home / "router/active.json", route_config(WEB))

    def snapshot(web=WEB):
        file = home / "live" / web.removeprefix("trade-release-web-") / "configuration.json"
        value = {**raw, "socket": str(file.parent / "socket/control.sock")}
        durable_json(file, value)
        return SimpleNamespace(file=file, raw=value, config=configuration.load(file), binding=release.Binding(home, web))

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
