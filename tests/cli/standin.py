"""`python -m tests.cli.standin <noun> <verb> ...`: the real command line (cli.main.main) with stand-in
runtime images and containers, for the command tests' subprocesses.

The stand-ins are the replay tests' (tests/replay/world.py): a pinned image identity, a probe
report, and "containers" that are local Python processes acting as runner, auditor and fingerprint
stage. Everything else (ledger, market, exports, records, reports) is real. The product
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
from tests.ledger.dolt import IDENTITY, january
from tests.replay import world


def _command(identity, mounts, module, argv, name):
    scenario = json.loads(os.environ.get("CLI_STANDIN_SCENARIO") or "{}")
    return world.stand_in(mounts, module, argv, name, scenario, world.DEFAULT_FINGERPRINT)[1]


def main() -> int:
    from cli import main as cli
    checkout = Path(os.environ["CLI_STANDIN_CHECKOUT"])
    entry.WORK_ROOT = tempfile.gettempdir()
    with registration_seams.use(resolve_runtime=lambda reference: {**IDENTITY, "build_revision": world.BUILD_REVISION},
                                inspect_runtime=world.inspect,
                                require_ci_build=lambda identity, inspection: world.BUILD_REVISION,
                                checkout=lambda: checkout), january(), \
            replay_seams.use(container_command=_command, stop=lambda name: None):
        return cli.main(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
