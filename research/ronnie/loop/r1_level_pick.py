"""Loop S-2 (loop/LOG.md): when one breakout candle breaks several pivots, which level's order to place: all (the
current R-1), the nearest to the close, the deepest, or only candles that break one pivot. One slot per coin, taken
by the first fill by the hour; 1h walks with ambiguous hours on 1m; 0.05% stop slippage. Usage: python loop/r1_level_pick.py"""
import os, sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_r as FR  # noqa: E402
import r1_select as S1  # noqa: E402
import r1_zone_entry as Z  # noqa: E402
import r1_zone_entry_fine as F  # noqa: E402

POLICIES = ("all", "nearest", "deepest", "single")


def coin_rows(coin):
    d = E.bars(coin)["1d"]
    try:
        q = E.bars_1h(coin)
    except Exception:
        return []
    S = FR.state(d)
    c, a, tr = S["c"], S["a"], S["trend"]
    events = {}
    for i, kind, p in S["events"]:
        if kind not in ("break_high", "break_low") or i + 1 >= len(d) or np.isnan(a[i]) or i <= 300 or i + 1 + FR.HOLD >= len(d):
            continue
        side = 1 if kind == "break_high" else -1
        if tr[i] == side:
            events.setdefault((i, side), []).append(p)
    rows = []
    for f in (0.0, 0.5):
        orders = {}
        for (i, side), ps in events.items():
            for p in ps:
                lvl, edge = p[1], p[2]
                lower = max(edge, lvl - a[i]) if side == 1 else min(edge, lvl + a[i])
                stop = lower - side * FR.BUF * a[i]
                lim = lvl - f * (lvl - lower)
                if (lim - stop) * side > 0:
                    orders.setdefault((i, side), []).append((lim, stop))
        walked = {}  # (i, side, lim) -> walk or None
        for (i, side), os_ in orders.items():
            for lim, stop in os_:
                k, px = FR.fill(S, i + 1, side, lim)
                w = F.walk(coin, q, d, (k, i, side, px, stop, px + side * 2 * abs(px - stop), lim, 0)) if k is not None else None
                walked[(i, side, lim)] = (w, stop)
        for pol in POLICIES:
            pend = []
            for (i, side), os_ in orders.items():
                dist = [(c[i] - lim) * side for lim, _ in os_]
                if pol == "all":
                    pick = os_
                elif pol == "nearest":
                    pick = [os_[int(np.argmin(dist))]]
                elif pol == "deepest":
                    pick = [os_[int(np.argmax(dist))]]
                else:
                    pick = os_ if len(os_) == 1 else []
                for lim, stop in pick:
                    w, _ = walked[(i, side, lim)]
                    if w is not None:
                        pend.append((w[4], i, side, stop, w))
            busy = -1
            for jf, i, side, stop, w in sorted(pend, key=lambda x: (x[0], x[1])):
                if jf <= busy:
                    continue
                px, kind, ex, flag, jf, jx = w
                busy = jx
                if not (Z.T0 <= d.index[i] < Z.T1):
                    continue
                risk = abs(px - stop)
                exs = ex - side * S1.SLIP * ex if kind == "stop" else ex
                rows.append(dict(coin=coin, f=f, policy=pol, arm=d.index[i], fill=q.index[jf], exit=q.index[jx] + pd.Timedelta(hours=1),
                                 side=side, R=(exs - px) * side / risk - F.FEE * (px + exs) / risk))
    print(coin, flush=True)
    return rows


def main():
    with ProcessPoolExecutor(8) as ex:
        z = pd.DataFrame([r for rows in ex.map(coin_rows, E.ITER_COINS + E.ITER_EXT_COINS) for r in rows])
    z.to_csv(os.path.join(HERE, "out", "S-2_trades.csv.gz"), index=False)
    idx = pd.date_range(Z.T0, Z.T1, freq="W-MON", inclusive="left")
    out = ["S-2: which broken level to trade per breakout candle; one slot per coin by first fill (hour); 1h/1m walks, 0.05% stop slippage"]
    for (f, pol), g in z.groupby(["f", "policy"], sort=False):
        w = g.set_index(pd.to_datetime(g.arm))["R"].resample("W-MON").sum().reindex(idx).fillna(0)
        S1.SLOTS = 5
        acc = []
        ev = g.sort_values("fill")
        open_, taken = [], []
        for r in ev.itertuples():
            open_ = [(t, cc) for t, cc in open_ if t > r.fill]
            if len(open_) >= 5 or any(cc == r.coin for _, cc in open_):
                continue
            open_.append((r.exit, r.coin))
            taken.append((r.exit, r.R))
        aw = pd.Series([x for _, x in taken], index=pd.to_datetime([t for t, _ in taken], utc=True)).resample("W-MON").sum()
        eq = aw.cumsum()
        out.append(f"  f {f:.1f} {pol:8s}: n {len(g)}, win {np.mean(g.R > 0):.0%}, avg R {g.R.mean():+.3f}, total R {g.R.sum():.0f}, weekly Sharpe "
                   f"{w.mean() / w.std() * np.sqrt(52):.2f}; by year " + ", ".join(f"{y} {gg.R.mean():+.2f}" for y, gg in g.groupby(pd.to_datetime(g.arm).dt.year))
                   + f" | 5-slot account: {len(taken)} trades, total R {aw.sum():.0f}, Sharpe {aw.mean() / aw.std() * np.sqrt(52):.2f}, max DD {(eq - eq.cummax()).min():.0f}R")
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "r1_level_pick.txt"), "w").write(t + "\n")
    E.log("S-2", "R-1 level pick per breakout", "exploratory", dict(n=len(z), edge=np.nan, lo=np.nan, hi=np.nan), False, "see r1_level_pick.txt")


if __name__ == "__main__":
    main()
