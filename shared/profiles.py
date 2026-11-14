"""The profile directory: one JSON file per research ledger or market directory, named after it.

`TRADE_LEDGER_HOME` overrides the directory for tests and rehearsals. Every profile says what it `holds` (research,
paper or market) and its lifecycle `kind` (active, isolated, temporary; null for a reader's profile). Ledger profiles are
read as `ledger.db.LedgerProfile`; market profiles are plain {name, holds: market, kind, root}.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import secrets
from typing import Literal, get_args

from shared.refusals import refuse


DEFAULT_HOME = Path.home() / ".local/share/trade/ledgers"
NAME = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")  # a profile's name, its file's stem
Kind = Literal["active", "isolated", "temporary"]  # a profile's lifecycle
KINDS: tuple[str, ...] = get_args(Kind)


def home() -> Path:
    return Path(os.environ.get("TRADE_LEDGER_HOME", DEFAULT_HOME)).expanduser()


def entries() -> dict[str, dict]:
    """Every readable profile in the directory, by file name stem; unreadable files are skipped."""
    directory = home()
    found: dict[str, dict] = {}
    for path in sorted(directory.glob("*.json")) if directory.is_dir() else ():
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(value, dict):
            found[path.stem] = value
    return found


def read_file(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise refuse("LEDGER_UNKNOWN", f"{path} is not a readable profile file", missing=(str(path),)) from exc
    if not isinstance(value, dict):
        raise refuse("LEDGER_UNKNOWN", f"{path} is not a profile", missing=(str(path),))
    return value


def new_file(name: str) -> Path:
    """The path of a profile `ledger init` or `market init` is to write: no file of that name exists, whatever it
    holds and whether or not it reads as a profile."""
    path = home() / f"{name}.json"
    if path.exists():
        raise refuse("PROFILE_EXISTS", f"profile file {path} already exists; nothing is replaced", missing=(name,))
    return path


def is_path(value: str) -> bool:
    """Whether a command's profile argument names a file rather than a profile name."""
    return "/" in value or value.endswith(".json")


def market(value: str | None) -> dict:
    """The market a command names: a profile file, a profile name, or the active one in the profile
    directory; its profile names the market directory (root)."""
    if value is not None and is_path(value):
        found = read_file(Path(value).expanduser())
    elif value is not None:
        found = read_file(home() / f"{value}.json")
    else:
        active = [entry for entry in entries().values() if entry.get("holds") == "market" and entry.get("kind") == "active"]
        if not active:
            raise refuse("LEDGER_UNKNOWN", "no active market profile in the ledger profile directory: make one with "
                                           "`market init` or pass --market", missing=("--market",))
        found = active[0]
    if found.get("holds") != "market" or not found.get("root"):
        raise refuse("LEDGER_KIND", f"profile {found.get('name')!r} is not a market", missing=("--market",))
    return found


def private_write(path: Path, value: dict) -> None:
    """Replace `path` atomically with `value` as JSON, readable by the owner only."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}")
    with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    os.replace(temporary, path)
