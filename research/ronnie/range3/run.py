"""TrialFamily range-v3: box breakout (X1), overreaction fade (X2) and regime-gated box fade (X3). See INTENT.md.

Writes range3/events.csv.gz and range3/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
_spec = importlib.util.spec_from_file_location("range2_run", os.path.join(ROOT, "range2", "run.py"))
R2 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R2)
MT = R2.MT

BODY, VOLX, FADE_PAD, RETRACE, FADE_HOLD = 2.5, 3.0, 0.25, 0.5, 12
VR_BARS, VR_K, VR_MAX, ADX_MAX = 720, 4, 0.9, 20.0
HOLDOUT = ("STRAX", "LSK", "CTK", "GTC", "REQ", "FIDA", "DEXE", "AUCTION", "DIA", "ONG", "RAY", "RIF", "WAXP", "XVG")
DEV = R2.DEV
HOLD = (pd.Timestamp("2022-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))


def adx(h, l, c, n=14):
    up, dn = np.diff(h, prepend=h[0]), -np.diff(l, prepend=l[0])
    plus = np.where((up > dn) & (up > 0), up, 0.0)
    minus = np.where((dn > up) & (dn > 0), dn, 0.0)
    a = MT.atr_of(h, l, c, n)
    sm = lambda x: pd.Series(x).ewm(alpha=1 / n, adjust=False).mean().values  # noqa: E731
    pdi, mdi = 100 * sm(plus) / a, 100 * sm(minus) / a
    dx = 100 * np.abs(pdi - mdi) / np.maximum(pdi + mdi, 1e-12)
    return sm(dx)


def variance_ratio(c1):
    """VR(k) of 1h log returns over the prior VR_BARS bars, known at each bar's close."""
    r = pd.Series(np.diff(np.log(c1), prepend=np.log(c1[0])))
    rk = r.rolling(VR_K).sum()
    return (rk.rolling(VR_BARS).var() / (VR_K * r.rolling(VR_BARS).var())).values


def x1(d, top, bot, a):
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    out, used = [], set()
    for i in range(R2.W + 21, len(c) - 1):
        t, b = top[i - 1], bot[i - 1]  # the box known at the bar before the break
        if np.isnan(t):
            continue
        for side, edge in ((1, t), (-1, b)):
            key = (round(t, 10), round(b, 10), side)
            if key in used or (c[i] - edge) * side <= 0:
                continue
            used.add(key)
            mid, width = (t + b) / 2, t - b
            entry = o[i + 1]
            if (entry - mid) * side > 0:
                out.append((i + 1, side, entry, mid, entry + side * width))
    return out


def x2(d1h, d4h, box4_active):
    o, h, l, c, v = (d1h[x].values for x in ("open", "high", "low", "close", "volume"))
    a = MT.atr_of(h, l, c)
    vm = pd.Series(v).shift(1).rolling(20).mean().values
    k4 = d4h.index.searchsorted(d1h.index, side="right") - 1  # the 4h bar each hour belongs to
    out = {"X2": [], "X2-any": []}
    for i in range(300, len(c) - 1):
        body = c[i] - o[i]
        if abs(body) < BODY * a[i - 1] or not vm[i] > 0 or v[i] < VOLX * vm[i]:
            continue
        side = -1 if body > 0 else 1
        stop = (h[i] if body > 0 else l[i]) - side * FADE_PAD * a[i - 1]
        entry = o[i + 1]
        tgt = c[i] + side * RETRACE * abs(body)
        if (entry - stop) * side <= 0 or (tgt - entry) * side <= 0:
            continue
        sig = (i + 1, side, entry, stop, tgt)
        out["X2-any"].append(sig)
        j = k4[i] - 1  # the last 4h bar closed before this hour
        if j >= 0 and box4_active[j]:
            out["X2"].append(sig)
    return out


def score(coin, tf, variant, d, sigs, a, rng, hold):
    saved = R2.HOLD
    R2.HOLD = hold
    try:
        return R2.score(coin, tf, variant, d, sigs, a, rng)
    finally:
        R2.HOLD = saved


def market(coin, bars, t0, t1, rng):
    rows = []
    frames = {tf: bars[tf][["open", "high", "low", "close", "volume"]] for tf in ("1h", "4h")}
    bx = {tf: R2.boxes(frames[tf]) for tf in frames}
    vr = variance_ratio(frames["1h"].close.values)
    d4 = frames["4h"]
    ax = adx(d4.high.values, d4.low.values, d4.close.values)
    for tf, d in frames.items():
        top, bot, a = bx[tf]
        rows += score(coin, tf, "X1", d, x1(d, top, bot, a), a, rng, R2.HOLD)
        # X3: range-v2 C entries gated by the regime known at the signal bar's close
        close_t = d.index + pd.Timedelta(hours=1 if tf == "1h" else 4)
        jh = frames["1h"].index.searchsorted(close_t) - 1  # the last 1h bar closed by then
        j4 = d4.index.searchsorted(close_t - pd.Timedelta(hours=4), side="right") - 1  # the last closed 4h bar
        ok = (jh >= 0) & (j4 >= 0)
        gate = np.zeros(len(d), bool)
        gate[ok] = (vr[jh[ok]] < VR_MAX) & (ax[j4[ok]] < ADX_MAX)
        sigs = [s for s in R2.signals(d[["open", "high", "low", "close"]], top, bot, a)["C"] if gate[s[0] - 1]]
        rows += score(coin, tf, "X3", d, sigs, a, rng, R2.HOLD)
    active4 = ~np.isnan(bx["4h"][0])
    fades = x2(frames["1h"], d4, active4)
    for v in ("X2", "X2-any"):
        rows += score(coin, "1h", v, frames["1h"], fades[v], bx["1h"][2], rng, FADE_HOLD)
    return [r for r in rows if t0 <= r["time"] < t1]


def main():
    from evaluate import holdout_bars
    rng = np.random.default_rng(23)
    rows = []
    for name_set, coins, (t0, t1) in (("dev", R2.COINS, DEV), ("holdout", HOLDOUT, HOLD)):
        for coin in coins:
            rows += [dict(r, set=name_set) for r in market(coin, holdout_bars(coin), t0, t1, rng)]
            print(f"{coin}: {sum(r['coin'] == coin for r in rows)} signals", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["R", "control"])
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    out = ["range-v3: box breakout (X1), overreaction fade (X2), regime-gated box fade (X3); avg R net of 0.06%/side;",
           "control = 20 random entries, same geometry; 95% coin-then-signal intervals",
           "variant tf  set        n      win   avgR    control  minus control [interval]  median target R"]
    verdict = []
    for (v, tf), g in ev.groupby(["variant", "tf"], sort=False):
        lows = []
        for s in ("dev", "holdout"):
            z = g[g.set == s]
            if len(z) < 5 or z.coin.nunique() < 2:
                out.append(f"{v:<7} {tf:<3} {s:<8} {len(z):5d}  too few")
                lows.append(-1)
                continue
            lo, hi = R2.coin_boot(z)
            lows.append(lo)
            out.append(f"{v:<7} {tf:<3} {s:<8} {len(z):5d}  {np.mean(z.R > 0):.0%}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   "
                       f"{(z.R - z.control).mean():+.3f} [{lo:+.3f}, {hi:+.3f}]  {z.target_R.median():.2f}")
        if v != "X2-any":
            verdict.append(f"{v} {tf} {'HOLDS' if min(lows) > 0 else 'fails'}")
    out.append("decision (X2-any is reported, not decided): " + "; ".join(verdict))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
