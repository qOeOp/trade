"""Loop P-4: Ronnie's 2024-2025 method from his videos (RONNIE_2024_RULES.md). Daily bars, limit entries in zones.
Usage: python loop/family_r.py"""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import family_p as FP  # noqa: E402

T0, T1 = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
K, BODY_X, VALID, HOLD, BUF = 3, 1.5, 10, 60, 0.25


def state(d):
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    n = len(c)
    a = E.MT.atr_of(h, l, c)
    body = np.abs(c - o)
    med = pd.Series(body).rolling(20).median().shift(1).values
    big = body >= BODY_X * med
    big2 = (np.abs(c - np.r_[np.nan, o[:-1]]) >= BODY_X * 2 * med)  # two candles merged
    trend = np.zeros(n, int)
    ph, pl = [], []  # confirmed pivots: (index, price, body edge)
    eff_low, eff_high = np.full(n, np.nan), np.full(n, np.nan)
    piv_hi_list = []  # per bar: confirmed pivot highs so far
    cur, last_pl, last_ph = 0, None, None
    events = []  # (bar, kind, payload)
    for i in range(K * 2 + 21, n):
        j = i - K
        if h[j] == h[j - K:j + K + 1].max():
            ph.append((j, h[j], max(o[j], c[j])))
        if l[j] == l[j - K:j + K + 1].min():
            pl.append((j, l[j], min(o[j], c[j])))
        strong_up = (c[i] > o[i] and big[i]) or (c[i] > o[i - 1] and big2[i])
        strong_dn = (c[i] < o[i] and big[i]) or (c[i] < o[i - 1] and big2[i])
        # breaks of pivot highs/lows on a strong close (each pivot once)
        for p in [p for p in ph if p[1] < c[i] and p[1] >= c[i - 1]]:
            if strong_up:
                events.append((i, "break_high", p))
        for p in [p for p in pl if p[1] > c[i] and p[1] <= c[i - 1]]:
            if strong_dn:
                events.append((i, "break_low", p))
        if ph and strong_up and c[i] > ph[-1][1] and cur != 1:
            cur = 1
            events.append((i, "flip_up", pl[-1] if pl else None))
        elif pl and strong_dn and c[i] < pl[-1][1] and cur != -1:
            cur = -1
            events.append((i, "flip_down", ph[-1] if ph else None))
        trend[i] = cur
    return dict(o=o, h=h, l=l, c=c, a=a, trend=trend, events=events)


def fill(S, start, side, limit):
    o, h, l = S["o"], S["h"], S["l"]
    for k in range(start, min(start + VALID, len(o))):
        if (side == 1 and l[k] <= limit) or (side == -1 and h[k] >= limit):
            return k, (min(o[k], limit) if side == 1 else max(o[k], limit))
    return None, None


def signals(d, btc_trend=None):
    S = state(d)
    c, a, tr = S["c"], S["a"], S["trend"]
    out = {"R-1": [], "R-2": [], "R-3": []}
    busy = {k: -1 for k in out}
    flip = None  # (bar, side, effective extreme price)
    for i, kind, p in S["events"]:
        if i + 1 >= len(c) or np.isnan(a[i]):
            continue
        if kind in ("break_high", "break_low"):
            side = 1 if kind == "break_high" else -1
            if tr[i] != side:
                continue
            lvl, edge = p[1], p[2]
            lower = max(edge, lvl - a[i]) if side == 1 else min(edge, lvl + a[i])
            stop = lower - side * BUF * a[i]
            k, px = fill(S, i + 1, side, lvl)
            if k is None or (px - stop) * side <= 0:
                continue
            sig = (k, side, px, stop, px + side * 2 * abs(px - stop))
            for v in ("R-1", "R-3"):
                if v == "R-3" and btc_trend is not None and btc_trend[i] != side:
                    continue
                if k > busy[v]:
                    out[v].append(sig)
                    busy[v] = k + HOLD
        elif kind in ("flip_up", "flip_down") and p is not None:
            side = 1 if kind == "flip_up" else -1
            flip = (i, side, p[1], p[0])
        if flip is not None and kind in ("flip_up", "flip_down"):
            fi, side, ext, ej = flip
            # impulse on closes: effective extreme (pivot close-side) to the most extreme close in the next bars while the trend holds
            jstart = fi
            best, bk = c[fi], fi
            for k2 in range(fi, min(fi + 40, len(c) - 1)):
                if tr[k2] != side:
                    break
                if (c[k2] - best) * side > 0:
                    best, bk = c[k2], k2
                # once price has retraced to the 0.5 level after the extreme, try the limit
                lim = best - side * 0.5 * abs(best - ext)
                if k2 > bk and ((side == 1 and S["l"][k2] <= lim) or (side == -1 and S["h"][k2] >= lim)) and k2 > busy["R-2"]:
                    px = min(S["o"][k2], lim) if side == 1 else max(S["o"][k2], lim)
                    stop = ext - side * BUF * a[fi]
                    if (px - stop) * side > 0:
                        out["R-2"].append((k2, side, px, stop, px + side * abs(best - ext)))
                        busy["R-2"] = k2 + HOLD
                    break
            flip = None
    return out, tr


def main():
    btc = E.bars("BTC")["1d"]
    _, btc_tr = signals(btc)
    btc_tr = pd.Series(btc_tr, index=btc.index)
    rows = []
    for k, coin in enumerate(E.ITER_COINS + E.ITER_EXT_COINS):
        d = E.bars(coin)["1d"]
        bt = None if coin == "BTC" else btc_tr.reindex(d.index).fillna(0).values
        sig, _ = signals(d, bt)
        a = E.MT.atr_of(d.high.values, d.low.values, d.close.values)
        for v, s in sig.items():
            for x in FP.score_all(coin, d[["open", "high", "low", "close"]], s, HOLD, k, a):
                if T0 <= x["time"] < T1:
                    rows.append(dict(x, variant=v))
    z = pd.DataFrame(rows).dropna(subset=["R", "control"])
    with gzip.GzipFile(os.path.join(HERE, "out", "P-4_iteration.csv.gz"), "wb", mtime=0) as f:
        f.write(z.to_csv(index=False).encode())
    lines = ["P-4: Ronnie's 2024-2025 method (daily, limit entries in zones), 53 coins 2018-2022; edge vs matched random entries"]
    for v, g in z.groupby("variant"):
        lo, hi = attrib.week_boot(g)
        e = float((g.R - g.control).mean())
        st = "active" if lo > 0 and e >= 0.10 else ("harmful" if hi < 0 else ("equivalent-null" if hi < 0.10 else "inconclusive"))
        sides = ", ".join(f"{'long' if sd == 1 else 'short'} {(gg.R - gg.control).mean():+.2f} ({len(gg)})" for sd, gg in g.groupby("side"))
        lines.append(f"  {v}: n {len(g)}, avg R {g.R.mean():+.3f}, edge {e:+.3f} [{lo:+.3f}, {hi:+.3f}] -> {st}; {sides}")
        E.log(f"P-4 {v}", "familyR", "iteration", dict(n=len(g), edge=e, lo=lo, hi=hi), st == "active", "Ronnie 2024-25 method, daily")
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "p-4_plan.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
