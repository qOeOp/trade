"""The semantic fingerprint of one run's native reports (engine.report_fingerprint).

It runs inside the runtime image as the replay's fingerprint stage, so the image digest is its
identity: ``python -m engine.compare --run REPORTS --output FILE`` reads the report directory and
writes only FILE. Two replays of the same run give the same fingerprint even though Nautilus draws
fresh UUIDs every run.

- Random identifiers (event, initialization, position-snapshot and settlement UUIDs) are renumbered
  in the order they first appear, walking the order event history first (orders by client order ID,
  each order's events in engine order), then the other tables. The same identifier gets the same
  number everywhere, so fills stay linked to positions and events to orders. Trade IDs
  (``T-<hex>-<n>``) are derived from the venue, the order and the execution counter in the pinned
  Nautilus, so they are kept as they are and an exchange of two executions shows.
- Every table is then sorted by all its columns, so rows of one timestamp, price and quantity
  cannot swap into a false difference. An order event carries its position in its order's history
  (``seq``), the causal order the auditor reads. Funding adjustments take part row by row inside the
  positions report.
- Each table gives its row count, a whole-table hash and one hash per UTC day of its time column,
  so a mismatch names the table and day. The account, daily returns and exposures, stable byte for
  byte, also carry the hash of their file.
"""

from __future__ import annotations

import argparse
import csv
from datetime import UTC, datetime
import gzip
import hashlib
import json
from pathlib import Path
import re


# table: (file, time column, file bytes are stable)
TABLES = {
    "orders": ("orders.csv", "ts_init", False),
    "fills": ("fills.csv", "ts_event", False),
    "positions": ("positions.csv", "ts_opened", False),
    "account": ("account.csv", "ts_event", True),
    "returns_series": ("returns_series.csv", "ts_event_ns", True),
    "order_events": ("order_events.jsonl.gz", "ts_event", False),
    "exposures": ("exposures.csv.gz", "ts_event_ns", True),
}
# The walk that numbers random identifiers: the event history holds every order and fill event.
NUMBERING_ORDER = ("order_events", "orders", "fills", "positions", "account", "exposures", "returns_series")
RANDOM = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _csv_rows(path: Path) -> list[dict]:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8", newline="") as stream:
            return list(csv.DictReader(stream))
    with path.open(newline="", encoding="utf-8") as stream:
        return list(csv.DictReader(stream))


def _event_rows(path: Path) -> list[dict]:
    """The event history with each event's position in its own order's history."""
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


def _day(value) -> str:
    """The UTC day of a time cell: integer nanoseconds or an ISO-8601 datetime with an explicit UTC
    offset; '' when empty. A datetime without an offset is refused, never read in the host time zone."""
    if value in (None, ""):
        return ""
    text = str(value)
    if text.lstrip("-").isdigit():
        return datetime.fromtimestamp(int(text) // 10**9, UTC).date().isoformat()
    moment = datetime.fromisoformat(text)
    if moment.utcoffset() is None:
        raise ValueError(f"time {text!r} has no UTC offset")
    return moment.astimezone(UTC).date().isoformat()


def _sha(lines: list[str]) -> str:
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def report_fingerprint(directory: Path) -> dict:
    """{table: {rows, sha256, by_utc_day: {day: sha256}[, file_sha256]}} of one report directory; reads only."""
    directory = Path(directory)
    tables = {name: (_event_rows if name == "order_events" else _csv_rows)(directory / file)
              for name, (file, _, _) in TABLES.items()}
    texts = {name: [_text(row) for row in rows] for name, rows in tables.items()}
    numbers: dict[str, str] = {}
    for name in NUMBERING_ORDER:
        rows, found = tables[name], texts[name]
        walk = (sorted(range(len(rows)), key=lambda index: (rows[index]["client_order_id"], rows[index]["seq"]))
                if name == "order_events" else sorted(range(len(rows)), key=lambda index: RANDOM.sub("~", found[index])))
        for index in walk:
            for match in RANDOM.finditer(found[index]):
                numbers.setdefault(match.group(0), f"#{len(numbers) + 1}")
    result = {}
    for name, (file, column, stable) in TABLES.items():
        lines = sorted(((_day(row.get(column)), RANDOM.sub(lambda match: numbers[match.group(0)], text))
                        for row, text in zip(tables[name], texts[name])), key=lambda item: item[1])
        days: dict[str, list[str]] = {}
        for day, line in lines:
            days.setdefault(day, []).append(line)
        entry = {"rows": len(lines), "sha256": _sha([line for _, line in lines]),
                 "by_utc_day": {day: _sha(found) for day, found in sorted(days.items())}}
        if stable:
            entry["file_sha256"] = hashlib.sha256((directory / file).read_bytes()).hexdigest()
        result[name] = entry
    return result


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--run", type=Path, required=True, help="the native report directory (read only)")
    parser.add_argument("--output", type=Path, required=True, help="the fingerprint JSON file to write")
    args = parser.parse_args(argv)
    fingerprint = report_fingerprint(args.run)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as stream:
        json.dump(fingerprint, stream, sort_keys=True, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
