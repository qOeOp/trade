"""Read-time measures (`report.derive_measures`), shared by the single-run and the comparison report.

Everything here is computed from what the ledger stores for a sealed run (its position cycles, its
daily series and its sealed result) plus, for the market exposure and the volatility regimes, the
market's daily returns. Each
measure is `name@version`; a version computes the same value at any time, and a definition change
is a new version. A measure that cannot be given is None with a named reason; nothing is guessed.
`run_facts` reads one run's stored facts; the functions below it are pure.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import math
import statistics

import numpy as np
import numpy.typing as npt

from ledger import db, metrics
from registration import duties
from report import profit


DAY_NS = metrics.DAY_NS
HOUR_NS = 3_600 * 10**9
MINUTE_NS = 60 * 10**9
TOP = 5
# Read-time explanations, not new measure definitions or sealed facts.
MEASURE_NOTES = {
    "level_term": "Account-currency PnL decomposition on exposed days: T * mean(N) * mean(PnL/N). "
                  "N is contemporaneous marked gross notional; this is descriptive, not scale-free.",
    "timing_term": "Account-currency PnL decomposition on exposed days: T * population_cov(N, PnL/N). "
                   "N is contemporaneous marked gross notional. Scaling both N and PnL scales this term; "
                   "passive price changes, compounding and costs can affect it. Its sign alone does not "
                   "identify active sizing skill or exposure in rising versus falling months.",
    "residual_after_top5_days": "Sum of daily log contributions after removing up to five in the direction "
                                "of their total: the largest when total >= 0, the smallest when total < 0. "
                                "This is descriptive concentration, not evidence for a filter or forecast horizon.",
}
# Definition versions; the drawdown measures are the sealed result's (ledger.metrics, @2 reads no
# account row after its bar label).
VERSIONS = {"annual_return": 1, "plan_win_rate": 1, "sharpe_365": 1, "mark_max_drawdown": 2,
            "price": 1, "fee": 1, "funding": 1, "open_mark": 1, "account": 1,
            "mean_notional": 1, "unit_return": 1, "level_term": 1, "timing_term": 1, "up_month_notional": 1,
            "down_month_notional": 1, "return_over_drawdown": 1,
            "breakeven_fee_multiple": 1,
            "top5_abs_share": 1, "one_side_instruments": 1, "long_net": 1, "short_net": 1,
            "daily_turnover": 1,
            # @2: the standard error's Bartlett bandwidth is Newey-West (1994)'s automatic one
            "beta_basket": 1, "alpha_basket": 2, "beta_btc": 1, "alpha_btc": 2,
            "months_won_share": 1, "residual_after_top5_days": 1, "sharpe_lo": 1,
            "high_vol_days": 1, "high_vol_mean_log": 1, "high_vol_log_sum": 1,
            "low_vol_days": 1, "low_vol_mean_log": 1, "low_vol_log_sum": 1,
            "cycles": 1, "win_rate": 1, "avg_win": 1, "avg_loss": 1, "expectancy": 1, "median_holding_hours": 1,
            "top_exit_share": 1,
            "matched_share": 1, "matched_net_share": 1, "removed_net": 2, "added_net": 2, "matched_delta_net": 2,
            "win_to_loss": 2, "loss_to_win": 2, "median_entry_shift_minutes": 1,
            "max_drawdown": 2, "drawdown_days": 2, "top_instrument_share_in_drawdown": 3}
HEADLINE = ("annual_return", "mark_max_drawdown", "plan_win_rate", "sharpe_365", "sharpe_lo")
COMPARISON_ONLY = frozenset({"trade_pairs"})
SEALED_DRAWDOWN = {"max_drawdown": "mark_max_drawdown@2", "mark_max_drawdown": "mark_max_drawdown@2",
                   "drawdown_days": "duration_days@2",
                   "top_instrument_share_in_drawdown": "top_instrument_share_in_drawdown@3"}
CATALOGUE_REVISION = metrics.CATALOGUE
ANNUAL_DAYS = 365
BARTLETT_GAMMA = 1.1447  # Newey-West (1994) c_gamma of the Bartlett kernel (q = 1)
REGIME_WINDOW = 30  # days of basket returns before a day that label its volatility regime


def key(name: str) -> str:
    return f"{name}@{VERSIONS[name]}"


def measure(value, population: str, sample_size: int | None, null_reason: str | None = None) -> dict:
    """One measure: a value, or None with the reason it cannot be given."""
    if value is None and null_reason is None:
        null_reason = "NOT_COMPUTABLE: no value for this population"
    return {"value": value, "population": population, "sample_size": sample_size,
            "null_reason": None if value is not None else null_reason}


def money(value: Decimal | None) -> str | None:
    return metrics.money(value)


# Stored facts of one run

def _ns(moment: datetime) -> int:
    moment = moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment
    return int(moment.timestamp()) * 10**9 + moment.microsecond * 1000


def _mapping(value: object) -> Mapping:
    return value if isinstance(value, Mapping) else {}


def run_facts(conn: db.LedgerConnection, trial_id: int) -> dict:
    """What derive_measures reads for one run: the run and trial rows, the latest sealed result, the
    daily series and position cycles as stored, the starting balance of the account terms, the final
    equity the sealed facts record, the trading window and the input identity."""
    loaded = metrics.load_run(conn, trial_id)
    sealed = metrics.latest_sealed(conn, trial_id, loaded["sealed"])
    capture = loaded["capture"]
    coverage = _mapping(capture.get("input_coverage"))
    config = _mapping(coverage.get("effective_config"))
    account = _mapping(config.get("account"))
    starting = account.get("starting_balance_usdt")
    compounding = ((sealed or {}).get("activity") or {}).get("returns_compound_to_equity@1") or {}
    trial = loaded["trial"]
    return {"run": loaded["run"], "trial": trial, "sealed": sealed, "capture": capture, "evidence": loaded["evidence"],
            "returns": [(int(ts), float(value), mean) for ts, value, mean in loaded["returns"]],
            "cycles": profit.complete_cycles(loaded["cycles"], profit.native_economics(capture)),
            "stored_cycles": loaded["cycles"], "native_economics": profit.native_economics(capture), "effective_config": dict(config),
            "starting_balance": Decimal(str(starting)) if starting is not None else None,
            "final_equity": Decimal(str(compounding["final_equity"])) if compounding.get("final_equity") else None,
            "trade_start_ns": _ns(trial["trade_start"]), "trade_end_ns": _ns(trial["trade_end"]),
            "input_identity": (capture.get("start") or {}).get("input_identity") or {}}


# Pure helpers

def annual_return(growth: float | None, days: float) -> float | None:
    """(final / initial) ** (365 / days) - 1 over the actual trading-window length in days."""
    if growth is None or growth <= 0 or days <= 0:
        return None
    return growth ** (365 / days) - 1


def sharpe_365(returns: Sequence[float]) -> float | None:
    """Mean over sample standard deviation of the daily simple returns, times sqrt(365)."""
    if len(returns) < 2:
        return None
    deviation = statistics.stdev(returns)
    return None if deviation == 0 else statistics.fmean(returns) / deviation * math.sqrt(365)


def lag_selection(observations: int) -> int:
    """Newey-West (1994)'s lag selection parameter n = floor(4 (T / 100) ** (2 / 9)): where the
    autocovariance sums that estimate the bandwidth are truncated (not the bandwidth itself)."""
    return int(math.floor(4 * (observations / 100) ** (2 / 9)))


def automatic_bandwidth(series: Sequence[float]) -> tuple[int, int]:
    """Newey-West (1994) automatic bandwidth of the Bartlett kernel for the scalar series w'h_t
    (eqs. 3-8 to 3-13, without prewhitening): sigma_j = T^-1 sum_{t>j} h_t h_(t-j) for j = 0..n,
    s0 = sigma_0 + 2 sum sigma_j, s1 = 2 sum j sigma_j, gamma = 1.1447 ((s1 / s0) ** 2) ** (1 / 3),
    m = floor(gamma T ** (1 / 3)), at most T - 1. Returns (m, n); m is 0 when the series is all zero."""
    h = np.asarray(series, dtype=float)
    count = len(h)
    n = min(lag_selection(count), count - 1)
    sigma = [float(h[j:] @ h[:count - j]) / count for j in range(n + 1)]
    s0 = sigma[0] + 2 * sum(sigma[1:])
    s1 = 2 * sum(j * value for j, value in enumerate(sigma) if j)
    if s0 == 0:
        return 0, n
    gamma = BARTLETT_GAMMA * ((s1 / s0) ** 2) ** (1 / 3)
    return min(int(math.floor(gamma * count ** (1 / 3))), count - 1), n


def ols_newey_west(y: npt.ArrayLike, x: np.ndarray, lags: int) -> tuple[np.ndarray, np.ndarray]:
    """OLS coefficients and their heteroskedasticity- and autocorrelation-consistent covariance
    (Bartlett weights 1 - l / (lags + 1))."""
    y = np.asarray(y, dtype=float)
    x = np.asarray(x, dtype=float)
    beta, *_ = np.linalg.lstsq(x, y, rcond=None)
    residual = y - x @ beta
    scores = x * residual[:, None]
    middle = scores.T @ scores
    for lag in range(1, lags + 1):
        weight = 1 - lag / (lags + 1)
        gamma = scores[lag:].T @ scores[:-lag]
        middle += weight * (gamma + gamma.T)
    bread = np.linalg.inv(x.T @ x)
    return beta, bread @ middle @ bread


def coefficient_bandwidth(y: npt.ArrayLike, x: np.ndarray, index: int) -> tuple[int, int]:
    """The automatic bandwidth for the variance of coefficient `index`: the weight vector is
    w_T = alpha' H_T with alpha selecting that coefficient and H_T = (X'X / T)^-1 (Newey-West 1994,
    section III, the OLS case), so w'h_t is that coefficient's row of the inverse times x_t e_t."""
    y = np.asarray(y, dtype=float)
    x = np.asarray(x, dtype=float)
    beta, *_ = np.linalg.lstsq(x, y, rcond=None)
    weight = np.linalg.inv(x.T @ x / len(y))[index]
    return automatic_bandwidth((x * (y - x @ beta)[:, None]) @ weight)


def market_regression(y: Sequence[float], market: Sequence[float]) -> dict:
    """y_t = a + b0 m_t + b1 m_(t-1) + e_t from the second day on (Dimson's one-day lag);
    beta = b0 + b1, alpha = a per day with its Newey-West standard error at the automatic bandwidth
    for the intercept (`lags`; `lag_selection` is the truncation that estimated it)."""
    if len(y) != len(market) or len(y) < 5:
        raise ValueError("the regression needs two aligned series of at least five days")
    m = np.asarray(market, dtype=float)
    x = np.column_stack([np.ones(len(m) - 1), m[1:], m[:-1]])
    target = np.asarray(y, dtype=float)[1:]
    lags, selection = coefficient_bandwidth(target, x, 0)
    beta, covariance = ols_newey_west(target, x, lags)
    return {"beta": float(beta[1] + beta[2]), "alpha": float(beta[0]), "alpha_se": float(math.sqrt(covariance[0, 0])),
            "lags": lags, "lag_selection": selection, "days": len(m) - 1}


def autocorrelations(values: Sequence[float], lags: int) -> list[float]:
    """Sample autocorrelations rho_1..rho_lags: sum_{t>k} (r_t - mean)(r_(t-k) - mean) over sum (r_t - mean)^2."""
    r = np.asarray(values, dtype=float) - statistics.fmean(values)
    total = float(r @ r)
    return [float(r[k:] @ r[:len(r) - k]) / total for k in range(1, lags + 1)]


def sharpe_lo(returns: Sequence[float], periods: int = ANNUAL_DAYS) -> dict | None:
    """Lo (2002)'s annual Sharpe ratio under serial correlation: the daily Sharpe ratio (mean over
    sample standard deviation of the simple returns) times eta(q) = q / sqrt(q + 2 sum_k (q - k) rho_k)
    with q = 365; the autocorrelations beyond `lags` = lag_selection(T) are taken as zero. None when
    the returns do not vary, the series is shorter than lags + 2, or the bracket is not positive."""
    lags = lag_selection(len(returns))
    if len(returns) < lags + 2 or lags < 1 or statistics.stdev(returns) == 0:
        return None
    rho = autocorrelations(returns, lags)
    bracket = periods + 2 * sum((periods - k) * value for k, value in enumerate(rho, 1))
    if bracket <= 0:
        return None
    eta = periods / math.sqrt(bracket)
    return {"value": statistics.fmean(returns) / statistics.stdev(returns) * eta, "eta": eta, "lags": lags,
            "autocorrelations": rho}


def regime_labels(market: Mapping | None, days: Sequence[str]) -> tuple[dict[str, str | None] | None, str | None]:
    """Each day's volatility regime from the equal-weight basket's daily returns known before it: "high"
    when the absolute basket return of the prior day is above the median absolute basket return of
    the REGIME_WINDOW days ending the prior day, else "low"; None (unlabelled) when one of those days
    has no basket return."""
    if market is None:
        return None, "MARKET_RETURNS_UNAVAILABLE: no market daily returns were read"
    if isinstance(market.get("error"), str):
        return None, market["error"]
    # A shorter series leaves its last days missing, which the caller reports.
    basket = dict(zip(market.get("days") or [], market.get("basket") or [], strict=False))
    found: dict[str, str | None] = {}
    for day in days:
        moment = datetime.fromisoformat(day)
        prior = [basket.get((moment - k * timedelta(days=1)).date().isoformat()) for k in range(1, REGIME_WINDOW + 1)]
        known = [value for value in prior if value is not None]
        if len(known) != len(prior):
            found[day] = None
            continue
        found[day] = "high" if abs(known[0]) > statistics.median(abs(value) for value in known) else "low"
    return found, None


def level_timing(notional: Sequence[float], pnl: Sequence[float]) -> dict:
    """Daily PnL as notional times unit return over the exposed days: their total splits into a level
    term T * mean(N) * mean(u) and a timing term T * cov(N, u) (population covariance), summing exactly;
    the days without exposure are counted apart with their PnL (flat_days, flat_pnl)."""
    exposed = [(n, p / n) for n, p in zip(notional, pnl, strict=True) if n > 0]
    flat = [p for n, p in zip(notional, pnl, strict=True) if n <= 0]
    if not exposed:
        return {"level": None, "timing": None, "exposed_days": 0, "flat_days": len(flat), "flat_pnl": sum(flat)}
    count = len(exposed)
    mean_n = sum(n for n, _ in exposed) / count
    mean_u = sum(u for _, u in exposed) / count
    covariance = sum((n - mean_n) * (u - mean_u) for n, u in exposed) / count
    return {"level": count * mean_n * mean_u, "timing": count * covariance, "exposed_days": count,
            "flat_days": len(flat), "flat_pnl": sum(flat)}


def residual_after_top(values: Sequence[float], top: int = TOP) -> float | None:
    """The sum left after removing the `top` values that contribute most in the direction of the total."""
    if not values:
        return None
    total = sum(values)
    ordered = sorted(values, reverse=total >= 0)
    return total - sum(ordered[:top])


def top_share(values: Sequence, top: int = TOP) -> float | None:
    """The share of the `top` largest absolute values in the sum of all absolute values."""
    absolute = sorted((abs(value) for value in values), reverse=True)
    total = sum(absolute)
    return None if not total else float(sum(absolute[:top]) / total)


def breakeven_multiple(difference: Decimal, fee_difference: Decimal) -> tuple[float | None, str | None]:
    """The multiple k of both sides' fees at which the account difference reaches zero:
    difference - (k - 1) * fee_difference = 0 (fees are net of maker rebates). A candidate that pays
    less in fees and still wins never reaches zero: raising both fees only widens its lead."""
    if fee_difference == 0:
        return None, "NEVER_ZERO: the fees do not differ, so no multiple moves the difference"
    if fee_difference < 0 and difference > 0:
        return None, "NEVER_ZERO: the candidate pays less in fees and still wins; higher fees widen its lead"
    multiple = 1 + difference / fee_difference
    if multiple < 0:
        return None, "NEVER_ZERO: no nonnegative fee multiple brings the difference to zero"
    return float(multiple), None


def expectancy_split(control: Mapping, candidate: Mapping) -> dict | None:
    """Expectancy E = w W + (1 - w) L split into a win-rate part and a payoff part, each the mean of
    its marginal effect over both orders of change (Shapley); the parts sum to the difference."""
    try:
        w0, w1 = control["win_rate"], candidate["win_rate"]
        p0, p1 = (control["avg_win"], control["avg_loss"]), (candidate["avg_win"], candidate["avg_loss"])
    except KeyError:
        return None
    if None in (w0, w1, *p0, *p1):
        return None

    def value(w, payoff):
        return w * payoff[0] + (1 - w) * payoff[1]

    rate = ((value(w1, p0) - value(w0, p0)) + (value(w1, p1) - value(w0, p1))) / 2
    payoff = ((value(w0, p1) - value(w0, p0)) + (value(w1, p1) - value(w1, p0))) / 2
    return {"win_rate_part": rate, "payoff_part": payoff, "difference": value(w1, p1) - value(w0, p0)}


# Per-run building blocks

def _closed(cycles: list[dict]) -> list[dict]:
    return [cycle for cycle in cycles if cycle["ts_closed_ns"] is not None]


def instrument_net(cycles: list[dict]) -> dict[str, Decimal]:
    found: defaultdict[str, Decimal] = defaultdict(Decimal)
    for cycle in _closed(cycles):
        found[cycle["instrument_id"]] += Decimal(cycle["realized_pnl"])
    return dict(found)


def exit_net(cycles: list[dict]) -> dict[str, Decimal]:
    found: defaultdict[str, Decimal] = defaultdict(Decimal)
    for cycle in _closed(cycles):
        found[cycle["closing_order_type"] or "UNKNOWN"] += Decimal(cycle["realized_pnl"])
    return dict(found)


def month_logs(returns: list[tuple]) -> dict[str, float]:
    found: defaultdict[str, float] = defaultdict(float)
    for ts, value, _ in returns:
        found[datetime.fromtimestamp(ts // 10**9, timezone.utc).strftime("%Y-%m")] += math.log1p(value)
    return dict(found)


def day_of(ts: int) -> str:
    return datetime.fromtimestamp(ts // 10**9, timezone.utc).date().isoformat()


def aligned_market(returns: list[tuple], market: Mapping | None, series: str) -> tuple[list[float] | None, str | None]:
    """The market series aligned to the run's days; None with the reason when a day lacks it."""
    if market is None:
        return None, "MARKET_RETURNS_UNAVAILABLE: no market daily returns were read"
    if isinstance(market.get("error"), str):
        return None, market["error"]
    # A shorter series leaves its last days missing: MARKET_RETURNS_INCOMPLETE below.
    by_day = dict(zip(market.get("days") or [], market.get(series) or [], strict=False))
    days = [day_of(ts) for ts, _, _ in returns]
    missing = [day for day in days if by_day.get(day) is None]
    if missing:
        return None, f"MARKET_RETURNS_INCOMPLETE: no {series} return on {', '.join(missing[:3])}"
    return [by_day[day] for day in days], None


def basket_months(returns: list[tuple], market: Mapping | None) -> tuple[dict[str, float] | None, str | None]:
    values, reason = aligned_market(returns, market, "basket")
    if values is None:
        return None, reason
    found: defaultdict[str, float] = defaultdict(float)
    for (ts, _, _), value in zip(returns, values, strict=True):
        found[day_of(ts)[:7]] += math.log1p(value)
    return dict(found), None


def daily_pnl(returns: list[tuple], starting: Decimal) -> list[float]:
    equity, found = float(starting), []
    for _, value, _ in returns:
        found.append(equity * value)
        equity *= 1 + value
    return found


def derive_measures(run: Mapping, catalogue: dict | None = None, market: Mapping | None = None) -> dict:
    """{name@version: {value, population, sample_size, null_reason}} of one run's stored facts
    (`run_facts`), for every measure of the catalogue's single-run slices and the headline."""
    catalogue = catalogue or duties.measure_catalogue()
    sealed = run.get("sealed") or {}
    returns, cycles = list(run["returns"]), list(run["cycles"])
    closed = _closed(cycles)
    days = len(returns)
    window_days = (run["trade_end_ns"] - run["trade_start_ns"]) / DAY_NS
    activity = sealed.get("activity") or {}
    compounds = (activity.get("returns_compound_to_equity@1") or {}).get("passed") is True
    series_reason = None if compounds and returns else "RETURN_SERIES_UNUSABLE: the daily series does not compound " \
                                                       "to the final equity"
    found: dict[str, dict] = {}

    def put(name: str, value, population: str, size: int | None, reason: str | None = None):
        found[key(name)] = measure(value, population, size, reason)
        if name in MEASURE_NOTES:
            found[key(name)]["definition_note"] = MEASURE_NOTES[name]

    growth = math.prod(1 + value for _, value, _ in returns) if returns else None
    annual = annual_return(growth, window_days) if series_reason is None else None
    put("annual_return", annual, "account_days", days, series_reason or (None if annual is not None else
                                                                          "NONPOSITIVE_EQUITY: no annual return"))
    sharpe = sharpe_365([value for _, value, _ in returns]) if series_reason is None else None
    put("sharpe_365", sharpe, "account_days", days, series_reason or "ZERO_VARIANCE: the daily returns do not vary")
    adjusted = sharpe_lo([value for _, value, _ in returns]) if series_reason is None else None
    put("sharpe_lo", None if adjusted is None else adjusted["value"], "account_days", days,
        series_reason or "NOT_COMPUTABLE: the daily returns do not vary, are too few for their lags, or their "
                         "autocorrelations leave no positive variance")
    if adjusted is not None:
        found[key("sharpe_lo")].update(eta=adjusted["eta"], lags=adjusted["lags"],
                                       autocorrelations=adjusted["autocorrelations"])
    drawdown = sealed.get("drawdown") or {}
    for name, sealed_key in SEALED_DRAWDOWN.items():
        item = drawdown.get(sealed_key) or {}
        put(name, item.get("value"), "bars", (sealed.get("populations") or {}).get("bars"),
            None if item.get("value") is not None else item.get("null_reason") or
            "SEALED_DRAWDOWN_MISSING: the sealed result has no reading for this definition")
    plans_valid = sealed.get("plans_valid@1") or {}
    if plans_valid.get("passed") is not True:
        put("plan_win_rate", None, "plans", None, f"{plans_valid.get('code') or 'PLANS_UNAVAILABLE'}: the plan "
                                                  "contract does not hold for this run")
    elif any(cycle["plan_tag"] is None for cycle in cycles):
        put("plan_win_rate", None, "plans", None, "PLAN_TAG_MISSING: a position cycle has no plan tag")
    else:
        plans = defaultdict(list)
        for cycle in cycles:
            plans[cycle["plan_tag"]].append(cycle)
        won = sum(1 for items in plans.values() if all(item["ts_closed_ns"] is not None for item in items)
                  and sum(Decimal(item["realized_pnl"]) for item in items) > 0)
        put("plan_win_rate", won / len(plans) if plans else None, "plans", len(plans),
            None if plans else "NO_PLANS: the run holds no plan")

    # profit_bridge
    starting, final = run.get("starting_balance"), run.get("final_equity")
    bridge = profit.account_bridge(run.get("stored_cycles", cycles), starting, final, run.get("native_economics"))
    # Legacy residual cycle readings are descriptive. Audit the original stored rows separately.
    for name, value in bridge["values"].items():
        put(name, money(value), "account", len(cycles), bridge["reason"])

    # capital_scaled
    notional = [mean for _, _, mean in returns]
    capital_reason = series_reason
    if capital_reason is None and (not notional or any(mean is None for mean in notional)):
        capital_reason = "EXPOSURE_SERIES_MISSING: a day has no mean gross notional"
    if capital_reason is None and starting is None:
        capital_reason = "ACCOUNT_UNKNOWN: the starting balance is not recorded"
    if capital_reason is None and starting is not None:
        n = [float(mean) for mean in notional]
        pnl = daily_pnl(returns, starting)
        mean_n = sum(n) / len(n)
        split = level_timing(n, pnl)
        put("mean_notional", mean_n, "account_days", days)
        put("unit_return", float(final - starting) / mean_n if mean_n and final is not None else None, "account_days",
            days, "FLAT: the run held no exposure" if not mean_n else "ACCOUNT_UNKNOWN: no final equity")
        put("level_term", split["level"], "exposed_days", split["exposed_days"], "FLAT: the run held no exposure")
        put("timing_term", split["timing"], "exposed_days", split["exposed_days"], "FLAT: the run held no exposure")
        for name in ("level_term", "timing_term"):  # the days without exposure are listed apart (R.3.2.2)
            found[key(name)].update(flat_days=split["flat_days"], flat_pnl=split["flat_pnl"])
        months, reason = basket_months(returns, market)
        up = [value for (ts, _, _), value in zip(returns, n, strict=True)
              if months and months.get(day_of(ts)[:7], 0) > 0]
        down = [value for (ts, _, _), value in zip(returns, n, strict=True)
                if months and months.get(day_of(ts)[:7], 0) <= 0]
        put("up_month_notional", sum(up) / len(up) if up else None, "basket_up_days", len(up),
            reason or "NO_UP_MONTH: the basket rose in no month")
        put("down_month_notional", sum(down) / len(down) if down else None, "basket_down_days", len(down),
            reason or "NO_DOWN_MONTH: the basket fell in no month")
    else:
        for name in ("mean_notional", "unit_return", "level_term", "timing_term", "up_month_notional",
                     "down_month_notional"):
            put(name, None, "account_days", days, capital_reason)
    drawn = (drawdown.get("mark_max_drawdown@2") or {}).get("value")
    put("return_over_drawdown", annual / drawn if annual is not None and drawn else None, "account_days", days,
        "NO_DRAWDOWN: the annual return or the mark drawdown is missing or zero")

    bridge_reason = bridge["reason"]
    account = bridge["values"]["account"]
    fees = -bridge["values"]["fee"] if bridge["values"]["fee"] is not None else None

    # fee_stress
    if bridge_reason is None and account is not None:
        multiple, reason = breakeven_multiple(account, fees) if fees else (None, "NO_FEES: the run paid no fees")
        put("breakeven_fee_multiple", multiple, "account", len(cycles), reason)
    else:
        put("breakeven_fee_multiple", None, "account", len(cycles), bridge_reason)
    turnover, fills, reason = daily_turnover(sealed.get("fees_by_liquidity_side@2"), starting, window_days)
    put("daily_turnover", turnover, "fills", fills, reason)

    # by_instrument
    nets = instrument_net(cycles)
    put("top5_abs_share", top_share(list(nets.values())), "instruments", len(nets), "NO_CLOSED_CYCLE: no closed "
                                                                                    "cycle")
    put("one_side_instruments", None, "instruments", len(nets), "COMPARISON_ONLY: counted across two runs")
    for name, side in (("long_net", "long"), ("short_net", "short")):
        put(name, money(sum((Decimal(cycle["realized_pnl"]) for cycle in closed if cycle["side"] == side),
                            Decimal(0))), "closed_cycles", sum(1 for cycle in closed if cycle["side"] == side))

    # market_exposure
    simple = [value for _, value, _ in returns]
    for series, beta_name, alpha_name in (("basket", "beta_basket", "alpha_basket"), ("btc", "beta_btc", "alpha_btc")):
        values, reason = aligned_market(returns, market, series)
        reason = series_reason or reason
        if reason is None and values is not None:
            try:
                fitted = market_regression(simple, values)
            except (ValueError, np.linalg.LinAlgError) as exc:
                reason = f"REGRESSION_UNAVAILABLE: {exc}"
        if reason is None:
            put(beta_name, fitted["beta"], "account_days", fitted["days"])
            put(alpha_name, fitted["alpha"], "account_days", fitted["days"])
            found[key(alpha_name)].update(standard_error=fitted["alpha_se"], lags=fitted["lags"],
                                          lag_selection=fitted["lag_selection"])
        else:
            put(beta_name, None, "account_days", days, reason)
            put(alpha_name, None, "account_days", days, reason)

    # by_period
    months = month_logs(returns)
    put("months_won_share", sum(1 for value in months.values() if value > 0) / len(months) if months and
        series_reason is None else None, "months", len(months), series_reason or "NO_MONTH: no daily return")
    logs = [math.log1p(value) for _, value, _ in returns]
    put("residual_after_top5_days", residual_after_top(logs) if series_reason is None else None, "account_days", days,
        series_reason or "NO_DAY: no daily return")

    # by_regime
    labels, reason = regime_labels(market, [day_of(ts) for ts, _, _ in returns])
    reason = series_reason or reason
    unlabelled = None if labels is None else sum(1 for value in labels.values() if value is None)
    for regime in ("high", "low"):
        logs_in = [math.log1p(value) for ts, value, _ in returns if labels and labels.get(day_of(ts)) == regime]
        empty = reason or (f"NO_{regime.upper()}_VOL_DAY: no labelled day of the window is in this regime "
                           f"({unlabelled} days unlabelled)")
        put(f"{regime}_vol_days", len(logs_in) if reason is None else None, "account_days", days, reason)
        found[key(f"{regime}_vol_days")].update(unlabelled_days=unlabelled)
        put(f"{regime}_vol_mean_log", sum(logs_in) / len(logs_in) if logs_in and reason is None else None,
            "regime_days", len(logs_in), empty)
        put(f"{regime}_vol_log_sum", sum(logs_in) if logs_in and reason is None else None, "regime_days",
            len(logs_in), empty)

    # trade_structure
    wins = [Decimal(cycle["realized_pnl"]) for cycle in closed if Decimal(cycle["realized_pnl"]) > 0]
    losses = [Decimal(cycle["realized_pnl"]) for cycle in closed if Decimal(cycle["realized_pnl"]) <= 0]
    count, empty = len(closed), "NO_CLOSED_CYCLE: no closed cycle"
    put("cycles", count, "closed_cycles", count)
    put("win_rate", len(wins) / count if count else None, "closed_cycles", count, empty)
    win_total, loss_total = sum(wins, Decimal(0)), sum(losses, Decimal(0))
    put("avg_win", money(win_total / len(wins)) if wins else None, "closed_cycles", len(wins), "NO_WIN: no winning cycle")
    put("avg_loss", money(loss_total / len(losses)) if losses else None, "closed_cycles", len(losses),
        "NO_LOSS: no losing cycle")
    put("expectancy", money((win_total + loss_total) / count) if count else None, "closed_cycles", count, empty)
    hours = [(cycle["ts_closed_ns"] - cycle["ts_opened_ns"]) / HOUR_NS for cycle in closed]
    put("median_holding_hours", statistics.median(hours) if hours else None, "closed_cycles", count, empty)
    exits = exit_net(cycles)
    put("top_exit_share", top_share(list(exits.values()), 1), "exit_classes", len(exits), empty)

    # drawdown: the sealed values above (max_drawdown, drawdown_days, top_instrument_share_in_drawdown)
    wanted = {key(name) for name in HEADLINE} | {key(name) for item in catalogue["slices"]
                                                 if item["id"] not in COMPARISON_ONLY for name in item["measures"]}
    return {name: value for name, value in found.items() if name in wanted}


def daily_turnover(sides: Mapping | None, starting: Decimal | None,
                   days: float) -> tuple[float | None, int | None, str | None]:
    """(turnover, fills, reason): the sealed traded notional of every liquidity side over the starting
    balance, per day of the trading window."""
    if not isinstance(sides, Mapping):
        return None, None, "FEES_UNAVAILABLE: the sealed result has no fees by liquidity side"
    fills = sum(int(item.get("fills") or 0) for item in sides.values())
    if not starting or days <= 0:
        return None, fills, "ACCOUNT_UNKNOWN: no starting balance or no trading day"
    notional = sum((Decimal(item["notional"]) for item in sides.values() if item.get("notional")), Decimal(0))
    return float(notional / starting) / days, fills, None


def closed_by_year(cycles: list[dict]) -> dict:
    """Closed cycles' count, price PnL, commissions and funding by the UTC year of their close."""
    years: dict[str, dict] = {}
    for cycle in _closed(cycles):
        year = str(datetime.fromtimestamp(cycle["ts_closed_ns"] // 10**9, timezone.utc).year)
        item = years.setdefault(year, {"closed_trades": 0, "price": Decimal(0), "commissions": Decimal(0),
                                       "funding": Decimal(0)})
        item["closed_trades"] += 1
        item["price"] += Decimal(cycle["price_pnl"])
        item["commissions"] += Decimal(cycle["commissions"])
        item["funding"] += Decimal(cycle["funding"])
    return {year: {"closed_trades": item["closed_trades"], "price_pnl_usdt": money(item["price"]),
                   "fill_commissions_usdt": money(item["commissions"]), "reported_funding_usdt": money(item["funding"])}
            for year, item in sorted(years.items())}


def market_for(run: Mapping) -> dict | None:
    """The market's daily returns over the run's trading window and the REGIME_WINDOW days before it
    (report.seams.market_returns); a failure becomes {error} so that only the market measures are empty."""
    from ledger.errors import Refusal
    from report import seams
    identity = run.get("input_identity") or {}
    try:
        return seams.current.market_returns(identity.get("market_database"), identity.get("market_commit"),
                                            identity.get("universe_rule"),
                                            datetime.fromtimestamp(run["trade_start_ns"] // 10**9, timezone.utc)
                                            - timedelta(days=REGIME_WINDOW),
                                            datetime.fromtimestamp(run["trade_end_ns"] // 10**9, timezone.utc))
    except Refusal as exc:
        return {"error": f"{exc.code}: {exc.message}"}
    except Exception as exc:  # the market database is another service; its failure empties only these measures
        return {"error": f"MARKET_RETURNS_UNAVAILABLE: {type(exc).__name__}: {exc}"}

