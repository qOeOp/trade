"""Load one published, complete native strategy from verified external bytes."""

from __future__ import annotations

import hashlib
import importlib.util
import inspect
import json
import os
import re
import stat
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

from nautilus_trader.trading import Strategy


RUNTIME_CONTRACT = "r1-native-v2"
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


@dataclass(frozen=True)
class LoadedStrategy:
    source_path: Path
    source_sha256: str
    entry_class: str
    strategy_class: type[Strategy]
    binding: dict | None

    def metadata(self) -> dict:
        identity = {
            "strategy_source_sha256": self.source_sha256,
            "strategy_entry_class": self.entry_class,
            "strategy_runtime_contract": RUNTIME_CONTRACT,
            "strategy_source": {
                "path": str(self.source_path),
                "sha256": self.source_sha256,
                "entry_class": self.entry_class,
            },
        }
        if self.binding is not None:
            identity["strategy_binding"] = self.binding.copy()
        return identity


def _read_regular_file(path: Path) -> bytes:
    """Read through one descriptor; never follow a symlink at the file boundary."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        if not stat.S_ISREG(path.lstat().st_mode):
            raise ValueError(f"strategy source must be a regular file: {path}")
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ValueError(f"cannot read strategy source: {path}: {error}") from error
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError(f"strategy source must be a regular file: {path}")
        return stream.read()


def _binding(path: Path | None, source_sha256: str, entry_class: str) -> dict | None:
    if path is None:
        return None
    try:
        value = json.loads(_read_regular_file(path))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"strategy binding is not valid JSON: {path}") from error
    required = {
        "database", "commit", "strategy_id", "revision", "source_sha256",
        "entry_class", "runtime_contract",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError("strategy binding must contain the exact Dolt revision identity")
    for field in required - {"revision"}:
        if not isinstance(value[field], str) or not value[field].strip():
            raise ValueError(f"strategy binding has no valid {field}")
    if type(value["revision"]) is not int or value["revision"] < 1:
        raise ValueError("strategy binding revision must be a positive integer")
    if value["source_sha256"] != source_sha256:
        raise ValueError("strategy binding source hash differs from verified bytes")
    if value["entry_class"] != entry_class:
        raise ValueError("strategy binding entry class differs from selected class")
    if value["runtime_contract"] != RUNTIME_CONTRACT:
        raise ValueError("strategy binding runtime contract is unsupported")
    return value


def load_strategy(
    path: Path,
    entry_class: str,
    expected_sha256: str,
    binding_path: Path | None = None,
) -> LoadedStrategy:
    """Execute exactly hash-checked source bytes and resolve a native class.

    This verifies identity, not safety of arbitrary Python. The invoking sandbox
    or fixed runtime image supplies the execution boundary.
    """
    if not isinstance(expected_sha256, str) or not _SHA256.fullmatch(expected_sha256):
        raise ValueError("strategy SHA-256 must be 64 lowercase hexadecimal characters")
    if not entry_class.isidentifier():
        raise ValueError("strategy class must be one Python class name")
    source = _read_regular_file(path)
    actual_sha256 = hashlib.sha256(source).hexdigest()
    if actual_sha256 != expected_sha256:
        raise ValueError("strategy SHA-256 differs from the published source")
    binding = _binding(binding_path, actual_sha256, entry_class)
    source_path = path.resolve()
    module_name = f"_trade_strategy_{actual_sha256}"
    module = sys.modules.get(module_name)
    if module is None:
        module = ModuleType(module_name)
        module.__file__ = str(source_path)
        module.__package__ = ""
        module.__spec__ = importlib.util.spec_from_loader(module_name, loader=None)
        sys.modules[module_name] = module
        try:
            exec(compile(source, str(source_path), "exec"), module.__dict__)
        except BaseException:
            sys.modules.pop(module_name, None)
            raise
    strategy_class = getattr(module, entry_class, None)
    if (
        not inspect.isclass(strategy_class)
        or strategy_class is Strategy
        or not issubclass(strategy_class, Strategy)
        or strategy_class.__module__ != module_name
    ):
        raise ValueError("strategy entry class must be declared here and extend native Strategy")
    return LoadedStrategy(source_path, actual_sha256, entry_class, strategy_class, binding)
