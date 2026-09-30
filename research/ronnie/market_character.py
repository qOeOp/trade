"""Trend or mean reversion? Variance ratios of 4h log returns per market, in and out of sample.

VR(q) = Var(q-bar return) / (q * Var(1-bar return)), overlapping q-bar sums; above 1 means moves tend to continue
(trending), below 1 that they tend to reverse (mean reverting). z uses the Lo-MacKinlay heteroskedasticity-robust
standard error. Descriptive: no parameter is chosen from it.
"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "filters"))
import run as FR  # noqa: E402

PERIODS = {"IS 2017-2022": ("2017-01-01", "2023-01-01"), "OOS 2023-2026": ("2023-01-01", "2027-01-01")}


def vr(r, q):
    r = r - r.mean()
    n = len(r)
    var1 = (r ** 2).mean()
    rq = np.convolve(r, np.ones(q), "valid")
    varq = (rq ** 2).mean() / q
    # Lo-MacKinlay robust variance of VR(q) - 1
    delta = [((r[j:] ** 2) * (r[:n - j] ** 2)).sum() / ((r ** 2).sum() ** 2) * n for j in range(1, q)]
    theta = sum((2 * (q - j) / q) ** 2 * delta[j - 1] for j in range(1, q))
    v = varq / var1
    return v, (v - 1) / np.sqrt(theta / n)


def main():
    rows = []
    for name, d4, d1 in FR.markets():
        lr = np.log(d4.close.astype(float)).diff().dropna()
        for pname, (a, b) in PERIODS.items():
            r = lr[(lr.index >= a) & (lr.index < b)].values
            row = dict(market=name, period=pname)
            for q in (6, 30):
                v, z = vr(r, q)
                row[f"VR{q}"], row[f"z{q}"] = v, z
            rows.append(row)
        print(name, flush=True)
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(HERE, "results", "market_character.csv"), index=False)
    out = ["Variance ratios of 4h returns (>1 trending, <1 mean reverting; z robust, |z|>2 about 5%)",
           f"{'market':<9} {'period':<14} {'VR 1 day':>9} {'z':>6} {'VR 5 days':>10} {'z':>6}"]
    for r in df.itertuples():
        out.append(f"{r.market:<9} {r.period:<14} {r.VR6:9.3f} {r.z6:6.1f} {r.VR30:10.3f} {r.z30:6.1f}")
    for cls, m in (("crypto", df.market.isin(["BTCUSD", "ETHUSDT"])), ("FX", ~df.market.isin(["BTCUSD", "ETHUSDT"]))):
        for pname in PERIODS:
            z = df[m & (df.period == pname)]
            out.append(f"  {cls:<6} {pname}: mean VR 1 day {z.VR6.mean():.3f}, 5 days {z.VR30.mean():.3f}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "results", "market_character.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
