"""Loop X-2 (loop/LOG.md): dynamic exits after +1R on R-1u trades. Usage: python loop/r1_dynexit.py"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_r as FR  # noqa: E402
import r1_lines as L1  # noqa: E402

FEE = 0.0006
VARIANTS = ("base", "BE1", "BE1+", "BE15", "P1", "P1BE", "T1")


def walk(o, h, l, c, k, side, px, stop0, v):
    """R of one trade (in initial risk) under exit variant v"""
    risk = abs(px - stop0)
    tgt = px + side * 2 * risk
    stop, armed, half, best = stop0, False, 0.0, (h[k] if side == 1 else l[k])
    realized = 0.0
    fee = lambda price: FEE * price / risk  # noqa: E731
    end = min(k + FR.HOLD, len(c))
    for m in range(k, end):
        hit_s = (l[m] <= stop) if side == 1 else (h[m] >= stop)
        hit_t = m > k and ((h[m] >= tgt) if side == 1 else (l[m] <= tgt))
        rem = 1.0 - half
        if hit_s:
            ex = stop if m == k else (min(o[m], stop) if side == 1 else max(o[m], stop))
            return realized + rem * ((ex - px) * side / risk - fee(px) - fee(ex))
        if hit_t:
            ex = max(o[m], tgt) if side == 1 else min(o[m], tgt)
            return realized + rem * ((ex - px) * side / risk - fee(px) - fee(ex))
        # updates take effect from the next bar
        fav = ((h[m] - px) if side == 1 else (px - l[m])) / risk
        best = max(best, h[m]) if side == 1 else min(best, l[m])
        trig = 1.5 if v == "BE15" else 1.0
        if not armed and m > k and fav >= trig and v != "base":  # the fill bar's high may predate the fill
            armed = True
            if v in ("BE1", "BE15", "P1BE"):
                stop = px
            elif v == "BE1+":
                stop = px + side * 0.1 * risk
            if v in ("P1", "P1BE"):
                lvl = px + side * 1.0 * risk
                half = 0.5
                realized += 0.5 * (1.0 - fee(px) - fee(lvl))
        if armed and v == "T1":
            stop = max(stop, best - risk) if side == 1 else min(stop, best + risk)
    ex = c[end - 1]
    return realized + (1.0 - half) * ((ex - px) * side / risk - fee(px) - fee(ex))


def main():
    rows = []
    for coin in E.ITER_COINS + E.ITER_EXT_COINS:
        d = E.bars(coin)["1d"]
        o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
        for t in L1.trades(d):
            k = t["k"]
            if not (L1.T0 <= d.index[k] < L1.T1) or k + 2 >= len(c):
                continue
            risk = abs(t["px"] - t["stop"])
            seg = slice(k, min(k + FR.HOLD, len(c)))
            r = dict(coin=coin, time=d.index[k], side=t["side"])
            for v in VARIANTS:
                r[v] = walk(o, h, l, c, k, t["side"], t["px"], t["stop"], v)
            # did the trade touch +1R before its base exit?
            ex_bar = FR.exit_bar({"h": h, "l": l}, k, t["side"], t["stop"], t["px"] + t["side"] * 2 * risk)
            ex_bar = min(ex_bar, len(c) - 1)
            seg_h, seg_l = h[k + 1:ex_bar], l[k + 1:ex_bar]  # excluding the fill bar and the exit bar (order unknown)
            fav = ((seg_h - t["px"]) if t["side"] == 1 else (t["px"] - seg_l)) / risk
            r["mfe"] = float(fav.max()) if len(fav) else 0.0
            rows.append(r)
        print(coin, flush=True)
    z = pd.DataFrame(rows)
    z.to_csv(os.path.join(HERE, "out", "X-2_trades.csv.gz"), index=False)
    loss = z[z.base < -0.5]
    out = [f"X-2: dynamic exits after +1R, R-1u development (53 coins, 2018-2022), {len(z)} trades",
           f"  base: win {np.mean(z.base > 0):.0%}; stopped (R < -0.5) {len(loss)} ({len(loss) / len(z):.0%}); of those, reached "
           f"+1R first {np.mean(loss.mfe >= 1):.0%}, +1.5R first {np.mean(loss.mfe >= 1.5):.0%}; all trades reaching +1R {np.mean(z.mfe >= 1):.0%},"
           f" of which ended at 2R {np.mean(z[z.mfe >= 1].base > 1.5):.0%}"]
    wk = pd.to_datetime(z.time, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
    weeks = pd.unique(wk)
    rng = np.random.default_rng(21)
    draws = [np.flatnonzero(np.isin(wk, rng.choice(weeks, len(weeks)))) for _ in range(2000)]
    idx = pd.date_range(L1.T0, L1.T1, freq="W-MON", inclusive="left")
    res = {}
    for v in VARIANTS:
        w = z.set_index(pd.to_datetime(z.time))[v].resample("W-MON").sum().reindex(idx).fillna(0)
        sh = w.mean() / w.std() * np.sqrt(52)
        dd = (z[v] - z.base).values
        bs = np.array([dd[ix].mean() for ix in draws])
        lo, hi = np.percentile(bs, [2.5, 97.5])
        p = float(min(np.mean(bs <= 0), np.mean(bs >= 0)) * 2)
        res[v] = (p, dd.mean(), sh)
        out.append(f"  {v:5s}: avg R {z[v].mean():+.3f}, win {np.mean(z[v] > 0):.0%}, total R {z[v].sum():.0f}, weekly Sharpe {sh:.2f}"
                   + ("" if v == "base" else f"; minus base {dd.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]"))
    cands = sorted([v for v in VARIANTS if v != "base"], key=lambda v: res[v][0])
    out.append("  Holm (two-sided, 95%, six): " + ", ".join(f"{v} p {res[v][0]:.3f} vs {0.05 / (6 - n):.4f}" for n, v in enumerate(cands)))
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "r1_dynexit.txt"), "w").write(t + "\n")
    E.log("X-2", "R-1 dynamic exits", "iteration", dict(n=len(z), edge=np.nan, lo=np.nan, hi=np.nan), False, "six exits; see r1_dynexit.txt")


if __name__ == "__main__":
    main()
