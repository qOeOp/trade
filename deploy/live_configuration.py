"""Shared, stdlib-only parsing of installed Live declarations and release snapshots."""

import json
import os
from pathlib import Path
import re
import stat

OPERATOR_FIELDS = frozenset({"root", "research_ledger", "research_at", "universe_file", "symbols",
                            "sources", "defaults", "memory", "market_root"})
DECLARATION = "live-deployment-v1"
CONTROL = "live-control-v1"
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


def declaration(path: Path) -> dict:
    value = read_object(path)
    if set(value) != OPERATOR_FIELDS | {"format"} or value["format"] != DECLARATION:
        raise RuntimeError("Live installation must declare operator inputs without runtime or socket")
    root = absolute(value["root"])
    if root.is_symlink() or root.resolve() != root or not root.is_dir() or root.stat().st_mode & 0o077:
        raise RuntimeError("Live installation must retain its existing private custody root")
    return value


def snapshot(path: Path, socket: Path) -> dict:
    value = read_object(path)
    if (set(value) != OPERATOR_FIELDS | {"format", "runtime", "socket"}
            or value["format"] != CONTROL or not isinstance(value["runtime"], str)
            or not RUNTIME.fullmatch(value["runtime"]) or value["socket"] != str(socket)):
        raise RuntimeError("Live configuration cache does not match its release")
    return value
