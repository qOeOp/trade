"""Loop L-4 (loop/LOG.md): entries on a test of a trend line drawn by drawer D, in R-1's trend state.
Usage: python loop/family_tl.py"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import family_p as FP  # noqa: E402
import family_r as FR  # noqa: E402
import r1_lines2 as L2  # noqa: E402

T0, T1 = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
VARIANTS = {"L-4a": (0.5, 0.0), "L-4b": (1.0, 0.0), "L-4a placebo": (0.5, 1.0), "L-4b placebo": (1.0, 1.0)}


def signals(d):
    S = FR.state(d)
    o, h, l, c, a, tr = S["o"], S["h"], S["l"], S["c"], S["a"], S["trend"]
    hi = pd.Series(h).rolling(2 * L2.K + 1, center=True).max().values == h
    lo = pd.Series(l).rolling(2 * L2.K + 1, center=True).min().values == l
    piv_h, piv_l = list(np.flatnonzero(hi)), list(np.flatnonzero(lo))
    out = {v: [] for v in VARIANTS}
    busy = {v: -1 for v in VARIANTS}
    for i in range(300, len(c) - 1):
        side = tr[i]
        if side == 0 or np.isnan(a[i]):
            continue
        if all(i + 1 <= busy[v] for v in VARIANTS):
            continue
        lines = L2.drawer(h, l, c, a, i, side, piv_h, piv_l)
        if not lines:
            continue
        _, _, y, s, _ = lines[0]
        for v, (stop_atr, shift) in VARIANTS.items():
            if i + 1 <= busy[v]:
                continue
            lim = y + s - side * shift * a[i]
            k = i + 1
            if not ((side == 1 and l[k] <= lim) or (side == -1 and h[k] >= lim)):
                continue
            px = min(o[k], lim) if side == 1 else max(o[k], lim)
            stop = lim - side * stop_atr * a[i]
            if (px - stop) * side <= 0:
                continue
            tgt = px + side * 2 * abs(px - stop)
            out[v].append((k, side, px, stop, tgt))
            busy[v] = FR.exit_bar(S, k, side, stop, tgt)
    return out, a


def main():
    rows = []
    for ci, coin in enumerate(E.ITER_COINS + E.ITER_EXT_COINS):
        d = E.bars(coin)["1d"]
        sig, a = signals(d)
        for v, s in sig.items():
            for x in FP.score_all(coin, d[["open", "high", "low", "close"]], s, FR.HOLD, ci, a):
                if T0 <= x["time"] < T1:
                    rows.append(dict(x, variant=v))
        print(coin, {v: len(s) for v, s in sig.items()}, flush=True)
    z = pd.DataFrame(rows).dropna(subset=["R", "control"])
    z.to_csv(os.path.join(HERE, "out", "L-4_trades.csv.gz"), index=False)
    lines = ["L-4: entry on a test of drawer D's trend line in R-1's trend state, development (53 coins, 2018-2022)"]
    res = {}
    for v, g in z.groupby("variant"):
        lo, hi = attrib.week_boot(g)
        e = float((g.R - g.control).mean())
        res[v] = (e, lo, hi)
        lines.append(f"  {v}: n {len(g)}, avg R {g.R.mean():+.3f}, edge {e:+.3f} [{lo:+.3f}, {hi:+.3f}]")
    for v in ("L-4a", "L-4b"):
        e, lo, hi = res.get(v, (np.nan,) * 3)
        pe = res.get(v + " placebo", (np.nan,))[0]
        ok = lo > 0 and e >= 0.10 and e > pe
        lines.append(f"  {v}: {'PASS' if ok else 'fail'} at stage 1 (placebo edge {pe:+.3f}); "
                     f"{'harmful' if hi < 0 else ('equivalent-null' if hi < 0.10 else ('active' if ok else 'inconclusive'))}")
        E.log(v, "trend-line test entry", "iteration", dict(n=int((z.variant == v).sum()), edge=e, lo=lo, hi=hi), ok, f"placebo {pe:+.3f}")
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "family_tl.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
