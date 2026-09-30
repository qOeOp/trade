"""TrialFamily patterns-v1: converging triangle and wedge breakouts (raw, confirmed, retest). See INTENT.md.

Writes patterns/events.csv.gz and patterns/result.txt. Also defines HOLDOUT (shared with stops-v1).
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, path))
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, os.path.dirname(spec.origin))
    spec.loader.exec_module(mod)
    return mod


SR = _load("setups_run", "setups/run.py")  # trade(), ci(), COST, HOLD, CONTROLS

K, SPAN, MIN_AGE, MAX_LAST, SQUEEZE, MIN_W, MAX_STOP = 5, 80, 20, 30, 0.6, 1.5, 6.0
BODY, OUTER, VOL, RETEST_BARS, RETEST_PAD = 0.5, 0.7, 1.2, 10, 0.25
DEV_END = pd.Timestamp("2023-01-01", tz="UTC")
HOLD_START, HOLD_END = pd.Timestamp("2021-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC")
HOLDOUT = ("IOTA", "KSM", "RUNE", "SNX", "COMP", "BAT", "ZIL", "ONT", "FET", "1INCH", "ENJ", "KAVA", "SUSHI", "YFI", "CELO",
           "ANKR", "STORJ", "IOST", "ONE", "RVN")  # the INTENT list minus LRC and SXP (no 2026-08 archive)
VARIANTS = ("W-raw", "W-confirm", "W-retest")
RNG = np.random.default_rng(83)


def atr_of(h, l, c):
    tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    return pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values


def pivots(h, l, k=K):
    ph, pl = [], []
    for j in range(k, len(h) - k):
        if h[j] == h[j - k:j + k + 1].max():
            ph.append(j)
        if l[j] == l[j - k:j + k + 1].min():
            pl.append(j)
    return ph, pl


def signals(d4, has_volume):
    """-> {variant: [(signal bar, side, stop, target price)]}; targets are measured from the next open."""
    o, h, l, c, v = (d4[x].values.astype(float) for x in ("open", "high", "low", "close", "volume"))
    n = len(c)
    atr = atr_of(h, l, c)
    vmean = pd.Series(v).shift(1).rolling(20).mean().values
    ph, pl = pivots(h, l)
    out = {x: [] for x in VARIANTS}
    done = set()
    a_h = a_l = 0
    for i in range(SPAN, n - 1):
        while a_h < len(ph) and ph[a_h] + K <= i:
            a_h += 1
        while a_l < len(pl) and pl[a_l] + K <= i:
            a_l += 1
        if a_h < 2 or a_l < 2:
            continue
        hA, hB, lA, lB = ph[a_h - 2], ph[a_h - 1], pl[a_l - 2], pl[a_l - 1]
        first, last = min(hA, lA), max(hB, lB)
        if first < i - SPAN or first > i - MIN_AGE or last < i - MAX_LAST:
            continue
        up = lambda x: h[hA] + (h[hB] - h[hA]) * (x - hA) / (hB - hA)  # noqa: E731
        dn = lambda x: l[lA] + (l[lB] - l[lA]) * (x - lA) / (lB - lA)  # noqa: E731
        w0, wi = up(first) - dn(first), up(i) - dn(i)
        if not (0 < wi < SQUEEZE * w0) or wi < MIN_W * atr[i]:
            continue
        for side in (1, -1):
            line = up if side == 1 else dn
            key = (hA, hB, lA, lB, side)
            if key in done or not ((c[i] - line(i)) * side > 0 and (c[i - 1] - line(i - 1)) * side <= 0):
                continue
            done.add(key)
            stop = min(l[lB], dn(i)) if side == 1 else max(h[hB], up(i))
            tgt = o[i + 1] + side * w0
            if abs(o[i + 1] - stop) > MAX_STOP * atr[i]:
                continue
            out["W-raw"].append((i, side, stop, tgt))
            rg = h[i] - l[i]
            strong = rg > 0 and (c[i] - o[i]) * side >= BODY * atr[i] and ((c[i] - l[i]) if side == 1 else (h[i] - c[i])) / rg >= OUTER
            if strong and (not has_volume or (vmean[i] > 0 and v[i] >= VOL * vmean[i])):
                out["W-confirm"].append((i, side, stop, tgt))
            for j in range(i + 1, min(i + 1 + RETEST_BARS, n - 1)):
                if (l[j] <= stop) if side == 1 else (h[j] >= stop):
                    break  # stopped out before any retest
                lv = line(j)
                back = (l[j] <= lv + RETEST_PAD * atr[j]) if side == 1 else (h[j] >= lv - RETEST_PAD * atr[j])
                if back and (c[j] - lv) * side > 0 and (c[j] - o[j]) * side > 0:
                    out["W-retest"].append((j, side, stop, tgt))
                    break
    return out, atr


def events(name, cls, d4, has_volume, t0=None, t1=None):
    cost = SR.COST["fx" if cls == "fx" else "crypto"]
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    sig, atr = signals(d4, has_volume)
    years = d4.index.year.values
    rows = []
    for variant, lst in sig.items():
        for i, side, stop, tp in lst:
            e = i + 1
            if e + SR.HOLD >= len(c) or (t0 is not None and not t0 <= d4.index[e] < t1):
                continue
            risk = (o[e] - stop) * side
            if risk <= 0 or (tp - o[e]) * side < risk:
                continue
            r = SR.trade(o, h, l, c, e, side, stop, tp, cost)
            if r is None:
                continue
            stop_atr, target_r = risk / atr[i], (tp - o[e]) * side / risk
            pool = np.flatnonzero((years == years[e]) & (np.arange(len(c)) > 150) & (np.arange(len(c)) < len(c) - SR.HOLD - 2))
            ctl = [SR.trade(o, h, l, c, j, side, o[j] - side * stop_atr * atr[j - 1], o[j] + side * target_r * stop_atr * atr[j - 1], cost)
                   for j in RNG.choice(pool, SR.CONTROLS)]
            ctl = [x for x in ctl if x is not None]
            rows.append(dict(market=name, cls=cls, variant=variant, entry_time=d4.index[e], side=side, R=r,
                             control=float(np.mean(ctl)) if ctl else np.nan, stop_atr=stop_atr, target_R=target_r))
    return rows


def coin_boot(z, level=95, seed=5):
    rng = np.random.default_rng(seed)
    groups = [g.values for _, g in (z.R - z.control).groupby(z.market)]
    b = []
    for _ in range(4000):
        pick = [groups[k] for k in rng.integers(0, len(groups), len(groups))]
        b.append(np.concatenate([g[rng.integers(0, len(g), len(g))] for g in pick]).mean())
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)


def main():
    import harness as H
    from evaluate import holdout_bars
    FR = _load("filters_run", "filters/run.py")
    rows = []
    for name in ("BTCUSD", "ETHUSDT"):
        rows += events(name, "crypto", H.load(name)["4h"], True)
        print(f"{name}: {sum(r['market'] == name for r in rows)} signals", flush=True)
    for name, d4, _d1 in FR.markets():
        if name in ("BTCUSD", "ETHUSDT"):
            continue
        rows += events(name, "fx", d4, False)
        print(f"{name}: {sum(r['market'] == name for r in rows)} signals", flush=True)
    for coin in HOLDOUT:
        rows += events(coin, "holdout", holdout_bars(coin)["4h"], True, HOLD_START, HOLD_END)
        print(f"{coin}: {sum(r['market'] == coin for r in rows)} signals", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["control"])
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    oos = ev.entry_time >= DEV_END
    out = ["patterns-v1: converging triangle/wedge breakouts; avgR net of costs; control = 20 random entries, same geometry",
           "variant    set               n     win   avgR    control  minus control [interval]"]
    verdict = []
    for vname in VARIANTS:
        res = {}
        for label, m, lvl, fn in (("crypto dev 17-22", (ev.cls == "crypto") & ~oos, 95, SR.ci),
                                  ("fx IS 17-22", (ev.cls == "fx") & ~oos, 95, SR.ci),
                                  ("fx OOS 23-26", (ev.cls == "fx") & oos, 90, SR.ci),
                                  ("holdout 20 coins", ev.cls == "holdout", 95, None)):
            z = ev[(ev.variant == vname) & m]
            if fn is None:
                d = (z.R - z.control).mean()
                lo, hi = coin_boot(z, lvl)
            else:
                d, lo, hi = fn(z.R - z.control, lvl)
            res[label] = lo
            out.append(f"{vname:<10} {label:<16} {len(z):5d}  {np.mean(z.R > 0):.0%}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   "
                       f"{d:+.3f} [{lo:+.3f}, {hi:+.3f}] ({lvl}%)")
        verdict.append(f"{vname}: crypto {'HOLDS' if res['crypto dev 17-22'] > 0 and res['holdout 20 coins'] > 0 else 'fails'}, "
                       f"FX {'HOLDS' if res['fx IS 17-22'] > 0 and res['fx OOS 23-26'] > 0 else 'fails'}")
    out.append("decision: " + "; ".join(verdict))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
