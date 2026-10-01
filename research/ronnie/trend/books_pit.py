"""Loop T-2: trend books on a point-in-time top-20 universe (survivorship-free). Usage: python trend/books_pit.py [validate]
Iteration: 2018-2022, full report. validate: 2023-01 to 2026-08, prints only a three-level verdict on Sharpe(B3) - Sharpe(B1)
and seals the details in loop/sealed/T-2_validate.json."""
import json, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from books import COST, TARGET, states  # noqa: E402

N_TOP = 20


def load():
    U = pd.read_csv(os.path.join(ROOT, "loop", ".cache", "universe_1d.csv.gz"), parse_dates=["time"])
    C = U.pivot_table(index="time", columns="symbol", values="close")
    QV = U.pivot_table(index="time", columns="symbol", values="quote_volume")
    return C.sort_index(), QV.sort_index()


def membership(C, QV):
    age = C.notna().cumsum()
    med = QV.rolling(30, min_periods=20).median()
    M = pd.DataFrame(False, index=C.index, columns=C.columns)
    for m in pd.date_range(C.index[0].normalize(), C.index[-1], freq="MS", tz="UTC"):
        prev = C.index[C.index < m]
        if len(prev) == 0:
            continue
        t = prev[-1]
        ok = (age.loc[t] >= 365) & med.loc[t].notna()
        top = med.loc[t][ok].nlargest(N_TOP).index
        nxt = (C.index >= m) & (C.index < m + pd.offsets.MonthBegin(1))
        M.loc[nxt, top] = True
    return M


def run(t0, t1):
    C, QV = load()
    M = membership(C, QV)
    R = C.pct_change()
    V = R.rolling(90, min_periods=60).std() * np.sqrt(365)
    books = {}
    for k in ("B0", "B1", "B2", "B3"):
        X = pd.DataFrame(0.0, index=C.index, columns=C.columns)
        for s in C.columns[M.any()]:
            c = C[s].dropna()
            st = states(c.values)[k]
            X.loc[c.index, s] = st
        X = X.where(M, 0.0)
        W = (X * (TARGET / V) / N_TOP).clip(upper=1.0).fillna(0.0)
        gross = W.sum(axis=1)
        W = W.div(np.maximum(gross, 1.0), axis=0).shift(1)
        pr = (W * R.fillna(0)).sum(axis=1) - COST * W.diff().abs().sum(axis=1)
        books[k] = pr[(pr.index >= t0) & (pr.index < t1)]
    return books, M


def stats(pr):
    eq = (1 + pr).cumprod()
    return dict(sharpe=pr.mean() / pr.std() * np.sqrt(365), cagr=eq.iloc[-1] ** (365 / len(pr)) - 1, maxdd=(eq / eq.cummax() - 1).min(),
                years={str(y): float((1 + s).prod() - 1) for y, s in pr.groupby(pr.index.year)})


def sharpe_diff(a, b, seed=3):
    wa, wb = a.resample("W-MON").sum().values, b.resample("W-MON").sum().values
    rng = np.random.default_rng(seed)
    d = []
    for _ in range(4000):
        i = rng.integers(0, len(wa), len(wa))
        d.append(wa[i].mean() / wa[i].std() * np.sqrt(52) - wb[i].mean() / wb[i].std() * np.sqrt(52))
    return np.mean(d), np.percentile(d, 2.5), np.percentile(d, 97.5)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "validate":
        books, _ = run(pd.Timestamp("2023-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
        m, lo, hi = sharpe_diff(books["B3"], books["B1"])
        verdict = "PASS" if lo > 0 else ("FAIL (edge positive, interval spans zero)" if m > 0 else "FAIL (edge at or below zero)")
        sealed = {k: stats(v) for k, v in books.items()}
        sealed["diff_B3_B1"] = dict(mean=m, lo=lo, hi=hi)
        json.dump(sealed, open(os.path.join(ROOT, "loop", "sealed", "T-2_validate.json"), "w"), indent=1, default=float)
        print(f"T-2 validate: {verdict} at 95%")
        return
    books, M = run(pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
    names = sorted(M.columns[M[(M.index >= "2018-01-01") & (M.index < "2023-01-01")].any()])
    lines = [f"T-2: point-in-time top-{N_TOP} universe, 2018-2022 ({len(names)} symbols ever in it: {', '.join(n[:-4] for n in names)})", ""]
    for k, v in books.items():
        s = stats(v)
        lines.append(f"{k}: Sharpe {s['sharpe']:.2f}, CAGR {s['cagr']:+.1%}, max DD {s['maxdd']:+.1%}; "
                     + ", ".join(f"{y} {r:+.0%}" for y, r in s["years"].items()))
    for k in ("B2", "B3"):
        m, lo, hi = sharpe_diff(books[k], books["B1"])
        lines.append(f"Sharpe {k} - B1: {m:+.2f} [{lo:+.2f}, {hi:+.2f}]")
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "books_pit.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
