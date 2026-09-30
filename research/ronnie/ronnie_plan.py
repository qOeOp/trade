"""Backtest of the Ronnie-derived trading plan (direction F2, map R1/R2/R4/R5, state F1, setups S1-S5).

Scratch research, not the repository's Owner path. Every parameter below is the plan's declared default;
nothing is tuned. Decisions happen at a 4h bar's close and act from the next bar. Higher timeframes are read
only once their bar has closed.

Fill model (conservative):
- limit buy fills only if low < price (trade-through), at min(price, open); maker fee;
- market entries fill at next open; stop exits at the worse of stop and open, taker fee plus slippage;
- targets fill at the better of target and open, maker fee;
- on the bar a limit fills, only the stop is checked, never the target;
- if stop and target are both touched in one bar, the stop wins.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# ---------------------------------------------------------------- declared defaults (the plan) --------------
P = dict(
    atr_n=14, pivot_k=3, reactions_per_side=6, cluster_atr=0.5, min_touches=2, max_thickness_atr=1.5,
    bb_n=20, bb_k=2.0, bw_look=120, squeeze_pct=0.30, expand_pct=0.70, squeeze_within=10,
    wk_sma=20, wk_ret=12,
    fib_levels=(0.382, 0.5, 0.618), fib_weights=(1, 1, 2), fib_confluence_atr=0.25,
    risk=0.0075, risk_s5=0.005, short_mult=0.5, max_open_risk=0.03, max_lev=3.0,
    daily_loss_stop=0.02, loss_streak=6, streak_mult=0.5,
    maker=0.0002, taker=0.0005, slip=0.0001, funding_8h=0.0001,
    s1_near_atr=1.5, s1_stop_pad=0.25, s1_valid=6,
    s3_min_width_atr=3.0, s3_valid=6,
    s2b_body_atr=1.5, s2b_close_pos=0.75,
    s5_min_touches=3, s5_near_high_atr=3.0, s5_high_look=540, s5_rr=1.25,
    s4_valid=30, max_hold=60, max_hold_fast=30, cooldown=6,
)
SETUPS = ("S1", "S2b", "S3", "S4", "S5")


# ---------------------------------------------------------------- data and features -------------------------
def load(path="btc_4h.csv"):
    d4 = pd.read_csv(path, index_col=0, parse_dates=True)
    d4 = d4[d4.volume > 0]
    d1 = pd.read_csv("btc_1d.csv", index_col=0, parse_dates=True)
    d1 = d1[d1.volume > 0]
    return d4, d1


def weekly_direction(d1, d4, bar_h=4):
    w = d1.resample("W-MON", label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    sma = w.close.rolling(P["wk_sma"]).mean()
    ret = w.close / w.close.shift(P["wk_ret"]) - 1
    dirn = pd.Series(0, index=w.index)
    dirn[(w.close > sma) & (ret > 0)] = 1
    dirn[(w.close < sma) & (ret < 0)] = -1
    dirn[sma.isna() | ret.isna()] = 0
    dirn.index = dirn.index + pd.Timedelta(days=7)  # known only at the week's close
    decision_time = d4.index + pd.Timedelta(hours=bar_h)
    return dirn.reindex(decision_time, method="ffill").fillna(0).astype(int).values


def features(d4, d1, bar_h=4):
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    tr = np.maximum(h - l, np.maximum(np.abs(h - np.roll(c, 1)), np.abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    atr = pd.Series(tr).ewm(alpha=1 / P["atr_n"], adjust=False).mean().values
    cs = d4.close
    mid = cs.rolling(P["bb_n"]).mean()
    sd = cs.rolling(P["bb_n"]).std(ddof=0)
    bw = (2 * P["bb_k"] * sd / mid)
    bwp = bw.rolling(P["bw_look"]).rank(pct=True).values
    squeezed = pd.Series(bwp < P["squeeze_pct"]).rolling(P["squeeze_within"], min_periods=1).max().fillna(0).astype(bool).values
    hi_look = pd.Series(h).rolling(P["s5_high_look"], min_periods=50).max().values
    return dict(o=o, h=h, l=l, c=c, atr=atr, bwp=bwp, squeezed=squeezed, hi_look=hi_look,
                dirn=weekly_direction(d1, d4, bar_h), t=d4.index, bar_h=bar_h)


# ---------------------------------------------------------------- map layer ----------------------------------
@dataclass
class Zone:
    lo: float
    hi: float
    touches: int


def build_zones(highs, lows, atr, rng=None):
    recs = list(highs) + list(lows)  # (wick, body)
    if len(recs) < 2:
        return []
    keys = sorted(((w + b) / 2, w, b) for w, b in recs)
    groups, cur = [], [keys[0]]
    for k in keys[1:]:
        if k[0] - cur[-1][0] <= P["cluster_atr"] * atr:
            cur.append(k)
        else:
            groups.append(cur)
            cur = [k]
    groups.append(cur)
    zones = []
    for g in groups:
        if len(g) < P["min_touches"]:
            continue
        prices = [x[1] for x in g] + [x[2] for x in g]
        lo, hi = min(prices), max(prices)
        if hi - lo > P["max_thickness_atr"] * atr:
            centre = float(np.median([x[0] for x in g]))
            lo, hi = centre - P["max_thickness_atr"] * atr / 2, centre + P["max_thickness_atr"] * atr / 2
        if rng is not None:  # placebo: same width and touches, displaced 2-6 ATR at random
            off = rng.uniform(2, 6) * atr * rng.choice((-1, 1))
            lo, hi = lo + off, hi + off
        zones.append(Zone(lo, hi, len(g)))
    return zones


# ---------------------------------------------------------------- execution objects --------------------------
@dataclass
class Leg:
    price: float  # limit price, or nan for a market order at the next open
    qty: float
    filled: bool = False
    fill: float = 0.0


@dataclass
class Trade:
    setup: str
    side: int
    stop: float
    target: float
    legs: list
    risk_usd: float
    created: int
    expiry: int
    max_hold: int
    first_fill: int = -1
    fees: float = 0.0
    funding: float = 0.0
    cancel_above: float = math.nan  # S4: cancel unfilled legs when price runs past the impulse high

    def filled_qty(self):
        return sum(x.qty for x in self.legs if x.filled)

    def avg(self):
        q = self.filled_qty()
        return sum(x.qty * x.fill for x in self.legs if x.filled) / q if q else math.nan

    def pending(self):
        return [x for x in self.legs if not x.filled]


# ---------------------------------------------------------------- simulation ---------------------------------
def simulate(F, *, use_f1=True, use_f2=True, zone_rng=None, fib_levels=None, only=None):
    o, h, l, c, atr, bwp, sq, hl, dirn, t = (F[k] for k in ("o", "h", "l", "c", "atr", "bwp", "squeezed", "hi_look", "dirn", "t"))
    n = len(c)
    fib_levels = fib_levels or P["fib_levels"]
    k = P["pivot_k"]
    highs, lows = [], []          # recent pivot reactions (wick, body)
    piv_seq = []                  # (bar, 'H'/'L', price) for fib impulses
    zones = []
    eq = 1.0
    curve = np.empty(n)
    active: list[Trade] = []
    closed = []
    last_close = {s: -10**9 for s in SETUPS}
    day, day_start_eq = None, 1.0
    streak, risk_mult = 0, 1.0
    enabled = set(only) if only else set(SETUPS)

    def cost(notional, rate):
        return abs(notional) * rate

    def close_trade(tr, px, i, rate, why):
        nonlocal eq, streak, risk_mult
        q = tr.filled_qty()
        pnl = tr.side * q * (px - tr.avg())
        tr.fees += cost(q * px, rate)
        net = pnl - tr.fees - tr.funding
        eq += net
        risk_real = sum(x.qty * abs(x.fill - tr.stop) for x in tr.legs if x.filled)
        r = net / risk_real if risk_real > 0 else 0.0
        closed.append(dict(setup=tr.setup, side=tr.side, entry_bar=tr.first_fill, exit_bar=i, entry_time=t[tr.first_fill],
                           avg=tr.avg(), exit=px, why=why, R=r, net=net, stop_atr=abs(tr.avg() - tr.stop) / atr[tr.first_fill],
                           target_R=abs(tr.target - tr.avg()) / abs(tr.avg() - tr.stop), max_hold=tr.max_hold))
        last_close[tr.setup] = i
        if r < 0:
            streak += 1
            if streak >= P["loss_streak"]:
                risk_mult = P["streak_mult"]
        else:
            streak = 0
            if r >= 2:
                risk_mult = 1.0

    for i in range(n):
        # ---- fills and exits during bar i
        for tr in list(active):
            fresh = False
            for leg in tr.pending():
                if i > tr.expiry or (tr.side == 1 and not math.isnan(tr.cancel_above) and h[i] > tr.cancel_above and tr.filled_qty() == 0):
                    continue
                if math.isnan(leg.price):
                    leg.filled, leg.fill = True, o[i] * (1 + tr.side * P["slip"])
                    tr.fees += cost(leg.qty * leg.fill, P["taker"])
                elif (tr.side == 1 and l[i] < leg.price) or (tr.side == -1 and h[i] > leg.price):
                    leg.filled = True
                    leg.fill = min(leg.price, o[i]) if tr.side == 1 else max(leg.price, o[i])
                    tr.fees += cost(leg.qty * leg.fill, P["maker"])
                else:
                    continue
                if tr.first_fill < 0:
                    tr.first_fill = i
                fresh = True
            q = tr.filled_qty()
            if q == 0:
                if i >= tr.expiry or (not math.isnan(tr.cancel_above) and h[i] > tr.cancel_above):
                    active.remove(tr)
                continue
            # funding for the bar held
            tr.funding += tr.side * q * c[i] * P["funding_8h"] / 2
            s = tr.side
            hit_stop = (l[i] <= tr.stop) if s == 1 else (h[i] >= tr.stop)
            hit_tp = (h[i] > tr.target) if s == 1 else (l[i] < tr.target)
            if hit_stop:
                px = (min(o[i], tr.stop) if s == 1 else max(o[i], tr.stop)) * (1 - s * P["slip"])
                active.remove(tr); close_trade(tr, px, i, P["taker"], "stop")
            elif hit_tp and not fresh:
                px = max(o[i], tr.target) if s == 1 else min(o[i], tr.target)
                active.remove(tr); close_trade(tr, px, i, P["maker"], "target")
            elif i - tr.first_fill >= tr.max_hold:
                px = c[i] * (1 - s * P["slip"])
                active.remove(tr); close_trade(tr, px, i, P["taker"], "time")
        mtm = eq + sum(tr.side * tr.filled_qty() * (c[i] - tr.avg()) - tr.fees - tr.funding for tr in active if tr.filled_qty() > 0)
        curve[i] = mtm

        # ---- close of bar i: update the map
        if i >= 2 * k:
            j = i - k
            win_h = h[j - k:j + k + 1]
            win_l = l[j - k:j + k + 1]
            new = False
            if h[j] == win_h.max():
                highs.append((h[j], max(o[j], c[j]))); highs[:] = highs[-P["reactions_per_side"]:]
                piv_seq.append((j, "H", h[j])); new = True
            if l[j] == win_l.min():
                lows.append((l[j], min(o[j], c[j]))); lows[:] = lows[-P["reactions_per_side"]:]
                piv_seq.append((j, "L", l[j])); new = True
            if new:
                zones = build_zones(highs, lows, atr[i], zone_rng)
                piv_seq[:] = piv_seq[-20:]

        # ---- daily loss stop and new orders
        dday = t[i].date()
        if dday != day:
            day, day_start_eq = dday, curve[i]
        if i < 600 or math.isnan(bwp[i]):
            continue
        halted = curve[i] < day_start_eq * (1 - P["daily_loss_stop"])
        if halted:
            continue
        a = atr[i]
        D = dirn[i] if use_f2 else None
        supports = sorted([z for z in zones if z.hi < c[i]], key=lambda z: -z.hi)
        resists = sorted([z for z in zones if z.lo > c[i]], key=lambda z: z.lo)
        busy = {tr.setup for tr in active}
        open_risk = sum(tr.risk_usd for tr in active)
        notional = sum(sum(x.qty for x in tr.legs) * c[i] for tr in active)

        def allowed(side):
            return True if D is None else D == side

        def place(setup, side, legs_px_w, stop, target, valid, max_hold, cancel_above=math.nan, risk_frac=None):
            nonlocal open_risk, notional
            rf = (risk_frac if risk_frac is not None else P["risk"]) * risk_mult
            if side == -1 and setup != "S5":
                rf *= P["short_mult"]
            risk_usd = rf * curve[i]
            if open_risk + risk_usd > P["max_open_risk"] * curve[i]:
                return
            ref = [(px if not math.isnan(px) else o[i + 1] if i + 1 < n else c[i], w) for px, w in legs_px_w]
            per = sum(w * abs(px - stop) for px, w in ref)
            if per <= 0:
                return
            unit = risk_usd / per
            legs = [Leg(px, unit * w) for (px, w) in legs_px_w]
            leg_notional = sum(unit * w * rp for (rp, w) in ref)
            room = P["max_lev"] * curve[i] - notional
            if room <= 0:
                return
            if leg_notional > room:
                scale = room / leg_notional
                for x in legs:
                    x.qty *= scale
                risk_usd *= scale
            active.append(Trade(setup, side, stop, target, legs, risk_usd, i, i + valid, max_hold, cancel_above=cancel_above))
            open_risk += risk_usd
            notional += min(leg_notional, room)

        def ready(s):
            return s in enabled and s not in busy and i - last_close[s] >= P["cooldown"]

        # S1: trend pullback limit at the near support's inner edge
        if ready("S1"):
            for side in (1, -1):
                if not allowed(side):
                    continue
                if side == 1 and supports and c[i] - supports[0].hi <= P["s1_near_atr"] * a:
                    z = supports[0]; entry = z.hi; stop = z.lo - P["s1_stop_pad"] * a
                    tgt = resists[0].lo if resists else entry + 2 * (entry - stop)
                    if tgt - entry >= 2 * (entry - stop):
                        place("S1", 1, [(entry, 1)], stop, tgt, P["s1_valid"], P["max_hold"]); break
                if side == -1 and resists and resists[0].lo - c[i] <= P["s1_near_atr"] * a:
                    z = resists[0]; entry = z.lo; stop = z.hi + P["s1_stop_pad"] * a
                    tgt = supports[0].hi if supports else entry - 2 * (stop - entry)
                    if entry - tgt >= 2 * (stop - entry):
                        place("S1", -1, [(entry, 1)], stop, tgt, P["s1_valid"], P["max_hold"]); break

        # S3: range quartiles in a compression with a neutral direction
        if ready("S3") and supports and resists:
            neutral = True if D is None else D == 0
            compressed = (bwp[i] < P["squeeze_pct"]) if use_f1 else True
            s, r = supports[0], resists[0]
            width = r.lo - s.hi
            if neutral and compressed and width >= P["s3_min_width_atr"] * a:
                mid = s.hi + width / 2
                if c[i] < mid:
                    place("S3", 1, [(s.hi + width / 4, 1)], s.lo - 0.25 * a, mid, P["s3_valid"], P["max_hold"])
                else:
                    place("S3", -1, [(r.lo - width / 4, 1)], r.hi + 0.25 * a, mid, P["s3_valid"], P["max_hold"])

        # S2b: large body breaking a zone's outer edge as a compression expands
        if ready("S2b") and i + 1 < n:
            state_ok = (sq[i] and bwp[i] >= P["expand_pct"]) if use_f1 else True
            rng_ = h[i] - l[i]
            body = c[i] - o[i]
            if state_ok and rng_ > 0 and abs(body) >= P["s2b_body_atr"] * a:
                if body > 0 and (c[i] - l[i]) / rng_ >= P["s2b_close_pos"] and allowed(1):
                    broken = [z for z in zones if c[i - 1] <= z.hi < c[i]]
                    if broken:
                        z = max(broken, key=lambda z: z.hi); stop = z.lo; risk_px = o[i + 1] - stop
                        if risk_px > 0:
                            nxt = [x.lo for x in zones if x.lo > c[i]]
                            dist = (min(nxt) - o[i + 1]) / risk_px if nxt else 3
                            tgt = o[i + 1] + float(np.clip(dist, 2, 3)) * risk_px
                            place("S2b", 1, [(math.nan, 1)], stop, tgt, 1, P["max_hold_fast"])
                elif body < 0 and (h[i] - c[i]) / rng_ >= P["s2b_close_pos"] and allowed(-1):
                    broken = [z for z in zones if c[i] < z.lo <= c[i - 1]]
                    if broken:
                        z = min(broken, key=lambda z: z.lo); stop = z.hi; risk_px = stop - o[i + 1]
                        if risk_px > 0:
                            nxt = [x.hi for x in zones if x.hi < c[i]]
                            dist = (o[i + 1] - max(nxt)) / risk_px if nxt else 3
                            tgt = o[i + 1] - float(np.clip(dist, 2, 3)) * risk_px
                            place("S2b", -1, [(math.nan, 1)], stop, tgt, 1, P["max_hold_fast"])

        # S4: layered Fibonacci pullback in the trend, only when a level meets a zone
        if ready("S4") and len(piv_seq) >= 2:
            (j1, t1, p1), (j2, t2, p2) = piv_seq[-2], piv_seq[-1]
            for side in (1, -1):
                if not allowed(side):
                    continue
                if side == 1 and t1 == "L" and t2 == "H" and c[i] < p2 and c[i] > p1:
                    lv = [p2 - r * (p2 - p1) for r in fib_levels]
                    conf = any(z.lo - P["fib_confluence_atr"] * a <= x <= z.hi + P["fib_confluence_atr"] * a for x in lv for z in zones)
                    if conf and all(x < c[i] for x in lv):
                        place("S4", 1, list(zip(lv, P["fib_weights"])), p1 - 0.25 * a, p2, P["s4_valid"], P["max_hold"], cancel_above=p2)
                        break
                if side == -1 and t1 == "H" and t2 == "L" and p2 < c[i] < p1:
                    lv = [p2 + r * (p1 - p2) for r in fib_levels]
                    conf = any(z.lo - P["fib_confluence_atr"] * a <= x <= z.hi + P["fib_confluence_atr"] * a for x in lv for z in zones)
                    if conf and all(x > c[i] for x in lv):
                        place("S4", -1, list(zip(lv, P["fib_weights"])), p1 + 0.25 * a, p2, P["s4_valid"], P["max_hold"])
                        break

        # S5: counter-trend short after a sweep of a strong resistance near the major high
        if ready("S5") and i + 1 < n and (D is None or D >= 0):
            for z in zones:
                strong = z.touches >= P["s5_min_touches"] and z.hi >= hl[i] - P["s5_near_high_atr"] * a
                if strong and h[i] > z.hi and c[i] < z.hi and c[i - 1] < z.hi:
                    stop = h[i] + 0.1 * a; risk_px = stop - o[i + 1]
                    if risk_px > 0:
                        place("S5", -1, [(math.nan, 1)], stop, o[i + 1] - P["s5_rr"] * risk_px, 1, P["max_hold_fast"],
                              risk_frac=P["risk_s5"])
                    break

    return pd.Series(curve, index=t), pd.DataFrame(closed)


# ---------------------------------------------------------------- reporting ----------------------------------
IS = ("2017-01-01", "2023-01-01")
OOS = ("2023-01-01", "2027-01-01")


def curve_stats(curve, a, b):
    seg = curve[(curve.index >= a) & (curve.index < b)]
    seg = seg / seg.iloc[0]
    yrs = (seg.index[-1] - seg.index[0]).days / 365.25
    daily = seg.resample("1D").last().pct_change().dropna()
    return dict(total=seg.iloc[-1] - 1, CAGR=seg.iloc[-1] ** (1 / yrs) - 1, maxDD=(seg / seg.cummax() - 1).min(),
                Sharpe=daily.mean() / daily.std() * np.sqrt(365) if daily.std() > 0 else np.nan)


def trade_stats(tr, a, b):
    if tr.empty:
        return dict(n=0)
    x = tr[(tr.entry_time >= a) & (tr.entry_time < b)]
    if x.empty:
        return dict(n=0)
    pos, neg = x.net[x.net > 0].sum(), -x.net[x.net < 0].sum()
    return dict(n=len(x), win=(x.R > 0).mean(), avgR=x.R.mean(), sumR=x.R.sum(), PF=pos / neg if neg > 0 else np.nan)
