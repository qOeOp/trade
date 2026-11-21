"""market: the market directory's imports and reads (init, import, import-quotes, import-trades,
import-metrics, follow, lifecycle, coverage, bars)."""

from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
import re
import sys

from cli.common import LEDGER, MARKET, MARKET_DAY, OP_ID, Command, _count, _new_temporary, declarer, option
from ledger import db
from shared import profiles
from shared.refusals import refuse


NOUNS = {"market": "market data"}
COMMANDS: list[Command] = []
command = declarer(COMMANDS)
MONTH = option("--month", required=True, help="UTC month, YYYY-MM")
CACHE = option("--cache-root", help="download cache (default: trade-market-cache in the temporary directory)")
UNIVERSE_SYMBOLS = option("--symbols", nargs="+", help="contracts (default: the month's universe members)")


def _month_start(month: str) -> date:
    """The first day of a YYYY-MM month argument (MONTH_INVALID); an import refuses a month not begun itself."""
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise refuse("MONTH_INVALID", f"{month!r} is not YYYY-MM", expected="YYYY-MM")
    try:
        return date.fromisoformat(month + "-01")
    except ValueError as exc:
        raise refuse("MONTH_INVALID", f"{month!r} is not a month", expected="YYYY-MM") from exc


def _market_cache(cache_root: str | None) -> Path:
    from market import store
    return Path(cache_root) if cache_root else store.default_cache()


def _market_log(line: str) -> None:
    print(line, file=sys.stderr, flush=True)


def _month_arg(value: str) -> date:
    try:
        return date.fromisoformat(f"{value}-01") if re.fullmatch(r"\d{4}-\d{2}", value) else date.fromisoformat("")
    except ValueError:
        raise argparse.ArgumentTypeError(f"{value!r} is not YYYY-MM") from None


def _day_arg(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{value!r} is not YYYY-MM-DD") from None


@command("market", "init", "create an empty market directory and its profile", (
        "the profile directory",
        "the market directory at --root with its lock alone (the first import writes the first file) and the profile "
        "file {name, holds: market, kind, root}",
        "name, holds, kind, root, profile",
        "PROFILE_EXISTS (a profile file of that name exists); MARKET_EXISTS (an active market exists, or --root is "
        "not an empty directory); "
        "ISOLATION_BREACH (an active market in the checkout or a temporary root, or another market in the active "
        "one's directory); INVALID_NAME"),
         option("--name", required=True, help="profile name"),
         option("--kind", required=True, choices=profiles.KINDS,
                help="active (needs the user's authority), isolated or temporary"),
         option("--root", required=True, type=Path, help="the market directory (absent or empty)"))
def market_init(args):
    """An empty market directory and its profile (market.init_market); `--kind active` needs the user's authority,
    isolated and temporary markets are plain directories."""
    from market import files
    return files.init_market(args.name, Path(args.root), args.kind)


@command("market", "import", "import one month of bars, funding and terms", (
        "the stored bars, funding, terms and members (import role, holding the import lock); Binance public "
        "data: exchangeInfo, monthly and daily 1m kline and mark price archives (checked against their "
        "published CHECKSUM and cached under --cache-root), REST fill-ins and funding",
        "bars, funding, instrument terms and the month's universe members (a backfill also the members of the "
        "stored months whose look-back it completes), each table's whole file written and renamed into place after "
        "data_tests, bars last",
        "month, universe_rule, scope, through, instruments_appended, funding_rows, universe_members, gaps, "
        "source_rows, excluded, inferred_terms, rounded_volumes, derived_findings, per_symbol (each prepared contract: "
        "rows (new bars), bars (by price type), funding, source_rows), universe_filled (a backfill: the stored months it "
        "gave members), rows (all contracts' new bars), market_day, seconds; progress lines on stderr",
        "MONTH_INVALID (the first import takes any closed month; after that only the latest month, to extend "
        "it, the month after it once it is complete, or the month just before the earliest (a backfill); a skipped "
        "month; a month not begun; a first import with no closed UTC day; on the current month's first day the import "
        "writes its members only); MONTH_EXISTS (the month is complete, a backfilled month already holds bars or other funding rows, or "
        "stored rows no longer match the sources); EMPTY_SYMBOLS (--symbols is empty, repeats or malforms a contract); "
        "UNIVERSE_CHANGED (members differ from the stored ones); CONCURRENT_IMPORT (the lock is held, or a file "
        "changed under the import); CHECK_FAILED; DATA_TESTS_FAILED; CHECKSUM_MISMATCH, ARCHIVE_NOT_PUBLISHED, "
        "SOURCE_UNREACHABLE"), MARKET, MONTH,
         option("--cache-root", help="download cache directory (default: trade-market-cache in the temporary directory)"),
         option("--workers", type=_count, default=4, help="parallel import processes (default: 4)"),
         option("--symbols", nargs="+", help="only these contracts (default: every eligible contract)"))
def market_import(args):
    """One UTC month of Binance public data; --symbols narrows the contracts."""
    from market import store
    first = _month_start(args.month)
    return store.import_month(profiles.market(args.market), first, _market_cache(args.cache_root), args.workers,
                              args.symbols, log=_market_log)


@command("market", "import-quotes", "import one ended month of best bid/ask inferred from the stored aggTrades",
         (
        "the month's universe members, each contract's newest stored terms, stored quotes and the stored aggTrades of "
        "the month and the day before it (import role, holding the import lock): every month, an earlier one included, "
        "is inferred with the price increment observed last, not the one in force that month; when the day before is "
        "not stored, its Binance daily aggTrades archive (checksum-verified, cached under --cache-root)",
        "best bid/ask quote rows inferred from the trades, one file per contract and month, placed in symbol order; a "
        "refused contract leaves the others' files",
        "month, through, quote_rule, per_symbol (each contract in symbol order: rows (quote states), eve (the day "
        "before was read), days and the inference readings), rows (all contracts), market_day, seconds; progress lines "
        "on stderr",
        "MONTH_INVALID (not YYYY-MM, or the month has not ended; any earlier month is accepted, in any order); "
        "MONTH_EXISTS (a named contract already has the month's quotes); MARKET_EMPTY (no bars yet); UNIVERSE_UNKNOWN "
        "(the month has no members; import its bars or name --symbols); TERMS_UNKNOWN; TRADES_NOT_HELD (no aggTrades "
        "file of the month: market import-trades first); the first refused contract's refusal, naming the contracts "
        "written; CONCURRENT_IMPORT; CHECK_FAILED"), MARKET, MONTH,
         option("--cache-root", help="download cache directory (default: trade-market-cache in the temporary directory)"),
         UNIVERSE_SYMBOLS)
def market_import_quotes(args):
    """One ended UTC month of best bid/ask inferred from the stored aggTrades (market.quotes.RULE); --symbols
    defaults to the month's universe members."""
    from market import quotes
    first = _month_start(args.month)
    return quotes.import_quotes(profiles.market(args.market), first, _market_cache(args.cache_root), args.symbols,
                                log=_market_log)


@command("market", "import-trades", "import one ended month of complete source aggTrades, one file per contract",
         (
        "one explicit ended month of one or more named contracts (import role, one worker process per contract written "
        "at once while this one holds the import lock); official daily aggTrades ZIPs and the eve, checksum-verified "
        "under --cache-root, downloaded and parsed in bounded chunks",
        "all eight source fields in agg_trade, one file per contract and month, placed in symbol order; a refused "
        "contract leaves the others' files in place; no change to bars, quotes or replay exports",
        "month, codec (binance-aggtrades-int64-scale8-v1: price and quantity exactly x1e8), per_symbol (each contract "
        "in symbol order: rows, seconds), rows (all contracts), market_day, seconds; a line per placed contract on "
        "stderr",
        "MONTH_INVALID (the month has not ended; any earlier month in any order); EMPTY_SYMBOLS (a repeated or malformed "
        "symbol); the first refused contract's refusal, naming the contracts written; MARKET_EMPTY; MONTH_EXISTS; "
        "SCALE_LOSS (any value is inexact or outside signed int64: refuse the whole month, no rounding or fallback); "
        "SEQUENCE_GAP (within/between batches, days or eve); SOURCE_SHAPE; CHECKSUM_MISMATCH; ARCHIVE_NOT_PUBLISHED; "
        "CONCURRENT_IMPORT; CHECK_FAILED"), MARKET, MONTH,
         option("--symbols", required=True, nargs="+", help="USD-M perpetual contracts, written at once"), CACHE)
def market_import_trades(args):
    """One ended UTC month of complete source aggTrades of each named contract, written at once."""
    from market import aggtrades
    first = _month_start(args.month)
    return aggtrades.import_month(profiles.market(args.market), first, _market_cache(args.cache_root), args.symbols,
                                  log=_market_log)


@command("market", "import-metrics", "import the days of one month of open interest and long/short ratios not yet "
         "held, one file per contract", (
        "one explicit month of the named contracts (default: the month's universe members) and the days its file holds "
        "(import role, holding the import lock); official daily metrics ZIPs, checksum-verified under --cache-root",
        "sum_open_interest and the three long/short ratios at each create_time in metrics: each contract's month file "
        "with the published days it lacks added, through the last closed UTC day; a refused contract leaves the earlier "
        "ones' files; no change to bars, quotes, trades or replay exports",
        "month, per_symbol (each contract in symbol order: from, through (exclusive end day), readings (daily rows, "
        "repeated_rows merged, empty ratios), unpublished (days without an archive), rows), rows (all contracts), "
        "market_day, seconds; daily progress on stderr",
        "MONTH_INVALID (no closed UTC day); EMPTY_SYMBOLS; UNIVERSE_UNKNOWN; MONTH_EXISTS (every closed day already "
        "held); ARCHIVE_NOT_PUBLISHED (no day published); SOURCE_SHAPE (header, symbol, a create_time off the "
        "five-minute grid of its day, no open interest, a negative or non-decimal value, two different rows at one "
        "create_time; identical repeats are merged and counted); SCALE_LOSS (a value needs more than 16 decimals or 22 "
        "integer digits: no rounding); the first refused contract's refusal, naming the contracts written; "
        "MARKET_EMPTY; CHECKSUM_MISMATCH; CONCURRENT_IMPORT; CHECK_FAILED"), MARKET, MONTH, UNIVERSE_SYMBOLS, CACHE)
def market_import_metrics(args):
    """The days of one UTC month of open interest and long/short ratios not yet held, per contract."""
    from market import metrics
    first = _month_start(args.month)
    return metrics.import_month(profiles.market(args.market), first, _market_cache(args.cache_root), args.symbols,
                                log=_market_log)


@command("market", "follow", "keep the configured range of the bars, and the named contracts' metrics, quotes and "
         "complete aggTrades, imported, until stopped", (
        "each round: what the market directory holds, from its paths and footers (reader), the daily archives each "
        "import reads downloaded into --cache-root (bars: the last closed day's klines of every contract; metrics; "
        "aggTrades streamed, a month with its eve, outside the import lock)",
        "each round: market import of the bars' months from --bars-from through the last closed UTC day (--bar-symbols "
        "only; a day is sealed only once every contract's daily klines archive is out, or 3 days after it closed; a "
        "stored range after --bars-from is first extended back, month by month); per contract market import-metrics of "
        "each month from --metrics-from with days missing; market import-trades (the contracts due that month in one "
        "call) and then market import-quotes (one contract a call, once the aggTrades hold the month) of every closed "
        "month after the contract's latest, from --trades-from and --quotes-from when it holds none; a month 40 days "
        "closed and not out, or whose next closed month is wholly out, is passed over; once a month, each month from the "
        "configured one to a contract's latest quotes or aggTrades that is not held, when its archives are new to the "
        "cache or were republished; --status marked running at the start and rewritten after every "
        "round",
        "nothing until stopped; one JSON line per round on stdout, as written to --status: at, last_closed_day, "
        "kinds {bars {scope}, metrics, quotes, trades {contract}: state (caught_up, waiting, lagging: still missing "
        "3 days after it closed, stopped, unknown), refusal, retry, rows; bars through; metrics "
        "missing_from, missing_days, unpublished (days long closed with no archive, not asked for again until the "
        "process restarts); quotes and trades next_month, skipped, filled}, round_refusal, "
        "next_round (an hour later while anything waits or the market is unreadable, else 00:30 UTC of the next "
        "day); import progress on stderr",
        "EMPTY_SYMBOLS at start. Rounds never exit: ARCHIVE_NOT_PUBLISHED, CONCURRENT_IMPORT, "
        "MARKET_UNREACHABLE, MARKET_EMPTY, SOURCE_UNREACHABLE, CHECKSUM_MISMATCH, "
        "TRADES_NOT_HELD and (but for bars) MONTH_EXISTS retry next round; a quotes or aggTrades SEQUENCE_GAP downloads "
        "the month again once, then skips the month (a gap on the eve stops the contract's kind instead); "
        "DATA_TESTS_FAILED stops "
        "everything; any other refusal or error stops its contract's kind (for bars, the bars: a month missing between "
        "the stored ones is MONTH_INVALID); stops last until the process restarts"), MARKET,
         option("--bar-symbols", nargs="+", help="contracts of the bars (default: every eligible contract)"),
         option("--bars-from", required=True, type=_month_arg, help="first month of the bars, YYYY-MM"),
         option("--symbols", nargs="+", default=[], help="contracts whose metrics, quotes and aggTrades to keep "
                "(default: none, bars only); it needs the three options below"),
         option("--metrics-from", type=_day_arg, help="first day of the metrics, YYYY-MM-DD"),
         option("--metrics-pool", action="store_true",
                help="also keep the metrics of the newest month's universe members, each from the first day "
                     "of the month it is found in (no earlier days)"),
         option("--quotes-from", type=_month_arg, help="first month of the quotes, YYYY-MM"),
         option("--trades-from", type=_month_arg, help="first month of the aggTrades, YYYY-MM"), CACHE,
         option("--status", help="status file rewritten every round (default: market-import/status.json "
                                 "in the temporary directory)"),
         epilog="Imports through market import, import-metrics, import-quotes and import-trades; adds no import rule. "
                "What is due is what the configured range lacks on disk, so an empty directory fills from the "
                "configured starts. The first round starts 5 minutes after start. The healthcheck is "
                "market.follow.check(): unhealthy while anything is stopped, lagging or unknown, or the status is "
                "older than 26 hours; skipped months are not.")
def market_follow(args):
    """Keep the configured range of the market's bars and the named contracts' metrics, complete aggTrades and quotes
    imported, unattended; runs until stopped."""
    from market import follow
    firsts = (args.metrics_from, args.trades_from, args.quotes_from)
    if args.symbols and None in firsts:
        raise refuse("USAGE_ERROR", "--symbols needs --metrics-from, --trades-from and --quotes-from",
                     missing=("--metrics-from", "--trades-from", "--quotes-from"))
    # With no --symbols nothing reads the three first dates.
    metrics_from, trades_from, quotes_from = firsts if args.symbols else (args.bars_from,) * 3
    scope = follow.Scope(symbols=args.symbols, bars_from=args.bars_from, metrics_from=metrics_from,
                         trades_from=trades_from, quotes_from=quotes_from, bar_symbols=args.bar_symbols,
                         metrics_pool=args.metrics_pool)
    return follow.follow(profiles.market(args.market), scope, _market_cache(args.cache_root),
                         Path(args.status) if args.status else follow.default_status(), log=_market_log,
                         report=lambda line: print(line, flush=True))


@command("market", "lifecycle", "write the lifecycle bundle of a market day", (
        "the market day of --market-day (reader); --manifest and each --notice, validated against that market day before "
        "anything is written",
        "the ledger bundle lifecycle-<market day> (lifecycle.json and the notices); the same content again is "
        "a replay",
        "bundle, market_day, files {path: sha256}, episodes (count per contract), write_status, ledger_commit",
        "LIFECYCLE_INPUT (a file missing, not regular or not JSON, or the manifest does not fit the market day); "
        "BUNDLE_EXISTS (a different manifest; a correction belongs to a new market day); "
        "MARKET_DAY_UNRESOLVED"),
         LEDGER, MARKET, MARKET_DAY, option("--manifest", required=True, help="lifecycle.json (native-lifecycle-v1)"),
         option("--notice", action="append", dest="notices", default=[], help="an exchange notice it cites"), OP_ID)
def market_lifecycle(args):
    """The lifecycle evidence bundle lifecycle-<market_day> of a market day, from its manifest and the exchange
    notices it cites (registration.record_lifecycle)."""
    from registration import inputs
    profile = db.profile(args.ledger, holds="research")
    return inputs.record_lifecycle(profile, profiles.market(args.market), args.market_day, Path(args.manifest),
                                   [Path(item) for item in args.notices or ()], args.op_id)


@command("market", "coverage", "per-contract coverage facts at a market day", (
        "bars, mark prices, funding, quotes, trades, metrics, instruments and universe members at --market-day "
        "(reader); without --symbols, every member of the months [--start, --end) touches; with --lifecycle-bundle, "
        "that ledger bundle",
        "nothing",
        "market_day, scope {symbols, start, end, expanded}, input_interval_ms, coverage [per contract], lifecycle, "
        "lifecycle_missing, interpretation",
        "INTERVAL_INVALID (not UTC whole minutes, or start not before end); EMPTY_SYMBOLS; UNKNOWN_SYMBOL; "
        "MARKET_DAY_UNRESOLVED; LIFECYCLE_INPUT"), MARKET, MARKET_DAY,
         option("--symbols", nargs="+", help="Binance symbols (default: every universe member in the window)"),
         option("--start", required=True, help="input interval start, UTC ISO-8601 with Z"),
         option("--end", required=True, help="input interval end, UTC ISO-8601 with Z"), LEDGER,
         option("--lifecycle-bundle", help="lifecycle-<market_day> bundle to add lifecycle episodes (needs --ledger)"),
         epilog="""Facts only: it judges no contract, window or line.
coverage[].funding: rows, first_ms, last_ms; spacing [{spacing_ms, from_ms, to_ms}], the runs of equal
spacing between consecutive settlements, each time taken at its nearest whole UTC hour (a new run is a
spacing change); missing_settlements [{after_ms, before_ms, missing}], where a single interval is a
whole multiple k >= 2 of the spacing beside it (the same on both sides): k - 1 settlements missing.
Settlement times themselves: market bars.
coverage[].quotes: months [{month, rows}], the contract's quote files meeting the interval, rows at the market day;
first_ms and last_ms, the first and last stored quote in the interval; uncovered_intervals_ms, the [from, to)
parts of the interval no file holds.
coverage[].trades: the same for the complete aggregate trades a replay exports with --trade-ticks.
coverage[].metrics: open interest and long/short ratios (market import-metrics): months [{month, rows, empty (rows
per ratio left empty), missing_rows (five-minute rows the held days lack), missing_days (days up to the market day it
does not hold)}], first_ms, last_ms (create_time), uncovered_intervals_ms (missing days included).
coverage[].terms: the terms row a replay of the market day trades on for the whole window, the latest
observed at the market day (CURRENT_SNAPSHOT_APPROXIMATION): observed_at, terms_source (exchange_info or
inferred), price_increment, size_increment, min_quantity, max_quantity, min_notional, min_price,
max_price (null for inferred terms).""")
def market_coverage(args):
    """Per-contract coverage facts at a market day, with lifecycle receipts."""
    from market import coverage, files as market_files
    from registration import inputs, seams
    market, at, symbols, start, end = profiles.market(args.market), args.market_day, args.symbols, args.start, args.end
    lifecycle = None
    if args.lifecycle_bundle is not None:
        if args.ledger is None:
            raise refuse("USAGE_ERROR", "--lifecycle-bundle needs --ledger")
        market_day = market_files.resolve_day(market_files.open_market(market, "reader"), at)
        _, files = inputs.load_lifecycle(db.profile(args.ledger), args.lifecycle_bundle, market_day,
                                         market=seams.current.market(market))
        lifecycle = (json.loads(files[inputs.LIFECYCLE].decode("utf-8")), files)
    expanded = symbols is None
    if symbols is None:
        symbols = coverage.universe_members(market, at, start, end)
    found = coverage.diagnose_coverage(market, at, list(symbols), start, end, lifecycle)
    found["scope"] = {"symbols": list(symbols), "start": start, "end": end, "expanded": expanded}
    return found


@command("market", "bars", "one contract's stored bars and funding at a market day", (
        "bar, funding and instrument at --market-day (reader), through the exporter's own reads "
        "(market.read_bars, market.daily_bars, market.read_funding)",
        "nothing in any database; with --output, one new file under the temporary root",
        "market_day, symbol, price_type, timeframe, interval {start, end, ms}, next_start, bars {columns, count, rows}, "
        "funding {columns, count, rows}, output",
        "INTERVAL_INVALID (not UTC whole minutes, start not before end; 1d: not whole UTC days or MARK); UNKNOWN_SYMBOL "
        "(no such contract at the market day); MARKET_DAY_UNRESOLVED; NOT_TEMPORARY_PATH, PATH_EXISTS (--output)"), MARKET, MARKET_DAY,
         option("--symbol", required=True, help="one Binance symbol such as BTCUSDT"),
         option("--price-type", choices=("LAST", "MARK"), default="LAST",
                help="LAST trade bars or MARK price bars (default: LAST; 1d is LAST only)"),
         option("--timeframe", choices=("1m", "1d"), default="1m",
                help="1m stored minutes or 1d derived daily bars (default: 1m)"),
         option("--start", required=True, help="interval start, UTC ISO-8601 with Z"),
         option("--end", required=True, help="interval end (exclusive), UTC ISO-8601 with Z"),
         option("--limit", type=_count, default=1440,
                help="most bar periods returned inline (default: 1440, one day of minutes)"),
         option("--output", help="new JSON file under the temporary root for the whole interval"),
         epilog="""The source reviewer's price read: no trial, no exposure. Prices and volumes are decimals at the
stored scale. ts_event_ms is when the Catalog delivers the bar to a strategy: its close, ts_open_ms
plus the period minus 1 ms. 1m MARK bars become one mark price per minute at that close. 1d bars are
the Catalog's daily LAST bars, the complete UTC days derived from the stored minutes, which a
strategy whose WARMUP declares 1-DAY receives before its trading start; inside the window the engine
aggregates the minutes natively, stamped on close. Funding rows are the settlements in the same interval, each
delivered at its funding_time_ms. Without --output at most --limit bar periods from --start are
returned and next_start names where the rest begins (null when the interval is complete); with
--output the whole interval goes to the file, rows included, and the printed result keeps only the
counts. Lifecycle episodes are not applied (one contract as stored).""")
def market_bars(args):
    """One contract's stored bars and funding settlements at a market day, inline up to --limit bar periods or whole
    into a new temporary file."""
    from market import read
    target = _new_temporary(args.output) if args.output else None
    found = read.stored_bars(profiles.market(args.market), args.market_day, args.symbol, args.price_type,
                             args.timeframe, args.start, args.end, None if target else args.limit)
    if target is None:
        return {**found, "output": None}
    target.write_text(json.dumps(found, ensure_ascii=False) + "\n", encoding="utf-8")
    return {**found, "output": str(target), "bars": {key: value for key, value in found["bars"].items() if key != "rows"},
            "funding": {key: value for key, value in found["funding"].items() if key != "rows"}}
