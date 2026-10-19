"""The attribution part of the comparison report (`report.attribution`) and the one trade pairing
algorithm (`report.pair_trades`).

Both sides' measures come from the same read-time derivation as the single-run report; each catalogue
measure is given for both sides with their difference (candidate minus control), and where the
comparison has its own definition (the pair's breakeven fee multiple, the concentration of
per-instrument and per-day differences, months won, the regression of the daily difference on the
market, the expectancy split, trade pairing) that pairwise value is given beside it. Registered
predictions are checked for sign only. Nothing is tested again and nothing is written.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from datetime import timezone
from decimal import Decimal
import math
import statistics

from ledger.refusals import refuse
from registration import duties
from report import measures


MINUTE_NS = measures.MINUTE_NS


def _ns(moment) -> int:
    if isinstance(moment, int):
        return moment
    moment = moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment
    return int(moment.timestamp()) * 10**9 + moment.microsecond * 1000


def _net(cycle: Mapping) -> Decimal | None:
    """A closed cycle's realized PnL (after commissions and funding); None while it is open."""
    return None if cycle["ts_closed_ns"] is None else Decimal(cycle["realized_pnl"])


def _value(cycle: Mapping) -> Decimal:
    """A cycle's PnL: realized when closed, its final mark (open_unrealized) while open."""
    found = _net(cycle)
    return found if found is not None else Decimal(cycle["open_unrealized"] or 0)


def _rank(values: list[float], share: float):
    """The nearest-rank lower quantile: the value at index floor(share * (n - 1)) of the sorted values."""
    return values[int(share * (len(values) - 1))] if values else None


def _sums(cycles: list[Mapping]) -> dict:
    closed = [cycle for cycle in cycles if cycle["ts_closed_ns"] is not None]
    return {"count": len(cycles), "price": measures.money(sum((Decimal(c["price_pnl"]) for c in closed), Decimal(0))),
            "fee": measures.money(-sum((Decimal(c["commissions"]) for c in cycles), Decimal(0))),
            "funding": measures.money(sum((Decimal(c["funding"]) for c in cycles), Decimal(0))),
            "net": measures.money(sum((_value(c) for c in cycles), Decimal(0)))}


def _minus(left: dict, right: dict) -> dict:
    return {key: (left[key] - right[key] if key == "count" else
                  measures.money(Decimal(left[key]) - Decimal(right[key]))) for key in left}


def pair_trades(control: list[dict], candidate: list[dict], window_end) -> dict:
    """Pair the two sides' position cycles: one-to-one, split or merged, only in the control, only in
    the candidate. Grouped by instrument and side (never by position ID or PnL); two cycles of a
    group are a candidate pair when their holding intervals intersect, with overlap = intersection
    over union; pairs are taken one to one by overlap, highest first (ties: the earlier opening
    first); an unpaired cycle intersecting a paired cycle of the other side is split or merged. An
    open cycle's interval ends at `window_end` and its PnL is its final mark. Descriptive only; it
    never enters the test."""
    end = _ns(window_end)

    def span(cycle):
        return cycle["ts_opened_ns"], cycle["ts_closed_ns"] if cycle["ts_closed_ns"] is not None else end

    groups: dict[tuple, tuple[list[int], list[int]]] = defaultdict(lambda: ([], []))
    for index, cycle in enumerate(control):
        groups[(cycle["instrument_id"], cycle["side"])][0].append(index)
    for index, cycle in enumerate(candidate):
        groups[(cycle["instrument_id"], cycle["side"])][1].append(index)
    options = []
    for left, right in groups.values():
        for i in left:
            a0, a1 = span(control[i])
            for j in right:
                b0, b1 = span(candidate[j])
                inter = min(a1, b1) - max(a0, b0)
                if inter > 0:
                    options.append((inter / (max(a1, b1) - min(a0, b0)), min(a0, b0), i, j))
    options.sort(key=lambda item: (-item[0], item[1], item[2], item[3]))
    used_a, used_b, pairs = set(), set(), []
    for overlap, _, i, j in options:
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        pairs.append((i, j, overlap))

    def touches(cycle, others, used) -> bool:
        c0, c1 = span(cycle)
        return any(k in used and others[k]["instrument_id"] == cycle["instrument_id"]
                   and others[k]["side"] == cycle["side"] and min(c1, span(others[k])[1]) - max(c0, span(others[k])[0]) > 0
                   for k in range(len(others)))

    only_a = [i for i in range(len(control)) if i not in used_a]
    only_b = [j for j in range(len(candidate)) if j not in used_b]
    split_a = [i for i in only_a if touches(control[i], candidate, used_b)]
    split_b = [j for j in only_b if touches(candidate[j], control, used_a)]
    removed = [control[i] for i in only_a if i not in split_a]
    added = [candidate[j] for j in only_b if j not in split_b]
    closed_pairs = [(i, j, overlap) for i, j, overlap in pairs
                    if _net(control[i]) is not None and _net(candidate[j]) is not None]
    flips: dict[str, int] = defaultdict(int)
    for i, j, _ in pairs:
        flips[("win" if _value(control[i]) > 0 else "loss") + "_to_" + ("win" if _value(candidate[j]) > 0 else "loss")] += 1
    closed_abs = sum((abs(_net(cycle)) for cycle in [*control, *candidate] if _net(cycle) is not None), Decimal(0))
    matched_abs = sum((abs(_net(control[i])) + abs(_net(candidate[j])) for i, j, _ in closed_pairs), Decimal(0))
    overlaps = sorted(overlap for _, _, overlap in pairs)
    shifts = [(candidate[j]["ts_opened_ns"] - control[i]["ts_opened_ns"]) / MINUTE_NS for i, j, _ in pairs]
    detail = []
    for i, j, overlap in pairs:
        a, b = control[i], candidate[j]
        exit_shift = (None if a["ts_closed_ns"] is None or b["ts_closed_ns"] is None
                      else (b["ts_closed_ns"] - a["ts_closed_ns"]) / MINUTE_NS)
        difference = _value(b) - _value(a)
        detail.append({"control": a["seq"], "candidate": b["seq"], "instrument_id": a["instrument_id"],
                       "side": a["side"], "overlap": overlap,
                       "entry_shift_minutes": (b["ts_opened_ns"] - a["ts_opened_ns"]) / MINUTE_NS,
                       "exit_shift_minutes": exit_shift, "net_difference": measures.money(difference),
                       "flip": ("win" if _value(a) > 0 else "loss") + "_to_" + ("win" if _value(b) > 0 else "loss"),
                       "control_exit": a.get("closing_order_type"), "candidate_exit": b.get("closing_order_type")})
    matched_a, matched_b = [control[i] for i, _, _ in pairs], [candidate[j] for _, j, _ in pairs]
    return {
        "coverage": {"matched_share": 2 * len(pairs) / (len(control) + len(candidate)) if control or candidate else None,
                     "matched_net_share": float(matched_abs / closed_abs) if closed_abs else None,
                     "overlap_quantiles": {"p10": _rank(overlaps, 0.1), "p50": _rank(overlaps, 0.5),
                                           "p90": _rank(overlaps, 0.9)}},
        "classes": {"matched": {**_minus(_sums(matched_b), _sums(matched_a)), "count": len(pairs)},
                    "split_merge": {**_minus(_sums([candidate[j] for j in split_b]), _sums([control[i] for i in split_a])),
                                    "count": len(split_a) + len(split_b)},
                    "only_control": _sums(removed), "only_candidate": _sums(added)},
        "scalars": {"matched_share": 2 * len(pairs) / (len(control) + len(candidate)) if control or candidate else None,
                    "matched_net_share": float(matched_abs / closed_abs) if closed_abs else None,
                    "removed_net": _sums(removed)["net"], "added_net": _sums(added)["net"],
                    "matched_delta_net": measures.money(sum((_value(candidate[j]) - _value(control[i])
                                                             for i, j, _ in pairs), Decimal(0))),
                    "win_to_loss": flips.get("win_to_loss", 0), "loss_to_win": flips.get("loss_to_win", 0),
                    "median_entry_shift_minutes": statistics.median(shifts) if shifts else None},
        "flips": dict(sorted(flips.items())),
        "pairs": detail,
        "open": {"control": sum(1 for c in control if c["ts_closed_ns"] is None),
                 "candidate": sum(1 for c in candidate if c["ts_closed_ns"] is None),
                 "pairs_with_an_open_side": len(pairs) - len(closed_pairs),
                 "scope": "an open cycle's interval ends at the window end and its PnL is its final mark; the "
                          "matched net share counts closed cycles only"},
    }


def _difference(candidate, control):
    if candidate is None or control is None:
        return None
    if isinstance(candidate, str) or isinstance(control, str):
        return measures.money(Decimal(str(candidate)) - Decimal(str(control)))
    return candidate - control


def _pairwise(control: Mapping, candidate: Mapping, control_measures: Mapping, candidate_measures: Mapping,
              market: Mapping | None, pairs: Mapping) -> dict:
    """The comparison's own definitions, by measure name: {value, null_reason} (and detail)."""
    found: dict[str, dict] = {}

    def put(name, value, reason=None, **detail):
        found[name] = {"value": value, "null_reason": None if value is not None else
                       (reason or "NOT_COMPUTABLE: no value for this pair"), **detail}

    account_c = (candidate_measures.get(measures.key("account")) or {}).get("value")
    account_o = (control_measures.get(measures.key("account")) or {}).get("value")
    fee_c = (candidate_measures.get(measures.key("fee")) or {}).get("value")
    fee_o = (control_measures.get(measures.key("fee")) or {}).get("value")
    if None in (account_c, account_o, fee_c, fee_o):
        put("breakeven_fee_multiple", None, "BRIDGE_UNAVAILABLE: a side's profit bridge is empty")
    else:
        difference = Decimal(account_c) - Decimal(account_o)
        fee_difference = -Decimal(fee_c) + Decimal(fee_o)  # fee is stored negative: candidate pays minus control pays
        multiple, reason = measures.breakeven_multiple(difference, fee_difference)
        put("breakeven_fee_multiple", multiple, reason)
    nets_c, nets_o = measures.instrument_net(candidate["cycles"]), measures.instrument_net(control["cycles"])
    names = sorted(set(nets_c) | set(nets_o))
    put("top5_abs_share", measures.top_share([nets_c.get(name, Decimal(0)) - nets_o.get(name, Decimal(0))
                                              for name in names]), "NO_DIFFERENCE: no instrument differs")
    traded_c = {cycle["instrument_id"] for cycle in candidate["cycles"]}
    traded_o = {cycle["instrument_id"] for cycle in control["cycles"]}
    put("one_side_instruments", len(traded_c ^ traded_o))
    returns_c, returns_o = candidate["returns"], control["returns"]
    logs = [math.log1p(c) - math.log1p(o) for (_, c, _), (_, o, _) in zip(returns_c, returns_o)]
    put("residual_after_top5_days", measures.residual_after_top(logs), "NO_DAY: no aligned day")
    months_c, months_o = measures.month_logs(returns_c), measures.month_logs(returns_o)
    months = sorted(set(months_c) & set(months_o))
    put("months_won_share", sum(1 for month in months if months_c[month] > months_o[month]) / len(months)
        if months else None, "NO_MONTH: no aligned month")
    difference = [c - o for (_, c, _), (_, o, _) in zip(returns_c, returns_o)]
    for series, beta, alpha in (("basket", "beta_basket", "alpha_basket"), ("btc", "beta_btc", "alpha_btc")):
        values, reason = measures.aligned_market(returns_c, market, series)
        if values is None:
            put(beta, None, reason)
            put(alpha, None, reason)
            continue
        fitted = measures.market_regression(difference, values)
        put(beta, fitted["beta"])
        put(alpha, fitted["alpha"], standard_error=fitted["alpha_se"], lags=fitted["lags"])
    split = measures.expectancy_split(_trade_inputs(control_measures), _trade_inputs(candidate_measures))
    put("expectancy", None if split is None else split["difference"], "TRADE_STRUCTURE_UNAVAILABLE: a side has no "
                                                                      "wins or no losses",
        **({} if split is None else {"win_rate_part": split["win_rate_part"], "payoff_part": split["payoff_part"]}))
    exits_c, exits_o = measures.exit_net(candidate["cycles"]), measures.exit_net(control["cycles"])
    put("top_exit_share", measures.top_share([exits_c.get(name, Decimal(0)) - exits_o.get(name, Decimal(0))
                                              for name in sorted(set(exits_c) | set(exits_o))], 1),
        "NO_DIFFERENCE: no exit class differs")
    for name, value in pairs["scalars"].items():
        put(name, value, "NO_PAIR: no cycles to pair")
    return found


def _trade_inputs(derived: Mapping) -> dict:
    def value(name):
        item = (derived.get(measures.key(name)) or {}).get("value")
        return None if item is None else float(item)
    return {"win_rate": value("win_rate"), "avg_win": value("avg_win"), "avg_loss": value("avg_loss")}


def attribute(control: Mapping, candidate: Mapping, body: Mapping, market: Mapping | None) -> dict:
    """{metrics_revision, catalogue, slices, predictions, interaction, trade_pairs} for two runs' facts
    (report.measures.run_facts) and the registration body that declared the comparison."""
    catalogue = duties.measure_catalogue()
    derived_c = measures.derive_measures(candidate, catalogue, market)
    derived_o = measures.derive_measures(control, catalogue, market)
    pairs = pair_trades(control["cycles"], candidate["cycles"], candidate["trade_end_ns"])
    pairwise = _pairwise(control, candidate, derived_o, derived_c, market, pairs)
    slices = {}
    headline = {}
    for name in measures.HEADLINE:
        c, o = derived_c[measures.key(name)], derived_o[measures.key(name)]
        headline[measures.key(name)] = {"candidate": c["value"], "control": o["value"],
                                        "difference": _difference(c["value"], o["value"]),
                                        "null_reason": c["null_reason"] or o["null_reason"]}
    for item in catalogue["slices"]:
        found = {}
        for name in item["measures"]:
            label = measures.key(name)
            if item["id"] in measures.COMPARISON_ONLY:
                pair = pairwise[name]
                found[label] = {"candidate": None, "control": None, "difference": pair["value"],
                                "null_reason": pair["null_reason"]}
                continue
            c, o = derived_c[label], derived_o[label]
            entry = {"candidate": c["value"], "control": o["value"], "difference": _difference(c["value"], o["value"]),
                     "null_reason": c["null_reason"] or o["null_reason"],
                     "population": c["population"], "sample_size": {"candidate": c["sample_size"],
                                                                    "control": o["sample_size"]}}
            if name in pairwise:
                entry["pairwise"] = pairwise[name]
            found[label] = entry
        available = [entry for entry in found.values() if entry["difference"] is not None
                     or (entry.get("pairwise") or {}).get("value") is not None]
        slices[item["id"]] = {"title": item["title"], "duties": item["duties"], "measures": found,
                              "available": bool(available),
                              "reason": None if available else next((entry["null_reason"] for entry in found.values()
                                                                     if entry["null_reason"]), None)}
    if "interaction" in (body.get("prediction") or {}):
        raise refuse("INTERACTION_UNATTESTED", "the registration declares an interaction, but no source review record "
                                               "can confirm the shape of its four corners",
                     missing=("prediction.interaction",))
    return {"metrics_revision": measures.metrics.metrics_revision(clean=False), "catalogue": measures.CATALOGUE_REVISION,
            "headline": headline, "slices": slices, "predictions": predictions(body, slices), "interaction": None,
            "trade_pairs": pairs}


def predictions(body: Mapping, slices: Mapping) -> list[dict]:
    """Each registered prediction beside the observed difference, marked only for its sign."""
    found = []
    for item in (body.get("prediction") or {}).get("mechanism") or ():
        entry = {key: item.get(key) for key in ("slice", "measure", "direction", "duty")}
        entry["registered_reason"] = item.get("reason")
        if item.get("slice") is None:
            found.append({**entry, "observed": None, "same_sign": None,
                          "reason": "NO_SLICE: the registration names no slice measuring this duty"})
            continue
        measured = ((slices.get(item["slice"]) or {}).get("measures") or {}).get(measures.key(item["measure"])) \
            if item.get("measure") in measures.VERSIONS else None
        observed = None if measured is None else measured["difference"]
        if observed is None:
            found.append({**entry, "observed": None, "same_sign": None,
                          "reason": "UNCHECKABLE: " + ((measured or {}).get("null_reason") or "the measure is empty")})
            continue
        value = float(observed)
        found.append({**entry, "observed": observed, "same_sign": value > 0 if item["direction"] == "up" else value < 0,
                      "reason": None})
    return found


def attribution(profile, bundle: str, run_id: int, at: str | None = None) -> dict:
    """The attribution part of the comparison of `run_id` with its registered control: the same
    identity and refusals as report.compare."""
    from report import comparison
    return comparison.compare(profile, bundle, run_id, at, part="attribution")

