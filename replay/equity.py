"""A run's equity path against its replay's (replay.comparison): the replay's value at each minute, and the cause of
each minute that differs."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
import csv
from datetime import datetime
from decimal import ROUND_HALF_EVEN, Decimal
import gzip
from pathlib import Path

from engine.config import ACCOUNT_CONTRACT, MINUTE_NS, symbol_of, utc_text
from ledger import metrics


MILLISECOND_NS = 10**6
LISTED = 50  # bars listed per contract and kind; the counts are complete


def amount(value) -> Decimal | None:
    """A Nautilus amount ("0.25 USDT", "0.25") as a Decimal."""
    if value is None or value == "":
        return None
    return Decimal(str(value).split()[0])


def replay_equity(reports: Path, minutes: list[int]) -> list[list]:
    """The replay's equity at each run snapshot minute: its account balance after the minute's bar plus the open
    profit of its positions at that bar's close."""
    with (reports / "account.csv").open(newline="", encoding="utf-8") as handle:
        # By time alone: rows of one instant keep the order Nautilus wrote them in, the last being the latest.
        balances = sorted(((round(datetime.fromisoformat(row["ts_event"]).timestamp() * 1000) * MILLISECOND_NS,
                            Decimal(row["total"])) for row in csv.DictReader(handle)), key=lambda item: item[0])
    open_profit: dict[int, Decimal] = {}
    exposures = reports / "exposures.csv.gz"
    if exposures.is_file():
        with gzip.open(exposures, "rt", newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                at = int(row["ts_event_ns"])
                open_profit[at] = open_profit.get(at, Decimal(0)) + (amount(row["unrealized_pnl"]) or Decimal(0))
    path, i, balance = [], 0, None
    for minute in sorted(minutes):
        close = minute + MINUTE_NS - MILLISECOND_NS
        while i < len(balances) and balances[i][0] <= close:
            balance = balances[i][1]
            i += 1
        if balance is not None:
            path.append([minute, str(balance + open_profit.get(close, Decimal(0)))])
    return path


def price_places(run_bars: Iterable[Mapping]) -> dict[str, int]:
    """Per contract, the decimals the run's bars write their prices at: its instrument's price precision, on which the
    run also received its marks; a contract whose bars show several is left out."""
    found: dict[str, set[int]] = {}
    for line in run_bars:
        found.setdefault(symbol_of(line["instrument_id"]), set()).add(len(line["close"].partition(".")[2]))
    return {symbol: places.pop() for symbol, places in found.items() if len(places) == 1}


def mark_rounding(compared: Iterable[Mapping], minute: int, cut: int, marks: Mapping[str, Mapping[int, Decimal]],
                  places: Mapping[str, int]) -> Decimal | None:
    """The equity the run has over the replay at `minute` only because Nautilus writes a live mark at its instrument's
    precision, half to even (rc7 parse_mark_price, Price.from_decimal_dp), while a replay's MARK is the archive's
    close: over the positions open at `cut`, each one's profit at the rounded close less that at the close, in binary
    floating point and rounded to money as Nautilus does it (rc7 Position.try_unrealized_pnl). None when an open
    position's entry, the archive's close of that minute (`marks`: {symbol: {minute: close}}) or the contract's
    precision is unknown. For groups that agree, whose fills are the replay's."""
    from nautilus_trader.model import Currency, Money
    usdt = Currency.from_str(ACCOUNT_CONTRACT["base_currency"])
    total = Decimal(0)
    for group in compared:
        sign = 1 if group["side"] == "BUY" else -1
        quantity, opened = Decimal(0), None
        for row in group["orders"]:
            fill = (row["run"] or {}).get("fill")
            if not fill or fill["ts_ns"] > cut:
                continue
            opening = row["side"] == group["side"]
            quantity += sign * Decimal(fill["qty"]) * (1 if opening else -1)
            if opening:
                opened = float(fill["px"])
        if not quantity:
            continue
        symbol = symbol_of(group["instrument"])
        close = (marks.get(symbol) or {}).get(minute)
        if opened is None or close is None or symbol not in places:
            return None
        rounded = close.quantize(Decimal(1).scaleb(-places[symbol]), ROUND_HALF_EVEN)
        at_rounded, at_close = (Money(float(abs(quantity)) * sign * (float(mark) - opened), usdt).as_decimal()
                                for mark in (rounded, close))
        total += at_rounded - at_close
    return total


def equity_differences(run_equity: list[tuple[int, Decimal]], replayed: Mapping[int, Decimal],
                       compared: list[dict] | None, taken: Mapping[int, int],
                       paused: Iterable[tuple[int, int]] = (), marks: Mapping[str, Mapping[int, Decimal]] | None = None,
                       places: Mapping[str, int] | None = None) -> list[dict]:
    """Each minute whose equities differ by more than metrics.MONEY, with what the comparison knows of it (`cause`):
    `orders_differ` when a group that differs has a fill on either side by then (the equity follows the order
    differences already attributed), else `fill_timing` when an order filled on both sides is counted in the minute on
    one side only, else `held` when a held Paper run was down in the minute (`paused`: the [pause, resume] of each held
    interruption, paper.compare), else `mark_rounding` when the run says when it took the minute's value (`taken`) and
    the difference is exactly the one its price-precision marks make on the open positions (mark_rounding, to
    metrics.MONEY; user 2026-11-24, 「授权全部按建议修」), else `unexplained`; `orders` names the run's orders of that cause. A
    run values a minute at the last mark it received in it, and from its pause until its held recovery went live after
    the resume it received none, so it values the minute it paused in at a mark from before then, not at the minute's
    last mark (Paper runs 3 and 4, 2026-11-18).

    A replay values a minute after its bar's close, the fills that bar caused included, at the MARK bar's close. A run
    values it when it took the minute's value (`taken`: {minute: the run clock then}; Paper's snapshot, at the next
    minute's first mark; Live's, the minute's end, as its host clock is not its fills' venue clock; by default the
    minute's end), before the minute's bar reached its source: the fills that bar caused fall in the next minute (audit
    runs 52 to 54, 2026-11-15: a BTC entry's commission and its open profit to the minute's MARK close, 0.10 to 0.12
    USDT)."""
    found = []
    for minute, value in run_equity:
        if minute not in replayed or abs(value - replayed[minute]) <= metrics.MONEY:
            continue
        run_cut, replay_cut = taken.get(minute, minute + MINUTE_NS), minute + MINUTE_NS - MILLISECOND_NS
        differ: list[str] = []
        timing: list[str] = []
        for group in compared or []:
            for row in group["orders"]:
                run_fill = ((row["run"] or {}).get("fill") or {}).get("ts_ns")
                replay_fill = ((row["replay"] or {}).get("fill") or {}).get("ts_ns")
                name = (row["run"] or row["replay"])["order"]
                if group["class"] != "same":
                    if (run_fill is not None and run_fill <= run_cut) or (
                            replay_fill is not None and replay_fill <= replay_cut):
                        differ.append(name)
                elif run_fill is not None and replay_fill is not None and (
                        (run_fill <= run_cut) != (replay_fill <= replay_cut)):
                    timing.append(name)
        down = any(minute <= resume and minute + MINUTE_NS > pause for pause, resume in paused)
        cause, orders = (("orders_differ", differ) if differ else ("fill_timing", timing) if timing
                         else ("held", []) if down else ("unexplained", []))
        if cause == "unexplained" and compared is not None and minute in taken:
            rounding = mark_rounding(compared, minute, run_cut, marks or {}, places or {})
            if rounding is not None and abs(value - replayed[minute] - rounding) <= metrics.MONEY:
                cause = "mark_rounding"
        found.append({"minute": utc_text(minute), "minute_ns": minute, "run": str(value),
                      "replay": str(replayed[minute]), "difference": str(value - replayed[minute]), "cause": cause,
                      "orders": orders[:LISTED]})
    return found
