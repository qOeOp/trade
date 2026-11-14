"""Input identity (`registration.market_inputs`, `registration.export_fingerprint`,
`registration.load_lifecycle`, `registration.record_lifecycle`).

A replay's market inputs are exported AS OF one pinned market day into an immutable directory,
with a membership file holding only the exported instruments. Their identity is content, not
location: the export content hash covers what a replay reads and nothing else, so neither where and
when it was exported nor the market day it was exported at changes it while the window's data stays
the same, and the exporter hash the market adapter reports names the code that exported it, wherever it
ran (provenance only). Registration and replay each export once and compare the same identity. Nothing
here writes the ledger, drops an instrument, shortens a window or fills data.
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

from ledger import db, evidence
from shared.errors import Refusal
from shared.refusals import refuse
from registration import seams


MEMBERSHIP = "membership.json"
RECEIPT = "export.json"
LIFECYCLE = "lifecycle.json"
LIFECYCLE_EVIDENCE = "lifecycle-evidence/"  # the export's copy of the bundle: a replay reads no file of it
MINUTE = "1m"


def _encoded(value) -> bytes:
    return db.canonical_json(value).encode("utf-8")


def _invalid(message: str, item: str) -> Refusal:
    return refuse("EXPORT_CONTENT_INVALID", message, missing=(item,))


def _read_facts(name: str, data: bytes) -> bytes:
    """What a replay takes from a receipt or the membership file: the assumed fees and margins (engine.fee_model),
    each piece's lifecycle episode, the membership. The rest only checks or describes the data files."""
    try:
        value = json.loads(data.decode("utf-8"))
        if name == MEMBERSHIP:
            return _encoded(value["membership"])
        return _encoded({"assumed": value["assumed"], "episodes": [piece["episode"] for piece in value["pieces"]]})
    except (UnicodeDecodeError, ValueError, KeyError, TypeError) as exc:
        raise _invalid(f"{name} in the export root holds no replay facts", name) from exc


def export_fingerprint(inputs: Mapping, semantic: bool) -> dict:
    """{export_content_sha256} of the selected contracts' directories and the lifecycle evidence under the export
    root, plus the membership file: with `semantic` what a replay reads (the input identity), without it every byte
    of every file (a check that nothing changed during a replay). A cached export root is shared with other
    selections, so other contracts' directories in it are not part of the identity."""
    root, membership = Path(inputs["root"]), Path(inputs["membership_file"])
    if root.is_symlink() or not root.is_dir():
        raise _invalid(f"the export root {root} is a link or not a directory", str(root))
    if membership.is_symlink() or not membership.is_file():
        raise _invalid(f"the membership file {membership} is missing or a link", MEMBERSHIP)
    entries: list[tuple[str, Path]] = []
    for top in (*inputs["symbols"], LIFECYCLE_EVIDENCE.rstrip("/")):
        if (root / top).is_symlink():
            raise _invalid(f"{top} in the export root is a link", top)
        for directory, names, files in os.walk(root / top, followlinks=False):
            for name in sorted(names) + sorted(files):
                path = Path(directory) / name
                if path.is_symlink():
                    raise _invalid(f"{path.relative_to(root)} in the export root is a link",
                                   str(path.relative_to(root)))
            entries += [((Path(directory) / name).relative_to(root).as_posix(), Path(directory) / name)
                        for name in files if (Path(directory) / name).is_file()]
    entries.append((MEMBERSHIP, membership))
    total = hashlib.sha256()
    for name, path in sorted(entries, key=lambda item: item[0]):
        if semantic and name.startswith(LIFECYCLE_EVIDENCE):
            continue
        data = path.read_bytes()
        if semantic and Path(name).name in (RECEIPT, MEMBERSHIP):
            data = _read_facts(name, data)
        encoded = name.encode("utf-8")
        total.update(len(encoded).to_bytes(8, "big"))
        total.update(encoded)
        total.update(hashlib.sha256(data).digest())
    return {"export_content_sha256": total.hexdigest()}


def record_lifecycle(profile, market, at: str | None, manifest: Path, notices: list[Path], op_id: str | None = None) -> dict:
    """Write the lifecycle evidence bundle lifecycle-<market_day> of one market day: the manifest
    (lifecycle.json, native-lifecycle-v1) with the exchange notices it cites as sources, validated
    by market.validate_lifecycle against the market day before anything is written. The bundle is
    immutable; a correction is a new market day's bundle."""
    adapter = seams.current.market(market)
    market_day = adapter.resolve_day(at)
    data = _regular_bytes(Path(manifest), LIFECYCLE)
    files = {LIFECYCLE: data}
    for path in notices or ():
        path = Path(path)
        if path.name in files:
            raise refuse("LIFECYCLE_INPUT", f"two sources are named {path.name}", missing=(path.name,))
        files[path.name] = _regular_bytes(path, path.name)
    try:
        body = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise refuse("LIFECYCLE_INPUT", f"{manifest} is not JSON", missing=(LIFECYCLE,)) from exc
    episodes = adapter.validate_lifecycle(body, market_day, files)
    bundle = f"lifecycle-{market_day}"
    digests = evidence.digests(files)
    with db.connect(profile, "writer") as conn:
        written = db.write(conn, "record_lifecycle", {"bundle": bundle, "files": digests}, "evidence_bundle",
                           lambda c, op: evidence.write_files(c, bundle, files, kind="lifecycle", op_id=op), op_id=op_id)
    return {"bundle": bundle, "market_day": market_day, "files": digests,
            "episodes": {symbol: len(found) for symbol, found in episodes.items()},
            "write_status": written["write_status"], "ledger_commit": written["commit"]}


def _regular_bytes(path: Path, name: str) -> bytes:
    if path.is_symlink() or not path.is_file():
        raise refuse("LIFECYCLE_INPUT", f"{path} is missing, a link or not a regular file", missing=(name,))
    return path.read_bytes()


def cleanup(inputs: Mapping | None) -> None:
    """Remove what market_inputs created: the membership directory, and a fresh export root."""
    if not inputs:
        return
    if inputs.get("membership_file"):
        shutil.rmtree(Path(inputs["membership_file"]).parent, ignore_errors=True)
    if inputs.get("fresh") and inputs.get("root"):
        shutil.rmtree(inputs["root"], ignore_errors=True)


def load_lifecycle(profile: db.LedgerProfile, bundle: str, market_day: str, *, market) -> tuple[dict, dict[str, bytes]]:
    """(episodes, files) of the lifecycle evidence bundle lifecycle-<market_day>, validated against the
    pinned market day.

    `profile` is the research ledger profile; `market` the market adapter whose validate_lifecycle
    checks the manifest.
    """
    if bundle != f"lifecycle-{market_day}":  # the market command writes lifecycle-<market_day> for each market day
        raise refuse("LIFECYCLE_INPUT", f"{bundle!r} is not the lifecycle bundle lifecycle-{market_day} of the pinned "
                                        "market day", missing=(str(bundle),), expected=f"lifecycle-{market_day}")
    try:
        with db.connect(profile, "reader") as conn:
            loaded = evidence.load_bundle(conn, bundle)
    except Refusal as exc:
        if exc.code in ("UNKNOWN_BUNDLE", "LEDGER_CORRUPT", "INVALID_BUNDLE_NAME"):
            raise refuse("LIFECYCLE_INPUT", f"lifecycle bundle {bundle!r} is unreadable ({exc.code})",
                         missing=(str(bundle),)) from exc
        raise
    files = loaded["files"]
    if LIFECYCLE not in files:
        raise refuse("LIFECYCLE_INPUT", f"{bundle} holds no {LIFECYCLE}", missing=(f"{bundle}/{LIFECYCLE}",))
    try:
        body = json.loads(files[LIFECYCLE].decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise refuse("LIFECYCLE_INPUT", f"{bundle}/{LIFECYCLE} is not JSON", missing=(f"{bundle}/{LIFECYCLE}",)) from exc
    return market.validate_lifecycle(body, market_day, files), dict(files)


def _intersects(intervals, start: int, end: int) -> bool:
    return any(lo < end and start < hi for lo, hi in intervals)


def _clipped(intervals, start: int, end: int) -> list[list[int]]:
    return [[max(lo, start), min(hi, end)] for lo, hi in intervals if lo < end and start < hi]


def market_inputs(market, at: str | None, window: Mapping, selection: Mapping, lifecycle_bundle: str | None,
                  fresh: bool, research=None, *, include_quotes: bool = True, include_trades: bool = False,
                  include_metrics: bool = False) -> dict:
    """Export the inputs of one replay AS OF the pinned market day and assemble their identity.

    `market` is the market profile (the seam turns it into an adapter); `window` holds start,
    trade_start and end in UTC nanoseconds; `selection` is {"universe": True} or {"symbols": [...]}.
    Returns {identity, root, membership_file, symbols, fresh}; the membership path handed to the strategy is the
    membership file, cut to the input window. The export receipts stay under root (<symbol>/RECEIPT).
    """
    universe = isinstance(selection, Mapping) and selection.get("universe") is True
    symbols = selection.get("symbols") if isinstance(selection, Mapping) else None
    if (not isinstance(selection, Mapping) or set(selection) - {"universe", "symbols"} or universe == (symbols is not None)
            or (symbols is not None and (not isinstance(symbols, list) or not symbols
                                         or any(not isinstance(item, str) or not item for item in symbols)
                                         or len(set(symbols)) != len(symbols)))):
        raise refuse("SYMBOL_SELECTION_INVALID", "give exactly one of universe or symbols, without repeats",
                     expected='{"universe": true} or {"symbols": [unique names]}')
    adapter = seams.current.market(market)
    market_day = adapter.resolve_day(at)
    rule = adapter.universe_rule(market_day)
    if not adapter.universe_month(market_day):
        raise refuse("UNIVERSE_EMPTY", f"market day {market_day} has no universe members", missing=(market_day,))
    path = adapter.membership_path(market_day, window["end"])["membership"]
    if universe:
        symbols = sorted(symbol for symbol, intervals in path.items()
                         if _intersects(intervals, window["trade_start"], window["end"]))
        if not symbols:
            raise refuse("UNIVERSE_EMPTY", f"no member of {market_day} intersects the trading window", missing=(market_day,))
    episodes, lifecycle_files = None, None
    if lifecycle_bundle is not None:
        episodes, lifecycle_files = load_lifecycle(research, lifecycle_bundle, market_day, market=adapter)
    assert symbols is not None  # the selection check above refused a selection without universe or symbols
    exported = adapter.export_catalogs(market_day, list(symbols), window["start"], window["end"], episodes,
                                       lifecycle_files, fresh, include_quotes=include_quotes,
                                       include_trades=include_trades, include_metrics=include_metrics)
    inputs = {"root": Path(exported["root"]), "fresh": fresh, "symbols": list(symbols)}
    try:
        receipts = exported["receipts"]
        for symbol in symbols:
            if (receipts.get(symbol) or {}).get("timeframe") != MINUTE:
                raise refuse("EXPORT_TIMEFRAME", f"the export receipt of {symbol} is not of 1-minute bars",
                             missing=(symbol,), expected=MINUTE)
        membership = {symbol: [list(interval) for interval in path.get(symbol, [])] for symbol in symbols}
        membership_file = Path(tempfile.mkdtemp(prefix="registration-inputs-")) / MEMBERSHIP
        inputs["membership_file"] = membership_file
        # The file a strategy reads holds the input window only: what lies outside it changes with the market day.
        membership_file.write_bytes(_encoded({"market_day": market_day, "universe_rule": rule, "membership": {
            symbol: _clipped(intervals, window["start"], window["end"]) for symbol, intervals in membership.items()}}))
        fingerprint = export_fingerprint(inputs, semantic=True)
    except BaseException:
        cleanup(inputs)
        raise
    inputs = {"root": inputs["root"], "membership_file": inputs["membership_file"]}
    chosen: dict[str, bool | list[str]] = {"universe": True} if universe else {"symbols": list(symbols)}
    identity = {"market_database": adapter.database, "market_day": market_day, "universe_rule": rule,
                "selection": chosen, "symbols": list(symbols), **fingerprint}
    if lifecycle_bundle is not None:
        identity["lifecycle_bundle"] = lifecycle_bundle
    return {"identity": identity, **inputs, "symbols": list(symbols), "fresh": fresh}
