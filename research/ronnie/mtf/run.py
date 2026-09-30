"""TrialFamily mtf-v1: strong-level fade (M1), top-down sweep + 1h change of character (M2), 4h sweep fade (M3).
See INTENT.md. Writes mtf/events.csv.gz and mtf/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)

D_K, W_K, NEAR, GAP_D, P1H = 3, 2, 0.25, 3, 3
M1_TOUCH, M1_STOP, M1_TGT, HOLD_1H = 2, 0.5, 1.0, 120
ARM_BARS, INVALID, SWEEP_PAD, MIN_RR, MAX_RR = 24, 1.0, 0.1, 2.0, 6.0
M3_PAD, M3_RR, HOLD_4H = 0.1, 2.0, 30
COST = {"crypto": 0.0006, "fx": 0.00005}
CONTROLS = 20
DEV = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
HOLD = (pd.Timestamp("2021-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
HOLDOUT = ("ICX", "ZRX", "DGB", "SC", "HOT", "ARPA", "CTSI", "DUSK", "CHR", "COTI", "MTL", "OGN", "BAND", "SKL", "CELR",
           "TFUEL", "WIN", "TRB", "LPT", "UMA")  # the INTENT list minus DENT, NKN, OCEAN, REEF, BTT (no 2026-08 archive)
AGG = {"open": "first", "high": "max", "low": "min", "close": "last"}
VARIANTS = ("M1", "M1-fresh", "M2", "M3")


def atr_of(h, l, c, n=14):
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return pd.Series(tr).ewm(alpha=1 / n, adjust=False).mean().values


def pivots(h, l, k):
    ph, pl = [], []
    for j in range(k, len(h) - k):
        if h[j] == h[j - k:j + k + 1].max():
            ph.append(j)
        if l[j] == l[j - k:j + k + 1].min():
            pl.append(j)
    return ph, pl


def level_book(dx, k, count_touches):
    """For each bar D of dx: intact levels known at its open, as arrays (price, side, prior touches, last touch bar).

    side +1: resistance (from swing highs), -1: support (from swing lows). Built from bars closed before D."""
    h, l, c = (dx[x].values for x in ("high", "low", "close"))
    a = atr_of(h, l, c)
    ph, pl = pivots(h, l, k)
    born = sorted([(j + k, j, 1) for j in ph] + [(j + k, j, -1) for j in pl])
    act, p, book = [], 0, []
    for D in range(len(c)):
        j = D - 1  # the last closed bar
        if j >= 0:
            keep = []
            for lv in act:
                y, side = lv["y"], lv["side"]
                if (c[j] - y) * side > 0:
                    continue  # closed beyond: removed
                reached = h[j] >= y - NEAR * a[j] if side == 1 else l[j] <= y + NEAR * a[j]
                if count_touches and reached:  # it closed on the original side, or it would have been removed above
                    if j - lv["last"] >= GAP_D:
                        lv["touches"] += 1
                        lv["last"] = j
                keep.append(lv)
            act = keep
            while p < len(born) and born[p][0] <= j:
                _, jj, side = born[p]
                act.append(dict(y=h[jj] if side == 1 else l[jj], side=side, touches=0, last=jj, pivot=jj))
                p += 1
        book.append((np.array([x["y"] for x in act]), np.array([x["side"] for x in act]),
                     np.array([x["touches"] for x in act]), np.array([x["last"] for x in act]), a[D - 1] if D else np.nan))
    return book


def walk(o, h, l, c, e, side, entry, stop, tgt, hold, cost, chunk=20000):
    """R net of costs; stop checked from the entry bar, target from the next; time exit at the close of bar e+hold."""
    R = np.full(len(e), np.nan)
    ok = np.flatnonzero(e + hold < len(c))
    for s in range(0, len(ok), chunk):
        k = ok[s:s + chunk]
        ee, sd, en, st, tp = e[k], side[k], entry[k], stop[k], tgt[k]
        w = ee[:, None] + np.arange(hold + 1)[None, :]
        Hh, Ll = h[w], l[w]
        hs = np.where(sd[:, None] == 1, Ll <= st[:, None], Hh >= st[:, None])
        ht = np.where(sd[:, None] == 1, Hh >= tp[:, None], Ll <= tp[:, None])
        ht[:, 0] = False
        fs = np.where(hs.any(1), hs.argmax(1), hold + 1)
        ft = np.where(ht.any(1), ht.argmax(1), hold + 1)
        oj = o[ee + np.minimum(fs, hold)]
        sfill = np.where(fs == 0, st, np.where(sd == 1, np.minimum(oj, st), np.maximum(oj, st)))
        px = np.where(fs <= ft, sfill, tp)
        px = np.where((fs > hold) & (ft > hold), c[ee + hold], px)
        risk = (en - st) * sd
        R[k] = sd * (px - en) / risk - cost * (en + px) / risk
    return R


class Market:
    def __init__(self, name, cls, h1):
        self.name, self.cls = name, cls
        h1 = h1[["open", "high", "low", "close"]].astype(float)
        self.h1 = h1
        self.d1 = h1.resample("1D", label="left", closed="left").agg(AGG).dropna()
        self.w1 = self.d1.resample("W-MON", label="left", closed="left").agg(AGG).dropna()
        self.h4 = h1.resample("4h", label="left", closed="left").agg(AGG).dropna()
        self.dbook = level_book(self.d1, D_K, True)
        self.wbook = level_book(self.w1, W_K, False)
        # index of the daily / weekly bar each 1h and 4h bar belongs to
        self.d_of_1h = self.d1.index.searchsorted(h1.index, side="right") - 1
        self.w_of_1h = self.w1.index.searchsorted(h1.index, side="right") - 1
        self.d_of_4h = self.d1.index.searchsorted(self.h4.index, side="right") - 1

    def arrays(self, df):
        return tuple(df[x].values for x in ("open", "high", "low", "close"))

    def m1(self):
        o, h, l, c = self.arrays(self.h1)
        out = {"M1": [], "M1-fresh": []}
        fired = set()
        for t in range(1, len(c)):
            D = self.d_of_1h[t]
            if D < 30:
                continue
            Y, S, T, LT, ad = self.dbook[D]
            if len(Y) == 0 or not ad > 0:
                continue
            reach = np.flatnonzero(np.where(S == -1, (l[t] <= Y) & (c[t - 1] > Y), (h[t] >= Y) & (c[t - 1] < Y)))
            for q in reach:
                key = (round(Y[q], 10), S[q], D)
                if key in fired:
                    continue
                fired.add(key)
                var = "M1" if T[q] >= M1_TOUCH and D - 1 - LT[q] >= GAP_D else "M1-fresh" if T[q] == 0 else None
                if var is None:
                    continue
                side = -int(S[q])  # buy support, sell resistance
                fill = min(o[t], Y[q]) if side == 1 else max(o[t], Y[q])
                stop = Y[q] - side * M1_STOP * ad
                if (fill - stop) * side <= 0:
                    continue
                out[var].append((t, side, fill, stop, Y[q] + side * M1_TGT * ad))
        return out

    def m2(self):
        o, h, l, c = self.arrays(self.h1)
        ph, pl = pivots(h, l, P1H)
        dc = self.d1.close.values
        out, arms, seen = [], [], set()
        a_h = a_l = 0
        for t in range(1, len(c) - 1):
            D, W = self.d_of_1h[t], self.w_of_1h[t]
            if D < 30 or W < 10:
                continue
            Yd, Sd, _, _, ad = self.dbook[D]
            Yw, Sw, _, _, _ = self.wbook[W]
            Y, S = np.r_[Yd, Yw], np.r_[Sd, Sw]
            while a_h < len(ph) and ph[a_h] + P1H <= t:
                a_h += 1
            while a_l < len(pl) and pl[a_l] + P1H <= t:
                a_l += 1
            # progress open arms
            keep = []
            for arm in arms:
                y, s, t0, ext, d0 = arm
                side = -s
                ext = min(ext, l[t]) if side == 1 else max(ext, h[t])
                if any((dc[d] - y) * s > INVALID * ad for d in range(d0, D)):
                    continue  # a daily close far beyond the level: not a sweep
                swing = (h[ph[a_h - 1]] if a_h else np.nan) if side == 1 else (l[pl[a_l - 1]] if a_l else np.nan)
                if (c[t] - swing) * side > 0 and (c[t - 1] - swing) * side <= 0:
                    entry, stop = o[t + 1], ext - side * SWEEP_PAD * ad
                    risk = (entry - stop) * side
                    far = Y[(S == side) & ((Y - entry) * side > 0)]
                    if risk > 0 and len(far) and (t, side) not in seen:
                        tgt = far.min() if side == 1 else far.max()
                        rr = (tgt - entry) * side / risk
                        if rr >= MIN_RR:
                            out.append((t + 1, side, entry, stop, entry + side * min(rr, MAX_RR) * risk))
                            seen.add((t, side))
                    continue
                if t - t0 < ARM_BARS:
                    keep.append((y, s, t0, ext, d0))
            arms = keep
            armed = {(round(a[0], 10), a[1]) for a in arms}
            hit = np.flatnonzero(np.where(S == -1, (l[t] < Y) & (c[t - 1] >= Y), (h[t] > Y) & (c[t - 1] <= Y)))
            for q in hit:
                if (round(Y[q], 10), S[q]) not in armed:
                    arms.append((Y[q], S[q], t, l[t] if S[q] == -1 else h[t], D))
        return out

    def m3(self):
        o, h, l, c = self.arrays(self.h4)
        a4 = atr_of(h, l, c)
        out, seen = [], set()
        for i in range(1, len(c) - 1):
            D = self.d_of_4h[i]
            if D < 30:
                continue
            Y, S, _, _, _ = self.dbook[D]
            if len(Y) == 0:
                continue
            sup = np.any((S == -1) & (l[i] < Y) & (c[i] > Y))
            res = np.any((S == 1) & (h[i] > Y) & (c[i] < Y))
            for side, ok in ((1, sup), (-1, res)):
                if ok and (i, side) not in seen:
                    seen.add((i, side))
                    stop = (l[i] if side == 1 else h[i]) - side * M3_PAD * a4[i]
                    entry = o[i + 1]
                    if (entry - stop) * side > 0:
                        out.append((i + 1, side, entry, stop, entry + side * M3_RR * (entry - stop) * side))
        return out

    def score(self, variant, sigs, tf, hold, t0, t1, rng):
        df = self.h1 if tf == "1h" else self.h4
        o, h, l, c = self.arrays(df)
        atr = atr_of(h, l, c)
        if not sigs:
            return []
        e, side, entry, stop, tgt = (np.array(x) for x in zip(*sigs))
        e = e.astype(int)
        keep = np.array([t0 <= df.index[min(x, len(df) - 1)] < t1 for x in e]) & (e + hold < len(c))
        e, side, entry, stop, tgt = e[keep], side[keep], entry[keep], stop[keep], tgt[keep]
        if len(e) == 0:
            return []
        cost = COST[self.cls]
        R = walk(o, h, l, c, e, side, entry, stop, tgt, hold, cost)
        risk = (entry - stop) * side
        stop_atr = risk / atr[np.maximum(e - 1, 0)]
        tr = (tgt - entry) * side / risk
        years = df.index.year.values
        idx = np.arange(len(c))
        ce, cs, cst, ctg, cen = [], [], [], [], []
        for x, sd, sa, r_ in zip(e, side, stop_atr, tr):
            pool = np.flatnonzero((years == years[x]) & (idx > 300) & (idx < len(c) - hold - 2))
            j = rng.choice(pool, CONTROLS)
            rk = sa * atr[j - 1]
            ce.append(j), cs.append(np.full(CONTROLS, sd)), cen.append(o[j])
            cst.append(o[j] - sd * rk), ctg.append(o[j] + sd * r_ * rk)
        ce, cs, cst, ctg, cen = (np.concatenate(v) for v in (ce, cs, cst, ctg, cen))
        ctl = np.nanmean(walk(o, h, l, c, ce, cs, cen, cst, ctg, hold, cost).reshape(-1, CONTROLS), axis=1)
        return [dict(market=self.name, cls=self.cls, variant=variant, time=df.index[x], side=int(sd), R=r, control=k,
                     stop_atr=sa, target_R=q) for x, sd, r, k, sa, q in zip(e, side, R, ctl, stop_atr, tr)]

    def run(self, t0, t1, rng):
        rows = []
        m1 = self.m1()
        for v in ("M1", "M1-fresh"):
            rows += self.score(v, m1[v], "1h", HOLD_1H, t0, t1, rng)
        rows += self.score("M2", self.m2(), "1h", HOLD_1H, t0, t1, rng)
        rows += self.score("M3", self.m3(), "4h", HOLD_4H, t0, t1, rng)
        return rows


def coin_boot(z, level=95, seed=4):
    rng = np.random.default_rng(seed)
    groups = [g.values for _, g in (z.R - z.control).groupby(z.market)]
    b = []
    for _ in range(4000):
        pick = [groups[k] for k in rng.integers(0, len(groups), len(groups))]
        b.append(np.concatenate([g[rng.integers(0, len(g), len(g))] for g in pick]).mean())
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)


def simple_ci(v, level, seed=6):
    v = np.asarray(v, float)
    if len(v) < 5:
        return np.nan, np.nan
    rng = np.random.default_rng(seed)
    b = rng.choice(v, size=(4000, len(v))).mean(1)
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)


def main():
    import harness as H
    import tv_fx_mtf
    import tv_hourly
    rng = np.random.default_rng(71)
    rows = []
    for name in ("BTCUSD", "ETHUSDT"):
        rows += Market(name, "crypto", H.load(name)["1h"]).run(*DEV, rng)
        print(f"{name}: {sum(r['market'] == name for r in rows)} signals", flush=True)
    for pair in tv_fx_mtf.PAIRS:
        rows += Market(pair, "fx", tv_fx_mtf.hourly(pair)).run(pd.Timestamp("2017-01-01", tz="UTC"), HOLD[1], rng)
        print(f"{pair}: {sum(r['market'] == pair for r in rows)} signals", flush=True)
    t_a, t_b = int(pd.Timestamp("2019-01-01").value // 10**9), int(HOLD[1].value // 10**9)
    for coin in HOLDOUT:
        h = tv_hourly.binance(f"{coin}USDT", t_a, t_b).drop_duplicates("time").sort_values("time")
        h.index = pd.to_datetime(h.time, unit="s", utc=True)
        rows += [dict(r, cls="holdout") for r in Market(coin, "crypto", h).run(*HOLD, rng)]
        print(f"{coin}: {sum(r['market'] == coin for r in rows)} signals", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["R", "control"])
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    fx_oos = ev.time >= DEV[1]
    out = ["mtf-v1: higher-timeframe levels, practitioner uses; avgR net of costs; control = 20 random entries, same geometry",
           "variant   set                n      win   avgR    control  minus control [interval]  median target R"]
    verdict = []
    for v in VARIANTS:
        res = {}
        for label, m, lvl in (("crypto dev 18-22", ev.cls == "crypto", 95), ("fx IS 17-22", (ev.cls == "fx") & ~fx_oos, 95),
                              ("fx OOS 23-26", (ev.cls == "fx") & fx_oos, 90), ("holdout 20 coins", ev.cls == "holdout", 95)):
            z = ev[(ev.variant == v) & m]
            d = (z.R - z.control).mean()
            lo, hi = coin_boot(z, lvl) if label.startswith("holdout") else simple_ci(z.R - z.control, lvl)
            res[label] = lo
            out.append(f"{v:<9} {label:<17} {len(z):6d}  {np.mean(z.R > 0):.0%}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   "
                       f"{d:+.3f} [{lo:+.3f}, {hi:+.3f}] ({lvl}%)  {z.target_R.median():.2f}")
        if v != "M1-fresh":
            verdict.append(f"{v}: crypto {'HOLDS' if res['crypto dev 18-22'] > 0 and res['holdout 20 coins'] > 0 else 'fails'}, "
                           f"FX {'HOLDS' if res['fx IS 17-22'] > 0 and res['fx OOS 23-26'] > 0 else 'fails'}")
    out.append("decision (M1-fresh is a reference, not decided): " + "; ".join(verdict))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
