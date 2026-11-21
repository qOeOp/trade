"""Read-time splits of one run (`report.splits`): its closed cycles by close year and by instrument, and its
trading window cut into development years or, under two years, quarters. Derived on read from the stored cycles and
daily returns, never stored; the single-run report gives them beside the measures (report.measures).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from decimal import Decimal
import itertools
import math

from ledger import metrics
from report.measures import annual_return, closed_cycles


def closed_by_year(cycles: list[dict]) -> dict:
    """Closed cycles' count, price PnL, commissions and funding by the UTC year of their close."""
    years: dict[str, dict] = {}
    for cycle in closed_cycles(cycles):
        year = str(datetime.fromtimestamp(cycle["ts_closed_ns"] // 10**9, timezone.utc).year)
        item = years.setdefault(year, {"closed_trades": 0, "price": Decimal(0), "commissions": Decimal(0),
                                       "funding": Decimal(0)})
        item["closed_trades"] += 1
        item["price"] += Decimal(cycle["price_pnl"])
        item["commissions"] += Decimal(cycle["commissions"])
        item["funding"] += Decimal(cycle["funding"])
    return {year: {"closed_trades": item["closed_trades"], "price_pnl_usdt": metrics.money(item["price"]),
                   "fill_commissions_usdt": metrics.money(item["commissions"]), "reported_funding_usdt": metrics.money(item["funding"])}
            for year, item in sorted(years.items())}


def closed_by_instrument(cycles: list[dict]) -> dict:
    """Closed cycles by instrument: count, win rate (net PnL above zero), price PnL, commissions, funding and net
    PnL (realized), derived on read from the stored cycles (instrument_net keeps only the net)."""
    found: dict[str, dict] = {}
    for cycle in closed_cycles(cycles):
        item = found.setdefault(cycle["instrument_id"], {"closed_trades": 0, "won": 0, "price": Decimal(0),
                                                         "commissions": Decimal(0), "funding": Decimal(0),
                                                         "net": Decimal(0)})
        net = Decimal(cycle["realized_pnl"])
        item["closed_trades"] += 1
        item["won"] += net > 0
        item["price"] += Decimal(cycle["price_pnl"])
        item["commissions"] += Decimal(cycle["commissions"])
        item["funding"] += Decimal(cycle["funding"])
        item["net"] += net
    return {name: {"closed_trades": item["closed_trades"], "win_rate": item["won"] / item["closed_trades"],
                   "price_pnl_usdt": metrics.money(item["price"]), "fill_commissions_usdt": metrics.money(item["commissions"]),
                   "reported_funding_usdt": metrics.money(item["funding"]), "net_pnl_usdt": metrics.money(item["net"])}
            for name, item in sorted(found.items())}


def _segments(run: Mapping, months: int) -> tuple[list[datetime], int, list[float]] | None:
    """(cuts, whole, returns) of a run's trading window cut every `months` months from its trade start, a last part
    segment when the window does not end on a cut: each segment's compound return over the stored daily returns
    dated in it. None for a window of one whole segment or less, or a start whose day some month lacks."""
    start = datetime.fromtimestamp(run["trade_start_ns"] // 10**9, timezone.utc)
    end = datetime.fromtimestamp(run["trade_end_ns"] // 10**9, timezone.utc)

    def shifted(k: int) -> datetime:
        month = start.month - 1 + k * months
        return start.replace(year=start.year + month // 12, month=month % 12 + 1)

    cuts = [start]
    try:
        while (following := shifted(len(cuts))) <= end:
            cuts.append(following)
    except ValueError:  # a start on a day some month lacks (29-31) has no regular cuts
        return None
    whole = len(cuts) - 1
    if end > cuts[-1]:
        cuts.append(end)
    if whole == 0 or len(cuts) < 3:
        return None
    bounds = [int(moment.timestamp()) * 10**9 for moment in cuts]
    returns = [math.prod(1 + value for ts, value, _ in run["returns"] if low <= ts < high) - 1
               for low, high in itertools.pairwise(bounds)]
    return cuts, whole, returns


def _without_best(cuts: list[datetime], whole: int, returns: list[float]) -> float | None:
    """The window's annual return over its days without its best whole segment (part segments included)."""
    days = [(high - low).total_seconds() / 86400 for low, high in itertools.pairwise(cuts)]
    best = returns.index(max(returns[:whole]))
    rest = [k for k in range(len(returns)) if k != best]
    return annual_return(math.prod(1 + returns[k] for k in rest), sum(days[k] for k in rest))


def dev_years(run: Mapping, annual_target: float | None = None) -> dict | None:
    """The development years of a run's trading window, cut at its trade start's anniversaries, and a last part
    year (`partial`) when the window does not end on one: each segment's compound return over the stored daily
    returns dated in it, and with `annual_target` whether a whole year reaches the target or by how much it falls
    short, how many whole years reach it, the worst whole year's return and the window's annual return over its
    days without the best whole year (the part year's included). A part year is not read against the annual
    target. A slice of one continuous run: positions and the equity peak carry across segments. None for a window
    of one whole year or less."""
    cut = _segments(run, 12)
    if cut is None:
        return None
    cuts, whole, returns = cut
    years = []
    for k, ((begin, finish), value) in enumerate(zip(itertools.pairwise(cuts), returns, strict=True)):
        item: dict[str, object] = {"start": begin.date().isoformat(), "end": finish.date().isoformat(),
                                   "return": value, "partial": k >= whole}
        if annual_target is not None and k < whole:
            item.update(at_target=value >= annual_target, short_by=max(annual_target - value, 0.0))
        years.append(item)
    return {"years": years, "annual_target": annual_target,
            "years_at_target": None if annual_target is None else sum(value >= annual_target
                                                                      for value in returns[:whole]),
            "worst_year_return": min(returns[:whole]),
            "return_without_best_year": _without_best(cuts, whole, returns)}


def dev_quarters(run: Mapping) -> dict | None:
    """The development quarters of a run's trading window with fewer than two whole years, where dev_years gives at
    most one whole year: the window cut every three months from its trade start, a last part quarter (`partial`)
    when it does not end on a cut, each quarter's compound return, the worst whole quarter's return and the window's
    annual return over its days without the best whole quarter. Not read against the annual target. A slice of
    one continuous run, like dev_years. None for a window of two whole years or more, or of one quarter or less."""
    start = datetime.fromtimestamp(run["trade_start_ns"] // 10**9, timezone.utc)
    if run["trade_end_ns"] >= int(start.replace(year=start.year + 2, day=min(start.day, 28)).timestamp()) * 10**9:
        return None
    if (cut := _segments(run, 3)) is None:
        return None
    cuts, whole, returns = cut
    return {"quarters": [{"start": begin.date().isoformat(), "end": finish.date().isoformat(), "return": value,
                          "partial": k >= whole}
                         for k, ((begin, finish), value) in enumerate(zip(itertools.pairwise(cuts), returns,
                                                                          strict=True))],
            "worst_quarter_return": min(returns[:whole]),
            "return_without_best_quarter": _without_best(cuts, whole, returns)}
