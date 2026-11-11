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
import json
from pathlib import Path
import re

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
RANDOM = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _csv_rows(path: Path) -> list[dict]:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8", newline="") as stream:
            return list(dict_reader(stream))
    with path.open(newline="", encoding="utf-8") as stream:
        return list(dict_reader(stream))


def _event_rows(path: Path) -> list[dict]:
    """The event history with each event's position in its own order's history."""
    seen: dict[str, int]
    rows, seen = [], {}
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            event = json.loads(line)
            identity = event["client_order_id"]
            seen[identity] = seen.get(identity, -1) + 1
            rows.append({**event, "seq": seen[identity]})
    return rows


def _text(row: dict) -> str:
    return json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _sha(lines: list[str]) -> str:
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def report_fingerprint(directory: Path) -> dict:
    """{table: {rows, sha256[, file_sha256]}} of one report directory; reads only."""
    directory = Path(directory)
    tables = {name: (_event_rows if name == "order_events" else _csv_rows)(directory / file)
              for name, (file, _) in TABLES.items()}
    texts = {name: [_text(row) for row in rows] for name, rows in tables.items()}
    numbers: dict[str, str] = {}
    for name in NUMBERING_ORDER:
        rows, found = tables[name], texts[name]
        if name == "order_events":
            # Orders by client order ID with its random part masked (a liquidation order's ID, and every ID of a
            # source using UUID client order IDs, is fresh every run), orders of one masked ID by the time of their
            # first event and their instrument, then by their whole masked event history (a stop and a target
            # submitted at one fill share a time), then each order's events in engine order. IDs without a random
            # part keep the plain ID order.
            first: dict[str, tuple] = {}
            history: dict[str, list[str]] = {}
            for row, text in zip(rows, found, strict=True):
                first.setdefault(row["client_order_id"], (row.get("ts_event"), row.get("instrument_id", "")))
                history.setdefault(row["client_order_id"], []).append(RANDOM.sub("~", text))
            walk = sorted(range(len(rows)), key=lambda index: (RANDOM.sub("~", rows[index]["client_order_id"]),
                                                               *first[rows[index]["client_order_id"]],
                                                               history[rows[index]["client_order_id"]],
                                                               rows[index]["seq"]))
        else:
            walk = sorted(range(len(rows)), key=lambda index: RANDOM.sub("~", found[index]))
        for index in walk:
            for match in RANDOM.finditer(found[index]):
                numbers.setdefault(match.group(0), f"#{len(numbers) + 1}")
    result = {}
    for name, (file, stable) in TABLES.items():
        lines = sorted(RANDOM.sub(lambda match: numbers[match.group(0)], text) for text in texts[name])
        entry = {"rows": len(lines), "sha256": _sha(lines)}
        if stable:
            entry["file_sha256"] = hashlib.sha256((directory / file).read_bytes()).hexdigest()
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
