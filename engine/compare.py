"""The semantic fingerprint of one run's native reports (engine.report_fingerprint).

It runs inside the runtime image as the replay's fingerprint stage, so the image digest is its
identity: ``python -m engine.compare --run REPORTS --output FILE`` reads the report directory and
writes only FILE. Two replays of the same run give the same fingerprint even though Nautilus draws
fresh UUIDs every run.

- Random identifiers (event, initialization, position-snapshot and settlement UUIDs) are renumbered
  in the order they first appear, walking the order event history first (orders by client order ID
  with any random part masked, orders of one masked ID by their first event's time and instrument,
  then by their whole event history with random parts masked, each order's events in engine order),
  then the other tables. A liquidation order's client order ID (``LIQUIDATION-<venue>-<uuid>``), and
  every client order ID of a source with ``use_uuid_client_order_ids``, is fresh every run, so its place
  in the walk comes from when it happened and what happened to it, not from the UUID; IDs without a
  random part walk in plain ID order as before. The same identifier gets the same
  number everywhere, so fills stay linked to positions and events to orders. Trade IDs
  (``T-<hex>-<n>``) are derived from the venue, the order and the execution counter in the pinned
  Nautilus, so they are kept as they are and an exchange of two executions shows.
- Every table is then sorted by all its columns, so rows of one timestamp, price and quantity
  cannot swap into a false difference. An order event carries its position in its order's history
  (``seq``), the causal order the auditor reads. Funding adjustments take part row by row inside the
  positions report.
- Each table gives its row count and a whole-table hash, so a mismatch names the table. The account,
  daily returns and exposures, stable byte for byte, also carry the hash of their file. Every table is
  required, the fill volumes included.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import heapq
import json
from pathlib import Path
import re
from typing import Iterator
import zlib

from engine.native_csv import dict_reader


# table: (file, file bytes are stable)
TABLES = {
    "orders": ("orders.csv", False),
    "fills": ("fills.csv", False),
    "positions": ("positions.csv", False),
    "account": ("account.csv", True),
    "returns_series": ("returns_series.csv", True),
    "order_events": ("order_events.jsonl.gz", False),
    "exposures": ("exposures.csv.gz", True),
    "fill_volumes": ("fill_volumes.csv", False),
}
# The walk that numbers random identifiers: the event history holds every order and fill event.
NUMBERING_ORDER = ("order_events", "orders", "fills", "positions", "account", "exposures", "returns_series",
                   "fill_volumes")
RUN_BYTES = 64 * 1024 * 1024  # renumbered lines held before they are sorted and compressed into a run
RANDOM = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _csv_rows(path: Path) -> Iterator[dict]:
    """A report's rows, one at a time."""
    with (gzip.open(path, "rt", encoding="utf-8", newline="") if path.suffix == ".gz"
          else path.open(newline="", encoding="utf-8")) as stream:
        yield from dict_reader(stream)


def _event_rows(path: Path) -> Iterator[dict]:
    """The event history, one event at a time, with each event's position in its own order's history."""
    seen: dict[str, int] = {}
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            event = json.loads(line)
            identity = event["client_order_id"]
            seen[identity] = seen.get(identity, -1) + 1
            yield {**event, "seq": seen[identity]}


def _text(row: dict) -> str:
    return json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _runs(lines: Iterator[bytes]) -> list[bytes]:
    """`lines` sorted in bounded memory: runs of at most RUN_BYTES, each sorted and kept zlib-compressed one line
    to a line (a JSON text holds no raw newline)."""
    runs: list[bytes] = []
    held: list[bytes] = []
    size = 0
    for line in lines:
        held.append(line)
        size += len(line)
        if size >= RUN_BYTES:
            held.sort()  # UTF-8 bytes sort as their text does
            runs.append(zlib.compress(b"".join(found + b"\n" for found in held), 1))
            held, size = [], 0
    if held:
        held.sort()
        runs.append(zlib.compress(b"".join(found + b"\n" for found in held), 1))
    return runs


def _read_run(run: bytes) -> Iterator[bytes]:
    decompressor, rest = zlib.decompressobj(), b""
    for start in range(0, len(run), 1 << 16):
        *lines, rest = (rest + decompressor.decompress(run[start:start + (1 << 16)])).split(b"\n")
        yield from lines
    if rest + decompressor.flush():
        raise ValueError("a sorted run ends inside a line")


def _hash(runs: list[bytes]) -> tuple[int, str]:
    """(rows, hash of the lines of `runs` in sorted order joined by newlines)."""
    rows, whole = 0, hashlib.sha256()
    for line in heapq.merge(*map(_read_run, runs)):
        if rows:
            whole.update(b"\n")
        whole.update(line)
        rows += 1
    return rows, whole.hexdigest()


def _file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def _numbering(directory: Path) -> dict[str, str]:
    """Each random identifier's number, by the walk of NUMBERING_ORDER. Only rows holding an identifier are
    kept, and as their masked text and identifiers: a stable sort orders them as it orders the whole table."""
    numbers: dict[str, str] = {}
    for name in NUMBERING_ORDER:
        path = directory / TABLES[name][0]
        if name == "order_events":
            # Orders by client order ID with its random part masked (a liquidation order's ID, and every ID of a
            # source using UUID client order IDs, is fresh every run), orders of one masked ID by the time of their
            # first event and their instrument, then by their whole masked event history (a stop and a target
            # submitted at one fill share a time), then each order's events in engine order. IDs without a random
            # part keep the plain ID order.
            first: dict[str, tuple] = {}
            history: dict[str, list[str]] = {}
            found: list[tuple[str, int, list[str]]] = []
            for row in _event_rows(path):
                text, identity = _text(row), row["client_order_id"]
                first.setdefault(identity, (row.get("ts_event"), row.get("instrument_id", "")))
                history.setdefault(identity, []).append(RANDOM.sub("~", text))
                found.append((identity, row["seq"], RANDOM.findall(text)))
            found.sort(key=lambda item: (RANDOM.sub("~", item[0]), *first[item[0]], history[item[0]], item[1]))
            walk = [identifiers for _, _, identifiers in found]
        else:
            kept = [(RANDOM.sub("~", text), identifiers) for text in map(_text, _csv_rows(path))
                    if (identifiers := RANDOM.findall(text))]
            kept.sort(key=lambda item: item[0])
            walk = [identifiers for _, identifiers in kept]
        for identifiers in walk:
            for identifier in identifiers:
                numbers.setdefault(identifier, f"#{len(numbers) + 1}")
    return numbers


def report_fingerprint(directory: Path) -> dict:
    """{table: {rows, sha256[, file_sha256]}} of one report directory; reads only.

    The reports are read row by row, twice: once to number the random identifiers, then one table at a time
    for its hash, whose renumbered lines are sorted in compressed runs of bounded size."""
    directory = Path(directory)
    numbers = _numbering(directory)
    result = {}
    for name, (file, stable) in TABLES.items():
        rows, whole = _hash(_runs(RANDOM.sub(lambda match: numbers[match.group(0)], _text(row)).encode("utf-8")
                                  for row in (_event_rows if name == "order_events" else _csv_rows)(directory / file)))
        entry = {"rows": rows, "sha256": whole}
        if stable:
            entry["file_sha256"] = _file_sha(directory / file)
        result[name] = entry
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--run", type=Path, required=True, help="the native report directory (read only)")
    parser.add_argument("--output", type=Path, required=True, help="the fingerprint JSON file to write")
    args = parser.parse_args()
    fingerprint = report_fingerprint(args.run)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as stream:
        json.dump(fingerprint, stream, sort_keys=True, indent=2)
        stream.write("\n")
