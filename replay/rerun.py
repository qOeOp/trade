"""The archive side of a run's comparison (replay.comparison): the archive's minutes, warm-up, funding and metrics
for the run's window, and the replay of the run's source on its image, compared with the run."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from decimal import Decimal, ROUND_HALF_DOWN, ROUND_HALF_EVEN
import gzip
import hashlib
import json
from pathlib import Path

from engine.config import instrument_id, symbol_of, utc_text
from replay.comparison import FUNDING_INTERVAL_NS, METRICS_VALUES, MILLISECOND_NS, MINUTE_NS, compare, text
from shared import paths
from shared.refusals import refuse


def archive_metrics(opened, market_day: str, symbol: str, low: int, end: int) -> list[list]:
    """The metrics rows a replay streams of `symbol` from ts_event `low` that reach it before `end`
    (market.export.metrics_rows, the ratios as shown_ratio gives them): [[ts_event, *METRICS_VALUES, ties], ...], the
    values as text or None; `ties` holds {field: text} for a position ratio stored exactly at the midpoint of the 4th
    decimal, rounded half-down, the other value REST may show (compare_metrics)."""
    from market import export, files
    rows = export.metrics_rows(opened, market_day, symbol, low // MILLISECOND_NS, None, end // MILLISECOND_NS)
    found = []
    for row in rows:
        stored = dict(zip(files.METRICS_VALUES, row[1:], strict=True))
        ties: dict[str, str | None] = {}
        for name in METRICS_VALUES[1:]:
            if name not in export.ACCOUNT_RATIOS and stored[name] is not None:
                down = stored[name].quantize(export.RATIO_PLACES, ROUND_HALF_DOWN)
                if down != export.shown_ratio(name, stored[name]):  # half-up and half-down part only at the midpoint
                    ties[name] = text(down)
        found.append([(row[0] + export.METRICS_DESCRIBES_MS) * MILLISECOND_NS, text(stored[METRICS_VALUES[0]]),
                      *(text(export.shown_ratio(name, stored[name])) for name in METRICS_VALUES[1:]), ties])
    return found


def digest(rows: Iterable[tuple]) -> dict:
    """A history as engine.realtime.warmup_digest records it: rows (ts_event, open, high, low, close, volume) as text."""
    found = list(rows)
    text = "\n".join(",".join(str(value) for value in row) for row in found)
    return {"bars": len(found), "first_ts_event": found[0][0] if found else None,
            "last_ts_event": found[-1][0] if found else None, "sha256": hashlib.sha256(text.encode()).hexdigest()}


def _places(increment: str) -> list[int]:
    """The precisions a contract's bars may be written at: its increment's decimals as the market stores it, and
    without trailing zeros (a venue may give either)."""
    from market.instrument import decimals
    return sorted({decimals(increment), decimals(format(Decimal(increment).normalize(), "f"))})


def _at(value, places: int) -> str:
    return format(Decimal(value).quantize(Decimal(1).scaleb(-places), ROUND_HALF_EVEN), "f")


def archive_warmup(market: dict, market_day: str, symbol: str, at: int, received: Mapping[str, Mapping],
                   terms: Mapping) -> dict[str, dict]:
    """Per period the run received, the same bars from the archive's minutes: `received`'s count of bars of the
    period ending 1 ms before floor(at, P) (engine.warmup.history_range), each aggregated from its minutes, as
    digests {bars, first_ts_event, last_ts_event, sha256s}: one per precision the contract's bars may be written at
    (_places), so the text compares as Nautilus wrote it."""
    from engine.warmup import FUNDING, PERIODS
    from market import read
    found = {}
    for period, got in received.items():
        if period == FUNDING:
            found[period] = archive_funding(market, market_day, symbol, at, got.get("bars") or 0)
            continue
        step = PERIODS[period] * MINUTE_NS
        count = got.get("bars") or 0
        end = at // step * step
        first_open = end - count * step
        rows = []
        if count:
            stored = read.stored_bars(market, market_day, symbol, "LAST", "1m", utc_text(first_open), utc_text(end), None,
                                      funding=False)["bars"]["rows"]
            buckets: dict[int, list] = {}
            for row in stored:
                buckets.setdefault(row[0] * MILLISECOND_NS // step * step, []).append(row)
            for opened in range(first_open, end, step):
                minutes = buckets.get(opened)
                if minutes:
                    rows.append((opened + step - MILLISECOND_NS, Decimal(minutes[0][2]),
                                 max(Decimal(row[3]) for row in minutes), min(Decimal(row[4]) for row in minutes),
                                 Decimal(minutes[-1][5]), sum((Decimal(row[6]) for row in minutes), Decimal(0))))
        written = [digest([(row[0], *(_at(value, price) for value in row[1:5]), _at(row[5], size)) for row in rows])
                   for price in _places(terms["price_increment"]) for size in _places(terms["size_increment"])]
        found[period] = {key: written[0][key] for key in ("bars", "first_ts_event", "last_ts_event")} | {
            "sha256s": sorted({item["sha256"] for item in written})}
    return found


def archive_funding(market: dict, market_day: str, symbol: str, at: int, count: int) -> dict:
    """The last `count` settlements the market stores at or before `at`, each as engine.warmup.funding_update gives it, as
    a digest {bars, first_ts_event, last_ts_event, sha256s}."""
    from engine.warmup import funding_update
    from market import coverage, files
    stored: list = []
    if count:
        opened = files.open_market(market, "reader")
        start_ms = max(at - (count + 1) * FUNDING_INTERVAL_NS, 0) // MILLISECOND_NS
        stored = [row for row in coverage.read_funding(opened, market_day, symbol, start_ms, at // MILLISECOND_NS + 1)
                  if row[0] * MILLISECOND_NS <= at][-count:]
    written = digest((update.ts_event, update.rate) for update in
                     (funding_update(instrument_id(symbol), at_ms * MILLISECOND_NS, rate) for at_ms, rate in stored))
    return {key: written[key] for key in ("bars", "first_ts_event", "last_ts_event")} | {"sha256s": [written["sha256"]]}


def archive(market: dict, at: str | None, symbols: list[str], start: int, end: int,
            code: str) -> tuple[str, dict[str, list]]:
    """(market day, each contract's archived one-minute bars in [start, end)); `code` when the market does not hold
    them all yet."""
    from market import read
    market_day, found = None, {}
    for symbol in symbols:
        stored = read.stored_bars(market, market_day or at, symbol, "LAST", "1m", utc_text(start), utc_text(end), None,
                                  funding=False)
        market_day = stored["market_day"]
        found[symbol] = stored["bars"]["rows"]
        if not found[symbol] or found[symbol][-1][1] * MILLISECOND_NS < end - MILLISECOND_NS:
            month = utc_text(end - 1)[:7]
            raise refuse(code, f"market day {market_day} holds {symbol}'s minutes only to "
                               f"{utc_text(found[symbol][-1][1] * MILLISECOND_NS) if found[symbol] else 'nothing'} of "
                               f"the run's [{utc_text(start)}, {utc_text(end)})", missing=(f"market import --month {month}",))
    return market_day, found  # type: ignore[return-value]


def archive_marks(market: dict, market_day: str, symbol: str, start: int, end: int) -> dict[int, Decimal]:
    """{minute: the close of its archived MARK bar, as a replay values it} in [start, end)."""
    from market import read
    rows = read.stored_bars(market, market_day, symbol, "MARK", "1m", utc_text(start), utc_text(end), None,
                            funding=False)["bars"]["rows"]
    return {row[0] * MILLISECOND_NS: Decimal(row[5]) for row in rows}


def history_start(start: int, received: Mapping[str, Mapping[str, Mapping]]) -> int:
    """The first minute a replay warmed at `start` must export so the histories the run `received` ({instrument:
    {period: digest}}) lie in it: the opening of the first of each period's bars (engine.warmup.history_range), as the
    replay builds a history only from the window's one-minute bars (engine.run.history_stamps), and the minute of the
    first funding settlement, as the replay reads settlements from its window (engine.run.funding_settlements); daily
    bars come from the market's own."""
    from engine.warmup import FUNDING, PERIODS
    first = start
    for periods in received.values():
        for period, got in periods.items():
            count = int((got or {}).get("bars") or 0)
            if count and period == FUNDING and isinstance((got or {}).get("first_ts_event"), int):
                first = min(first, got["first_ts_event"] // MINUTE_NS * MINUTE_NS)
            elif count and period not in (FUNDING, "1-DAY"):
                step = PERIODS[period] * MINUTE_NS
                first = min(first, start // step * step - count * step)
    return first


def _refusals(output: Path) -> set[str]:
    """The codes of the runtime failures a replay directory recorded (engine.execution_failure)."""
    from ledger import problems
    found = set()
    path = output / problems.RUNTIME_ERRORS
    for line in path.read_text(encoding="utf-8").splitlines() if path.is_file() else []:
        try:
            item = json.loads(line)
        except ValueError:  # the replay's audit reports a malformed line
            continue
        if isinstance(item, dict) and isinstance(item.get("code"), str):
            found.add(item["code"])
    return found


def replay(market: dict, market_day: str, source: bytes, entry_class: str, image_ref: str, symbols: list[str],
           start: int, end: int, leverage: str, starting_balance: str, output: Path, name: str,
           timeout: float | None, received: Mapping[str, Mapping[str, Mapping]]) -> tuple[dict, list[dict] | None, Path | None]:
    """(the replay's status, its order events or None when it wrote none, its reports directory or None without an
    account report): the run's source on its image trading [start, end), warmed at `start` on the bars before it that
    the run `received` (history_start), in the bars environment at the run's leverage and starting balance, streaming
    metrics when the source subscribes to them. Its membership runs to the end of the month of the window's last
    minute, as the run's did (engine.membership.month_end_ns)."""
    from engine.membership import month_end_ns
    from replay import entry
    argv = ["--symbols", *symbols, "--start", utc_text(history_start(start, received)), "--trade-start", utc_text(start),
            "--end", utc_text(end),
            "--execution", "bars", "--leverage", str(leverage), "--starting-balance", str(starting_balance)]
    membership_end = month_end_ns(end - 1)
    replayed = entry.replay_unrecorded(market, market_day, source, entry_class, image_ref, argv, output, name, timeout,
                                       membership_end)
    if "METRICS_NOT_SERVED" in _refusals(Path(replayed["path"])):
        # The source subscribes to metrics, which Paper and Live serve (engine.metrics) and a replay streams only with
        # --metrics; neither run records whether it read them, so the refused replay says so.
        replayed = entry.replay_unrecorded(market, market_day, source, entry_class, image_ref, [*argv, "--metrics"],
                                           output.with_name(output.name + "-metrics"), name, timeout, membership_end)
    reports = Path(replayed["path"]) / entry.REPORTS
    events_file = reports / "order_events.jsonl.gz"
    events = ([json.loads(raw) for raw in gzip.decompress(events_file.read_bytes()).splitlines()]
              if events_file.is_file() else None)
    return replayed, events, reports if (reports / "account.csv").is_file() else None


def replay_and_compare(run: Mapping, market: dict, market_day: str, archived: Mapping[str, list[list]], source: bytes,
                       entry_class: str, image_ref: str, symbols: list[str], start: int, end: int, leverage: str,
                       starting_balance: str, output: Path, name: str,
                       timeout: float | None, existing: bool = False) -> tuple[Path, dict, dict]:
    """(the new temporary directory, the replay's status, the comparison): the run's source replayed into
    `output`/replay on the warm-up the run received, and `run` compared with it against the `archived` minutes, the
    contract terms at `market_day`, the warm-up and metrics the archive gives and the fees the market assumes."""
    from market import files, instrument
    opened = files.open_market(market, "reader")
    replay_terms = {symbol: instrument.terms(opened, market_day, symbol) for symbol in symbols}
    received = run.get("warmup") or {}
    archived_warmup = {symbol: archive_warmup(market, market_day, symbol, start,
                                              received.get(instrument_id(symbol), {}), replay_terms[symbol])
                       for symbol in symbols}
    firsts: dict[str, int] = {}
    for row in run.get("metrics") or []:
        if row.get("kind") != "metrics_unsubscribed":
            firsts[symbol_of(row["instrument_id"])] = min(row["ts_event"],
                                                          firsts.get(symbol_of(row["instrument_id"]), end))
    archived_metrics = {symbol: archive_metrics(opened, market_day, symbol, first, end)
                        for symbol, first in firsts.items()}
    # A run that says when it took each minute's value (Paper, Live) has its equity checked against archived marks.
    archived_marks = ({symbol: archive_marks(market, market_day, symbol, start, end) for symbol in symbols}
                      if run.get("taken") else None)
    if not existing:  # a preliminary comparison made its directory for its market (replay.preliminary)
        output = paths.temporary_path(output)
        output.mkdir(mode=0o700, parents=True)
    replayed, events, reports = replay(market, market_day, source, entry_class, image_ref, symbols, start, end,
                                       leverage, starting_balance, output / "replay", name, timeout, received)
    return output, replayed, compare(run, events, archived, reports, start, end, archived_warmup=archived_warmup,
                                     archived_metrics=archived_metrics, archived_marks=archived_marks,
                                     replay_terms=replay_terms, replay_fees={"maker": instrument.ASSUMED["maker_fee"],
                                                                            "taker": instrument.ASSUMED["taker_fee"]})
