"""S6: horizontal zone x trend line confluence (Ronnie R1/R2 + R3), with its two components as controls.

Rules are declared before the run. One position at a time per variant; limit entry at the confluence point,
re-placed every bar because the line moves. Same conservative fill model as ronnie_plan.py.
"""
import math
import sys

import numpy as np
import pandas as pd

from ronnie_plan import build_zones, load, features, P as PLAN

C = dict(min_gap=5, max_age=120, near_atr=1.5, zone_pad_atr=0.25, stop_pad_atr=0.25, line_only_stop_atr=1.0,
         min_rr=2.0, max_hold=60, cooldown=6, risk=0.0075,
         maker=PLAN["maker"], taker=PLAN["taker"], slip=PLAN["slip"], funding_8h=PLAN["funding_8h"])


def line_at(p1, p2, i):
    (j1, v1), (j2, v2) = p1, p2
    return v2 + (v2 - v1) * (i - j2) / (j2 - j1)


def run(F, mode="confluence", k=3, zone_rng=None, use_dir=False, log=None):
    o, h, l, c, atr, dirn, t = (F[x] for x in ("o", "h", "l", "c", "atr", "dirn", "t"))
    n = len(c)
    highs, lows, hp, lp = [], [], [], []   # reactions for zones; pivot (bar, price) lists for lines
    zones = []
    trades = []
    pos = None      # dict while in a position
    last_exit = -10**9
    order = None    # pending order for bar i+1
    for i in range(n):
        # ---- execute pending order / manage position on bar i
        if pos is None and order is not None:
            side, E, stop, tgt = order
            if (side == 1 and l[i] < E) or (side == -1 and h[i] > E):
                fill = min(E, o[i]) if side == 1 else max(E, o[i])
                pos = dict(side=side, fill=fill, stop=stop, tgt=tgt, i0=i, fees=fill * C["maker"], fund=0.0)
        order = None
        if pos is not None:
            s = pos["side"]
            pos["fund"] += s * c[i] * C["funding_8h"] * F.get("bar_h", 4) / 8
            fresh = pos["i0"] == i
            px = why = None
            if (s == 1 and l[i] <= pos["stop"]) or (s == -1 and h[i] >= pos["stop"]):
                px = (min(o[i], pos["stop"]) if s == 1 else max(o[i], pos["stop"])) * (1 - s * C["slip"]); why = "stop"; fee = C["taker"]
            elif not fresh and ((s == 1 and h[i] > pos["tgt"]) or (s == -1 and l[i] < pos["tgt"])):
                px = max(o[i], pos["tgt"]) if s == 1 else min(o[i], pos["tgt"]); why = "target"; fee = C["maker"]
            elif i - pos["i0"] >= C["max_hold"]:
                px = c[i] * (1 - s * C["slip"]); why = "time"; fee = C["taker"]
            if px is not None:
                risk = abs(pos["fill"] - pos["stop"])
                net = s * (px - pos["fill"]) - pos["fees"] - px * fee - pos["fund"]
                trades.append(dict(entry_time=t[pos["i0"]], side=s, R=net / risk, why=why, bars=i - pos["i0"],
                                   stop_atr=risk / atr[pos["i0"]], target_R=abs(pos["tgt"] - pos["fill"]) / risk))
                pos = None
                last_exit = i
        # ---- close of bar i: pivots, zones, lines
        if i >= 2 * k:
            j = i - k
            if h[j] == h[j - k:j + k + 1].max():
                highs.append((h[j], max(o[j], c[j]))); highs[:] = highs[-PLAN["reactions_per_side"]:]
                hp.append((j, h[j])); hp[:] = hp[-4:]
                zones = build_zones(highs, lows, atr[i], zone_rng)
            if l[j] == l[j - k:j + k + 1].min():
                lows.append((l[j], min(o[j], c[j]))); lows[:] = lows[-PLAN["reactions_per_side"]:]
                lp.append((j, l[j])); lp[:] = lp[-4:]
                zones = build_zones(highs, lows, atr[i], zone_rng)
        if pos is not None or i < 600 or i + 1 >= n or i - last_exit < C["cooldown"]:
            continue
        a = atr[i]
        supports = sorted([z for z in zones if z.hi < c[i]], key=lambda z: -z.hi)
        resists = sorted([z for z in zones if z.lo > c[i]], key=lambda z: z.lo)

        def valid_line(pts, side):
            if len(pts) < 2:
                return None
            p1, p2 = pts[-2], pts[-1]
            if p2[0] - p1[0] < C["min_gap"] or i - p2[0] > C["max_age"]:
                return None
            if side == 1 and not p2[1] > p1[1]:
                return None
            if side == -1 and not p2[1] < p1[1]:
                return None
            idx = np.arange(p2[0], i + 1)
            vals = p2[1] + (p2[1] - p1[1]) * (idx - p2[0]) / (p2[0] - p1[0])
            if side == 1 and (c[p2[0]:i + 1] < vals).any():
                return None
            if side == -1 and (c[p2[0]:i + 1] > vals).any():
                return None
            return line_at(p1, p2, i + 1)

        for side in (1, -1):
            if use_dir and dirn[i] != side:
                continue
            if side == 1:
                tl = valid_line(lp, 1)
                zone = supports[0] if supports else None
                if mode == "confluence":
                    if tl is None or zone is None or not (zone.lo - C["zone_pad_atr"] * a <= tl <= zone.hi + C["zone_pad_atr"] * a):
                        continue
                    E = tl; stop = min(zone.lo, tl) - C["stop_pad_atr"] * a
                elif mode == "zone_only":
                    if zone is None:
                        continue
                    E = zone.hi; stop = zone.lo - C["stop_pad_atr"] * a
                else:  # line_only
                    if tl is None:
                        continue
                    E = tl; stop = tl - C["line_only_stop_atr"] * a
                if not (E < c[i] and c[i] - E <= C["near_atr"] * a and stop < E):
                    continue
                tgt = resists[0].lo if resists else E + C["min_rr"] * (E - stop)
                if tgt - E < C["min_rr"] * (E - stop):
                    continue
                order = (1, E, stop, tgt)
                if log is not None: log.append((i, 1, E, stop, tgt))
                break
            else:
                tl = valid_line(hp, -1)
                zone = resists[0] if resists else None
                if mode == "confluence":
                    if tl is None or zone is None or not (zone.lo - C["zone_pad_atr"] * a <= tl <= zone.hi + C["zone_pad_atr"] * a):
                        continue
                    E = tl; stop = max(zone.hi, tl) + C["stop_pad_atr"] * a
                elif mode == "zone_only":
                    if zone is None:
                        continue
                    E = zone.lo; stop = zone.hi + C["stop_pad_atr"] * a
                else:
                    if tl is None:
                        continue
                    E = tl; stop = tl + C["line_only_stop_atr"] * a
                if not (E > c[i] and E - c[i] <= C["near_atr"] * a and stop > E):
                    continue
                tgt = supports[0].hi if supports else E - C["min_rr"] * (stop - E)
                if E - tgt < C["min_rr"] * (stop - E):
                    continue
                order = (-1, E, stop, tgt)
                if log is not None: log.append((i, -1, E, stop, tgt))
                break
    return pd.DataFrame(trades)


def random_control(F, real, runs=200, seed=5):
    """Market entries at random bars: same count per year, same sides, same stop-ATR and target-R pairs."""
    o, h, l, c, atr, t = (F[x] for x in ("o", "h", "l", "c", "atr", "t"))
    rng = np.random.default_rng(seed)
    years = pd.DatetimeIndex(t).year
    real = real.copy(); real["year"] = pd.DatetimeIndex(real.entry_time).year
    pairs = real[["stop_atr", "target_R"]].values
    out = []
    for _ in range(runs):
        Rs = []
        for y, g in real.groupby("year"):
            bars = np.where((years == y) & (np.arange(len(c)) > 600) & (np.arange(len(c)) < len(c) - C["max_hold"] - 2))[0]
            for i0, s in zip(rng.choice(bars, len(g), replace=False), rng.permutation(g.side.values)):
                sa, tr_ = pairs[rng.integers(len(pairs))]
                e = o[i0] * (1 + s * C["slip"]); risk = sa * atr[i0 - 1]
                stop, tgt = e - s * risk, e + s * tr_ * risk
                fund = 0.0; px = None
                for i in range(i0, i0 + C["max_hold"] + 1):
                    fund += s * c[i] * C["funding_8h"] * F.get("bar_h", 4) / 8
                    if (s == 1 and l[i] <= stop) or (s == -1 and h[i] >= stop):
                        px = (min(o[i], stop) if s == 1 else max(o[i], stop)) * (1 - s * C["slip"]); fee = C["taker"]; break
                    if i > i0 and ((s == 1 and h[i] > tgt) or (s == -1 and l[i] < tgt)):
                        px = max(o[i], tgt) if s == 1 else min(o[i], tgt); fee = C["maker"]; break
                if px is None:
                    px = c[i0 + C["max_hold"]]; fee = C["taker"]
                Rs.append((s * (px - e) - e * C["taker"] - px * fee - fund) / risk)
        out.append(np.mean(Rs))
    return np.array(out)


def summary(tr, a, b):
    x = tr[(tr.entry_time >= a) & (tr.entry_time < b)] if len(tr) else tr
    if len(x) == 0:
        return dict(n=0)
    eq = np.cumprod(1 + C["risk"] * x.R.values)
    yrs = (pd.Timestamp(b, tz="UTC") - pd.Timestamp(a, tz="UTC")).days / 365.25
    yrs = min(yrs, (pd.Timestamp("2026-09-30", tz="UTC") - pd.Timestamp(a, tz="UTC")).days / 365.25)
    return dict(n=len(x), win=(x.R > 0).mean(), avgR=x.R.mean(), tR=x.R.mean() / (x.R.std(ddof=1) / math.sqrt(len(x))),
                CAGR=eq[-1] ** (1 / yrs) - 1, maxDD=(eq / np.maximum.accumulate(eq) - 1).min())


if __name__ == "__main__":
    d4, d1 = load(); F = features(d4, d1)
    IS, OOS = ("2017-01-01", "2023-01-01"), ("2023-01-01", "2027-01-01")
    pd.set_option("display.width", 220)
    rows, keep = [], {}
    for k in (3, 5):
        for mode in ("confluence", "zone_only", "line_only"):
            for use_dir in (False, True):
                tr = run(F, mode, k=k, use_dir=use_dir)
                keep[(k, mode, use_dir)] = tr
                for pn, (a, b) in (("IS", IS), ("OOS", OOS)):
                    rows.append(dict(k=k, mode=mode, F2=use_dir, period=pn, **summary(tr, a, b)))
    tab = pd.DataFrame(rows).set_index(["k", "mode", "F2", "period"])
    print(tab.to_string(float_format=lambda x: f"{x:,.3f}"))

    for k in (3, 5):
        real = keep[(k, "confluence", False)]
        print(f"\n== k={k} confluence, no F2 ==")
        print(real.groupby("side").agg(n=("R", "size"), win=("R", lambda r: (r > 0).mean()), avgR=("R", "mean")).round(3).to_string())
        rc = random_control(F, real)
        print(f"random-entry control (200 runs) avgR median {np.median(rc):.3f} [5-95% {np.percentile(rc,5):.3f},{np.percentile(rc,95):.3f}]; real {real.R.mean():.3f}; share>=real {(rc>=real.R.mean()).mean():.3f}")
        pz = []
        for s in range(30):
            x = run(F, "confluence", k=k, zone_rng=np.random.default_rng(100 + s))
            pz.append((summary(x, *IS).get("avgR", np.nan), summary(x, *OOS).get("avgR", np.nan), len(x)))
        pz = np.array(pz)
        for col, pn, (a, b) in ((0, "IS", IS), (1, "OOS", OOS)):
            r = summary(real, a, b)["avgR"]; v = pz[:, col][~np.isnan(pz[:, col])]
            print(f"placebo zones {pn}: real avgR {r:.3f} | placebo median {np.median(v):.3f} [5-95% {np.percentile(v,5):.3f},{np.percentile(v,95):.3f}] | share>=real {(v>=r).mean():.2f} | placebo trades median {int(np.median(pz[:,2]))}")
        real.to_csv(f"s6_confluence_k{k}_trades.csv", index=False)
