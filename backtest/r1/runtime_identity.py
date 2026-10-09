"""Describe the executing image's native code and effective replay defaults."""

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys

from backtest.r1.run_portfolio import effective_configuration, parse_configuration, runtime_source_metadata


def inspect(runner_args=None):
    metadata = runtime_source_metadata()
    root = Path(__file__).resolve().parents[2]
    result = {
        "runtime_contract": "r1-native-v1",
        "nautilus_version": importlib.metadata.version("nautilus_trader"),
        "python_version": sys.version.split()[0],
        "dependency_lock_sha256": hashlib.sha256((root / "uv.lock").read_bytes()).hexdigest(),
        "source_files_sha256": {key: value for key, value in metadata.items() if key.endswith("_source_sha256")},
        "source_file_paths": metadata["source_file_paths"],
        "audit_source_sha256": hashlib.sha256((root / "backtest/r1/checks/audit_tiered_native.py").read_bytes()).hexdigest(),
    }
    if runner_args is not None:
        if not isinstance(runner_args, list) or any(not isinstance(value, str) for value in runner_args):
            raise ValueError("runner args must be a JSON string array")
        argv = list(runner_args)
        for option, value in (("--strategy-file", "/strategy/strategy.py"),
                              ("--strategy-class", "_Probe"),
                              ("--strategy-sha256", "0" * 64),
                              ("--output", "/reports")):
            if not any(item == option or item.startswith(option + "=") for item in argv):
                argv.extend((option, value))
        result["effective_config"] = effective_configuration(parse_configuration(argv))
        encoded = json.dumps(result["effective_config"], sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
        result["effective_config_sha256"] = hashlib.sha256(encoded).hexdigest()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runner-args-json")
    args = parser.parse_args()
    runner_args = json.loads(args.runner_args_json) if args.runner_args_json is not None else None
    print(json.dumps(inspect(runner_args), sort_keys=True))


if __name__ == "__main__":
    main()
