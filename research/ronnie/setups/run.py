"""TrialFamily setups-v1: breakout, trend pullbacks and a range fade on crypto and FX. See setups/INTENT.md.

Outputs setups/events.csv.gz (every signal with its R and control mean) and setups/result.txt.
"""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "filters"))
import ronnie_bt as B  # noqa: E402
import run as FR  # noqa: E402

HOLD, CONTROLS, PAD = 30, 20, 0.25
COST = {"crypto": 0.0006, "fx": 0.00005}
IS_END = pd.Timestamp("2023-01-01", tz="UTC")
SETUPS = ("B1", "P1", "P2", "P3", "R1")
RNG = np.random.default_rng(31)


def trade(o, h, l, c, i, side, stop, tp, cost):
    e = o[i]
    risk = (e - stop) * side
    if risk <= 0 or (tp - e) * side <= 0:
        return None
    px = None
    for j in range(i, min(i + HOLD + 1, len(c))):
        if side == 1 and l[j] <= stop or side == -1 and h[j] >= stop:
            px = min(o[j], stop) if side == 1 else max(o[j], stop)
            break
        if j > i and (side == 1 and h[j] >= tp or side == -1 and l[j] <= tp):
            px = max(o[j], tp) if side == 1 else min(o[j], tp)
            break
    if px is None:
        px = c[min(i + HOLD, len(c) - 1)]
    return (side * (px - e) - (e + px) * cost) / risk


def signals(d4, d1):
    """-> list of (signal bar index, side, stop, target or None for 2R) per setup."""
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    n = len(c)
    tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values
    sma50d = d1.close.rolling(50).mean()
    ds = np.sign(d1.close - sma50d).fillna(0)
    ds.index = ds.index + pd.Timedelta(days=1)
    dtrend = ds.reindex(d4.index + pd.Timedelta(hours=4), method="ffill").fillna(0).values
    cs = pd.Series(c)
    ema20, ema50 = cs.ewm(span=20, adjust=False).mean().values, cs.ewm(span=50, adjust=False).mean().values
    mid = cs.rolling(20).mean().values
    sd = cs.rolling(20).std(ddof=0).values
    up_b, lo_b = mid + 2 * sd, mid - 2 * sd
    bwp = pd.Series((up_b - lo_b) / mid).rolling(120).rank(pct=True).values
    hh = pd.Series(h).shift(1).rolling(20).max().values
    ll = pd.Series(l).shift(1).rolling(20).min().values
    out = {k: [] for k in SETUPS}

    lo_sig, sh_sig = B.signals(d4, B.features(d4))
    for i in np.flatnonzero((lo_sig | sh_sig).values):
        side = 1 if lo_sig.values[i] else -1
        out["B1"].append((i, side, l[i] if side == 1 else h[i], None))

    last = {1: -99, -1: -99}
    for i in range(60, n):
        for side in (1, -1):
            trend = dtrend[i] == side and (ema20[i] - ema50[i]) * side > 0
            touch = l[i] <= ema20[i] < c[i] and c[i] > o[i] if side == 1 else h[i] >= ema20[i] > c[i] and c[i] < o[i]
            if trend and touch and i - last[side] >= 6:
                out["P1"].append((i, side, (l[i] - PAD * atr[i]) if side == 1 else (h[i] + PAD * atr[i]), None))
                last[side] = i

    k = 3
    piv_lo, piv_hi = [], []
    used = set()
    for i in range(2 * k, n):
        j = i - k
        if l[j] == l[j - k:j + k + 1].min():
            piv_lo.append(j)
        if h[j] == h[j - k:j + k + 1].max():
            piv_hi.append(j)
        for side in (1, -1):
            if not piv_lo or not piv_hi:
                continue
            a, b = (piv_lo[-1], piv_hi[-1]) if side == 1 else (piv_hi[-1], piv_lo[-1])
            if not a < b or (a, b) in used or i - b > 30 or i <= b + k - 1:
                continue
            lo_p, hi_p = (l[a], h[b]) if side == 1 else (l[b], h[a])
            span = hi_p - lo_p
            if span < 3 * atr[b] or dtrend[i] != side:
                continue
            seg = slice(b + 1, i + 1)
            if side == 1 and (h[seg].max() > hi_p or l[seg].min() < lo_p) or side == -1 and (l[seg].min() < lo_p or h[seg].max() > hi_p):
                used.add((a, b))
                continue
            if side == 1:
                f382, f618, f786 = hi_p - 0.382 * span, hi_p - 0.618 * span, hi_p - 0.786 * span
                hit = l[i] <= f382 and c[i] > f618 and c[i] > o[i]
                stop, tgt = f786 - PAD * atr[i], hi_p
            else:
                f382, f618, f786 = lo_p + 0.382 * span, lo_p + 0.618 * span, lo_p + 0.786 * span
                hit = h[i] >= f382 and c[i] < f618 and c[i] < o[i]
                stop, tgt = f786 + PAD * atr[i], lo_p
            if hit:
                out["P2"].append((i, side, stop, tgt))
                used.add((a, b))

    pending = []  # (breakout bar, side, level)
    for i in range(21, n):
        keep = []
        for jb, side, lev in pending:
            if i - jb > 10:
                continue
            if side == 1 and l[i] <= lev < c[i] and c[i] > o[i] or side == -1 and h[i] >= lev > c[i] and c[i] < o[i]:
                out["P3"].append((i, side, (l[i] - PAD * atr[i]) if side == 1 else (h[i] + PAD * atr[i]), None))
            else:
                keep.append((jb, side, lev))
        pending = keep
        if c[i] > hh[i]:
            pending.append((i, 1, hh[i]))
        if c[i] < ll[i]:
            pending.append((i, -1, ll[i]))

    for i in range(140, n):
        if not (bwp[i] < 0.3 and abs(c[i] - c[i - 20]) < 2 * atr[i]):
            continue
        if h[i] >= up_b[i] > c[i] and c[i] < o[i]:
            out["R1"].append((i, -1, h[i] + PAD * atr[i], mid[i]))
        if l[i] <= lo_b[i] < c[i] and c[i] > o[i]:
            out["R1"].append((i, 1, l[i] - PAD * atr[i], mid[i]))
    return out, atr


def market_events(name, d4, d1):
    cls = "crypto" if name in ("BTCUSD", "ETHUSDT") else "fx"
    cost = COST[cls]
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    sig, atr = signals(d4, d1)
    years = d4.index.year.values
    rows = []
    for setup, lst in sig.items():
        for i, side, stop, tgt in lst:
            e = i + 1
            if e + HOLD >= len(c):
                continue
            risk = (o[e] - stop) * side
            if risk <= 0:
                continue
            tp = tgt if tgt is not None else o[e] + side * 2 * risk
            if tgt is not None and (tp - o[e]) * side < risk:
                continue  # target under 1R (P2, R1)
            r = trade(o, h, l, c, e, side, stop, tp, cost)
            if r is None:
                continue
            stop_atr, target_r = risk / atr[i], (tp - o[e]) * side / risk
            bars = np.flatnonzero((years == years[e]) & (np.arange(len(c)) > 150) & (np.arange(len(c)) < len(c) - HOLD - 2))
            ctl = []
            for j in RNG.choice(bars, CONTROLS):
                rk = stop_atr * atr[j - 1]
                ctl.append(trade(o, h, l, c, j, side, o[j] - side * rk, o[j] + side * target_r * rk, cost))
            rows.append(dict(market=name, cls=cls, setup=setup, entry_time=d4.index[e], side=side, R=r,
                             control=float(np.mean([x for x in ctl if x is not None])), stop_atr=stop_atr, target_R=target_r))
    return rows


def ci(v, level=95):
    v = np.asarray(v, float)
    if len(v) < 5:
        return np.nan, np.nan, np.nan
    b = RNG.choice(v, size=(2000, len(v))).mean(1)
    q = (100 - level) / 2
    return v.mean(), np.percentile(b, q), np.percentile(b, 100 - q)


def main():
    rows = []
    for name, d4, d1 in FR.markets():
        rows += market_events(name, d4, d1)
        print(f"{name}: {sum(r['market'] == name for r in rows)} signals", flush=True)
    ev = pd.DataFrame(rows)
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False).encode())
    ev["oos"] = ev.entry_time >= IS_END
    out = ["setups-v1: avgR per signal (costs: crypto 0.06%, FX 0.005% per side); control = random entries, same geometry",
           "setup  class    period  n      avgR   control   minus control [interval]"]
    verdict = []
    for s in SETUPS:
        for cls in ("crypto", "fx"):
            res = {}
            for per, m, lvl in (("IS", ~ev.oos, 95), ("OOS", ev.oos, 90)):
                z = ev[(ev.setup == s) & (ev.cls == cls) & m]
                d, lo, hi = ci(z.R - z.control, lvl)
                res[per] = (lo, d)
                out.append(f"{s:<6} {cls:<8} {per:<6} {len(z):5d}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   {d:+.3f} [{lo:+.2f},{hi:+.2f}] ({lvl}%)")
            ok = res["IS"][0] > 0 and res["OOS"][0] > 0
            verdict.append(f"{s} {cls}: {'HOLDS' if ok else 'fails'}")
    out.append("decision (IS 95% and OOS 90% intervals of the difference above zero): " + "; ".join(verdict))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
