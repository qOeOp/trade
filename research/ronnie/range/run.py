"""TrialFamily range-v1: the range box fade (R2) on crypto, FX and the 15 altcoins. See range/INTENT.md.

Writes range/events.csv.gz and range/result.txt.
"""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
import importlib.util  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, path))
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, os.path.dirname(spec.origin))
    spec.loader.exec_module(mod)
    return mod


FR = _load("filters_run", "filters/run.py")  # BTC, ETH and the nine FX majors
SR = _load("setups_run", "setups/run.py")

W, MIN_W, MAX_W, TOUCH, GAP, DRIFT = 60, 4.0, 15.0, 0.5, 5, 0.35
PAD, DEPTH, ZONE, TP_PAD, SPACING = 0.5, 1.0, 0.35, 0.25, 6
HOLD, CONTROLS = SR.HOLD, SR.CONTROLS
IS_END = SR.IS_END
RNG = np.random.default_rng(47)


def touches(x, level, a, above):
    near = np.flatnonzero(x >= level - TOUCH * a) if above else np.flatnonzero(x <= level + TOUCH * a)
    return 0 if len(near) == 0 else 1 + int(np.sum(np.diff(near) >= GAP))


def signals(d4):
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values
    out, last = [], {1: -99, -1: -99}
    for i in range(W + 20, len(c)):
        a = atr[i - 1]
        hw, lw = h[i - W:i], l[i - W:i]
        top, bot = hw.max(), lw.min()
        width = top - bot
        if not (MIN_W * a <= width <= MAX_W * a) or abs(c[i - 1] - c[i - W]) > DRIFT * width:
            continue
        if touches(hw, top, a, True) < 2 or touches(lw, bot, a, False) < 2:
            continue
        rg = h[i] - l[i]
        if rg <= 0:
            continue
        if (bot - DEPTH * a <= l[i] <= bot + TOUCH * a and bot < c[i] < bot + ZONE * width
                and (c[i] - l[i]) / rg >= 0.5 and i - last[1] >= SPACING):
            out.append((i, 1, min(l[i], bot) - PAD * a, top - TP_PAD * a))
            last[1] = i
        if (top - TOUCH * a <= h[i] <= top + DEPTH * a and top - ZONE * width < c[i] < top
                and (h[i] - c[i]) / rg >= 0.5 and i - last[-1] >= SPACING):
            out.append((i, -1, max(h[i], top) + PAD * a, bot + TP_PAD * a))
            last[-1] = i
    return out, atr


def events(name, cls, d4):
    cost = SR.COST["fx" if cls == "fx" else "crypto"]
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    sig, atr = signals(d4)
    years = d4.index.year.values
    rows = []
    for i, side, stop, tp in sig:
        e = i + 1
        if e + HOLD >= len(c):
            continue
        risk = (o[e] - stop) * side
        if risk <= 0 or (tp - o[e]) * side < risk:
            continue
        r = SR.trade(o, h, l, c, e, side, stop, tp, cost)
        if r is None:
            continue
        stop_atr, target_r = risk / atr[i], (tp - o[e]) * side / risk
        bars = np.flatnonzero((years == years[e]) & (np.arange(len(c)) > 150) & (np.arange(len(c)) < len(c) - HOLD - 2))
        ctl = [SR.trade(o, h, l, c, j, side, o[j] - side * stop_atr * atr[j - 1], o[j] + side * target_r * stop_atr * atr[j - 1], cost)
               for j in RNG.choice(bars, CONTROLS)]
        rows.append(dict(market=name, cls=cls, entry_time=d4.index[e], side=side, R=r,
                         control=float(np.mean([x for x in ctl if x is not None])), stop_atr=stop_atr, target_R=target_r))
    return rows


def main():
    from evaluate import COINS, holdout_bars
    rows = []
    for name, d4, d1 in FR.markets():
        rows += events(name, "crypto" if name in ("BTCUSD", "ETHUSDT") else "fx", d4)
        print(f"{name}: {sum(r['market'] == name for r in rows)} signals", flush=True)
    for coin in COINS:
        rows += events(coin, "alt", holdout_bars(coin)["4h"])
        print(f"{coin}: {sum(r['market'] == coin for r in rows)} signals", flush=True)
    ev = pd.DataFrame(rows)
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    ev["oos"] = ev.entry_time >= IS_END
    out = ["range-v1: R2 range box fade; avgR per signal net of costs; control = 20 random entries, same geometry",
           "class   period  n      win   avgR    control  minus control [interval]  median target R"]
    res = {}
    for cls, per, m, lvl in (("crypto", "IS", ~ev.oos, 95), ("crypto", "OOS", ev.oos, 90), ("fx", "IS", ~ev.oos, 95),
                             ("fx", "OOS", ev.oos, 90), ("alt", "all", ev.oos | ~ev.oos, 95)):
        z = ev[(ev.cls == cls) & m]
        d, lo, hi = SR.ci(z.R - z.control, lvl)
        res[(cls, per)] = (d, lo)
        out.append(f"{cls:<7} {per:<6} {len(z):5d}  {np.mean(z.R > 0):.0%}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   "
                   f"{d:+.3f} [{lo:+.3f}, {hi:+.3f}] ({lvl}%)  {z.target_R.median():.2f}")
    alt = ev[ev.cls == "alt"].groupby("market").apply(lambda g: (g.R - g.control).mean())
    out.append(f"altcoins with R above control: {int((alt > 0).sum())} of {len(alt)}")
    crypto_ok = res[("crypto", "IS")][1] > 0 and res[("crypto", "OOS")][1] > 0 and res[("alt", "all")][0] > 0
    fx_ok = res[("fx", "IS")][1] > 0 and res[("fx", "OOS")][1] > 0
    out.append(f"decision: crypto {'HOLDS' if crypto_ok else 'fails'}; FX {'HOLDS' if fx_ok else 'fails'}")
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
