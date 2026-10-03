"""Loop L-5 (loop/LOG.md): diagonal role reversal. L-5a/b: a large-bodied close through one of drawer D's clean trend
lines in R-1's trend direction arms a limit that follows the broken line for 10 days. L-5c: R-1u orders whose level
meets a broken-and-retested line ("double support"). Development, 53 coins, 2018-2022.
Usage: python loop/family_dr.py"""
import itertools, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import family_p as FP  # noqa: E402
import family_r as FR  # noqa: E402
import r1_lines as L1  # noqa: E402
import r1_lines2 as L2  # noqa: E402

T0, T1 = L1.T0, L1.T1
VARIANTS = {"L-5a": (0.25, 0.0), "L-5b": (0.5, 0.0), "L-5a placebo": (0.25, 1.0), "L-5b placebo": (0.5, 1.0)}


def strong(o, c):
    body = np.abs(c - o)
    med = pd.Series(body).rolling(20).median().shift(1).values
    big = body >= FR.BODY_X * med
    big2 = np.abs(c - np.r_[np.nan, o[:-1]]) >= FR.BODY_X * 2 * med
    up = ((c > o) & big) | ((c > np.r_[np.nan, o[:-1]]) & big2)
    dn = ((c < o) & big) | ((c < np.r_[np.nan, o[:-1]]) & big2)
    return up, dn


def broken_lines(h, l, c, a, i, piv_h, piv_l, window=200):
    """D2's broken kind at bar i (order-5 pivots, 700 bars): lines held until a close through after their later pivot,
    the break within `window` bars, price on the new side on 70% of closes since; -> [(side now, value at i)] top 2/side"""
    out = []
    for own, piv, ext in ((1, [j for j in piv_l if i - L2.LOOK <= j and j + L2.K <= i], l),
                          (-1, [j for j in piv_h if i - L2.LOOK <= j and j + L2.K <= i], h)):
        P = np.array(piv)
        cands = []
        for u, v in itertools.combinations(range(len(P)), 2):
            j1, j2 = P[u], P[v]
            sl = (ext[j2] - ext[j1]) / (j2 - j1)
            y_i = ext[j1] + sl * (i - j1)
            if abs(y_i - c[i]) > 3 * a[i] or (c[i] - y_i) * own >= 0:
                continue
            y = ext[j1] + sl * (np.arange(j1, i + 1) - j1)
            th = np.flatnonzero((c[j1:i + 1] - y) * own < -0.1 * a[j1:i + 1])
            if not len(th) or th[0] + j1 <= j2:
                continue
            b = th[0] + j1
            if i - b > window or np.mean((c[b:i + 1] - y[b - j1:]) * own < 0) < 0.7:
                continue
            w = P[(P >= j1) & (P <= b)]
            touches = int(np.sum(np.abs(ext[w] - (ext[j1] + sl * (w - j1))) <= 0.2 * a[w]))
            cands.append((touches, j2 - j1, y_i))
        cands.sort(reverse=True)
        out += [(-own, y) for _, _, y in cands[:2]]
    return out


def diag_candidates(d, stop_atr=0.5, shift=0.0):
    """L-5 candidate fills (before the slot rule) with their break bar: [(fill bar, side, px, stop, tgt, break bar)]"""
    S = FR.state(d)
    o, h, l, c, a, tr = S["o"], S["h"], S["l"], S["c"], S["a"], S["trend"]
    up, dn = strong(o, c)
    hi = pd.Series(h).rolling(2 * L2.K + 1, center=True).max().values == h
    lo = pd.Series(l).rolling(2 * L2.K + 1, center=True).min().values == l
    piv_h, piv_l = list(np.flatnonzero(hi)), list(np.flatnonzero(lo))
    out = set()
    for i in range(301, len(c) - 1):
        side = tr[i]
        if side == 0 or not ((side == 1 and up[i]) or (side == -1 and dn[i])):
            continue
        for _, _, y0, s, _ in L2.drawer(h, l, c, a, i - 1, -side, piv_h, piv_l):
            y_i = y0 + s + side * shift * a[i - 1]
            if not ((c[i] - y_i) * side > 0 and (c[i - 1] - (y0 + side * shift * a[i - 1])) * side <= 0):
                continue
            for m in range(i + 1, min(i + 1 + FR.VALID, len(c))):
                ym = y_i + s * (m - i)
                if (side == 1 and l[m] <= ym) or (side == -1 and h[m] >= ym):
                    px = min(o[m], ym) if side == 1 else max(o[m], ym)
                    stop = ym - side * stop_atr * a[i]
                    if (px - stop) * side > 0:
                        out.add((m, side, px, stop, px + side * 2 * abs(px - stop), i))
                    break
    return sorted(out), S


def r1_arm_bars(S):
    """bars on which R-1 armed an order (a break in the trend direction)"""
    return sorted({i for i, kind, p in S["events"] if kind in ("break_high", "break_low")
                   and S["trend"][i] == (1 if kind == "break_high" else -1)})


def r1d_signals(d):
    """{'L-5b': standalone, 'diag-only': L-5b breaks with no R-1 arming in the 10 bars up to the break,
    'R-1d': R-1u candidates plus diag-only candidates, one slot per coin, first fill}"""
    cand, S = diag_candidates(d)
    arms = np.array(r1_arm_bars(S))
    only = [x for x in cand if not len(arms) or not np.any((arms >= x[5] - FR.VALID) & (arms <= x[5]))]
    r1 = []
    for i, kind, p in S["events"]:
        if kind not in ("break_high", "break_low") or i + 1 >= len(S["c"]) or np.isnan(S["a"][i]):
            continue
        side = 1 if kind == "break_high" else -1
        if S["trend"][i] != side:
            continue
        lvl, edge = p[1], p[2]
        lower = max(edge, lvl - S["a"][i]) if side == 1 else min(edge, lvl + S["a"][i])
        stop = lower - side * FR.BUF * S["a"][i]
        k, px = FR.fill(S, i + 1, side, lvl)
        if k is None or (px - stop) * side <= 0:
            continue
        r1.append((k, side, px, stop, px + side * 2 * abs(px - stop), i))

    def slot(cs):
        busy, out = -1, []
        for sg in sorted(set(cs), key=lambda x: x[0]):
            if sg[0] <= busy:
                continue
            out.append(sg[:5])
            busy = FR.exit_bar(S, sg[0], sg[1], sg[3], sg[4])
        return out
    return {"L-5b": slot(cand), "diag-only": slot(only), "R-1d": slot(r1 + only), "R-1u": slot(r1)}


def main():
    rows, tags = [], []
    for ci, coin in enumerate(E.ITER_COINS + E.ITER_EXT_COINS):
        d = E.bars(coin)["1d"]
        S = FR.state(d)
        o, h, l, c, a, tr = S["o"], S["h"], S["l"], S["c"], S["a"], S["trend"]
        up, dn = strong(o, c)
        hi = pd.Series(h).rolling(2 * L2.K + 1, center=True).max().values == h
        lo = pd.Series(l).rolling(2 * L2.K + 1, center=True).min().values == l
        piv_h, piv_l = list(np.flatnonzero(hi)), list(np.flatnonzero(lo))
        cand = {v: [] for v in VARIANTS}
        for i in range(301, len(c) - 1):
            side = tr[i]
            if side == 0 or not ((side == 1 and up[i]) or (side == -1 and dn[i])):
                continue
            for _, _, y0, s, _ in L2.drawer(h, l, c, a, i - 1, -side, piv_h, piv_l):  # lines on the far side at i-1
                for v, (stop_atr, shift) in VARIANTS.items():
                    y_i = y0 + s - side * shift * a[i - 1] * (-1)  # moved away from price: up for resistance, down for support
                    if not ((c[i] - y_i) * side > 0 and (c[i - 1] - (y0 - side * shift * a[i - 1] * (-1))) * side <= 0):
                        continue
                    for m in range(i + 1, min(i + 1 + FR.VALID, len(c))):
                        ym = y_i + s * (m - i)
                        if (side == 1 and l[m] <= ym) or (side == -1 and h[m] >= ym):
                            px = min(o[m], ym) if side == 1 else max(o[m], ym)
                            stop = ym - side * stop_atr * a[i]
                            if (px - stop) * side > 0:
                                cand[v].append((m, side, px, stop, px + side * 2 * abs(px - stop)))
                            break
        sigs = {}
        for v, cs in cand.items():
            busy, out = -1, []
            for sg in sorted(set(cs), key=lambda x: x[0]):
                if sg[0] <= busy:
                    continue
                out.append(sg)
                busy = FR.exit_bar(S, sg[0], sg[1], sg[3], sg[4])
            sigs[v] = out
        for v, s in sigs.items():
            for x in FP.score_all(coin, d[["open", "high", "low", "close"]], s, FR.HOLD, ci, a):
                if T0 <= x["time"] < T1:
                    rows.append(dict(x, variant=v))
        # L-5c: double support on R-1u orders
        base = []
        meta = []
        for t in L1.trades(d):
            i, side, lvl = t["i"], t["side"], t["lvl"]
            bl = [y for sd, y in broken_lines(h, l, c, a, i, piv_h, piv_l) if sd == side]
            meta.append((t["k"], side, any(abs(y - lvl) <= 0.5 * a[i] for y in bl),
                         any(min(abs(y + s_ * a[i] - lvl) for s_ in (-1, 1)) <= 0.5 * a[i] for y in bl)))
            base.append((t["k"], side, t["px"], t["stop"], t["tgt"]))
        sc = {(x["time"], x["side"]): x for x in FP.score_all(coin, d[["open", "high", "low", "close"]], base, FR.HOLD, ci, a)}
        for k, side, tg, tp in meta:
            x = sc.get((d.index[k], side))
            if x is not None and T0 <= x["time"] < T1:
                tags.append(dict(time=x["time"], R=x["R"], control=x["control"], tag=tg, plac=tp))
        print(coin, {v: len(s) for v, s in sigs.items()}, flush=True)
    z = pd.DataFrame(rows).dropna(subset=["R", "control"])
    z.to_csv(os.path.join(HERE, "out", "L-5_trades.csv.gz"), index=False)
    out = ["L-5: diagonal role reversal, development (53 coins, 2018-2022)"]
    res = {}
    for v, g in z.groupby("variant"):
        lo, hi = attrib.week_boot(g)
        e = float((g.R - g.control).mean())
        res[v] = (e, lo, hi)
        out.append(f"  {v}: n {len(g)}, avg R {g.R.mean():+.3f}, edge {e:+.3f} [{lo:+.3f}, {hi:+.3f}]")
    for v in ("L-5a", "L-5b"):
        e, lo, hi = res.get(v, (np.nan,) * 3)
        pe = res.get(v + " placebo", (np.nan,))[0]
        lo975 = attrib.week_boot(z[z.variant == v], level=97.5)[0] if v in res else np.nan
        ok = lo975 > 0 and e >= 0.10 and e > pe
        out.append(f"  {v}: {'PASS' if ok else 'fail'} (Holm first step at 97.5%: lower {lo975:+.3f}; placebo {pe:+.3f}); "
                   f"{'harmful' if hi < 0 else ('equivalent-null' if hi < 0.10 else ('active' if ok else 'inconclusive'))}")
        E.log(v, "diagonal role reversal", "iteration", dict(n=int((z.variant == v).sum()), edge=e, lo=lo, hi=hi), ok, f"placebo {pe:+.3f}")
    q = pd.DataFrame(tags)
    q["e"] = q.R - q.control
    wk = pd.to_datetime(q.time, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
    weeks = pd.unique(wk)
    rng = np.random.default_rng(15)
    tg, tp, e = q.tag.values.astype(bool), q.plac.values.astype(bool), q.e.values
    dif = lambda m, ix: e[ix][m[ix]].mean() - e[ix][~m[ix]].mean()  # noqa: E731
    allix = np.arange(len(q))
    v = np.array([dif(tg, np.flatnonzero(np.isin(wk, rng.choice(weeks, len(weeks))))) for _ in range(1000)])
    lo, hi = np.nanpercentile(v, [2.5, 97.5])
    real, plac = dif(tg, allix), dif(tp, allix)
    out.append(f"  L-5c double support: {tg.sum()} of {len(q)} R-1u trades tagged ({tg.mean():.0%}); edge {e[tg].mean():+.3f} vs {e[~tg].mean():+.3f}: "
               f"difference {real:+.3f} [{lo:+.3f}, {hi:+.3f}]; placebo {plac:+.3f} ({tp.mean():.0%} tagged) -> "
               f"{'PASS' if lo > 0 and real > plac else 'fail'}")
    E.log("L-5c", "double support tag", "iteration", dict(n=int(tg.sum()), edge=real, lo=lo, hi=hi), bool(lo > 0 and real > plac), f"placebo {plac:+.3f}")
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "family_dr.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
