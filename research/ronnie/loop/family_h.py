"""Family H of the R&D loop: pairs mean reversion on 4h bars. Usage: python loop/family_h.py H-1
Market-neutral: the score is the net return per trade on gross notional; the benchmark is cash (zero).
Writes loop/out/<id>_iteration.csv.gz and prints the gate."""
import gzip, itertools, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402

BASE = dict(form=126, trade=42, top=5, adf_crit=-3.37, z_in=2.0, z_out=1.0, z_stop=4.0, cost=0.0012, coins="iter")
LOOPS = {"H-1": dict(BASE), "H-2": dict(BASE, roll=60), "H-3": dict(BASE, tf="1h", form=504, trade=168)}


def adf_t(e):
    """Engle-Granger ADF t-statistic (no lags, with constant) of a residual series."""
    de, lag = np.diff(e), e[:-1]
    X = np.c_[np.ones(len(lag)), lag]
    b, *_ = np.linalg.lstsq(X, de, rcond=None)
    res = de - X @ b
    s2 = res @ res / (len(de) - 2)
    cov = s2 * np.linalg.inv(X.T @ X)
    return b[1] / np.sqrt(cov[1, 1])


def prices(coins, t0, t1, tf="4h"):
    P = pd.DataFrame({c: (E.bars_1h(c) if tf == "1h" else E.bars(c)["4h"]).close for c in coins})
    return np.log(P[(P.index >= t0 - pd.Timedelta(days=30)) & (P.index < t1)])


def simulate(L, a, b, beta, mu, sd, s, e_end, cfg):
    """Trades on one pair inside [s, e_end): -> list of (entry index, side, net return)."""
    out, i = [], s
    A, B = L[a].values, L[b].values
    spread = A - beta * B
    if cfg.get("roll"):  # rolling statistics of the spread, known at each bar
        sr = pd.Series(spread)
        rmu, rsd = sr.rolling(cfg["roll"]).mean().values, sr.rolling(cfg["roll"]).std().values
    else:
        rmu, rsd = np.full(len(A), mu), np.full(len(A), sd)
    zf = lambda k: (spread[k] - rmu[k]) / rsd[k] if rsd[k] > 0 else np.nan  # noqa: E731
    while i < e_end - 1:
        z = zf(i)
        if np.isnan(z) or abs(z) < cfg["z_in"] or abs(z) >= cfg["z_stop"]:  # never enter beyond the stop
            i += 1
            continue
        side = -np.sign(z)  # +1: long the spread (long A, short beta B)
        e0 = i + 1  # enter at the next bar's close proxy (4h close)
        if e0 >= e_end:
            break
        j = e0
        while j < e_end - 1:
            zj = zf(j)
            if abs(zj) <= cfg["z_out"] or abs(zj) >= cfg["z_stop"] or np.sign(zj) != np.sign(z):
                break
            j += 1
        w = 1 + abs(beta)
        ret = side * ((A[j] - A[e0]) - beta * (B[j] - B[e0])) / w - cfg["cost"]
        out.append((e0, side, ret))
        zj = zf(j)
        if abs(zj) >= cfg["z_stop"]:  # a diverged pair is not traded again this week
            break
        i = j + 1
    return out


def run(loop, cfg, coins, t0, t1, random_pairs=False, seed=0):
    L = prices(coins, t0, t1, cfg.get("tf", "4h")).dropna(how="all")
    rng = np.random.default_rng(seed)
    idx = L.index
    rows = []
    start = int(idx.searchsorted(t0))
    for s in range(max(start, cfg["form"]), len(idx) - 1, cfg["trade"]):
        F = L.iloc[s - cfg["form"]:s]
        cand = []
        for a, b in itertools.combinations([c for c in coins if F[c].notna().all()], 2):
            x, y = F[b].values, F[a].values
            beta = np.polyfit(x, y, 1)[0]
            resid = y - beta * x
            cand.append((adf_t(resid), a, b, beta, resid.mean(), resid.std()))
        if random_pairs:
            pick = [cand[k] for k in rng.choice(len(cand), min(cfg["top"], len(cand)), replace=False)] if cand else []
        else:
            pick = sorted([c for c in cand if c[0] < cfg["adf_crit"]])[:cfg["top"]]
        e_end = min(s + cfg["trade"], len(idx))
        for t, a, b, beta, mu, sd in pick:
            if sd <= 0:
                continue
            for e0, side, ret in simulate(L, a, b, beta, mu, sd, s, e_end, cfg):
                rows.append(dict(pair=f"{a}-{b}", coin=f"{a}-{b}", time=idx[e0], side=int(side), R=ret, control=0.0, adf=t))
    return pd.DataFrame(rows)


def main():
    loop = sys.argv[1]
    cfg = LOOPS[loop]
    coins = E.ITER_COINS
    z = run(loop, cfg, coins, *E.ITER)
    zr = run(loop, cfg, coins, *E.ITER, random_pairs=True, seed=7)
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    with gzip.GzipFile(os.path.join(HERE, "out", f"{loop}_iteration.csv.gz"), "wb", mtime=0) as fh:
        fh.write(z.to_csv(index=False, float_format="%.6g").encode())
    lo, hi = attrib.week_boot(z)
    a, b = z[z.time < E.ITER_SPLIT], z[z.time >= E.ITER_SPLIT]
    passed = bool(lo > 0 and a.R.mean() > 0 and b.R.mean() > 0)
    st = dict(n=len(z), edge=z.R.mean(), lo=lo, hi=hi)
    E.log(loop, "familyH", "iteration", st, passed, "market-neutral; edge = mean net return; week-clustered interval")
    lr, hr = attrib.week_boot(zr)
    print(f"{loop} iteration gate {'PASS' if passed else 'fail'}: n {len(z)}, mean net return {z.R.mean():+.3%} [{lo:+.3%}, {hi:+.3%}] "
          f"(week-clustered); win {np.mean(z.R > 0):.0%}; 2018-20 {a.R.mean():+.3%} (n {len(a)}), 2021-22 {b.R.mean():+.3%} (n {len(b)})")
    print(f"  random pairs, same rules: n {len(zr)}, mean {zr.R.mean():+.3%} [{lr:+.3%}, {hr:+.3%}]")
    print(f"  pairs traded: {z.pair.nunique()}; most frequent: " + ", ".join(f"{p} {n}" for p, n in z.pair.value_counts().head(6).items()))


if __name__ == "__main__":
    main()
