"""Exercise the built image on its native CI runner, with no venue or host Docker access.

The small bracket replay is a packaging regression check, not the paired CLI acceptance in engine/README.md.
"""

import argparse
import importlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import unittest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("runtime", "service", "ide"))
    parser.add_argument("arch", choices=("arm64", "amd64"))
    parser.add_argument("--output", type=Path, default=Path("/tmp/native-check"))
    args = parser.parse_args()
    expected = {"arm64": "aarch64", "amd64": "x86_64"}[args.arch]
    assert platform.machine() == expected, (platform.machine(), expected)
    # Resolve product packages before exposing the checkout's tests. Otherwise tests might
    # silently exercise mounted sources instead of the image we are about to publish.
    packages = ("engine",) if args.kind == "runtime" else (
        "cli", "engine", "ledger", "market", "paper", "qualification", "registration", "replay", "report", "runtime")
    for package in packages:
        module = importlib.import_module(package)
        assert Path(module.__file__).is_relative_to("/opt/trade"), module.__file__
    sys.path.insert(0, "/opt/trade/ide")
    if args.kind != "runtime":
        module = importlib.import_module("research_graph")
        assert Path(module.__file__).is_relative_to("/opt/trade/ide"), module.__file__
    sys.path.insert(0, "/validation")
    if args.kind == "runtime":
        suite = unittest.defaultTestLoader.discover("/validation/tests/engine", top_level_dir="/validation")
    elif args.kind == "service":
        version = subprocess.check_output(["dolt", "version"], text=True)
        assert version.startswith("dolt version 2.4.2"), version
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            "tests.ledger.test_replica", "tests.paper.test_remote_control", "tests.paper.test_serve",
            "tests.research_graph.test_research_sync"])
    else:
        from research_graph.render import built_page

        assert built_page()
        assert subprocess.check_output(["node", "--version"], text=True).startswith("v24.")
        print(f"Native {args.arch} IDE page and Node loaded")
        return
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    assert result.wasSuccessful(), "native image checks failed"
    assert not result.skipped, result.skipped
    if args.kind == "runtime":
        from engine.config import ACCOUNT_CONTRACT
        from engine.paper_redis import NativeCache
        from tests.engine.test_partial_entry_protection import replay

        with tempfile.TemporaryDirectory(prefix="native-cache-check-") as directory:
            output = Path(directory)
            identity = "a" * 64
            cache = NativeCache(output, identity, ACCOUNT_CONTRACT["trader_id"])
            try:
                (output / "events.jsonl").write_bytes(b"")
                cache.snapshot(None, {"phase": "native-platform-check"})
            finally:
                cache.close()
            cache = NativeCache(output, identity, ACCOUNT_CONTRACT["trader_id"])
            try:
                assert cache.state() == {"phase": "native-platform-check"}
            finally:
                cache.close()
        args.output.mkdir(parents=True, exist_ok=True)
        audit = replay(args.output / "reports")
        assert audit["passed"], audit
        (args.output / "audit.json").write_text(json.dumps(audit, indent=2) + "\n")
        print(f"Native {args.arch} Redis snapshot/reload and bracket replay passed")


if __name__ == "__main__":
    main()
