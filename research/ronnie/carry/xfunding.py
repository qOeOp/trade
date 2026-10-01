"""Loop X-1: daily cross-sectional funding long-short on the 17 majors 2020-2022 (iteration tier). Writes carry/xfunding.txt."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "loop"))
import engine as E  # noqa: E402

COST, Q = 0.0006, 3


def main():
    D = pd.read_csv(os.path.join(HERE, "daily.csv.gz"), index_col=0, parse_dates=True)
    D = D[D.coin.isin(E.ITER_COINS)]
    F = D.pivot_table(index=D.index, columns="coin", values="fund")
    P = D.pivot_table(index=D.index, columns="coin", values="perp_ret")
    sig = F.rolling(3).sum()  # known at the end of day t
    rows = []
    prev_l, prev_s = set(), set()
    for t in range(3, len(F) - 1):
        s = sig.iloc[t].dropna()
        if len(s) < 10:
            continue
        lo, hi = set(s.nsmallest(Q).index), set(s.nlargest(Q).index)
        nxt = P.iloc[t + 1]
        fn = F.iloc[t + 1]
        price = nxt[list(lo)].mean() - nxt[list(hi)].mean()
        fund = -fn[list(lo)].mean() + fn[list(hi)].mean()  # longs pay funding, shorts receive it
        turn = (len(lo - prev_l) + len(hi - prev_s)) / Q if prev_l else 2.0
        rows.append(dict(time=P.index[t + 1], price=price - COST * turn, total=price + fund - COST * turn))
        prev_l, prev_s = lo, hi
    Z = pd.DataFrame(rows).set_index("time")
    Z = Z[(Z.index >= pd.Timestamp("2020-01-01")) & (Z.index < pd.Timestamp("2023-01-01"))]
    out = ["X-1: daily long 3 lowest-funding / short 3 highest-funding majors, 2020-2022, net of 0.06% a side", ""]
    rng = np.random.default_rng(5)
    for col in ("price", "total"):
        wk = Z[col].resample("W-MON").sum()
        b = rng.choice(wk.values, (4000, len(wk))).mean(1) * 52
        a, c = Z[col][Z.index < pd.Timestamp("2021-01-01")], Z[col][Z.index >= pd.Timestamp("2021-01-01")]
        out.append(f"{col:<5}: {Z[col].mean() * 365:+.1%} a year [{np.percentile(b, 2.5):+.1%}, {np.percentile(b, 97.5):+.1%}] (weekly bootstrap); "
                   f"2020 {a.mean() * 365:+.1%}, 2021-22 {c.mean() * 365:+.1%}; by year "
                   + ", ".join(f"{y} {v * 365:+.1%}" for y, v in Z[col].groupby(Z.index.year).mean().items()))
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "xfunding.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
