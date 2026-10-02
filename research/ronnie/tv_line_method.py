"""How Ronnie draws trend lines, channels and Fibonacci in his 2024-2025 video ideas (tv/video_drawings.jsonl.gz, each
drawing id at its first appearance), measured on the bars of the chart timeframe it was drawn on (4h or daily).
His anchors are arbitrary points along a line he drags long, not pivots, so each line is measured as a whole: the
order-3 pivots it touches (wick or body), closes through it, and the same line moved 1-2 ATR as a control. Channels:
both borders and the width. Fibonacci: whether the anchor prices equal major (order-20) pivot extremes.
Bars: Binance public market data (data-api.binance.vision) for Binance symbols, TradingView otherwise.
Usage: python tv_line_method.py   (writes results/tv_line_method.txt)"""
import collections, gzip, json, time, urllib.request

import numpy as np
import pandas as pd

from tv_prices import fetch

TF = {"240": "4h", "1D": "1d", "D": "1d"}
KMAX = 60


def binance(sym, tf):
    out, start = [], 1483228800000
    while True:
        url = f"https://data-api.binance.vision/api/v3/klines?symbol={sym}&interval={tf}&startTime={start}&limit=1000"
        for k in range(4):
            try:
                rows = json.loads(urllib.request.urlopen(url, timeout=60).read())
                break
            except Exception:
                time.sleep(2 * (k + 1))
        else:
            rows = []
        if not rows:
            break
        out += rows
        start = rows[-1][0] + 1
        if len(rows) < 1000:
            break
    d = pd.DataFrame([r[1:5] for r in out], index=pd.to_datetime([r[0] for r in out], unit="ms"),
                     columns=["o", "h", "l", "c"]).astype(float)
    return d


def tv(sym, tf):
    b, _err = fetch(sym, {"4h": "240", "1d": "1D"}[tf], 5000)
    return pd.DataFrame([v for _, v in b], index=pd.to_datetime([t for t, _ in b], unit="s"),
                        columns=["o", "h", "l", "c"]).astype(float)


def bars(sym, tf, cache={}):
    if (sym, tf) not in cache:
        ex, s = sym.split(":")
        d = binance(s, tf) if ex == "BINANCE" else tv(sym, tf)
        pc = d.c.shift(1)
        d["atr"] = pd.concat([d.h - d.l, (d.h - pc).abs(), (d.l - pc).abs()], axis=1).max(axis=1).rolling(14).mean()
        cache[(sym, tf)] = d
    return cache[(sym, tf)]


def ts(t):
    return pd.Timestamp(t, unit="s") if not isinstance(t, str) else pd.Timestamp(t).tz_localize(None)


def pivots(d, k):
    h, l = d.h.values, d.l.values
    hi = pd.Series(h).rolling(2 * k + 1, center=True).max().values == h
    lo = pd.Series(l).rolling(2 * k + 1, center=True).min().values == l
    return hi, lo


def line_stats(d, i1, p1, i2, p2, now, shift=0.0):
    """touches of a straight line by order-3 pivots between its anchors (and up to publish), in chart ATR"""
    h, l, o, c, a = d.h.values, d.l.values, d.o.values, d.c.values, d.atr.values
    hi, lo = PIV[id(d)]
    j0, j1 = max(min(i1, i2), 20), min(max(i1, i2, now), now, len(d) - 1)
    if j1 - j0 < 5:
        return None
    y = lambda i: p1 + (p2 - p1) * (i - i1) / (i2 - i1) + shift * a[now]  # noqa: E731
    above = np.mean([c[i] > y(i) for i in range(j0, j1 + 1)])
    sup = above >= 0.5
    t_w = t_b = 0
    last = None
    for i in range(j0, j1 + 1):
        yi, ai = y(i), a[i]
        if not ai > 0:
            continue
        piv = lo[i] if sup else hi[i]
        if not piv:
            continue
        wick = l[i] if sup else h[i]
        body = min(o[i], c[i]) if sup else max(o[i], c[i])
        if abs(wick - yi) <= 0.2 * ai or abs(body - yi) <= 0.2 * ai:
            if abs(wick - yi) <= abs(body - yi):
                t_w += 1
            else:
                t_b += 1
            last = i
    through = np.mean([(c[i] - y(i)) * (1 if sup else -1) < -0.1 * a[i] for i in range(j0, j1 + 1)])
    return dict(sup=sup, touches=t_w + t_b, wick=t_w, body=t_b, through=through, span=j1 - j0,
                since_last=(now - last) if last is not None else np.nan, dist_now=abs(y(now) - c[now]) / a[now])


PIV = {}


def load():
    meta = {}
    for line in gzip.open("tv/video_ideas.jsonl.gz", "rt"):
        r = json.loads(line)
        meta[r["uuid"]] = (pd.Timestamp(r["created_at"][:19]), (r.get("symbol") or {}).get("pro_symbol"))
    first = {}
    for line in gzip.open("tv/video_drawings.jsonl.gz", "rt"):
        x = json.loads(line)
        if x["type"] not in ("LineToolTrendLine", "LineToolParallelChannel", "LineToolFibRetracement",
                             "LineToolTrendBasedFibExtension"):
            continue
        c, s = meta[x["uuid"]]
        if x["id"] not in first or c < first[x["id"]][0]:
            first[x["id"]] = (c, s, x)
    return first.values()


def line_at(i1, p1, i2, p2, i):
    return p1 + (p2 - p1) * (i - i1) / (i2 - i1)


def main():
    T, C, F = [], [], []
    levels = collections.Counter()
    for created, sym, x in load():
        tf = TF.get(x["style"].get("interval"))
        if tf is None or not sym or not sym.startswith(("BINANCE:", "FX:", "TVC:", "COINBASE:", "OKX:")):
            continue
        if any(q.get("price") is None or q.get("time") is None or q.get("time_est") for q in x["anchors"]):
            continue
        try:
            d = bars(sym, tf)
        except Exception:
            continue
        if id(d) not in PIV:
            PIV[id(d)] = pivots(d, 3)
        now = int(d.index.searchsorted(created)) - 1
        if now < 30:
            continue
        I = [int(d.index.searchsorted(ts(q["time"]))) for q in x["anchors"]]
        P = [q["price"] for q in x["anchors"]]
        if x["type"] in ("LineToolTrendLine", "LineToolParallelChannel"):
            if I[0] == I[1]:
                continue
            borders = [(I[0], P[0], I[1], P[1])]
            if x["type"] == "LineToolParallelChannel":
                off = P[2] - (P[0] + (P[1] - P[0]) * (I[2] - I[0]) / (I[1] - I[0]))
                borders.append((I[0], P[0] + off, I[1], P[1] + off))
            for b_i, (i1, p1, i2, p2) in enumerate(borders):
                r = line_stats(d, i1, p1, i2, p2, now)
                if r is None:
                    continue
                moved = [line_stats(d, i1, p1, i2, p2, now, sh) for sh in (-2.0, -1.0, 1.0, 2.0)]
                r["moved_touches"] = np.mean([m["touches"] for m in moved if m])
                r.update(tf=tf, slope=np.sign(p2 - p1), kind=x["type"][8:], border=b_i,
                         width=abs(borders[-1][1] - borders[0][1]) / d.atr.values[now] if len(borders) == 2 else np.nan)
                (T if x["type"] == "LineToolTrendLine" else C).append(r)
        else:
            for lv, on in (x.get("levels") or []):
                if on:
                    levels[(x["type"][8:], lv)] += 1
            hi, lo = PIV.setdefault((id(d), 20), pivots(d, 20))
            a = d.atr.values[now]
            win = slice(max(0, now - 1500), now + 1)
            ph = d.h.values[win][hi[win]]
            pl = d.l.values[win][lo[win]]
            near = lambda p: min(np.abs(np.r_[ph, pl] - p).min() if len(ph) + len(pl) else np.inf, 99) / a  # noqa: E731
            F.append(dict(kind=x["type"][8:], tf=tf, m0=near(P[0]), m1=near(P[1]), span_atr=abs(P[1] - P[0]) / a,
                          up=P[1] > P[0], pos=(d.c.values[now] - P[1]) / (P[0] - P[1]) if P[0] != P[1] else np.nan,
                          moved=np.mean([near(P[0] + s_ * a) for s_ in (-2, -1, 1, 2)])))
    T, C, F = pd.DataFrame(T), pd.DataFrame(C), pd.DataFrame(F)
    q = lambda s: f"median {s.median():.2f} (IQR {s.quantile(.25):.2f}-{s.quantile(.75):.2f})"  # noqa: E731
    out = [f"Ronnie's 2024-2025 trend lines, channels and Fibonacci, measured on the chart timeframe they were drawn on",
           "(a touch: an order-3 pivot low (support) or high (resistance) within 0.2 ATR of the line; moved: the same line",
           " shifted 1 and 2 ATR up and down)",
           f"TREND LINES: {len(T)} ({T.tf.value_counts().to_dict()}); support {T.sup.mean():.0%}; rising {np.mean(T.slope > 0):.0%}",
           f"  touches {q(T.touches)} vs moved {q(T.moved_touches)}; two or more {np.mean(T.touches >= 2):.0%} vs moved {np.mean(T.moved_touches >= 2):.0%}",
           f"  touch by the wick {T.wick.sum() / max(T.touches.sum(), 1):.0%}, by the body edge {T.body.sum() / max(T.touches.sum(), 1):.0%}",
           f"  closes through the line {q(T.through * 100)}% of bars; span {q(T.span)} bars; bars since the last touch at publish {q(T.since_last)}",
           f"  distance from price at publish {q(T.dist_now)} ATR; within 1 ATR {np.mean(T.dist_now <= 1):.0%}",
           f"CHANNEL BORDERS: {len(C)} ({C.tf.value_counts().to_dict()}); width {q(C.width)} ATR",
           f"  touches {q(C.touches)} vs moved {q(C.moved_touches)}; touch by the wick {C.wick.sum() / max(C.touches.sum(), 1):.0%}; closes through {q(C.through * 100)}%",
           f"FIBONACCI: {len(F)} ({F.kind.value_counts().to_dict()}, {F.tf.value_counts().to_dict()})",
           f"  anchor prices vs the nearest order-20 pivot extreme (ATR): {q(F.m0)} and {q(F.m1)} vs moved {q(F.moved)};"
           f" both within 0.25 ATR {np.mean((F.m0 <= .25) & (F.m1 <= .25)):.0%}",
           f"  span {q(F.span_atr)} ATR; drawn on an up-move {F.up.mean():.0%}; price at publish as a retracement {q(F.pos)}",
           "  enabled levels: " + ", ".join(f"{k[0]} {k[1]} {v}" for k, v in sorted(levels.items()))]
    t = "\n".join(out)
    print(t)
    open("results/tv_line_method.txt", "w").write(t + "\n")


if __name__ == "__main__":
    main()
