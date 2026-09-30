"""Do the points where Ronnie's own lines cross work? Test on his drawings, not on lines of ours.

Intersections: each of his trend lines and channel borders, extended right, against each of his horizontal lines, and
against each other, at a time after he published and within 30 bars of the chart he drew on (sloped x horizontal and
sloped x sloped are reported apart). Arrival: price trades through the intersection price within 3 chart bars either
side of the intersection time. Outcome as in tv_effect.E1: "held" if price moves 1 ATR away on the side it came from
before a close 1 ATR beyond, within 30 chart bars. ATR is his chart's ATR(14) at publish.
Controls: the same intersection moved 1-4 ATR in price (200 draws each, same time window), and each of his horizontal
lines tested alone at its first touch after publish.
Prices: tv/hourly windows (tv_hourly.py) where they exist, else TradingView daily bars (tv_prices.py) for daily and
weekly charts; 4h/1h ideas without hourly bars are skipped.
"""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from tv_calibrate import load_ideas  # noqa: E402

BAR_S = {"60": 3600, "240": 14400, "1D": 86400, "1W": 604800}
HORIZON, WINDOW, DRAWS = 30, 3, 200
RNG = np.random.default_rng(21)


def ts(iso):
    return int(pd.Timestamp(iso).value // 10**9)


def sloped_lines(I):
    """[(t1, p1, slope per second, kind)] for trend lines and both channel borders."""
    out = []
    for d in I["draws"]:
        a = d["anchors"]
        if d["type"] == "LineToolTrendLine" and len(a) >= 2:
            (t1, p1), (t2, p2) = (ts(a[0]["time"]), a[0]["price"]), (ts(a[1]["time"]), a[1]["price"])
            if t2 != t1:
                out.append((t1, p1, (p2 - p1) / (t2 - t1), "trend"))
        if d["type"] == "LineToolParallelChannel" and len(a) >= 3:
            (t1, p1), (t2, p2), (t3, p3) = ((ts(x["time"]), x["price"]) for x in a[:3])
            if t2 != t1:
                sl = (p2 - p1) / (t2 - t1)
                out.append((t1, p1, sl, "channel"))
                out.append((t1, p1 + (p3 - (p1 + sl * (t3 - t1))), sl, "channel"))
    return out


def horizontals(I):
    return [d["anchors"][0]["price"] for d in I["draws"] if d["type"] == "LineToolHorzLine" and d["anchors"]]


def prices(I):
    uuid = I["it"]["uuid"]
    p = f"{HERE}/tv/hourly/{uuid}.csv.gz"
    if os.path.exists(p):
        d = pd.read_csv(gzip.open(p, "rt"))
        return d, "hourly"
    if I["it"]["interval"] in ("1D", "1W"):
        sym = (I["it"]["chart_symbol"] or I["it"]["symbol"]).replace(":", "_")
        q = f"{HERE}/tv/prices/{sym}.csv.gz"
        if os.path.exists(q):
            d = pd.read_csv(gzip.open(q, "rt"))
            before = d[d.time <= ts(I["it"]["created_at"])]
            if before.empty:  # the feed's history starts after the idea
                return None, None
            k = I["c"][-1] / before.close.iloc[-1]
            d[["open", "high", "low", "close"]] *= k
            return d, "daily"
    return None, None


def react(d, t_lo, t_hi, y, atr, horizon_s):
    """Outcome at the first bar in [t_lo, t_hi] that trades through y: 1 held, 0 broke, None not reached/unresolved."""
    t, o, h, l, c = (d[x].values for x in ("time", "open", "high", "low", "close"))
    idx = np.flatnonzero((t >= t_lo) & (t <= t_hi) & (l <= y) & (h >= y))
    if not idx.size:
        return None
    i = idx[0]
    side = 1 if o[i] >= y else -1  # came from above: the level is support
    end = np.searchsorted(t, t[i] + horizon_s)
    for j in range(i, min(end, len(c))):
        if side * (c[j] - y) < -atr:
            return 0
        if (side == 1 and h[j] >= y + atr) or (side == -1 and l[j] <= y - atr):
            return 1
    return None


def main():
    rows = []
    for I in load_ideas():
        tf = I["it"]["interval"]
        pub, bar, a = ts(I["it"]["created_at"]), BAR_S[tf], I["atr"]
        d, src = prices(I)
        if d is None:
            continue
        crypto = not any(x in (I["it"]["chart_symbol"] or I["it"]["symbol"]) for x in ("FX", "OANDA", "TVC", "SP:", "FOREX"))
        span = HORIZON * bar * (1 if crypto or tf in ("60", "240") else 7 / 5)  # FX daily and weekly skip weekends
        horizon_s, win = span, WINDOW * bar
        SL, HL = sloped_lines(I), horizontals(I)
        pts = []
        for t1, p1, sl, kind in SL:
            if sl == 0:
                continue
            for y in HL:
                tx = t1 + (y - p1) / sl
                if pub < tx <= pub + span:
                    pts.append((tx, y, f"{kind} x horizontal"))
        for u in range(len(SL)):
            for v in range(u + 1, len(SL)):
                (ta, pa, sa, ka), (tb, pb, sb, kb) = SL[u], SL[v]
                if abs(sa - sb) < 1e-15:
                    continue
                tx = (pb - pa + sa * ta - sb * tb) / (sa - sb)  # pa + sa(t - ta) = pb + sb(t - tb)
                if pub < tx <= pub + span:
                    pts.append((tx, pa + sa * (tx - ta), "sloped x sloped"))
        for tx, y, kind in pts:
            r = react(d, tx - win, tx + win, y, a, horizon_s)
            jit = [react(d, tx - win, tx + win, y + RNG.uniform(1, 4) * a * RNG.choice((-1, 1)), a, horizon_s) for _ in range(DRAWS)]
            jit = [x for x in jit if x is not None]
            rows.append(dict(uuid=I["it"]["uuid"], symbol=I["it"]["short"], tf=tf, src=src, kind=kind,
                             t=pd.Timestamp(tx, unit="s").strftime("%Y-%m-%d %H:%M"), y=y, held=r,
                             placebo=np.mean(jit) if jit else np.nan, placebo_reach=len(jit) / DRAWS))
        for y in HL:  # his horizontal line alone, first touch after publish
            r = react(d, pub, pub + span, y, a, horizon_s)
            jit = [react(d, pub, pub + span, y + RNG.uniform(1, 4) * a * RNG.choice((-1, 1)), a, horizon_s) for _ in range(DRAWS)]
            jit = [x for x in jit if x is not None]
            rows.append(dict(uuid=I["it"]["uuid"], symbol=I["it"]["short"], tf=tf, src=src, kind="horizontal alone",
                             t="", y=y, held=r, placebo=np.mean(jit) if jit else np.nan, placebo_reach=len(jit) / DRAWS))
    df = pd.DataFrame(rows)
    df.to_csv(f"{HERE}/results/tv_intersections.csv", index=False)
    out = [f"His own line intersections after publish, {df.uuid.nunique()} ideas with prices"]
    for kind, z in df.groupby("kind"):
        v = z.held.dropna()
        p = v.mean() if len(v) else np.nan
        line = (f"  {kind:<22} intersections {len(z):3d}, reached {len(v):3d} ({len(v) / len(z):.0%}); held {p:.0%}"
                f" (+-{np.sqrt(p * (1 - p) / len(v)) if len(v) else np.nan:.0%} s.e.)")
        zz = z[z.held.notna() & z.placebo.notna()]
        if len(zz):
            line += (f"; paired n={len(zz)}: his {zz.held.mean():.0%} vs same points moved 1-4 ATR {zz.placebo.mean():.0%}, "
                     f"difference {np.mean(zz.held - zz.placebo):+.0%}")
        out.append(line)
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/results/tv_intersections.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
