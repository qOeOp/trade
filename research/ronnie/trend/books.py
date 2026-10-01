"""Loop T-1: portfolio-level comparison of trend rules on the 17 majors 2018-2022 under one volatility-targeted sizing.
Writes trend/books.txt."""
import importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "loop"))
import engine as E  # noqa: E402

LOOKS = (5, 10, 20, 30, 60, 90, 150, 250, 360)
T0, T1 = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
COST, TARGET = 0.001, 0.25


def states(c):
    """Exposure in [0, 1] per day for each rule, decided at the close."""
    n = len(c)
    sma = pd.Series(c).rolling(200).mean().values
    out = {"B0": np.ones(n), "B1": (c > sma).astype(float)}
    hi50, lo20 = pd.Series(c).shift(1).rolling(50).max().values, pd.Series(c).shift(1).rolling(20).min().values
    s, inn = np.zeros(n), False
    for i in range(n):
        if not inn and c[i] > hi50[i]:
            inn = True
        elif inn and c[i] < lo20[i]:
            inn = False
        s[i] = inn
    out["B2"] = s
    ens = np.zeros(n)
    for L in LOOKS:
        hh, ll = pd.Series(c).shift(1).rolling(L).max().values, pd.Series(c).shift(1).rolling(L).min().values
        inn, stop, sub = False, -np.inf, np.zeros(n)
        for i in range(n):
            if np.isnan(hh[i]):
                continue
            if not inn and c[i] > hh[i]:
                inn, stop = True, (hh[i] + ll[i]) / 2
            elif inn:
                stop = max(stop, (hh[i] + ll[i]) / 2)
                if c[i] < stop:
                    inn = False
            sub[i] = inn
        ens += sub
    out["B3"] = ens / len(LOOKS)
    return out


def main():
    rets, expo, vol = {}, {}, {}
    for coin in E.ITER_COINS:
        d = E.bars(coin)["1d"]
        c = d.close.values
        r = pd.Series(c, index=d.index).pct_change()
        rets[coin] = r
        vol[coin] = r.rolling(90).std() * np.sqrt(365)
        for k, s in states(c).items():
            expo.setdefault(k, {})[coin] = pd.Series(s, index=d.index)
    R, V = pd.DataFrame(rets), pd.DataFrame(vol)
    lines = ["T-1: books on the 17 majors 2018-2022; weight = exposure x (25% / 90d vol) / 17, gross <= 1, 0.1% a side", ""]
    books = {}
    for k in ("B0", "B1", "B2", "B3"):
        X = pd.DataFrame(expo[k])
        W = (X * (TARGET / V) / len(E.ITER_COINS)).clip(upper=1.0)
        gross = W.sum(axis=1)
        W = W.div(np.maximum(gross, 1.0), axis=0)
        W = W.shift(1)  # decided at the close, earned the next day
        pr = (W * R).sum(axis=1) - COST * W.diff().abs().sum(axis=1)
        pr = pr[(pr.index >= T0) & (pr.index < T1)]
        books[k] = pr
        eq = (1 + pr).cumprod()
        dd = (eq / eq.cummax() - 1).min()
        sh = pr.mean() / pr.std() * np.sqrt(365)
        cagr = eq.iloc[-1] ** (365 / len(pr)) - 1
        y = pr.groupby(pr.index.year).apply(lambda s: (1 + s).prod() - 1)
        lines.append(f"{k}: Sharpe {sh:.2f}, CAGR {cagr:+.1%}, max DD {dd:+.1%}, average gross {W.sum(axis=1).mean():.2f}; "
                     + ", ".join(f"{a} {b:+.0%}" for a, b in y.items()))
    rng = np.random.default_rng(3)
    wk = {k: v.resample("W-MON").sum() for k, v in books.items()}
    lines.append("")
    for k in ("B2", "B3"):
        a, b = wk[k].values, wk["B1"].values
        diffs = []
        for _ in range(4000):
            idx = rng.integers(0, len(a), len(a))
            sa, sb = a[idx], b[idx]
            diffs.append(sa.mean() / sa.std() * np.sqrt(52) - sb.mean() / sb.std() * np.sqrt(52))
        lo, hi = np.percentile(diffs, [2.5, 97.5])
        lines.append(f"Sharpe {k} - B1 (weekly bootstrap): {np.mean(diffs):+.2f} [{lo:+.2f}, {hi:+.2f}]")
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "books.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
