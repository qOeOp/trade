"""Loop L-3 (loop/LOG.md): cycle-swing Fibonacci levels as R-1u targets, against 2R and a placebo ratio set.
Usage: python loop/r1_fibtgt.py"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_p as FP  # noqa: E402
import family_r as FR  # noqa: E402
import r1_lines as L1  # noqa: E402

KF = 20
REAL = ((0.236, 0.382, 0.5, 0.618, 0.764), (1.272, 1.618))
PLAC = ((0.20, 0.32, 0.44, 0.56, 0.70), (1.35, 1.80))


def swing(h, l, piv_h, piv_l, i):
    """latest confirmed order-20 pivot B and the opposite-type pivot A before it: (A price, B price) or None"""
    kh = [j for j in piv_h if j + KF <= i]
    kl = [j for j in piv_l if j + KF <= i]
    if not kh or not kl:
        return None
    if kh[-1] > kl[-1]:
        b, prev = kh[-1], [j for j in kl if j < kh[-1]]
        return (l[prev[-1]], h[b]) if prev else None
    b, prev = kl[-1], [j for j in kh if j < kl[-1]]
    return (h[prev[-1]], l[b]) if prev else None


def target(sw, a, side, px, risk, ratios):
    if sw is None:
        return None
    A, B = sw
    if abs(B - A) < 5 * a:
        return None
    lv = [B, A] + [B + r * (A - B) for r in ratios[0]] + [B + (B - A) * (x - 1) for x in ratios[1]]
    lv = sorted(x for x in lv if (x - px) * side >= risk and (x - px) * side <= 6 * risk)
    if not lv:
        return None
    return lv[0] if side == 1 else lv[-1]


def main():
    rows = []
    for ci, coin in enumerate(E.ITER_COINS + E.ITER_EXT_COINS):
        d = E.bars(coin)["1d"]
        h, l, c = d.high.values, d.low.values, d.close.values
        a = E.MT.atr_of(h, l, c)
        hi = pd.Series(h).rolling(2 * KF + 1, center=True).max().values == h
        lo = pd.Series(l).rolling(2 * KF + 1, center=True).min().values == l
        piv_h, piv_l = list(np.flatnonzero(hi)), list(np.flatnonzero(lo))
        sigs = {"base": [], "fib": [], "plac": []}
        has = []
        for t in L1.trades(d):
            i, side, px, stop = t["i"], t["side"], t["px"], t["stop"]
            risk = abs(px - stop)
            sw = swing(h, l, piv_h, piv_l, i)
            tf, tp = target(sw, a[i], side, px, risk, REAL), target(sw, a[i], side, px, risk, PLAC)
            sigs["base"].append((t["k"], side, px, stop, t["tgt"]))
            sigs["fib"].append((t["k"], side, px, stop, tf if tf is not None else t["tgt"]))
            sigs["plac"].append((t["k"], side, px, stop, tp if tp is not None else t["tgt"]))
            has.append((t["k"], side, tf is not None, tp is not None, (tf - px) * side / risk if tf is not None else np.nan))
        sc = {k: {(x["time"], x["side"]): x for x in FP.score_all(coin, d[["open", "high", "low", "close"]], s, FR.HOLD, ci, a)}
              for k, s in sigs.items()}
        for k, side, hf, hp, rr in has:
            key = (d.index[k], side)
            if key not in sc["base"] or not (L1.T0 <= key[0] < L1.T1):
                continue
            rows.append(dict(coin=coin, time=key[0], side=side, R=sc["base"][key]["R"], R_fib=sc["fib"][key]["R"],
                             R_plac=sc["plac"][key]["R"], has_fib=hf, has_plac=hp, fib_R=rr))
        print(coin, len(has), flush=True)
    z = pd.DataFrame(rows)
    z.to_csv(os.path.join(HERE, "out", "L-3_trades.csv.gz"), index=False)
    wk = pd.to_datetime(z.time, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
    weeks = pd.unique(wk)
    rng = np.random.default_rng(13)
    draws = [np.flatnonzero(np.isin(wk, rng.choice(weeks, len(weeks)))) for _ in range(1000)]
    f, p = z.has_fib.values, z.has_plac.values
    df, dp = (z.R_fib - z.R).values, (z.R_plac - z.R).values
    v = np.array([df[ix][f[ix]].mean() for ix in draws])
    lo, hi = np.percentile(v, [2.5, 97.5])
    out = [f"L-3: cycle Fibonacci targets on R-1u, development (53 coins, 2018-2022), {len(z)} trades",
           f"  a Fibonacci target found on {f.sum()} trades ({f.mean():.0%}); its distance median {np.nanmedian(z.fib_R):.2f}R",
           f"  R per trade on those trades: 2R {z.R[f].mean():+.3f}, Fibonacci target {z.R_fib[f].mean():+.3f}; paired difference "
           f"{df[f].mean():+.3f} [{lo:+.3f}, {hi:+.3f}]",
           f"  placebo ratios: found on {p.sum()} trades; paired difference {dp[p].mean():+.3f}",
           f"  verdict: {'PASS' if lo > 0 and df[f].mean() > dp[p].mean() else 'fail'} (interval above zero and above the placebo)"]
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "r1_fibtgt.txt"), "w").write(t + "\n")
    E.log("L-3", "R-1 cycle Fibonacci target", "iteration", dict(n=int(f.sum()), edge=float(df[f].mean()), lo=float(lo), hi=float(hi)),
          bool(lo > 0 and df[f].mean() > dp[p].mean()), f"placebo {dp[p].mean():+.3f}")


if __name__ == "__main__":
    main()
