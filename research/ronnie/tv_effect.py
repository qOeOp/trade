"""Do Ronnie's own BTC levels hold after he publishes them, and does calibrating the zone map to his lines help?

E2 (backtest, in-sample 2017-2022 only): the full plan with its zone map rebuilt from the calibrated parameters, on
   4h bars and on daily bars (most of his BTC charts are daily), each against 30 runs whose zones are displaced 2-6 ATR.

E1 (level reaction, BTC/USD ideas, Bitstamp bars on each idea's timeframe): from publish time, the first bar that
   trades through a level; "held" if price then moves 1 ATR away on the rejecting side before a close 1 ATR beyond
   the level, else "broke" (60-bar horizon). His lines vs the same lines jittered 1-4 ATR (500 draws each), and vs the
   nearest mechanical zone edges above/below price at the same moment (default and calibrated map parameters).
"""
import json, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from tv_calibrate import load_ideas, horizontals, zones_at_end  # noqa: E402
import ronnie_plan  # noqa: E402

TF = {"60": "btc_1h.csv", "240": "btc_4h.csv", "1D": "btc_1d.csv"}
BAR = {"60": 3600, "240": 14400, "1D": 86400}
DEFAULT = (3, 6, 0.5, 2, "wick")
CALIBRATED = (2, 12, 0.5, 2, "wick")  # tv_calibrate Q2: best or tied-best on both halves
RNG = np.random.default_rng(5)


def bars(tf):
    d = pd.read_csv(f"{HERE}/{TF[tf]}", index_col=0, parse_dates=True)
    d = d[d.volume > 0]
    t = d.index.as_unit("s").asi8
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1))))
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values
    return dict(t=t, o=o, h=h, l=l, c=c, atr=atr)


def react(B, i0, y, horizon=60):
    """Outcome of the first touch of y after bar i0 (the last bar closed at publish)."""
    o, h, l, c, atr = B["o"], B["h"], B["l"], B["c"], B["atr"]
    side = 1 if c[i0] > y else -1  # 1: support below price, -1: resistance above
    for i in range(i0 + 1, min(i0 + 1 + horizon, len(c))):
        if l[i] <= y <= h[i] or (side == 1 and h[i] < y) or (side == -1 and l[i] > y):
            a = atr[i0]
            for j in range(i, min(i + horizon, len(c))):
                if side * (c[j] - y) < -a:
                    return 0  # closed 1 ATR through
                if (side == 1 and h[j] >= y + a) or (side == -1 and l[j] <= y - a):
                    return 1  # moved 1 ATR away on the rejecting side
            return None
    return None  # never touched


def e1():
    ideas = [I for I in load_ideas() if I["it"]["short"] in ("BTCUSD", "BTCUSDT", "BTCUSD.P", "XBTUSD")
             and I["it"]["interval"] in TF]
    Bs = {tf: bars(tf) for tf in TF}
    rows = []
    for I in ideas:
        tf = I["it"]["interval"]
        B = Bs[tf]
        pub = pd.Timestamp(I["it"]["created_at"]).value // 10**9
        i0 = int(np.searchsorted(B["t"], pub - BAR[tf], side="right")) - 1  # last bar closed by publish time
        if i0 < 200:
            continue
        a = B["atr"][i0]
        mech = {}
        for name, prm in (("default map", DEFAULT), ("calibrated map", CALIBRATED)):
            s = slice(max(0, i0 - 400), i0 + 1)
            J = dict(o=B["o"][s], h=B["h"][s], l=B["l"][s], c=B["c"][s], atr=B["atr"][i0])
            zs = zones_at_end(J, *prm)
            px = B["c"][i0]
            below = [z.hi for z in zs if z.hi < px]
            above = [z.lo for z in zs if z.lo > px]
            mech[name] = ([max(below)] if below else []) + ([min(above)] if above else [])
        for y in horizontals(I):
            r = react(B, i0, y)
            jit = [react(B, i0, y + RNG.uniform(1, 4) * a * RNG.choice((-1, 1))) for _ in range(500)]
            jit = [x for x in jit if x is not None]
            rows.append(dict(uuid=I["it"]["uuid"], date=I["it"]["created_at"][:10], tf=tf, y=y, dist_atr=(y - B["c"][i0]) / a,
                             his=r, jitter=np.mean(jit) if jit else np.nan))
        for name, ys in mech.items():
            for y in ys:
                rows.append(dict(uuid=I["it"]["uuid"], date=I["it"]["created_at"][:10], tf=tf, y=y,
                                 dist_atr=(y - B["c"][i0]) / a, **{name: react(B, i0, y)}))
    df = pd.DataFrame(rows)
    out = [f"E1 BTC level reaction: {df.uuid.nunique()} unique BTC/USD ideas, {df.jitter.notna().sum()} of his lines"]
    for col in ("his", "default map", "calibrated map"):
        v = df[col].dropna()
        p = v.mean()
        out.append(f"  {col:<15} resolved {len(v):3d}; held {p:.0%} (+-{np.sqrt(p * (1 - p) / len(v)):.0%} s.e.)")
    his = df[df.his.notna()]
    if len(his):
        out.append(f"  jittered his lines (same touched lines, 500 draws each): held {his.jitter.mean():.0%}; "
                   f"his minus jitter {np.mean(his.his - his.jitter):+.0%} over {len(his)} lines")
    return out, df


def zone_schedule(d, close_times, t4_decide, prm, rng=None):
    """Zones known at each 4h decision time, rebuilt from d's pivots (order k, confirmed k bars later)."""
    k, per_side, cluster, min_t, _ = prm
    P = ronnie_plan.P
    saved = {x: P[x] for x in ("cluster_atr", "min_touches")}
    P["cluster_atr"], P["min_touches"] = cluster, min_t
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1))))
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values
    highs, lows, snaps = [], [], []
    try:
        for i in range(len(c)):
            j = i - k
            if j - k >= 0:
                new = False
                if h[j] == h[j - k:j + k + 1].max():
                    highs.append((h[j], max(o[j], c[j]))); highs[:] = highs[-per_side:]; new = True
                if l[j] == l[j - k:j + k + 1].min():
                    lows.append((l[j], min(o[j], c[j]))); lows[:] = lows[-per_side:]; new = True
                if new or not snaps:
                    snaps.append((close_times[i], ronnie_plan.build_zones(highs, lows, atr[i], rng)))
    finally:
        P.update(saved)
    ct = np.array([x[0] for x in snaps])
    idx = np.searchsorted(ct, t4_decide, side="right") - 1
    return [snaps[x][1] if x >= 0 else [] for x in idx]


def e2():
    d4, d1 = ronnie_plan.load()
    F = ronnie_plan.features(d4, d1)
    t4 = d4.index.as_unit("s").asi8 + 4 * 3600
    ct4 = t4.copy()
    ct1 = d1.index.as_unit("s").asi8 + 86400
    zsetups = ("S1", "S3")  # the setups that trade the zone map

    def summ(res):
        curve, tr = res
        cs = ronnie_plan.curve_stats(curve, *ronnie_plan.IS)
        r = dict(Sharpe=cs["Sharpe"], CAGR=cs["CAGR"])
        for s_ in ronnie_plan.SETUPS:
            ts = ronnie_plan.trade_stats(tr[tr.setup == s_], *ronnie_plan.IS)
            r[f"{s_}_avgR"], r[f"{s_}_n"] = ts.get("avgR", np.nan), ts.get("n", 0)
        z = tr[(tr.setup.isin(zsetups)) & (tr.entry_time >= ronnie_plan.IS[0]) & (tr.entry_time < ronnie_plan.IS[1])]
        r["zone_avgR"], r["zone_n"] = z.R.mean(), len(z)
        return r

    out = ["E2 full plan, in-sample 2017-2022 (Sharpe of the portfolio; zone_avgR = S1+S3 trades, which use the map)"]
    variants = [("default map (4h, k=3, 6/side)", (d4, ct4, DEFAULT)),  # schedule reproduces simulate()'s own map exactly
                ("calibrated map on 4h (k=2, 12/side)", (d4, ct4, CALIBRATED)),
                ("calibrated map on daily (k=2, 12/side)", (d1, ct1, CALIBRATED)),
                ("default params on daily (k=3, 6/side)", (d1, ct1, DEFAULT))]
    for name, v in variants:
        sched = zone_schedule(v[0], v[1], t4, v[2])
        real = summ(ronnie_plan.simulate(F, zone_sched=sched))
        out.append(f"  {name:<40} Sharpe {real['Sharpe']:+.2f}  CAGR {real['CAGR']:+.1%}  zone trades {real['zone_n']:4d} avgR {real['zone_avgR']:+.3f}  "
                   + "  ".join(f"{s_} {real[f'{s_}_avgR']:+.2f}/{real[f'{s_}_n']}" for s_ in ronnie_plan.SETUPS))
        pl = [summ(ronnie_plan.simulate(F, zone_sched=zone_schedule(v[0], v[1], t4, v[2], np.random.default_rng(s_))))
              for s_ in range(30)]
        for key in ("Sharpe", "zone_avgR"):
            x = np.array([p[key] for p in pl], float)
            x = x[~np.isnan(x)]
            out.append(f"      placebo zones {key:<9}: median {np.median(x):+.3f} [5-95% {np.percentile(x, 5):+.3f}, {np.percentile(x, 95):+.3f}]"
                       f"  share >= real {np.mean(x >= real[key]):.2f}")
    return out


if __name__ == "__main__":
    o, df = e1()
    df.to_csv(f"{HERE}/results/tv_e1_levels.csv", index=False)
    o += [""] + e2()
    text = "\n".join(o)
    print(text)
    open(f"{HERE}/results/tv_effect.txt", "w").write(text + "\n")
