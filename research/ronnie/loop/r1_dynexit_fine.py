"""Loop X-2 on 1h bars (loop/LOG.md): dynamic exits after +1R on R-1u trades, events ordered by hourly bars; counts
the trades where a single hourly bar touches both the stop and a target/trigger (order still unknown).
Usage: python loop/r1_dynexit_fine.py"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_r as FR  # noqa: E402
import r1_dynexit as X  # noqa: E402
import r1_lines as L1  # noqa: E402

PER_DAY = 24


def walk(o, h, l, c, f, side, px, stop0, v, hold):
    risk = abs(px - stop0)
    tgt = px + side * 2 * risk
    stop, armed, half, best, realized, mfe, amb = stop0, False, 0.0, None, 0.0, 0.0, False
    fee = lambda price: X.FEE * price / risk  # noqa: E731
    end = min(f + hold, len(c))
    trig = 1.5 if v == "BE15" else 1.0
    for m in range(f, end):
        hit_s = (l[m] <= stop) if side == 1 else (h[m] >= stop)
        hit_t = m > f and ((h[m] >= tgt) if side == 1 else (l[m] <= tgt))
        fav = ((h[m] - px) if side == 1 else (px - l[m])) / risk
        if hit_s and m > f and (hit_t or (not armed and v != "base" and fav >= trig)):
            amb = True
        rem = 1.0 - half
        if hit_s:
            ex = stop if m == f else (min(o[m], stop) if side == 1 else max(o[m], stop))
            return realized + rem * ((ex - px) * side / risk - fee(px) - fee(ex)), mfe, amb
        if hit_t:
            ex = max(o[m], tgt) if side == 1 else min(o[m], tgt)
            return realized + rem * ((ex - px) * side / risk - fee(px) - fee(ex)), mfe, amb
        if m == f:
            continue
        mfe = max(mfe, fav)
        best = (h[m] if best is None else max(best, h[m])) if side == 1 else (l[m] if best is None else min(best, l[m]))
        if not armed and fav >= trig and v != "base":
            armed = True
            if v in ("BE1", "BE15", "P1BE"):
                stop = px
            elif v == "BE1+":
                stop = px + side * 0.1 * risk
            if v in ("P1", "P1BE"):
                half = 0.5
                realized += 0.5 * (1.0 - fee(px) - fee(px + side * risk))
        if armed and v == "T1":
            stop = max(stop, best - risk) if side == 1 else min(stop, best + risk)
    ex = c[end - 1]
    return realized + (1.0 - half) * ((ex - px) * side / risk - fee(px) - fee(ex)), mfe, amb


def main():
    rows, missing = [], []
    for coin in E.ITER_COINS + E.ITER_EXT_COINS:
        d = E.bars(coin)["1d"]
        try:
            q = E.bars_1h(coin)
        except Exception as ex:
            missing.append(coin)
            continue
        o, h, l, c = (q[x].values for x in ("open", "high", "low", "close"))
        for t in L1.trades(d):
            day = d.index[t["k"]]
            if not (L1.T0 <= day < L1.T1):
                continue
            j0, j1 = q.index.searchsorted(day), q.index.searchsorted(day + pd.Timedelta(days=1))
            side, px = t["side"], t["px"]
            f = next((j for j in range(j0, j1) if (side == 1 and l[j] <= px) or (side == -1 and h[j] >= px)), None)
            if f is None or f + 2 >= len(c):
                continue
            r = dict(coin=coin, time=day, side=side)
            amb_any = False
            for v in X.VARIANTS:
                r[v], mfe, amb = walk(o, h, l, c, f, side, px, t["stop"], v, FR.HOLD * PER_DAY)
                amb_any |= amb
                if v == "base":
                    r["mfe"] = mfe
            r["ambiguous"] = amb_any
            rows.append(r)
        print(coin, flush=True)
    z = pd.DataFrame(rows)
    z.to_csv(os.path.join(HERE, "out", "X-2_1h_trades.csv.gz"), index=False)
    loss = z[z.base < -0.5]
    out = [f"X-2 on 1h bars: dynamic exits after +1R, R-1u development, {len(z)} trades on {z.coin.nunique()} coins"
           + (f" (no hourly bars: {', '.join(missing)})" if missing else ""),
           f"  a single hourly bar touched both the stop and the target or +1R trigger in {z.ambiguous.mean():.1%} of trades (counted as the stop)",
           f"  base: win {np.mean(z.base > 0):.0%}; stopped {len(loss)} ({len(loss) / len(z):.0%}); of those, reached +1R first "
           f"{np.mean(loss.mfe >= 1):.0%}, +1.5R first {np.mean(loss.mfe >= 1.5):.0%}; trades reaching +1R {np.mean(z.mfe >= 1):.0%}, "
           f"of which ended at 2R {np.mean(z[z.mfe >= 1].base > 1.5):.0%}"]
    wk = pd.to_datetime(z.time, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
    weeks = pd.unique(wk)
    rng = np.random.default_rng(23)
    draws = [np.flatnonzero(np.isin(wk, rng.choice(weeks, len(weeks)))) for _ in range(2000)]
    idx = pd.date_range(L1.T0, L1.T1, freq="W-MON", inclusive="left")
    res = {}
    for v in X.VARIANTS:
        w = z.set_index(pd.to_datetime(z.time))[v].resample("W-MON").sum().reindex(idx).fillna(0)
        sh = w.mean() / w.std() * np.sqrt(52)
        dd = (z[v] - z.base).values
        bs = np.array([dd[ix].mean() for ix in draws])
        lo, hi = np.percentile(bs, [2.5, 97.5])
        res[v] = (float(min(np.mean(bs <= 0), np.mean(bs >= 0)) * 2), dd.mean(), sh)
        out.append(f"  {v:5s}: avg R {z[v].mean():+.3f}, win {np.mean(z[v] > 0):.0%}, total R {z[v].sum():.0f}, weekly Sharpe {sh:.2f}"
                   + ("" if v == "base" else f"; minus base {dd.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]"))
    cands = sorted([v for v in X.VARIANTS if v != "base"], key=lambda v: res[v][0])
    out.append("  Holm (two-sided, 95%, six): " + ", ".join(f"{v} p {res[v][0]:.3f} vs {0.05 / (6 - n):.4f}" for n, v in enumerate(cands)))
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "r1_dynexit_1h.txt"), "w").write(t + "\n")
    E.log("X-2 1h", "R-1 dynamic exits", "iteration", dict(n=len(z), edge=np.nan, lo=np.nan, hi=np.nan), False, "1h-ordered; see r1_dynexit_1h.txt")


if __name__ == "__main__":
    main()
