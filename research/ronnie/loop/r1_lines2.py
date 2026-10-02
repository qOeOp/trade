"""Loop L-2 (loop/LOG.md): L-1's trend-line tests repeated with drawer D, the drawer calibrated to reproduce Ronnie's
own lines (tv_line_fidelity.py): order-5 pivots, look-back 700 bars, lines never closed through since their first
pivot, the top two per side by touches (then span), within 3 ATR of price. Usage: python loop/r1_lines2.py"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_p as FP  # noqa: E402
import family_r as FR  # noqa: E402
import r1_lines as L1  # noqa: E402

T0, T1 = L1.T0, L1.T1
K, LOOK, TOP = 5, 700, 2


def drawer(h, l, c, a, i, side, piv_h, piv_l):
    """D's lines at bar i on one side: list of (value at i, slope, first pivot, far extreme offset) for the top lines"""
    ext = l if side == 1 else h
    P = np.array([j for j in (piv_l if side == 1 else piv_h) if i - LOOK <= j and j + K <= i])
    if len(P) < 2:
        return []
    V = ext[P]
    out = []
    for u in range(len(P) - 1):
        j1 = P[u]
        m = np.arange(j1 + 1, i + 1)
        if side == 1:
            smax = np.min((c[m] + 0.1 * a[m] - V[u]) / (m - j1))
        else:
            smin = np.max((c[m] - 0.1 * a[m] - V[u]) / (m - j1))
        for v in range(u + 1, len(P)):
            s = (V[v] - V[u]) / (P[v] - j1)
            if (side == 1 and s > smax) or (side == -1 and s < smin):
                continue
            y_i = V[u] + s * (i - j1)
            if (c[i] - y_i) * side <= 0 or abs(c[i] - y_i) > 3 * a[i]:
                continue
            w = P[u:]
            touches = int(np.sum(np.abs(ext[w] - (V[u] + s * (w - j1))) <= 0.2 * a[w]))
            out.append((touches, P[v] - j1, y_i, s, j1))
    out.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return out[:TOP]


def main():
    rows = []
    for ci, coin in enumerate(E.ITER_COINS + E.ITER_EXT_COINS):
        d = E.bars(coin)["1d"]
        o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
        a = E.MT.atr_of(h, l, c)
        hi = pd.Series(h).rolling(2 * K + 1, center=True).max().values == h
        lo = pd.Series(l).rolling(2 * K + 1, center=True).min().values == l
        piv_h, piv_l = list(np.flatnonzero(hi)), list(np.flatnonzero(lo))
        sigs = {"base": [], "chan": [], "chan07": [], "chan13": []}
        meta = []
        for t in L1.trades(d):
            i, side, lvl, px, stop = t["i"], t["side"], t["lvl"], t["px"], t["stop"]
            ai, risk = a[i], abs(px - stop)
            own = drawer(h, l, c, a, i, side, piv_h, piv_l)
            m = dict(coin=coin, k=t["k"], side=side)
            m["L1"] = any(abs(y - lvl) <= 0.5 * ai for _, _, y, _, _ in own)
            m["L1p"] = any(min(abs(y + s_ * ai - lvl) for s_ in (-1, 1)) <= 0.5 * ai for _, _, y, _, _ in own)
            # L2': opposite-side lines known 20 bars before arming, closed through in the trade's direction since
            j0 = i - 20
            opp = drawer(h, l, c, a, j0, -side, piv_h, piv_l) if j0 > LOOK // 4 else []

            def broke(shift):
                for _, _, y0, s, _ in opp:
                    for mm in range(j0 + 1, i + 1):
                        y = y0 + s * (mm - j0) + shift * a[j0]
                        if (c[mm] - y) * side > 0:
                            return True
                return False
            m["L2"], m["L2p"] = broke(0.0), (broke(1.0 * side), broke(-1.0 * side))
            rail = {}
            if own:
                _, _, y, s, j1 = own[0]
                ext = l if side == 1 else h
                idx = np.arange(j1, i + 1)
                ys = ext[j1] + s * (idx - j1)
                off = (h[j1:i + 1] - ys).max() if side == 1 else (l[j1:i + 1] - ys).min()
                for key, f in (("chan", 1.0), ("chan07", 0.7), ("chan13", 1.3)):
                    r = y + f * off
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
    z.to_csv(os.path.join(HERE, "out", "L-2_trades.csv.gz"), index=False)
    z["e"] = z.R - z.control
    wk = pd.to_datetime(z.time, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
    weeks = pd.unique(wk)
    rng = np.random.default_rng(12)
    draws = [np.flatnonzero(np.isin(wk, rng.choice(weeks, len(weeks)))) for _ in range(1000)]
    e = z.e.values

    def diff(mask, ix=None):
        ix = np.arange(len(z)) if ix is None else ix
        mk = mask[ix]
        return e[ix][mk].mean() - e[ix][~mk].mean() if mk.any() and (~mk).any() else np.nan

    out = [f"L-2: L-1 repeated with the calibrated drawer D, development (53 coins, 2018-2022), {len(z)} trades, R-1u edge {e.mean():+.3f}"]
    res = {}
    for tag in ("L1", "L2"):
        mask = z[tag].values.astype(bool)
        pms = [z["L1p"].values.astype(bool)] if tag == "L1" else [np.array([x[0] for x in z.L2p]), np.array([x[1] for x in z.L2p])]
        real, plac = diff(mask), np.nanmean([diff(pm) for pm in pms])
        v = np.array([diff(mask, ix) for ix in draws])
        lo, hi = np.nanpercentile(v, [2.5, 97.5])
        res[tag] = (float(np.nanmean(v <= 0)), real, plac)
        out.append(f"  {tag}' tag: {mask.sum()} tagged ({mask.mean():.0%}), edge {e[mask].mean():+.3f} vs {e[~mask].mean():+.3f}: "
                   f"difference {real:+.3f} [{lo:+.3f}, {hi:+.3f}]; placebo {plac:+.3f} (placebo tagged {np.mean([pm.mean() for pm in pms]):.0%})")
    chm = z.chan.values.astype(bool)
    dd = (z.R_chan - z.R).values
    pl = np.nanmean([np.nanmean((z.R_chan07 - z.R).values[chm]), np.nanmean((z.R_chan13 - z.R).values[chm])])
    v = np.array([np.nanmean(dd[ix][chm[ix]]) for ix in draws])
    lo, hi = np.nanpercentile(v, [2.5, 97.5])
    res["L3"] = (float(np.nanmean(v <= 0)), float(np.nanmean(dd[chm])), pl)
    out.append(f"  L3' channel target: {chm.sum()} trades ({chm.mean():.0%}); far rail minus 2R {np.nanmean(dd[chm]):+.3f}R "
               f"[{lo:+.3f}, {hi:+.3f}]; placebo rails {pl:+.3f}R")
    order = sorted(res, key=lambda k: res[k][0])
    out.append("  Holm (95%, three tests): " + ", ".join(
        f"{k}' p {res[k][0]:.3f} vs {0.05 / (3 - n):.4f} -> {'PASS' if res[k][0] <= 0.05 / (3 - n) and res[k][1] > res[k][2] else 'fail'}"
        for n, k in enumerate(order)))
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "r1_lines2.txt"), "w").write(t + "\n")
    for k, (p, real, plac) in res.items():
        E.log(f"L-2 {k}", "R-1 lines (calibrated drawer)", "iteration", dict(n=len(z), edge=real, lo=np.nan, hi=np.nan), False,
              f"placebo {plac:+.3f}; p {p:.3f}")


if __name__ == "__main__":
    main()
