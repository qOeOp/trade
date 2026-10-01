"""Loop K1p: carry timed on the premium index. Writes carry/k1p.txt (see loop/LOG.md).
Usage: python carry/k1p.py [reserve]  (reserve: the gatekeeper's read; prints only the verdict)."""
import json, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run as C  # noqa: E402
from k1b import path as k1_path_band  # noqa: E402


def premium_path(d, prem):
    p = prem.reindex(d.index)
    m3 = p.rolling(3).mean().shift(1)
    last = p.shift(1)
    held, out = False, []
    for a, b, h in zip(m3.values, last.values, d.hedge.values):
        cost = 0.0
        if not held and a > 0:
            held, cost = True, C.OPEN_CLOSE / 2
        elif held and b < 0:
            held, cost = False, C.OPEN_CLOSE / 2
        out.append((h - cost) if held else (-cost if cost else np.nan))
    return pd.Series(out, index=d.index)


def books(D, P, coins, t0, t1):
    k1, kp = {}, {}
    for c in coins:
        d = D[D.coin == c].sort_index()
        pr = P[P.coin == c].set_index("date").close
        if d.empty or pr.empty:
            continue
        k1[c] = k1_path_band(d, C.K1_IN, C.K1_OUT)
        kp[c] = premium_path(d, pr)
    out = {}
    for name, X in (("K1", k1), ("K1p", kp)):
        X = pd.DataFrame(X)
        X = X[(X.index >= t0) & (X.index < t1)]
        out[name] = (X.mean(axis=1).fillna(0.0), X.notna().mean().mean(), (X.notna().astype(int).diff() == 1).sum().sum())
    return out


def main():
    D = pd.read_csv(os.path.join(HERE, "daily.csv.gz"), index_col=0, parse_dates=True)
    P = pd.read_csv(os.path.join(HERE, "premium.csv.gz"), parse_dates=["date"])
    b = books(D, P, C.R4.MAJORS, *C.DEV)
    lines = ["K1p (premium 3-day mean > 0 in, last close < 0 out) against K1, 17 majors 2020-2022, per notional", ""]
    for k, (r, held, entries) in b.items():
        lo, hi = C.week_boot(r.resample("W-MON").sum())
        lines.append(f"{k}: {r.mean() * 365:+.1%} a year [{lo * 52:+.1%}, {hi * 52:+.1%}], held {held:.0%} of coin-days, "
                     f"{entries} entries; " + ", ".join(f"{y} {v:+.1%}" for y, v in r.groupby(r.index.year).sum().items()))
    diff = (b["K1p"][0] - b["K1"][0]).resample("W-MON").sum()
    lo, hi = C.week_boot(diff)
    lines.append(f"difference K1p - K1: {diff.mean() * 52:+.1%} a year [{lo * 52:+.1%}, {hi * 52:+.1%}]; "
                 f"gate {'PASS' if lo > 0 else 'fail'}")
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "k1p.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
