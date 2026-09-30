"""combo-v2 harness: development data, the fixed fill model, random controls and the look-ahead check (combo/INTENT.md).

A candidate is a module exposing `signals(bars) -> list[Signal]`, where `bars` is {"1h", "4h", "1d"} of DataFrames
(UTC index at bar open; columns open, high, low, close, volume). A Signal is (time, side, stop, target, max_bars):
`time` is the close of the 4h bar the decision is made on, `side` is 1 or -1, `stop` and `target` are prices, and
`max_bars` is a time limit in 4h bars, at most 60. The candidate may read only bars that closed at or before `time`.

Development markets: BTCUSD (Bitstamp) and ETHUSDT (Binance), 2017 to 2026-09. The holdout is not loadable from here.
"""
import os, sys
from collections import namedtuple

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

Signal = namedtuple("Signal", "time side stop target max_bars")
COST, CONTROLS, MAX_BARS = 0.0006, 20, 60
AGG = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
DEV_MARKETS = ("BTCUSD", "ETHUSDT")
_CACHE = {}


def _resample(h):
    h = h[["open", "high", "low", "close", "volume"]].astype(float)
    return {"1h": h,
            "4h": h.resample("4h", label="left", closed="left").agg(AGG).dropna(),
            "1d": h.resample("1D", label="left", closed="left").agg(AGG).dropna()}


def load(market):
    """Development bars for one market: {"1h", "4h", "1d"}."""
    if market not in DEV_MARKETS:
        raise PermissionError(f"{market} is not a development market")
    if market in _CACHE:
        return _CACHE[market]
    if market == "BTCUSD":
        h = pd.read_csv(os.path.join(ROOT, "btc_1h.csv"), index_col=0, parse_dates=True)
        h = h[h.volume > 0]
    else:
        import tv_hourly
        t0, t1 = int(pd.Timestamp("2017-07-01").value // 10**9), int(pd.Timestamp("2026-09-30").value // 10**9)
        h = tv_hourly.binance("ETHUSDT", t0, t1, volume=True).drop_duplicates("time").sort_values("time")
        h.index = pd.to_datetime(h.time, unit="s", utc=True)
    h = h[h.index >= "2017-01-01"]
    _CACHE[market] = _resample(h)
    return _CACHE[market]


def cut(bars, t):
    """Bars that have closed by time t (inclusive)."""
    step = {"1h": pd.Timedelta(hours=1), "4h": pd.Timedelta(hours=4), "1d": pd.Timedelta(days=1)}
    return {k: v[v.index + step[k] <= t] for k, v in bars.items()}


def _atr(d4):
    h, l, c = d4.high.values, d4.low.values, d4.close.values
    tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    return pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values


def _trade(o, h, l, c, i, side, stop, tp, n_max):
    e = o[i]
    risk = (e - stop) * side
    if risk <= 0 or (tp - e) * side <= 0:
        return None
    px = None
    for j in range(i, min(i + n_max + 1, len(c))):
        if side == 1 and l[j] <= stop or side == -1 and h[j] >= stop:
            px = min(o[j], stop) if side == 1 else max(o[j], stop)
            break
        if j > i and (side == 1 and h[j] >= tp or side == -1 and l[j] <= tp):
            px = max(o[j], tp) if side == 1 else min(o[j], tp)
            break
    if px is None:
        px = c[min(i + n_max, len(c) - 1)]
    return (side * (px - e) - (e + px) * COST) / risk


def score(bars, sigs, controls=True, seed=0):
    """Score signals with the fixed fill model. -> DataFrame (time, side, R, control, stop_atr, target_R)."""
    d4 = bars["4h"]
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    close_t = d4.index + pd.Timedelta(hours=4)
    atr = _atr(d4)
    years = d4.index.year.values
    rng = np.random.default_rng(seed)
    rows = []
    for s in sigs:
        i = int(np.searchsorted(close_t, pd.Timestamp(s.time), side="left"))  # signal bar
        if i >= len(c) or close_t[i] != pd.Timestamp(s.time):
            raise ValueError(f"signal time {s.time} is not a 4h bar close")
        e = i + 1
        n_max = int(min(s.max_bars, MAX_BARS))
        if e + n_max >= len(c):
            continue
        r = _trade(o, h, l, c, e, s.side, s.stop, s.target, n_max)
        if r is None:
            continue
        risk = (o[e] - s.stop) * s.side
        row = dict(time=pd.Timestamp(s.time), side=s.side, R=r, stop_atr=risk / atr[i], target_R=(s.target - o[e]) * s.side / risk)
        if controls:
            pool = np.flatnonzero((years == years[e]) & (np.arange(len(c)) > 100) & (np.arange(len(c)) < len(c) - n_max - 2))
            ctl = []
            for j in rng.choice(pool, CONTROLS):
                rk = row["stop_atr"] * atr[j - 1]
                ctl.append(_trade(o, h, l, c, j, s.side, o[j] - s.side * rk, o[j] + s.side * row["target_R"] * rk, n_max))
            ctl = [x for x in ctl if x is not None]
            row["control"] = float(np.mean(ctl)) if ctl else np.nan
        rows.append(row)
    return pd.DataFrame(rows)


def lookahead_check(signals_fn, bars, cuts=5, seed=1):
    """Recompute on data cut at `cuts` dates; every signal before a cut must be unchanged. -> (ok, message)."""
    full = {(pd.Timestamp(s.time), s.side, round(s.stop, 8), round(s.target, 8)) for s in signals_fn(bars)}
    idx = bars["4h"].index
    rng = np.random.default_rng(seed)
    for k in sorted(rng.choice(np.arange(len(idx) // 5, len(idx) - 10), cuts, replace=False)):
        t = idx[k] + pd.Timedelta(hours=4)
        part = {(pd.Timestamp(s.time), s.side, round(s.stop, 8), round(s.target, 8)) for s in signals_fn(cut(bars, t))}
        before_full = {x for x in full if x[0] <= t}
        before_part = {x for x in part if x[0] <= t}
        if before_full != before_part:
            diff = sorted(before_full ^ before_part)[:3]
            return False, f"signals before {t} change when later data is removed, e.g. {diff}"
    return True, f"unchanged at {cuts} cuts"


def summary(df, label=""):
    """avgR, control and their difference with a 95% bootstrap interval, plus a by-year view."""
    if df.empty:
        return f"{label}: no signals"
    rng = np.random.default_rng(7)
    d = (df.R - df.control).values
    b = rng.choice(d, size=(2000, len(d))).mean(1)
    lines = [f"{label}: n={len(df)} avgR {df.R.mean():+.3f} control {df.control.mean():+.3f} minus {d.mean():+.3f} "
             f"[95% {np.percentile(b, 2.5):+.3f}, {np.percentile(b, 97.5):+.3f}] win {np.mean(df.R > 0):.0%}"]
    by = df.assign(y=df.time.dt.year).groupby("y").apply(lambda g: (len(g), (g.R - g.control).mean()), include_groups=False)
    lines.append("  by year minus control: " + ", ".join(f"{y}:{n}/{v:+.2f}" for y, (n, v) in by.items()))
    return "\n".join(lines)
