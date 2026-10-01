"""TrialFamily range-v2: multi-timeframe range boxes faded at both edges (L limit, C rejection, M 4h-1d confluence).
See INTENT.md. Writes range2/events.csv.gz and range2/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
_spec = importlib.util.spec_from_file_location("mtf_run", os.path.join(ROOT, "mtf", "run.py"))
MT = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(MT)

W, MIN_W, MAX_W, TOUCH, GAP, DRIFT = 60, 4.0, 15.0, 0.5, 5, 0.35
PAD, TP_PAD, VALID, SPACING, HOLD, CONF = 0.5, 0.25, 6, 6, 30, 0.5
FEE, CONTROLS = 0.0006, 20
COINS = ("BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "DOGE", "LTC", "TRX", "LINK", "DOT", "AVAX", "BCH", "ETC", "XLM", "ATOM", "FIL")
DEV = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
CHK = (pd.Timestamp("2023-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
TFS = ("1h", "4h", "1d")


def touches(x, level, a, above):
    near = np.flatnonzero(x >= level - TOUCH * a) if above else np.flatnonzero(x <= level + TOUCH * a)
    return 0 if len(near) == 0 else 1 + int(np.sum(np.diff(near) >= GAP))


def boxes(d):
    """-> arrays top, bot (nan when no qualifying box) per bar i (known at its close), and ATR."""
    h, l, c = (d[x].values for x in ("high", "low", "close"))
    a = MT.atr_of(h, l, c)
    n = len(c)
    top, bot = np.full(n, np.nan), np.full(n, np.nan)
    for i in range(W + 20, n):
        ai = a[i - 1]
        hw, lw = h[i - W:i], l[i - W:i]
        t, b = hw.max(), lw.min()
        wd = t - b
        if not (MIN_W * ai <= wd <= MAX_W * ai) or abs(c[i - 1] - c[i - W]) > DRIFT * wd or not b < c[i] < t:
            continue
        if touches(hw, t, ai, True) < 2 or touches(lw, b, ai, False) < 2:
            continue
        top[i], bot[i] = t, b
    return top, bot, a


def signals(d, top, bot, a, conf=None):
    """-> {"L": [...], "C": [...]} of (entry bar, side, entry, stop, target); conf(i, side, edge) filters L for M."""
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    n = len(c)
    out = {"L": [], "C": []}
    last = {("L", 1): -99, ("L", -1): -99, ("C", 1): -99, ("C", -1): -99}
    used = set()
    for i in range(W + 20, n - 1):
        if np.isnan(top[i]):
            continue
        t, b, ai = top[i], bot[i], a[i - 1]
        for side, edge, far in ((1, b, t), (-1, t, b)):
            stop, tgt = edge - side * PAD * ai, far - side * TP_PAD * ai
            key = (round(t, 10), round(b, 10), side)
            # L: resting limit at the edge for the next VALID bars
            if key not in used and i - last[("L", side)] >= SPACING and (conf is None or conf(i, side, edge)):
                for j in range(i + 1, min(i + 1 + VALID, n)):
                    reach = l[j] <= edge if side == 1 else h[j] >= edge
                    if reach:
                        fill = min(o[j], edge) if side == 1 else max(o[j], edge)
                        if (fill - stop) * side > 0:
                            out["L"].append((j, side, fill, stop, tgt))
                            used.add(key)
                            last[("L", side)] = i
                        break
            # C: bar i itself reached the edge and closed back inside in its outer half
            rg = h[i] - l[i]
            if conf is None and rg > 0 and i - last[("C", side)] >= SPACING:
                hit = (l[i] <= edge + TOUCH * ai and (c[i] - l[i]) / rg >= 0.5) if side == 1 else \
                      (h[i] >= edge - TOUCH * ai and (h[i] - c[i]) / rg >= 0.5)
                if hit and (o[i + 1] - stop) * side > 0:
                    out["C"].append((i + 1, side, o[i + 1], stop, tgt))
                    last[("C", side)] = i
    return out


def score(coin, tf, variant, d, sigs, a, rng):
    if not sigs:
        return []
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    e, side, entry, stop, tgt = (np.array(x) for x in zip(*sigs))
    e = e.astype(int)
    risk = (entry - stop) * side
    keep = ((tgt - entry) * side >= risk) & (e + HOLD < len(c)) & (e > 300)
    e, side, entry, stop, tgt, risk = e[keep], side[keep], entry[keep], stop[keep], tgt[keep], risk[keep]
    if len(e) == 0:
        return []
    R = MT.walk(o, h, l, c, e, side, entry, stop, tgt, HOLD, FEE)
    sa, tr = risk / a[e - 1], (tgt - entry) * side / risk
    years, idx = d.index.year.values, np.arange(len(c))
    ce, cs, cen, cst, ctg = [], [], [], [], []
    for x, sd, s_, r_ in zip(e, side, sa, tr):
        j = rng.choice(np.flatnonzero((years == years[x]) & (idx > 300) & (idx < len(c) - HOLD - 2)), CONTROLS)
        rk = s_ * a[j - 1]
        ce.append(j), cs.append(np.full(CONTROLS, sd)), cen.append(o[j]), cst.append(o[j] - sd * rk), ctg.append(o[j] + sd * r_ * rk)
    ctl = np.nanmean(MT.walk(o, h, l, c, *(np.concatenate(v) for v in (ce, cs, cen, cst, ctg)), HOLD, FEE).reshape(-1, CONTROLS), axis=1)
    return [dict(coin=coin, tf=tf, variant=variant, time=d.index[x], side=int(sd), R=r, control=k, stop_atr=s_, target_R=q)
            for x, sd, r, k, s_, q in zip(e, side, R, ctl, sa, tr)]


def coin_boot(z, level=95, seed=2):
    rng = np.random.default_rng(seed)
    groups = [g.values for _, g in (z.R - z.control).groupby(z.coin)]
    b = [np.concatenate([groups[k][rng.integers(0, len(groups[k]), len(groups[k]))] for k in rng.integers(0, len(groups), len(groups))]).mean()
         for _ in range(4000)]
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)


def main():
    from evaluate import holdout_bars
    rng = np.random.default_rng(19)
    rows = []
    for coin in COINS:
        bars = holdout_bars(coin)
        frames = {tf: bars[tf][["open", "high", "low", "close"]] for tf in TFS}
        bx = {tf: boxes(frames[tf]) for tf in TFS}
        for tf in TFS:
            s = signals(frames[tf], *bx[tf])
            for v in ("L", "C"):
                rows += score(coin, tf, v, frames[tf], s[v], bx[tf][2], rng)
        # M: 4h limit orders whose edge matches the 1d box active at that moment
        d4, d1 = frames["4h"], frames["1d"]
        k1 = d1.index.searchsorted(d4.index + pd.Timedelta(hours=4), side="right") - 1  # last 1d bar closed by the 4h close
        k1 = k1 - 1  # a daily box is known at its bar's close: use the previous complete day
        t1, b1, _ = bx["1d"]
        a4 = bx["4h"][2]

        def conf(i, side, edge):
            k = k1[i]
            if k < 0 or np.isnan(t1[k]):
                return False
            return abs(edge - (b1[k] if side == 1 else t1[k])) <= CONF * a4[i - 1]
        rows += score(coin, "4h", "M", d4, signals(d4, *bx["4h"], conf=conf)["L"], a4, rng)
        print(f"{coin}: {sum(r['coin'] == coin for r in rows)} signals", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["R", "control"])
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    out = ["range-v2: multi-timeframe range boxes on the 17 majors; avg R net of 0.06%/side; control = 20 random entries",
           "variant tf   period      n      win   avgR    control  minus control [95% coin-then-signal]  median target R"]
    verdict = []
    for (v, tf), g in ev.groupby(["variant", "tf"], sort=False):
        lows = []
        for label, (t0, t1_) in (("2018-2022", DEV), ("2023-2026", CHK)):
            z = g[(g.time >= t0) & (g.time < t1_)]
            if len(z) < 5:
                out.append(f"{v:<7} {tf:<4} {label}  {len(z):5d}  too few")
                lows.append(-1)
                continue
            lo, hi = coin_boot(z)
            lows.append(lo)
            out.append(f"{v:<7} {tf:<4} {label}  {len(z):5d}  {np.mean(z.R > 0):.0%}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   "
                       f"{(z.R - z.control).mean():+.3f} [{lo:+.3f}, {hi:+.3f}]  {z.target_R.median():.2f}")
        verdict.append(f"{v} {tf} {'HOLDS' if min(lows) > 0 else 'fails'}")
    out.append("decision: " + "; ".join(verdict))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
