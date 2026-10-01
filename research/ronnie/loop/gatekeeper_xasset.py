"""Gatekeeper for X-3: the frozen B3 trend book outside crypto (loop/LOG.md). The iterating agent does not run this.

B3 and B1 exactly as trend/books.py (states(), 25% volatility target per instrument / N, gross <= 1, decided at the
close, earned the next day), costs 0.03% a side, on commodities, equity indices and FX, 2008-01 to 2026-08.
Two verdicts, Holm over the two (the first at 97.5%, the second at 95% if the first passes), weekly bootstrap:
1. Sharpe(B3) above zero; 2. Sharpe(B3) - Sharpe(B1) above zero.
stdout carries verdicts only; details go to loop/sealed/X-3_xasset.json.
Limitation, stated: NYMEX:NG1! and COMEX:HG1! are continuous front-month series with roll jumps.
"""
import json, os, sys, time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (HERE, ROOT, os.path.join(ROOT, "trend")):
    sys.path.insert(0, p)
from books import TARGET, states  # noqa: E402
from tv_prices import fetch  # noqa: E402
import tv_fx_mtf  # noqa: E402

COST = 0.0003
T0, T1 = pd.Timestamp("2008-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC")
BUCKETS = {"commodities": ["TVC:GOLD", "TVC:SILVER", "TVC:USOIL", "TVC:UKOIL", "NYMEX:NG1!", "COMEX:HG1!"],
           "indices": ["TVC:SPX", "TVC:NDX", "TVC:DJI", "TVC:DEU40", "TVC:NI225", "TVC:UKX"],
           "fx": list(tv_fx_mtf.PAIRS)}


def daily(sym):
    if sym in tv_fx_mtf.PAIRS:
        h = tv_fx_mtf.hourly(sym)
        return h.close.resample("1D").last().dropna()
    for _ in range(4):
        try:
            b, _ = fetch(sym, "1D", 5000)
            if b:
                break
        except Exception:
            time.sleep(3)
    s = pd.Series([v[3] for _, v in b], index=pd.to_datetime([t for t, _ in b], unit="s", utc=True).normalize())
    return s[~s.index.duplicated(keep="last")].astype(float)


def book(closes, kind):
    R = pd.DataFrame({k: c.pct_change() for k, c in closes.items()})  # each on its own calendar, then aligned
    V = pd.DataFrame({k: c.pct_change().rolling(90).std() * np.sqrt(252) for k, c in closes.items()}).reindex(R.index)
    X = pd.DataFrame({k: pd.Series(states(c.values)[kind], index=c.index) for k, c in closes.items()}).reindex(R.index)
    W = (X * (TARGET / V) / len(closes)).clip(upper=1.0)
    W = W.div(np.maximum(W.sum(axis=1), 1.0), axis=0).shift(1)
    pr = (W * R).sum(axis=1) - COST * W.diff().abs().sum(axis=1)
    return pr[(pr.index >= T0) & (pr.index < T1)]


def sharpe(x):
    return x.mean() / x.std() * np.sqrt(52) if x.std() > 0 else np.nan


def boot(a, b, fn, level, reps=4000, seed=17):
    rng = np.random.default_rng(seed)
    v = [fn(a[i], b[i]) for i in (rng.integers(0, len(a), len(a)) for _ in range(reps))]
    q = (100 - level) / 2
    return np.percentile(v, [q, 100 - q])


def verdict(lo, est):
    if lo > 0:
        return "PASS"
    return "FAIL (edge positive, interval spans zero)" if est > 0 else "FAIL (edge at or below zero)"


def main():
    closes = {s: daily(s) for b in BUCKETS.values() for s in b}
    wk = {k: book(closes, k).resample("W-MON").sum() for k in ("B0", "B1", "B3")}
    a, b = wk["B3"].values, wk["B1"].reindex(wk["B3"].index).values
    sh = lambda x, _=None: x.mean() / x.std() * np.sqrt(52)  # noqa: E731
    lo1, hi1 = boot(a, a, sh, 97.5)
    v1 = verdict(lo1, sh(a))
    lvl2 = 95.0 if lo1 > 0 else 97.5
    lo2, hi2 = boot(a, b, lambda x, y: sh(x) - sh(y), lvl2)
    v2 = verdict(lo2, sh(a) - sh(b))
    print(f"X-3 B3 cross-asset vs cash: {v1} at 97.5%")
    print(f"X-3 B3 minus B1 cross-asset: {v2} at {lvl2:.1f}%")
    per_bucket = {}
    for name, syms in BUCKETS.items():
        sub = {s: closes[s] for s in syms}
        per_bucket[name] = {k: float(sharpe(book(sub, k).resample("W-MON").sum())) for k in ("B0", "B1", "B3")}
    sealed = dict(loop="X-3", weeks=len(a), sharpe={k: float(sharpe(v)) for k, v in wk.items()},
                  ci_b3=[float(lo1), float(hi1)], ci_b3_b1=[float(lo2), float(hi2)], level2=lvl2,
                  per_bucket=per_bucket, bars={s: [str(c.index[0].date()), len(c)] for s, c in closes.items()},
                  per_year={str(y): float(g.sum()) for y, g in wk["B3"].groupby(wk["B3"].index.year)}, verdicts=[v1, v2])
    json.dump(sealed, open(os.path.join(HERE, "sealed", "X-3_xasset.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
