"""Kill thresholds and power for the forward candidates, from their iteration-period weekly streams (block bootstrap of
52-week paths, 4-week blocks). Writes loop/forward_plan.txt; the numbers feed loop/FORWARD_PLAN.md."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ensemble as N  # noqa: E402


def paths(x, weeks=52, block=4, reps=20000, seed=5):
    x = np.asarray(x.dropna(), float)
    rng = np.random.default_rng(seed)
    nb = weeks // block
    starts = rng.integers(0, len(x) - block, (reps, nb))
    P = np.stack([x[s:s + block] for s in starts.ravel()]).reshape(reps, nb * block)
    return P


def main():
    X = pd.read_csv(os.path.join(HERE, "out", "streams_weekly.csv.gz"), index_col=0, parse_dates=True)
    S = pd.DataFrame({k: N.scaled(X[k]) for k in ("B3", "D-1", "F-2", "C-6")})
    book = S[S.index >= pd.Timestamp("2018-07-01", tz="UTC")].mean(axis=1)
    import run as CR  # carry/run.py, on the path through ensemble
    D = pd.read_csv(os.path.join(os.path.dirname(HERE), "carry", "daily.csv.gz"), index_col=0, parse_dates=True)
    k1h = pd.DataFrame({c: CR.k1_path(g.sort_index()) for c, g in D.groupby("coin")})
    k1h = k1h[(k1h.index >= CR.HOLD[0]) & (k1h.index < CR.HOLD[1])].mean(axis=1).fillna(0.0).resample("W-MON").sum()
    series = {"K1 2023-2026 (per notional, read before)": k1h, "book T (10% vol units)": book, "B3 (book return)": X.B3, "K1 (per notional)": X.K1,
              "D-1 (R per week)": X["D-1"], "F-2 (R per week)": X["F-2"], "C-6 (R per week)": X["C-6"]}
    lines = ["candidate: in-sample weekly mean, Sharpe; 52-week sum 5th / 1st percentile; 52-week max drawdown of the "
             "cumulative sum, 95th / 99th percentile; years to a one-sided 95% bound above zero at half the Sharpe"]
    for k, x in series.items():
        x = x.dropna()
        P = paths(x)
        tot = P.sum(1)
        cum = P.cumsum(1)
        dd = (cum - np.maximum.accumulate(np.maximum(cum, 0), axis=1)).min(1)
        sh = x.mean() / x.std() * np.sqrt(52)
        yrs = (1.645 / (sh / 2)) ** 2 if sh > 0 else np.inf
        lines.append(f"{k}: mean {x.mean():+.4f}, Sharpe {sh:.2f}; 52w sum p5 {np.percentile(tot, 5):+.3f} p1 "
                     f"{np.percentile(tot, 1):+.3f}; drawdown p95 {np.percentile(dd, 5):+.3f} p99 {np.percentile(dd, 1):+.3f}; "
                     f"years {yrs:.1f}")
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "forward_plan.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
