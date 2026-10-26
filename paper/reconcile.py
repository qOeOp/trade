"""Paper reconciliation (`paper.reconcile`): a sealed paper run replayed on the archive and compared order by order.

The replay takes everything from the run's declaration and capture (its source, image, contracts and the
interval its runner received bars for) and only the market commit from the caller; it is no trial and
writes nothing to the ledger (user decision 2026-10-26). Its reports and the comparison, reconcile.json,
stay in a new temporary directory (docs/plans/paper-trading-design.zh.md §5, step 7).

Each side's fills are taken per order (a market order may fill in pieces) and paired per contract, side and
order role in time order. The first pair or lone fill that differs after a contract's previous agreeing
fill is classed by the evidence since that fill: a live bar missing, a live bar differing from the archive,
or neither, which for a replay-only fill marks it a look-ahead suspect. Once the two paths part, the
positions they trade from differ, so each later difference up to the next agreeing fill is a consequence
of that first one.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
import csv
from datetime import datetime, timezone
from decimal import Decimal
import gzip
import json
from pathlib import Path

from ledger import db, paper as records, paths, strategies
from ledger.refusals import refuse


FORMAT = "paper-reconcile@2026-10-26"
MINUTE_NS = 60 * 10**9
ON_TIME_NS = MINUTE_NS  # a fill within one bar of its counterpart is on time
PAIR_NS = 10 * MINUTE_NS  # an uncalibrated example value: fills further apart are different trades
LISTED = 50  # bars listed per contract and kind; the counts are complete
ROLES = {"ENTRY": "entry", "STOP_LOSS": "stop", "TAKE_PROFIT": "target"}
BAR_FIELDS = ("open", "high", "low", "close", "volume")


def _utc(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _amount(value) -> Decimal | None:
    """A Nautilus amount ("0.25 USDT", "0.25") as a Decimal."""
    if value is None or value == "":
        return None
    return Decimal(str(value).split()[0])


def symbol_of(instrument_id: str) -> str:
    return instrument_id.split("-", 1)[0]


def window(lines: list[dict], seal: Mapping) -> tuple[int, int]:
    """[start, end) of the bars the run's runner received: from its input start to the minute it stopped."""
    started = next((line for line in lines if line["kind"] == "started"), None)
    stopped = seal.get("stopped_ns")
    if not started or not isinstance(started.get("input_start_ns"), int) or not isinstance(stopped, int):
        raise refuse("PAPER_RECONCILE_EMPTY", "the run's capture has no input start or no stop time",
                     missing=("started", "stopped_ns"))
    start, end = started["input_start_ns"], stopped - stopped % MINUTE_NS
    if end <= start:
        raise refuse("PAPER_RECONCILE_EMPTY", f"the run stopped at {_utc(stopped)}, before its first bar closed",
                     missing=("bars",))
    return start, end


def orders(events: Iterable[Mapping]) -> list[dict]:
    """Each filled order as one fill: {order, instrument, side, role, ts_ns (its first fill), qty, px (the
    quantity-weighted price), commission}, by time."""
    roles: dict[str | None, str] = {}
    found: dict[str | None, dict] = {}
    for event in events:
        order = event.get("client_order_id")
        if event.get("type") == "OrderInitialized":
            tags = event.get("tags") or []
            roles[order] = next((ROLES[tag] for tag in tags if tag in ROLES), (tags[0] if tags else "other").lower())
        if event.get("type") != "OrderFilled":
            continue
        qty, px = _amount(event.get("last_qty")), _amount(event.get("last_px"))
        assert qty is not None and px is not None, "a Nautilus OrderFilled always carries last_qty and last_px"
        item = found.setdefault(order, {"order": order, "instrument": event.get("instrument_id"),
                                        "side": event.get("order_side"), "ts_ns": event.get("ts_event"),
                                        "qty": Decimal(0), "notional": Decimal(0), "commission": Decimal(0)})
        item["qty"] += qty
        item["notional"] += qty * px
        item["commission"] += _amount(event.get("commission")) or Decimal(0)
    result = []
    for item in found.values():
        notional = item.pop("notional")
        result.append({**item, "role": roles.get(item["order"], "other"), "px": notional / item["qty"]})
    return sorted(result, key=lambda item: (item["ts_ns"], item["order"]))


def pair(paper: list[dict], replay: list[dict]) -> list[tuple[dict | None, dict | None]]:
    """Paper and replay fills paired per contract, side and role, each with the nearest unpaired one within
    PAIR_NS (earlier first); the rest stand alone."""
    taken: set[int] = set()
    pairs: list[tuple[dict | None, dict | None]] = []
    for mine in paper:
        near = [(abs(other["ts_ns"] - mine["ts_ns"]), i) for i, other in enumerate(replay) if i not in taken
                and (other["instrument"], other["side"], other["role"]) == (mine["instrument"], mine["side"], mine["role"])
                and abs(other["ts_ns"] - mine["ts_ns"]) <= PAIR_NS]
        if near:
            i = min(near)[1]
            taken.add(i)
            pairs.append((mine, replay[i]))
        else:
            pairs.append((mine, None))
    pairs += [(None, other) for i, other in enumerate(replay) if i not in taken]
    # By the earlier side, so a contract's first difference comes before what follows from it.
    return sorted(pairs, key=lambda p: min((fill["ts_ns"], fill["order"]) for fill in p if fill))


def bars(lines: list[dict], archive: Mapping[str, list[list]], start: int, end: int) -> dict[str, dict]:
    """Per contract, the live bars against the archive's: {missing: closes of archive bars no live bar
    matched, differing: {close: {field: [live, archive]}}, live_only, late}."""
    live: dict[str, dict[int, dict]] = {}
    late: dict[str, int] = {}
    for line in lines:
        if line["kind"] == "bar" and start < line["ts_event"] <= end:
            live.setdefault(symbol_of(line["instrument_id"]), {})[line["ts_event"]] = line
        elif line["kind"] == "late_bar":
            symbol = symbol_of(line.get("instrument_id") or "")
            late[symbol] = late.get(symbol, 0) + 1
    result = {}
    for symbol, rows in archive.items():
        stored = {row[1] * 10**6: dict(zip(BAR_FIELDS, row[2:7], strict=True)) for row in rows}
        mine = live.get(symbol, {})
        differing = {}
        for close, bar in stored.items():
            if close in mine:
                fields = {name: [mine[close][name], bar[name]] for name in BAR_FIELDS
                          if Decimal(mine[close][name]) != Decimal(bar[name])}
                if fields:
                    differing[close] = fields
        result[symbol] = {"archive": len(stored), "live": len(mine), "late": late.get(symbol, 0),
                          "missing": sorted(set(stored) - set(mine)), "live_only": sorted(set(mine) - set(stored)),
                          "differing": differing}
    return result


def _evidence(found: Mapping, since: int, until: int) -> dict:
    missing = [close for close in found["missing"] if since < close <= until]
    differing = [close for close in found["differing"] if since < close <= until]
    return {"missing_bars": len(missing), "differing_bars": len(differing),
            "first": _utc(min(missing + differing)) if missing or differing else None}


def _side(fill: dict | None) -> dict | None:
    if fill is None:
        return None
    return {"order": fill["order"], "ts": _utc(fill["ts_ns"]), "ts_ns": fill["ts_ns"], "qty": str(fill["qty"]),
            "px": format(fill["px"].normalize(), "f"), "commission": str(fill["commission"])}


def classify(pairs: list[tuple[dict | None, dict | None]], found: Mapping[str, dict], start: int, end: int) -> list[dict]:
    """Each pair with its class (same, price, quantity, time, paper_only, replay_only) and, when not the
    same, its cause. The first difference since the contract's previous agreeing fill takes it from the bars
    since then: live_gap, bar_mismatch, window_end (a lone fill in the last minute) or unexplained (for a
    replay-only fill, a look-ahead suspect). Each later one is a consequence that follows it."""
    agreed: dict[str, int] = {}
    parted: dict[str, int] = {}  # the contract's first difference since its previous agreeing fill
    result = []
    for paper, replay in pairs:
        either = paper or replay
        assert either is not None
        symbol = symbol_of(either["instrument"])
        if paper is None or replay is None:
            kind = "paper_only" if replay is None else "replay_only"
        elif abs(paper["ts_ns"] - replay["ts_ns"]) > ON_TIME_NS:
            kind = "time"
        elif paper["qty"] != replay["qty"]:
            kind = "quantity"
        elif paper["px"] != replay["px"]:
            kind = "price"
        else:
            kind = "same"
        item = {"class": kind, "instrument": either["instrument"], "side": either["side"], "role": either["role"],
                "paper": _side(paper), "replay": _side(replay)}
        if paper and replay:
            item["delay_ms"] = (paper["ts_ns"] - replay["ts_ns"]) // 10**6
            item["price_bps"] = float((paper["px"] - replay["px"]) / replay["px"] * 10_000)
        if kind == "same":
            agreed[symbol] = either["ts_ns"]
            parted.pop(symbol, None)
        elif symbol in parted:
            item |= {"cause": "consequence", "follows": _utc(parted[symbol]), "look_ahead_suspect": False}
        else:
            parted[symbol] = min(fill["ts_ns"] for fill in (paper, replay) if fill)
            until = max(fill["ts_ns"] for fill in (paper, replay) if fill)
            evidence = _evidence(found.get(symbol) or {"missing": [], "differing": {}}, agreed.get(symbol, start), until)
            if evidence["missing_bars"]:
                cause = "live_gap"
            elif evidence["differing_bars"]:
                cause = "bar_mismatch"
            elif (paper is None or replay is None) and either["ts_ns"] >= end - MINUTE_NS:
                cause = "window_end"
            else:
                cause = "unexplained"
            item |= {"cause": cause, "evidence": evidence, "look_ahead_suspect": kind == "replay_only" and cause == "unexplained"}
        result.append(item)
    return result


def replay_equity(reports: Path, minutes: list[int]) -> list[list]:
    """The replay's equity at each paper snapshot minute: its account balance after the minute's bar plus
    the open profit of its positions at that bar's close."""
    with (reports / "account.csv").open(newline="", encoding="utf-8") as handle:
        balances = sorted((round(datetime.fromisoformat(row["ts_event"]).timestamp() * 1000) * 10**6,
                           Decimal(row["total"])) for row in csv.DictReader(handle))
    open_profit: dict[int, Decimal] = {}
    exposures = reports / "exposures.csv.gz"
    if exposures.is_file():
        with gzip.open(exposures, "rt", newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                at = int(row["ts_event_ns"])
                open_profit[at] = open_profit.get(at, Decimal(0)) + (_amount(row["unrealized_pnl"]) or Decimal(0))
    path, i, balance = [], 0, None
    for minute in sorted(minutes):
        close = minute + MINUTE_NS - 10**6
        while i < len(balances) and balances[i][0] <= close:
            balance = balances[i][1]
            i += 1
        if balance is not None:
            path.append([minute, str(balance + open_profit.get(close, Decimal(0)))])
    return path


def compare(lines: list[dict], replay_events: list[dict], archive: Mapping[str, list[list]], reports: Path | None,
            start: int, end: int) -> dict:
    """The comparison of one run's journal with its replay: fills, bars and equity."""
    found = bars(lines, archive, start, end)
    fills = classify(pair(orders(line for line in lines if line["kind"] == "order"), orders(replay_events)),
                     found, start, end)
    counts = {kind: sum(item["class"] == kind for item in fills)
              for kind in ("same", "price", "quantity", "time", "paper_only", "replay_only")}
    paper_equity, _ = records.equity_path(lines)
    minutes = [minute for minute, _ in paper_equity if start <= minute < end]
    equity = {"paper": [[minute, str(value)] for minute, value in paper_equity if start <= minute < end],
              "replay": replay_equity(reports, minutes) if reports else []}
    replayed = dict((minute, Decimal(value)) for minute, value in equity["replay"])
    gaps = [abs(value - replayed[minute]) for minute, value in paper_equity if minute in replayed]
    return {"summary": {"paper_fills": sum(item["paper"] is not None for item in fills),
                        "replay_fills": sum(item["replay"] is not None for item in fills), **counts,
                        "look_ahead_suspects": sum(bool(item.get("look_ahead_suspect")) for item in fills),
                        "missing_bars": sum(len(item["missing"]) for item in found.values()),
                        "differing_bars": sum(len(item["differing"]) for item in found.values()),
                        "late_bars": sum(item["late"] for item in found.values()),
                        "equity_max_difference": str(max(gaps)) if gaps else None},
            "fills": fills,
            "bars": {symbol: {**{key: item[key] for key in ("archive", "live", "late")},
                              "missing": [_utc(close) for close in item["missing"][:LISTED]],
                              "live_only": [_utc(close) for close in item["live_only"][:LISTED]],
                              "differing": [{"close": _utc(close), "fields": fields}
                                            for close, fields in list(item["differing"].items())[:LISTED]]}
                     for symbol, item in found.items()},
            "equity": equity}


def _journal(conn: db.LedgerConnection, paper_id: int) -> list[dict]:
    files = records.evidence.load_bundle(conn, records.bundle_name(paper_id))["files"]
    lines: list[dict] = []
    for name in sorted(name for name in files if name.startswith("events/")):
        found, _ = records.journal_lines(gzip.decompress(files[name]))
        lines += found
    return lines


def _archive(market: dict, at: str | None, symbols: list[str], start: int, end: int) -> tuple[str, dict[str, list]]:
    from market import read
    commit, found = None, {}
    for symbol in symbols:
        stored = read.stored_bars(market, commit or at, symbol, "LAST", "1m", _utc(start), _utc(end), None)
        commit = stored["commit"]
        found[symbol] = stored["bars"]["rows"]
        if not found[symbol] or found[symbol][-1][1] * 10**6 < end - 10**6:
            month = _utc(end - 1)[:7]
            raise refuse("PAPER_RECONCILE_UNCOVERED",
                         f"market commit {commit} holds {symbol}'s minutes only to "
                         f"{_utc(found[symbol][-1][1] * 10**6) if found[symbol] else 'nothing'} of the run's "
                         f"[{_utc(start)}, {_utc(end)})", missing=(f"market import --month {month}",))
    return commit, found  # type: ignore[return-value]


def reconcile(profile: db.LedgerProfile, market: dict, at: str | None, paper_id: int, output: Path,
              timeout: float | None = None) -> dict:
    """paper reconcile: replay a sealed paper run's interval on the archive and write reconcile.json."""
    from paper import runs
    from replay import entry
    with db.connect(profile, "reader") as conn:
        row = records.read_paper_run(conn, paper_id)
        seal = records.seal_of(conn, paper_id)
        if seal is None:
            raise refuse("PAPER_RUN_ACTIVE", f"paper run {paper_id} is not sealed", missing=(str(paper_id),))
        candidate = strategies.read_candidate(conn, row["config"]["candidate"])
        lines = _journal(conn, paper_id)
    start, end = window(lines, seal)
    commit, archive = _archive(market, at, list(row["symbols"]), start, end)
    output = paths.temporary_path(output)
    output.mkdir(mode=0o700, parents=True)
    argv = ["--symbols", *row["symbols"], "--start", _utc(start), "--trade-start", _utc(start), "--end", _utc(end),
            "--execution", "bars"]
    replayed = entry.replay_unrecorded(market, commit, candidate["source"], candidate["entry_class"], row["image_ref"],
                                       argv, output / "replay", f"trade-paper-reconcile-{runs.ledger_key(profile)}-{paper_id}",
                                       timeout)
    reports = Path(replayed["path"]) / entry.REPORTS
    events_file = reports / "order_events.jsonl.gz"
    events = [json.loads(raw) for raw in gzip.open(events_file)] if events_file.is_file() else []
    result = {"format": FORMAT, "paper_id": paper_id, "candidate": row["config"]["candidate"],
              "source_sha256": row["source_sha256"], "image_ref": row["image_ref"], "market_commit": commit,
              "window": {"start": _utc(start), "end": _utc(end)}, "fees": row["config"].get("fees"),
              "replay": {key: replayed[key] for key in ("status", "problems", "path")},
              **compare(lines, events, archive, reports if (reports / "account.csv").is_file() else None, start, end)}
    (output / "reconcile.json").write_text(json.dumps(result, indent=2, sort_keys=True, default=str), encoding="utf-8")
    return {"path": str(output / "reconcile.json"), "summary": result["summary"], "replay": result["replay"]}
