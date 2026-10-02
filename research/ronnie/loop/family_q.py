"""Loop P-3: the Ronnie plan drawn faithfully (loop/LOG.md, "Loop P-3"; EXTERNAL_RESEARCH section 7).
Weekly + daily direction, daily structure (big-swing Fibonacci, round numbers, Bollinger), 1h rejection entries.
Usage: python loop/family_q.py"""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import family_p as FP  # noqa: E402

T0, T1 = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
PIV, SPACING, HOLD, HOLD_RANGE = 21, 24, 720, 240
VARIANTS = ("Q-1", "Q-1p", "Q-2", "Q-3", "Q-4")
BANDS = {"Q-1": (0.5, 0.618, 0.786), "Q-1p": (0.42, 0.53, 0.70)}


def daily_features(d1):
    o, h, l, c = (d1[x].values for x in ("open", "high", "low", "close"))
    atr = E.MT.atr_of(h, l, c)
    mid = d1.close.rolling(20).mean().values
    sd = d1.close.rolling(20).std(ddof=0).values
    up, lo = mid + 2 * sd, mid - 2 * sd
    bw = (up - lo) / mid
    bw_pct = pd.Series(bw).rolling(125).rank(pct=True).values
    w = d1.resample("W-MON", label="left", closed="left").agg({"close": "last"}).dropna()
    ema = w.close.ewm(span=13, adjust=False).mean()
    wk_up = (ema > ema.shift(1)).astype(int) - (ema < ema.shift(1)).astype(int)
    wk_up.index = wk_up.index + pd.Timedelta(days=7)  # known at the week's close
    wk = wk_up.reindex(d1.index + pd.Timedelta(days=1), method="ffill").fillna(0).values  # as of each day's close
    bias = np.where((wk > 0) & (c > mid), 1, np.where((wk < 0) & (c < mid), -1, 0))
    # pivots of order PIV, confirmed PIV days later
    piv = []  # (confirm index, pivot index, 'H'/'L', price)
    for j in range(PIV, len(c) - PIV):
        if h[j] == h[j - PIV:j + PIV + 1].max():
            piv.append((j + PIV, j, "H", h[j]))
        if l[j] == l[j - PIV:j + PIV + 1].min():
            piv.append((j + PIV, j, "L", l[j]))
    piv.sort()
    return dict(c=c, atr=atr, mid=mid, up=up, lo=lo, bw=bw, bw_pct=bw_pct, bias=bias, piv=piv)


def signals(d1, h1):
    D = daily_features(d1)
    # for each 1h bar, the last daily bar closed before it opens
    di = d1.index.searchsorted(h1.index - pd.Timedelta(days=1), side="right") - 1
    o, h, l, c = (h1[x].values for x in ("open", "high", "low", "close"))
    out = {v: [] for v in VARIANTS}
    last = {v: -10**9 for v in VARIANTS}
    busy = {v: -1 for v in VARIANTS}
    used_imp = {v: set() for v in ("Q-1", "Q-1p")}
    armed = None  # Q-2: (level, side, expiry daily index)
    pi = 0
    conf = []  # confirmed pivots so far
    prev_j = -1
    for i in range(len(c) - 1):
        j = di[i]
        if j < 130 or np.isnan(D["atr"][j]) or np.isnan(D["mid"][j]):
            continue
        a = D["atr"][j]
        bias = D["bias"][j]
        if j != prev_j:  # new daily close: update pivots and Q-2 arming
            while pi < len(D["piv"]) and D["piv"][pi][0] <= j:
                conf.append(D["piv"][pi])
                pi += 1
            cj, cp = D["c"][j], D["c"][j - 1]
            step = 10 ** np.floor(np.log10(cj)) / 10
            if bias != 0:
                lvl = (np.floor(cj / step) if bias == 1 else np.ceil(cj / step)) * step
                if (bias == 1 and cp < lvl <= cj) or (bias == -1 and cp > lvl >= cj):
                    armed = (lvl, bias, j + 10)
            if armed and (j > armed[2] or (armed[1] == 1 and cj < armed[0]) or (armed[1] == -1 and cj > armed[0])):
                armed = None
            prev_j = j

        def rejection(level, side, reach_tol=0.0):
            """the bar reaches within reach_tol of the level and closes back beyond the level, body in the trade's direction"""
            reach = l[i] <= level + reach_tol if side == 1 else h[i] >= level - reach_tol
            back = c[i] > level if side == 1 else c[i] < level
            body = (c[i] - o[i]) * side > 0
            return reach and back and body

        def take(v, side, stop, tgt):
            if i - last[v] < SPACING or i <= busy[v]:
                return
            entry = o[i + 1]
            if (entry - stop) * side <= 0 or (tgt - entry) * side <= 0:
                return
            out[v].append((i + 1, side, entry, stop, tgt))
            last[v] = i
            # the slot frees at the trade's exit (the 30-day lock from the fill was a side effect; loop/LOG.md, P-3 rerun)
            hold = HOLD_RANGE if v == "Q-4" else HOLD
            ex = i + 1 + hold
            for m in range(i + 1, min(i + 1 + hold, len(c))):
                if (side == 1 and l[m] <= stop) or (side == -1 and h[m] >= stop):
                    ex = m
                    break
                if m > i + 1 and ((side == 1 and h[m] >= tgt) or (side == -1 and l[m] <= tgt)):
                    ex = m
                    break
            busy[v] = ex

        # Q-1 / Q-1p: big-swing retracement in the bias direction
        if bias != 0 and len(conf) >= 2:
            (_, ja, ta, pa), (_, jb, tb, pb) = conf[-2], conf[-1]
            impulse = (ta == "L" and tb == "H" and bias == 1) or (ta == "H" and tb == "L" and bias == -1)
            if impulse:
                for v in ("Q-1", "Q-1p"):
                    if (ja, jb) in used_imp[v]:
                        continue
                    r_in, r_deep, r_stop = BANDS[v]
                    lv_in, lv_deep, lv_stop = (pb - r * (pb - pa) for r in (r_in, r_deep, r_stop))
                    beyond = (l[i] < lv_stop) if bias == 1 else (h[i] > lv_stop)
                    if beyond:
                        used_imp[v].add((ja, jb))
                        continue
                    in_band = (l[i] <= lv_in and c[i] > lv_deep) if bias == 1 else (h[i] >= lv_in and c[i] < lv_deep)
                    body = (c[i] - o[i]) * bias > 0
                    if in_band and body and (c[i] - pb) * bias < 0:
                        take(v, bias, lv_stop - bias * 0.1 * a, pb)
                        if out[v] and out[v][-1][0] == i + 1:
                            used_imp[v].add((ja, jb))
        # Q-2: break, retest, confirm at a round number
        if armed is not None:
            lvl, side, _ = armed
            if rejection(lvl, side, 0.25 * a):
                stop = lvl - side * 0.5 * a
                entry = o[i + 1]
                take("Q-2", side, stop, entry + side * 2 * abs(entry - stop))
                if out["Q-2"] and out["Q-2"][-1][0] == i + 1:
                    armed = None
        # Q-3: daily middle band as support or resistance, bands opening
        if bias != 0 and D["bw"][j] > D["bw"][j - 5]:
            m = D["mid"][j]
            if rejection(m, bias, 0.25 * a):
                take("Q-3", bias, m - bias * 0.5 * a, D["up"][j] if bias == 1 else D["lo"][j])
        # Q-4: squeeze read as a range; fade the outer band
        if D["bw_pct"][j] <= 0.10:
            for side, band in ((-1, D["up"][j]), (1, D["lo"][j])):
                if rejection(band, side):
                    take("Q-4", side, band - side * 0.5 * a, D["mid"][j])
    return out


def main():
    rows = []
    for k, coin in enumerate(E.ITER_COINS + E.ITER_EXT_COINS):
        try:
            h1 = E.bars_1h(coin)
        except Exception as ex:  # a coin without hourly history is reported, not hidden
            print(f"{coin}: no hourly bars ({type(ex).__name__})", flush=True)
            continue
        d1 = E.bars(coin)["1d"]
        h1 = h1[(h1.index >= d1.index[0])]
        sig = signals(d1, h1)
        a1 = E.MT.atr_of(h1.high.values, h1.low.values, h1.close.values)
        for v, s in sig.items():
            hold = HOLD_RANGE if v == "Q-4" else HOLD
            for x in FP.score_all(coin, h1[["open", "high", "low", "close"]], s, hold, k, a1):
                if T0 <= x["time"] < T1:
                    rows.append(dict(x, variant=v))
        print(f"{coin}: " + ", ".join(f"{v} {len(s)}" for v, s in sig.items()), flush=True)
    z = pd.DataFrame(rows).dropna(subset=["R", "control"])
    with gzip.GzipFile(os.path.join(HERE, "out", "P-3_iteration.csv.gz"), "wb", mtime=0) as f:
        f.write(z.to_csv(index=False).encode())
    lines = ["P-3: the Ronnie plan drawn faithfully (1h execution), 53 coins 2018-2022; edge vs matched random entries"]
    for v, g in z.groupby("variant"):
        lo, hi = attrib.week_boot(g)
        e = float((g.R - g.control).mean())
        st = "active" if lo > 0 and e >= 0.10 else ("harmful" if hi < 0 else ("equivalent-null" if hi < 0.10 else "inconclusive"))
        sides = ", ".join(f"{'long' if sd == 1 else 'short'} {(gg.R - gg.control).mean():+.2f} ({len(gg)})" for sd, gg in g.groupby("side"))
        lines.append(f"  {v}: n {len(g)}, avg R {g.R.mean():+.3f}, edge {e:+.3f} [{lo:+.3f}, {hi:+.3f}] -> {st}; {sides}")
        E.log(f"P-3 {v}", "familyQ", "iteration", dict(n=len(g), edge=e, lo=lo, hi=hi), st == "active", "faithful Ronnie plan, 1h")
    if {"Q-1", "Q-1p"} <= set(z.variant):
        d = (z[z.variant == "Q-1"].R - z[z.variant == "Q-1"].control).mean() - (z[z.variant == "Q-1p"].R - z[z.variant == "Q-1p"].control).mean()
        lines.append(f"  Fibonacci test, Q-1 minus Q-1p: {d:+.3f}")
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "p-3_plan.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
