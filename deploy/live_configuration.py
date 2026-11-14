"""Shared, stdlib-only parsing of the Live control snapshots a release writes."""

import json
import os
from pathlib import Path
import re
import stat

# What every release host gives its controls: the custody root and research reader, both fixed under the release
# state, and the market directory the Web reads. A snapshot adds the release's runtime digest and the control's socket.
HOST_FIELDS = frozenset({"root", "research_ledger", "market_root"})
CONTROL = "live-control-v2"
ROOT = "live-root"  # beside live/, whose revision directories pruning removes
READER = "profiles/research.json"  # the reader profile every release tick writes (deploy/release_host.py)
RUNTIME = re.compile(r"ghcr\.io/qoeop/trade-runtime@sha256:[0-9a-f]{64}\Z")


def _pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate Live configuration field")
        value[key] = item
    return value


def read_object(path: Path) -> dict:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "r") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise RuntimeError("Live deployment configuration is not a regular file")
        value = json.load(stream, object_pairs_hook=_pairs)
    if not isinstance(value, dict):
        raise RuntimeError("Live deployment configuration is not an object")
    return value


def absolute(value) -> Path:
    if not isinstance(value, str) or not Path(value).is_absolute() or "," in value:
        raise RuntimeError("Live deployment inputs need explicit absolute bind paths")
    return Path(value)


def snapshot(path: Path, socket: Path) -> dict:
    """The snapshot at `<state>/live/<revision>/configuration.json`; its root and reader are that state's own."""
    value = read_object(path)
    state = path.parents[2]
    if (set(value) != HOST_FIELDS | {"format", "runtime", "socket"}
            or value["format"] != CONTROL or not isinstance(value["runtime"], str)
            or not RUNTIME.fullmatch(value["runtime"]) or value["socket"] != str(socket)
            or value["root"] != str(state / ROOT) or value["research_ledger"] != str(state / READER)):
        raise RuntimeError("Live configuration cache does not match its release")
    absolute(value["market_root"])
    return value
