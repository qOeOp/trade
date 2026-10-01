"""Loop K1b: K1 with an entry band above the funding anchor. Writes carry/k1b.txt (see loop/LOG.md)."""
import importlib.util, os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
_s = importlib.util.spec_from_file_location("carry_run", os.path.join(HERE, "run.py"))
C = importlib.util.module_from_spec(_s)
_s.loader.exec_module(C)


def path(d, k_in, k_out):
    held, out = False, []
    for f7, f3, h in zip(d.f7.values, d.f3.values, d.hedge.values):
        cost = 0.0
        if not held and f7 >= k_in:
            held, cost = True, C.OPEN_CLOSE / 2
        elif held and f3 < k_out:
            held, cost = False, C.OPEN_CLOSE / 2
        out.append((h - cost) if held else (-cost if cost else np.nan))
    return pd.Series(out, index=d.index)


def book(D, coins, t0, t1, k_in, k_out):
    P = pd.DataFrame({c: path(D[D.coin == c].sort_index(), k_in, k_out) for c in coins if (D.coin == c).any()})
    P = P[(P.index >= t0) & (P.index < t1)]
    return P.mean(axis=1).fillna(0.0), P.notna().mean().mean()


def main():
    D = pd.read_csv(os.path.join(HERE, "daily.csv.gz"), index_col=0, parse_dates=True)
    out = ["K1b (entry 7d mean >= 0.015%, exit 3d mean < 0.01%) against K1 (entry >= 0.01%, exit < 0); per notional", ""]
    for label, coins, (t0, t1) in (("development (17 majors, 2020-2022)", C.R4.MAJORS, C.DEV),
                                   ("holdout (37 coins, 2023-2026; read before, descriptive)", C.R4.MAJORS + C.R4.LARGE, C.HOLD)):
        for name, ki, ko in (("K1", C.K1_IN, C.K1_OUT), ("K1b", 0.00015, 0.0001)):
            r, held = book(D, coins, t0, t1, ki, ko)
            wk = r.resample("W-MON").sum()
            lo, hi = C.week_boot(wk)
            yr = r.groupby(r.index.year).sum()
            out.append(f"{label} {name}: {r.mean() * 365:+.1%} a year [{lo * 52:+.1%}, {hi * 52:+.1%}], held {held:.0%} of coin-days; "
                       + ", ".join(f"{y} {v:+.1%}" for y, v in yr.items()))
        out.append("")
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "k1b.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
