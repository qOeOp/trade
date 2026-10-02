"""Loop L-1 (loop/LOG.md): Ronnie's trend lines, channels and cycle Fibonacci as tags and a target on the R-1u
development trades (53 coins, 2018-2022), each against a placebo. Usage: python loop/r1_lines.py"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_p as FP  # noqa: E402
import family_r as FR  # noqa: E402

T0, T1 = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
KL, KF = 5, 20
FIB, FIB_P = (0.382, 0.5, 0.618), (0.32, 0.44, 0.70)


def confirmed_pivots(h, l, k):
    """per bar i: the confirmed pivot highs and lows (index lists) known at i (a pivot j is known at j + k)"""
    n = len(h)
    hi = pd.Series(h).rolling(2 * k + 1, center=True).max().values == h
    lo = pd.Series(l).rolling(2 * k + 1, center=True).min().values == l
    ph, pl, out_h, out_l = [], [], [None] * n, [None] * n
    for i in range(n):
        j = i - k
        if j >= k:
            if hi[j]:
                ph.append(j)
            if lo[j]:
                pl.append(j)
        out_h[i], out_l[i] = (ph[-2:] if len(ph) >= 2 else None), (pl[-2:] if len(pl) >= 2 else None)
    return out_h, out_l, ph, pl


def lines(d):
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    a = E.MT.atr_of(h, l, c)
    n = len(c)
    ph2, pl2, _, _ = confirmed_pivots(h, l, KL)
    sup, res = np.full(n, np.nan), np.full(n, np.nan)  # line values at each bar (support rising, resistance falling)
    sup_un = np.zeros(n, bool)  # support unbroken since its later pivot
    res_un = np.zeros(n, bool)
    sup_def, res_def = [None] * n, [None] * n
    for i in range(n):
        if pl2[i] is not None:
            j1, j2 = pl2[i]
            if l[j2] > l[j1]:
                y = lambda m: l[j1] + (l[j2] - l[j1]) * (m - j1) / (j2 - j1)  # noqa: E731
                sup[i] = y(i)
                sup_un[i] = all(c[m] >= y(m) - 0.1 * a[m] for m in range(j2 + 1, i + 1))
                sup_def[i] = (j1, j2)
        if ph2[i] is not None:
            j1, j2 = ph2[i]
            if h[j2] < h[j1]:
                y = lambda m: h[j1] + (h[j2] - h[j1]) * (m - j1) / (j2 - j1)  # noqa: E731
                res[i] = y(i)
                res_un[i] = all(c[m] <= y(m) + 0.1 * a[m] for m in range(j2 + 1, i + 1))
                res_def[i] = (j1, j2)
    return dict(o=o, h=h, l=l, c=c, a=a, sup=sup, res=res, sup_un=sup_un, res_un=res_un, sup_def=sup_def, res_def=res_def)


def tl_state(L, shift):
    """+1 after a close above the falling resistance line, -1 after a close below the rising support line (lines moved
    by shift ATR: resistance up, support down, for the placebo)"""
    c, a = L["c"], L["a"]
    st, cur = np.zeros(len(c), int), 0
    for m in range(1, len(c)):
        r, s = L["res"][m], L["sup"][m]
        if not np.isnan(r) and c[m] > r + shift * a[m] and c[m - 1] <= r + shift * a[m]:
            cur = 1
        if not np.isnan(s) and c[m] < s - shift * a[m] and c[m - 1] >= s - shift * a[m]:
            cur = -1
        st[m] = cur
    return st


def trades(d):
    """R-1u trades with their arming bar, as family_r.signals (first fill takes the slot)"""
    S = FR.state(d)
    c, a, tr = S["c"], S["a"], S["trend"]
    cand = []
    for i, kind, p in S["events"]:
        if kind not in ("break_high", "break_low") or i + 1 >= len(c) or np.isnan(a[i]):
            continue
        side = 1 if kind == "break_high" else -1
        if tr[i] != side:
            continue
        lvl, edge = p[1], p[2]
        lower = max(edge, lvl - a[i]) if side == 1 else min(edge, lvl + a[i])
        stop = lower - side * FR.BUF * a[i]
        k, px = FR.fill(S, i + 1, side, lvl)
        if k is None or (px - stop) * side <= 0:
            continue
        cand.append(dict(i=i, k=k, side=side, px=px, stop=stop, lvl=lvl))
    out, busy = [], -1
    for t in sorted(cand, key=lambda t: t["k"]):
        if t["k"] <= busy:
            continue
        t["tgt"] = t["px"] + t["side"] * 2 * abs(t["px"] - t["stop"])
        busy = FR.exit_bar(S, t["k"], t["side"], t["stop"], t["tgt"])
        out.append(t)
    return out


def fib_levels(L, i, side, piv_h, piv_l, ratios):
    h, l, a = L["h"], L["l"], L["a"][i]
    known = [j for j in (piv_l if side == 1 else piv_h) if j + KF <= i]
    if not known:
        return None
    A = known[-1]
    if side == 1:
        B = h[A:i + 1].max()
        span = B - l[A]
        return [B - r * span for r in ratios] if span >= 5 * a else None
    B = l[A:i + 1].min()
    span = h[A] - B
    return [B + r * span for r in ratios] if span >= 5 * a else None


def main():
    rows = []
    for ci, coin in enumerate(E.ITER_COINS + E.ITER_EXT_COINS):
        d = E.bars(coin)["1d"]
        L = lines(d)
        st = {s: tl_state(L, s) for s in (0.0, 1.0, -1.0)}
        _, _, piv_h, piv_l = confirmed_pivots(L["h"], L["l"], KF)
        h, l, a = L["h"], L["l"], L["a"]
        sigs = {"base": [], "chan": [], "chan07": [], "chan13": []}
        meta = []
        for t in trades(d):
            i, side, lvl, px, stop = t["i"], t["side"], t["lvl"], t["px"], t["stop"]
            ai, risk = a[i], abs(px - stop)
            own = L["sup"][i] if side == 1 else L["res"][i]
            own_ok = (L["sup_un"][i] if side == 1 else L["res_un"][i]) and not np.isnan(own)
            m = dict(coin=coin, k=t["k"], side=side)
            m["L1"] = bool(own_ok and abs(own - lvl) <= 0.5 * ai)
            m["L1p"] = bool(own_ok and min(abs(own + s * ai - lvl) for s in (-1, 1)) <= 0.5 * ai)
            m["L2"] = bool(st[0.0][i] == side)
            m["L2p"] = bool(st[1.0][i] == side), bool(st[-1.0][i] == side)
            fl, fp = fib_levels(L, i, side, piv_h, piv_l, FIB), fib_levels(L, i, side, piv_h, piv_l, FIB_P)
            m["L4"] = bool(fl and min(abs(x - lvl) for x in fl) <= 0.25 * ai)
            m["L4p"] = bool(fp and min(abs(x - lvl) for x in fp) <= 0.25 * ai)
            # channel: the trade-side line plus a parallel through the far extreme since its first pivot
            rail = {}
            dfn = L["sup_def"][i] if side == 1 else L["res_def"][i]
            if own_ok and dfn is not None:
                j1, j2 = dfn
                y0 = (l if side == 1 else h)
                slope = (y0[j2] - y0[j1]) / (j2 - j1)
                ys = y0[j1] + slope * (np.arange(j1, i + 1) - j1)
                off = (h[j1:i + 1] - ys).max() if side == 1 else (l[j1:i + 1] - ys).min()
                for key, f in (("chan", 1.0), ("chan07", 0.7), ("chan13", 1.3)):
                    r = own + f * off
                    rail[key] = r if (r - px) * side >= risk else None
            m["chan"] = rail.get("chan") is not None
            sigs["base"].append((t["k"], side, px, stop, t["tgt"]))
            for key in ("chan", "chan07", "chan13"):
                r = rail.get(key)
                sigs[key].append((t["k"], side, px, stop, r if r is not None else t["tgt"]))
            meta.append(m)
        scored = {key: FP.score_all(coin, d[["open", "high", "low", "close"]], s, FR.HOLD, ci, a) for key, s in sigs.items()}
        bykey = {key: {(x["time"], x["side"]): x for x in v} for key, v in scored.items()}
        for m in meta:
            key = (d.index[m["k"]], m["side"])
            b = bykey["base"].get(key)
            if b is None or not (T0 <= b["time"] < T1):
                continue
            row = dict(m, time=b["time"], R=b["R"], control=b["control"])
            for kk in ("chan", "chan07", "chan13"):
                row["R_" + kk] = bykey[kk][key]["R"] if key in bykey[kk] else np.nan
            rows.append(row)
        print(coin, len(meta), flush=True)
    z = pd.DataFrame(rows).dropna(subset=["R", "control"])
    z.to_csv(os.path.join(HERE, "out", "L-1_trades.csv.gz"), index=False)
    z["e"] = z.R - z.control
    wk = pd.to_datetime(z.time, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
    weeks = pd.unique(wk)
    rng = np.random.default_rng(11)
    draws = [np.flatnonzero(np.isin(wk, rng.choice(weeks, len(weeks)))) for _ in range(1000)]

    def tag_diff(mask, idx=None):
        g = z.iloc[idx] if idx is not None else z
        mk = mask[idx] if idx is not None else mask
        return g.e[mk].mean() - g.e[~mk].mean()

    def boot(fn):
        v = np.array([fn(ix) for ix in draws])
        return np.nanpercentile(v, [2.5, 97.5]), float(np.mean(v <= 0))

    lines_out = [f"L-1: trend lines, channels and cycle Fibonacci on R-1u, development (53 coins, 2018-2022), {len(z)} trades",
                 f"  R-1u edge {z.e.mean():+.3f}"]
    res = {}
    for tag, pl in (("L1", "L1p"), ("L2", "L2p"), ("L4", "L4p")):
        mask = z[tag].values.astype(bool)
        if tag == "L2":
            pms = [np.array([x[0] for x in z.L2p]), np.array([x[1] for x in z.L2p])]
        else:
            pms = [z[pl].values.astype(bool)]
        real = tag_diff(mask)
        plac = np.mean([tag_diff(pm) for pm in pms])
        (lo, hi), p = boot(lambda ix: tag_diff(mask, ix))
        res[tag] = (p, lo, real, plac)
        lines_out.append(f"  {tag} tag: {mask.sum()} tagged ({mask.mean():.0%}), tagged edge {z.e[mask].mean():+.3f} vs untagged "
                         f"{z.e[~mask].mean():+.3f}: difference {real:+.3f} [{lo:+.3f}, {hi:+.3f}]; placebo difference {plac:+.3f}"
                         f" (placebo tagged {np.mean([pm.mean() for pm in pms]):.0%})")
    ch = z[z.chan.astype(bool)]
    diff = (ch.R_chan - ch.R).values
    pl = np.nanmean([(ch.R_chan07 - ch.R).mean(), (ch.R_chan13 - ch.R).mean()])
    idx_ch = np.flatnonzero(z.chan.astype(bool).values)
    pos = {v: n for n, v in enumerate(idx_ch)}
    v = []
    for ix in draws:
        sel = [pos[x] for x in ix if x in pos]
        v.append(np.nanmean(diff[sel]) if sel else np.nan)
    v = np.array(v)
    lo, hi = np.nanpercentile(v, [2.5, 97.5])
    res["L3"] = (float(np.nanmean(v <= 0)), lo, float(np.nanmean(diff)), pl)
    lines_out.append(f"  L3 channel target: {len(ch)} trades with a channel ({len(ch) / len(z):.0%}); far rail minus 2R, paired "
                     f"{np.nanmean(diff):+.3f}R [{lo:+.3f}, {hi:+.3f}]; placebo rails (0.7x, 1.3x) {pl:+.3f}R")
    order = sorted(res, key=lambda k: res[k][0])
    lines_out.append("  Holm (95%, four tests): " + ", ".join(
        f"{k} p {res[k][0]:.3f} vs {0.05 / (4 - n):.4f} -> {'PASS' if res[k][0] <= 0.05 / (4 - n) and res[k][2] > res[k][3] else 'fail'}"
        for n, k in enumerate(order)))
    t = "\n".join(lines_out)
    print(t)
    open(os.path.join(HERE, "r1_lines.txt"), "w").write(t + "\n")
    for k, (p, lo, real, plac) in res.items():
        E.log(f"L-1 {k}", "R-1 lines", "iteration", dict(n=len(z), edge=real, lo=lo, hi=np.nan), False, f"placebo {plac:+.3f}; p {p:.3f}")


if __name__ == "__main__":
    main()
