"""TrialFamily goldtrend-v1: trend-v1 T0 (50-day close breakout, 2 ATR stop, 20-day close exit) on spot gold, with a
silver cross-check and a 1%-risk long-only book. See INTENT.md. Writes goldtrend/trades.csv and goldtrend/result.txt.
"""
import importlib.util, os, sys, time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
from tv_prices import fetch  # noqa: E402

_spec = importlib.util.spec_from_file_location("trend_run", os.path.join(ROOT, "trend", "run.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)
T.FEE, T.FUND_DAY = 0.0003, 0.0001
FORM = (pd.Timestamp("2008-01-01", tz="UTC"), pd.Timestamp("2019-01-01", tz="UTC"))
TEST = (pd.Timestamp("2019-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
RISK, BOOK_FEE = 0.01, 0.0003


def daily(symbol, cut=True):
    for _ in range(4):
        try:
            bars, _ = fetch(symbol, "1D", 5000)
            if bars:
                break
        except Exception:
            time.sleep(3)
    d = pd.DataFrame([(t, *v) for t, v in bars], columns=["time", "open", "high", "low", "close"])
    d.index = pd.to_datetime(d.time, unit="s", utc=True).dt.normalize()
    d = d[~d.index.duplicated(keep="last")][["open", "high", "low", "close"]].astype(float)
    return d[d.index < TEST[1]] if cut else d


def trades(asset, d, rng):
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    n, atr, years = len(c), T.MT.atr_of(h, l, c, 20), d.index.year.values
    pool_ok = (np.arange(n) > 80) & (np.arange(n) < n - 2)
    rows, busy = [], {1: -1, -1: -1}
    for i in range(80, n - 1):
        for side in (1, -1):
            if i <= busy[side]:
                continue
            ref = c[i - 50:i].max() if side == 1 else c[i - 50:i].min()
            if (c[i] - ref) * side <= 0:
                continue
            e, entry = i + 1, o[i + 1]
            stop = entry - side * 2 * atr[i]
            xj, r = T.run_trade(o, h, l, c, e, side, entry, stop)
            busy[side] = xj
            ctl = [T.run_trade(o, h, l, c, j, side, o[j], o[j] - side * 2 * atr[j - 1])[1]
                   for j in rng.choice(np.flatnonzero(pool_ok & (years == years[e])), 20)]
            px = c[xj] if xj < n else np.nan
            rows.append(dict(asset=asset, time=d.index[e], side=side, entry=entry, stop=stop, exit_time=d.index[xj],
                             R=r, control=float(np.mean(ctl)), days=xj - e + 1, weight=min(1.0, RISK * entry / (entry - stop)),
                             e=e, x=xj, px=px))
    return pd.DataFrame(rows)


def book(d, z):
    """Daily returns of a long-only book: weight = 1% risk / stop distance, capped at 1x; fees per side."""
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    ret = np.zeros(len(c))
    for t in z[z.side == 1].itertuples():
        stop_hit = l[t.x] <= t.stop
        px = (min(o[t.x], t.stop) if t.x > t.e else t.stop) if stop_hit else c[t.x]
        for j in range(t.e, t.x + 1):
            a = o[j] if j == t.e else c[j - 1]
            b = px if j == t.x else c[j]
            ret[j] += t.weight * (b / a - 1)
        ret[t.e] -= t.weight * BOOK_FEE
        ret[t.x] -= t.weight * BOOK_FEE
    return pd.Series(ret, index=d.index)


def stats(r):
    eq = (1 + r).cumprod()
    yrs = len(r) / 252
    cagr = eq.iloc[-1] ** (1 / yrs) - 1
    dd = (eq / eq.cummax() - 1).min()
    sh = r.mean() / r.std() * np.sqrt(252) if r.std() > 0 else np.nan
    return cagr, dd, sh


def main():
    rng = np.random.default_rng(71)
    out = ["goldtrend-v1 (INTENT.md): trend-v1 T0 on TVC:GOLD daily; costs 0.03%/side + 0.01%/day carry;",
           "control = 20 random entries, same year and side, same stop and exits; trade bootstrap", ""]
    all_z = []
    for asset in ("TVC:GOLD", "TVC:SILVER"):
        d = daily(asset)
        z = trades(asset, d, rng)
        all_z.append(z)
        out.append(f"{asset}: data {d.index[0].date()} to {d.index[-1].date()}")
        for label, (t0, t1) in (("formation 2008-2018", FORM), ("test 2019-2026", TEST)):
            for sd, nm in ((1, "long"), (-1, "short")):
                k = z[(z.side == sd) & (z.time >= t0) & (z.time < t1)]
                if len(k) < 3:
                    out.append(f"  {label:<20} {nm:<5} n {len(k)}")
                    continue
                lo, hi = T.boot(k.R - k.control)
                out.append(f"  {label:<20} {nm:<5} n {len(k):3d}  win {np.mean(k.R > 0):.0%}  avg R {k.R.mean():+.3f}  "
                           f"control {k.control.mean():+.3f}  minus control {(k.R - k.control).mean():+.3f} [{lo:+.3f}, {hi:+.3f}]  "
                           f"median days {k.days.median():.0f}")
                if asset == "TVC:GOLD" and label.startswith("test") and sd == 1:
                    verdict = lo > 0
        if asset == "TVC:GOLD":
            g = z[z.time >= FORM[0]]
            yr = g.groupby([g.time.dt.year, "side"]).R.agg(["count", "mean"]).unstack()
            out.append("  per year (long n / avg R | short n / avg R):")
            for y, r in yr.iterrows():
                f = lambda s: f"{int(r[('count', s)]) if r[('count', s)] == r[('count', s)] else 0:2d} / {r[('mean', s)]:+.2f}"  # noqa: E731
                out.append(f"    {y}: long {f(1)} | short {f(-1)}")
            r = book(d, z)
            hold = d.close.pct_change().fillna(0)
            for label, (t0, t1) in (("2008-2026", (FORM[0], TEST[1])), ("2019-2026", TEST)):
                m = (r.index >= t0) & (r.index < t1)
                a, b = stats(r[m]), stats(hold[m])
                out.append(f"  book {label}: trend 1% risk long-only CAGR {a[0]:+.1%} maxDD {a[1]:+.1%} Sharpe {a[2]:.2f} "
                           f"invested {(r[m] != 0).mean():.0%} | buy and hold CAGR {b[0]:+.1%} maxDD {b[1]:+.1%} Sharpe {b[2]:.2f}")
            yb = r[r.index >= FORM[0]].groupby(r.index[r.index >= FORM[0]].year).apply(lambda s: (1 + s).prod() - 1)
            yh = hold[hold.index >= FORM[0]].groupby(hold.index[hold.index >= FORM[0]].year).apply(lambda s: (1 + s).prod() - 1)
            out.append("  book by year (trend / hold): " + ", ".join(f"{y} {yb[y]:+.0%}/{yh[y]:+.0%}" for y in yb.index))
        out.append("")
    out.append(f"decision: the long rule on gold {'HOLDS' if verdict else 'fails'} (test-period R minus control above zero at 95%)")
    # current state on the latest closed bar (data after the cut, descriptive)
    d = daily("TVC:GOLD", cut=False)
    d = d[d.index < pd.Timestamp.now(tz="UTC").normalize()]
    c, h, l = d.close.values, d.high.values, d.low.values
    atr = T.MT.atr_of(h, l, c, 20)
    out.append(f"\ncurrent state (last closed bar {d.index[-1].date()}): close {c[-1]:.1f}; entry trigger (50-day close high) "
               f"{c[-51:-1].max():.1f} ({c[-51:-1].max() / c[-1] - 1:+.1%}); 20-day close low {c[-21:-1].min():.1f}; ATR(20) {atr[-1]:.1f}")
    pd.concat(all_z).drop(columns=["e", "x", "px"]).to_csv(os.path.join(HERE, "trades.csv"), index=False, float_format="%.6g")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "result.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
