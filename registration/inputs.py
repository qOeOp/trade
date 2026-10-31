"""Input identity (`registration.market_inputs`, `registration.export_fingerprint`,
`registration.load_lifecycle`, `registration.record_lifecycle`).

A replay's market inputs are exported AS OF one pinned market commit into an immutable directory,
with a membership file holding only the exported instruments. Their identity is content, not
location: the export content hash ignores where and when it was exported, and the exporter hash
the market adapter reports names the code that exported it, wherever it ran (provenance only:
input_key does not compare it). Registration and replay each export once and compare the same
identity. Nothing here writes the ledger, drops an instrument, shortens a window or fills data.
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
from ledger.errors import Refusal
from ledger.refusals import refuse
from registration import seams


MEMBERSHIP = "membership.json"
RECEIPT = "export.json"
LIFECYCLE = "lifecycle.json"
MINUTE = "1m"


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _semantic(data: bytes) -> bytes:
    try:
        receipt = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return data
    if isinstance(receipt, dict):
        receipt.pop("seconds", None)  # receipts of older exporters (a supply not yet updated too) carry their wall time
    return _canonical(receipt)


def _invalid(message: str, item: str) -> Refusal:
    return refuse("EXPORT_CONTENT_INVALID", message, missing=(item,))


def export_fingerprint(inputs: Mapping, semantic: bool) -> dict:
    """{export_content_sha256} of the export root plus the membership file."""
    root, membership = Path(inputs["root"]), Path(inputs["membership_file"])
    if root.is_symlink() or not root.is_dir():
        raise _invalid(f"the export root {root} is a link or not a directory", str(root))
    if membership.is_symlink() or not membership.is_file():
        raise _invalid(f"the membership file {membership} is missing or a link", MEMBERSHIP)
    entries: list[tuple[str, Path]] = []
    for directory, names, files in os.walk(root, followlinks=False):
        for name in sorted(names) + sorted(files):
            path = Path(directory) / name
            if path.is_symlink():
                raise _invalid(f"{path.relative_to(root)} in the export root is a link", str(path.relative_to(root)))
        entries += [((Path(directory) / name).relative_to(root).as_posix(), Path(directory) / name)
                    for name in files if (Path(directory) / name).is_file()]
    entries.append((MEMBERSHIP, membership))
    total = hashlib.sha256()
    for name, path in sorted(entries, key=lambda item: item[0]):
        data = path.read_bytes()
        if semantic and Path(name).name == RECEIPT:
            data = _semantic(data)
        encoded = name.encode("utf-8")
        total.update(len(encoded).to_bytes(8, "big"))
        total.update(encoded)
        total.update(hashlib.sha256(data).digest())
    return {"export_content_sha256": total.hexdigest()}


def record_lifecycle(profile, market, at: str | None, manifest: Path, notices: list[Path], op_id: str | None = None) -> dict:
    """Write the lifecycle evidence bundle lifecycle-<commit> of one market commit: the manifest
    (lifecycle.json, native-lifecycle-v1) with the exchange notices it cites as sources, validated
    by market.validate_lifecycle against the commit before anything is written. The bundle is
    immutable; a correction is a new market commit's bundle."""
    adapter = seams.current.market(market)
    commit = adapter.resolve_commit(at)
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
    episodes = adapter.validate_lifecycle(body, commit, files)
    bundle = f"lifecycle-{commit}"
    digests = evidence.digests(files)
    if isinstance(profile, str):
        profile = db.load_profile(profile)
    with db.connect(profile, "writer") as conn:
        written = db.write(conn, "record_lifecycle", {"bundle": bundle, "files": digests}, "evidence_bundle",
                           lambda c, op: evidence.write_files(c, bundle, files, op), op_id=op_id)
    return {"bundle": bundle, "market_commit": commit, "files": digests,
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
    if (inputs.get("fresh") or inputs.get("temporary")) and inputs.get("root"):
        shutil.rmtree(inputs["root"], ignore_errors=True)


def load_lifecycle(profile, bundle: str, commit: str, *, market=None) -> tuple[dict, dict[str, bytes]]:
    """(episodes, files) of the lifecycle evidence bundle lifecycle-<commit>, validated against the
    pinned market commit.

    `profile` is the research ledger profile (or its name); `market` the market adapter whose
    validate_lifecycle checks the manifest (default: the seam's adapter for no profile).
    """
    if bundle != f"lifecycle-{commit}":  # the market command writes lifecycle-<market_commit> for each commit
        raise refuse("LIFECYCLE_INPUT", f"{bundle!r} is not the lifecycle bundle lifecycle-{commit} of the pinned "
                                        "market commit", missing=(str(bundle),), expected=f"lifecycle-{commit}")
    if isinstance(profile, str):
        profile = db.load_profile(profile)
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
    validate = market.validate_lifecycle if market is not None else seams.validate_lifecycle
    try:
        episodes = validate(body, commit, files)
    except Refusal as exc:
        if exc.code == "LIFECYCLE_INPUT":
            raise
        raise refuse("LIFECYCLE_INPUT", f"{bundle} does not validate ({exc.code}): {exc.message}",
                     missing=(str(bundle),)) from exc
    return episodes, dict(files)


def _intersects(intervals, start: int, end: int) -> bool:
    return any(lo < end and start < hi for lo, hi in intervals)


def market_inputs(market, at: str | None, window: Mapping, selection: Mapping, lifecycle_bundle: str | None,
                  fresh: bool, research=None, *, include_quotes: bool = True, include_trades: bool = False,
                  include_metrics: bool = False) -> dict:
    """Export the inputs of one replay AS OF the pinned market commit and assemble their identity.

    `market` is the market profile (the seam turns it into an adapter); `window` holds start,
    trade_start and end in UTC nanoseconds; `selection` is {"universe": True} or {"symbols": [...]}.
    Returns {identity, root, membership_file, symbols, receipts, exported{exported, reused},
    fresh}; `identity` also holds the membership path handed to the strategy.
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
    commit = adapter.resolve_commit(at)
    rule = adapter.universe_rule(commit)
    if not adapter.universe_month(commit):
        raise refuse("UNIVERSE_EMPTY", f"market commit {commit} has no universe members", missing=(commit,))
    path = adapter.membership_path(commit, window["end"])["membership"]
    if universe:
        symbols = sorted(symbol for symbol, intervals in path.items()
                         if _intersects(intervals, window["trade_start"], window["end"]))
        if not symbols:
            raise refuse("UNIVERSE_EMPTY", f"no member of {commit} intersects the trading window", missing=(commit,))
    episodes, lifecycle_files = None, None
    if lifecycle_bundle is not None:
        episodes, lifecycle_files = load_lifecycle(research, lifecycle_bundle, commit, market=adapter)
    assert symbols is not None  # the selection check above refused a selection without universe or symbols
    exported = adapter.export_catalogs(commit, list(symbols), window["start"], window["end"], episodes,
                                       lifecycle_files, fresh, include_quotes=include_quotes,
                                       include_trades=include_trades, include_metrics=include_metrics)
    inputs = {"root": Path(exported["root"]), "fresh": fresh, "temporary": exported.get("temporary", False)}
    try:
        receipts = exported["receipts"]
        for symbol in symbols:
            if (receipts.get(symbol) or {}).get("timeframe") != MINUTE:
                raise refuse("EXPORT_TIMEFRAME", f"the export receipt of {symbol} is not of 1-minute bars",
                             missing=(symbol,), expected=MINUTE)
        membership = {symbol: [list(interval) for interval in path.get(symbol, [])] for symbol in symbols}
        membership_file = Path(tempfile.mkdtemp(prefix="registration-inputs-")) / MEMBERSHIP
        inputs["membership_file"] = membership_file
        membership_file.write_bytes(_canonical({"commit": commit, "universe_rule": rule, "membership": membership}))
        fingerprint = {**export_fingerprint(inputs, semantic=True),
                       "exporter_source_sha256": exported["exporter_source_sha256"]}
    except BaseException:
        cleanup(inputs)
        raise
    inputs = {"root": inputs["root"], "membership_file": inputs["membership_file"]}
    chosen: dict[str, bool | list[str]] = {"universe": True} if universe else {"symbols": list(symbols)}
    identity = {"market_database": adapter.database, "market_commit": commit, "universe_rule": rule,
                "selection": chosen, "symbols": list(symbols), "membership": membership, **fingerprint}
    if lifecycle_bundle is not None:
        identity["lifecycle_bundle"] = lifecycle_bundle
    return {"identity": identity, **inputs, "symbols": list(symbols), "receipts": receipts,
            "exported": {key: exported.get(key) for key in ("exported", "reused")}, "fresh": fresh,
            "temporary": exported.get("temporary", False)}
