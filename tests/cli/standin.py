"""`python -m tests.cli.standin <noun> <verb> ...`: the real command line (cli.main.main) with stand-in
runtime images and containers, for the command tests' subprocesses.

The stand-ins are the replay tests' (tests/replay/world.py): a pinned image identity, a probe
report, and "containers" that are local Python processes acting as runner, auditor and fingerprint
stage. Everything else (ledger, market database, exports, records, reports) is real. The product
checkout is CLI_STANDIN_CHECKOUT (a clean Git work tree); CLI_STANDIN_SCENARIO (JSON) steers the
stand-in runner.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile

from registration import seams as registration_seams
from replay import entry, seams as replay_seams
from tests.ledger.dolt import IDENTITY
from tests.replay import world


def _command(identity, mounts, module, argv, name):
    kind = "audit" if module.endswith("audit") else "fingerprint" if module == "fingerprint" else "runner"
    spec = {"module": kind, "mounts": {target: str(host) for host, target, _ in mounts}, "argv": list(argv),
            "scenario": json.loads(os.environ.get("CLI_STANDIN_SCENARIO") or "{}"),
            "fingerprint": world.DEFAULT_FINGERPRINT, "name": name}
    return [sys.executable, "-c", world.RUNNER, json.dumps(spec), *argv]


def _layout(runtime_contract: str) -> dict:
    return {**replay_seams.DEFAULT.layout(runtime_contract), "fingerprint_module": "fingerprint"}


def main() -> int:
    from cli import main as cli
    checkout = Path(os.environ["CLI_STANDIN_CHECKOUT"])
    entry.WORK_ROOT = tempfile.gettempdir()
    with registration_seams.use(resolve_runtime=lambda reference: dict(IDENTITY), inspect_runtime=world.inspect,
                                checkout=lambda: checkout), \
            replay_seams.use(container_command=_command, build_revision=lambda identity: world.BUILD_REVISION,
                             layout=_layout, stop=lambda name: None):
        return cli.main(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
